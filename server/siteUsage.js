/**
 * Site-scoped usage log for MrBlank OpenAPI.
 * Captures /v1 traffic through this BFF — not CPA-wide CPAMP usage.
 */
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_MAX_EVENTS = 50_000
const DEFAULT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function readStore(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { version: 1, events: [] }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return { version: 1, events: Array.isArray(raw?.events) ? raw.events : [] }
  } catch {
    return { version: 1, events: [] }
  }
}

function writeStore(filePath, store) {
  ensureDir(filePath)
  const tmp = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(store), 'utf8')
  fs.renameSync(tmp, filePath)
}

function shanghaiDayKey(ms) {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}

export function periodStartMs(period = 'today') {
  const now = Date.now()
  if (period === 'all') return 0
  if (period === '7d' || period === 'week') return now - 7 * 86400000
  if (period === '24h') return now - 86400000
  const today = shanghaiDayKey(now)
  let t = now
  for (let i = 0; i < 48; i++) {
    if (shanghaiDayKey(t) !== today) return t + 1
    t -= 3600000
  }
  return now - 86400000
}

/**
 * @param {string} filePath
 * @param {{ maxEvents?: number, maxAgeMs?: number }} [opts]
 */
export function createSiteUsageStore(filePath, opts = {}) {
  const maxEvents = Number(opts.maxEvents) > 0 ? Number(opts.maxEvents) : DEFAULT_MAX_EVENTS
  const maxAgeMs = Number(opts.maxAgeMs) > 0 ? Number(opts.maxAgeMs) : DEFAULT_MAX_AGE_MS
  let store = readStore(filePath)
  let dirty = false
  let writeTimer = null

  function prune(now = Date.now()) {
    const cutoff = now - maxAgeMs
    let events = store.events.filter((e) => (Date.parse(e.ts || '') || 0) >= cutoff)
    if (events.length > maxEvents) events = events.slice(events.length - maxEvents)
    if (events.length !== store.events.length) {
      store.events = events
      dirty = true
    }
  }

  function flush() {
    if (!dirty) return
    prune()
    writeStore(filePath, store)
    dirty = false
  }

  function scheduleFlush() {
    if (writeTimer) return
    writeTimer = setTimeout(() => {
      writeTimer = null
      try {
        flush()
      } catch (err) {
        console.error('[siteUsage] flush failed', err?.message || err)
      }
    }, 800)
    if (typeof writeTimer.unref === 'function') writeTimer.unref()
  }

  /** @param {{ ts?: string, userId?: string|null, keyHash?: string|null, model?: string|null, endpoint?: string|null, success?: boolean, tokens?: number, prompt_tokens?: number, completion_tokens?: number }} evt */
  function recordEvent(evt) {
    const prompt = Number(evt.prompt_tokens) || 0
    const completion = Number(evt.completion_tokens) || 0
    const tokens = Number(evt.tokens) || prompt + completion
    store.events.push({
      ts: evt.ts || new Date().toISOString(),
      userId: evt.userId != null ? String(evt.userId) : null,
      keyHash: evt.keyHash ? String(evt.keyHash) : null,
      model: evt.model ? String(evt.model) : null,
      endpoint: evt.endpoint ? String(evt.endpoint) : null,
      success: evt.success !== false,
      tokens,
      prompt_tokens: prompt,
      completion_tokens: completion,
    })
    dirty = true
    if (store.events.length > maxEvents + 500) prune()
    scheduleFlush()
  }

  function eventsInPeriod(period = 'today') {
    const start = periodStartMs(period)
    return store.events.filter((e) => {
      const ts = Date.parse(e.ts || '') || 0
      return !start || ts >= start
    })
  }

  /**
   * Only events whose keyHash is in hashToUser (site key map), or userId matches a mapped user.
   * @param {{ period?: string, sort?: string, hashToUser?: Map<string, any> }} [opts]
   */
  function leaderboard({ period = 'today', sort = 'credits', hashToUser = null } = {}) {
    const allow = hashToUser instanceof Map ? hashToUser : null
    const allowedUserIds = allow
      ? new Set([...allow.values()].map((m) => String(m.userId || '')).filter(Boolean))
      : null

    /** @type {Map<string, { calls: number, success: number, tokens: number, userId: string|null }>} */
    const byKey = new Map()
    for (const e of eventsInPeriod(period)) {
      const h = e.keyHash
      if (allow) {
        const hashOk = h && allow.has(h)
        const userOk = e.userId && allowedUserIds.has(String(e.userId))
        if (!hashOk && !userOk) continue
      }
      const key = h || `user:${e.userId || 'unknown'}`
      let row = byKey.get(key)
      if (!row) {
        row = { calls: 0, success: 0, tokens: 0, userId: e.userId }
        byKey.set(key, row)
      }
      row.calls += 1
      if (e.success) row.success += 1
      row.tokens += Number(e.tokens) || 0
      if (!row.userId && e.userId) row.userId = e.userId
    }

    const items = [...byKey.entries()].map(([key, stats]) => {
      const mapped = (allow && key.indexOf('user:') !== 0 && allow.get(key)) || null
      const byUser =
        !mapped && allow && stats.userId
          ? [...allow.values()].find((m) => String(m.userId) === String(stats.userId))
          : null
      const meta = mapped || byUser
      const display =
        (meta?.display_name && String(meta.display_name).trim()) ||
        (meta?.username && String(meta.username).trim()) ||
        ''
      const userId = meta?.userId || stats.userId || null
      const name = display
        ? display
        : userId
          ? `u***${String(userId).slice(-3)}`
          : `k***${String(key).slice(0, 4)}`
      return {
        name,
        mapped: !!display,
        calls: stats.success || stats.calls,
        credits: stats.tokens,
      }
    })

    if (sort === 'calls') items.sort((a, b) => b.calls - a.calls || b.credits - a.credits)
    else items.sort((a, b) => b.credits - a.credits || b.calls - a.calls)

    return items.map((item, i) => ({
      rank: i + 1,
      name: item.name,
      mapped: !!item.mapped,
      calls: item.calls,
      credits: item.credits,
    }))
  }

  function activityByModel({ period = 'today' } = {}) {
    /** @type {Map<string, { calls: number, successful: number, tokens: number, prompt_tokens: number, completion_tokens: number }>} */
    const byModel = new Map()
    for (const e of eventsInPeriod(period)) {
      const model = e.model || 'unknown'
      let row = byModel.get(model)
      if (!row) {
        row = { calls: 0, successful: 0, tokens: 0, prompt_tokens: 0, completion_tokens: 0 }
        byModel.set(model, row)
      }
      row.calls += 1
      if (e.success) row.successful += 1
      row.tokens += Number(e.tokens) || 0
      row.prompt_tokens += Number(e.prompt_tokens) || 0
      row.completion_tokens += Number(e.completion_tokens) || 0
    }
    return [...byModel.entries()]
      .map(([model, s]) => ({
        model,
        calls: s.calls,
        successful: s.successful,
        tokens: s.tokens,
        prompt_tokens: s.prompt_tokens,
        completion_tokens: s.completion_tokens,
        credits: s.tokens,
      }))
      .sort((a, b) => b.calls - a.calls)
  }

  /** Shape compatible with summarizeUsage() for admin usage page. */
  function summarize({ period = 'all' } = {}) {
    const events = eventsInPeriod(period)
    const byModel = {}
    const byEndpoint = {}
    let success = 0
    let failure = 0
    let totalTokens = 0
    for (const e of events) {
      if (e.success) success += 1
      else failure += 1
      totalTokens += Number(e.tokens) || 0
      const model = e.model || 'unknown'
      const prev = byModel[model] || { calls: 0, failed: 0, tokens: 0 }
      byModel[model] = {
        calls: prev.calls + 1,
        failed: prev.failed + (e.success ? 0 : 1),
        tokens: prev.tokens + (Number(e.tokens) || 0),
      }
      const ep = e.endpoint || 'unknown'
      const epPrev = byEndpoint[ep] || { calls: 0, failed: 0, tokens: 0 }
      byEndpoint[ep] = {
        calls: epPrev.calls + 1,
        failed: epPrev.failed + (e.success ? 0 : 1),
        tokens: epPrev.tokens + (Number(e.tokens) || 0),
      }
    }
    return {
      total_requests: events.length,
      success_count: success,
      failure_count: failure,
      total_tokens: totalTokens,
      by_model: Object.entries(byModel)
        .map(([model, s]) => ({ model, ...s }))
        .sort((a, b) => b.calls - a.calls),
      by_endpoint: Object.entries(byEndpoint)
        .map(([endpoint, s]) => ({ endpoint, ...s }))
        .sort((a, b) => b.calls - a.calls),
    }
  }

  function stats() {
    return { path: filePath, events: store.events.length, dirty }
  }


  function eventsBetween(fromMs, toMs) {
    const from = Number(fromMs) || 0
    const to = Number(toMs) > 0 ? Number(toMs) : Date.now()
    return store.events.filter((e) => {
      const ts = Date.parse(e.ts || '') || 0
      return ts >= from && ts <= to
    })
  }

  function pickBucketMs(spanMs) {
    if (spanMs <= 2 * 3600000) return 5 * 60000
    if (spanMs <= 24 * 3600000) return 30 * 60000
    if (spanMs <= 7 * 86400000) return 2 * 3600000
    return 6 * 3600000
  }

  /**
   * CPAMP-like dashboard summary from site-usage events.
   * @param {{ todayStartMs?: number }} [opts]
   */
  function dashboardSummary({ todayStartMs } = {}) {
    const now = Date.now()
    const todayStart = Number(todayStartMs) > 0 ? Number(todayStartMs) : periodStartMs('today')
    const window30 = now - 30 * 60000
    let todayReq = 0
    let todayOk = 0
    let todayFail = 0
    let todayTokens = 0
    let todayPrompt = 0
    let todayCompletion = 0
    let m30Req = 0
    let m30Tokens = 0
    /** @type {Map<string, { calls: number, tokens: number, success: number }>} */
    const byModel = new Map()

    for (const e of store.events) {
      const ts = Date.parse(e.ts || '') || 0
      if (ts < todayStart && ts < window30) continue
      const tokens = Number(e.tokens) || 0
      const model = e.model || 'unknown'
      if (ts >= todayStart) {
        todayReq += 1
        if (e.success) todayOk += 1
        else todayFail += 1
        todayTokens += tokens
        todayPrompt += Number(e.prompt_tokens) || 0
        todayCompletion += Number(e.completion_tokens) || 0
        let row = byModel.get(model)
        if (!row) {
          row = { calls: 0, tokens: 0, success: 0 }
          byModel.set(model, row)
        }
        row.calls += 1
        row.tokens += tokens
        if (e.success) row.success += 1
      }
      if (ts >= window30) {
        m30Req += 1
        m30Tokens += tokens
      }
    }

    const models = [...byModel.entries()].map(([model, s]) => ({
      model,
      calls: s.calls,
      success: s.success,
      tokens: s.tokens,
    }))
    const topByTokens = models.slice().sort((a, b) => b.tokens - a.tokens || b.calls - a.calls).slice(0, 10)
    const topByCalls = models.slice().sort((a, b) => b.calls - a.calls || b.tokens - a.tokens).slice(0, 10)

    return {
      source: 'site-usage',
      generated_at: new Date().toISOString(),
      today_start_ms: todayStart,
      today: {
        requests: todayReq,
        success: todayOk,
        failure: todayFail,
        tokens: todayTokens,
        prompt_tokens: todayPrompt,
        completion_tokens: todayCompletion,
        success_rate: todayReq ? todayOk / todayReq : null,
      },
      last_30m: {
        requests: m30Req,
        tokens: m30Tokens,
        rpm: Math.round((m30Req / 30) * 1000) / 1000,
        tpm: Math.round((m30Tokens / 30) * 1000) / 1000,
      },
      top_models_by_tokens: topByTokens,
      top_models_by_calls: topByCalls,
    }
  }

  /**
   * Time-bucket + per-model series for monitoring page.
   * @param {{ fromMs: number, toMs: number, bucketMs?: number }} opts
   */
  function monitoringAnalytics({ fromMs, toMs, bucketMs } = {}) {
    const to = Number(toMs) > 0 ? Number(toMs) : Date.now()
    const from = Number(fromMs) >= 0 ? Number(fromMs) : to - 24 * 3600000
    const span = Math.max(1, to - from)
    const bucket = Number(bucketMs) > 0 ? Number(bucketMs) : pickBucketMs(span)
    const events = eventsBetween(from, to)

    const bucketCount = Math.max(1, Math.ceil(span / bucket))
    /** @type {{ t: number, requests: number, success: number, failure: number, tokens: number }[]} */
    const buckets = []
    for (let i = 0; i < bucketCount; i++) {
      buckets.push({
        t: from + i * bucket,
        requests: 0,
        success: 0,
        failure: 0,
        tokens: 0,
      })
    }

    /** @type {Map<string, { requests: number, success: number, failure: number, tokens: number, series: number[] }>} */
    const byModel = new Map()

    for (const e of events) {
      const ts = Date.parse(e.ts || '') || 0
      let idx = Math.floor((ts - from) / bucket)
      if (idx < 0) idx = 0
      if (idx >= buckets.length) idx = buckets.length - 1
      const tokens = Number(e.tokens) || 0
      buckets[idx].requests += 1
      buckets[idx].tokens += tokens
      if (e.success) buckets[idx].success += 1
      else buckets[idx].failure += 1

      const model = e.model || 'unknown'
      let row = byModel.get(model)
      if (!row) {
        row = {
          requests: 0,
          success: 0,
          failure: 0,
          tokens: 0,
          series: new Array(bucketCount).fill(0),
        }
        byModel.set(model, row)
      }
      row.requests += 1
      row.tokens += tokens
      row.series[idx] += 1
      if (e.success) row.success += 1
      else row.failure += 1
    }

    const models = [...byModel.entries()]
      .map(([model, s]) => ({
        model,
        requests: s.requests,
        success: s.success,
        failure: s.failure,
        tokens: s.tokens,
        series: s.series,
      }))
      .sort((a, b) => b.requests - a.requests || b.tokens - a.tokens)

    return {
      source: 'site-usage',
      from_ms: from,
      to_ms: to,
      bucket_ms: bucket,
      totals: {
        requests: events.length,
        success: events.filter((e) => e.success).length,
        failure: events.filter((e) => !e.success).length,
        tokens: events.reduce((s, e) => s + (Number(e.tokens) || 0), 0),
      },
      buckets,
      by_model: models,
    }
  }

  function distinctModels({ period = 'all' } = {}) {
    const set = new Set()
    for (const e of eventsInPeriod(period)) {
      if (e.model) set.add(String(e.model))
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }

  function normalizeEvent(raw) {
    if (!raw || typeof raw !== 'object') return null
    const prompt = Number(raw.prompt_tokens) || 0
    const completion = Number(raw.completion_tokens) || 0
    const tokens = Number(raw.tokens) || prompt + completion
    const ts = raw.ts ? String(raw.ts) : new Date().toISOString()
    if (!Date.parse(ts)) return null
    return {
      ts,
      userId: raw.userId != null ? String(raw.userId) : null,
      keyHash: raw.keyHash ? String(raw.keyHash) : null,
      model: raw.model ? String(raw.model) : null,
      endpoint: raw.endpoint ? String(raw.endpoint) : null,
      success: raw.success !== false,
      tokens,
      prompt_tokens: prompt,
      completion_tokens: completion,
    }
  }

  function eventKey(e) {
    return [e.ts, e.keyHash || '', e.userId || '', e.model || '', e.endpoint || '', e.tokens, e.success ? 1 : 0].join('|')
  }

  /** JSON-download friendly export of site-usage events. */
  function exportBundle({ period = 'all', limit = 0 } = {}) {
    let events = eventsInPeriod(period).map((e) => ({ ...e }))
    const lim = Number(limit) || 0
    if (lim > 0 && events.length > lim) events = events.slice(events.length - lim)
    return {
      version: 1,
      source: 'site-usage',
      exported_at: new Date().toISOString(),
      period,
      count: events.length,
      events,
    }
  }

  /**
   * Import events from a JSON blob (exportBundle shape or {events}/array).
   * @param {any} payload
   * @param {{ mode?: 'append'|'merge', maxEvents?: number, maxImport?: number }} [opts]
   */
  function importEvents(payload, opts = {}) {
    const mode = opts.mode === 'merge' ? 'merge' : 'append'
    const maxImport = Number(opts.maxImport) > 0 ? Number(opts.maxImport) : 100_000
    const cap = Number(opts.maxEvents) > 0 ? Number(opts.maxEvents) : maxEvents

    let list = []
    if (Array.isArray(payload)) list = payload
    else if (Array.isArray(payload?.events)) list = payload.events
    else if (Array.isArray(payload?.data?.events)) list = payload.data.events
    else {
      const err = new Error('Invalid import payload: expected { events: [...] }')
      err.status = 400
      throw err
    }
    if (list.length > maxImport) {
      const err = new Error(`Import too large: ${list.length} events (max ${maxImport}). Use chunked import-sessions.`)
      err.status = 413
      throw err
    }

    const existing = mode === 'merge' ? new Set(store.events.map(eventKey)) : null
    let added = 0
    let skipped = 0
    let invalid = 0
    for (const raw of list) {
      const e = normalizeEvent(raw)
      if (!e) {
        invalid += 1
        continue
      }
      if (existing) {
        const k = eventKey(e)
        if (existing.has(k)) {
          skipped += 1
          continue
        }
        existing.add(k)
      }
      store.events.push(e)
      added += 1
    }
    dirty = true
    prune()
    if (store.events.length > cap) {
      store.events = store.events.slice(store.events.length - cap)
    }
    flush()
    return {
      mode,
      received: list.length,
      added,
      skipped,
      invalid,
      total_events: store.events.length,
    }
  }

  prune()
  if (dirty) flush()

  return {
    recordEvent,
    leaderboard,
    activityByModel,
    summarize,
    stats,
    flush,
    eventsBetween,
    dashboardSummary,
    monitoringAnalytics,
    distinctModels,
    periodStartMs,
    exportBundle,
    importEvents,
  }
}
