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
    /** @type {Map<string, { calls: number, successful: number, tokens: number }>} */
    const byModel = new Map()
    for (const e of eventsInPeriod(period)) {
      const model = e.model || 'unknown'
      let row = byModel.get(model)
      if (!row) {
        row = { calls: 0, successful: 0, tokens: 0 }
        byModel.set(model, row)
      }
      row.calls += 1
      if (e.success) row.successful += 1
      row.tokens += Number(e.tokens) || 0
    }
    return [...byModel.entries()]
      .map(([model, s]) => ({
        model,
        calls: s.calls,
        successful: s.successful,
        tokens: s.tokens,
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

  prune()
  if (dirty) flush()

  return { recordEvent, leaderboard, activityByModel, summarize, stats, flush }
}
