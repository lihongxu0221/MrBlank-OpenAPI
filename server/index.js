import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cookieParser from 'cookie-parser'
import {
  loadCpaConfig,
  fetchCpaModels,
  addCpaApiKey,
  removeCpaApiKey,
  fetchCpampUsage,
  fetchCpampUsageCached,
  fetchCpampAuthFilesCached,
  flattenUsageForHashes,
  hashApiKey,
  maskKey,
  probeCpaModels,
  probeServiceHealth,
  aggregateLeaderboardFromUsage,
  aggregateActivityFromUsage,
  modelLatencyStatsFromUsage,
  mapAuthFilesToPoolItems,
  listCpaApiKeys,
  probeUrl,
} from './cpa.js'
import { createUserKeyStore } from './userKeys.js'
import {
  loadAdminAllowlist,
  isAdminUser,
  sanitizeConfig,
  summarizeUsage,
  mapAdminAccounts,
  maskSecretValue,
} from './admin.js'
import { createSiteContentStore } from './siteContent.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const text = fs.readFileSync(filePath, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = val
  }
}

loadEnvFile(path.join(rootDir, '.env'))
loadEnvFile(path.join(__dirname, '.env'))

const cpaCfg = loadCpaConfig(process.env)
const userKeyStore = createUserKeyStore(
  process.env.USER_KEYS_PATH || path.join(__dirname, 'data', 'user-keys.json'),
)
const adminAllowlist = loadAdminAllowlist(process.env)
const siteContent = createSiteContentStore(
  process.env.SITE_CONTENT_PATH || path.join(__dirname, 'data', 'site-content.json'),
)

const CLIENT_ID = process.env.LINUXDO_CLIENT_ID || ''
const CLIENT_SECRET = process.env.LINUXDO_CLIENT_SECRET || ''
const REDIRECT_URI =
  process.env.LINUXDO_REDIRECT_URI || 'https://openapi.juc114.cn/oauth/linuxdo'
const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '127.0.0.1'
const SESSION_SECRET = process.env.SESSION_SECRET || ''
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://openapi.juc114.cn'
const AILY_ADAPTER_URL = (process.env.AILY_ADAPTER_URL || 'http://127.0.0.1:8088').replace(/\/$/, '')
const COOKIE_NAME = 'mrblank_sid'
const STATE_TTL_MS = 10 * 60 * 1000
const SESSION_TTL_MS = 12 * 60 * 60 * 1000
const Q = 500_000

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('[server] LINUXDO_CLIENT_ID and LINUXDO_CLIENT_SECRET are required')
  process.exit(1)
}
if (!SESSION_SECRET || SESSION_SECRET.length < 16) {
  console.error('[server] SESSION_SECRET must be set (min 16 chars)')
  process.exit(1)
}

const oauthStates = new Map() // flow_token -> { createdAt, intent }
const sessions = new Map() // sid -> session record
/** @type {Map<string|number, any>} */
const userStores = new Map()

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex')
}

function day(offset = 0) {
  const d = new Date(Date.now() + offset * 86400000)
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}

function monthKey() {
  return day().slice(0, 7)
}

function ok(data) {
  return { success: true, data }
}

function fail(message, code) {
  return { success: false, data: null, message, code }
}

function getOrCreateUserStore(user) {
  const key = String(user.id)
  let store = userStores.get(key)
  if (!store) {
    store = {
      user: {
        id: user.id,
        display_name: user.display_name,
        username: user.username,
        email: user.email || '',
        quota: 0,
        settled_quota: 0,
        used_quota: 0,
        request_count: 0,
        concurrency_limit: 5,
        pending_quota: 0,
      },
      checkins: [],
      tokens: [],
      nextId: 1,
      redeemed: new Set(),
      logs: [],
    }
    userStores.set(key, store)
  } else {
    store.user.display_name = user.display_name
    store.user.username = user.username
    if (user.email) store.user.email = user.email
  }
  return store
}

function pruneMaps() {
  const now = Date.now()
  for (const [k, v] of oauthStates) {
    if (now - v.createdAt > STATE_TTL_MS) oauthStates.delete(k)
  }
  for (const [k, v] of sessions) {
    if (now - v.createdAt > SESSION_TTL_MS) sessions.delete(k)
  }
}
setInterval(pruneMaps, 60_000).unref?.()

function readSid(req) {
  const raw = req.cookies?.[COOKIE_NAME]
  return typeof raw === 'string' && raw.length > 8 ? raw : null
}

function getSession(req) {
  const sid = readSid(req)
  if (!sid) return null
  const rec = sessions.get(sid)
  if (!rec) return null
  if (Date.now() - rec.createdAt > SESSION_TTL_MS) {
    sessions.delete(sid)
    return null
  }
  return rec
}

function requireAuth(req, res, next) {
  const session = getSession(req)
  if (!session) {
    res.status(401).json(fail('请先登录。'))
    return
  }
  req.auth = session
  req.store = getOrCreateUserStore(session.user)
  next()
}

function requireAdmin(req, res, next) {
  const session = getSession(req)
  if (!session) {
    res.status(401).json(fail('请先登录。'))
    return
  }
  if (!isAdminUser(session.user, adminAllowlist)) {
    res.status(403).json(fail('需要管理员权限'))
    return
  }
  req.auth = session
  req.store = getOrCreateUserStore(session.user)
  next()
}

function setSessionCookie(res, sid) {
  res.cookie(COOKIE_NAME, sid, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
  })
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  })
}


