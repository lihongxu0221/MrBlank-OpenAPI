/**
 * Phase C/D/E — BFF /v1 reverse-proxy with diagnosis capture + group governance.
 * Default upstream: CPA billing. Optional in-process Aily bridge by model allowlist.
 * Phase E: per-user rolling quotas (429) and model allowlist (403) when API key maps to a site user.
 */
import {
  extractModelFromReqBody,
  extractUsageFromBody,
  maskTokenNameFromAuth,
  redactHeaders,
} from './diagnosis.js'


/** Pure CPA vs Aily route selection (testable).
 * Embedded mode: match alone is enough (in-process bridge uses .aily tokens).
 * Legacy mode: ailyBase + ailyApiKey still supported if provided without handler.
 */
export function selectUpstreamRoute({ requestedModel, cpaBase, ailyBase, ailyApiKey, match, embedded = true }) {
  const cpa = String(cpaBase || '').replace(/\/$/, '')
  const aily = String(ailyBase || '').replace(/\/$/, '')
  if (typeof match === 'function' && match(requestedModel)) {
    if (embedded) {
      return { routeVia: 'aily', mode: 'embedded', upstreamBase: '', authOverride: null }
    }
    if (aily && ailyApiKey) {
      return { routeVia: 'aily', mode: 'legacy', upstreamBase: aily, authOverride: ailyApiKey }
    }
  }
  return { routeVia: 'cpa', mode: 'cpa', upstreamBase: cpa, authOverride: null }
}


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

function forwardHeaders(req, { authOverride } = {}) {
  const out = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (HOP.has(k.toLowerCase())) continue
    if (v == null) continue
    out[k] = Array.isArray(v) ? v.join(', ') : String(v)
  }
  delete out['accept-encoding']
  if (authOverride) out.authorization = `Bearer ${authOverride}`
  return out
}

function bearerFromReq(req) {
  const auth = req.headers.authorization || req.headers['x-api-key'] || ''
  return String(auth).replace(/^Bearer\s+/i, '').trim()
}

function isModelsList(endpoint, method) {
  const pathOnly = String(endpoint || '').split('?')[0]
  return method === 'GET' && /\/v1\/models\/?$/.test(pathOnly)
}

function isConsumingEndpoint(endpoint, method) {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false
  const pathOnly = String(endpoint || '').split('?')[0]
  return /\/v1\/(chat\/completions|completions|messages|responses|embeddings|images\/|audio\/|videos)/.test(
    pathOnly,
  )
}

/**
 * @param {object} opts
 * @param {string} opts.billingBaseUrl CPA billing shim
 * @param {object} opts.store diagnosis store
 * @param {boolean} [opts.enabled]
 * @param {{ match?: (model:string)=>boolean, handleV1?: Function, embedded?: boolean, adapterUrl?: string, apiKey?: string }} [opts.ailyRoute]
 * @param {{
 *   enforce?: (ctx: object) => Promise<{ allow: true, userId?: string, groupInfo?: object } | { allow: false, status: number, headers?: object, body: object }>,
 *   filterModelsBody?: (ctx: object, bodyText: string) => string,
 *   onComplete?: (ctx: object) => void,
 * }} [opts.governance]
 */
