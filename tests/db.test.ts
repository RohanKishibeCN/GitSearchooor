import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeDedupKey, StateDB } from "../src/db";

describe("db", () => {
  it("dedup and hit_count increments", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gitsearchooor-"));
    const dbPath = path.join(dir, "state.db");

    const db = new StateDB(dbPath);
    db.init();

    const dk = makeDedupKey("a/b", "x.txt", "sha", "term");
    const h = {
      dedup_key: dk,
      repo: "a/b",
      repo_url: "https://github.com/a/b",
      file_path: "x.txt",
      file_url: "https://github.com/a/b/blob/main/x.txt",
      blob_sha: "sha",
      term: "term",
      ecosystem: "unknown",
      snippet_masked: "x",
      scanned_at: 1
    };

    expect(db.insertHitIfNew(h)).toBe(true);
    expect(db.insertHitIfNew(h)).toBe(false);

    const { isNew, row } = db.upsertHitSeen(h);
    expect(isNew).toBe(false);
    expect(Number(row.hit_count)).toBeGreaterThanOrEqual(2);

    db.close();
  });
});
