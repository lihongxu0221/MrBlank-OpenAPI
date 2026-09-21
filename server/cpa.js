import crypto from 'node:crypto'
import fs from 'node:fs'

function readSecretFile(filePath) {
  if (!filePath) return ''
  try {
    return fs.readFileSync(filePath, 'utf8').trim()
  } catch {
    return ''
  }
}

export function loadCpaConfig(env = process.env) {
  const demoKey =
    env.CPA_DEMO_API_KEY || readSecretFile(env.CPA_DEMO_API_KEY_FILE) || ''
  const managementKey =
    env.CPA_MANAGEMENT_KEY || readSecretFile(env.CPA_MANAGEMENT_KEY_FILE) || ''
  const adminKey =
    env.CPAMP_ADMIN_KEY || readSecretFile(env.CPAMP_ADMIN_KEY_FILE) || ''
  return {
    cpaBaseUrl: (env.CPA_BASE_URL || 'http://127.0.0.1:8317').replace(/\/$/, ''),
    billingBaseUrl: (env.CPA_BILLING_URL || env.CPA_BASE_URL || 'http://127.0.0.1:8320').replace(
      /\/$/,
      '',
    ),
    cpampBaseUrl: (env.CPAMP_BASE_URL || 'http://127.0.0.1:18317').replace(/\/$/, ''),
    publicApiBaseUrl: (env.PUBLIC_API_BASE_URL || 'https://openapi.juc114.cn/v1').replace(
      /\/$/,
      '',
    ),
    demoKey,
    managementKey,
    adminKey,
  }
}

function maskKey(fullKey) {
  if (!fullKey || fullKey.length < 12) return '****'
  return `${fullKey.slice(0, 8)}****${fullKey.slice(-4)}`
}

export function hashApiKey(fullKey) {
  return crypto.createHash('sha256').update(String(fullKey)).digest('hex')
}

async function cpaFetch(cfg, path, { method = 'GET', body, key, headers = {} } = {}) {
  const url = `${cfg.cpaBaseUrl}${path}`
  const h = { Accept: 'application/json', ...headers }
  const auth = key || cfg.managementKey
  if (auth) h.Authorization = `Bearer ${auth}`
  if (body !== undefined) h['Content-Type'] = 'application/json'
  const res = await fetch(url, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }
  if (!res.ok) {
    const err = new Error(json?.error || json?.message || `CPA ${method} ${path} failed (${res.status})`)
    err.status = res.status
    err.payload = json
    throw err
  }
  return json
}

async function cpampFetch(cfg, path, { method = 'GET', body } = {}) {
  const url = `${cfg.cpampBaseUrl}${path}`
  const h = { Accept: 'application/json' }
  if (cfg.adminKey) h.Authorization = `Bearer ${cfg.adminKey}`
  if (body !== undefined) h['Content-Type'] = 'application/json'
  const res = await fetch(url, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }
  if (!res.ok) {
    const err = new Error(
      json?.error || json?.message || `CPAMP ${method} ${path} failed (${res.status})`,
    )
    err.status = res.status
    err.payload = json
    throw err
  }
  return json
}

let keyMutationChain = Promise.resolve()
function withKeyLock(fn) {
  const run = keyMutationChain.then(fn, fn)
  keyMutationChain = run.catch(() => {})
  return run
}

export async function listCpaApiKeys(cfg) {
  const data = await cpaFetch(cfg, '/v0/management/api-keys')
  return Array.isArray(data?.['api-keys']) ? data['api-keys'] : []
}

export async function setCpaApiKeys(cfg, keys) {
  return withKeyLock(async () => {
    await cpaFetch(cfg, '/v0/management/api-keys', { method: 'PUT', body: keys })
    return keys
  })
}

export async function addCpaApiKey(cfg, newKey) {
  return withKeyLock(async () => {
    const current = await listCpaApiKeys(cfg)
    if (current.includes(newKey)) return current
    const next = [...current, newKey]
    await cpaFetch(cfg, '/v0/management/api-keys', { method: 'PUT', body: next })
    return next
  })
}

