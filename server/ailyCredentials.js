/**
 * Multi-Aily account pool (dedicated store).
 * Path: server/data/aily-credentials.json — NOT aily-accounts.json (Grok/OpenAI).
 *
 * Load balance: AILY_LOAD_BALANCE_STRATEGY=round-robin (default).
 * Pick among enabled + not cooled-down; lower priority first; RR within same priority.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeAilyToken } from './aily.js'
import { acceptPublicHttpsUrl, assertPublicHttpsUrl } from './safeUrl.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const DEFAULT_COOLDOWN_MS = 60_000
export const REFRESH_FAIL_COOLDOWN_MS = 5 * 60_000
const DEFAULT_BASE = 'https://api.aily.pro'
const REGION_BASE = {
  CN: 'https://api.yiyu.pro',
  cn: 'https://api.yiyu.pro',
  EU: 'https://api.aily.pro',
  eu: 'https://api.aily.pro',
}

function defaultPath() {
  return process.env.AILY_CREDENTIALS_PATH || path.join(__dirname, 'data', 'aily-credentials.json')
}

export function maskToken(value) {
  const s = String(value || '')
  if (!s) return ''
  if (s.length <= 10) return '****'
  return `${s.slice(0, 4)}****${s.slice(-4)}`
}

function jwtPayload(token) {
  try {
    const part = String(token || '').split('.')[1]
    if (!part) return null
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const obj = JSON.parse(json)
    return obj && typeof obj === 'object' ? obj : null
  } catch {
    return null
  }
}

export function baseFromToken(token, fallback = DEFAULT_BASE) {
  const region = jwtPayload(token)?.region
  if (typeof region === 'string' && REGION_BASE[region]) return REGION_BASE[region]
  return fallback
}

export function nextRefreshFromToken(token) {
  try {
    const exp = Number(jwtPayload(token)?.exp)
    if (!Number.isFinite(exp) || exp <= 0) return null
    return new Date((exp - 300) * 1000).toISOString()
  } catch {
    return null
  }
}

function readJsonFile(filePath, fallback = {}) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

export function strategyFromEnv(env = process.env) {
  const raw = String(env.AILY_LOAD_BALANCE_STRATEGY || 'round-robin')
    .trim()
    .toLowerCase()
  if (raw === 'priority' || raw === 'first') return 'priority'
  return 'round-robin'
}

function normalizeAccount(a, idx = 0) {
  if (!a || typeof a !== 'object') return null
  const idNum = Number.parseInt(String(a.id), 10)
  const priority = Number.parseInt(String(a.priority ?? 100), 10)
  const concurrency =
    a.concurrency == null || a.concurrency === ''
      ? null
      : Number.parseInt(String(a.concurrency), 10)
  const access = normalizeAilyToken(a.access_token || '')
  const refresh = normalizeAilyToken(a.refresh_token || '')
  const base = String(a.aily_base_url || '')
    .trim()
    .replace(/\/+$/, '')
  return {
    id: Number.isFinite(idNum) && idNum > 0 ? idNum : idx + 1,
    name: String(a.name || a.email || `Aily ${idx + 1}`).slice(0, 60),
    email: String(a.email || '').slice(0, 120),
    remark: String(a.remark || '').slice(0, 200),
    enabled: a.enabled !== false,
    aily_base_url: base,
    access_token: access,
    refresh_token: refresh,
    updated_at: a.updated_at || null,
    priority: Number.isFinite(priority) ? priority : 100,
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : null,
    cooldown_until: a.cooldown_until || null,
    last_error: a.last_error ? String(a.last_error).slice(0, 300) : null,
    last_used_at: a.last_used_at || null,
  }
}

export function createAilyCredentialsStore(filePath = defaultPath(), opts = {}) {
  let cache = null
  let rrCursor = 0
  let strategy = opts.strategy || strategyFromEnv()

  function load() {
    if (cache) return cache
    try {
      if (!fs.existsSync(filePath)) {
        cache = []
        return cache
      }
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      const arr = Array.isArray(parsed?.accounts)
        ? parsed.accounts
        : Array.isArray(parsed)
          ? parsed
          : []
      cache = arr.map((a, i) => normalizeAccount(a, i)).filter(Boolean)
      return cache
    } catch {
      cache = []
      return cache
    }
  }

  function save(accounts) {
    cache = accounts
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const tmp = `${filePath}.${process.pid}.tmp`
    const payload = {
      accounts,
      strategy,
      updated_at: new Date().toISOString(),
    }
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
    fs.renameSync(tmp, filePath)
  }

  function nextId(list) {
    return list.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1
  }

  function parseId(id) {
    const n = Number.parseInt(String(id), 10)
    return Number.isFinite(n) && n > 0 ? n : 0
  }

  function publicAccount(a) {
    if (!a) return null
    const cooled =
      a.cooldown_until && Date.parse(a.cooldown_until) > Date.now() ? a.cooldown_until : null
    return {
      id: a.id,
      name: a.name,
      email: a.email || '',
      remark: a.remark || '',
      enabled: a.enabled !== false,
      aily_base_url: a.aily_base_url || '',
      has_access_token: !!a.access_token,
      has_refresh_token: !!a.refresh_token,
      access_preview: maskToken(a.access_token),
      refresh_preview: maskToken(a.refresh_token),
      updated_at: a.updated_at || null,
      priority: a.priority ?? 100,
      concurrency: a.concurrency,
      cooldown_until: cooled,
      last_error: a.last_error || null,
      last_used_at: a.last_used_at || null,
      next_refresh_at: nextRefreshFromToken(a.access_token),
      schedulable: isSchedulable(a),
    }
  }

  function isSchedulable(a) {
    if (!a || a.enabled === false) return false
    if (!a.access_token && !a.refresh_token) return false
    if (a.cooldown_until && Date.parse(a.cooldown_until) > Date.now()) return false
    return true
  }

  function resolveBase(a) {
    const fromAccount = acceptPublicHttpsUrl(a?.aily_base_url)
    if (fromAccount) return fromAccount
    const fromEnv = acceptPublicHttpsUrl(process.env.AILY_BASE_URL)
    if (fromEnv) return fromEnv
    return acceptPublicHttpsUrl(baseFromToken(a?.access_token, DEFAULT_BASE))
  }

  function applyFields(a, fields) {
    if (!fields) return a
    if (fields.name != null) a.name = String(fields.name).slice(0, 60)
    if (fields.email != null) a.email = String(fields.email).slice(0, 120)
    if (fields.remark != null) a.remark = String(fields.remark).slice(0, 200)
    if (fields.enabled != null) a.enabled = !!fields.enabled
    if (fields.aily_base_url != null) {
      const next = String(fields.aily_base_url || '').trim()
      a.aily_base_url = next ? assertPublicHttpsUrl(next) : ''
    }
    if (fields.access_token != null && String(fields.access_token).trim() !== '') {
      a.access_token = normalizeAilyToken(fields.access_token)
    }
    if (fields.refresh_token != null && String(fields.refresh_token).trim() !== '') {
      a.refresh_token = normalizeAilyToken(fields.refresh_token)
    }
    if (fields.clear_tokens) {
      a.access_token = ''
      a.refresh_token = ''
    }
    if (fields.priority != null) {
      const p = Number.parseInt(String(fields.priority), 10)
      if (Number.isFinite(p)) a.priority = p
    }
    if (fields.concurrency !== undefined) {
      if (fields.concurrency == null || fields.concurrency === '') a.concurrency = null
      else {
        const c = Number.parseInt(String(fields.concurrency), 10)
        a.concurrency = Number.isFinite(c) && c > 0 ? c : null
      }
    }
    if (fields.cooldown_until !== undefined) a.cooldown_until = fields.cooldown_until || null
    if (fields.last_error !== undefined) {
      a.last_error = fields.last_error ? String(fields.last_error).slice(0, 300) : null
    }
    a.updated_at = new Date().toISOString()
    return a
  }

  function migrateFromAuthFile(authFilePath) {
    const list = load()
    if (list.length > 0) {
      return { migrated: false, account: publicAccount(list[0]), reason: 'pool_not_empty' }
    }
    const auth = readJsonFile(authFilePath, {})
    const access = normalizeAilyToken(auth.access_token || '')
    const refresh = normalizeAilyToken(auth.refresh_token || '')
    if (!access && !refresh) {
      return { migrated: false, account: null, reason: 'no_tokens' }
    }
    const payload = jwtPayload(access) || {}
    let email = String(auth.email || payload.email || '').trim().slice(0, 120)
    // Ignore non-email junk (e.g. stringified JWT claims objects)
    if (email.startsWith('{') || email.includes(' ') || (email && !email.includes('@'))) {
      email = ''
    }
    const a = normalizeAccount(
      {
        id: 1,
        name: email || 'Aily #1',
        email,
        enabled: true,
        aily_base_url: String(auth.aily_base_url || '')
          .trim()
          .replace(/\/+$/, ''),
        access_token: access,
        refresh_token: refresh,
        updated_at: auth.updated_at || new Date().toISOString(),
        priority: 100,
        remark: 'migrated from .aily',
      },
      0,
    )
    list.push(a)
    save(list)
    return { migrated: true, account: publicAccount(a), reason: 'ok' }
  }

  function syncAccountToAuthFile(accountId, authFilePath) {
    if (!authFilePath) return false
    const a = get(accountId)
    if (!a || (!a.access_token && !a.refresh_token)) return false
    try {
      const prev = readJsonFile(authFilePath, {})
      const next = {
        ...prev,
        access_token: a.access_token || '',
        refresh_token: a.refresh_token || '',
        updated_at: a.updated_at || new Date().toISOString(),
      }
      if (a.email) next.email = a.email
      if (a.aily_base_url) next.aily_base_url = a.aily_base_url
      fs.mkdirSync(path.dirname(authFilePath), { recursive: true })
      fs.writeFileSync(authFilePath, JSON.stringify(next, null, 2), 'utf8')
      return true
    } catch {
      return false
    }
  }

  function get(id) {
    const n = parseId(id)
    if (!n) return null
    return load().find((x) => x.id === n) || null
  }

  function listSchedulable(opts = {}) {
    const exclude = new Set((opts.excludeIds || []).map((x) => Number(x)).filter(Boolean))
    return load()
      .filter((a) => isSchedulable(a) && !exclude.has(a.id))
      .sort((a, b) => {
        const pa = a.priority ?? 100
        const pb = b.priority ?? 100
        if (pa !== pb) return pa - pb
        return a.id - b.id
      })
  }

  function peekAilyAccount(pickOpts = {}) {
    const candidates = listSchedulable(pickOpts)
    if (!candidates.length) return null
    const topPriority = candidates[0].priority ?? 100
    const bucket = candidates.filter((a) => (a.priority ?? 100) === topPriority)
    if (!bucket.length) return null
    if (strategy === 'priority') return bucket[0]
    return bucket[rrCursor % bucket.length]
  }

  function pickAilyAccount(pickOpts = {}) {
    const candidates = listSchedulable(pickOpts)
    if (!candidates.length) return null
    const topPriority = candidates[0].priority ?? 100
    const bucket = candidates.filter((a) => (a.priority ?? 100) === topPriority)
    if (!bucket.length) return null
    let chosen
    if (strategy === 'priority') {
      chosen = bucket[0]
    } else {
      const idx = rrCursor % bucket.length
      rrCursor = (rrCursor + 1) % Math.max(bucket.length, 1)
      chosen = bucket[idx]
    }
    const list = load()
    const row = list.find((x) => x.id === chosen.id)
    if (row) row.last_used_at = new Date().toISOString()
    return row || chosen
  }

  function resetRoundRobin() {
    rrCursor = 0
  }

  function getRrCursor() {
    return rrCursor
  }

  function markUnschedulable(id, reason, cooldownMs = DEFAULT_COOLDOWN_MS) {
    const list = load()
    const a = list.find((x) => x.id === parseId(id))
    if (!a) return null
    const ms = Math.max(1000, Number(cooldownMs) || DEFAULT_COOLDOWN_MS)
    a.cooldown_until = new Date(Date.now() + ms).toISOString()
    a.last_error = reason ? String(reason).slice(0, 300) : a.last_error
    a.updated_at = new Date().toISOString()
    save(list)
    return publicAccount(a)
  }

  function clearCooldown(id) {
    const list = load()
    const a = list.find((x) => x.id === parseId(id))
    if (!a) return null
    a.cooldown_until = null
    a.last_error = null
    a.updated_at = new Date().toISOString()
    save(list)
    return publicAccount(a)
  }

  function setTokens(id, { access_token, refresh_token, email, aily_base_url } = {}) {
    const list = load()
    const a = list.find((x) => x.id === parseId(id))
    if (!a) throw new Error('账号不存在')
    if (access_token != null && String(access_token).trim() !== '') {
      a.access_token = normalizeAilyToken(access_token)
    }
    if (refresh_token != null && String(refresh_token).trim() !== '') {
      a.refresh_token = normalizeAilyToken(refresh_token)
    }
    if (email != null) a.email = String(email).slice(0, 120)
    if (aily_base_url != null) {
      const next = String(aily_base_url || '').trim()
      a.aily_base_url = next ? assertPublicHttpsUrl(next) : ''
    }
    a.cooldown_until = null
    a.last_error = null
    a.updated_at = new Date().toISOString()
    save(list)
    return publicAccount(a)
  }

  function poolMetrics() {
    const all = load()
    const enabled = all.filter((a) => a.enabled !== false)
    const schedulable = all.filter(isSchedulable)
    const cooled = all.filter(
      (a) => a.cooldown_until && Date.parse(a.cooldown_until) > Date.now(),
    )
    const disabled = all.filter((a) => a.enabled === false)
    const withToken = all.filter((a) => !!a.access_token)
    return {
      total: all.length,
      enabled: enabled.length,
      disabled: disabled.length,
      schedulable: schedulable.length,
      cooldown: cooled.length,
      with_token: withToken.length,
      strategy,
      strategy_env: process.env.AILY_LOAD_BALANCE_STRATEGY || 'round-robin',
    }
  }

  return {
    filePath,
    DEFAULT_COOLDOWN_MS,
    REFRESH_FAIL_COOLDOWN_MS,
    maskToken,
    strategyFromEnv,
    getStrategy: () => strategy,
    setStrategy(s) {
      const next = String(s || '')
        .trim()
        .toLowerCase()
      strategy = next === 'priority' || next === 'first' ? 'priority' : 'round-robin'
      return strategy
    },
    loadAccounts: load,
    listPublic() {
      return load().map(publicAccount)
    },
    get,
    publicAccount,
    resolveBase,
    isSchedulable,
    listSchedulable,
    pickAilyAccount,
    peekAilyAccount,
    resetRoundRobin,
    getRrCursor,
    markUnschedulable,
    clearCooldown,
    setTokens,
    poolMetrics,
    migrateFromAuthFile,
    syncAccountToAuthFile,
    create(fields) {
      const list = load()
      const a = normalizeAccount(
        {
          id: nextId(list),
          name: (fields && fields.name) || `Aily ${list.length + 1}`,
          email: (fields && fields.email) || '',
          remark: (fields && fields.remark) || '',
          enabled: !fields || fields.enabled !== false,
          aily_base_url: (fields && fields.aily_base_url) || '',
          access_token: (fields && fields.access_token) || '',
          refresh_token: (fields && fields.refresh_token) || '',
          priority: fields && fields.priority != null ? fields.priority : 100,
          concurrency: fields && fields.concurrency,
          updated_at: new Date().toISOString(),
        },
        list.length,
      )
      applyFields(a, fields)
      list.push(a)
      save(list)
      return publicAccount(a)
    },
    update(id, fields) {
      const list = load()
      const a = list.find((x) => x.id === parseId(id))
      if (!a) throw new Error('账号不存在')
      applyFields(a, fields)
      save(list)
      return publicAccount(a)
    },
    remove(id) {
      const list = load()
      const n = parseId(id)
      const i = list.findIndex((x) => x.id === n)
      if (i < 0) throw new Error('账号不存在')
      const removed = list.splice(i, 1)[0]
      save(list)
      return publicAccount(removed)
    },
    upsertTokens(id, tokens, { createIfMissing = true } = {}) {
      if (id) {
        const existing = get(id)
        if (existing) return setTokens(id, tokens)
        if (!createIfMissing) throw new Error('账号不存在')
      }
      return this.create({
        name: tokens.email || tokens.name || `Aily ${load().length + 1}`,
        email: tokens.email || '',
        access_token: tokens.access_token || '',
        refresh_token: tokens.refresh_token || '',
        aily_base_url: tokens.aily_base_url || '',
        enabled: true,
        priority: 100,
      })
    },
    reload() {
      cache = null
      return load()
    },
  }
}
