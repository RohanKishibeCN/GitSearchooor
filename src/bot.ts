import { appendDeadletter } from "./deadletter";
import type { Config } from "./config";
import { desensitize } from "./masking";
import { NotionWriter } from "./notion/writer";
import { StateDB, type Hit, makeDedupKey } from "./db";
import { GitHubClient, GitHubHttpError, type CodeHit, type Repo } from "./github/client";
import { shouldPauseBucket, type RateLimitState } from "./github/rateLimit";
import { shouldSkipContent, shouldSkipPath } from "./filters";
import { containsSecretPattern } from "./secretPatterns";
import { nowSec, sleepMs, tsToIso } from "./time";

export type RunStats = {
  repos: number;
  repos_skipped: number;
  hits_seen: number;
  hits_new: number;
  hits_existing: number;
  notion_created: number;
  notion_updated: number;
  deadletter: number;
};

export type TermBatch = {
  query: string;
  terms: string[];
};

// GitHub Search 对查询有 256 字符、最多 5 个布尔运算符的限制。
// 这里按长度+数量分批，并丢弃单个过长的 term，避免整批 422。
export function batchLeakTerms(
  terms: string[],
  opts: { maxBatchSize?: number; maxQueryLen?: number } = {}
): TermBatch[] {
  const maxBatchSize = Math.max(1, opts.maxBatchSize ?? 4);
  const maxQueryLen = Math.max(1, opts.maxQueryLen ?? 200);
  const batches: TermBatch[] = [];
  let cur: string[] = [];
  let curLen = 0;

  const push = () => {
    if (cur.length > 0) {
      batches.push({ query: cur.map((t) => `"${t}"`).join(" OR "), terms: [...cur] });
      cur = [];
      curLen = 0;
    }
  };

  for (const raw of terms) {
    const t = (raw || "").trim();
    if (!t) continue;
    const quoted = `"${t}"`;
    if (quoted.length > maxQueryLen) continue; // 单 term 超长：直接丢弃该 term
    const addLen = curLen === 0 ? quoted.length : 4 + quoted.length;
    if (cur.length >= maxBatchSize || curLen + addLen > maxQueryLen) push();
    cur.push(t);
    curLen += curLen === 0 ? quoted.length : 4 + quoted.length;
  }
  push();
  return batches;
}

// 从命中片段中提取实际命中的关键词（而不是整批 OR 查询串）。
// 片段缺失时返回空数组，由调用方回退到批查询串。
export function extractMatchedTerms(fragment: string | undefined, batchTerms: string[]): string[] {
  if (!fragment || batchTerms.length === 0) return [];
  const low = fragment.toLowerCase();
  const found: string[] = [];
  for (const t of batchTerms) {
    if (low.includes(t.toLowerCase())) found.push(t);
  }
  return found;
}

