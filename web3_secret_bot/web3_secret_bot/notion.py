from __future__ import annotations

import json

from .subproc import run


class NotionWriter:
    def __init__(self, *, ntn_bin: str, database_id: str, props: dict[str, str]):
        self._ntn = ntn_bin
        self._db = database_id
        self._props = props

    def create_page(self, *, fields: dict[str, object]) -> dict:
        if not self._db:
            raise RuntimeError("NOTION_DATABASE_ID is empty")
        body = {
            "parent": {"database_id": self._db},
            "properties": self._to_properties(fields),
        }
        res = run([self._ntn, "api", "v1/pages", "-d", json.dumps(body, ensure_ascii=False)], timeout_sec=60)
        try:
            return json.loads(res.stdout or "{}")
        except Exception:
            return {"raw": (res.stdout or "").strip()}

    def update_page(self, *, page_id: str, fields: dict[str, object]) -> dict:
        body = {"properties": self._to_properties(fields)}
        res = run(
            [self._ntn, "api", f"v1/pages/{page_id}", "-X", "PATCH", "-d", json.dumps(body, ensure_ascii=False)],
            timeout_sec=60,
        )
        try:
            return json.loads(res.stdout or "{}")
        except Exception:
            return {"raw": (res.stdout or "").strip()}

    def _to_properties(self, fields: dict[str, object]) -> dict:
        props: dict[str, object] = {}

        def rt(s: str) -> dict:
            return {"rich_text": [{"type": "text", "text": {"content": s}}]}

        def title(s: str) -> dict:
            return {"title": [{"type": "text", "text": {"content": s}}]}

        def ms(names: list[str]) -> dict:
            return {"multi_select": [{"name": n} for n in names if n]}

        for k, v in fields.items():
            name = self._props.get(k, k)
            if k in ("repo_url", "file_url") and isinstance(v, str):
                props[name] = {"url": v}
            elif k == "title" and isinstance(v, str):
                props[name] = title(v)
            elif k in ("first_seen", "last_seen") and isinstance(v, str):
                props[name] = {"date": {"start": v}}
            elif k == "hit_count" and isinstance(v, int):
                props[name] = {"number": v}
            elif k in ("term", "tags"):
                if isinstance(v, str):
                    props[name] = ms([v])
                elif isinstance(v, list):
                    props[name] = ms([str(x) for x in v])
            elif k in ("ecosystem", "status") and isinstance(v, str):
                props[name] = {"select": {"name": v}}
            else:
                props[name] = rt(str(v))

        return props
