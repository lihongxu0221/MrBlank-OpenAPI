/**
 * Phase C/D/E — BFF /v1 reverse-proxy with diagnosis capture + group governance.
 * Default upstream: CPA billing. Optional in-process Aily bridge by model allowlist.
 * Phase E: per-user rolling quotas (429) and model allowlist (403) when API key maps to a site user.
 */
import crypto from 'node:crypto'
import { requestIp } from './requestIp.js'
import {
  extractModelFromReqBody,
  extractReasoningFromReqBody,
  extractUsageFromBody,
  maskTokenNameFromAuth,
  redactHeaders,
} from './diagnosis.js'
import {
  createHonorModelSseTransformer,
  honorModelName,
  honorRequestedModelInBody,
} from './honorRequestedModel.js'


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
  // Never trust the first X-Forwarded-For entry (client-controlled; nginx appends).
  return requestIp(req)
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

/** Request headers that may be forwarded upstream (allowlist; everything else is dropped). */
const FORWARD_ALLOW = new Set([
  'content-type',
  'accept',
  'user-agent',
  'anthropic-version',
  'anthropic-beta',
  'openai-beta',
  'idempotency-key',
  'x-request-id',
])
const FORWARD_ALLOW_PREFIX = ['x-stainless-']

/** Header names that can carry a client credential (all stripped before forwarding). */
const AUTH_HEADERS = ['authorization', 'x-api-key', 'x-goog-api-key', 'api-key']
/** Query params that can carry a client credential (stripped before forwarding). */
const AUTH_QUERY_PARAMS = ['key', 'api_key', 'api-key']

export function forwardHeaders(req, { authOverride } = {}) {
  const out = {}
  for (const [k, v] of Object.entries(req.headers || {})) {
    const lk = k.toLowerCase()
    if (v == null) continue
    if (!FORWARD_ALLOW.has(lk) && !FORWARD_ALLOW_PREFIX.some((p) => lk.startsWith(p))) continue
    out[lk] = Array.isArray(v) ? v.join(', ') : String(v)
  }
  if (authOverride) out.authorization = `Bearer ${authOverride}`
  return out
}

/**
 * Extract the client API key from any supported location
 * (Authorization Bearer, x-api-key, x-goog-api-key, api-key, ?key=).
 */
export function extractClientKey(req, query = null) {
  const h = req.headers || {}
  const auth = String(h.authorization || '').trim()
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth)
    const v = (m ? m[1] : auth).trim()
    if (v) return v
  }
  for (const name of ['x-api-key', 'x-goog-api-key', 'api-key']) {
    const v = String(h[name] || '').trim()
    if (v) return v
  }
  if (query) {
    for (const name of AUTH_QUERY_PARAMS) {
      const v = String(query.get(name) || '').trim()
      if (v) return v
    }
  }
  return ''
}

/**
 * Exact route allowlist for the public /v1 surface.
 * consuming = billable (quota / credits / key limits enforced).
 */
const V1_ROUTES = [
  { method: 'GET', re: /^\/v1\/models$/, consuming: false, models: true },
  { method: 'GET', re: /^\/v1\/models\/[A-Za-z0-9._:@+-]{1,128}$/, consuming: false },
  { method: 'POST', re: /^\/v1\/chat\/completions$/, consuming: true },
  { method: 'POST', re: /^\/v1\/completions$/, consuming: true },
  { method: 'POST', re: /^\/v1\/messages$/, consuming: true },
  { method: 'POST', re: /^\/v1\/messages\/count_tokens$/, consuming: true },
  { method: 'POST', re: /^\/v1\/responses$/, consuming: true },
  { method: 'POST', re: /^\/v1\/responses\/compact$/, consuming: true },
  { method: 'POST', re: /^\/v1\/embeddings$/, consuming: true },
  { method: 'POST', re: /^\/v1\/images\/(generations|edits|variations)$/, consuming: true },
  { method: 'POST', re: /^\/v1\/audio\/(speech|transcriptions|translations)$/, consuming: true },
  { method: 'POST', re: /^\/v1\/videos$/, consuming: true },
  { method: 'GET', re: /^\/v1\/videos\/[A-Za-z0-9._:-]{1,128}$/, consuming: false },
]

