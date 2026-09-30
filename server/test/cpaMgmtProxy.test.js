import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import {
  createCpaMgmtRouter,
  filterCpaConfigForProviders,
  resolveCpaMgmtRoute,
  validateApiCallPayload,
  CPA_MGMT_PROVIDER_SECTIONS,
} from '../cpaMgmtProxy.js'

function listen(app) {
  return new Promise((resolve) => {
    const srv = http.createServer(app)
    srv.listen(0, '127.0.0.1', () => resolve(srv))
  })
}

const FULL_CONFIG = {
  'remote-management': { 'secret-key': 'hashed' },
  'api-keys': ['sk-user-1'],
  'auth-dir': '/root/.cli-proxy-api',
  'proxy-url': 'socks5://secret',
  'gemini-api-key': [{ 'api-key': 'AIza-1', 'x-unknown': 1 }],
  'codex-api-key': [{ 'api-key': 'co-1', 'base-url': 'https://chatgpt.com' }],
  'openai-compatibility': [{ name: 'p', 'base-url': 'https://x/v1', 'api-key-entries': [{ 'api-key': 'k' }] }],
}

describe('cpaMgmtProxy pure helpers', () => {
  it('filters /config to provider sections only', () => {
    const out = filterCpaConfigForProviders(FULL_CONFIG)
    assert.deepEqual(Object.keys(out).sort(), ['codex-api-key', 'gemini-api-key', 'openai-compatibility'])
    assert.equal(out['remote-management'], undefined)
    assert.equal(out['api-keys'], undefined)
    assert.equal(out['proxy-url'], undefined)
    assert.deepEqual(out['gemini-api-key'][0]['x-unknown'], 1)
  })

  it('route whitelist', () => {
    assert.deepEqual(resolveCpaMgmtRoute('GET', '/config'), { kind: 'config' })
    assert.equal(resolveCpaMgmtRoute('PUT', '/config'), null)
    assert.equal(resolveCpaMgmtRoute('GET', '/config.yaml'), null)
    assert.equal(resolveCpaMgmtRoute('GET', '/api-keys'), null)
    assert.equal(resolveCpaMgmtRoute('PUT', '/api-keys'), null)
    assert.equal(resolveCpaMgmtRoute('GET', '/auth-files'), null)
    assert.equal(resolveCpaMgmtRoute('GET', '/api-call'), null)
    assert.deepEqual(resolveCpaMgmtRoute('POST', '/api-call'), { kind: 'api-call' })
    assert.deepEqual(resolveCpaMgmtRoute('GET', '/api-key-usage'), { kind: 'api-key-usage' })
    assert.equal(CPA_MGMT_PROVIDER_SECTIONS.length, 8)
    for (const s of CPA_MGMT_PROVIDER_SECTIONS) {
      for (const m of ['GET', 'PUT', 'PATCH', 'DELETE']) assert.ok(resolveCpaMgmtRoute(m, `/${s}`), `${m} ${s}`)
      assert.equal(resolveCpaMgmtRoute('POST', `/${s}`), null)
    }
    assert.equal(resolveCpaMgmtRoute('GET', '/gemini-api-key/../config'), null)
  })

  it('api-call URL policy', () => {
    assert.equal(validateApiCallPayload({ url: 'https://api.openai.com/v1/models', method: 'GET' }).ok, true)
    for (const url of [
      'http://127.0.0.1:8317/v0/management/config',
      'http://localhost/x',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://172.20.0.1/',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/',
      'http://[fd00::1]/',
      'http://0.0.0.0/',
      'http://100.64.0.1/',
      'file:///etc/passwd',
      'ftp://example.com/',
      'https://user:pass@example.com/',
      'not a url',
    ]) {
      assert.equal(validateApiCallPayload({ url, method: 'GET' }).ok, false, url)
    }
    assert.equal(validateApiCallPayload({ url: 'https://a.com', method: 'TRACE' }).ok, false)
    assert.equal(validateApiCallPayload({ url: 'https://a.com', proxy_url: 'file:///x' }).ok, false)
    assert.equal(validateApiCallPayload({ url: 'https://a.com', proxy_url: 'socks5://1.2.3.4:1080' }).ok, true)
  })
})

