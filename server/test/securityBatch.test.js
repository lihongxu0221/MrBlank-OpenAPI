import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import express from 'express'
import { createRateLimiter } from '../rateLimiter.js'
import { createReservationLedger, estimateRequestQuota } from '../reservations.js'
import {
  createLocalUserStore,
  hashPasswordAsync,
  verifyPasswordAsync,
  verifyPassword,
  hashPassword,
} from '../localUsers.js'
import { createSiteContentStore } from '../siteContent.js'
import { createUsageImportSessions } from '../usageImportSessions.js'
import {
  validateOpenaiCompatPayload,
  maskAccountLabel,
  matchMaskedProviderEntries,
  removeCpaProviderKey,
  maskKey,
} from '../cpa.js'
import { securityHeaders, noStoreApi, spaStatic } from '../securityHeaders.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mrb-sec-'))

test('rate limiter blocks after max and resets', () => {
  const rl = createRateLimiter({ windowMs: 60_000, max: 3, blockMs: 120_000 })
  for (let i = 0; i < 3; i++) assert.equal(rl.hit('ip').limited, false)
  const r = rl.hit('ip')
  assert.equal(r.limited, true)
  assert.ok(r.retryAfterMs >= 60_000)
  assert.equal(rl.peek('ip').limited, true)
  assert.equal(rl.peek('other').limited, false)
  rl.reset('ip')
  assert.equal(rl.hit('ip').limited, false)
})

test('reservations: parallel overdraft blocked, release frees, per-user concurrency cap', () => {
  const led = createReservationLedger({ maxPerUser: 3 })
  // balance 100, each call estimated 60 → second concurrent call must be refused
  const a = led.reserve('u', [{ pool: 'credits', amount: 60, available: 100 }])
  assert.equal(a.ok, true)
  const b = led.reserve('u', [{ pool: 'credits', amount: 60, available: 100 }])
  assert.equal(b.ok, false)
  assert.equal(b.code, 'insufficient_reserve')
  assert.equal(led.reservedFor('u', 'credits'), 60)
  a.release()
  a.release() // idempotent
  assert.equal(led.reservedFor('u', 'credits'), 0)
  const held = [1, 2, 3].map(() => led.reserve('u', [{ pool: 'credits', amount: 1, available: 1000 }]))
  assert.ok(held.every((h) => h.ok))
  const over = led.reserve('u', [{ pool: 'credits', amount: 1, available: 1000 }])
  assert.equal(over.ok, false)
  assert.equal(over.code, 'user_concurrency')
  // other users unaffected
  assert.equal(led.reserve('v', [{ pool: 'credits', amount: 1, available: 10 }]).ok, true)
  held.forEach((h) => h.release())
  assert.equal(led.inflightFor('u'), 0)
})

test('estimateRequestQuota is always >= 1 and scales with max_tokens', () => {
  assert.equal(estimateRequestQuota({ bodyText: '' }), 1)
  const price = { input: 1, output: 1 }
  const costForTokens = (p, i, o) => (i + o) / 1e6
  const dollarsToQuota = (d) => d * 500000
  const small = estimateRequestQuota({ bodyText: 'x'.repeat(400), maxTokens: 10, price, costForTokens, dollarsToQuota })
  const big = estimateRequestQuota({ bodyText: 'x'.repeat(400), maxTokens: 10000, price, costForTokens, dollarsToQuota })
  assert.ok(small >= 1)
  assert.ok(big > small)
})

test('async scrypt hashes interoperate with sync', async () => {
  const h = await hashPasswordAsync('secret-123')
  assert.equal(await verifyPasswordAsync('secret-123', h), true)
  assert.equal(await verifyPasswordAsync('wrong', h), false)
  assert.equal(verifyPassword('secret-123', h), true)
  assert.equal(await verifyPasswordAsync('abc123', hashPassword('abc123')), true)
  assert.equal(await verifyPasswordAsync('x', 'garbage'), false)
})

test('local users: async auth/create, seedAdminsIfNone only bootstraps', async () => {
  const dir = tmp()
  const store = createLocalUserStore(path.join(dir, 'u.json'), {})
  const u = await store.createUserAsync({ username: 'alice', password: 'pw-123456' })
  assert.equal(u.role, 'user')
  await assert.rejects(store.createUserAsync({ username: 'alice', password: 'pw-123456' }), (e) => e.status === 409)
  await assert.rejects(store.createUserAsync({ username: 'a b', password: 'pw-123456' }), (e) => e.status === 400)
  const ok = await store.authenticateAsync('alice', 'pw-123456')
  assert.equal(ok.username, 'alice')
  await assert.rejects(store.authenticateAsync('alice', 'nope'), (e) => e.status === 401)
  await assert.rejects(store.authenticateAsync('ghost', 'nope'), (e) => e.status === 401)
  assert.deepEqual(store.seedAdminsIfNone(['alice']), ['alice'])
  await store.createUserAsync({ username: 'bob', password: 'pw-123456' })
  assert.deepEqual(store.seedAdminsIfNone(['bob']), [], 'no seeding once an admin exists')
  assert.equal(store.findByUsername('bob').role, 'user')
  const mode = fs.statSync(path.join(dir, 'u.json')).mode & 0o777
  assert.equal(mode, 0o600)
})

test('site content: registration toggle defaults on and persists', () => {
  const dir = tmp()
  const p = path.join(dir, 'c.json')
  const s = createSiteContentStore(p)
  assert.equal(s.getAuthSettings().registration_enabled, true)
  s.saveAuthSettings({ registration_enabled: false })
  assert.equal(createSiteContentStore(p).getAuthSettings().registration_enabled, false)
  assert.equal(fs.statSync(p).mode & 0o777, 0o600)
})

