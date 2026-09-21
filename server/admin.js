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
 * Match session user against allowlist / local role.
 * - Local password users: role === 'admin' OR username in ADMIN_LOCAL_USERNAMES
 * - Linux.do: id, username, display_name/name, email allowlists
 */
export function isAdminUser(user, allowlist) {
  if (!user || !allowlist) return false

  const provider = String(user.auth_provider || 'linuxdo').toLowerCase()

  if (provider === 'local') {
    if (String(user.role || '').toLowerCase() === 'admin') return true
    const username = String(user.username || '').toLowerCase()
    if (username && allowlist.localUsernames && allowlist.localUsernames.has(username)) {
      return true
    }
    return false
  }

  // Legacy sessions from old aily-adapter login path
  if (provider === 'aily') {
    if (user.aily_admin === true) return true
    const role = Number(user.aily_role || 0)
    if (role >= 10) return true
    const username = String(user.username || '').toLowerCase()
    if (username && allowlist.localUsernames && allowlist.localUsernames.has(username)) {
      return true
    }
  }

  const hasAny =
    (allowlist.ids && allowlist.ids.size > 0) ||
    (allowlist.usernames && allowlist.usernames.size > 0) ||
    (allowlist.emails && allowlist.emails.size > 0) ||
    (allowlist.localUsernames && allowlist.localUsernames.size > 0)
  if (!hasAny && provider !== 'aily') return false

  const id = String(user.id ?? '')
  if (id && allowlist.ids.has(id)) return true

  const username = String(user.username || '').toLowerCase()
  if (username && allowlist.usernames.has(username)) return true

  const name = String(user.display_name || user.name || '').toLowerCase()
  if (name && allowlist.usernames.has(name)) return true

  const email = String(user.email || '').toLowerCase()
  if (allowlist.emails && allowlist.emails.size) {
    for (const candidate of [email, username, name]) {
      if (candidate && allowlist.emails.has(candidate)) return true
    }
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

export function mapAdminAccounts(authFilesPayload) {
  const files = Array.isArray(authFilesPayload?.files) ? authFilesPayload.files : []
  return files.map((f) => {
    const recent = Array.isArray(f.recent_requests) ? f.recent_requests : []
    return {
      id: f.id || f.name || f.auth_index,
      label: f.label || f.email || f.account || f.name,
      email: f.email || f.account || null,
      provider: f.provider || f.type || null,
      account_type: f.account_type || f.type || null,
      status: f.status || null,
      disabled: !!f.disabled,
      unavailable: !!f.unavailable,
      success: Number(f.success || 0) || 0,
      failed: Number(f.failed || 0) || 0,
      last_refresh: f.last_refresh || null,
      updated_at: f.updated_at || null,
      status_message: f.status_message || '',
      recent_requests: recent.slice(-12),
    }
  })
}

export function summarizeAccounts(accounts) {
  const items = Array.isArray(accounts) ? accounts : []
  const by_provider = {}
  let active = 0
  let unavailable = 0
  let disabled = 0
  for (const a of items) {
    const p = String(a.provider || 'unknown')
    by_provider[p] = (by_provider[p] || 0) + 1
    if (a.disabled) disabled += 1
    else if (a.unavailable) unavailable += 1
    else active += 1
  }
  return {
    total: items.length,
    active,
    unavailable,
    disabled,
    by_provider: Object.entries(by_provider)
      .map(([provider, count]) => ({ provider, count }))
      .sort((a, b) => b.count - a.count),
  }
}

