/**
 * Phase C — BFF /v1 → CPA billing reverse-proxy with diagnosis capture.
 */
import {
  extractModelFromReqBody,
  extractUsageFromBody,
  maskTokenNameFromAuth,
  redactHeaders,
} from './diagnosis.js'

const HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
])
const MAX_CAPTURE = Number(process.env.DIAGNOSIS_MAX_BODY_CHARS || 512 * 1024)

function clientIp(req) {
  const xff = req.headers['x-forwarded-for']
  if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim()
  return req.socket?.remoteAddress || ''
}

function readRawBody(req, limit = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(Object.assign(new Error('request body too large'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function forwardHeaders(req) {
  const out = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (HOP.has(k.toLowerCase())) continue
    if (v == null) continue
    out[k] = Array.isArray(v) ? v.join(', ') : String(v)
  }
  delete out['accept-encoding']
  return out
}

export function createV1Proxy({ billingBaseUrl, store, enabled = true }) {
  const base = String(billingBaseUrl || '').replace(/\/$/, '')

  return async function v1Proxy(req, res) {
    if (!enabled) {
      res.status(503).json({ error: { message: 'BFF /v1 proxy disabled' } })
      return
    }
    if (!base) {
      res.status(503).json({ error: { message: 'CPA billing URL not configured' } })
      return
    }

    const started = Date.now()
    let ttft_ms = null
    const endpoint = req.originalUrl || req.url || '/v1'
    const upstreamUrl = `${base}${endpoint.startsWith('/v1') ? endpoint : `/v1${endpoint}`}`

    let reqBuf = Buffer.alloc(0)
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') reqBuf = await readRawBody(req)
    } catch (err) {
      res.status(err.status || 400).json({ error: { message: err.message || 'bad request body' } })
      return
    }

    const reqBodyText = reqBuf.length ? reqBuf.toString('utf8') : ''
    const requestedModel = extractModelFromReqBody(reqBodyText)
    const fwd = forwardHeaders(req)

    let upstream
    try {
      upstream = await fetch(upstreamUrl, {
        method: req.method,
        headers: fwd,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : reqBuf,
        redirect: 'manual',
      })
    } catch (err) {
      const slim = store.record({
        method: req.method,
        endpoint,
        upstream_url: upstreamUrl,
        status_code: 502,
        duration_ms: Date.now() - started,
        ip: clientIp(req),
        model_name: requestedModel,
        requested_model: requestedModel,
        token_name: maskTokenNameFromAuth(req.headers.authorization),
        req_headers: redactHeaders(req.headers),
        req_body: reqBodyText,
        res_headers: {},
        res_body: String(err?.message || err),
        upstream_req_headers: redactHeaders(fwd),
        upstream_req_body: reqBodyText,
        content: `upstream fetch failed: ${err?.message || err}`,
        type: 5,
        is_stream: false,
      })
      res.status(502).json({ error: { message: 'upstream unavailable', diagnosis_id: slim.id } })
      return
    }

    res.status(upstream.status)
    const resHeaderObj = {}
    upstream.headers.forEach((v, k) => {
      resHeaderObj[k] = v
      if (HOP.has(k.toLowerCase()) || k.toLowerCase() === 'content-length') return
      try {
        res.setHeader(k, v)
      } catch {
        /* ignore */
      }
    })

    const capture = []
    let captured = 0
    const reader = upstream.body?.getReader?.()
    if (!reader) {
      const text = await upstream.text().catch(() => '')
      if (text) {
        capture.push(Buffer.from(text))
        captured = text.length
        res.end(text)
      } else res.end()
    } else {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (ttft_ms == null) ttft_ms = Date.now() - started
          const buf = Buffer.from(value)
          res.write(buf)
          if (captured < MAX_CAPTURE) {
            const take = Math.min(buf.length, MAX_CAPTURE - captured)
            capture.push(buf.subarray(0, take))
            captured += take
          }
        }
        res.end()
      } catch (err) {
        try {
          res.end()
        } catch {
          /* ignore */
        }
        capture.push(Buffer.from(String(err?.message || err)))
      }
    }

    let resBodyText = Buffer.concat(capture).toString('utf8')
    if (captured >= MAX_CAPTURE) resBodyText += '\n…(truncated)'
    const usage = extractUsageFromBody(resBodyText)
    const is_stream =
      String(resHeaderObj['content-type'] || '').includes('text/event-stream') ||
      /data:\s*\{/.test(resBodyText.slice(0, 200))

    try {
      store.record({
        method: req.method,
        endpoint,
        upstream_url: upstreamUrl,
        status_code: upstream.status,
        duration_ms: Date.now() - started,
        ttft_ms,
        ip: clientIp(req),
        model_name: usage.model_name || requestedModel,
        requested_model: requestedModel,
        token_name: maskTokenNameFromAuth(req.headers.authorization),
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        cache_tokens: usage.cache_tokens,
        req_headers: redactHeaders(req.headers),
        req_body: reqBodyText,
        res_headers: redactHeaders(resHeaderObj),
        res_body: resBodyText,
        upstream_req_headers: redactHeaders(fwd),
        upstream_req_body: reqBodyText,
        is_stream,
        type: upstream.status >= 400 ? 5 : 2,
        content: upstream.status >= 400 ? resBodyText.slice(0, 300) : '',
      })
    } catch (err) {
      console.error('[diagnosis] record failed', err?.message || err)
    }
  }
}
