// Integration test against a LOCAL throwaway CPA. Skipped unless CPA_IT_URL is set, e.g.
//   CPA_IT_URL=http://127.0.0.1:18417 CPA_IT_KEY=local-test-mgmt-key node --test server/test/cpaMgmtProxy.integration.test.js
// Never point this at a live CPA: it performs writes (and restores them).
import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { createCpaMgmtRouter } from '../cpaMgmtProxy.js'

const base = process.env.CPA_IT_URL
const key = process.env.CPA_IT_KEY || ''
const skip = !base || !/^http:\/\/127\.0\.0\.1:18\d{3}$/.test(base)

async function withServer(fn) {
  const app = express()
  app.use(express.json({ limit: '8mb' }))
  app.use('/m', (req, _res, next) => { req.auth = { user: { id: 'it' } }; next() },
    createCpaMgmtRouter({ cpaCfg: { cpaBaseUrl: base, managementKey: key }, express, audit: () => {} }))
  const srv = app.listen(0, '127.0.0.1')
  await new Promise((r) => srv.once('listening', r))
  const url = `http://127.0.0.1:${srv.address().port}/m`
  try { await fn(url) } finally { srv.close() }
}

test('integration: config filtered, whitelist enforced, writes preserve other entries', { skip }, async () => {
  await withServer(async (url) => {
    const cfg = await (await fetch(`${url}/config`)).json()
    assert.equal(cfg['remote-management'], undefined)
    assert.equal(cfg['api-keys'], undefined)
    assert.ok('gemini-api-key' in cfg)
    assert.equal((await fetch(`${url}/api-keys`)).status, 404)
    assert.equal((await fetch(`${url}/remote-management`)).status, 404)

    const before = (await (await fetch(`${url}/claude-api-key`)).json())['claude-api-key'] || []
    const next = [...before.map(({ 'auth-index': _a, ...e }) => e), { 'api-key': 'sk-it-tmp', prefix: 'it', 'x-ui-unknown': 1 }]
    const put = await fetch(`${url}/claude-api-key`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })
    assert.equal(put.status, 200)
    const mid = (await (await fetch(`${url}/claude-api-key`)).json())['claude-api-key']
    assert.ok(mid.some((e) => e['api-key'] === 'sk-it-tmp' && e.prefix === 'it'))
    const del = await fetch(`${url}/claude-api-key?api-key=sk-it-tmp`, { method: 'DELETE' })
    assert.equal(del.status, 200)
    const after = (await (await fetch(`${url}/claude-api-key`)).json())['claude-api-key'] || []
    const norm = (l) => JSON.stringify(l.map(({ 'auth-index': _a, ...e }) => e))
    assert.equal(norm(after), norm(before))
  })
})
