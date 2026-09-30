#!/usr/bin/env node
/**
 * Wallet ledger backfill / reconcile (idempotent; rows tagged source:'backfill').
 * The server also runs this automatically at startup.
 *
 * Usage:
 *   node server/scripts/backfill-wallet.js [--data DIR] [--credits FILE] [--ledger FILE] [--dry-run]
 * Defaults: DIR = server/data; credits = DIR/site-credits.json; ledger = DIR/wallet-ledger.jsonl.
 * Prints counts/totals only (no user secrets). Amounts are mp (1 点 = 1e6 mp; unit_version 2).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWalletLedger } from '../walletLedger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const dataDir = path.resolve(opt('--data') || path.join(__dirname, '..', 'data'))
const creditsPath = path.resolve(opt('--credits') || path.join(dataDir, 'site-credits.json'))
const ledgerPath = path.resolve(opt('--ledger') || path.join(dataDir, 'wallet-ledger.jsonl'))
const dryRun = args.includes('--dry-run')

let rawPerPoint = 500000
try {
  const qu = JSON.parse(fs.readFileSync(path.join(dataDir, 'quota-unit.json'), 'utf8'))
  if (Number(qu.quota_per_unit) > 0) rawPerPoint = Number(qu.quota_per_unit)
} catch {
  /* default */
}

const doc = JSON.parse(fs.readFileSync(creditsPath, 'utf8'))
if (Number(doc.unit_version) !== 2) {
  console.error('site-credits.json is legacy (raw units); run server/scripts/migrate-points-unit.js first')
  process.exit(78)
}
const ledger = createWalletLedger(ledgerPath, { getRawPerPoint: () => rawPerPoint })
const rows = ledger.backfill(doc, { dryRun })
const byChannel = {}
let inMp = 0
let outMp = 0
for (const r of rows) {
  const k = `${r.direction}:${r.channel}`
  byChannel[k] = (byChannel[k] || 0) + 1
  if (r.direction === 'in') inMp += r.points_mp
  else outMp += r.points_mp
}
const users = Object.values(doc.users || {})
console.log(
  JSON.stringify(
    {
      dry_run: dryRun,
      ledger_path: ledgerPath,
      existing_rows_before: ledger.size - (dryRun ? 0 : rows.length),
      new_rows: rows.length,
      by_channel: byChannel,
      income_mp: inMp,
      expense_mp: outMp,
      granted_total_sum: users.reduce((a, u) => a + (Number(u.granted_total) || 0), 0),
      consumed_total_sum: users.reduce((a, u) => a + (Number(u.consumed_total) || 0), 0),
      raw_per_point: rawPerPoint,
      rows: rows.map((r) => ({ ts: r.ts, direction: r.direction, channel: r.channel, points_mp: r.points_mp, ref_id: r.ref_id })),
    },
    null,
    2,
  ),
)
