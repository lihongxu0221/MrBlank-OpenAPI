/**
 * Site DB: API key hash ↔ friendly label (Wave B rebuild of CPAMP api-key-aliases).
 */
import fs from 'node:fs'
import path from 'node:path'

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function readStore(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { version: 1, aliases: {} }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    const aliases =
      raw?.aliases && typeof raw.aliases === 'object' && !Array.isArray(raw.aliases)
        ? raw.aliases
        : {}
    return { version: 1, aliases }
  } catch {
    return { version: 1, aliases: {} }
  }
}

function writeStore(filePath, store) {
  ensureDir(filePath)
  const tmp = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8')
  fs.renameSync(tmp, filePath)
}

export function createApiKeyAliasesStore(filePath) {
  let store = readStore(filePath)

  function persist() {
    writeStore(filePath, store)
  }

  function list() {
    return Object.entries(store.aliases)
      .map(([hash, meta]) => ({
        hash,
        label: typeof meta === 'string' ? meta : String(meta?.label || ''),
        note: typeof meta === 'object' && meta?.note != null ? String(meta.note) : '',
        updated_at: typeof meta === 'object' ? meta.updated_at || null : null,
      }))
      .filter((a) => a.hash)
      .sort((a, b) => a.label.localeCompare(b.label) || a.hash.localeCompare(b.hash))
  }

  function put(hash, label, note = '') {
    const h = String(hash || '').trim().toLowerCase()
    const lab = String(label || '').trim()
    if (!h) throw Object.assign(new Error('hash required'), { status: 400 })
    if (!lab) throw Object.assign(new Error('label required'), { status: 400 })
    store.aliases[h] = {
      label: lab,
      note: String(note || ''),
      updated_at: new Date().toISOString(),
    }
    persist()
    return list().find((a) => a.hash === h)
  }

  function remove(hash) {
    const h = String(hash || '').trim().toLowerCase()
    if (!h || !(h in store.aliases)) {
      throw Object.assign(new Error('alias not found'), { status: 404 })
    }
    delete store.aliases[h]
    persist()
    return { removed: h }
  }

  function labelFor(hash) {
    const h = String(hash || '').trim().toLowerCase()
    const meta = store.aliases[h]
    if (!meta) return null
    return typeof meta === 'string' ? meta : meta.label || null
  }

  return { list, put, remove, labelFor }
}
