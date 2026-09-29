import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createQuotaUnitStore,
  dollarsToQuota,
  quotaToDollars,
  pointsToQuota,
  usdPerMtokToQuotaPerMtok,
  DEFAULT_QUOTA_PER_UNIT,
} from '../quotaUnit.js'
import {
  createModelPricesStore,
  costForTokens,
  quotaForTokens,
} from '../modelPrices.js'
import { createGroupStore } from '../groups.js'

test('aily formula: dollars↔quota and usd/mtok→quota_per_mtok', () => {
  assert.equal(DEFAULT_QUOTA_PER_UNIT, 500_000)
  assert.equal(dollarsToQuota(1), 500_000)
  assert.equal(dollarsToQuota(0.002), 1000)
  assert.equal(quotaToDollars(500_000), 1)
  assert.equal(pointsToQuota(2), 1_000_000)
  // gpt-ish: $3 / MTok input → 1_500_000 raw per MTok
  assert.equal(usdPerMtokToQuotaPerMtok(3), 1_500_000)
  assert.equal(usdPerMtokToQuotaPerMtok(0.15), 75_000)
  // rounding
  assert.equal(dollarsToQuota(0.000001), 1) // round(0.5)=1? 0.000001*500000=0.5 → 1 or 0
  assert.equal(Math.round(0.000001 * 500000), 1)
})

test('quota unit store persists and drives conversion', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qu-'))
  const store = createQuotaUnitStore(path.join(dir, 'quota-unit.json'))
  assert.equal(store.getUnit(), 500_000)
  store.setUnit(100_000)
  assert.equal(store.getUnit(), 100_000)
  assert.equal(store.dollarsToQuota(1), 100_000)
  assert.equal(store.creditUnitInfo().raw_per_point, 100_000)
  // reload
  const store2 = createQuotaUnitStore(path.join(dir, 'quota-unit.json'))
  assert.equal(store2.getUnit(), 100_000)
  store2.setUnit(500_000) // restore default for other tests sharing nothing
  fs.rmSync(dir, { recursive: true, force: true })
})

test('costForTokens → quotaForTokens uses unit', () => {
  const price = {
    model: 'demo',
    input_per_mtok: 1, // $1 / MTok
    output_per_mtok: 2,
    cache_read_per_mtok: 0.1,
  }
  // 1M uncached input + 1M output = $3 → 1_500_000 raw at default unit
  const usd = costForTokens(price, 1_000_000, 1_000_000)
  assert.equal(usd, 3)
  assert.equal(quotaForTokens(price, 1_000_000, 1_000_000), 1_500_000)
  assert.equal(quotaForTokens(price, 1_000_000, 1_000_000, { quotaUnit: 100_000 }), 300_000)
  // cache: 500k cached @0.1 + 500k uncached @1 + 0 out = 0.05+0.5 = 0.55 → 275000
  const usd2 = costForTokens(price, 1_000_000, 0, { cacheReadTokens: 500_000 })
  assert.ok(Math.abs(usd2 - 0.55) < 1e-9)
  assert.equal(quotaForTokens(price, 1_000_000, 0, { cacheReadTokens: 500_000 }), 275_000)
})

