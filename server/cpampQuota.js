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
import { cpaApiCall, queryCpampQuotaSnapshots, queryCpampAccountWindowUsage } from './cpa.js'

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

/** CPAMP goe — loadCodeAssist for antigravity subscription / plan (Fle + wce). */
const ANTIGRAVITY_LOAD_CODE_ASSIST_URLS = [
  'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist',
  'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist',
]

/** CPAMP _ce body for loadCodeAssist. */
const LOAD_CODE_ASSIST_BODY = JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } })

/** CPAMP vce — tier id → plan. */
const ANTIGRAVITY_TIER_TO_PLAN = new Map([
  ['free-tier', 'free'],
  ['g1-pro-tier', 'pro'],
  ['g1-ultra-tier', 'ultra'],
  ['g1-ultra-lite-tier', 'ultra-lite'],
])

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

  const startMs = numOrNull(w.cycle_start_ms ?? w.cycleStartMs)
  const endMs = numOrNull(w.cycle_end_ms ?? w.cycleEndMs)
  const resets_at = endMs != null && endMs > 0 ? new Date(endMs).toISOString() : null
  const risk = riskFromRatio(remaining_ratio)
  const prev = w.previous_cycle ?? w.previousCycle
  return {
    label: labelCpampWindow(w, provider),
    window: w.provider_window_id != null ? String(w.provider_window_id) : null,
    remaining_ratio,
    remaining: null,
    limit: null,
    resets_at,
    risk,
    used_percent: usedPct,
    used_cost: numOrNull(w.used_cost ?? w.usedCost ?? w.current_cost ?? w.currentCost),
    used_tokens: numOrNull(w.used_tokens ?? w.usedTokens ?? w.current_tokens ?? w.currentTokens),
    forecast_cost: numOrNull(w.forecast_cost ?? w.forecastCost),
    forecast_tokens: numOrNull(w.forecast_tokens ?? w.forecastTokens),
    window_kind: w.window_kind != null ? String(w.window_kind) : null,
    model_scope_key: w.model_scope_key != null ? String(w.model_scope_key) : null,
    model_scope_kind: w.model_scope_kind != null ? String(w.model_scope_kind) : w.modelScopeKind != null ? String(w.modelScopeKind) : null,
    cycle_start_ms: startMs,
    cycle_end_ms: endMs,
    previous_cycle: prev && typeof prev === 'object' ? prev : null,
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
    if (!hit) return a
    const plan_type = a.plan_type || hit.plan_type || null
    if (!hit.quota_windows?.length) {
      if (!plan_type || plan_type === a.plan_type) return a
      return {
        ...a,
        plan_type,
        quota: a.quota ? { ...a.quota, plan_type: a.quota.plan_type || plan_type } : a.quota,
      }
    }
    return {
      ...a,
      plan_type,
      quota: hit.quota
        ? { ...hit.quota, plan_type: hit.quota.plan_type || plan_type }
        : a.quota || null,
      quota_windows: hit.quota_windows,
    }
  })
}

/**
 * Build CPAMP account-window-usage targets from snapshot windows (SPA UO subset).
 * Includes current (+ previous when previous_cycle bounds exist).
 */
