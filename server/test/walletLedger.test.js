import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCreditStore, CREDIT_QUOTA_UNIT as Q } from '../credits.js'
import { createWalletLedger, detailText } from '../walletLedger.js'
import { shanghaiRangeBounds, shanghaiDayStart } from '../shanghaiRange.js'
import { requestIp } from '../requestIp.js'

const N = 1_000_000

describe('wallet ledger + credits instrumentation', () => {
  let dir
  let ledger
  let store
  const ledgerPath = () => path.join(dir, 'wallet-ledger.jsonl')

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-'))
    ledger = createWalletLedger(ledgerPath(), { getRawPerPoint: () => N })
    store = createCreditStore(path.join(dir, 'credits.json'), { getQuotaUnit: () => N, ledger })
    store.saveConfig({ checkin_enabled: true, daily_grant_min: 2 * N, daily_grant_max: 2 * N })
    store.saveCodes([{ code: 'WELCOME', quota: 5 * N, once_per_user: true, enabled: true }])
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('balance_after is continuous across checkin / redeem / consume / admin ops', () => {
    const uid = 'u1'
    store.claimCheckin(uid, { ip: '1.1.1.1' })
    store.redeem(uid, 'welcome', { ip: '2.2.2.2' })
    store.adminGrant(uid, 3 * N, '补偿', { ip: '9.9.9.9', operator: 'admin' })
    store.consume(uid, 1.5 * N, { ip: '3.3.3.3', ref_id: 'ev1', detail: { model: 'gpt-x', prompt_tokens: 10, completion_tokens: 5 } })
    store.adminDeduct(uid, N, '回收', { ip: '9.9.9.9', operator: 'admin' })
    const rows = ledger.listForUser(uid)
    assert.equal(rows.length, 5)
    let bal = 0
    for (const r of rows) {
      bal += r.direction === 'in' ? r.points_mp : -r.points_mp
      assert.equal(r.balance_after, bal, `balance_after mismatch at ${r.channel}`)
      assert.equal(r.raw_per_point, N)
      assert.equal(r.source, 'live')
    }
    assert.equal(bal, store.getBalance(uid))
    assert.deepEqual(
      rows.map((r) => r.channel),
      ['checkin', 'redeem', 'admin_grant', 'api_usage', 'admin_deduct'],
    )
    assert.equal(rows[0].ip, '1.1.1.1')
    assert.equal(rows[0].ref_id, rows[0].detail.checkin_date)
    assert.equal(rows[3].ref_id, 'ev1')
    // persisted and reloadable
    const again = createWalletLedger(ledgerPath(), { getRawPerPoint: () => N })
    assert.equal(again.listForUser(uid).length, 5)
    assert.equal((fs.statSync(ledgerPath()).mode & 0o777).toString(8), '600')
  })

  it('truncated consume records actual take; zero take writes nothing', () => {
    const uid = 'u2'
    store.adminGrant(uid, N)
    const r = store.consume(uid, 3 * N, { detail: { model: 'm' } })
    assert.equal(r.deducted, N)
    const rows = ledger.listForUser(uid)
    assert.equal(rows.length, 2)
    assert.equal(rows[1].points_mp, N)
    assert.equal(rows[1].detail.need, 3 * N)
    assert.equal(rows[1].balance_after, 0)
    assert.match(detailText(rows[1]), /余额不足按实扣/)
    // balance 0 → consume and deduct are no-ops
    assert.equal(store.consume(uid, N).deducted, 0)
    assert.equal(store.adminDeduct(uid, N).deducted, 0)
    store.consume(uid, 0)
    assert.equal(ledger.listForUser(uid).length, 2)
  })

  it('user view hides IP on admin operations; admin view shows operator', () => {
    const uid = 'u3'
    store.adminGrant(uid, N, 'x', { ip: '9.9.9.9', operator: 'boss' })
    store.claimCheckin(uid, { ip: '1.2.3.4' })
    const user = ledger.query({ user_id: uid, range: 'all' })
    const grant = user.items.find((i) => i.channel === 'admin_grant')
    const ck = user.items.find((i) => i.channel === 'checkin')
    assert.equal(grant.ip, null)
    assert.equal(grant.operator, undefined)
    assert.equal(ck.ip, '1.2.3.4')
    const adm = ledger.query({ user_id: uid, range: 'all' }, { admin: true })
    const g2 = adm.items.find((i) => i.channel === 'admin_grant')
    assert.equal(g2.ip, '9.9.9.9')
    assert.equal(g2.operator, 'boss')
  })

  it('no cross-user access: query without user_id returns nothing (non-admin)', () => {
    store.adminGrant('a', N)
    store.adminGrant('b', 2 * N)
    assert.equal(ledger.query({ range: 'all' }).total, 0)
    const a = ledger.query({ user_id: 'a', range: 'all' })
    assert.equal(a.total, 1)
    assert.ok(a.items.every((i) => i.amount_mp === N))
    assert.equal(ledger.query({ range: 'all' }, { admin: true }).total, 2)
  })

  it('direction / channel filters, pagination, summary, points fixed in mp', () => {
    const uid = 'u4'
    for (let i = 0; i < 7; i++) store.adminGrant(uid, N)
    store.redeem(uid, 'WELCOME')
    for (let i = 0; i < 3; i++) store.consume(uid, N / 2, { detail: { model: 'm' } })
    const all = ledger.query({ user_id: uid, range: 'all', page_size: 5 })
    assert.equal(all.total, 11)
    assert.equal(all.items.length, 5)
    assert.equal(ledger.query({ user_id: uid, range: 'all', page_size: 5, p: 3 }).items.length, 1)
    assert.equal(all.summary.in_mp, 12 * N)
    assert.equal(all.summary.out_mp, 1.5 * N)
    assert.equal(ledger.query({ user_id: uid, range: 'all', direction: 'out' }).total, 3)
    assert.equal(ledger.query({ user_id: uid, range: 'all', direction: 'in' }).total, 8)
    assert.equal(ledger.query({ user_id: uid, range: 'all', channel: 'redeem' }).total, 1)
    assert.equal(ledger.query({ user_id: uid, range: 'all', channel: '兑换' }).total, 1)
    assert.equal(ledger.query({ user_id: uid, range: 'all', channel: 'API' }).total, 3)
    assert.equal(ledger.query({ user_id: uid, range: 'all', channel: '管理员发放' }).total, 7)
    const item = ledger.query({ user_id: uid, range: 'all', channel: 'redeem' }).items[0]
    assert.equal(item.points, 5)
    assert.equal(item.direction_label, '收入')
    assert.equal(item.channel_label, '兑换码')
    // newest first
    const ts = all.items.map((i) => Date.parse(i.ts))
    assert.deepEqual(ts, [...ts].sort((x, y) => y - x))
    // channel options include used flags
    const opts = ledger.channelOptions(uid)
    assert.ok(opts.find((o) => o.value === 'redeem').used)
    assert.ok(!opts.find((o) => o.value === 'checkin').used)
  })

  it('backfill: checkins + redeems + diff row, idempotent across reloads', () => {
    const plain = createWalletLedger(path.join(dir, 'bf.jsonl'), { getRawPerPoint: () => N })
    const doc = {
      users: {
        u9: {
          balance: 0,
          granted_total: 926870187 + 266595408 + 5 * N + 7 * N,
          consumed_total: 2 * N,
          checkins: [
            { checkin_date: '2026-09-23', quota_awarded: 926870187, at: '2026-09-23T11:11:44.100Z' },
            { checkin_date: '2026-09-28', quota_awarded: 266595408, at: '2026-09-28T07:13:50.266Z' },
          ],
          redeemed: { WELCOME: { at: '2026-09-24T00:00:00.000Z', quota: 5 * N } },
        },
      },
    }
    const dry = plain.backfill(doc, { dryRun: true })
    assert.equal(dry.length, 5)
    assert.equal(plain.size, 0, 'dry run writes nothing')
    const rows = plain.backfill(doc)
    assert.equal(rows.length, 5)
    assert.ok(rows.every((r) => r.source === 'backfill'))
    const adjIn = rows.find((r) => r.channel === 'backfill_adjust' && r.direction === 'in')
    assert.equal(adjIn.points_mp, 7 * N)
    const adjOut = rows.find((r) => r.channel === 'backfill_adjust' && r.direction === 'out')
    assert.equal(adjOut.points_mp, 2 * N)
    assert.equal(rows.find((r) => r.ref_id === '2026-09-23').ts, '2026-09-23T11:11:44.100Z')
    assert.equal(plain.backfill(doc).length, 0, 'second run no-op')
    const reloaded = createWalletLedger(path.join(dir, 'bf.jsonl'), { getRawPerPoint: () => N })
    assert.equal(reloaded.backfill(doc).length, 0, 'reload + rerun no-op')
    assert.equal(reloaded.size, 5)
  })

  it('points are fixed at write time: changing N never rescales ledger rows', () => {
    let n = 1_000_000
    const l = createWalletLedger(path.join(dir, 'n.jsonl'), { getRawPerPoint: () => n })
    const s2 = createCreditStore(path.join(dir, 'c2.json'), { getQuotaUnit: () => n, ledger: l })
    s2.adminGrant('z', 3_000_000) // 3 点
    n = 5_000_000
    const q = l.query({ user_id: 'z', range: 'all' })
    assert.equal(q.items[0].points, 3)
    assert.equal(q.summary.in_points, 3)
    assert.equal(s2.getBalance('z'), 3_000_000)
    // legacy raw-only rows are rejected (must be migrated)
    fs.appendFileSync(path.join(dir, 'n.jsonl'), JSON.stringify({ user_id: 'z', direction: 'in', channel: 'checkin', raw: 5 }) + '\n')
    assert.equal(createWalletLedger(path.join(dir, 'n.jsonl')).listForUser('z').length, 1)
  })

  it('backfill after live rows does not duplicate live check-ins', () => {
    const uid = 'live'
    store.claimCheckin(uid, { ip: '1.1.1.1' })
    store.redeem(uid, 'WELCOME')
    const rows = ledger.backfill(store.exportDoc())
    assert.equal(rows.length, 0)
  })
})

