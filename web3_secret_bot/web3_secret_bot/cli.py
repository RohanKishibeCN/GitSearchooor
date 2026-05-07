from __future__ import annotations

import argparse
import json

from .bot import run_once
from .config import Config
from .db import StateDB


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="web3-secret-bot")
    p.add_argument("--config", default="", help="ini config path")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("print-config")

    p_init = sub.add_parser("init-db")
    p_init.add_argument("--db", default="")

    p_run = sub.add_parser("run")
    p_run.add_argument("--dry-run", action="store_true")

    ns = p.parse_args(argv)
    cfg = Config.load(ns.config or None)

    if ns.cmd == "print-config":
        print(json.dumps(cfg.__dict__, ensure_ascii=False, indent=2))
        return 0

    if ns.cmd == "init-db":
        db_path = ns.db or cfg.state_db_path
        db = StateDB(db_path)
        db.init()
        db.close()
        print(f"ok: {db_path}")
        return 0

    if ns.cmd == "run":
        stats = run_once(cfg, dry_run=bool(ns.dry_run))
        print(json.dumps(stats, ensure_ascii=False))
        return 0

    return 2


if __name__ == "__main__":
    raise SystemExit(main())

