/**
 * Asia/Shanghai calendar range helpers (UTC+8, no DST).
 * Shared by wallet ledger (and usable by other list endpoints).
 */
const OFFSET_MS = 8 * 3600 * 1000
const DAY_MS = 86400 * 1000

/** Epoch ms of 00:00 Asia/Shanghai for the day containing `ms`. */
export function shanghaiDayStart(ms = Date.now()) {
  return Math.floor((ms + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS
}

/** Parse YYYY-MM-DD as 00:00 Asia/Shanghai; null when invalid. */
export function parseShanghaiDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim())
  if (!m) return null
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00+08:00`)
  return Number.isFinite(t) ? t : null
}

function shanghaiYm(ms) {
  const d = new Date(ms + OFFSET_MS)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }
}

function monthStart(y, m) {
  return Date.UTC(y, m - 1, 1) - OFFSET_MS
}

export const WALLET_RANGES = ['today', 'yesterday', '24h', '7d', '30d', 'month', 'last_month', 'all', 'custom']

/**
 * Resolve { from, to } (inclusive epoch ms) for a range preset.
 * @param {{ range?: string, start_date?: string, end_date?: string }} q
 */
export function shanghaiRangeBounds(q = {}, now = Date.now()) {
  const range = String(q.range || '30d')
  const today = shanghaiDayStart(now)
  switch (range) {
    case 'today':
      return { from: today, to: today + DAY_MS - 1 }
    case 'yesterday':
      return { from: today - DAY_MS, to: today - 1 }
    case '24h':
      return { from: now - DAY_MS, to: now }
    case '7d':
      return { from: now - 7 * DAY_MS, to: now }
    case '30d':
      return { from: now - 30 * DAY_MS, to: now }
    case 'month': {
      const { y, m } = shanghaiYm(now)
      return { from: monthStart(y, m), to: m === 12 ? monthStart(y + 1, 1) - 1 : monthStart(y, m + 1) - 1 }
    }
    case 'last_month': {
      const { y, m } = shanghaiYm(now)
      const ly = m === 1 ? y - 1 : y
      const lm = m === 1 ? 12 : m - 1
      return { from: monthStart(ly, lm), to: monthStart(y, m) - 1 }
    }
    case 'custom': {
      const s = parseShanghaiDate(q.start_date)
      const e = parseShanghaiDate(q.end_date)
      let from = s ?? 0
      let to = e != null ? e + DAY_MS - 1 : Number.MAX_SAFE_INTEGER
      if (from > to) [from, to] = [to - DAY_MS + 1, from + DAY_MS - 1]
      return { from, to }
    }
    case 'all':
    default:
      if (range !== 'all') return shanghaiRangeBounds({ range: '30d' }, now)
      return { from: 0, to: Number.MAX_SAFE_INTEGER }
  }
}
