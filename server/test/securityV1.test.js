import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import {
  createV1Proxy,
  resolveV1Request,
  extractClientKey,
  forwardHeaders,
  sanitizedQueryString,
  extractMaxTokens,
  applyUpstreamHeaders,
} from '../v1Proxy.js'

test('resolveV1Request: rejects encoded / ambiguous paths, exact whitelist', () => {
  for (const u of ['/v1/%63hat/completions', '/v1/chat%2Fcompletions', '/v1/chat%2fcompletions', '/v1/%2e%2e/admin']) {
    const r = resolveV1Request(u, 'POST')
    assert.equal(r.ok, false, u)
    assert.equal(r.status, 400, u)
  }
  for (const u of ['/v1//chat/completions', '/v1/./chat/completions', '/v1/models/../chat/completions', '/v1\\chat']) {
    const r = resolveV1Request(u, 'POST')
    assert.equal(r.ok, false, u)
    assert.equal(r.status, 400, u)
  }
  assert.equal(resolveV1Request('/v1/.env', 'GET').status, 404)
  assert.equal(resolveV1Request('/v1/nonexistent-xyz', 'GET').status, 404)
  assert.equal(resolveV1Request('/v1/chat/completions', 'GET').status, 404, 'method must match')
  const ok = resolveV1Request('/v1/chat/completions?key=sk-x&foo=1', 'post')
  assert.equal(ok.ok, true)
  assert.equal(ok.consuming, true)
  assert.equal(ok.path, '/v1/chat/completions')
  assert.equal(sanitizedQueryString(ok.query), '?foo=1')
  const models = resolveV1Request('/v1/models', 'GET')
  assert.equal(models.ok && models.models, true)
  assert.equal(models.consuming, false)
  assert.equal(resolveV1Request('/v1/embeddings', 'POST').consuming, true)
  assert.equal(resolveV1Request('/v1/responses/', 'POST').path, '/v1/responses')
})

test('extractClientKey reads every client auth style', () => {
  const q = new URLSearchParams('key=sk-q')
  assert.equal(extractClientKey({ headers: { authorization: 'Bearer sk-a' } }), 'sk-a')
  assert.equal(extractClientKey({ headers: { 'x-api-key': 'sk-b' } }), 'sk-b')
  assert.equal(extractClientKey({ headers: { 'x-goog-api-key': 'sk-c' } }), 'sk-c')
  assert.equal(extractClientKey({ headers: { 'api-key': 'sk-d' } }), 'sk-d')
  assert.equal(extractClientKey({ headers: {} }, q), 'sk-q')
  assert.equal(extractClientKey({ headers: {} }, new URLSearchParams('')), '')
})

test('forwardHeaders: allowlist only, client credentials never forwarded', () => {
  const h = forwardHeaders(
    {
      headers: {
        authorization: 'Bearer sk-site',
        'x-api-key': 'sk-site',
        'x-goog-api-key': 'sk-site',
        'api-key': 'sk-site',
        cookie: 'mrblank_session=abc',
        'x-forwarded-for': '1.2.3.4',
        host: 'evil',
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-stainless-os': 'Linux',
      },
    },
    { authOverride: 'sk-bff-upstream' },
  )
  const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]))
  assert.equal(lower.authorization, 'Bearer sk-bff-upstream')
  for (const k of ['x-api-key', 'x-goog-api-key', 'api-key', 'cookie', 'x-forwarded-for', 'host']) {
    assert.equal(lower[k], undefined, k)
  }
  assert.equal(lower['content-type'], 'application/json')
  assert.equal(lower['anthropic-version'], '2023-06-01')
  assert.equal(lower['x-stainless-os'], 'Linux')
})

test('applyUpstreamHeaders drops set-cookie, location, and CORS', () => {
  const set = new Map()
  const res = {
    setHeader(k, v) {
      set.set(String(k).toLowerCase(), v)
    },
  }
  const headers = new Map([
    ['set-cookie', 'mrblank_sid=stolen'],
    ['location', 'https://evil.example/phish'],
    ['access-control-allow-origin', 'https://evil.example'],
    ['cache-control', 'no-store'],
    ['x-request-id', 'req-1'],
    ['content-type', 'text/html'],
  ])
  applyUpstreamHeaders(res, headers)
  assert.equal(set.has('set-cookie'), false)
  assert.equal(set.has('location'), false)
  assert.equal(set.has('access-control-allow-origin'), false)
  assert.equal(set.get('cache-control'), 'no-store')
  assert.equal(set.get('x-request-id'), 'req-1')
  assert.equal(set.get('content-type'), 'application/json')
})

test('extractMaxTokens', () => {
  assert.equal(extractMaxTokens('{"max_tokens":100}'), 100)
  assert.equal(extractMaxTokens('{"max_output_tokens":7}'), 7)
  assert.equal(extractMaxTokens('nope'), 0)
})

function listen(app) {
  return new Promise((resolve) => {
    const srv = http.createServer(app).listen(0, '127.0.0.1', () => resolve(srv))
  })
}

