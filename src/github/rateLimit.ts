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
  const prev = state[bucket];

  // retry-after 只在该响应头存在时生效；否则沿用旧值但必须考虑其已过期。
  // 否则一次 429 之后 retryAfterSec 会永久残留，导致后续每个请求都被 sleep 卡住。
  let nextRetryAfter: number | undefined;
  if (retryAfterSec !== undefined) {
    nextRetryAfter = retryAfterSec;
  } else if (prev.retryAfterSec && prev.updatedAtSec) {
    nextRetryAfter = nowSec < prev.updatedAtSec + prev.retryAfterSec ? prev.retryAfterSec : undefined;
  }

  state[bucket] = {
    remaining: remaining ?? prev.remaining,
    resetAtSec: resetAtSec ?? prev.resetAtSec,
    retryAfterSec: nextRetryAfter,
    updatedAtSec: nowSec
  };
}

function retryAfterStillValid(bucket: RateBucket, nowSec: number): boolean {
  return !!(
    bucket.retryAfterSec &&
    bucket.retryAfterSec > 0 &&
    bucket.updatedAtSec !== undefined &&
    nowSec < bucket.updatedAtSec + bucket.retryAfterSec
  );
}

export function shouldPauseBucket(
  bucket: RateBucket,
  minRemaining: number
): { should: boolean; sleepUntilSec?: number } {
  const nowSec = (Date.now() / 1000) | 0;
  if (retryAfterStillValid(bucket, nowSec)) {
    return { should: true, sleepUntilSec: nowSec + bucket.retryAfterSec! };
  }
  if (bucket.remaining === undefined || bucket.resetAtSec === undefined) return { should: false };
  if (bucket.remaining >= minRemaining) return { should: false };
  return { should: true, sleepUntilSec: bucket.resetAtSec };
}

