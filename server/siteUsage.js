/**
 * Site-scoped usage log for MrBlank OpenAPI (aily-parity enriched events).
 * Captures /v1 traffic through this BFF — not CPA-wide CPAMP usage.
 * Never stores raw API keys (keyHash + masked token_name only).
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_MAX_EVENTS = 50_000
const DEFAULT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

/** aily LogTypeConsume / LogTypeError */
export const TYPE_CONSUME = 2
export const TYPE_ERROR = 5

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function readStore(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { version: 2, events: [] }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return { version: 2, events: Array.isArray(raw?.events) ? raw.events : [] }
  } catch {
    return { version: 2, events: [] }
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

function pad2(n) {
  return String(n).padStart(2, '0')
}

function dayKeyMs(ms) {
  const d = new Date(ms)
  // Asia/Shanghai calendar day
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value
  return `${y}-${m}-${day}`
}

function hourKeyMs(ms) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(dPartsSafe(ms))
  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value
  let h = parts.find((p) => p.type === 'hour')?.value
  if (h === '24') h = '00'
  return `${y}-${m}-${day} ${h}:00`
}

function dPartsSafe(ms) {
  return new Date(ms)
}

function newId() {
  return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
}

function syntheticId(e) {
  const raw = [e.ts, e.keyHash || '', e.userId || '', e.model || '', e.endpoint || '', e.tokens, e.success ? 1 : 0].join('|')
  return `bf-${crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16)}`
}

export function periodStartMs(period = 'today') {
  const now = Date.now()
  if (period === 'all') return 0
  if (period === '7d' || period === 'week') return now - 7 * 86400000
  if (period === '14d') return now - 14 * 86400000
  if (period === '30d') return now - 30 * 86400000
  if (period === '24h') return now - 86400000
  if (period === 'yesterday') {
    const today = shanghaiDayKey(now)
    let t = now
    let crossed = false
    for (let i = 0; i < 72; i++) {
      const k = shanghaiDayKey(t)
      if (!crossed && k !== today) crossed = true
      else if (crossed && k !== shanghaiDayKey(t + 3600000)) return t + 1
      t -= 3600000
    }
    return now - 2 * 86400000
  }
  if (period === 'month') {
    const day = shanghaiDayKey(now)
    const [y, m] = day.split('-').map(Number)
    return Date.parse(`${y}-${pad2(m)}-01T00:00:00+08:00`) || now - 30 * 86400000
  }
  if (period === 'last_month') {
    const day = shanghaiDayKey(now)
    const [y, m] = day.split('-').map(Number)
    const lm = m === 1 ? 12 : m - 1
    const ly = m === 1 ? y - 1 : y
    const start = Date.parse(`${ly}-${pad2(lm)}-01T00:00:00+08:00`) || 0
    const end = Date.parse(`${y}-${pad2(m)}-01T00:00:00+08:00`) || now
    return { start, end }
  }
  // today (Asia/Shanghai)
  const today = shanghaiDayKey(now)
  let t = now
  for (let i = 0; i < 48; i++) {
    if (shanghaiDayKey(t) !== today) return t + 1
    t -= 3600000
  }
  return now - 86400000
}