export function buildWindowUsageTargets(accounts, byKey) {
  const targets = []
  const list = Array.isArray(accounts) ? accounts : []
  for (const acct of list) {
    const rowKey = String(acct?.row_key || '').trim()
    if (!rowKey) continue
    const hit = byKey.get(rowKey)
    const windows = hit?.quota_windows
    if (!Array.isArray(windows) || !windows.length) continue
    const snap = acct.account && typeof acct.account === 'object' ? acct.account : {}
    for (const w of windows) {
      const pid = String(w.window || '').trim()
      if (!pid) continue
      const scopeKind = String(w.model_scope_kind || 'all')
      const scopeKey = w.model_scope_key != null ? String(w.model_scope_key) : ''
      const model_scope = { kind: scopeKind, complete: true }
      if (scopeKey) model_scope.key = scopeKey
      const periods = []
      if (w.cycle_start_ms && w.cycle_end_ms) {
        periods.push(['current', w.cycle_start_ms, w.cycle_end_ms])
      }
      const prev = w.previous_cycle
      if (prev && typeof prev === 'object') {
        const pfrom = numOrNull(prev.actual_start_ms ?? prev.actualStartMs ?? prev.scheduled_start_ms ?? prev.scheduledStartMs)
        const pto = numOrNull(prev.actual_end_ms ?? prev.actualEndMs ?? prev.scheduled_end_ms ?? prev.scheduledEndMs)
        if (pfrom && pto) periods.push(['previous', pfrom, pto])
      }
      for (const [period, fromMs, toMs] of periods) {
        const request_key = `${rowKey}|${pid}|${period}|${scopeKind}:${scopeKey}`
        targets.push({
          request_key,
          row_key: rowKey,
          window_key: pid,
          provider_window_id: pid,
          period,
          from_ms: fromMs,
          to_ms: toMs,
          model_scope,
          account_snapshot: snap.account_snapshot ?? '',
          auth_label_snapshot: snap.auth_label_snapshot ?? '',
          auth_file_snapshot: snap.auth_file_snapshot ?? rowKey,
          auth_provider_snapshot: snap.auth_provider_snapshot ?? String(acct.provider || ''),
          auth_account_id_snapshot: snap.auth_account_id_snapshot ?? '',
          auth_project_id_snapshot: snap.auth_project_id_snapshot ?? '',
          auth_index: snap.auth_index ?? '',
          source: snap.source ?? rowKey,
        })
      }
    }
  }
  return targets
}

function usageTrusted(item) {
  if (!item || item.matched !== true) return null
  if (String(item.scope_match_status ?? 'complete') !== 'complete') return null
  const requests = numOrNull(item.total_requests ?? item.totalRequests)
  const tokens = numOrNull(item.total_tokens ?? item.totalTokens)
  const cost = numOrNull(item.total_cost ?? item.totalCost)
  if (requests == null || tokens == null || cost == null) return null
  if (requests < 0 || tokens < 0 || cost < 0) return null
  return { requests, tokens, cost }
}

/** CPAMP UEe — forecast from current×usedPercent, else previous cycle. */
export function forecastFromUsage({ usedPercent, current, previous }) {
  const curOk = current && Number.isFinite(current.requests) && Number.isFinite(current.tokens) && Number.isFinite(current.cost)
  const pctOk = usedPercent != null && Number.isFinite(usedPercent) && usedPercent > 0 && usedPercent <= 100
  if (curOk && pctOk) {
    const scale = 100 / usedPercent
    const out = {
      requests: Math.max(current.requests, Math.round(current.requests * scale)),
      tokens: Math.max(current.tokens, Math.round(current.tokens * scale)),
      cost: Math.max(current.cost, Number((current.cost * scale).toFixed(6))),
    }
    if (Number.isFinite(out.requests) && Number.isFinite(out.tokens) && Number.isFinite(out.cost)) return out
  }
  if (previous && Number.isFinite(previous.requests) && Number.isFinite(previous.tokens) && Number.isFinite(previous.cost)) {
    return { requests: previous.requests, tokens: previous.tokens, cost: previous.cost }
  }
  return null
}

/**
 * Merge account-window-usage into quota_windows (CPAMP GEe fields).
 * Strips join-only fields from windows returned to the client.
 */
