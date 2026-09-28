/**
 * Persistent login sessions (CODE_REVIEW M3).
 * Atomic JSON write under site data dir — survives hot-deploy restart.
 */
import fs from 'node:fs'
import path from 'node:path'

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function readStore(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { version: 1, sessions: [] }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    const list = Array.isArray(raw?.sessions) ? raw.sessions : Array.isArray(raw) ? raw : []
    return { version: 1, sessions: list }
  } catch {
    return { version: 1, sessions: [] }
  }
}

function writeStoreAtomic(filePath, store) {
  ensureDir(filePath)
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, filePath)
  try {
    fs.chmodSync(filePath, 0o600)
  } catch {
    /* best-effort */
  }
}

function isExpired(rec, ttlMs, now = Date.now()) {
  if (!rec || typeof rec !== 'object') return true
  const created = Number(rec.createdAt) || 0
  if (!created) return true
  return now - created > ttlMs
}

/**
 * @param {string} filePath
 * @param {{ ttlMs?: number, debounceMs?: number }} [opts]
 */
export function createSessionStore(filePath, { ttlMs = 12 * 60 * 60 * 1000, debounceMs = 250 } = {}) {
  const storePath =
    filePath || path.join(process.cwd(), 'data', 'sessions.json')
  const ttl = Math.max(1_000, Number(ttlMs) || 12 * 60 * 60 * 1000)
  const debounce = Math.max(0, Number(debounceMs) || 0)

  /** @type {Map<string, any>} */
  const map = new Map()
  let writeTimer = null
  let dirty = false

  function hydrate() {
    map.clear()
    const doc = readStore(storePath)
    const now = Date.now()
    let pruned = 0
    for (const rec of doc.sessions) {
      if (!rec || typeof rec !== 'object') continue
      const sid = String(rec.sid || '').trim()
      if (!sid) continue
      if (isExpired(rec, ttl, now)) {
        pruned += 1
        continue
      }
      map.set(sid, rec)
    }
    if (pruned > 0) {
      dirty = true
      schedulePersist()
    }
    return { loaded: map.size, pruned }
  }

  function snapshot() {
    return {
      version: 1,
      updated_at: new Date().toISOString(),
      sessions: [...map.values()],
    }
  }

  function persistSync() {
    if (writeTimer) {
      clearTimeout(writeTimer)
      writeTimer = null
    }
    writeStoreAtomic(storePath, snapshot())
    dirty = false
  }

  function schedulePersist() {
    dirty = true
    if (debounce <= 0) {
      persistSync()
      return
    }
    if (writeTimer) return
    writeTimer = setTimeout(() => {
      writeTimer = null
      if (!dirty) return
      try {
        persistSync()
      } catch (err) {
        console.error('[sessions] persist failed', err?.message || err)
      }
    }, debounce)
    writeTimer.unref?.()
  }

  const boot = hydrate()

  return {
    path: storePath,
    ttlMs: ttl,
    size: () => map.size,
    boot,
    get(sid) {
      const key = String(sid || '').trim()
      if (!key) return null
      const rec = map.get(key)
      if (!rec) return null
      if (isExpired(rec, ttl)) {
        map.delete(key)
        schedulePersist()
        return null
      }
      return rec
    },
    set(rec) {
      if (!rec || typeof rec !== 'object') return null
      const sid = String(rec.sid || '').trim()
      if (!sid) return null
      map.set(sid, rec)
      schedulePersist()
      return rec
    },
    delete(sid) {
      const key = String(sid || '').trim()
      if (!key) return false
      const ok = map.delete(key)
      if (ok) schedulePersist()
      return ok
    },
    values() {
      return map.values()
    },
    entries() {
      return map.entries()
    },
    prune(now = Date.now()) {
      let n = 0
      for (const [k, v] of map) {
        if (isExpired(v, ttl, now)) {
          map.delete(k)
          n += 1
        }
      }
      if (n) schedulePersist()
      return n
    },
    /** Flush pending write immediately (tests / shutdown). */
    flush() {
      if (dirty || writeTimer) persistSync()
    },
    /** Re-read disk into memory (tests: simulate process restart). */
    reloadFromDisk() {
      if (writeTimer) {
        clearTimeout(writeTimer)
        writeTimer = null
      }
      return hydrate()
    },
    /** Test helper: find by access_token */
    findByAccessToken(token) {
      const t = String(token || '').trim()
      if (!t || t.length < 8) return null
      for (const rec of map.values()) {
        if (rec.access_token === t) {
          if (isExpired(rec, ttl)) {
            map.delete(rec.sid)
            schedulePersist()
            return null
          }
          return rec
        }
      }
      return null
    },
  }
}

export { isExpired as sessionIsExpired }
