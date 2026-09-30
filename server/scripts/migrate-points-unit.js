#!/usr/bin/env node
/**
 * One-shot migration: point-denominated data files raw → micro-points (unit_version 2).
 *
 * Before: balances / limits / configs were stored as raw (1 点 = N raw, N configurable), so every
 * change of N silently rescaled them. After: stored as mp (1 点 = 1,000,000 mp, fixed); only
 * per-call pricing follows N. Each category is interpreted at the N it was last entered/earned at.
 *
 * Usage:
 *   node server/scripts/migrate-points-unit.js --data DIR [--out DIR] [--dry-run] [--report FILE]
 *     [--balances-n 1000000]        site-credits users (balance, totals, checkins, redeemed) + wallet ledger
 *     [--credits-config-n 5000000]  site-credits config.daily_grant_min/max + codes[].quota
 *     [--groups-n 1000000]          user-groups quotas / model_quotas / promotion.min_used_quota
 *     [--keys-n 1000000]            user-keys remain_quota / used_quota / rate_limit_*
 *     [--timeline "ISO=N,ISO=N"] [--timeline-base 500000]
 *                                   per-event N for site-usage events, group usage events, key spend_log
 *     [--expect-current-n 5000000]  abort unless quota-unit.json N matches
 *
 * --out: copy DIR's files to OUT and migrate the copy (DIR untouched). Without --out and without
 * --dry-run the files in DIR are rewritten atomically (tmp + rename, mode 0600).
 * Idempotent: files already at unit_version 2 (ledger rows with points_mp) are left unchanged.
 * Prints numbers only (never keys / secrets).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { rawToMp, POINT_MP, UNIT_VERSION } from '../quotaUnit.js'
import { createWalletLedger } from '../walletLedger.js'
import { findLegacyUnitFiles } from '../pointsUnitGuard.js'

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : def
}
const num = (name, def) => {
  const v = Number(opt(name, def))
  if (!Number.isFinite(v) || v <= 0) throw new Error(`${name} must be a positive number`)
  return Math.round(v)
}

const srcDir = path.resolve(opt('--data', path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data')))
const outDir = opt('--out') ? path.resolve(opt('--out')) : null
const dryRun = args.includes('--dry-run')
const reportPath = opt('--report')
const N_BAL = num('--balances-n', 1_000_000)
const N_CFG = num('--credits-config-n', 1_000_000)
const N_GRP = num('--groups-n', 1_000_000)
const N_KEY = num('--keys-n', 1_000_000)
const TL_BASE = num('--timeline-base', 500_000)
const timeline = String(opt('--timeline', '') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const i = s.lastIndexOf('=')
    const at = Date.parse(s.slice(0, i))
    const n = Math.round(Number(s.slice(i + 1)))
    if (!Number.isFinite(at) || !(n > 0)) throw new Error(`bad --timeline entry: ${s}`)
    return { at, n }
  })
  .sort((a, b) => a.at - b.at)
const expectN = opt('--expect-current-n') ? num('--expect-current-n') : null

/** N in force at time t (ms). */
function nAt(tMs) {
  let n = TL_BASE
  for (const s of timeline) if (Number(tMs) >= s.at) n = s.n
  return n
}

const FILES = {
  credits: 'site-credits.json',
  groups: 'user-groups.json',
  keys: 'user-keys.json',
  ledger: 'wallet-ledger.jsonl',
  usage: 'site-usage.json',
  unit: 'quota-unit.json',
}

const workDir = outDir || srcDir
if (outDir) {
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 })
  for (const f of Object.values(FILES)) {
    const s = path.join(srcDir, f)
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(outDir, f))
  }
}
const P = (k) => path.join(workDir, FILES[k])

const report = {
  src: srcDir,
  work: workDir,
  dry_run: dryRun,
  params: { balances_n: N_BAL, credits_config_n: N_CFG, groups_n: N_GRP, keys_n: N_KEY, timeline_base: TL_BASE, timeline: timeline.map((t) => ({ at: new Date(t.at).toISOString(), n: t.n })) },
  files: {},
  rows: [],
}
const pts = (mp) => Math.round((mp / POINT_MP) * 1e6) / 1e6
function row(item, raw, n, mp) {
  report.rows.push({ item, raw, n, mp, points: pts(mp) })
}
function conv(raw, n, item) {
  const r = Math.max(0, Number(raw) || 0)
  const mp = rawToMp(r, n)
  if (item) row(item, r, n, mp)
  return mp
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}
const pending = []
function stage(p, text) {
  pending.push({ p, text })
}
function commit() {
  for (const { p, text } of pending) {
    const tmp = `${p}.migrate.${process.pid}.tmp`
    fs.writeFileSync(tmp, text, { mode: 0o600 })
    fs.renameSync(tmp, p)
    fs.chmodSync(p, 0o600)
  }
}

