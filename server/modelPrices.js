/**
 * Model price book for costed site-usage summaries (Wave B + official sync).
 * Persisted at server/data/model-prices.json (JSON file store — same pattern as other Wave B stores).
 *
 * Schema per model:
 *   model, input_per_mtok, output_per_mtok, cache_read_per_mtok?, cache_write_per_mtok?,
 *   currency (USD), note, manual, source, updated_at
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

function optionalNonNeg(raw) {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return null
  return n
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
  const cacheRead = optionalNonNeg(raw.cache_read_per_mtok)
  const cacheWrite = optionalNonNeg(raw.cache_write_per_mtok)
  const row = {
    model,
    input_per_mtok: Math.max(0, Number(raw.input_per_mtok) || 0),
    output_per_mtok: Math.max(0, Number(raw.output_per_mtok) || 0),
    currency: String(raw.currency || 'USD').trim() || 'USD',
    note,
    manual,
    source: source || (manual ? 'manual' : ''),
    updated_at: raw.updated_at ? String(raw.updated_at) : null,
  }
  if (cacheRead != null) row.cache_read_per_mtok = cacheRead
  if (cacheWrite != null) row.cache_write_per_mtok = cacheWrite
  return row
}

function isProtectedManual(price) {
  if (!price) return false
  if (price.manual === true) return true
  if (String(price.source || '') === 'manual') return true
  if (/\bmanual\b/i.test(String(price.note || ''))) return true
  return false
}

/**
 * Cost estimate in USD.
 * When cache_read tokens are present, treat prompt_tokens as including them (OpenAI-style)
 * and bill (prompt - cache_read) at input_per_mtok and cache_read at cache_read_per_mtok
 * (fallback to input rate if cache rate missing). cache_write billed separately when provided.
 *
 * @param {object|null} price
 * @param {number} promptTokens
 * @param {number} completionTokens
 * @param {{ cacheReadTokens?: number, cacheWriteTokens?: number }} [opts]
 */
function costForTokens(price, promptTokens, completionTokens, opts = {}) {
  if (!price) return 0
  const cacheRead = Math.max(0, Number(opts.cacheReadTokens) || 0)
  const cacheWrite = Math.max(0, Number(opts.cacheWriteTokens) || 0)
  const prompt = Math.max(0, Number(promptTokens) || 0)
  const completion = Math.max(0, Number(completionTokens) || 0)
  const uncached = Math.max(0, prompt - cacheRead)
  const inputRate = Number(price.input_per_mtok) || 0
  const outputRate = Number(price.output_per_mtok) || 0
  const cacheReadRate =
    price.cache_read_per_mtok != null && Number.isFinite(Number(price.cache_read_per_mtok))
      ? Number(price.cache_read_per_mtok)
      : inputRate
  const cacheWriteRate =
    price.cache_write_per_mtok != null && Number.isFinite(Number(price.cache_write_per_mtok))
      ? Number(price.cache_write_per_mtok)
      : inputRate
  return (
    (uncached / 1_000_000) * inputRate +
    (cacheRead / 1_000_000) * cacheReadRate +
    (cacheWrite / 1_000_000) * cacheWriteRate +
    (completion / 1_000_000) * outputRate
  )
}

/**
 * @param {string} filePath
 */
