/**
 * In-memory fixed-window rate limiter with temporary lockout.
 * Used to throttle login / register / oauth-state (per IP and per username).
 * Single-process only (BFF runs one node); resets on restart. No external deps.
 */

/**
 * @param {object} opts
 * @param {number} opts.windowMs   Rolling window size.
 * @param {number} opts.max        Max hits allowed within the window before blocking.
 * @param {number} [opts.blockMs]  How long to keep blocking once tripped (defaults to windowMs).
 */
export function createRateLimiter({ windowMs, max, blockMs } = {}) {
  const WINDOW = Math.max(1000, Number(windowMs) || 60_000)
  const MAX = Math.max(1, Number(max) || 10)
  const BLOCK = Math.max(WINDOW, Number(blockMs) || WINDOW)
  /** @type {Map<string, { count: number, first: number, blockedUntil: number }>} */
  const buckets = new Map()

  function prune(now) {
    for (const [k, v] of buckets) {
      if (v.blockedUntil > now) continue
      if (now - v.first > WINDOW) buckets.delete(k)
    }
  }

  return {
    /** Record one attempt for key. Returns { limited, retryAfterMs }. */
    hit(key) {
      const now = Date.now()
      if (buckets.size > 5000) prune(now)
      const k = String(key || '')
      let b = buckets.get(k)
      if (!b || now - b.first > WINDOW) {
        b = { count: 0, first: now, blockedUntil: 0 }
        buckets.set(k, b)
      }
      if (b.blockedUntil > now) {
        return { limited: true, retryAfterMs: b.blockedUntil - now }
      }
      b.count += 1
      if (b.count > MAX) {
        b.blockedUntil = now + BLOCK
        return { limited: true, retryAfterMs: BLOCK }
      }
      return { limited: false, retryAfterMs: 0 }
    },
    /** Clear a key (e.g. on successful login). */
    reset(key) {
      buckets.delete(String(key || ''))
    },
    /** Non-mutating check: is this key currently blocked? */
    peek(key) {
      const now = Date.now()
      const b = buckets.get(String(key || ''))
      if (b && b.blockedUntil > now) return { limited: true, retryAfterMs: b.blockedUntil - now }
      return { limited: false, retryAfterMs: 0 }
    },
    _size() {
      return buckets.size
    },
  }
}
