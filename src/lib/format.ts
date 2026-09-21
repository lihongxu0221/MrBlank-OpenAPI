let quotaPerUnit = 500000

export function setQuotaPerUnit(n: number) {
  if (n > 0) quotaPerUnit = n
}

export function getQuotaPerUnit() {
  return quotaPerUnit
}

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