export async function runOnce(cfg: Config, opts: { dryRun: boolean; db: StateDB; gh: GitHubClient; notion?: NotionWriter }): Promise<RunStats> {
  const stats: RunStats = {
    repos: 0,
    repos_skipped: 0,
    hits_seen: 0,
    hits_new: 0,
    hits_existing: 0,
    notion_created: 0,
    notion_updated: 0,
    deadletter: 0
  };

  let repos: Repo[];
  try {
    repos = await fetchReposWithSampling(cfg, opts.gh);
  } catch (e: any) {
    // repo 搜索失败（503/限流/网络等）不应中止整轮，记录后直接结束本轮
    opts.db.logEvent("repo_search_failed", JSON.stringify({ error: String(e?.message ?? e) }));
    return stats;
  }
  // 记录本轮实际扫描的仓库，便于观察查询/黑名单效果
  opts.db.logEvent("repos_scanned", JSON.stringify(repos.map((r) => r.fullName)));
  const termBatches = batchLeakTerms(cfg.github.leakTerms);
  const ecosystemCache = new Map<string, string>();

  for (const repo of repos) {
    await pauseForBudget(cfg, opts.gh);
    stats.repos += 1;

    let keptInRepo = 0;
    let repoHasAnyMatch = false;
    for (const batch of termBatches) {
      if (cfg.github.maxHitsPerRepo > 0 && keptInRepo >= cfg.github.maxHitsPerRepo) break;
      await pauseForBudget(cfg, opts.gh);

      let hits: CodeHit[];
      try {
        hits = await opts.gh.searchCode(repo.fullName, batch.query, cfg.github.perRepoCodeHits);
      } catch (e: any) {
        const isRateLimited = e instanceof GitHubHttpError && (e.status === 429 || e.status === 403);
        if (isRateLimited) {
          // 限流：立即停手整轮，避免连续请求把账号风控喂得更狠
          opts.db.logEvent("rate_limit_stop", JSON.stringify({ repo: repo.fullName, error: String(e?.message ?? e) }));
          return stats;
        }
        // 其他错误（422/5xx/网络等）只跳过该批次，不中断整轮
        opts.db.logEvent("term_search_failed", JSON.stringify({ repo: repo.fullName, error: String(e?.message ?? e) }));
        continue;
      }

      for (const h of hits) {
        if (cfg.github.maxHitsPerRepo > 0 && keptInRepo >= cfg.github.maxHitsPerRepo) break;
        stats.hits_seen += 1;
        if (shouldSkipPath(h.filePath, cfg.github.pathFilter)) continue;
        const snippet = await getSnippet(cfg, opts.gh, h);
        // 无片段（fragment 缺失且拉文件失败/被限流）不产生无上下文价值的记录
        if (!snippet) continue;
        if (shouldSkipContent(snippet, cfg.github.contentFilter)) continue;
        if (
          cfg.github.requireSecretPattern &&
          !containsSecretPattern(snippet, {
            base58MinLen: cfg.github.secretPattern.base58MinLen,
            enableMnemonic: cfg.github.secretPattern.enableMnemonic,
            enableBase58: cfg.github.secretPattern.enableBase58
          })
        )
          continue;
        repoHasAnyMatch = true;
        const snippetMasked = desensitize(snippet);

        // 记录实际命中的关键词（而非整批 OR 查询串），用于 Notion Term 与 dedup
        const matchedTerms = extractMatchedTerms(snippet, batch.terms);
        const term = matchedTerms[0] ?? batch.query;

        const scannedAt = nowSec();
        const dk = makeDedupKey(h.repoFullName, h.filePath, h.blobSha, term);
        const rec: Hit = {
          dedup_key: dk,
          repo: h.repoFullName,
          repo_url: h.repoHtmlUrl,
          file_path: h.filePath,
          file_url: h.fileHtmlUrl,
          blob_sha: h.blobSha,
          term,
          ecosystem: await getEcosystemCached(cfg, opts.gh, h.repoFullName, ecosystemCache),
          snippet_masked: snippetMasked,
          scanned_at: scannedAt
        };

        const { isNew, row } = opts.db.upsertHitSeen(rec);
        if (isNew) stats.hits_new += 1;
        else stats.hits_existing += 1;
        keptInRepo += 1;

        const notionTerms = matchedTerms.length > 0 ? matchedTerms : [term];
        const fields = buildNotionFields(cfg, rec, row, notionTerms);

        if (opts.dryRun) {
          opts.db.logEvent("dry_run_notion_payload", JSON.stringify({ is_new: isNew, fields }));
          continue;
        }

        if (!opts.notion) throw new Error("notion writer is not provided");

        try {
          const pageId = row?.notion_page_id ? String(row.notion_page_id) : "";
          if (isNew) {
            const res = await opts.notion.createPage(fields);
            const pid = (res as any)?.id;
            if (typeof pid === "string" && pid) opts.db.setNotionPageId(rec.dedup_key, pid);
            stats.notion_created += 1;
          } else if (pageId) {
            await opts.notion.updatePage(pageId, { last_seen: fields.last_seen, hit_count: fields.hit_count });
            stats.notion_updated += 1;
          } else {
            if (cfg.notion.backfillMissingPage) {
              const res = await opts.notion.createPage(fields);
              const pid = (res as any)?.id;
              if (typeof pid === "string" && pid) opts.db.setNotionPageId(rec.dedup_key, pid);
              stats.notion_created += 1;
              opts.db.logEvent("notion_backfill_created", rec.dedup_key);
            } else {
              opts.db.logEvent("notion_page_id_missing", rec.dedup_key);
            }
          }
        } catch (e: any) {
          stats.deadletter += 1;
          opts.db.logEvent("notion_write_failed", String(e?.message ?? e));
          appendDeadletter(cfg.paths.deadletterPath, { ts: nowSec(), error: String(e?.message ?? e), fields });
        }
      }
    }
    if (!repoHasAnyMatch) {
      stats.repos_skipped += 1;
    }
  }

  return stats;
}

