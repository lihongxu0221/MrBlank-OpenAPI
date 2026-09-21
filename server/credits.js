/**
 * Phase F — site credit wallet + check-in + redeem codes.
 * Persisted at server/data/site-credits.json (override via SITE_CREDITS_PATH).
 *
 * Unit: same as Phase E — 1 点 = 500000 raw. Grants raise balance; /v1 success
 * consumes balance (alongside group rolling windows). Day boundary: Asia/Shanghai.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const Q = 500_000
const TZ = 'Asia/Shanghai'

function nowIso() {
  return new Date().toISOString()
}

/** Calendar date YYYY-MM-DD in Asia/Shanghai (optional day offset). */
export function shanghaiDay(offset = 0) {
  const d = new Date(Date.now() + offset * 86400000)
  return d.toLocaleDateString('en-CA', { timeZone: TZ })
}

function shanghaiMonth() {
  return shanghaiDay().slice(0, 7)
}

function defaultConfig() {
  return {
    checkin_enabled: true,
    /** Inclusive raw range; if min===max → fixed grant. */
    daily_grant_min: 2 * Q,
    daily_grant_max: 2 * Q,
    timezone: TZ,
    note: '签到与兑换码发放本站额度（点）；1 点 = 500000 内部单位。日界 Asia/Shanghai。',
  }
}

function defaultCodes() {
  // Seed community codes (once per user). Admins can edit/disable.
  const seeds = ['WELCOME', 'GROK2026', 'COMMUNITY', 'DARKFORGER']
  return seeds.map((code) => ({
    code,
    quota: 5 * Q,
    max_uses: 0, // 0 = unlimited global redemptions
    used_count: 0,
    once_per_user: true,
    enabled: true,
    note: '默认社区兑换码',
    created_at: nowIso(),
    expires_at: null,
  }))
}

function normalizeConfig(raw = {}) {
  const base = defaultConfig()
  let min = Math.max(0, Number(raw.daily_grant_min ?? base.daily_grant_min) || 0)
  let max = Math.max(0, Number(raw.daily_grant_max ?? base.daily_grant_max) || 0)
  if (max < min) [min, max] = [max, min]
  return {
    checkin_enabled: raw.checkin_enabled !== false,
    daily_grant_min: min,
    daily_grant_max: max,
    timezone: String(raw.timezone || TZ),
    note: String(raw.note || base.note),
  }
}

function normalizeCode(raw) {
  const code = String(raw?.code || '')
    .trim()
    .toUpperCase()
  if (!code) return null
  return {
    code,
    quota: Math.max(0, Number(raw.quota) || 0),
    max_uses: Math.max(0, Number(raw.max_uses) || 0),
    used_count: Math.max(0, Number(raw.used_count) || 0),
    once_per_user: raw.once_per_user !== false,
    enabled: raw.enabled !== false,
    note: String(raw.note || ''),
    created_at: raw.created_at || nowIso(),
    expires_at: raw.expires_at || null,
  }
}

function defaultDoc() {
  return {
    config: defaultConfig(),
    codes: defaultCodes(),
    users: {},
    updated_at: null,
  }
}

function normalizeDoc(raw) {
  const base = defaultDoc()
  const codesIn = Array.isArray(raw?.codes) ? raw.codes : base.codes
  const codes = codesIn.map(normalizeCode).filter(Boolean)
  return {
    config: normalizeConfig(raw?.config),
    codes: codes.length ? codes : base.codes,
    users: raw?.users && typeof raw.users === 'object' ? raw.users : {},
    updated_at: raw?.updated_at || null,
  }
}

function ensureUser(doc, userId) {
  const id = String(userId)
  if (!doc.users[id]) {
    doc.users[id] = {
      balance: 0,
      granted_total: 0,
      consumed_total: 0,
      checkins: [],
      redeemed: {},
    }
  } else {
    const u = doc.users[id]
    if (!Array.isArray(u.checkins)) u.checkins = []
    if (!u.redeemed || typeof u.redeemed !== 'object') u.redeemed = {}
    u.balance = Math.max(0, Number(u.balance) || 0)
    u.granted_total = Math.max(0, Number(u.granted_total) || 0)
    u.consumed_total = Math.max(0, Number(u.consumed_total) || 0)
  }
  return doc.users[id]
}

function pickGrantAmount(config) {
  const min = config.daily_grant_min
  const max = config.daily_grant_max
  if (min === max) return min
  const span = max - min
  const r = crypto.randomInt(0, span + 1)
  return min + r
}

