/**
 * Official / aggregate model price sync.
 * Sources (fill missing only, in order): models.dev → LiteLLM → OpenRouter.
 * Prices normalized to USD per million tokens, including cache read/write when available.
 *
 * Primary public sources chosen for coverage + cache fields:
 * - models.dev API (cost.input/output/cache_read/cache_write already $/MTok)
 * - LiteLLM model_prices_and_context_window.json (per-token → ×1e6)
 * - OpenRouter /api/v1/models (pricing.prompt/completion/input_cache_*)
 */
const FETCH_TIMEOUT_MS = 12_000

const SOURCES = {
  'models.dev': 'https://models.dev/api.json',
  litellm:
    'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
  openrouter: 'https://openrouter.ai/api/v1/models',
}

async function fetchJson(url, { timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'MrBlank-OpenAPI-price-sync/1.0' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

/**
 * @param {Map<string, object>} map
 * @param {string} model
 * @param {number|string|null|undefined} input
 * @param {number|string|null|undefined} output
 * @param {string} source
 * @param {{ cacheRead?: number|string|null, cacheWrite?: number|string|null }} [cache]
 */
function pushPrice(map, model, input, output, source, cache = {}) {
  const id = String(model || '').trim()
  if (!id) return
  if (map.has(id)) return // earlier source wins
  const inp = Number(input)
  const out = Number(output)
  if (!Number.isFinite(inp) || !Number.isFinite(out)) return
  if (inp < 0 || out < 0) return
  const cacheRead = cache.cacheRead != null && cache.cacheRead !== '' ? Number(cache.cacheRead) : null
  const cacheWrite =
    cache.cacheWrite != null && cache.cacheWrite !== '' ? Number(cache.cacheWrite) : null
  const row = {
    model: id,
    input_per_mtok: inp,
    output_per_mtok: out,
    currency: 'USD',
    note: `synced:${source}`,
    manual: false,
    source,
    updated_at: new Date().toISOString(),
  }
  if (cacheRead != null && Number.isFinite(cacheRead) && cacheRead >= 0) {
    row.cache_read_per_mtok = cacheRead
  }
  if (cacheWrite != null && Number.isFinite(cacheWrite) && cacheWrite >= 0) {
    row.cache_write_per_mtok = cacheWrite
  }
  map.set(id, row)
}

/** models.dev: cost already $/MTok; optional cache_read / cache_write */
function parseModelsDev(json) {
  const map = new Map()
  if (!json || typeof json !== 'object') return map
  for (const [provider, pdata] of Object.entries(json)) {
    if (!pdata || typeof pdata !== 'object') continue
    const models = pdata.models && typeof pdata.models === 'object' ? pdata.models : null
    if (!models) continue
    for (const [mid, m] of Object.entries(models)) {
      const cost = m?.cost
      if (!cost || typeof cost !== 'object') continue
      const input = cost.input
      const output = cost.output
      if (input == null || output == null) continue
      const bare = String(m.id || mid).trim()
      const cache = { cacheRead: cost.cache_read, cacheWrite: cost.cache_write }
      pushPrice(map, bare, input, output, 'models.dev', cache)
      if (provider && bare && !bare.includes('/')) {
        pushPrice(map, `${provider}/${bare}`, input, output, 'models.dev', cache)
      }
    }
  }
  return map
}

/** LiteLLM: per-token USD → convert to per MTok */
function parseLitellm(json) {
  const map = new Map()
  if (!json || typeof json !== 'object') return map
  for (const [key, row] of Object.entries(json)) {
    if (!row || typeof row !== 'object') continue
    if (key === 'sample_spec') continue
    const inpTok = row.input_cost_per_token
    const outTok = row.output_cost_per_token
    if (inpTok == null || outTok == null) continue
    const input = Number(inpTok) * 1_000_000
    const output = Number(outTok) * 1_000_000
    const cacheReadTok =
      row.cache_read_input_token_cost ?? row.input_cost_per_token_cache_hit ?? null
    const cacheWriteTok = row.cache_creation_input_token_cost ?? null
    const cache = {
      cacheRead: cacheReadTok != null ? Number(cacheReadTok) * 1_000_000 : null,
      cacheWrite: cacheWriteTok != null ? Number(cacheWriteTok) * 1_000_000 : null,
    }
    pushPrice(map, key, input, output, 'litellm', cache)
    const slash = key.indexOf('/')
    if (slash > 0) {
      pushPrice(map, key.slice(slash + 1), input, output, 'litellm', cache)
    }
  }
  return map
}

/** OpenRouter: pricing.* are USD per token (string) */
function parseOpenRouter(json) {
  const map = new Map()
  const list = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : []
  for (const m of list) {
    const id = String(m?.id || '').trim()
    if (!id) continue
    const prompt = m?.pricing?.prompt
    const completion = m?.pricing?.completion
    if (prompt == null || completion == null) continue
    const input = Number(prompt) * 1_000_000
    const output = Number(completion) * 1_000_000
    const cacheReadRaw = m?.pricing?.input_cache_read
    const cacheWriteRaw = m?.pricing?.input_cache_write ?? m?.pricing?.input_cache_write_1h
    const cache = {
      cacheRead: cacheReadRaw != null ? Number(cacheReadRaw) * 1_000_000 : null,
      cacheWrite: cacheWriteRaw != null ? Number(cacheWriteRaw) * 1_000_000 : null,
    }
    pushPrice(map, id, input, output, 'openrouter', cache)
    const slash = id.indexOf('/')
    if (slash > 0) {
      pushPrice(map, id.slice(slash + 1), input, output, 'openrouter', cache)
    }
  }
  return map
}

/**
 * Fetch all sources; merge with priority models.dev > litellm > openrouter (first wins).
 * @returns {Promise<{ prices: object[], sources: Record<string, object>, failed_sources: string[] }>}
 */
export async function fetchOfficialPrices() {
  const failed_sources = []
  const sources = {}
  const parsers = [
    ['models.dev', SOURCES['models.dev'], parseModelsDev],
    ['litellm', SOURCES.litellm, parseLitellm],
    ['openrouter', SOURCES.openrouter, parseOpenRouter],
  ]

  const settled = await Promise.all(
    parsers.map(async ([name, url, parse]) => {
      try {
        const raw = await fetchJson(url)
        const map = parse(raw)
        return { name, ok: true, map, count: map.size }
      } catch (err) {
        return { name, ok: false, map: new Map(), count: 0, error: err?.message || String(err) }
      }
    }),
  )

  const merged = new Map()
  for (const s of settled) {
    sources[s.name] = s.ok
      ? { ok: true, count: s.count }
      : { ok: false, count: 0, error: s.error || 'fetch failed' }
    if (!s.ok) {
      failed_sources.push(s.name)
      continue
    }
    for (const [id, price] of s.map) {
      if (!merged.has(id)) merged.set(id, price)
    }
  }

  return {
    prices: [...merged.values()],
    sources,
    failed_sources,
  }
}

export { SOURCES, FETCH_TIMEOUT_MS, parseModelsDev, parseLitellm, parseOpenRouter }
