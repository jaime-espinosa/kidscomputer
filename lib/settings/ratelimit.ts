type Bucket = { count: number; resetAt: number }

export function createRateLimiter({
  limit,
  windowMs,
  now = Date.now,
}: { limit: number; windowMs: number; now?: () => number }) {
  const buckets = new Map<string, Bucket>()
  return {
    allow(ip: string): boolean {
      const t = now()
      const b = buckets.get(ip)
      if (!b || t >= b.resetAt) {
        buckets.set(ip, { count: 1, resetAt: t + windowMs })
        return true
      }
      if (b.count >= limit) return false
      b.count += 1
      return true
    },
  }
}
