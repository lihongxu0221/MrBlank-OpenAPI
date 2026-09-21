/**
 * Chunked usage import sessions (Wave C).
 * Staging under server/data/usage-imports/ — does not require CPAMP.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const DEFAULT_MAX_CHUNKS = 200
const DEFAULT_MAX_EVENTS_PER_CHUNK = 5_000
const DEFAULT_MAX_TOTAL_EVENTS = 100_000
const SESSION_TTL_MS = 2 * 60 * 60 * 1000

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function sessionDir(baseDir, id) {
  return path.join(baseDir, id)
}

function metaPath(baseDir, id) {
  return path.join(sessionDir(baseDir, id), 'meta.json')
}

function chunkPath(baseDir, id, index) {
  return path.join(sessionDir(baseDir, id), `chunk-${String(index).padStart(5, '0')}.json`)
}

function readMeta(baseDir, id) {
  const p = metaPath(baseDir, id)
  if (!fs.existsSync(p)) {
    const err = new Error('import session not found')
    err.status = 404
    throw err
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

function writeMeta(baseDir, id, meta) {
  const dir = sessionDir(baseDir, id)
  ensureDir(dir)
  const tmp = `${metaPath(baseDir, id)}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), 'utf8')
  fs.renameSync(tmp, metaPath(baseDir, id))
}

function cleanupExpired(baseDir) {
  try {
    if (!fs.existsSync(baseDir)) return
    const now = Date.now()
    for (const name of fs.readdirSync(baseDir)) {
      const metaFile = path.join(baseDir, name, 'meta.json')
      if (!fs.existsSync(metaFile)) continue
      try {
        const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'))
        const created = Date.parse(meta.created_at || '') || 0
        if (meta.status === 'completed' || meta.status === 'cancelled' || now - created > SESSION_TTL_MS) {
          fs.rmSync(path.join(baseDir, name), { recursive: true, force: true })
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} baseDir
 * @param {{ importEvents: (payload: any, opts?: any) => any }} siteUsage
 */
export function createUsageImportSessions(baseDir, siteUsage) {
  ensureDir(baseDir)
  cleanupExpired(baseDir)

  function start({ mode = 'append', expected_chunks = null } = {}) {
    cleanupExpired(baseDir)
    const id = crypto.randomBytes(8).toString('hex')
    const meta = {
      id,
      status: 'open',
      mode: mode === 'merge' ? 'merge' : 'append',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      chunks_received: 0,
      events_received: 0,
      expected_chunks: expected_chunks != null ? Number(expected_chunks) : null,
      result: null,
      error: null,
    }
    writeMeta(baseDir, id, meta)
    return meta
  }

  function get(id) {
    return readMeta(baseDir, String(id || '').trim())
  }

  /**
   * @param {string} id
   * @param {{ events?: any[], chunk?: any[], index?: number }} body
   */
  function addChunk(id, body = {}) {
    const sid = String(id || '').trim()
    const meta = readMeta(baseDir, sid)
    if (meta.status !== 'open') {
      const err = new Error(`session is ${meta.status}`)
      err.status = 409
      throw err
    }
    const events = Array.isArray(body.events)
      ? body.events
      : Array.isArray(body.chunk)
        ? body.chunk
        : null
    if (!events) {
      const err = new Error('chunk body must include events: []')
      err.status = 400
      throw err
    }
    if (events.length > DEFAULT_MAX_EVENTS_PER_CHUNK) {
      const err = new Error(`chunk too large (max ${DEFAULT_MAX_EVENTS_PER_CHUNK} events)`)
      err.status = 413
      throw err
    }
    if (meta.chunks_received >= DEFAULT_MAX_CHUNKS) {
      const err = new Error(`too many chunks (max ${DEFAULT_MAX_CHUNKS})`)
      err.status = 413
      throw err
    }
    if (meta.events_received + events.length > DEFAULT_MAX_TOTAL_EVENTS) {
      const err = new Error(`session event cap exceeded (max ${DEFAULT_MAX_TOTAL_EVENTS})`)
      err.status = 413
      throw err
    }
    const index = meta.chunks_received
    const tmp = `${chunkPath(baseDir, sid, index)}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ events }), 'utf8')
    fs.renameSync(tmp, chunkPath(baseDir, sid, index))
    meta.chunks_received += 1
    meta.events_received += events.length
    meta.updated_at = new Date().toISOString()
    writeMeta(baseDir, sid, meta)
    return {
      id: sid,
      chunks_received: meta.chunks_received,
      events_received: meta.events_received,
      status: meta.status,
    }
  }

  function complete(id) {
    const sid = String(id || '').trim()
    const meta = readMeta(baseDir, sid)
    if (meta.status !== 'open') {
      const err = new Error(`session is ${meta.status}`)
      err.status = 409
      throw err
    }
    const all = []
    for (let i = 0; i < meta.chunks_received; i++) {
      const p = chunkPath(baseDir, sid, i)
      if (!fs.existsSync(p)) {
        const err = new Error(`missing chunk ${i}`)
        err.status = 400
        throw err
      }
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
      if (Array.isArray(raw?.events)) all.push(...raw.events)
    }
    try {
      const result = siteUsage.importEvents(
        { events: all, source: 'import-session', session_id: sid },
        { mode: meta.mode, maxImport: DEFAULT_MAX_TOTAL_EVENTS },
      )
      meta.status = 'completed'
      meta.result = result
      meta.updated_at = new Date().toISOString()
      writeMeta(baseDir, sid, meta)
      // drop chunk files; keep meta briefly
      for (let i = 0; i < meta.chunks_received; i++) {
        try {
          fs.unlinkSync(chunkPath(baseDir, sid, i))
        } catch {
          /* ignore */
        }
      }
      return meta
    } catch (err) {
      meta.status = 'failed'
      meta.error = err?.message || String(err)
      meta.updated_at = new Date().toISOString()
      writeMeta(baseDir, sid, meta)
      throw err
    }
  }

  function cancel(id) {
    const sid = String(id || '').trim()
    const meta = readMeta(baseDir, sid)
    meta.status = 'cancelled'
    meta.updated_at = new Date().toISOString()
    writeMeta(baseDir, sid, meta)
    try {
      fs.rmSync(sessionDir(baseDir, sid), { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    return { id: sid, status: 'cancelled' }
  }

  return { start, get, addChunk, complete, cancel }
}
