/** Shared list helpers for console tables (pagination + Asia/Shanghai dates). */

const SH_OFFSET_MS = 8 * 3600 * 1000

/** Page number strip with ellipses: 1 … 4 5 6 … 20 */
export function pageNums(cur: number, total: number): (number | string)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const out: (number | string)[] = [1]
  if (cur > 3) out.push('...')
  for (let n = Math.max(2, cur - 1); n <= Math.min(total - 1, cur + 1); n++) out.push(n)
  if (cur < total - 2) out.push('...')
  out.push(total)
  return out
}

/** YYYY-MM-DD → unix seconds of 00:00:00 Asia/Shanghai. */
export function shanghaiStartOfDay(s: string): number {
  const [y, m, d] = String(s).split('-').map(Number)
  return Math.floor((Date.UTC(y, m - 1, d) - SH_OFFSET_MS) / 1000)
}

/** YYYY-MM-DD → unix seconds of 23:59:59 Asia/Shanghai. */
export function shanghaiEndOfDay(s: string): number {
  return shanghaiStartOfDay(s) + 86400 - 1
}

/** Unix seconds → "YYYY-MM-DD HH:mm:ss" in Asia/Shanghai. */
export function fmtShanghai(sec?: number): string {
  if (!sec) return '-'
  const d = new Date(sec * 1000 + SH_OFFSET_MS)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

export const RANGE_LABELS: Record<string, string> = {
  today: '今天',
  yesterday: '昨天',
  '24h': '近 24 小时',
  '7d': '近 7 天',
  '14d': '近 14 天',
  '30d': '近 30 天',
  month: '本月',
  last_month: '上月',
  all: '全部',
  custom: '自定义',
}
