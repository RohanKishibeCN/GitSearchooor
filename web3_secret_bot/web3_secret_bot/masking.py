from __future__ import annotations

import hashlib
import re


_RE_MNEMONIC = re.compile(r"\b([a-z]{3,8}\s+){11,23}[a-z]{3,8}\b", re.IGNORECASE)
_RE_HEX_PRIV = re.compile(r"\b0x[a-fA-F0-9]{64}\b")
_RE_BASE58_LONG = re.compile(r"\b[1-9A-HJ-NP-Za-km-z]{44,}\b")
_RE_ASSIGN = re.compile(
    r"(?i)\b(seedphrase|seed\s*phrase|mnemonic|private\s*key|secret\s*key|api[_-]?key|token|password|passwd)\b\s*[:=]\s*([^\s'\"`]{8,})"
)


def _sha256_12(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8", errors="ignore")).hexdigest()[:12]


def _mask_keep_edges(s: str, head: int = 4, tail: int = 4) -> str:
    if len(s) <= head + tail + 3:
        return "***"
    return f"{s[:head]}...{s[-tail:]}"


def desensitize(text: str) -> str:
    s = text or ""

    s = _RE_MNEMONIC.sub(lambda m: f"<MNEMONIC_SHA256:{_sha256_12(m.group(0))}>", s)
    s = _RE_HEX_PRIV.sub(lambda m: f"<HEX64:{_mask_keep_edges(m.group(0), 6, 6)}>", s)
    s = _RE_BASE58_LONG.sub(lambda m: f"<B58:{_mask_keep_edges(m.group(0), 6, 6)}>", s)

    def repl_assign(m: re.Match) -> str:
        k = m.group(1)
        v = m.group(2)
        return f"{k}=<MASKED_SHA256:{_sha256_12(v)}>"

    s = _RE_ASSIGN.sub(repl_assign, s)

    if len(s) > 1200:
        s = s[:1200] + "...<TRUNCATED>"
    return s