// ---- quota-unit.json ----
let currentN = null
if (fs.existsSync(P('unit'))) {
  const qu = readJson(P('unit'))
  currentN = Number(qu.quota_per_unit) || null
  if (expectN && currentN !== expectN) throw new Error(`quota-unit N=${currentN} ≠ --expect-current-n ${expectN}; abort`)
  if (qu.account_unit_version !== UNIT_VERSION) {
    const hist = Array.isArray(qu.history) ? qu.history.slice() : []
    let prev = TL_BASE
    for (const t of timeline) {
      if (!hist.some((h) => Date.parse(h.at) === t.at)) hist.push({ at: new Date(t.at).toISOString(), from: prev, to: t.n, operator: 'reconstructed(migrate-points-unit)' })
      prev = t.n
    }
    hist.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    qu.history = hist
    qu.account_unit_version = UNIT_VERSION
    stage(P('unit'), JSON.stringify(qu, null, 2))
    report.files.unit = { current_n: currentN, history: hist.length }
  } else report.files.unit = { current_n: currentN, already: true }
}

// ---- wallet-ledger.jsonl ----
// Per-row N: backfill rows (reconstructed history, raw_per_point stamped at backfill time) use
// --balances-n; live rows use the raw_per_point recorded when they were written (true N at the time).
let ledgerText = null
const ledgerRows = []
if (fs.existsSync(P('ledger'))) {
  let conv_n = 0
  let kept = 0
  const out = []
  for (const line of fs.readFileSync(P('ledger'), 'utf8').split('\n')) {
    if (!line.trim()) continue
    const e = JSON.parse(line)
    if (e.points_mp == null) {
      const n = e.source === 'live' && Number(e.raw_per_point) > 0 ? Number(e.raw_per_point) : N_BAL
      e.points_mp = conv(e.raw, n)
      e.unit_version = UNIT_VERSION
      e.migrated_n = n
      conv_n += 1
      row(`ledger ${e.ts} ${e.source || ''} ${e.channel} ${e.direction}`, Number(e.raw) || 0, n, e.points_mp)
    } else kept += 1
    ledgerRows.push(e)
    out.push(JSON.stringify(e))
  }
  ledgerText = out.join('\n') + (out.length ? '\n' : '')
  if (conv_n) stage(P('ledger'), ledgerText)
  report.files.ledger = { converted: conv_n, already: kept }
}

