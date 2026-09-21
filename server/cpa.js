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

/** Prefer CPA /healthz (cli-proxy-api); optional path fallbacks. */
async function probeServiceRoot(baseUrl, candidates) {
  let last = { ok: false, status: 0, latency_ms: 0 }
  for (const path of candidates) {
    const result = await probeUrl(`${baseUrl}${path}`)
    last = result
    if (result.ok) return result
  }
  return last
}

export async function probeServiceHealth(cfg) {
  const [cpa, billing] = await Promise.all([
    probeServiceRoot(cfg.cpaBaseUrl, ["/healthz", "/", "/health"]),
    probeServiceRoot(cfg.billingBaseUrl, ["/healthz", "/", "/health"]),
  ])
  return {
    cpa: { ok: cpa.ok, latency_ms: cpa.latency_ms, status: cpa.status },
    billing: { ok: billing.ok, latency_ms: billing.latency_ms, status: billing.status },
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
  const allow = hashToUser instanceof Map ? hashToUser : null
  for (const { detail } of iterateUsageDetails(usage)) {
    if (!filterDetailInPeriod(detail, period)) continue
    const h = detail.api_key_hash
    if (!h) continue
    // When a site key map is provided, only count keys issued by this site.
    if (allow && !allow.has(h)) continue
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
    const isMapped = !!(
      (mapped?.display_name && String(mapped.display_name).trim()) ||
      (mapped?.username && String(mapped.username).trim())
    )
    return {
      hash: String(hash).slice(0, 8),
      user_id: mapped?.userId || null,
      name,
      mapped: isMapped,
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
    mapped: !!item.mapped,
    calls: item.calls,
    credits: item.credits,
  }))
}

