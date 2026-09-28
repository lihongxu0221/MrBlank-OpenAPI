/**
 * Model price book for costed site-usage summaries (Wave B + P0-B sync).
 * Persisted at server/data/model-prices.json
 *
 * aily/{model} inherits bare {model} pricing via lookupPrice (no duplicated rows).
 */
import fs from 'node:fs'
import path from 'node:path'
import { stripAilyPrefix, isAilyPrefixed } from './ailyModelRouting.js'
import { fetchOfficialPrices } from './modelPriceSync.js'

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function readStore(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { version: 1, updated_at: null, last_sync: null, prices: [] }
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    const prices = Array.isArray(raw?.prices) ? raw.prices : Array.isArray(raw) ? raw : []
    return {
      version: 1,
      updated_at: raw?.updated_at || null,
      last_sync: raw?.last_sync || null,
      prices: prices.map(normalizePrice).filter(Boolean),
    }
  } catch {
    return { version: 1, updated_at: null, last_sync: null, prices: [] }
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
  const note = raw.note != null ? String(raw.note) : ''
  const source = raw.source != null ? String(raw.source) : ''
  let manual = false
  if (raw.manual === true || raw.manual === 1 || raw.manual === '1' || raw.manual === 'true') {
    manual = true
  } else if (source === 'manual') {
    manual = true
  } else if (/\bmanual\b/i.test(note)) {
    manual = true
  }
  return {
    model,
    input_per_mtok: Math.max(0, Number(raw.input_per_mtok) || 0),
    output_per_mtok: Math.max(0, Number(raw.output_per_mtok) || 0),
    currency: String(raw.currency || 'USD').trim() || 'USD',
    note,
    manual,
    source: source || (manual ? 'manual' : ''),
  }
}

function isProtectedManual(price) {
  if (!price) return false
  if (price.manual === true) return true
  if (String(price.source || '') === 'manual') return true
  if (/\bmanual\b/i.test(String(price.note || ''))) return true
  return false
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
      last_sync: store.last_sync || null,
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

  /** Exact map keyed by model id (no aily fallback). */
  function priceMap() {
    return new Map(store.prices.map((p) => [p.model, p]))
  }

  /**
   * Lookup with aily/ prefix fallback: aily/xxx → xxx.
   * Prefer this over duplicating every aily row in the book.
   */
  function lookupPrice(model) {
    const key = String(model || '').trim()
    if (!key) return null
    const map = priceMap()
    if (map.has(key)) return map.get(key)
    if (isAilyPrefixed(key)) {
      const bare = stripAilyPrefix(key)
      if (bare && map.has(bare)) return map.get(bare)
    }
    return null
  }

  /**
   * Merge official/aggregate prices into the book.
   * @param {{ overwriteManual?: boolean, incoming?: object[] }} [opts]
   *   If incoming is provided, skip network fetch (tests / one-shot import).
   */
  async function syncOfficial(opts = {}) {
    const overwriteManual = opts.overwriteManual === true
    let fetched
    if (Array.isArray(opts.incoming)) {
      fetched = {
        prices: opts.incoming.map(normalizePrice).filter(Boolean),
        sources: { local: { ok: true, count: opts.incoming.length } },
        failed_sources: [],
      }
    } else {
      fetched = await fetchOfficialPrices()
    }

    const byModel = new Map(store.prices.map((p) => [p.model, p]))
    let imported = 0
    let updated = 0
    let skipped = 0

    for (const raw of fetched.prices) {
      const next = normalizePrice(raw)
      if (!next) continue
      // Never store aily/ duplicates from sync — bare only; lookup falls back
      if (isAilyPrefixed(next.model)) {
        skipped += 1
        continue
      }
      const prev = byModel.get(next.model)
      if (prev && isProtectedManual(prev) && !overwriteManual) {
        skipped += 1
        continue
      }
      if (!prev) {
        byModel.set(next.model, next)
        imported += 1
        continue
      }
      const same =
        Number(prev.input_per_mtok) === Number(next.input_per_mtok) &&
        Number(prev.output_per_mtok) === Number(next.output_per_mtok) &&
        String(prev.currency || 'USD') === String(next.currency || 'USD')
      if (same && !overwriteManual) {
        // refresh source/note lightly but count skipped
        byModel.set(next.model, {
          ...prev,
          source: next.source || prev.source,
          note: prev.note || next.note,
          manual: prev.manual,
        })
        skipped += 1
        continue
      }
      byModel.set(next.model, {
        ...next,
        manual: false,
        note: next.note || prev.note,
      })
      updated += 1
    }

    store.prices = [...byModel.values()].sort((a, b) => a.model.localeCompare(b.model))
    const summary = {
      at: new Date().toISOString(),
      imported,
      updated,
      skipped,
      failed_sources: fetched.failed_sources || [],
      sources: fetched.sources || {},
      total_prices: store.prices.length,
    }
    store.last_sync = summary
    persist()
    return { ...summary, prices: store.prices.slice(), updated_at: store.updated_at }
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
    let totalCost = 0
    const rows = byModel.map((row) => {
      const price = lookupPrice(row.model)
      // activityByModel only has aggregate tokens; split ~unknown → treat all as input if no split
      const prompt = Number(row.prompt_tokens) || 0
      const completion = Number(row.completion_tokens) || 0
      const tokens = Number(row.tokens) || prompt + completion
      const usePrompt = prompt || (completion ? 0 : tokens)
      const useCompletion = completion
      const cost = costForTokens(price, usePrompt, useCompletion)
      totalCost += cost
      const resolvedVia =
        price && isAilyPrefixed(row.model) && price.model !== row.model ? price.model : null
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
        price_model: price?.model || null,
        resolved_via: resolvedVia,
      }
    })
    return {
      period,
      total_cost: Math.round(totalCost * 1e6) / 1e6,
      currency: 'USD',
      by_model: rows.sort((a, b) => b.cost - a.cost || b.tokens - a.tokens),
      priced_models: store.prices.length,
      note:
        'Cost = site-usage tokens × local price book (per MTok). aily/{model} inherits bare {model} price. Unpriced models show cost 0.',
    }
  }

  return {
    getPrices,
    putPrices,
    syncOfficial,
    usageSummaryCosted,
    priceMap,
    lookupPrice,
    costForTokens,
    isProtectedManual,
  }
}

export { costForTokens, normalizePrice, isProtectedManual, stripAilyPrefix }