export function applyWindowUsageToQuotaMap(byKey, usageItems) {
  const byRequest = new Map()
  for (const it of Array.isArray(usageItems) ? usageItems : []) {
    const rk = String(it?.request_key || '').trim()
    if (rk) byRequest.set(rk, it)
  }
  for (const [rowKey, hit] of byKey.entries()) {
    if (!hit?.quota_windows?.length) continue
    const nextWindows = hit.quota_windows.map((w) => {
      const pid = String(w.window || '').trim()
      const scopeKind = String(w.model_scope_kind || 'all')
      const scopeKey = w.model_scope_key != null ? String(w.model_scope_key) : ''
      const curKey = `${rowKey}|${pid}|current|${scopeKind}:${scopeKey}`
      const prevKey = `${rowKey}|${pid}|previous|${scopeKind}:${scopeKey}`
      const current = usageTrusted(byRequest.get(curKey))
      const previous = usageTrusted(byRequest.get(prevKey))
      let used_cost = w.used_cost ?? null
      let used_tokens = w.used_tokens ?? null
      let forecast_cost = w.forecast_cost ?? null
      let forecast_tokens = w.forecast_tokens ?? null
      if (current) {
        used_cost = current.cost
        used_tokens = current.tokens
        const forecast = forecastFromUsage({
          usedPercent: w.used_percent,
          current,
          previous,
        })
        // CPAMP: only expose forecast when trusted current exists and forecast >= actual
        if (
          forecast &&
          forecast.requests >= current.requests &&
          forecast.tokens >= current.tokens &&
          forecast.cost + 1e-9 >= current.cost
        ) {
          forecast_cost = forecast.cost
          forecast_tokens = forecast.tokens
        }
      }
      return {
        label: w.label,
        window: w.window,
        remaining_ratio: w.remaining_ratio,
        remaining: w.remaining,
        limit: w.limit,
        resets_at: w.resets_at,
        risk: w.risk,
        used_percent: w.used_percent,
        used_cost,
        used_tokens,
        forecast_cost,
        forecast_tokens,
        window_kind: w.window_kind,
        model_scope_key: w.model_scope_key,
        stale: w.stale,
        source: current ? 'cpamp:quota-snapshots+window-usage' : w.source,
      }
    })
    byKey.set(rowKey, { ...hit, quota_windows: nextWindows })
  }
  return byKey
}

/**
 * Fetch quota snapshots from CPAMP (literal SPA Yd.query),
 * then enrich footers via account-window-usage (SPA Jd.getAccountWindowUsage / GEe).
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
  let byKey = mapCpampQueryToAccountQuota(result)
  let usageMeta = { ok: false, attempted: false }
  try {
    const targets = buildWindowUsageTargets(accounts, byKey)
    usageMeta = { ok: false, attempted: true, targets: targets.length }
    if (targets.length) {
      const usage = await queryCpampAccountWindowUsage(cfg, { windows: targets })
      const items = Array.isArray(usage?.items) ? usage.items : []
      byKey = applyWindowUsageToQuotaMap(byKey, items)
      const withCost = [...byKey.values()].filter((v) =>
        (v.quota_windows || []).some((w) => w.used_tokens != null || w.used_cost != null),
      ).length
      usageMeta = {
        ok: true,
        attempted: true,
        targets: targets.length,
        items: items.length,
        with_cost: withCost,
        source: 'cpamp:account-window-usage',
      }
    } else {
      usageMeta = { ok: true, attempted: true, targets: 0, skipped: true }
      byKey = applyWindowUsageToQuotaMap(byKey, [])
    }
  } catch (err) {
    usageMeta = {
      ok: false,
      attempted: true,
      error: err?.message || String(err),
      source: 'cpamp:account-window-usage',
    }
    // Still strip join-only fields so clients never see cycle_start_ms etc.
    byKey = applyWindowUsageToQuotaMap(byKey, [])
  }
  return {
    byKey,
    meta: {
      ok: true,
      count: byKey.size,
      with_windows: [...byKey.values()].filter((v) => v.quota_windows?.length).length,
      generated_at_ms: result?.generated_at_ms ?? null,
      source: 'cpamp:quota-snapshots',
      window_usage: usageMeta,
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
 * CPAMP Cce() — parse loadCodeAssist body → { plan, tierId, tierName, source }.
 * Prefers paidTier when present (same as SPA).
 */
