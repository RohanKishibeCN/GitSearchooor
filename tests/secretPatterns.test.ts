import { describe, expect, it } from "vitest";
import { containsSecretPattern } from "../src/secretPatterns";

describe("secretPatterns", () => {
  it("detects hex private key", () => {
    expect(
      containsSecretPattern(`PRIVATE_KEY=0x${"a".repeat(64)}`, { base58MinLen: 80, enableMnemonic: true, enableBase58: true })
    ).toBe(true);
  });

  it("detects mnemonic", () => {
    expect(
      containsSecretPattern(
        "abandon ability able about above absent absorb abstract absurd abuse access about",
        { base58MinLen: 80, enableMnemonic: true, enableBase58: true }
      )
    ).toBe(true);
  });

  it("rejects normal code", () => {
    expect(
      containsSecretPattern("function mnemonicToEntropy(mnemonic: string) { return 1 }", {
        base58MinLen: 80,
        enableMnemonic: true,
        enableBase58: true
      })
    ).toBe(false);
  });

  it("rejects 44-char base58 when minLen is 80", () => {
    const pubkey = "GLXybrLSCDc21SAjhjRSPW9XTBj4tH8gtnmjqwx".padEnd(44, "1");
    expect(containsSecretPattern(pubkey, { base58MinLen: 80, enableMnemonic: true, enableBase58: true })).toBe(false);
  });

  it("rejects mnemonic with too few unique words (test fixture)", () => {
    expect(
      containsSecretPattern("test test test test test test test test test test test junk", {
        base58MinLen: 80,
        enableMnemonic: true,
        enableBase58: true
      })
    ).toBe(false);
  });

  it("is deterministic across repeated calls (regression: /g lastIndex bug)", () => {
    const opts = { base58MinLen: 80, enableMnemonic: true, enableBase58: true };
    const hex = `PRIVATE_KEY=0x${"a".repeat(64)}`;
    const mn = "abandon ability able about above absent absorb abstract absurd abuse access about";

    // 同一输入重复调用必须返回相同结果（此前 /g 正则的 lastIndex 残留导致 true/false 交替）
    expect(containsSecretPattern(hex, opts)).toBe(true);
    expect(containsSecretPattern(hex, opts)).toBe(true);
    expect(containsSecretPattern(hex, opts)).toBe(true);

    expect(containsSecretPattern(mn, opts)).toBe(true);
    expect(containsSecretPattern(mn, opts)).toBe(true);

    const clean = "function mnemonicToEntropy(mnemonic: string) { return 1 }";
    expect(containsSecretPattern(clean, opts)).toBe(false);
    expect(containsSecretPattern(clean, opts)).toBe(false);
  });
});
