import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  createQuotaUnitStore,
  usdToMp,
  rawToMp,
  pointsToMp,
  mpToPoints,
  POINT_MP,
  UNIT_VERSION,
} from '../quotaUnit.js'
import { createCreditStore } from '../credits.js'
import { createGroupStore } from '../groups.js'
import { createUserKeyStore } from '../userKeys.js'
import { createWalletLedger } from '../walletLedger.js'
import { createModelPricesStore } from '../modelPrices.js'
import { findLegacyUnitFiles } from '../pointsUnitGuard.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p))

test('billing: points charged = USD × 500000 ÷ N (mp = ×1e6), follows N', () => {
  assert.equal(POINT_MP, 1_000_000)
  assert.equal(usdToMp(1, 500_000), 1_000_000) // $1 = 1 点 @0.5M
  assert.equal(usdToMp(1, 1_000_000), 500_000) // $1 = 0.5 点 @1M
  assert.equal(usdToMp(1, 5_000_000), 100_000) // $1 = 0.1 点 @5M
  assert.equal(usdToMp(0.002, 1_000_000), 1000)
  assert.equal(usdToMp(0, 1_000_000), 0)
  assert.equal(rawToMp(1_255_563_630, 1_000_000), 1_255_563_630)
  assert.equal(rawToMp(49_995_000_000, 5_000_000), 9_999_000_000)
  assert.equal(pointsToMp(2.5), 2_500_000)
  assert.equal(mpToPoints(11_254_563_630), 11254.56363)
})

