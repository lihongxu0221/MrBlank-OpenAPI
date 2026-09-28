import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createSessionStore } from '../sessions.js'

test('session store persists across reload (hot-restart simulation)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrblank-sess-'))
  const file = path.join(dir, 'sessions.json')
  const store = createSessionStore(file, { ttlMs: 60_000, debounceMs: 0 })
  const rec = {
    sid: 'sid-abc-12345678',
    access_token: 'tok-xyz-12345678',
    createdAt: Date.now(),
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'u1', display_name: 'Test', username: 'test', email: 't@x.com' },
  }
  store.set(rec)
  store.flush()
  assert.ok(fs.existsSync(file), 'sessions.json should exist')
  assert.equal(store.get('sid-abc-12345678')?.user?.username, 'test')

  // Simulate process restart: new store instance reading same file
  const store2 = createSessionStore(file, { ttlMs: 60_000, debounceMs: 0 })
  const restored = store2.get('sid-abc-12345678')
  assert.ok(restored, 'sid should survive restart')
  assert.equal(restored.access_token, 'tok-xyz-12345678')
  assert.equal(restored.user.id, 'u1')
  assert.equal(store2.findByAccessToken('tok-xyz-12345678')?.sid, 'sid-abc-12345678')
})

test('session store prunes expired on boot and get', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrblank-sess-'))
  const file = path.join(dir, 'sessions.json')
  const ttl = 5_000
  const store = createSessionStore(file, { ttlMs: ttl, debounceMs: 0 })
  store.set({
    sid: 'old-sid-12345678',
    access_token: 'old-tok-12345678',
    createdAt: Date.now() - ttl - 10_000,
    expiresAt: 1,
    user: { id: 'u2', username: 'old' },
  })
  store.set({
    sid: 'new-sid-12345678',
    access_token: 'new-tok-12345678',
    createdAt: Date.now(),
    expiresAt: Math.floor(Date.now() / 1000) + 60,
    user: { id: 'u3', username: 'new' },
  })
  store.flush()

  const reloaded = createSessionStore(file, { ttlMs: ttl, debounceMs: 0 })
  assert.equal(reloaded.get('old-sid-12345678'), null)
  assert.ok(reloaded.get('new-sid-12345678'))
  assert.equal(reloaded.size(), 1)
})

test('logout delete removes from disk after flush', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrblank-sess-'))
  const file = path.join(dir, 'sessions.json')
  const store = createSessionStore(file, { ttlMs: 60_000, debounceMs: 0 })
  store.set({
    sid: 'del-sid-12345678',
    access_token: 'del-tok-12345678',
    createdAt: Date.now(),
    expiresAt: Math.floor(Date.now() / 1000) + 60,
    user: { id: 'u4', username: 'del' },
  })
  store.flush()
  store.delete('del-sid-12345678')
  store.flush()
  const again = createSessionStore(file, { ttlMs: 60_000, debounceMs: 0 })
  assert.equal(again.get('del-sid-12345678'), null)
})