/**
 * Validate + normalize a raw /v1 request URL.
 * Rejects any percent-encoding, backslashes, dot segments, empty segments ("//").
 * Returns { ok, status, error } or { ok:true, path, query, route, consuming, models }.
 */
export function resolveV1Request(rawUrl, method) {
  const raw = String(rawUrl || '')
  const qIdx = raw.indexOf('?')
  let pathPart = qIdx >= 0 ? raw.slice(0, qIdx) : raw
  const queryPart = qIdx >= 0 ? raw.slice(qIdx + 1) : ''
  if (!pathPart.startsWith('/v1')) pathPart = `/v1${pathPart.startsWith('/') ? '' : '/'}${pathPart}`
  if (/%/.test(pathPart) || /\\/.test(pathPart)) {
    return { ok: false, status: 400, error: 'encoded or escaped characters are not allowed in the request path' }
  }
  if (pathPart.length > 1 && pathPart.endsWith('/')) pathPart = pathPart.slice(0, -1)
  const segs = pathPart.split('/').slice(1)
  if (segs.some((s) => s === '' || s === '.' || s === '..')) {
    return { ok: false, status: 400, error: 'malformed request path' }
  }
  const m = String(method || 'GET').toUpperCase()
  const route = V1_ROUTES.find((r) => r.method === m && r.re.test(pathPart))
  if (!route) {
    return { ok: false, status: 404, error: `unsupported endpoint: ${m} ${pathPart}` }
  }
  const query = new URLSearchParams(queryPart)
  return { ok: true, path: pathPart, query, consuming: route.consuming, models: !!route.models }
}

/** Upstream query string with credential params removed. */
export function sanitizedQueryString(query) {
  const q = new URLSearchParams(query)
  for (const name of AUTH_QUERY_PARAMS) q.delete(name)
  const s = q.toString()
  return s ? `?${s}` : ''
}

/** Extract requested completion budget (max_tokens etc.) from a JSON body. */
export function extractMaxTokens(bodyText) {
  if (!bodyText) return 0
  try {
    const o = JSON.parse(bodyText)
    const n = Number(
      o?.max_tokens ?? o?.max_completion_tokens ?? o?.max_output_tokens ?? o?.generationConfig?.maxOutputTokens ?? 0,
    )
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  } catch {
    return 0
  }
}

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers':
    'authorization, content-type, x-api-key, x-goog-api-key, api-key, anthropic-version, anthropic-beta, openai-beta, x-stainless-arch, x-stainless-lang, x-stainless-os, x-stainless-package-version, x-stainless-runtime, x-stainless-runtime-version, x-stainless-retry-count, x-stainless-timeout',
  'access-control-max-age': '600',
}

