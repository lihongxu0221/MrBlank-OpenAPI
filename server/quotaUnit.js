/**
 * Single source of truth for 展示「点」↔ 内部 raw quota units ↔ USD.
 *
 * Blank Li rules (must keep exact):
 *   1. 1 点 = N 内部单位 — configurable (raw_per_point / quota_per_unit)
 *   2. 1 USD = 500000 内部单位 — FIXED (not configurable)
 *   3. On 刷新 / 同步: raw = usd × 500000; display_points = raw / N
 *
 * Persisted at server/data/quota-unit.json (override via QUOTA_UNIT_PATH).
 * Only N (raw_per_point) is written; USD→raw is always FIXED_USD_TO_RAW.
 *
 * Account unit (unit_version 2, 2026-09-30):
 *   「点」is the ACCOUNT currency. Every balance / grant / limit / config denominated in 点
 *   (wallet balance, check-in range, redeem codes, admin grant/deduct, group 5h/week/month
 *   quotas, per-model quotas, promotion thresholds, key remain/limits, ledger rows) is
 *   stored as integer micro-points (mp): 1 点 = POINT_MP = 1,000,000 mp — FIXED, independent of N.
 *   N ONLY affects per-call pricing: points charged = USD × 500000 ÷ N (computed at charge time).
 *   Changing N therefore reprices the model list and future calls; it never rescales balances.
 */
import fs from 'node:fs'
import path from 'node:path'

/** Fixed: 1 USD = 500000 raw. Never read from admin UI / store. */
export const FIXED_USD_TO_RAW = 500_000
/** @deprecated alias — same fixed constant; prefer FIXED_USD_TO_RAW for USD paths */
export const DEFAULT_QUOTA_PER_UNIT = FIXED_USD_TO_RAW
/** Default N when store has no override: 1 点 = 500000 raw (≈ 1 USD). */
export const DEFAULT_RAW_PER_POINT = FIXED_USD_TO_RAW

/** Fixed account unit: 1 点 = 1,000,000 micro-points (mp). Never depends on N. */
export const POINT_MP = 1_000_000
/** Data-file unit version: 2 = point-denominated values stored as mp. */
export const UNIT_VERSION = 2

/** 点 → mp (integer). Negative / invalid → 0. */
export function pointsToMp(points) {
  const n = Number(points)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(n * POINT_MP)
}

/** mp → 点 (float). */
export function mpToPoints(mp) {
  return (Number(mp) || 0) / POINT_MP
}

/**
 * Billing: USD → mp charged at the given N (1 点 = N raw; 1 USD = 500000 raw fixed).
 * points = usd × 500000 ÷ N  →  mp = round(usd × 500000 × 1e6 ÷ N)
 */
export function usdToMp(usd, rawPerPoint = DEFAULT_RAW_PER_POINT) {
  const v = Number(usd)
  if (!Number.isFinite(v) || v <= 0) return 0
  const n = clampUnit(rawPerPoint) || DEFAULT_RAW_PER_POINT
  return Math.round((v * FIXED_USD_TO_RAW * POINT_MP) / n)
}

/** raw → mp at a given N (migration / history). */
export function rawToMp(raw, rawPerPoint) {
  const v = Number(raw)
  if (!Number.isFinite(v) || v <= 0) return 0
  const n = clampUnit(rawPerPoint)
  if (!n) throw new Error('rawToMp: invalid N')
  return Math.round((v * POINT_MP) / n)
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function clampUnit(n) {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) return null
  if (v < 1) return null
  if (v > 1e12) return null
  return Math.round(v)
}

/**
 * Parse admin 「1 点 = N」 input.
 * Accepts plain numbers (500000) and suffix units B/M/K (case-insensitive):
 *   0.5M = 500000, 500K = 500000, 1B = 1000000000
 * @param {unknown} input
 * @returns {number|null} clamped integer or null if invalid
 */