export function createModelPricesStore(filePath) {
  let store = readStore(filePath)
  /** @type {ReturnType<typeof setInterval>|null} */
  let syncTimer = null
  let syncInFlight = false

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
    const now = new Date().toISOString()
    for (const raw of list) {
      const p = normalizePrice(raw)
      if (!p) continue
      if (!p.updated_at) p.updated_at = now
      byModel.set(p.model, p)
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

  function priceFieldsEqual(a, b) {
    if (!a || !b) return false
    const keys = ['input_per_mtok', 'output_per_mtok', 'cache_read_per_mtok', 'cache_write_per_mtok']
    for (const k of keys) {
      const av = a[k] == null ? null : Number(a[k])
      const bv = b[k] == null ? null : Number(b[k])
      if (av !== bv) return false
    }
    return String(a.currency || 'USD') === String(b.currency || 'USD')
  }

  /**
   * Merge official/aggregate prices into the book.
   * @param {{ overwriteManual?: boolean, incoming?: object[] }} [opts]
   */
  async function syncOfficial(opts = {}) {
    if (syncInFlight && !Array.isArray(opts.incoming)) {
      throw Object.assign(new Error('model-prices sync already in progress'), { status: 409 })
    }
    syncInFlight = true
    try {
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
      const now = new Date().toISOString()

      for (const raw of fetched.prices) {
        const next = normalizePrice({ ...raw, updated_at: now })
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
        if (priceFieldsEqual(prev, next) && !overwriteManual) {
          byModel.set(next.model, {
            ...prev,
            source: next.source || prev.source,
            note: prev.note || next.note,
            manual: prev.manual,
            updated_at: prev.updated_at || next.updated_at,
            ...(next.cache_read_per_mtok != null && prev.cache_read_per_mtok == null
              ? { cache_read_per_mtok: next.cache_read_per_mtok }
              : {}),
            ...(next.cache_write_per_mtok != null && prev.cache_write_per_mtok == null
              ? { cache_write_per_mtok: next.cache_write_per_mtok }
              : {}),
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
        at: now,
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
    } finally {
      syncInFlight = false
    }
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
      const prompt = Number(row.prompt_tokens) || 0
      const completion = Number(row.completion_tokens) || 0
      const cacheRead = Number(row.cache_tokens ?? row.cache_read_tokens) || 0
      const cacheWrite = Number(row.cache_write_tokens) || 0
      const tokens = Number(row.tokens) || prompt + completion
      const usePrompt = prompt || (completion ? 0 : tokens)
      const useCompletion = completion
      const cost = costForTokens(price, usePrompt, useCompletion, {
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
      })
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
        cache_tokens: cacheRead,
        cache_write_tokens: cacheWrite,
        input_per_mtok: price?.input_per_mtok ?? null,
        output_per_mtok: price?.output_per_mtok ?? null,
        cache_read_per_mtok: price?.cache_read_per_mtok ?? null,
        cache_write_per_mtok: price?.cache_write_per_mtok ?? null,
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
        'Cost = site-usage tokens × local price book (per MTok). Cache-read tokens billed at cache_read_per_mtok when present. aily/{model} inherits bare {model} price. Unpriced models show cost 0.',
    }
  }

  /**
   * In-process scheduled sync. Interval hours from env MODEL_PRICES_SYNC_INTERVAL_HOURS
   * (default 24). Set to 0 to disable. MODEL_PRICES_SYNC_CRON accepted as hours alias
   * (numeric string or "every Nh").
   * @param {{ intervalHours?: number, runOnBoot?: boolean, bootDelayMs?: number, log?: Function }} [opts]
   */
  function startScheduledSync(opts = {}) {
    stopScheduledSync()
    const log = typeof opts.log === 'function' ? opts.log : (msg) => console.log(msg)
    let hours =
      opts.intervalHours != null
        ? Number(opts.intervalHours)
        : parseSyncIntervalHours(process.env.MODEL_PRICES_SYNC_INTERVAL_HOURS, process.env.MODEL_PRICES_SYNC_CRON)
    if (!Number.isFinite(hours) || hours <= 0) {
      log('[modelPrices] scheduled sync disabled (interval<=0)')
      return { enabled: false, interval_hours: 0 }
    }
    const ms = Math.max(60_000, Math.round(hours * 3600_000))
    const run = async (reason) => {
      try {
        log(`[modelPrices] sync start (${reason})`)
        const result = await syncOfficial()
        log(
          `[modelPrices] sync done imported=${result.imported} updated=${result.updated} skipped=${result.skipped} total=${result.total_prices} failed=${(result.failed_sources || []).join(',') || 'none'}`,
        )
      } catch (err) {
        console.error('[modelPrices] sync failed', err?.message || err)
      }
    }
    syncTimer = setInterval(() => {
      void run('interval')
    }, ms)
    if (typeof syncTimer.unref === 'function') syncTimer.unref()
    const runOnBoot = opts.runOnBoot !== false && process.env.MODEL_PRICES_SYNC_ON_BOOT !== '0'
    if (runOnBoot) {
      const delay = opts.bootDelayMs != null ? Number(opts.bootDelayMs) : 15_000
      const t = setTimeout(() => {
        void run('boot')
      }, Math.max(0, delay))
      if (typeof t.unref === 'function') t.unref()
    }
    log(`[modelPrices] scheduled sync every ${hours}h (${ms}ms)`)
    return { enabled: true, interval_hours: hours, interval_ms: ms }
  }

  function stopScheduledSync() {
    if (syncTimer) {
      clearInterval(syncTimer)
      syncTimer = null
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
    startScheduledSync,
    stopScheduledSync,
  }
}

/**
 * Parse interval hours from MODEL_PRICES_SYNC_INTERVAL_HOURS or MODEL_PRICES_SYNC_CRON.
 * CRON values accepted: bare number ("24"), "every 24h", "24h". Non-numeric cron → default 24.
 */
function parseSyncIntervalHours(intervalEnv, cronEnv) {
  const raw = intervalEnv != null && String(intervalEnv).trim() !== '' ? String(intervalEnv).trim() : null
  if (raw != null) {
    const n = Number(raw)
    return Number.isFinite(n) ? n : 24
  }
  const cron = cronEnv != null ? String(cronEnv).trim() : ''
  if (!cron) return 24
  const m = cron.match(/(\d+(?:\.\d+)?)\s*h/i) || cron.match(/^(\d+(?:\.\d+)?)$/)
  if (m) return Number(m[1])
  // true cron expressions not implemented in-process — fall back to daily
  return 24
}

export {
  costForTokens,
  normalizePrice,
  isProtectedManual,
  stripAilyPrefix,
  parseSyncIntervalHours,
}