describe('Asia/Shanghai range bounds', () => {
  // 2026-09-30 01:30 Shanghai == 2026-09-29T17:30Z
  const now = Date.parse('2026-09-29T17:30:00Z')
  const at = (s) => Date.parse(s)

  it('today / yesterday are exact +08:00 calendar days (yesterday excludes today)', () => {
    assert.equal(shanghaiDayStart(now), at('2026-09-30T00:00:00+08:00'))
    const t = shanghaiRangeBounds({ range: 'today' }, now)
    assert.equal(t.from, at('2026-09-30T00:00:00+08:00'))
    const y = shanghaiRangeBounds({ range: 'yesterday' }, now)
    assert.equal(y.from, at('2026-09-29T00:00:00+08:00'))
    assert.equal(y.to, at('2026-09-30T00:00:00+08:00') - 1)
  })

  it('month / last_month use Shanghai months (incl. Jan rollover)', () => {
    const m = shanghaiRangeBounds({ range: 'month' }, now)
    assert.equal(m.from, at('2026-09-01T00:00:00+08:00'))
    assert.equal(m.to, at('2026-10-01T00:00:00+08:00') - 1)
    const lm = shanghaiRangeBounds({ range: 'last_month' }, now)
    assert.equal(lm.from, at('2026-08-01T00:00:00+08:00'))
    assert.equal(lm.to, at('2026-09-01T00:00:00+08:00') - 1)
    // 2027-01-01 00:10 Shanghai = 2026-12-31T16:10Z (UTC still December)
    const jan = Date.parse('2026-12-31T16:10:00Z')
    assert.equal(shanghaiRangeBounds({ range: 'month' }, jan).from, at('2027-01-01T00:00:00+08:00'))
    const ljan = shanghaiRangeBounds({ range: 'last_month' }, jan)
    assert.equal(ljan.from, at('2026-12-01T00:00:00+08:00'))
    assert.equal(ljan.to, at('2027-01-01T00:00:00+08:00') - 1)
  })

  it('rolling + custom + default', () => {
    assert.equal(shanghaiRangeBounds({ range: '24h' }, now).from, now - 86400000)
    assert.equal(shanghaiRangeBounds({ range: '7d' }, now).from, now - 7 * 86400000)
    assert.equal(shanghaiRangeBounds({}, now).from, now - 30 * 86400000)
    const c = shanghaiRangeBounds({ range: 'custom', start_date: '2026-09-23', end_date: '2026-09-28' }, now)
    assert.equal(c.from, at('2026-09-23T00:00:00+08:00'))
    assert.equal(c.to, at('2026-09-29T00:00:00+08:00') - 1)
    const sw = shanghaiRangeBounds({ range: 'custom', start_date: '2026-09-28', end_date: '2026-09-23' }, now)
    assert.deepEqual(sw, c, 'swapped dates normalized')
    assert.equal(shanghaiRangeBounds({ range: 'all' }, now).from, 0)
  })

  it('ledger range filter honours Shanghai day edges', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wlr-'))
    try {
      const l = createWalletLedger(path.join(dir, 'l.jsonl'), { getRawPerPoint: () => N })
      const mk = (ts) => l.append({ user_id: 'u', ts, direction: 'in', channel: 'checkin', points_mp: N })
      mk('2026-09-29T15:59:59.999Z') // 09-29 23:59:59.999 SH → yesterday
      mk('2026-09-29T16:00:00.000Z') // 09-30 00:00 SH → today
      mk('2026-08-31T15:59:59.000Z') // 08-31 23:59:59 SH → last month
      mk('2026-08-31T16:00:00.000Z') // 09-01 00:00 SH → this month
      const q = (range, extra = {}) => l.query({ user_id: 'u', range, ...extra }, { now }).total
      assert.equal(q('today'), 1)
      assert.equal(q('yesterday'), 1)
      assert.equal(q('month'), 3)
      assert.equal(q('last_month'), 1)
      assert.equal(q('custom', { start_date: '2026-09-29', end_date: '2026-09-29' }), 1)
      assert.equal(q('custom', { start_date: '2026-09-01', end_date: '2026-09-30' }), 3)
      assert.equal(q('all'), 4)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('requestIp (no first-XFF spoofing)', () => {
  it('prefers X-Real-IP, then req.ip, then right-most XFF', () => {
    assert.equal(requestIp({ headers: { 'x-real-ip': '5.5.5.5', 'x-forwarded-for': '6.6.6.6, 5.5.5.5' }, ip: '127.0.0.1' }), '5.5.5.5')
    assert.equal(requestIp({ headers: { 'x-forwarded-for': '6.6.6.6, 7.7.7.7' }, ip: '7.7.7.7' }), '7.7.7.7')
    assert.equal(requestIp({ headers: { 'x-forwarded-for': '6.6.6.6, 7.7.7.7' } }), '7.7.7.7')
    assert.equal(requestIp({ headers: {}, socket: { remoteAddress: '::ffff:10.0.0.1' } }), '10.0.0.1')
  })

  it('ignores proxy headers from a non-loopback peer (direct exposure)', () => {
    const direct = { headers: { 'x-real-ip': '5.5.5.5', 'x-forwarded-for': '6.6.6.6' }, ip: '6.6.6.6', socket: { remoteAddress: '::ffff:203.0.113.9' } }
    assert.equal(requestIp(direct), '203.0.113.9')
    const viaNginx = { headers: { 'x-real-ip': '5.5.5.5' }, ip: '127.0.0.1', socket: { remoteAddress: '::ffff:127.0.0.1' } }
    assert.equal(requestIp(viaNginx), '5.5.5.5')
  })
})
