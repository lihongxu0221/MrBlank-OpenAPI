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
  fetchCpaAuthFiles,
  fetchCpaAuthFilesCached,
  fetchCpaConfig,
  fetchCpaRequestLog,
  setCpaRequestLog,
  setOpenaiCompatibility,
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
  fetchOpenaiCompatibility,
  CPA_SETTING_FIELDS,
  CPA_PROVIDER_KEY_TYPES,
  CPA_OAUTH_AUTH_URLS,
  fetchCpaSetting,
  setCpaSetting,
  fetchCpaSettingsAll,
  listCpaProviderKeys,
  addCpaProviderKey,
  removeCpaProviderKey,
  matchMaskedProviderKey,
  setAuthFileDisabled,
  patchAuthFileFields,
  refreshAuthFile,
  deleteAuthFile,
  downloadAuthFile,
  uploadAuthFile,
  startCpaOAuth,
  getCpaAuthStatus,
  submitCpaOAuthCallback,
  fetchOauthModelAlias,
  setOauthModelAlias,
  fetchOauthExcludedModels,
  setOauthExcludedModels,
  fetchCpaPlugins,
  setCpaPlugins,
  fetchCpaLogs,
} from './cpa.js'
import { createSiteUsageStore } from './siteUsage.js'
import { createModelPricesStore } from './modelPrices.js'
import { createApiKeyAliasesStore } from './apiKeyAliases.js'
import { createAccountActionsStore } from './accountActions.js'
import { createCpaCollector } from './cpaCollector.js'
import { createUserKeyStore } from './userKeys.js'
import {
  loadAdminAllowlist,
  isAdminUser,
  sanitizeConfig,
  summarizeUsage,
  summarizeAccounts,
  mapAdminAccounts,
  maskSecretValue,
} from './admin.js'
import { createSiteContentStore } from './siteContent.js'
import { createGroupStore, CREDIT_UNIT_INFO } from './groups.js'
import { createCreditStore, shanghaiDay } from './credits.js'
import { createLocalUserStore } from './localUsers.js'
import { createDiagnosisStore } from './diagnosis.js'
import { createV1Proxy } from './v1Proxy.js'
import { createAilyManager, loadAilyConfig } from './aily.js'

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
const diagnosisStore = createDiagnosisStore(
  process.env.DIAGNOSIS_PATH || path.join(__dirname, 'data', 'diagnosis'),
)
const userKeyStore = createUserKeyStore(
  process.env.USER_KEYS_PATH || path.join(__dirname, 'data', 'user-keys.json'),
)
const siteUsage = createSiteUsageStore(
  process.env.SITE_USAGE_PATH || path.join(__dirname, 'data', 'site-usage.json'),
)
const modelPrices = createModelPricesStore(
  process.env.MODEL_PRICES_PATH || path.join(__dirname, 'data', 'model-prices.json'),
)
const apiKeyAliases = createApiKeyAliasesStore(
  process.env.API_KEY_ALIASES_PATH || path.join(__dirname, 'data', 'api-key-aliases.json'),
)
const accountActions = createAccountActionsStore(
  process.env.ACCOUNT_ACTIONS_PATH || path.join(__dirname, 'data', 'account-actions.json'),
)
const cpaCollector = createCpaCollector({
  intervalMs: Number(process.env.CPA_COLLECTOR_INTERVAL_MS || 20_000) || 20_000,
  fetchAuthFiles: (force) => fetchCpaAuthFilesCached(cpaCfg, { force: !!force }),
  mapPool: (payload) => mapAuthFilesToPoolItems(payload),
})
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
const ailyManager = createAilyManager(loadAilyConfig(process.env))
const COOKIE_NAME = 'mrblank_sid'
const STATE_TTL_MS = 10 * 60 * 1000
const SESSION_TTL_MS = 12 * 60 * 60 * 1000
const Q = 500_000
const groupStore = createGroupStore(
  process.env.USER_GROUPS_PATH || path.join(__dirname, 'data', 'user-groups.json'),
  { quotaUnit: Q },
)
const creditStore = createCreditStore(
  process.env.SITE_CREDITS_PATH || path.join(__dirname, 'data', 'site-credits.json'),
  { quotaUnit: Q },
)
const localUserStore = createLocalUserStore(
  process.env.LOCAL_USERS_PATH || path.join(__dirname, 'data', 'local-users.json'),
  process.env,
)
try {
  const boot = localUserStore.bootstrapFromEnv()
  if (boot.created) console.log(`[server] bootstrap admin created user=${boot.username}`)
  else if (boot.upgraded) console.log(`[server] bootstrap admin role upgraded user=${boot.username}`)
  else if (boot.reason === 'exists') console.log(`[server] bootstrap admin already present user=${boot.username}`)
  else console.log('[server] bootstrap admin skipped (BOOTSTRAP_ADMIN_USER/PASSWORD unset)')
} catch (e) {
  console.error('[server] bootstrap admin failed', e?.message || e)
}


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
  return shanghaiDay(offset)
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

