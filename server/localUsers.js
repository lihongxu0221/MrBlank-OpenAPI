/**
 * Local username/password user store for MrBlank-OpenAPI.
 * Passwords hashed with Node crypto.scrypt; never store plaintext.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEYLEN = 64

function ensureDir(filePath) {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

export function hashPassword(password, saltBuf) {
  const salt = saltBuf || crypto.randomBytes(16)
  const derived = crypto.scryptSync(String(password), salt, KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derived.toString('base64')}`
}

export function verifyPassword(password, encoded) {
  const parts = String(encoded || '').split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const N = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  const salt = Buffer.from(parts[4], 'base64')
  const expected = Buffer.from(parts[5], 'base64')
  let derived
  try {
    derived = crypto.scryptSync(String(password), salt, expected.length, { N, r, p })
  } catch {
    return false
  }
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived)
}

const scryptAsync = (password, salt, keylen, opts) =>
  new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)))
  })

/** Non-blocking hash (libuv threadpool) — use on request paths. */
export async function hashPasswordAsync(password, saltBuf) {
  const salt = saltBuf || crypto.randomBytes(16)
  const derived = await scryptAsync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derived.toString('base64')}`
}

/** Non-blocking verify (libuv threadpool) — use on request paths. */
export async function verifyPasswordAsync(password, encoded) {
  const parts = String(encoded || '').split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const N = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  const salt = Buffer.from(parts[4], 'base64')
  const expected = Buffer.from(parts[5], 'base64')
  let derived
  try {
    derived = await scryptAsync(password, salt, expected.length, { N, r, p })
  } catch {
    return false
  }
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived)
}

// Fixed dummy hash so unknown usernames cost the same as wrong passwords (no user enumeration by timing).
const DUMMY_HASH = hashPassword('dummy-password-for-timing', Buffer.alloc(16, 7))

function publicUser(row) {
  if (!row) return null
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    group_id: row.group_id || null,
    disabled: !!row.disabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function normalizeUsername(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
}

function normalizeRole(raw) {
  const r = String(raw || 'user').trim().toLowerCase()
  return r === 'admin' ? 'admin' : 'user'
}

export function createLocalUserStore(filePath, env = process.env) {
  const storePath = filePath || path.join(process.cwd(), 'data', 'local-users.json')

  function load() {
    ensureDir(storePath)
    if (!fs.existsSync(storePath)) {
      const empty = { users: [], updated_at: new Date().toISOString() }
      fs.writeFileSync(storePath, JSON.stringify(empty, null, 2), { mode: 0o600 })
      return empty
    }
    try {
      const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'))
      if (!raw || !Array.isArray(raw.users)) return { users: [], updated_at: null }
      return raw
    } catch {
      return { users: [], updated_at: null }
    }
  }

  function save(doc) {
    ensureDir(storePath)
    const out = {
      users: doc.users || [],
      updated_at: new Date().toISOString(),
    }
    const tmp = `${storePath}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(out, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, storePath)
    try {
      fs.chmodSync(storePath, 0o600)
    } catch {
      /* ignore */
    }
    return out
  }

  function findByUsername(username) {
    const u = normalizeUsername(username)
    if (!u) return null
    const doc = load()
    return doc.users.find((row) => normalizeUsername(row.username) === u) || null
  }

  function findById(id) {
    const doc = load()
    return doc.users.find((row) => row.id === id) || null
  }

  function listUsers() {
    return load().users.map(publicUser)
  }

  function validateNewUser(uname, password) {
    if (!uname || uname.length < 2) {
      throw Object.assign(new Error('用户名至少 2 个字符'), { status: 400 })
    }
    if (uname.length > 32 || !/^[\p{L}\p{N}_.@\-]+$/u.test(uname)) {
      throw Object.assign(new Error('用户名最多 32 个字符，仅限字母、数字、下划线、点、@ 和短横线'), { status: 400 })
    }
    if (!password || String(password).length < 6) {
      throw Object.assign(new Error('密码至少 6 个字符'), { status: 400 })
    }
    if (String(password).length > 256) {
      throw Object.assign(new Error('密码过长'), { status: 400 })
    }
    if (findByUsername(uname)) {
      throw Object.assign(new Error('用户名已存在'), { status: 409 })
    }
  }

  function insertUser({ uname, password_hash, role, display_name, group_id }) {
    const now = new Date().toISOString()
    const row = {
      id: `local:${crypto.randomBytes(8).toString('hex')}`,
      username: uname,
      password_hash,
      role: normalizeRole(role),
      display_name: String(display_name || uname).trim().slice(0, 64) || uname,
      group_id: group_id ? String(group_id) : null,
      disabled: false,
      created_at: now,
      updated_at: now,
    }
    const doc = load()
    doc.users.push(row)
    save(doc)
    return publicUser(row)
  }

  function createUser({ username, password, role = 'user', display_name, group_id } = {}) {
    const uname = String(username || '').trim()
    validateNewUser(uname, password)
    return insertUser({ uname, password_hash: hashPassword(password), role, display_name, group_id })
  }

  function updateUser(id, patch = {}) {
    const doc = load()
    const idx = doc.users.findIndex((u) => u.id === id)
    if (idx < 0) throw Object.assign(new Error('用户不存在'), { status: 404 })
    const row = doc.users[idx]
    if (patch.display_name != null) row.display_name = String(patch.display_name).trim() || row.username
    if (patch.role != null) row.role = normalizeRole(patch.role)
    if (patch.group_id !== undefined) row.group_id = patch.group_id ? String(patch.group_id) : null
    if (patch.disabled != null) row.disabled = !!patch.disabled
    row.updated_at = new Date().toISOString()
    doc.users[idx] = row
    save(doc)
    return publicUser(row)
  }

  function resetPassword(id, password) {
    if (!password || String(password).length < 6) {
      throw Object.assign(new Error('密码至少 6 个字符'), { status: 400 })
    }
    const doc = load()
    const idx = doc.users.findIndex((u) => u.id === id)
    if (idx < 0) throw Object.assign(new Error('用户不存在'), { status: 404 })
    doc.users[idx].password_hash = hashPassword(password)
    doc.users[idx].updated_at = new Date().toISOString()
    save(doc)
    return publicUser(doc.users[idx])
  }

  function deleteUser(id) {
    const doc = load()
    const next = doc.users.filter((u) => u.id !== id)
    if (next.length === doc.users.length) {
      throw Object.assign(new Error('用户不存在'), { status: 404 })
    }
    doc.users = next
    save(doc)
    return true
  }

  /**
   * Verify credentials. Returns public user or throws with status.
   */
  function authenticate(username, password) {
    const row = findByUsername(username)
    if (!row || !verifyPassword(password, row.password_hash)) {
      throw Object.assign(new Error('用户名或密码错误'), { status: 401 })
    }
    if (row.disabled) {
      throw Object.assign(new Error('账号已停用'), { status: 403 })
    }
    return publicUser(row)
  }

  /**
   * Bootstrap admin from env if configured and username missing.
   * Never logs the password.
   */
  function bootstrapFromEnv() {
    const user = String(env.BOOTSTRAP_ADMIN_USER || '').trim()
    const pass = String(env.BOOTSTRAP_ADMIN_PASSWORD || '')
    if (!user || !pass) {
      return { created: false, reason: 'env_unset' }
    }
    if (findByUsername(user)) {
      // Never promote an existing account. A re-registered username must not inherit admin.
      const row = findByUsername(user)
      if (row.role !== 'admin') {
        console.warn(
          `[local-users] bootstrap skipped: ${user} exists and is not admin; not upgrading`,
        )
        return { created: false, reason: 'exists_not_upgraded', username: user }
      }
      return { created: false, reason: 'exists', username: user }
    }
    const created = createUser({
      username: user,
      password: pass,
      role: 'admin',
      display_name: user,
    })
    return { created: true, username: created.username, id: created.id }
  }

  /** Promote listed existing usernames to admin only when there is no admin at all. */
  function seedAdminsIfNone(usernames = []) {
    const doc = load()
    if (doc.users.some((u) => u.role === 'admin')) return []
    const want = new Set(usernames.map(normalizeUsername).filter(Boolean))
    const out = []
    for (const row of doc.users) {
      if (want.has(normalizeUsername(row.username))) {
        row.role = 'admin'
        row.updated_at = new Date().toISOString()
        out.push(row.username)
      }
    }
    if (out.length) save(doc)
    return out
  }

  async function authenticateAsync(username, password) {
    const row = findByUsername(username)
    const ok = await verifyPasswordAsync(password, row ? row.password_hash : DUMMY_HASH)
    if (!row || !ok) {
      throw Object.assign(new Error('用户名或密码错误'), { status: 401 })
    }
    if (row.disabled) {
      throw Object.assign(new Error('账号已停用'), { status: 403 })
    }
    return publicUser(row)
  }

  async function createUserAsync({ username, password, role = 'user', display_name, group_id } = {}) {
    const uname = String(username || '').trim()
    validateNewUser(uname, password)
    const password_hash = await hashPasswordAsync(password)
    // re-check after the await (another request may have taken the name meanwhile)
    if (findByUsername(uname)) {
      throw Object.assign(new Error('用户名已存在'), { status: 409 })
    }
    return insertUser({ uname, password_hash, role, display_name, group_id })
  }

  function toSessionUser(pub) {
    return {
      id: pub.id,
      username: pub.username,
      display_name: pub.display_name,
      email: '',
      auth_provider: 'local',
      role: pub.role,
      group_id: pub.group_id || null,
    }
  }

  return {
    listUsers,
    createUser,
    updateUser,
    resetPassword,
    deleteUser,
    authenticate,
    bootstrapFromEnv,
    seedAdminsIfNone,
    authenticateAsync,
    createUserAsync,
    toSessionUser,
    findById,
    findByUsername,
    publicUser,
  }
}
