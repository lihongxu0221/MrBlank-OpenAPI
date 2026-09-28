import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/** new-api / aily-compatible raw quota scale (display 点 are converted by the UI). */
export const QUOTA_PER_USD = 500_000

const STATUS_ENABLED = 1
const STATUS_DISABLED = 2
const STATUS_EXPIRED = 3
const STATUS_EXHAUSTED = 4

const DISPLAY_RATE_WINDOWS = [
  { id: '5h', field: 'rate_limit_5h', sec: 5 * 3600, label: '5h' },
  { id: 'week', field: 'rate_limit_7d', sec: 7 * 24 * 3600, label: '周' },
  { id: 'month', field: 'rate_limit_30d', sec: 30 * 24 * 3600, label: '月' },
]

const RATE_WINDOWS_CHECK = [
  ['rate_limit_5h', 5 * 3600, '5小时'],
  ['rate_limit_1d', 24 * 3600, '日'],
  ['rate_limit_7d', 7 * 24 * 3600, '周'],
  ['rate_limit_30d', 30 * 24 * 3600, '月'],
]

const SPEND_KEEP_SEC = 31 * 24 * 3600

function nowSec() {
  return Math.floor(Date.now() / 1000)
}

export function quotaLimit(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export const usdLimit = quotaLimit

export function maskKey(key) {
  const k = String(key || '')
  if (k.length <= 8) return '****'
  return k.slice(0, 4) + '**********' + k.slice(-4)
}

function pruneSpendLog(log, now = nowSec()) {
  const cutoff = now - SPEND_KEEP_SEC
  return (Array.isArray(log) ? log : []).filter((e) => Number(e?.sec) >= cutoff)
}

function migrateToken(t) {
  if (!t || typeof t !== 'object') return null
  let status = STATUS_ENABLED
  if (t.status === 'disabled' || t.status === 2) status = STATUS_DISABLED
  else if (t.status === 'expired' || t.status === 3) status = STATUS_EXPIRED
  else if (t.status === 'exhausted' || t.status === 4) status = STATUS_EXHAUSTED
  else if (t.status === 'enabled' || t.status === 1 || t.status == null) status = STATUS_ENABLED
  else status = Number(t.status) || STATUS_ENABLED

  const unlimited =
    t.unlimited_quota === true || t.remain_quota === -1 || t.unlimited === true
  const created =
    t.created_time ||
    (t.created_at ? Math.floor(Date.parse(t.created_at) / 1000) : nowSec())
  const accessed =
    t.accessed_time ||
    (t.accessed_at ? Math.floor(Date.parse(t.accessed_at) / 1000) : 0)

  return {
    id: Number(t.id) || 0,
    name: String(t.name || 'key').slice(0, 50),
    key: t.key || (t.fullKey ? maskKey(t.fullKey) : ''),
    fullKey: t.fullKey || '',
    status,
    created_time: Number.isFinite(created) ? created : nowSec(),
    created_at: t.created_at || new Date((Number.isFinite(created) ? created : nowSec()) * 1000).toISOString(),
    accessed_time: Number.isFinite(accessed) ? accessed : 0,
    last_accessed_time: Number(t.last_accessed_time) || 0,
    expired_time: t.expired_time == null ? -1 : Number(t.expired_time),
    remain_quota: unlimited ? 0 : Math.max(0, Number(t.remain_quota) || 0),
    unlimited_quota: unlimited,
    used_quota: Number(t.used_quota) || 0,
    used_amount: Number(t.used_amount) || 0,
    max_concurrency: Math.max(0, Number(t.max_concurrency) || 0),
    rate_limit_enabled: t.rate_limit_enabled === true,
    rate_limit_5h: quotaLimit(t.rate_limit_5h),
    rate_limit_1d: quotaLimit(t.rate_limit_1d),
    rate_limit_7d: quotaLimit(t.rate_limit_7d),
    rate_limit_30d: quotaLimit(t.rate_limit_30d),
    rate_limit_reset_at: Math.max(0, Number(t.rate_limit_reset_at) || 0),
    spend_log: pruneSpendLog(t.spend_log),
    model_limits: t.model_limits != null ? String(t.model_limits) : '',
    access_group_id: t.access_group_id != null ? t.access_group_id : 1,
    group: t.group != null ? String(t.group) : 'default',
  }
}

function rateWindowSince(token, sec, now) {
  const start = now - sec
  const resetAt = Number(token?.rate_limit_reset_at) || 0
  if (!resetAt) return start
  return Math.max(start, resetAt + 1)
}

function tokenSpendSince(token, sinceSec) {
  const since = Number(sinceSec) || 0
  let sum = 0
  for (const e of token?.spend_log || []) {
    if (Number(e.sec) >= since) sum += Number(e.amount) || 0
  }
  return sum
}

function attachRateWindows(token) {
  if (!token || !token.rate_limit_enabled) return []
  const now = nowSec()
  return DISPLAY_RATE_WINDOWS.map((w) => {
    const cap = quotaLimit(token[w.field])
    const since = rateWindowSince(token, w.sec, now)
    const used = tokenSpendSince(token, since)
    const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 1000) / 10) : 0
    return { id: w.id, label: w.label, used, cap, pct }
  })
}

