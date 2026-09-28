/**
 * Variant price inheritance for supported models missing aggregator list prices.
 * Applied after supported-set sync so each sync refreshes derived rates.
 *
 * Audit source strings:
 *   inherit:gemini-3.8-flash
 *   inherit:grok-4.7*2
 *   inherit:gpt-5.6-terra          (GPT-5.6 地球 = Terra / Earth official OpenAI list)
 *   inherit:claude-opus-4-6
 *   inherit:glm-5.3
 *   inherit:max(glm-5.3-flash,deepseek-v4.1-flash)
 */

/** @typedef {{ input_per_mtok: number, output_per_mtok: number, cache_read_per_mtok?: number|null, cache_write_per_mtok?: number|null, currency?: string }} RateFields */

/**
 * @typedef {{
 *   target: string,
 *   bases: string[],
 *   mode: 'copy' | 'multiply' | 'max',
 *   factor?: number,
 *   sourceLabel?: string,
 *   note?: string,
 * }} InheritanceRule
 */

/** @type {InheritanceRule[]} */
export const VARIANT_INHERITANCE = [
  {
    target: 'gemini-3.8-flash-high',
    bases: ['gemini-3.8-flash', 'google/gemini-3.8-flash'],
    mode: 'copy',
    note: '1:1 copy of gemini-3.8-flash',
  },
  {
    target: 'grok-4.7-build-fast',
    bases: ['grok-4.7', 'xai/grok-4.7'],
    mode: 'multiply',
    factor: 2,
    note: 'double all rates of grok-4.7',
  },
  {
    // 「gpt 5.6 地球费率」= GPT-5.6 Terra (Earth). Official OpenAI short-context list:
    // $2 / $12 / $0.20 cache_read / $2.50 cache_write per MTok (not Sol/Luna).
    target: 'gpt-oss-120b-medium',
    bases: [
      'gpt-5.6-terra',
      'openai/gpt-5.6-terra',
      'gpt-terra-latest',
      'openai/gpt-terra-latest',
      '~openai/gpt-terra-latest',
    ],
    mode: 'copy',
    sourceLabel: 'gpt-5.6-terra',
    note: 'GPT-5.6 Earth/Terra official list (gpt-5.6-terra), not Sol/Luna',
  },
  {
    target: 'claude-opus-4-6-thinking',
    bases: [
      'claude-opus-4-6',
      'opus-4.6',
      'claude-opus-4.6',
      'anthropic/claude-opus-4-6',
      'anthropic/claude-opus-4.6',
    ],
    mode: 'copy',
    note: 'same as opus-4.6 / claude-opus-4-6',
  },
  {
    target: 'auto-max',
    bases: ['glm-5.3', 'zhipuai/glm-5.3', 'zai-org/GLM-5.3'],
    mode: 'copy',
    sourceLabel: 'glm-5.3',
    note: 'same as glm-5.3',
  },
  {
    target: 'auto-fast',
    bases: [
      'glm-5.3-flash',
      'deepseek-v4.1-flash',
      'zhipuai/glm-5.3-flash',
      'zai-org/GLM-5.3-Flash',
      'deepseek/deepseek-v4.1-flash',
      'deepseek-ai/DeepSeek-V4.1-Flash',
    ],
    mode: 'max',
    // Prefer the two canonical bare ids for the audit label; resolution may use alternates.
    sourceLabel: 'max(glm-5.3-flash,deepseek-v4.1-flash)',
    note: 'per-field max of glm-5.3-flash and deepseek-v4.1-flash',
  },
]

const RATE_KEYS = /** @type {const} */ ([
  'input_per_mtok',
  'output_per_mtok',
  'cache_read_per_mtok',
  'cache_write_per_mtok',
])

/**
 * Build case-insensitive + bare-suffix lookup over price rows / map entries.
 * @param {Iterable<object>|Map<string, object>} rows
 * @returns {Map<string, object>} lowercased key → row
 */
export function buildPriceLookup(rows) {
  const lookup = new Map()
  const add = (key, row) => {
    const k = String(key || '').trim()
    if (!k || !row) return
    const lower = k.toLowerCase()
    if (!lookup.has(lower)) lookup.set(lower, row)
    const slash = k.lastIndexOf('/')
    if (slash > 0) {
      const bare = k.slice(slash + 1)
      const bl = bare.toLowerCase()
      if (bare && !lookup.has(bl)) lookup.set(bl, row)
    }
    // strip leading ~ (OpenRouter style)
    if (k.startsWith('~')) {
      const stripped = k.slice(1)
      if (!lookup.has(stripped.toLowerCase())) lookup.set(stripped.toLowerCase(), row)
    }
  }
  if (rows instanceof Map) {
    for (const [k, v] of rows) add(k, v)
  } else {
    for (const row of rows || []) {
      if (row?.model) add(row.model, row)
    }
  }
  return lookup
}

