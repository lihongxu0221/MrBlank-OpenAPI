import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCreditStore, shanghaiDay, CREDIT_QUOTA_UNIT as Q } from '../credits.js'

describe('credits check-in day boundary + redeem', () => {
  let dir
  let store

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-'))
    store = createCreditStore(path.join(dir, 'credits.json'))
    // deterministic grant
    store.saveConfig({ checkin_enabled: true, daily_grant_min: 2 * Q, daily_grant_max: 2 * Q })
    store.saveCodes([
      { code: 'WELCOME', quota: 5 * Q, once_per_user: true, enabled: true, max_uses: 0 },
      { code: 'MULTI', quota: Q, once_per_user: false, enabled: true, max_uses: 0 },
    ])
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('shanghaiDay returns YYYY-MM-DD (Asia/Shanghai calendar)', () => {
    const d = shanghaiDay()
    assert.match(d, /^\d{4}-\d{2}-\d{2}$/)
    // en-CA locale with Asia/Shanghai should match Intl
    const expected = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
    assert.equal(d, expected)
  })

  it('claimCheckin once per Shanghai day; second fails', () => {
    const uid = 'u-checkin'
    const first = store.claimCheckin(uid)
    assert.equal(first.ok, true)
    assert.equal(first.quota_awarded, 2 * Q)
    assert.equal(first.checkin_date, shanghaiDay())
    assert.equal(store.getBalance(uid), 2 * Q)
    const second = store.claimCheckin(uid)
    assert.equal(second.ok, false)
    assert.match(second.message, /已签到/)
    assert.equal(store.getBalance(uid), 2 * Q)
    assert.equal(store.hasCheckedInToday(uid), true)
  })

  it('redeem once_per_user blocks second use; unknown codes rejected (no DF-* mint)', () => {
    const uid = 'u-redeem'
    const r1 = store.redeem(uid, 'welcome')
    assert.equal(r1.ok, true)
    assert.equal(r1.awarded, 5 * Q)
    const r2 = store.redeem(uid, 'WELCOME')
    assert.equal(r2.ok, false)
    assert.match(r2.message, /已使用/)
    const ephemeral = store.redeem(uid, 'DF-FAKE-FREE-CREDITS')
    assert.equal(ephemeral.ok, false)
    assert.match(ephemeral.message, /无效/)
  })

  it('once_per_user=false allows repeat redeem for same user', () => {
    const uid = 'u-multi'
    assert.equal(store.redeem(uid, 'MULTI').ok, true)
    assert.equal(store.redeem(uid, 'MULTI').ok, true)
    assert.equal(store.getBalance(uid), 2 * Q)
  })

  it('consume deducts up to balance', () => {
    const uid = 'u-consume'
    store.adminGrant(uid, 100)
    const c = store.consume(uid, 40)
    assert.equal(c.deducted, 40)
    assert.equal(c.balance, 60)
    const c2 = store.consume(uid, 1000)
    assert.equal(c2.deducted, 60)
    assert.equal(c2.balance, 0)
  })
})
