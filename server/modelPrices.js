/**
 * Model price book for costed site-usage summaries (Wave B).
 * Persisted at server/data/model-prices.json
 */
import fs from 'node:fs'
import path from 'node:path'

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function readStore(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { version: 1, updated_at: null, prices: [] }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    const prices = Array.isArray(raw?.prices) ? raw.prices : Array.isArray(raw) ? raw : []
    return {
      version: 1,
      updated_at: raw?.updated_at || null,
      prices: prices.map(normalizePrice).filter(Boolean),
    }
  } catch {
    return { version: 1, updated_at: null, prices: [] }
  }
}

function writeStore(filePath, store) {
  ensureDir(filePath)
  const tmp = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8')
  fs.renameSync(tmp, filePath)
}

function normalizePrice(raw) {
  const model = String(raw?.model || '').trim()
  if (!model) return null
  return {
    model,
    input_per_mtok: Math.max(0, Number(raw.input_per_mtok) || 0),
    output_per_mtok: Math.max(0, Number(raw.output_per_mtok) || 0),
    currency: String(raw.currency || 'USD').trim() || 'USD',
    note: raw.note != null ? String(raw.note) : '',
  }
}

function costForTokens(price, promptTokens, completionTokens) {
  if (!price) return 0
  const inp = (Number(promptTokens) || 0) / 1_000_000
  const out = (Number(completionTokens) || 0) / 1_000_000
  return inp * (Number(price.input_per_mtok) || 0) + out * (Number(price.output_per_mtok) || 0)
}

/**
 * @param {string} filePath
 */
export function createModelPricesStore(filePath) {
  let store = readStore(filePath)

  function persist() {
    store.updated_at = new Date().toISOString()
    writeStore(filePath, store)
  }

  function getPrices() {
    return {
      updated_at: store.updated_at,
      prices: store.prices.slice(),
      path: filePath,
    }
  }

  /** Replace entire price book. */
  function putPrices(items) {
    const list = Array.isArray(items) ? items : items?.prices
    if (!Array.isArray(list)) throw Object.assign(new Error('prices must be an array'), { status: 400 })
    const byModel = new Map()
    for (const raw of list) {
      const p = normalizePrice(raw)
      if (p) byModel.set(p.model, p)
    }
    store.prices = [...byModel.values()].sort((a, b) => a.model.localeCompare(b.model))
    persist()
    return getPrices()
  }

  function priceMap() {
    return new Map(store.prices.map((p) => [p.model, p]))
  }

  /**
   * @param {{ activityByModel?: Function, summarize?: Function }} siteUsage
   * @param {{ period?: string }} [opts]
   */
  function usageSummaryCosted(siteUsage, { period = 'today' } = {}) {
    const byModel =
      typeof siteUsage.activityByModel === 'function'
        ? siteUsage.activityByModel({ period })
        : []
    const prices = priceMap()
    let totalCost = 0
    const rows = byModel.map((row) => {
      const price = prices.get(row.model) || null
      // activityByModel only has aggregate tokens; split ~unknown → treat all as input if no split
      const prompt = Number(row.prompt_tokens) || 0
      const completion = Number(row.completion_tokens) || 0
      const tokens = Number(row.tokens) || prompt + completion
      const usePrompt = prompt || (completion ? 0 : tokens)
      const useCompletion = completion
      const cost = costForTokens(price, usePrompt, useCompletion)
      totalCost += cost
      return {
        model: row.model,
        calls: row.calls,
        successful: row.successful ?? row.calls,
        tokens,
        prompt_tokens: usePrompt,
        completion_tokens: useCompletion,
        input_per_mtok: price?.input_per_mtok ?? null,
        output_per_mtok: price?.output_per_mtok ?? null,
        currency: price?.currency || 'USD',
        cost: Math.round(cost * 1e6) / 1e6,
        priced: !!price,
      }
    })
    return {
      period,
      total_cost: Math.round(totalCost * 1e6) / 1e6,
      currency: 'USD',
      by_model: rows.sort((a, b) => b.cost - a.cost || b.tokens - a.tokens),
      priced_models: store.prices.length,
      note: 'Cost = site-usage tokens × local price book (per MTok). Unpriced models show cost 0.',
    }
  }

  return { getPrices, putPrices, usageSummaryCosted, priceMap, costForTokens }
}
