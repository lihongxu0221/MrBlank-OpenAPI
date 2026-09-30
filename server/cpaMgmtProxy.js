/**
 * Admin-only whitelist proxy: MrBlank BFF → CPA management API (/v0/management/*).
 *
 * Serves the 1:1 port of the cpa-manager-plus (CPAMP) AI providers page
 * (src/cpamp/**). The browser never sees the CPA management key: it authenticates with
 * the MrBlank admin session (requireAdmin is applied by the caller when mounting) and this
 * router injects the key server-side.
 *
 * Whitelist (everything else → 404):
 *   GET                  /config                    (filtered to provider sections only)
 *   GET|PUT|PATCH|DELETE /<provider section>        (8 sections, see CPA_MGMT_PROVIDER_SECTIONS)
 *   POST                 /api-call                  (rate-limited, audited, URL policy, size/time limits)
 *   GET                  /api-key-usage
 *
 * Writes are serialized per section (CPAMP does read-modify-write of whole sections; the
 * queue prevents two admins interleaving their GET /config → PUT cycles through this BFF).
 */

export const CPA_MGMT_PROVIDER_SECTIONS = Object.freeze([
  'gemini-api-key',
  'interactions-api-key',
  'codex-api-key',
  'xai-api-key',
  'meta-api-key',
  'claude-api-key',
  'vertex-api-key',
  'openai-compatibility',
])

/** Only these top-level keys of CPA /config are exposed to the browser. */
export const CPA_MGMT_CONFIG_ALLOWED_KEYS = Object.freeze([...CPA_MGMT_PROVIDER_SECTIONS])

const PASSTHROUGH_RESPONSE_HEADERS = [
  'x-cpa-version',
  'x-cpa-commit',
  'x-cpa-build-date',
  'x-server-version',
  'x-server-commit',
  'x-server-build-date',
]

const DEFAULT_LIMITS = Object.freeze({
  requestTimeoutMs: 30_000,
  apiCallTimeoutMs: 60_000,
  maxSectionBodyBytes: 2 * 1024 * 1024,
  maxApiCallBodyBytes: 256 * 1024,
  apiCallPerMinute: 60,
  writesPerMinute: 120,
})

/** Filter a CPA /config payload down to the allowed provider sections. */
export function filterCpaConfigForProviders(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {}
  const out = {}
  for (const key of CPA_MGMT_CONFIG_ALLOWED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(config, key)) out[key] = config[key]
  }
  return out
}

/** Resolve whitelisted route → { kind, section? } or null. */
export function resolveCpaMgmtRoute(method, path) {
  const m = String(method || '').toUpperCase()
  const p = String(path || '').replace(/\/+$/, '') || '/'
  if (p === '/config') return m === 'GET' ? { kind: 'config' } : null
  if (p === '/api-call') return m === 'POST' ? { kind: 'api-call' } : null
  if (p === '/api-key-usage') return m === 'GET' ? { kind: 'api-key-usage' } : null
  const section = p.slice(1)
  if (CPA_MGMT_PROVIDER_SECTIONS.includes(section)) {
    if (['GET', 'PUT', 'PATCH', 'DELETE'].includes(m)) return { kind: 'section', section }
  }
  return null
}

const PRIVATE_V4 = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10/8
  [0x64400000, 10], // 100.64/10 CGNAT
  [0x7f000000, 8], // 127/8
  [0xa9fe0000, 16], // 169.254/16 link-local + metadata
  [0xac100000, 12], // 172.16/12
  [0xc0a80000, 16], // 192.168/16
  [0xc6120000, 15], // 198.18/15 benchmarking
  [0xe0000000, 3], // multicast + reserved
]

function ipv4ToInt(host) {
  const parts = host.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const v = Number(part)
    if (v > 255) return null
    n = n * 256 + v
  }
  return n >>> 0
}

function isPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true
  if (host === 'metadata.google.internal') return true
  const v4 = ipv4ToInt(host)
  if (v4 !== null) {
    return PRIVATE_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
      return ((v4 & mask) >>> 0) === ((base & mask) >>> 0)
    })
  }
  if (host.includes(':')) {
    if (host === '::' || host === '::1') return true
    if (/^f[cd][0-9a-f]{2}:/.test(host)) return true // fc00::/7
    if (/^fe[89ab][0-9a-f]:/.test(host)) return true // fe80::/10
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host)
    if (mapped) return isPrivateHost(mapped[1])
  }
  return false
}

/**
 * Validate a CPAMP /api-call payload. Returns { ok: true, target } or { ok: false, error }.
 * Policy: http(s) only, no loopback / private / link-local literal hosts, no credentials in URL.
 */
export function validateApiCallPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid api-call payload' }
  }
  const rawUrl = String(body.url || '').trim()
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, error: 'api-call url invalid' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: 'api-call url must be http(s)' }
  }
  if (url.username || url.password) return { ok: false, error: 'api-call url must not embed credentials' }
  if (isPrivateHost(url.hostname)) return { ok: false, error: 'api-call target host not allowed' }
  const method = String(body.method || 'GET').toUpperCase()
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) {
    return { ok: false, error: 'api-call method not allowed' }
  }
  const proxy = body.proxy_url ?? body.proxyUrl
  if (proxy !== undefined && proxy !== null && String(proxy).trim()) {
    let p
    try {
      p = new URL(String(proxy).trim())
    } catch {
      return { ok: false, error: 'api-call proxy_url invalid' }
    }
    if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(p.protocol)) {
      return { ok: false, error: 'api-call proxy_url scheme not allowed' }
    }
  }
  return { ok: true, target: `${method} ${url.origin}${url.pathname}` }
}