/**
 * Public token view (never includes fullKey unless revealFullKey).
 */
export function publicToken(t, revealFullKey = false) {
  if (!t) return null
  const m = migrateToken(t)
  return {
    id: m.id,
    key: revealFullKey && m.fullKey ? m.fullKey : maskKey(m.fullKey || m.key),
    status: m.status,
    name: m.name,
    created_time: m.created_time,
    accessed_time: m.accessed_time,
    last_accessed_time: m.last_accessed_time || 0,
    expired_time: m.expired_time,
    remain_quota: m.remain_quota,
    unlimited_quota: m.unlimited_quota,
    used_quota: m.used_quota,
    used_amount: m.used_amount || 0,
    max_concurrency: m.max_concurrency || 0,
    rate_limit_enabled: !!m.rate_limit_enabled,
    rate_limit_5h: m.rate_limit_5h || 0,
    rate_limit_1d: m.rate_limit_1d || 0,
    rate_limit_7d: m.rate_limit_7d || 0,
    rate_limit_30d: m.rate_limit_30d || 0,
    rate_limit_reset_at: m.rate_limit_reset_at || 0,
    rate_windows: attachRateWindows(m),
    model_limits: m.model_limits,
    access_group_id: m.access_group_id,
    group: m.group,
    created_at: m.created_at,
  }
}

/**
 * Disk-backed map: linux.do user id -> { tokens: [...], nextId, profile? }
 * Token records keep fullKey server-side only.
 */
