/**
 * Aily model whitelist / mapping (ported from aily-openai-adapter lib.mjs).
 * Persisted at server/data/aily-model-routing.json (override via AILY_MODEL_ROUTING_PATH).
 * Empty whitelist + empty mappings = no restriction.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const MODEL_ALIASES = {
  'aily-auto': 'auto',
  'aily-max': 'auto-max',
  'aily-fast': 'auto-fast',
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

export function exposedModelNames(routing) {
  const cfg = normalizeModelRouting(routing)
  return uniqNames([...cfg.whitelist, ...cfg.mappings.map((row) => row.from)])
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
  const mapped = mappingLookup(routing)[requested] || requested
  const info =
    typeof resolveAilyModel === 'function'
      ? resolveAilyModel(mapped, index)
      : { requested: mapped }
  const exposed = exposedModelNames(routing)
  const allowed = !exposed.length || exposed.includes(requested)
  return { ...info, requested, mapped, allowed }
}

export function publicModelList(catalogList, routing) {
  const cfg = normalizeModelRouting(routing)
  const byId = new Map()
  for (const m of catalogList || []) {
    if (m && m.id) byId.set(m.id, m)
  }
  const out = []
  const seen = new Set()
  const add = (id) => {
    const key = String(id || '').trim()
    if (!key || seen.has(key)) return
    seen.add(key)
    const rec = byId.get(key)
    out.push(rec ? { ...rec } : { id: key, object: 'model', owned_by: 'aily' })
  }
  const exposed = exposedModelNames(cfg)
  if (exposed.length) {
    for (const id of exposed) add(id)
  } else {
    for (const m of catalogList || []) add(m.id)
  }
  return out
}

/** sync: latest | upstream | clear */
export function syncModelWhitelist(catalogList, source) {
  if (source === 'clear') return []
  const ids = uniqNames((catalogList || []).map((m) => m && m.id))
  if (source === 'latest') {
    for (const [alias, preset] of Object.entries(MODEL_ALIASES)) {
      if (ids.includes(preset) || ids.includes(alias)) ids.push(alias)
    }
    return uniqNames(ids)
  }
  // upstream: catalog ids excluding local alias keys
  return uniqNames((catalogList || []).map((m) => m && m.id).filter((id) => id && !MODEL_ALIASES[id]))
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
 * @param {string} [filePath]
 */
export function createAilyModelRoutingStore(filePath = defaultRoutingPath()) {
  let routing = readStore(filePath)

  function get() {
    return normalizeModelRouting(routing)
  }

  function save(next) {
    routing = normalizeModelRouting(next)
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