function syncStoreFromCredits(store, userId) {
  try {
    const snap = creditStore.getUserSnapshot(userId)
    store.user.quota = snap.balance
    store.user.settled_quota = snap.consumed_total
    store.checkins = creditStore.listAllCheckins(userId)
  } catch {
    /* ignore */
  }
  return store
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
  syncStoreFromCredits(store, user.id)
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

function findSessionByAccessToken(token) {
  const t = String(token || '').trim()
  if (!t || t.length < 8) return null
  for (const rec of sessions.values()) {
    if (rec.access_token === t) return rec
  }
  return null
}

function getSession(req) {
  const sid = readSid(req)
  let rec = sid ? sessions.get(sid) : null
  if (!rec) {
    const auth = String(req.headers.authorization || '')
    const m = /^Bearer\s+(.+)$/i.exec(auth)
    if (m) rec = findSessionByAccessToken(m[1])
  }
  if (!rec) return null
  if (Date.now() - rec.createdAt > SESSION_TTL_MS) {
    sessions.delete(rec.sid)
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
      role: rec.user.role || null,
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
    const existing = userKeyStore.getProfile(user.id)
    const profile = userKeyStore.setProfile(user.id, {
      display_name: user.display_name,
      username: user.username,
      email: user.email,
    })
    groupStore.ensureUser(user.id, {
      joinedAt: existing?.created_at || profile?.created_at || new Date().toISOString(),
    })
    // Phase E: evaluate promotion rules on every login
    try {
      const store = getOrCreateUserStore(user)
      groupStore.resolveUserGroup(user.id, userGroupMetrics(user.id, store))
    } catch (e2) {
      console.error('[groups] promote-on-login failed', e2?.message || e2)
    }
  } catch (e) {
    console.error('[userKeys] setProfile failed', e?.message || e)
  }
  return rec
}

function postLoginPath(user) {
  return isAdminUser(user, adminAllowlist) ? '/admin' : '/console'
}

function userGroupMetrics(userId, store) {
  const profile = userKeyStore.getProfile(userId)
  const joined = profile?.created_at || profile?.updated_at
  let account_days = 0
  if (joined) {
    account_days = Math.max(0, Math.floor((Date.now() - new Date(joined).getTime()) / 86400000))
  }
  let lifetime = { request_count: 0, used_quota: 0 }
  try {
    lifetime = groupStore.lifetimeTotals(userId)
  } catch {
    /* ignore */
  }
  return {
    account_days,
    request_count: Math.max(Number(store?.user?.request_count || 0) || 0, lifetime.request_count || 0),
    used_quota: Math.max(Number(store?.user?.used_quota || 0) || 0, lifetime.used_quota || 0),
    checkins: (() => {
      try {
        return creditStore.checkinCount(userId)
      } catch {
        return Array.isArray(store?.checkins) ? store.checkins.length : 0
      }
    })(),
  }
}

/** Metrics for API-key path (may have no session store). */
function metricsForUserId(userId) {
  const store = userStores.get(String(userId)) || null
  return userGroupMetrics(userId, store)
}

function resolveAuthGroup(req) {
  const store = req.store || getOrCreateUserStore(req.auth.user)
  const metrics = userGroupMetrics(req.auth.user.id, store)
  return groupStore.resolveUserGroup(req.auth.user.id, metrics)
}



const probeHistory = [] // { checked_at, overall, latency_ms, model_count }
const PROBE_HISTORY_MAX = 48

function rememberProbe(entry) {
  probeHistory.unshift(entry)
  while (probeHistory.length > PROBE_HISTORY_MAX) probeHistory.pop()
}

function overallFromHealth(modelsOk, health, modelCount) {
  const cpaUp = !!(health?.cpa?.ok || health?.billing?.ok)
  // CPAMP is optional — do not degrade community/admin when it is down.
  if (!modelsOk && !cpaUp) return 'unavailable'
  if (!modelsOk) return 'degraded'
  if (modelCount === 0) return 'degraded'
  if (!cpaUp) return 'degraded'
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
    // CPAMP usage optional (latency hints only); site usage is authoritative for community stats
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
    source: 'cpa+billing',
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


/** Enrich site key hash map with local + session display names. */
function enrichHashToUserMap(hashMap) {
  if (!hashMap || !hashMap.size) return hashMap
  const localById = new Map()
  try {
    for (const u of localUserStore.listUsers()) {
      localById.set(String(u.id), u)
    }
  } catch {
    /* ignore */
  }
  for (const [h, meta] of hashMap) {
    const loc = localById.get(String(meta.userId))
    if (loc) {
      hashMap.set(h, {
        ...meta,
        display_name: meta.display_name || loc.display_name || '',
        username: meta.username || loc.username || '',
      })
    }
  }
  for (const rec of sessions.values()) {
    const uid = String(rec.user?.id || '')
    if (!uid) continue
    for (const [h, meta] of hashMap) {
      if (String(meta.userId) === uid) {
        hashMap.set(h, {
          ...meta,
          display_name: rec.user.display_name || meta.display_name,
          username: rec.user.username || meta.username,
        })
      }
    }
  }
  return hashMap
}

async function buildLeaderboard(period = 'today', sort = 'credits', p = 1) {
  try {
    const hashMap = enrichHashToUserMap(userKeyStore.hashToUserMap())
    const ranked = siteUsage.leaderboard({ period, sort, hashToUser: hashMap })
    const mapped = ranked.filter((r) => r.mapped).length
    const pageSize = 10
    const pageNum = Math.max(1, Number(p) || 1)
    const start = (pageNum - 1) * pageSize
    const emptyNote = hashMap.size
      ? ranked.length
        ? undefined
        : '本站密钥尚无调用记录；排行榜在有人通过本站 /v1 产生用量后出现。'
      : '本站尚未发放密钥；排行榜为空，直到有人在控制台创建密钥并产生用量。'
    return ok({
      items: ranked.slice(start, start + pageSize),
      total: ranked.length,
      mapped,
      unmapped: ranked.length - mapped,
      period,
      sort,
      page: pageNum,
      page_size: pageSize,
      source: 'site-usage',
      note: emptyNote,
      privacy_note:
        '仅统计经本站 /v1 代理、且密钥由本站控制台发放的调用。有昵称的显示 Linux.do / 本站名称；否则脱敏。',
    })
  } catch (err) {
    console.error('[welfare] leaderboard failed', err?.message || err)
    return ok({
      items: [],
      total: 0,
      period,
      sort,
      page: p,
      note: `排行榜暂不可用：${err?.message || 'site usage error'}`,
    })
  }
}

async function buildActivity(period = 'today') {
  try {
    const hashMap = userKeyStore.hashToUserMap()
    const items = siteUsage.activityByModel({ period })
    return ok({
      period,
      items,
      source: 'site-usage',
      note: hashMap.size
        ? items.length
          ? undefined
          : '本站密钥尚无模型调用；实况在有人通过本站 /v1 调用后出现。'
        : '本站尚未发放密钥；模型调用实况为空，直到控制台创建密钥并产生用量。',
    })
  } catch (err) {
    console.error('[welfare] activity failed', err?.message || err)
    return ok({ period, items: [], note: `调用实况暂不可用：${err?.message || 'site usage error'}` })
  }
}

async function buildPool() {
  if (!cpaCfg.managementKey) {
    return ok({ stale: true, items: [], note: 'CPA Management Key 未配置；号池暂不可用。' })
  }
  try {
    // Prefer collector cache; fall back to direct CPA fetch.
    let snap = cpaCollector.getPoolSnapshot()
    if (!snap.items.length) {
      await cpaCollector.refresh({ force: true })
      snap = cpaCollector.getPoolSnapshot()
    }
    if (!snap.items.length && snap.error) {
      // Last resort: direct fetch (bypass collector state)
      const auth = await fetchCpaAuthFilesCached(cpaCfg, { force: true })
      const items = mapAuthFilesToPoolItems(auth)
      return ok({
        stale: false,
        items,
        observed_at: auth?.observed_at || null,
        source: 'cpa:auth-files',
      })
    }
    return ok({
      stale: !!snap.stale,
      items: snap.items,
      observed_at: snap.observed_at || null,
      source: 'cpa:auth-files',
      note: snap.error && !snap.items.length ? `号池暂不可用：${snap.error}` : undefined,
    })
  } catch (err) {
    console.error('[welfare] pool failed', err?.message || err)
    return ok({ stale: true, items: [], note: `号池暂不可用：${err?.message || 'CPA 错误'}` })
  }
}

function publicHandlers() {
  return {
    status: () => ok({ quota_per_unit: Q, credit_unit: CREDIT_UNIT_INFO }),
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
    notices: (size = 50, page = 1) => {
      const all = [
        {
          id: 1,
          level: 'warning',
          title: '通用公告｜每日额度使用规则',
          content:
            '更新时间：以北京时间为准。\n\n每日签到领取额度，请尽快使用，不要囤积。\n\n额度仅用于本站模型调用，不可充值、提现，也不保证上游持续可用。\n\n请勿自动签到、批量账号、转售或共享密钥滥用资源。',
          createdAt: '2026-09-18T10:00:00.000Z',
          updatedAt: '2026-09-21T00:24:00.000Z',
        },
        {
          id: 2,
          level: 'info',
          title: '欢迎来到 MrBlank OpenAPI',
          content:
            '模型调用 Base URL：https://openapi.juc114.cn/v1\n\n支持本站账号注册登录与 Linux.do 社区登录。\n\n控制台可管理密钥、查看真实用量，并参与签到与兑换。',
          createdAt: '2026-09-10T01:00:00.000Z',
          updatedAt: '2026-09-10T01:00:00.000Z',
        },
      ]
      const pageSize = Math.min(Math.max(Number(size) || 10, 1), 50)
      const p = Math.max(Number(page) || 1, 1)
      const start = (p - 1) * pageSize
      const items = all.slice(start, start + pageSize)
      return ok({
        items,
        total: all.length,
        page: p,
        pageSize,
        timezone: 'Asia/Shanghai',
      })
    },
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
const v1ProxyEnabled = String(process.env.V1_PROXY_ENABLED || '1') !== '0'
app.use(
  '/v1',
  createV1Proxy({
    billingBaseUrl: cpaCfg.billingBaseUrl,
    store: diagnosisStore,
    enabled: v1ProxyEnabled,
    ailyRoute: {
      adapterUrl: ailyManager.cfg.adapterUrl,
      apiKey: ailyManager.cfg.adapterApiKey,
      match: (model) => ailyManager.modelMatches(model),
    },
    governance: {
      async enforce({ apiKey, model, isModelsList, isConsuming }) {
        // Unmapped keys (CPA demo / external) bypass site group rules.
        const owner = apiKey ? userKeyStore.findByApiKey(apiKey) : null
        if (!owner?.userId) return { allow: true }
        const userId = owner.userId
        const metrics = metricsForUserId(userId)
        const groupInfo = groupStore.resolveUserGroup(userId, metrics)
        let useSiteCredits = false

        if (isConsuming) {
          const quotaCheck = groupStore.assertQuotaAvailable(userId, metrics)
          if (!quotaCheck.ok) {
            // Phase F: site credits (check-in / redeem) act as overflow capacity
            let siteBal = 0
            try {
              siteBal = creditStore.getBalance(userId)
            } catch {
              siteBal = 0
            }
            if (siteBal <= 0) {
              return {
                allow: false,
                status: 429,
                code: quotaCheck.code || 'quota_exhausted',
                group_id: groupInfo.group?.id,
                headers: {
                  'x-mrblank-governance': quotaCheck.code || 'quota_exhausted',
                  'x-mrblank-group': groupInfo.group?.id || '',
                  'retry-after': quotaCheck.window === 'window_5h' ? '300' : '3600',
                },
                body: {
                  error: {
                    message: quotaCheck.message,
                    type: 'insufficient_quota',
                    code: quotaCheck.code || 'quota_exhausted',
                    param: quotaCheck.window || null,
                  },
                  group_id: groupInfo.group?.id,
                  remaining: quotaCheck.info?.remaining || groupInfo.remaining,
                  site_credits: siteBal,
                  credit_unit: CREDIT_UNIT_INFO,
                },
              }
            }
            useSiteCredits = true
            // allow via site credits; still enforce model allowlist below
          }
          // When group has a model allowlist, require an explicit model on consuming calls
          const allowlist = groupInfo.group?.model_ids || []
          if (allowlist.length && !String(model || '').trim()) {
            return {
              allow: false,
              status: 403,
              code: 'model_required',
              group_id: groupInfo.group?.id,
              headers: {
                'x-mrblank-governance': 'model_required',
                'x-mrblank-group': groupInfo.group?.id || '',
              },
              body: {
                error: {
                  message: '当前用户组限制了可用模型，请在请求中指定 model。',
                  type: 'forbidden',
                  code: 'model_required',
                  param: 'model',
                },
                group_id: groupInfo.group?.id,
                model_allowlist: allowlist,
              },
            }
          }
          if (model) {
            const modelCheck = groupStore.assertModelAllowed(groupInfo.group, model)
            if (!modelCheck.ok) {
              return {
                allow: false,
                status: 403,
                code: modelCheck.code || 'model_not_allowed',
                group_id: groupInfo.group?.id,
                headers: {
                  'x-mrblank-governance': 'model_not_allowed',
                  'x-mrblank-group': groupInfo.group?.id || '',
                },
                body: {
                  error: {
                    message: modelCheck.message,
                    type: 'forbidden',
                    code: 'model_not_allowed',
                    param: 'model',
                  },
                  group_id: groupInfo.group?.id,
                  model_allowlist: groupInfo.group?.model_ids || [],
                },
              }
            }
          }
        }
        return { allow: true, userId, groupInfo, useSiteCredits }
      },
      filterModelsBody(ctx, bodyText) {
        return groupStore.filterModelsResponseBody(bodyText, ctx.groupInfo?.group)
      },
      onComplete({ userId, status, usage, isConsuming, useSiteCredits, apiKey, requestedModel, endpoint }) {
        const okStatus = status >= 200 && status < 300
        // Always record site-scoped usage for community leaderboard / admin usage (incl. failures).
        try {
          const prompt = Number(usage?.prompt_tokens) || 0
          const completion = Number(usage?.completion_tokens) || 0
          siteUsage.recordEvent({
            userId: userId || null,
            keyHash: apiKey ? hashApiKey(apiKey) : null,
            model: requestedModel || usage?.model || null,
            endpoint: endpoint || null,
            success: okStatus,
            tokens: prompt + completion,
            prompt_tokens: prompt,
            completion_tokens: completion,
          })
        } catch (e) {
          console.error('[siteUsage] recordEvent failed', e?.message || e)
        }
        if (!userId || !isConsuming || !okStatus) return
        const tokens =
          (Number(usage?.prompt_tokens) || 0) + (Number(usage?.completion_tokens) || 0)
        const quota = Math.max(1, tokens) // at least 1 raw unit per successful call
        try {
          groupStore.recordUsage(userId, { quota, requests: 1 })
        } catch (e) {
          console.error('[groups] recordUsage failed', e?.message || e)
        }
        // Phase F: only deduct site credits when this call used overflow capacity
        if (useSiteCredits) {
          try {
            creditStore.consume(userId, quota)
          } catch (e) {
            console.error('[credits] consume failed', e?.message || e)
          }
        }
        const store = userStores.get(String(userId))
        if (store?.user) {
          store.user.request_count = (Number(store.user.request_count) || 0) + 1
          store.user.used_quota = (Number(store.user.used_quota) || 0) + quota
          syncStoreFromCredits(store, userId)
        }
        // Re-evaluate promotion after usage
        try {
          groupStore.resolveUserGroup(userId, metricsForUserId(userId))
        } catch {
          /* ignore */
        }
      },
    },
  }),
)

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
  res.json(pub.notices(Number(req.query.size || 50), Number(req.query.p || 1))),
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
    u.pathname = '/login'
    u.searchParams.set('oauth_error', reason)
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
    res.redirect(302, `${SITE_ORIGIN}${postLoginPath(user)}`)
  } catch (err) {
    console.error('[oauth] callback error', err?.message || err)
    return failRedirect('oauth_failed')
  }
})

app.get('/api/user/self', requireAuth, (req, res) => {
  syncStoreFromCredits(req.store, req.auth.user.id)
  const groupInfo = resolveAuthGroup(req)
  const snap = creditStore.getUserSnapshot(req.auth.user.id)
  res.json(
    ok({
      ...req.store.user,
      quota: snap.balance,
      granted_quota: snap.granted_total,
      consumed_site_quota: snap.consumed_total,
      checkin_count: snap.checkin_count,
      group_id: groupInfo.group?.id,
      group_name: groupInfo.group?.name,
      group_level: groupInfo.group?.level,
    }),
  )
})

app.get('/api/user/group', requireAuth, (req, res) => {
  res.json(ok(resolveAuthGroup(req)))
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
  const status = creditStore.getCheckinStatus(req.auth.user.id, mm)
  syncStoreFromCredits(req.store, req.auth.user.id)
  res.json(ok(status))
})

app.post('/api/user/checkin', requireAuth, (req, res) => {
  const result = creditStore.claimCheckin(req.auth.user.id)
  if (!result.ok) {
    res.json(fail(result.message || '签到失败'))
    return
  }
  syncStoreFromCredits(req.store, req.auth.user.id)
  // Re-evaluate promotion (checkin count may unlock next group)
  let group = null
  try {
    group = resolveAuthGroup(req)
  } catch {
    /* ignore */
  }
  res.json(
    ok({
      quota_awarded: result.quota_awarded,
      balance: result.balance,
      checkin_date: result.checkin_date,
      group,
    }),
  )
})

app.post('/api/user/topup', requireAuth, (req, res) => {
  const code = String(req.body?.key || '').trim()
  const result = creditStore.redeem(req.auth.user.id, code)
  if (!result.ok) {
    res.json(fail(result.message || '兑换失败'))
    return
  }
  syncStoreFromCredits(req.store, req.auth.user.id)
  // API historically returned awarded number directly
  res.json(ok(result.awarded))
})


function handleLocalPasswordLogin(req, res) {
  const username = String(req.body?.username || '').trim()
  const password = String(req.body?.password || '')
  if (!username || !password) {
    res.status(400).json(fail('请输入用户名和密码'))
    return
  }
  try {
    const pub = localUserStore.authenticate(username, password)
    const user = localUserStore.toSessionUser(pub)
    if (pub.group_id) {
      try {
        groupStore.assignMember(user.id, { group_id: pub.group_id, override: true })
      } catch (e) {
        console.error('[local-auth] group assign', e?.message || e)
      }
    }
    const rec = createUserSession(user)
    setSessionCookie(res, rec.sid)
    res.json(ok(sessionPayload(rec)))
  } catch (err) {
    const status = Number(err?.status) || 401
    res.status(status).json(fail(err?.message || '登录失败'))
  }
}

app.post('/api/auth/login', handleLocalPasswordLogin)
// Legacy path alias (no longer proxies to Aily adapter)
app.post('/api/auth/aily', handleLocalPasswordLogin)

app.post('/api/auth/register', (req, res) => {
  const username = String(req.body?.username || '').trim()
  const password = String(req.body?.password || '')
  const displayName = String(req.body?.display_name || '').trim()
  if (!username || !password) {
    res.status(400).json(fail('请输入用户名和密码'))
    return
  }
  try {
    // Public self-registration is always role=user (never admin).
    const pub = localUserStore.createUser({
      username,
      password,
      role: 'user',
      display_name: displayName || username,
    })
    const user = localUserStore.toSessionUser(pub)
    if (pub.group_id) {
      try {
        groupStore.assignMember(user.id, { group_id: pub.group_id, override: true })
      } catch (e) {
        console.error('[local-auth] group assign', e?.message || e)
      }
    }
    // createUserSession already ensures profile + group promotion metrics
    const rec = createUserSession(user)
    setSessionCookie(res, rec.sid)
    res.status(201).json(ok(sessionPayload(rec)))
  } catch (err) {
    const status = Number(err?.status) || 400
    res.status(status).json(fail(err?.message || '注册失败'))
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
    const groupInfo = resolveAuthGroup(req)
    const quotaCheck = groupStore.assertQuotaAvailable(
      req.auth.user.id,
      userGroupMetrics(req.auth.user.id, req.store),
    )
    if (!quotaCheck.ok) {
      res.status(429).json(fail(quotaCheck.message))
      return
    }
    const body = req.body || {}
    const fullKey = `sk-mrblank-${req.auth.user.id}-${randomToken(12)}`
    await addCpaApiKey(cpaCfg, fullKey)
    const modelLimits =
      body.model_limits || groupStore.modelLimitsString(groupInfo.group) || ''
    const item = userKeyStore.create(req.auth.user.id, {
      name: String(body.name || 'key'),
      key: maskKey(fullKey),
      fullKey,
      status: 1,
      unlimited_quota: body.unlimited_quota !== false,
      remain_quota: body.remain_quota ?? 0,
      expired_time: body.expired_time ?? -1,
      model_limits: modelLimits,
      access_group_id: 1,
      group: groupInfo.group?.id || body.group || 'default',
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

app.get('/api/token/options', requireAuth, async (req, res) => {
  try {
    const allModels = await fetchCpaModels(cpaCfg)
    const groupInfo = resolveAuthGroup(req)
    const model_details = groupStore.filterModels(allModels, groupInfo.group)
    res.json(
      ok({
        groups: [
          {
            id: groupInfo.group?.id || 1,
            name: groupInfo.group?.name || 'default',
            is_default: true,
            ratio: 1,
            level: groupInfo.group?.level,
          },
        ],
        model_details,
        model_allowlist: groupInfo.group?.model_ids || [],
        api_base_url: cpaCfg.publicApiBaseUrl,
        source: 'cpa',
        filtered: !!(groupInfo.group?.model_ids || []).length,
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
    try {
      groupStore.syncUsageFromLogs(req.auth.user.id, named)
      // keep in-memory store counters loosely aligned for promotion metrics
      const reqCount = named.length
      const usedTokens = named.reduce(
        (s, r) => s + (Number(r.total_tokens ?? (r.prompt_tokens || 0) + (r.completion_tokens || 0)) || 0),
        0,
      )
      req.store.user.request_count = Math.max(Number(req.store.user.request_count || 0), reqCount)
      req.store.user.used_quota = Math.max(Number(req.store.user.used_quota || 0), usedTokens)
    } catch (e) {
      console.error('[groups] sync usage failed', e?.message || e)
    }
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
        role: req.auth.user.role || null,
      },
      ops_note:
        'www CPAMP = full ops; openapi /admin = MrBlank-styled CPAMP capability subset (no embed).',
      allowlist_configured:
        adminAllowlist.ids.size > 0 ||
        adminAllowlist.usernames.size > 0 ||
        adminAllowlist.emails.size > 0 ||
        (adminAllowlist.localUsernames && adminAllowlist.localUsernames.size > 0),
      allowlist_hint: {
        env_keys: [
          'ADMIN_LINUXDO_IDS',
          'ADMIN_LINUXDO_USERNAMES',
          'ADMIN_LINUXDO_EMAILS',
          'ADMIN_LOCAL_USERNAMES',
        ],
        note: '多管理员：在服务端 .env 配置上述变量（逗号分隔），或将本站用户 role 设为 admin。完整运维仍用 www CPAMP。',
        counts: {
          linuxdo_ids: adminAllowlist.ids.size,
          linuxdo_usernames: adminAllowlist.usernames.size,
          linuxdo_emails: adminAllowlist.emails.size,
          local_usernames: adminAllowlist.localUsernames?.size || 0,
        },
      },
    }),
  )
})

app.get('/api/admin/overview', requireAdmin, async (_req, res) => {
  try {
    const [health, modelsProbe, authFiles, keys] = await Promise.all([
      probeServiceHealth(cpaCfg).catch(() => null),
      probeCpaModels(cpaCfg).catch(() => ({ ok: false, models: [], latency_ms: 0 })),
      cpaCfg.managementKey
        ? fetchCpaAuthFilesCached(cpaCfg).catch(() => null)
        : Promise.resolve(null),
      cpaCfg.managementKey ? listCpaApiKeys(cpaCfg).catch(() => []) : [],
    ])
    const summary = siteUsage.summarize({ period: 'all' })
    const accounts = authFiles ? mapAdminAccounts(authFiles) : []
    const collector = cpaCollector.getStatus()
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
        usage: {
          total_requests: summary.total_requests,
          success_count: summary.success_count,
          failure_count: summary.failure_count,
          total_tokens: summary.total_tokens,
        },
        accounts: {
          total: accounts.length,
          active: accounts.filter((a) => !a.disabled && !a.unavailable).length,
          unavailable: accounts.filter((a) => a.unavailable || a.disabled).length,
        },
        api_keys: { total: Array.isArray(keys) ? keys.length : 0 },
        public_api_base: cpaCfg.publicApiBaseUrl,
        pool: summarizeAccounts(accounts),
        collector,
        ops: {
          www_cpamp: 'https://www.juc114.cn/management.html',
          openapi_admin: 'https://openapi.juc114.cn/admin',
          note: 'CPA management key is primary. CPAMP is optional. Usage is site-scoped (BFF /v1).',
        },
      }),
    )
  } catch (err) {
    console.error('[admin] overview', err?.message || err)
    res.status(502).json(fail(err?.message || 'admin overview failed'))
  }
})

app.get('/api/admin/connection', requireAdmin, async (_req, res) => {
  try {
    const started = Date.now()
    const health = await probeServiceHealth(cpaCfg)
    const cpaLatency = Date.now() - started
    const models = await probeCpaModels(cpaCfg)
    const ailyAdapter = await ailyManager.testAdapterModels().catch((e) => ({
      ok: false,
      message: e?.message || String(e),
    }))
    const ailyStatus = ailyManager.publicStatus()
    const collector = cpaCollector.getStatus()
    res.json(
      ok({
        checked_at: new Date().toISOString(),
        cpa_base: cpaCfg.cpaBaseUrl,
        billing_base: cpaCfg.billingBaseUrl,
        cpamp_base: cpaCfg.cpampBaseUrl,
        public_api_base: cpaCfg.publicApiBaseUrl,
        aily_adapter_url: ailyStatus.adapter_url,
        secrets: {
          demo: !!cpaCfg.demoKey,
          management: !!cpaCfg.managementKey,
          admin: !!cpaCfg.adminKey,
          aily_adapter_key: !!ailyStatus.adapter_api_key_configured,
        },
        health,
        cpa_latency_ms: health?.cpa?.latency_ms ?? cpaLatency,
        collector,
        models: {
          ok: models.ok,
          count: models.models.length,
          latency_ms: models.latency_ms,
          base: models.base,
          error: models.error,
        },
        aily: {
          ok: !!ailyAdapter.ok,
          message: ailyAdapter.message || null,
          model_count: Array.isArray(ailyAdapter.models) ? ailyAdapter.models.length : 0,
          latency_ms: ailyAdapter.latency_ms || null,
          model_routes: ailyStatus.model_routes,
          has_access_token: ailyStatus.has_access_token,
        },
        note: 'CPA + billing are primary. CPAMP is optional and not required for pool/accounts/config.',
      }),
    )
  } catch (err) {
    res.status(502).json(fail(err?.message || 'connection probe failed'))
  }
})

app.get('/api/admin/accounts', requireAdmin, async (_req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    await cpaCollector.refresh({ force: true })
    let auth = cpaCollector.getAuthFilesPayload()
    if (!auth) {
      auth = await fetchCpaAuthFilesCached(cpaCfg, { force: true })
    }
    const items = mapAdminAccounts(auth)
    res.json(
      ok({
        observed_at: auth?.observed_at || cpaCollector.getStatus().lastSync || null,
        items,
        pool: summarizeAccounts(items),
        source: 'cpa:auth-files',
        collector: cpaCollector.getStatus(),
      }),
    )
  } catch (err) {
    console.error('[admin] accounts', err?.message || err)
    res.status(502).json(fail(err?.message || 'accounts failed'))
  }
})

app.get('/api/admin/usage', requireAdmin, async (_req, res) => {
  try {
    const summary = siteUsage.summarize({ period: 'all' })
    res.json(
      ok({
        ...summary,
        source: 'site-usage',
        note: '用量来自本站 BFF /v1 记录，不是 CPAMP 全局 usage。无本站密钥调用时为空。',
        stats: siteUsage.stats(),
      }),
    )
  } catch (err) {
    console.error('[admin] usage', err?.message || err)
    res.status(502).json(fail(err?.message || 'usage failed'))
  }
})

app.get('/api/admin/diagnosis/logs', requireAdmin, (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50))
    const offset = Math.max(0, Number(req.query.offset) || 0)
    const q = String(req.query.q || '')
    const result = diagnosisStore.list({ limit, offset, q })
    res.json(
      ok({
        ...result,
        stats: diagnosisStore.stats(),
        note: 'Bodies only on detail endpoint. CPAMP usage has no req/res bodies — capture requires /v1 via BFF.',
      }),
    )
  } catch (err) {
    console.error('[admin] diagnosis list', err?.message || err)
    res.status(500).json(fail(err?.message || 'diagnosis list failed'))
  }
})

