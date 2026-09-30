import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertPublicHttpsUrl } from '../safeUrl.js'
import { safeAuthFileName } from '../authFileConvert.js'
import { createLocalUserStore } from '../localUsers.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const closed = {}

test('assertPublicHttpsUrl allows public https and rejects private/http', () => {
  assert.equal(assertPublicHttpsUrl('https://api.openai.com/v1/', closed), 'https://api.openai.com/v1')
  for (const bad of [
    'http://127.0.0.1',
    'https://169.254.169.254',
    'https://10.0.0.1',
    'https://192.168.1.1',
    'https://user:pass@api.openai.com',
    'https://metadata.google.internal',
    'https://localhost/v1',
    'file:///etc/passwd',
  ]) {
    assert.throws(() => assertPublicHttpsUrl(bad, closed), (e) => e.status === 400, bad)
  }
  assert.equal(
    assertPublicHttpsUrl('http://127.0.0.1:8080/v1', { UPSTREAM_ALLOW_PRIVATE: '1' }),
    'http://127.0.0.1:8080/v1',
  )
})

test('safeAuthFileName rejects traversal and odd names', () => {
  assert.equal(safeAuthFileName('codex-a.json'), 'codex-a.json')
  for (const bad of ['../x.json', 'a/b.json', 'a\\b.json', '..json', 'nope.txt', '']) {
    assert.throws(() => safeAuthFileName(bad), (e) => e.status === 400, JSON.stringify(bad))
  }
})

test('bootstrap does not upgrade an existing non-admin', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-'))
  const file = path.join(dir, 'users.json')
  const store = createLocalUserStore(file, {})
  store.createUser({ username: 'admin', password: 'password1', role: 'user' })
  const boot = createLocalUserStore(file, {
    BOOTSTRAP_ADMIN_USER: 'admin',
    BOOTSTRAP_ADMIN_PASSWORD: 'other-pass',
  }).bootstrapFromEnv()
  assert.equal(boot.reason, 'exists_not_upgraded')
  assert.equal(store.findByUsername('admin').role, 'user')
  fs.rmSync(dir, { recursive: true, force: true })
})
