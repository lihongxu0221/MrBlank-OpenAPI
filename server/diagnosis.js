/**
 * Phase C — admin diagnosis dump store (bodies on disk; list has no bodies).
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_BODY_CHARS = Number(process.env.DIAGNOSIS_MAX_BODY_CHARS || 512 * 1024)
const MAX_INDEX = Number(process.env.DIAGNOSIS_MAX_INDEX || 800)
const SENSITIVE =
  /^(authorization|cookie|set-cookie|x-api-key|api-key|x-goog-api-key|proxy-authorization)$/i

export function redactHeaders(headers) {
  const out = {}
  if (!headers) return out
  const entries =
    typeof headers.forEach === 'function'
      ? (() => {
          const o = {}
          headers.forEach((v, k) => {
            o[k] = v
          })
          return Object.entries(o)
        })()
      : Object.entries(headers)
  for (const [k, v] of entries) {
    const val = Array.isArray(v) ? v.join(', ') : String(v ?? '')
    out[k] = SENSITIVE.test(k)
      ? val.length > 16
        ? `${val.slice(0, 10)}…${val.slice(-4)}`
        : '***'
      : val
  }
  return out
}

function clipText(v, max = MAX_BODY_CHARS) {
  if (v == null) return ''
  const s =
    typeof v === 'string'
      ? v
      : (() => {
          try {
            return JSON.stringify(v)
          } catch {
            return String(v)
          }
        })()
  return s.length <= max ? s : `${s.slice(0, max)}\n…(truncated)`
}

export function createDiagnosisStore(rootDir) {
  const base =
    rootDir ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'diagnosis')
  const dumpsDir = path.join(base, 'dumps')
  const indexPath = path.join(base, 'index.jsonl')
  fs.mkdirSync(dumpsDir, { recursive: true })

  function dumpPath(id) {
    const safe = String(id || '').replace(/[^a-zA-Z0-9._-]/g, '_')
    return path.join(dumpsDir, `${safe}.json`)
  }

  function readIndex() {
    if (!fs.existsSync(indexPath)) return []
    const rows = []
    for (const line of fs.readFileSync(indexPath, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        rows.push(JSON.parse(line))
      } catch {
        /* skip */
      }
    }
    return rows
  }

  function writeIndex(rows) {
    const trimmed = rows.slice(-MAX_INDEX)
    const tmp = `${indexPath}.tmp`
    fs.writeFileSync(
      tmp,
      trimmed.map((r) => JSON.stringify(r)).join('\n') + (trimmed.length ? '\n' : ''),
    )
    fs.renameSync(tmp, indexPath)
    const keep = new Set(trimmed.map((r) => r.id))
    try {
      for (const name of fs.readdirSync(dumpsDir)) {
        if (!name.endsWith('.json')) continue
        const id = name.slice(0, -5)
        if (!keep.has(id)) {
          try {
            fs.unlinkSync(path.join(dumpsDir, name))
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  function record(entry) {
    const id =
      entry.id ||
      `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
    const created_at = entry.created_at || new Date().toISOString()
    const req_headers = redactHeaders(entry.req_headers || {})
    const res_headers = redactHeaders(entry.res_headers || {})
    const upstream_req_headers = redactHeaders(entry.upstream_req_headers || {})
    const req_body = clipText(entry.req_body)
    const res_body = clipText(entry.res_body)
    const upstream_req_body = clipText(entry.upstream_req_body ?? entry.req_body)
    const has_detail = !!(req_body || res_body || Object.keys(req_headers).length)

    const full = {
      id,
      created_at,
      type: entry.type ?? (Number(entry.status_code) >= 400 ? 5 : 2),
      method: entry.method || 'POST',
      endpoint: entry.endpoint || '',
      upstream_url: entry.upstream_url || '',
      status_code: Number(entry.status_code) || 0,
      duration_ms: entry.duration_ms ?? null,
      ttft_ms: entry.ttft_ms ?? null,
      ip: entry.ip || '',
      model_name: entry.model_name || '',
      requested_model: entry.requested_model || entry.model_name || '',
      token_name: entry.token_name || '',
      prompt_tokens: Number(entry.prompt_tokens) || 0,
      completion_tokens: Number(entry.completion_tokens) || 0,
      cache_tokens: Number(entry.cache_tokens) || 0,
      is_stream: !!entry.is_stream,
      group: entry.group || '',
      content: entry.content || '',
      source: entry.source || 'bff-v1',
      has_detail,
      req_headers,
      req_body,
      res_headers,
      res_body,
      upstream_req_headers,
      upstream_req_body,
      dialog: entry.dialog || null,
    }

    const tmpDump = `${dumpPath(id)}.tmp`
    fs.writeFileSync(tmpDump, JSON.stringify(full))
    fs.renameSync(tmpDump, dumpPath(id))

    const slim = {
      id,
      created_at,
      type: full.type,
      method: full.method,
      endpoint: full.endpoint,
      upstream_url: full.upstream_url,
      status_code: full.status_code,
      duration_ms: full.duration_ms,
      ttft_ms: full.ttft_ms,
      ip: full.ip,
      model_name: full.model_name,
      requested_model: full.requested_model,
      token_name: full.token_name,
      prompt_tokens: full.prompt_tokens,
      completion_tokens: full.completion_tokens,
      cache_tokens: full.cache_tokens,
      is_stream: full.is_stream,
      group: full.group,
      content: full.content ? String(full.content).slice(0, 200) : '',
      source: full.source,
      has_detail,
    }
    const rows = readIndex()
    rows.push(slim)
    writeIndex(rows)
    return slim
  }

  function list({ limit = 50, offset = 0, q = '' } = {}) {
    let rows = readIndex().slice().reverse()
    const query = String(q || '').trim().toLowerCase()
    if (query) {
      rows = rows.filter((r) =>
        [r.id, r.endpoint, r.model_name, r.requested_model, r.token_name, r.ip, r.content]
          .filter(Boolean)
          .some((x) => String(x).toLowerCase().includes(query)),
      )
    }
    return {
      items: rows.slice(offset, offset + limit).map((r) => ({ ...r, has_detail: !!r.has_detail })),
      total: rows.length,
      limit,
      offset,
    }
  }

  function get(id) {
    const p = dumpPath(id)
    if (!fs.existsSync(p)) return null
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'))
    } catch {
      return null
    }
  }

  function stats() {
    const rows = readIndex()
    return {
      total: rows.length,
      with_detail: rows.filter((r) => r.has_detail).length,
      max_index: MAX_INDEX,
      max_body_chars: MAX_BODY_CHARS,
      path: base,
    }
  }

  return { record, list, get, stats, redactHeaders, clipText }
}

export function extractUsageFromBody(resBody) {
  if (!resBody) return {}
  let obj = null
  if (typeof resBody === 'object') obj = resBody
  else {
    const s = String(resBody)
    try {
      obj = JSON.parse(s)
    } catch {
      const lines = s.split('\n')
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          obj = JSON.parse(payload)
          if (obj?.usage) break
        } catch {
          /* continue */
        }
      }
    }
  }
  const usage = obj?.usage || {}
  return {
    prompt_tokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0,
    completion_tokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0,
    cache_tokens:
      Number(usage.cache_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0) || 0,
    model_name: obj?.model || '',
  }
}

export function extractModelFromReqBody(reqBody) {
  if (!reqBody) return ''
  try {
    const obj = typeof reqBody === 'object' ? reqBody : JSON.parse(String(reqBody))
    return String(obj?.model || '')
  } catch {
    return ''
  }
}

export function maskTokenNameFromAuth(authHeader) {
  const raw = String(authHeader || '')
  const m = /^Bearer\s+(.+)$/i.exec(raw)
  const key = (m ? m[1] : raw).trim()
  if (!key) return ''
  if (key.length <= 12) return '***'
  return `${key.slice(0, 8)}…${key.slice(-4)}`
}
