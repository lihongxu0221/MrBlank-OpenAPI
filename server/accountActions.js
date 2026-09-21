/**
 * Account-action candidates (Wave B lite): auth-files status + diagnosis failures.
 * Dismissals (ignore/resolve) stored in JSON — no CPA auth-file delete during triage.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function readStore(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { version: 1, dismissals: {} }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return {
      version: 1,
      dismissals:
        raw?.dismissals && typeof raw.dismissals === 'object' ? raw.dismissals : {},
    }
  } catch {
    return { version: 1, dismissals: {} }
  }
}

function writeStore(filePath, store) {
  ensureDir(filePath)
  const tmp = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8')
  fs.renameSync(tmp, filePath)
}

function candidateId(kind, key) {
  return crypto.createHash('sha1').update(`${kind}:${key}`).digest('hex').slice(0, 16)
}

function isBadStatus(status, statusMessage) {
  const s = `${status || ''} ${statusMessage || ''}`.toLowerCase()
  return (
    s.includes('error') ||
    s.includes('expired') ||
    s.includes('invalid') ||
    s.includes('revok') ||
    s.includes('fail') ||
    s.includes('unauth') ||
    s.includes('forbidden') ||
    s.includes('401') ||
    s.includes('403')
  )
}

export function createAccountActionsStore(filePath) {
  let store = readStore(filePath)

  function persist() {
    writeStore(filePath, store)
  }

  /**
   * @param {{
   *   accounts?: Array<any>,
   *   diagnosisItems?: Array<any>,
   *   includeDismissed?: boolean,
   * }} opts
   */
  function listCandidates({ accounts = [], diagnosisItems = [], includeDismissed = false } = {}) {
    /** @type {Map<string, any>} */
    const map = new Map()

    for (const a of accounts) {
      const name = a.name || a.id || a.label || ''
      const status = a.status || ''
      const msg = a.status_message || ''
      const bad = a.unavailable || isBadStatus(status, msg) || (Number(a.failed) > 0 && Number(a.success) === 0)
      if (!bad && !a.disabled) continue
      const id = candidateId('auth', name || String(a.email || a.label || ''))
      const reason = a.disabled
        ? 'disabled'
        : isBadStatus(status, msg)
          ? String(status || msg || 'error')
          : a.unavailable
            ? 'unavailable'
            : 'failures'
      map.set(id, {
        id,
        kind: 'auth-file',
        name: name || null,
        label: a.label || a.email || name,
        provider: a.provider || null,
        status: status || (a.disabled ? 'disabled' : 'unavailable'),
        status_message: msg,
        reason,
        failed: Number(a.failed) || 0,
        success: Number(a.success) || 0,
        source: 'cpa:auth-files',
        dismissal: store.dismissals[id] || null,
      })
    }

    for (const d of diagnosisItems) {
      const code = Number(d.status_code) || 0
      if (code > 0 && code < 400) continue
      const key = `${d.model_name || d.requested_model || 'unknown'}|${code}|${d.endpoint || ''}`
      const id = candidateId('diag', key)
      if (map.has(id)) {
        const prev = map.get(id)
        prev.diag_hits = (prev.diag_hits || 0) + 1
        continue
      }
      map.set(id, {
        id,
        kind: 'diagnosis',
        name: d.model_name || d.requested_model || null,
        label: d.model_name || d.requested_model || d.endpoint || id,
        provider: null,
        status: String(code || 'error'),
        status_message: d.content || d.endpoint || '',
        reason: code >= 400 ? `http_${code}` : 'diagnosis_failure',
        failed: 1,
        success: 0,
        diag_hits: 1,
        last_seen: d.created_at || null,
        source: 'bff:diagnosis',
        dismissal: store.dismissals[id] || null,
      })
    }

    let items = [...map.values()]
    if (!includeDismissed) {
      items = items.filter((c) => !c.dismissal)
    }
    items.sort((a, b) => (b.failed || 0) - (a.failed || 0) || String(a.label).localeCompare(String(b.label)))
    return {
      items,
      total: items.length,
      dismissed: Object.keys(store.dismissals).length,
      note: 'Best-effort triage from auth-files status + recent diagnosis failures. Ignore/resolve only dismiss locally — does not delete CPA auth-files.',
    }
  }

  function dismiss(id, action = 'ignore') {
    const cid = String(id || '').trim()
    if (!cid) throw Object.assign(new Error('id required'), { status: 400 })
    const act = action === 'resolve' ? 'resolve' : 'ignore'
    store.dismissals[cid] = {
      action: act,
      at: new Date().toISOString(),
    }
    persist()
    return store.dismissals[cid]
  }

  function clearDismissal(id) {
    const cid = String(id || '').trim()
    if (cid in store.dismissals) {
      delete store.dismissals[cid]
      persist()
    }
    return { cleared: cid }
  }

  return { listCandidates, dismiss, clearDismissal }
}