function rangeBounds(q = {}) {
  const now = Date.now()
  if (Number(q.start_timestamp) && Number(q.end_timestamp)) {
    return {
      from: Number(q.start_timestamp) * (Number(q.start_timestamp) < 1e12 ? 1000 : 1),
      to: Number(q.end_timestamp) * (Number(q.end_timestamp) < 1e12 ? 1000 : 1),
    }
  }
  const range = q.range || q.period || '24h'
  if (range === 'all') return { from: 0, to: now }
  if (range === 'custom' && q.startMs && q.endMs) {
    return { from: Number(q.startMs) || 0, to: Number(q.endMs) || now }
  }
  const start = periodStartMs(range)
  if (start && typeof start === 'object' && start.start != null) {
    return { from: start.start, to: start.end || now }
  }
  return { from: Number(start) || 0, to: now }
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

  // Backfill: ensure every event has id + enriched defaults (no fake bodies)
  let backfilled = 0
  for (const e of store.events) {
    if (!e.id) {
      e.id = syntheticId(e)
      backfilled += 1
      dirty = true
    }
    if (e.type == null) {
      e.type = e.success === false ? TYPE_ERROR : TYPE_CONSUME
      dirty = true
    }
    if (e.diagnosis_id == null && e.id) {
      // historical: no diagnosis dump link; leave null (CPAMP summary-only)
    }
    if (e.amountUsd == null && e.amount != null) e.amountUsd = Number(e.amount) || 0
    if (e.rawQuota == null && e.quota != null) e.rawQuota = Number(e.quota) || 0
    if (e.model_requested == null && e.model) e.model_requested = e.model
    if (e.model_resolved == null && e.model) e.model_resolved = e.model
  }
  if (backfilled) {
    console.log(`[siteUsage] backfilled ids on ${backfilled} legacy events`)
  }

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

  function normalizeIncoming(evt) {
    if (!evt || typeof evt !== 'object') return null
    const prompt = Number(evt.prompt_tokens) || 0
    const completion = Number(evt.completion_tokens) || 0
    const cacheTokens = Number(evt.cache_tokens) || 0
    const cacheWriteTokens = Number(evt.cache_write_tokens) || 0
    const tokens = Number(evt.tokens) || prompt + completion
    const ts = evt.ts ? String(evt.ts) : new Date().toISOString()
    if (!Date.parse(ts)) return null
    const success = evt.success !== false && !(Number(evt.status) >= 400) && !(Number(evt.status_code) >= 400)
    const type =
      evt.type != null
        ? Number(evt.type)
        : success
          ? TYPE_CONSUME
          : TYPE_ERROR
    const modelRequested = evt.model_requested || evt.requested_model || evt.model || null
    const modelResolved = evt.model_resolved || evt.model_name || evt.model || modelRequested
    const id = evt.id || evt.diagnosis_id || newId()
    // Never persist raw keys
    const keyHash = evt.keyHash ? String(evt.keyHash) : null
    if (evt.apiKey || evt.api_key || evt.raw_key) {
      /* intentionally dropped */
    }
    return {
      id: String(id),
      ts,
      userId: evt.userId != null ? String(evt.userId) : null,
      username: evt.username ? String(evt.username) : null,
      keyHash,
      token_name: evt.token_name ? String(evt.token_name).slice(0, 120) : null,
      model: modelResolved ? String(modelResolved) : null,
      model_requested: modelRequested ? String(modelRequested) : null,
      model_resolved: modelResolved ? String(modelResolved) : null,
      endpoint: evt.endpoint ? String(evt.endpoint) : null,
      group: evt.group ? String(evt.group) : evt.group_id ? String(evt.group_id) : null,
      status: Number(evt.status ?? evt.status_code) || (success ? 200 : 0),
      success,
      type,
      tokens,
      prompt_tokens: prompt,
      completion_tokens: completion,
      cache_tokens: cacheTokens,
      cache_write_tokens: cacheWriteTokens,
      amountUsd: Number(evt.amountUsd ?? evt.amount) || 0,
      rawQuota: Number(evt.rawQuota ?? evt.quota) || 0,
      duration_ms: evt.duration_ms != null ? Number(evt.duration_ms) : null,
      ttft_ms: evt.ttft_ms != null ? Number(evt.ttft_ms) : null,
      stream: !!(evt.stream ?? evt.is_stream),
      ip: evt.ip ? String(evt.ip).slice(0, 64) : null,
      route: evt.route || evt.route_via || null,
      diagnosis_id: evt.diagnosis_id ? String(evt.diagnosis_id) : String(id),
      content: evt.content ? String(evt.content).slice(0, 300) : null,
      has_detail: evt.has_detail != null ? !!evt.has_detail : !!evt.diagnosis_id,
    }
  }

  /** @param {object} evt */
  function recordEvent(evt) {
    const row = normalizeIncoming(evt)
    if (!row) return null
    store.events.push(row)
    dirty = true
    if (store.events.length > maxEvents + 500) prune()
    scheduleFlush()
    return row
  }

  function eventsInPeriod(period = 'today') {
    const { from, to } = rangeBounds({ range: period })
    return store.events.filter((e) => {
      const ts = Date.parse(e.ts || '') || 0
      return ts >= from && ts <= to
    })
  }

  function matchFilters(e, q = {}) {
    // Console scope: match userId OR any of keyHashes (OR semantics)
    if (q.userIdOrKeyHashes) {
      const uid = q.userIdOrKeyHashes.userId
      const hashes = q.userIdOrKeyHashes.keyHashes
      const userOk = uid != null && String(e.userId || '') === String(uid)
      const hashOk = e.keyHash && hashes instanceof Set && hashes.has(e.keyHash)
      if (!userOk && !hashOk) return false
    } else {
      if (q.userId != null && String(e.userId || '') !== String(q.userId)) return false
      if (q.userIds instanceof Set && !q.userIds.has(String(e.userId || ''))) return false
      if (q.keyHashes instanceof Set) {
        if (!e.keyHash || !q.keyHashes.has(e.keyHash)) return false
      }
      if (q.keyHash && e.keyHash !== q.keyHash) return false
    }
    if (q.token_name) {
      const want = String(q.token_name).toLowerCase()
      if (!String(e.token_name || '').toLowerCase().includes(want)) return false
    }
    if (q.model || q.model_name) {
      const want = String(q.model || q.model_name).toLowerCase()
      const hay = `${e.model || ''} ${e.model_requested || ''} ${e.model_resolved || ''}`.toLowerCase()
      if (!hay.includes(want)) return false
    }
    if (q.group) {
      const g = e.group || '默认分组'
      if (String(g) !== String(q.group) && !(q.group === 'ungrouped' && !e.group)) return false
    }
    if (q.username) {
      const want = String(q.username).toLowerCase()
      if (!String(e.username || '').toLowerCase().includes(want) && !String(e.userId || '').includes(want))
        return false
    }
    if (q.is_stream === '1' || q.is_stream === 1 || q.stream === true) {
      if (!e.stream) return false
    }
    if (q.is_stream === '0' || q.is_stream === 0 || q.stream === false) {
      if (e.stream) return false
    }
    if (q.type != null && q.type !== '' && Number(q.type) !== Number(e.type)) return false
    if (q.success === true && !e.success) return false
    if (q.success === false && e.success) return false
    return true
  }

  function filterEvents(q = {}) {
    const { from, to } = rangeBounds(q)
    return store.events.filter((e) => {
      const ts = Date.parse(e.ts || '') || 0
      if (ts < from || ts > to) return false
      return matchFilters(e, q)
    })
  }

  /** Slim list item (no bodies — site-usage never stores bodies). */
  function toListItem(e, { includeUser = true } = {}) {
    const createdAtSec = Math.floor((Date.parse(e.ts || '') || 0) / 1000)
    return {
      id: e.id,
      created_at: createdAtSec,
      ts: e.ts,
      type: e.type,
      userId: includeUser ? e.userId : undefined,
      username: includeUser ? e.username || null : undefined,
      keyHash: e.keyHash,
      token_name: e.token_name || (e.keyHash ? `k***${String(e.keyHash).slice(0, 4)}` : '-'),
      model_name: e.model_resolved || e.model || e.model_requested || '',
      requested_model: e.model_requested || e.model || '',
      endpoint: e.endpoint || '',
      group: e.group || '默认分组',
      status_code: e.status || (e.success ? 200 : 0),
      success: !!e.success,
      prompt_tokens: Number(e.prompt_tokens) || 0,
      completion_tokens: Number(e.completion_tokens) || 0,
      cache_tokens: Number(e.cache_tokens) || 0,
      cache_write_tokens: Number(e.cache_write_tokens) || 0,
      tokens: Number(e.tokens) || 0,
      amount: Number(e.amountUsd) || 0,
      amountUsd: Number(e.amountUsd) || 0,
      quota: Number(e.rawQuota) || 0,
      rawQuota: Number(e.rawQuota) || 0,
      duration_ms: e.duration_ms,
      ttft_ms: e.ttft_ms,
      is_stream: !!e.stream,
      ip: e.ip || '',
      route_via: e.route || '',
      diagnosis_id: e.diagnosis_id || e.id,
      has_detail: !!e.has_detail,
      content: e.content || '',
    }
  }

  /**
   * Paginated slim list with aily-like filters.
   * @param {object} q
   */
  function listEvents(q = {}) {
    const page = Math.max(1, Number(q.p) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(q.page_size) || 20))
    const filtered = filterEvents(q)
    // newest first
    filtered.sort((a, b) => (Date.parse(b.ts || '') || 0) - (Date.parse(a.ts || '') || 0))
    const total = filtered.length
    const start = (page - 1) * pageSize
    const slice = filtered.slice(start, start + pageSize)
    return {
      page,
      page_size: pageSize,
      total,
      items: slice.map((e) => toListItem(e, { includeUser: q.includeUser !== false })),
    }
  }

  function emptyBucket(key) {
    return {
      date: key,
      quota: 0,
      tokens: 0,
      amount: 0,
      requests: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      cache_tokens: 0,
    }
  }

  function bumpBag(bag, key, row) {
    const rec =
      bag[key] ||
      {
        name: key,
        quota: 0,
        tokens: 0,
        amount: 0,
        requests: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
        cache_tokens: 0,
        keys: {},
      }
    rec.quota += Number(row.rawQuota) || 0
    rec.amount += Number(row.amountUsd) || 0
    rec.requests += 1
    rec.prompt_tokens += Number(row.prompt_tokens) || 0
    rec.completion_tokens += Number(row.completion_tokens) || 0
    rec.cache_tokens += Number(row.cache_tokens) || 0
    rec.tokens = rec.prompt_tokens + rec.completion_tokens
    const kn = row.token_name || row.keyHash || 'unknown'
    if (!rec.keys[kn]) {
      rec.keys[kn] = {
        name: kn,
        requests: 0,
        tokens: 0,
        amount: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
      }
    }
    const k = rec.keys[kn]
    k.requests += 1
    k.prompt_tokens += Number(row.prompt_tokens) || 0
    k.completion_tokens += Number(row.completion_tokens) || 0
    k.tokens = k.prompt_tokens + k.completion_tokens
    k.amount += Number(row.amountUsd) || 0
    bag[key] = rec
  }

  function bagToList(bag, nestKeys = false) {
    return Object.values(bag)
      .map((r) => {
        const out = { ...r }
        if (nestKeys) {
          out.keys = Object.values(r.keys || {}).sort((a, b) => (b.tokens || 0) - (a.tokens || 0))
        } else {
          delete out.keys
        }
        return out
      })
      .sort((a, b) => (b.tokens || 0) - (a.tokens || 0) || (b.requests || 0) - (a.requests || 0))
  }

  /** aily-parity chart/distributions */
  function chartData(q = {}) {
    const typeQ = { ...q }
    if (typeQ.type == null || typeQ.type === '') typeQ.type = TYPE_CONSUME
    const events = filterEvents(typeQ)
    let { from, to } = rangeBounds(q)
    const range = q.range || q.period || '24h'
    // Anchor unbounded windows to real data (aily-parity) so we never emit epoch→now buckets.
    if (range === 'all' || from <= 0) {
      if (events.length) {
        let oldest = to
        for (const row of events) {
          const ts = Date.parse(row.ts || '') || 0
          if (ts > 0 && ts < oldest) oldest = ts
        }
        from = oldest
      } else {
        from = Math.max(0, to - 86400000)
      }
    }
    const span = Math.max(3600000, to - from)
    let grain = q.grain || (span <= 48 * 3600000 ? 'hour' : 'day')
    if (grain !== 'hour' && grain !== 'day') grain = 'day'

    const buckets = []
    const map = {}
    const ensureBucket = (key) => {
      if (map[key]) return
      const rec = emptyBucket(key)
      buckets.push(rec)
      map[key] = rec
    }
    // Inclusive of the end grain key so "current hour/day" events bind into series
    // (ceil(span/step) alone drops the in-progress bucket and left Token趋势 flat).
    if (grain === 'hour') {
      const step = 3600000
      for (let t = from; t <= to; t += step) ensureBucket(hourKeyMs(t))
      ensureBucket(hourKeyMs(to))
    } else {
      const step = 86400000
      for (let t = from; t <= to; t += step) ensureBucket(dayKeyMs(t))
      ensureBucket(dayKeyMs(to))
    }

    const by_model = {}
    const by_group = {}
    const by_endpoint = {}
    const by_user = {}
    let durationSum = 0
    let durationN = 0
    let prompt = 0
    let completion = 0
    let cache = 0
    let amount = 0
    let quota = 0

    for (const row of events) {
      const ts = Date.parse(row.ts || '') || 0
      const key = grain === 'hour' ? hourKeyMs(ts) : dayKeyMs(ts)
      const pt = Number(row.prompt_tokens) || 0
      const ct = Number(row.completion_tokens) || 0
      const ch = Number(row.cache_tokens) || 0
      const am = Number(row.amountUsd) || 0
      const qu = Number(row.rawQuota) || 0
      prompt += pt
      completion += ct
      cache += ch
      amount += am
      quota += qu
      if (row.duration_ms != null) {
        durationSum += Number(row.duration_ms) || 0
        durationN += 1
      }
      if (map[key]) {
        map[key].quota += qu
        map[key].amount += am
        map[key].requests += 1
        map[key].prompt_tokens += pt
        map[key].completion_tokens += ct
        map[key].cache_tokens += ch
        map[key].tokens = map[key].prompt_tokens + map[key].completion_tokens
      }
      bumpBag(by_model, row.model_resolved || row.model || row.model_requested || 'unknown', row)
      bumpBag(by_group, row.group || '默认分组', row)
      bumpBag(by_endpoint, row.endpoint || 'unknown', row)
      bumpBag(by_user, row.username || row.userId || 'unknown', row)
    }

    return {
      grain,
      from_ms: from,
      to_ms: to,
      series: buckets,
      days: buckets,
      by_model: bagToList(by_model, true),
      by_group: bagToList(by_group),
      by_endpoint: bagToList(by_endpoint),
      by_user: bagToList(by_user),
      totals: {
        requests: events.length,
        prompt_tokens: prompt,
        completion_tokens: completion,
        cache_tokens: cache,
        tokens: prompt + completion,
        amount,
        quota,
        avg_ms: durationN ? Math.round(durationSum / durationN) : 0,
      },
    }
  }

  function logFilters(q = {}) {
    const scoped = filterEvents({ ...q, type: q.type != null ? q.type : undefined, range: q.range || 'all' })
    const token_names = new Set()
    const model_names = new Set()
    const usernames = new Set()
    const groups = new Set()
    for (const e of scoped) {
      if (e.token_name) token_names.add(e.token_name)
      const m = e.model_resolved || e.model || e.model_requested
      if (m) model_names.add(m)
      if (e.username) usernames.add(e.username)
      groups.add(e.group || '默认分组')
    }
    return {
      token_names: [...token_names].sort(),
      model_names: [...model_names].sort(),
      usernames: q.includeUsers === false ? [] : [...usernames].sort(),
      groups: [...groups].sort(),
    }
  }

  function getEvent(id) {
    const want = String(id || '')
    return store.events.find((e) => e.id === want || e.diagnosis_id === want) || null
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
    /** @type {Map<string, { calls: number, successful: number, tokens: number, prompt_tokens: number, completion_tokens: number, cache_tokens: number, cache_write_tokens: number }>} */
    const byModel = new Map()
    for (const e of eventsInPeriod(period)) {
      const model = e.model || 'unknown'
      let row = byModel.get(model)
      if (!row) {
        row = {
          calls: 0,
          successful: 0,
          tokens: 0,
          prompt_tokens: 0,
          completion_tokens: 0,
          cache_tokens: 0,
          cache_write_tokens: 0,
        }
        byModel.set(model, row)
      }
      row.calls += 1
      if (e.success) row.successful += 1
      row.tokens += Number(e.tokens) || 0
      row.prompt_tokens += Number(e.prompt_tokens) || 0
      row.completion_tokens += Number(e.completion_tokens) || 0
      row.cache_tokens += Number(e.cache_tokens) || 0
      row.cache_write_tokens += Number(e.cache_write_tokens) || 0
    }
    return [...byModel.entries()]
      .map(([model, s]) => ({
        model,
        calls: s.calls,
        successful: s.successful,
        tokens: s.tokens,
        prompt_tokens: s.prompt_tokens,
        completion_tokens: s.completion_tokens,
        cache_tokens: s.cache_tokens,
        cache_write_tokens: s.cache_write_tokens,
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
    let totalAmount = 0
    for (const e of events) {
      if (e.success) success += 1
      else failure += 1
      totalTokens += Number(e.tokens) || 0
      totalAmount += Number(e.amountUsd) || 0
      const model = e.model || 'unknown'
      const prev = byModel[model] || { calls: 0, failed: 0, tokens: 0, amount: 0 }
      byModel[model] = {
        calls: prev.calls + 1,
        failed: prev.failed + (e.success ? 0 : 1),
        tokens: prev.tokens + (Number(e.tokens) || 0),
        amount: prev.amount + (Number(e.amountUsd) || 0),
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
      total_amount: totalAmount,
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
    return normalizeIncoming(raw)
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
      version: 2,
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
    listEvents,
    chartData,
    logFilters,
    getEvent,
    toListItem,
    TYPE_CONSUME,
    TYPE_ERROR,
  }
}
