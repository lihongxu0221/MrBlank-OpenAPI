/**
 * Upstream Grok / OpenAI accounts store (design §6.3).
 * Persisted at server/data/aily-accounts.json — separate from CPA auth-files.
 * Aily credentials stay in aily.js / .aily; this store is grok|openai only.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeModelRouting } from './ailyModelRouting.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const COMPAT_PLATFORMS = {
  grok: { label: 'Grok', defaultBase: 'https://api.x.ai/v1' },
  openai: { label: 'OpenAI', defaultBase: 'https://api.openai.com/v1' },
}

export function isCompatPlatform(p) {
  return !!COMPAT_PLATFORMS[String(p || '').toLowerCase()]
}

export function defaultCompatBase(p) {
  const key = String(p || '').toLowerCase()
  return (COMPAT_PLATFORMS[key] && COMPAT_PLATFORMS[key].defaultBase) || ''
}

export function parseOAuthSecret(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  if (!s.startsWith('{')) return { access_token: s }
  try {
    const j = JSON.parse(s)
    if (!j || typeof j !== 'object') return { access_token: s }
    return {
      access_token: String(j.access_token || j.access || j.api_key || '').trim(),
      refresh_token: String(j.refresh_token || j.refresh || '').trim(),
      account_id: String(j.account_id || j.accountId || j.chatgpt_account_id || '').trim(),
      email: String(j.email || '').trim(),
      expired: String(j.expired || j.expires || j.expires_at || '').trim(),
      last_refresh: String(j.last_refresh || '').trim(),
      type: String(j.type || '').trim(),
      id_token: String(j.id_token || '').trim(),
      issuer: String(j.issuer || '').trim(),
      client_id: String(j.client_id || '').trim(),
    }
  } catch {
    return { access_token: s }
  }
}

function normalizeOauth(a) {
  if (a && a.oauth && typeof a.oauth === 'object') {
    return {
      access_token: String(a.oauth.access_token || ''),
      refresh_token: String(a.oauth.refresh_token || ''),
      account_id: String(a.oauth.account_id || ''),
      email: String(a.oauth.email || ''),
      expired: String(a.oauth.expired || ''),
      last_refresh: String(a.oauth.last_refresh || ''),
      type: String(a.oauth.type || ''),
      id_token: String(a.oauth.id_token || ''),
      issuer: String(a.oauth.issuer || ''),
      client_id: String(a.oauth.client_id || ''),
    }
  }
  if (a && a.auth_type === 'oauth') {
    const parsed = parseOAuthSecret(a.api_key)
    if (parsed && (parsed.refresh_token || parsed.account_id || parsed.access_token)) return parsed
  }
  return null
}

function migrateAccount(a, idx) {
  if (!a || typeof a !== 'object') return null
  const platform = String(a.platform || '').trim().toLowerCase()
  if (!isCompatPlatform(platform)) return null
  const idNum = Number.parseInt(String(a.id), 10)
  const base_url = String(a.base_url || '')
  const def = defaultCompatBase(platform)
  return {
    id: Number.isFinite(idNum) && idNum > 0 ? idNum : idx + 1,
    platform,
    name: String(a.name || platform).slice(0, 40),
    remark: String(a.remark || '').slice(0, 200),
    auth_type: a.auth_type === 'oauth' ? 'oauth' : 'api_key',
    custom_upstream:
      a.custom_upstream != null
        ? !!a.custom_upstream
        : !!(base_url && def && base_url.replace(/\/+$/, '') !== def),
    enabled: a.enabled !== false,
    model_routing: normalizeModelRouting(a.model_routing),
    api_key: String(a.api_key || ''),
    oauth: normalizeOauth(a),
    base_url,
  }
}

function defaultPath() {
  return process.env.AILY_ACCOUNTS_PATH || path.join(__dirname, 'data', 'aily-accounts.json')
}

/**
 * @param {string} [filePath]
 */