// ---- site-credits.json ----
let creditsAfter = null
if (fs.existsSync(P('credits'))) {
  const d = readJson(P('credits'))
  if (Number(d.unit_version) === UNIT_VERSION) {
    report.files.credits = { already: true }
    creditsAfter = d
  } else {
    const c = d.config || {}
    c.daily_grant_min = conv(c.daily_grant_min, N_CFG, 'credits.config.daily_grant_min')
    c.daily_grant_max = conv(c.daily_grant_max, N_CFG, 'credits.config.daily_grant_max')
    c.note = '签到与兑换码发放本站额度（点）；点数不随价格换算比例变化。日界 Asia/Shanghai。'
    d.config = c
    for (const code of d.codes || []) {
      code.quota = conv(code.quota, N_CFG, `credits.codes[${String(code.code).slice(0, 3)}***].quota`)
    }
    for (const [uid, u] of Object.entries(d.users || {})) {
      const tag = `credits.users[${uid}]`
      // Prefer exact per-row conversion when the ledger fully reconciles with the raw totals.
      const rows = ledgerRows.filter((e) => String(e.user_id) === String(uid) && e.source !== 'backfill_adjust')
      const sumRaw = (f) => rows.filter(f).reduce((a, e) => a + (Number(e.raw) || 0), 0)
      const sumMp = (f) => rows.filter(f).reduce((a, e) => a + (Number(e.points_mp) || 0), 0)
      const isIn = (e) => e.direction === 'in'
      const isUse = (e) => e.direction === 'out' && e.channel === 'api_usage'
      const isDed = (e) => e.direction === 'out' && e.channel === 'admin_deduct'
      const isOut = (e) => e.direction === 'out'
      const reconciled =
        rows.length > 0 &&
        sumRaw(isIn) === (Number(u.granted_total) || 0) &&
        sumRaw(isOut) === (Number(u.consumed_total) || 0) + (Number(u.admin_deducted_total) || 0) &&
        sumRaw(isIn) - sumRaw(isOut) === (Number(u.balance) || 0)
      const before = { balance: u.balance, granted_total: u.granted_total, consumed_total: u.consumed_total, admin_deducted_total: u.admin_deducted_total || 0 }
      if (reconciled) {
        u.granted_total = sumMp(isIn)
        u.consumed_total = sumMp(isUse) + sumMp((e) => isOut(e) && !isUse(e) && !isDed(e))
        u.admin_deducted_total = sumMp(isDed)
        u.balance = u.granted_total - u.consumed_total - u.admin_deducted_total
        for (const k of ['balance', 'granted_total', 'consumed_total', 'admin_deducted_total']) {
          row(`${tag}.${k} (Σ ledger rows @ own N)`, Number(before[k]) || 0, 'per-row', u[k])
        }
      } else {
        report.warnings = [...(report.warnings || []), `${tag}: ledger does not reconcile with raw totals → scaled at --balances-n`]
        u.balance = conv(u.balance, N_BAL, `${tag}.balance`)
        u.granted_total = conv(u.granted_total, N_BAL, `${tag}.granted_total`)
        u.consumed_total = conv(u.consumed_total, N_BAL, `${tag}.consumed_total`)
        u.admin_deducted_total = conv(u.admin_deducted_total, N_BAL, `${tag}.admin_deducted_total`)
      }
      const rowN = (channel, ref) => {
        const e = rows.find((x) => x.channel === channel && String(x.ref_id) === String(ref))
        return e ? e.migrated_n || N_BAL : N_BAL
      }
      for (const ck of u.checkins || []) ck.quota_awarded = conv(ck.quota_awarded, rowN('checkin', ck.checkin_date), `${tag}.checkin ${ck.checkin_date}`)
      for (const [code, r] of Object.entries(u.redeemed || {})) {
        if (r && r.quota != null) r.quota = conv(r.quota, rowN('redeem', code), `${tag}.redeemed[${String(code).slice(0, 3)}***]`)
      }
    }
    d.unit_version = UNIT_VERSION
    d.unit_migrated_at = new Date().toISOString()
    stage(P('credits'), JSON.stringify(d, null, 2))
    creditsAfter = d
    report.files.credits = { users: Object.keys(d.users || {}).length, codes: (d.codes || []).length }
  }
}

// ---- user-groups.json ----
if (fs.existsSync(P('groups'))) {
  const d = readJson(P('groups'))
  if (Number(d.unit_version) === UNIT_VERSION) report.files.groups = { already: true }
  else {
    for (const g of d.groups || []) {
      const q = g.quotas || {}
      for (const k of ['window_5h', 'week', 'month']) q[k] = conv(q[k], N_GRP, `groups[${g.id}].${k}`)
      g.quotas = q
      for (const [m, v] of Object.entries(g.model_quotas || {})) g.model_quotas[m] = conv(v, N_GRP, `groups[${g.id}].model_quotas[${m}]`)
      if (g.promotion) g.promotion.min_used_quota = conv(g.promotion.min_used_quota, N_GRP, `groups[${g.id}].min_used_quota`)
    }
    let events = 0
    let rawSum = 0
    let mpSum = 0
    for (const [, u] of Object.entries(d.usage || {})) {
      const list = Array.isArray(u) ? u : u?.events || []
      for (const e of list) {
        const n = nAt(e.at)
        rawSum += Number(e.quota) || 0
        e.quota = conv(e.quota, n)
        mpSum += e.quota
        events += 1
      }
    }
    row(`groups.usage events (${events}, per-event N)`, rawSum, 'timeline', mpSum)
    d.unit_version = UNIT_VERSION
    d.unit_migrated_at = new Date().toISOString()
    stage(P('groups'), JSON.stringify(d, null, 2))
    report.files.groups = { groups: (d.groups || []).length, usage_events: events }
  }
}