test('syncOfficial filters to supported; removes stale auto; attaches quota fields', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-sup-'))
  let unit = 500_000
  const prices = createModelPricesStore(path.join(dir, 'prices.json'), {
    getQuotaUnit: () => unit,
  })
  prices.putPrices([
    { model: 'keep-manual', input_per_mtok: 9, output_per_mtok: 9, manual: true },
    { model: 'stale-auto', input_per_mtok: 1, output_per_mtok: 1, source: 'models.dev' },
    { model: 'grok-4.7', input_per_mtok: 0.2, output_per_mtok: 0.5, source: 'models.dev' },
  ])
  const result = await prices.syncOfficial({
    supportedModels: ['grok-4.7', 'claude-sonnet-4-6', 'aily/glm-5.3'],
    incoming: [
      { model: 'grok-4.7', input_per_mtok: 0.25, output_per_mtok: 0.6, source: 'models.dev' },
      { model: 'claude-sonnet-4-6', input_per_mtok: 3, output_per_mtok: 15, source: 'litellm' },
      { model: 'glm-5.3', input_per_mtok: 1, output_per_mtok: 2, source: 'openrouter' },
      { model: 'noise-11k', input_per_mtok: 99, output_per_mtok: 99, source: 'openrouter' },
    ],
  })
  assert.equal(result.supported_count, 3) // bare set: grok, claude, glm-5.3
  assert.ok(result.stale_removed >= 1)
  const book = prices.getPrices().prices
  assert.ok(book.find((p) => p.model === 'keep-manual'))
  assert.ok(!book.find((p) => p.model === 'stale-auto'))
  assert.ok(!book.find((p) => p.model === 'noise-11k'))
  const grok = book.find((p) => p.model === 'grok-4.7')
  assert.equal(grok.input_per_mtok, 0.25)
  assert.equal(grok.input_quota_per_mtok, Math.round(0.25 * 500_000))
  assert.equal(prices.lookupPrice('aily/glm-5.3')?.input_per_mtok, 1)

  // unit change recomputes quota fields
  unit = 100_000
  prices.recomputeQuotaFields()
  const grok2 = prices.getPrices().prices.find((p) => p.model === 'grok-4.7')
  assert.equal(grok2.input_quota_per_mtok, Math.round(0.25 * 100_000))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('group 5h limit in 点 stores raw = points * unit; billing quota reduces window', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grp-pt-'))
  const unit = 500_000
  const store = createGroupStore(path.join(dir, 'g.json'), { quotaUnit: unit })
  // Admin sets 0.01 点 for 5h → 5000 raw
  const points = 0.01
  const raw = pointsToQuota(points, unit)
  assert.equal(raw, 5000)
  store.saveGroups([
    {
      id: 'tiny',
      name: 'tiny',
      level: 1,
      quotas: { window_5h: raw, week: raw * 10, month: raw * 40 },
      model_ids: [],
      promotion: { min_account_days: 0, min_request_count: 0, min_used_quota: 0, min_checkins: 0 },
      enabled: true,
    },
  ])
  const uid = 'u-pt'
  store.ensureUser(uid)
  assert.equal(store.assertQuotaAvailable(uid).ok, true)
  // Simulate price-based deduct: $0.01 → 5000 raw (= full 5h window of 0.01 点)
  const deduct = dollarsToQuota(0.01, unit)
  assert.equal(deduct, 5000)
  store.recordUsage(uid, { quota: deduct, requests: 1 })
  const denied = store.assertQuotaAvailable(uid)
  assert.equal(denied.ok, false)
  assert.equal(denied.code, 'quota_5h_exhausted')
  const info = store.resolveUserGroup(uid, {})
  assert.equal(info.used.window_5h, 5000)
  assert.equal(info.remaining.window_5h, 0)
  assert.equal(info.quota_unit, unit)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('mock request usage deducts price-based raw not token count', () => {
  const price = { model: 'grok-4.7', input_per_mtok: 0.2, output_per_mtok: 0.5 }
  const promptTok = 10_000
  const completionTok = 2_000
  // token-count old way would charge 12000 raw
  const tokenCountQuota = promptTok + completionTok
  const usd = costForTokens(price, promptTok, completionTok)
  // (10000/1e6)*0.2 + (2000/1e6)*0.5 = 0.002 + 0.001 = 0.003
  assert.ok(Math.abs(usd - 0.003) < 1e-12)
  const raw = dollarsToQuota(usd)
  assert.equal(raw, 1500)
  assert.notEqual(raw, tokenCountQuota)
  assert.ok(raw < tokenCountQuota)
})

test('plazaPriceFields returns points per MTok matching admin conversion', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plaza-price-'))
  const unitPath = path.join(dir, 'quota-unit.json')
  const pricesPath = path.join(dir, 'prices.json')
  const unitStore = createQuotaUnitStore(unitPath)
  assert.equal(unitStore.getUnit(), 500_000)

  const prices = createModelPricesStore(pricesPath, {
    getQuotaUnit: () => unitStore.getUnit(),
  })
  prices.putPrices([
    { model: 'grok-4', input_per_mtok: 3, output_per_mtok: 15, currency: 'USD', source: 'manual', manual: true },
    { model: 'glm-5.3', input_per_mtok: 0.15, output_per_mtok: 0.6, currency: 'USD', source: 'models.dev' },
  ])

  const grok = prices.plazaPriceFields('grok-4')
  assert.ok(grok)
  assert.equal(grok.priced, true)
  // default unit 500000 → points ≈ USD
  assert.equal(grok.text_price, 3)
  assert.equal(grok.text_out_price, 15)
  assert.equal(grok.input_quota_per_mtok, 1_500_000)

  // aily/ prefix inherits bare price
  const aily = prices.plazaPriceFields('aily/glm-5.3')
  assert.ok(aily)
  assert.equal(aily.text_price, 0.15)
  assert.equal(aily.text_out_price, 0.6)

  assert.equal(prices.plazaPriceFields('no-such-model'), null)

  // custom raw_per_point (= quota_per_unit): $3 → 3*100000 raw → 3 points still when unit matches
  unitStore.setUnit(100_000)
  prices.recomputeQuotaFields(100_000)
  const grok2 = prices.plazaPriceFields('grok-4')
  assert.equal(grok2.text_price, 3)
  assert.equal(grok2.input_quota_per_mtok, 300_000)

  fs.rmSync(dir, { recursive: true, force: true })
})