export function parseAntigravitySubscription(body) {
  const raw = typeof body === 'string' ? safeJson(body) : body
  if (!raw || typeof raw !== 'object') return null
  const current = raw.currentTier ?? raw.current_tier
  const paid = raw.paidTier ?? raw.paid_tier
  const pickTier = (t) => {
    if (!t || typeof t !== 'object' || Array.isArray(t)) return null
    const id = t.id != null ? String(t.id).trim() : ''
    const name = t.name != null ? String(t.name).trim() : ''
    if (!id && !name) return null
    return { id: id || null, name: name || null }
  }
  const cur = pickTier(current)
  const paidT = pickTier(paid)
  const chosen = paidT?.id ? paidT : cur
  if (!chosen?.id && !chosen?.name) return null
  const tierId = chosen.id || ''
  const plan = tierId ? ANTIGRAVITY_TIER_TO_PLAN.get(tierId) || 'unknown' : 'unknown'
  return {
    plan,
    tierId: chosen.id,
    tierName: chosen.name,
    source: paidT?.id ? 'paid' : 'current',
  }
}

/**
 * CPAMP wce.get — fetch antigravity subscription via loadCodeAssist (CPA api-call).
 */
export async function fetchAntigravitySubscription(cfg, file) {
  const authIndex = String(file?.auth_index ?? file?.authIndex ?? '').trim()
  if (!authIndex) {
    return { status: 'error', error: 'missing auth_index', name: file?.name, subscription: null }
  }
  let lastErr = 'unknown'
  let lastStatus = null
  for (const url of ANTIGRAVITY_LOAD_CODE_ASSIST_URLS) {
    try {
      const res = await cpaApiCall(cfg, {
        authIndex,
        method: 'POST',
        url,
        header: { ...ANTIGRAVITY_HEADERS },
        data: LOAD_CODE_ASSIST_BODY,
      })
      const statusCode = Number(res?.status_code ?? res?.statusCode ?? 0)
      if (statusCode < 200 || statusCode >= 300) {
        lastStatus = statusCode
        lastErr = `upstream ${statusCode}`
        if (statusCode === 429) {
          return {
            status: 'error',
            error: lastErr,
            errorStatus: 429,
            rateLimited: true,
            name: file?.name,
            subscription: null,
          }
        }
        continue
      }
      const body = res?.body ?? res?.bodyText ?? res
      const subscription = parseAntigravitySubscription(body)
      if (!subscription) {
        lastErr = 'empty_subscription'
        continue
      }
      return {
        status: 'success',
        name: file?.name,
        subscription,
        plan_type: subscription.plan && subscription.plan !== 'unknown' ? subscription.plan : null,
        source: 'cpa:api-call:loadCodeAssist',
      }
    } catch (err) {
      lastErr = err?.message || String(err)
      lastStatus = err?.status || lastStatus
      if (lastStatus === 429 || /429/.test(lastErr)) {
        return {
          status: 'error',
          error: lastErr,
          errorStatus: 429,
          rateLimited: true,
          name: file?.name,
          subscription: null,
        }
      }
    }
  }
  return {
    status: 'error',
    error: lastErr,
    errorStatus: lastStatus,
    name: file?.name,
    subscription: null,
  }
}

/**
 * Enrich antigravity account rows with plan from loadCodeAssist (CPAMP Fle subscription).
 * Serial per account to avoid provider rate limits. Skips rows that already have plan_type.
 */
