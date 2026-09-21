import fs from 'node:fs'
import path from 'node:path'

/**
 * Disk-backed map: linux.do user id -> { tokens: [...], nextId }
 * Token records keep fullKey server-side only.
 */
export function createUserKeyStore(filePath) {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })

  function readAll() {
    if (!fs.existsSync(filePath)) return { users: {} }
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      return raw && typeof raw === 'object' ? raw : { users: {} }
    } catch {
      return { users: {} }
    }
  }

  function writeAll(data) {
    const tmp = `${filePath}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, filePath)
    try {
      fs.chmodSync(filePath, 0o600)
    } catch {
      /* ignore */
    }
  }

  function ensureUser(data, userId) {
    const id = String(userId)
    if (!data.users) data.users = {}
    if (!data.users[id]) data.users[id] = { tokens: [], nextId: 1 }
    return data.users[id]
  }

  return {
    list(userId) {
      const data = readAll()
      return ensureUser(data, userId).tokens.slice()
    },
    get(userId, tokenId) {
      return this.list(userId).find((t) => t.id === Number(tokenId)) || null
    },
    create(userId, token) {
      const data = readAll()
      const u = ensureUser(data, userId)
      const id = u.nextId++
      const item = { ...token, id }
      u.tokens.unshift(item)
      writeAll(data)
      return item
    },
    update(userId, tokenId, patch) {
      const data = readAll()
      const u = ensureUser(data, userId)
      const t = u.tokens.find((x) => x.id === Number(tokenId))
      if (!t) return null
      Object.assign(t, patch)
      writeAll(data)
      return t
    },
    remove(userId, tokenId) {
      const data = readAll()
      const u = ensureUser(data, userId)
      const i = u.tokens.findIndex((x) => x.id === Number(tokenId))
      if (i < 0) return null
      const [removed] = u.tokens.splice(i, 1)
      writeAll(data)
      return removed
    },
    allFullKeys() {
      const data = readAll()
      const keys = []
      for (const u of Object.values(data.users || {})) {
        for (const t of u.tokens || []) {
          if (t.fullKey) keys.push(t.fullKey)
        }
      }
      return keys
    },
  }
}
