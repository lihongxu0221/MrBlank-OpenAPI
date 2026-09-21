import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  hashPassword,
  verifyPassword,
  createLocalUserStore,
} from '../localUsers.js'

describe('localUsers password hash/verify', () => {
  it('hashes with scrypt and verifies correct password', () => {
    const encoded = hashPassword('s3cret-pass')
    assert.match(encoded, /^scrypt\$16384\$8\$1\$/)
    assert.equal(verifyPassword('s3cret-pass', encoded), true)
    assert.equal(verifyPassword('wrong', encoded), false)
    assert.equal(verifyPassword('', encoded), false)
  })

  it('rejects malformed encodings safely', () => {
    assert.equal(verifyPassword('x', ''), false)
    assert.equal(verifyPassword('x', 'not-scrypt'), false)
    assert.equal(verifyPassword('x', 'scrypt$1$1$1$YQ==$YQ=='), false) // weak/invalid params caught
  })

  it('authenticate returns public user without password_hash', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lu-'))
    const store = createLocalUserStore(path.join(dir, 'users.json'), {})
    store.createUser({ username: 'alice', password: 'password1', role: 'user' })
    const pub = store.authenticate('Alice', 'password1') // case-insensitive username
    assert.equal(pub.username, 'alice')
    assert.equal(pub.password_hash, undefined)
    assert.throws(() => store.authenticate('alice', 'bad'), (e) => e.status === 401)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