/**
 * @param {Map<string, object>} lookup
 * @param {string[]} candidates
 * @returns {{ row: object, matchedId: string } | null}
 */
export function resolveBasePrice(lookup, candidates) {
  for (const id of candidates || []) {
    const key = String(id || '').trim()
    if (!key) continue
    const row = lookup.get(key.toLowerCase())
    if (row && Number.isFinite(Number(row.input_per_mtok)) && Number.isFinite(Number(row.output_per_mtok))) {
      return { row, matchedId: key }
    }
  }
  return null
}

/**
 * @param {object} row
 * @returns {RateFields}
 */
export function extractRates(row) {
  /** @type {RateFields} */
  const out = {
    input_per_mtok: Number(row.input_per_mtok) || 0,
    output_per_mtok: Number(row.output_per_mtok) || 0,
    currency: String(row.currency || 'USD'),
  }
  if (row.cache_read_per_mtok != null && Number.isFinite(Number(row.cache_read_per_mtok))) {
    out.cache_read_per_mtok = Number(row.cache_read_per_mtok)
  }
  if (row.cache_write_per_mtok != null && Number.isFinite(Number(row.cache_write_per_mtok))) {
    out.cache_write_per_mtok = Number(row.cache_write_per_mtok)
  }
  return out
}

/**
 * @param {RateFields} rates
 * @param {number} factor
 */
export function multiplyRates(rates, factor) {
  const f = Number(factor)
  if (!Number.isFinite(f) || f <= 0) return { ...rates }
  /** @type {RateFields} */
  const out = {
    input_per_mtok: rates.input_per_mtok * f,
    output_per_mtok: rates.output_per_mtok * f,
    currency: rates.currency || 'USD',
  }
  if (rates.cache_read_per_mtok != null) out.cache_read_per_mtok = rates.cache_read_per_mtok * f
  if (rates.cache_write_per_mtok != null) out.cache_write_per_mtok = rates.cache_write_per_mtok * f
  return out
}

/**
 * Per-field max across rate objects (ignore missing/null fields).
 * @param {RateFields[]} rateList
 * @returns {RateFields|null}
 */
export function maxRates(rateList) {
  const list = (rateList || []).filter(Boolean)
  if (!list.length) return null
  /** @type {RateFields} */
  const out = {
    input_per_mtok: Math.max(...list.map((r) => Number(r.input_per_mtok) || 0)),
    output_per_mtok: Math.max(...list.map((r) => Number(r.output_per_mtok) || 0)),
    currency: list[0].currency || 'USD',
  }
  const reads = list
    .map((r) => r.cache_read_per_mtok)
    .filter((v) => v != null && Number.isFinite(Number(v)))
    .map(Number)
  if (reads.length) out.cache_read_per_mtok = Math.max(...reads)
  const writes = list
    .map((r) => r.cache_write_per_mtok)
    .filter((v) => v != null && Number.isFinite(Number(v)))
    .map(Number)
  if (writes.length) out.cache_write_per_mtok = Math.max(...writes)
  return out
}

/**
 * Build audit source string for a rule + resolved base id(s).
 * @param {InheritanceRule} rule
 * @param {string[]} matchedBases
 */
export function inheritanceSource(rule, matchedBases) {
  if (rule.sourceLabel) return `inherit:${rule.sourceLabel}`
  if (rule.mode === 'multiply') {
    const base = matchedBases[0] || rule.bases[0] || 'unknown'
    const bare = base.includes('/') ? base.slice(base.lastIndexOf('/') + 1) : base
    return `inherit:${bare}*${rule.factor ?? 2}`
  }
  if (rule.mode === 'max') {
    const names = (matchedBases.length ? matchedBases : rule.bases)
      .map((b) => (b.includes('/') ? b.slice(b.lastIndexOf('/') + 1) : b))
    return `inherit:max(${names.join(',')})`
  }
  const base = matchedBases[0] || rule.bases[0] || 'unknown'
  const bare = base.includes('/') ? base.slice(base.lastIndexOf('/') + 1) : base
  return `inherit:${bare}`
}

/**
 * For max-mode rules that need multiple peers: resolve the preferred peer set.
 * Uses first N unique "logical" bases from rule.bases that successfully resolve,
 * preferring the declared order. For auto-fast we want glm-5.3-flash + deepseek-v4.1-flash.
 *
 * @param {Map<string, object>} lookup
 * @param {InheritanceRule} rule
 * @returns {{ rates: RateFields[], matched: string[] } | null}
 */
