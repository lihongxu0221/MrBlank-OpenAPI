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
  fetchAuthFileModels,
  resetAuthFileQuota,
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
  invalidateCpaAuthFilesCache,
  normalizeAuthFilePatchFields,
} from './cpa.js'
import { createSiteUsageStore } from './siteUsage.js'
import { createModelPricesStore } from './modelPrices.js'
import { createQuotaUnitStore, DEFAULT_QUOTA_PER_UNIT, buildCreditUnitInfo } from './quotaUnit.js'
import { createApiKeyAliasesStore } from './apiKeyAliases.js'
import { createAccountActionsStore } from './accountActions.js'
import { createUsageImportSessions } from './usageImportSessions.js'
import { createCodexInspectionStore } from './codexInspection.js'
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
import { createGroupStore } from './groups.js'
import { createCreditStore, shanghaiDay } from './credits.js'
import { createLocalUserStore } from './localUsers.js'
import { createDiagnosisStore } from './diagnosis.js'
import { createV1Proxy } from './v1Proxy.js'
import { createAilyManager, loadAilyConfig } from './aily.js'
import { createAilyUpstream } from './ailyUpstream.js'
import { createAilyModelRoutingStore, publicModelList, normalizeModelRouting, exposedModelNames, isAilyPrefixed, stripAilyPrefix } from './ailyModelRouting.js'
import { collectAilyPublicModelRows, enrichModelsBodyWithAily } from './mergedV1Models.js'
import { createAilyAccountsStore } from './ailyAccounts.js'
import { createAilyCredentialsStore } from './ailyCredentials.js'
import { createAilyCompat } from './ailyCompat.js'
import { createAilyOauth } from './ailyOauth.js'
import { createQuotaSnapshotStore } from './quotaSnapshots.js'
import { createSessionStore } from './sessions.js'
import {
  fetchCpampAccountQuotas,
  mergeCpampQuotaIntoAccounts,
  refreshAccountQuotas,
  enrichAntigravityPlans,
} from './cpampQuota.js'
import { normalizeAuthFileModels, parseExcludedModels } from './credModels.js'
import { convertPasteToAuthFiles } from './authFileConvert.js'
import {
  fetchCpaConfigYamlRaw,
  prepareAndPutConfigYaml,
  buildMaskedConfigPayload,
  isConfigYamlWriteEnabled,
  parseConfigYaml,
} from './configYaml.js'

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
const quotaUnitStore = createQuotaUnitStore(
  process.env.QUOTA_UNIT_PATH || path.join(__dirname, 'data', 'quota-unit.json'),
)

/** Filled after aily/CPA stores are ready; used by price sync fail-closed filter. */
let resolveSupportedModels = async () => []

const modelPrices = createModelPricesStore(
  process.env.MODEL_PRICES_PATH || path.join(__dirname, 'data', 'model-prices.json'),
  {
    getQuotaUnit: () => quotaUnitStore.getUnit(),
    getSupportedModels: () => resolveSupportedModels(),
  },
)
const apiKeyAliases = createApiKeyAliasesStore(
  process.env.API_KEY_ALIASES_PATH || path.join(__dirname, 'data', 'api-key-aliases.json'),
)
const accountActions = createAccountActionsStore(
  process.env.ACCOUNT_ACTIONS_PATH || path.join(__dirname, 'data', 'account-actions.json'),
)
const quotaSnapshots = createQuotaSnapshotStore(
  process.env.QUOTA_SNAPSHOTS_PATH || path.join(__dirname, 'data', 'quota-snapshots.json'),
)
const usageImportSessions = createUsageImportSessions(
  process.env.USAGE_IMPORTS_DIR || path.join(__dirname, 'data', 'usage-imports'),
  siteUsage,
)
const codexInspection = createCodexInspectionStore(
  process.env.CODEX_INSPECTION_PATH || path.join(__dirname, 'data', 'codex-inspection.json'),
  {
    listAccounts: async () => {
      let payload = cpaCollector.getAuthFilesPayload?.() || null
      if (!payload && cpaCfg.managementKey) {
        try {
          await cpaCollector.refresh({ force: true })
          payload = cpaCollector.getAuthFilesPayload?.() || null
        } catch {
          payload = null
        }
      }
      return payload ? mapAdminAccounts(payload) : []
    },
    refreshAuthFile: async (name) => {
      const result = await refreshAuthFile(cpaCfg, name)
      try {
        await cpaCollector.refresh({ force: true })
      } catch {
        /* ignore */
      }
      return result
    },
    setAuthFileDisabled: async (name, disabled) => {
      const result = await setAuthFileDisabled(cpaCfg, name, disabled)
      try {
        await cpaCollector.refresh({ force: true })
      } catch {
        /* ignore */
      }
      return result
    },
    deleteAuthFile: async (name) => {
      const result = await deleteAuthFile(cpaCfg, name)
      try {
        await cpaCollector.refresh({ force: true })
      } catch {
        /* ignore */
      }
      return result
    },
    refreshCollector: async () => cpaCollector.refresh({ force: true }),
  },
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
const ailyModelRouting = createAilyModelRoutingStore(
  process.env.AILY_MODEL_ROUTING_PATH || path.join(__dirname, 'data', 'aily-model-routing.json'),
)
const ailyAccounts = createAilyAccountsStore(
  process.env.AILY_ACCOUNTS_PATH || path.join(__dirname, 'data', 'aily-accounts.json'),
)
const ailyCredentials = createAilyCredentialsStore(
  process.env.AILY_CREDENTIALS_PATH || path.join(__dirname, 'data', 'aily-credentials.json'),
)
try {
  const mig = ailyCredentials.migrateFromAuthFile(ailyManager.cfg.authFile)
  if (mig.migrated) {
    console.log(`[aily-pool] migrated .aily → account #${mig.account?.id} (${mig.account?.name || ''})`)
  }
} catch (e) {
  console.warn('[aily-pool] migrate skipped:', e?.message || e)
}
const ailyCompat = createAilyCompat({
  getAccounts: () => ailyAccounts.loadAccounts(),
})
const ailyOauth = createAilyOauth({ accountsStore: ailyAccounts })

async function refreshAilyPoolAccount(id) {
  const acc = ailyCredentials.get(id)
  if (!acc) return { ok: false, message: '账号不存在' }
  const rt = String(acc.refresh_token || '').trim()
  if (!rt) return { ok: false, message: 'No refresh_token stored' }
  const base = ailyCredentials.resolveBase(acc)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20000)
  try {
    const res = await fetch(`${base}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt }),
      signal: ctrl.signal,
    })
    const json = await res.json().catch(() => null)
    const data = json?.data
    if (res.ok && data?.access_token) {
      ailyCredentials.setTokens(id, {
        access_token: data.access_token,
        refresh_token: data.refresh_token || undefined,
      })
      const primary = ailyCredentials
        .loadAccounts()
        .filter((a) => a.enabled !== false)
        .sort((a, b) => a.id - b.id)[0]
      if (primary) ailyCredentials.syncAccountToAuthFile(primary.id, ailyManager.cfg.authFile)
      return { ok: true, message: '已刷新 Token', upstream: base, account_id: id }
    }
    return {
      ok: false,
      status: res.status,
      message: json?.message || json?.errorMessage || `HTTP ${res.status}`,
    }
  } catch (e) {
    return { ok: false, message: e?.message || String(e) }
  } finally {
    clearTimeout(timer)
  }
}

async function testAilyPoolAccount(id) {
  const acc = ailyCredentials.get(id)
  if (!acc) return { ok: false, message: '账号不存在' }
  let token = String(acc.access_token || '').trim()
  if (!token && acc.refresh_token) {
    const refreshed = await refreshAilyPoolAccount(id)
    if (!refreshed.ok) return { ok: false, message: refreshed.message || 'refresh failed' }
    token = String(ailyCredentials.get(id)?.access_token || '').trim()
  }
  if (!token) return { ok: false, message: 'No access_token stored' }
  const base = ailyCredentials.resolveBase(ailyCredentials.get(id) || acc)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(`${base}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    })
    const json = await res.json().catch(() => null)
    const user =
      json?.data?.nickname ||
      json?.data?.email ||
      json?.data?.user?.nickname ||
      json?.data?.user?.email ||
      null
    if (res.ok && user && !acc.email) {
      try {
        ailyCredentials.update(id, { email: user })
      } catch {
        /* ignore */
      }
    }
    if (res.ok) ailyCredentials.clearCooldown(id)
    return {
      ok: res.ok,
      status: res.status,
      message: res.ok ? `连接正常${user ? ` · ${user}` : ''}` : json?.message || `HTTP ${res.status}`,
      user,
      upstream: base,
      account_id: id,
    }
  } catch (e) {
    return { ok: false, message: e?.message || String(e), account_id: id }
  } finally {
    clearTimeout(timer)
  }
}

const ailyUpstream = createAilyUpstream({
  getAccessToken: () => {
    const peek = ailyCredentials.peekAilyAccount({})
    if (peek?.access_token) return peek.access_token
    return ailyManager.getAccessToken()
  },
  getRefreshToken: () => {
    const peek = ailyCredentials.peekAilyAccount({})
    if (peek?.refresh_token) return peek.refresh_token
    return ailyManager.getRefreshToken()
  },
  getUpstreamBase: () => {
    const peek = ailyCredentials.peekAilyAccount({})
    if (peek) return ailyCredentials.resolveBase(peek)
    return ailyManager.getUpstreamBase()
  },
  saveAuth: (patch) => ailyManager.saveAuth(patch),
  refreshToken: () => ailyManager.refreshToken(),
  pickAilyAccount: (opts) => ailyCredentials.pickAilyAccount(opts),
  peekAilyAccount: (opts) => ailyCredentials.peekAilyAccount(opts),
  getAccount: (id) => ailyCredentials.get(id),
  refreshAccount: (id) => refreshAilyPoolAccount(id),
  markUnschedulable: (id, reason, ms) => ailyCredentials.markUnschedulable(id, reason, ms),
  resolveAccountBase: (acc) => ailyCredentials.resolveBase(acc),
  DEFAULT_COOLDOWN_MS: ailyCredentials.DEFAULT_COOLDOWN_MS,
  REFRESH_FAIL_COOLDOWN_MS: ailyCredentials.REFRESH_FAIL_COOLDOWN_MS,
  getModelRouting: () => ailyModelRouting.get(),
  resolveCompat: (model) => ailyCompat.resolve(model),
})
ailyManager.attachUpstream(ailyUpstream)