app.get('/api/admin/diagnosis/logs/:id', requireAdmin, (req, res) => {
  try {
    const rec = diagnosisStore.get(req.params.id)
    if (!rec) {
      res.status(404).json(fail('记录不存在'))
      return
    }
    res.json(ok(rec))
  } catch (err) {
    console.error('[admin] diagnosis detail', err?.message || err)
    res.status(500).json(fail(err?.message || 'diagnosis detail failed'))
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
    let key = String(req.body?.key || '').trim()
    const generate = !!req.body?.generate
    if (generate && !key) {
      key = `sk-${crypto.randomBytes(24).toString('hex')}`
    }
    if (!key || key.length < 8) {
      res.status(400).json(fail('请提供有效的 API Key，或传 generate:true'))
      return
    }
    await addCpaApiKey(cpaCfg, key)
    // Only return full key once when newly generated; otherwise mask.
    res.json(
      ok({
        key: generate ? key : maskSecretValue(key),
        masked: maskSecretValue(key),
        added: true,
        generated: generate,
      }),
    )
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


app.get('/api/admin/groups', requireAdmin, (_req, res) => {
  res.json(ok({ groups: groupStore.listGroups(), updated_at: null, quota_unit: Q, credit_unit: CREDIT_UNIT_INFO }))
})

app.put('/api/admin/groups', requireAdmin, (req, res) => {
  try {
    const groups = groupStore.saveGroups(req.body?.groups || req.body)
    res.json(ok({ groups, quota_unit: Q }))
  } catch (err) {
    res.status(400).json(fail(err?.message || '保存用户组失败'))
  }
})

app.get('/api/admin/groups/members', requireAdmin, (_req, res) => {
  const members = groupStore.listMembers().map((m) => {
    const profile = userKeyStore.getProfile(m.user_id) || {}
    return {
      ...m,
      display_name: profile.display_name || '',
      username: profile.username || '',
      email: profile.email || '',
    }
  })
  res.json(ok({ members, groups: groupStore.listGroups() }))
})

app.put('/api/admin/groups/members/:userId', requireAdmin, (req, res) => {
  try {
    const row = groupStore.assignMember(req.params.userId, {
      group_id: req.body?.group_id,
      override: req.body?.override !== false,
    })
    res.json(ok(row))
  } catch (err) {
    res.status(400).json(fail(err?.message || '分配用户组失败'))
  }
})

app.get('/api/admin/credits', requireAdmin, (_req, res) => {
  res.json(ok(creditStore.adminSummary()))
})

app.put('/api/admin/credits/config', requireAdmin, (req, res) => {
  try {
    const body = req.body || {}
    const cfg = creditStore.saveConfig({
      checkin_enabled: body.checkin_enabled,
      daily_grant_min: body.daily_grant_min,
      daily_grant_max: body.daily_grant_max,
      note: body.note,
    })
    res.json(ok(cfg))
  } catch (err) {
    res.status(400).json(fail(err?.message || '保存失败'))
  }
})

app.put('/api/admin/credits/codes', requireAdmin, (req, res) => {
  try {
    const codes = creditStore.saveCodes(req.body?.codes || req.body || [])
    res.json(ok({ codes }))
  } catch (err) {
    res.status(400).json(fail(err?.message || '保存失败'))
  }
})

app.post('/api/admin/credits/codes', requireAdmin, (req, res) => {
  try {
    const code = creditStore.upsertCode(req.body || {})
    res.json(ok(code))
  } catch (err) {
    res.status(400).json(fail(err?.message || '保存失败'))
  }
})

app.delete('/api/admin/credits/codes/:code', requireAdmin, (req, res) => {
  try {
    creditStore.deleteCode(req.params.code)
    res.json(ok(true))
  } catch (err) {
    res.status(400).json(fail(err?.message || '删除失败'))
  }
})

app.post('/api/admin/credits/grant', requireAdmin, (req, res) => {
  try {
    const userId = String(req.body?.user_id || '').trim()
    const amount = Number(req.body?.amount)
    if (!userId) {
      res.status(400).json(fail('需要 user_id'))
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json(fail('amount 须为正数（内部单位）'))
      return
    }
    const result = creditStore.adminGrant(userId, amount, String(req.body?.note || ''))
    res.json(ok(result))
  } catch (err) {
    res.status(400).json(fail(err?.message || '发放失败'))
  }
})


app.get('/api/admin/users', requireAdmin, (_req, res) => {
  res.json(ok({ users: localUserStore.listUsers() }))
})

app.post('/api/admin/users', requireAdmin, (req, res) => {
  try {
    const created = localUserStore.createUser({
      username: req.body?.username,
      password: req.body?.password,
      role: req.body?.role,
      display_name: req.body?.display_name,
      group_id: req.body?.group_id,
    })
    if (created.group_id) {
      try {
        groupStore.assignMember(created.id, { group_id: created.group_id, override: true })
      } catch (e) {
        console.error('[admin-users] group assign', e?.message || e)
      }
    }
    res.json(ok({ user: created }))
  } catch (err) {
    res.status(Number(err?.status) || 400).json(fail(err?.message || '创建用户失败'))
  }
})

app.put('/api/admin/users/:id', requireAdmin, (req, res) => {
  try {
    const updated = localUserStore.updateUser(req.params.id, {
      display_name: req.body?.display_name,
      role: req.body?.role,
      group_id: req.body?.group_id,
      disabled: req.body?.disabled,
    })
    if (req.body?.group_id !== undefined) {
      try {
        if (updated.group_id) {
          groupStore.assignMember(updated.id, { group_id: updated.group_id, override: true })
        }
      } catch (e) {
        console.error('[admin-users] group assign', e?.message || e)
      }
    }
    res.json(ok({ user: updated }))
  } catch (err) {
    res.status(Number(err?.status) || 400).json(fail(err?.message || '更新用户失败'))
  }
})

app.post('/api/admin/users/:id/password', requireAdmin, (req, res) => {
  try {
    const updated = localUserStore.resetPassword(req.params.id, req.body?.password)
    res.json(ok({ user: updated }))
  } catch (err) {
    res.status(Number(err?.status) || 400).json(fail(err?.message || '重置密码失败'))
  }
})

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  try {
    // Prevent deleting self
    if (req.auth.user.id === req.params.id) {
      res.status(400).json(fail('不能删除当前登录账号'))
      return
    }
    localUserStore.deleteUser(req.params.id)
    res.json(ok(true))
  } catch (err) {
    res.status(Number(err?.status) || 400).json(fail(err?.message || '删除用户失败'))
  }
})


app.get('/api/admin/aily/status', requireAdmin, async (_req, res) => {
  try {
    let openaiCompat = []
    try {
      if (cpaCfg.managementKey) openaiCompat = await fetchOpenaiCompatibility(cpaCfg)
    } catch (e) {
      openaiCompat = { error: e?.message || String(e) }
    }
    res.json(
      ok({
        ...ailyManager.publicStatus(),
        cpa_openai_compatibility: openaiCompat,
        architecture: {
          primary: 'client → openapi /v1 → BFF → CPA billing :8320 → CPA',
          aily_credentials: 'shared .aily auth file + upstream APIs (not site login)',
          selective_route: 'AILY_MODEL_ROUTES → BFF → aily :8088 (optional)',
          cpa_aily_catalog:
            'CPA openai-compatibility can point at host aily only if Docker can reach :8088 (currently blocked on 172.17.0.1)',
        },
      }),
    )
  } catch (err) {
    console.error('[admin] aily status', err?.message || err)
    res.status(500).json(fail(err?.message || 'aily status failed'))
  }
})

app.post('/api/admin/aily/test', requireAdmin, async (_req, res) => {
  try {
    const [upstream, adapter] = await Promise.all([
      ailyManager.testUpstreamMe().catch((e) => ({ ok: false, message: e?.message || String(e) })),
      ailyManager.testAdapterModels().catch((e) => ({ ok: false, message: e?.message || String(e) })),
    ])
    res.json(ok({ upstream, adapter }))
  } catch (err) {
    res.status(502).json(fail(err?.message || 'aily test failed'))
  }
})

app.post('/api/admin/aily/send-code', requireAdmin, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim()
    if (!email) return res.status(400).json(fail('email required'))
    const result = await ailyManager.sendEmailCode(email, req.body?.aily_base_url)
    res.status(result.ok ? 200 : result.status || 400).json(result.ok ? ok(result) : fail(result.message))
  } catch (err) {
    res.status(502).json(fail(err?.message || 'send-code failed'))
  }
})