export async function removeCpaApiKey(cfg, fullKey) {
  return withKeyLock(async () => {
    const current = await listCpaApiKeys(cfg)
    if (!current.includes(fullKey)) return current
    const next = current.filter((k) => k !== fullKey)
    // Prefer value query delete when possible; fall back to full replace.
    try {
      const url = `${cfg.cpaBaseUrl}/v0/management/api-keys?value=${encodeURIComponent(fullKey)}`
      const res = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${cfg.managementKey}`, Accept: 'application/json' },
      })
      if (res.ok) return next
    } catch {
      /* fall through */
    }
    await cpaFetch(cfg, '/v0/management/api-keys', { method: 'PUT', body: next })
    return next
  })
}

export async function fetchCpaModels(cfg) {
  const key = cfg.demoKey
  if (!key) throw new Error('CPA demo API key not configured')
  // Prefer billing shim when available; CPA direct also works.
  const bases = [cfg.billingBaseUrl, cfg.cpaBaseUrl].filter(Boolean)
  let lastErr
  for (const base of [...new Set(bases)]) {
    try {
      const res = await fetch(`${base}/v1/models`, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      })
      const json = await res.json()
      if (!res.ok) {
        lastErr = new Error(json?.error?.message || json?.error || `models ${res.status}`)
        continue
      }
      const items = Array.isArray(json?.data) ? json.data : []
      return items.map((m) => {
        const id = String(m.id || '')
        const owned = String(m.owned_by || 'cpa')
        let kind = 'text'
        const lower = id.toLowerCase()
        if (lower.includes('image') || lower.includes('imagine')) kind = 'image'
        else if (lower.includes('video')) kind = 'video'
        return {
          id,
          name: id,
          provider: owned,
          kind,
          text_price: kind === 'text' ? 0 : undefined,
          text_out_price: kind === 'text' ? 0 : undefined,
          image_price: kind === 'image' ? 0 : undefined,
          video_price: kind === 'video' ? 0 : undefined,
        }
      })
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error('failed to fetch models')
}

export async function fetchCpampUsage(cfg) {
  if (!cfg.adminKey) throw new Error('CPAMP admin key not configured')
  return cpampFetch(cfg, '/v0/management/usage')
}

/** Flatten CPAMP usage tree into log rows for given api key hashes. */
export function flattenUsageForHashes(usage, hashSet, { limit = 200, nameMap = null } = {}) {
  const rows = []
  const apis = usage?.apis || {}
  for (const [endpoint, meta] of Object.entries(apis)) {
    const models = meta?.models || {}
    for (const [modelName, modelMeta] of Object.entries(models)) {
      const details = Array.isArray(modelMeta?.details) ? modelMeta.details : []
      for (const d of details) {
        const h = d.api_key_hash
        if (!h || !hashSet.has(h)) continue
        const tokens = d.tokens || {}
        const prompt =
          Number(tokens.input_tokens ?? tokens.prompt_tokens ?? tokens.total_input_tokens ?? 0) || 0
        const completion =
          Number(tokens.output_tokens ?? tokens.completion_tokens ?? tokens.total_output_tokens ?? 0) ||
          0
        const total = Number(tokens.total_tokens ?? prompt + completion) || 0
        rows.push({
          id: `${d.timestamp || ''}-${h.slice(0, 8)}-${rows.length}`,
          created_at: d.timestamp || null,
          model_name: d.requested_model || d.resolved_model || modelName,
          token_name: (nameMap && nameMap.get(h)) || maskKeyFromHash(h),
          prompt_tokens: prompt,
          completion_tokens: completion,
          quota: total,
          endpoint,
          latency_ms: d.latency_ms,
          failed: !!d.failed,
        })
      }
    }
  }
  rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  return rows.slice(0, limit)
}

function maskKeyFromHash(h) {
  return `key…${String(h).slice(0, 6)}`
}

export { maskKey }

/** Simple in-memory TTL cache. */
export function createTtlCache(ttlMs = 45_000) {
  let entry = null
  return {
    get() {
      if (!entry) return null
      if (Date.now() - entry.at > ttlMs) {
        entry = null
        return null
      }
      return entry.value
    },
    set(value) {
      entry = { at: Date.now(), value }
      return value
    },
    clear() {
      entry = null
    },
  }
}

const usageCache = createTtlCache(45_000)

export async function fetchCpampUsageCached(cfg, { force = false } = {}) {
  if (!force) {
    const hit = usageCache.get()
    if (hit) return hit
  }
  const data = await fetchCpampUsage(cfg)
  return usageCache.set(data)
}

export async function probeUrl(url, { headers = {}, timeoutMs = 5000 } = {}) {
  const started = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal })
    const latency_ms = Date.now() - started
    let body = null
    try {
      body = await res.json()
    } catch {
      body = null
    }
    return { ok: res.ok, status: res.status, latency_ms, body }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      latency_ms: Date.now() - started,
      error: err?.message || String(err),
      body: null,
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Probe GET /v1/models with demo key; prefer billing then CPA. */
export async function probeCpaModels(cfg) {
  const key = cfg.demoKey
  if (!key) {
    return { ok: false, latency_ms: 0, models: [], error: 'demo key missing', base: null }
  }
  const bases = [...new Set([cfg.billingBaseUrl, cfg.cpaBaseUrl].filter(Boolean))]
  let last = null
  for (const base of bases) {
    const result = await probeUrl(`${base}/v1/models`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    })
    last = { ...result, base }
    if (result.ok) {
      const items = Array.isArray(result.body?.data) ? result.body.data : []
      return {
        ok: true,
        latency_ms: result.latency_ms,
        models: items.map((m) => ({
          id: String(m.id || ''),
          name: String(m.id || ''),
          owned_by: String(m.owned_by || 'cpa'),
        })),
        base,
        error: null,
      }
    }
  }
  return {
    ok: false,
    latency_ms: last?.latency_ms || 0,
    models: [],
    base: last?.base || null,
    error: last?.error || `models ${last?.status || 0}`,
  }
}

export async function probeServiceHealth(cfg) {
  const [cpa, billing, cpamp] = await Promise.all([
    probeUrl(`${cfg.cpaBaseUrl}/health`),
    probeUrl(`${cfg.billingBaseUrl}/health`),
    probeUrl(`${cfg.cpampBaseUrl}/health`),
  ])
  return {
    cpa: { ok: cpa.ok, latency_ms: cpa.latency_ms, status: cpa.status },
    billing: { ok: billing.ok, latency_ms: billing.latency_ms, status: billing.status },
    cpamp: { ok: cpamp.ok, latency_ms: cpamp.latency_ms, status: cpamp.status },
  }
}

function parseUsageTs(raw) {
  if (!raw) return null
  const s = String(raw)
  // Trim sub-ms fractions JS may reject (e.g. .717084143Z)
  const normalized = s.replace(/(\.\d{3})\d+(Z|[+-]\d{2}:?\d{2})?$/, '$1$2')
  const t = Date.parse(normalized)
  return Number.isFinite(t) ? t : null
}

function shanghaiDayKey(ms) {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}

export function periodStartMs(period = 'today') {
  const now = Date.now()
  if (period === 'all') return 0
  if (period === '7d' || period === 'week') return now - 7 * 86400000
  if (period === '24h') return now - 86400000
  // today in Asia/Shanghai
  const today = shanghaiDayKey(now)
  // Approximate: walk back hours until day key changes
  let t = now
  for (let i = 0; i < 48; i++) {
    if (shanghaiDayKey(t) !== today) return t + 1
    t -= 3600000
  }
  return now - 86400000
}

export function* iterateUsageDetails(usage) {
  const apis = usage?.apis || {}
  for (const [endpoint, meta] of Object.entries(apis)) {
    const models = meta?.models || {}
    for (const [modelName, modelMeta] of Object.entries(models)) {
      const details = Array.isArray(modelMeta?.details) ? modelMeta.details : []
      for (const d of details) {
        yield { endpoint, modelName, detail: d }
      }
    }
  }
}

function detailTokens(d) {
  const tokens = d?.tokens || {}
  const prompt =
    Number(tokens.input_tokens ?? tokens.prompt_tokens ?? tokens.total_input_tokens ?? 0) || 0
  const completion =
    Number(tokens.output_tokens ?? tokens.completion_tokens ?? tokens.total_output_tokens ?? 0) || 0
  const total = Number(tokens.total_tokens ?? prompt + completion) || 0
  return { prompt, completion, total }
}

export function filterDetailInPeriod(detail, period) {
  const start = periodStartMs(period)
  if (!start) return true
  const ts = parseUsageTs(detail?.timestamp)
  if (ts == null) return period === 'all'
  return ts >= start
}

/** Aggregate per api_key_hash for leaderboard. */
export function aggregateLeaderboardFromUsage(usage, hashToUser, { period = 'today', sort = 'credits' } = {}) {
  /** @type {Map<string, { calls: number, success: number, tokens: number }>} */
  const byHash = new Map()
  for (const { detail } of iterateUsageDetails(usage)) {
    if (!filterDetailInPeriod(detail, period)) continue
    const h = detail.api_key_hash
    if (!h) continue
    let row = byHash.get(h)
    if (!row) {
      row = { calls: 0, success: 0, tokens: 0 }
      byHash.set(h, row)
    }
    row.calls += 1
    if (!detail.failed) row.success += 1
    row.tokens += detailTokens(detail).total
  }

  const items = [...byHash.entries()].map(([hash, stats]) => {
    const mapped = hashToUser?.get?.(hash)
    const display =
      (mapped?.display_name && String(mapped.display_name).trim()) ||
      (mapped?.username && String(mapped.username).trim()) ||
      ''
    const name = display
      ? display
      : mapped?.userId
        ? `u***${String(mapped.userId).slice(-3)}`
        : `k***${String(hash).slice(0, 4)}`
    return {
      hash: String(hash).slice(0, 8),
      user_id: mapped?.userId || null,
      name,
      calls: stats.success || stats.calls,
      credits: stats.tokens,
      tokens: stats.tokens,
      requests: stats.calls,
    }
  })

  if (sort === 'calls') {
    items.sort((a, b) => b.calls - a.calls || b.credits - a.credits)
  } else {
    items.sort((a, b) => b.credits - a.credits || b.calls - a.calls)
  }

  return items.map((item, i) => ({
    rank: i + 1,
    name: item.name,
    calls: item.calls,
    credits: item.credits,
  }))
}

/** Aggregate per model for community activity. */
export function aggregateActivityFromUsage(usage, { period = 'today' } = {}) {
  /** @type {Map<string, { calls: number, successful: number, tokens: number }>} */
  const byModel = new Map()
  for (const { modelName, detail } of iterateUsageDetails(usage)) {
    if (!filterDetailInPeriod(detail, period)) continue
    const model = detail.requested_model || detail.resolved_model || modelName
    let row = byModel.get(model)
    if (!row) {
      row = { calls: 0, successful: 0, tokens: 0 }
      byModel.set(model, row)
    }
    row.calls += 1
    if (!detail.failed) row.successful += 1
    row.tokens += detailTokens(detail).total
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

/** Per-model latency samples from CPAMP for status cards. */
export function modelLatencyStatsFromUsage(usage, { period = '7d', limit = 24 } = {}) {
  /** @type {Map<string, { latencies: number[], failed: number, total: number }>} */
  const byModel = new Map()
  for (const { modelName, detail } of iterateUsageDetails(usage)) {
    if (!filterDetailInPeriod(detail, period)) continue
    const model = detail.requested_model || detail.resolved_model || modelName
    let row = byModel.get(model)
    if (!row) {
      row = { latencies: [], failed: 0, total: 0 }
      byModel.set(model, row)
    }
    row.total += 1
    if (detail.failed) row.failed += 1
    const lat = Number(detail.latency_ms)
    if (Number.isFinite(lat) && lat >= 0) {
      row.latencies.push({
        checked_at: detail.timestamp || null,
        status: detail.failed ? 'down' : 'operational',
        latency_ms: Math.round(lat),
      })
    }
  }
  const out = new Map()
  for (const [model, row] of byModel) {
    const hist = row.latencies
      .slice()
      .sort((a, b) => String(b.checked_at || '').localeCompare(String(a.checked_at || '')))
      .slice(0, limit)
    const okRate = row.total ? (row.total - row.failed) / row.total : 0
    const avg =
      hist.length > 0 ? Math.round(hist.reduce((s, h) => s + (h.latency_ms || 0), 0) / hist.length) : null
    let status = 'operational'
    if (okRate < 0.5) status = 'down'
    else if (okRate < 0.95) status = 'degraded'
    out.set(model, {
      status,
      latency_ms: avg,
      availability: Math.round(okRate * 1000) / 10,
      history: hist,
      samples: row.total,
    })
  }
  return out
}

const authFilesCache = createTtlCache(45_000)

export async function fetchCpampAuthFiles(cfg) {
  if (!cfg.adminKey) throw new Error('CPAMP admin key not configured')
  return cpampFetch(cfg, '/v0/management/auth-files')
}

export async function fetchCpampAuthFilesCached(cfg, { force = false } = {}) {
  if (!force) {
    const hit = authFilesCache.get()
    if (hit) return hit
  }
  const data = await fetchCpampAuthFiles(cfg)
  return authFilesCache.set(data)
}

/** Mask email / label for public pool cards. */
export function maskAccountLabel(raw) {
  const s = String(raw || '').trim()
  if (!s) return 'account***'
  const at = s.indexOf('@')
  if (at > 0) {
    const local = s.slice(0, at)
    const domain = s.slice(at + 1)
    const keep = Math.min(3, Math.max(1, local.length - 1))
    const domKeep = domain.includes('.') ? domain.slice(domain.indexOf('.')) : ''
    const domHead = domain.split('.')[0] || ''
    return `${local.slice(0, keep)}***@${domHead.slice(0, 2)}***${domKeep}`
  }
  if (s.length <= 4) return `${s[0]}***`
  return `${s.slice(0, 2)}***${s.slice(-2)}`
}

function poolStatusFromFile(f) {
  if (f.disabled) return 'disabled'
  if (f.unavailable) return 'exhausted'
  const st = String(f.status || '').toLowerCase()
  if (st === 'active' || st === 'ok' || st === 'available') return 'available'
  if (st.includes('exhaust') || st.includes('quota') || st.includes('limit')) return 'exhausted'
  if (st.includes('disable') || st.includes('ban')) return 'disabled'
  if (st) return st
  return 'available'
}

/** Map CPAMP auth-files → community pool cards (no secrets/paths). */
export function mapAuthFilesToPoolItems(authFilesPayload) {
  const files = Array.isArray(authFilesPayload?.files) ? authFilesPayload.files : []
  return files.map((f, i) => {
    const success = Number(f.success || 0) || 0
    const failed = Number(f.failed || 0) || 0
    const recent = Array.isArray(f.recent_requests) ? f.recent_requests : []
    const recentOk = recent.reduce((s, r) => s + (Number(r.success) || 0), 0)
    const recentFail = recent.reduce((s, r) => s + (Number(r.failed) || 0), 0)
    const label = f.label || f.email || f.account || f.name || `account-${i + 1}`
    return {
      name: maskAccountLabel(label),
      provider: String(f.provider || f.type || 'cpa'),
      tier: String(f.account_type || f.type || 'oauth'),
      status: poolStatusFromFile(f),
      success,
      failed,
      quotas: [
        {
          mode: 'observed',
          known: true,
          used: success,
          limit: success + failed,
        },
        {
          mode: 'recent',
          known: true,
          used: recentOk,
          limit: recentOk + recentFail,
        },
      ],
    }
  })
}

export async function fetchOpenaiCompatibility(cfg) {
  if (!cfg.managementKey) throw new Error('CPA management key not configured')
  const data = await cpaFetch(cfg, '/v0/management/openai-compatibility')
  const items = Array.isArray(data?.['openai-compatibility'])
    ? data['openai-compatibility']
    : Array.isArray(data)
      ? data
      : []
  return items.map((it) => ({
    name: it?.name || '',
    base_url: it?.['base-url'] || it?.base_url || '',
    prefix: it?.prefix || '',
    disabled: !!it?.disabled,
    models: Array.isArray(it?.models)
      ? it.models.map((m) => ({
          name: m?.name || '',
          alias: m?.alias || m?.name || '',
          display_name: m?.['display-name'] || m?.display_name || '',
        }))
      : [],
    api_key_count: Array.isArray(it?.['api-key-entries'])
      ? it['api-key-entries'].length
      : Array.isArray(it?.api_key_entries)
        ? it.api_key_entries.length
        : 0,
  }))
}