const AILY_POOL_REFRESH_INTERVAL_MS = Number(process.env.AILY_POOL_REFRESH_INTERVAL_MS || 10 * 60 * 1000)
setInterval(() => {
  ;(async () => {
    for (const a of ailyCredentials.loadAccounts()) {
      if (a.enabled === false || !a.refresh_token || !a.access_token) continue
      try {
        const part = String(a.access_token).split('.')[1]
        if (!part) continue
        const payload = JSON.parse(
          Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
        )
        const exp = Number(payload?.exp)
        if (!Number.isFinite(exp)) continue
        if (exp * 1000 - Date.now() > 10 * 60 * 1000) continue
        const r = await refreshAilyPoolAccount(a.id)
        if (!r.ok) {
          ailyCredentials.markUnschedulable(
            a.id,
            `auto_refresh: ${r.message}`,
            ailyCredentials.REFRESH_FAIL_COOLDOWN_MS,
          )
        }
      } catch (e) {
        console.warn('[aily-pool] auto-refresh', a.id, e?.message || e)
      }
    }
  })().catch((e) => console.warn('[aily-pool] auto-refresh loop', e?.message || e))
}, Math.max(60_000, AILY_POOL_REFRESH_INTERVAL_MS)).unref?.()

/**
 * Supported price-book catalog: CPA billing /v1/models + aily/{id} when routing enabled.
 * Fail closed — auto-sync never imports the ~11k aggregator universe.
 */
resolveSupportedModels = async () => {
  const ids = new Set()
  try {
    const cpaModels = await fetchCpaModels(cpaCfg)
    for (const m of cpaModels || []) {
      const id = String(m?.id || m?.name || '').trim()
      if (id) ids.add(id)
    }
  } catch (err) {
    console.warn('[modelPrices] supported CPA models:', err?.message || err)
  }
  try {
    const routing = ailyModelRouting.get()
    const exposed = exposedModelNames(routing) || []
    const envRoutes = ailyManager.cfg?.modelRoutes || []
    if (exposed.length || envRoutes.length) {
      for (const id of exposed) {
        const s = String(id || '').trim()
        if (!s) continue
        ids.add(s)
        ids.add(isAilyPrefixed(s) ? s : `aily/${s}`)
        const bare = stripAilyPrefix(s)
        if (bare) ids.add(bare)
      }
      try {
        const result = await ailyUpstream.listModels(false)
        const catalog =
          result?.data ||
          (result?.models || []).map((id) => ({ id, object: 'model', owned_by: 'aily' }))
        const pub = publicModelList(catalog, routing)
        for (const m of pub || []) {
          const id = String(m?.id || '').trim()
          if (!id) continue
          ids.add(id)
          const bare = stripAilyPrefix(id)
          if (bare) ids.add(bare)
        }
      } catch (e) {
        console.warn('[modelPrices] aily catalog:', e?.message || e)
      }
    }
  } catch (err) {
    console.warn('[modelPrices] supported aily models:', err?.message || err)
  }
  return [...ids]
}


const COOKIE_NAME = 'mrblank_sid'
const STATE_TTL_MS = 10 * 60 * 1000
const SESSION_TTL_MS = 12 * 60 * 60 * 1000
const Q = DEFAULT_QUOTA_PER_UNIT
const groupStore = createGroupStore(
  process.env.USER_GROUPS_PATH || path.join(__dirname, 'data', 'user-groups.json'),
  { quotaUnit: Q, getQuotaUnit: () => quotaUnitStore.getUnit() },
)
const creditStore = createCreditStore(
  process.env.SITE_CREDITS_PATH || path.join(__dirname, 'data', 'site-credits.json'),
  { quotaUnit: Q, getQuotaUnit: () => quotaUnitStore.getUnit() },
)
function creditUnitInfo() {
  return quotaUnitStore.creditUnitInfo()
}
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
const sessionStore = createSessionStore(
  process.env.SESSIONS_PATH || path.join(__dirname, 'data', 'sessions.json'),
  { ttlMs: SESSION_TTL_MS, debounceMs: 250 },
)
console.log(
  `[server] sessions loaded path=${sessionStore.path} count=${sessionStore.size()} pruned=${sessionStore.boot?.pruned || 0}`,
)
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
  sessionStore.prune(now)
}
setInterval(pruneMaps, 60_000).unref?.()

function readSid(req) {
  const raw = req.cookies?.[COOKIE_NAME]
  return typeof raw === 'string' && raw.length > 8 ? raw : null
}

function findSessionByAccessToken(token) {
  return sessionStore.findByAccessToken(token)
}

