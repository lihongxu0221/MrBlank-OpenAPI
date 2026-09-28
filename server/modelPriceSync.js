/**
 * Official / aggregate model price sync (P0-B).
 * Sources (fill missing only, in order): models.dev → LiteLLM → OpenRouter.
 * Prices normalized to USD per million tokens.
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

function pushPrice(map, model, input, output, source) {
  const id = String(model || '').trim()
  if (!id) return
  if (map.has(id)) return // earlier source wins
  const inp = Number(input)
  const out = Number(output)
  if (!Number.isFinite(inp) || !Number.isFinite(out)) return
  if (inp < 0 || out < 0) return
  // skip zero/zero noise unless both are explicitly 0 and we still want them — keep zeros
  map.set(id, {
    model: id,
    input_per_mtok: inp,
    output_per_mtok: out,
    currency: 'USD',
    note: `synced:${source}`,
    manual: false,
    source,
  })
}

/** models.dev: { provider: { models: { id: { cost: { input, output } } } } } — cost already $/MTok */
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
      pushPrice(map, bare, input, output, 'models.dev')
      // also provider/id for disambiguation when helpful
      if (provider && bare && !bare.includes('/')) {
        pushPrice(map, `${provider}/${bare}`, input, output, 'models.dev')
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
    pushPrice(map, key, input, output, 'litellm')
    // if key is provider/model, also register bare model when free
    const slash = key.indexOf('/')
    if (slash > 0) {
      const bare = key.slice(slash + 1)
      pushPrice(map, bare, input, output, 'litellm')
    }
  }
  return map
}

/** OpenRouter: pricing.prompt/completion are USD per token (string) */
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
    pushPrice(map, id, input, output, 'openrouter')
    const slash = id.indexOf('/')
    if (slash > 0) {
      pushPrice(map, id.slice(slash + 1), input, output, 'openrouter')
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

  // Merge in priority order (array order = priority)
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

export { SOURCES, FETCH_TIMEOUT_MS }
