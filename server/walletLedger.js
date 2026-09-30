/**
 * Wallet ledger — append-only income/expense log for site credits (钱包).
 * Persisted as JSONL at server/data/wallet-ledger.jsonl (override via WALLET_LEDGER_PATH).
 * Kept forever (no pruning).
 * unit_version 2: the amount of record is `points_mp` (integer micro-points, 1 点 = 1,000,000 mp),
 * fixed at write time — display never depends on the current N. `raw` / `raw_per_point` are kept
 * as audit fields only (api_usage: raw cost + N at charge time).
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { shanghaiRangeBounds } from './shanghaiRange.js'
import { POINT_MP } from './quotaUnit.js'

export const WALLET_CHANNELS = [
  { value: 'checkin', label: '每日签到', direction: 'in' },
  { value: 'redeem', label: '兑换码', direction: 'in' },
  { value: 'admin_grant', label: '管理员发放', direction: 'in' },
  { value: 'admin_deduct', label: '管理员扣减', direction: 'out' },
  { value: 'api_usage', label: 'API 调用', direction: 'out' },
  { value: 'backfill_adjust', label: '历史调整', direction: null },
  { value: 'other', label: '其他', direction: null },
]
const CHANNEL_LABEL = Object.fromEntries(WALLET_CHANNELS.map((c) => [c.value, c.label]))
const ADMIN_CHANNELS = new Set(['admin_grant', 'admin_deduct'])

export function channelLabel(ch) {
  return CHANNEL_LABEL[ch] || CHANNEL_LABEL.other
}

function newId(tsMs) {
  return `wl_${tsMs.toString(36)}${crypto.randomBytes(5).toString('hex')}`
}

function toInt(n) {
  const v = Math.round(Number(n) || 0)
  return Number.isFinite(v) ? v : 0
}

function fmtRaw(n) {
  return toInt(n).toLocaleString('en-US')
}

/** mp → "12.5" 点 text */
function fmtPts(mp) {
  const v = toInt(mp) / POINT_MP
  if (Number.isInteger(v)) return String(v)
  return String(Number(v.toFixed(v < 10 ? 4 : 2)))
}

/** Human 详细信息 text (no internal wording; amounts in token). */
export function detailText(e) {
  const d = e.detail || {}
  switch (e.channel) {
    case 'checkin':
      return `签到日期 ${d.checkin_date || e.ref_id || '-'}${e.source === 'backfill' ? '（历史记录回填）' : ''}`
    case 'redeem': {
      let s = `兑换码 ${d.code || e.ref_id || '-'}`
      if (e.source === 'backfill') s += d.times > 1 ? `（历史记录回填，累计兑换 ${d.times} 次，仅保留最后一次）` : '（历史记录回填）'
      return s
    }
    case 'admin_grant':
      return d.note ? `管理员发放：${d.note}` : '管理员发放'
    case 'admin_deduct': {
      let s = d.note ? `管理员扣减：${d.note}` : '管理员扣减'
      if (d.requested && toInt(d.requested) !== toInt(e.points_mp)) s += `（申请 ${fmtPts(d.requested)} 点，余额不足按实扣）`
      return s
    }
    case 'api_usage': {
      const parts = []
      if (d.model) parts.push(`模型 ${d.model}`)
      if (d.token_name) parts.push(`密钥 ${d.token_name}`)
      if (d.endpoint) parts.push(d.endpoint)
      const tok = []
      if (d.prompt_tokens != null) tok.push(`输入 ${fmtRaw(d.prompt_tokens)}`)
      if (d.completion_tokens != null) tok.push(`输出 ${fmtRaw(d.completion_tokens)}`)
      if (d.cache_tokens) tok.push(`缓存 ${fmtRaw(d.cache_tokens)}`)
      if (tok.length) parts.push(tok.join(' / '))
      if (d.need && toInt(d.need) > toInt(e.points_mp)) parts.push(`应扣 ${fmtPts(d.need)} 点，余额不足按实扣`)
      return parts.length ? parts.join(' · ') : 'API 调用（组额度用尽后使用钱包余额）'
    }
    case 'backfill_adjust':
      return d.note || (e.direction === 'in' ? '历史调整：上线钱包前的其他收入（含管理员发放）' : '历史调整：上线钱包前的其他支出')
    default:
      return d.note || '-'
  }
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null
  const user_id = String(raw.user_id ?? '').trim()
  // Amount of record (mp). Legacy rows without points_mp are rejected (must be migrated).
  const mp = toInt(raw.points_mp)
  if (!user_id || mp <= 0) return null
  const rawAmt = raw.raw == null || raw.raw === '' ? null : toInt(raw.raw)
  const direction = raw.direction === 'out' ? 'out' : 'in'
  const channel = CHANNEL_LABEL[raw.channel] ? raw.channel : 'other'
  const tsMs = Date.parse(raw.ts || '') || Date.now()
  return {
    id: String(raw.id || newId(tsMs)),
    user_id,
    ts: new Date(tsMs).toISOString(),
    ip: raw.ip ? String(raw.ip).slice(0, 64) : null,
    direction,
    channel,
    points_mp: mp,
    raw: rawAmt,
    raw_per_point: toInt(raw.raw_per_point) || null,
    balance_after: raw.balance_after == null ? null : toInt(raw.balance_after),
    ref_type: raw.ref_type ? String(raw.ref_type) : null,
    ref_id: raw.ref_id != null && raw.ref_id !== '' ? String(raw.ref_id) : null,
    operator: raw.operator ? String(raw.operator) : null,
    detail: raw.detail && typeof raw.detail === 'object' ? raw.detail : {},
    source: raw.source === 'backfill' ? 'backfill' : 'live',
  }
}

