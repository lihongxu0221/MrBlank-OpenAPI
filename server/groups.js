/**
 * User groups (Linux.do / Discourse-inspired trust levels).
 * Persisted at server/data/user-groups.json.
 *
 * Credit / quota unit:
 *   - unit_version 2: rolling 5h / week / month quotas, model_quotas, promotion.min_used_quota
 *     and usage events are STORED as integer micro-points (mp, 1 点 = 1,000,000 mp) —
 *     independent of N (1 点 = N raw). Changing N never rescales them.
 *   - BFF /v1 records the points charged at call time (USD × 500000 ÷ N → mp) into these windows
 *   - Empty model_ids = all models; non-empty = allowlist (403 if violated)
 *   - model_quotas: per-model mp caps (0 or missing = unlimited); rolling 30d;
 *     pre-request soft check like window quotas (blocks when already exhausted; no mid-request clamp);
 *     hard governance — no site-credits overflow (D5)
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DEFAULT_QUOTA_PER_UNIT, POINT_MP, UNIT_VERSION, buildCreditUnitInfo } from './quotaUnit.js'

const Q = DEFAULT_QUOTA_PER_UNIT
/** 1 点 in stored units (mp). Defaults below are written in 点. */
const P = POINT_MP

/** Public description of the credit unit (API + docs). Prefer store.creditUnitInfo(). */
export const CREDIT_UNIT_INFO = buildCreditUnitInfo(Q)

const DEFAULT_GROUPS = [
  {
    id: 'newcomer',
    name: '新人',
    level: 1,
    description: '刚加入的探索者，可用基础模型与较小滚动额度。',
    quotas: { window_5h: 2 * P, week: 10 * P, month: 30 * P },
    model_ids: [],
    model_quotas: {},
    promotion: { min_account_days: 0, min_request_count: 0, min_used_quota: 0, min_checkins: 0 },
    enabled: true,
    sort_order: 10,
  },
  {
    id: 'basic',
    name: '基本用户',
    level: 2,
    description: '完成初步使用后的默认活跃档。',
    quotas: { window_5h: 5 * P, week: 25 * P, month: 80 * P },
    model_ids: [],
    model_quotas: {},
    promotion: { min_account_days: 3, min_request_count: 10, min_used_quota: 1 * P, min_checkins: 2 },
    enabled: true,
    sort_order: 20,
  },
  {
    id: 'member',
    name: '成员',
    level: 3,
    description: '稳定使用社区资源的成员。',
    quotas: { window_5h: 10 * P, week: 50 * P, month: 160 * P },
    model_ids: [],
    model_quotas: {},
    promotion: { min_account_days: 14, min_request_count: 50, min_used_quota: 5 * P, min_checkins: 7 },
    enabled: true,
    sort_order: 30,
  },
  {
    id: 'regular',
    name: '活跃用户',
    level: 4,
    description: '高频调用与长期签到的活跃探索者。',
    quotas: { window_5h: 20 * P, week: 100 * P, month: 320 * P },
    model_ids: [],
    model_quotas: {},
    promotion: { min_account_days: 45, min_request_count: 200, min_used_quota: 20 * P, min_checkins: 20 },
    enabled: true,
    sort_order: 40,
  },
  {
    id: 'leader',
    name: '老用户',
    level: 5,
    description: '高信任档；额度更高。信任分/社区声望等规则预留扩展。',
    quotas: { window_5h: 40 * P, week: 200 * P, month: 600 * P },
    model_ids: [],
    model_quotas: {},
    promotion: { min_account_days: 90, min_request_count: 500, min_used_quota: 50 * P, min_checkins: 40 },
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
    min_used_quota: Math.max(0, Math.round(Number(p.min_used_quota) || 0)),
    min_checkins: Math.max(0, Number(p.min_checkins) || 0),
    // Placeholders for future Linux.do-like trust rules (not enforced yet):
    // min_trust_level, min_likes_received, min_topics_entered, min_posts_read
    notes: String(p.notes || ''),
  }
}

function normalizeModelQuotas(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw)) {
    const id = String(k || '').trim()
    if (!id) continue
    const n = Number(v)
    out[id] = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0
  }
  return out
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
      window_5h: Math.max(0, Math.round(Number(quotas.window_5h ?? quotas['5h'] ?? 2 * P) || 0)),
      week: Math.max(0, Math.round(Number(quotas.week) || 0)),
      month: Math.max(0, Math.round(Number(quotas.month) || 0)),
    },
    model_ids,
    model_quotas: normalizeModelQuotas(raw?.model_quotas),
    promotion: normalizePromotion(raw?.promotion),
    enabled: raw?.enabled !== false,
    sort_order: Number.isFinite(Number(raw?.sort_order)) ? Number(raw.sort_order) : (index + 1) * 10,
  }
}

