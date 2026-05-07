from __future__ import annotations

import subprocess
from dataclasses import dataclass


@dataclass(frozen=True)
class CmdResult:
    stdout: str
    stderr: str
    rc: int


class CmdError(RuntimeError):
    def __init__(self, argv: list[str], res: CmdResult):
        super().__init__(f"command failed rc={res.rc}: {' '.join(argv)}\nstderr:\n{res.stderr}")
        self.argv = argv
        self.res = res


def run(argv: list[str], *, timeout_sec: int = 60, env: dict | None = None) -> CmdResult:
    p = subprocess.run(
        argv,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
        timeout=timeout_sec,
    )
    res = CmdResult(stdout=p.stdout or "", stderr=p.stderr or "", rc=p.returncode)
    if p.returncode != 0:
        raise CmdError(argv, res)
    return res

