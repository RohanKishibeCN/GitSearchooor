import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyRateLimitState,
  shouldPauseBucket,
  updateRateLimitFromHeaders,
  type RateLimitState
} from "../src/github/rateLimit";

function fakeHeaders(values: Record<string, string>): Headers {
  return { get: (n: string) => values[n] ?? null } as unknown as Headers;
}

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses headers into state", () => {
    const state: RateLimitState = emptyRateLimitState();
    updateRateLimitFromHeaders(
      state,
      "search",
      fakeHeaders({ "x-ratelimit-remaining": "12", "x-ratelimit-reset": "9999999999" })
    );
    expect(state.search.remaining).toBe(12);
    expect(state.search.resetAtSec).toBe(9999999999);
    expect(shouldPauseBucket(state.search, 50).should).toBe(true);
    expect(shouldPauseBucket(state.search, 10).should).toBe(false);
  });

  it("retry-after expires and does not pause forever (regression)", () => {
    const state: RateLimitState = emptyRateLimitState();
    updateRateLimitFromHeaders(state, "core", fakeHeaders({ "retry-after": "60" }));
    expect(state.core.retryAfterSec).toBe(60);

    // 窗口内：应该暂停
    expect(shouldPauseBucket(state.core, 0).should).toBe(true);

    // 61 秒后：retry-after 过期，不应再暂停
    vi.setSystemTime(new Date("2026-01-01T00:01:01Z"));
    expect(shouldPauseBucket(state.core, 0).should).toBe(false);

    // 过期后的成功响应（无 retry-after 头）应清掉残留值
    updateRateLimitFromHeaders(state, "core", fakeHeaders({ "x-ratelimit-remaining": "100" }));
    expect(state.core.retryAfterSec).toBeUndefined();
  });

  it("keeps retry-after when a subsequent headerless response arrives inside the window", () => {
    const state: RateLimitState = emptyRateLimitState();
    updateRateLimitFromHeaders(state, "search", fakeHeaders({ "retry-after": "30" }));
    vi.setSystemTime(new Date("2026-01-01T00:00:10Z"));
    updateRateLimitFromHeaders(state, "search", fakeHeaders({ "x-ratelimit-remaining": "5" }));
    expect(state.search.retryAfterSec).toBe(30);
    expect(shouldPauseBucket(state.search, 0).should).toBe(true);
  });
});