function defaultDoc() {
  return {
    unit_version: UNIT_VERSION,
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
    // Missing unit_version = legacy raw-unit file (v1); write() refuses to stamp it.
    unit_version: Number(raw?.unit_version) || 1,
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

export function createGroupStore(filePath, { quotaUnit = Q, getQuotaUnit } = {}) {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const resolveUnit = () => {
    if (typeof getQuotaUnit === 'function') {
      const n = Number(getQuotaUnit())
      if (Number.isFinite(n) && n > 0) return n
    }
    return quotaUnit || Q
  }
  const unit = resolveUnit()

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
    if (normalized.unit_version !== UNIT_VERSION) {
      throw Object.assign(new Error('user-groups.json is legacy (raw units); run server/scripts/migrate-points-unit.js'), {
        status: 503,
      })
    }
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

  /** Per-model usage in rolling window (default month = 30d). */
  function usedForModel(doc, userId, modelId, kind = 'month') {
    const mid = String(modelId || '').trim()
    if (!mid) return 0
    const u = doc.usage[String(userId)] || { events: [] }
    const events = pruneUsage(u.events, kind)
    return events.reduce((sum, e) => {
      if (String(e.model || '').trim() !== mid) return sum
      return sum + (Number(e.quota) || 0)
    }, 0)
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

    /**
     * Merge orphan membership keys (e.g. username typed as id) into canonical userId.
     * Prefers an override assignment when the canonical row has none.
     */
    mergeAlias(canonicalUserId, aliasUserId) {
      const doc = read()
      const id = String(canonicalUserId)
      const alias = String(aliasUserId || '')
      if (!alias || alias === id || !doc.members[alias]) {
        return doc.members[id] ? { user_id: id, ...doc.members[id] } : null
      }
      const orphan = doc.members[alias]
      const mem = ensureMember(doc, id)
      if (orphan.override && !mem.override) {
        mem.group_id = orphan.group_id
        mem.override = true
        mem.assigned_at = orphan.assigned_at || nowIso()
      } else if (orphan.override && mem.override) {
        if (String(orphan.assigned_at || '') > String(mem.assigned_at || '')) {
          mem.group_id = orphan.group_id
          mem.assigned_at = orphan.assigned_at
        }
      }
      if (orphan.joined_at && (!mem.joined_at || orphan.joined_at < mem.joined_at)) {
        mem.joined_at = orphan.joined_at
      }
      if (doc.usage[alias]?.events?.length) {
        if (!doc.usage[id]) doc.usage[id] = { events: [] }
        doc.usage[id].events.push(...doc.usage[alias].events)
        delete doc.usage[alias]
      }
      delete doc.members[alias]
      write(doc)
      return { user_id: id, ...mem }
    },

    /** Absorb username / alternate keys into one membership row (single source of truth). */
    absorbAliases(canonicalUserId, aliasUserIds = []) {
      let last = null
      for (const a of aliasUserIds || []) {
        last = this.mergeAlias(canonicalUserId, a) || last
      }
      return last
    },

    assignMember(userId, { group_id, override = true, merge_from = [] } = {}) {
      const id = String(userId)
      if (Array.isArray(merge_from) && merge_from.length) {
        this.absorbAliases(id, merge_from)
      }
      const doc = read()
      const mem = ensureMember(doc, id)
      if (group_id) {
        if (!findGroup(doc, group_id)) throw new Error('用户组不存在')
        mem.group_id = group_id
      }
      mem.override = !!override
      mem.assigned_at = nowIso()
      write(doc)
      return { user_id: id, ...mem }
    },

    ensureUser(userId, { joinedAt } = {}) {
      const doc = read()
      ensureMember(doc, userId, { joinedAt })
      write(doc)
    },

    recordUsage(userId, { quota = 0, requests = 0, model = '' } = {}) {
      const doc = read()
      const id = String(userId)
      if (!doc.usage[id]) doc.usage[id] = { events: [] }
      const q = Math.max(0, Number(quota) || 0)
      const r = Math.max(0, Number(requests) || 0)
      const mid = String(model || '').trim()
      if (q || r) {
        const ev = { at: Date.now(), quota: q, requests: r }
        if (mid) ev.model = mid
        doc.usage[id].events.push(ev)
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
    resolveUserGroup(userId, metrics = {}, { aliasKeys = [] } = {}) {
      if (Array.isArray(aliasKeys) && aliasKeys.length) {
        this.absorbAliases(userId, aliasKeys)
      }
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
        quota_unit: resolveUnit(),
        credit_unit: buildCreditUnitInfo(resolveUnit()),
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

    /**
     * Per-model hard cap (rolling 30d / month window). 0 or missing = unlimited.
     * Pre-request soft check like window quotas: denies when used >= limit already;
     * does not clamp mid-request. Does NOT allow site-credits overflow (D5).
     */
    assertModelQuota(userId, group, modelId) {
      const mid = String(modelId || '').trim()
      if (!mid) return { ok: true }
      const limitRaw = group?.model_quotas?.[mid]
      if (limitRaw == null) return { ok: true }
      const limit = Math.max(0, Number(limitRaw) || 0)
      if (limit <= 0) return { ok: true, unlimited: true, model: mid }
      const doc = read()
      const used = usedForModel(doc, userId, mid, 'month')
      if (used >= limit) {
        return {
          ok: false,
          code: 'model_quota_exhausted',
          model: mid,
          used,
          limit,
          remaining: 0,
          message: `模型「${mid}」本月（滚动 30 日）额度已用尽。`,
        }
      }
      return { ok: true, model: mid, used, limit, remaining: Math.max(0, limit - used) }
    },

    usedForModel(userId, modelId, kind = 'month') {
      return usedForModel(read(), userId, modelId, kind)
    },

    /** Patch one group's model_ids + model_quotas (admin group-models tab). */
    updateGroupModels(groupId, { model_ids, model_quotas } = {}) {
      const doc = read()
      const g = findGroup(doc, groupId)
      if (!g) throw new Error('用户组不存在')
      if (model_ids !== undefined) {
        g.model_ids = Array.isArray(model_ids)
          ? model_ids.map((s) => String(s).trim()).filter(Boolean)
          : String(model_ids || '')
              .split(/[,，\s]+/)
              .map((s) => s.trim())
              .filter(Boolean)
      }
      if (model_quotas !== undefined) {
        g.model_quotas = normalizeModelQuotas(model_quotas)
      }
      const idx = doc.groups.findIndex((x) => x.id === g.id)
      doc.groups[idx] = normalizeGroup(g, idx)
      write(doc)
      return doc.groups[idx]
    },

    /**
     * Effective allowlist = group.model_ids ∩ key model_limits (stricter).
     * Empty side means unrestricted on that side.
     */
    effectiveModelAllowlist(group, keyModelLimits) {
      const groupIds = group?.model_ids || []
      const keyIds = Array.isArray(keyModelLimits)
        ? keyModelLimits.map((s) => String(s).trim()).filter(Boolean)
        : String(keyModelLimits || '')
            .split(/[,，\s]+/)
            .map((s) => s.trim())
            .filter(Boolean)
      if (!groupIds.length && !keyIds.length) return []
      if (!groupIds.length) return keyIds
      if (!keyIds.length) return groupIds.slice()
      const keySet = new Set(keyIds.map(String))
      return groupIds.filter((id) => keySet.has(String(id)))
    },

    assertKeyModelAllowed(keyModelLimits, modelId) {
      const keyIds = Array.isArray(keyModelLimits)
        ? keyModelLimits.map((s) => String(s).trim()).filter(Boolean)
        : String(keyModelLimits || '')
            .split(/[,，\s]+/)
            .map((s) => s.trim())
            .filter(Boolean)
      if (!keyIds.length) return { ok: true }
      const mid = String(modelId || '').trim()
      if (!mid) return { ok: true }
      if (keyIds.map(String).includes(mid)) return { ok: true }
      return {
        ok: false,
        message: `模型「${mid}」不在此 API Key 的模型限制内。`,
        code: 'key_model_not_allowed',
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
        // DEPRECATED (not called by the BFF): legacy MVP mapped 1 token ≈ 1 unit. Kept for tests only;
        // live usage events are recorded in mp via recordUsage().
        const mid = String(row.model || row.model_name || '').trim()
        const ev = { at, quota: total, requests: 1 }
        if (mid) ev.model = mid
        events.push(ev)
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

export { Q as GROUP_QUOTA_UNIT, DEFAULT_GROUPS, CREDIT_UNIT_INFO as GROUP_CREDIT_UNIT, buildCreditUnitInfo }