function resolveAllForMax(lookup, rule) {
  /** Logical peer keys (first two non-provider entries in bases, or all until 2 resolved). */
  const preferredLogical = []
  for (const b of rule.bases) {
    const bare = b.includes('/') ? b.slice(b.lastIndexOf('/') + 1) : b
    const norm = bare.toLowerCase()
    if (!preferredLogical.includes(norm)) preferredLogical.push(norm)
    if (preferredLogical.length >= 2) break
  }
  const rates = []
  const matched = []
  const tried = new Set()
  for (const logical of preferredLogical) {
    // Collect candidates for this logical name: exact + any bases that bare-match it
    const candidates = rule.bases.filter((b) => {
      const bare = (b.includes('/') ? b.slice(b.lastIndexOf('/') + 1) : b).toLowerCase()
      return bare === logical
    })
    // Also try the logical bare itself
    if (!candidates.includes(logical)) candidates.unshift(logical)
    const hit = resolveBasePrice(lookup, candidates)
    if (!hit) continue
    const key = String(hit.row.model || hit.matchedId).toLowerCase()
    if (tried.has(key)) continue
    tried.add(key)
    rates.push(extractRates(hit.row))
    matched.push(hit.matchedId)
  }
  if (!rates.length) return null
  return { rates, matched }
}

/**
 * Apply variant inheritance into byModel (mutates).
 *
 * Lookup order for bases: existing book (byModel) then full fetched universe.
 * Manual targets are never overwritten.
 *
 * @param {Map<string, object>} byModel
 * @param {{
 *   supported: Set<string>,
 *   fetchedPrices?: object[],
 *   isProtectedManual?: (p: object) => boolean,
 *   attachQuotaFields?: (row: object, unit?: number) => object,
 *   unit?: number,
 *   now?: string,
 *   rules?: InheritanceRule[],
 * }} opts
 * @returns {{
 *   inherited: object[],
 *   inheritance_missed: object[],
 *   inherited_count: number,
 *   inheritance_missed_count: number,
 * }}
 */
export function applyVariantInheritance(byModel, opts = {}) {
  const supported = opts.supported instanceof Set ? opts.supported : new Set(opts.supported || [])
  const isProtected =
    typeof opts.isProtectedManual === 'function' ? opts.isProtectedManual : () => false
  const attach =
    typeof opts.attachQuotaFields === 'function' ? opts.attachQuotaFields : (r) => r
  const unit = opts.unit
  const now = opts.now || new Date().toISOString()
  const rules = Array.isArray(opts.rules) ? opts.rules : VARIANT_INHERITANCE

  const bookLookup = buildPriceLookup(byModel)
  const fetchedLookup = buildPriceLookup(opts.fetchedPrices || [])
  // Prefer book rates (already filtered/synced) then universe
  const mergedLookup = new Map([...fetchedLookup, ...bookLookup])

  const inherited = []
  const inheritance_missed = []

  for (const rule of rules) {
    const target = String(rule.target || '').trim()
    if (!target) continue
    if (supported.size && !supported.has(target)) continue

    const prev = byModel.get(target)
    if (prev && isProtected(prev)) {
      inheritance_missed.push({
        target,
        reason: 'manual_protected',
        tried: rule.bases.slice(),
      })
      continue
    }

    let rates = null
    /** @type {string[]} */
    let matched = []

    if (rule.mode === 'max') {
      const multi = resolveAllForMax(mergedLookup, rule)
      if (!multi) {
        inheritance_missed.push({ target, reason: 'base_missing', tried: rule.bases.slice() })
        continue
      }
      rates = maxRates(multi.rates)
      matched = multi.matched
      // Prefer having both peers when declared; still apply if only one found (never undercharge vs that one)
      if (!rates) {
        inheritance_missed.push({ target, reason: 'base_missing', tried: rule.bases.slice() })
        continue
      }
    } else {
      const hit = resolveBasePrice(mergedLookup, rule.bases)
      if (!hit) {
        inheritance_missed.push({ target, reason: 'base_missing', tried: rule.bases.slice() })
        continue
      }
      matched = [hit.matchedId]
      rates = extractRates(hit.row)
      if (rule.mode === 'multiply') {
        rates = multiplyRates(rates, rule.factor ?? 2)
      }
    }

    const source = inheritanceSource(rule, matched)
    /** @type {object} */
    const next = {
      model: target,
      input_per_mtok: rates.input_per_mtok,
      output_per_mtok: rates.output_per_mtok,
      currency: rates.currency || 'USD',
      note: rule.note || `inherited from ${matched.join('+')}`,
      manual: false,
      source,
      updated_at: now,
      stale: false,
    }
    if (rates.cache_read_per_mtok != null) next.cache_read_per_mtok = rates.cache_read_per_mtok
    if (rates.cache_write_per_mtok != null) next.cache_write_per_mtok = rates.cache_write_per_mtok
    attach(next, unit)
    byModel.set(target, next)
    inherited.push({
      target,
      source,
      bases_matched: matched,
      input_per_mtok: next.input_per_mtok,
      output_per_mtok: next.output_per_mtok,
      cache_read_per_mtok: next.cache_read_per_mtok ?? null,
      cache_write_per_mtok: next.cache_write_per_mtok ?? null,
    })
  }

  return {
    inherited,
    inheritance_missed,
    inherited_count: inherited.length,
    inheritance_missed_count: inheritance_missed.length,
  }
}

export { RATE_KEYS }
