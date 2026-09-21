/**
 * Site-side lite Codex inspection (Wave C).
 * Based on CPA auth-files — NOT the CPAMP-native codex-inspection service.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function readStore(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { version: 1, runs: [] }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return {
      version: 1,
      runs: Array.isArray(raw?.runs) ? raw.runs : [],
    }
  } catch {
    return { version: 1, runs: [] }
  }
}

function writeStore(filePath, store) {
  ensureDir(filePath)
  const tmp = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8')
  fs.renameSync(tmp, filePath)
}

function isCodexLike(account) {
  const provider = String(account.provider || account.account_type || '').toLowerCase()
  const name = String(account.name || account.label || account.email || '').toLowerCase()
  return (
    provider.includes('codex') ||
    provider.includes('openai') ||
    name.includes('codex') ||
    name.startsWith('codex-') ||
    name.includes('chatgpt')
  )
}

function classifyFinding(account) {
  const status = String(account.status || '').toLowerCase()
  const msg = String(account.status_message || '').toLowerCase()
  const combined = `${status} ${msg}`
  if (account.disabled) {
    return { verdict: 'disabled', severity: 'info' }
  }
  if (
    combined.includes('expired') ||
    combined.includes('expir') ||
    (combined.includes('refresh') && combined.includes('fail'))
  ) {
    return { verdict: 'expired', severity: 'error' }
  }
  if (
    combined.includes('error') ||
    combined.includes('invalid') ||
    combined.includes('revok') ||
    combined.includes('unauth') ||
    combined.includes('forbidden') ||
    combined.includes('401') ||
    combined.includes('403') ||
    account.unavailable
  ) {
    return { verdict: 'error', severity: 'error' }
  }
  if (Number(account.failed) > 0 && Number(account.success) === 0) {
    return { verdict: 'error', severity: 'warn' }
  }
  return { verdict: 'ok', severity: 'ok' }
}

/**
 * @param {string} filePath
 * @param {{
 *   listAccounts: () => Promise<any[]>,
 *   refreshAuthFile?: (name: string) => Promise<any>,
 *   setAuthFileDisabled?: (name: string, disabled: boolean) => Promise<any>,
 *   deleteAuthFile?: (name: string) => Promise<any>,
 *   refreshCollector?: () => Promise<any>,
 *   maxRuns?: number,
 * }} deps
 */