export function parseRawPerPoint(input) {
  if (typeof input === 'number') return clampUnit(input)
  const s = String(input ?? '')
    .trim()
    .replace(/,/g, '')
    .replace(/_/g, '')
  if (!s) return null
  const m = s.match(/^([+-]?\d+(?:\.\d+)?)\s*([kKmMbB])?$/)
  if (!m) return null
  let n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return null
  const suf = (m[2] || '').toUpperCase()
  if (suf === 'K') n *= 1e3
  else if (suf === 'M') n *= 1e6
  else if (suf === 'B') n *= 1e9
  return clampUnit(n)
}

/**
 * Compact display for N: prefer B/M/K when exact (or short decimal for M).
 * e.g. 500000 → "0.5M", 1000000000 → "1B", 5000 → "5K", 123 → "123"
 * @param {number} n
 */
export function formatRawPerPointCompact(n) {
  const v = clampUnit(n) || DEFAULT_RAW_PER_POINT
  if (v >= 1e9 && v % 1e9 === 0) return `${v / 1e9}B`
  // Prefer M when divisible to ≤3 decimal places (0.5M, 1.25M, …)
  if (v >= 1e5) {
    const m = v / 1e6
    const rounded = Math.round(m * 1000) / 1000
    if (Math.abs(rounded * 1e6 - v) < 0.5) {
      const s = String(rounded).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
      return `${s}M`
    }
  }
  if (v >= 1e3 && v % 1e3 === 0) return `${v / 1e3}K`
  return String(v)
}

/**
 * USD → raw quota. Always uses FIXED_USD_TO_RAW (second arg ignored if passed).
 * @param {number} usd
 * @param {number} [_ignoredUnit] kept for call-site compat; never overrides fixed rate
 */
export function dollarsToQuota(usd, _ignoredUnit) {
  const n = Number(usd)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(n * FIXED_USD_TO_RAW)
}

/**
 * Raw quota → USD. Always uses FIXED_USD_TO_RAW.
 * @param {number} quota
 * @param {number} [_ignoredUnit]
 */
export function quotaToDollars(quota, _ignoredUnit) {
  return (Number(quota) || 0) / FIXED_USD_TO_RAW
}

/** Display 点 = raw / N */
export function quotaToPoints(quota, rawPerPoint = DEFAULT_RAW_PER_POINT) {
  const n = clampUnit(rawPerPoint) || DEFAULT_RAW_PER_POINT
  return (Number(quota) || 0) / n
}

/** Display 点 → raw = round(points × N) */
export function pointsToQuota(points, rawPerPoint = DEFAULT_RAW_PER_POINT) {
  const u = clampUnit(rawPerPoint) || DEFAULT_RAW_PER_POINT
  const n = Number(points)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(n * u)
}

/**
 * USD per MTok → quota (raw) per MTok: round(usd_per_mtok × FIXED_USD_TO_RAW)
 * @param {number} usdPerMtok
 * @param {number} [_ignoredUnit]
 */
export function usdPerMtokToQuotaPerMtok(usdPerMtok, _ignoredUnit) {
  const n = Number(usdPerMtok)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * FIXED_USD_TO_RAW)
}

export function buildCreditUnitInfo(rawPerPoint = DEFAULT_RAW_PER_POINT) {
  const n = clampUnit(rawPerPoint) || DEFAULT_RAW_PER_POINT
  return {
    raw_per_point: n,
    quota_per_unit: n,
    usd_to_raw: FIXED_USD_TO_RAW,
    display_name: '点',
    note: `1 点 = ${n.toLocaleString('en-US')} token`,
    /** Balances / limits / configs are stored in mp (1 点 = mp_per_point), independent of N. */
    mp_per_point: POINT_MP,
    account_unit: 'point',
    unit_version: UNIT_VERSION,
    windows: ['window_5h', 'week', 'month'],
    formula: {
      point_to_raw: `1 点 = ${n} raw`,
      usd_to_raw: `1 USD = ${FIXED_USD_TO_RAW} raw (fixed)`,
      quota_per_mtok: `round(usd_per_mtok × ${FIXED_USD_TO_RAW})`,
      display_points: `raw ÷ ${n}`,
      charge_points: `usd × ${FIXED_USD_TO_RAW} ÷ ${n}`,
      balance_storage: `1 点 = ${POINT_MP} mp (fixed; N 变化不影响余额/额度)`,
    },
  }
}

