/**
 * Model price book for costed site-usage summaries + billing raw-quota conversion.
 * Persisted at server/data/model-prices.json (JSON file store).
 *
 * Schema per model:
 *   model, input_per_mtok, output_per_mtok, cache_read_per_mtok?, cache_write_per_mtok?,
 *   input_quota_per_mtok, output_quota_per_mtok, cache_read_quota_per_mtok?, cache_write_quota_per_mtok?,
 *   currency (USD), note, manual, source, updated_at, stale?
 *
 * aily/{model} inherits bare {model} pricing via lookupPrice (no duplicated rows).
 *
 * Auto-sync: FILTER to supported catalog only (CPA /v1/models + aily when routed).
 * Rebuild automatic portion; preserve manual overrides; remove stale auto rows.
 * Then apply VARIANT_INHERITANCE for unpriced supported aliases/variants.
 * Quota fields: quota_per_mtok = round(usd_per_mtok * FIXED_USD_TO_RAW) (1 USD = 500000 raw, fixed).
 * Display 点 = raw / N where N = raw_per_point (configurable).
 */
import fs from 'node:fs'
import path from 'node:path'
import { stripAilyPrefix, isAilyPrefixed } from './ailyModelRouting.js'
import { fetchOfficialPrices } from './modelPriceSync.js'
import { applyVariantInheritance, VARIANT_INHERITANCE } from './modelPriceInheritance.js'
import {
  DEFAULT_QUOTA_PER_UNIT,
  FIXED_USD_TO_RAW,
  dollarsToQuota,
  quotaToPoints,
  usdPerMtokToQuotaPerMtok,
} from './quotaUnit.js'

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
      prices: prices.map((row) => normalizePrice(row)).filter(Boolean),
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

function attachQuotaFields(row, _unitIgnored) {
  if (!row) return row
  // Always FIXED_USD_TO_RAW — N (raw_per_point) only affects display points, not stored raw.
  row.input_quota_per_mtok = usdPerMtokToQuotaPerMtok(row.input_per_mtok)
  row.output_quota_per_mtok = usdPerMtokToQuotaPerMtok(row.output_per_mtok)
  if (row.cache_read_per_mtok != null) {
    row.cache_read_quota_per_mtok = usdPerMtokToQuotaPerMtok(row.cache_read_per_mtok)
  } else {
    delete row.cache_read_quota_per_mtok
  }
  if (row.cache_write_per_mtok != null) {
    row.cache_write_quota_per_mtok = usdPerMtokToQuotaPerMtok(row.cache_write_per_mtok)
  } else {
    delete row.cache_write_quota_per_mtok
  }
  return row
}