test('createV1Proxy integration: default-deny, stripping, authOverride, encoded path', async () => {
  const seen = []
  const upstream = await listen((req, res) => {
    seen.push({ url: req.url, headers: req.headers })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ id: 'x', object: 'list', data: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
  })
  const upBase = `http://127.0.0.1:${upstream.address().port}`
  const valid = 'sk-mrblank-good'
  const completes = []
  const governance = {
    async enforce({ apiKey }) {
      if (!apiKey) return { allow: false, status: 401, code: 'missing_api_key', body: { error: { message: 'missing' } } }
      if (apiKey !== valid) return { allow: false, status: 401, code: 'invalid_api_key', body: { error: { message: 'bad' } } }
      return { allow: true, userId: 'local:u1', upstreamKey: 'sk-bff-upstream' }
    },
    onComplete(ctx) {
      completes.push(ctx)
    },
  }
  let ailyCalls = 0
  const app = express()
  app.use(
    '/v1',
    createV1Proxy({
      billingBaseUrl: upBase,
      store: { record() {} },
      governance,
      ailyRoute: {
        embedded: true,
        match: (m) => String(m || '').startsWith('aily-'),
        handleV1: async () => {
          ailyCalls++
          return true
        },
      },
    }),
  )
  const srv = await listen(app)
  const base = `http://127.0.0.1:${srv.address().port}`
  const post = (path, headers = {}, body = { model: 'gpt-x', messages: [] }) =>
    fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  try {
    assert.equal((await post('/v1/chat/completions')).status, 401)
    assert.equal((await post('/v1/chat/completions', { authorization: 'Bearer sk-unknown' })).status, 401)
    assert.equal((await post('/v1/chat/completions?key=sk-unknown')).status, 401)
    assert.equal((await post('/v1/chat/completions', { 'x-goog-api-key': 'sk-unknown' })).status, 401)
    // Aily route requires an owner too
    assert.equal((await post('/v1/chat/completions', {}, { model: 'aily-pro', messages: [] })).status, 401)
    assert.equal(ailyCalls, 0)
    assert.equal((await post('/v1/%63hat/completions', { authorization: `Bearer ${valid}` })).status, 400)
    assert.equal((await post('/v1/chat%2Fcompletions', { authorization: `Bearer ${valid}` })).status, 400)
    assert.equal((await post('/v1/unknown', { authorization: `Bearer ${valid}` })).status, 404)
    assert.equal(seen.length, 0, 'nothing denied may reach upstream')

    await new Promise((r) => setTimeout(r, 20))
    const completesBeforePreflight = completes.length
    const pre = await fetch(base + '/v1/chat/completions', { method: 'OPTIONS' })
    assert.equal(pre.status, 204)
    assert.equal(pre.headers.get('access-control-allow-origin'), '*')
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(completes.length, completesBeforePreflight, 'CORS preflight must not emit a usage record')

    const r1 = await post('/v1/chat/completions?key=' + valid + '&foo=1', { 'x-goog-api-key': valid, cookie: 's=1' })
    assert.equal(r1.status, 200)
    const up = seen.at(-1)
    assert.equal(up.url, '/v1/chat/completions?foo=1')
    assert.equal(up.headers.authorization, 'Bearer sk-bff-upstream')
    assert.equal(up.headers['x-goog-api-key'], undefined)
    assert.equal(up.headers.cookie, undefined)
    assert.ok(!JSON.stringify(up.headers).includes(valid))

    const r2 = await post('/v1/chat/completions', { 'x-api-key': valid })
    assert.equal(r2.status, 200)
    assert.equal(seen.at(-1).headers['x-api-key'], undefined)
    await r1.text()
    await r2.text()
    await new Promise((r) => setTimeout(r, 50))
    assert.ok(completes.length >= 2)
    const okRows = completes.filter((c) => c.status === 200)
    assert.equal(okRows.length, 2)
    assert.ok(okRows.every((c) => c.isConsuming === true && c.userId === 'local:u1'))
    assert.ok(completes.filter((c) => c.status === 401).every((c) => c.isConsuming === false))
  } finally {
    srv.close()
    upstream.close()
  }
})

test('createV1Proxy fails closed without governance or without userId', async () => {
  const app = express()
  app.use('/v1', createV1Proxy({ billingBaseUrl: 'http://127.0.0.1:9', store: { record() {} } }))
  const app2 = express()
  app2.use(
    '/v1',
    createV1Proxy({
      billingBaseUrl: 'http://127.0.0.1:9',
      store: { record() {} },
      governance: { enforce: async () => ({ allow: true }) },
    }),
  )
  const s1 = await listen(app)
  const s2 = await listen(app2)
  try {
    const r1 = await fetch(`http://127.0.0.1:${s1.address().port}/v1/models`, { headers: { authorization: 'Bearer x' } })
    assert.equal(r1.status, 503)
    const r2 = await fetch(`http://127.0.0.1:${s2.address().port}/v1/models`, { headers: { authorization: 'Bearer x' } })
    assert.equal(r2.status, 401)
  } finally {
    s1.close()
    s2.close()
  }
})