function sessionPayload(rec) {
  return {
    access_token: rec.access_token,
    token_type: 'Bearer',
    access_expires_at: rec.expiresAt,
    session: { sid: rec.sid, current: true },
    user: {
      id: rec.user.id,
      display_name: rec.user.display_name,
      username: rec.user.username,
      email: rec.user.email || '',
      auth_provider: rec.user.auth_provider || 'linuxdo',
    },
    is_admin: isAdminUser(rec.user, adminAllowlist),
  }
}

function createUserSession(user) {
  const sid = randomToken(32)
  const access_token = randomToken(24)
  const expiresAt = Math.floor(Date.now() / 1000) + Math.floor(SESSION_TTL_MS / 1000)
  const rec = {
    sid,
    access_token,
    createdAt: Date.now(),
    expiresAt,
    user,
  }
  sessions.set(sid, rec)
  getOrCreateUserStore(user)
  try {
    userKeyStore.setProfile(user.id, {
      display_name: user.display_name,
      username: user.username,
      email: user.email,
    })
  } catch (e) {
    console.error('[userKeys] setProfile failed', e?.message || e)
  }
  return rec
}

function postLoginHash(user) {
  return isAdminUser(user, adminAllowlist) ? '/admin' : '/console'
}

function extractAilySessionCookie(setCookieHeader) {
  if (!setCookieHeader) return null
  const parts = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader]
  for (const raw of parts) {
    const m = String(raw).match(/(?:^|,\s*)aily_admin_session=([^;]+)/i)
    if (m) return decodeURIComponent(m[1].trim())
  }
  // Also try first cookie pair if header is a single Set-Cookie
  for (const raw of parts) {
    const first = String(raw).split(';')[0]
    const eq = first.indexOf('=')
    if (eq > 0 && first.slice(0, eq).trim() === 'aily_admin_session') {
      return decodeURIComponent(first.slice(eq + 1).trim())
    }
  }
  return null
}

function mapAilyAuthError(status, message) {
  const msg = String(message || '').trim()
  if (status === 429 || /尝试过多|稍后再试|locked|too many/i.test(msg)) {
    return { status: 429, message: '尝试过多，请稍后再试' }
  }
  if (/禁用|disabled/i.test(msg)) {
    return { status: 401, message: '该 Aily 账号已被禁用' }
  }
  if (/用户名或密码错误|密码错误|unauthorized|Invalid/i.test(msg) || status === 401) {
    return { status: 401, message: '用户名或密码错误' }
  }
  if (/请输入用户名/i.test(msg)) {
    return { status: 400, message: '请输入用户名' }
  }
  if (status >= 500) {
    return { status: 502, message: 'Aily 登录服务暂时不可用，请稍后重试' }
  }
  return { status: status >= 400 ? status : 401, message: msg || 'Aily 登录失败' }
}


const probeHistory = [] // { checked_at, overall, latency_ms, model_count }
const PROBE_HISTORY_MAX = 48

function rememberProbe(entry) {
  probeHistory.unshift(entry)
  while (probeHistory.length > PROBE_HISTORY_MAX) probeHistory.pop()
}

function overallFromHealth(modelsOk, health, modelCount) {
  const cpaUp = !!(health?.cpa?.ok || health?.billing?.ok)
  const cpampUp = !!health?.cpamp?.ok
  if (!modelsOk && !cpaUp) return 'unavailable'
  if (!modelsOk) return 'degraded'
  if (modelCount === 0) return 'degraded'
  if (!cpampUp) return 'degraded'
  return 'operational'
}

async function buildAvailability() {
  const now = new Date().toISOString()
  const [health, modelsProbe, usage] = await Promise.all([
    probeServiceHealth(cpaCfg).catch(() => ({
      cpa: { ok: false, latency_ms: 0 },
      billing: { ok: false, latency_ms: 0 },
      cpamp: { ok: false, latency_ms: 0 },
    })),
    probeCpaModels(cpaCfg).catch((e) => ({
      ok: false,
      latency_ms: 0,
      models: [],
      error: e?.message || String(e),
    })),
    cpaCfg.adminKey
      ? fetchCpampUsageCached(cpaCfg).catch(() => null)
      : Promise.resolve(null),
  ])

  const modelStats = usage
    ? modelLatencyStatsFromUsage(usage, { period: '7d', limit: 24 })
    : new Map()
  const overall = overallFromHealth(modelsProbe.ok, health, modelsProbe.models.length)
  const probeLatency = modelsProbe.latency_ms || health?.billing?.latency_ms || health?.cpa?.latency_ms || null

  rememberProbe({
    checked_at: now,
    overall,
    latency_ms: probeLatency,
    model_count: modelsProbe.models.length,
  })

  const historySeed = probeHistory.map((h) => ({
    checked_at: h.checked_at,
    status: h.overall === 'operational' ? 'operational' : h.overall === 'degraded' ? 'degraded' : 'down',
    latency_ms: h.latency_ms,
  }))

  const models = (modelsProbe.models || []).map((m) => {
    const stats = modelStats.get(m.id)
    let status = modelsProbe.ok ? 'operational' : 'down'
    if (stats?.status) status = stats.status
    if (!modelsProbe.ok) status = 'down'
    else if (overall === 'degraded' && status === 'operational') {
      // keep operational per-model if CPA models list is up
    }
    const hist = (stats?.history && stats.history.length ? stats.history : historySeed).slice(0, 24)
    const latency_ms =
      stats?.latency_ms != null ? stats.latency_ms : modelsProbe.ok ? probeLatency : null
    const availability =
      stats?.availability != null
        ? stats.availability
        : modelsProbe.ok
          ? 100
          : 0
    return {
      id: m.id,
      name: m.name || m.id,
      status,
      latency_ms,
      availability,
      history: hist,
    }
  })

  // If models probe failed entirely, still surface a single unavailable card so UI is honest.
  if (!models.length) {
    models.push({
      id: 'cpa',
      name: 'CPA',
      status: 'down',
      latency_ms: probeLatency,
      availability: 0,
      history: historySeed,
    })
  }

  const operational = models.filter((m) => m.status === 'operational').length
  const latSamples = models.filter((m) => m.latency_ms != null).map((m) => m.latency_ms)
  const avg_latency_ms = latSamples.length
    ? Math.round(latSamples.reduce((a, b) => a + b, 0) / latSamples.length)
    : null

  const endpointStatus = modelsProbe.ok ? 'operational' : overall === 'degraded' ? 'degraded' : 'down'
  const endpoints = [
    '/v1/chat/completions',
    '/v1/messages',
    '/v1/responses',
    '/v1/images/generations',
    '/v1/videos',
  ].map((path) => ({
    path,
    status: endpointStatus,
    latency_ms: probeLatency,
  }))

  return ok({
    checked_at: now,
    overall,
    source: 'cpa+cpamp',
    cpa: health.cpa,
    billing: health.billing,
    cpamp: health.cpamp,
    totals: {
      models: modelsProbe.models.length,
      operational,
      avg_latency_ms,
      total_tokens: usage?.total_tokens ?? 0,
      total_requests: usage?.total_requests ?? 0,
      success_count: usage?.success_count ?? 0,
      failure_count: usage?.failure_count ?? 0,
    },
    endpoints,
    groups: [
      {
        name: '默认分组',
        checked_at: now,
        models,
      },
    ],
    note: modelsProbe.ok
      ? undefined
      : modelsProbe.error || '无法探测 CPA /v1/models',
  })
}