function normalizePrice(raw, unit = DEFAULT_QUOTA_PER_UNIT) {
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
  if (raw.stale === true) row.stale = true
  attachQuotaFields(row, unit)
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
 * aily calculateQuota (tokenPrices path): USD then round(USD * QUOTA_PER_UNIT).
 * @param {object|null} price
 * @param {number} promptTokens
 * @param {number} completionTokens
 * @param {{ cacheReadTokens?: number, cacheWriteTokens?: number, quotaUnit?: number }} [opts]
 */
function quotaForTokens(price, promptTokens, completionTokens, opts = {}) {
  const usd = costForTokens(price, promptTokens, completionTokens, opts)
  // USD → raw always FIXED; opts.quotaUnit ignored for billing raw
  return dollarsToQuota(usd)
}

/** Normalize supported catalog ids to bare keys used in the price book. */
function bareSupportedSet(supportedModels) {
  const set = new Set()
  for (const raw of supportedModels || []) {
    const id = String(raw || '').trim()
    if (!id) continue
    const bare = isAilyPrefixed(id) ? stripAilyPrefix(id) : id
    if (bare) set.add(bare)
    if (!isAilyPrefixed(id)) set.add(id)
  }
  return set
}

/**
 * @param {string} filePath
 * @param {{ getQuotaUnit?: () => number, getSupportedModels?: () => Promise<string[]>|string[] }} [deps]
 */
export function createModelPricesStore(filePath, deps = {}) {
  let store = readStore(filePath)
  /** @type {ReturnType<typeof setInterval>|null} */
  let syncTimer = null
  let syncInFlight = false

  /** Configurable N: 1 点 = N raw (display only). USD→raw always FIXED_USD_TO_RAW. */
  const resolveRawPerPoint = () => {
    if (typeof deps.getQuotaUnit === 'function') {
      const n = Number(deps.getQuotaUnit())
      if (Number.isFinite(n) && n > 0) return n
    }
    return DEFAULT_QUOTA_PER_UNIT
  }
  const resolveUnit = resolveRawPerPoint

  function persist() {
    store.updated_at = new Date().toISOString()
    writeStore(filePath, store)
  }

  function recomputeQuotaFields(_unitIgnored) {
    // Recalc raw from stored USD with FIXED 500000; N only affects display getters.
    store.prices = store.prices.map((p) => attachQuotaFields({ ...p }))
    persist()
    return getPrices()
  }

  function getPrices() {
    const rawPerPoint = resolveRawPerPoint()
    return {
      updated_at: store.updated_at,
      last_sync: store.last_sync || null,
      prices: store.prices.map((p) => attachQuotaFields({ ...p })),
      path: filePath,
      quota_per_unit: rawPerPoint,
      raw_per_point: rawPerPoint,
      usd_to_raw: FIXED_USD_TO_RAW,
    }
  }

  /** Replace entire price book. */
  function putPrices(items) {
    const list = Array.isArray(items) ? items : items?.prices
    if (!Array.isArray(list)) throw Object.assign(new Error('prices must be an array'), { status: 400 })
    const byModel = new Map()
    const now = new Date().toISOString()
    const unit = resolveUnit()
    for (const raw of list) {
      const p = normalizePrice(raw, unit)
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
    // Also try last path segment for provider/model ids
    const slash = key.lastIndexOf('/')
    if (slash > 0) {
      const bare = key.slice(slash + 1)
      if (bare && map.has(bare)) return map.get(bare)
    }
    // Unpriced base name → price of its 1:1 (copy-mode) inherited variant.
    // e.g. upstream answers `gemini-3.8-flash` for a `gemini-3.8-flash-high` request while
    // the supported catalog (and so the book) only lists the -high alias.
    const viaVariant = inheritedVariantPrice(map, key)
    if (viaVariant) return viaVariant
    return null
  }

  /**
   * Find a copy-mode VARIANT_INHERITANCE target whose bases include `key`
   * (case-insensitive; aily/ and provider/ prefixes stripped) and which has a book row.
   */
  function inheritedVariantPrice(map, key) {
    const cands = new Set()
    const add = (k) => {
      const v = String(k || '').trim().toLowerCase()
      if (v) cands.add(v)
    }
    add(key)
    if (isAilyPrefixed(key)) add(stripAilyPrefix(key))
    const slash = key.lastIndexOf('/')
    if (slash > 0) add(key.slice(slash + 1))
    for (const rule of VARIANT_INHERITANCE) {
      if (rule.mode !== 'copy') continue
      const target = String(rule.target || '').trim()
      if (!target || !map.has(target)) continue
      const hit = (rule.bases || []).some((b) => {
        const bl = String(b || '').trim().toLowerCase()
        if (cands.has(bl)) return true
        const i = bl.lastIndexOf('/')
        return i > 0 && cands.has(bl.slice(i + 1))
      })
      if (hit) return map.get(target)
    }
    return null
  }

  /**
   * Billing-consistent price: requested model first (what the user asked for / is billed on),
   * then the upstream-resolved model.
   * @returns {{ price: object|null, model: string|null }}
   */
  function lookupBillingPrice(requestedModel, resolvedModel) {
    for (const m of [requestedModel, resolvedModel]) {
      const key = String(m || '').trim()
      if (!key) continue
      const price = lookupPrice(key)
      if (price) return { price, model: key }
    }
    return { price: null, model: null }
  }

  /**
   * USD cost for a site-usage record — same model precedence as billing (requested → resolved).
   * @param {{ requestedModel?: string|null, resolvedModel?: string|null, promptTokens?: number,
   *   completionTokens?: number, cacheReadTokens?: number, cacheWriteTokens?: number }} args
   */
  function usageRecordCostUsd(args = {}) {
    const { price } = lookupBillingPrice(args.requestedModel, args.resolvedModel)
    return costForTokens(price, args.promptTokens, args.completionTokens, {
      cacheReadTokens: args.cacheReadTokens,
      cacheWriteTokens: args.cacheWriteTokens,
    })
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
   * Merge official/aggregate prices into the book — FILTERED to supported catalog.
   * Rebuilds automatic portion; preserves manuals; removes stale auto rows.
   *
   * @param {{
   *   overwriteManual?: boolean,
   *   incoming?: object[],
   *   supportedModels?: string[],
   *   allowEmptySupported?: boolean,
   * }} [opts]
   */
  async function syncOfficial(opts = {}) {
    if (syncInFlight && !Array.isArray(opts.incoming)) {
      throw Object.assign(new Error('model-prices sync already in progress'), { status: 409 })
    }
    syncInFlight = true
    try {
      const overwriteManual = opts.overwriteManual === true
      const unit = resolveUnit()
      let supportedList = opts.supportedModels
      if (supportedList == null && typeof deps.getSupportedModels === 'function') {
        supportedList = await deps.getSupportedModels()
      }
      if (!Array.isArray(supportedList)) supportedList = []
      const supported = bareSupportedSet(supportedList)
      if (supported.size === 0 && !opts.allowEmptySupported) {
        throw Object.assign(
          new Error(
            'supported model catalog empty or unavailable — sync aborted (fail closed; will not import ~11k universe)',
          ),
          { status: 503 },
        )
      }

      let fetched
      if (Array.isArray(opts.incoming)) {
        fetched = {
          prices: opts.incoming.map((r) => normalizePrice(r, unit)).filter(Boolean),
          sources: { local: { ok: true, count: opts.incoming.length } },
          failed_sources: [],
        }
      } else {
        fetched = await fetchOfficialPrices()
      }

      const byModel = new Map(store.prices.map((p) => [p.model, { ...p }]))
      let imported = 0
      let updated = 0
      let skipped = 0
      let skipped_unsupported = 0
      let stale_removed = 0
      const now = new Date().toISOString()
      const matchedSupported = new Set()

      for (const raw of fetched.prices) {
        let next = normalizePrice({ ...raw, updated_at: now, stale: false }, unit)
        if (!next) continue
        // Never store aily/ duplicates from sync — bare only; lookup falls back
        if (isAilyPrefixed(next.model)) {
          skipped += 1
          continue
        }
        if (supported.size && !supported.has(next.model)) {
          skipped_unsupported += 1
          continue
        }
        matchedSupported.add(next.model)
        next = attachQuotaFields(next, unit)
        const prev = byModel.get(next.model)
        if (prev && isProtectedManual(prev) && !overwriteManual) {
          skipped += 1
          continue
        }
        if (!prev) {
          byModel.set(next.model, { ...next, manual: false, stale: false })
          imported += 1
          continue
        }
        if (priceFieldsEqual(prev, next) && !overwriteManual) {
          byModel.set(next.model, {
            ...prev,
            source: next.source || prev.source,
            note: prev.note || next.note,
            manual: prev.manual,
            stale: false,
            updated_at: prev.updated_at || next.updated_at,
            ...(next.cache_read_per_mtok != null && prev.cache_read_per_mtok == null
              ? { cache_read_per_mtok: next.cache_read_per_mtok }
              : {}),
            ...(next.cache_write_per_mtok != null && prev.cache_write_per_mtok == null
              ? { cache_write_per_mtok: next.cache_write_per_mtok }
              : {}),
          })
          attachQuotaFields(byModel.get(next.model), unit)
          skipped += 1
          continue
        }
        byModel.set(next.model, {
          ...next,
          manual: false,
          stale: false,
          note: next.note || prev.note,
        })
        updated += 1
      }

      // Remove / mark stale auto rows not in supported catalog
      for (const [model, prev] of [...byModel.entries()]) {
        if (isProtectedManual(prev)) continue
        if (supported.size && !supported.has(model)) {
          byModel.delete(model)
          stale_removed += 1
        }
      }

      // Variant inheritance for supported models missing aggregator prices
      const inheritance = applyVariantInheritance(byModel, {
        supported,
        fetchedPrices: fetched.prices,
        isProtectedManual,
        attachQuotaFields,
        unit,
        now,
      })

      store.prices = [...byModel.values()]
        .map((p) => attachQuotaFields({ ...p }, unit))
        .sort((a, b) => a.model.localeCompare(b.model))

      const priced_auto = store.prices.filter((p) => !isProtectedManual(p)).length
      const priced_manual = store.prices.filter((p) => isProtectedManual(p)).length
      const unpriced = [...supported].filter((id) => !byModel.has(id)).length

      const summary = {
        at: now,
        imported,
        updated,
        skipped,
        skipped_unsupported,
        stale_removed,
        failed_sources: fetched.failed_sources || [],
        sources: fetched.sources || {},
        total_prices: store.prices.length,
        supported_count: supported.size,
        priced_count: store.prices.length,
        priced_auto,
        priced_manual,
        unpriced_count: unpriced,
        matched_from_sources: matchedSupported.size,
        quota_per_unit: resolveRawPerPoint(),
        raw_per_point: resolveRawPerPoint(),
        usd_to_raw: FIXED_USD_TO_RAW,
        inherited_count: inheritance.inherited_count,
        inheritance_missed_count: inheritance.inheritance_missed_count,
        inherited: inheritance.inherited,
        inheritance_missed: inheritance.inheritance_missed,
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
    const rawPerPoint = resolveRawPerPoint()
    let totalCost = 0
    let totalQuota = 0
    const rows = byModel.map((row) => {
      const prompt = Number(row.prompt_tokens) || 0
      const completion = Number(row.completion_tokens) || 0
      const cacheRead = Number(row.cache_tokens ?? row.cache_read_tokens) || 0
      const cacheWrite = Number(row.cache_write_tokens) || 0
      const tokens = Number(row.tokens) || prompt + completion
      const usePrompt = prompt || (completion ? 0 : tokens)
      const useCompletion = completion
      // Billing parity: price each requested-model slice by requested model first, then resolved.
      const slices = Array.isArray(row.by_requested) && row.by_requested.length ? row.by_requested : null
      let price = null
      let cost = 0
      if (slices) {
        for (const sl of slices) {
          const hit = lookupBillingPrice(sl.model_requested, row.model)
          if (hit.price && !price) price = hit.price
          const sp = Number(sl.prompt_tokens) || 0
          const sc = Number(sl.completion_tokens) || 0
          const st = Number(sl.tokens) || sp + sc
          cost += costForTokens(hit.price, sp || (sc ? 0 : st), sc, {
            cacheReadTokens: Number(sl.cache_tokens) || 0,
            cacheWriteTokens: Number(sl.cache_write_tokens) || 0,
          })
        }
      } else {
        price = lookupPrice(row.model)
        cost = costForTokens(price, usePrompt, useCompletion, {
          cacheReadTokens: cacheRead,
          cacheWriteTokens: cacheWrite,
        })
      }
      const quota = dollarsToQuota(cost) // FIXED 500000
      totalCost += cost
      totalQuota += quota
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
        input_quota_per_mtok: price?.input_quota_per_mtok ?? null,
        output_quota_per_mtok: price?.output_quota_per_mtok ?? null,
        currency: price?.currency || 'USD',
        cost: Math.round(cost * 1e6) / 1e6,
        quota_raw: quota,
        quota_points: quotaToPoints(quota, rawPerPoint),
        priced: !!price,
        price_model: price?.model || null,
        resolved_via: resolvedVia,
      }
    })
    return {
      period,
      total_cost: Math.round(totalCost * 1e6) / 1e6,
      total_quota_raw: totalQuota,
      total_quota_points: quotaToPoints(totalQuota, rawPerPoint),
      currency: 'USD',
      quota_per_unit: rawPerPoint,
      raw_per_point: rawPerPoint,
      usd_to_raw: FIXED_USD_TO_RAW,
      by_model: rows.sort((a, b) => b.cost - a.cost || b.tokens - a.tokens),
      priced_models: store.prices.length,
      note: `1 点 = ${rawPerPoint.toLocaleString('en-US')} token`,
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
          `[modelPrices] sync done imported=${result.imported} updated=${result.updated} skipped=${result.skipped} stale_removed=${result.stale_removed} inherited=${result.inherited_count || 0} supported=${result.supported_count} priced=${result.priced_count} unpriced=${result.unpriced_count} failed=${(result.failed_sources || []).join(',') || 'none'}`,
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

  /**
   * Console 模型广场 display fields: points per MTok from price book.
   * raw = round(usd × FIXED_USD_TO_RAW); points = raw / raw_per_point (N).
   * Returns null when model has no price-book row.
   */
  function plazaPriceFields(modelId) {
    const price = lookupPrice(modelId)
    if (!price) return null
    const rawPerPoint = resolveRawPerPoint()
    // Re-attach with FIXED USD→raw — never trust stale quota fields.
    const fresh = attachQuotaFields({ ...price })
    const inRaw = Number(fresh.input_quota_per_mtok) || 0
    const outRaw = Number(fresh.output_quota_per_mtok) || 0
    return {
      text_price: quotaToPoints(inRaw, rawPerPoint),
      text_out_price: quotaToPoints(outRaw, rawPerPoint),
      input_per_mtok: Number(fresh.input_per_mtok) || 0,
      output_per_mtok: Number(fresh.output_per_mtok) || 0,
      input_quota_per_mtok: inRaw,
      output_quota_per_mtok: outRaw,
      priced: true,
    }
  }

  return {
    getPrices,
    putPrices,
    syncOfficial,
    usageSummaryCosted,
    priceMap,
    lookupPrice,
    lookupBillingPrice,
    usageRecordCostUsd,
    plazaPriceFields,
    costForTokens,
    quotaForTokens: (price, prompt, completion, opts = {}) =>
      quotaForTokens(price, prompt, completion, opts),
    isProtectedManual,
    recomputeQuotaFields,
    startScheduledSync,
    stopScheduledSync,
    getQuotaUnit: resolveUnit,
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
  quotaForTokens,
  normalizePrice,
  isProtectedManual,
  stripAilyPrefix,
  parseSyncIntervalHours,
  attachQuotaFields,
  bareSupportedSet,
  dollarsToQuota,
  usdPerMtokToQuotaPerMtok,
  FIXED_USD_TO_RAW,
  VARIANT_INHERITANCE,
  applyVariantInheritance,
}
