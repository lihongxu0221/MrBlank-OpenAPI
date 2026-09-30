/**
 * Admin allowlist + sanitized CPAMP/CPA views for the OpenAPI operator console.
 * Management / Admin keys never leave the server.
 */

function splitList(raw) {
  return String(raw || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function loadAdminAllowlist(env = process.env) {
  const ids = new Set(splitList(env.ADMIN_LINUXDO_IDS).map(String))
  const usernames = new Set(
    splitList(env.ADMIN_LINUXDO_USERNAMES).map((s) => s.toLowerCase()),
  )
  const emails = new Set(splitList(env.ADMIN_LINUXDO_EMAILS).map((s) => s.toLowerCase()))
  // Legacy alias: ADMIN_AILY_USERNAMES still accepted as local-username allowlist
  const localUsernames = new Set(
    [
      ...splitList(env.ADMIN_LOCAL_USERNAMES),
      ...splitList(env.ADMIN_AILY_USERNAMES),
    ].map((s) => s.toLowerCase()),
  )
  return { ids, usernames, emails, localUsernames, ailyUsernames: localUsernames }
}

/**
 * Decide whether a session user is an administrator.
 * - Local password users: ONLY role === 'admin' (persisted in local-users.json).
 *   ADMIN_LOCAL_USERNAMES / BOOTSTRAP_ADMIN_USER are used solely to seed that role
 *   for an existing/bootstrap account at startup — never as a live username match
 *   (a re-registered username must not inherit admin).
 * - Linux.do users: immutable numeric id in ADMIN_LINUXDO_IDS, or the OAuth email
 *   field in ADMIN_LINUXDO_EMAILS only when email_verified === true.
 *   Never username / display_name (user-editable). Missing verified flag does not grant admin.
 * - Legacy aily sessions: never admin (login path removed).
 */
export function isAdminUser(user, allowlist) {
  if (!user || !allowlist) return false
  const provider = String(user.auth_provider || 'linuxdo').toLowerCase()

  if (provider === 'local') {
    return String(user.role || '').toLowerCase() === 'admin'
  }
  if (provider !== 'linuxdo') return false

  const id = String(user.id ?? '').trim()
  if (id && /^\d+$/.test(id) && allowlist.ids && allowlist.ids.has(id)) return true

  const email = String(user.oauth_email ?? user.email ?? '').trim().toLowerCase()
  if (email && email.includes('@') && allowlist.emails && allowlist.emails.has(email)) {
    // Missing flag is not verified. IdP must say true.
    return user.email_verified === true
  }
  return false
}

export function maskSecretValue(value) {
  const s = String(value || '')
  if (!s) return ''
  if (s.length <= 8) return '****'
  return `${s.slice(0, 6)}****${s.slice(-4)}`
}

/** Strip secrets from CPAMP/CPA config for admin UI. */
export function sanitizeConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return {}
  const out = {}
  for (const [k, v] of Object.entries(cfg)) {
    const lower = k.toLowerCase()
    if (
      lower.includes('key') ||
      lower.includes('secret') ||
      lower.includes('token') ||
      lower.includes('password') ||
      lower === 'api-keys'
    ) {
      if (Array.isArray(v))
        out[k] = v.map((item) => (typeof item === 'string' ? maskSecretValue(item) : '[redacted]'))
      else if (typeof v === 'string') out[k] = maskSecretValue(v)
      else out[k] = '[redacted]'
      continue
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = sanitizeConfig(v)
    } else {
      out[k] = v
    }
  }
  return out
}

export function summarizeUsage(usage) {
  const byModel = {}
  const byEndpoint = {}
  const apis = usage?.apis || {}
  for (const [endpoint, meta] of Object.entries(apis)) {
    let epCalls = 0
    let epFail = 0
    let epTokens = 0
    for (const [modelName, modelMeta] of Object.entries(meta?.models || {})) {
      const details = Array.isArray(modelMeta?.details) ? modelMeta.details : []
      let calls = 0
      let failed = 0
      let tokens = 0
      for (const d of details) {
        calls += 1
        if (d.failed) failed += 1
        const t = d.tokens || {}
        tokens += Number(t.total_tokens ?? 0) || 0
      }
      const prev = byModel[modelName] || { calls: 0, failed: 0, tokens: 0 }
      byModel[modelName] = {
        calls: prev.calls + calls,
        failed: prev.failed + failed,
        tokens: prev.tokens + tokens,
      }
      epCalls += calls
      epFail += failed
      epTokens += tokens
    }
    byEndpoint[endpoint] = { calls: epCalls, failed: epFail, tokens: epTokens }
  }
  return {
    total_requests: usage?.total_requests ?? 0,
    success_count: usage?.success_count ?? 0,
    failure_count: usage?.failure_count ?? 0,
    total_tokens: usage?.total_tokens ?? 0,
    by_model: Object.entries(byModel)
      .map(([model, s]) => ({ model, ...s }))
      .sort((a, b) => b.calls - a.calls),
    by_endpoint: Object.entries(byEndpoint)
      .map(([endpoint, s]) => ({ endpoint, ...s }))
      .sort((a, b) => b.calls - a.calls),
  }
}

function attr(f, key, fallback = null) {
  if (f?.[key] !== undefined && f?.[key] !== null) return f[key]
  const kebab = String(key || '').includes('_') ? String(key).replaceAll('_', '-') : null
  if (kebab && f?.[kebab] !== undefined && f?.[kebab] !== null) return f[kebab]
  if (f?.attributes && f.attributes[key] !== undefined && f.attributes[key] !== null) return f.attributes[key]
  if (kebab && f?.attributes && f.attributes[kebab] !== undefined && f.attributes[kebab] !== null) {
    return f.attributes[kebab]
  }
  return fallback
}


function decodeJwtPayload(token) {
  if (!token) return null
  if (typeof token === 'object' && !Array.isArray(token)) return token
  if (typeof token !== 'string') return null
  const t = token.trim()
  if (!t) return null
  try {
    const asJson = JSON.parse(t)
    if (asJson && typeof asJson === 'object') return asJson
  } catch {
    /* not json */
  }
  const parts = t.split('.')
  if (parts.length < 2) return null
  try {
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4
    if (pad) b64 += '='.repeat(4 - pad)
    const json = Buffer.from(b64, 'base64').toString('utf8')
    const obj = JSON.parse(json)
    return obj && typeof obj === 'object' ? obj : null
  } catch {
    return null
  }
}

function normalizePlanType(raw) {
  if (raw == null) return null
  const s = String(raw).trim()
  return s ? s.toLowerCase() : null
}

function asPlanObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null
}