async function buildLeaderboard(period = 'today', sort = 'credits', p = 1) {
  if (!cpaCfg.adminKey) {
    return ok({
      items: [],
      total: 0,
      period,
      sort,
      page: p,
      note: 'CPAMP Admin Key 未配置；排行榜暂不可用。',
    })
  }
  try {
    const usage = await fetchCpampUsageCached(cpaCfg)
    // Merge disk profiles with live session display names.
    const hashMap = userKeyStore.hashToUserMap()
    for (const rec of sessions.values()) {
      const uid = String(rec.user?.id || '')
      if (!uid) continue
      for (const [h, meta] of hashMap) {
        if (meta.userId === uid) {
          hashMap.set(h, {
            ...meta,
            display_name: rec.user.display_name || meta.display_name,
            username: rec.user.username || meta.username,
          })
        }
      }
    }
    const ranked = aggregateLeaderboardFromUsage(usage, hashMap, { period, sort })
    return ok({
      items: ranked,
      total: ranked.length,
      period,
      sort,
      page: p,
      source: 'cpamp',
    })
  } catch (err) {
    console.error('[welfare] leaderboard failed', err?.message || err)
    return ok({
      items: [],
      total: 0,
      period,
      sort,
      page: p,
      note: `排行榜暂不可用：${err?.message || 'CPAMP 错误'}`,
    })
  }
}

async function buildActivity(period = 'today') {
  if (!cpaCfg.adminKey) {
    return ok({ period, items: [], note: 'CPAMP Admin Key 未配置；调用实况暂不可用。' })
  }
  try {
    const usage = await fetchCpampUsageCached(cpaCfg)
    const items = aggregateActivityFromUsage(usage, { period })
    return ok({ period, items, source: 'cpamp' })
  } catch (err) {
    console.error('[welfare] activity failed', err?.message || err)
    return ok({ period, items: [], note: `调用实况暂不可用：${err?.message || 'CPAMP 错误'}` })
  }
}

async function buildPool() {
  if (!cpaCfg.adminKey) {
    return ok({ stale: true, items: [], note: 'CPAMP Admin Key 未配置；号池暂不可用。' })
  }
  try {
    const auth = await fetchCpampAuthFilesCached(cpaCfg)
    const items = mapAuthFilesToPoolItems(auth)
    return ok({
      stale: false,
      items,
      observed_at: auth?.observed_at || null,
      source: 'cpamp:auth-files',
    })
  } catch (err) {
    console.error('[welfare] pool failed', err?.message || err)
    return ok({ stale: true, items: [], note: `号池暂不可用：${err?.message || 'CPAMP 错误'}` })
  }
}

function publicHandlers() {
  return {
    status: () => ok({ quota_per_unit: Q }),
    config: () =>
      ok({
        loginEnabled: true,
        turnstileSiteKey: '',
        linuxdoClientId: CLIENT_ID,
      }),
    availability: () => buildAvailability(),
    pool: () => buildPool(),
    leaderboard: (period = 'today', sort = 'credits', p = 1) => buildLeaderboard(period, sort, p),
    activity: (period = 'today') => buildActivity(period),
    notices: (size = 50) =>
      ok({
        items: [
          {
            id: 'n1',
            level: 'warning',
            title: '提醒 | 通用公告 | 每日额度使用规则',
            body: '请合理使用社区共享额度，勿自动签到或转售密钥。签到以北京时间为准。',
            published_at: '2026-09-18T10:00:00+08:00',
            ack_identity: 'n1-2026-09-18',
          },
          {
            id: 'n2',
            level: 'info',
            title: '欢迎来到 MrBlank OpenAPI',
            body: '模型调用 Base URL 为 https://openapi.juc114.cn/v1（本站 nginx → CPA billing）。请使用 Linux.do 登录。',
            published_at: '2026-09-10T09:00:00+08:00',
            ack_identity: 'n2-2026-09-10',
          },
        ].slice(0, size),
      }),
    challenge: (purpose) =>
      ok({
        id: randomToken(32),
        purpose,
        bits: 4,
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      }),
    verify: () => ok({ grant: 'grant-' + randomToken(8) }),
  }
}