/**
 * @param {object} opts
 * @param {string} opts.billingBaseUrl CPA billing shim
 * @param {object} opts.store diagnosis store
 * @param {boolean} [opts.enabled]
 * @param {{ match?: (model:string)=>boolean, handleV1?: Function, embedded?: boolean, adapterUrl?: string, apiKey?: string }} [opts.ailyRoute]
 * @param {{
 *   enforce?: (ctx: object) => Promise<{ allow: true, userId?: string, groupInfo?: object } | { allow: false, status: number, headers?: object, body: object }>,
 *   enrichModelsBody?: (ctx: object, bodyText: string) => string | Promise<string>,
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
    // CORS preflight: answer locally (never forward, never needs a key).
    if (req.method === 'OPTIONS') {
      for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v)
      res.status(204).end()
      return
    }
    res.setHeader('access-control-allow-origin', '*')
    if (!enabled) {
      res.status(503).json({ error: { message: 'BFF /v1 proxy disabled' } })
      return
    }
    if (!cpaBase) {
      res.status(503).json({ error: { message: 'CPA billing URL not configured' } })
      return
    }

    const resolved = resolveV1Request(req.originalUrl || req.url || '/v1', req.method)
    if (!resolved.ok) {
      res.status(resolved.status).json({
        error: { message: resolved.error, type: 'invalid_request_error', code: resolved.status === 404 ? 'unknown_endpoint' : 'bad_path' },
      })
      return
    }
    const routeConsuming = resolved.consuming
    const routeIsModels = resolved.models
    // Canonical endpoint (normalized path + query without credentials) — used for routing, logs, upstream.
    const endpoint = `${resolved.path}${sanitizedQueryString(resolved.query)}`
    const isModelsList = () => routeIsModels
    const isConsumingEndpoint = () => routeConsuming

    const started = Date.now()
    let ttft_ms = null
    const apiKey = extractClientKey(req, resolved.query)
    const eventId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
    const tokenNameMasked = maskTokenNameFromAuth(apiKey ? `Bearer ${apiKey}` : '')
    const ip = clientIp(req)

    function emitComplete(extra = {}) {
      if (typeof governance?.onComplete !== 'function') return
      try {
        governance.onComplete({
          ...govCtx,
          diagnosis_id: eventId,
          id: eventId,
          ip,
          token_name: tokenNameMasked,
          duration_ms: Date.now() - started,
          ttft_ms,
          endpoint,
          method: req.method,
          requestedModel,
          apiKey,
          reasoning,
          ...extra,
        })
      } catch (err) {
        console.error('[v1] governance onComplete failed', err?.message || err)
      }
    }

    let reqBuf = Buffer.alloc(0)
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') reqBuf = await readRawBody(req)
    } catch (err) {
      res.status(err.status || 400).json({ error: { message: err.message || 'bad request body' } })
      return
    }

    const reqBodyText = reqBuf.length ? reqBuf.toString('utf8') : ''
    const requestedModel = extractModelFromReqBody(reqBodyText)
    const reasoning = extractReasoningFromReqBody(reqBodyText)

    /** @type {{ userId?: string, groupInfo?: object, skipUpstream?: boolean }} */
    let govCtx = { apiKey, requestedModel, endpoint, method: req.method }
    if (typeof governance?.enforce !== 'function') {
      res.status(503).json({ error: { message: 'governance not configured', type: 'server_error' } })
      return
    }
    {
      try {
        const decision = await governance.enforce({
          req,
          apiKey,
          model: requestedModel,
          endpoint,
          method: req.method,
          isModelsList: isModelsList(endpoint, req.method),
          isConsuming: isConsumingEndpoint(endpoint, req.method),
          reqBodyText,
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
          id: eventId,
              method: req.method,
              endpoint,
              upstream_url: '',
              status_code: status,
              duration_ms: Date.now() - started,
              ip: clientIp(req),
              model_name: requestedModel,
              requested_model: requestedModel,
              token_name: tokenNameMasked,
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
          emitComplete({
            status,
            usage: {},
            isConsuming: false,
            is_stream: false,
            model_name: requestedModel,
            route_via: 'governance',
            group: decision.group_id || '',
            success: false,
            content: decision.body?.error?.message || decision.code || 'governance deny',
            has_detail: true,
          })
          res.status(status).json(decision.body || { error: { message: 'forbidden' } })
          return
        }
        if (!decision || decision.allow !== true || !decision.userId) {
          try { decision?.releaseTokenConcurrency?.() } catch { /* ignore */ }
          // Fail closed: an allow without an identified owner / upstream credential is a bug.
          res.status(401).json({ error: { message: '无效的 API Key', type: 'invalid_request_error', code: 'invalid_api_key' } })
          return
        }
        govCtx = { ...govCtx, ...decision, apiKey, requestedModel, endpoint, method: req.method }
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
    if (routeVia === 'cpa') {
      // BFF talks to CPA with its own dedicated upstream key; client credentials never leave the BFF.
      authOverride = govCtx.upstreamKey || null
      if (!authOverride) {
        try { govCtx.releaseTokenConcurrency?.() } catch { /* ignore */ }
        res.status(503).json({ error: { message: 'upstream key not configured', type: 'server_error' } })
        return
      }
    }

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
          id: eventId,
          method: req.method,
          endpoint,
          upstream_url: '',
          status_code: 502,
          duration_ms: Date.now() - started,
          ip: clientIp(req),
          model_name: requestedModel,
          requested_model: requestedModel,
          token_name: tokenNameMasked,
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
        emitComplete({
          status: 502,
          usage: {},
          isConsuming: isConsumingEndpoint(endpoint, req.method),
          is_stream: false,
          model_name: requestedModel,
          route_via: 'aily',
          group: govCtx.groupInfo?.group?.id || '',
          success: false,
          content: String(err?.message || err),
          has_detail: true,
        })
        if (!res.headersSent) {
          res.status(502).json({
            error: { message: 'aily upstream unavailable', diagnosis_id: slim.id || eventId, route_via: 'aily' },
          })
        }
        return
      }
      try {
        store.record({
          id: eventId,
          method: req.method,
          endpoint,
          upstream_url: handled?.upstream_url || '',
          status_code: handled?.status || 200,
          duration_ms: Date.now() - started,
          ip: clientIp(req),
          model_name: handled?.model_name || requestedModel,
          requested_model: requestedModel,
          token_name: tokenNameMasked,
          prompt_tokens: handled?.usage?.prompt_tokens || 0,
          completion_tokens: handled?.usage?.completion_tokens || 0,
          cache_tokens: handled?.usage?.cache_tokens || 0,
          req_headers: redactHeaders(req.headers),
          req_body: reqBodyText,
          res_headers: {},
          res_body: handled?.capturedBody || '',
          upstream_req_headers: handled?.upstream_req_headers || {},
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
      emitComplete({
        status: handled?.status || 200,
        usage: handled?.usage || {},
        isConsuming: isConsumingEndpoint(endpoint, req.method),
        is_stream: !!handled?.is_stream,
        model_name: handled?.model_name || requestedModel,
        route_via: 'aily',
        group: govCtx.groupInfo?.group?.id || govCtx.groupInfo?.group?.name || '',
        has_detail: true,
      })
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
          id: eventId,
        method: req.method,
        endpoint,
        upstream_url: upstreamUrl,
        status_code: 502,
        duration_ms: Date.now() - started,
        ip: clientIp(req),
        model_name: requestedModel,
        requested_model: requestedModel,
        token_name: tokenNameMasked,
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
      emitComplete({
        status: 502,
        usage: {},
        isConsuming: isConsumingEndpoint(endpoint, req.method),
        is_stream: false,
        model_name: requestedModel,
        route_via: routeVia,
        group: govCtx.groupInfo?.group?.id || '',
        success: false,
        content: String(err?.message || err),
        has_detail: true,
      })
      res.status(502).json({ error: { message: 'upstream unavailable', diagnosis_id: slim.id || eventId, route_via: routeVia } })
      return
    }

    const modelsList = isModelsList(endpoint, req.method)
    let resBodyOverride = null

    // For /v1/models: buffer full body, merge Aily (plaza parity), filter by group, then send
    const shouldBufferModels =
      modelsList &&
      (typeof governance?.enrichModelsBody === 'function' ||
        (typeof governance?.filterModelsBody === 'function' && govCtx.userId))
    if (shouldBufferModels) {
      const text = await upstream.text().catch(() => '')
      let merged = text
      if (typeof governance?.enrichModelsBody === 'function') {
        try {
          merged = (await governance.enrichModelsBody(govCtx, text)) || text
        } catch (err) {
          console.warn('[v1] enrichModelsBody failed', err?.message || err)
          merged = text
        }
      }
      if (typeof governance?.filterModelsBody === 'function' && govCtx.userId) {
        resBodyOverride = governance.filterModelsBody(govCtx, merged) || merged
      } else {
        resBodyOverride = merged
      }
      // If CPA errored but enrich produced aily rows, prefer 200 so pickers see aily/*
      let outStatus = upstream.status
      try {
        const parsed = JSON.parse(resBodyOverride || '{}')
        if (Array.isArray(parsed?.data) && parsed.data.length && upstream.status >= 400) {
          outStatus = 200
        }
      } catch {
        /* keep upstream status */
      }
      res.status(outStatus)
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
        if (merged !== text) res.setHeader('x-mrblank-models', 'cpa+aily')
      } catch {
        /* ignore */
      }
      res.end(resBodyOverride)

      const usage = extractUsageFromBody(resBodyOverride)
      try {
        store.record({
          id: eventId,
          method: req.method,
          endpoint,
          upstream_url: upstreamUrl,
          status_code: outStatus,
          duration_ms: Date.now() - started,
          ttft_ms: null,
          ip: clientIp(req),
          model_name: usage.model_name || requestedModel,
          requested_model: requestedModel,
          token_name: tokenNameMasked,
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
          type: outStatus >= 400 ? 5 : 2,
          content: '',
          route_via: routeVia,
          group_id: govCtx.groupInfo?.group?.id || '',
        })
      } catch (err) {
        console.error('[diagnosis] record failed', err?.message || err)
      }
      emitComplete({
        status: outStatus,
        usage,
        isConsuming: false,
        is_stream: false,
        model_name: usage.model_name || requestedModel,
        route_via: routeVia,
        group: govCtx.groupInfo?.group?.id || '',
        has_detail: true,
      })
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
    const ctype = String(resHeaderObj['content-type'] || '')
    const upstreamLooksStream = ctype.includes('text/event-stream')
    const honorSse = upstreamLooksStream ? createHonorModelSseTransformer(requestedModel) : null
    const reader = upstream.body?.getReader?.()

    /** Buffer non-SSE bodies fully so we can honor requested model before write. */
    async function readAllFromReader(rdr) {
      const parts = []
      while (true) {
        const { done, value } = await rdr.read()
        if (done) break
        if (ttft_ms == null) ttft_ms = Date.now() - started
        parts.push(Buffer.from(value))
      }
      return Buffer.concat(parts).toString('utf8')
    }

    if (!upstreamLooksStream) {
      let rawText = ''
      try {
        rawText = reader ? await readAllFromReader(reader) : await upstream.text().catch(() => '')
      } catch (err) {
        rawText = String(err?.message || err)
      }
      const honored = honorRequestedModelInBody(rawText, requestedModel)
      const text = honored.text
      if (honored.changed) {
        try {
          res.setHeader('x-mrblank-model-honor', '1')
        } catch {
          /* ignore */
        }
      }
      if (text) {
        capture.push(Buffer.from(text))
        captured = text.length
        res.end(text)
      } else res.end()
    } else if (!reader) {
      const rawText = await upstream.text().catch(() => '')
      const honored = honorRequestedModelInBody(rawText, requestedModel)
      const text = honored.text
      if (honored.changed) {
        try {
          res.setHeader('x-mrblank-model-honor', '1')
        } catch {
          /* ignore */
        }
      }
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
          let outBuf = Buffer.from(value)
          if (honorSse) {
            const rewritten = honorSse.push(outBuf)
            outBuf = Buffer.from(rewritten)
            if (!outBuf.length) continue
          }
          res.write(outBuf)
          if (captured < MAX_CAPTURE) {
            const take = Math.min(outBuf.length, MAX_CAPTURE - captured)
            capture.push(outBuf.subarray(0, take))
            captured += take
          }
        }
        if (honorSse) {
          const tail = honorSse.flush()
          if (tail) {
            const outBuf = Buffer.from(tail)
            res.write(outBuf)
            if (captured < MAX_CAPTURE) {
              const take = Math.min(outBuf.length, MAX_CAPTURE - captured)
              capture.push(outBuf.subarray(0, take))
              captured += take
            }
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
    const resolvedModelName = honorModelName(usage.model_name || '', requestedModel)
    const is_stream =
      upstreamLooksStream ||
      /data:\s*\{/.test(resBodyText.slice(0, 200))

    try {
      store.record({
          id: eventId,
        method: req.method,
        endpoint,
        upstream_url: upstreamUrl,
        status_code: upstream.status,
        duration_ms: Date.now() - started,
        ttft_ms,
        ip: clientIp(req),
        model_name: resolvedModelName || requestedModel,
        requested_model: requestedModel,
        token_name: tokenNameMasked,
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

    emitComplete({
      status: upstream.status,
      usage: { ...usage, model_name: resolvedModelName || usage.model_name || requestedModel },
      isConsuming: isConsumingEndpoint(endpoint, req.method),
      is_stream,
      model_name: resolvedModelName || requestedModel,
      route_via: routeVia,
      group: govCtx.groupInfo?.group?.id || govCtx.groupInfo?.group?.name || '',
      has_detail: true,
    })
  }
}

export {
  honorModelName,
  honorRequestedModelInBody,
  isUpstreamVariantOfRequested,
} from './honorRequestedModel.js'
