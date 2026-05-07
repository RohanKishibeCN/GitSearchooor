from __future__ import annotations

import base64
import json
import time
from dataclasses import dataclass

from .rate import RateLimiter
from .subproc import CmdError, run


@dataclass(frozen=True)
class Repo:
    full_name: str
    html_url: str
    updated_at: str | None
    stars: int | None


@dataclass(frozen=True)
class CodeHit:
    repo_full_name: str
    repo_html_url: str
    file_path: str
    file_html_url: str
    blob_sha: str
    fragment: str | None


class GitHubClient:
    def __init__(
        self,
        *,
        gh_bin: str,
        limiter: RateLimiter,
        backoff_base_sec: float,
        backoff_max_sec: float,
        backoff_max_retries: int,
        on_event=None,
    ):
        self._gh = gh_bin
        self._limiter = limiter
        self._backoff_base = float(backoff_base_sec)
        self._backoff_max = float(backoff_max_sec)
        self._backoff_retries = int(backoff_max_retries)
        self._on_event = on_event

    def _call_json(self, argv: list[str], *, timeout_sec: int = 60) -> object:
        attempt = 0
        while True:
            self._limiter.wait()
            try:
                out = run(argv, timeout_sec=timeout_sec).stdout
                return json.loads(out or "null")
            except CmdError as e:
                msg = (e.res.stderr or "") + (e.res.stdout or "")
                is_rate = ("rate limit" in msg.lower()) or ("HTTP 403" in msg) or ("HTTP 429" in msg)
                if not is_rate or attempt >= self._backoff_retries:
                    raise
                sleep_for = min(self._backoff_max, self._backoff_base * (2**attempt))
                if self._on_event:
                    self._on_event("github_backoff", f"attempt={attempt} sleep={sleep_for} err={msg[:500]}")
                time.sleep(sleep_for)
                attempt += 1

    def search_repos(self, *, query: str, limit: int) -> list[Repo]:
        data = self._call_json(
            [
                self._gh,
                "api",
                "search/repositories",
                "-f",
                f"q={query}",
                "-f",
                f"per_page={int(limit)}",
            ]
        )
        items = []
        if isinstance(data, dict):
            items = data.get("items") or []
        repos: list[Repo] = []
        for i in items:
            if not isinstance(i, dict):
                continue
            full_name = i.get("full_name")
            html_url = i.get("html_url")
            if not full_name or not html_url:
                continue
            repos.append(
                Repo(
                    full_name=full_name,
                    html_url=html_url,
                    updated_at=i.get("updated_at"),
                    stars=i.get("stargazers_count"),
                )
            )
        return repos

    def search_code(self, *, repo: str, term: str, per_page: int) -> list[CodeHit]:
        q = f"{term} repo:{repo}"
        data = self._call_json(
            [
                self._gh,
                "api",
                "search/code",
                "-f",
                f"q={q}",
                "-f",
                f"per_page={int(per_page)}",
            ]
        )
        items = []
        if isinstance(data, dict):
            items = data.get("items") or []
        hits: list[CodeHit] = []
        for i in items:
            if not isinstance(i, dict):
                continue
            repo_obj = i.get("repository") or {}
            repo_full = repo_obj.get("full_name") or repo
            repo_url = repo_obj.get("html_url") or f"https://github.com/{repo_full}"
            file_path = i.get("path") or ""
            file_html_url = i.get("html_url") or ""
            blob_sha = i.get("sha") or ""
            fragment = None
            cms = i.get("text_matches") or []
            if cms and isinstance(cms, list):
                x = cms[0]
                if isinstance(x, dict):
                    fragment = x.get("fragment")
            hits.append(
                CodeHit(
                    repo_full_name=repo_full,
                    repo_html_url=repo_url,
                    file_path=file_path,
                    file_html_url=file_html_url,
                    blob_sha=blob_sha,
                    fragment=fragment,
                )
            )
        return hits

    def get_file_text(self, *, repo: str, path: str) -> str:
        data = self._call_json([self._gh, "api", f"repos/{repo}/contents/{path}"], timeout_sec=60)
        if not isinstance(data, dict):
            return ""
        if data.get("encoding") != "base64":
            return ""
        try:
            b = base64.b64decode((data.get("content") or "").encode("utf-8"))
            return b.decode("utf-8", errors="replace")
        except Exception:
            return ""