test('usage import sessions reject non-hex ids (path traversal)', () => {
  const dir = tmp()
  const s = createUsageImportSessions(dir, { importEvents: () => ({}) })
  for (const bad of ['../../etc', '..', 'abc', 'ABCDEF0123456789', 'a/b']) {
    assert.throws(() => s.get(bad), (e) => e.status === 400, bad)
    assert.throws(() => s.cancel(bad), (e) => e.status === 400, bad)
  }
})

test('openai-compat PUT validation rejects GET-reshaped payloads (data-loss guard)', () => {
  const reshaped = [
    { name: 'x', base_url: 'https://up', prefix: '', disabled: false, models: [], api_key_count: 2 },
  ]
  assert.ok(validateOpenaiCompatPayload(reshaped))
  assert.ok(validateOpenaiCompatPayload([{ name: 'x', 'base-url': 'https://up' }]), 'missing api-key-entries')
  assert.ok(validateOpenaiCompatPayload([{ name: 'x', 'base-url': 'https://up', 'api-key-entries': [] }]))
  assert.ok(validateOpenaiCompatPayload([{ name: 'x', 'base-url': 'https://up', 'api-key-entries': [{ 'api-key': '' }] }]))
  assert.ok(validateOpenaiCompatPayload({}))
  assert.equal(
    validateOpenaiCompatPayload([
      { name: 'x', 'base-url': 'https://up', 'api-key-entries': [{ 'api-key': 'sk-real' }], headers: { a: 'b' } },
    ]),
    null,
  )
  assert.equal(validateOpenaiCompatPayload([]), null)
})

test('maskAccountLabel never leaks email/account text', () => {
  const l = maskAccountLabel('someone@gmail.com', 0)
  assert.match(l, /^账号 #[0-9a-f]{4}$/)
  assert.ok(!l.includes('some') && !l.includes('gmail'))
  assert.equal(maskAccountLabel('someone@gmail.com', 5), l, 'stable per account')
})

test('matchMaskedProviderEntries returns base-url per duplicate', () => {
  const raw = [
    { 'api-key': 'sk-same-key-1234567890', 'base-url': 'https://a' },
    { 'api-key': 'sk-same-key-1234567890', 'base-url': 'https://b' },
    { 'api-key': 'sk-other-000000000000' },
  ]
  const m = matchMaskedProviderEntries(raw, maskKey('sk-same-key-1234567890'))
  assert.deepEqual(
    m.map((x) => x.baseUrl),
    ['https://a', 'https://b'],
  )
})

test('removeCpaProviderKey passes base-url to CPA', async () => {
  const seen = []
  const srv = await new Promise((r) => {
    const s = http
      .createServer((req, res) => {
        if (req.method === 'DELETE') seen.push(req.url)
        else if (req.method === 'GET') return res.end('{"claude-api-key":[]}')
        res.setHeader('content-type', 'application/json')
        res.end('{"status":"ok"}')
      })
      .listen(0, '127.0.0.1', () => r(s))
  })
  try {
    const cfg = { cpaBaseUrl: `http://127.0.0.1:${srv.address().port}`, managementKey: 'm' }
    await removeCpaProviderKey(cfg, 'claude-api-key', 'sk-x', { baseUrl: 'https://b' })
    const u = new URL(seen[0], 'http://x')
    assert.equal(u.searchParams.get('api-key'), 'sk-x')
    assert.equal(u.searchParams.get('base-url'), 'https://b')
    await removeCpaProviderKey(cfg, 'claude-api-key', 'sk-x', { baseUrl: '' })
    assert.equal(new URL(seen[1], 'http://x').searchParams.has('base-url'), true)
  } finally {
    srv.close()
  }
})

test('security headers + caching middleware', async () => {
  const dist = tmp()
  fs.mkdirSync(path.join(dist, 'assets'))
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>x</title>')
  fs.writeFileSync(path.join(dist, 'assets', 'app-abc.js'), 'console.log(1)')
  const app = express()
  app.disable('x-powered-by')
  app.use(securityHeaders())
  app.use('/api', noStoreApi(), (req, res) => res.json({ ok: 1 }))
  app.use(spaStatic(dist))
  app.use((req, res) => res.status(404).end())
  const srv = await new Promise((r) => {
    const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s))
  })
  const base = `http://127.0.0.1:${srv.address().port}`
  try {
    const idx = await fetch(base + '/')
    assert.equal(idx.status, 200)
    assert.match(idx.headers.get('cache-control') || '', /no-cache|no-store/)
    assert.match(idx.headers.get('strict-transport-security') || '', /max-age=\d+/)
    assert.equal(idx.headers.get('x-frame-options'), 'DENY')
    assert.equal(idx.headers.get('x-content-type-options'), 'nosniff')
    assert.ok(idx.headers.get('referrer-policy'))
    assert.match(idx.headers.get('content-security-policy') || '', /frame-ancestors 'none'/)
    assert.equal(idx.headers.get('x-powered-by'), null)
    const asset = await fetch(base + '/assets/app-abc.js')
    assert.match(asset.headers.get('cache-control') || '', /immutable/)
    const deep = await fetch(base + '/console/wallet')
    assert.equal(deep.status, 200, 'SPA fallback')
    const api = await fetch(base + '/api/x')
    assert.match(api.headers.get('cache-control') || '', /no-store/)
    assert.equal((await fetch(base + '/.env')).status, 404)
  } finally {
    srv.close()
  }
})