function getSession(req) {
  const sid = readSid(req)
  let rec = sid ? sessionStore.get(sid) : null
  if (!rec) {
    const auth = String(req.headers.authorization || '')
    const m = /^Bearer\s+(.+)$/i.exec(auth)
    if (m) rec = findSessionByAccessToken(m[1])
  }
  return rec || null
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
  sessionStore.set(rec)
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
  for (const rec of sessionStore.values()) {
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
    const rankedRaw = siteUsage.leaderboard({ period, sort, hashToUser: hashMap })
    // siteUsage.credits is raw quota; API 点数 = raw ÷ raw_per_point (N).
    const ranked = rankedRaw.map((r) => {
      const raw = Number(r.credits) || 0
      const points = quotaUnitStore.quotaToPoints(raw)
      let credits = 0
      if (Number.isFinite(points)) {
        if (Math.abs(points - Math.round(points)) < 1e-9) credits = Math.round(points)
        else credits = points < 10 ? Math.round(points * 100) / 100 : Math.round(points * 10) / 10
      }
      return { ...r, credits }
    })
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
    status: () => ok({ quota_per_unit: quotaUnitStore.getUnit(), raw_per_point: quotaUnitStore.getUnit(), usd_to_raw: 500_000, credit_unit: creditUnitInfo() }),
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
      embedded: true,
      // Prefer CPA for bare ids. Aily only when:
      //  - model starts with aily/  (plaza / explicit), OR
      //  - AILY_MODEL_ROUTES env patterns, OR
      //  - ailyCompat (Grok/OpenAI accounts)
      // Site whitelist/mappings alone must NOT steal bare ids from CPA.
      match: (model) => {
        const m = String(model || '').trim()
        if (!m) return false
        if (isAilyPrefixed(m)) return true
        if (ailyManager.modelMatches(m)) return true
        if (ailyCompat.matchSync(m)) return true
        return false
      },
      handleV1: (ctx) => ailyUpstream.handleV1(ctx),
      // legacy optional fields (unused when embedded)
      adapterUrl: ailyManager.cfg.adapterUrl,
      apiKey: ailyManager.cfg.adapterApiKey,
    },
    governance: {
      async enforce({ apiKey, model, isModelsList, isConsuming }) {
        // Unmapped keys (CPA demo / external) bypass site group rules.
        // Site-issued sk- keys: enforce aily-parity status / quota / rate / concurrency.
        let owner = null
        let releaseTokenConcurrency = () => {}
        if (apiKey) {
          const validated = userKeyStore.validateSiteKey(apiKey)
          if (validated.error) {
            // Unknown key → fall through as unmapped (CPA demo etc.)
            if (validated.error === '无效的 API Key') {
              owner = null
            } else {
              return {
                allow: false,
                status: validated.code || 401,
                code: validated.code === 429 ? 'key_quota_exhausted' : 'key_disabled',
                headers: { 'x-mrblank-governance': 'site_key' },
                body: {
                  error: {
                    message: validated.error,
                    type: validated.code === 429 ? 'insufficient_quota' : 'invalid_request_error',
                    code: validated.code === 429 ? 'key_quota_exhausted' : 'key_disabled',
                  },
                },
              }
            }
          } else {
            owner = validated.owner
          }
        }
        if (!owner?.userId) return { allow: true }

        if (isConsuming && owner.token) {
          const rateHit = userKeyStore.checkRateLimit(owner.token)
          if (rateHit) {
            return {
              allow: false,
              status: rateHit.code || 429,
              code: 'key_rate_limit',
              headers: { 'x-mrblank-governance': 'key_rate_limit', 'retry-after': '60' },
              body: {
                error: {
                  message: rateHit.error,
                  type: 'rate_limit_exceeded',
                  code: 'key_rate_limit',
                },
              },
            }
          }
          const release = userKeyStore.beginConcurrency(owner.token)
          if (!release) {
            return {
              allow: false,
              status: 429,
              code: 'key_concurrency',
              headers: { 'x-mrblank-governance': 'key_concurrency', 'retry-after': '5' },
              body: {
                error: {
                  message: '该 API Key 并发数已达上限',
                  type: 'rate_limit_exceeded',
                  code: 'key_concurrency',
                },
              },
            }
          }
          releaseTokenConcurrency = release
        }

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
              try { releaseTokenConcurrency() } catch { /* ignore */ }
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
                  credit_unit: creditUnitInfo(),
                },
              }
            }
            useSiteCredits = true
            // allow via site credits; still enforce model allowlist below
          }
          // When group has a model allowlist, require an explicit model on consuming calls
          const allowlist = groupInfo.group?.model_ids || []
          if (allowlist.length && !String(model || '').trim()) {
            try { releaseTokenConcurrency() } catch { /* ignore */ }
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
              try { releaseTokenConcurrency() } catch { /* ignore */ }
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
        return {
          allow: true,
          userId,
          groupInfo,
          useSiteCredits,
          siteTokenId: owner.token?.id,
          releaseTokenConcurrency,
        }
      },
      async enrichModelsBody(_ctx, bodyText) {
        // Plaza / price-sync parity: include aily/* when routing or AILY_MODEL_ROUTES enabled.
        return enrichModelsBodyWithAily(bodyText, {
          getRouting: () => ailyModelRouting.get(),
          getEnvRoutes: () => ailyManager.cfg?.modelRoutes || [],
          envModelMatches: (m) => ailyManager.modelMatches(m),
          listAilyModels: () => ailyUpstream.listModels(false),
        })
      },
      filterModelsBody(ctx, bodyText) {
        return groupStore.filterModelsResponseBody(bodyText, ctx.groupInfo?.group)
      },
      onComplete({
        userId,
        status,
        usage,
        isConsuming,
        useSiteCredits,
        apiKey,
        requestedModel,
        endpoint,
        siteTokenId,
        releaseTokenConcurrency,
        diagnosis_id,
        id: eventId,
        ip,
        token_name,
        duration_ms,
        ttft_ms,
        is_stream,
        model_name,
        route_via,
        group,
        content,
        has_detail,
        groupInfo,
      }) {
        try {
          if (typeof releaseTokenConcurrency === 'function') releaseTokenConcurrency()
        } catch {
          /* ignore */
        }
        const okStatus = status >= 200 && status < 300
        // Always record site-scoped usage for community leaderboard / admin usage (incl. failures).
        try {
          const prompt = Number(usage?.prompt_tokens) || 0
          const completion = Number(usage?.completion_tokens) || 0
          const cacheTokens =
            Number(usage?.cache_tokens ?? usage?.prompt_tokens_details?.cached_tokens ?? 0) || 0
          const cacheWriteTokens =
            Number(usage?.cache_write_tokens ?? usage?.cache_creation_tokens ?? 0) || 0
          const resolvedModel = model_name || usage?.model || requestedModel || null
          let amountUsd = 0
          let rawQuota = 0
          try {
            const price = modelPrices.lookupPrice(String(resolvedModel || requestedModel || '').trim())
            amountUsd = modelPrices.costForTokens(price, prompt, completion, {
              cacheReadTokens: cacheTokens,
              cacheWriteTokens: cacheWriteTokens,
            })
            rawQuota = quotaUnitStore.dollarsToQuota(amountUsd)
          } catch {
            amountUsd = 0
            rawQuota = 0
          }
          let username = null
          try {
            if (userId) {
              const u = localUserStore.findById(userId)
              username = u?.username || u?.display_name || null
              if (!username) {
                const store = userStores.get(String(userId))
                username = store?.user?.username || store?.user?.display_name || null
              }
            }
          } catch {
            /* ignore */
          }
          const diagId = diagnosis_id || eventId || null
          siteUsage.recordEvent({
            id: diagId || undefined,
            diagnosis_id: diagId,
            userId: userId || null,
            username,
            keyHash: apiKey ? hashApiKey(apiKey) : null,
            token_name: token_name || null,
            model: resolvedModel,
            model_requested: requestedModel || null,
            model_resolved: resolvedModel,
            endpoint: endpoint || null,
            group: group || groupInfo?.group?.id || groupInfo?.group?.name || null,
            status,
            success: okStatus,
            type: okStatus ? 2 : 5,
            tokens: prompt + completion,
            prompt_tokens: prompt,
            completion_tokens: completion,
            cache_tokens: cacheTokens,
            cache_write_tokens: cacheWriteTokens,
            amountUsd,
            rawQuota,
            duration_ms: duration_ms ?? null,
            ttft_ms: ttft_ms ?? null,
            stream: !!is_stream,
            ip: ip || null,
            route: route_via || null,
            content: content || null,
            has_detail: has_detail !== false && !!diagId,
          })
        } catch (e) {
          console.error('[siteUsage] recordEvent failed', e?.message || e)
        }
        if (!userId || !isConsuming || !okStatus) return
        const promptTok = Number(usage?.prompt_tokens) || 0
        const completionTok = Number(usage?.completion_tokens) || 0
        const cacheReadTok =
          Number(usage?.cache_tokens ?? usage?.prompt_tokens_details?.cached_tokens ?? 0) || 0
        const cacheWriteTok =
          Number(usage?.cache_write_tokens ?? usage?.cache_creation_tokens ?? 0) || 0
        const tokens = promptTok + completionTok
        // Price-book USD → raw quota (aily: round(USD * quota_per_unit)); not 1 token = 1 raw
        let amountUsd = 0
        let quota = 0
        try {
          const model = String(requestedModel || usage?.model || '').trim()
          const price = modelPrices.lookupPrice(model)
          amountUsd = modelPrices.costForTokens(price, promptTok, completionTok, {
            cacheReadTokens: cacheReadTok,
            cacheWriteTokens: cacheWriteTok,
          })
          quota = quotaUnitStore.dollarsToQuota(amountUsd)
          // Unpriced successful call: charge minimal 1 raw so windows still move; prefer syncing prices
          if (quota <= 0 && tokens > 0) quota = price ? 0 : 1
        } catch (e) {
          console.error('[billing] price quota failed', e?.message || e)
          amountUsd = 0
          quota = tokens > 0 ? 1 : 0
        }
        try {
          groupStore.recordUsage(userId, { quota, requests: 1 })
        } catch (e) {
          console.error('[groups] recordUsage failed', e?.message || e)
        }
        // Site-issued key: consume remain_quota + record rate-window spend (aily parity)
        if (siteTokenId) {
          try {
            userKeyStore.consumeQuota(userId, siteTokenId, quota, amountUsd)
          } catch (e) {
            console.error('[userKeys] consumeQuota failed', e?.message || e)
          }
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

app.use(express.json({ limit: '8mb' }))
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
  if (sid) sessionStore.delete(sid)
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
  const size = Number(req.query.size || req.query.page_size || 100)
  const all = userKeyStore.listPublic(req.auth.user.id)
  const startIdx = Math.max(0, (p - 1) * size)
  const items = all.slice(startIdx, startIdx + size)
  res.json(
    ok({
      items,
      total: all.length,
      page: p,
      page_size: size,
      api_base_url: cpaCfg.publicApiBaseUrl,
      demo_key_masked: cpaCfg.demoKey ? maskKey(cpaCfg.demoKey) : null,
      note: '密钥由本站服务端在 CPA 注册；Management/Admin Key 不会下发到浏览器。完整密钥仅创建时可见。',
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
    const unlimited = body.unlimited_quota !== false
    const item = userKeyStore.create(req.auth.user.id, {
      name: String(body.name || 'key'),
      fullKey,
      status: body.enabled === false || body.status === 2 ? 2 : 1,
      unlimited_quota: unlimited,
      remain_quota: unlimited ? 0 : Math.max(0, Number(body.remain_quota) || 0),
      expired_time: body.expired_time == null || body.expired_time === '' ? -1 : Number(body.expired_time),
      max_concurrency: Math.max(0, Number(body.max_concurrency) || 0),
      rate_limit_enabled: body.rate_limit_enabled === true,
      rate_limit_5h: body.rate_limit_5h,
      rate_limit_1d: body.rate_limit_1d,
      rate_limit_7d: body.rate_limit_7d,
      rate_limit_30d: body.rate_limit_30d,
      model_limits: modelLimits,
      access_group_id: 1,
      group: groupInfo.group?.id || body.group || 'default',
    })
    // Reveal full key once on create (aily parity)
    res.json(ok(userKeyStore.getPublic(req.auth.user.id, item.id, true)))
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
      const updated = userKeyStore.update(req.auth.user.id, t.id, { status: nextStatus }, true)
      res.json(ok(userKeyStore.getPublic(req.auth.user.id, updated.id, false)))
      return
    }
    const updated = userKeyStore.update(req.auth.user.id, t.id, {
      name: body.name ?? t.name,
      remain_quota: body.remain_quota ?? t.remain_quota,
      unlimited_quota: body.unlimited_quota ?? t.unlimited_quota,
      expired_time: body.expired_time ?? t.expired_time,
      max_concurrency: body.max_concurrency ?? t.max_concurrency,
      rate_limit_enabled: body.rate_limit_enabled ?? t.rate_limit_enabled,
      rate_limit_5h: body.rate_limit_5h ?? t.rate_limit_5h,
      rate_limit_1d: body.rate_limit_1d ?? t.rate_limit_1d,
      rate_limit_7d: body.rate_limit_7d ?? t.rate_limit_7d,
      rate_limit_30d: body.rate_limit_30d ?? t.rate_limit_30d,
      reset_rate_limit_usage: body.reset_rate_limit_usage,
      status: body.status,
      enabled: body.enabled,
      model_limits: body.model_limits ?? t.model_limits,
      group: body.group ?? t.group,
    })
    res.json(ok(userKeyStore.getPublic(req.auth.user.id, updated.id, false)))
  } catch (err) {
    console.error('[cpa] update key failed', err?.message || err)
    res.status(502).json(fail(err?.message || '更新密钥失败'))
  }
})

app.get('/api/token/options', requireAuth, async (req, res) => {
  try {
    const groupInfo = resolveAuthGroup(req)
    let cpaModels = []
    let cpaErr = null
    try {
      cpaModels = await fetchCpaModels(cpaCfg)
    } catch (err) {
      cpaErr = err?.message || String(err)
      console.error('[cpa] models failed', cpaErr)
    }

    // Merge Aily public models when site routing or AILY_MODEL_ROUTES is configured.
    // Public ids are always aily/{name} so they never collide with CPA bare ids.
    // Shared with GET /v1/models enrich (mergedV1Models) so admin pickers match plaza.
    let ailyModels = []
    try {
      const rows = await collectAilyPublicModelRows({
        getRouting: () => ailyModelRouting.get(),
        getEnvRoutes: () => ailyManager.cfg?.modelRoutes || [],
        envModelMatches: (m) => ailyManager.modelMatches(m),
        listAilyModels: () => ailyUpstream.listModels(false),
      })
      ailyModels = rows.map((m) => ({
        id: m.id, // already aily/...
        name: m.name || stripAilyPrefix(m.id) || m.id,
        provider: 'Aily',
        kind: 'text',
        text_price: 0,
        text_out_price: 0,
        owned_by: 'aily',
      }))
    } catch (e) {
      console.warn('[aily] plaza merge failed:', e?.message || e)
    }

    // Dedupe by id: CPA first (bare), then Aily prefixed ids (never overwrite CPA)
    const byId = new Map()
    for (const m of cpaModels || []) {
      const id = String(m?.id || m?.name || '').trim()
      if (id) byId.set(id, m)
    }
    for (const m of ailyModels) {
      const id = String(m.id || '').trim()
      if (!id || byId.has(id)) continue
      byId.set(id, m)
    }
    const merged = [...byId.values()]
    // Wire 消耗标准（点） from price book — same raw→点 conversion as admin.
    const withPrices = merged.map((m) => {
      const id = String(m?.id || m?.name || '').trim()
      if (!id) return m
      const fields = modelPrices.plazaPriceFields(id)
      if (!fields) return m
      const kind = String(m.kind || 'text')
      if (kind === 'image' || kind === 'video') {
        return { ...m, priced: true, input_per_mtok: fields.input_per_mtok, output_per_mtok: fields.output_per_mtok }
      }
      return {
        ...m,
        text_price: fields.text_price,
        text_out_price: fields.text_out_price,
        priced: true,
        input_per_mtok: fields.input_per_mtok,
        output_per_mtok: fields.output_per_mtok,
      }
    })
    const model_details = groupStore.filterModels(withPrices, groupInfo.group)
    const priced_count = model_details.filter((m) => m?.priced).length

    if (!cpaModels.length && !ailyModels.length && cpaErr) {
      return res.status(502).json(fail(cpaErr || '无法拉取模型列表'))
    }

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
        source: cpaErr ? (ailyModels.length ? 'aily' : 'error') : ailyModels.length ? 'cpa+aily' : 'cpa',
        aily_count: ailyModels.length,
        cpa_count: (cpaModels || []).length,
        priced_count,
        quota_per_unit: quotaUnitStore.getUnit(),
        raw_per_point: quotaUnitStore.getUnit(),
        usd_to_raw: 500_000,
        filtered: !!(groupInfo.group?.model_ids || []).length,
      }),
    )
  } catch (err) {
    console.error('[token/options] failed', err?.message || err)
    res.status(502).json(fail(err?.message || '无法拉取模型列表'))
  }
})