function createWindowLimiter(perMinute, now) {
  const hits = new Map()
  return (key) => {
    const t = now()
    const arr = (hits.get(key) || []).filter((x) => t - x < 60_000)
    if (arr.length >= perMinute) {
      hits.set(key, arr)
      return false
    }
    arr.push(t)
    hits.set(key, arr)
    return true
  }
}

function defaultAudit(entry) {
  try {
    console.log(`[cpa-mgmt-audit] ${JSON.stringify(entry)}`)
  } catch {
    /* ignore */
  }
}

function userLabel(req) {
  const u = req.auth?.user || {}
  return String(u.id ?? u.username ?? 'unknown')
}

/**
 * @param {object} opts
 * @param {{ cpaBaseUrl: string, managementKey: string }} opts.cpaCfg
 * @param {import('express')} opts.express  express module (for Router)
 * @param {(entry: object) => void} [opts.audit]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {() => number} [opts.now]
 * @param {Partial<typeof DEFAULT_LIMITS>} [opts.limits]
 */
export function createCpaMgmtRouter({ cpaCfg, express, audit = defaultAudit, fetchImpl, now = Date.now, limits = {} }) {
  const L = { ...DEFAULT_LIMITS, ...limits }
  const doFetch = fetchImpl || ((...args) => fetch(...args))
  const router = express.Router()
  const queues = new Map()
  const apiCallLimiter = createWindowLimiter(L.apiCallPerMinute, now)
  const writeLimiter = createWindowLimiter(L.writesPerMinute, now)

  const enqueue = (key, task) => {
    const prev = queues.get(key) || Promise.resolve()
    const run = prev.then(task, task)
    queues.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    )
    return run
  }

  async function callCpa({ method, path, search, body, timeoutMs }) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const headers = { Accept: 'application/json', Authorization: `Bearer ${cpaCfg.managementKey}` }
      if (body !== undefined) headers['Content-Type'] = 'application/json'
      const res = await doFetch(`${cpaCfg.cpaBaseUrl}/v0/management${path}${search || ''}`, {
        method,
        headers,
        body: body !== undefined ? body : undefined,
        signal: ctrl.signal,
      })
      const text = await res.text()
      let json
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        json = undefined
      }
      const passHeaders = {}
      for (const h of PASSTHROUGH_RESPONSE_HEADERS) {
        const v = res.headers?.get?.(h)
        if (v) passHeaders[h] = v
      }
      return { status: res.status, json, text, headers: passHeaders }
    } finally {
      clearTimeout(timer)
    }
  }

  router.all('*', async (req, res) => {
    const started = now()
    const method = req.method.toUpperCase()
    const route = resolveCpaMgmtRoute(method, req.path)
    if (!route) {
      res.status(404).json({ error: 'not allowed' })
      return
    }
    if (!cpaCfg?.managementKey) {
      res.status(503).json({ error: 'CPA Management Key 未配置' })
      return
    }

    const user = userLabel(req)
    const isWrite = method !== 'GET'
    const qIndex = req.originalUrl.indexOf('?')
    const search = qIndex >= 0 ? req.originalUrl.slice(qIndex) : ''

    let body
    let auditTarget = route.section || route.kind
    if (method === 'PUT' || method === 'PATCH' || method === 'POST') {
      body = JSON.stringify(req.body === undefined ? null : req.body)
      const max = route.kind === 'api-call' ? L.maxApiCallBodyBytes : L.maxSectionBodyBytes
      if (Buffer.byteLength(body, 'utf8') > max) {
        res.status(413).json({ error: 'payload too large' })
        return
      }
    }

    if (route.kind === 'api-call') {
      const check = validateApiCallPayload(req.body)
      if (!check.ok) {
        audit({ at: new Date(started).toISOString(), user, method, path: req.path, target: null, status: 400, error: check.error })
        res.status(400).json({ error: check.error })
        return
      }
      auditTarget = check.target
      if (!apiCallLimiter(user)) {
        res.status(429).json({ error: 'api-call rate limit exceeded' })
        return
      }
    } else if (isWrite && !writeLimiter(user)) {
      res.status(429).json({ error: 'write rate limit exceeded' })
      return
    }

    const timeoutMs = route.kind === 'api-call' ? L.apiCallTimeoutMs : L.requestTimeoutMs
    const exec = () => callCpa({ method, path: req.path.replace(/\/+$/, ''), search, body, timeoutMs })

    let result
    try {
      result =
        route.kind === 'section' && isWrite ? await enqueue(route.section, exec) : await exec()
    } catch (err) {
      const aborted = err?.name === 'AbortError'
      if (isWrite || route.kind === 'api-call') {
        audit({ at: new Date(started).toISOString(), user, method, path: req.path, target: auditTarget, status: aborted ? 504 : 502, ms: now() - started })
      }
      res.status(aborted ? 504 : 502).json({ error: aborted ? 'CPA request timed out' : 'CPA unreachable' })
      return
    }

    if (isWrite || route.kind === 'api-call') {
      const entry = { at: new Date(started).toISOString(), user, method, path: req.path, target: auditTarget, status: result.status, ms: now() - started }
      if (route.kind === 'api-call' && result.json && typeof result.json === 'object') {
        const sc = result.json.status_code ?? result.json.statusCode
        if (sc !== undefined) entry.upstreamStatus = sc
      }
      audit(entry)
    }

    for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v)
    res.setHeader('Cache-Control', 'no-store')
    if (route.kind === 'config' && result.status >= 200 && result.status < 300) {
      res.status(result.status).json(filterCpaConfigForProviders(result.json))
      return
    }
    if (result.json !== undefined) {
      res.status(result.status).json(result.json)
    } else {
      res.status(result.status).type('text/plain').send(result.text || '')
    }
  })

  return router
}