app.post('/api/admin/aily/login', requireAdmin, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim()
    const code = String(req.body?.code || '').trim()
    if (!email || !code) return res.status(400).json(fail('email and code required'))
    const result = await ailyManager.emailCodeLogin(email, code, req.body?.aily_base_url)
    res.status(result.ok ? 200 : 401).json(result.ok ? ok(result) : fail(result.message))
  } catch (err) {
    res.status(502).json(fail(err?.message || 'aily login failed'))
  }
})

app.post('/api/admin/aily/tokens', requireAdmin, (req, res) => {
  try {
    const result = ailyManager.saveTokens(req.body || {})
    res.status(result.ok ? 200 : 400).json(result.ok ? ok(result) : fail(result.message))
  } catch (err) {
    res.status(500).json(fail(err?.message || 'save tokens failed'))
  }
})

app.post('/api/admin/aily/refresh', requireAdmin, async (_req, res) => {
  try {
    const result = await ailyManager.refreshToken()
    res.status(result.ok ? 200 : 400).json(result.ok ? ok(result) : fail(result.message))
  } catch (err) {
    res.status(502).json(fail(err?.message || 'refresh failed'))
  }
})

app.post('/api/admin/aily/logout', requireAdmin, (_req, res) => {
  try {
    res.json(ok(ailyManager.clearTokens()))
  } catch (err) {
    res.status(500).json(fail(err?.message || 'clear failed'))
  }
})

