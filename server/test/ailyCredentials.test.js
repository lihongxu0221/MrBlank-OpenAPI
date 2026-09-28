import { describe, it, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createAilyCredentialsStore } from '../ailyCredentials.js'

describe('ailyCredentials pool + round-robin', () => {
  let file
  let authFile
  let store

  beforeEach(() => {
    file = path.join(os.tmpdir(), `aily-creds-${process.pid}-${Date.now()}.json`)
    authFile = path.join(os.tmpdir(), `aily-auth-${process.pid}-${Date.now()}.json`)
    try {
      fs.unlinkSync(file)
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(authFile)
    } catch {
      /* ignore */
    }
    store = createAilyCredentialsStore(file, { strategy: 'round-robin' })
  })

  after(() => {
    for (const f of [file, authFile]) {
      try {
        fs.unlinkSync(f)
      } catch {
        /* ignore */
      }
    }
  })

  it('CRUD + masks tokens in listPublic', () => {
    const a = store.create({
      name: 'Mock A',
      email: 'a@example.com',
      access_token: 'tok_access_aaaa1111bbbb2222',
      refresh_token: 'tok_refresh_cccc3333dddd4444',
      priority: 10,
    })
    assert.equal(a.id, 1)
    assert.equal(a.has_access_token, true)
    assert.ok(a.access_preview.includes('****'))
    assert.ok(!a.access_preview.includes('aaaa1111'))
    const list = store.listPublic()
    assert.equal(list.length, 1)
    assert.equal(list[0].access_preview.includes('tok_access_aaaa'), false)
    store.update(a.id, { remark: 'note', priority: 5 })
    assert.equal(store.get(a.id).priority, 5)
    store.remove(a.id)
    assert.equal(store.get(a.id), null)
  })

  it('migrate .aily → account #1 only when pool empty', () => {
    fs.writeFileSync(
      authFile,
      JSON.stringify({
        access_token: 'mig_access_token_xxxxxxxx',
        refresh_token: 'mig_refresh_token_yyyyyyyy',
        email: 'legacy@example.com',
        updated_at: '2026-01-01T00:00:00.000Z',
      }),
      'utf8',
    )
    const r1 = store.migrateFromAuthFile(authFile)
    assert.equal(r1.migrated, true)
    assert.equal(r1.account.id, 1)
    assert.equal(r1.account.email, 'legacy@example.com')
    assert.equal(store.loadAccounts().length, 1)

    // second migrate must NOT overwrite
    const r2 = store.migrateFromAuthFile(authFile)
    assert.equal(r2.migrated, false)
    assert.equal(r2.reason, 'pool_not_empty')
    assert.equal(store.loadAccounts().length, 1)
  })

  it('never silently overwrite sole slot on create', () => {
    const a1 = store.create({
      name: 'Only',
      access_token: 'token_one_aaaaaaaa',
      refresh_token: 'refresh_one_bbbbbbbb',
    })
    const a2 = store.create({
      name: 'Second',
      access_token: 'token_two_cccccccc',
      refresh_token: 'refresh_two_dddddddd',
    })
    assert.notEqual(a1.id, a2.id)
    assert.equal(store.loadAccounts().length, 2)
    assert.equal(store.get(a1.id).access_token.startsWith('token_one'), true)
  })

  it('round-robin picks alternate among same priority', () => {
    store.create({
      name: 'A',
      access_token: 'tok_a_111111111111',
      priority: 100,
    })
    store.create({
      name: 'B',
      access_token: 'tok_b_222222222222',
      priority: 100,
    })
    store.resetRoundRobin()
    const p1 = store.pickAilyAccount()
    const p2 = store.pickAilyAccount()
    const p3 = store.pickAilyAccount()
    assert.ok(p1 && p2 && p3)
    assert.notEqual(p1.id, p2.id)
    assert.equal(p1.id, p3.id)
  })

  it('respects priority (lower first); RR within bucket', () => {
    store.create({ name: 'low', access_token: 'tok_l_111111111111', priority: 10 })
    store.create({ name: 'high', access_token: 'tok_h_222222222222', priority: 200 })
    store.create({ name: 'low2', access_token: 'tok_l2_33333333333', priority: 10 })
    store.resetRoundRobin()
    const picks = [store.pickAilyAccount(), store.pickAilyAccount(), store.pickAilyAccount()]
    assert.ok(picks.every((p) => p.priority === 10))
    assert.notEqual(picks[0].id, picks[1].id)
  })

  it('disable removes from schedulable pool', () => {
    const a = store.create({ name: 'A', access_token: 'tok_a_111111111111', priority: 100 })
    const b = store.create({ name: 'B', access_token: 'tok_b_222222222222', priority: 100 })
    store.update(a.id, { enabled: false })
    store.resetRoundRobin()
    const p1 = store.pickAilyAccount()
    const p2 = store.pickAilyAccount()
    assert.equal(p1.id, b.id)
    assert.equal(p2.id, b.id)
    assert.equal(store.poolMetrics().schedulable, 1)
    assert.equal(store.poolMetrics().disabled, 1)
  })

  it('cooldown marks unschedulable then failover exclude works', () => {
    const a = store.create({ name: 'A', access_token: 'tok_a_111111111111' })
    const b = store.create({ name: 'B', access_token: 'tok_b_222222222222' })
    store.markUnschedulable(a.id, 'HTTP 429', 60_000)
    store.resetRoundRobin()
    const picked = store.pickAilyAccount()
    assert.equal(picked.id, b.id)
    const excluded = store.pickAilyAccount({ excludeIds: [b.id] })
    assert.equal(excluded, null)
    store.clearCooldown(a.id)
    assert.equal(store.isSchedulable(store.get(a.id)), true)
  })

  it('poolMetrics reports strategy', () => {
    store.create({ name: 'A', access_token: 'tok_a_111111111111' })
    const m = store.poolMetrics()
    assert.equal(m.total, 1)
    assert.equal(m.strategy, 'round-robin')
    assert.equal(m.with_token, 1)
  })
})
