let quotaPerUnit = 500000

export function setQuotaPerUnit(n: number) {
  if (n > 0) quotaPerUnit = n
}

export function getQuotaPerUnit() {
  return quotaPerUnit
}

/** Default aily / new-api: $1 = 1 点 = 500000 raw (overridden at runtime via /api/status). */
export const QUOTA_PER_USD = 500_000

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

export function quotaToUsd(q: number, unit = quotaPerUnit) {
  return (Number(q) || 0) / (unit || QUOTA_PER_USD)
}

export function usdToQuota(usd: number, unit = quotaPerUnit) {
  return Math.round((Number(usd) || 0) * (unit || QUOTA_PER_USD))
}

/** Display 点 → raw (same N as USD under aily parity). */
export function pointsToQuota(points: number, unit = quotaPerUnit) {
  return usdToQuota(points, unit)
}

export function quotaToPoints(q: number, unit = quotaPerUnit) {
  return quotaToUsd(q, unit)
}

export function stName(s: number) {
  return ({ 1: '启用', 2: '禁用', 3: '过期', 4: '用尽' })[s] || String(s || '')
}