app.get('/api/admin/aily/adapter-models', requireAdmin, async (_req, res) => {
  try {
    const result = await ailyManager.testAdapterModels()
    res.status(result.ok ? 200 : 502).json(result.ok ? ok(result) : fail(result.message))
  } catch (err) {
    res.status(502).json(fail(err?.message || 'adapter models failed'))
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
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const raw = await fetchCpaConfig(cpaCfg)
    let requestLog = null
    try {
      requestLog = await fetchCpaRequestLog(cpaCfg)
    } catch {
      requestLog = null
    }
    res.json(
      ok({
        config: sanitizeConfig(raw || {}),
        request_log: requestLog,
        source: 'cpa',
        writable: {
          request_log: true,
          openai_compatibility: true,
          note: 'Full config PUT / config.yaml write is not exposed; use /api/admin/settings field endpoints + providers + openai-compatibility.',
        },
      }),
    )
  } catch (err) {
    res.status(502).json(fail(err?.message || 'config failed'))
  }
})

app.get('/api/admin/request-log', requireAdmin, async (_req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const rl = await fetchCpaRequestLog(cpaCfg)
    res.json(ok({ ...rl, source: 'cpa' }))
  } catch (err) {
    res.status(502).json(fail(err?.message || 'request-log failed'))
  }
})