export async function enrichAntigravityPlans(cfg, accounts, authFilesPayload, { force = false } = {}) {
  const files = Array.isArray(authFilesPayload?.files) ? authFilesPayload.files : []
  const byName = new Map(files.map((f) => [String(f?.name || '').trim(), f]))
  const items = Array.isArray(accounts) ? accounts : []
  const out = []
  let fetched = 0
  let filled = 0
  let rateLimited = false
  for (const a of items) {
    const provider = String(a?.provider || '').toLowerCase()
    const existing = a?.plan_type || a?.quota?.plan_type || null
    if (provider !== 'antigravity' || (existing && !force) || rateLimited) {
      out.push(a)
      continue
    }
    const name = String(a?.name || a?.id || '').trim()
    const file = byName.get(name) || {
      name,
      auth_index: a?.auth_index,
      provider: 'antigravity',
      project_id: a?.project_id,
    }
    const r = await fetchAntigravitySubscription(cfg, file)
    fetched += 1
    if (r.rateLimited || r.errorStatus === 429) rateLimited = true
    if (r.status === 'success' && r.plan_type) {
      filled += 1
      out.push({
        ...a,
        plan_type: r.plan_type,
        subscription: r.subscription,
        quota: a.quota
          ? { ...a.quota, plan_type: a.quota.plan_type || r.plan_type }
          : a.quota,
      })
    } else {
      out.push(a)
    }
  }
  return {
    items: out,
    meta: { fetched, filled, rateLimited, source: 'cpa:api-call:loadCodeAssist' },
  }
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
  // CPAMP Fle: start loadCodeAssist (subscription) in parallel with quota summary
  const subPromise = fetchAntigravitySubscription(cfg, file)
  let lastErr = 'unknown'
  let lastStatus = null
  let sawOkHttp = false
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
          const sub = await subPromise
          return {
            status: 'error',
            error: lastErr,
            errorStatus: 429,
            rateLimited: true,
            name: file?.name,
            plan_type: sub?.plan_type || null,
            subscription: sub?.subscription || null,
          }
        }
        continue
      }
      sawOkHttp = true
      const body = res?.body ?? res?.bodyText ?? res
      const groups = parseAntigravityQuotaGroups(body)
      if (!groups.length) {
        lastErr = 'empty_models'
        continue
      }
      const windows = mapAntigravityGroupsToWindows(groups)
      const sub = await subPromise
      const plan_type = sub?.plan_type || null
      return {
        status: 'success',
        name: file?.name,
        provider: 'antigravity',
        quota_windows: windows,
        groups_count: groups.length,
        plan_type,
        subscription: sub?.subscription || null,
        source: 'cpa:api-call',
      }
    } catch (err) {
      lastErr = err?.message || String(err)
      lastStatus = err?.status || lastStatus
      if (lastStatus === 429 || /429/.test(lastErr)) {
        const sub = await subPromise.catch(() => null)
        return {
          status: 'error',
          error: lastErr,
          errorStatus: 429,
          rateLimited: true,
          name: file?.name,
          plan_type: sub?.plan_type || null,
          subscription: sub?.subscription || null,
        }
      }
    }
  }
  // Quota empty but HTTP may have succeeded — still return subscription if any (CPAMP Fle)
  const sub = await subPromise.catch(() => null)
  if (sawOkHttp && sub?.plan_type) {
    return {
      status: 'success',
      name: file?.name,
      provider: 'antigravity',
      quota_windows: [],
      groups_count: 0,
      plan_type: sub.plan_type,
      subscription: sub.subscription,
      source: 'cpa:api-call',
    }
  }
  return {
    status: 'error',
    error: lastErr,
    errorStatus: lastStatus,
    name: file?.name,
    plan_type: sub?.plan_type || null,
    subscription: sub?.subscription || null,
  }
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

  // Overlay successful api-call windows + plan onto map (fresher than snapshot)
  for (const r of results) {
    if (r.status !== 'success' || !r.name) continue
    const plan_type = r.plan_type || null
    if (r.quota_windows?.length) {
      const primary = r.quota_windows[0]
      const prev = cpamp.byKey.get(r.name)
      cpamp.byKey.set(r.name, {
        quota_windows: r.quota_windows,
        quota: {
          remaining_ratio: primary.remaining_ratio,
          remaining: null,
          limit: null,
          window: primary.window,
          resets_at: primary.resets_at,
          risk: primary.risk,
          plan_type,
          observed_at_ms: Date.now(),
          source: 'cpa:api-call',
        },
        plan_type,
        raw_window_count: r.quota_windows.length,
      })
    } else if (plan_type) {
      const prev = cpamp.byKey.get(r.name) || {}
      cpamp.byKey.set(r.name, {
        ...prev,
        plan_type,
        quota: prev.quota ? { ...prev.quota, plan_type: prev.quota.plan_type || plan_type } : prev.quota,
      })
    }
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
