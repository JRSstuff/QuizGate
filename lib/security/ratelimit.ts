interface RateLimitRecord {
  timestamps: number[];
}

const cache = new Map<string, RateLimitRecord>();

/**
 * Sliding window in-memory rate limiter.
 * Prunes expired buckets automatically when cache exceeds 1,000 keys to prevent memory growth.
 */
export function checkRateLimit(
  key: string,
  limit = 60,
  windowMs = 60000
): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  const windowStart = now - windowMs;

  if (cache.size > 1000) {
    for (const [k, rec] of cache.entries()) {
      const fresh = rec.timestamps.filter((t) => t > windowStart);
      if (fresh.length === 0) {
        cache.delete(k);
      } else {
        rec.timestamps = fresh;
      }
    }
  }

  let record = cache.get(key);
  if (!record) {
    record = { timestamps: [] };
    cache.set(key, record);
  }

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