const pub = publicHandlers()

const app = express()
app.set('trust proxy', 1)
app.use(cookieParser(SESSION_SECRET))
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: false }))

app.get('/api/status', (_req, res) => res.json(pub.status()))
app.get('/api/welfare/config', (_req, res) => res.json(pub.config()))
app.get('/api/welfare/constellation', (_req, res) => {
  res.json(ok(siteContent.getPublicConstellation()))
})
app.get('/api/welfare/availability', async (_req, res) => {
  try {
    res.json(await pub.availability())
  } catch (err) {
    console.error('[welfare] availability', err?.message || err)
    res.status(502).json(fail(err?.message || '服务状态探测失败'))
  }
})
app.get('/api/welfare/pool', async (_req, res) => {
  try {
    res.json(await pub.pool())
  } catch (err) {
    console.error('[welfare] pool', err?.message || err)
    res.json(ok({ stale: true, items: [], note: err?.message || '号池不可用' }))
  }
})
app.get('/api/welfare/leaderboard', async (req, res) => {
  try {
    res.json(
      await pub.leaderboard(
        String(req.query.period || 'today'),
        String(req.query.sort || 'credits'),
        Number(req.query.p || 1),
      ),
    )
  } catch (err) {
    console.error('[welfare] leaderboard', err?.message || err)
    res.json(
      ok({
        items: [],
        total: 0,
        period: String(req.query.period || 'today'),
        sort: String(req.query.sort || 'credits'),
        page: Number(req.query.p || 1),
        note: err?.message || '排行榜不可用',
      }),
    )
  }
})
app.get('/api/welfare/activity', async (req, res) => {
  try {
    res.json(await pub.activity(String(req.query.period || 'today')))
  } catch (err) {
    console.error('[welfare] activity', err?.message || err)
    res.json(ok({ period: String(req.query.period || 'today'), items: [], note: err?.message || '调用实况不可用' }))
  }
})
app.get('/api/welfare/notices', (req, res) =>
  res.json(pub.notices(Number(req.query.size || 50))),
)
app.post('/api/welfare/challenge', (req, res) =>
  res.json(pub.challenge(String(req.body?.purpose || 'login'))),
)
app.post('/api/welfare/verify', (_req, res) => res.json(pub.verify()))

app.post('/api/oauth/state', (req, res) => {
  const provider = String(req.body?.provider || '')
  const intent = String(req.body?.intent || 'login')
  if (provider !== 'linuxdo') {
    res.status(400).json(fail('不支持的登录提供方'))
    return
  }
  const flow_token = randomToken(24)
  oauthStates.set(flow_token, { createdAt: Date.now(), intent })
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'user',
    state: flow_token,
  })
  const authorization_url = `https://connect.linux.do/oauth2/authorize?${params.toString()}`
  res.json(ok({ flow_token, authorization_url }))
})

app.get('/oauth/linuxdo', async (req, res) => {
  const code = String(req.query.code || '')
  const state = String(req.query.state || '')
  const oauthError = String(req.query.error || '')

  const failRedirect = (reason) => {
    const u = new URL(SITE_ORIGIN)
    u.searchParams.set('oauth_error', reason)
    u.hash = '/console'
    res.redirect(302, u.toString())
  }

  if (oauthError) return failRedirect(oauthError)
  if (!code || !state) return failRedirect('missing_code')

  const st = oauthStates.get(state)
  oauthStates.delete(state)
  if (!st || Date.now() - st.createdAt > STATE_TTL_MS) {
    return failRedirect('invalid_state')
  }

  try {
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    })
    const tokenRes = await fetch('https://connect.linux.do/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    })
    if (!tokenRes.ok) {
      console.error('[oauth] token exchange failed', tokenRes.status)
      return failRedirect('token_exchange_failed')
    }
    const tokenJson = await tokenRes.json()
    const accessToken = tokenJson.access_token
    if (!accessToken) {
      console.error('[oauth] no access_token in response')
      return failRedirect('token_exchange_failed')
    }

    const userRes = await fetch('https://connect.linux.do/api/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })
    if (!userRes.ok) {
      console.error('[oauth] user fetch failed', userRes.status)
      return failRedirect('userinfo_failed')
    }
    const ldUser = await userRes.json()
    const id = ldUser.id
    const username = ldUser.username || String(id)
    const display_name = ldUser.name || username
    const email = String(ldUser.email || ldUser.primary_email || '').trim()
    if (!id) return failRedirect('userinfo_empty')

    const user = {
      id,
      username,
      display_name,
      email: email || undefined,
      auth_provider: 'linuxdo',
    }
    const rec = createUserSession(user)
    setSessionCookie(res, rec.sid)
    res.redirect(302, `${SITE_ORIGIN}/#${postLoginHash(user)}`)
  } catch (err) {
    console.error('[oauth] callback error', err?.message || err)
    return failRedirect('oauth_failed')
  }
})

app.get('/api/user/self', requireAuth, (req, res) => {
  res.json(ok({ ...req.store.user }))
})

