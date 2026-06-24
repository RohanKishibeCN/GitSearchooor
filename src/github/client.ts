import { emptyRateLimitState, type RateBucketName, type RateLimitState, updateRateLimitFromHeaders } from "./rateLimit";

export type Repo = {
  fullName: string;
  htmlUrl: string;
  updatedAt?: string;
  stars?: number;
};

export type CodeHit = {
  repoFullName: string;
  repoHtmlUrl: string;
  filePath: string;
  fileHtmlUrl: string;
  blobSha: string;
  fragment?: string;
};

export class GitHubHttpError extends Error {
  status: number;
  bucket: RateBucketName;
  body: any;
  constructor(status: number, bucket: RateBucketName, body: any) {
    super(`GitHub API failed: status=${status}${formatBodyForMessage(body)}`);
    this.status = status;
    this.bucket = bucket;
    this.body = body;
  }
}

export type RepoSearchResult = {
  items: Repo[];
  totalCount: number;
};

export class GitHubClient {
  readonly rateLimit: RateLimitState;
  private baseUrl: string;
  private token: string;
  private userAgent: string;
  private timeoutSec: number;
  private searchMinRemaining: number;
  private coreMinRemaining: number;

  constructor(opts: {
    baseUrl: string;
    token: string;
    userAgent: string;
    timeoutSec: number;
    searchMinRemaining: number;
    coreMinRemaining: number;
    rateLimit?: RateLimitState;
  }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.userAgent = opts.userAgent;
    this.timeoutSec = opts.timeoutSec;
    this.searchMinRemaining = Math.max(0, opts.searchMinRemaining);
    this.coreMinRemaining = Math.max(0, opts.coreMinRemaining);
    this.rateLimit = opts.rateLimit ?? emptyRateLimitState();
  }

  private async requestJson(bucket: RateBucketName, url: string, init?: RequestInit): Promise<any> {
    await this.maybePause(bucket);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutSec * 1000);

    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          ...(init?.headers ?? {}),
          Authorization: `Bearer ${this.token}`,
          "User-Agent": this.userAgent,
          Accept: "application/vnd.github+json"
        }
      });

      updateRateLimitFromHeaders(this.rateLimit, bucket, res.headers);

      const txt = await res.text();
      const body = txt ? safeJsonParse(txt) : null;

      if (!res.ok) {
        throw new GitHubHttpError(res.status, bucket, body);
      }

      return body;
    } finally {
      clearTimeout(t);
    }
  }

  async searchRepos(query: string, limit: number, page?: number, sort?: string, order?: string): Promise<RepoSearchResult> {
    const url = new URL(`${this.baseUrl}/search/repositories`);
    url.searchParams.set("q", query);
    url.searchParams.set("per_page", String(limit));
    if (page && page > 0) url.searchParams.set("page", String(page));
    if (sort) url.searchParams.set("sort", sort);
    if (order) url.searchParams.set("order", order);

    const data = await this.requestJson("search", url.toString());
    const totalCount = typeof data?.total_count === "number" ? data.total_count : 0;
    const items = Array.isArray(data?.items) ? data.items : [];

    const repos: Repo[] = [];
    for (const i of items) {
      if (!i || typeof i !== "object") continue;
      const fullName = i.full_name;
      const htmlUrl = i.html_url;
      if (!fullName || !htmlUrl) continue;
      repos.push({
        fullName,
        htmlUrl,
        updatedAt: i.updated_at ?? undefined,
        stars: typeof i.stargazers_count === "number" ? i.stargazers_count : undefined
      });
    }
    return { items: repos, totalCount };
  }

  async searchCode(repo: string, term: string, perPage: number): Promise<CodeHit[]> {
    const q = `${term} repo:${repo}`;
    const url = new URL(`${this.baseUrl}/search/code`);
    url.searchParams.set("q", q);
    url.searchParams.set("per_page", String(perPage));

    const data = await this.requestJson("search", url.toString(), {
      headers: {
        Accept: "application/vnd.github.text-match+json"
      }
    });

    const items = Array.isArray(data?.items) ? data.items : [];
    const hits: CodeHit[] = [];

    for (const i of items) {
      if (!i || typeof i !== "object") continue;
      const repoObj = i.repository ?? {};
      const repoFull = repoObj.full_name ?? repo;
      const repoUrl = repoObj.html_url ?? `https://github.com/${repoFull}`;
      const filePath = i.path ?? "";
      const fileHtmlUrl = i.html_url ?? "";
      const blobSha = i.sha ?? "";
      let fragment: string | undefined;
      const tms = Array.isArray(i.text_matches) ? i.text_matches : [];
      if (tms.length > 0 && typeof tms[0] === "object") {
        fragment = tms[0].fragment ?? undefined;
      }

      hits.push({
        repoFullName: repoFull,
        repoHtmlUrl: repoUrl,
        filePath,
        fileHtmlUrl,
        blobSha,
        fragment
      });
    }

    return hits;
  }

  async getFileText(repo: string, filePath: string): Promise<string> {
    const url = `${this.baseUrl}/repos/${repo}/contents/${encodeURIComponent(filePath).replace(/%2F/g, "/")}`;
    const data = await this.requestJson("core", url);
    if (!data || typeof data !== "object") return "";
    if (data.encoding !== "base64" || typeof data.content !== "string") return "";
    try {
      return Buffer.from(data.content, "base64").toString("utf8");
    } catch {
      return "";
    }
  }

  private async maybePause(bucket: RateBucketName): Promise<void> {
    const b = this.rateLimit[bucket];
    const nowSec = (Date.now() / 1000) | 0;

    if (b.retryAfterSec && b.retryAfterSec > 0) {
      await sleepMs(b.retryAfterSec * 1000);
      return;
    }

    const minRemaining = bucket === "search" ? this.searchMinRemaining : this.coreMinRemaining;
    if (b.remaining === undefined || b.resetAtSec === undefined) return;
    if (b.remaining > minRemaining) return;
    if (b.resetAtSec <= nowSec) return;
    await sleepMs((b.resetAtSec - nowSec + 1) * 1000);
  }
}

function safeJsonParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return { raw: s };
  }
}

function formatBodyForMessage(body: any): string {
  if (!body || typeof body !== "object") return "";
  const msg = typeof body.message === "string" ? body.message : "";
  const errors = Array.isArray(body.errors) ? body.errors : [];
  const errStr = errors
    .slice(0, 3)
    .map((e: any) => {
      if (!e || typeof e !== "object") return "";
      const r = typeof e.resource === "string" ? e.resource : "";
      const f = typeof e.field === "string" ? e.field : "";
      const c = typeof e.code === "string" ? e.code : "";
      const m = typeof e.message === "string" ? e.message : "";
      const parts = [r && `resource=${r}`, f && `field=${f}`, c && `code=${c}`, m && `message=${m}`].filter(Boolean);
      return parts.join(" ");
    })
    .filter(Boolean)
    .join("; ");

  if (msg && errStr) return ` message=${msg} errors=${errStr}`;
  if (msg) return ` message=${msg}`;
  if (errStr) return ` errors=${errStr}`;
  return "";
}

async function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
