import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type Hit = {
  dedup_key: string;
  repo: string;
  repo_url: string;
  file_path: string;
  file_url: string;
  blob_sha: string;
  term: string;
  ecosystem: string;
  snippet_masked: string;
  scanned_at: number;
};

export function makeDedupKey(repo: string, filePath: string, blobSha: string, term: string): string {
  const raw = `${repo}\n${filePath}\n${blobSha}\n${term}`;
  return crypto.createHash("sha256").update(Buffer.from(raw, "utf8")).digest("hex");
}

const schemaSql = `
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;

CREATE TABLE IF NOT EXISTS hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedup_key TEXT NOT NULL UNIQUE,
  repo TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_url TEXT NOT NULL,
  blob_sha TEXT NOT NULL,
  term TEXT NOT NULL,
  ecosystem TEXT NOT NULL,
  snippet_masked TEXT NOT NULL,
  scanned_at INTEGER NOT NULL,
  notion_page_id TEXT,
  first_seen INTEGER,
  last_seen INTEGER,
  hit_count INTEGER
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL
);
`;

export class StateDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    const p = path.resolve(dbPath);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    this.db = new Database(p);
  }

  init(): void {
    this.db.exec(schemaSql);
    this.migrateHits();
  }

  private migrateHits(): void {
    const rows = this.db.prepare("PRAGMA table_info(hits)").all() as Array<{ name: string }>;
    const cols = new Set(rows.map((r) => r.name));
    const add: Array<[string, string]> = [];
    if (!cols.has("notion_page_id")) add.push(["notion_page_id", "TEXT"]);
    if (!cols.has("first_seen")) add.push(["first_seen", "INTEGER"]);
    if (!cols.has("last_seen")) add.push(["last_seen", "INTEGER"]);
    if (!cols.has("hit_count")) add.push(["hit_count", "INTEGER"]);

    for (const [name, ty] of add) {
      this.db.prepare(`ALTER TABLE hits ADD COLUMN ${name} ${ty}`).run();
    }

    if (add.length > 0) {
      this.db
        .prepare(
          "UPDATE hits SET first_seen=COALESCE(first_seen, scanned_at), last_seen=COALESCE(last_seen, scanned_at), hit_count=COALESCE(hit_count, 1)"
        )
        .run();
    }
  }

  logEvent(kind: string, detail: string): void {
    const d = (detail || "").slice(0, 4000);
    this.db.prepare("INSERT INTO events(ts, kind, detail) VALUES (?,?,?)").run(Date.now() / 1000 | 0, kind, d);
  }

  insertHitIfNew(h: Hit): boolean {
    try {
      this.db
        .prepare(
          `INSERT INTO hits(
             dedup_key, repo, repo_url, file_path, file_url, blob_sha, term, ecosystem, snippet_masked, scanned_at,
             first_seen, last_seen, hit_count
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          h.dedup_key,
          h.repo,
          h.repo_url,
          h.file_path,
          h.file_url,
          h.blob_sha,
          h.term,
          h.ecosystem,
          h.snippet_masked,
          h.scanned_at,
          h.scanned_at,
          h.scanned_at,
          1
        );
      return true;
    } catch (e: any) {
      if (typeof e?.code === "string" && e.code === "SQLITE_CONSTRAINT_UNIQUE") return false;
      throw e;
    }
  }

  upsertHitSeen(h: Hit): { isNew: boolean; row: any } {
    const isNew = this.insertHitIfNew(h);
    if (!isNew) {
      this.db
        .prepare(
          `UPDATE hits
           SET last_seen=?,
               hit_count=COALESCE(hit_count, 1) + 1,
               snippet_masked=?,
               ecosystem=?
           WHERE dedup_key=?`
        )
        .run(h.scanned_at, h.snippet_masked, h.ecosystem, h.dedup_key);
    }

    const row = this.db.prepare("SELECT * FROM hits WHERE dedup_key=?").get(h.dedup_key);
    if (!row) throw new Error("failed to load hit after upsert");
    return { isNew, row };
  }

  setNotionPageId(dedupKey: string, pageId: string): void {
    this.db.prepare("UPDATE hits SET notion_page_id=? WHERE dedup_key=?").run(pageId, dedupKey);
  }

  close(): void {
    this.db.close();
  }
}