export function createV1Proxy({
  billingBaseUrl,
  store,
  enabled = true,
  ailyRoute = null,
  governance = null,
}) {
  const cpaBase = String(billingBaseUrl || '').replace(/\/$/, '')
  const ailyBase = String(ailyRoute?.adapterUrl || '').replace(/\/$/, '')
  const ailyEmbedded = ailyRoute?.embedded !== false

  return async function v1Proxy(req, res) {
    if (!enabled) {
      res.status(503).json({ error: { message: 'BFF /v1 proxy disabled' } })
      return
    }
    if (!cpaBase) {
      res.status(503).json({ error: { message: 'CPA billing URL not configured' } })
      return
    }

    const started = Date.now()
    let ttft_ms = null
    const endpoint = req.originalUrl || req.url || '/v1'
    const apiKey = bearerFromReq(req)

    let reqBuf = Buffer.alloc(0)
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') reqBuf = await readRawBody(req)
    } catch (err) {
      res.status(err.status || 400).json({ error: { message: err.message || 'bad request body' } })
      return
    }

    const reqBodyText = reqBuf.length ? reqBuf.toString('utf8') : ''
    const requestedModel = extractModelFromReqBody(reqBodyText)

    /** @type {{ userId?: string, groupInfo?: object, skipUpstream?: boolean }} */
    let govCtx = { apiKey, requestedModel, endpoint, method: req.method }
    if (typeof governance?.enforce === 'function') {
      try {
        const decision = await governance.enforce({
          req,
          apiKey,
          model: requestedModel,
          endpoint,
          method: req.method,
          isModelsList: isModelsList(endpoint, req.method),
          isConsuming: isConsumingEndpoint(endpoint, req.method),
        })
        if (decision && decision.allow === false) {
          const status = decision.status || 403
          if (decision.headers) {
            for (const [k, v] of Object.entries(decision.headers)) {
              try {
                res.setHeader(k, v)
              } catch {
                /* ignore */
              }
            }
          }
          try {
            res.setHeader('x-mrblank-governance', decision.code || 'denied')
          } catch {
            /* ignore */
          }
          // Still record a slim diagnosis row for admins
          try {
            store.record({
              method: req.method,
              endpoint,
              upstream_url: '',
              status_code: status,
              duration_ms: Date.now() - started,
              ip: clientIp(req),
              model_name: requestedModel,
              requested_model: requestedModel,
              token_name: maskTokenNameFromAuth(req.headers.authorization),
              req_headers: redactHeaders(req.headers),
              req_body: reqBodyText,
              res_headers: {},
              res_body: JSON.stringify(decision.body || {}),
              content: decision.body?.error?.message || decision.code || 'governance deny',
              type: 5,
              is_stream: false,
              route_via: 'governance',
              group_id: decision.group_id || '',
            })
          } catch {
            /* ignore */
          }
          res.status(status).json(decision.body || { error: { message: 'forbidden' } })
          return
        }
        if (decision && decision.allow !== false) {
          govCtx = { ...govCtx, ...decision, apiKey, requestedModel, endpoint, method: req.method }
        }
      } catch (err) {
        console.error('[v1] governance enforce failed', err?.message || err)
        res.status(503).json({
          error: {
            message: 'governance temporarily unavailable',
            type: 'server_error',
            code: 'governance_error',
          },
        })
        return
      }
    }

    const selected = selectUpstreamRoute({
      requestedModel,
      cpaBase,
      ailyBase,
      ailyApiKey: ailyRoute?.apiKey,
      match: ailyRoute?.match,
      embedded: ailyEmbedded && typeof ailyRoute?.handleV1 === 'function',
    })
    let routeVia = selected.routeVia
    let upstreamBase = selected.upstreamBase
    let authOverride = selected.authOverride

    // ── Embedded Aily bridge (in-process) ──
    if (routeVia === 'aily' && selected.mode === 'embedded' && typeof ailyRoute?.handleV1 === 'function') {
      let handled
      try {
        handled = await ailyRoute.handleV1({
          method: req.method,
          endpoint,
          reqBuf,
          reqBodyText,
          requestedModel,
          res,
        })
      } catch (err) {
        const slim = store.record({
          method: req.method,
          endpoint,
          upstream_url: '',
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
          content: `aily embedded failed: ${err?.message || err}`,
          type: 5,
          is_stream: false,
          route_via: 'aily',
          group_id: govCtx.groupInfo?.group?.id || '',
        })
        if (!res.headersSent) {
          res.status(502).json({
            error: { message: 'aily upstream unavailable', diagnosis_id: slim.id, route_via: 'aily' },
          })
        }
        return
      }
      try {
        store.record({
          method: req.method,
          endpoint,
          upstream_url: handled?.upstream_url || '',
          status_code: handled?.status || 200,
          duration_ms: Date.now() - started,
          ip: clientIp(req),
          model_name: handled?.model_name || requestedModel,
          requested_model: requestedModel,
          token_name: maskTokenNameFromAuth(req.headers.authorization),
          prompt_tokens: handled?.usage?.prompt_tokens || 0,
          completion_tokens: handled?.usage?.completion_tokens || 0,
          cache_tokens: handled?.usage?.cache_tokens || 0,
          req_headers: redactHeaders(req.headers),
          req_body: reqBodyText,
          res_headers: {},
          res_body: handled?.capturedBody || '',
          upstream_req_headers: {},
          upstream_req_body: handled?.upstream_req_body || '',
          is_stream: !!handled?.is_stream,
          type: (handled?.status || 200) >= 400 ? 5 : 2,
          content: (handled?.status || 200) >= 400 ? String(handled?.capturedBody || '').slice(0, 300) : '',
          route_via: 'aily',
          group_id: govCtx.groupInfo?.group?.id || '',
        })
      } catch (err) {
        console.error('[diagnosis] record failed', err?.message || err)
      }
      if (typeof governance?.onComplete === 'function') {
        try {
          governance.onComplete({
            ...govCtx,
            status: handled?.status || 200,
            usage: handled?.usage || {},
            isConsuming: isConsumingEndpoint(endpoint, req.method),
          })
        } catch (err) {
          console.error('[v1] governance onComplete failed', err?.message || err)
        }
      }
      return
    }

    const pathPart = endpoint.startsWith('/v1') ? endpoint : `/v1${endpoint}`
    const upstreamUrl = `${upstreamBase}${pathPart}`
    const fwd = forwardHeaders(req, { authOverride })

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
        content: `upstream fetch failed (${routeVia}): ${err?.message || err}`,
        type: 5,
        is_stream: false,
        route_via: routeVia,
        group_id: govCtx.groupInfo?.group?.id || '',
      })
      res.status(502).json({ error: { message: 'upstream unavailable', diagnosis_id: slim.id, route_via: routeVia } })
      return
    }

    const modelsList = isModelsList(endpoint, req.method)
    let resBodyOverride = null

    // For /v1/models: buffer full body, filter by group, then send
    if (modelsList && typeof governance?.filterModelsBody === 'function' && govCtx.userId) {
      const text = await upstream.text().catch(() => '')
      resBodyOverride = governance.filterModelsBody(govCtx, text) || text
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
      try {
        res.setHeader('x-mrblank-route', routeVia)
        res.setHeader('content-type', 'application/json')
        if (govCtx.groupInfo?.group?.id) res.setHeader('x-mrblank-group', govCtx.groupInfo.group.id)
      } catch {
        /* ignore */
      }
      res.end(resBodyOverride)

      const usage = extractUsageFromBody(resBodyOverride)
      try {
        store.record({
          method: req.method,
          endpoint,
          upstream_url: upstreamUrl,
          status_code: upstream.status,
          duration_ms: Date.now() - started,
          ttft_ms: null,
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
          res_body: resBodyOverride,
          upstream_req_headers: redactHeaders(fwd),
          upstream_req_body: reqBodyText,
          is_stream: false,
          type: upstream.status >= 400 ? 5 : 2,
          content: '',
          route_via: routeVia,
          group_id: govCtx.groupInfo?.group?.id || '',
        })
      } catch (err) {
        console.error('[diagnosis] record failed', err?.message || err)
      }
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
    try {
      res.setHeader('x-mrblank-route', routeVia)
      if (govCtx.groupInfo?.group?.id) res.setHeader('x-mrblank-group', govCtx.groupInfo.group.id)
    } catch {
      /* ignore */
    }

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
        route_via: routeVia,
        group_id: govCtx.groupInfo?.group?.id || '',
      })
    } catch (err) {
      console.error('[diagnosis] record failed', err?.message || err)
    }

    if (typeof governance?.onComplete === 'function') {
      try {
        governance.onComplete({
          ...govCtx,
          status: upstream.status,
          usage,
          isConsuming: isConsumingEndpoint(endpoint, req.method),
        })
      } catch (err) {
        console.error('[v1] governance onComplete failed', err?.message || err)
      }
    }
  }
}