export async function runLoop(cfg: Config, opts: { envFile: string; dryRun: boolean }): Promise<void> {
  const db = new StateDB(cfg.paths.sqliteDbPath);
  db.init();

  const rateLimit = { search: {}, core: {} } satisfies RateLimitState;
  const gh = new GitHubClient({
    baseUrl: cfg.github.apiBaseUrl,
    token: cfg.github.token,
    userAgent: cfg.github.userAgent,
    timeoutSec: cfg.github.httpTimeoutSec,
    searchMinRemaining: cfg.github.searchMinRemaining,
    coreMinRemaining: cfg.github.coreMinRemaining,
    rateLimit
  });

  let notion: NotionWriter | undefined;
  let validated = false;

  for (;;) {
    const startedAt = nowSec();

    try {
      if (!opts.dryRun) {
        notion = new NotionWriter({ token: cfg.notion.token, databaseId: cfg.notion.databaseId, props: cfg.notion.props });
        if (!validated || cfg.notion.validateEachLoop) {
          await notion.validateDatabaseSchema(cfg);
          validated = true;
          db.logEvent("notion_schema_ok", cfg.notion.databaseId);
        }
      }

      const stats = await runOnce(cfg, { dryRun: opts.dryRun, db, gh, notion });
      db.logEvent("run_stats", JSON.stringify(stats));
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      db.logEvent("run_failed", msg);

      if (e instanceof GitHubHttpError) {
        const bodyMsg = String(e.body?.message ?? "");
        const isRate = e.status === 429 || (e.status === 403 && /rate limit/i.test(bodyMsg));
        if (isRate) db.logEvent("github_rate_limited", JSON.stringify({ status: e.status, bucket: e.bucket, message: bodyMsg }));
      }
    }

    const sleepForMs = computeLoopSleepMs(cfg, gh.rateLimit, startedAt);
    db.logEvent("loop_sleep", JSON.stringify({ ms: sleepForMs, rate_limit: gh.rateLimit }));
    await sleepMs(sleepForMs);
  }
}

function computeLoopSleepMs(cfg: Config, rateLimit: RateLimitState, startedAtSec: number): number {
  const now = nowSec();
  const minMs = Math.max(0, cfg.loop.minIntervalSec * 1000 - (now - startedAtSec) * 1000);
  const maxMs = cfg.loop.maxIntervalSec * 1000;

  const s = shouldPauseBucket(rateLimit.search, cfg.github.searchMinRemaining);
  const c = shouldPauseBucket(rateLimit.core, cfg.github.coreMinRemaining);
  const untilSec = Math.max(s.sleepUntilSec ?? 0, c.sleepUntilSec ?? 0);

  let sleepMs = minMs;
  if (untilSec > 0) {
    const jitter = cfg.loop.jitterSec > 0 ? Math.floor(Math.random() * cfg.loop.jitterSec) : 0;
    const resetMs = Math.max(0, (untilSec - now) * 1000) + jitter * 1000;
    sleepMs = Math.max(sleepMs, resetMs);
  }

  if (sleepMs > maxMs) sleepMs = maxMs;
  return Math.max(0, Math.floor(sleepMs));
}

