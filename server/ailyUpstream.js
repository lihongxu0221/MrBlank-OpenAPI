/**
 * In-process OpenAI-compatible bridge to Aily upstream (api.yiyu.pro / api.aily.pro).
 * Ported minimally from aily-openai-adapter (service/aily.mjs + lib catalog helpers).
 * Uses shared .aily tokens via ailyManager — no separate :8088 process.
 */
import { normalizeAilyToken } from './aily.js'
import {
  MODEL_ALIASES,
  applyModelRouting,
  publicModelList,
  normalizeModelRouting,
} from './ailyModelRouting.js'
import {
  chatBodyFromResponses,
  buildCompletionsUpstreamBody,
  completionTextFromJson,
  wrapCompletion,
  makeCompletionChunk,
  buildResponsesOutput,
  wrapResponse,
  runCompatTurn,
} from './ailyCompat.js'

const CATALOG_TTL_MS = 5 * 60 * 1000
const toolReasoningCache = new Map()

function catalogPayload(payload) {
  if (!payload || typeof payload !== 'object') return {}
  if (payload.data && typeof payload.data === 'object') return payload.data
  return payload
}

function addModel(ids, id, extra = {}) {
  if (typeof id !== 'string') return
  const trimmed = id.trim()
  if (!trimmed || ids.has(trimmed)) return
  ids.set(trimmed, { id: trimmed, object: 'model', owned_by: 'aily', ...extra })
}

export function mapCatalogToModels(payload) {
  const data = catalogPayload(payload)
  const ids = new Map()
  for (const table of [data.model_presets, data.user_visible_model_presets]) {
    if (!table || typeof table !== 'object') continue
    for (const [id, entry] of Object.entries(table)) {
      const name = typeof entry?.display_name === 'string' ? entry.display_name : undefined
      // Display name belongs to the preset id only — never copy onto entry.model
      // (e.g. auto-max "Aily Max" must not label glm-5.3).
      addModel(ids, id, name ? { name } : {})
      addModel(ids, entry?.model)
      if (Array.isArray(entry?.aliases)) for (const alias of entry.aliases) addModel(ids, alias)
    }
  }
  if (data.models && typeof data.models === 'object') {
    for (const [id, entry] of Object.entries(data.models)) {
      const name = typeof entry?.display_name === 'string' ? entry.display_name : undefined
      addModel(ids, id, name ? { name } : {})
      if (Array.isArray(entry?.aliases)) for (const alias of entry.aliases) addModel(ids, alias)
    }
  }
  for (const [alias, preset] of Object.entries(MODEL_ALIASES)) {
    if (ids.has(preset)) addModel(ids, alias)
  }
  return [...ids.values()]
}

export function catalogIndex(payload) {
  const data = catalogPayload(payload)
  const presets = new Set()
  const models = new Set()
  for (const id of Object.keys(data.model_presets || {})) presets.add(id)
  for (const id of Object.keys(data.user_visible_model_presets || {})) presets.add(id)
  for (const id of Object.keys(data.models || {})) models.add(id)
  for (const preset of Object.values(MODEL_ALIASES)) presets.add(preset)
  return { presets, models, list: mapCatalogToModels(payload) }
}

export function resolveAilyModel(model, index = { presets: new Set(), models: new Set() }) {
  const requested = String(model || '').trim() || 'aily-auto'
  if (MODEL_ALIASES[requested]) return { requested, presetId: MODEL_ALIASES[requested] }
  if (index.presets?.has(requested)) return { requested, presetId: requested }
  if (index.models?.has(requested)) return { requested, selectModel: requested }
  if (requested === 'auto' || requested.startsWith('auto-')) return { requested, presetId: requested }
  return { requested, presetId: requested }
}

function convertMessages(msgs) {
  return (msgs || []).map((m) => {
    const out = { role: m.role }
    if (typeof m.content === 'string') {
      out.content = m.content
    } else if (Array.isArray(m.content)) {
      out.content = m.content.map((p) => {
        if (p.type === 'text') return { type: 'text', text: p.text }
        if (p.type === 'image_url' && p.image_url?.url) {
          const match = String(p.image_url.url).match(/^data:(.+?);base64,(.+)$/)
          if (match) return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }
          return { type: 'text', text: '[image skipped]' }
        }
        return p
      })
    }
    if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      out.tool_calls = m.tool_calls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.function?.name, arguments: tc.function?.arguments },
      }))
    }
    if (m.reasoning_content) out.reasoning_content = m.reasoning_content
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id
    if (m.name) out.name = m.name
    if (out.role === 'assistant' && Array.isArray(out.tool_calls) && !out.reasoning_content) {
      for (const tc of out.tool_calls) {
        const rc = toolReasoningCache.get(tc.id)
        if (rc !== undefined) {
          out.reasoning_content = rc
          break
        }
      }
    }
    return out
  })
}

function buildAilyBody(openaiBody, index, routing) {
  const info = applyModelRouting(openaiBody.model, index, routing, resolveAilyModel)
  const body = {
    messages: convertMessages(openaiBody.messages),
    max_tokens: openaiBody.max_tokens || openaiBody.max_completion_tokens || 16384,
    temperature: openaiBody.temperature ?? 0,
  }
  if (info.presetId) body.model_preset_id = info.presetId
  if (info.selectModel) body.select_model = info.selectModel
  if (Array.isArray(openaiBody.tools) && openaiBody.tools.length > 0) {
    body.tools = openaiBody.tools
      .filter((t) => t.type === 'function')
      .map((t) => ({
        name: t.function.name,
        description: t.function.description || '',
        input_schema: t.function.parameters || { type: 'object', properties: {} },
      }))
  }
  return body
}

