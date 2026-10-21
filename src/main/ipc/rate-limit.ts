/** 会话内滑动窗口限流（settings.saveSecret 专用；重启即清零，不持久化）。 */

export interface RateDecision {
  readonly ok: boolean;
  readonly retryAfterMs: number;
}

export interface RateLimiter {
  tryConsume(now?: number): RateDecision;
  reset(): void;
}

export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('limit must be a positive integer');
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error('windowMs must be positive');
  let timestamps: number[] = [];
  return {
    tryConsume(now: number = Date.now()): RateDecision {
      timestamps = timestamps.filter((timestamp) => now - timestamp < windowMs);
      if (timestamps.length >= limit) {
        const oldest = timestamps[0] ?? now;
        return { ok: false, retryAfterMs: Math.max(1, windowMs - (now - oldest)) };
      }
      timestamps.push(now);
      return { ok: true, retryAfterMs: 0 };
    },
    reset(): void {
      timestamps = [];
    },
  };
}
