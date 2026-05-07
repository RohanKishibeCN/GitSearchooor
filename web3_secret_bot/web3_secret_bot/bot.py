from __future__ import annotations

import json
import time
from datetime import datetime, timezone

from .config import Config
from .db import Hit, StateDB, make_dedup_key
from .github import GitHubClient
from .masking import desensitize
from .notion import NotionWriter
from .rate import RateLimiter


def _append_deadletter(path: str, payload: dict) -> None:
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False) + "\n")


def _detect_ecosystem(cfg: Config, gh: GitHubClient, repo: str) -> str:
    blob = ""
    for fn in cfg.dependency_files:
        try:
            blob += "\n" + (gh.get_file_text(repo=repo, path=fn) or "")
        except Exception:
            continue
        if len(blob) > 300_000:
            break
    low = blob.lower()
    has_eth = any(m.lower() in low for m in cfg.ethereum_markers)
    has_sol = any(m.lower() in low for m in cfg.solana_markers)
    if has_eth and has_sol:
        return "both"
    if has_eth:
        return "ethereum"
    if has_sol:
        return "solana"
    return "unknown"


def run_once(cfg: Config, *, dry_run: bool) -> dict:
    db = StateDB(cfg.state_db_path)
    db.init()

    limiter = RateLimiter(
        min_interval_sec=cfg.min_interval_sec,
        jitter_sec=cfg.jitter_sec,
        max_calls_per_minute=cfg.max_calls_per_minute,
    )
    gh = GitHubClient(
        gh_bin=cfg.gh_bin,
        limiter=limiter,
        backoff_base_sec=cfg.backoff_base_sec,
        backoff_max_sec=cfg.backoff_max_sec,
        backoff_max_retries=cfg.backoff_max_retries,
        on_event=db.log_event,
    )
    notion = NotionWriter(ntn_bin=cfg.ntn_bin, database_id=cfg.notion_database_id, props=cfg.notion_props)

    stats = {
        "repos": 0,
        "hits_seen": 0,
        "hits_new": 0,
        "notion_written": 0,
        "dedup_skipped": 0,
        "deadletter": 0,
    }

    repos = gh.search_repos(query=cfg.repo_query, limit=cfg.repos_per_run)
    for repo in repos:
        stats["repos"] += 1
        eco = _detect_ecosystem(cfg, gh, repo.full_name)

        for term in cfg.leak_terms:
            hits = gh.search_code(repo=repo.full_name, term=term, per_page=cfg.per_repo_code_hits)
            for h in hits:
                stats["hits_seen"] += 1
                snippet = h.fragment or ""
                if not snippet and h.file_path:
                    try:
                        snippet = (gh.get_file_text(repo=h.repo_full_name, path=h.file_path) or "")[:900]
                    except Exception:
                        snippet = ""
                snippet_masked = desensitize(snippet)

                dk = make_dedup_key(h.repo_full_name, h.file_path, h.blob_sha, term)
                rec = Hit(
                    dedup_key=dk,
                    repo=h.repo_full_name,
                    repo_url=h.repo_html_url,
                    file_path=h.file_path,
                    file_url=h.file_html_url,
                    blob_sha=h.blob_sha,
                    term=term,
                    ecosystem=eco,
                    snippet_masked=snippet_masked,
                    scanned_at=int(time.time()),
                )

                if not db.insert_hit_if_new(rec):
                    stats["dedup_skipped"] += 1
                    continue
                stats["hits_new"] += 1

                scanned_at_iso = datetime.now(timezone.utc).isoformat()
                title = f"{rec.repo} {rec.file_path}"
                fields = {
                    "title": title,
                    "repo_url": rec.repo_url,
                    "file_url": rec.file_url,
                    "term": rec.term,
                    "snippet": rec.snippet_masked,
                    "ecosystem": rec.ecosystem,
                    "status": cfg.notion_default_status,
                    "scanned_at": scanned_at_iso,
                    "dedup_key": rec.dedup_key,
                }

                if dry_run:
                    db.log_event("dry_run_notion_payload", json.dumps(fields, ensure_ascii=False))
                    continue

                try:
                    notion.create_page(fields=fields)
                    stats["notion_written"] += 1
                except Exception as e:
                    stats["deadletter"] += 1
                    db.log_event("notion_write_failed", str(e))
                    _append_deadletter(
                        cfg.deadletter_path,
                        {"ts": int(time.time()), "error": str(e), "fields": fields},
                    )

    db.close()
    return stats