function isUnknownPlan(raw) {
  return normalizePlanType(raw) === 'unknown'
}

/** First non-null trim; prefer non-"unknown" when present (CPAMP sE). */
function pickPlanCandidate(list) {
  const vals = (Array.isArray(list) ? list : [])
    .map((v) => (v == null ? null : String(v).trim() || null))
    .filter((v) => v != null)
  if (!vals.length) return null
  const preferred = vals.find((v) => !isUnknownPlan(v))
  return preferred ?? vals[0]
}

/** CPAMP gu() — plan from file / attributes / id_token JWT (codex-oriented). */
export function resolvePlanTypeGu(f) {
  if (!f || typeof f !== 'object') return null
  const metadata = asPlanObject(f.metadata)
  const attributes = asPlanObject(f.attributes)
  const idTokObj = asPlanObject(f.id_token)
  const metaIdTok = metadata ? asPlanObject(metadata.id_token) : null
  const fromJwt = (tok) => {
    const payload = decodeJwtPayload(tok)
    return payload ? normalizePlanType(payload.plan_type ?? payload.planType) : null
  }
  const candidates = [
    f.plan_type,
    f.planType,
    f.plan_type,
    f.planType,
    fromJwt(f.id_token),
    idTokObj?.plan_type,
    idTokObj?.planType,
    metadata?.plan_type,
    metadata?.planType,
    fromJwt(metadata?.id_token),
    metaIdTok?.plan_type,
    metaIdTok?.planType,
    attributes?.plan_type,
    attributes?.planType,
    fromJwt(attributes?.id_token),
  ]
  for (const c of candidates) {
    const n = normalizePlanType(c)
    if (n) return n
  }
  return null
}

