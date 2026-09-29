let quotaPerUnit = 500000

export function setQuotaPerUnit(n: number) {
  if (n > 0) quotaPerUnit = n
}

export function getQuotaPerUnit() {
  return quotaPerUnit
}

/** Fixed: 1 USD = 500000 raw (Blank Li rule — not configurable). */
export const QUOTA_PER_USD = 500_000
export const FIXED_USD_TO_RAW = 500_000

export function formatCredits(raw: number, unit = quotaPerUnit): string {
  const credits = raw / unit
  if (!Number.isFinite(credits)) return '0'
  if (Number.isInteger(credits)) return String(credits)
  return credits.toFixed(credits < 10 ? 2 : 1)
}

export function formatDateTime(unixSec: number, lang: 'zh' | 'en') {
  return new Date(unixSec * 1000).toLocaleString(lang === 'en' ? 'en-US' : 'zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  })
}

export function fmtUsd(n: number) {
  const v = Number(n) || 0
  return (
    '$' +
    v.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    })
  )
}

/** Raw → USD (always FIXED 500000). */
export function quotaToUsd(q: number, _unitIgnored?: number) {
  return (Number(q) || 0) / FIXED_USD_TO_RAW
}

/** USD → raw (always FIXED 500000). */
export function usdToQuota(usd: number, _unitIgnored?: number) {
  return Math.round((Number(usd) || 0) * FIXED_USD_TO_RAW)
}

/** Display 点 → raw = round(points × N). */
export function pointsToQuota(points: number, unit = quotaPerUnit) {
  return Math.round((Number(points) || 0) * (unit || FIXED_USD_TO_RAW))
}

/** Raw → display 点 = raw / N. */
export function quotaToPoints(q: number, unit = quotaPerUnit) {
  return (Number(q) || 0) / (unit || FIXED_USD_TO_RAW)
}

/**
 * Parse 「1 点 = N」 input: plain number or B/M/K suffix (case-insensitive).
 * 0.5M = 500000, 500K = 500000, 1B = 1000000000. Returns null if invalid.
 */
export function parseRawPerPoint(input: unknown): number | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 1 || input > 1e12) return null
    return Math.round(input)
  }
  const s = String(input ?? '')
    .trim()
    .replace(/,/g, '')
    .replace(/_/g, '')
  if (!s) return null
  const m = s.match(/^([+-]?\d+(?:\.\d+)?)\s*([kKmMbB])?$/)
  if (!m) return null
  let n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return null
  const suf = (m[2] || '').toUpperCase()
  if (suf === 'K') n *= 1e3
  else if (suf === 'M') n *= 1e6
  else if (suf === 'B') n *= 1e9
  if (!Number.isFinite(n) || n < 1 || n > 1e12) return null
  return Math.round(n)
}

/** Compact a quota amount using the service-status B/M/K thresholds. */
export function formatQuotaCompact(n: number): string {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0'
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  let scaled = abs
  let suffix = ''
  if (abs >= 1e9) {
    scaled = abs / 1e9
    suffix = 'B'
  } else if (abs >= 1e6) {
    scaled = abs / 1e6
    suffix = 'M'
  } else if (abs >= 1e3) {
    scaled = abs / 1e3
    suffix = 'K'
  } else {
    return String(Math.round(v * 10) / 10)
  }
  // Truncate to avoid displaying more quota than the full value represents.
  const oneDecimal = Math.floor(scaled * 10) / 10
  return `${sign}${oneDecimal.toFixed(1).replace(/\.0$/, '')}${suffix}`
}

/** Full quota amount with thousands separators and its compact B/M/K form. */
export function formatQuotaWithCompact(n: number): string {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0'
  const full = v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return Math.abs(v) >= 1e3 ? `${full} ≈ ${formatQuotaCompact(v)}` : full
}

/** Short quota-unit help text shared by console and admin surfaces. */
export function formatQuotaUnitLabel(n = quotaPerUnit): string {
  const v = Math.round(Number(n) || FIXED_USD_TO_RAW)
  return `1 点 = ${v.toLocaleString('en-US')} token`
}

/** Compact form for N: 500000 → "0.5M", 1e9 → "1B", 5000 → "5K". */
export function formatRawPerPointCompact(n: number): string {
  const v = Math.round(Number(n) || FIXED_USD_TO_RAW)
  if (v >= 1e9 && v % 1e9 === 0) return `${v / 1e9}B`
  if (v >= 1e5) {
    const m = v / 1e6
    const rounded = Math.round(m * 1000) / 1000
    if (Math.abs(rounded * 1e6 - v) < 0.5) {
      const s = String(rounded)
        .replace(/(\.\d*?)0+$/, '$1')
        .replace(/\.$/, '')
      return `${s}M`
    }
  }
  if (v >= 1e3 && v % 1e3 === 0) return `${v / 1e3}K`
  return String(v)
}

export function stName(s: number) {
  return ({ 1: '启用', 2: '禁用', 3: '过期', 4: '用尽' })[s] || String(s || '')
}