describe('cpaMgmtProxy router (fake CPA upstream)', () => {
  let cpa
  let bff
  let base
  const seen = []
  const audits = []
  let putDelay = 0
  const order = []

  before(async () => {
    const up = express()
    up.use(express.json({ limit: '10mb' }))
    up.use((req, res, next) => {
      seen.push({ method: req.method, url: req.originalUrl, auth: req.headers.authorization, body: req.body })
      res.setHeader('X-CPA-VERSION', 'v8.0.4')
      res.setHeader('X-CPA-COMMIT', 'abc123')
      next()
    })
    up.get('/v0/management/config', (_req, res) => res.json(FULL_CONFIG))
    up.put('/v0/management/:section', async (req, res) => {
      order.push(`start:${req.body?.[0]?.tag}`)
      if (putDelay) await new Promise((r) => setTimeout(r, putDelay))
      order.push(`end:${req.body?.[0]?.tag}`)
      res.json({ status: 'ok' })
    })
    up.delete('/v0/management/:section', (_req, res) => res.json({ status: 'ok' }))
    up.get('/v0/management/api-key-usage', (_req, res) => res.json({ usage: {} }))
    up.post('/v0/management/api-call', (_req, res) => res.json({ status_code: 200, body: '{}' }))
    cpa = await listen(up)
    const cpaCfg = { cpaBaseUrl: `http://127.0.0.1:${cpa.address().port}`, managementKey: 'mgmt-secret' }

    const app = express()
    app.use(express.json({ limit: '8mb' }))
    // stand-in for index.js requireAdmin
    const requireAdmin = (req, res, next) => {
      const role = req.headers['x-test-role']
      if (!role) return res.status(401).json({ success: false, message: '请先登录。' })
      if (role !== 'admin') return res.status(403).json({ success: false, message: '需要管理员权限' })
      req.auth = { user: { id: 42 } }
      next()
    }
    app.use(
      '/api/admin/cpa-mgmt',
      requireAdmin,
      createCpaMgmtRouter({
        cpaCfg,
        express,
        audit: (e) => audits.push(e),
        limits: { apiCallPerMinute: 3, maxApiCallBodyBytes: 1024 },
      }),
    )
    bff = await listen(app)
    base = `http://127.0.0.1:${bff.address().port}/api/admin/cpa-mgmt`
  })

  after(() => {
    cpa?.close()
    bff?.close()
  })

  const req = (path, { method = 'GET', role = 'admin', body } = {}) =>
    fetch(`${base}${path}`, {
      method,
      headers: { ...(role ? { 'x-test-role': role } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

  it('requires admin session', async () => {
    assert.equal((await req('/config', { role: null })).status, 401)
    assert.equal((await req('/config', { role: 'user' })).status, 403)
  })

  it('GET /config strips sensitive sections, injects mgmt key upstream, passes version headers', async () => {
    const res = await req('/config')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('x-cpa-version'), 'v8.0.4')
    assert.equal(res.headers.get('x-cpa-commit'), 'abc123')
    const json = await res.json()
    assert.equal(json['remote-management'], undefined)
    assert.equal(json['api-keys'], undefined)
    assert.equal(json['auth-dir'], undefined)
    assert.ok(Array.isArray(json['gemini-api-key']))
    const last = seen.at(-1)
    assert.equal(last.auth, 'Bearer mgmt-secret')
  })

  it('rejects non-whitelisted paths/methods with 404 and never reaches CPA', async () => {
    const before = seen.length
    for (const [p, m] of [
      ['/api-keys', 'GET'],
      ['/api-keys', 'PUT'],
      ['/config', 'PUT'],
      ['/config.yaml', 'GET'],
      ['/auth-files', 'GET'],
      ['/logs', 'DELETE'],
      ['/gemini-api-key', 'POST'],
      ['/', 'GET'],
    ]) {
      const res = await req(p, { method: m, body: m === 'PUT' ? [] : undefined })
      assert.equal(res.status, 404, `${m} ${p}`)
    }
    assert.equal(seen.length, before)
  })

  it('DELETE forwards api-key + base-url query unchanged', async () => {
    const res = await req('/codex-api-key?api-key=co-1&base-url=https%3A%2F%2Fchatgpt.com', { method: 'DELETE' })
    assert.equal(res.status, 200)
    assert.equal(seen.at(-1).url, '/v0/management/codex-api-key?api-key=co-1&base-url=https%3A%2F%2Fchatgpt.com')
    assert.ok(audits.some((a) => a.method === 'DELETE' && a.target === 'codex-api-key'))
  })

  it('PUT body passes through verbatim (unknown fields preserved)', async () => {
    const payload = [{ 'api-key': 'AIza-1', 'x-unknown': { deep: true }, tag: 'verbatim' }]
    const res = await req('/gemini-api-key', { method: 'PUT', body: payload })
    assert.equal(res.status, 200)
    assert.deepEqual(seen.at(-1).body, payload)
  })

  it('serializes writes per section', async () => {
    putDelay = 60
    order.length = 0
    await Promise.all([
      req('/claude-api-key', { method: 'PUT', body: [{ tag: 'a' }] }),
      req('/claude-api-key', { method: 'PUT', body: [{ tag: 'b' }] }),
    ])
    putDelay = 0
    assert.deepEqual(order, ['start:a', 'end:a', 'start:b', 'end:b'])
  })

  it('api-call: policy, size limit, rate limit, audit without secrets', async () => {
    const blocked = await req('/api-call', { method: 'POST', body: { method: 'GET', url: 'http://127.0.0.1:8317/v0/management/config' } })
    assert.equal(blocked.status, 400)
    const big = await req('/api-call', { method: 'POST', body: { method: 'POST', url: 'https://api.example.com/v1/x', data: 'x'.repeat(4096) } })
    assert.equal(big.status, 413)
    const statuses = []
    for (let i = 0; i < 4; i++) {
      const r = await req('/api-call', {
        method: 'POST',
        body: { method: 'GET', url: 'https://api.example.com/v1/models?key=secret', header: { Authorization: 'Bearer sk-secret' } },
      })
      statuses.push(r.status)
    }
    assert.deepEqual(statuses, [200, 200, 200, 429])
    const auditJson = JSON.stringify(audits)
    assert.ok(!auditJson.includes('sk-secret'))
    assert.ok(!auditJson.includes('key=secret'))
    assert.ok(audits.some((a) => a.target === 'GET https://api.example.com/v1/models' && a.upstreamStatus === 200))
  })

  it('503 when management key missing', async () => {
    const app = express()
    app.use(express.json())
    app.use('/m', createCpaMgmtRouter({ cpaCfg: { cpaBaseUrl: 'http://127.0.0.1:1', managementKey: '' }, express }))
    const srv = await listen(app)
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/m/config`)
    assert.equal(r.status, 503)
    srv.close()
  })

  it('502 when CPA unreachable', async () => {
    const app = express()
    app.use(express.json())
    app.use('/m', createCpaMgmtRouter({ cpaCfg: { cpaBaseUrl: 'http://127.0.0.1:1', managementKey: 'k' }, express, audit: () => {} }))
    const srv = await listen(app)
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/m/gemini-api-key`)
    assert.equal(r.status, 502)
    srv.close()
  })
})
