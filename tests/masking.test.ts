import { describe, expect, it } from "vitest";
import { desensitize } from "../src/masking";

describe("masking", () => {
  it("masks hex private key", () => {
    const s = `PRIVATE_KEY=0x${"a".repeat(64)}`;
    const out = desensitize(s);
    expect(out.includes(`0x${"a".repeat(64)}`)).toBe(false);
  });

  it("masks mnemonic", () => {
    const s = `${"abandon ".repeat(11)}about`;
    const out = desensitize(s);
    expect(out.includes(s)).toBe(false);
    expect(out.includes("MNEMONIC_SHA256")).toBe(true);
  });
});

