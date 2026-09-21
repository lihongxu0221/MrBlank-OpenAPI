/**
 * Aily model whitelist / mapping (ported from aily-openai-adapter lib.mjs).
 * Persisted at server/data/aily-model-routing.json (override via AILY_MODEL_ROUTING_PATH).
 * Empty whitelist + empty mappings = no restriction.
 *
 * Public API ids (plaza / token/options / /v1 when routed to Aily) use prefix `aily/`
 * so bare names like `glm-5.3` stay on CPA unless AILY_MODEL_ROUTES (env) opts in.
 * Admin UI still manages upstream catalog ids (bare); publicModelList emits `aily/{id}`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** User-facing / match prefix — must not collide with CPA bare ids. */
export const AILY_PUBLIC_PREFIX = 'aily/'

export const MODEL_ALIASES = {
  'aily-auto': 'auto',
  'aily-max': 'auto-max',
  'aily-fast': 'auto-fast',
}

export function isAilyPrefixed(id) {
  return String(id || '').trim().startsWith(AILY_PUBLIC_PREFIX)
}

/** Strip leading `aily/` once; bare ids unchanged. */
export function stripAilyPrefix(id) {
  const s = String(id || '').trim()
  if (s.startsWith(AILY_PUBLIC_PREFIX)) return s.slice(AILY_PUBLIC_PREFIX.length)
  return s
}

/** Ensure public id is `aily/{upstreamOrMappingName}`. */
export function toPublicAilyId(id) {
  const s = String(id || '').trim()
  if (!s) return s
  if (s.startsWith(AILY_PUBLIC_PREFIX)) return s
  return AILY_PUBLIC_PREFIX + s
}