/** CPAMP cE() — subscription object → plan/tierName/tierId. */
export function planFromSubscription(sub) {
  const obj = asPlanObject(sub)
  if (obj) return pickPlanCandidate([obj.plan, obj.tierName, obj.tierId])
  return sub == null ? null : String(sub).trim() || null
}

/**
 * CPAMP iE() — antigravity subscription prefers plan, else fallback, else tierName/tierId.
 * Returns raw plan string (not normalized) for display mapping.
 */
export function planFromAntigravitySubscription(sub, fallbackPlan = null) {
  const obj = asPlanObject(sub)
  const norm = (v) => {
    if (v == null) return null
    const s = typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : null
    if (!s) return null
    return { raw: s, normalized: s.toLowerCase() }
  }
  const plan = norm(obj ? obj.plan : sub)
  const fb = norm(fallbackPlan)
  const tiers = [norm(obj?.tierName), norm(obj?.tierId)].filter(Boolean)
  if (plan && plan.normalized !== 'unknown') return plan.raw
  if (fb && fb.normalized !== 'unknown') return fb.raw
  const hit = [plan, ...tiers, fb].find((x) => x && x.normalized !== 'unknown')
  return hit?.raw ?? plan?.raw ?? tiers[0]?.raw ?? fb?.raw ?? null
}

/**
 * CPAMP lE() — full plan resolver used by account list (oCe).
 * Codex: gu() first. Else JWT → plan_type/tier fields → subscription.
 */