export function createCodexInspectionStore(filePath, deps) {
  let store = readStore(filePath)
  const maxRuns = Number(deps.maxRuns) > 0 ? Number(deps.maxRuns) : 50
  /** @type {Map<string, { cancelled: boolean }>} */
  const live = new Map()

  function persist() {
    if (store.runs.length > maxRuns) {
      store.runs = store.runs.slice(0, maxRuns)
    }
    writeStore(filePath, store)
  }

  function listRuns({ limit = 30 } = {}) {
    const lim = Math.min(100, Math.max(1, Number(limit) || 30))
    return {
      note: '本站版 Codex 巡检（基于 CPA auth-files，非 CPAMP 原版）',
      items: store.runs.slice(0, lim).map(summarizeRun),
      total: store.runs.length,
    }
  }

  function getRun(id) {
    const run = store.runs.find((r) => r.id === String(id))
    if (!run) {
      const err = new Error('run not found')
      err.status = 404
      throw err
    }
    return run
  }

  function summarizeRun(run) {
    return {
      id: run.id,
      status: run.status,
      created_at: run.created_at,
      finished_at: run.finished_at || null,
      summary: run.summary || null,
      finding_count: Array.isArray(run.findings) ? run.findings.length : 0,
      note: run.note,
    }
  }

  async function executeRun(run) {
    const ctrl = live.get(run.id) || { cancelled: false }
    live.set(run.id, ctrl)
    try {
      run.status = 'running'
      run.started_at = new Date().toISOString()
      persist()

      if (typeof deps.refreshCollector === 'function') {
        try {
          await deps.refreshCollector()
        } catch {
          /* best-effort */
        }
      }
      if (ctrl.cancelled) {
        run.status = 'cancelled'
        run.finished_at = new Date().toISOString()
        persist()
        return run
      }

      const accounts = await deps.listAccounts()
      const targets = (Array.isArray(accounts) ? accounts : []).filter(isCodexLike)
      const findings = []
      let ok = 0
      let expired = 0
      let error = 0
      let disabled = 0

      for (const a of targets) {
        if (ctrl.cancelled) break
        const { verdict, severity } = classifyFinding(a)
        if (verdict === 'ok') ok += 1
        else if (verdict === 'expired') expired += 1
        else if (verdict === 'disabled') disabled += 1
        else error += 1
        findings.push({
          id: crypto.createHash('sha1').update(`codex:${a.name || a.label || ''}`).digest('hex').slice(0, 12),
          name: a.name || null,
          label: a.label || a.email || a.name || null,
          provider: a.provider || null,
          status: a.status || null,
          status_message: a.status_message || '',
          disabled: !!a.disabled,
          unavailable: !!a.unavailable,
          success: Number(a.success) || 0,
          failed: Number(a.failed) || 0,
          verdict,
          severity,
          suggested_actions: suggestedActions(verdict),
        })
      }

      run.findings = findings
      run.summary = {
        scanned: targets.length,
        ok,
        expired,
        error,
        disabled,
        cancelled: !!ctrl.cancelled,
      }
      run.status = ctrl.cancelled ? 'cancelled' : 'completed'
      run.finished_at = new Date().toISOString()
      persist()
      return run
    } catch (err) {
      run.status = 'failed'
      run.error = err?.message || String(err)
      run.finished_at = new Date().toISOString()
      persist()
      return run
    } finally {
      live.delete(run.id)
    }
  }

  function suggestedActions(verdict) {
    if (verdict === 'ok') return ['refresh']
    if (verdict === 'disabled') return ['refresh']
    if (verdict === 'expired' || verdict === 'error') return ['refresh', 'disable']
    return ['refresh']
  }

  /**
   * @param {{ async?: boolean }} [opts]
   */
  async function startRun(opts = {}) {
    const run = {
      id: crypto.randomBytes(6).toString('hex'),
      status: 'queued',
      created_at: new Date().toISOString(),
      started_at: null,
      finished_at: null,
      note: '本站版 Codex 巡检（基于 CPA auth-files，非 CPAMP 原版）',
      findings: [],
      summary: null,
      error: null,
      actions_log: [],
    }
    store.runs.unshift(run)
    persist()
    live.set(run.id, { cancelled: false })

    if (opts.async) {
      setImmediate(() => {
        executeRun(run).catch((err) => {
          console.error('[codexInspection] async run failed', err?.message || err)
        })
      })
      return summarizeRun(run)
    }
    await executeRun(run)
    return run
  }

  function cancelRun(id) {
    const run = getRun(id)
    const ctrl = live.get(run.id)
    if (ctrl) ctrl.cancelled = true
    if (run.status === 'queued' || run.status === 'running') {
      run.status = 'cancelled'
      run.finished_at = new Date().toISOString()
      persist()
    } else if (run.status !== 'cancelled') {
      // already finished — mark note only
      run.cancel_requested = true
      persist()
    }
    return summarizeRun(run)
  }

  /**
   * Safe actions by default: refresh / disable.
   * delete requires confirm: true (and UI danger confirm).
   * @param {string} id
   * @param {{ actions?: Array<{ type: string, name: string, confirm?: boolean }> }} body
   */
  async function applyActions(id, body = {}) {
    const run = getRun(id)
    const actions = Array.isArray(body.actions) ? body.actions : []
    if (!actions.length) {
      const err = new Error('actions[] required')
      err.status = 400
      throw err
    }
    const results = []
    for (const act of actions) {
      const type = String(act.type || act.action || '').toLowerCase()
      const name = String(act.name || '').trim()
      if (!name && type !== 'refresh_collector') {
        results.push({ type, name, ok: false, error: 'name required' })
        continue
      }
      try {
        if (type === 'refresh' || type === 'refresh_auth_file') {
          if (typeof deps.refreshAuthFile !== 'function') throw new Error('refreshAuthFile unavailable')
          await deps.refreshAuthFile(name)
          results.push({ type: 'refresh', name, ok: true })
        } else if (type === 'disable') {
          if (typeof deps.setAuthFileDisabled !== 'function') throw new Error('setAuthFileDisabled unavailable')
          await deps.setAuthFileDisabled(name, true)
          results.push({ type: 'disable', name, ok: true })
        } else if (type === 'enable') {
          if (typeof deps.setAuthFileDisabled !== 'function') throw new Error('setAuthFileDisabled unavailable')
          await deps.setAuthFileDisabled(name, false)
          results.push({ type: 'enable', name, ok: true })
        } else if (type === 'refresh_collector' || type === 'refresh_cache') {
          if (typeof deps.refreshCollector === 'function') await deps.refreshCollector()
          results.push({ type: 'refresh_collector', name: null, ok: true })
        } else if (type === 'delete') {
          if (!act.confirm) {
            results.push({
              type: 'delete',
              name,
              ok: false,
              error: 'delete requires confirm:true (explicit UI danger confirm)',
            })
            continue
          }
          if (typeof deps.deleteAuthFile !== 'function') throw new Error('deleteAuthFile unavailable')
          await deps.deleteAuthFile(name)
          results.push({ type: 'delete', name, ok: true, confirmed: true })
        } else {
          results.push({ type, name, ok: false, error: `unsupported action: ${type}` })
        }
      } catch (err) {
        results.push({ type, name, ok: false, error: err?.message || String(err) })
      }
    }
    run.actions_log = run.actions_log || []
    run.actions_log.push({
      at: new Date().toISOString(),
      results,
    })
    persist()
    return { run_id: run.id, results, run: summarizeRun(run) }
  }

  return {
    listRuns,
    getRun,
    startRun,
    cancelRun,
    applyActions,
  }
}
