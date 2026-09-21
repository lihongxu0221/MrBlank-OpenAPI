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
  flattenUsageForHashes,
  hashApiKey,
  maskKey,
} from './cpa.js'
import { createUserKeyStore } from './userKeys.js'

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

const CLIENT_ID = process.env.LINUXDO_CLIENT_ID || ''
const CLIENT_SECRET = process.env.LINUXDO_CLIENT_SECRET || ''
const REDIRECT_URI =
  process.env.LINUXDO_REDIRECT_URI || 'https://openapi.juc114.cn/oauth/linuxdo'
const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '127.0.0.1'
const SESSION_SECRET = process.env.SESSION_SECRET || ''
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://openapi.juc114.cn'
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
    res.status(401).json(fail('请先使用 Linux.do 登录。'))
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

function publicHandlers() {
  return {
    status: () => ok({ quota_per_unit: Q }),
    config: () =>
      ok({
        loginEnabled: true,
        turnstileSiteKey: '',
        linuxdoClientId: CLIENT_ID,
      }),
    availability: () => {
      const now = new Date().toISOString()
      const hist = (rate) =>
        Array.from({ length: 7 }, (_, i) => ({
          checked_at: new Date(Date.now() - i * 86400000).toISOString(),
          status: Math.random() < rate ? 'operational' : 'down',
          latency_ms: 800 + Math.floor(Math.random() * 1200),
        }))
      const mk = (id, name, rate, latency, status = 'down') => ({
        id,
        name,
        status,
        latency_ms: latency,
        availability: Math.round(rate * 1000) / 10,
        history: hist(rate),
      })
      return ok({
        checked_at: now,
        groups: [
          {
            name: '默认分组',
            checked_at: now,
            models: [
              mk('grok-4.5', 'Grok 4.5', 0.713, 1480),
              mk('grok-4', 'Grok 4.0', 0.68, 1320),
              mk('grok-chat-auto', 'Grok Auto', 0.74, 980),
              mk('grok-chat-expert', 'Grok Expert', 0.71, 1510),
              mk('grok-chat-fast', 'Grok Fast', 0.82, 640),
              mk('grok-heavy', 'Grok Heavy', 0.55, 2400),
              mk('grok-composer-2.5-fast', 'Grok Composer 2.5 Fast', 0.79, 720),
              mk('grok-imagine-image', 'Grok Imagine', 0.66, 1800),
              mk('grok-imagine-image-2.0', 'Grok Imagine Image 2.0', 0.61, 2100),
              mk('grok-imagine-image-edit', 'Grok Imagine Image Edit', 0.58, 1950),
              mk('grok-imagine-image-lite', 'Grok Imagine Image Lite', 0.7, 1100),
              mk('grok-imagine-video', 'Grok Imagine Video', 0.42, 3200),
              mk('grok-imagine-video-1.5', 'Grok Imagine Video 1.5', 0.38, 3600),
            ],
          },
        ],
      })
    },
    pool: () =>
      ok({
        stale: false,
        items: Array.from({ length: 6 }, (_, i) => ({
          name: `Heavy-${String(i + 1).padStart(2, '0')}`,
          provider: 'xAI',
          tier: 'heavy',
          status: i % 5 === 0 ? 'exhausted' : 'available',
          quotas: [
            {
              mode: 'weekly',
              known: true,
              used: 20 + i * 11,
              limit: 100,
              reset_at: new Date(Date.now() + (7 - i) * 86400000).toISOString(),
            },
          ],
        })),
      }),
    leaderboard: (period = 'today', sort = 'credits', p = 1) => {
      const names = ['a***7', 'm***x', '蓝***云', 'c***9', '探***者', 'g***k', '星***海', 'n***2']
      const items = names.map((name, i) => ({
        rank: i + 1,
        name,
        calls: 40 - i * 3 + (period === 'all' ? 200 : period === '7d' ? 80 : 0),
        credits: 120 - i * 9 + (sort === 'calls' ? i : 0),
      }))
      return ok({ items, total: items.length, period, sort, page: p })
    },
    activity: (period = 'today') =>
      ok({
        period,
        items: [
          { model: 'grok-4.6', calls: 420, successful: 401, tokens: 1_200_000, credits: 86 },
          { model: 'grok-4', calls: 210, successful: 205, tokens: 540_000, credits: 41 },
          { model: 'grok-imagine-1.5', calls: 64, successful: 58, tokens: 0, credits: 22 },
          { model: 'grok-imagine-video-1.5', calls: 12, successful: 9, tokens: 0, credits: 18 },
        ],
      }),
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
app.get('/api/welfare/availability', (_req, res) => res.json(pub.availability()))
app.get('/api/welfare/pool', (_req, res) => res.json(pub.pool()))
app.get('/api/welfare/leaderboard', (req, res) =>
  res.json(
    pub.leaderboard(
      String(req.query.period || 'today'),
      String(req.query.sort || 'credits'),
      Number(req.query.p || 1),
    ),
  ),
)
app.get('/api/welfare/activity', (req, res) =>
  res.json(pub.activity(String(req.query.period || 'today'))),
)
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
    if (!id) return failRedirect('userinfo_empty')

    const user = { id, username, display_name }
    getOrCreateUserStore(user)

    const sid = randomToken(32)
    const access_token = randomToken(24)
    const expiresAt = Math.floor(Date.now() / 1000) + Math.floor(SESSION_TTL_MS / 1000)
    sessions.set(sid, {
      sid,
      access_token,
      createdAt: Date.now(),
      expiresAt,
      user,
    })
    setSessionCookie(res, sid)
    res.redirect(302, `${SITE_ORIGIN}/#/console`)
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

app.post('/api/user/auth/logout', (req, res) => {
  const sid = readSid(req)
  if (sid) sessions.delete(sid)
  clearSessionCookie(res)
  res.json(ok(true))
})

app.post('/api/user/auth/refresh', requireAuth, (req, res) => {
  res.json(
    ok({
      access_token: req.auth.access_token,
      token_type: 'Bearer',
      access_expires_at: req.auth.expiresAt,
      session: { sid: req.auth.sid, current: true },
      user: {
        id: req.auth.user.id,
        display_name: req.auth.user.display_name,
        username: req.auth.user.username,
      },
    }),
  )
})

/** Session restore payload for SPA (cookie-backed). */
app.get('/api/user/session', requireAuth, (req, res) => {
  res.json(
    ok({
      access_token: req.auth.access_token,
      token_type: 'Bearer',
      access_expires_at: req.auth.expiresAt,
      session: { sid: req.auth.sid, current: true },
      user: {
        id: req.auth.user.id,
        display_name: req.auth.user.display_name,
        username: req.auth.user.username,
      },
    }),
  )
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
})
