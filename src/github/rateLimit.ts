export type RateBucketName = "search" | "core";

export type RateBucket = {
  remaining?: number;
  resetAtSec?: number;
  retryAfterSec?: number;
  updatedAtSec?: number;
};

export type RateLimitState = {
  search: RateBucket;
  core: RateBucket;
};

export function emptyRateLimitState(): RateLimitState {
  return { search: {}, core: {} };
}

function toInt(x: string | null): number | undefined {
  if (!x) return undefined;
  const v = Number.parseInt(x, 10);
  return Number.isFinite(v) ? v : undefined;
}

export function updateRateLimitFromHeaders(
  state: RateLimitState,
  bucket: RateBucketName,
  headers: Headers
): void {
  const remaining = toInt(headers.get("x-ratelimit-remaining"));
  const resetAtSec = toInt(headers.get("x-ratelimit-reset"));
  const retryAfterSec = toInt(headers.get("retry-after"));
  const nowSec = (Date.now() / 1000) | 0;

  state[bucket] = {
    remaining: remaining ?? state[bucket].remaining,
    resetAtSec: resetAtSec ?? state[bucket].resetAtSec,
    retryAfterSec: retryAfterSec ?? state[bucket].retryAfterSec,
    updatedAtSec: nowSec
  };
}

export function shouldPauseBucket(
  bucket: RateBucket,
  minRemaining: number
): { should: boolean; sleepUntilSec?: number } {
  if (bucket.retryAfterSec && bucket.retryAfterSec > 0) {
    return { should: true, sleepUntilSec: ((Date.now() / 1000) | 0) + bucket.retryAfterSec };
  }
  if (bucket.remaining === undefined || bucket.resetAtSec === undefined) return { should: false };
  if (bucket.remaining >= minRemaining) return { should: false };
  return { should: true, sleepUntilSec: bucket.resetAtSec };
}

