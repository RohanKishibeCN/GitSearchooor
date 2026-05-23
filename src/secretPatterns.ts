const reMnemonic = /\b([a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/gi;
const reHexPriv = /\b0x[a-fA-F0-9]{64}\b/g;
const reBase58Long = /\b[1-9A-HJ-NP-Za-km-z]{44,}\b/g;
const reAssign =
  /\b(seedphrase|seed\s*phrase|mnemonic|private\s*key|secret\s*key|api[_-]?key|token|password|passwd)\b\s*[:=]\s*([^\s'"`]{16,})/gi;

export function containsSecretPattern(text: string): boolean {
  const s = text || "";
  if (!s) return false;
  if (reHexPriv.test(s)) return true;
  if (reBase58Long.test(s)) return true;
  if (reAssign.test(s)) return true;
  if (reMnemonic.test(s)) return true;
  return false;
}

