import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  batchLeakTerms,
  buildRepoQuery,
  extractMatchedTerms,
  fetchReposWithSampling,
  runOnce
} from "../src/bot";
import { loadConfig, type Config } from "../src/config";
import { StateDB } from "../src/db";
import type { GitHubClient, Repo } from "../src/github/client";
import type { NotionWriter } from "../src/notion/writer";

const BASE_ENV: Record<string, string> = {
  GITHUB_TOKEN: "test-token",
  GITHUB_REPO_QUERY: "ethereum is:public",
  GITHUB_REPOS_PER_RUN: "2",
  GITHUB_PER_REPO_CODE_HITS: "5",
  GITHUB_MAX_HITS_PER_REPO: "3",
  GITHUB_REQUIRE_SECRET_PATTERN: "0",
  GITHUB_PATH_FILTER_ENABLED: "0",
  GITHUB_CONTENT_FILTER_ENABLED: "0",
  GITHUB_REPO_SEARCH_PAGE_LIMIT: "1",
  GITHUB_REPO_PUSHED_DAYS: "0",
  LEAK_TERMS: "mnemonic,PRIVATE_KEY",
  DEPENDENCY_FILES: "package.json",
  ETHEREUM_MARKERS: "ethers",
  SOLANA_MARKERS: "@solana/web3.js"
};