app.put('/api/admin/request-log', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const enabled = !!(req.body?.enabled ?? req.body?.value ?? req.body?.['request-log'])
    await setCpaRequestLog(cpaCfg, enabled)
    const rl = await fetchCpaRequestLog(cpaCfg)
    res.json(ok({ ...rl, source: 'cpa' }))
  } catch (err) {
    res.status(502).json(fail(err?.message || 'request-log update failed'))
  }
})

app.get('/api/admin/openai-compatibility', requireAdmin, async (_req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const items = await fetchOpenaiCompatibility(cpaCfg)
    res.json(ok({ items, source: 'cpa' }))
  } catch (err) {
    res.status(502).json(fail(err?.message || 'openai-compatibility failed'))
  }
})

app.put('/api/admin/openai-compatibility', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const entries = Array.isArray(req.body?.items)
      ? req.body.items
      : Array.isArray(req.body)
        ? req.body
        : Array.isArray(req.body?.['openai-compatibility'])
          ? req.body['openai-compatibility']
          : null
    if (!entries) {
      res.status(400).json(fail('body must be an array or { items: [] }'))
      return
    }
    // CPA expects the raw array as PUT body.
    await setOpenaiCompatibility(cpaCfg, entries)
    const items = await fetchOpenaiCompatibility(cpaCfg)
    res.json(ok({ items, source: 'cpa' }))
  } catch (err) {
    res.status(502).json(fail(err?.message || 'openai-compatibility update failed'))
  }
})


/* ═══════════════ Wave A — CPA-native settings / providers / accounts mutate / oauth / plugins / logs ═══════════════ */

app.get('/api/admin/settings', requireAdmin, async (_req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const data = await fetchCpaSettingsAll(cpaCfg)
    res.json(ok({ ...data, fields: CPA_SETTING_FIELDS, source: 'cpa' }))
  } catch (err) {
    res.status(err?.status || 502).json(fail(err?.message || 'settings failed'))
  }
})

app.get('/api/admin/settings/:field', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const field = String(req.params.field || '')
    const row = await fetchCpaSetting(cpaCfg, field)
    res.json(ok({ ...row, source: 'cpa' }))
  } catch (err) {
    res.status(err?.status || 502).json(fail(err?.message || 'setting get failed'))
  }
})

app.put('/api/admin/settings/:field', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const field = String(req.params.field || '')
    if (!CPA_SETTING_FIELDS.includes(field)) {
      res.status(400).json(fail(`unsupported setting: ${field}`))
      return
    }
    let value = req.body?.value
    if (value === undefined) value = req.body?.[field]
    if (value === undefined) value = req.body?.enabled
    if (field === 'proxy-url') {
      value = value == null ? '' : String(value)
    } else if (field === 'logs-max-total-size-mb') {
      value = Number(value)
      if (!Number.isFinite(value) || value < 0) {
        res.status(400).json(fail('logs-max-total-size-mb must be a non-negative number'))
        return
      }
    } else {
      value = !!value
    }
    const row = await setCpaSetting(cpaCfg, field, value)
    // Keep legacy request-log shape in sync
    if (field === 'request-log') {
      res.json(ok({ ...row, enabled: !!row.value, source: 'cpa' }))
      return
    }
    res.json(ok({ ...row, source: 'cpa' }))
  } catch (err) {
    res.status(err?.status || 502).json(fail(err?.message || 'setting update failed'))
  }
})

app.get('/api/admin/providers', requireAdmin, async (_req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const types = {}
    for (const type of CPA_PROVIDER_KEY_TYPES) {
      try {
        const listed = await listCpaProviderKeys(cpaCfg, type)
        types[type] = { items: listed.items, count: listed.count }
      } catch (err) {
        types[type] = { items: [], count: 0, error: err?.message || String(err) }
      }
    }
    res.json(ok({ types, type_list: CPA_PROVIDER_KEY_TYPES, source: 'cpa' }))
  } catch (err) {
    res.status(err?.status || 502).json(fail(err?.message || 'providers failed'))
  }
})

app.get('/api/admin/providers/:type', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const type = String(req.params.type || '')
    const listed = await listCpaProviderKeys(cpaCfg, type)
    res.json(ok({ type, items: listed.items, count: listed.count, source: 'cpa' }))
  } catch (err) {
    res.status(err?.status || 502).json(fail(err?.message || 'provider list failed'))
  }
})

app.post('/api/admin/providers/:type', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const type = String(req.params.type || '')
    const apiKey = String(req.body?.['api-key'] || req.body?.api_key || req.body?.key || '').trim()
    if (!apiKey) {
      res.status(400).json(fail('api-key required'))
      return
    }
    const extra = {}
    if (req.body?.['base-url'] || req.body?.base_url) extra['base-url'] = req.body['base-url'] || req.body.base_url
    if (req.body?.['proxy-url'] || req.body?.proxy_url) extra['proxy-url'] = req.body['proxy-url'] || req.body.proxy_url
    const listed = await addCpaProviderKey(cpaCfg, type, apiKey, extra)
    res.json(
      ok({
        type,
        items: listed.items,
        count: listed.count,
        added: maskSecretValue(apiKey),
        source: 'cpa',
      }),
    )
  } catch (err) {
    res.status(err?.status || 502).json(fail(err?.message || 'provider add failed'))
  }
})

app.delete('/api/admin/providers/:type', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const type = String(req.params.type || '')
    const exact = String(req.body?.['api-key'] || req.body?.api_key || req.body?.key || '').trim()
    const masked = String(req.body?.masked || req.query?.masked || '').trim()
    let target = exact
    if (!target && masked) {
      const listed = await listCpaProviderKeys(cpaCfg, type)
      target = matchMaskedProviderKey(listed._raw, masked)
      if (!target) {
        res.status(404).json(fail('未找到匹配的密钥（脱敏匹配失败，请用完整 api-key 删除）'))
        return
      }
    }
    if (!target) {
      res.status(400).json(fail('api-key or masked required'))
      return
    }
    const listed = await removeCpaProviderKey(cpaCfg, type, target)
    res.json(ok({ type, items: listed.items, count: listed.count, source: 'cpa' }))
  } catch (err) {
    res.status(err?.status || 502).json(fail(err?.message || 'provider delete failed'))
  }
})

app.patch('/api/admin/accounts/status', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const name = String(req.body?.name || '').trim()
    if (!name) {
      res.status(400).json(fail('name required'))
      return
    }
    const disabled = !!(req.body?.disabled ?? req.body?.value)
    const result = await setAuthFileDisabled(cpaCfg, name, disabled)
    try {
      await cpaCollector.refresh({ force: true })
    } catch {
      /* ignore */
    }
    res.json(ok({ name, disabled, result, source: 'cpa' }))
  } catch (err) {
    res.status(err?.status || 502).json(fail(err?.message || 'account status update failed'))
  }
})