/**
 * @param {string} filePath
 * @param {{ getRawPerPoint?: () => number }} [opts]
 */
export function createWalletLedger(filePath, { getRawPerPoint } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const entries = []
  const byUser = new Map()
  const ids = new Set()

  const unit = () => {
    const n = Number(typeof getRawPerPoint === 'function' ? getRawPerPoint() : 0)
    return Number.isFinite(n) && n > 0 ? n : 500000
  }

  function index(e) {
    entries.push(e)
    ids.add(e.id)
    let list = byUser.get(e.user_id)
    if (!list) byUser.set(e.user_id, (list = []))
    list.push(e)
  }

  // Load
  if (fs.existsSync(filePath)) {
    const text = fs.readFileSync(filePath, 'utf8')
    let bad = 0
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const e = normalizeEntry(JSON.parse(line))
        if (e && !ids.has(e.id)) index(e)
      } catch {
        bad += 1
      }
    }
    if (bad) console.warn(`[wallet] skipped ${bad} malformed ledger lines`)
  }

  function persist(list) {
    if (!list.length) return
    const data = list.map((e) => JSON.stringify(e)).join('\n') + '\n'
    fs.appendFileSync(filePath, data, { mode: 0o600 })
    try {
      fs.chmodSync(filePath, 0o600)
    } catch {
      /* ignore */
    }
  }

  function append(raw) {
    const e = normalizeEntry({ raw_per_point: unit(), ...raw })
    if (!e || ids.has(e.id)) return null
    persist([e])
    index(e)
    return e
  }

  function appendMany(list) {
    const out = []
    for (const raw of list) {
      const e = normalizeEntry({ raw_per_point: unit(), ...raw })
      if (e && !ids.has(e.id) && !out.some((x) => x.id === e.id)) out.push(e)
    }
    persist(out)
    out.forEach(index)
    return out
  }

  function toItem(e, { admin = false } = {}) {
    const item = {
      id: e.id,
      ts: e.ts,
      created_at: Math.floor(Date.parse(e.ts) / 1000),
      // Users never see the admin's IP for admin operations.
      ip: !admin && ADMIN_CHANNELS.has(e.channel) ? null : e.ip,
      direction: e.direction,
      direction_label: e.direction === 'in' ? '收入' : '支出',
      channel: e.channel,
      channel_label: channelLabel(e.channel),
      amount_mp: e.points_mp,
      points: e.points_mp / POINT_MP,
      balance_after: e.balance_after,
      detail_text: detailText(e),
      source: e.source,
    }
    if (admin) {
      item.user_id = e.user_id
      item.operator = e.operator
      item.raw = e.raw
      item.raw_per_point = e.raw_per_point
      item.ref_id = e.ref_id
    }
    return item
  }

  function matchChannel(e, ch) {
    const q = String(ch || '').trim().toLowerCase()
    if (!q) return true
    if (e.channel === q) return true
    return channelLabel(e.channel).toLowerCase().includes(q) || e.channel.includes(q)
  }

  function sortDesc(a, b) {
    const d = Date.parse(b.ts) - Date.parse(a.ts)
    return d || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  }

  /**
   * Query entries. userId required unless admin (admin may pass user_id filter).
   */
  function query(q = {}, { now = Date.now(), admin = false } = {}) {
    const { from, to } = shanghaiRangeBounds(q, now)
    const uid = q.user_id != null && q.user_id !== '' ? String(q.user_id) : null
    if (!admin && !uid) return { items: [], total: 0, page: 1, page_size: 20, summary: { in_mp: 0, out_mp: 0, in_points: 0, out_points: 0, in_count: 0, out_count: 0 } }
    const base = uid ? byUser.get(uid) || [] : entries
    const inRange = base.filter((e) => {
      const t = Date.parse(e.ts)
      return t >= from && t <= to
    })
    const summary = { in_mp: 0, out_mp: 0, in_points: 0, out_points: 0, in_count: 0, out_count: 0 }
    for (const e of inRange) {
      if (e.direction === 'in') {
        summary.in_mp += e.points_mp
        summary.in_count += 1
      } else {
        summary.out_mp += e.points_mp
        summary.out_count += 1
      }
    }
    summary.in_points = summary.in_mp / POINT_MP
    summary.out_points = summary.out_mp / POINT_MP
    const dir = q.direction === 'in' || q.direction === 'out' ? q.direction : ''
    const filtered = inRange.filter((e) => (!dir || e.direction === dir) && matchChannel(e, q.channel))
    filtered.sort(sortDesc)
    const page_size = Math.min(100, Math.max(1, toInt(q.page_size) || 20))
    const page = Math.max(1, toInt(q.p || q.page) || 1)
    const start = (page - 1) * page_size
    return {
      items: filtered.slice(start, start + page_size).map((e) => toItem(e, { admin })),
      total: filtered.length,
      page,
      page_size,
      summary,
      range: { from: new Date(from).toISOString(), to: to >= Number.MAX_SAFE_INTEGER ? null : new Date(to).toISOString() },
    }
  }

  function channelOptions(userId) {
    const seen = new Set((byUser.get(String(userId)) || []).map((e) => e.channel))
    return WALLET_CHANNELS.filter((c) => c.value !== 'other' || seen.has('other')).map((c) => ({
      value: c.value,
      label: c.label,
      used: seen.has(c.value),
    }))
  }

  function listForUser(userId) {
    return (byUser.get(String(userId)) || []).slice()
  }

  /**
   * Reconcile ledger with site-credits doc (idempotent; source:'backfill').
   * - one income row per historical check-in (dedupe by user + checkin date)
   * - one income row per redeemed code without any existing row
   * - diff row when granted_total > Σ income rows (and consumed > Σ expense rows)
   * @param {{ users: Record<string, any> }} creditsDoc
   */
  function planBackfill(creditsDoc, { now = Date.now() } = {}) {
    const rows = []
    const users = creditsDoc?.users && typeof creditsDoc.users === 'object' ? creditsDoc.users : {}
    const nowIso = new Date(now).toISOString()
    for (const [uid, u] of Object.entries(users)) {
      const existing = byUser.get(uid) || []
      const hasCheckin = new Set(existing.filter((e) => e.channel === 'checkin').map((e) => e.ref_id))
      const hasRedeem = new Set(existing.filter((e) => e.channel === 'redeem').map((e) => e.ref_id))
      let inSum = existing.filter((e) => e.direction === 'in').reduce((a, e) => a + e.points_mp, 0)
      const outSum = existing.filter((e) => e.direction === 'out').reduce((a, e) => a + e.points_mp, 0)
      for (const c of Array.isArray(u?.checkins) ? u.checkins : []) {
        const date = String(c?.checkin_date || '')
        const amt = toInt(c?.quota_awarded)
        if (!date || amt <= 0 || hasCheckin.has(date)) continue
        hasCheckin.add(date)
        rows.push({
          id: `bf_${uid}_checkin_${date}`,
          user_id: uid,
          ts: c.at || `${date}T00:00:00+08:00`,
          ip: null,
          direction: 'in',
          channel: 'checkin',
          points_mp: amt,
          ref_type: 'checkin',
          ref_id: date,
          detail: { checkin_date: date },
          source: 'backfill',
        })
        inSum += amt
      }
      for (const [code, r] of Object.entries(u?.redeemed && typeof u.redeemed === 'object' ? u.redeemed : {})) {
        const amt = toInt(r?.quota)
        if (amt <= 0 || hasRedeem.has(code)) continue
        hasRedeem.add(code)
        rows.push({
          id: `bf_${uid}_redeem_${code}`,
          user_id: uid,
          ts: r.at || nowIso,
          ip: null,
          direction: 'in',
          channel: 'redeem',
          points_mp: amt,
          ref_type: 'redeem_code',
          ref_id: code,
          detail: { code, times: toInt(r?.times) || 1 },
          source: 'backfill',
        })
        inSum += amt
      }
      const granted = toInt(u?.granted_total)
      const diffIn = granted - inSum
      if (diffIn > 0) {
        rows.push({
          id: `bf_${uid}_adjust_in_${granted}`,
          user_id: uid,
          ts: nowIso,
          direction: 'in',
          channel: 'backfill_adjust',
          points_mp: diffIn,
          ref_type: 'reconcile',
          detail: { note: '历史调整：上线钱包前的其他收入（含管理员发放）', granted_total: granted },
          source: 'backfill',
        })
      } else if (diffIn < 0) {
        console.warn(`[wallet] ledger income exceeds granted_total for user ${uid} by ${-diffIn}`)
      }
      const spent = toInt(u?.consumed_total) + toInt(u?.admin_deducted_total)
      const diffOut = spent - outSum
      if (diffOut > 0) {
        rows.push({
          id: `bf_${uid}_adjust_out_${spent}`,
          user_id: uid,
          ts: nowIso,
          direction: 'out',
          channel: 'backfill_adjust',
          points_mp: diffOut,
          ref_type: 'reconcile',
          detail: { note: '历史调整：上线钱包前的其他支出', spent_total: spent },
          source: 'backfill',
        })
      }
    }
    return rows
  }

  function backfill(creditsDoc, { dryRun = false, now } = {}) {
    const rows = planBackfill(creditsDoc, { now })
    if (dryRun) return rows.map((r) => normalizeEntry({ raw_per_point: unit(), ...r }))
    return appendMany(rows)
  }

  return {
    filePath,
    append,
    query,
    channelOptions,
    listForUser,
    planBackfill,
    backfill,
    toItem,
    get size() {
      return entries.length
    },
  }
}