export function resolvePlanType(f) {
  if (!f || typeof f !== 'object') return null
  const provider = String(f.provider ?? f.type ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
  const metadata = asPlanObject(f.metadata)
  const attributes = asPlanObject(f.attributes)

  if (provider === 'codex') {
    const codex = resolvePlanTypeGu(f)
    if (codex && !isUnknownPlan(codex)) return codex
  }

  const fromJwtTok = (tok) => {
    const payload = decodeJwtPayload(tok)
    return payload ? pickPlanCandidate([payload.plan_type, payload.planType]) : null
  }
  const jwtPlan = pickPlanCandidate(
    [f.id_token, metadata?.id_token, attributes?.id_token].map(fromJwtTok),
  )
  if (jwtPlan && !isUnknownPlan(jwtPlan)) return normalizePlanType(jwtPlan)

  const fieldPlan = pickPlanCandidate([
    f.plan_type,
    f.planType,
    metadata?.plan_type,
    metadata?.planType,
    attributes?.plan_type,
    attributes?.planType,
    f.tier,
    f.tierName,
    f.tierId,
    f.subscriptionType,
    f.accountType,
    f.chatgpt_plan_type,
    f.plan,
  ])
  if (fieldPlan && !isUnknownPlan(fieldPlan)) return normalizePlanType(fieldPlan)

  const subPlan =
    provider === 'antigravity'
      ? planFromAntigravitySubscription(f.subscription)
      : planFromSubscription(f.subscription)
  const metaSub = planFromSubscription(metadata?.subscription)
  const attrSub = planFromSubscription(attributes?.subscription)
  const fromSub = pickPlanCandidate([subPlan, metaSub, attrSub])
  if (fromSub) return normalizePlanType(fromSub)

  // Fallbacks already tried above; keep gu() as last resort for non-codex
  const gu = resolvePlanTypeGu(f)
  return gu && !isUnknownPlan(gu) ? gu : normalizePlanType(jwtPlan || fieldPlan || fromSub || gu)
}

function numOrNull(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Best-effort quota from CPA auth-file fields (no extra probe).
 * Returns { quota, quota_windows } or nulls.
 */
export function extractAuthFileQuota(f) {
  if (!f || typeof f !== 'object') return { quota: null, quota_windows: null }
  const attrs = f.attributes && typeof f.attributes === 'object' ? f.attributes : {}
  const pick = (...keys) => {
    for (const k of keys) {
      if (f[k] != null) return f[k]
      if (attrs[k] != null) return attrs[k]
    }
    return null
  }

  let windows = []
  const rawWindows = pick('quota_windows', 'quotaWindows', 'quotas')
  if (Array.isArray(rawWindows)) {
    windows = rawWindows
      .map((w) => {
        if (!w || typeof w !== 'object') return null
        const usedPct = numOrNull(w.used_percent ?? w.usedPercent ?? w.header_quota_used_percent)
        let remaining_ratio = numOrNull(w.remaining_ratio ?? w.remainingRatio)
        if (remaining_ratio == null && usedPct != null) remaining_ratio = Math.max(0, Math.min(1, 1 - usedPct / 100))
        const remaining = numOrNull(w.remaining)
        const limit = numOrNull(w.limit)
        if (remaining_ratio == null && remaining != null && limit != null && limit > 0) {
          remaining_ratio = Math.max(0, Math.min(1, remaining / limit))
        }
        if (remaining_ratio == null && remaining == null && limit == null && usedPct == null) return null
        const risk =
          remaining_ratio == null
            ? null
            : remaining_ratio <= 0
              ? 'exhausted'
              : remaining_ratio < 0.2
                ? 'critical'
                : remaining_ratio < 0.5
                  ? 'low'
                  : 'ok'
        return {
          label: String(w.label || w.window || w.name || w.model || '额度'),
          window: w.window != null ? String(w.window) : w.name != null ? String(w.name) : null,
          remaining_ratio,
          remaining,
          limit,
          resets_at: w.resets_at != null ? String(w.resets_at) : w.reset_at != null ? String(w.reset_at) : null,
          risk,
          used_cost: numOrNull(w.used_cost ?? w.usedCost ?? w.current_cost ?? w.currentCost),
          used_tokens: numOrNull(w.used_tokens ?? w.usedTokens ?? w.current_tokens ?? w.currentTokens),
          forecast_cost: numOrNull(w.forecast_cost ?? w.forecastCost),
          forecast_tokens: numOrNull(w.forecast_tokens ?? w.forecastTokens),
        }
      })
      .filter(Boolean)
  }

  const usedPct = numOrNull(
    pick('used_percent', 'usedPercent', 'header_quota_used_percent', 'quota_used_percent'),
  )
  let remaining_ratio = numOrNull(pick('remaining_ratio', 'remainingRatio', 'quota_remaining_ratio'))
  if (remaining_ratio == null && usedPct != null) remaining_ratio = Math.max(0, Math.min(1, 1 - usedPct / 100))
  const remaining = numOrNull(pick('remaining', 'quota_remaining'))
  const limit = numOrNull(pick('limit', 'quota_limit'))
  if (remaining_ratio == null && remaining != null && limit != null && limit > 0) {
    remaining_ratio = Math.max(0, Math.min(1, remaining / limit))
  }
  const resets_at = pick('resets_at', 'reset_at', 'quota_resets_at')
  const window = pick('window', 'quota_window')

  let quota = null
  if (remaining_ratio != null || remaining != null || limit != null || windows.length) {
    const primary = windows[0]
    const ratio = remaining_ratio ?? primary?.remaining_ratio ?? null
    const risk =
      ratio == null ? null : ratio <= 0 ? 'exhausted' : ratio < 0.2 ? 'critical' : ratio < 0.5 ? 'low' : 'ok'
    quota = {
      remaining_ratio: ratio,
      remaining: remaining ?? primary?.remaining ?? null,
      limit: limit ?? primary?.limit ?? null,
      window: window != null ? String(window) : primary?.window || null,
      resets_at: resets_at != null ? String(resets_at) : primary?.resets_at || null,
      risk: risk || primary?.risk || null,
      plan_type: resolvePlanType(f),
      source: 'cpa:auth-files',
    }
  }

  return {
    quota,
    quota_windows: windows.length ? windows : null,
  }
}

export function deriveDisplayStatus(f) {
  if (f?.disabled) return 'disabled'
  const st = String(f?.status || f?.display_status || '').toLowerCase()
  const msg = String(f?.status_message || f?.error || '').toLowerCase()
  const blob = `${st} ${msg}`
  if (
    /reauth|re-auth|need.?reauth|expired|unauthorized|login.?required|invalid.?token|refresh.?fail|auth.?fail|token.?revok/.test(
      blob,
    )
  ) {
    return 'need_reauth'
  }
  if (f?.unavailable) return 'unavailable'
  if (/exhaust|quota.?risk|rate.?limit|limit.?exceed|unavailable|error|fail|ban/.test(blob)) return 'unavailable'
  if (/disable|off|paused/.test(blob)) return 'disabled'
  if (/run|active|ok|ready|available|normal|success/.test(st) || !st) return 'running'
  return st || 'running'
}

export function mapAdminAccounts(authFilesPayload) {
  const files = Array.isArray(authFilesPayload?.files) ? authFilesPayload.files : []
  return files.map((f) => {
    const recent = Array.isArray(f.recent_requests) ? f.recent_requests : []
    const disabled = !!f.disabled
    const unavailable = !!f.unavailable
    const display_status = deriveDisplayStatus(f)
    const plan_type = resolvePlanType(f)
    const { quota, quota_windows } = extractAuthFileQuota(f)
    return {
      id: f.id || f.name || f.auth_index,
      name: f.name || f.id || null,
      auth_index: f.auth_index || null,
      label: f.label || f.email || f.account || f.name,
      email: f.email || f.account || null,
      provider: f.provider || f.type || null,
      account_type: f.account_type || f.type || null,
      status: f.status || null,
      display_status,
      disabled,
      unavailable,
      success: Number(f.success || 0) || 0,
      failed: Number(f.failed || 0) || 0,
      last_refresh: f.last_refresh || null,
      created_at: f.created_at || f.ctime || null,
      updated_at: f.updated_at || f.modtime || null,
      status_message: f.status_message || '',
      note: attr(f, 'note', null),
      priority: attr(f, 'priority', null),
      weight: attr(f, 'weight', null),
      proxy_url: attr(f, 'proxy_url', attr(f, 'proxy', null)),
      prefix: attr(f, 'prefix', null),
      websockets: attr(f, 'websockets', null),
      cooling: attr(f, 'cooling', null),
      excluded_models:
        attr(f, 'excluded_models', null) ?? f.excludedModels ?? f['excluded-models'] ?? null,
      plan_type,
      recent_requests: recent.slice(-12),
      ...(quota ? { quota } : {}),
      ...(quota_windows ? { quota_windows } : {}),
    }
  })
}

export function summarizeAccounts(accounts) {
  const items = Array.isArray(accounts) ? accounts : []
  const by_provider = {}
  let active = 0
  let unavailable = 0
  let disabled = 0
  let need_reauth = 0
  let attention = 0
  for (const a of items) {
    const p = String(a.provider || 'unknown')
    by_provider[p] = (by_provider[p] || 0) + 1
    const display = a.display_status || deriveDisplayStatus(a)
    if (display === 'disabled' || a.disabled) disabled += 1
    else if (display === 'need_reauth') {
      need_reauth += 1
      attention += 1
    } else if (display === 'unavailable' || a.unavailable) {
      unavailable += 1
      attention += 1
    } else active += 1
  }
  return {
    total: items.length,
    active,
    unavailable,
    disabled,
    need_reauth,
    attention,
    by_provider: Object.entries(by_provider)
      .map(([provider, count]) => ({ provider, count }))
      .sort((a, b) => b.count - a.count),
  }
}