app.get('/api/token/:id', requireAuth, (req, res) => {
  const pub = userKeyStore.getPublic(req.auth.user.id, req.params.id, false)
  if (!pub) {
    res.json(fail('密钥不存在'))
    return
  }
  res.json(ok(pub))
})

app.put('/api/token/:id', requireAuth, async (req, res) => {
  try {
    const body = req.body || {}
    const t = userKeyStore.get(req.auth.user.id, req.params.id)
    if (!t) {
      res.json(fail('密钥不存在'))
      return
    }
    const statusOnly = String(req.query.status_only) === 'true'
    if (statusOnly) {
      const nextStatus = Number(body.status)
      if (nextStatus === 2 && t.status === 1 && t.fullKey) {
        await removeCpaApiKey(cpaCfg, t.fullKey)
      } else if (nextStatus === 1 && t.status !== 1 && t.fullKey) {
        await addCpaApiKey(cpaCfg, t.fullKey)
      }
    } else if (body.status === 2 || body.enabled === false) {
      if (t.status === 1 && t.fullKey) await removeCpaApiKey(cpaCfg, t.fullKey)
    } else if (body.status === 1 || body.enabled === true) {
      if (t.status !== 1 && t.fullKey) await addCpaApiKey(cpaCfg, t.fullKey)
    }
    const updated = userKeyStore.update(req.auth.user.id, t.id, body, statusOnly)
    if (!updated) {
      res.json(fail('密钥不存在'))
      return
    }
    res.json(ok(userKeyStore.getPublic(req.auth.user.id, updated.id, false)))
  } catch (err) {
    console.error('[cpa] update key/:id failed', err?.message || err)
    const msg = err?.message || '更新密钥失败'
    if (/无法启用|已过期|用尽/.test(msg)) {
      res.json(fail(msg))
      return
    }
    res.status(502).json(fail(msg))
  }
})

app.get('/api/token/:id/key', requireAuth, (req, res) => {
  const t = userKeyStore.get(req.auth.user.id, req.params.id)
  if (!t) {
    res.json(fail('密钥不存在'))
    return
  }
  res.json(ok({ key: t.fullKey }))
})

