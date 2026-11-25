interface RateLimitRecord {
  timestamps: number[];
}

const cache = new Map<string, RateLimitRecord>();

/**
 * Sliding window in-memory rate limiter.
 * @param key identifier (e.g. `ip:endpoint`)
 * @param limit maximum allowed requests in the window
 * @param windowMs time window in milliseconds (default 60000ms = 1 min)
 * @returns { allowed: boolean, remaining: number, resetMs: number }
 */
export function checkRateLimit(
  key: string,
  limit = 20,
  windowMs = 60000
): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  const windowStart = now - windowMs;

  let record = cache.get(key);
  if (!record) {
    record = { timestamps: [] };
    cache.set(key, record);
  }

  // Filter out timestamps outside window
  record.timestamps = record.timestamps.filter((t) => t > windowStart);

  if (record.timestamps.length >= limit) {
    const oldest = record.timestamps[0];
    const resetMs = oldest + windowMs - now;
    return { allowed: false, remaining: 0, resetMs };
  }

  record.timestamps.push(now);
  const remaining = limit - record.timestamps.length;
  return { allowed: true, remaining, resetMs: windowMs };
}
