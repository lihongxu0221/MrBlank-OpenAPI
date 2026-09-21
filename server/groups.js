/**
 * User groups (Linux.do / Discourse-inspired trust levels).
 * Persisted at server/data/user-groups.json.
 *
 * Credit / quota unit:
 *   - Display「点」= raw / Q ; Q = 500_000 (≈ $1 presentation unit)
 *   - Rolling 5h / week / month quotas use raw units
 *   - BFF /v1 maps prompt+completion tokens → raw (MVP: 1 token ≈ 1 raw unit)
 *   - Empty model_ids = all models; non-empty = allowlist (403 if violated)
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const Q = 500_000

/** Public description of the credit unit (API + docs). */
export const CREDIT_UNIT_INFO = {
  raw_per_point: Q,
  display_name: '点',
  note:
    '1 点 = 500000 内部额度单位（约 $1 展示换算）。用户组 5h/周/月滚动额度按内部单位计量；BFF /v1 将 prompt+completion tokens 计入（MVP：1 token ≈ 1 内部单位）。',
  windows: ['window_5h', 'week', 'month'],
}

const DEFAULT_GROUPS = [
  {
    id: 'newcomer',
    name: '新人',
    level: 1,
    description: '刚加入的探索者，可用基础模型与较小滚动额度。',
    quotas: { window_5h: 2 * Q, week: 10 * Q, month: 30 * Q },
    model_ids: [],
    promotion: { min_account_days: 0, min_request_count: 0, min_used_quota: 0, min_checkins: 0 },
    enabled: true,
    sort_order: 10,
  },
  {
    id: 'basic',
    name: '基本用户',
    level: 2,
    description: '完成初步使用后的默认活跃档。',
    quotas: { window_5h: 5 * Q, week: 25 * Q, month: 80 * Q },
    model_ids: [],
    promotion: { min_account_days: 3, min_request_count: 10, min_used_quota: 1 * Q, min_checkins: 2 },
    enabled: true,
    sort_order: 20,
  },
  {
    id: 'member',
    name: '成员',
    level: 3,
    description: '稳定使用社区资源的成员。',
    quotas: { window_5h: 10 * Q, week: 50 * Q, month: 160 * Q },
    model_ids: [],
    promotion: { min_account_days: 14, min_request_count: 50, min_used_quota: 5 * Q, min_checkins: 7 },
    enabled: true,
    sort_order: 30,
  },
  {
    id: 'regular',
    name: '活跃用户',
    level: 4,
    description: '高频调用与长期签到的活跃探索者。',
    quotas: { window_5h: 20 * Q, week: 100 * Q, month: 320 * Q },
    model_ids: [],
    promotion: { min_account_days: 45, min_request_count: 200, min_used_quota: 20 * Q, min_checkins: 20 },
    enabled: true,
    sort_order: 40,
  },
  {
    id: 'leader',
    name: '老用户',
    level: 5,
    description: '高信任档；额度更高。信任分/社区声望等规则预留扩展。',
    quotas: { window_5h: 40 * Q, week: 200 * Q, month: 600 * Q },
    model_ids: [],
    promotion: { min_account_days: 90, min_request_count: 500, min_used_quota: 50 * Q, min_checkins: 40 },
    enabled: true,
    sort_order: 50,
  },
]

function nowIso() {
  return new Date().toISOString()
}

function normalizePromotion(p = {}) {
  return {
    min_account_days: Math.max(0, Number(p.min_account_days) || 0),
    min_request_count: Math.max(0, Number(p.min_request_count) || 0),
    min_used_quota: Math.max(0, Number(p.min_used_quota) || 0),
    min_checkins: Math.max(0, Number(p.min_checkins) || 0),
    // Placeholders for future Linux.do-like trust rules (not enforced yet):
    // min_trust_level, min_likes_received, min_topics_entered, min_posts_read
    notes: String(p.notes || ''),
  }
}

