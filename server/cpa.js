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
