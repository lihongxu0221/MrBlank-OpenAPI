/**
 * Convert pasted Session / sub2api JSON into CPA-compatible auth-files.
 * Inspired by CPAMP paste_type_* behavior; no CPAMP dependency.
 */

function asObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null
}

function pick(...vals) {
  for (const v of vals) {
    if (v == null) continue
    const s = typeof v === 'string' ? v.trim() : v
    if (s !== '' && s != null) return s
  }
  return null
}

function safeNamePart(raw) {
  return String(raw || 'account')
    .toLowerCase()
    .replace(/[^a-z0-9._@+-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'account'
}

/** Basename-only auth filename. Rejects directories, `..`, and odd characters. */
export function safeAuthFileName(name) {
  const raw = String(name || '').trim()
  if (!raw || raw.length > 120 || raw.includes('..') || /[\\/]/.test(raw)) {
    throw Object.assign(new Error('invalid auth filename'), { status: 400 })
  }
  if (!/^[A-Za-z0-9._@+-]+$/.test(raw) || !raw.endsWith('.json')) {
    throw Object.assign(new Error('invalid auth filename'), { status: 400 })
  }
  return raw
}

function sessionToCodex(raw, now = new Date()) {
  const root = asObj(raw) || {}
  // Accept nested { session: {...} } or flat ChatGPT web export
  const session = asObj(root.session) || asObj(root.data) || root
  const user = asObj(session.user) || asObj(root.user) || {}
  const account = asObj(session.account) || asObj(root.account) || {}
  const access =
    pick(session.accessToken, session.access_token, root.accessToken, root.access_token, session.token) ||
    null
  const refresh = pick(
    session.refreshToken,
    session.refresh_token,
    root.refreshToken,
    root.refresh_token,
  )
  const sessionToken = pick(session.sessionToken, session.session_token, root.sessionToken, root.session_token)
  if (!access && !sessionToken) {
    throw Object.assign(new Error('Session JSON 缺少 accessToken / sessionToken'), { status: 400 })
  }
  const email = pick(user.email, account.email, session.email, root.email)
  const accountId = pick(account.id, account.account_id, session.account_id, root.account_id)
  const auth = {
    type: 'codex',
    access_token: access || sessionToken,
    ...(refresh ? { refresh_token: refresh } : {}),
    ...(sessionToken && sessionToken !== access ? { session_token: sessionToken } : {}),
    ...(email ? { email } : {}),
    ...(accountId ? { account_id: accountId } : {}),
    expired: session.expired ?? root.expired ?? null,
    last_refresh: now.toISOString(),
    source: 'session-convert',
  }
  const fileName = `codex-${safeNamePart(email || accountId || 'session')}.json`
  return { fileName, authJson: auth }
}

function extractSub2apiAccounts(raw) {
  const root = asObj(raw) || {}
  if (Array.isArray(raw)) return raw
  if (Array.isArray(root.accounts)) return root.accounts
  if (Array.isArray(root.proxies)) {
    // proxies may embed account payloads
    const out = []
    for (const p of root.proxies) {
      if (asObj(p)?.account) out.push(p.account)
      else if (asObj(p)?.auth || asObj(p)?.token || asObj(p)?.access_token) out.push(p)
      else if (asObj(p)) out.push(p)
    }
    if (out.length) return out
  }
  if (Array.isArray(root.items)) return root.items
  if (asObj(root.account) || root.access_token || root.accessToken) return [root]
  throw Object.assign(new Error('无法识别 sub2api 导出结构（需要 accounts / proxies / 单账号对象）'), {
    status: 400,
  })
}

function sub2apiAccountToCodex(item, now = new Date()) {
  const obj = asObj(item) || {}
  const nested = asObj(obj.auth) || asObj(obj.credential) || asObj(obj.session) || obj
  // Prefer converting via session path when ChatGPT-shaped
  if (nested.accessToken || nested.sessionToken || nested.user || nested.account) {
    return sessionToCodex(nested, now)
  }
  const access = pick(nested.access_token, nested.token, obj.access_token, obj.token)
  if (!access) {
    throw Object.assign(new Error('sub2api 账号缺少 access_token'), { status: 400 })
  }
  const email = pick(nested.email, obj.email, obj.name)
  const auth = {
    type: pick(nested.type, obj.type, 'codex') || 'codex',
    access_token: access,
    ...(pick(nested.refresh_token, obj.refresh_token) ? { refresh_token: pick(nested.refresh_token, obj.refresh_token) } : {}),
    ...(email ? { email } : {}),
    last_refresh: now.toISOString(),
    source: 'sub2api-convert',
  }
  return { fileName: `codex-${safeNamePart(email || 'sub2api')}.json`, authJson: auth }
}

/**
 * @param {'cpa'|'session'|'sub2api'} pasteType
 * @param {string} content
 * @param {string} [preferredName]
 */
export function convertPasteToAuthFiles(pasteType, content, preferredName = '') {
  let parsed
  try {
    parsed = typeof content === 'string' ? JSON.parse(content) : content
  } catch {
    throw Object.assign(new Error('JSON 解析失败'), { status: 400 })
  }
  const type = String(pasteType || 'cpa').toLowerCase()
  const now = new Date()

  if (type === 'cpa') {
    if (!parsed || typeof parsed !== 'object') {
      throw Object.assign(new Error('CPA JSON 须为对象'), { status: 400 })
    }
    const fileName = preferredName?.trim()
      ? safeAuthFileName(preferredName)
      : `${safeNamePart(parsed.type || parsed.provider || 'auth')}-${safeNamePart(parsed.email || parsed.name || 'file')}.json`
    return { files: [{ fileName, authJson: parsed }], failures: [], convertedSourceCount: 1 }
  }

  if (type === 'session') {
    const one = sessionToCodex(parsed, now)
    if (preferredName?.trim()) one.fileName = safeAuthFileName(preferredName)
    return { files: [one], failures: [], convertedSourceCount: 1 }
  }

  if (type === 'sub2api') {
    const accounts = extractSub2apiAccounts(parsed)
    const files = []
    const failures = []
    let i = 0
    for (const acc of accounts) {
      i += 1
      try {
        const converted = sub2apiAccountToCodex(acc, now)
        // disambiguate duplicate names
        if (files.some((f) => f.fileName === converted.fileName)) {
          converted.fileName = converted.fileName.replace(/\.json$/i, `-${i}.json`)
        }
        files.push(converted)
      } catch (err) {
        failures.push({ index: i, error: err?.message || String(err) })
      }
    }
    if (!files.length) {
      throw Object.assign(new Error(failures[0]?.error || 'sub2api 转换未产生任何文件'), { status: 400 })
    }
    return { files, failures, convertedSourceCount: accounts.length }
  }

  throw Object.assign(new Error('pasteType 须为 cpa|session|sub2api'), { status: 400 })
}