export function createUserKeyStore(filePath) {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })

  /** @type {Map<number, number>} tokenId -> inflight count (process-local) */
  const inflightByToken = new Map()

  function readAll() {
    if (!fs.existsSync(filePath)) return { users: {} }
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      return raw && typeof raw === 'object' ? raw : { users: {} }
    } catch {
      return { users: {} }
    }
  }

  function writeAll(data) {
    const tmp = `${filePath}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, filePath)
    try {
      fs.chmodSync(filePath, 0o600)
    } catch {
      /* ignore */
    }
  }

  function ensureUser(data, userId) {
    const id = String(userId)
    if (!data.users) data.users = {}
    if (!data.users[id]) data.users[id] = { tokens: [], nextId: 1 }
    if (!Array.isArray(data.users[id].tokens)) data.users[id].tokens = []
    if (!data.users[id].nextId) data.users[id].nextId = 1
    return data.users[id]
  }

  function listRaw(userId) {
    const data = readAll()
    return ensureUser(data, userId).tokens.map(migrateToken).filter(Boolean)
  }

  function getRaw(userId, tokenId) {
    return listRaw(userId).find((t) => t.id === Number(tokenId)) || null
  }

  function applyPatch(rec, patch, statusOnly) {
    if (statusOnly) {
      const next = Number(patch.status)
      if (next === STATUS_ENABLED) {
        if (rec.status === STATUS_EXPIRED && rec.expired_time !== -1 && rec.expired_time <= nowSec()) {
          throw new Error('已过期的令牌无法启用')
        }
        if (rec.status === STATUS_EXHAUSTED && !rec.unlimited_quota && rec.remain_quota <= 0) {
          throw new Error('额度已用尽的令牌无法启用')
        }
      }
      rec.status = next
      return rec
    }
    if (patch.name != null) rec.name = String(patch.name).trim().slice(0, 50) || rec.name
    if (patch.expired_time != null) rec.expired_time = Number(patch.expired_time)
    if (patch.unlimited_quota != null) rec.unlimited_quota = !!patch.unlimited_quota
    if (patch.remain_quota != null && !rec.unlimited_quota) {
      rec.remain_quota = Math.max(0, Number(patch.remain_quota) || 0)
    }
    if (rec.unlimited_quota) rec.remain_quota = 0
    if (patch.status != null) rec.status = Number(patch.status)
    if (patch.enabled === true) rec.status = STATUS_ENABLED
    if (patch.enabled === false) rec.status = STATUS_DISABLED
    if (patch.max_concurrency != null) rec.max_concurrency = Math.max(0, Number(patch.max_concurrency) || 0)
    if (patch.rate_limit_enabled != null) rec.rate_limit_enabled = !!patch.rate_limit_enabled
    if (patch.rate_limit_5h != null) rec.rate_limit_5h = quotaLimit(patch.rate_limit_5h)
    if (patch.rate_limit_1d != null) rec.rate_limit_1d = quotaLimit(patch.rate_limit_1d)
    if (patch.rate_limit_7d != null) rec.rate_limit_7d = quotaLimit(patch.rate_limit_7d)
    if (patch.rate_limit_30d != null) rec.rate_limit_30d = quotaLimit(patch.rate_limit_30d)
    if (patch.reset_rate_limit_usage === true) rec.rate_limit_reset_at = nowSec()
    if (patch.model_limits != null) rec.model_limits = String(patch.model_limits)
    if (patch.group != null) rec.group = String(patch.group)
    if (patch.access_group_id != null) rec.access_group_id = patch.access_group_id
    // Auto-recover exhausted if quota topped up
    if (
      rec.status === STATUS_EXHAUSTED &&
      (rec.unlimited_quota || rec.remain_quota > 0)
    ) {
      rec.status = STATUS_ENABLED
    }
    return rec
  }

  return {
    QUOTA_PER_USD,
    list(userId) {
      return listRaw(userId)
    },
    listPublic(userId) {
      return listRaw(userId).map((t) => publicToken(t, false))
    },
    get(userId, tokenId) {
      return getRaw(userId, tokenId)
    },
    getPublic(userId, tokenId, revealFullKey = false) {
      const t = getRaw(userId, tokenId)
      return t ? publicToken(t, revealFullKey) : null
    },
    create(userId, token) {
      const data = readAll()
      const u = ensureUser(data, userId)
      const id = u.nextId++
      const unlimited = token?.unlimited_quota !== false
      const now = nowSec()
      const fullKey = token.fullKey || ''
      const item = migrateToken({
        id,
        name: String(token?.name || 'key').trim().slice(0, 50) || 'key',
        key: maskKey(fullKey),
        fullKey,
        status:
          token?.enabled === false || token?.status === STATUS_DISABLED
            ? STATUS_DISABLED
            : STATUS_ENABLED,
        created_time: now,
        created_at: new Date(now * 1000).toISOString(),
        accessed_time: 0,
        last_accessed_time: 0,
        expired_time:
          token?.expired_time == null || token.expired_time === ''
            ? -1
            : Number(token.expired_time),
        remain_quota: unlimited ? 0 : Math.max(0, Number(token?.remain_quota) || 0),
        unlimited_quota: unlimited,
        used_quota: 0,
        used_amount: 0,
        max_concurrency: Math.max(0, Number(token?.max_concurrency) || 0),
        rate_limit_enabled: token?.rate_limit_enabled === true,
        rate_limit_5h: quotaLimit(token?.rate_limit_5h),
        rate_limit_1d: quotaLimit(token?.rate_limit_1d),
        rate_limit_7d: quotaLimit(token?.rate_limit_7d),
        rate_limit_30d: quotaLimit(token?.rate_limit_30d),
        rate_limit_reset_at: 0,
        spend_log: [],
        model_limits: token?.model_limits != null ? String(token.model_limits) : '',
        access_group_id: token?.access_group_id != null ? token.access_group_id : 1,
        group: token?.group != null ? String(token.group) : 'default',
      })
      u.tokens.unshift(item)
      writeAll(data)
      return item
    },
    update(userId, tokenId, patch, statusOnly = false) {
      const data = readAll()
      const u = ensureUser(data, userId)
      const idx = u.tokens.findIndex((x) => x.id === Number(tokenId))
      if (idx < 0) return null
      const rec = migrateToken(u.tokens[idx])
      applyPatch(rec, patch || {}, statusOnly)
      if (rec.fullKey) rec.key = maskKey(rec.fullKey)
      u.tokens[idx] = rec
      writeAll(data)
      return rec
    },
    remove(userId, tokenId) {
      const data = readAll()
      const u = ensureUser(data, userId)
      const i = u.tokens.findIndex((x) => x.id === Number(tokenId))
      if (i < 0) return null
      const [removed] = u.tokens.splice(i, 1)
      writeAll(data)
      return removed
    },
    allFullKeys() {
      const data = readAll()
      const keys = []
      for (const u of Object.values(data.users || {})) {
        for (const t of u.tokens || []) {
          if (t.fullKey) keys.push(t.fullKey)
        }
      }
      return keys
    },
    setProfile(userId, profile = {}) {
      const data = readAll()
      const u = ensureUser(data, userId)
      const prev = u.profile || {}
      u.profile = {
        ...prev,
        display_name: profile.display_name || prev.display_name || '',
        username: profile.username || prev.username || '',
        email: profile.email || prev.email || '',
        created_at: prev.created_at || profile.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      writeAll(data)
      return u.profile
    },
    getProfile(userId) {
      const data = readAll()
      const u = data.users?.[String(userId)]
      return u?.profile || null
    },
    hashToUserMap() {
      const data = readAll()
      /** @type {Map<string, { userId: string, display_name: string, username: string }>} */
      const map = new Map()
      for (const [userId, u] of Object.entries(data.users || {})) {
        const display_name = u.profile?.display_name || ''
        const username = u.profile?.username || ''
        for (const t of u.tokens || []) {
          if (!t.fullKey) continue
          const h = crypto.createHash('sha256').update(String(t.fullKey)).digest('hex')
          map.set(h, { userId, display_name, username })
        }
      }
      return map
    },
    /**
     * Resolve site user by raw API key (Bearer value).
     * Returns null for unknown keys. Disabled keys still resolve so caller can 401.
     */
    findByApiKey(apiKey, { includeDisabled = false } = {}) {
      const key = String(apiKey || '')
        .replace(/^Bearer\s+/i, '')
        .trim()
      if (!key) return null
      const data = readAll()
      for (const [userId, u] of Object.entries(data.users || {})) {
        for (const raw of u.tokens || []) {
          const t = migrateToken(raw)
          if (!t?.fullKey || t.fullKey !== key) continue
          if (!includeDisabled && Number(t.status) === STATUS_DISABLED) continue
          return {
            userId: String(userId),
            token: t,
            profile: u.profile || null,
          }
        }
      }
      return null
    },

    /**
     * Validate site-issued key for /v1 (status / expiry / remain_quota).
     * Mutates token status on disk when expired/exhausted detected.
     */
    validateSiteKey(apiKey) {
      const owner = this.findByApiKey(apiKey, { includeDisabled: true })
      if (!owner?.token) return { error: '无效的 API Key', code: 401 }
      const t = owner.token
      if (t.status === STATUS_DISABLED) {
        return { error: '该 API Key 不可用', code: 401, owner }
      }
      if (t.expired_time !== -1 && t.expired_time < nowSec()) {
        this.update(owner.userId, t.id, { status: STATUS_EXPIRED }, true)
        return { error: '该 API Key 已过期', code: 401, owner }
      }
      if (!t.unlimited_quota && t.remain_quota <= 0) {
        this.update(owner.userId, t.id, { status: STATUS_EXHAUSTED }, true)
        return { error: '额度已用尽', code: 429, owner }
      }
      // touch last_accessed (best-effort, non-blocking for hot path)
      try {
        const data = readAll()
        const u = ensureUser(data, owner.userId)
        const rec = u.tokens.find((x) => x.id === t.id)
        if (rec) {
          const now = nowSec()
          if ((Number(rec.last_accessed_time) || 0) !== now) {
            rec.last_accessed_time = now
            writeAll(data)
          }
        }
      } catch {
        /* ignore */
      }
      return { owner: { ...owner, token: this.get(owner.userId, t.id) || t } }
    },

    checkRateLimit(token) {
      if (!token || !token.rate_limit_enabled) return null
      const now = nowSec()
      for (const [field, sec, label] of RATE_WINDOWS_CHECK) {
        const cap = quotaLimit(token[field])
        if (!cap) continue
        if (tokenSpendSince(token, rateWindowSince(token, sec, now)) >= cap) {
          return { error: `该 API Key 已达到${label}限额`, code: 429 }
        }
      }
      return null
    },

    /**
     * @returns {(() => void)|null} release fn, or null if over limit
     */
    beginConcurrency(token) {
      const max = Math.max(0, Number(token?.max_concurrency) || 0)
      if (!max) return () => {}
      const id = Number(token.id) || 0
      const n = (inflightByToken.get(id) || 0) + 1
      if (n > max) return null
      inflightByToken.set(id, n)
      let done = false
      return () => {
        if (done) return
        done = true
        const cur = (inflightByToken.get(id) || 1) - 1
        if (cur <= 0) inflightByToken.delete(id)
        else inflightByToken.set(id, cur)
      }
    },

    /**
     * Deduct key quota / record raw point-window usage.
     */
    consumeQuota(userId, tokenId, quota, amount) {
      const data = readAll()
      const u = ensureUser(data, userId)
      const rec = u.tokens.find((x) => x.id === Number(tokenId))
      if (!rec) return null
      const t = migrateToken(rec)
      const q = Math.max(0, Number(quota) || 0)
      const am = Number(amount) || 0
      t.used_quota = (t.used_quota || 0) + q
      t.used_amount = (t.used_amount || 0) + am
      t.accessed_time = nowSec()
      t.spend_log = pruneSpendLog([...(t.spend_log || []), { sec: nowSec(), amount: q }])
      if (!t.unlimited_quota) {
        t.remain_quota = Math.max(0, (t.remain_quota || 0) - q)
        if (t.remain_quota <= 0) t.status = STATUS_EXHAUSTED
      }
      if (t.fullKey) t.key = maskKey(t.fullKey)
      Object.assign(rec, t)
      writeAll(data)
      return t
    },

    /** Test helper */
    _inflightSize() {
      return inflightByToken.size
    },
  }
}

export {
  STATUS_ENABLED,
  STATUS_DISABLED,
  STATUS_EXPIRED,
  STATUS_EXHAUSTED,
  publicToken as toPublicToken,
}
