import { describe, expect, it } from "vitest";
import { shouldSkipContent, shouldSkipPath } from "../src/filters";

describe("filters", () => {
  it("skips markdown paths", () => {
    const cfg = {
      enabled: true,
      excludeExtensions: [".md", ".mdx"],
      excludeContains: ["docs/"],
      excludeBasenames: ["readme.md"]
    };
    expect(shouldSkipPath("README.md", cfg)).toBe(true);
    expect(shouldSkipPath("docs/intro.mdx", cfg)).toBe(true);
    expect(shouldSkipPath("src/index.ts", cfg)).toBe(false);
  });

  it("skips example keywords in content", () => {
    const cfg = { enabled: true, excludeKeywords: ["your_private_key", "example"] };
    expect(shouldSkipContent("const x = 'YOUR_PRIVATE_KEY'", cfg)).toBe(true);
    expect(shouldSkipContent("This is an example", cfg)).toBe(true);
    expect(shouldSkipContent("PRIVATE_KEY=0xabc", cfg)).toBe(false);
  });
});

