/**
 * Background collector: refresh CPA auth-files (~20s) via management key.
 */

/**
 * @param {{
 *   fetchAuthFiles: (force?: boolean) => Promise<any>,
 *   mapPool?: (payload: any) => any[],
 *   intervalMs?: number,
 * }} opts
 */
export function createCpaCollector(opts) {
  const intervalMs = Number(opts.intervalMs) > 0 ? Number(opts.intervalMs) : 20_000
  let timer = null
  let running = false
  let lastSync = null
  let lastOk = false
  let lastError = null
  let lastLatencyMs = null
  let payload = null
  let poolItems = []

  async function refresh({ force = false } = {}) {
    if (running) return getStatus()
    running = true
    const started = Date.now()
    try {
      const data = await opts.fetchAuthFiles(force)
      payload = data
      poolItems = typeof opts.mapPool === 'function' ? opts.mapPool(data) : []
      lastSync = new Date().toISOString()
      lastOk = true
      lastError = null
      lastLatencyMs = Date.now() - started
    } catch (err) {
      lastOk = false
      lastError = err?.message || String(err)
      lastLatencyMs = Date.now() - started
    } finally {
      running = false
    }
    return getStatus()
  }

  function getStatus() {
    return {
      lastSync,
      ok: lastOk,
      error: lastError,
      latency_ms: lastLatencyMs,
      interval_ms: intervalMs,
      account_count: Array.isArray(payload?.files) ? payload.files.length : poolItems.length,
    }
  }

  function getPoolSnapshot() {
    return {
      items: poolItems,
      observed_at: payload?.observed_at || lastSync,
      source: 'cpa:auth-files',
      stale: !lastOk,
      last_sync: lastSync,
      ok: lastOk,
      error: lastError,
    }
  }

  function getAuthFilesPayload() {
    return payload
  }

  function start() {
    if (timer) return
    refresh({ force: true }).catch(() => {})
    timer = setInterval(() => {
      refresh().catch(() => {})
    }, intervalMs)
    if (typeof timer.unref === 'function') timer.unref()
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  return {
    start,
    stop,
    refresh,
    getPoolSnapshot,
    getAuthFilesPayload,
    getStatus,
    getCollectorStatus: getStatus,
  }
}
