import { describe, expect, it } from "vitest";
import { containsSecretPattern } from "../src/secretPatterns";

describe("secretPatterns", () => {
  it("detects hex private key", () => {
    expect(
      containsSecretPattern(`PRIVATE_KEY=0x${"a".repeat(64)}`, { base58MinLen: 80, enableMnemonic: true, enableBase58: true })
    ).toBe(true);
  });

  it("detects mnemonic", () => {
    expect(containsSecretPattern(`${"abandon ".repeat(11)}about`, { base58MinLen: 80, enableMnemonic: true, enableBase58: true })).toBe(
      true
    );
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
});
