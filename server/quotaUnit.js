/**
 * Single source of truth for 展示「点」↔ 内部 raw quota units.
 * aily / new-api parity: default QUOTA_PER_UNIT = 500000 → 1 点 = $1 = 500000 raw.
 *
 * Persisted at server/data/quota-unit.json (override via QUOTA_UNIT_PATH).
 * Pricing conversion, billing deduct, keys USD↔quota, credits/groups display
 * all read getUnit() dynamically — never freeze a stale module constant only.
 */
import fs from 'node:fs'
import path from 'node:path'

export const DEFAULT_QUOTA_PER_UNIT = 500_000

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function clampUnit(n) {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) return null
  // Guard against absurd values (fractional units break integer display)
  if (v < 1) return null
  if (v > 1e12) return null
  return Math.round(v)
}

/**
 * USD → raw quota (aily pricing.mjs dollarsToQuota).
 * @param {number} usd
 * @param {number} [unit]
 */
export function dollarsToQuota(usd, unit = DEFAULT_QUOTA_PER_UNIT) {
  const n = Number(usd)
  const u = clampUnit(unit) || DEFAULT_QUOTA_PER_UNIT
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(n * u)
}

/**
 * Raw quota → USD / 点 (same N for both under aily parity).
 * @param {number} quota
 * @param {number} [unit]
 */
export function quotaToDollars(quota, unit = DEFAULT_QUOTA_PER_UNIT) {
  const u = clampUnit(unit) || DEFAULT_QUOTA_PER_UNIT
  return (Number(quota) || 0) / u
}

/** Alias: display 点 = raw / unit */
export function quotaToPoints(quota, unit = DEFAULT_QUOTA_PER_UNIT) {
  return quotaToDollars(quota, unit)
}

/** Display 点 → raw */
export function pointsToQuota(points, unit = DEFAULT_QUOTA_PER_UNIT) {
  const u = clampUnit(unit) || DEFAULT_QUOTA_PER_UNIT
  const n = Number(points)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(n * u)
}

/**
 * USD per MTok → quota (raw) per MTok: round(usd_per_mtok * unit)
 * @param {number} usdPerMtok
 * @param {number} [unit]
 */
export function usdPerMtokToQuotaPerMtok(usdPerMtok, unit = DEFAULT_QUOTA_PER_UNIT) {
  const n = Number(usdPerMtok)
  const u = clampUnit(unit) || DEFAULT_QUOTA_PER_UNIT
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * u)
}

export function buildCreditUnitInfo(unit = DEFAULT_QUOTA_PER_UNIT) {
  const u = clampUnit(unit) || DEFAULT_QUOTA_PER_UNIT
  return {
    raw_per_point: u,
    quota_per_unit: u,
    display_name: '点',
    note: `1 点 = ${u} 内部额度单位（与 $1 同换算，aily/new-api 对齐）。用户组 5h/周/月与计费均按内部单位计量。`,
    windows: ['window_5h', 'week', 'month'],
    formula: {
      point_to_raw: `1 点 = ${u} raw`,
      usd_to_raw: `1 USD = ${u} raw`,
      quota_per_mtok: `round(usd_per_mtok × ${u})`,
    },
  }
}

function readStore(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return {
        version: 1,
        quota_per_unit: DEFAULT_QUOTA_PER_UNIT,
        updated_at: null,
      }
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    const unit = clampUnit(raw?.quota_per_unit ?? raw?.raw_per_point) || DEFAULT_QUOTA_PER_UNIT
    return {
      version: 1,
      quota_per_unit: unit,
      updated_at: raw?.updated_at || null,
    }
  } catch {
    return {
      version: 1,
      quota_per_unit: DEFAULT_QUOTA_PER_UNIT,
      updated_at: null,
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

  function getUnit() {
    return store.quota_per_unit || DEFAULT_QUOTA_PER_UNIT
  }

  function get() {
    const unit = getUnit()
    return {
      quota_per_unit: unit,
      raw_per_point: unit,
      updated_at: store.updated_at,
      credit_unit: buildCreditUnitInfo(unit),
      path: filePath,
    }
  }

  /**
   * @param {number|string} next
   */
  function setUnit(next) {
    const unit = clampUnit(next)
    if (unit == null) {
      throw Object.assign(new Error('quota_per_unit must be a positive number'), { status: 400 })
    }
    store.quota_per_unit = unit
    persist()
    return get()
  }

  return {
    get,
    getUnit,
    setUnit,
    dollarsToQuota: (usd) => dollarsToQuota(usd, getUnit()),
    quotaToDollars: (q) => quotaToDollars(q, getUnit()),
    pointsToQuota: (p) => pointsToQuota(p, getUnit()),
    quotaToPoints: (q) => quotaToPoints(q, getUnit()),
    usdPerMtokToQuotaPerMtok: (usd) => usdPerMtokToQuotaPerMtok(usd, getUnit()),
    creditUnitInfo: () => buildCreditUnitInfo(getUnit()),
    DEFAULT_QUOTA_PER_UNIT,
  }
}

export { clampUnit }
