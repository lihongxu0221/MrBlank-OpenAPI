/**
 * Merge CPA OpenAI-style /v1/models body with site Aily public models (aily/{id}).
 * Same rules as plaza GET /api/token/options and price-book resolveSupportedModels:
 *  - only when aily routing (whitelist/mappings) or AILY_MODEL_ROUTES is enabled
 *  - public ids always aily/{name}; never overwrite CPA bare ids
 */
import {
  exposedModelNames,
  publicModelList,
  stripAilyPrefix,
  isAilyPrefixed,
} from './ailyModelRouting.js'

/**
 * Pure merge of OpenAI { object, data: [{ id, ... }] } lists.
 * @param {unknown[]} cpaData
 * @param {unknown[]} ailyData  already public-prefixed rows
 */
export function mergeOpenAiModelData(cpaData, ailyData) {
  const byId = new Map()
  for (const m of cpaData || []) {
    const id = String(m?.id || m?.name || '').trim()
    if (id) byId.set(id, m)
  }
  for (const m of ailyData || []) {
    const id = String(m?.id || m?.name || '').trim()
    if (!id || byId.has(id)) continue
    byId.set(id, m)
  }
  return [...byId.values()]
}

/**
 * Merge aily rows into an OpenAI models list JSON string. Returns original on parse failure.
 * @param {string} bodyText
 * @param {Array<{ id: string, object?: string, owned_by?: string, name?: string }>} ailyRows
 */
export function mergeAilyIntoModelsBody(bodyText, ailyRows) {
  if (!ailyRows?.length) return bodyText
  try {
    const obj = bodyText ? JSON.parse(bodyText) : { object: 'list', data: [] }
    if (obj && typeof obj === 'object' && !Array.isArray(obj.data)) {
      // Non-list error / unexpected — do not mutate
      if (obj.error || obj.data == null) return bodyText || JSON.stringify({ object: 'list', data: ailyRows })
    }
    const cpaData = Array.isArray(obj?.data) ? obj.data : []
    const data = mergeOpenAiModelData(cpaData, ailyRows)
    return JSON.stringify({
      ...(obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {}),
      object: 'list',
      data,
    })
  } catch {
    return bodyText
  }
}

/**
 * Build OpenAI-style aily public model rows when routing/env enables Aily.
 * Mirrors plaza merge in server/index.js GET /api/token/options.
 *
 * @param {object} deps
 * @param {() => object} deps.getRouting  ailyModelRouting.get()
 * @param {() => string[]} [deps.getEnvRoutes] AILY_MODEL_ROUTES patterns
 * @param {(model: string) => boolean} [deps.envModelMatches]
 * @param {() => Promise<{ ok?: boolean, data?: any[], models?: string[] }>} deps.listAilyModels
 */
export async function collectAilyPublicModelRows(deps) {
  const routing = typeof deps.getRouting === 'function' ? deps.getRouting() : {}
  const exposed = exposedModelNames(routing) || []
  const envRoutes =
    typeof deps.getEnvRoutes === 'function' ? deps.getEnvRoutes() || [] : []
  if (!exposed.length && !envRoutes.length) return []

  let catalogList = []
  try {
    const result = await deps.listAilyModels()
    catalogList =
      result?.data ||
      (result?.models || []).map((id) => ({ id, object: 'model', owned_by: 'aily' }))
  } catch {
    catalogList = []
  }

  const sourceList =
    catalogList.length > 0
      ? catalogList
      : exposed.map((id) => ({
          id,
          object: 'model',
          owned_by: 'aily',
          name: stripAilyPrefix(id) || id,
        }))

  let pub = publicModelList(sourceList, routing)
  if (!exposed.length && envRoutes.length && typeof deps.envModelMatches === 'function') {
    pub = pub.filter(
      (m) =>
        deps.envModelMatches(m.id) || deps.envModelMatches(stripAilyPrefix(m.id)),
    )
  }

  return pub.map((m) => ({
    id: m.id,
    object: 'model',
    owned_by: m.owned_by || 'aily',
    created: typeof m.created === 'number' ? m.created : undefined,
    // Keep name for admin pickers / plaza-style UIs; OpenAI clients ignore unknown fields
    ...(m.name ? { name: m.name } : {}),
  }))
}

/**
 * Async enrich OpenAI /v1/models JSON with aily rows (no-op when aily disabled).
 */
export async function enrichModelsBodyWithAily(bodyText, deps) {
  const rows = await collectAilyPublicModelRows(deps)
  if (!rows.length) return bodyText
  // If CPA returned empty/invalid body, still expose aily catalog
  if (!bodyText || !String(bodyText).trim()) {
    return JSON.stringify({ object: 'list', data: rows })
  }
  try {
    const obj = JSON.parse(bodyText)
    if (obj?.error && !Array.isArray(obj?.data)) {
      // Prefer returning aily-only list over propagating CPA error when we have models
      return JSON.stringify({ object: 'list', data: rows })
    }
  } catch {
    /* fall through to merge helper */
  }
  return mergeAilyIntoModelsBody(bodyText, rows)
}

export { isAilyPrefixed, stripAilyPrefix, exposedModelNames, publicModelList }
