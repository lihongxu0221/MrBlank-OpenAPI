import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSiteUsageStore, TYPE_CONSUME, TYPE_ERROR } from '../siteUsage.js'

test('enriched siteUsage records id/diagnosis link/amount and lists/filters/charts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-usage-enr-'))
  const file = path.join(dir, 'site-usage.json')
  const store = createSiteUsageStore(file, { maxEvents: 1000, maxAgeMs: 86400000 * 30 })

  const id1 = 'evt-admin-1'
  store.recordEvent({
    id: id1,
    diagnosis_id: id1,
    userId: 'u1',
    username: 'alice',
    keyHash: 'hash-a',
    token_name: 'alice-key',
    model_requested: 'gpt-test',
    model_resolved: 'gpt-test',
    endpoint: '/v1/chat/completions',
    group: 'default',
    status: 200,
    success: true,
    type: TYPE_CONSUME,
    prompt_tokens: 10,
    completion_tokens: 20,
    cache_tokens: 2,
    amountUsd: 0.012,
    rawQuota: 6000,
    duration_ms: 321,
    ttft_ms: 40,
    stream: true,
    ip: '1.2.3.4',
    route: 'cpa',
    has_detail: true,
  })
  store.recordEvent({
    userId: 'u2',
    username: 'bob',
    keyHash: 'hash-b',
    token_name: 'bob-key',
    model: 'other',
    endpoint: '/v1/responses',
    success: false,
    status: 500,
    type: TYPE_ERROR,
    prompt_tokens: 0,
    completion_tokens: 0,
    amountUsd: 0,
    stream: false,
    ip: '5.6.7.8',
    route: 'aily',
    content: 'upstream boom',
  })
  // Never stores raw API key even if passed
  store.recordEvent({
    userId: 'u1',
    keyHash: 'hash-a',
    apiKey: 'sk-should-never-persist',
    model: 'gpt-test',
    success: true,
    prompt_tokens: 1,
    completion_tokens: 1,
    amountUsd: 0.001,
  })
  store.flush()

  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.ok(raw.events.every((e) => e.id))
  assert.ok(raw.events.every((e) => !('apiKey' in e) && !('api_key' in e) && !('raw_key' in e)))
  assert.equal(raw.events[0].diagnosis_id, id1)

  const list = store.listEvents({ range: 'all', type: TYPE_CONSUME, page_size: 10 })
  assert.ok(list.total >= 2)
  assert.ok(list.items.every((i) => i.id && i.amount != null))
  assert.ok(!list.items.some((i) => i.req_body || i.res_body))

  const scoped = store.listEvents({
    range: 'all',
    userIdOrKeyHashes: { userId: 'u1', keyHashes: new Set(['hash-a']) },
  })
  assert.ok(scoped.items.every((i) => i.userId === 'u1' || i.keyHash === 'hash-a'))
  assert.ok(scoped.items.every((i) => i.userId !== 'u2'))

  const chart = store.chartData({ range: 'all', type: TYPE_CONSUME })
  assert.ok(chart.totals.requests >= 2)
  assert.ok(chart.by_model.some((m) => m.name === 'gpt-test'))
  assert.ok(Number(chart.totals.amount) > 0)

  const filters = store.logFilters({ range: 'all', includeUsers: true })
  assert.ok(filters.model_names.includes('gpt-test'))
  assert.ok(filters.token_names.includes('alice-key') || filters.token_names.length >= 1)

  const got = store.getEvent(id1)
  assert.equal(got.diagnosis_id, id1)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('legacy events get synthetic ids on load (backfill)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-usage-bf-'))
  const file = path.join(dir, 'site-usage.json')
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      events: [
        {
          ts: new Date().toISOString(),
          userId: 'u9',
          keyHash: 'abc',
          model: 'legacy',
          success: true,
          tokens: 3,
          prompt_tokens: 1,
          completion_tokens: 2,
        },
      ],
    }),
  )
  const store = createSiteUsageStore(file)
  const list = store.listEvents({ range: 'all' })
  assert.equal(list.total, 1)
  assert.ok(list.items[0].id)
  assert.match(list.items[0].id, /^bf-/)
  fs.rmSync(dir, { recursive: true, force: true })
})