export function buildRepoQuery(cfg: Config): string {
  const q = (cfg.github.repoQuery || "").trim();
  if (cfg.github.repoPushedDays <= 0) return q;
  if (/\bpushed:/i.test(q)) return q;
  const since = new Date(Date.now() - cfg.github.repoPushedDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
  if (!q) return `pushed:>=${since}`;
  return `${q} pushed:>=${since}`;
}

export async function fetchReposWithSampling(cfg: Config, gh: GitHubClient): Promise<Repo[]> {
  const perPage = Math.max(1, cfg.github.reposPerRun);
  const query = buildRepoQuery(cfg);
  const blacklist = new Set(cfg.github.repoBlacklist || []);

  const repoMap = new Map<string, Repo>();
  const addUnique = (items: Repo[]) => {
    for (const r of items) {
      if (!blacklist.has(r.fullName) && !repoMap.has(r.fullName)) {
        repoMap.set(r.fullName, r);
      }
    }
  };

  // 首屏只取配额的一半，为后面的随机分页采样留出空间，
  // 否则首屏 100 条 >= 配额，采样逻辑永远不触发（死代码）。
  const firstPerPage = Math.min(100, Math.max(1, Math.round(perPage * 0.5)));
  const firstPage = await gh.searchRepos(query, firstPerPage, 1);
  addUnique(firstPage.items);

  const totalCount = firstPage.totalCount;
  const maxPageTotal = Math.ceil(totalCount / 100);
  // GitHub Search 单查询最多返回 1000 条（10 页 x 100），超出页码会 422
  const maxPage = Math.min(maxPageTotal, 10, cfg.github.repoSearchPageLimit);

  if (maxPage > 1 && repoMap.size < perPage) {
    const pagesToTry = Math.min(3, maxPage - 1);
    const pages = new Set<number>();
    while (pages.size < pagesToTry) {
      pages.add(Math.floor(Math.random() * (maxPage - 1)) + 2);
    }

    for (const page of pages) {
      if (repoMap.size >= perPage) break;
      try {
        const want = Math.min(100, perPage - repoMap.size);
        const pageResult = await gh.searchRepos(query, want, page, "stars", "asc");
        addUnique(pageResult.items);
      } catch {
        continue;
      }
    }
  }

  const result = [...repoMap.values()];
  if (result.length > perPage) return result.slice(0, perPage);
  return result;
}

async function getEcosystemCached(
  cfg: Config,
  gh: GitHubClient,
  repo: string,
  cache: Map<string, string>
): Promise<string> {
  const cached = cache.get(repo);
  if (cached !== undefined) return cached;
  let eco = "unknown";
  try {
    eco = await detectEcosystem(cfg, gh, repo);
  } catch {
    // 生态判定失败不阻塞命中入库
    eco = "unknown";
  }
  cache.set(repo, eco);
  return eco;
}

async function detectEcosystem(cfg: Config, gh: GitHubClient, repo: string): Promise<string> {
  const corePause = shouldPauseBucket(gh.rateLimit.core, cfg.github.coreMinRemaining);
  if (corePause.should) return "unknown";

  let blob = "";
  for (const fn of cfg.github.dependencyFiles) {
    try {
      blob += `\n${(await gh.getFileText(repo, fn)) || ""}`;
    } catch {
      continue;
    }
    if (blob.length > 300_000) break;
  }
  const low = blob.toLowerCase();
  const hasEth = cfg.github.ethereumMarkers.some((m) => low.includes(m.toLowerCase()));
  const hasSol = cfg.github.solanaMarkers.some((m) => low.includes(m.toLowerCase()));
  if (hasEth && hasSol) return "both";
  if (hasEth) return "ethereum";
  if (hasSol) return "solana";
  return "unknown";
}

async function getSnippet(cfg: Config, gh: GitHubClient, h: CodeHit): Promise<string> {
  if (h.fragment) return h.fragment;
  if (!h.filePath) return "";
  const corePause = shouldPauseBucket(gh.rateLimit.core, cfg.github.coreMinRemaining);
  if (corePause.should) return "";
  try {
    const t = await gh.getFileText(h.repoFullName, h.filePath);
    return (t || "").slice(0, 900);
  } catch {
    return "";
  }
}

function buildNotionFields(cfg: Config, rec: Hit, row: any, terms?: string[]): Record<string, any> {
  const title = `${rec.repo} ${rec.file_path}`;
  const firstSeenIso = tsToIso(Number(row?.first_seen ?? rec.scanned_at));
  const lastSeenIso = tsToIso(Number(row?.last_seen ?? rec.scanned_at));
  const hitCount = Number(row?.hit_count ?? 1);

  return {
    title,
    repo_url: rec.repo_url,
    file_url: rec.file_url,
    file_path: rec.file_path,
    term: terms && terms.length > 0 ? terms : [rec.term],
    snippet: rec.snippet_masked,
    ecosystem: rec.ecosystem,
    blob_sha: rec.blob_sha,
    status: cfg.notion.defaultStatus,
    dedup_key: rec.dedup_key,
    first_seen: firstSeenIso,
    last_seen: lastSeenIso,
    hit_count: hitCount,
    notes: "",
    tags: []
  };
}

// 搜索配额不足时睡到 reset 再继续，而不是中止整轮。
// 否则 10 次/分钟的 Search 配额下，每轮只用掉 9 次就被 budget_stop 掐断，
// 之后又睡 1 小时 —— 配额利用率只有 15%。
async function pauseForBudget(cfg: Config, gh: GitHubClient): Promise<void> {
  const p = shouldPauseBucket(gh.rateLimit.search, cfg.github.searchMinRemaining);
  if (!p.should || p.sleepUntilSec === undefined) return;
  const waitSec = p.sleepUntilSec - nowSec();
  if (waitSec <= 0) return;
  // GitHub 的标准退避最长约 1 小时；这里只做防御性上限，不截断退避时间
  await sleepMs(Math.min(waitSec, 21600) * 1000);
}