function uniqNames(arr) {
  const out = []
  const seen = new Set()
  for (const raw of arr || []) {
    const id = String(raw || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * Ids that appear in whitelist or mapping.from (as stored — may be bare or prefixed).
 * Used for admin / gating; do NOT use alone for /v1 route match (would steal CPA bare ids).
 */
export function exposedModelNames(routing) {
  const cfg = normalizeModelRouting(routing)
  return uniqNames([...cfg.whitelist, ...cfg.mappings.map((row) => row.from)])
}

/** True if `model` matches an exposed name in bare or `aily/` form. */
export function exposedIncludes(routing, model) {
  const requested = String(model || '').trim()
  if (!requested) return false
  const bare = stripAilyPrefix(requested)
  const exposed = exposedModelNames(routing)
  if (!exposed.length) return false
  for (const e of exposed) {
    const eb = stripAilyPrefix(e)
    if (e === requested || e === bare || eb === bare || eb === requested || toPublicAilyId(eb) === requested) {
      return true
    }
  }
  return false
}

export function normalizeModelRouting(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const mappings = []
  const seenFrom = new Set()
  for (const row of Array.isArray(src.mappings) ? src.mappings : []) {
    if (!row || typeof row !== 'object') continue
    const from = String(row.from || row.source || '').trim()
    const to = String(row.to || row.target || '').trim()
    if (!from || !to || seenFrom.has(from)) continue
    seenFrom.add(from)
    mappings.push({ from, to })
  }
  return { whitelist: uniqNames(src.whitelist || src.models), mappings }
}

export function mappingLookup(routing) {
  const map = Object.create(null)
  for (const row of (routing && routing.mappings) || []) {
    if (row && row.from) map[row.from] = row.to
  }
  return map
}

/**
 * Resolve mapping `to` for a request model.
 * Accepts `aily/X` or bare `X`; looks up from=`aily/X` or from=`X`.
 * Returns upstream model id (typically bare; never forces CPA).
 */
export function resolveMappedModel(model, routing) {
  const requested = String(model || '').trim()
  const bare = stripAilyPrefix(requested) || requested
  const map = mappingLookup(routing)
  const hit =
    map[requested] ||
    map[bare] ||
    (bare && map[toPublicAilyId(bare)]) ||
    undefined
  // Upstream id should be bare catalog id
  return stripAilyPrefix(hit != null ? hit : bare) || bare
}

/**
 * Resolve request model through whitelist/mappings.
 * @param {string} model
 * @param {{ presets?: Set<string>, models?: Set<string> }} index
 * @param {{ whitelist?: string[], mappings?: {from:string,to:string}[] }} routing
 * @param {(model:string, index:object) => object} resolveAilyModel
 */
export function applyModelRouting(model, index, routing, resolveAilyModel) {
  const requested = String(model || '').trim() || 'aily-auto'
  const bare = stripAilyPrefix(requested) || requested
  const mapped = resolveMappedModel(requested, routing)
  const info =
    typeof resolveAilyModel === 'function'
      ? resolveAilyModel(mapped, index)
      : { requested: mapped }
  const exposed = exposedModelNames(routing)
  const allowed = !exposed.length || exposedIncludes(routing, requested) || exposedIncludes(routing, bare)
  return { ...info, requested, mapped, allowed, bare }
}

/**
 * User-facing model list: always emit `aily/{id}` so plaza / merge never collide with CPA.
 * Catalog / whitelist may still store bare upstream ids; display name stays friendly.
 */
export function publicModelList(catalogList, routing) {
  const cfg = normalizeModelRouting(routing)
  const byId = new Map()
  for (const m of catalogList || []) {
    if (!m || !m.id) continue
    const bare = stripAilyPrefix(m.id)
    byId.set(m.id, m)
    if (bare) byId.set(bare, m)
  }
  const out = []
  const seen = new Set()
  const add = (id) => {
    const raw = String(id || '').trim()
    if (!raw) return
    const bare = stripAilyPrefix(raw) || raw
    const publicId = toPublicAilyId(bare)
    if (!bare || seen.has(publicId)) return
    seen.add(publicId)
    // Prefer catalog row whose id matches this bare name; do not reuse another
    // preset's display_name that was incorrectly keyed under the same bare id.
    const rec =
      byId.get(bare) ||
      byId.get(raw) ||
      byId.get(publicId) ||
      null
    const exact =
      rec && (String(rec.id) === bare || stripAilyPrefix(String(rec.id || '')) === bare)
        ? rec
        : null
    const display =
      (exact && exact.name && String(exact.name).trim()) || bare
    const base = exact ? { ...exact } : { id: publicId, object: 'model', owned_by: 'aily' }
    out.push({
      ...base,
      id: publicId,
      name: display,
      owned_by: base.owned_by || 'aily',
    })
  }
  const exposed = exposedModelNames(cfg)
  if (exposed.length) {
    for (const id of exposed) add(id)
  } else {
    for (const m of catalogList || []) add(m.id)
  }
  return out
}

/** sync: latest | upstream | clear — stores bare upstream catalog ids for admin. */
export function syncModelWhitelist(catalogList, source) {
  if (source === 'clear') return []
  const ids = uniqNames((catalogList || []).map((m) => m && stripAilyPrefix(m.id)))
  if (source === 'latest') {
    for (const [alias, preset] of Object.entries(MODEL_ALIASES)) {
      if (ids.includes(preset) || ids.includes(alias) || ids.includes(stripAilyPrefix(alias))) ids.push(alias)
    }
    return uniqNames(ids)
  }
  // upstream: catalog ids excluding local alias keys
  return uniqNames(
    (catalogList || [])
      .map((m) => m && stripAilyPrefix(m.id))
      .filter((id) => id && !MODEL_ALIASES[id]),
  )
}

function defaultRoutingPath() {
  return (
    process.env.AILY_MODEL_ROUTING_PATH ||
    path.join(__dirname, 'data', 'aily-model-routing.json')
  )
}

function readStore(filePath) {
  try {
    if (!fs.existsSync(filePath)) return normalizeModelRouting({})
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    // Migrate on read: keep stored form as-is (bare or prefixed); runtime public list prefixes.
    return normalizeModelRouting(raw)
  } catch {
    return normalizeModelRouting({})
  }
}

function writeStore(filePath, routing) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.tmp`
  const payload = {
    ...normalizeModelRouting(routing),
    updated_at: new Date().toISOString(),
  }
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
  fs.renameSync(tmp, filePath)
}

/**
 * Optional: when saving from admin, keep whitelist/mappings.from as bare upstream ids
 * (strip accidental aily/ so admin catalog checkboxes stay aligned).
 */
export function normalizeRoutingForStorage(raw) {
  const cfg = normalizeModelRouting(raw)
  return {
    whitelist: uniqNames(cfg.whitelist.map((id) => stripAilyPrefix(id) || id)),
    mappings: cfg.mappings.map((row) => ({
      from: stripAilyPrefix(row.from) || row.from,
      to: stripAilyPrefix(row.to) || row.to,
    })),
  }
}

/**
 * @param {string} [filePath]
 */
export function createAilyModelRoutingStore(filePath = defaultRoutingPath()) {
  let routing = readStore(filePath)

  function get() {
    return normalizeModelRouting(routing)
  }

  function save(next) {
    // Admin save: store bare upstream ids; public list adds aily/ at serve time.
    routing = normalizeRoutingForStorage(next)
    writeStore(filePath, routing)
    return get()
  }

  function update(patch = {}) {
    const cur = get()
    return save({
      whitelist: patch.whitelist != null ? patch.whitelist : cur.whitelist,
      mappings: patch.mappings != null ? patch.mappings : cur.mappings,
    })
  }

  function sync(catalogList, source) {
    const cur = get()
    return save({
      whitelist: syncModelWhitelist(catalogList, source),
      mappings: cur.mappings,
    })
  }

  return {
    filePath,
    get,
    save,
    update,
    sync,
    reload() {
      routing = readStore(filePath)
      return get()
    },
  }
}
