import { describe, expect, it } from "vitest";
import { containsSecretPattern } from "../src/secretPatterns";

describe("secretPatterns", () => {
  it("detects hex private key", () => {
    expect(containsSecretPattern(`PRIVATE_KEY=0x${"a".repeat(64)}`)).toBe(true);
  });

  it("detects mnemonic", () => {
    expect(containsSecretPattern(`${"abandon ".repeat(11)}about`)).toBe(true);
  });

  it("rejects normal code", () => {
    expect(containsSecretPattern("function mnemonicToEntropy(mnemonic: string) { return 1 }")).toBe(false);
  });
});

