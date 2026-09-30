import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSiteUsageStore } from '../siteUsage.js'
import { createModelPricesStore } from '../modelPrices.js'

async function highOnlyBook(dir) {
  const prices = createModelPricesStore(path.join(dir, 'prices.json'))
  // Live shape: supported catalog lists only the -high alias; base comes from the fetched universe.
  await prices.syncOfficial({
    supportedModels: ['gemini-3.8-flash-high'],
    incoming: [
      {
        model: 'gemini-3.8-flash',
        input_per_mtok: 0.75,
        output_per_mtok: 3.75,
        cache_read_per_mtok: 0.075,
        source: 'models.dev',
      },
    ],
  })
  return prices
}

test('catalog only has gemini-3.8-flash-high; upstream returns gemini-3.8-flash → record cost > 0', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-varres-'))
  const prices = await highOnlyBook(dir)
  const book = prices.getPrices().prices.map((p) => p.model)
  assert.deepEqual(book, ['gemini-3.8-flash-high'])

  // Base name falls back to its copy-mode inherited variant
  const base = prices.lookupPrice('gemini-3.8-flash')
  assert.ok(base)
  assert.equal(base.model, 'gemini-3.8-flash-high')
  assert.equal(prices.lookupPrice('google/gemini-3.8-flash')?.model, 'gemini-3.8-flash-high')
  assert.equal(prices.lookupPrice('totally-unknown-model'), null)

  const args = {
    requestedModel: 'gemini-3.8-flash-high',
    resolvedModel: 'gemini-3.8-flash',
    promptTokens: 542210,
    completionTokens: 33,
    cacheReadTokens: 0,
  }
  const usd = prices.usageRecordCostUsd(args)
  assert.ok(usd > 0)
  assert.ok(Math.abs(usd - (0.54221 * 0.75 + 0.000033 * 3.75)) < 1e-9)
  // Same as billing (requested model price)
  const billed = prices.costForTokens(prices.lookupPrice('gemini-3.8-flash-high'), 542210, 33, {})
  assert.equal(usd, billed)
  // Resolved-only still priced via variant fallback
  assert.ok(prices.usageRecordCostUsd({ ...args, requestedModel: null }) > 0)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('lookupBillingPrice prefers requested model over resolved model', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-varres2-'))
  const prices = createModelPricesStore(path.join(dir, 'prices.json'))
  prices.putPrices([
    { model: 'grok-4.7', input_per_mtok: 2, output_per_mtok: 6 },
    { model: 'grok-4.7-build', input_per_mtok: 3, output_per_mtok: 9, manual: true },
  ])
  const hit = prices.lookupBillingPrice('grok-4.7', 'grok-4.7-build')
  assert.equal(hit.model, 'grok-4.7')
  assert.equal(hit.price.input_per_mtok, 2)
  assert.equal(prices.lookupBillingPrice('', 'grok-4.7-build').model, 'grok-4.7-build')
  assert.equal(prices.lookupBillingPrice('nope', 'grok-4.7-build').model, 'grok-4.7-build')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('usageSummaryCosted prices by requested model (billing parity)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-varres3-'))
  const prices = await highOnlyBook(dir)
  const usage = createSiteUsageStore(path.join(dir, 'u.json'), { maxEvents: 50, maxAgeMs: 86400000 })
  usage.recordEvent({
    model: 'gemini-3.8-flash',
    model_requested: 'gemini-3.8-flash-high',
    model_resolved: 'gemini-3.8-flash',
    status: 200,
    success: true,
    prompt_tokens: 1_000_000,
    completion_tokens: 0,
    tokens: 1_000_000,
  })
  usage.flush()
  const sum = prices.usageSummaryCosted(usage, { period: 'all' })
  const row = sum.by_model.find((r) => r.model === 'gemini-3.8-flash')
  assert.ok(row)
  assert.equal(row.priced, true)
  assert.ok(Math.abs(row.cost - 0.75) < 1e-9)
  assert.equal(sum.total_quota_raw, 375000)
  fs.rmSync(dir, { recursive: true, force: true })
})
