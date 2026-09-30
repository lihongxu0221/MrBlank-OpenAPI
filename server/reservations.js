/**
 * Pre-authorization ledger for /v1 billable calls (in-memory, single process).
 *
 * Why: balance / group-window checks happen before the upstream call but usage is
 * only known after it. Without reservations, N parallel requests all pass a
 * "balance > 0" check and are then clamped to the remaining balance (free overdraft).
 *
 * Each in-flight billable request reserves an estimated cost; checks subtract the
 * sum of a user's open reservations. A per-user concurrency cap bounds the burst.
 * Reservations are released on settle (success or failure) and expire after TTL
 * as a safety net against leaks.
 */
import crypto from 'node:crypto'

export function createReservationLedger({ maxPerUser = 4, ttlMs = 15 * 60 * 1000 } = {}) {
  /** @type {Map<string, { userId: string, pools: Record<string, number>, at: number }>} */
  const open = new Map()

  function sweep(now = Date.now()) {
    for (const [id, r] of open) if (now - r.at > ttlMs) open.delete(id)
  }

  function stats(userId) {
    sweep()
    const uid = String(userId)
    const pools = {}
    let count = 0
    for (const r of open.values()) {
      if (r.userId !== uid) continue
      count += 1
      for (const [p, a] of Object.entries(r.pools)) pools[p] = (pools[p] || 0) + a
    }
    return { pools, count }
  }

  return {
    get maxPerUser() {
      return maxPerUser
    },
    /** Sum of open reservations for a user in one pool (e.g. 'credits', 'group', 'token:5'). */
    reservedFor(userId, pool) {
      return stats(userId).pools[pool] || 0
    },
    inflightFor(userId) {
      return stats(userId).count
    },
    /**
     * Atomically check-and-reserve across pools.
     * pools: [{ pool, amount, available }] — `available` is capacity BEFORE reservations.
     * Returns { ok:true, id, release } or { ok:false, code, reason, pool }.
     */
    reserve(userId, pools = [], { limit = maxPerUser } = {}) {
      const uid = String(userId)
      const cur = stats(uid)
      if (limit > 0 && cur.count >= limit) {
        return { ok: false, code: 'user_concurrency', reason: `同时进行中的请求已达上限（${limit}）` }
      }
      const take = {}
      for (const { pool, amount, available } of pools) {
        const need = Math.max(1, Math.ceil(Number(amount) || 0))
        const already = cur.pools[pool] || 0
        if (Number.isFinite(available) && available - already < need) {
          return {
            ok: false,
            code: 'insufficient_reserve',
            pool,
            need,
            available: Math.max(0, available - already),
            reason: '可用额度不足以覆盖本次请求的预估费用（含进行中的请求）',
          }
        }
        take[pool] = need
      }
      const id = crypto.randomBytes(8).toString('hex')
      open.set(id, { userId: uid, pools: take, at: Date.now() })
      let done = false
      return {
        ok: true,
        id,
        pools: take,
        release() {
          if (done) return
          done = true
          open.delete(id)
        },
      }
    },
    _size() {
      return open.size
    },
  }
}

/**
 * Estimate a request's cost in raw quota before calling upstream.
 * prompt ≈ body chars / 4; completion = requested max tokens or a default budget.
 */
export function estimateRequestQuota({ bodyText = '', maxTokens = 0, price = null, costForTokens, dollarsToQuota, defaultCompletion = 1024, maxCompletion = 32768 }) {
  const promptTok = Math.ceil(String(bodyText || '').length / 4)
  const completionTok = Math.min(maxCompletion, maxTokens > 0 ? maxTokens : defaultCompletion)
  if (!price || typeof costForTokens !== 'function' || typeof dollarsToQuota !== 'function') return 1
  try {
    const usd = costForTokens(price, promptTok, completionTok, {})
    const q = Math.ceil(dollarsToQuota(usd) || 0)
    return Math.max(1, q)
  } catch {
    return 1
  }
}
