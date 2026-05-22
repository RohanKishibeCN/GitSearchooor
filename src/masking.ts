import crypto from "node:crypto";

const reMnemonic = /\b([a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/gi;
const reHexPriv = /\b0x[a-fA-F0-9]{64}\b/g;
const reBase58Long = /\b[1-9A-HJ-NP-Za-km-z]{44,}\b/g;
const reAssign =
  /\b(seedphrase|seed\s*phrase|mnemonic|private\s*key|secret\s*key|api[_-]?key|token|password|passwd)\b\s*[:=]\s*([^\s'"`]{8,})/gi;

function sha256_12(s: string): string {
  return crypto.createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex").slice(0, 12);
}

function maskKeepEdges(s: string, head = 4, tail = 4): string {
  if (s.length <= head + tail + 3) return "***";
  return `${s.slice(0, head)}...${s.slice(-tail)}`;
}

export function desensitize(text: string): string {
  let s = text || "";

  s = s.replace(reMnemonic, (m) => `<MNEMONIC_SHA256:${sha256_12(m)}>` );
  s = s.replace(reHexPriv, (m) => `<HEX64:${maskKeepEdges(m, 6, 6)}>` );
  s = s.replace(reBase58Long, (m) => `<B58:${maskKeepEdges(m, 6, 6)}>` );

  s = s.replace(reAssign, (_m, k: string, v: string) => `${k}=<MASKED_SHA256:${sha256_12(v)}>` );

  if (s.length > 1200) s = `${s.slice(0, 1200)}...<TRUNCATED>`;
  return s;
}

