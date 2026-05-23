const reMnemonic = /\b([a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/gi;
const reHexPriv = /\b0x[a-fA-F0-9]{64}\b/g;
const reAssign =
  /\b(seedphrase|seed\s*phrase|mnemonic|private\s*key|secret\s*key|api[_-]?key|token|password|passwd)\b\s*[:=]\s*([^\s'"`]{16,})/gi;

export type SecretPatternOptions = {
  base58MinLen: number;
  enableMnemonic: boolean;
  enableBase58: boolean;
};

export function containsSecretPattern(text: string, opts: SecretPatternOptions): boolean {
  const s = text || "";
  if (!s) return false;
  if (reHexPriv.test(s)) return true;
  if (reAssign.test(s)) return true;
  if (opts.enableMnemonic && reMnemonic.test(s)) return true;
  if (opts.enableBase58) {
    const minLen = Math.max(1, opts.base58MinLen | 0);
    const reBase58Long = new RegExp(`\\b[1-9A-HJ-NP-Za-km-z]{${minLen},}\\b`, "g");
    if (reBase58Long.test(s)) return true;
  }
  return false;
}