app.patch('/api/admin/accounts/fields', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const name = String(req.body?.name || '').trim()
    if (!name) {
      res.status(400).json(fail('name required'))
      return
    }
    const fields = {}
    if (req.body?.note !== undefined) fields.note = String(req.body.note)
    if (req.body?.priority !== undefined) fields.priority = Number(req.body.priority)
    if (req.body?.disabled !== undefined) fields.disabled = !!req.body.disabled
    const result = await patchAuthFileFields(cpaCfg, name, fields)
    try {
      await cpaCollector.refresh({ force: true })
    } catch {
      /* ignore */
    }
    res.json(ok({ name, fields, result, source: 'cpa' }))
  } catch (err) {
    res.status(err?.status || 502).json(fail(err?.message || 'account fields update failed'))
  }
})

app.post('/api/admin/accounts/refresh', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const name = String(req.body?.name || '').trim()
    if (!name) {
      res.status(400).json(fail('name required'))
      return
    }
    const result = await refreshAuthFile(cpaCfg, name)
    try {
      await cpaCollector.refresh({ force: true })
    } catch {
      /* ignore */
    }
    res.json(ok({ name, result, source: 'cpa' }))
  } catch (err) {
    res.status(err?.status || 502).json(fail(err?.message || 'account refresh failed'))
  }
})

app.get('/api/admin/accounts/download', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const name = String(req.query?.name || '').trim()
    if (!name) {
      res.status(400).json(fail('name required'))
      return
    }
    const data = await downloadAuthFile(cpaCfg, name)
    // Return full content to admin only; never cache.
    res.setHeader('Cache-Control', 'no-store')
    res.json(ok({ name, content: data, source: 'cpa', warning: 'Contains secrets — do not share.' }))
  } catch (err) {
    res.status(err?.status || 502).json(fail(err?.message || 'account download failed'))
  }
})

app.post('/api/admin/accounts/upload', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const filename = String(req.body?.filename || req.body?.name || '').trim()
    let content = req.body?.content
    if (content && typeof content === 'object') content = JSON.stringify(content)
    content = String(content || '')
    if (!filename || !content) {
      res.status(400).json(fail('filename and content required'))
      return
    }
    const result = await uploadAuthFile(cpaCfg, { filename, content })
    try {
      await cpaCollector.refresh({ force: true })
    } catch {
      /* ignore */
    }
    res.json(ok({ filename, result, source: 'cpa' }))
  } catch (err) {
    res.status(err?.status || 502).json(fail(err?.message || 'account upload failed'))
  }
})

app.delete('/api/admin/accounts', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const name = String(req.body?.name || req.query?.name || '').trim()
    if (!name) {
      res.status(400).json(fail('name required'))
      return
    }
    const result = await deleteAuthFile(cpaCfg, name)
    try {
      await cpaCollector.refresh({ force: true })
    } catch {
      /* ignore */
    }
    res.json(ok({ name, result, source: 'cpa' }))
  } catch (err) {
    res.status(err?.status || 502).json(fail(err?.message || 'account delete failed'))
  }
})

app.get('/api/admin/oauth/providers', requireAdmin, (_req, res) => {
  res.json(
    ok({
      providers: CPA_OAUTH_AUTH_URLS.map((p) => ({
        id: p.replace(/-auth-url$/, ''),
        path: p,
      })),
      source: 'cpa',
    }),
  )
})

app.post('/api/admin/oauth/start/:provider', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    let provider = String(req.params.provider || '').trim()
    if (!provider.endsWith('-auth-url')) provider = `${provider}-auth-url`
    const data = await startCpaOAuth(cpaCfg, provider)
    res.json(ok({ provider, ...data, source: 'cpa' }))
  } catch (err) {
    const status = err?.status || 502
    res.status(status).json(
      fail(err?.message || 'oauth start failed', err?.unavailable ? 'oauth_unavailable' : undefined),
    )
  }
})

app.get('/api/admin/oauth/status', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const state = String(req.query?.state || '').trim()
    const data = await getCpaAuthStatus(cpaCfg, state || undefined)
    res.json(ok({ ...data, source: 'cpa' }))
  } catch (err) {
    res.status(err?.status || 502).json(fail(err?.message || 'oauth status failed'))
  }
})

app.post('/api/admin/oauth/callback', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const state = String(req.body?.state || '').trim()
    const redirect_url = String(
      req.body?.redirect_url || req.body?.url || req.body?.callback_url || '',
    ).trim()
    const data = await submitCpaOAuthCallback(cpaCfg, { state, redirect_url })
    try {
      await cpaCollector.refresh({ force: true })
    } catch {
      /* ignore */
    }
    res.json(ok({ ...data, source: 'cpa' }))
  } catch (err) {
    res.status(err?.status || 502).json(fail(err?.message || 'oauth callback failed'))
  }
})

app.get('/api/admin/oauth/model-alias', requireAdmin, async (_req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const data = await fetchOauthModelAlias(cpaCfg)
    res.json(ok({ alias: data?.['oauth-model-alias'] ?? data, raw: sanitizeConfig(data || {}), source: 'cpa' }))
  } catch (err) {
    res.status(err?.status || 502).json(fail(err?.message || 'oauth-model-alias failed'))
  }
})

app.put('/api/admin/oauth/model-alias', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const value = req.body?.alias ?? req.body?.['oauth-model-alias'] ?? req.body
    const data = await setOauthModelAlias(cpaCfg, value)
    res.json(ok({ alias: data?.['oauth-model-alias'] ?? data, source: 'cpa' }))
  } catch (err) {
    res.status(err?.status || 502).json(fail(err?.message || 'oauth-model-alias update failed'))
  }
})

app.get('/api/admin/oauth/excluded-models', requireAdmin, async (_req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const data = await fetchOauthExcludedModels(cpaCfg)
    res.json(
      ok({
        excluded: data?.['oauth-excluded-models'] ?? data,
        raw: sanitizeConfig(data || {}),
        source: 'cpa',
      }),
    )
  } catch (err) {
    res.status(err?.status || 502).json(fail(err?.message || 'oauth-excluded-models failed'))
  }
})

app.put('/api/admin/oauth/excluded-models', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const value = req.body?.excluded ?? req.body?.['oauth-excluded-models'] ?? req.body
    const data = await setOauthExcludedModels(cpaCfg, value)
    res.json(ok({ excluded: data?.['oauth-excluded-models'] ?? data, source: 'cpa' }))
  } catch (err) {
    res.status(err?.status || 502).json(fail(err?.message || 'oauth-excluded-models update failed'))
  }
})

app.get('/api/admin/plugins', requireAdmin, async (_req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const data = await fetchCpaPlugins(cpaCfg)
    res.json(
      ok({
        plugins_enabled: data.plugins_enabled,
        plugins_dir: data.plugins_dir,
        plugins: data.plugins,
        writable: false, // probed below on PUT
        note: 'CPA v7.3.10 exposes GET /plugins; PUT returns 404 on this build.',
        source: 'cpa',
      }),
    )
  } catch (err) {
    res.status(err?.status || 502).json(fail(err?.message || 'plugins failed'))
  }
})

app.put('/api/admin/plugins', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const data = await setCpaPlugins(cpaCfg, {
      plugins_enabled: req.body?.plugins_enabled ?? req.body?.enabled,
      plugins_dir: req.body?.plugins_dir ?? req.body?.dir,
    })
    if (data.unavailable) {
      res.status(501).json(
        fail('CPA 此版本不支持 PUT /plugins（404）。请升级 CPA 或通过配置文件修改。', 'plugins_put_unavailable'),
      )
      return
    }
    res.json(
      ok({
        plugins_enabled: data.plugins_enabled,
        plugins_dir: data.plugins_dir,
        plugins: data.plugins,
        writable: true,
        source: 'cpa',
      }),
    )
  } catch (err) {
    res.status(err?.status || 502).json(fail(err?.message || 'plugins update failed'))
  }
})

app.get('/api/admin/logs', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const limit = req.query?.limit ? Number(req.query.limit) : undefined
    const data = await fetchCpaLogs(cpaCfg, { limit })
    res.json(ok({ ...data, source: 'cpa' }))
  } catch (err) {
    const status = err?.status || 502
    res.status(status).json(fail(err?.message || 'logs failed', err?.code))
  }
})


// ——— Wave B: dashboard / monitoring / model-prices / aliases / account-actions ———

