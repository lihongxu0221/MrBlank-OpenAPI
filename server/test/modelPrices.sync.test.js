import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSiteUsageStore } from '../siteUsage.js'
import {
  createModelPricesStore,
  costForTokens,
  parseSyncIntervalHours,
} from '../modelPrices.js'
import { parseModelsDev, parseLitellm, parseOpenRouter } from '../modelPriceSync.js'

test('aily/ inherits bare model price via lookupPrice', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-aily-'))
  const prices = createModelPricesStore(path.join(dir, 'prices.json'))
  prices.putPrices([
    { model: 'glm-5.3', input_per_mtok: 1, output_per_mtok: 2, currency: 'USD', source: 'models.dev' },
  ])
  assert.equal(prices.lookupPrice('glm-5.3')?.input_per_mtok, 1)
  assert.equal(prices.lookupPrice('aily/glm-5.3')?.input_per_mtok, 1)
  assert.equal(prices.lookupPrice('aily/glm-5.3')?.model, 'glm-5.3')
  assert.equal(prices.lookupPrice('aily/missing'), null)
  assert.equal(prices.priceMap().has('aily/glm-5.3'), false)

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

test('syncOfficial merges without overwriting manual; stores cache rates', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-sync-'))
  const prices = createModelPricesStore(path.join(dir, 'prices.json'))
  prices.putPrices([
    { model: 'keep-me', input_per_mtok: 9, output_per_mtok: 9, note: 'manual override', manual: true },
    { model: 'auto-me', input_per_mtok: 1, output_per_mtok: 1, source: 'models.dev' },
  ])
  const result = await prices.syncOfficial({
    supportedModels: ['keep-me', 'auto-me', 'new-me'],
    incoming: [
      { model: 'keep-me', input_per_mtok: 0.1, output_per_mtok: 0.1, source: 'models.dev' },
      {
        model: 'auto-me',
        input_per_mtok: 2,
        output_per_mtok: 3,
        cache_read_per_mtok: 0.2,
        cache_write_per_mtok: 2.5,
        source: 'litellm',
      },
      { model: 'new-me', input_per_mtok: 4, output_per_mtok: 5, cache_read_per_mtok: 0.4, source: 'openrouter' },
      { model: 'aily/should-skip', input_per_mtok: 1, output_per_mtok: 1, source: 'models.dev' },
      { model: 'universe-noise', input_per_mtok: 9, output_per_mtok: 9, source: 'openrouter' },
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
  assert.equal(auto.cache_read_per_mtok, 0.2)
  assert.equal(auto.cache_write_per_mtok, 2.5)
  const neu = book.find((p) => p.model === 'new-me')
  assert.equal(neu.cache_read_per_mtok, 0.4)
  assert.ok(!book.find((p) => p.model === 'aily/should-skip'))
  assert.ok(!book.find((p) => p.model === 'universe-noise'))
  assert.equal(result.supported_count, 3)
  assert.ok(prices.getPrices().last_sync)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('costForTokens applies cache_read rate to cached portion of prompt', () => {
  const price = {
    input_per_mtok: 10,
    output_per_mtok: 20,
    cache_read_per_mtok: 1,
    cache_write_per_mtok: 12.5,
  }
  // 400k uncached * 10 + 100k cache_read * 1 + 50k cache_write * 12.5 + 200k out * 20
  // = 4 + 0.1 + 0.625 + 4 = 8.725
  const cost = costForTokens(price, 500_000, 200_000, {
    cacheReadTokens: 100_000,
    cacheWriteTokens: 50_000,
  })
  assert.equal(Math.round(cost * 1000) / 1000, 8.725)
})

test('usageSummaryCosted uses cache tokens from site-usage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-cache-'))
  const usage = createSiteUsageStore(path.join(dir, 'u.json'), { maxEvents: 50, maxAgeMs: 86400000 })
  usage.recordEvent({
    model: 'gpt-a',
    success: true,
    tokens: 700_000,
    prompt_tokens: 500_000,
    completion_tokens: 200_000,
    cache_tokens: 100_000,
  })
  usage.flush()
  const prices = createModelPricesStore(path.join(dir, 'prices.json'))
  prices.putPrices([
    {
      model: 'gpt-a',
      input_per_mtok: 10,
      output_per_mtok: 20,
      cache_read_per_mtok: 1,
      currency: 'USD',
    },
  ])
  const costed = prices.usageSummaryCosted(usage, { period: 'all' })
  // 400k*10 + 100k*1 + 200k*20 = 4 + 0.1 + 4 = 8.1
  assert.equal(costed.total_cost, 8.1)
  assert.equal(costed.by_model[0].cache_tokens, 100_000)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('parsers extract cache fields from source shapes', () => {
  const md = parseModelsDev({
    openai: {
      models: {
        'gpt-x': { id: 'gpt-x', cost: { input: 1, output: 2, cache_read: 0.1, cache_write: 1.25 } },
      },
    },
  })
  assert.equal(md.get('gpt-x').cache_read_per_mtok, 0.1)
  assert.equal(md.get('gpt-x').cache_write_per_mtok, 1.25)

  const ll = parseLitellm({
    'openai/gpt-y': {
      input_cost_per_token: 1e-6,
      output_cost_per_token: 2e-6,
      cache_read_input_token_cost: 1e-7,
      cache_creation_input_token_cost: 1.25e-6,
    },
  })
  assert.equal(ll.get('openai/gpt-y').input_per_mtok, 1)
  assert.ok(Math.abs(ll.get('openai/gpt-y').cache_read_per_mtok - 0.1) < 1e-9)
  assert.ok(Math.abs(ll.get('openai/gpt-y').cache_write_per_mtok - 1.25) < 1e-9)

  const or = parseOpenRouter({
    data: [
      {
        id: 'openai/gpt-z',
        pricing: {
          prompt: '0.000001',
          completion: '0.000002',
          input_cache_read: '0.0000001',
          input_cache_write: '0.00000125',
        },
      },
    ],
  })
  assert.ok(Math.abs(or.get('openai/gpt-z').cache_read_per_mtok - 0.1) < 1e-9)
  assert.ok(Math.abs(or.get('openai/gpt-z').cache_write_per_mtok - 1.25) < 1e-9)
})

test('parseSyncIntervalHours reads env aliases', () => {
  assert.equal(parseSyncIntervalHours('12', null), 12)
  assert.equal(parseSyncIntervalHours(null, 'every 6h'), 6)
  assert.equal(parseSyncIntervalHours('0', null), 0)
  assert.equal(parseSyncIntervalHours(null, null), 24)
})

import {
  applyVariantInheritance,
  inheritanceSource,
  maxRates,
  multiplyRates,
  VARIANT_INHERITANCE,
} from '../modelPriceInheritance.js'

test('VARIANT_INHERITANCE covers the six required targets', () => {
  const targets = VARIANT_INHERITANCE.map((r) => r.target).sort()
  assert.deepEqual(targets, [
    'auto-fast',
    'auto-max',
    'claude-opus-4-6-thinking',
    'gemini-3.8-flash-high',
    'gpt-oss-120b-medium',
    'grok-4.7-build-fast',
  ])
})

test('inheritance rule: gemini-3.8-flash-high copies gemini-3.8-flash 1:1', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-inh-gem-'))
  const prices = createModelPricesStore(path.join(dir, 'prices.json'))
  const result = await prices.syncOfficial({
    supportedModels: ['gemini-3.8-flash', 'gemini-3.8-flash-high'],
    incoming: [
      {
        model: 'gemini-3.8-flash',
        input_per_mtok: 0.15,
        output_per_mtok: 0.6,
        cache_read_per_mtok: 0.0375,
        cache_write_per_mtok: 0.1875,
        source: 'models.dev',
      },
    ],
  })
  assert.equal(result.inherited_count, 1)
  const high = prices.getPrices().prices.find((p) => p.model === 'gemini-3.8-flash-high')
  assert.ok(high)
  assert.equal(high.input_per_mtok, 0.15)
  assert.equal(high.output_per_mtok, 0.6)
  assert.equal(high.cache_read_per_mtok, 0.0375)
  assert.equal(high.cache_write_per_mtok, 0.1875)
  assert.equal(high.source, 'inherit:gemini-3.8-flash')
  assert.equal(high.input_quota_per_mtok, Math.round(0.15 * 500_000))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('inheritance rule: grok-4.7-build-fast doubles grok-4.7 rates', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-inh-grok-'))
  const prices = createModelPricesStore(path.join(dir, 'prices.json'))
  const result = await prices.syncOfficial({
    supportedModels: ['grok-4.7', 'grok-4.7-build-fast'],
    incoming: [
      {
        model: 'grok-4.7',
        input_per_mtok: 1.2,
        output_per_mtok: 6,
        cache_read_per_mtok: 0.3,
        cache_write_per_mtok: 1.5,
        source: 'models.dev',
      },
    ],
  })
  assert.equal(result.inherited_count, 1)
  const fast = prices.getPrices().prices.find((p) => p.model === 'grok-4.7-build-fast')
  assert.equal(fast.input_per_mtok, 2.4)
  assert.equal(fast.output_per_mtok, 12)
  assert.equal(fast.cache_read_per_mtok, 0.6)
  assert.equal(fast.cache_write_per_mtok, 3)
  assert.equal(fast.source, 'inherit:grok-4.7*2')
  assert.equal(fast.output_quota_per_mtok, Math.round(12 * 500_000))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('inheritance rule: gpt-oss-120b-medium uses GPT-5.6 Terra (地球) rates', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-inh-oss-'))
  const prices = createModelPricesStore(path.join(dir, 'prices.json'))
  // Base not in supported catalog — must resolve from fetched universe via alternate id
  const result = await prices.syncOfficial({
    supportedModels: ['gpt-oss-120b-medium'],
    incoming: [
      {
        model: 'openai/gpt-5.6-terra',
        input_per_mtok: 2,
        output_per_mtok: 12,
        cache_read_per_mtok: 0.2,
        cache_write_per_mtok: 2.5,
        source: 'models.dev',
      },
    ],
  })
  assert.equal(result.inherited_count, 1)
  const row = prices.getPrices().prices.find((p) => p.model === 'gpt-oss-120b-medium')
  assert.equal(row.input_per_mtok, 2)
  assert.equal(row.output_per_mtok, 12)
  assert.equal(row.cache_read_per_mtok, 0.2)
  assert.equal(row.cache_write_per_mtok, 2.5)
  assert.equal(row.source, 'inherit:gpt-5.6-terra')
  assert.ok(['gpt-5.6-terra', 'openai/gpt-5.6-terra'].includes(result.inherited[0].bases_matched[0]))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('inheritance rule: claude-opus-4-6-thinking copies opus/claude-opus-4-6', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-inh-opus-'))
  const prices = createModelPricesStore(path.join(dir, 'prices.json'))
  const result = await prices.syncOfficial({
    supportedModels: ['claude-opus-4-6-thinking'],
    incoming: [
      {
        model: 'opus-4.6',
        input_per_mtok: 5,
        output_per_mtok: 25,
        cache_read_per_mtok: 0.5,
        cache_write_per_mtok: 6.25,
        source: 'litellm',
      },
    ],
  })
  assert.equal(result.inherited_count, 1)
  const row = prices.getPrices().prices.find((p) => p.model === 'claude-opus-4-6-thinking')
  assert.equal(row.input_per_mtok, 5)
  assert.equal(row.output_per_mtok, 25)
  assert.equal(row.source, 'inherit:opus-4.6')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('inheritance rule: auto-max copies glm-5.3', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-inh-amax-'))
  const prices = createModelPricesStore(path.join(dir, 'prices.json'))
  await prices.syncOfficial({
    supportedModels: ['glm-5.3', 'auto-max'],
    incoming: [
      {
        model: 'glm-5.3',
        input_per_mtok: 0.9,
        output_per_mtok: 4,
        cache_read_per_mtok: 0.2,
        source: 'models.dev',
      },
    ],
  })
  const row = prices.getPrices().prices.find((p) => p.model === 'auto-max')
  assert.equal(row.input_per_mtok, 0.9)
  assert.equal(row.output_per_mtok, 4)
  assert.equal(row.cache_read_per_mtok, 0.2)
  assert.equal(row.source, 'inherit:glm-5.3')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('inheritance rule: auto-fast takes per-field max of flash peers', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-inh-afast-'))
  const prices = createModelPricesStore(path.join(dir, 'prices.json'))
  const result = await prices.syncOfficial({
    supportedModels: ['glm-5.3-flash', 'deepseek-v4.1-flash', 'auto-fast'],
    incoming: [
      {
        model: 'glm-5.3-flash',
        input_per_mtok: 0.15,
        output_per_mtok: 0.5,
        cache_read_per_mtok: 0.03,
        cache_write_per_mtok: 0.2,
        source: 'models.dev',
      },
      {
        model: 'deepseek-v4.1-flash',
        input_per_mtok: 0.2,
        output_per_mtok: 0.6,
        cache_read_per_mtok: 0.006,
        // no cache_write — max should keep glm's write
        source: 'models.dev',
      },
    ],
  })
  assert.ok(result.inherited_count >= 1)
  const row = prices.getPrices().prices.find((p) => p.model === 'auto-fast')
  assert.equal(row.input_per_mtok, 0.2) // deepseek higher
  assert.equal(row.output_per_mtok, 0.6)
  assert.equal(row.cache_read_per_mtok, 0.03) // glm higher
  assert.equal(row.cache_write_per_mtok, 0.2) // only glm has it
  assert.equal(row.source, 'inherit:max(glm-5.3-flash,deepseek-v4.1-flash)')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('inheritance leaves unpriced when base truly missing; reports missed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-inh-miss-'))
  const prices = createModelPricesStore(path.join(dir, 'prices.json'))
  const result = await prices.syncOfficial({
    supportedModels: ['gemini-3.8-flash-high', 'auto-max'],
    incoming: [{ model: 'unrelated', input_per_mtok: 1, output_per_mtok: 1, source: 'models.dev' }],
  })
  assert.equal(result.inherited_count, 0)
  assert.ok(result.inheritance_missed_count >= 2)
  assert.ok(result.unpriced_count >= 2)
  assert.ok(!prices.getPrices().prices.find((p) => p.model === 'gemini-3.8-flash-high'))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('inheritance does not overwrite manual targets', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-inh-man-'))
  const prices = createModelPricesStore(path.join(dir, 'prices.json'))
  prices.putPrices([
    {
      model: 'auto-max',
      input_per_mtok: 99,
      output_per_mtok: 99,
      manual: true,
      source: 'manual',
    },
  ])
  await prices.syncOfficial({
    supportedModels: ['glm-5.3', 'auto-max'],
    incoming: [
      { model: 'glm-5.3', input_per_mtok: 0.9, output_per_mtok: 4, source: 'models.dev' },
    ],
  })
  const row = prices.getPrices().prices.find((p) => p.model === 'auto-max')
  assert.equal(row.input_per_mtok, 99)
  assert.equal(row.manual, true)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('multiplyRates and maxRates helpers', () => {
  const doubled = multiplyRates(
    { input_per_mtok: 1, output_per_mtok: 2, cache_read_per_mtok: 0.1, cache_write_per_mtok: 1.25 },
    2,
  )
  assert.deepEqual(doubled, {
    input_per_mtok: 2,
    output_per_mtok: 4,
    cache_read_per_mtok: 0.2,
    cache_write_per_mtok: 2.5,
    currency: 'USD',
  })
  const mx = maxRates([
    { input_per_mtok: 0.15, output_per_mtok: 0.5, cache_read_per_mtok: 0.03 },
    { input_per_mtok: 0.2, output_per_mtok: 0.4, cache_write_per_mtok: 0.25 },
  ])
  assert.equal(mx.input_per_mtok, 0.2)
  assert.equal(mx.output_per_mtok, 0.5)
  assert.equal(mx.cache_read_per_mtok, 0.03)
  assert.equal(mx.cache_write_per_mtok, 0.25)
  assert.equal(inheritanceSource({ mode: 'multiply', factor: 2, bases: ['grok-4.7'] }, ['grok-4.7']), 'inherit:grok-4.7*2')
})

test('applyVariantInheritance pure: refreshes inherit:* on re-sync', () => {
  const byModel = new Map([
    [
      'glm-5.3',
      { model: 'glm-5.3', input_per_mtok: 1, output_per_mtok: 3, currency: 'USD', source: 'models.dev' },
    ],
  ])
  const r1 = applyVariantInheritance(byModel, {
    supported: new Set(['glm-5.3', 'auto-max']),
    fetchedPrices: [],
  })
  assert.equal(r1.inherited_count, 1)
  assert.equal(byModel.get('auto-max').input_per_mtok, 1)
  byModel.set('glm-5.3', {
    model: 'glm-5.3',
    input_per_mtok: 0.9,
    output_per_mtok: 4,
    currency: 'USD',
    source: 'models.dev',
  })
  const r2 = applyVariantInheritance(byModel, {
    supported: new Set(['glm-5.3', 'auto-max']),
    fetchedPrices: [],
  })
  assert.equal(r2.inherited_count, 1)
  assert.equal(byModel.get('auto-max').input_per_mtok, 0.9)
  assert.equal(byModel.get('auto-max').output_per_mtok, 4)
})