function readStore(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return {
        version: 1,
        quota_per_unit: DEFAULT_RAW_PER_POINT,
        updated_at: null,
        history: [],
      }
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    const unit = clampUnit(raw?.quota_per_unit ?? raw?.raw_per_point) || DEFAULT_RAW_PER_POINT
    const out = {
      version: 1,
      quota_per_unit: unit,
      updated_at: raw?.updated_at || null,
      history: Array.isArray(raw?.history) ? raw.history.slice(-200) : [],
    }
    if (raw?.account_unit_version != null) out.account_unit_version = raw.account_unit_version
    return out
  } catch {
    return {
      version: 1,
      quota_per_unit: DEFAULT_RAW_PER_POINT,
      updated_at: null,
      history: [],
    }
  }
}

function writeStore(filePath, store) {
  ensureDir(filePath)
  const tmp = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, filePath)
  try {
    fs.chmodSync(filePath, 0o600)
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} filePath
 */
export function createQuotaUnitStore(filePath) {
  let store = readStore(filePath)

  function persist() {
    store.updated_at = new Date().toISOString()
    writeStore(filePath, store)
  }

  /** Configurable N: 1 点 = N raw */
  function getUnit() {
    return store.quota_per_unit || DEFAULT_RAW_PER_POINT
  }

  function get() {
    const unit = getUnit()
    return {
      quota_per_unit: unit,
      raw_per_point: unit,
      usd_to_raw: FIXED_USD_TO_RAW,
      updated_at: store.updated_at,
      credit_unit: buildCreditUnitInfo(unit),
      history: (store.history || []).slice(-20),
      path: filePath,
    }
  }

  /**
   * Set configurable N (1 点 = N raw). Accepts number or B/M/K string.
   * Does NOT change FIXED_USD_TO_RAW and NEVER touches balances / point-denominated
   * limits (those are stored in mp). Only per-call pricing follows N.
   * @param {number|string} next
   * @param {{ operator?: string|null }} [meta]
   */
  function setUnit(next, meta = {}) {
    const unit = parseRawPerPoint(next)
    if (unit == null) {
      throw Object.assign(
        new Error('raw_per_point must be a positive number or suffix form (e.g. 0.5M, 500K, 1B)'),
        { status: 400 },
      )
    }
    const prev = store.quota_per_unit || DEFAULT_RAW_PER_POINT
    store.quota_per_unit = unit
    if (!Array.isArray(store.history)) store.history = []
    if (prev !== unit) {
      store.history.push({
        at: new Date().toISOString(),
        from: prev,
        to: unit,
        operator: meta.operator ? String(meta.operator).slice(0, 80) : null,
      })
      store.history = store.history.slice(-200)
    }
    persist()
    return get()
  }

  return {
    get,
    getUnit,
    setUnit,
    /** Always FIXED — ignores stored N */
    dollarsToQuota: (usd) => dollarsToQuota(usd),
    quotaToDollars: (q) => quotaToDollars(q),
    pointsToQuota: (p) => pointsToQuota(p, getUnit()),
    quotaToPoints: (q) => quotaToPoints(q, getUnit()),
    /** Billing: USD → mp at CURRENT N (points = usd × 500000 ÷ N). */
    usdToMp: (usd) => usdToMp(usd, getUnit()),
    rawToMp: (raw) => rawToMp(raw, getUnit()),
    usdPerMtokToQuotaPerMtok: (usd) => usdPerMtokToQuotaPerMtok(usd),
    creditUnitInfo: () => buildCreditUnitInfo(getUnit()),
    DEFAULT_QUOTA_PER_UNIT,
    FIXED_USD_TO_RAW,
  }
}

export { clampUnit }
