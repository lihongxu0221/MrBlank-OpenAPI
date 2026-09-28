/**
 * CPAMP-literal quota client (copy from management.html AccountsPage).
 *
 * Display SoT: POST {CPAMP}/v0/management/quota-snapshots/query
 *   accounts[] = { row_key, provider, account: { auth_file_snapshot, auth_index, ... } }
 * Refresh (antigravity): CPA POST /v0/management/api-call → Google retrieveUserQuotaSummary
 *   (same as CPAMP Fle via up.request), then map groups → quota_windows.
 *
 * CPA itself has NO quota-snapshots / account-window-usage (404 probed).
 */
import { cpaApiCall, queryCpampQuotaSnapshots } from './cpa.js'

const ANTIGRAVITY_QUOTA_URLS = [
  'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
  'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary',
  'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
]

const ANTIGRAVITY_MODEL_URLS = [
  'https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
  'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels',
  'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
]

const ANTIGRAVITY_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'User-Agent': 'antigravity/cli/1.0.13 (aidev_client; os_type=linux; arch=x64)',
}

/** CPAMP RO() + hEe() + OEe() — build QueryAccount list from CPA auth-files. */
export function buildCpampQueryAccounts(authFilesPayloadOrFiles) {
  const files = Array.isArray(authFilesPayloadOrFiles)
    ? authFilesPayloadOrFiles
    : Array.isArray(authFilesPayloadOrFiles?.files)
      ? authFilesPayloadOrFiles.files
      : []
  const out = []
  for (const f of files) {
    if (!f || typeof f !== 'object') continue
    const name = String(f.name || f.id || '').trim()
    const provider = String(f.provider || f.type || '').trim().toLowerCase()
    if (!name) continue
    // OEe only queries these providers
    if (!['codex', 'claude', 'antigravity', 'kimi', 'xai', 'devin', 'meta'].includes(provider)) continue
    const email = String(f.email || f.account || '').trim()
    const label = String(f.label || email || name).trim()
    const authIndex = f.auth_index != null ? String(f.auth_index) : f.authIndex != null ? String(f.authIndex) : ''
    const projectId = f.project_id != null ? String(f.project_id) : f.projectId != null ? String(f.projectId) : ''
    out.push({
      row_key: name,
      provider,
      account: {
        account_snapshot: email || name,
        auth_label_snapshot: label,
        auth_file_snapshot: name,
        auth_provider_snapshot: provider,
        auth_account_id_snapshot: provider === 'codex' ? String(f.account_id || f.accountId || '') : '',
        auth_project_id_snapshot: provider === 'codex' ? '' : projectId,
        auth_index: authIndex,
        source: name,
      },
    })
  }
  return out
}

function riskFromRatio(ratio) {
  if (ratio == null || !Number.isFinite(ratio)) return null
  if (ratio <= 0) return 'exhausted'
  if (ratio < 0.2) return 'critical'
  if (ratio < 0.5) return 'low'
  return 'ok'
}