app.get('/api/user/dashboard', requireAuth, (_req, res) => {
  res.json(
    ok({
      days: Array.from({ length: 7 }, (_, i) => ({
        date: day(i - 6),
        requests: 0,
      })),
    }),
  )
})

app.get('/api/user/checkin', requireAuth, (req, res) => {
  const mm = String(req.query.month || monthKey())
  const records = req.store.checkins.filter((r) => r.checkin_date.startsWith(mm))
  const today = day()
  const checked = req.store.checkins.some((r) => r.checkin_date === today)
  res.json(
    ok({
      enabled: true,
      claimable: !checked,
      unavailable_reason: checked ? '今日已签到' : undefined,
      min_quota: 0,
      max_quota: 5 * Q,
      month: mm,
      stats: {
        checked_in_today: checked,
        checkin_count: records.length,
        total_checkins: req.store.checkins.length,
        records,
      },
    }),
  )
})

app.post('/api/user/checkin', requireAuth, (req, res) => {
  const today = day()
  if (req.store.checkins.some((r) => r.checkin_date === today)) {
    res.json(fail('今日已签到'))
    return
  }
  const quota_awarded = 2 * Q
  req.store.checkins.push({ checkin_date: today, quota_awarded })
  req.store.user.quota += quota_awarded
  res.json(ok({ quota_awarded }))
})

app.post('/api/user/topup', requireAuth, (req, res) => {
  const code = String(req.body?.key || '')
    .trim()
    .toUpperCase()
  if (!code) {
    res.json(fail('请输入兑换码'))
    return
  }
  if (req.store.redeemed.has(code)) {
    res.json(fail('兑换码已使用'))
    return
  }
  if (
    !['WELCOME', 'GROK2026', 'COMMUNITY', 'DARKFORGER'].includes(code) &&
    !code.startsWith('DF-')
  ) {
    res.json(fail('兑换码无效'))
    return
  }
  req.store.redeemed.add(code)
  const awarded = 5 * Q
  req.store.user.quota += awarded
  res.json(ok(awarded))
})


