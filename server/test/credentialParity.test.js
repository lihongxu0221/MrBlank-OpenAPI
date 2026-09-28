import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { convertPasteToAuthFiles } from '../authFileConvert.js'
import { createQuotaSnapshotStore } from '../quotaSnapshots.js'
import { deriveDisplayStatus, mapAdminAccounts, summarizeAccounts } from '../admin.js'

test('deriveDisplayStatus maps reauth / disabled / running', () => {
  assert.equal(deriveDisplayStatus({ disabled: true }), 'disabled')
  assert.equal(deriveDisplayStatus({ status_message: 'need reauth token expired' }), 'need_reauth')
  assert.equal(deriveDisplayStatus({ unavailable: true }), 'unavailable')
  assert.equal(deriveDisplayStatus({ status: 'ok' }), 'running')
})

test('mapAdminAccounts exposes display_status and fields', () => {
  const items = mapAdminAccounts({
    files: [
      {
        name: 'codex-a.json',
        provider: 'codex',
        disabled: false,
        note: 'n1',
        priority: 3,
        weight: 2,
        recent_requests: [],
      },
    ],
  })
  assert.equal(items[0].display_status, 'running')
  assert.equal(items[0].note, 'n1')
  assert.equal(items[0].priority, 3)
  assert.equal(items[0].weight, 2)
  const pool = summarizeAccounts(items)
  assert.equal(pool.total, 1)
  assert.equal(pool.active, 1)
})

test('convertPasteToAuthFiles session → codex', () => {
  const out = convertPasteToAuthFiles('session', JSON.stringify({
    accessToken: 'tok-abc',
    refreshToken: 'ref-1',
    user: { email: 'a@example.com' },
    account: { id: 'acc1' },
  }))
  assert.equal(out.files.length, 1)
  assert.equal(out.files[0].authJson.type, 'codex')
  assert.equal(out.files[0].authJson.access_token, 'tok-abc')
  assert.match(out.files[0].fileName, /codex-a@example\.com\.json/)
})

test('convertPasteToAuthFiles sub2api multi', () => {
  const out = convertPasteToAuthFiles('sub2api', JSON.stringify({
    accounts: [
      { email: 'u1@x.com', access_token: 't1' },
      { email: 'u2@x.com', access_token: 't2' },
    ],
  }))
  assert.equal(out.files.length, 2)
  assert.equal(out.convertedSourceCount, 2)
})

test('quotaSnapshots ingest + latest query', () => {
  const file = path.join(os.tmpdir(), `qs-${process.pid}-${Date.now()}.json`)
  try {
    const store = createQuotaSnapshotStore(file)
    store.ingest([
      { account: 'a.json', remaining_ratio: 0.8, provider: 'codex' },
      { account: 'a.json', remaining_ratio: 0.15, provider: 'codex' },
      { account: 'b.json', remaining_ratio: 0, provider: 'claude' },
    ])
    const q = store.query({ accounts: ['a.json', 'b.json'], latest_only: true })
    assert.equal(q.count, 2)
    const a = q.items.find((x) => x.account === 'a.json')
    assert.equal(a.remaining_ratio, 0.15)
    assert.equal(a.risk, 'critical')
    const b = q.items.find((x) => x.account === 'b.json')
    assert.equal(b.risk, 'exhausted')
  } finally {
    try {
      fs.unlinkSync(file)
    } catch {
      /* ignore */
    }
  }
})
