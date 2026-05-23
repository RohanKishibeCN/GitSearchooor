import { appendDeadletter } from "./deadletter";
import type { Config } from "./config";
import { desensitize } from "./masking";
import { NotionWriter } from "./notion/writer";
import { StateDB, type Hit, makeDedupKey } from "./db";
import { GitHubClient, GitHubHttpError, type CodeHit } from "./github/client";
import { shouldPauseBucket, type RateLimitState } from "./github/rateLimit";
import { shouldSkipContent, shouldSkipPath } from "./filters";
import { nowSec, sleepMs, tsToIso } from "./time";

export type RunStats = {
  repos: number;
  hits_seen: number;
  hits_new: number;
  hits_existing: number;
  notion_created: number;
  notion_updated: number;
  deadletter: number;
};

export async function runOnce(cfg: Config, opts: { dryRun: boolean; db: StateDB; gh: GitHubClient; notion?: NotionWriter }): Promise<RunStats> {
  const stats: RunStats = {
    repos: 0,
    hits_seen: 0,
    hits_new: 0,
    hits_existing: 0,
    notion_created: 0,
    notion_updated: 0,
    deadletter: 0
  };

  const repos = await opts.gh.searchRepos(buildRepoQuery(cfg), cfg.github.reposPerRun);
  for (const repo of repos) {
    if (shouldStopForBudget(cfg, opts.gh)) {
      opts.db.logEvent("budget_stop", JSON.stringify({ where: "before_repo", rate_limit: opts.gh.rateLimit }));
      return stats;
    }
    stats.repos += 1;
    const ecosystem = await detectEcosystem(cfg, opts.gh, repo.fullName);

    let keptInRepo = 0;
    for (const term of cfg.github.leakTerms) {
      if (cfg.github.maxHitsPerRepo > 0 && keptInRepo >= cfg.github.maxHitsPerRepo) break;
      if (shouldStopForBudget(cfg, opts.gh)) {
        opts.db.logEvent("budget_stop", JSON.stringify({ where: "before_term", rate_limit: opts.gh.rateLimit }));
        return stats;
      }
      const hits = await opts.gh.searchCode(repo.fullName, term, cfg.github.perRepoCodeHits);
      for (const h of hits) {
        if (cfg.github.maxHitsPerRepo > 0 && keptInRepo >= cfg.github.maxHitsPerRepo) break;
        stats.hits_seen += 1;
        if (shouldSkipPath(h.filePath, cfg.github.pathFilter)) continue;
        const snippet = await getSnippet(cfg, opts.gh, h);
        if (shouldSkipContent(snippet, cfg.github.contentFilter)) continue;
        const snippetMasked = desensitize(snippet);

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
          ecosystem,
          snippet_masked: snippetMasked,
          scanned_at: scannedAt
        };

        const { isNew, row } = opts.db.upsertHitSeen(rec);
        if (isNew) stats.hits_new += 1;
        else stats.hits_existing += 1;
        keptInRepo += 1;

        const fields = buildNotionFields(cfg, rec, row);

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

function buildRepoQuery(cfg: Config): string {
  const q = (cfg.github.repoQuery || "").trim();
  if (cfg.github.repoPushedDays <= 0) return q;
  if (/\bpushed:/i.test(q)) return q;
  const since = new Date(Date.now() - cfg.github.repoPushedDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
  if (!q) return `pushed:>=${since}`;
  return `${q} pushed:>=${since}`;
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

function buildNotionFields(cfg: Config, rec: Hit, row: any): Record<string, any> {
  const title = `${rec.repo} ${rec.file_path}`;
  const firstSeenIso = tsToIso(Number(row?.first_seen ?? rec.scanned_at));
  const lastSeenIso = tsToIso(Number(row?.last_seen ?? rec.scanned_at));
  const hitCount = Number(row?.hit_count ?? 1);

  return {
    title,
    repo_url: rec.repo_url,
    file_url: rec.file_url,
    file_path: rec.file_path,
    term: [rec.term],
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

function shouldStopForBudget(cfg: Config, gh: GitHubClient): boolean {
  const s = shouldPauseBucket(gh.rateLimit.search, cfg.github.searchMinRemaining);
  if (s.should) return true;
  return false;
}
