import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSiteUsageStore } from '../siteUsage.js'
import { createModelPricesStore } from '../modelPrices.js'

test('P0-B: aily/ inherits bare model price via lookupPrice', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p0b-aily-'))
  const prices = createModelPricesStore(path.join(dir, 'prices.json'))
  prices.putPrices([
    { model: 'glm-5.3', input_per_mtok: 1, output_per_mtok: 2, currency: 'USD', source: 'models.dev' },
  ])
  assert.equal(prices.lookupPrice('glm-5.3')?.input_per_mtok, 1)
  assert.equal(prices.lookupPrice('aily/glm-5.3')?.input_per_mtok, 1)
  assert.equal(prices.lookupPrice('aily/glm-5.3')?.model, 'glm-5.3')
  assert.equal(prices.lookupPrice('aily/missing'), null)
  // priceMap stays exact-only
  assert.equal(prices.priceMap().has('aily/glm-5.3'), false)
  assert.equal(prices.priceMap().has('glm-5.3'), true)

  const usage = createSiteUsageStore(path.join(dir, 'u.json'), { maxEvents: 50, maxAgeMs: 86400000 })
  usage.recordEvent({
    model: 'aily/glm-5.3',
    success: true,
    tokens: 1_000_000,
    prompt_tokens: 500_000,
    completion_tokens: 500_000,
  })
  usage.flush()
  const costed = prices.usageSummaryCosted(usage, { period: 'all' })
  assert.equal(costed.by_model[0].priced, true)
  assert.equal(costed.by_model[0].resolved_via, 'glm-5.3')
  assert.equal(costed.total_cost, 1.5)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('P0-B: syncOfficial merges without overwriting manual', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p0b-sync-'))
  const prices = createModelPricesStore(path.join(dir, 'prices.json'))
  prices.putPrices([
    { model: 'keep-me', input_per_mtok: 9, output_per_mtok: 9, note: 'manual override', manual: true },
    { model: 'auto-me', input_per_mtok: 1, output_per_mtok: 1, source: 'models.dev' },
  ])
  const result = await prices.syncOfficial({
    incoming: [
      { model: 'keep-me', input_per_mtok: 0.1, output_per_mtok: 0.1, source: 'models.dev' },
      { model: 'auto-me', input_per_mtok: 2, output_per_mtok: 3, source: 'litellm' },
      { model: 'new-me', input_per_mtok: 4, output_per_mtok: 5, source: 'openrouter' },
      { model: 'aily/should-skip', input_per_mtok: 1, output_per_mtok: 1, source: 'models.dev' },
    ],
  })
  assert.equal(result.imported, 1)
  assert.equal(result.updated, 1)
  assert.ok(result.skipped >= 2)
  const book = prices.getPrices().prices
  const keep = book.find((p) => p.model === 'keep-me')
  assert.equal(keep.input_per_mtok, 9)
  assert.equal(keep.manual, true)
  const auto = book.find((p) => p.model === 'auto-me')
  assert.equal(auto.input_per_mtok, 2)
  assert.equal(auto.output_per_mtok, 3)
  assert.ok(book.find((p) => p.model === 'new-me'))
  assert.ok(!book.find((p) => p.model === 'aily/should-skip'))
  assert.ok(prices.getPrices().last_sync)

  fs.rmSync(dir, { recursive: true, force: true })
})