function createSseParser(onEvent) {
  let buf = ''
  return (chunkData) => {
    buf += chunkData.toString('utf8')
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      let line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        onEvent(JSON.parse(payload))
      } catch {
        /* ignore */
      }
    }
  }
}

function pickRouting(ev, state = {}) {
  const next = { ...state }
  if (!ev || typeof ev !== 'object') return next
  if (typeof ev.resolved_model === 'string' && ev.resolved_model.trim()) {
    next.resolved_model = ev.resolved_model.trim()
  }
  const routing = ev.model_routing
  if (routing && typeof routing === 'object') {
    next.model_routing = routing
    const selected =
      routing.selected_model ||
      routing.selectedModel ||
      routing.selected_preset_id ||
      routing.selectedPresetId
    if (typeof selected === 'string' && selected.trim()) {
      next.resolved_model = next.resolved_model || selected.trim()
    }
  }
  return next
}

function responseModel(requested, routing) {
  return (
    routing?.resolved_model ||
    routing?.model_routing?.selected_model ||
    routing?.model_routing?.selectedModel ||
    requested
  )
}

function firstNum(...vals) {
  for (const v of vals) {
    if (v == null || v === '') continue
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return 0
}

function toUsage(usage) {
  if (!usage || typeof usage !== 'object') return null
  const prompt = firstNum(usage.prompt_tokens, usage.promptTokens, usage.inputTokens)
  const completion = firstNum(usage.completion_tokens, usage.completionTokens, usage.outputTokens)
  const cache = firstNum(
    usage.cache_tokens,
    usage.cached_tokens,
    usage.cache_read_tokens,
    usage.cache_read_input_tokens,
    usage.cacheReadTokens,
    usage.cachedTokens,
    usage.prompt_tokens_details?.cached_tokens,
  )
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    cache_tokens: cache,
  }
}

function mergeUsage(prev, next) {
  if (!next || typeof next !== 'object') return prev
  return { ...(prev || {}), ...next }
}

function mapStop(r) {
  switch (String(r || '').toUpperCase()) {
    case 'COMPLETED':
    case 'TEXT_NO_TERMINATE':
      return 'stop'
    case 'TOOL_CALLS':
      return 'tool_calls'
    case 'MAX_TOKENS':
      return 'length'
    case 'CONTENT_FILTER':
      return 'content_filter'
    default:
      return 'stop'
  }
}

function makeChunk(id, model, delta, finish) {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finish ?? null }],
  }
}

function FALLBACK_MODELS() {
  return Object.keys(MODEL_ALIASES).map((id) => ({ id, object: 'model', owned_by: 'aily' }))
}

/**
 * @param {{
 *   getAccessToken: () => string,
 *   getRefreshToken: () => string,
 *   getUpstreamBase: () => string,
 *   saveAuth: (patch: object) => void,
 *   refreshToken: () => Promise<{ok:boolean,message?:string}>,
 *   getModelRouting?: () => { whitelist: string[], mappings: {from:string,to:string}[] },
 * }} deps
 */
