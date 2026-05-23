export type PathFilterConfig = {
  enabled: boolean;
  excludeExtensions: string[];
  excludeContains: string[];
  excludeBasenames: string[];
};

export type ContentFilterConfig = {
  enabled: boolean;
  excludeKeywords: string[];
};

export function shouldSkipPath(filePath: string, cfg: PathFilterConfig): boolean {
  if (!cfg.enabled) return false;
  const p = (filePath || "").toLowerCase();
  if (!p) return false;

  const base = p.split("/").pop() || p;
  if (cfg.excludeBasenames.some((x) => x && x === base)) return true;

  const dot = base.lastIndexOf(".");
  if (dot >= 0) {
    const ext = base.slice(dot);
    if (cfg.excludeExtensions.some((x) => x && x.toLowerCase() === ext)) return true;
  }

  for (const s of cfg.excludeContains) {
    if (!s) continue;
    if (p.includes(s.toLowerCase())) return true;
  }

  return false;
}

export function shouldSkipContent(snippet: string, cfg: ContentFilterConfig): boolean {
  if (!cfg.enabled) return false;
  const s = (snippet || "").toLowerCase();
  if (!s) return false;
  for (const k of cfg.excludeKeywords) {
    if (!k) continue;
    if (s.includes(k.toLowerCase())) return true;
  }
  return false;
}

