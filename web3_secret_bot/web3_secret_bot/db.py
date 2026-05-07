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
  scanned_at INTEGER NOT NULL
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
        self._conn.commit()

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
                       dedup_key, repo, repo_url, file_path, file_url, blob_sha, term, ecosystem, snippet_masked, scanned_at
                   ) VALUES (?,?,?,?,?,?,?,?,?,?)""",
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
                ),
            )
            self._conn.commit()
            return True
        except sqlite3.IntegrityError:
            return False

    def iter_hits(self, limit: int = 1000) -> Iterable[sqlite3.Row]:
        cur = self._conn.execute("SELECT * FROM hits ORDER BY id DESC LIMIT ?", (int(limit),))
        yield from cur.fetchall()

    def close(self) -> None:
        self._conn.close()