export function createAilyUpstream(deps) {
  function currentRouting() {
    try {
      return normalizeModelRouting(deps.getModelRouting?.() || {})
    } catch {
      return normalizeModelRouting({})
    }
  }

  /** Optional: resolve Grok/OpenAI account route. */
  async function resolveCompat(model) {
    if (typeof deps.resolveCompat !== 'function') return { allowed: false, mapped: model }
    try {
      return await deps.resolveCompat(model)
    } catch (e) {
      console.warn('[aily-upstream] resolveCompat failed:', e?.message || e)
      return { allowed: false, mapped: model }
    }
  }
  let catalogState = { at: 0, payload: null, index: catalogIndex(null), list: FALLBACK_MODELS() }

  async function fetchUpstream(url, { method = 'GET', headers = {}, body, timeoutMs = 120000 } = {}) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
        signal: ctrl.signal,
      })
      return res
    } finally {
      clearTimeout(timer)
    }
  }

  async function withAuthRetry(doFetch) {
    let token = normalizeAilyToken(deps.getAccessToken())
    if (!token) {
      const err = new Error('No Aily access_token stored')
      err.status = 401
      throw err
    }
    let res = await doFetch(token)
    if (res.status === 401 && deps.getRefreshToken()) {
      const refreshed = await deps.refreshToken()
      if (refreshed?.ok) {
        token = normalizeAilyToken(deps.getAccessToken())
        if (token) res = await doFetch(token)
      }
    }
    return { res, token }
  }

  async function loadCatalog(force = false) {
    const now = Date.now()
    if (!force && catalogState.payload && now - catalogState.at < CATALOG_TTL_MS) return catalogState
    const base = deps.getUpstreamBase()
    try {
      const { res } = await withAuthRetry((token) =>
        fetchUpstream(`${base}/api/v2/model_catalog`, {
          headers: { Authorization: `Bearer ${token}` },
          timeoutMs: 20000,
        }),
      )
      const json = await res.json().catch(() => null)
      if (res.ok && json) {
        catalogState = {
          at: now,
          payload: json,
          index: catalogIndex(json),
          list: mapCatalogToModels(json),
        }
        return catalogState
      }
      console.warn('[aily-upstream] model_catalog HTTP', res.status)
    } catch (e) {
      console.warn('[aily-upstream] model_catalog failed:', e?.message || e)
    }
    if (!catalogState.payload) {
      catalogState.list = FALLBACK_MODELS()
      catalogState.index = catalogIndex(null)
    }
    return catalogState
  }

  async function listModels(force = false) {
    const started = Date.now()
    const token = normalizeAilyToken(deps.getAccessToken())
    if (!token) {
      return {
        ok: false,
        message: 'No access_token stored',
        models: [],
        sample: [],
        latency_ms: Date.now() - started,
        upstream: deps.getUpstreamBase(),
        embedded: true,
      }
    }
    const cat = await loadCatalog(force)
    const models = (cat.list || []).map((m) => m.id).filter(Boolean)
    return {
      ok: true,
      message: `embedded OK · ${models.length} models`,
      models,
      sample: models.slice(0, 12),
      latency_ms: Date.now() - started,
      upstream: deps.getUpstreamBase(),
      embedded: true,
      data: cat.list,
    }
  }

  async function runAilyTurn(openaiBody, hooks = {}) {
    const cat = await loadCatalog()
    const base = deps.getUpstreamBase()
    const routingCfg = currentRouting()
    const routeInfo = applyModelRouting(openaiBody.model, cat.index, routingCfg, resolveAilyModel)
    if (!routeInfo.allowed) {
      return {
        error: `模型未在白名单中: ${routeInfo.requested}`,
        status: 403,
        upstream_url: '',
        upstream_req_body: null,
        upstream_req_headers: {},
        rejected: true,
      }
    }
    const bodyForUpstream = { ...openaiBody, model: routeInfo.mapped }
    const upstream_req_body = buildAilyBody(bodyForUpstream, cat.index, routingCfg)
    const upstreamUrl = `${base}/api/v2/chat_stateless`
    const makeUpstreamHeaders = (token) => ({
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${token}`,
    })
    // Snapshot for diagnosis (credentials redacted by diagnosis.record)
    let upstream_req_headers = makeUpstreamHeaders('(pending)')

    const doFetch = (token) => {
      upstream_req_headers = makeUpstreamHeaders(token)
      return fetchUpstream(upstreamUrl, {
        method: 'POST',
        headers: upstream_req_headers,
        body: JSON.stringify(upstream_req_body),
        timeoutMs: 300000,
      })
    }

    let res
    try {
      ;({ res } = await withAuthRetry(doFetch))
    } catch (e) {
      return {
        error: e?.message || String(e),
        status: e?.status || 502,
        upstream_url: upstreamUrl,
        upstream_req_body,
        upstream_req_headers,
      }
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return {
        error: errText || `error ${res.status}`,
        status: res.status,
        upstream_url: upstreamUrl,
        upstream_req_body,
        upstream_req_headers,
      }
    }

    hooks.onStart?.()
    let text = ''
    let think = ''
    const toolCalls = []
    let usage = null
    let stopReason = null
    let routing = {}

    const onEvent = (ev) => {
      routing = pickRouting(ev, routing)
      switch (ev.type) {
        case 'text_delta': {
          const t = ev.content || ''
          if (!t) break
          text += t
          hooks.onText?.(t, routing)
          break
        }
        case 'markdown_delta': {
          const t = ev.text || ''
          if (!t) break
          text += t
          hooks.onText?.(t, routing)
          break
        }
        case 'thinking':
        case 'thinking_delta':
        case 'reasoning': {
          const t = ev.content || ev.text || ''
          if (!t) break
          think += t
          hooks.onThink?.(t, routing)
          break
        }
        case 'tool_call':
          if (ev.tool_name && ev.tool_id) {
            let args = {}
            try {
              args = JSON.parse(ev.tool_args)
            } catch {
              /* ignore */
            }
            toolCalls.push({ id: ev.tool_id, name: ev.tool_name, arguments: args })
          }
          break
        case 'tool_call_begin':
          if (ev.toolName && ev.toolCallId) {
            toolCalls.push({ id: ev.toolCallId, name: ev.toolName, arguments: ev.input || {} })
          }
          break
        case 'usage':
          usage = mergeUsage(usage, ev.usage || ev.value)
          break
        case 'turn_end':
        case 'response_complete':
        case 'done':
          stopReason = ev.stop_reason || ev.stopReason || stopReason
          usage = mergeUsage(usage, ev.usage || ev.value)
          break
        default:
          break
      }
    }

    const feed = createSseParser(onEvent)
    const reader = res.body?.getReader?.()
    if (reader) {
      const dec = new TextDecoder()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          feed(dec.decode(value, { stream: true }))
        }
        feed(dec.decode())
      } catch (e) {
        console.error('[aily-upstream] read err:', e?.message || e)
      }
    } else {
      const textBody = await res.text().catch(() => '')
      feed(textBody)
    }

    if (think && toolCalls.length > 0) {
      for (const tc of toolCalls) toolReasoningCache.set(tc.id, think)
      while (toolReasoningCache.size > 800) {
        toolReasoningCache.delete(toolReasoningCache.keys().next().value)
      }
    }

    return {
      text,
      think,
      toolCalls,
      usage,
      stopReason,
      routing,
      upstream_url: upstreamUrl,
      upstream_req_body,
      upstream_req_headers,
    }
  }

  /**
   * Handle OpenAI-compatible request; writes to Express res.
   * @returns {{ status: number, capturedBody: string, upstream_url: string, is_stream: boolean, usage: object|null, model_name: string }}
   */
  async function handleChatCompletions(openaiBody, res) {
    const model = openaiBody.model || 'aily-auto'
    const isStream = openaiBody.stream === true
    const cid = `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const capture = []

    const write = (s) => {
      capture.push(s)
      if (!res.writableEnded) res.write(s)
    }

    const result = await runAilyTurn(openaiBody, {
      onStart() {
        if (isStream && !res.headersSent) {
          res.status(200)
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
          res.setHeader('Cache-Control', 'no-cache')
          res.setHeader('Connection', 'keep-alive')
          res.setHeader('x-mrblank-route', 'aily')
        }
      },
      onText(t, routing) {
        if (isStream) {
          write(
            `data: ${JSON.stringify(makeChunk(cid, responseModel(model, routing), { content: t }))}\n\n`,
          )
        }
      },
      onThink(t, routing) {
        if (isStream) {
          write(
            `data: ${JSON.stringify(makeChunk(cid, responseModel(model, routing), { reasoning_content: t }))}\n\n`,
          )
        }
      },
    })

    if (result.error) {
      const status = result.status || 502
      const body = {
        error: {
          message: `Upstream failed: ${String(result.error).slice(0, 500)}`,
          type: 'upstream_error',
          code: 'aily_upstream',
        },
      }
      if (!res.headersSent) {
        res.status(status)
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('x-mrblank-route', 'aily')
        res.end(JSON.stringify(body))
      }
      return {
        status,
        capturedBody: JSON.stringify(body),
        upstream_url: result.upstream_url || '',
        is_stream: false,
        usage: null,
        model_name: model,
        upstream_req_body: result.upstream_req_body
          ? JSON.stringify(result.upstream_req_body)
          : '',
        upstream_req_headers: result.upstream_req_headers || {},
      }
    }

    const { text, think, toolCalls, usage, stopReason, routing } = result
    const finish = toolCalls.length > 0 ? 'tool_calls' : mapStop(stopReason)
    const outModel = responseModel(model, routing)
    const ou = toUsage(usage)

    if (isStream) {
      if (!res.headersSent) {
        res.status(200)
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
        res.setHeader('x-mrblank-route', 'aily')
      }
      toolCalls.forEach((tc, i) => {
        write(
          `data: ${JSON.stringify(
            makeChunk(cid, outModel, {
              tool_calls: [
                {
                  index: i,
                  id: tc.id,
                  type: 'function',
                  function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
                },
              ],
            }),
          )}\n\n`,
        )
      })
      const finalChunk = makeChunk(cid, outModel, {}, finish)
      if (ou) finalChunk.usage = ou
      write(`data: ${JSON.stringify(finalChunk)}\n\n`)
      write('data: [DONE]\n\n')
      res.end()
      return {
        status: 200,
        capturedBody: capture.join('').slice(0, 512 * 1024),
        upstream_url: result.upstream_url || '',
        is_stream: true,
        usage: ou,
        model_name: outModel,
        upstream_req_body: result.upstream_req_body
          ? JSON.stringify(result.upstream_req_body)
          : '',
        upstream_req_headers: result.upstream_req_headers || {},
      }
    }

    const msg = { role: 'assistant', content: text || null }
    if (think) msg.reasoning_content = think
    if (toolCalls.length > 0) {
      msg.tool_calls = toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      }))
    }
    const resp = {
      id: cid,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: outModel,
      choices: [{ index: 0, message: msg, finish_reason: finish }],
    }
    if (ou) resp.usage = ou
    const bodyText = JSON.stringify(resp)
    if (!res.headersSent) {
      res.status(200)
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('x-mrblank-route', 'aily')
    }
    res.end(bodyText)
    return {
      status: 200,
      capturedBody: bodyText,
      upstream_url: result.upstream_url || '',
      is_stream: false,
      usage: ou,
      model_name: outModel,
      upstream_req_body: result.upstream_req_body
        ? JSON.stringify(result.upstream_req_body)
        : '',
      upstream_req_headers: result.upstream_req_headers || {},
    }
  }

  async function handleModelsList(res) {
    const result = await listModels()
    const catalog = result.data || (result.models || []).map((id) => ({ id, object: 'model', owned_by: 'aily' }))
    const data = publicModelList(catalog, currentRouting())
    const body = { object: 'list', data }
    const bodyText = JSON.stringify(body)
    if (!res.headersSent) {
      res.status(result.ok ? 200 : 401)
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('x-mrblank-route', 'aily')
    }
    res.end(bodyText)
    return {
      status: result.ok ? 200 : 401,
      capturedBody: bodyText,
      upstream_url: `${deps.getUpstreamBase()}/api/v2/model_catalog`,
      is_stream: false,
      usage: null,
      model_name: '',
      upstream_req_body: '',
    }
  }

  function parseBodyOr400(reqBuf, res) {
    try {
      return { ok: true, body: reqBuf?.length ? JSON.parse(reqBuf.toString('utf8')) : {} }
    } catch {
      const errBody = { error: { message: 'Invalid JSON', type: 'invalid_request_error' } }
      if (!res.headersSent) res.status(400).json(errBody)
      return {
        ok: false,
        result: {
          status: 400,
          capturedBody: JSON.stringify(errBody),
          upstream_url: '',
          is_stream: false,
          usage: null,
          model_name: '',
          upstream_req_body: '',
        },
      }
    }
  }

  function writeResponsesEvent(res, type, extra) {
    res.write('event: ' + type + '\ndata: ' + JSON.stringify({ type, ...(extra || {}) }) + '\n\n')
  }

  /**
   * Shared turn runner: prefer compat account if matched, else Aily.
   */
  async function runTurnForModel(openaiBody, hooks) {
    const requested = openaiBody.model || 'aily-auto'
    const compat = await resolveCompat(requested)
    if (compat.allowed && compat.account) {
      return {
        ...(await runCompatTurn(compat, openaiBody, hooks)),
        _via: 'compat',
        _requested: requested,
        _mapped: compat.mapped,
      }
    }
    return { ...(await runAilyTurn(openaiBody, hooks)), _via: 'aily', _requested: requested }
  }

  async function handleCompletions(openaiBody, res) {
    const requested = openaiBody.model || 'aily-auto'
    const isStream = openaiBody.stream === true
    const cid = `cmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const capture = []
    const write = (s) => {
      capture.push(s)
      if (!res.writableEnded) res.write(s)
    }

    const compat = await resolveCompat(requested)
    // Compat path: degrade to single-turn chat
    if (compat.allowed && compat.account) {
      const chatBody = {
        model: compat.mapped,
        messages: [{ role: 'user', content: openaiBody.prompt || '' }],
        stream: isStream,
        max_tokens: openaiBody.max_tokens || openaiBody.max_completion_tokens,
        temperature: openaiBody.temperature,
      }
      const result = await runCompatTurn(compat, chatBody, {
        onStart() {
          if (isStream && !res.headersSent) {
            res.status(200)
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
            res.setHeader('Cache-Control', 'no-cache')
            res.setHeader('x-mrblank-route', 'aily-compat')
          }
        },
        onText(t, routing) {
          if (isStream && t) {
            write(
              `data: ${JSON.stringify(makeCompletionChunk(cid, responseModel(requested, routing), t))}\n\n`,
            )
          }
        },
      })
      if (result.error) {
        const status = result.status || 502
        const body = {
          error: {
            message: `Upstream failed: ${String(result.error).slice(0, 500)}`,
            type: 'upstream_error',
            code: 'aily_compat',
          },
        }
        if (!res.headersSent) {
          res.status(status)
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('x-mrblank-route', 'aily-compat')
          res.end(JSON.stringify(body))
        }
        return {
          status,
          capturedBody: JSON.stringify(body),
          upstream_url: result.upstream_url || '',
          is_stream: false,
          usage: toUsage(result.usage),
          model_name: requested,
          upstream_req_body: result.upstream_req_body
            ? JSON.stringify(result.upstream_req_body)
            : '',
          upstream_req_headers: result.upstream_req_headers || {},
        }
      }
      const ou = toUsage(result.usage)
      const outModel = responseModel(requested, result.routing)
      if (isStream) {
        if (!res.headersSent) {
          res.status(200)
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
          res.setHeader('x-mrblank-route', 'aily-compat')
        }
        const finalChunk = makeCompletionChunk(cid, outModel, '', mapStop(result.stopReason))
        if (ou) finalChunk.usage = ou
        write(`data: ${JSON.stringify(finalChunk)}\n\n`)
        write('data: [DONE]\n\n')
        res.end()
        return {
          status: 200,
          capturedBody: capture.join('').slice(0, 512 * 1024),
          upstream_url: result.upstream_url || '',
          is_stream: true,
          usage: ou,
          model_name: outModel,
          upstream_req_body: result.upstream_req_body
            ? JSON.stringify(result.upstream_req_body)
            : '',
          upstream_req_headers: result.upstream_req_headers || {},
        }
      }
      const resp = wrapCompletion({
        id: cid,
        model: outModel,
        text: result.text,
        finish: mapStop(result.stopReason),
        usage: ou,
      })
      const bodyText = JSON.stringify(resp)
      if (!res.headersSent) {
        res.status(200)
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('x-mrblank-route', 'aily-compat')
      }
      res.end(bodyText)
      return {
        status: 200,
        capturedBody: bodyText,
        upstream_url: result.upstream_url || '',
        is_stream: false,
        usage: ou,
        model_name: outModel,
        upstream_req_body: result.upstream_req_body
          ? JSON.stringify(result.upstream_req_body)
          : '',
        upstream_req_headers: result.upstream_req_headers || {},
      }
    }

    // Aily native completions → /api/v3/code/completions
    const cat = await loadCatalog()
    const routingCfg = currentRouting()
    const routeInfo = applyModelRouting(requested, cat.index, routingCfg, resolveAilyModel)
    if (!routeInfo.allowed) {
      const body = {
        error: {
          message: `模型未在白名单中: ${requested}`,
          type: 'invalid_request_error',
          code: 'model_not_allowed',
        },
      }
      if (!res.headersSent) {
        res.status(403)
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('x-mrblank-route', 'aily')
        res.end(JSON.stringify(body))
      }
      return {
        status: 403,
        capturedBody: JSON.stringify(body),
        upstream_url: '',
        is_stream: false,
        usage: null,
        model_name: requested,
        upstream_req_body: '',
      }
    }
    const bodyForUp = { ...openaiBody, model: routeInfo.mapped }
    const upstream_req_body = buildCompletionsUpstreamBody(bodyForUp)
    const base = deps.getUpstreamBase()
    const upstreamUrl = `${base}/api/v3/code/completions`
    const makeHdrs = (token) => ({
      'Content-Type': 'application/json',
      Accept: isStream ? 'text/event-stream' : 'application/json',
      Authorization: `Bearer ${token}`,
    })
    let upstream_req_headers = makeHdrs('(pending)')
    let upRes
    try {
      ;({ res: upRes } = await withAuthRetry((token) => {
        upstream_req_headers = makeHdrs(token)
        return fetchUpstream(upstreamUrl, {
          method: 'POST',
          headers: upstream_req_headers,
          body: JSON.stringify(upstream_req_body),
          timeoutMs: 300000,
        })
      }))
    } catch (e) {
      const body = {
        error: {
          message: `Upstream failed: ${e?.message || e}`,
          type: 'upstream_error',
          code: 'aily_upstream',
        },
      }
      if (!res.headersSent) {
        res.status(e?.status || 502).json(body)
      }
      return {
        status: e?.status || 502,
        capturedBody: JSON.stringify(body),
        upstream_url: upstreamUrl,
        is_stream: false,
        usage: null,
        model_name: requested,
        upstream_req_body: JSON.stringify(upstream_req_body),
        upstream_req_headers,
      }
    }
    if (!upRes.ok) {
      const errText = await upRes.text().catch(() => '')
      const body = {
        error: {
          message: errText || `error ${upRes.status}`,
          type: 'upstream_error',
          code: 'aily_upstream',
        },
      }
      if (!res.headersSent) {
        res.status(upRes.status)
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('x-mrblank-route', 'aily')
        res.end(JSON.stringify(body))
      }
      return {
        status: upRes.status,
        capturedBody: JSON.stringify(body),
        upstream_url: upstreamUrl,
        is_stream: false,
        usage: null,
        model_name: requested,
        upstream_req_body: JSON.stringify(upstream_req_body),
        upstream_req_headers,
      }
    }
    const ctype = (upRes.headers.get('content-type') || '').toLowerCase()
    let routing = {}
    let usage = null
    let text = ''
    let stopReason = null
    if (ctype.includes('text/event-stream')) {
      if (isStream && !res.headersSent) {
        res.status(200)
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('x-mrblank-route', 'aily')
      }
      const feed = createSseParser((ev) => {
        routing = pickRouting(ev, routing)
        usage = mergeUsage(usage, ev.usage || ev.value)
        const delta = ev.content || ev.text || ev.completion || ''
        if (
          ev.type === 'text_delta' ||
          ev.type === 'completion_delta' ||
          ev.type === 'markdown_delta' ||
          ev.type === 'content'
        ) {
          text += delta
          if (isStream && delta) {
            write(
              `data: ${JSON.stringify(makeCompletionChunk(cid, responseModel(requested, routing), delta))}\n\n`,
            )
          }
        }
        if (ev.type === 'turn_end' || ev.type === 'done' || ev.type === 'response_complete') {
          stopReason = ev.stop_reason || ev.stopReason || stopReason
          usage = mergeUsage(usage, ev.usage || ev.value)
        }
      })
      const reader = upRes.body?.getReader?.()
      if (reader) {
        const dec = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          feed(dec.decode(value, { stream: true }))
        }
        feed(dec.decode())
      } else {
        feed(await upRes.text().catch(() => ''))
      }
      const ou = toUsage(usage)
      const outModel = responseModel(requested, routing)
      if (isStream) {
        const finalChunk = makeCompletionChunk(cid, outModel, '', mapStop(stopReason))
        if (ou) finalChunk.usage = ou
        write(`data: ${JSON.stringify(finalChunk)}\n\n`)
        write('data: [DONE]\n\n')
        res.end()
        return {
          status: 200,
          capturedBody: capture.join('').slice(0, 512 * 1024),
          upstream_url: upstreamUrl,
          is_stream: true,
          usage: ou,
          model_name: outModel,
          upstream_req_body: JSON.stringify(upstream_req_body),
          upstream_req_headers,
        }
      }
      const resp = wrapCompletion({
        id: cid,
        model: outModel,
        text,
        finish: mapStop(stopReason),
        usage: ou,
      })
      const bodyText = JSON.stringify(resp)
      if (!res.headersSent) {
        res.status(200)
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('x-mrblank-route', 'aily')
      }
      res.end(bodyText)
      return {
        status: 200,
        capturedBody: bodyText,
        upstream_url: upstreamUrl,
        is_stream: false,
        usage: ou,
        model_name: outModel,
        upstream_req_body: JSON.stringify(upstream_req_body),
        upstream_req_headers,
      }
    }
    const json = await upRes.json().catch(() => null)
    routing = pickRouting(json, routing)
    usage = json?.usage || json?.data?.usage || usage
    text = completionTextFromJson(json)
    const ou = toUsage(usage)
    const outModel = responseModel(json?.model || requested, routing)
    const resp =
      json && json.object === 'text_completion' && Array.isArray(json.choices)
        ? { ...json, model: outModel }
        : wrapCompletion({ id: cid, model: outModel, text, finish: 'stop', usage: ou })
    if (isStream) {
      if (!res.headersSent) {
        res.status(200)
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
        res.setHeader('x-mrblank-route', 'aily')
      }
      const full = completionTextFromJson(resp)
      if (full) write(`data: ${JSON.stringify(makeCompletionChunk(cid, outModel, full))}\n\n`)
      const finalChunk = makeCompletionChunk(cid, outModel, '', 'stop')
      if (ou) finalChunk.usage = ou
      write(`data: ${JSON.stringify(finalChunk)}\n\n`)
      write('data: [DONE]\n\n')
      res.end()
      return {
        status: 200,
        capturedBody: capture.join('').slice(0, 512 * 1024),
        upstream_url: upstreamUrl,
        is_stream: true,
        usage: ou,
        model_name: outModel,
        upstream_req_body: JSON.stringify(upstream_req_body),
        upstream_req_headers,
      }
    }
    const bodyText = JSON.stringify(resp)
    if (!res.headersSent) {
      res.status(200)
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('x-mrblank-route', 'aily')
    }
    res.end(bodyText)
    return {
      status: 200,
      capturedBody: bodyText,
      upstream_url: upstreamUrl,
      is_stream: false,
      usage: ou,
      model_name: outModel,
      upstream_req_body: JSON.stringify(upstream_req_body),
      upstream_req_headers,
    }
  }

  async function handleResponses(openaiLikeBody, res) {
    const chatBody = chatBodyFromResponses(openaiLikeBody)
    if (!chatBody.messages.length) {
      const errBody = { error: { message: 'input is required', type: 'invalid_request_error' } }
      if (!res.headersSent) res.status(400).json(errBody)
      return {
        status: 400,
        capturedBody: JSON.stringify(errBody),
        upstream_url: '',
        is_stream: false,
        usage: null,
        model_name: '',
        upstream_req_body: '',
      }
    }
    const model = chatBody.model || 'aily-auto'
    const isStream = openaiLikeBody.stream === true
    const rid = `resp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const msgId = 'msg_' + rid.slice(-8)
    const rsId = 'rs_' + rid.slice(-8)
    let thinkStarted = false
    let textStarted = false
    let liveRouting = {}
    const created_at = Math.floor(Date.now() / 1000)
    const skeleton = () => ({
      id: rid,
      object: 'response',
      created_at,
      status: 'in_progress',
      model: responseModel(model, liveRouting),
      output: [],
    })
    const capture = []
    const write = (s) => {
      capture.push(s)
      if (!res.writableEnded) res.write(s)
    }
    const writeEv = (type, extra) => {
      const line = 'event: ' + type + '\ndata: ' + JSON.stringify({ type, ...(extra || {}) }) + '\n\n'
      write(line)
    }

    const result = await runTurnForModel(chatBody, {
      onStart() {
        if (!isStream) return
        if (!res.headersSent) {
          res.status(200)
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
          res.setHeader('Cache-Control', 'no-cache')
          res.setHeader('x-mrblank-route', 'aily')
        }
        writeEv('response.created', { response: skeleton() })
        writeEv('response.in_progress', { response: skeleton() })
      },
      onThink(t, routing) {
        liveRouting = routing
        if (!isStream || !t) return
        if (!thinkStarted) {
          thinkStarted = true
          writeEv('response.output_item.added', {
            output_index: 0,
            item: { type: 'reasoning', id: rsId, status: 'in_progress', summary: [] },
          })
        }
        writeEv('response.reasoning_summary_text.delta', {
          item_id: rsId,
          output_index: 0,
          delta: t,
        })
      },
      onText(t, routing) {
        liveRouting = routing
        if (!isStream || !t) return
        const idx = thinkStarted ? 1 : 0
        if (!textStarted) {
          textStarted = true
          writeEv('response.output_item.added', {
            output_index: idx,
            item: {
              type: 'message',
              id: msgId,
              role: 'assistant',
              status: 'in_progress',
              content: [],
            },
          })
          writeEv('response.content_part.added', {
            item_id: msgId,
            output_index: idx,
            content_index: 0,
            part: { type: 'output_text', text: '' },
          })
        }
        writeEv('response.output_text.delta', {
          item_id: msgId,
          output_index: idx,
          content_index: 0,
          delta: t,
        })
      },
    })

    if (result.error) {
      const status = result.status || 502
      const body = {
        error: {
          message: `Upstream failed: ${String(result.error).slice(0, 500)}`,
          type: 'upstream_error',
          code: 'aily_upstream',
        },
      }
      if (!res.headersSent) {
        res.status(status)
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('x-mrblank-route', 'aily')
        res.end(JSON.stringify(body))
      }
      return {
        status,
        capturedBody: JSON.stringify(body),
        upstream_url: result.upstream_url || '',
        is_stream: false,
        usage: null,
        model_name: model,
        upstream_req_body: result.upstream_req_body
          ? JSON.stringify(result.upstream_req_body)
          : '',
        upstream_req_headers: result.upstream_req_headers || {},
      }
    }

    const { text, think, toolCalls, usage, routing } = result
    const ou = toUsage(usage)
    const output = buildResponsesOutput({ text, think, toolCalls, ids: { rs: rsId, msg: msgId } })
    const resp = wrapResponse({
      id: rid,
      model: responseModel(model, routing),
      output,
      usage: ou,
      status: 'completed',
    })
    if (isStream) {
      const idx = thinkStarted ? 1 : 0
      if (textStarted) {
        writeEv('response.output_text.done', {
          item_id: msgId,
          output_index: idx,
          content_index: 0,
          text: text || '',
        })
        writeEv('response.content_part.done', {
          item_id: msgId,
          output_index: idx,
          content_index: 0,
          part: { type: 'output_text', text: text || '' },
        })
        writeEv('response.output_item.done', {
          output_index: idx,
          item: {
            type: 'message',
            id: msgId,
            role: 'assistant',
            status: 'completed',
            content: text ? [{ type: 'output_text', text }] : [],
          },
        })
      }
      writeEv('response.completed', { response: resp })
      res.end()
      return {
        status: 200,
        capturedBody: capture.join('').slice(0, 512 * 1024),
        upstream_url: result.upstream_url || '',
        is_stream: true,
        usage: ou,
        model_name: resp.model,
        upstream_req_body: result.upstream_req_body
          ? JSON.stringify(result.upstream_req_body)
          : '',
        upstream_req_headers: result.upstream_req_headers || {},
      }
    }
    const bodyText = JSON.stringify(resp)
    if (!res.headersSent) {
      res.status(200)
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('x-mrblank-route', 'aily')
    }
    res.end(bodyText)
    return {
      status: 200,
      capturedBody: bodyText,
      upstream_url: result.upstream_url || '',
      is_stream: false,
      usage: ou,
      model_name: resp.model,
      upstream_req_body: result.upstream_req_body
        ? JSON.stringify(result.upstream_req_body)
        : '',
      upstream_req_headers: result.upstream_req_headers || {},
    }
  }

  /** Chat completions: prefer compat if model matches account, else Aily. */
  async function handleChatCompletionsRouted(openaiBody, res) {
    const requested = openaiBody.model || 'aily-auto'
    const compat = await resolveCompat(requested)
    if (compat.allowed && compat.account) {
      // Reuse streaming wrapper with runCompatTurn
      const model = requested
      const isStream = openaiBody.stream === true
      const cid = `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const capture = []
      const write = (s) => {
        capture.push(s)
        if (!res.writableEnded) res.write(s)
      }
      const result = await runCompatTurn(compat, openaiBody, {
        onStart() {
          if (isStream && !res.headersSent) {
            res.status(200)
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
            res.setHeader('Cache-Control', 'no-cache')
            res.setHeader('Connection', 'keep-alive')
            res.setHeader('x-mrblank-route', 'aily-compat')
          }
        },
        onText(t, routing) {
          if (isStream) {
            write(
              `data: ${JSON.stringify(makeChunk(cid, responseModel(model, routing), { content: t }))}\n\n`,
            )
          }
        },
        onThink(t, routing) {
          if (isStream) {
            write(
              `data: ${JSON.stringify(makeChunk(cid, responseModel(model, routing), { reasoning_content: t }))}\n\n`,
            )
          }
        },
      })
      if (result.error) {
        const status = result.status || 502
        const body = {
          error: {
            message: `Upstream failed: ${String(result.error).slice(0, 500)}`,
            type: 'upstream_error',
            code: 'aily_compat',
          },
        }
        if (!res.headersSent) {
          res.status(status)
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('x-mrblank-route', 'aily-compat')
          res.end(JSON.stringify(body))
        }
        return {
          status,
          capturedBody: JSON.stringify(body),
          upstream_url: result.upstream_url || '',
          is_stream: false,
          usage: null,
          model_name: model,
          upstream_req_body: result.upstream_req_body
            ? JSON.stringify(result.upstream_req_body)
            : '',
          upstream_req_headers: result.upstream_req_headers || {},
        }
      }
      const { text, think, toolCalls, usage, stopReason, routing } = result
      const finish = toolCalls.length > 0 ? 'tool_calls' : mapStop(stopReason)
      const outModel = responseModel(model, routing)
      const ou = toUsage(usage)
      if (isStream) {
        if (!res.headersSent) {
          res.status(200)
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
          res.setHeader('x-mrblank-route', 'aily-compat')
        }
        toolCalls.forEach((tc, i) => {
          write(
            `data: ${JSON.stringify(
              makeChunk(cid, outModel, {
                tool_calls: [
                  {
                    index: i,
                    id: tc.id,
                    type: 'function',
                    function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
                  },
                ],
              }),
            )}\n\n`,
          )
        })
        const finalChunk = makeChunk(cid, outModel, {}, finish)
        if (ou) finalChunk.usage = ou
        write(`data: ${JSON.stringify(finalChunk)}\n\n`)
        write('data: [DONE]\n\n')
        res.end()
        return {
          status: 200,
          capturedBody: capture.join('').slice(0, 512 * 1024),
          upstream_url: result.upstream_url || '',
          is_stream: true,
          usage: ou,
          model_name: outModel,
          upstream_req_body: result.upstream_req_body
            ? JSON.stringify(result.upstream_req_body)
            : '',
          upstream_req_headers: result.upstream_req_headers || {},
        }
      }
      const msg = { role: 'assistant', content: text || null }
      if (think) msg.reasoning_content = think
      if (toolCalls.length > 0) {
        msg.tool_calls = toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }))
      }
      const resp = {
        id: cid,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: outModel,
        choices: [{ index: 0, message: msg, finish_reason: finish }],
      }
      if (ou) resp.usage = ou
      const bodyText = JSON.stringify(resp)
      if (!res.headersSent) {
        res.status(200)
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('x-mrblank-route', 'aily-compat')
      }
      res.end(bodyText)
      return {
        status: 200,
        capturedBody: bodyText,
        upstream_url: result.upstream_url || '',
        is_stream: false,
        usage: ou,
        model_name: outModel,
        upstream_req_body: result.upstream_req_body
          ? JSON.stringify(result.upstream_req_body)
          : '',
        upstream_req_headers: result.upstream_req_headers || {},
      }
    }
    return handleChatCompletions(openaiBody, res)
  }

  /**
   * Dispatch OpenAI /v1 path to embedded bridge (Aily or compat accounts).
   */
  async function handleV1({ method, endpoint, reqBuf, res }) {
    const pathOnly = String(endpoint || '').split('?')[0]
    if (method === 'GET' && /\/v1\/models\/?$/.test(pathOnly)) {
      return handleModelsList(res)
    }
    if (method === 'POST' && /\/v1\/chat\/completions\/?$/.test(pathOnly)) {
      const parsed = parseBodyOr400(reqBuf, res)
      if (!parsed.ok) return parsed.result
      return handleChatCompletionsRouted(parsed.body, res)
    }
    if (method === 'POST' && /\/v1\/completions\/?$/.test(pathOnly)) {
      const parsed = parseBodyOr400(reqBuf, res)
      if (!parsed.ok) return parsed.result
      return handleCompletions(parsed.body, res)
    }
    if (method === 'POST' && /\/v1\/responses\/?$/.test(pathOnly)) {
      const parsed = parseBodyOr400(reqBuf, res)
      if (!parsed.ok) return parsed.result
      return handleResponses(parsed.body, res)
    }
    const errBody = {
      error: {
        message: `Embedded Aily bridge does not handle ${method} ${pathOnly}`,
        type: 'invalid_request_error',
      },
    }
    res.status(404).json(errBody)
    return {
      status: 404,
      capturedBody: JSON.stringify(errBody),
      upstream_url: '',
      is_stream: false,
      usage: null,
      model_name: '',
      upstream_req_body: '',
    }
  }

  return {
    listModels,
    loadCatalog,
    handleV1,
    handleChatCompletions,
    handleCompletions,
    handleResponses,
    MODEL_ALIASES,
    getModelRouting: currentRouting,
  }
}