/** Aggregate per model for community activity. */
export function aggregateActivityFromUsage(usage, { period = 'today', hashAllow = null } = {}) {
  /** @type {Map<string, { calls: number, successful: number, tokens: number }>} */
  const byModel = new Map()
  const allow = hashAllow instanceof Set || hashAllow instanceof Map ? hashAllow : null
  for (const { modelName, detail } of iterateUsageDetails(usage)) {
    if (!filterDetailInPeriod(detail, period)) continue
    const h = detail.api_key_hash
    if (allow && (!h || !allow.has(h))) continue
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


const cpaAuthFilesCache = createTtlCache(45_000)

/** CPA auth-files via management key (preferred over CPAMP). */
export async function fetchCpaAuthFiles(cfg) {
  if (!cfg.managementKey) throw new Error('CPA management key not configured')
  return cpaFetch(cfg, '/v0/management/auth-files')
}

export async function fetchCpaAuthFilesCached(cfg, { force = false } = {}) {
  if (!force) {
    const hit = cpaAuthFilesCache.get()
    if (hit) return hit
  }
  const data = await fetchCpaAuthFiles(cfg)
  return cpaAuthFilesCache.set(data)
}

/** CPA /v0/management/config (sanitized by caller). */
export async function fetchCpaConfig(cfg) {
  if (!cfg.managementKey) throw new Error('CPA management key not configured')
  return cpaFetch(cfg, '/v0/management/config')
}

/** GET { "request-log": boolean } */
export async function fetchCpaRequestLog(cfg) {
  if (!cfg.managementKey) throw new Error('CPA management key not configured')
  const data = await cpaFetch(cfg, '/v0/management/request-log')
  return { enabled: !!(data?.['request-log'] ?? data?.enabled ?? data?.value) }
}

/** PUT body: { "value": boolean } */
export async function setCpaRequestLog(cfg, enabled) {
  if (!cfg.managementKey) throw new Error('CPA management key not configured')
  return cpaFetch(cfg, '/v0/management/request-log', {
    method: 'PUT',
    body: { value: !!enabled },
  })
}

/** PUT openai-compatibility — body is the raw array. */
export async function setOpenaiCompatibility(cfg, entries) {
  if (!cfg.managementKey) throw new Error('CPA management key not configured')
  const list = Array.isArray(entries) ? entries : []
  return cpaFetch(cfg, '/v0/management/openai-compatibility', {
    method: 'PUT',
    body: list,
  })
}

const authFilesCache = createTtlCache(45_000)

/** @deprecated Prefer fetchCpaAuthFiles — CPAMP optional. */
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
  if (f.unavailable || f.unavailable) return 'exhausted'
  const st = String(f.status || '').toLowerCase()
  if (st === 'active' || st === 'ok' || st === 'available' || st === 'ready') return 'available'
  if (st.includes('exhaust') || st.includes('quota') || st.includes('limit') || st === 'unavailable') return 'exhausted'
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
    const recent = Array.isArray(f.recent_requests)
      ? f.recent_requests
      : Array.isArray(f.recent_requests)
        ? f.recent_requests
        : []
    const recentOk = recent.reduce((s, r) => s + (Number(r.success) || 0), 0)
    const recentFail = recent.reduce((s, r) => s + (Number(r.failed) || 0), 0)
    const label = f.label || f.email || f.account || f.name || `account-${i + 1}`
    return {
      name: maskAccountLabel(label),
      provider: String(f.provider || f.type || f.account_type || 'cpa'),
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

/* ─── Wave A: CPA-native field settings / providers / auth / oauth / plugins / logs ─── */

export const CPA_SETTING_FIELDS = [
  'debug',
  'proxy-url',
  'logging-to-file',
  'logs-max-total-size-mb',
  'force-model-prefix',
  'ws-auth',
  'usage-statistics-enabled',
  'request-log',
]

export const CPA_PROVIDER_KEY_TYPES = [
  'gemini-api-key',
  'claude-api-key',
  'codex-api-key',
  'vertex-api-key',
  'xai-api-key',
  'interactions-api-key',
]

export const CPA_OAUTH_AUTH_URLS = [
  'anthropic-auth-url',
  'codex-auth-url',
  'antigravity-auth-url',
  'kimi-auth-url',
  'xai-auth-url',
  'devin-auth-url',
  'qwen-auth-url',
  'iflow-auth-url',
  'gemini-cli-auth-url',
]

function requireMgmt(cfg) {
  if (!cfg.managementKey) throw Object.assign(new Error('CPA management key not configured'), { status: 503 })
}

function unwrapField(data, field) {
  if (data == null) return null
  if (Object.prototype.hasOwnProperty.call(data, field)) return data[field]
  if (Object.prototype.hasOwnProperty.call(data, 'value')) return data.value
  if (Object.prototype.hasOwnProperty.call(data, 'enabled')) return data.enabled
  return data
}

/** GET a CPA management field endpoint → normalized { field, value }. */
export async function fetchCpaSetting(cfg, field) {
  requireMgmt(cfg)
  if (!CPA_SETTING_FIELDS.includes(field)) {
    throw Object.assign(new Error(`unsupported setting: ${field}`), { status: 400 })
  }
  const data = await cpaFetch(cfg, `/v0/management/${field}`)
  return { field, value: unwrapField(data, field) }
}

/** PUT { value } to a CPA field endpoint. */
export async function setCpaSetting(cfg, field, value) {
  requireMgmt(cfg)
  if (!CPA_SETTING_FIELDS.includes(field)) {
    throw Object.assign(new Error(`unsupported setting: ${field}`), { status: 400 })
  }
  await cpaFetch(cfg, `/v0/management/${field}`, {
    method: 'PUT',
    body: { value },
  })
  return fetchCpaSetting(cfg, field)
}

/** Aggregate all basic settings (best-effort per field). */
export async function fetchCpaSettingsAll(cfg) {
  requireMgmt(cfg)
  const settings = {}
  const errors = {}
  await Promise.all(
    CPA_SETTING_FIELDS.map(async (field) => {
      try {
        const row = await fetchCpaSetting(cfg, field)
        settings[field] = row.value
      } catch (err) {
        errors[field] = err?.message || String(err)
      }
    }),
  )
  return { settings, errors }
}

function sanitizeProviderEntries(entries) {
  return (Array.isArray(entries) ? entries : []).map((it, i) => {
    if (typeof it === 'string') {
      return { id: i + 1, 'api-key': maskKey(it), length: it.length, auth_index: null, raw_type: 'string' }
    }
    const key = it?.['api-key'] || it?.api_key || it?.key || ''
    return {
      id: i + 1,
      'api-key': typeof key === 'string' && key ? maskKey(key) : '****',
      length: typeof key === 'string' ? key.length : 0,
      auth_index: it?.['auth-index'] || it?.auth_index || null,
      'base-url': it?.['base-url'] || it?.base_url || '',
      'proxy-url': it?.['proxy-url'] || it?.proxy_url || '',
      models: it?.models ?? null,
    }
  })
}

export async function listCpaProviderKeys(cfg, type) {
  requireMgmt(cfg)
  if (!CPA_PROVIDER_KEY_TYPES.includes(type)) {
    throw Object.assign(new Error(`unsupported provider key type: ${type}`), { status: 400 })
  }
  const data = await cpaFetch(cfg, `/v0/management/${type}`)
  const entries = Array.isArray(data?.[type]) ? data[type] : Array.isArray(data) ? data : []
  return { type, items: sanitizeProviderEntries(entries), count: entries.length, _raw: entries }
}

/** Add one provider key. CPA PUT body is an array of { "api-key": "..." }. */
export async function addCpaProviderKey(cfg, type, apiKey, extra = {}) {
  requireMgmt(cfg)
  if (!CPA_PROVIDER_KEY_TYPES.includes(type)) {
    throw Object.assign(new Error(`unsupported provider key type: ${type}`), { status: 400 })
  }
  const key = String(apiKey || '').trim()
  if (!key) throw Object.assign(new Error('api-key required'), { status: 400 })
  const listed = await listCpaProviderKeys(cfg, type)
  const raw = listed._raw || []
  const exists = raw.some((it) => {
    const k = typeof it === 'string' ? it : it?.['api-key'] || it?.api_key || ''
    return k === key
  })
  if (exists) return listCpaProviderKeys(cfg, type)
  const entry = { 'api-key': key, ...extra }
  const next = [
    ...raw.map((it) => (typeof it === 'string' ? { 'api-key': it } : it)),
    entry,
  ]
  await cpaFetch(cfg, `/v0/management/${type}`, { method: 'PUT', body: next })
  return listCpaProviderKeys(cfg, type)
}

/** Delete by exact api-key query param. */
export async function removeCpaProviderKey(cfg, type, apiKey) {
  requireMgmt(cfg)
  if (!CPA_PROVIDER_KEY_TYPES.includes(type)) {
    throw Object.assign(new Error(`unsupported provider key type: ${type}`), { status: 400 })
  }
  const key = String(apiKey || '').trim()
  if (!key) throw Object.assign(new Error('api-key required'), { status: 400 })
  const url = `${cfg.cpaBaseUrl}/v0/management/${type}?api-key=${encodeURIComponent(key)}`
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${cfg.managementKey}`, Accept: 'application/json' },
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }
  if (!res.ok) {
    const err = new Error(json?.error || json?.message || `CPA DELETE ${type} failed (${res.status})`)
    err.status = res.status
    err.payload = json
    throw err
  }
  return listCpaProviderKeys(cfg, type)
}

/** Match masked key against raw list (same pattern as api-keys). */
export function matchMaskedProviderKey(rawEntries, masked) {
  const m = String(masked || '')
  for (const it of rawEntries || []) {
    const k = typeof it === 'string' ? it : it?.['api-key'] || it?.api_key || ''
    if (!k) continue
    if (maskKey(k) === m || maskSecretLike(k) === m) return k
  }
  return null
}

function maskSecretLike(fullKey) {
  const s = String(fullKey || '')
  if (!s) return ''
  if (s.length <= 8) return '****'
  return `${s.slice(0, 6)}****${s.slice(-4)}`
}

export async function setAuthFileDisabled(cfg, name, disabled) {
  requireMgmt(cfg)
  const n = String(name || '').trim()
  if (!n) throw Object.assign(new Error('name required'), { status: 400 })
  return cpaFetch(cfg, '/v0/management/auth-files/status', {
    method: 'PATCH',
    body: { name: n, disabled: !!disabled },
  })
}

export async function patchAuthFileFields(cfg, name, fields = {}) {
  requireMgmt(cfg)
  const n = String(name || '').trim()
  if (!n) throw Object.assign(new Error('name required'), { status: 400 })
  const body = { name: n, ...fields }
  return cpaFetch(cfg, '/v0/management/auth-files/fields', {
    method: 'PATCH',
    body,
  })
}

export async function refreshAuthFile(cfg, name) {
  requireMgmt(cfg)
  const n = String(name || '').trim()
  if (!n) throw Object.assign(new Error('name required'), { status: 400 })
  return cpaFetch(cfg, '/v0/management/auth-files/refresh', {
    method: 'POST',
    body: { name: n },
  })
}

export async function deleteAuthFile(cfg, name) {
  requireMgmt(cfg)
  const n = String(name || '').trim()
  if (!n) throw Object.assign(new Error('name required'), { status: 400 })
  const url = `${cfg.cpaBaseUrl}/v0/management/auth-files?name=${encodeURIComponent(n)}`
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${cfg.managementKey}`, Accept: 'application/json' },
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }
  if (!res.ok) {
    const err = new Error(json?.error || json?.message || `CPA DELETE auth-files failed (${res.status})`)
    err.status = res.status
    err.payload = json
    throw err
  }
  cpaAuthFilesCache.clear()
  return json
}

/** Download auth file JSON (contains secrets — admin only). */
export async function downloadAuthFile(cfg, name) {
  requireMgmt(cfg)
  const n = String(name || '').trim()
  if (!n) throw Object.assign(new Error('name required'), { status: 400 })
  if (!n.endsWith('.json')) {
    throw Object.assign(new Error('name must end with .json'), { status: 400 })
  }
  return cpaFetch(cfg, `/v0/management/auth-files/download?name=${encodeURIComponent(n)}`)
}

/**
 * Upload auth file via multipart. `file` is { filename, content } where content is string/Buffer.
 * Never POST JSON bodies to /auth-files?name= — that overwrites the credential file.
 */
export async function uploadAuthFile(cfg, { filename, content }) {
  requireMgmt(cfg)
  const name = String(filename || '').trim()
  if (!name || !name.endsWith('.json')) {
    throw Object.assign(new Error('filename must end with .json'), { status: 400 })
  }
  const blob = typeof content === 'string' ? content : Buffer.from(content).toString('utf8')
  // Validate JSON before upload
  try {
    JSON.parse(blob)
  } catch {
    throw Object.assign(new Error('content must be valid JSON'), { status: 400 })
  }
  const form = new FormData()
  form.append('file', new Blob([blob], { type: 'application/json' }), name)
  const res = await fetch(`${cfg.cpaBaseUrl}/v0/management/auth-files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.managementKey}`, Accept: 'application/json' },
    body: form,
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }
  if (!res.ok) {
    const err = new Error(json?.error || json?.message || `CPA upload auth-files failed (${res.status})`)
    err.status = res.status
    err.payload = json
    throw err
  }
  cpaAuthFilesCache.clear()
  return json
}

