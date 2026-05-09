from __future__ import annotations

import hashlib
import sqlite3
import time
from dataclasses import dataclass
from typing import Iterable


_SCHEMA = """
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
"""


@dataclass(frozen=True)
class Hit:
    dedup_key: str
    repo: str
    repo_url: str
    file_path: str
    file_url: str
    blob_sha: str
    term: str
    ecosystem: str
    snippet_masked: str
    scanned_at: int


def make_dedup_key(repo: str, path: str, blob_sha: str, term: str) -> str:
    raw = f"{repo}\n{path}\n{blob_sha}\n{term}".encode("utf-8", errors="ignore")
    return hashlib.sha256(raw).hexdigest()


class StateDB:
    def __init__(self, path: str):
        self._conn = sqlite3.connect(path)
        self._conn.row_factory = sqlite3.Row

    def init(self) -> None:
        self._conn.executescript(_SCHEMA)
        self._migrate_hits()
        self._conn.commit()

    def _migrate_hits(self) -> None:
        cols = {r["name"] for r in self._conn.execute("PRAGMA table_info(hits)").fetchall()}
        add = []
        if "notion_page_id" not in cols:
            add.append(("notion_page_id", "TEXT"))
        if "first_seen" not in cols:
            add.append(("first_seen", "INTEGER"))
        if "last_seen" not in cols:
            add.append(("last_seen", "INTEGER"))
        if "hit_count" not in cols:
            add.append(("hit_count", "INTEGER"))
        for name, ty in add:
            self._conn.execute(f"ALTER TABLE hits ADD COLUMN {name} {ty}")
        if add:
            self._conn.execute(
                "UPDATE hits SET first_seen=COALESCE(first_seen, scanned_at), last_seen=COALESCE(last_seen, scanned_at), hit_count=COALESCE(hit_count, 1)"
            )

    def log_event(self, kind: str, detail: str) -> None:
        self._conn.execute(
            "INSERT INTO events(ts, kind, detail) VALUES (?,?,?)",
            (int(time.time()), kind, (detail or "")[:4000]),
        )
        self._conn.commit()

    def insert_hit_if_new(self, h: Hit) -> bool:
        try:
            self._conn.execute(
                """INSERT INTO hits(
                       dedup_key, repo, repo_url, file_path, file_url, blob_sha, term, ecosystem, snippet_masked, scanned_at,
                       first_seen, last_seen, hit_count
                   ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
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
                    1,
                ),
            )
            self._conn.commit()
            return True
        except sqlite3.IntegrityError:
            return False

    def upsert_hit_seen(self, h: Hit) -> tuple[bool, sqlite3.Row]:
        now = int(h.scanned_at)
        is_new = self.insert_hit_if_new(h)
        if not is_new:
            self._conn.execute(
                """UPDATE hits
                   SET last_seen=?,
                       hit_count=COALESCE(hit_count, 1) + 1,
                       snippet_masked=?,
                       ecosystem=?
                   WHERE dedup_key=?""",
                (now, h.snippet_masked, h.ecosystem, h.dedup_key),
            )
            self._conn.commit()
        row = self._conn.execute("SELECT * FROM hits WHERE dedup_key=?", (h.dedup_key,)).fetchone()
        if row is None:
            raise RuntimeError("failed to load hit after upsert")
        return is_new, row

    def set_notion_page_id(self, dedup_key: str, page_id: str) -> None:
        self._conn.execute("UPDATE hits SET notion_page_id=? WHERE dedup_key=?", (page_id, dedup_key))
        self._conn.commit()

    def iter_hits(self, limit: int = 1000) -> Iterable[sqlite3.Row]:
        cur = self._conn.execute("SELECT * FROM hits ORDER BY id DESC LIMIT ?", (int(limit),))
        yield from cur.fetchall()

    def close(self) -> None:
        self._conn.close()