export function createAilyAccountsStore(filePath = defaultPath()) {
  /** @type {ReturnType<typeof migrateAccount>[]} */
  let cache = null

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
      cache = arr.map(migrateAccount).filter(Boolean)
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
    const payload = { accounts, updated_at: new Date().toISOString() }
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

  function defaultName(platform, list) {
    const label = (COMPAT_PLATFORMS[platform] && COMPAT_PLATFORMS[platform].label) || platform
    const n = list.filter((x) => x.platform === platform).length
    return n ? `${label} ${n + 1}` : label
  }

  function publicAccount(a) {
    if (!a) return null
    const key = a.api_key || ''
    return {
      id: a.id,
      platform: a.platform,
      name: a.name,
      remark: a.remark || '',
      auth_type: a.auth_type === 'oauth' ? 'oauth' : 'api_key',
      custom_upstream: !!a.custom_upstream,
      enabled: a.enabled !== false,
      base_url: a.base_url || '',
      has_key: !!key,
      api_key_preview: key ? `${key.slice(0, 6)}...${key.slice(-4)}` : '',
      oauth_email: (a.oauth && a.oauth.email) || '',
      has_refresh: !!(a.oauth && a.oauth.refresh_token),
      model_routing: normalizeModelRouting(a.model_routing),
    }
  }

  function applyFields(a, fields) {
    if (!fields) return a
    if (fields.platform != null) {
      const p = String(fields.platform || '').trim().toLowerCase()
      if (!isCompatPlatform(p)) throw new Error('不支持的平台（仅 grok / openai）')
      a.platform = p
    }
    if (fields.name != null) a.name = String(fields.name).slice(0, 40)
    if (fields.remark != null) a.remark = String(fields.remark).slice(0, 200)
    if (fields.auth_type != null) a.auth_type = fields.auth_type === 'oauth' ? 'oauth' : 'api_key'
    if (fields.custom_upstream != null) a.custom_upstream = !!fields.custom_upstream
    if (fields.oauth && typeof fields.oauth === 'object') {
      a.oauth = normalizeOauth({ oauth: fields.oauth, auth_type: 'oauth' })
      if (a.oauth && a.oauth.access_token) a.api_key = a.oauth.access_token
      a.auth_type = 'oauth'
    }
    if (fields.api_key != null && String(fields.api_key).trim() !== '') {
      const parsed = parseOAuthSecret(fields.api_key)
      if (a.auth_type === 'oauth' || (parsed && (parsed.refresh_token || parsed.account_id))) {
        a.auth_type = 'oauth'
        a.oauth = { ...(a.oauth || {}), ...parsed }
        a.api_key = (parsed && parsed.access_token) || String(fields.api_key)
      } else {
        a.api_key = String(fields.api_key)
      }
    }
    if (fields.base_url != null) a.base_url = String(fields.base_url).trim()
    if (fields.enabled != null) a.enabled = !!fields.enabled
    if (fields.model_routing) a.model_routing = normalizeModelRouting(fields.model_routing)
    return a
  }

  return {
    filePath,
    COMPAT_PLATFORMS,
    isCompatPlatform,
    defaultCompatBase,
    loadAccounts: load,
    listPublic() {
      return load().map(publicAccount)
    },
    get(id) {
      const n = parseId(id)
      if (!n) return null
      return load().find((x) => x.id === n) || null
    },
    publicAccount,
    create(fields) {
      const p = String((fields && fields.platform) || '')
        .trim()
        .toLowerCase()
      if (!isCompatPlatform(p)) throw new Error('不支持的平台（仅 grok / openai）')
      const list = load()
      const a = {
        id: nextId(list),
        platform: p,
        name: String((fields && fields.name) || defaultName(p, list)).slice(0, 40),
        remark: String((fields && fields.remark) || '').slice(0, 200),
        auth_type: fields && fields.auth_type === 'oauth' ? 'oauth' : 'api_key',
        custom_upstream: !!(fields && fields.custom_upstream),
        enabled: !fields || fields.enabled !== false,
        model_routing: normalizeModelRouting(fields && fields.model_routing),
        api_key: '',
        oauth: null,
        base_url: String((fields && fields.base_url) || defaultCompatBase(p)).trim(),
      }
      applyFields(a, fields)
      list.push(a)
      save(list)
      return publicAccount(a)
    },
    update(id, fields) {
      const list = load()
      const n = parseId(id)
      const a = list.find((x) => x.id === n)
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
    setOauth(id, oauth) {
      const list = load()
      const a = list.find((x) => x.id === parseId(id))
      if (!a) throw new Error('账号不存在')
      a.auth_type = 'oauth'
      a.oauth = normalizeOauth({ oauth, auth_type: 'oauth' })
      if (a.oauth && a.oauth.access_token) a.api_key = a.oauth.access_token
      save(list)
      return publicAccount(a)
    },
    setRouting(id, routing) {
      const list = load()
      const a = list.find((x) => x.id === parseId(id))
      if (!a) throw new Error('账号不存在')
      a.model_routing = normalizeModelRouting(routing)
      save(list)
      return publicAccount(a)
    },
    reload() {
      cache = null
      return load()
    },
  }
}
