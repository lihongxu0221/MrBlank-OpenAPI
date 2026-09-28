/**
 * Site-side quota snapshot store (Rebuild).
 * Mirrors CPAMP quota-snapshots ingest/query semantics without reading CPAMP DB.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function readStore(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { version: 1, entries: [] }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return {
      version: 1,
      entries: Array.isArray(raw?.entries) ? raw.entries : [],
    }
  } catch {
    return { version: 1, entries: [] }
  }
}

function writeStore(filePath, store) {
  ensureDir(filePath)
  const tmp = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8')
  fs.renameSync(tmp, filePath)
}

function normalizeEntry(raw, nowMs) {
  if (!raw || typeof raw !== 'object') return null
  const account = String(raw.account || raw.name || raw.auth_file || '').trim()
  if (!account) return null
  const observed = Number(raw.observed_at_ms || raw.now_ms || raw.ts || nowMs) || nowMs
  return {
    id: String(raw.id || crypto.randomUUID()),
    account,
    provider: raw.provider != null ? String(raw.provider) : null,
    plan_type: raw.plan_type != null ? String(raw.plan_type) : raw.plan != null ? String(raw.plan) : null,
    remaining_ratio:
      raw.remaining_ratio != null && Number.isFinite(Number(raw.remaining_ratio))
        ? Number(raw.remaining_ratio)
        : null,
    remaining: raw.remaining != null ? Number(raw.remaining) : null,
    limit: raw.limit != null ? Number(raw.limit) : null,
    window: raw.window != null ? String(raw.window) : null,
    resets_at: raw.resets_at != null ? String(raw.resets_at) : null,
    source: raw.source != null ? String(raw.source) : 'manual',
    risk: raw.risk != null ? String(raw.risk) : null,
    headers: raw.headers && typeof raw.headers === 'object' ? raw.headers : null,
    meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : null,
    observed_at_ms: observed,
    created_at: new Date(observed).toISOString(),
  }
}

function riskFromRatio(ratio) {
  if (ratio == null || !Number.isFinite(ratio)) return null
  if (ratio <= 0) return 'exhausted'
  if (ratio < 0.2) return 'critical'
  if (ratio < 0.5) return 'low'
  return 'ok'
}

export function createQuotaSnapshotStore(filePath, { maxEntries = 5000 } = {}) {
  const limit = Math.max(100, Number(maxEntries) || 5000)

  function ingest(entriesInput = []) {
    const list = Array.isArray(entriesInput) ? entriesInput : [entriesInput]
    const nowMs = Date.now()
    const store = readStore(filePath)
    const added = []
    for (const raw of list) {
      const entry = normalizeEntry(raw, nowMs)
      if (!entry) continue
      if (!entry.risk && entry.remaining_ratio != null) entry.risk = riskFromRatio(entry.remaining_ratio)
      store.entries.push(entry)
      added.push(entry)
    }
    if (store.entries.length > limit) {
      store.entries = store.entries.slice(-limit)
    }
    writeStore(filePath, store)
    return { added: added.length, total: store.entries.length, items: added }
  }

  function query({ accounts, now_ms, include_inactive = true, latest_only = true } = {}) {
    const store = readStore(filePath)
    const allow = Array.isArray(accounts) && accounts.length
      ? new Set(accounts.map((a) => String(a || '').trim()).filter(Boolean))
      : null
    const nowMs = Number(now_ms) || Date.now()
    let items = store.entries.filter((e) => {
      if (allow && !allow.has(e.account)) return false
      if (!include_inactive && e.risk === 'exhausted') return false
      return true
    })
    if (latest_only) {
      const best = new Map()
      for (const e of items) {
        const prev = best.get(e.account)
        if (!prev || (e.observed_at_ms || 0) >= (prev.observed_at_ms || 0)) best.set(e.account, e)
      }
      items = [...best.values()]
    }
    items.sort((a, b) => (b.observed_at_ms || 0) - (a.observed_at_ms || 0))
    return {
      now_ms: nowMs,
      count: items.length,
      items,
      source: 'site:quota-snapshots',
      note: '本站 Rebuild；非 CPAMP usage.sqlite。无采集时为空。',
    }
  }

  function stats() {
    const store = readStore(filePath)
    return { total: store.entries.length, path: filePath }
  }

  return { ingest, query, stats }
}
