from __future__ import annotations

import configparser
import os
from dataclasses import dataclass
from pathlib import Path


def _env(name: str, default: str) -> str:
    v = os.environ.get(name)
    if v is None or v == "":
        return default
    return v


def _split_csv(s: str) -> list[str]:
    return [x.strip() for x in (s or "").split(",") if x.strip()]


@dataclass(frozen=True)
class Config:
    state_db_path: str
    deadletter_path: str

    gh_bin: str
    repo_query: str
    repo_pushed_days: int
    repos_per_run: int
    per_repo_code_hits: int

    dependency_files: list[str]
    ethereum_markers: list[str]
    solana_markers: list[str]

    leak_terms: list[str]

    min_interval_sec: float
    jitter_sec: float
    max_calls_per_minute: int
    backoff_base_sec: float
    backoff_max_sec: float
    backoff_max_retries: int

    ntn_bin: str
    notion_database_id: str
    notion_default_status: str
    notion_props: dict[str, str]

    @staticmethod
    def load(config_path: str | None) -> "Config":
        p = configparser.ConfigParser()
        if config_path:
            p.read(config_path, encoding="utf-8")

        state_db_path = p.get("paths", "state_db_path", fallback=_env("STATE_DB_PATH", ".data/state.db"))
        deadletter_path = p.get("paths", "deadletter_path", fallback=_env("DEADLETTER_PATH", ".data/deadletter.jsonl"))

        gh_bin = p.get("github", "gh_bin", fallback=_env("GH_BIN", "gh"))
        repo_query = p.get(
            "github",
            "repo_query",
            fallback=_env(
                "GH_REPO_QUERY",
                'web3 OR crypto OR x402 OR stablecoin OR coin archived:false fork:false is:public',
            ),
        )
        repo_pushed_days = p.getint("github", "repo_pushed_days", fallback=int(_env("REPO_PUSHED_DAYS", "7")))
        repos_per_run = p.getint("github", "repos_per_run", fallback=int(_env("REPOS_PER_RUN", "30")))
        per_repo_code_hits = p.getint("github", "per_repo_code_hits", fallback=int(_env("PER_REPO_CODE_HITS", "10")))

        dependency_files = _split_csv(
            p.get(
                "ecosystem",
                "dependency_files",
                fallback=_env("DEPENDENCY_FILES", "package.json,requirements.txt,pyproject.toml,Cargo.toml,go.mod"),
            )
        )
        ethereum_markers = _split_csv(
            p.get(
                "ecosystem",
                "ethereum_markers",
                fallback=_env("ETHEREUM_MARKERS", "ethers,viem,web3,web3.py,go-ethereum,ethers::,alloy"),
            )
        )
        solana_markers = _split_csv(
            p.get(
                "ecosystem",
                "solana_markers",
                fallback=_env("SOLANA_MARKERS", "@solana/web3.js,solana-sdk,solana_sdk::,anchor-lang,anchor_lang::,anchorpy,solders"),
            )
        )

        leak_terms = _split_csv(
            p.get(
                "scan",
                "leak_terms",
                fallback=_env(
                    "LEAK_TERMS",
                    "seed phrase,seedphrase,mnemonic,private key,secret key,xprv,solana secret key",
                ),
            )
        )

        min_interval_sec = float(p.get("rate", "min_interval_sec", fallback=_env("MIN_INTERVAL_SEC", "1.2")))
        jitter_sec = float(p.get("rate", "jitter_sec", fallback=_env("JITTER_SEC", "0.8")))
        max_calls_per_minute = int(p.get("rate", "max_calls_per_minute", fallback=_env("MAX_CALLS_PER_MINUTE", "40")))
        backoff_base_sec = float(p.get("rate", "backoff_base_sec", fallback=_env("BACKOFF_BASE_SEC", "2")))
        backoff_max_sec = float(p.get("rate", "backoff_max_sec", fallback=_env("BACKOFF_MAX_SEC", "120")))
        backoff_max_retries = int(p.get("rate", "backoff_max_retries", fallback=_env("BACKOFF_MAX_RETRIES", "5")))

        ntn_bin = p.get("notion", "ntn_bin", fallback=_env("NTN_BIN", "ntn"))
        notion_database_id = p.get("notion", "database_id", fallback=_env("NOTION_DATABASE_ID", ""))
        notion_default_status = p.get("notion", "default_status", fallback=_env("NOTION_DEFAULT_STATUS", "待复核"))

        notion_props = {
            "title": p.get("notion", "prop_title", fallback=_env("NOTION_PROP_TITLE", "Title")),
            "repo_url": p.get("notion", "prop_repo_url", fallback=_env("NOTION_PROP_REPO_URL", "Repo URL")),
            "file_url": p.get("notion", "prop_file_url", fallback=_env("NOTION_PROP_FILE_URL", "File URL")),
            "file_path": p.get("notion", "prop_file_path", fallback=_env("NOTION_PROP_FILE_PATH", "File Path")),
            "term": p.get("notion", "prop_term", fallback=_env("NOTION_PROP_TERM", "Term")),
            "snippet": p.get("notion", "prop_snippet", fallback=_env("NOTION_PROP_SNIPPET", "Snippet (Masked)")),
            "ecosystem": p.get("notion", "prop_ecosystem", fallback=_env("NOTION_PROP_ECOSYSTEM", "Ecosystem")),
            "blob_sha": p.get("notion", "prop_blob_sha", fallback=_env("NOTION_PROP_BLOB_SHA", "Blob SHA")),
            "status": p.get("notion", "prop_status", fallback=_env("NOTION_PROP_STATUS", "Status")),
            "first_seen": p.get("notion", "prop_first_seen", fallback=_env("NOTION_PROP_FIRST_SEEN", "First Seen")),
            "last_seen": p.get("notion", "prop_last_seen", fallback=_env("NOTION_PROP_LAST_SEEN", "Last Seen")),
            "hit_count": p.get("notion", "prop_hit_count", fallback=_env("NOTION_PROP_HIT_COUNT", "Hit Count")),
            "dedup_key": p.get("notion", "prop_dedup_key", fallback=_env("NOTION_PROP_DEDUP_KEY", "Dedup Key")),
            "notes": p.get("notion", "prop_notes", fallback=_env("NOTION_PROP_NOTES", "Notes")),
            "tags": p.get("notion", "prop_tags", fallback=_env("NOTION_PROP_TAGS", "Tags")),
        }

        Path(state_db_path).parent.mkdir(parents=True, exist_ok=True)
        Path(deadletter_path).parent.mkdir(parents=True, exist_ok=True)

        return Config(
            state_db_path=state_db_path,
            deadletter_path=deadletter_path,
            gh_bin=gh_bin,
            repo_query=repo_query,
            repo_pushed_days=repo_pushed_days,
            repos_per_run=repos_per_run,
            per_repo_code_hits=per_repo_code_hits,
            dependency_files=dependency_files,
            ethereum_markers=ethereum_markers,
            solana_markers=solana_markers,
            leak_terms=leak_terms,
            min_interval_sec=min_interval_sec,
            jitter_sec=jitter_sec,
            max_calls_per_minute=max_calls_per_minute,
            backoff_base_sec=backoff_base_sec,
            backoff_max_sec=backoff_max_sec,
            backoff_max_retries=backoff_max_retries,
            ntn_bin=ntn_bin,
            notion_database_id=notion_database_id,
            notion_default_status=notion_default_status,
            notion_props=notion_props,
        )