app.post('/api/auth/aily', async (req, res) => {
  const username = String(req.body?.username || '').trim()
  const password = String(req.body?.password || '')
  if (!username || !password) {
    res.status(400).json(fail('请输入用户名和密码'))
    return
  }
  try {
    const authRes = await fetch(`${AILY_ADAPTER_URL}/admin/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ username, password }),
    })
    let authJson = null
    try {
      authJson = await authRes.json()
    } catch {
      authJson = null
    }
    if (!authRes.ok || !authJson?.ok) {
      const mapped = mapAilyAuthError(authRes.status, authJson?.message)
      res.status(mapped.status).json(fail(mapped.message))
      return
    }

    // Prefer profile from /admin/me using aily session cookie (server-side only; never forward to browser)
    let me = null
    const setCookies =
      typeof authRes.headers.getSetCookie === 'function' ? authRes.headers.getSetCookie() : null
    const ailyCookie = extractAilySessionCookie(
      setCookies && setCookies.length ? setCookies : authRes.headers.get('set-cookie'),
    )
    if (ailyCookie) {
      try {
        const meRes = await fetch(`${AILY_ADAPTER_URL}/admin/me`, {
          headers: {
            Accept: 'application/json',
            Cookie: `aily_admin_session=${ailyCookie}`,
          },
        })
        if (meRes.ok) {
          const meJson = await meRes.json()
          me = meJson?.data || meJson
        }
      } catch (e) {
        console.error('[aily-auth] /admin/me failed', e?.message || e)
      }
    }

    const ailyUsername = String(me?.username || authJson.username || username).trim()
    const ailyUserId = me?.userId ?? me?.id
    const display_name = String(me?.display_name || ailyUsername)
    const aily_role = Number(me?.role ?? authJson.role ?? 0) || 0
    const aily_admin = !!(me?.admin ?? authJson.admin ?? aily_role >= 10)
    const id = ailyUserId != null && ailyUserId !== '' ? `aily:${ailyUserId}` : `aily:${ailyUsername}`

    const user = {
      id,
      username: ailyUsername,
      display_name,
      email: '',
      auth_provider: 'aily',
      aily_role,
      aily_admin,
    }
    const rec = createUserSession(user)
    setSessionCookie(res, rec.sid)
    res.json(ok(sessionPayload(rec)))
  } catch (err) {
    console.error('[aily-auth] adapter unreachable', err?.message || err)
    res.status(502).json(fail('Aily 登录服务暂时不可用，请稍后重试'))
  }
})

app.post('/api/user/auth/logout', (req, res) => {
  const sid = readSid(req)
  if (sid) sessions.delete(sid)
  clearSessionCookie(res)
  res.json(ok(true))
})

app.post('/api/user/auth/refresh', requireAuth, (req, res) => {
  res.json(ok(sessionPayload(req.auth)))
})

/** Session restore payload for SPA (cookie-backed). */
app.get('/api/user/session', requireAuth, (req, res) => {
  res.json(ok(sessionPayload(req.auth)))
})

app.get(['/api/token/', '/api/token'], requireAuth, (req, res) => {
  const p = Number(req.query.p || 1)
  const size = Number(req.query.size || 10)
  const all = userKeyStore.list(req.auth.user.id)
  const startIdx = (p - 1) * size
  const items = all.slice(startIdx, startIdx + size).map(({ fullKey: _, ...rest }) => rest)
  res.json(
    ok({
      items,
      total: all.length,
      api_base_url: cpaCfg.publicApiBaseUrl,
      demo_key_masked: cpaCfg.demoKey ? maskKey(cpaCfg.demoKey) : null,
      note: '密钥由本站服务端在 CPA 注册；Management/Admin Key 不会下发到浏览器。',
    }),
  )
})

app.post(['/api/token/', '/api/token'], requireAuth, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置，无法创建密钥'))
      return
    }
    const body = req.body || {}
    const fullKey = `sk-mrblank-${req.auth.user.id}-${randomToken(12)}`
    await addCpaApiKey(cpaCfg, fullKey)
    const item = userKeyStore.create(req.auth.user.id, {
      name: String(body.name || 'key'),
      key: maskKey(fullKey),
      fullKey,
      status: 1,
      unlimited_quota: body.unlimited_quota !== false,
      remain_quota: body.remain_quota ?? 0,
      expired_time: body.expired_time ?? -1,
      model_limits: body.model_limits || '',
      access_group_id: 1,
      group: body.group || 'default',
      created_at: new Date().toISOString(),
    })
    const { fullKey: __, ...rest } = item
    res.json(ok(rest))
  } catch (err) {
    console.error('[cpa] create key failed', err?.message || err)
    res.status(502).json(fail(err?.message || '创建 CPA 密钥失败'))
  }
})

app.put(['/api/token/', '/api/token'], requireAuth, async (req, res) => {
  try {
    const body = req.body || {}
    const t = userKeyStore.get(req.auth.user.id, body.id)
    if (!t) {
      res.json(fail('密钥不存在'))
      return
    }
    if (String(req.query.status_only) === 'true') {
      const nextStatus = Number(body.status)
      if (nextStatus === 2 && t.status === 1 && t.fullKey) {
        await removeCpaApiKey(cpaCfg, t.fullKey)
      } else if (nextStatus === 1 && t.status !== 1 && t.fullKey) {
        await addCpaApiKey(cpaCfg, t.fullKey)
      }
      const updated = userKeyStore.update(req.auth.user.id, t.id, { status: nextStatus })
      const { fullKey: _, ...rest } = updated
      res.json(ok(rest))
      return
    }
    const updated = userKeyStore.update(req.auth.user.id, t.id, {
      name: body.name ?? t.name,
      remain_quota: body.remain_quota ?? t.remain_quota,
      unlimited_quota: body.unlimited_quota ?? t.unlimited_quota,
      expired_time: body.expired_time ?? t.expired_time,
      model_limits: body.model_limits ?? t.model_limits,
      group: body.group ?? t.group,
    })
    const { fullKey: __, ...rest } = updated
    res.json(ok(rest))
  } catch (err) {
    console.error('[cpa] update key failed', err?.message || err)
    res.status(502).json(fail(err?.message || '更新密钥失败'))
  }
})

app.get('/api/token/options', requireAuth, async (_req, res) => {
  try {
    const model_details = await fetchCpaModels(cpaCfg)
    res.json(
      ok({
        groups: [{ id: 1, name: 'default', is_default: true, ratio: 1 }],
        model_details,
        api_base_url: cpaCfg.publicApiBaseUrl,
        source: 'cpa',
      }),
    )
  } catch (err) {
    console.error('[cpa] models failed', err?.message || err)
    res.status(502).json(fail(err?.message || '无法从 CPA 拉取模型列表'))
  }
})

app.post('/api/token/:id/key', requireAuth, (req, res) => {
  const t = userKeyStore.get(req.auth.user.id, req.params.id)
  if (!t) {
    res.json(fail('密钥不存在'))
    return
  }
  res.json(ok(t.fullKey))
})

app.delete('/api/token/:id', requireAuth, async (req, res) => {
  try {
    const t = userKeyStore.get(req.auth.user.id, req.params.id)
    if (!t) {
      res.json(fail('密钥不存在'))
      return
    }
    if (t.fullKey && cpaCfg.managementKey) {
      await removeCpaApiKey(cpaCfg, t.fullKey)
    }
    userKeyStore.remove(req.auth.user.id, req.params.id)
    res.json(ok(true))
  } catch (err) {
    console.error('[cpa] delete key failed', err?.message || err)
    res.status(502).json(fail(err?.message || '删除 CPA 密钥失败'))
  }
})

app.get('/api/cpa/info', requireAuth, (_req, res) => {
  res.json(
    ok({
      api_base_url: cpaCfg.publicApiBaseUrl,
      demo_key_masked: cpaCfg.demoKey ? maskKey(cpaCfg.demoKey) : null,
      models_source: 'cpa:/v1/models',
      keys_source: 'cpa:/v0/management/api-keys',
      usage_source: cpaCfg.adminKey ? 'cpamp:/v0/management/usage' : null,
    }),
  )
})

app.get('/api/log/self', requireAuth, async (req, res) => {
  const p = Number(req.query.p || 1)
  const page_size = Number(req.query.page_size || 10)
  const tokens = userKeyStore.list(req.auth.user.id)
  const hashToName = new Map()
  const hashSet = new Set()
  for (const t of tokens) {
    if (!t.fullKey) continue
    const h = hashApiKey(t.fullKey)
    hashSet.add(h)
    hashToName.set(h, t.name || t.key)
  }

  if (!cpaCfg.adminKey) {
    res.json(ok({ items: [], total: 0, limited: true, note: 'CPAMP Admin Key 未配置；用量暂不可用。' }))
    return
  }
  if (!hashSet.size) {
    res.json(
      ok({
        items: [],
        total: 0,
        note: '创建并使用 API 密钥后，将从 CPAMP 汇总与你密钥相关的调用。',
      }),
    )
    return
  }
  try {
    const usage = await fetchCpampUsage(cpaCfg)
    const named = flattenUsageForHashes(usage, hashSet, { limit: 500, nameMap: hashToName })
    const startIdx = (p - 1) * page_size
    res.json(ok({ items: named.slice(startIdx, startIdx + page_size), total: named.length, source: 'cpamp' }))
  } catch (err) {
    console.error('[cpamp] usage failed', err?.message || err)
    res.json(ok({ items: [], total: 0, limited: true, note: `用量查询受限：${err?.message || 'CPAMP 不可用'}` }))
  }
})


app.get('/api/admin/me', requireAuth, (req, res) => {
  const admin = isAdminUser(req.auth.user, adminAllowlist)
  res.json(
    ok({
      is_admin: admin,
      user: {
        id: req.auth.user.id,
        username: req.auth.user.username,
        display_name: req.auth.user.display_name,
        email: req.auth.user.email || '',
        auth_provider: req.auth.user.auth_provider || 'linuxdo',
      },
      allowlist_configured:
        adminAllowlist.ids.size > 0 ||
        adminAllowlist.usernames.size > 0 ||
        adminAllowlist.emails.size > 0 ||
        (adminAllowlist.ailyUsernames && adminAllowlist.ailyUsernames.size > 0),
    }),
  )
})

app.get('/api/admin/overview', requireAdmin, async (_req, res) => {
  try {
    const [health, modelsProbe, usage, authFiles, keys] = await Promise.all([
      probeServiceHealth(cpaCfg).catch(() => null),
      probeCpaModels(cpaCfg).catch(() => ({ ok: false, models: [], latency_ms: 0 })),
      cpaCfg.adminKey ? fetchCpampUsageCached(cpaCfg).catch(() => null) : null,
      cpaCfg.adminKey ? fetchCpampAuthFilesCached(cpaCfg).catch(() => null) : null,
      cpaCfg.managementKey ? listCpaApiKeys(cpaCfg).catch(() => []) : [],
    ])
    const summary = usage ? summarizeUsage(usage) : null
    const accounts = authFiles ? mapAdminAccounts(authFiles) : []
    res.json(
      ok({
        checked_at: new Date().toISOString(),
        health,
        models: {
          ok: !!modelsProbe?.ok,
          count: modelsProbe?.models?.length || 0,
          latency_ms: modelsProbe?.latency_ms || null,
          error: modelsProbe?.error || null,
        },
        usage: summary
          ? {
              total_requests: summary.total_requests,
              success_count: summary.success_count,
              failure_count: summary.failure_count,
              total_tokens: summary.total_tokens,
            }
          : null,
        accounts: {
          total: accounts.length,
          active: accounts.filter((a) => !a.disabled && !a.unavailable).length,
          unavailable: accounts.filter((a) => a.unavailable || a.disabled).length,
        },
        api_keys: { total: Array.isArray(keys) ? keys.length : 0 },
        public_api_base: cpaCfg.publicApiBaseUrl,
      }),
    )
  } catch (err) {
    console.error('[admin] overview', err?.message || err)
    res.status(502).json(fail(err?.message || 'admin overview failed'))
  }
})

app.get('/api/admin/connection', requireAdmin, async (_req, res) => {
  try {
    const health = await probeServiceHealth(cpaCfg)
    const models = await probeCpaModels(cpaCfg)
    res.json(
      ok({
        checked_at: new Date().toISOString(),
        cpa_base: cpaCfg.cpaBaseUrl,
        billing_base: cpaCfg.billingBaseUrl,
        cpamp_base: cpaCfg.cpampBaseUrl,
        public_api_base: cpaCfg.publicApiBaseUrl,
        secrets: {
          demo: !!cpaCfg.demoKey,
          management: !!cpaCfg.managementKey,
          admin: !!cpaCfg.adminKey,
        },
        health,
        models: {
          ok: models.ok,
          count: models.models.length,
          latency_ms: models.latency_ms,
          base: models.base,
          error: models.error,
        },
      }),
    )
  } catch (err) {
    res.status(502).json(fail(err?.message || 'connection probe failed'))
  }
})

app.get('/api/admin/accounts', requireAdmin, async (_req, res) => {
  try {
    if (!cpaCfg.adminKey) {
      res.status(503).json(fail('CPAMP Admin Key 未配置'))
      return
    }
    const auth = await fetchCpampAuthFilesCached(cpaCfg, { force: true })
    res.json(
      ok({
        observed_at: auth?.observed_at || null,
        items: mapAdminAccounts(auth),
        source: 'cpamp:auth-files',
      }),
    )
  } catch (err) {
    console.error('[admin] accounts', err?.message || err)
    res.status(502).json(fail(err?.message || 'accounts failed'))
  }
})

app.get('/api/admin/usage', requireAdmin, async (_req, res) => {
  try {
    if (!cpaCfg.adminKey) {
      res.status(503).json(fail('CPAMP Admin Key 未配置'))
      return
    }
    const usage = await fetchCpampUsageCached(cpaCfg, { force: true })
    res.json(ok({ ...summarizeUsage(usage), source: 'cpamp' }))
  } catch (err) {
    console.error('[admin] usage', err?.message || err)
    res.status(502).json(fail(err?.message || 'usage failed'))
  }
})

app.get('/api/admin/keys', requireAdmin, async (_req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const keys = await listCpaApiKeys(cpaCfg)
    res.json(
      ok({
        items: keys.map((k, i) => ({
          id: i + 1,
          key: maskSecretValue(k),
          length: String(k).length,
        })),
        total: keys.length,
        note: '完整密钥不会返回到浏览器；增删通过服务端 Management Key 执行。',
      }),
    )
  } catch (err) {
    console.error('[admin] keys list', err?.message || err)
    res.status(502).json(fail(err?.message || 'keys list failed'))
  }
})

app.post('/api/admin/keys', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const key = String(req.body?.key || '').trim()
    if (!key || key.length < 8) {
      res.status(400).json(fail('请提供有效的 API Key'))
      return
    }
    await addCpaApiKey(cpaCfg, key)
    res.json(ok({ key: maskSecretValue(key), added: true }))
  } catch (err) {
    console.error('[admin] keys add', err?.message || err)
    res.status(502).json(fail(err?.message || 'add key failed'))
  }
})

app.delete('/api/admin/keys', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const key = String(req.body?.key || req.query?.key || '').trim()
    const masked = String(req.body?.masked || req.query?.masked || '').trim()
    const keys = await listCpaApiKeys(cpaCfg)
    let target = null
    if (key) {
      target = keys.find((k) => k === key) || null
    } else if (masked) {
      const matches = keys.filter((k) => maskSecretValue(k) === masked)
      if (matches.length === 1) target = matches[0]
      else if (matches.length > 1) {
        res.status(400).json(fail('匹配到多个密钥，请提供完整 key'))
        return
      }
    }
    if (!target) {
      res.status(404).json(fail('未找到要删除的密钥'))
      return
    }
    await removeCpaApiKey(cpaCfg, target)
    res.json(ok({ removed: maskSecretValue(target) }))
  } catch (err) {
    console.error('[admin] keys delete', err?.message || err)
    res.status(502).json(fail(err?.message || 'delete key failed'))
  }
})

app.get('/api/admin/constellation', requireAdmin, (_req, res) => {
  res.json(ok(siteContent.getAdminConstellation()))
})

app.put('/api/admin/constellation', requireAdmin, (req, res) => {
  try {
    const saved = siteContent.saveConstellation(req.body || {})
    res.json(ok({ ...saved, updated_at: siteContent.get().updated_at }))
  } catch (err) {
    res.status(400).json(fail(err?.message || '保存失败'))
  }
})

app.post('/api/admin/constellation/seed-from-models', requireAdmin, async (_req, res) => {
  try {
    const probe = await probeCpaModels(cpaCfg).catch(() => ({ ok: false, models: [] }))
    const ids = (probe.models || []).map((m) => m.id || m.name).filter(Boolean)
    // Force replace empty or allow admin explicit seed: overwrite cards from models
    const doc = siteContent.get()
    const cards = ids.slice(0, 24).map((mid, i) => ({
      id: mid,
      title: mid,
      status: '已上线',
      description: '',
      tags: [mid],
      model_ids: [mid],
      sort_order: (i + 1) * 10,
      enabled: true,
    }))
    const saved = siteContent.saveConstellation({
      eyebrow: doc.constellation.eyebrow,
      heading: doc.constellation.heading,
      lead: ids.length
        ? '以下条目由 CPA /v1/models 生成，可继续编辑文案与状态。'
        : doc.constellation.lead,
      cards: cards.length ? cards : doc.constellation.cards,
    })
    res.json(ok({ ...saved, updated_at: siteContent.get().updated_at, seeded: ids.length }))
  } catch (err) {
    res.status(502).json(fail(err?.message || '无法从 CPA 拉取模型'))
  }
})

app.get('/api/admin/config', requireAdmin, async (_req, res) => {
  try {
    if (!cpaCfg.adminKey) {
      res.status(503).json(fail('CPAMP Admin Key 未配置'))
      return
    }
    // Reuse cpamp via auth-files path style: fetch config through probeUrl with admin key
    const result = await probeUrl(`${cpaCfg.cpampBaseUrl}/v0/management/config`, {
      headers: { Authorization: `Bearer ${cpaCfg.adminKey}`, Accept: 'application/json' },
    })
    if (!result.ok) {
      res.status(502).json(fail(result.error || `config ${result.status}`))
      return
    }
    res.json(ok({ config: sanitizeConfig(result.body || {}), source: 'cpamp' }))
  } catch (err) {
    res.status(502).json(fail(err?.message || 'config failed'))
  }
})

app.use((req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/oauth/')) {
    res.status(404).json(fail('接口不存在'))
    return
  }
  res.status(404).end('Not Found')
})

app.listen(PORT, HOST, () => {
  console.log(`[server] listening on http://${HOST}:${PORT}`)
  console.log(`[server] redirect_uri=${REDIRECT_URI}`)
  console.log(`[server] client_id=${CLIENT_ID}`)
  console.log(`[server] public_api_base=${cpaCfg.publicApiBaseUrl}`)
  console.log(`[server] cpa=${cpaCfg.cpaBaseUrl} billing=${cpaCfg.billingBaseUrl} cpamp=${cpaCfg.cpampBaseUrl}`)
  console.log(
    `[server] secrets demo=${cpaCfg.demoKey ? 'yes' : 'no'} mgmt=${cpaCfg.managementKey ? 'yes' : 'no'} admin=${cpaCfg.adminKey ? 'yes' : 'no'}`,
  )
  console.log(
    `[server] admin allowlist ids=${adminAllowlist.ids.size} usernames=${adminAllowlist.usernames.size} emails=${adminAllowlist.emails.size} aily=${adminAllowlist.ailyUsernames?.size || 0}`,
  )
  console.log(`[server] aily_adapter=${AILY_ADAPTER_URL}`)
})