test('changing N reprices + logs, but balances and every point-denominated setting stay constant', () => {
  const dir = tmp('pts-n-')
  try {
    const unit = createQuotaUnitStore(path.join(dir, 'quota-unit.json'))
    unit.setUnit(1_000_000, { operator: 'admin' })
    const ledger = createWalletLedger(path.join(dir, 'wl.jsonl'), { getRawPerPoint: () => unit.getUnit() })
    const credits = createCreditStore(path.join(dir, 'credits.json'), { getQuotaUnit: () => unit.getUnit(), ledger })
    const groups = createGroupStore(path.join(dir, 'groups.json'), { getQuotaUnit: () => unit.getUnit() })
    const keys = createUserKeyStore(path.join(dir, 'keys.json'))
    const prices = createModelPricesStore(path.join(dir, 'prices.json'), { getQuotaUnit: () => unit.getUnit() })

    credits.saveConfig({ daily_grant_min: pointsToMp(2), daily_grant_max: pointsToMp(100) })
    credits.saveCodes([{ code: 'VIP', quota: pointsToMp(9999), enabled: true }])
    credits.adminGrant('u1', pointsToMp(1255.56363))
    credits.redeem('u1', 'VIP')
    groups.saveGroups([{ id: 'g', name: 'g', quotas: { window_5h: pointsToMp(10), week: pointsToMp(50), month: pointsToMp(150) }, promotion: { min_used_quota: pointsToMp(50) } }])
    const tok = keys.create('u1', { name: 'k', remain_quota: pointsToMp(20), rate_limit_enabled: true, rate_limit_5h: pointsToMp(3) })

    const snap = () => ({
      bal: credits.getBalance('u1'),
      cfg: credits.getConfig(),
      code: credits.listCodes()[0].quota,
      grp: groups.listGroups()[0].quotas,
      promo: groups.listGroups()[0].promotion.min_used_quota,
      key: (() => {
        const t = keys.list('u1').find((x) => x.id === (tok?.id ?? tok?.token?.id)) || keys.list('u1')[0]
        return [t.remain_quota, t.rate_limit_5h]
      })(),
      ledgerPts: ledger.query({ user_id: 'u1', range: 'all' }).summary.in_points,
    })
    const before = snap()
    assert.equal(mpToPoints(before.bal), 1255.56363 + 9999)
    assert.equal(before.ledgerPts, 1255.56363 + 9999)

    const priceBefore = prices.getPrices()
    unit.setUnit(5_000_000, { operator: 'admin' })
    try {
      prices.recomputeQuotaFields()
    } catch {
      /* empty book */
    }
    assert.deepEqual(snap(), before, 'N change must not touch balances / configs / limits / ledger')
    assert.equal(unit.get().history.at(-1).from, 1_000_000)
    assert.equal(unit.get().history.at(-1).to, 5_000_000)
    assert.equal(unit.get().history.at(-1).operator, 'admin')
    // Per-call charge DOES follow N
    assert.equal(unit.usdToMp(1), 100_000)
    unit.setUnit('1M')
    assert.equal(unit.usdToMp(1), 500_000)
    assert.deepEqual(snap(), before)
    assert.ok(priceBefore)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('group windows compare mp usage against mp limits regardless of N', () => {
  const dir = tmp('pts-g-')
  try {
    let n = 1_000_000
    const groups = createGroupStore(path.join(dir, 'groups.json'), { getQuotaUnit: () => n })
    groups.saveGroups([{ id: 'g', name: 'g', level: 1, quotas: { window_5h: pointsToMp(1), week: pointsToMp(10), month: pointsToMp(10) } }])
    groups.recordUsage('u', { quota: usdToMp(1, n), requests: 1 }) // 0.5 点 @1M
    assert.equal(groups.assertQuotaAvailable('u', {}).ok, true)
    n = 5_000_000
    groups.recordUsage('u', { quota: usdToMp(1, n), requests: 1 }) // 0.1 点 @5M
    const info = groups.assertQuotaAvailable('u', {})
    assert.equal(info.ok, true)
    groups.recordUsage('u', { quota: usdToMp(2, n) * 2, requests: 1 }) // +0.4 → 1.0 点 used
    assert.equal(groups.assertQuotaAvailable('u', {}).ok, false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('legacy raw-unit files: guard detects them and stores refuse to stamp them', () => {
  const dir = tmp('pts-legacy-')
  try {
    const c = path.join(dir, 'site-credits.json')
    const g = path.join(dir, 'user-groups.json')
    const k = path.join(dir, 'user-keys.json')
    const l = path.join(dir, 'wallet-ledger.jsonl')
    fs.writeFileSync(c, JSON.stringify({ config: {}, codes: [], users: { u: { balance: 5 } } }))
    fs.writeFileSync(g, JSON.stringify({ groups: [], members: {}, usage: {} }))
    fs.writeFileSync(k, JSON.stringify({ users: {} }))
    fs.writeFileSync(l, JSON.stringify({ user_id: 'u', direction: 'in', channel: 'checkin', raw: 5 }) + '\n')
    const legacy = findLegacyUnitFiles({ creditsPath: c, groupsPath: g, keysPath: k, ledgerPath: l })
    assert.equal(legacy.length, 4)
    const credits = createCreditStore(c)
    assert.throws(() => credits.adminGrant('u', 1), /legacy/)
    const groups = createGroupStore(g)
    assert.throws(() => groups.saveGroups([{ id: 'x' }]), /legacy/)
    // fresh files are created at unit_version 2
    const fresh = createCreditStore(path.join(dir, 'fresh.json'))
    fresh.adminGrant('u', 1)
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'fresh.json'), 'utf8')).unit_version, UNIT_VERSION)
    assert.equal(findLegacyUnitFiles({ creditsPath: path.join(dir, 'fresh.json') }).length, 0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('migrate-points-unit: per-category N, per-row ledger N, backfill 0 rows, idempotent, --out leaves source', () => {
  const dir = tmp('pts-mig-')
  try {
    const src = path.join(dir, 'src')
    const out = path.join(dir, 'out')
    fs.mkdirSync(src)
    const w = (f, o) => fs.writeFileSync(path.join(src, f), typeof o === 'string' ? o : JSON.stringify(o))
    w('quota-unit.json', { version: 1, quota_per_unit: 1_000_000 })
    w('site-credits.json', {
      config: { checkin_enabled: true, daily_grant_min: 10_000_000, daily_grant_max: 500_000_000 },
      codes: [{ code: 'VIP', quota: 49_995_000_000, enabled: true }],
      users: {
        u: {
          balance: 51_250_563_630,
          granted_total: 51_250_563_630,
          consumed_total: 0,
          checkins: [{ checkin_date: '2026-09-23', quota_awarded: 1_255_563_630 }],
          redeemed: { VIP: { quota: 49_995_000_000 } },
        },
      },
    })
    w(
      'wallet-ledger.jsonl',
      [
        { id: 'a', user_id: 'u', ts: '2026-09-23T11:11:44.100Z', direction: 'in', channel: 'checkin', raw: 1_255_563_630, raw_per_point: 1_000_000, ref_id: '2026-09-23', source: 'backfill' },
        { id: 'b', user_id: 'u', ts: '2026-09-30T02:51:35.259Z', direction: 'in', channel: 'redeem', raw: 49_995_000_000, raw_per_point: 5_000_000, ref_id: 'VIP', source: 'live' },
      ]
        .map((x) => JSON.stringify(x))
        .join('\n') + '\n',
    )
    w('user-groups.json', {
      groups: [{ id: 'newcomer', quotas: { window_5h: 10_000_000, week: 50_000_000, month: 150_000_000 }, model_quotas: { m: 3_000_000 }, promotion: { min_used_quota: 500_000 } }],
      members: {},
      usage: { u: { events: [{ at: Date.parse('2026-09-29T12:00:00Z'), quota: 1000 }, { at: Date.parse('2026-09-30T02:50:00Z'), quota: 5000 }] } },
    })
    w('user-keys.json', { users: { u: { tokens: [{ id: 1, remain_quota: 20_000_000, used_quota: 7, rate_limit_5h: 3_000_000, spend_log: [{ sec: 1_790_000_000, amount: 7 }] }] } } })
    w('site-usage.json', { version: 1, events: [{ ts: '2026-09-28T00:00:00Z', rawQuota: 500_000 }, { ts: '2026-09-29T12:00:00Z', rawQuota: 1_000_000 }] })

    const script = path.join(__dirname, '..', 'scripts', 'migrate-points-unit.js')
    const argv = [script, '--data', src, '--out', out, '--balances-n', '1000000', '--credits-config-n', '5000000', '--groups-n', '1000000', '--keys-n', '1000000', '--timeline-base', '500000', '--timeline', '2026-09-29T01:39:47.329Z=1000000,2026-09-30T02:44:28.550Z=5000000,2026-09-30T02:55:42.516Z=1000000', '--expect-current-n', '1000000']
    const before = fs.readFileSync(path.join(src, 'site-credits.json'), 'utf8')
    const rep = JSON.parse(execFileSync(process.execPath, argv, { encoding: 'utf8' }))
    assert.equal(fs.readFileSync(path.join(src, 'site-credits.json'), 'utf8'), before, 'source untouched with --out')
    assert.equal(rep.verify.backfill_rows, 0)
    assert.deepEqual(rep.verify.legacy_files, [])
    const rd = (f) => JSON.parse(fs.readFileSync(path.join(out, f), 'utf8'))
    const c = rd('site-credits.json')
    assert.equal(c.unit_version, 2)
    assert.equal(c.config.daily_grant_min, 2_000_000) // 2 点
    assert.equal(c.config.daily_grant_max, 100_000_000) // 100 点
    assert.equal(c.codes[0].quota, 9_999_000_000) // 9999 点
    assert.equal(c.users.u.balance, 1_255_563_630 + 9_999_000_000) // 1255.56 @1M + 9999 @5M
    assert.equal(c.users.u.redeemed.VIP.quota, 9_999_000_000)
    const g = rd('user-groups.json')
    assert.deepEqual(g.groups[0].quotas, { window_5h: 10_000_000, week: 50_000_000, month: 150_000_000 })
    assert.equal(g.groups[0].model_quotas.m, 3_000_000)
    assert.equal(g.groups[0].promotion.min_used_quota, 500_000)
    assert.deepEqual(g.usage.u.events.map((e) => e.quota), [1000, 1000]) // 2nd event at N=5M → /5
    const k = rd('user-keys.json')
    assert.equal(k.users.u.tokens[0].remain_quota, 20_000_000)
    const u = rd('site-usage.json')
    assert.deepEqual(u.events.map((e) => [e.raw_per_point, e.points_mp]), [[500_000, 1_000_000], [1_000_000, 1_000_000]])
    assert.equal(rd('quota-unit.json').account_unit_version, 2)
    // stores open the migrated data; ledger shows fixed points
    const ledger = createWalletLedger(path.join(out, 'wallet-ledger.jsonl'))
    assert.equal(ledger.query({ user_id: 'u', range: 'all' }).summary.in_points, 1255.56363 + 9999)
    // idempotent
    const again = JSON.parse(execFileSync(process.execPath, [script, '--data', out, '--credits-config-n', '5000000'], { encoding: 'utf8' }))
    assert.equal(again.files.credits.already, true)
    assert.equal(again.files.ledger.converted, 0)
    assert.equal(rd('site-credits.json').users.u.balance, 1_255_563_630 + 9_999_000_000)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
