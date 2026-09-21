/**
 * Phase D — Aily upstream credential management + in-process OpenAI bridge.
 *
 * Prefer CPA as /v1 source of truth. This module:
 *  - manages the shared Aily auth file (.aily)
 *  - talks to Aily upstream (api.yiyu.pro / api.aily.pro) for login/refresh/test
 *  - embeds OpenAI-compatible access (listModels / chat) via createAilyUpstream
 *  - AILY_ADAPTER_URL / AILY_ADAPTER_API_KEY are legacy no-ops (separate :8088 optional)
 *
 * Site login NEVER uses this module.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_AILY_BASE = 'https://api.aily.pro'
const REGION_BASE = {
  CN: 'https://api.yiyu.pro',
  cn: 'https://api.yiyu.pro',
  EU: 'https://api.aily.pro',
  eu: 'https://api.aily.pro',
}

function readJsonFile(filePath, fallback = {}) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

export function normalizeAilyToken(s) {
  if (s == null) return ''
  let t = String(s).replace(/^\uFEFF/, '').trim()
  t = t.replace(/^Bearer\s+/i, '').trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim()
  }
  return t.replace(/\s+/g, '')
}

function maskToken(value) {
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

function ailyBaseFromToken(token, fallback = DEFAULT_AILY_BASE) {
  const region = jwtPayload(token)?.region
  if (typeof region === 'string' && REGION_BASE[region]) return REGION_BASE[region]
  return fallback
}

function readSecretFile(filePath) {
  if (!filePath) return ''
  try {
    return fs.readFileSync(filePath, 'utf8').trim()
  } catch {
    return ''
  }
}

export function loadAilyConfig(env = process.env) {
  const authFile =
    env.AILY_AUTH_FILE ||
    path.join(env.HOME || '/home/ubuntu', '.config/aily-project/.aily')
  const adminConfigFile =
    env.AILY_ADMIN_CONFIG_FILE || path.join(path.dirname(authFile), 'admin.json')
  const adapterUrl = (env.AILY_ADAPTER_URL || '').trim().replace(/\/$/, '')
  const adapterApiKey =
    env.AILY_ADAPTER_API_KEY || readSecretFile(env.AILY_ADAPTER_API_KEY_FILE) || ''
  const adminUser = (env.AILY_ADAPTER_ADMIN_USER || '').trim()
  const adminPassword =
    env.AILY_ADAPTER_ADMIN_PASSWORD || readSecretFile(env.AILY_ADAPTER_ADMIN_PASSWORD_FILE) || ''
  const modelRoutes = String(env.AILY_MODEL_ROUTES || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  return {
    authFile,
    adminConfigFile,
    adapterUrl,
    adapterApiKey,
    adminUser,
    adminPassword,
    modelRoutes,
    envBase: (env.AILY_BASE_URL || '').trim().replace(/\/+$/, ''),
  }
}

/** Parse AILY_MODEL_ROUTES patterns: exact id, or prefix* / prefix-* */
export function modelMatchesAilyRoute(model, patterns) {
  const m = String(model || '').trim()
  if (!m || !Array.isArray(patterns) || !patterns.length) return false
  for (const raw of patterns) {
    const p = String(raw || '').trim()
    if (!p) continue
    if (p.endsWith('*')) {
      const prefix = p.slice(0, -1)
      if (m.startsWith(prefix)) return true
    } else if (m === p) return true
  }
  return false
}

