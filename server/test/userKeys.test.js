import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createUserKeyStore,
  publicToken,
  QUOTA_PER_USD,
  usdLimit,
} from '../userKeys.js'

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'userkeys-'))
  const file = path.join(dir, 'user-keys.json')
  return { store: createUserKeyStore(file), file, dir }
}

test('create + publicToken masks key and reveals once', () => {
  const { store, dir } = tmpStore()
  const fullKey = 'sk-mrblank-1-abcdef123456'
  const rec = store.create(42, {
    name: 'demo',
    fullKey,
    unlimited_quota: false,
    remain_quota: QUOTA_PER_USD * 2,
    max_concurrency: 3,
    rate_limit_enabled: true,
    rate_limit_5h: 1.5,
    rate_limit_7d: 10,
    rate_limit_30d: 40,
  })
  assert.equal(rec.id, 1)
  assert.equal(rec.fullKey, fullKey)
  assert.ok(rec.key.includes('****') || rec.key.includes('**'))
  const pub = publicToken(rec, false)
  assert.ok(!String(pub.key).includes('abcdef'))
  assert.equal(pub.max_concurrency, 3)
  assert.equal(pub.rate_limit_enabled, true)
  assert.equal(pub.rate_windows.length, 3)
  assert.equal(pub.remain_quota, QUOTA_PER_USD * 2)
  const revealed = publicToken(rec, true)
  assert.equal(revealed.key, fullKey)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('update fields + reset_rate_limit_usage', () => {
  const { store, dir } = tmpStore()
  const rec = store.create(7, {
    name: 'a',
    fullKey: 'sk-test-aaaa',
    unlimited_quota: true,
    rate_limit_enabled: true,
    rate_limit_5h: 2,
  })
  store.consumeQuota(7, rec.id, 100, 0.5)
  const after = store.get(7, rec.id)
  assert.ok(after.used_amount >= 0.5)
  assert.ok((after.spend_log || []).length >= 1)
  const updated = store.update(7, rec.id, {
    name: 'b',
    max_concurrency: 2,
    reset_rate_limit_usage: true,
    rate_limit_7d: 5,
  })
  assert.equal(updated.name, 'b')
  assert.equal(updated.max_concurrency, 2)
  assert.equal(updated.rate_limit_7d, 5)
  assert.ok(updated.rate_limit_reset_at > 0)
  const windows = publicToken(updated, false).rate_windows
  const w5 = windows.find((w) => w.id === '5h')
  // after reset, spend in window should be 0
  assert.equal(w5.used, 0)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('validateSiteKey + checkRateLimit + concurrency', () => {
  const { store, dir } = tmpStore()
  const fullKey = 'sk-mrblank-9-ratecheck'
  const rec = store.create(9, {
    name: 'r',
    fullKey,
    unlimited_quota: false,
    remain_quota: QUOTA_PER_USD,
    max_concurrency: 1,
    rate_limit_enabled: true,
    rate_limit_5h: 1,
  })
  const ok = store.validateSiteKey(fullKey)
  assert.ok(ok.owner)
  assert.equal(ok.owner.userId, '9')

  store.consumeQuota(9, rec.id, 10, 1.0)
  const t = store.get(9, rec.id)
  const hit = store.checkRateLimit(t)
  assert.ok(hit)
  assert.match(hit.error, /5小时/)

  const r1 = store.beginConcurrency(t)
  assert.equal(typeof r1, 'function')
  const r2 = store.beginConcurrency(t)
  assert.equal(r2, null)
  r1()
  const r3 = store.beginConcurrency(t)
  assert.equal(typeof r3, 'function')
  r3()

  // exhaust quota
  store.consumeQuota(9, rec.id, QUOTA_PER_USD, 0)
  const exhausted = store.validateSiteKey(fullKey)
  assert.equal(exhausted.code, 429)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('user scoping: list only own keys', () => {
  const { store, dir } = tmpStore()
  store.create(1, { name: 'u1', fullKey: 'sk-a' })
  store.create(2, { name: 'u2', fullKey: 'sk-b' })
  assert.equal(store.list(1).length, 1)
  assert.equal(store.list(2).length, 1)
  assert.equal(store.list(1)[0].name, 'u1')
  assert.equal(usdLimit(0), 0)
  assert.equal(usdLimit(-1), 0)
  assert.equal(usdLimit(2.5), 2.5)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('linux.do findByApiKey skips disabled by default', () => {
  const { store, dir } = tmpStore()
  const fullKey = 'sk-disabled-1'
  const rec = store.create(3, { name: 'd', fullKey })
  store.update(3, rec.id, { status: 2 }, true)
  assert.equal(store.findByApiKey(fullKey), null)
  assert.ok(store.findByApiKey(fullKey, { includeDisabled: true }))
  fs.rmSync(dir, { recursive: true, force: true })
})