app.post('/api/token/:id/key', requireAuth, (req, res) => {
  const t = userKeyStore.get(req.auth.user.id, req.params.id)
  if (!t) {
    res.json(fail('密钥不存在'))
    return
  }
  // Legacy: return raw string; also support { key } shape for aily UI
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

function consoleUsageScope(req) {
  const userId = String(req.auth?.user?.id || '')
  const tokens = userKeyStore.list(userId)
  const hashSet = new Set()
  const hashToName = new Map()
  for (const t of tokens) {
    if (!t.fullKey) continue
    const h = hashApiKey(t.fullKey)
    hashSet.add(h)
    hashToName.set(h, t.name || t.key)
  }
  return { userId, hashSet, hashToName }
}

function parseUsageQuery(req, { consoleScope = false } = {}) {
  const q = {
    p: req.query.p,
    page_size: req.query.page_size,
    type: req.query.type,
    token_name: req.query.token_name || req.query.key || '',
    model_name: req.query.model_name || req.query.model || '',
    group: req.query.group || '',
    is_stream: req.query.is_stream || req.query.stream || '',
    range: req.query.range || '24h',
    grain: req.query.grain || '',
    start_timestamp: req.query.start_timestamp,
    end_timestamp: req.query.end_timestamp,
    username: req.query.username || '',
    includeUser: !consoleScope,
  }
  if (consoleScope) {
    const { userId, hashSet } = consoleUsageScope(req)
    // Scope server-side: userId OR keyHash in user's keys (never trust client filters for identity)
    q._consoleUserId = userId
    q._consoleHashes = hashSet
  }
  return q
}

app.get('/api/log/self', requireAuth, (req, res) => {
  try {
    const scope = parseUsageQuery(req, { consoleScope: true })
    const { userId, hashSet, hashToName } = consoleUsageScope(req)
    const type = req.query.type != null && req.query.type !== '' ? Number(req.query.type) : undefined
    const result = siteUsage.listEvents({
      p: scope.p,
      page_size: scope.page_size || 20,
      type,
      token_name: scope.token_name,
      model_name: scope.model_name,
      group: scope.group,
      is_stream: scope.is_stream,
      range: scope.range,
      start_timestamp: scope.start_timestamp,
      end_timestamp: scope.end_timestamp,
      includeUser: false,
      userIdOrKeyHashes: { userId, keyHashes: hashSet },
    })
    for (const it of result.items || []) {
      if (it.keyHash && hashToName.has(it.keyHash)) it.token_name = hashToName.get(it.keyHash)
      // Never expose diagnosis affordance to console clients
      delete it.has_detail
      delete it.diagnosis_id
    }
    res.json(
      ok({
        ...result,
        source: 'site-usage',
        note: '用量来自本站 BFF /v1 记录（按你的用户与密钥范围）。控制台不可查看请求诊断。',
      }),
    )
  } catch (err) {
    console.error('[log/self]', err?.message || err)
    res.json(ok({ items: [], total: 0, limited: true, note: `用量查询失败：${err?.message || 'error'}` }))
  }
})

app.get('/api/log/chart', requireAuth, (req, res) => {
  try {
    const scope = parseUsageQuery(req, { consoleScope: true })
    const { userId, hashSet } = consoleUsageScope(req)
    const scopedChart = siteUsage.chartData({
      type: 2,
      token_name: scope.token_name,
      model_name: scope.model_name,
      group: scope.group,
      is_stream: scope.is_stream,
      range: scope.range,
      grain: scope.grain,
      start_timestamp: scope.start_timestamp,
      end_timestamp: scope.end_timestamp,
      userIdOrKeyHashes: { userId, keyHashes: hashSet },
    })
    res.json(ok({ ...scopedChart, source: 'site-usage', scoped: true }))
  } catch (err) {
    console.error('[log/chart]', err?.message || err)
    res.status(500).json(fail(err?.message || 'chart failed'))
  }
})

app.get('/api/log/filters', requireAuth, (req, res) => {
  try {
    const { userId, hashSet, hashToName } = consoleUsageScope(req)
    const data = siteUsage.logFilters({
      range: 'all',
      includeUsers: false,
      userIdOrKeyHashes: { userId, keyHashes: hashSet },
    })
    res.json(
      ok({
        token_names: [...new Set([...(data.token_names || []), ...hashToName.values()].filter(Boolean))].sort(),
        model_names: data.model_names || [],
        usernames: [],
        groups: data.groups || [],
        source: 'site-usage',
      }),
    )
  } catch (err) {
    console.error('[log/filters]', err?.message || err)
    res.status(500).json(fail(err?.message || 'filters failed'))
  }
})

// Console must NEVER get diagnosis bodies
app.get('/api/log/:id', requireAuth, (_req, res) => {
  res.status(403).json(fail('诊断详情仅管理员可用'))
})
app.get('/api/diagnosis/:id', requireAuth, (_req, res) => {
  res.status(403).json(fail('诊断详情仅管理员可用'))
})
app.get('/api/diagnosis/logs/:id', requireAuth, (_req, res) => {
  res.status(403).json(fail('诊断详情仅管理员可用'))
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
        'openapi /admin = CPA-kernel operator console (site-usage + CPA management).',
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
        note: '多管理员：在服务端 .env 配置上述变量（逗号分隔），或将本站用户 role 设为 admin。',
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
          openapi_admin: 'https://openapi.juc114.cn/admin',
          note: 'CPA management key is primary. Usage is site-scoped (BFF /v1).',
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
    const ailyModels = await ailyManager.testEmbeddedModels().catch((e) => ({
      ok: false,
      message: e?.message || String(e),
      models: [],
    }))
    const ailyStatus = ailyManager.publicStatus()
    const collector = cpaCollector.getStatus()
    res.json(
      ok({
        checked_at: new Date().toISOString(),
        cpa_base: cpaCfg.cpaBaseUrl,
        billing_base: cpaCfg.billingBaseUrl,
        public_api_base: cpaCfg.publicApiBaseUrl,
        secrets: {
          demo: !!cpaCfg.demoKey,
          management: !!cpaCfg.managementKey,
          admin: !!cpaCfg.adminKey,
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
          ok: !!ailyModels.ok,
          message: ailyModels.message || null,
          model_count: Array.isArray(ailyModels.models) ? ailyModels.models.length : 0,
          latency_ms: ailyModels.latency_ms || null,
          model_routes: ailyStatus.model_routes,
          has_access_token: ailyStatus.has_access_token,
          upstream: ailyStatus.upstream,
          bridge: 'embedded',
        },
        note: 'CPA + billing are primary. Aily uses in-process bridge (shared .aily tokens). Separate :8088 adapter is optional/legacy.',
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
    // CPAMP-literal: POST /v0/management/quota-snapshots/query (SPA Yd.query).
    // CPA has no quota-snapshots (404). Site store is fallback only.
    let quotaMeta = { source: null, ok: false }
    let enriched = items
    try {
      const { byKey, meta } = await fetchCpampAccountQuotas(cpaCfg, auth)
      quotaMeta = meta
      enriched = mergeCpampQuotaIntoAccounts(items, byKey)
    } catch (err) {
      quotaMeta = { ok: false, error: err?.message || String(err), source: 'cpamp:quota-snapshots' }
      // Fallback: site Rebuild store
      try {
        const q = quotaSnapshots.query({
          accounts: items.map((a) => a.name || a.id).filter(Boolean),
          latest_only: true,
        })
        const byAccount = {}
        for (const e of q.items || []) {
          if (e?.account) byAccount[e.account] = e
        }
        enriched = items.map((a) => {
          const key = a.name || a.id
          const snap = key ? byAccount[key] : null
          if (!snap) return a
          return {
            ...a,
            plan_type: a.plan_type || snap.plan_type || null,
            quota: {
              remaining_ratio: snap.remaining_ratio,
              remaining: snap.remaining,
              limit: snap.limit,
              window: snap.window,
              resets_at: snap.resets_at,
              risk: snap.risk,
              plan_type: snap.plan_type || a.plan_type,
              observed_at_ms: snap.observed_at_ms,
              source: 'site:quota-snapshots',
            },
          }
        })
        quotaMeta = { ...quotaMeta, fallback: 'site:quota-snapshots' }
      } catch {
        /* keep items */
      }
    }
    // CPAMP Fle subscription: loadCodeAssist for antigravity rows missing plan_type
    let planMeta = { ok: false, source: 'cpa:api-call:loadCodeAssist' }
    try {
      const needPlan = enriched.some(
        (a) => String(a?.provider || '').toLowerCase() === 'antigravity' && !a.plan_type && !a.quota?.plan_type,
      )
      if (needPlan) {
        const { items: withPlans, meta } = await enrichAntigravityPlans(cpaCfg, enriched, auth)
        enriched = withPlans
        planMeta = { ok: true, ...meta }
      } else {
        planMeta = { ok: true, skipped: true, reason: 'all_have_plan_or_none_antigravity' }
      }
    } catch (err) {
      planMeta = { ok: false, error: err?.message || String(err), source: 'cpa:api-call:loadCodeAssist' }
    }

    const pool = summarizeAccounts(enriched)
    const quota_risk = enriched.filter((a) => a.quota && ['low', 'critical', 'exhausted'].includes(a.quota.risk)).length
    pool.quota_risk = quota_risk
    pool.attention = (pool.attention || 0) + quota_risk
    res.json(
      ok({
        observed_at: auth?.observed_at || cpaCollector.getStatus().lastSync || null,
        items: enriched,
        pool,
        source: 'cpa:auth-files+cpamp:quota-snapshots+loadCodeAssist',
        collector: cpaCollector.getStatus(),
        quota_snapshots: quotaSnapshots.stats(),
        quota: quotaMeta,
        plan: planMeta,
      }),
    )
  } catch (err) {
    console.error('[admin] accounts', err?.message || err)
    res.status(502).json(fail(err?.message || 'accounts failed'))
  }
})

app.get('/api/admin/usage', requireAdmin, async (req, res) => {
  try {
    const period = String(req.query.period || req.query.range || 'all')
    const summary = siteUsage.summarize({ period })
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

app.get('/api/admin/usage/logs', requireAdmin, (req, res) => {
  try {
    const q = parseUsageQuery(req, { consoleScope: false })
    const type = req.query.type != null && req.query.type !== '' ? Number(req.query.type) : undefined
    const result = siteUsage.listEvents({
      p: q.p,
      page_size: q.page_size || 20,
      type,
      token_name: q.token_name,
      model_name: q.model_name,
      group: q.group,
      is_stream: q.is_stream,
      range: q.range,
      start_timestamp: q.start_timestamp,
      end_timestamp: q.end_timestamp,
      username: q.username,
      includeUser: true,
    })
    res.json(ok({ ...result, source: 'site-usage' }))
  } catch (err) {
    console.error('[admin] usage/logs', err?.message || err)
    res.status(500).json(fail(err?.message || 'usage logs failed'))
  }
})

app.get('/api/admin/usage/chart', requireAdmin, (req, res) => {
  try {
    const q = parseUsageQuery(req, { consoleScope: false })
    const chart = siteUsage.chartData({
      type: req.query.type != null && req.query.type !== '' ? Number(req.query.type) : 2,
      token_name: q.token_name,
      model_name: q.model_name,
      group: q.group,
      is_stream: q.is_stream,
      range: q.range,
      grain: q.grain,
      start_timestamp: q.start_timestamp,
      end_timestamp: q.end_timestamp,
      username: q.username,
    })
    res.json(ok({ ...chart, source: 'site-usage' }))
  } catch (err) {
    console.error('[admin] usage/chart', err?.message || err)
    res.status(500).json(fail(err?.message || 'usage chart failed'))
  }
})

app.get('/api/admin/usage/filters', requireAdmin, (req, res) => {
  try {
    const data = siteUsage.logFilters({
      range: req.query.range || 'all',
      username: req.query.username || '',
      includeUsers: true,
    })
    res.json(ok({ ...data, source: 'site-usage' }))
  } catch (err) {
    console.error('[admin] usage/filters', err?.message || err)
    res.status(500).json(fail(err?.message || 'usage filters failed'))
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
  res.json(ok({ groups: groupStore.listGroups(), updated_at: null, quota_unit: quotaUnitStore.getUnit(), credit_unit: creditUnitInfo() }))
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
      res.status(400).json(fail('amount 须为正数（token）'))
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
        ...ailyManager.adminStatus(),
        pool: {
          items: ailyCredentials.listPublic(),
          metrics: ailyCredentials.poolMetrics(),
          strategy: ailyCredentials.getStrategy(),
        },
        cpa_openai_compatibility: openaiCompat,
        architecture: {
          primary: 'client → openapi /v1 → BFF → CPA billing :8320 → CPA',
          aily_credentials: 'multi-account pool server/data/aily-credentials.json (+ migrate from .aily)',
          selective_route:
            'AILY_MODEL_ROUTES → BFF in-process Aily bridge with round-robin pool',
          load_balance: 'AILY_LOAD_BALANCE_STRATEGY=round-robin|priority',
          legacy_adapter: 'separate aily-openai-adapter :8088 is optional/legacy; not required',
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
    const [upstream, models] = await Promise.all([
      ailyManager.testUpstreamMe().catch((e) => ({ ok: false, message: e?.message || String(e) })),
      ailyManager.testEmbeddedModels(true).catch((e) => ({ ok: false, message: e?.message || String(e) })),
    ])
    res.json(ok({ upstream, models, adapter: models /* alias for older UI */ }))
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
    const result = await ailyManager.testEmbeddedModels(true)
    res.status(result.ok ? 200 : 502).json(result.ok ? ok(result) : fail(result.message))
  } catch (err) {
    res.status(502).json(fail(err?.message || 'aily models failed'))
  }
})

app.get('/api/admin/aily/models', requireAdmin, async (req, res) => {
  try {
    const refresh = String(req.query.refresh || '') === '1'
    const result = await ailyManager.testEmbeddedModels(refresh)
    const catalog = (result.data || (result.models || []).map((id) => ({ id, object: 'model', owned_by: 'aily' }))).map(
      (m) => ({ id: m.id || m, name: m.name || m.id || m }),
    )
    const routing = ailyModelRouting.get()
    const pub = publicModelList(
      catalog.map((m) => ({ id: m.id, object: 'model', owned_by: 'aily', name: m.name })),
      routing,
    ).map((m) => ({ id: m.id, name: m.name || m.id }))
    res.status(result.ok || catalog.length ? 200 : 502).json(
      result.ok || catalog.length
        ? ok({
            catalog,
            whitelist: routing.whitelist,
            mappings: routing.mappings,
            public: pub,
            embedded: true,
            message: result.message,
            latency_ms: result.latency_ms,
            upstream: result.upstream,
          })
        : fail(result.message || 'aily models failed'),
    )
  } catch (err) {
    res.status(502).json(fail(err?.message || 'aily models failed'))
  }
})

app.put('/api/admin/aily/models', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {}
    const refresh = body.refresh === true
    const result = await ailyManager.testEmbeddedModels(refresh)
    const catalogList = result.data || (result.models || []).map((id) => ({ id, object: 'model', owned_by: 'aily' }))
    let routing = ailyModelRouting.get()
    if (body.sync === 'latest' || body.sync === 'upstream' || body.sync === 'clear') {
      routing = ailyModelRouting.sync(catalogList, body.sync)
      // preserve mappings from request if provided alongside sync
      if (body.mappings != null) {
        routing = ailyModelRouting.update({ mappings: body.mappings })
      }
    } else if (body.whitelist != null || body.mappings != null || body.model_routing) {
      routing = ailyModelRouting.update({
        whitelist:
          body.whitelist != null
            ? body.whitelist
            : (body.model_routing && body.model_routing.whitelist) || routing.whitelist,
        mappings:
          body.mappings != null
            ? body.mappings
            : (body.model_routing && body.model_routing.mappings) || routing.mappings,
      })
    }
    routing = normalizeModelRouting(routing)
    const catalog = catalogList.map((m) => ({ id: m.id, name: m.name || m.id }))
    const pub = publicModelList(catalogList, routing).map((m) => ({ id: m.id, name: m.name || m.id }))
    res.json(
      ok({
        catalog,
        whitelist: routing.whitelist,
        mappings: routing.mappings,
        public: pub,
        embedded: true,
      }),
    )
  } catch (err) {
    res.status(502).json(fail(err?.message || '保存模型配置失败'))
  }
})



/* ── Aily credential pool (multi-account + RR) — NOT grok/openai aily-accounts.json ── */
app.get('/api/admin/aily/pool', requireAdmin, (_req, res) => {
  try {
    res.json(
      ok({
        items: ailyCredentials.listPublic(),
        metrics: ailyCredentials.poolMetrics(),
        strategy: ailyCredentials.getStrategy(),
        auth_file: ailyManager.cfg.authFile,
        note: 'Aily号池（本站上游）≠ Grok/OpenAI上游 ≠ CPA凭证',
      }),
    )
  } catch (err) {
    res.status(500).json(fail(err?.message || 'aily pool list failed'))
  }
})

app.get('/api/admin/aily/pool/metrics', requireAdmin, (_req, res) => {
  try {
    res.json(ok(ailyCredentials.poolMetrics()))
  } catch (err) {
    res.status(500).json(fail(err?.message || 'metrics failed'))
  }
})

app.post('/api/admin/aily/pool', requireAdmin, (req, res) => {
  try {
    const row = ailyCredentials.create(req.body || {})
    res.json(ok(row))
  } catch (err) {
    res.status(400).json(fail(err?.message || 'create failed'))
  }
})

app.get('/api/admin/aily/pool/:id', requireAdmin, (req, res) => {
  try {
    const a = ailyCredentials.get(req.params.id)
    if (!a) return res.status(404).json(fail('账号不存在'))
    res.json(
      ok({
        ...ailyCredentials.publicAccount(a),
        full_access_token: a.access_token || '',
        full_refresh_token: a.refresh_token || '',
      }),
    )
  } catch (err) {
    res.status(500).json(fail(err?.message || 'get failed'))
  }
})

app.put('/api/admin/aily/pool/:id', requireAdmin, (req, res) => {
  try {
    const row = ailyCredentials.update(req.params.id, req.body || {})
    const primary = ailyCredentials
      .loadAccounts()
      .filter((a) => a.enabled !== false)
      .sort((a, b) => a.id - b.id)[0]
    if (primary && primary.id === row.id) {
      ailyCredentials.syncAccountToAuthFile(primary.id, ailyManager.cfg.authFile)
    }
    res.json(ok(row))
  } catch (err) {
    const status = String(err?.message || '').includes('不存在') ? 404 : 400
    res.status(status).json(fail(err?.message || 'update failed'))
  }
})

app.delete('/api/admin/aily/pool/:id', requireAdmin, (req, res) => {
  try {
    const row = ailyCredentials.remove(req.params.id)
    res.json(ok(row))
  } catch (err) {
    const status = String(err?.message || '').includes('不存在') ? 404 : 400
    res.status(status).json(fail(err?.message || 'delete failed'))
  }
})

app.post('/api/admin/aily/pool/:id/enable', requireAdmin, (req, res) => {
  try {
    const enabled = req.body?.enabled !== false
    const row = ailyCredentials.update(req.params.id, {
      enabled,
      ...(enabled ? { cooldown_until: null, last_error: null } : {}),
    })
    res.json(ok(row))
  } catch (err) {
    const status = String(err?.message || '').includes('不存在') ? 404 : 400
    res.status(status).json(fail(err?.message || 'enable failed'))
  }
})

app.post('/api/admin/aily/pool/:id/tokens', requireAdmin, (req, res) => {
  try {
    const body = req.body || {}
    const row = ailyCredentials.setTokens(req.params.id, {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      email: body.email,
      aily_base_url: body.aily_base_url,
    })
    ailyCredentials.syncAccountToAuthFile(row.id, ailyManager.cfg.authFile)
    res.json(ok(row))
  } catch (err) {
    const status = String(err?.message || '').includes('不存在') ? 404 : 400
    res.status(status).json(fail(err?.message || 'save tokens failed'))
  }
})

app.post('/api/admin/aily/pool/:id/refresh', requireAdmin, async (req, res) => {
  try {
    const result = await refreshAilyPoolAccount(req.params.id)
    res.status(result.ok ? 200 : 400).json(result.ok ? ok(result) : fail(result.message))
  } catch (err) {
    res.status(502).json(fail(err?.message || 'refresh failed'))
  }
})

app.post('/api/admin/aily/pool/:id/test', requireAdmin, async (req, res) => {
  try {
    const result = await testAilyPoolAccount(req.params.id)
    res.status(result.ok ? 200 : 400).json(result.ok ? ok(result) : fail(result.message))
  } catch (err) {
    res.status(502).json(fail(err?.message || 'test failed'))
  }
})

app.post('/api/admin/aily/pool/:id/login', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id
    const acc = ailyCredentials.get(id)
    if (!acc) return res.status(404).json(fail('账号不存在'))
    const email = String(req.body?.email || '').trim()
    const code = String(req.body?.code || '').trim()
    if (!email || !code) return res.status(400).json(fail('email and code required'))
    const baseUrl = req.body?.aily_base_url
    const result = await ailyManager.emailCodeLogin(email, code, baseUrl)
    if (!result.ok) return res.status(401).json(fail(result.message))
    const auth = ailyManager.readAuth()
    const row = ailyCredentials.setTokens(id, {
      access_token: auth.access_token,
      refresh_token: auth.refresh_token,
      email,
      aily_base_url: baseUrl || undefined,
    })
    ailyCredentials.update(id, { name: acc.name || email, email })
    res.json(ok({ ...result, account: ailyCredentials.publicAccount(ailyCredentials.get(id)) || row }))
  } catch (err) {
    res.status(502).json(fail(err?.message || 'pool login failed'))
  }
})

app.post('/api/admin/aily/pool/:id/send-code', requireAdmin, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim()
    if (!email) return res.status(400).json(fail('email required'))
    const acc = ailyCredentials.get(req.params.id)
    const base = req.body?.aily_base_url || acc?.aily_base_url
    const result = await ailyManager.sendEmailCode(email, base)
    res.status(result.ok ? 200 : result.status || 400).json(result.ok ? ok(result) : fail(result.message))
  } catch (err) {
    res.status(502).json(fail(err?.message || 'send-code failed'))
  }
})

app.post('/api/admin/aily/pool/migrate', requireAdmin, (_req, res) => {
  try {
    const result = ailyCredentials.migrateFromAuthFile(ailyManager.cfg.authFile)
    res.json(ok(result))
  } catch (err) {
    res.status(500).json(fail(err?.message || 'migrate failed'))
  }
})

/* ── Aily upstream accounts (Grok / OpenAI) — separate from CPA auth-files ── */
app.get('/api/admin/aily/accounts', requireAdmin, (_req, res) => {
  try {
    res.json(
      ok({
        items: ailyAccounts.listPublic(),
        platforms: ailyAccounts.COMPAT_PLATFORMS,
      }),
    )
  } catch (err) {
    res.status(500).json(fail(err?.message || 'accounts list failed'))
  }
})

app.post('/api/admin/aily/accounts', requireAdmin, (req, res) => {
  try {
    const row = ailyAccounts.create(req.body || {})
    res.json(ok(row))
  } catch (err) {
    res.status(400).json(fail(err?.message || 'create failed'))
  }
})

app.put('/api/admin/aily/accounts/:id', requireAdmin, (req, res) => {
  try {
    const row = ailyAccounts.update(req.params.id, req.body || {})
    res.json(ok(row))
  } catch (err) {
    const status = String(err?.message || '').includes('不存在') ? 404 : 400
    res.status(status).json(fail(err?.message || 'update failed'))
  }
})

app.delete('/api/admin/aily/accounts/:id', requireAdmin, (req, res) => {
  try {
    const row = ailyAccounts.remove(req.params.id)
    res.json(ok(row))
  } catch (err) {
    const status = String(err?.message || '').includes('不存在') ? 404 : 400
    res.status(status).json(fail(err?.message || 'delete failed'))
  }
})

app.post('/api/admin/aily/accounts/test', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {}
    const saved = body.id ? ailyAccounts.get(body.id) : null
    const platform = String((saved && saved.platform) || body.platform || '')
      .trim()
      .toLowerCase()
    if (!ailyAccounts.isCompatPlatform(platform)) {
      return res.status(400).json(fail('不支持的平台（仅 grok / openai）'))
    }
    const acc = {
      id: saved ? saved.id : 0,
      platform,
      auth_type: (saved && saved.auth_type) || body.auth_type || 'api_key',
      api_key: String(body.api_key || (saved && saved.api_key) || ''),
      base_url: String(
        body.base_url || (saved && saved.base_url) || ailyAccounts.defaultCompatBase(platform),
      ),
      custom_upstream: !!(body.custom_upstream ?? saved?.custom_upstream),
      oauth: saved?.oauth || null,
      model_routing: saved?.model_routing || body.model_routing || {},
    }
    if (!acc.api_key && !(acc.oauth && acc.oauth.access_token)) {
      return res.status(400).json(fail('请先填写 API Key 或完成 OAuth'))
    }
    if (acc.oauth?.access_token && !acc.api_key) acc.api_key = acc.oauth.access_token
    const result = await ailyCompat.testAccount(acc)
    res.json(ok(result))
  } catch (err) {
    res.status(502).json(fail(err?.message || 'test failed'))
  }
})