// ---- user-keys.json ----
if (fs.existsSync(P('keys'))) {
  const d = readJson(P('keys'))
  if (Number(d.unit_version) === UNIT_VERSION) report.files.keys = { already: true }
  else {
    let tokens = 0
    const users = d.users && typeof d.users === 'object' ? d.users : {}
    for (const [uid, u] of Object.entries(users)) {
      for (const t of u?.tokens || []) {
        tokens += 1
        const tag = `keys[${String(uid).slice(-6)}#${t.id}]`
        t.remain_quota = conv(t.remain_quota, N_KEY, t.unlimited_quota ? null : `${tag}.remain_quota`)
        t.used_quota = conv(t.used_quota, N_KEY, `${tag}.used_quota`)
        for (const f of ['rate_limit_5h', 'rate_limit_1d', 'rate_limit_7d', 'rate_limit_30d']) {
          t[f] = conv(t[f], N_KEY, Number(t[f]) > 0 ? `${tag}.${f}` : null)
        }
        for (const s of t.spend_log || []) s.amount = conv(s.amount, nAt(Number(s.sec) * 1000))
      }
    }
    d.unit_version = UNIT_VERSION
    d.unit_migrated_at = new Date().toISOString()
    stage(P('keys'), JSON.stringify(d, null, 2))
    report.files.keys = { tokens }
  }
}

// ---- site-usage.json (history: points at the N of its time) ----
if (fs.existsSync(P('usage'))) {
  const d = readJson(P('usage'))
  let filled = 0
  let rawSum = 0
  let mpSum = 0
  for (const e of d.events || []) {
    if (e.points_mp != null) continue
    const n = nAt(Date.parse(e.ts) || 0)
    e.raw_per_point = n
    e.points_mp = conv(e.rawQuota ?? e.quota ?? 0, n)
    rawSum += Number(e.rawQuota ?? e.quota) || 0
    mpSum += e.points_mp
    filled += 1
  }
  if (filled) {
    row(`site-usage events (${filled}, per-event N)`, rawSum, 'timeline', mpSum)
    stage(P('usage'), JSON.stringify(d))
  }
  report.files.usage = { filled, events: (d.events || []).length }
}

// ---- verification (on the staged result, in a scratch dir) ----
const verifyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pts-verify-'))
try {
  for (const f of Object.values(FILES)) {
    const s = path.join(workDir, f)
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(verifyDir, f))
  }
  for (const { p, text } of pending) fs.writeFileSync(path.join(verifyDir, path.basename(p)), text, { mode: 0o600 })
  const legacy = findLegacyUnitFiles({
    creditsPath: path.join(verifyDir, FILES.credits),
    groupsPath: path.join(verifyDir, FILES.groups),
    keysPath: path.join(verifyDir, FILES.keys),
    ledgerPath: path.join(verifyDir, FILES.ledger),
  })
  const v = { legacy_files: legacy.map((l) => `${path.basename(l.file)}: ${l.reason}`) }
  if (creditsAfter && fs.existsSync(path.join(verifyDir, FILES.ledger))) {
    const ledger = createWalletLedger(path.join(verifyDir, FILES.ledger), { getRawPerPoint: () => currentN || 1 })
    v.backfill_rows = ledger.planBackfill(creditsAfter).length
    v.balance_check = Object.entries(creditsAfter.users || {}).map(([uid, u]) => {
      const rows = ledger.listForUser(uid)
      const net = rows.reduce((a, e) => a + (e.direction === 'in' ? e.points_mp : -e.points_mp), 0)
      return { user: uid, balance_mp: u.balance, ledger_net_mp: net, ok: net === u.balance }
    })
  } else if (creditsAfter) {
    const ledger = createWalletLedger(path.join(verifyDir, 'empty.jsonl'))
    v.backfill_rows_if_empty_ledger = ledger.planBackfill(creditsAfter).length
  }
  report.verify = v
} finally {
  fs.rmSync(verifyDir, { recursive: true, force: true })
}

if (!dryRun) commit()
report.written = dryRun ? [] : pending.map((x) => path.basename(x.p))
const text = JSON.stringify(report, null, 2)
if (reportPath) fs.writeFileSync(reportPath, text, { mode: 0o600 })
console.log(text)
if (report.verify.legacy_files.length || (report.verify.backfill_rows ?? 0) !== 0 || (report.verify.balance_check || []).some((b) => !b.ok)) {
  console.error('[migrate-points-unit] VERIFY FAILED')
  process.exit(2)
}