function numOrNull(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * CPAMP-style window label for list bars (Claude 5h / Gemini 5h / weekly).
 * Mirrors antigravity group+bucket naming and VAe window_kind fallbacks.
 */
export function labelCpampWindow(w, provider) {
  if (!w || typeof w !== 'object') return '额度'
  const pid = String(w.provider_window_id || '').toLowerCase()
  const scope = String(w.model_scope_key || '').toLowerCase()
  const kind = String(w.window_kind || '').toLowerCase()
  const mode = String(w.window_mode || '').toLowerCase()

  let family = ''
  if (/claude|gpt|claude_gpt|3p-/.test(`${pid} ${scope}`)) family = 'Claude'
  else if (/gemini/.test(`${pid} ${scope}`)) family = 'Gemini'
  else if (/xai|grok|credits/.test(`${pid} ${scope}`)) family = 'xAI'
  else if (provider) family = String(provider)

  let slot = ''
  if (kind === 'five_hour' || /5h|five.?hour|3p-5h/.test(pid)) slot = '5h'
  else if (kind === 'weekly' || /weekly|7d/.test(pid)) slot = '周额度'
  else if (kind === 'daily' || /daily|24h/.test(pid)) slot = '日额度'
  else if (kind === 'monthly' || /month/.test(pid)) slot = '月额度'
  else if (kind === 'product' || mode === 'non_window') slot = w.provider_window_id || '额度'
  else if (w.provider_window_id) return String(w.provider_window_id)

  if (family && slot && slot !== w.provider_window_id) return `${family} ${slot}`
  return slot || family || '额度'
}

/** Prefer standard 5h/weekly family windows for list (skip shared model pools). */
export function isListQuotaWindow(w) {
  if (!w || typeof w !== 'object') return false
  const kind = String(w.window_kind || '').toLowerCase()
  const scopeKind = String(w.model_scope_kind || '').toLowerCase()
  const mode = String(w.window_mode || '').toLowerCase()
  if (mode === 'non_window') return false
  if (kind === 'product' || kind === 'unknown') return false
  if (scopeKind === 'models') return false
  return ['five_hour', 'weekly', 'daily', 'monthly', 'rolling_24h'].includes(kind) || kind === ''
}

/**
 * Map one CPAMP snapshot window → OpenAPI QuotaWindow.
 */
export function mapCpampWindow(w, provider) {
  if (!w || typeof w !== 'object') return null
  const usedPct = numOrNull(w.used_percent ?? w.usedPercent)
  let remaining_ratio = numOrNull(w.remaining_percent ?? w.remainingPercent)
  if (remaining_ratio != null) remaining_ratio = Math.max(0, Math.min(1, remaining_ratio / 100))
  else if (usedPct != null) remaining_ratio = Math.max(0, Math.min(1, 1 - usedPct / 100))

  const endMs = numOrNull(w.cycle_end_ms ?? w.cycleEndMs)
  const resets_at = endMs != null && endMs > 0 ? new Date(endMs).toISOString() : null
  const risk = riskFromRatio(remaining_ratio)
  return {
    label: labelCpampWindow(w, provider),
    window: w.provider_window_id != null ? String(w.provider_window_id) : null,
    remaining_ratio,
    remaining: null,
    limit: null,
    resets_at,
    risk,
    used_percent: usedPct,
    window_kind: w.window_kind != null ? String(w.window_kind) : null,
    model_scope_key: w.model_scope_key != null ? String(w.model_scope_key) : null,
    stale: !!w.stale,
    source: 'cpamp:quota-snapshots',
  }
}

/**
 * Map CPAMP query items → Map<row_key, { quota_windows, quota, plan_type }>.
 */
export function mapCpampQueryToAccountQuota(queryResult) {
  const items = Array.isArray(queryResult?.items) ? queryResult.items : []
  const byKey = new Map()
  for (const it of items) {
    const key = String(it?.row_key || it?.account?.auth_file_snapshot || '').trim()
    if (!key) continue
    const provider = String(it?.provider || '').trim()
    const rawWindows = Array.isArray(it?.windows) ? it.windows : []
    const mapped = rawWindows
      .filter((w) => isListQuotaWindow(w))
      .map((w) => mapCpampWindow(w, provider))
      .filter(Boolean)
    // Fallback: if filter emptied but raw had data, map all non-product
    const windows =
      mapped.length > 0
        ? mapped
        : rawWindows
            .filter((w) => w && String(w.window_mode || '') !== 'non_window')
            .map((w) => mapCpampWindow(w, provider))
            .filter(Boolean)

    // Sort like CPAMP sOe: shorter duration first, Claude before Gemini
    windows.sort((a, b) => {
      const da = durationRank(a.window_kind)
      const db = durationRank(b.window_kind)
      if (da !== db) return da - db
      return familyRank(a.label) - familyRank(b.label)
    })

    const primary = windows[0]
    const quota = primary
      ? {
          remaining_ratio: primary.remaining_ratio,
          remaining: primary.remaining,
          limit: primary.limit,
          window: primary.window,
          resets_at: primary.resets_at,
          risk: primary.risk,
          plan_type: null,
          observed_at_ms: numOrNull(rawWindows[0]?.observed_at_ms) || Date.now(),
          source: 'cpamp:quota-snapshots',
        }
      : null

    byKey.set(key, {
      quota_windows: windows.length ? windows : null,
      quota,
      plan_type: null,
      raw_window_count: rawWindows.length,
    })
  }
  return byKey
}

function durationRank(kind) {
  const k = String(kind || '').toLowerCase()
  if (k === 'five_hour') return 0
  if (k === 'daily' || k === 'rolling_24h') return 1
  if (k === 'weekly') return 2
  if (k === 'monthly') return 3
  return 9
}

function familyRank(label) {
  const s = String(label || '').toLowerCase()
  if (s.includes('claude') || s.includes('gpt')) return 0
  if (s.includes('gemini')) return 1
  return 2
}

/** Merge CPAMP quota map into admin account rows (prefer CPAMP windows when present). */
export function mergeCpampQuotaIntoAccounts(accounts, quotaByKey) {
  const items = Array.isArray(accounts) ? accounts : []
  if (!(quotaByKey instanceof Map) || quotaByKey.size === 0) return items
  return items.map((a) => {
    const key = String(a?.name || a?.id || '').trim()
    const hit = key ? quotaByKey.get(key) : null
    if (!hit || !hit.quota_windows?.length) return a
    return {
      ...a,
      plan_type: a.plan_type || hit.plan_type || null,
      quota: hit.quota || a.quota || null,
      quota_windows: hit.quota_windows,
    }
  })
}

/**
 * Fetch quota snapshots from CPAMP (literal SPA Yd.query).
 */
export async function fetchCpampAccountQuotas(cfg, authFilesPayload) {
  if (!cfg?.adminKey) {
    return { byKey: new Map(), meta: { ok: false, error: 'CPAMP admin key not configured', source: 'cpamp:quota-snapshots' } }
  }
  const accounts = buildCpampQueryAccounts(authFilesPayload)
  if (!accounts.length) {
    return { byKey: new Map(), meta: { ok: true, count: 0, source: 'cpamp:quota-snapshots' } }
  }
  const result = await queryCpampQuotaSnapshots(cfg, {
    accounts,
    include_inactive: true,
    now_ms: Date.now(),
  })
  const byKey = mapCpampQueryToAccountQuota(result)
  return {
    byKey,
    meta: {
      ok: true,
      count: byKey.size,
      with_windows: [...byKey.values()].filter((v) => v.quota_windows?.length).length,
      generated_at_ms: result?.generated_at_ms ?? null,
      source: 'cpamp:quota-snapshots',
    },
    raw: result,
  }
}

/** Parse Google retrieveUserQuotaSummary / fetchAvailableModels body → groups (CPAMP hse). */
export function parseAntigravityQuotaGroups(body) {
  const raw = typeof body === 'string' ? safeJson(body) : body
  if (!raw || typeof raw !== 'object') return []
  const groupsIn = Array.isArray(raw.groups) ? raw.groups : []
  const groups = groupsIn
    .map((g, gi) => {
      const label = String(g.displayName ?? g.display_name ?? `Quota Group ${gi + 1}`).trim()
      const id = slugify(label) || `quota-group-${gi + 1}`
      const buckets = (Array.isArray(g.buckets) ? g.buckets : [])
        .map((b, bi) => {
          const remainingFraction = numOrNull(b.remainingFraction ?? b.remaining_fraction)
          if (remainingFraction == null) return null
          const window = b.window != null ? String(b.window) : undefined
          const bucketId =
            String(b.bucketId ?? b.bucket_id ?? '').trim() || `${id}-${window || `bucket-${bi + 1}`}`
          return {
            id: bucketId,
            label: String(b.displayName ?? b.display_name ?? bucketId).trim(),
            window,
            remainingFraction: Math.max(0, Math.min(1, remainingFraction)),
            resetTime: b.resetTime ?? b.reset_time ? String(b.resetTime ?? b.reset_time) : undefined,
          }
        })
        .filter(Boolean)
      if (!buckets.length) return null
      return { id, label, buckets }
    })
    .filter(Boolean)
  return groups
}

function safeJson(s) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function slugify(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Map antigravity groups → UI quota_windows (CPAMP tEe labels). */
export function mapAntigravityGroupsToWindows(groups) {
  const out = []
  for (const g of groups || []) {
    const groupLabel = translateAntigravityGroup(g.label)
    for (const b of g.buckets || []) {
      const bucketLabel = translateAntigravityBucket(b.label || b.window || b.id)
      const remaining_ratio = numOrNull(b.remainingFraction)
      const resets_at = b.resetTime ? tryIso(b.resetTime) : null
      out.push({
        label: composeAntigravityLabel(groupLabel, bucketLabel),
        window: b.window || b.id || null,
        remaining_ratio,
        remaining: null,
        limit: null,
        resets_at,
        risk: riskFromRatio(remaining_ratio),
        source: 'cpa:api-call',
      })
    }
  }
  return out
}

function translateAntigravityGroup(label) {
  const s = String(label || '').toLowerCase()
  if (s.includes('gemini')) return 'Gemini'
  if (s.includes('claude') || s.includes('gpt')) return 'Claude'
  return String(label || '').trim() || '额度'
}

function translateAntigravityBucket(label) {
  const s = String(label || '').toLowerCase()
  if (/5.?hour|five.?hour|5h/.test(s)) return '5h'
  if (/week/.test(s)) return '周额度'
  if (/day|daily|24/.test(s)) return '日额度'
  if (/month/.test(s)) return '月额度'
  return String(label || '').trim() || '额度'
}

function composeAntigravityLabel(group, bucket) {
  if (/claude|gemini/i.test(bucket)) return bucket
  if (group && bucket) return `${group} ${bucket}`
  return bucket || group || '额度'
}

function tryIso(v) {
  const t = Date.parse(String(v))
  return Number.isFinite(t) ? new Date(t).toISOString() : String(v)
}

/**
 * Refresh one antigravity account via CPA api-call (CPAMP Fle).
 * Limited URL fan-out; stops on first success.
 */
export async function refreshAntigravityQuota(cfg, file) {
  const authIndex = String(file?.auth_index ?? file?.authIndex ?? '').trim()
  if (!authIndex) {
    return { status: 'error', error: 'missing auth_index', name: file?.name }
  }
  const project =
    String(file?.project_id || file?.projectId || '').trim() || 'aicode-consumers'
  const data = JSON.stringify({ project })
  let lastErr = 'unknown'
  let lastStatus = null
  for (const url of [...ANTIGRAVITY_QUOTA_URLS, ...ANTIGRAVITY_MODEL_URLS]) {
    try {
      const res = await cpaApiCall(cfg, {
        authIndex,
        method: 'POST',
        url,
        header: { ...ANTIGRAVITY_HEADERS },
        data,
      })
      const statusCode = Number(res?.status_code ?? res?.statusCode ?? 0)
      if (statusCode < 200 || statusCode >= 300) {
        lastStatus = statusCode
        lastErr = `upstream ${statusCode}`
        if (statusCode === 429) {
          return { status: 'error', error: lastErr, errorStatus: 429, rateLimited: true, name: file?.name }
        }
        continue
      }
      const body = res?.body ?? res?.bodyText ?? res
      const groups = parseAntigravityQuotaGroups(body)
      if (!groups.length) {
        lastErr = 'empty_models'
        continue
      }
      const windows = mapAntigravityGroupsToWindows(groups)
      return {
        status: 'success',
        name: file?.name,
        provider: 'antigravity',
        quota_windows: windows,
        groups_count: groups.length,
        source: 'cpa:api-call',
      }
    } catch (err) {
      lastErr = err?.message || String(err)
      lastStatus = err?.status || lastStatus
      if (lastStatus === 429 || /429/.test(lastErr)) {
        return { status: 'error', error: lastErr, errorStatus: 429, rateLimited: true, name: file?.name }
      }
    }
  }
  return { status: 'error', error: lastErr, errorStatus: lastStatus, name: file?.name }
}

/**
 * Batch refresh: antigravity via api-call (serial per provider to avoid ban);
 * others: re-query CPAMP snapshots only.
 */
export async function refreshAccountQuotas(cfg, authFilesPayload, { names = null } = {}) {
  const files = Array.isArray(authFilesPayload?.files) ? authFilesPayload.files : []
  const allow = Array.isArray(names) && names.length ? new Set(names.map((n) => String(n).trim())) : null
  const targets = files.filter((f) => {
    const name = String(f?.name || '').trim()
    if (!name) return false
    if (allow && !allow.has(name)) return false
    return true
  })

  const results = []
  let rateLimited = false

  // Antigravity: one at a time (CPAMP perProviderConcurrency)
  for (const f of targets) {
    const provider = String(f.provider || f.type || '').toLowerCase()
    if (provider !== 'antigravity') continue
    if (rateLimited) {
      results.push({ name: f.name, status: 'skipped', reason: 'provider_rate_limit' })
      continue
    }
    const r = await refreshAntigravityQuota(cfg, f)
    results.push(r)
    if (r.rateLimited || r.errorStatus === 429) rateLimited = true
  }

  // Always re-query CPAMP snapshots (fills codex/claude/xai + any written windows)
  let cpamp = { byKey: new Map(), meta: { ok: false } }
  try {
    cpamp = await fetchCpampAccountQuotas(cfg, authFilesPayload)
  } catch (err) {
    cpamp = { byKey: new Map(), meta: { ok: false, error: err?.message || String(err) } }
  }

  // Overlay successful api-call windows onto map (fresher than snapshot)
  for (const r of results) {
    if (r.status !== 'success' || !r.quota_windows?.length || !r.name) continue
    const primary = r.quota_windows[0]
    cpamp.byKey.set(r.name, {
      quota_windows: r.quota_windows,
      quota: {
        remaining_ratio: primary.remaining_ratio,
        remaining: null,
        limit: null,
        window: primary.window,
        resets_at: primary.resets_at,
        risk: primary.risk,
        plan_type: null,
        observed_at_ms: Date.now(),
        source: 'cpa:api-call',
      },
      plan_type: null,
      raw_window_count: r.quota_windows.length,
    })
  }

  const success = results.filter((r) => r.status === 'success').length
  return {
    results,
    byKey: cpamp.byKey,
    meta: {
      success,
      total: targets.length,
      api_call_attempts: results.length,
      rate_limited: rateLimited,
      cpamp: cpamp.meta,
      source: 'cpamp:quota-snapshots+cpa:api-call',
    },
  }
}