app.post('/api/admin/aily/oauth/start', requireAdmin, async (req, res) => {
  try {
    const result = await ailyOauth.startOAuth(req.body || {})
    res.json(ok(result))
  } catch (err) {
    res.status(400).json(fail(err?.message || 'oauth start failed'))
  }
})

app.get('/api/admin/aily/oauth/status', requireAdmin, (req, res) => {
  try {
    res.json(ok(ailyOauth.oauthStatus(req.query.state)))
  } catch (err) {
    res.status(500).json(fail(err?.message || 'oauth status failed'))
  }
})

app.post('/api/admin/aily/oauth/cancel', requireAdmin, (req, res) => {
  try {
    res.json(ok(ailyOauth.cancelOAuth(req.body?.state)))
  } catch (err) {
    res.status(500).json(fail(err?.message || 'oauth cancel failed'))
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
    const yamlWrite = isConfigYamlWriteEnabled()
    res.json(
      ok({
        config: sanitizeConfig(raw || {}),
        request_log: requestLog,
        source: 'cpa',
        writable: {
          request_log: true,
          openai_compatibility: true,
          config_yaml: yamlWrite,
          note: yamlWrite
            ? 'Protected config.yaml GET/PUT via /api/admin/config.yaml (auto-backup, reject empty/{}). Field endpoints remain for known settings.'
            : 'config.yaml write disabled (CONFIG_YAML_WRITE_ENABLED). Use field endpoints + providers + openai-compatibility.',
        },
      }),
    )
  } catch (err) {
    res.status(502).json(fail(err?.message || 'config failed'))
  }
})

