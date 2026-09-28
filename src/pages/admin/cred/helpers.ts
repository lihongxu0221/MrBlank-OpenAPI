import { P } from '../../../i18n'
import type { Account, QuotaSnap, QuotaWindow } from './types'

export function accountName(a: Account) {
  return String(a.name || a.id || '')
}

export function resolveDisplay(a: Account) {
  return String(a.display_status || (a.disabled ? 'disabled' : a.unavailable ? 'unavailable' : 'running'))
}

/** CPAMP health_* labels for list badges */
export function healthBadge(a: Account): { className: string; label: string } {
  if (a.disabled || resolveDisplay(a) === 'disabled') {
    return { className: 'health-badge off', label: P('已禁用') }
  }
  const d = resolveDisplay(a)
  if (d === 'need_reauth') return { className: 'health-badge down', label: P('需重登') }
  if (d === 'unavailable') return { className: 'health-badge down', label: P('异常') }
  const risk = String(a.quota?.risk || '')
  if (risk === 'exhausted') return { className: 'health-badge down', label: P('已耗尽') }
  if (risk === 'critical' || risk === 'low') return { className: 'health-badge warn', label: P('低额度') }
  // unconfirmed: no quota evidence and no request activity
  const activity = Number(a.success || 0) + Number(a.failed || 0)
  if (!a.quota && activity === 0) {
    return { className: 'health-badge warn', label: P('未判定') }
  }
  return { className: 'health-badge ok', label: P('可用') }
}

export function maskId(name: string, show: boolean) {
  if (show || name.length <= 10) return name
  return `${name.slice(0, 4)}…${name.slice(-4)}`
}

export function maskEmail(email?: string | null, show = false) {
  const s = String(email || '').trim()
  if (!s) return ''
  if (show || !s.includes('@')) return s
  const [u, d] = s.split('@')
  if (u.length <= 3) return `${u[0] || '*'}***@${d}`
  return `${u.slice(0, 3)}***@${d}`
}

export function fmtTimeShort(iso?: string | null) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return String(iso)
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mi = String(d.getMinutes()).padStart(2, '0')
    const ss = String(d.getSeconds()).padStart(2, '0')
    return `${mm}/${dd} ${hh}:${mi}:${ss}`
  } catch {
    return String(iso)
  }
}

export function fmtCompact(n?: number | null) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return String(Math.round(v * 10) / 10)
}

export function fmtMoney(n?: number | null) {
  if (n == null || !Number.isFinite(Number(n))) return '$ 0.00'
  return `$ ${Number(n).toFixed(2)}`
}

export function fmtPct(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(1)}%`
}

export function usageStats(a: Account) {
  const ok = Number(a.success || 0)
  const fail = Number(a.failed || 0)
  const reqs = ok + fail
  const rate = reqs > 0 ? ok / reqs : null
  return {
    requests: reqs,
    cost: a.usage_cost ?? null,
    tokens: a.usage_tokens ?? null,
    successRate: rate,
  }
}

export function sparkSegments(a: Account, slots = 10): number[] {
  const recent = Array.isArray(a.recent_requests) ? a.recent_requests : []
  if (!recent.length) return Array.from({ length: slots }, () => 0)
  const slice = recent.slice(-slots)
  const vals = slice.map((r) => Number(r.success || 0) + Number(r.failed || 0))
  while (vals.length < slots) vals.unshift(0)
  const max = Math.max(1, ...vals)
  return vals.map((v) => v / max)
}

export function quotaWindows(a: Account): QuotaWindow[] {
  if (Array.isArray(a.quota_windows) && a.quota_windows.length) {
    return a.quota_windows.map((w) => ({
      ...w,
      label: w.label || windowLabel(w.label, a.provider),
    }))
  }
  const q = a.quota
  if (!q) return []
  return [
    {
      label: windowLabel(q.window, a.provider),
      remaining_ratio: q.remaining_ratio ?? null,
      remaining: q.remaining ?? null,
      limit: q.limit ?? null,
      resets_at: q.resets_at ?? null,
      risk: q.risk ?? null,
    },
  ]
}

function windowLabel(w?: string | null, provider?: string | null) {
  const s = String(w || '').trim()
  const lower = s.toLowerCase()
  const prov = providerLabel(String(provider || '')).replace(/cli/i, '').trim()
  let kind = ''
  if (/5h|five.?hour|5.?hour/.test(lower)) kind = '5h'
  else if (/week|weekly|7d|周/.test(lower)) kind = P('周额度')
  else if (/month|monthly|30d|月/.test(lower)) kind = P('月额度')
  else if (/day|24h|daily|日/.test(lower)) kind = P('日额度')
  else if (s) return s
  else kind = P('额度')
  // Prefer existing "Claude 5h" style labels as-is
  if (/claude|gemini|codex|gpt|antigravity|xai|grok/i.test(s)) return s
  if (prov && kind) return `${prov} ${kind}`
  return kind
}

/** CPAMP-style short reset: "4 小时后" / "6 天后" */
export function fmtResetRelative(iso?: string | null) {
  if (!iso) return '—'
  const t = Date.parse(String(iso))
  if (!Number.isFinite(t)) return fmtTimeShort(iso)
  const diffMs = t - Date.now()
  if (diffMs <= 0) return P('已重置')
  const mins = Math.round(diffMs / 60000)
  if (mins < 60) return `${mins} ${P('分钟后')}`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours} ${P('小时后')}`
  const days = Math.round(hours / 24)
  return `${days} ${P('天后')}`
}

export function deriveListMetrics(items: Account[]) {
  let available = 0
  let attention = 0
  let quotaRisk = 0
  let disabled = 0
  let unconfirmed = 0
  for (const a of items) {
    const d = resolveDisplay(a)
    if (d === 'disabled' || a.disabled) {
      disabled += 1
      continue
    }
    if (d === 'need_reauth' || d === 'unavailable' || a.unavailable) {
      attention += 1
      continue
    }
    const risk = String(a.quota?.risk || '')
    if (['low', 'critical', 'exhausted'].includes(risk)) {
      quotaRisk += 1
      continue
    }
    const activity = Number(a.success || 0) + Number(a.failed || 0)
    if (!a.quota && activity === 0) {
      unconfirmed += 1
      continue
    }
    available += 1
  }
  return {
    total: items.length,
    available,
    attention,
    quotaRisk,
    disabled,
    unconfirmed,
  }
}

export function providerLabel(p: string) {
  const k = p.toLowerCase()
  if (k === 'xai') return 'xAI'
  if (k === 'iflow') return 'iFlow'
  if (k === 'antigravity') return 'Antigravity'
  if (k === 'gemini-cli') return 'Gemini CLI'
  return p.charAt(0).toUpperCase() + p.slice(1)
}

export type { Account, QuotaSnap, QuotaWindow }
