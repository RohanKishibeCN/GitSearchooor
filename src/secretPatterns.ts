// 注意：这些正则用于 .test()/.exec()，绝不能带 /g 标志。
// /g 会让 lastIndex 在不同调用间残留，导致同一个输入重复调用返回不同结果。
const reHexPriv = /\b0x[a-fA-F0-9]{64}\b/;
const reAssign =
  /\b(seedphrase|seed\s*phrase|mnemonic|private\s*key|secret\s*key|api[_-]?key|token|password|passwd)\b\s*[:=]\s*([^\s'"`]{16,})/i;

export type SecretPatternOptions = {
  base58MinLen: number;
  enableMnemonic: boolean;
  enableBase58: boolean;
};

function hasValidMnemonic(s: string): boolean {
  const reMnemonic = /\b([a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/i;
  const match = reMnemonic.exec(s);
  if (!match) return false;
  const words = match[0].toLowerCase().trim().split(/\s+/);
  const unique = new Set(words).size;
  return unique >= 5;
}

export function containsSecretPattern(text: string, opts: SecretPatternOptions): boolean {
  const s = text || "";
  if (!s) return false;
  if (reHexPriv.test(s)) return true;
  if (reAssign.test(s)) return true;
  if (opts.enableMnemonic && hasValidMnemonic(s)) return true;
  if (opts.enableBase58) {
    const minLen = Math.max(1, opts.base58MinLen | 0);
    const reBase58Long = new RegExp(`\\b[1-9A-HJ-NP-Za-km-z]{${minLen},}\\b`, "g");
    if (reBase58Long.test(s)) return true;
  }
  return false;
}