app.get('/api/admin/config.yaml', requireAdmin, async (_req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const rawText = await fetchCpaConfigYamlRaw(cpaCfg)
    const payload = buildMaskedConfigPayload(rawText)
    payload.write_enabled = isConfigYamlWriteEnabled()
    payload.source = 'cpa:/v0/management/config.yaml'
    res.json(ok(payload))
  } catch (err) {
    const status = err?.status && Number.isFinite(err.status) ? err.status : 502
    res.status(status).json(fail(err?.message || 'config.yaml get failed'))
  }
})

app.put('/api/admin/config.yaml', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const result = await prepareAndPutConfigYaml(cpaCfg, req.body || {})
    result.source = 'cpa:/v0/management/config.yaml'
    res.json(ok(result))
  } catch (err) {
    const status = err?.status && Number.isFinite(err.status) ? err.status : 502
    res.status(status).json(fail(err?.message || 'config.yaml put failed'))
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
    if (req.body?.weight !== undefined) fields.weight = Number(req.body.weight)
    if (req.body?.disabled !== undefined) fields.disabled = !!req.body.disabled
    if (req.body?.proxy_url !== undefined) fields.proxy_url = String(req.body.proxy_url)
    if (req.body?.proxy !== undefined) fields.proxy = String(req.body.proxy)
    if (req.body?.prefix !== undefined) fields.prefix = String(req.body.prefix)
    if (req.body?.websockets !== undefined) fields.websockets = !!req.body.websockets
    if (req.body?.cooling !== undefined) fields.cooling = req.body.cooling
    if (req.body?.excluded_models !== undefined) fields.excluded_models = req.body.excluded_models
    if (req.body?.['excluded-models'] !== undefined) fields['excluded-models'] = req.body['excluded-models']
    const result = await patchAuthFileFields(cpaCfg, name, fields)
    try {
      invalidateCpaAuthFilesCache()
    } catch {
      /* ignore */
    }
    try {
      await cpaCollector.refresh({ force: true })
    } catch {
      /* ignore */
    }
    // Echo normalized excluded so UI can trust PATCH response
    const echoedExcluded =
      fields['excluded-models'] !== undefined
        ? fields['excluded-models']
        : fields.excluded_models !== undefined
          ? fields.excluded_models
          : undefined
    res.json(
      ok({
        name,
        fields,
        result,
        excluded_models: echoedExcluded,
        source: 'cpa',
      }),
    )
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


app.post('/api/admin/accounts/batch', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const action = String(req.body?.action || '').trim()
    const namesRaw = Array.isArray(req.body?.names) ? req.body.names : []
    const names = [...new Set(namesRaw.map((n) => String(n || '').trim()).filter(Boolean))]
    if (!names.length) {
      res.status(400).json(fail('names required'))
      return
    }
    if (!['enable', 'disable', 'delete', 'priority', 'weight', 'download'].includes(action)) {
      res.status(400).json(fail('action must be enable|disable|delete|priority|weight|download'))
      return
    }
    let priority
    let weight
    if (action === 'priority') {
      priority = Number(req.body?.priority)
      if (!Number.isFinite(priority)) {
        res.status(400).json(fail('priority must be a number'))
        return
      }
    }
    if (action === 'weight') {
      weight = Number(req.body?.weight)
      if (!Number.isFinite(weight)) {
        res.status(400).json(fail('weight must be a number'))
        return
      }
    }
    const results = []
    const downloads = []
    for (const name of names) {
      try {
        if (action === 'enable') await setAuthFileDisabled(cpaCfg, name, false)
        else if (action === 'disable') await setAuthFileDisabled(cpaCfg, name, true)
        else if (action === 'delete') await deleteAuthFile(cpaCfg, name)
        else if (action === 'priority') await patchAuthFileFields(cpaCfg, name, { priority })
        else if (action === 'weight') await patchAuthFileFields(cpaCfg, name, { weight })
        else if (action === 'download') {
          const content = await downloadAuthFile(cpaCfg, name)
          downloads.push({ name, content })
        }
        results.push({ name, ok: true })
      } catch (err) {
        results.push({ name, ok: false, error: err?.message || String(err), status: err?.status || 502 })
      }
    }
    try {
      await cpaCollector.refresh({ force: true })
    } catch {
      /* ignore */
    }
    res.setHeader('Cache-Control', 'no-store')
    res.json(
      ok({
        action,
        results,
        downloads: action === 'download' ? downloads : undefined,
        ok_count: results.filter((r) => r.ok).length,
        fail_count: results.filter((r) => !r.ok).length,
        source: 'cpa',
      }),
    )
  } catch (err) {
    res.status(err?.status || 502).json(fail(err?.message || 'account batch failed'))
  }
})

app.get('/api/admin/accounts/models', requireAdmin, async (req, res) => {
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
    const data = await fetchAuthFileModels(cpaCfg, name)
    const models = normalizeAuthFileModels(data)
    let excluded_models = []
    try {
      // Prefer fresh CPA read after fields PATCH — never serve stale TTL cache for excludes
      let filesPayload = null
      try {
        filesPayload = await fetchCpaAuthFilesCached(cpaCfg, { force: true })
      } catch {
        filesPayload = cpaCollector.getAuthFilesPayload?.() || null
      }
      const files = Array.isArray(filesPayload?.files) ? filesPayload.files : []
      const hit = files.find((f) => String(f?.name || '') === name)
      if (hit) {
        excluded_models = parseExcludedModels(
          hit.excluded_models ??
            hit['excluded-models'] ??
            hit.excludedModels ??
            hit.attributes?.excluded_models ??
            hit.attributes?.['excluded-models'],
        )
      }
    } catch {
      /* optional enrichment */
    }
    res.json(
      ok({
        name,
        models,
        models_raw: data,
        excluded_models,
        source: 'cpa',
      }),
    )
  } catch (err) {
    res.status(err?.status || 502).json(fail(err?.message || 'auth-file models failed'))
  }
})

app.post('/api/admin/accounts/reset-quota', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const name = String(req.body?.name || '').trim()
    const auth_index = req.body?.auth_index
    const result = await resetAuthFileQuota(cpaCfg, { name, auth_index })
    res.json(ok({ name: name || null, auth_index: auth_index ?? null, result, source: 'cpa' }))
  } catch (err) {
    res.status(err?.status || 502).json(fail(err?.message || 'reset-quota failed'))
  }
})

app.post('/api/admin/accounts/refresh-quota', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey && !cpaCfg.adminKey) {
      res.status(503).json(fail('CPA/CPAMP keys 未配置'))
      return
    }
    await cpaCollector.refresh({ force: true })
    let auth = cpaCollector.getAuthFilesPayload()
    if (!auth) auth = await fetchCpaAuthFilesCached(cpaCfg, { force: true })
    const namesRaw = Array.isArray(req.body?.names) ? req.body.names : []
    const names = [...new Set(namesRaw.map((n) => String(n || '').trim()).filter(Boolean))]
    const refreshed = await refreshAccountQuotas(cpaCfg, auth, {
      names: names.length ? names : null,
    })
    // Persist api-call successes into site store (local cache; display still prefers CPAMP query)
    try {
      const entries = []
      for (const r of refreshed.results || []) {
        if (r.status !== 'success' || !r.quota_windows?.length || !r.name) continue
        for (const w of r.quota_windows) {
          entries.push({
            account: r.name,
            provider: r.provider || 'antigravity',
            remaining_ratio: w.remaining_ratio,
            window: w.window || w.label,
            resets_at: w.resets_at,
            risk: w.risk,
            plan_type: r.plan_type || null,
            source: 'cpa:api-call',
            meta: { label: w.label },
          })
        }
      }
      if (entries.length) quotaSnapshots.ingest(entries)
    } catch {
      /* non-fatal */
    }
    const items = mergeCpampQuotaIntoAccounts(mapAdminAccounts(auth), refreshed.byKey)
    res.json(
      ok({
        ...refreshed.meta,
        results: (refreshed.results || []).map((r) => ({
          name: r.name,
          status: r.status,
          error: r.error || null,
          errorStatus: r.errorStatus || null,
          windows: r.quota_windows?.length || 0,
          reason: r.reason || null,
        })),
        items,
        source: refreshed.meta?.source || 'cpamp:quota-snapshots+cpa:api-call',
      }),
    )
  } catch (err) {
    console.error('[admin] refresh-quota', err?.message || err)
    res.status(err?.status || 502).json(fail(err?.message || 'refresh-quota failed'))
  }
})


app.post('/api/admin/accounts/convert-upload', requireAdmin, async (req, res) => {
  try {
    if (!cpaCfg.managementKey) {
      res.status(503).json(fail('CPA Management Key 未配置'))
      return
    }
    const pasteType = String(req.body?.paste_type || req.body?.type || 'cpa').trim()
    let content = req.body?.content
    if (content && typeof content === 'object') content = JSON.stringify(content)
    content = String(content || '')
    const preferredName = String(req.body?.filename || req.body?.name || '').trim()
    if (!content) {
      res.status(400).json(fail('content required'))
      return
    }
    const converted = convertPasteToAuthFiles(pasteType, content, preferredName)
    const uploadResults = []
    for (const file of converted.files) {
      try {
        const result = await uploadAuthFile(cpaCfg, {
          filename: file.fileName,
          content: JSON.stringify(file.authJson, null, 2),
        })
        uploadResults.push({ name: file.fileName, ok: true, result })
      } catch (err) {
        uploadResults.push({ name: file.fileName, ok: false, error: err?.message || String(err) })
      }
    }
    try {
      await cpaCollector.refresh({ force: true })
    } catch {
      /* ignore */
    }
    res.setHeader('Cache-Control', 'no-store')
    res.json(
      ok({
        paste_type: pasteType,
        converted_source_count: converted.convertedSourceCount,
        convert_failures: converted.failures,
        uploads: uploadResults,
        ok_count: uploadResults.filter((r) => r.ok).length,
        fail_count: uploadResults.filter((r) => !r.ok).length,
        source: 'cpa+convert',
      }),
    )
  } catch (err) {
    res.status(err?.status || 502).json(fail(err?.message || 'convert-upload failed'))
  }
})