export function createAilyManager(cfg = loadAilyConfig()) {
  let adminCookie = ''
  let adminCookieAt = 0

  function readAuth() {
    return readJsonFile(cfg.authFile, {})
  }

  function readAdminCfg() {
    return readJsonFile(cfg.adminConfigFile, {})
  }

  function getUpstreamBase(auth = readAuth()) {
    if (cfg.envBase) return cfg.envBase
    const fromCfg = String(readAdminCfg().aily_base_url || '')
      .trim()
      .replace(/\/+$/, '')
    if (fromCfg) return fromCfg
    return ailyBaseFromToken(auth.access_token, DEFAULT_AILY_BASE)
  }

  function saveAuth(patch) {
    const next = { ...readAuth(), ...patch, updated_at: new Date().toISOString() }
    writeJsonFile(cfg.authFile, next)
    return next
  }

  function setUpstreamBase(url) {
    if (cfg.envBase) return getUpstreamBase()
    const cleaned = String(url || '')
      .trim()
      .replace(/\/+$/, '')
    const next = { ...readAdminCfg(), aily_base_url: cleaned, updated_at: new Date().toISOString() }
    writeJsonFile(cfg.adminConfigFile, next)
    return cleaned
  }

  async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = 20000 } = {}) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
        signal: ctrl.signal,
      })
      const text = await res.text()
      let json = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        json = { raw: text.slice(0, 500) }
      }
      return { ok: res.ok, status: res.status, json, headers: res.headers }
    } finally {
      clearTimeout(timer)
    }
  }

  async function solveAltcha(base) {
    const res = await fetchJson(`${base}/api/v1/altcha`, { timeoutMs: 15000 })
    if (!res.ok) throw new Error(`altcha challenge failed: HTTP ${res.status}`)
    const challenge = res.json || {}
    if (challenge.algorithm !== 'SHA-256') {
      throw new Error(`unsupported altcha algorithm: ${challenge.algorithm}`)
    }
    const max = Number(challenge.maxnumber) || 1_000_000
    let solution = -1
    for (let n = 0; n <= max; n++) {
      const hash = crypto.createHash('sha256').update(String(challenge.salt) + n).digest('hex')
      if (hash === challenge.challenge) {
        solution = n
        break
      }
    }
    if (solution < 0) throw new Error('altcha solving failed: no match found')
    return Buffer.from(
      JSON.stringify({
        algorithm: challenge.algorithm,
        challenge: challenge.challenge,
        number: solution,
        salt: challenge.salt,
        signature: challenge.signature,
      }),
    ).toString('base64')
  }

  function publicStatus() {
    const auth = readAuth()
    const upstream = getUpstreamBase(auth)
    const adminCfg = readAdminCfg()
    const configuredBase = String(adminCfg.aily_base_url || '').trim().replace(/\/+$/, '')
    return {
      auth_file: cfg.authFile,
      upstream,
      upstream_from_env: !!cfg.envBase,
      aily_base_url: cfg.envBase ? '' : configuredBase,
      aily_base_from_env: !!cfg.envBase,
      has_access_token: !!auth.access_token,
      has_refresh_token: !!auth.refresh_token,
      access_preview: maskToken(auth.access_token),
      refresh_preview: maskToken(auth.refresh_token),
      updated_at: auth.updated_at || null,
      model_routes: cfg.modelRoutes.slice(),
      bridge: 'embedded',
      // legacy fields kept for older UI (soft no-op)
      adapter_url: cfg.adapterUrl || null,
      adapter_api_key_configured: !!cfg.adapterApiKey,
      admin_proxy_configured: !!(cfg.adminUser && cfg.adminPassword),
      cpa_note:
        'Client /v1 stays on openapi→CPA. Matching AILY_MODEL_ROUTES uses in-process Aily bridge (shared .aily tokens). Separate aily-openai-adapter :8088 is optional/legacy.',
    }
  }

  async function testUpstreamMe() {
    const auth = readAuth()
    const token = normalizeAilyToken(auth.access_token)
    if (!token) return { ok: false, message: 'No access_token stored' }
    const base = getUpstreamBase(auth)
    const res = await fetchJson(`${base}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const user =
      res.json?.data?.nickname ||
      res.json?.data?.email ||
      res.json?.data?.user?.nickname ||
      res.json?.data?.user?.email ||
      null
    return {
      ok: res.ok,
      status: res.status,
      message: res.ok ? `连接正常${user ? ` · ${user}` : ''}` : res.json?.message || `HTTP ${res.status}`,
      user,
      upstream: base,
    }
  }

  /** @type {null | { listModels: Function, handleV1: Function }} */
  let upstreamBridge = null

  function attachUpstream(bridge) {
    upstreamBridge = bridge
  }

  async function testEmbeddedModels(force = false) {
    if (!upstreamBridge?.listModels) {
      return { ok: false, message: 'Embedded Aily bridge not attached', models: [], embedded: true }
    }
    return upstreamBridge.listModels(force)
  }

  /** @deprecated use testEmbeddedModels — kept as alias for callers */
  async function testAdapterModels(force = false) {
    return testEmbeddedModels(force)
  }

  async function sendEmailCode(email, ailyBaseUrl) {
    if (ailyBaseUrl !== undefined && ailyBaseUrl !== null && String(ailyBaseUrl).trim()) {
      setUpstreamBase(ailyBaseUrl)
    }
    const base = getUpstreamBase()
    const altcha = await solveAltcha(base)
    const res = await fetchJson(`${base}/api/v1/auth/send-email-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { email: String(email || '').trim(), altcha, device_id: 'pc' },
      timeoutMs: 30000,
    })
    return {
      ok: res.ok,
      status: res.status,
      message: res.json?.message || (res.ok ? '验证码已发送' : res.json?.errorMessage || `HTTP ${res.status}`),
      upstream: base,
    }
  }

  async function emailCodeLogin(email, code, ailyBaseUrl) {
    if (ailyBaseUrl !== undefined && ailyBaseUrl !== null && String(ailyBaseUrl).trim()) {
      setUpstreamBase(ailyBaseUrl)
    }
    const base = getUpstreamBase()
    const res = await fetchJson(`${base}/api/v1/auth/email-code-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        email: String(email || '').trim(),
        code: String(code || '').trim(),
        device_id: 'pc',
      },
      timeoutMs: 30000,
    })
    const data = res.json?.data
    if ((res.ok || res.json?.status === 200) && data?.access_token) {
      saveAuth({
        access_token: normalizeAilyToken(data.access_token),
        ...(data.refresh_token
          ? { refresh_token: normalizeAilyToken(data.refresh_token) }
          : {}),
      })
      return {
        ok: true,
        message: '登录成功',
        user: data.user?.nickname || data.user?.email || '',
        upstream: getUpstreamBase(),
      }
    }
    return {
      ok: false,
      status: res.status,
      message: res.json?.message || res.json?.errorMessage || `HTTP ${res.status}`,
      upstream: base,
    }
  }

  function saveTokens({ access_token, refresh_token, aily_base_url } = {}) {
    if (aily_base_url !== undefined) setUpstreamBase(aily_base_url)
    const patch = {}
    if (access_token) patch.access_token = normalizeAilyToken(access_token)
    if (refresh_token) patch.refresh_token = normalizeAilyToken(refresh_token)
    if (!Object.keys(patch).length && aily_base_url === undefined) {
      return { ok: false, message: 'Nothing to save' }
    }
    if (Object.keys(patch).length) saveAuth(patch)
    return { ok: true, message: '已保存', upstream: getUpstreamBase(), ...publicStatus() }
  }

  async function refreshToken() {
    const auth = readAuth()
    const rt = normalizeAilyToken(auth.refresh_token)
    if (!rt) return { ok: false, message: 'No refresh_token stored' }
    const base = getUpstreamBase(auth)
    const res = await fetchJson(`${base}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { refresh_token: rt },
    })
    const data = res.json?.data
    if (res.ok && data?.access_token) {
      const patch = { access_token: normalizeAilyToken(data.access_token) }
      if (data.refresh_token) patch.refresh_token = normalizeAilyToken(data.refresh_token)
      saveAuth(patch)
      return { ok: true, message: '已刷新 Token', upstream: getUpstreamBase() }
    }
    return {
      ok: false,
      status: res.status,
      message: res.json?.message || res.json?.errorMessage || `HTTP ${res.status}`,
    }
  }

  function clearTokens() {
    saveAuth({ access_token: '', refresh_token: '' })
    return { ok: true, message: '已清除本地 token', ...publicStatus() }
  }

  async function ensureAdminSession() {
    if (!cfg.adminUser || !cfg.adminPassword) {
      const err = new Error('AILY_ADAPTER_ADMIN_USER/PASSWORD not configured')
      err.status = 503
      throw err
    }
    if (adminCookie && Date.now() - adminCookieAt < 6 * 3600 * 1000) return adminCookie
    const res = await fetchJson(`${cfg.adapterUrl}/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: cfg.adminUser, password: cfg.adminPassword },
    })
    if (!res.ok) {
      const err = new Error(res.json?.message || `aily admin auth failed (${res.status})`)
      err.status = res.status || 502
      throw err
    }
    const setCookie = res.headers?.get?.('set-cookie') || ''
    const match = /aily_admin_session=([^;]+)/.exec(setCookie)
    if (!match) {
      const err = new Error('aily admin auth returned no session cookie')
      err.status = 502
      throw err
    }
    adminCookie = `aily_admin_session=${match[1]}`
    adminCookieAt = Date.now()
    return adminCookie
  }

  async function proxyAdmin(pathname, { method = 'GET', body } = {}) {
    const cookie = await ensureAdminSession()
    const url = `${cfg.adapterUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`
    const headers = { Accept: 'application/json', Cookie: cookie }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const res = await fetchJson(url, { method, headers, body, timeoutMs: 30000 })
    return res
  }

  return {
    cfg,
    publicStatus,
    testUpstreamMe,
    testAdapterModels,
    testEmbeddedModels,
    attachUpstream,
    getAccessToken: () => normalizeAilyToken(readAuth().access_token),
    getRefreshToken: () => normalizeAilyToken(readAuth().refresh_token),
    getUpstreamBase: () => getUpstreamBase(),
    saveAuth,
    readAuth,
    sendEmailCode,
    emailCodeLogin,
    saveTokens,
    refreshToken,
    clearTokens,
    proxyAdmin,
    modelMatches: (model) => modelMatchesAilyRoute(model, cfg.modelRoutes),
    getUpstream() {
      return upstreamBridge
    },
  }
}