function normalizeGroup(raw, index = 0) {
  const id =
    String(raw?.id || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '') || `g-${crypto.randomBytes(3).toString('hex')}`
  const quotas = raw?.quotas || {}
  const model_ids = Array.isArray(raw?.model_ids)
    ? raw.model_ids.map((s) => String(s).trim()).filter(Boolean)
    : String(raw?.model_ids || '')
        .split(/[,，\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
  return {
    id,
    name: String(raw?.name || id).trim() || id,
    level: Number.isFinite(Number(raw?.level)) ? Number(raw.level) : index + 1,
    description: String(raw?.description || ''),
    quotas: {
      window_5h: Math.max(0, Number(quotas.window_5h ?? quotas['5h'] ?? 2 * Q) || 0),
      week: Math.max(0, Number(quotas.week) || 0),
      month: Math.max(0, Number(quotas.month) || 0),
    },
    model_ids,
    promotion: normalizePromotion(raw?.promotion),
    enabled: raw?.enabled !== false,
    sort_order: Number.isFinite(Number(raw?.sort_order)) ? Number(raw.sort_order) : (index + 1) * 10,
  }
}

function defaultDoc() {
  return {
    groups: DEFAULT_GROUPS.map((g, i) => normalizeGroup(g, i)),
    members: {},
    usage: {},
    updated_at: null,
  }
}

function normalizeDoc(raw) {
  const base = defaultDoc()
  const groups = Array.isArray(raw?.groups) && raw.groups.length
    ? raw.groups.map((g, i) => normalizeGroup(g, i))
    : base.groups
  return {
    groups,
    members: raw?.members && typeof raw.members === 'object' ? raw.members : {},
    usage: raw?.usage && typeof raw.usage === 'object' ? raw.usage : {},
    updated_at: raw?.updated_at || null,
  }
}

function windowMs(kind) {
  if (kind === 'window_5h' || kind === '5h') return 5 * 60 * 60 * 1000
  if (kind === 'week') return 7 * 24 * 60 * 60 * 1000
  if (kind === 'month') return 30 * 24 * 60 * 60 * 1000
  return 0
}

function meetsPromotion(metrics, rule) {
  if (!rule) return true
  return (
    (metrics.account_days || 0) >= rule.min_account_days &&
    (metrics.request_count || 0) >= rule.min_request_count &&
    (metrics.used_quota || 0) >= rule.min_used_quota &&
    (metrics.checkins || 0) >= rule.min_checkins
  )
}

export function createGroupStore(filePath, { quotaUnit = Q } = {}) {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const unit = quotaUnit || Q

  function read() {
    if (!fs.existsSync(filePath)) {
      const doc = defaultDoc()
      write(doc)
      return doc
    }
    try {
      return normalizeDoc(JSON.parse(fs.readFileSync(filePath, 'utf8')))
    } catch {
      return defaultDoc()
    }
  }

  function write(doc) {
    const normalized = normalizeDoc(doc)
    normalized.updated_at = nowIso()
    const tmp = `${filePath}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, filePath)
    try {
      fs.chmodSync(filePath, 0o600)
    } catch {
      /* ignore */
    }
    return normalized
  }

  function sortedGroups(doc) {
    return doc.groups
      .filter((g) => g.enabled)
      .slice()
      .sort((a, b) => a.level - b.level || a.sort_order - b.sort_order)
  }

  function findGroup(doc, id) {
    return doc.groups.find((g) => g.id === id) || null
  }

  function ensureMember(doc, userId, { joinedAt } = {}) {
    const id = String(userId)
    if (!doc.members[id]) {
      const starter = sortedGroups(doc)[0]
      doc.members[id] = {
        group_id: starter?.id || 'newcomer',
        override: false,
        joined_at: joinedAt || nowIso(),
        assigned_at: nowIso(),
      }
    } else if (!doc.members[id].joined_at) {
      doc.members[id].joined_at = joinedAt || nowIso()
    }
    return doc.members[id]
  }

  function pruneUsage(events, kind) {
    const ms = windowMs(kind)
    if (!ms) return []
    const cutoff = Date.now() - ms
    return (events || []).filter((e) => Number(e.at) >= cutoff)
  }

  function usedInWindow(doc, userId, kind) {
    const u = doc.usage[String(userId)] || { events: [] }
    const events = pruneUsage(u.events, kind)
    return events.reduce((sum, e) => sum + (Number(e.quota) || 0), 0)
  }

  function evaluateGroupId(doc, userId, metrics) {
    const mem = ensureMember(doc, userId)
    if (mem.override && mem.group_id && findGroup(doc, mem.group_id)) {
      return mem.group_id
    }
    let best = sortedGroups(doc)[0]?.id || 'newcomer'
    for (const g of sortedGroups(doc)) {
      if (meetsPromotion(metrics, g.promotion)) best = g.id
    }
    return best
  }

  return {
    quotaUnit: unit,

    listGroups() {
      return read().groups.slice().sort((a, b) => a.level - b.level || a.sort_order - b.sort_order)
    },

    saveGroups(groups) {
      const doc = read()
      doc.groups = (Array.isArray(groups) ? groups : []).map((g, i) => normalizeGroup(g, i))
      if (!doc.groups.length) doc.groups = defaultDoc().groups
      return write(doc).groups
    },

    listMembers() {
      const doc = read()
      return Object.entries(doc.members).map(([user_id, m]) => ({
        user_id,
        group_id: m.group_id,
        override: !!m.override,
        joined_at: m.joined_at,
        assigned_at: m.assigned_at,
      }))
    },

    assignMember(userId, { group_id, override = true } = {}) {
      const doc = read()
      const mem = ensureMember(doc, userId)
      if (group_id) {
        if (!findGroup(doc, group_id)) throw new Error('用户组不存在')
        mem.group_id = group_id
      }
      mem.override = !!override
      mem.assigned_at = nowIso()
      write(doc)
      return { user_id: String(userId), ...mem }
    },

    ensureUser(userId, { joinedAt } = {}) {
      const doc = read()
      ensureMember(doc, userId, { joinedAt })
      write(doc)
    },

    recordUsage(userId, { quota = 0, requests = 0 } = {}) {
      const doc = read()
      const id = String(userId)
      if (!doc.usage[id]) doc.usage[id] = { events: [] }
      const q = Math.max(0, Number(quota) || 0)
      const r = Math.max(0, Number(requests) || 0)
      if (q || r) {
        doc.usage[id].events.push({ at: Date.now(), quota: q, requests: r })
        // keep last ~90d
        const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
        doc.usage[id].events = doc.usage[id].events.filter((e) => Number(e.at) >= cutoff)
        write(doc)
      }
    },

    /**
     * Resolve group for user; auto-promote unless override.
     * metrics: { account_days, request_count, used_quota, checkins }
     */
    resolveUserGroup(userId, metrics = {}) {
      const doc = read()
      const mem = ensureMember(doc, userId)
      const nextId = evaluateGroupId(doc, userId, metrics)
      if (!mem.override && mem.group_id !== nextId) {
        mem.group_id = nextId
        mem.assigned_at = nowIso()
        write(doc)
      } else if (!doc.members[String(userId)]) {
        write(doc)
      }
      const group = findGroup(doc, mem.group_id) || sortedGroups(doc)[0]
      const used = {
        window_5h: usedInWindow(doc, userId, 'window_5h'),
        week: usedInWindow(doc, userId, 'week'),
        month: usedInWindow(doc, userId, 'month'),
      }
      const limits = group?.quotas || { window_5h: 0, week: 0, month: 0 }
      const remaining = {
        window_5h: Math.max(0, limits.window_5h - used.window_5h),
        week: Math.max(0, limits.week - used.week),
        month: Math.max(0, limits.month - used.month),
      }
      const all = sortedGroups(doc)
      const idx = all.findIndex((g) => g.id === group?.id)
      const next = idx >= 0 && idx < all.length - 1 ? all[idx + 1] : null
      let progress = null
      if (next) {
        const rule = next.promotion
        progress = {
          next_group_id: next.id,
          next_group_name: next.name,
          requirements: rule,
          current: {
            account_days: metrics.account_days || 0,
            request_count: metrics.request_count || 0,
            used_quota: metrics.used_quota || 0,
            checkins: metrics.checkins || 0,
          },
          ratios: {
            account_days: rule.min_account_days
              ? Math.min(1, (metrics.account_days || 0) / rule.min_account_days)
              : 1,
            request_count: rule.min_request_count
              ? Math.min(1, (metrics.request_count || 0) / rule.min_request_count)
              : 1,
            used_quota: rule.min_used_quota
              ? Math.min(1, (metrics.used_quota || 0) / rule.min_used_quota)
              : 1,
            checkins: rule.min_checkins
              ? Math.min(1, (metrics.checkins || 0) / rule.min_checkins)
              : 1,
          },
        }
      }
      return {
        group,
        override: !!mem.override,
        joined_at: mem.joined_at,
        used,
        remaining,
        limits,
        next_group: next
          ? { id: next.id, name: next.name, level: next.level, promotion: next.promotion }
          : null,
        progress,
        quota_unit: unit,
        credit_unit: CREDIT_UNIT_INFO,
      }
    },

    /** Lifetime totals from rolling usage log (promotion metrics). */
    lifetimeTotals(userId) {
      const doc = read()
      const events = doc.usage[String(userId)]?.events || []
      let requests = 0
      let quota = 0
      for (const e of events) {
        requests += Number(e.requests) || 0
        quota += Number(e.quota) || 0
      }
      return { request_count: requests, used_quota: quota }
    },

    isModelAllowed(group, modelId) {
      const allow = group?.model_ids || []
      if (!allow.length) return true
      const mid = String(modelId || '').trim()
      if (!mid) return true
      return allow.map(String).includes(mid)
    },

    assertModelAllowed(group, modelId) {
      if (this.isModelAllowed(group, modelId)) return { ok: true }
      const mid = String(modelId || '').trim() || '(empty)'
      return {
        ok: false,
        message: `模型「${mid}」不在当前用户组白名单内。`,
        code: 'model_not_allowed',
      }
    },

    /** Filter OpenAI-style { data: [{ id }] } /v1/models JSON text. */
    filterModelsResponseBody(bodyText, group) {
      const allow = group?.model_ids || []
      if (!allow.length || !bodyText) return bodyText
      try {
        const obj = JSON.parse(bodyText)
        if (!Array.isArray(obj?.data)) return bodyText
        const set = new Set(allow.map(String))
        obj.data = obj.data.filter((m) => set.has(String(m?.id || m?.name || '')))
        return JSON.stringify(obj)
      } catch {
        return bodyText
      }
    },

    filterModels(modelDetails, group) {
      const allow = group?.model_ids || []
      if (!allow.length) return modelDetails
      const set = new Set(allow.map(String))
      return (modelDetails || []).filter((m) => set.has(String(m.id || m.name || m.model || '')))
    },

    assertQuotaAvailable(userId, metrics = {}) {
      const info = this.resolveUserGroup(userId, metrics)
      const rem = info.remaining
      if (rem.window_5h <= 0) {
        return {
          ok: false,
          code: 'quota_5h_exhausted',
          window: 'window_5h',
          message: '近 5 小时额度已用尽，请稍后再试或等待晋级更高用户组。',
          info,
        }
      }
      if (rem.week <= 0) {
        return {
          ok: false,
          code: 'quota_week_exhausted',
          window: 'week',
          message: '本周额度已用尽。',
          info,
        }
      }
      if (rem.month <= 0) {
        return {
          ok: false,
          code: 'quota_month_exhausted',
          window: 'month',
          message: '本月额度已用尽。',
          info,
        }
      }
      return { ok: true, info }
    },


    /** Replace rolling usage events from CPAMP log rows (idempotent rebuild from source). */
    syncUsageFromLogs(userId, rows = []) {
      const doc = read()
      const id = String(userId)
      const events = []
      for (const row of rows || []) {
        const at = row.created_at ? Date.parse(row.created_at) : NaN
        if (!Number.isFinite(at)) continue
        const tokens = Number(row.prompt_tokens || 0) + Number(row.completion_tokens || 0)
        const total = Number(row.total_tokens ?? tokens) || 0
        // Map tokens -> quota units roughly 1 token ≈ 1 quota unit for rolling windows (MVP).
        events.push({ at, quota: total, requests: 1 })
      }
      const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
      doc.usage[id] = { events: events.filter((e) => e.at >= cutoff), synced_at: nowIso() }
      write(doc)
      return doc.usage[id]
    },
    modelLimitsString(group) {
      const ids = group?.model_ids || []
      return ids.length ? ids.join(',') : ''
    },
  }
}

export { Q as GROUP_QUOTA_UNIT, DEFAULT_GROUPS, CREDIT_UNIT_INFO as GROUP_CREDIT_UNIT }