app.post('/api/admin/quota-snapshots', requireAdmin, (req, res) => {
  try {
    const entries = req.body?.entries ?? req.body
    const result = quotaSnapshots.ingest(entries)
    res.json(ok({ ...result, source: 'site:quota-snapshots' }))
  } catch (err) {
    res.status(500).json(fail(err?.message || 'quota-snapshots ingest failed'))
  }
})

app.post('/api/admin/quota-snapshots/query', requireAdmin, (req, res) => {
  try {
    const result = quotaSnapshots.query({
      accounts: req.body?.accounts,
      now_ms: req.body?.now_ms,
      include_inactive: req.body?.include_inactive !== false,
      latest_only: req.body?.latest_only !== false,
    })
    res.json(ok(result))
  } catch (err) {
    res.status(500).json(fail(err?.message || 'quota-snapshots query failed'))
  }
})

app.get('/api/admin/quota-snapshots/stats', requireAdmin, (_req, res) => {
  res.json(ok({ ...quotaSnapshots.stats(), source: 'site:quota-snapshots' }))
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

app.get('/api/admin/quota-unit', requireAdmin, (_req, res) => {
  try {
    res.json(ok(quotaUnitStore.get()))
  } catch (err) {
    res.status(500).json(fail(err?.message || 'quota-unit failed'))
  }
})

app.put('/api/admin/quota-unit', requireAdmin, (req, res) => {
  try {
    const body = req.body || {}
    // N only (1 点 = N raw). Accepts number or B/M/K string. USD→raw stays FIXED 500000.
    const next = body.raw_per_point ?? body.quota_per_unit ?? body.value
    const data = quotaUnitStore.setUnit(next)
    try {
      // Re-attach raw from stored USD with FIXED 500000 (N change does not alter raw rates).
      modelPrices.recomputeQuotaFields()
    } catch (e) {
      console.warn('[quota-unit] recompute price quota fields:', e?.message || e)
    }
    res.json(ok(data))
  } catch (err) {
    res.status(err?.status || 400).json(fail(err?.message || 'quota-unit put failed'))
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

app.post('/api/admin/model-prices/sync', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {}
    const overwriteManual = body.overwrite_manual === true || body.overwriteManual === true
    const data = await modelPrices.syncOfficial({ overwriteManual })
    res.json(
      ok({
        imported: data.imported,
        updated: data.updated,
        skipped: data.skipped,
        skipped_unsupported: data.skipped_unsupported,
        stale_removed: data.stale_removed,
        failed_sources: data.failed_sources || [],
        sources: data.sources || {},
        total_prices: data.total_prices,
        supported_count: data.supported_count,
        priced_count: data.priced_count,
        priced_auto: data.priced_auto,
        priced_manual: data.priced_manual,
        unpriced_count: data.unpriced_count,
        inherited_count: data.inherited_count || 0,
        inheritance_missed_count: data.inheritance_missed_count || 0,
        inherited: data.inherited || [],
        inheritance_missed: data.inheritance_missed || [],
        matched_from_sources: data.matched_from_sources,
        quota_per_unit: data.quota_per_unit,
        at: data.at,
        updated_at: data.updated_at,
        last_sync: data,
      }),
    )
  } catch (err) {
    console.error('[admin] model-prices/sync', err?.message || err)
    res.status(err?.status || 500).json(fail(err?.message || 'model-prices sync failed'))
  }
})

app.get('/api/admin/model-prices/runtime-models', requireAdmin, async (req, res) => {
  try {
    const period = String(req.query?.period || 'all')
    const supported = await resolveSupportedModels()
    const usageSeen = new Set(siteUsage.distinctModels({ period }) || [])
    const models = [...new Set(supported)].sort((a, b) => a.localeCompare(b))
    res.json(
      ok({
        models,
        supported: models,
        usage_models: [...usageSeen].sort((a, b) => a.localeCompare(b)),
        period,
        source: 'cpa-/v1/models+aily-routing',
        note: 'Canonical supported set for price sync (not historical site-usage).',
      }),
    )
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


// ——— Wave C: usage import/export + site-side Codex inspection ———

app.get('/api/admin/usage/export', requireAdmin, (req, res) => {
  try {
    const period = String(req.query?.period || 'all')
    const limit = req.query?.limit != null ? Number(req.query.limit) : 0
    const bundle = siteUsage.exportBundle({ period, limit })
    const filename = `site-usage-export-${new Date().toISOString().slice(0, 10)}.json`
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.json(ok(bundle))
  } catch (err) {
    console.error('[admin] usage/export', err?.message || err)
    res.status(500).json(fail(err?.message || 'usage export failed'))
  }
})

app.post('/api/admin/usage/import', requireAdmin, (req, res) => {
  try {
    const body = req.body || {}
    const mode = body.mode === 'merge' ? 'merge' : 'append'
    const payload = body.events || body.bundle || body
    const result = siteUsage.importEvents(payload, {
      mode,
      maxImport: Number(body.max_import) > 0 ? Number(body.max_import) : 100_000,
    })
    res.json(ok(result))
  } catch (err) {
    console.error('[admin] usage/import', err?.message || err)
    res.status(err?.status || 400).json(fail(err?.message || 'usage import failed'))
  }
})

app.post('/api/admin/usage/import-sessions', requireAdmin, (req, res) => {
  try {
    const body = req.body || {}
    const meta = usageImportSessions.start({
      mode: body.mode,
      expected_chunks: body.expected_chunks,
    })
    res.status(201).json(ok(meta))
  } catch (err) {
    res.status(err?.status || 400).json(fail(err?.message || 'import session start failed'))
  }
})

app.get('/api/admin/usage/import-sessions/:id', requireAdmin, (req, res) => {
  try {
    res.json(ok(usageImportSessions.get(req.params.id)))
  } catch (err) {
    res.status(err?.status || 404).json(fail(err?.message || 'import session not found'))
  }
})

app.post('/api/admin/usage/import-sessions/:id/chunk', requireAdmin, (req, res) => {
  try {
    const result = usageImportSessions.addChunk(req.params.id, req.body || {})
    res.json(ok(result))
  } catch (err) {
    res.status(err?.status || 400).json(fail(err?.message || 'import chunk failed'))
  }
})

app.post('/api/admin/usage/import-sessions/:id/complete', requireAdmin, (req, res) => {
  try {
    const meta = usageImportSessions.complete(req.params.id)
    res.json(ok(meta))
  } catch (err) {
    res.status(err?.status || 400).json(fail(err?.message || 'import complete failed'))
  }
})

app.post('/api/admin/usage/import-sessions/:id/cancel', requireAdmin, (req, res) => {
  try {
    res.json(ok(usageImportSessions.cancel(req.params.id)))
  } catch (err) {
    res.status(err?.status || 400).json(fail(err?.message || 'import cancel failed'))
  }
})

app.post('/api/admin/codex-inspection/run', requireAdmin, async (req, res) => {
  try {
    const asyncMode = req.body?.async === true || String(req.query?.async || '') === '1'
    const run = await codexInspection.startRun({ async: asyncMode })
    res.status(asyncMode ? 202 : 200).json(ok(run))
  } catch (err) {
    console.error('[admin] codex-inspection/run', err?.message || err)
    res.status(err?.status || 500).json(fail(err?.message || 'codex inspection run failed'))
  }
})

app.get('/api/admin/codex-inspection/runs', requireAdmin, (req, res) => {
  try {
    const limit = req.query?.limit != null ? Number(req.query.limit) : 30
    res.json(ok(codexInspection.listRuns({ limit })))
  } catch (err) {
    res.status(500).json(fail(err?.message || 'codex inspection list failed'))
  }
})

app.get('/api/admin/codex-inspection/runs/:id', requireAdmin, (req, res) => {
  try {
    res.json(ok(codexInspection.getRun(req.params.id)))
  } catch (err) {
    res.status(err?.status || 404).json(fail(err?.message || 'run not found'))
  }
})

app.post('/api/admin/codex-inspection/runs/:id/cancel', requireAdmin, (req, res) => {
  try {
    res.json(ok(codexInspection.cancelRun(req.params.id)))
  } catch (err) {
    res.status(err?.status || 400).json(fail(err?.message || 'cancel failed'))
  }
})

app.post('/api/admin/codex-inspection/runs/:id/actions', requireAdmin, async (req, res) => {
  try {
    const result = await codexInspection.applyActions(req.params.id, req.body || {})
    res.json(ok(result))
  } catch (err) {
    console.error('[admin] codex-inspection/actions', err?.message || err)
    res.status(err?.status || 400).json(fail(err?.message || 'actions failed'))
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

try {
  const sched = modelPrices.startScheduledSync()
  if (sched?.enabled) {
    console.log(`[server] modelPrices sync scheduled every ${sched.interval_hours}h`)
  } else {
    console.log('[server] modelPrices sync schedule disabled')
  }
} catch (err) {
  console.error('[modelPrices] schedule start failed', err?.message || err)
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
  console.log(`[server] local_users=${localUserStore.listUsers().length} aily_bridge=embedded aily_upstream=${ailyManager.getUpstreamBase()} aily_routes=${ailyManager.cfg.modelRoutes.length} aily_pool=${ailyCredentials.poolMetrics().total} lb=${ailyCredentials.getStrategy()}`)
  console.log(`[server] cpaCollector=${cpaCollector.getStatus().ok ? 'ok' : 'pending'} siteUsage=${siteUsage.stats().events}`)
})