export function createCreditStore(filePath, { quotaUnit = Q } = {}) {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const unit = quotaUnit || Q

  function read() {
    if (!fs.existsSync(filePath)) {
      const doc = defaultDoc()
      write(doc)
      return doc
    }
    try {
      return normalizeDoc(JSON.parse(fs.readFileSync(filePath, 'utf8')))
    } catch {
      return defaultDoc()
    }
  }

  function write(doc) {
    const normalized = normalizeDoc(doc)
    normalized.updated_at = nowIso()
    const tmp = `${filePath}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, filePath)
    try {
      fs.chmodSync(filePath, 0o600)
    } catch {
      /* ignore */
    }
    return normalized
  }

  function grant(doc, userId, amount, meta = {}) {
    const u = ensureUser(doc, userId)
    const q = Math.max(0, Number(amount) || 0)
    u.balance += q
    u.granted_total += q
    return { balance: u.balance, granted: q, ...meta }
  }

  return {
    quotaUnit: unit,
    shanghaiDay,
    shanghaiMonth,

    getConfig() {
      return read().config
    },

    saveConfig(patch = {}) {
      const doc = read()
      doc.config = normalizeConfig({ ...doc.config, ...patch })
      return write(doc).config
    },

    listCodes() {
      return read().codes.slice()
    },

    saveCodes(codes) {
      const doc = read()
      const next = (Array.isArray(codes) ? codes : []).map(normalizeCode).filter(Boolean)
      // preserve used_count from disk when same code re-saved without count
      const prevByCode = new Map(doc.codes.map((c) => [c.code, c]))
      doc.codes = next.map((c) => {
        const prev = prevByCode.get(c.code)
        if (prev && (c.used_count == null || Number(c.used_count) === 0) && prev.used_count) {
          return { ...c, used_count: prev.used_count }
        }
        return c
      })
      if (!doc.codes.length) doc.codes = defaultCodes()
      return write(doc).codes
    },

    upsertCode(raw) {
      const doc = read()
      const code = normalizeCode(raw)
      if (!code) throw new Error('兑换码不能为空')
      const i = doc.codes.findIndex((c) => c.code === code.code)
      if (i >= 0) {
        const prev = doc.codes[i]
        doc.codes[i] = {
          ...prev,
          ...code,
          used_count: prev.used_count,
          created_at: prev.created_at,
        }
      } else {
        doc.codes.push(code)
      }
      write(doc)
      return doc.codes.find((c) => c.code === code.code)
    },

    deleteCode(codeStr) {
      const doc = read()
      const code = String(codeStr || '')
        .trim()
        .toUpperCase()
      const before = doc.codes.length
      doc.codes = doc.codes.filter((c) => c.code !== code)
      if (doc.codes.length === before) throw new Error('兑换码不存在')
      write(doc)
      return true
    },

    getBalance(userId) {
      const doc = read()
      return ensureUser(doc, userId).balance
    },

    getUserSnapshot(userId) {
      const doc = read()
      const u = ensureUser(doc, userId)
      return {
        balance: u.balance,
        granted_total: u.granted_total,
        consumed_total: u.consumed_total,
        checkin_count: u.checkins.length,
        redeemed_count: Object.keys(u.redeemed).length,
      }
    },

    checkinCount(userId) {
      const doc = read()
      return ensureUser(doc, userId).checkins.length
    },

    listCheckins(userId, month) {
      const doc = read()
      const u = ensureUser(doc, userId)
      if (!month) return u.checkins.slice()
      const mm = month
      return u.checkins.filter((r) => String(r.checkin_date).startsWith(mm))
    },

    listAllCheckins(userId) {
      const doc = read()
      return ensureUser(doc, userId).checkins.slice()
    },

    hasCheckedInToday(userId) {
      const doc = read()
      const today = shanghaiDay()
      return ensureUser(doc, userId).checkins.some((r) => r.checkin_date === today)
    },

    getCheckinStatus(userId, month) {
      const doc = read()
      const cfg = doc.config
      const u = ensureUser(doc, userId)
      const mm = month || shanghaiMonth()
      const today = shanghaiDay()
      const records = u.checkins.filter((r) => String(r.checkin_date).startsWith(mm))
      const checked = u.checkins.some((r) => r.checkin_date === today)
      let unavailable_reason
      let claimable = false
      if (!cfg.checkin_enabled) {
        unavailable_reason = '签到暂未开放'
      } else if (checked) {
        unavailable_reason = '今日已签到'
      } else {
        claimable = true
      }
      return {
        enabled: !!cfg.checkin_enabled,
        claimable,
        unavailable_reason,
        min_quota: cfg.daily_grant_min,
        max_quota: cfg.daily_grant_max,
        month: mm,
        timezone: cfg.timezone || TZ,
        stats: {
          checked_in_today: checked,
          checkin_count: records.length,
          total_checkins: u.checkins.length,
          records,
        },
        balance: u.balance,
      }
    },

    /**
     * Claim daily check-in. Throws / returns { ok:false, message }.
     */
    claimCheckin(userId) {
      const doc = read()
      const cfg = doc.config
      if (!cfg.checkin_enabled) return { ok: false, message: '签到暂未开放' }
      const today = shanghaiDay()
      const u = ensureUser(doc, userId)
      if (u.checkins.some((r) => r.checkin_date === today)) {
        return { ok: false, message: '今日已签到' }
      }
      const quota_awarded = pickGrantAmount(cfg)
      u.checkins.push({
        checkin_date: today,
        quota_awarded,
        at: nowIso(),
      })
      grant(doc, userId, quota_awarded)
      write(doc)
      return {
        ok: true,
        quota_awarded,
        balance: u.balance,
        checkin_date: today,
        total_checkins: u.checkins.length,
      }
    },

    /**
     * Redeem a code into site credits.
     */
    redeem(userId, codeRaw) {
      const code = String(codeRaw || '')
        .trim()
        .toUpperCase()
      if (!code) return { ok: false, message: '请输入兑换码' }
      const doc = read()
      const u = ensureUser(doc, userId)
      if (u.redeemed[code]) return { ok: false, message: '兑换码已使用' }

      // Prefix DF-* still supported as ad-hoc one-time per user if no admin code
      let entry = doc.codes.find((c) => c.code === code)
      if (!entry && code.startsWith('DF-')) {
        entry = {
          code,
          quota: 5 * Q,
          max_uses: 0,
          used_count: 0,
          once_per_user: true,
          enabled: true,
          note: 'DF 前缀临时代码',
          created_at: nowIso(),
          expires_at: null,
          _ephemeral: true,
        }
      }
      if (!entry || !entry.enabled) return { ok: false, message: '兑换码无效' }
      if (entry.expires_at) {
        const exp = Date.parse(entry.expires_at)
        if (Number.isFinite(exp) && Date.now() > exp) {
          return { ok: false, message: '兑换码已过期' }
        }
      }
      if (entry.max_uses > 0 && entry.used_count >= entry.max_uses) {
        return { ok: false, message: '兑换码已兑完' }
      }

      const awarded = entry.quota
      u.redeemed[code] = { at: nowIso(), quota: awarded }
      if (!entry._ephemeral) {
        entry.used_count = (Number(entry.used_count) || 0) + 1
      }
      grant(doc, userId, awarded)
      write(doc)
      return { ok: true, awarded, balance: u.balance, code }
    },

    /**
     * Consume site credits after a successful /v1 call.
     * Returns amount actually deducted.
     */
    consume(userId, amount) {
      const doc = read()
      const u = ensureUser(doc, userId)
      const need = Math.max(0, Number(amount) || 0)
      const take = Math.min(u.balance, need)
      if (take > 0) {
        u.balance -= take
        u.consumed_total += take
        write(doc)
      }
      return { deducted: take, balance: u.balance }
    },

    /** Admin grant without check-in. */
    adminGrant(userId, amount, note = '') {
      const doc = read()
      const result = grant(doc, userId, amount, { note })
      write(doc)
      return { ok: true, ...result }
    },

    adminSummary() {
      const doc = read()
      const users = Object.entries(doc.users).map(([user_id, u]) => ({
        user_id,
        balance: u.balance || 0,
        granted_total: u.granted_total || 0,
        consumed_total: u.consumed_total || 0,
        checkins: (u.checkins || []).length,
        redeemed: Object.keys(u.redeemed || {}).length,
      }))
      return {
        config: doc.config,
        codes: doc.codes,
        users,
        updated_at: doc.updated_at,
        credit_unit: {
          raw_per_point: unit,
          display_name: '点',
          note: '1 点 = 500000 内部额度单位（与 Phase E 一致）',
        },
      }
    },
  }
}

export { Q as CREDIT_QUOTA_UNIT, TZ as CREDIT_TIMEZONE }
