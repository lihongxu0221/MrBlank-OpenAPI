/**
 * Pure helpers for credential detail 「模型」tab — normalize CPA auth-files/models
 * shapes and compute per-credential excluded_models disable sets / filter counts.
 */

/** @typedef {{ id: string, name?: string, provider?: string }} CredModel */

/**
 * Parse excluded_models from CPA auth-file fields (array, CSV string, or nested).
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseExcludedModels(raw) {
  if (raw == null || raw === '') return []
  if (Array.isArray(raw)) {
    return dedupeStrings(raw.map((x) => String(x ?? '').trim()).filter(Boolean))
  }
  if (typeof raw === 'string') {
    return dedupeStrings(
      raw
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    )
  }
  if (typeof raw === 'object') {
    const o = /** @type {Record<string, unknown>} */ (raw)
    const nested =
      o.excluded_models ?? o['excluded-models'] ?? o.excludedModels ?? o.models ?? o.items
    if (nested != null && nested !== raw) return parseExcludedModels(nested)
  }
  return []
}

/**
 * Normalize various CPA /auth-files/models response shapes into { id, name?, provider? }[].
 * @param {unknown} raw
 * @returns {CredModel[]}
 */
export function normalizeAuthFileModels(raw) {
  const list = extractModelsArray(raw)
  const seen = new Set()
  /** @type {CredModel[]} */
  const out = []
  for (const item of list) {
    const m = coerceModel(item)
    if (!m) continue
    const key = m.id.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(m)
  }
  return out
}

/**
 * @param {string} modelId
 * @param {Iterable<string>} excludedRules
 * @returns {boolean}
 */
export function isModelExcluded(modelId, excludedRules) {
  const id = String(modelId || '').trim()
  if (!id) return false
  const idLower = id.toLowerCase()
  for (const rule of excludedRules || []) {
    const r = String(rule || '').trim()
    if (!r) continue
    if (r === id || r.toLowerCase() === idLower) return true
    if (r.includes('*') && wildcardMatch(r.toLowerCase(), idLower)) return true
  }
  return false
}

/**
 * @param {CredModel[]} models
 * @param {Iterable<string>} excludedRules
 */
export function computeModelFilterCounts(models, excludedRules) {
  const rules = [...(excludedRules || [])]
  let available = 0
  let disabled = 0
  for (const m of models || []) {
    if (isModelExcluded(m.id, rules)) disabled += 1
    else available += 1
  }
  return {
    all: (models || []).length,
    available,
    disabled,
  }
}

/**
 * Toggle a model id in the draft excluded list (exact id only; does not expand wildcards).
 * @param {string[]} draft
 * @param {string} modelId
 * @param {boolean} disable
 * @returns {string[]}
 */
export function toggleExcludedModel(draft, modelId, disable) {
  const id = String(modelId || '').trim()
  if (!id) return parseExcludedModels(draft)
  const cur = parseExcludedModels(draft)
  const lower = id.toLowerCase()
  const without = cur.filter((x) => x.toLowerCase() !== lower)
  if (disable) without.push(id)
  return dedupeStrings(without)
}

/**
 * @param {string[]} a
 * @param {string[]} b
 */
export function excludedListsEqual(a, b) {
  const aa = [...parseExcludedModels(a)].map((x) => x.toLowerCase()).sort()
  const bb = [...parseExcludedModels(b)].map((x) => x.toLowerCase()).sort()
  if (aa.length !== bb.length) return false
  return aa.every((v, i) => v === bb[i])
}

function dedupeStrings(arr) {
  const seen = new Set()
  const out = []
  for (const s of arr) {
    const k = s.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out
}

function extractModelsArray(raw) {
  if (raw == null) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'object') return []
  const o = /** @type {Record<string, unknown>} */ (raw)
  for (const key of ['models', 'data', 'items', 'files', 'result']) {
    const v = o[key]
    if (Array.isArray(v)) return v
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = /** @type {Record<string, unknown>} */ (v)
      for (const k2 of ['models', 'data', 'items']) {
        if (Array.isArray(nested[k2])) return nested[k2]
      }
    }
  }
  return []
}

/**
 * @param {unknown} item
 * @returns {CredModel | null}
 */
function coerceModel(item) {
  if (item == null) return null
  if (typeof item === 'string') {
    const id = item.trim()
    return id ? { id } : null
  }
  if (typeof item !== 'object' || Array.isArray(item)) return null
  const r = /** @type {Record<string, unknown>} */ (item)
  const idRaw =
    r.id ?? r.model ?? r.name ?? r.model_id ?? r.modelId ?? r.model_name ?? r.modelName
  const id = String(idRaw ?? '').trim()
  if (!id) return null
  /** @type {CredModel} */
  const out = { id }
  const display =
    r.display_name ?? r.displayName ?? r.title ?? (typeof r.name === 'string' && r.name !== id ? r.name : null)
  if (typeof display === 'string' && display.trim()) out.name = display.trim()
  const provider =
    r.provider ?? r.owned_by ?? r.ownedBy ?? r.type ?? r.platform ?? r.vendor
  if (typeof provider === 'string' && provider.trim()) out.provider = provider.trim()
  return out
}

/** Simple glob: * matches any run of chars (case-insensitive inputs expected). */
function wildcardMatch(pattern, value) {
  const parts = pattern.split('*').map(escapeRegex)
  const re = new RegExp(`^${parts.join('.*')}$`, 'i')
  return re.test(value)
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