function makeCfg(overrides: Record<string, string> = {}): Config {
  const saved: Record<string, string | undefined> = {};
  const env = { ...BASE_ENV, ...overrides };
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  const cfg = loadConfig();
  for (const k of Object.keys(env)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  return cfg;
}

function tmpDb(): StateDB {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gitsearchooor-bot-"));
  const db = new StateDB(path.join(dir, "state.db"));
  db.init();
  return db;
}

type FakeGH = {
  searchRepos: ReturnType<typeof vi.fn>;
  searchCode: ReturnType<typeof vi.fn>;
  getFileText: ReturnType<typeof vi.fn>;
  rateLimit: { search: Record<string, number>; core: Record<string, number> };
};

function baseGH(): FakeGH {
  return {
    searchRepos: vi.fn(async (): Promise<{ items: Repo[]; totalCount: number }> => ({
      items: [{ fullName: "acme/wallet", htmlUrl: "https://github.com/acme/wallet" }],
      totalCount: 1
    })),
    searchCode: vi.fn(async () => []),
    getFileText: vi.fn(async () => ""),
    rateLimit: {
      search: { remaining: 100, resetAtSec: 9999999999 },
      core: { remaining: 100, resetAtSec: 9999999999 }
    }
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("batchLeakTerms", () => {
  it("groups terms and respects batch size + query length", () => {
    const batches = batchLeakTerms(["a", "b", "c", "d", "e"]);
    expect(batches.map((b) => b.terms)).toEqual([["a", "b", "c", "d"], ["e"]]);
    expect(batches[0].query).toBe('"a" OR "b" OR "c" OR "d"');
    expect(batches.every((b) => b.query.length <= 200)).toBe(true);
  });

  it("drops over-long terms and splits on length", () => {
    expect(batchLeakTerms(["x".repeat(300)])).toEqual([]);
    const batches = batchLeakTerms(["aaaa", "bbbb", "cccc"], { maxQueryLen: 12 });
    // `"aaaa"` = 6 字符，加一个 OR + term 后超过 12 就需要拆分
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((b) => b.query.length <= 12)).toBe(true);
  });

  it("skips empty terms", () => {
    expect(batchLeakTerms(["", "   ", "mnemonic"])).toEqual([
      { query: '"mnemonic"', terms: ["mnemonic"] }
    ]);
  });
});

describe("extractMatchedTerms", () => {
  it("finds actual matched terms in the fragment", () => {
    const terms = ["mnemonic", "seed phrase", "PRIVATE_KEY"];
    const fragment = `export const mnemonic = 'abandon about'`;
    expect(extractMatchedTerms(fragment, terms)).toEqual(["mnemonic"]);
  });

  it("returns [] when fragment is missing", () => {
    expect(extractMatchedTerms(undefined, ["mnemonic"])).toEqual([]);
    expect(extractMatchedTerms("no match here", ["mnemonic"])).toEqual([]);
  });
});

describe("buildRepoQuery", () => {
  it("appends pushed window and keeps existing pushed qualifier", () => {
    const cfg = makeCfg({ GITHUB_REPO_PUSHED_DAYS: "7" });
    const q = buildRepoQuery(cfg);
    expect(q).toContain("pushed:>=");
    expect(q).toContain("ethereum");

    const cfg2 = makeCfg({ GITHUB_REPO_QUERY: "ethereum pushed:>=2026-01-01" });
    expect(buildRepoQuery(cfg2)).toBe("ethereum pushed:>=2026-01-01");
  });
});

describe("fetchReposWithSampling", () => {
  it("samples random pages within the 10-page cap and fills quota", async () => {
    const cfg = makeCfg({
      GITHUB_REPOS_PER_RUN: "10",
      GITHUB_REPO_SEARCH_PAGE_LIMIT: "3"
    });
    const calls: Array<{ page?: number; limit: number; sort?: string; order?: string }> = [];
    const gh = {
      searchRepos: vi.fn(async (_q: string, limit: number, page?: number, sort?: string, order?: string) => {
        calls.push({ page, limit, sort, order });
        return {
          totalCount: 1000,
          items: Array.from({ length: limit }, (_, i) => ({
            fullName: `r${page ?? 1}-${i}`,
            htmlUrl: `https://github.com/r${page ?? 1}-${i}`
          }))
        };
      })
    } as unknown as GitHubClient;

    const repos = await fetchReposWithSampling(cfg, gh);
    expect(repos.length).toBe(10);
    // 至少发起首屏 + 1 次采样
    expect(calls.length).toBeGreaterThanOrEqual(2);
    // 任何页码都不能超过 10（GitHub 1000 条上限）和配置的 pageLimit
    for (const c of calls) {
      if (c.page !== undefined) expect(c.page).toBeLessThanOrEqual(3);
    }
    // 首屏应为配额的一半（5）
    expect(calls[0].limit).toBe(5);
  });

  it("does not sample when page limit is 1", async () => {
    const cfg = makeCfg({ GITHUB_REPOS_PER_RUN: "10", GITHUB_REPO_SEARCH_PAGE_LIMIT: "1" });
    const gh = {
      searchRepos: vi.fn(async (_q: string, limit: number, page?: number) => ({
        totalCount: 1000,
        items: Array.from({ length: limit }, (_, i) => ({
          fullName: `r${page ?? 1}-${i}`,
          htmlUrl: `https://github.com/r${page ?? 1}-${i}`
        }))
      }))
    } as unknown as GitHubClient;

    const repos = await fetchReposWithSampling(cfg, gh);
    expect(repos.length).toBeLessThanOrEqual(10);
    expect(gh.searchRepos).toHaveBeenCalledTimes(1);
  });
});

describe("runOnce", () => {
  it("skips hits with empty snippet even when requireSecretPattern=false", async () => {
    const cfg = makeCfg();
    const db = tmpDb();
    const gh = baseGH();
    gh.searchCode.mockResolvedValue([
      {
        repoFullName: "acme/wallet",
        repoHtmlUrl: "https://github.com/acme/wallet",
        filePath: "src/config.ts",
        fileHtmlUrl: "https://github.com/acme/wallet/blob/main/src/config.ts",
        blobSha: "abc123",
        fragment: undefined
      }
    ]);
    gh.getFileText.mockResolvedValue("");

    const createPage = vi.fn(async () => ({ id: "p1" }));
    const notion = { createPage, updatePage: vi.fn() } as unknown as NotionWriter;

    const stats = await runOnce(cfg, {
      dryRun: false,
      db,
      gh: gh as unknown as GitHubClient,
      notion
    });

    expect(stats.hits_seen).toBe(1);
    expect(stats.hits_new).toBe(0);
    expect(createPage).not.toHaveBeenCalled();
    db.close();
  });

  it("records the actual matched term instead of the batch query", async () => {
    const cfg = makeCfg();
    const db = tmpDb();
    const gh = baseGH();
    gh.searchCode.mockResolvedValue([
      {
        repoFullName: "acme/wallet",
        repoHtmlUrl: "https://github.com/acme/wallet",
        filePath: ".env",
        fileHtmlUrl: "https://github.com/acme/wallet/blob/main/.env",
        blobSha: "abc123",
        fragment: `MNEMONIC="abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"`
      }
    ]);

    const createPage = vi.fn(async () => ({ id: "p1" }));
    const notion = { createPage, updatePage: vi.fn() } as unknown as NotionWriter;

    const stats = await runOnce(cfg, { dryRun: false, db, gh: gh as unknown as GitHubClient, notion });

    expect(stats.notion_created).toBe(1);
    const fields = createPage.mock.calls[0][0] as Record<string, any>;
    // Term 应为实际命中的 "mnemonic"，而不是整批 `"mnemonic" OR "PRIVATE_KEY"`
    expect(fields.term).toEqual(["mnemonic"]);
    expect(fields.snippet).toContain("MNEMONIC_SHA256");
    db.close();
  });

  it("wires ecosystem detection into records", async () => {
    const cfg = makeCfg();
    const db = tmpDb();
    const gh = baseGH();
    gh.searchCode.mockResolvedValue([
      {
        repoFullName: "acme/wallet",
        repoHtmlUrl: "https://github.com/acme/wallet",
        filePath: ".env",
        fileHtmlUrl: "https://github.com/acme/wallet/blob/main/.env",
        blobSha: "abc123",
        fragment: `MNEMONIC="abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"`
      }
    ]);
    gh.getFileText.mockResolvedValue(`{"dependencies":{"ethers":"6.0.0"}}`);

    const createPage = vi.fn(async () => ({ id: "p1" }));
    const notion = { createPage, updatePage: vi.fn() } as unknown as NotionWriter;

    const stats = await runOnce(cfg, { dryRun: false, db, gh: gh as unknown as GitHubClient, notion });
    expect(stats.notion_created).toBe(1);
    expect((createPage.mock.calls[0][0] as Record<string, any>).ecosystem).toBe("ethereum");
    expect(gh.getFileText).toHaveBeenCalled();
    db.close();
  });

  it("isolates term-search failures and keeps scanning other repos", async () => {
    const cfg = makeCfg({ GITHUB_REPOS_PER_RUN: "4" });
    const db = tmpDb();
    const gh = baseGH();
    // 第一个 repo 的 code search 抛错，第二个 repo 正常命中
    gh.searchRepos.mockImplementation(async (_q: string, limit: number) => {
      const all = ["acme/bad", "acme/good"];
      return {
        totalCount: all.length,
        items: all.slice(0, limit).map((name) => ({ fullName: name, htmlUrl: `https://github.com/${name}` }))
      };
    });
    gh.searchCode.mockImplementation(async (repo: string) => {
      if (repo === "acme/bad") throw new Error("boom 422");
      return [
        {
          repoFullName: repo,
          repoHtmlUrl: `https://github.com/${repo}`,
          filePath: ".env",
          fileHtmlUrl: `https://github.com/${repo}/blob/main/.env`,
          blobSha: "sha2",
          fragment: `PRIVATE_KEY="0x${"b".repeat(64)}"`
        }
      ];
    });

    const createPage = vi.fn(async () => ({ id: "p2" }));
    const notion = { createPage, updatePage: vi.fn() } as unknown as NotionWriter;

    // 若 term 搜索失败未被隔离，runOnce 会直接抛错导致测试失败
    const stats = await runOnce(cfg, { dryRun: false, db, gh: gh as unknown as GitHubClient, notion });
    expect(stats.repos).toBe(2);
    expect(stats.hits_seen).toBe(1);
    expect(stats.notion_created).toBe(1);
    expect(createPage).toHaveBeenCalledTimes(1);
    db.close();
  });
});
