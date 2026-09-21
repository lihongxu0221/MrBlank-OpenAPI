import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSiteUsageStore } from '../siteUsage.js'
import { createModelPricesStore } from '../modelPrices.js'
import { createApiKeyAliasesStore } from '../apiKeyAliases.js'
import { createAccountActionsStore } from '../accountActions.js'

test('dashboardSummary + monitoringAnalytics from site-usage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waveb-usage-'))
  const store = createSiteUsageStore(path.join(dir, 'u.json'), { maxEvents: 1000, maxAgeMs: 86400000 * 30 })
  const now = Date.now()
  store.recordEvent({
    ts: new Date(now - 5 * 60000).toISOString(),
    model: 'gpt-a',
    success: true,
    tokens: 100,
    prompt_tokens: 40,
    completion_tokens: 60,
  })
  store.recordEvent({
    ts: new Date(now - 10 * 60000).toISOString(),
    model: 'gpt-b',
    success: false,
    tokens: 10,
  })
  store.recordEvent({
    ts: new Date(now - 2 * 3600000).toISOString(),
    model: 'gpt-a',
    success: true,
    tokens: 50,
    prompt_tokens: 20,
    completion_tokens: 30,
  })
  store.flush()

  const dash = store.dashboardSummary({ todayStartMs: now - 24 * 3600000 })
  assert.ok(dash.today.requests >= 3)
  assert.ok(dash.last_30m.requests >= 2)
  assert.ok(dash.last_30m.rpm > 0)
  assert.ok(dash.top_models_by_tokens.some((m) => m.model === 'gpt-a'))

  const analytics = store.monitoringAnalytics({
    fromMs: now - 3 * 3600000,
    toMs: now,
    bucketMs: 60 * 60000,
  })
  assert.equal(analytics.totals.requests, 3)
  assert.ok(analytics.buckets.length >= 1)
  assert.ok(analytics.by_model.some((m) => m.model === 'gpt-a'))
  assert.deepEqual(store.distinctModels({ period: 'all' }).sort(), ['gpt-a', 'gpt-b'])

  fs.rmSync(dir, { recursive: true, force: true })
})

test('modelPrices costed usage + aliases + account actions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waveb-mp-'))
  const usage = createSiteUsageStore(path.join(dir, 'u.json'), { maxEvents: 100, maxAgeMs: 86400000 })
  usage.recordEvent({
    model: 'gpt-a',
    success: true,
    tokens: 1_000_000,
    prompt_tokens: 500_000,
    completion_tokens: 500_000,
  })
  usage.flush()

  const prices = createModelPricesStore(path.join(dir, 'prices.json'))
  prices.putPrices([
    { model: 'gpt-a', input_per_mtok: 1, output_per_mtok: 2, currency: 'USD' },
  ])
  const costed = prices.usageSummaryCosted(usage, { period: 'all' })
  assert.equal(costed.by_model[0].model, 'gpt-a')
  assert.ok(costed.by_model[0].cost > 0)
  // 0.5*1 + 0.5*2 = 1.5
  assert.equal(costed.total_cost, 1.5)

  const aliases = createApiKeyAliasesStore(path.join(dir, 'aliases.json'))
  aliases.put('abc123', 'Alice Key')
  assert.equal(aliases.list().length, 1)
  assert.equal(aliases.labelFor('abc123'), 'Alice Key')
  aliases.remove('abc123')
  assert.equal(aliases.list().length, 0)

  const actions = createAccountActionsStore(path.join(dir, 'actions.json'))
  const listed = actions.listCandidates({
    accounts: [
      { name: 'bad.json', label: 'bad@x.com', status: 'expired', status_message: 'token expired', failed: 3, success: 0 },
    ],
    diagnosisItems: [{ id: 'd1', status_code: 401, model_name: 'gpt-a', endpoint: '/v1/chat', created_at: new Date().toISOString() }],
  })
  assert.ok(listed.items.length >= 2)
  const id = listed.items[0].id
  actions.dismiss(id, 'ignore')
  const after = actions.listCandidates({
    accounts: [{ name: 'bad.json', label: 'bad@x.com', status: 'expired', failed: 3, success: 0 }],
    diagnosisItems: [],
  })
  assert.ok(!after.items.find((c) => c.id === id))

  fs.rmSync(dir, { recursive: true, force: true })
})