export async function startCpaOAuth(cfg, authUrlPath) {
  requireMgmt(cfg)
  const path = String(authUrlPath || '').replace(/^\//, '')
  if (!CPA_OAUTH_AUTH_URLS.includes(path)) {
    throw Object.assign(new Error(`unsupported oauth start: ${path}`), { status: 400 })
  }
  try {
    return await cpaFetch(cfg, `/v0/management/${path}`)
  } catch (err) {
    if (err?.status === 404) {
      const e = new Error(`${path} not available on this CPA build`)
      e.status = 404
      e.unavailable = true
      throw e
    }
    throw err
  }
}

export async function getCpaAuthStatus(cfg, state) {
  requireMgmt(cfg)
  const qs = state ? `?state=${encodeURIComponent(state)}` : ''
  return cpaFetch(cfg, `/v0/management/get-auth-status${qs}`)
}

/** Submit remote browser callback. Body: { state, redirect_url }. */
export async function submitCpaOAuthCallback(cfg, { state, redirect_url }) {
  requireMgmt(cfg)
  const st = String(state || '').trim()
  const url = String(redirect_url || '').trim()
  if (!st) throw Object.assign(new Error('state is required'), { status: 400 })
  if (!url) throw Object.assign(new Error('redirect_url is required'), { status: 400 })
  return cpaFetch(cfg, '/v0/management/oauth-callback', {
    method: 'POST',
    body: { state: st, redirect_url: url },
  })
}

export async function fetchOauthModelAlias(cfg) {
  requireMgmt(cfg)
  return cpaFetch(cfg, '/v0/management/oauth-model-alias')
}

export async function setOauthModelAlias(cfg, value) {
  requireMgmt(cfg)
  await cpaFetch(cfg, '/v0/management/oauth-model-alias', {
    method: 'PUT',
    body: value && typeof value === 'object' && !Array.isArray(value) && 'oauth-model-alias' in value
      ? value
      : { 'oauth-model-alias': value ?? {} },
  })
  return fetchOauthModelAlias(cfg)
}

export async function fetchOauthExcludedModels(cfg) {
  requireMgmt(cfg)
  return cpaFetch(cfg, '/v0/management/oauth-excluded-models')
}

export async function setOauthExcludedModels(cfg, value) {
  requireMgmt(cfg)
  const body =
    value && typeof value === 'object' && !Array.isArray(value) && 'oauth-excluded-models' in value
      ? value
      : { 'oauth-excluded-models': value ?? [] }
  await cpaFetch(cfg, '/v0/management/oauth-excluded-models', { method: 'PUT', body })
  return fetchOauthExcludedModels(cfg)
}

export async function fetchCpaPlugins(cfg) {
  requireMgmt(cfg)
  const data = await cpaFetch(cfg, '/v0/management/plugins')
  return {
    plugins_enabled: !!(data?.plugins_enabled ?? data?.enabled),
    plugins_dir: data?.plugins_dir || data?.dir || 'plugins',
    plugins: Array.isArray(data?.plugins) ? data.plugins : [],
    raw: data,
  }
}

/**
 * Attempt plugins PUT. Returns { ok, unavailable } — CPA v7.3.10 returns 404 for PUT.
 */
export async function setCpaPlugins(cfg, { plugins_enabled, plugins_dir } = {}) {
  requireMgmt(cfg)
  const body = {}
  if (plugins_enabled !== undefined) body.plugins_enabled = !!plugins_enabled
  if (plugins_dir !== undefined) body.plugins_dir = String(plugins_dir)
  try {
    await cpaFetch(cfg, '/v0/management/plugins', { method: 'PUT', body })
    return { ...(await fetchCpaPlugins(cfg)), writable: true }
  } catch (err) {
    if (err?.status === 404) {
      return { ...(await fetchCpaPlugins(cfg)), writable: false, unavailable: true }
    }
    throw err
  }
}

export async function fetchCpaLogs(cfg, { limit } = {}) {
  requireMgmt(cfg)
  const qs = limit ? `?limit=${encodeURIComponent(limit)}` : ''
  try {
    return await cpaFetch(cfg, `/v0/management/logs${qs}`)
  } catch (err) {
    if (err?.status === 400) {
      const msg =
        err?.payload?.error ||
        err?.message ||
        'logging to file disabled'
      const e = new Error(
        String(msg).includes('logging')
          ? 'CPA 文件日志未开启：请先在「基础设置」打开 logging-to-file。'
          : String(msg),
      )
      e.status = 400
      e.code = 'logging_to_file_disabled'
      throw e
    }
    throw err
  }
}