app.get('/api/admin/dashboard/summary', requireAdmin, (req, res) => {
  try {
    const todayStartMs = req.query?.today_start_ms != null ? Number(req.query.today_start_ms) : undefined
    const summary = siteUsage.dashboardSummary({ todayStartMs })
    const collector = cpaCollector.getStatus()
    res.json(
      ok({
        ...summary,
        collector: {
          ok: !!collector.ok,
          lastSync: collector.lastSync || null,
          error: collector.error || null,
          latency_ms: collector.latency_ms ?? null,
          account_count: collector.account_count ?? 0,
          interval_ms: collector.interval_ms ?? null,
        },
      }),
    )
  } catch (err) {
    console.error('[admin] dashboard/summary', err?.message || err)
    res.status(500).json(fail(err?.message || 'dashboard summary failed'))
  }
})

app.post('/api/admin/monitoring/analytics', requireAdmin, (req, res) => {
  try {
    const body = req.body || {}
    const fromMs = body.from_ms != null ? Number(body.from_ms) : Number(req.query?.from_ms)
    const toMs = body.to_ms != null ? Number(body.to_ms) : Number(req.query?.to_ms)
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
      res.status(400).json(fail('from_ms and to_ms required'))
      return
    }
    if (toMs < fromMs) {
      res.status(400).json(fail('to_ms must be >= from_ms'))
      return
    }
    const bucketMs = body.bucket_ms != null ? Number(body.bucket_ms) : undefined
    const analytics = siteUsage.monitoringAnalytics({ fromMs, toMs, bucketMs })
    res.json(ok(analytics))
  } catch (err) {
    console.error('[admin] monitoring/analytics', err?.message || err)
    res.status(500).json(fail(err?.message || 'monitoring analytics failed'))
  }
})

app.get('/api/admin/monitoring/header-snapshots', requireAdmin, (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 30))
    const diag = diagnosisStore.list({ limit: 80 })
    const items = (diag.items || [])
      .filter((r) => {
        const code = Number(r.status_code) || 0
        return code >= 400 || code === 0
      })
      .slice(0, limit)
      .map((r) => ({
        id: r.id,
        created_at: r.created_at || null,
        model: r.model_name || r.requested_model || null,
        endpoint: r.endpoint || null,
        status_code: r.status_code ?? null,
        content: r.content || null,
        source: 'bff:diagnosis',
      }))
    res.json(
      ok({
        items,
        total: items.length,
        note:
          items.length === 0
            ? 'No header/quota snapshots persisted yet. Showing empty list (CPA has no header-snapshots API). Diagnosis errors appear here when present.'
            : 'Derived from BFF diagnosis failures (CPA has no /monitoring/header-snapshots).',
      }),
    )
  } catch (err) {
    res.status(500).json(fail(err?.message || 'header-snapshots failed'))
  }
})

app.get('/api/admin/account-actions', requireAdmin, async (req, res) => {
  try {
    const includeDismissed = String(req.query?.include_dismissed || '') === '1'
    let accounts = []
    try {
      const payload = cpaCollector.getAuthFilesPayload()
      if (payload) accounts = mapAdminAccounts(payload)
      else if (cpaCfg.managementKey) {
        const fresh = await fetchCpaAuthFilesCached(cpaCfg).catch(() => null)
        if (fresh) accounts = mapAdminAccounts(fresh)
      }
    } catch {
      accounts = []
    }
    const diag = diagnosisStore.list({ limit: 100 })
    const data = accountActions.listCandidates({
      accounts,
      diagnosisItems: diag.items || [],
      includeDismissed,
    })
    res.json(ok(data))
  } catch (err) {
    console.error('[admin] account-actions', err?.message || err)
    res.status(500).json(fail(err?.message || 'account-actions failed'))
  }
})

app.post('/api/admin/account-actions/:id/ignore', requireAdmin, (req, res) => {
  try {
    const d = accountActions.dismiss(req.params.id, 'ignore')
    res.json(ok({ id: req.params.id, dismissal: d }))
  } catch (err) {
    res.status(err?.status || 400).json(fail(err?.message || 'ignore failed'))
  }
})

app.post('/api/admin/account-actions/:id/resolve', requireAdmin, (req, res) => {
  try {
    const d = accountActions.dismiss(req.params.id, 'resolve')
    res.json(ok({ id: req.params.id, dismissal: d }))
  } catch (err) {
    res.status(err?.status || 400).json(fail(err?.message || 'resolve failed'))
  }
})

app.get('/api/admin/model-prices', requireAdmin, (_req, res) => {
  try {
    res.json(ok(modelPrices.getPrices()))
  } catch (err) {
    res.status(500).json(fail(err?.message || 'model-prices failed'))
  }
})

app.put('/api/admin/model-prices', requireAdmin, (req, res) => {
  try {
    const body = req.body || {}
    const items = Array.isArray(body) ? body : body.prices
    const data = modelPrices.putPrices(items)
    res.json(ok(data))
  } catch (err) {
    res.status(err?.status || 400).json(fail(err?.message || 'model-prices put failed'))
  }
})

app.get('/api/admin/model-prices/runtime-models', requireAdmin, (req, res) => {
  try {
    const period = String(req.query?.period || 'all')
    const models = siteUsage.distinctModels({ period })
    res.json(ok({ models, period, source: 'site-usage' }))
  } catch (err) {
    res.status(500).json(fail(err?.message || 'runtime-models failed'))
  }
})

app.get('/api/admin/model-prices/usage-summary', requireAdmin, (req, res) => {
  try {
    const period = String(req.query?.period || 'today')
    const data = modelPrices.usageSummaryCosted(siteUsage, { period })
    res.json(ok(data))
  } catch (err) {
    res.status(500).json(fail(err?.message || 'usage-summary failed'))
  }
})

app.get('/api/admin/api-key-aliases', requireAdmin, (_req, res) => {
  try {
    res.json(ok({ items: apiKeyAliases.list() }))
  } catch (err) {
    res.status(500).json(fail(err?.message || 'aliases failed'))
  }
})

app.put('/api/admin/api-key-aliases', requireAdmin, (req, res) => {
  try {
    const body = req.body || {}
    const hash = body.hash || body.key_hash
    const label = body.label
    const note = body.note || ''
    const item = apiKeyAliases.put(hash, label, note)
    res.json(ok({ item, items: apiKeyAliases.list() }))
  } catch (err) {
    res.status(err?.status || 400).json(fail(err?.message || 'alias put failed'))
  }
})

app.delete('/api/admin/api-key-aliases', requireAdmin, (req, res) => {
  try {
    const hash = req.body?.hash || req.body?.key_hash || req.query?.hash
    const data = apiKeyAliases.remove(hash)
    res.json(ok({ ...data, items: apiKeyAliases.list() }))
  } catch (err) {
    res.status(err?.status || 400).json(fail(err?.message || 'alias delete failed'))
  }
})



app.use((req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/oauth/')) {
    res.status(404).json(fail('接口不存在'))
    return
  }
  res.status(404).end('Not Found')
})

try {
  cpaCollector.start()
} catch (err) {
  console.error('[cpaCollector] start failed', err?.message || err)
}

app.listen(PORT, HOST, () => {
  console.log(`[server] listening on http://${HOST}:${PORT}`)
  console.log(`[server] v1_proxy=${v1ProxyEnabled ? 'on→' + cpaCfg.billingBaseUrl : 'off'} diagnosis=${diagnosisStore.stats().path}`)
  console.log(`[server] redirect_uri=${REDIRECT_URI}`)
  console.log(`[server] client_id=${CLIENT_ID}`)
  console.log(`[server] public_api_base=${cpaCfg.publicApiBaseUrl}`)
  console.log(`[server] cpa=${cpaCfg.cpaBaseUrl} billing=${cpaCfg.billingBaseUrl} cpamp=${cpaCfg.cpampBaseUrl}`)
  console.log(
    `[server] secrets demo=${cpaCfg.demoKey ? 'yes' : 'no'} mgmt=${cpaCfg.managementKey ? 'yes' : 'no'} admin=${cpaCfg.adminKey ? 'yes' : 'no'}`,
  )
  console.log(
    `[server] admin allowlist ids=${adminAllowlist.ids.size} usernames=${adminAllowlist.usernames.size} emails=${adminAllowlist.emails.size} local=${adminAllowlist.localUsernames?.size || 0}`,
  )
  console.log(
    `[server] site-credits checkin=${creditStore.getConfig().checkin_enabled} grant=${creditStore.getConfig().daily_grant_min}-${creditStore.getConfig().daily_grant_max} codes=${creditStore.listCodes().length}`,
  )
  console.log(`[server] local_users=${localUserStore.listUsers().length} aily_adapter=${ailyManager.cfg.adapterUrl} aily_routes=${ailyManager.cfg.modelRoutes.length}`)
  console.log(`[server] cpaCollector=${cpaCollector.getStatus().ok ? 'ok' : 'pending'} siteUsage=${siteUsage.stats().events}`)
})
