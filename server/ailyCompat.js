/**
 * In-process OpenAI-compatible relay for Grok / OpenAI upstream accounts.
 * Minimal port of aily-openai-adapter pickProviderRoute + runOpenAICompatibleTurn.
 * Does NOT touch CPA; only used when /v1 is routed away from CPA.
 */
import {
  normalizeModelRouting,
  mappingLookup,
  exposedModelNames,
  publicModelList,
} from './ailyModelRouting.js'
import { defaultCompatBase, isCompatPlatform } from './ailyAccounts.js'

const CATALOG_TTL_MS = 5 * 60 * 1000
const catalogCache = new Map()

export const CODEX_MODELS = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex-spark',
  'codex-auto-review',
]

export function compatBase(account) {
  const platform = account && account.platform
  const def =
    account && account.auth_type === 'oauth' && platform === 'openai'
      ? 'https://chatgpt.com'
      : defaultCompatBase(platform) || ''
  if (account && account.custom_upstream) {
    return String(account.base_url || def).replace(/\/+$/, '')
  }
  return String(def || (account && account.base_url) || '').replace(/\/+$/, '')
}

/**
 * pickProviderRoute for compat accounts only (no aily fallback).
 * Priority: mapping → whitelist → empty-expose + catalog hit.
 */
export function pickProviderRoute(requested, accounts, catalogs) {
  const model = String(requested || '').trim()
  const enabled = (accounts || []).filter(
    (a) => a && a.enabled !== false && isCompatPlatform(a.platform),
  )
  if (!model) return { allowed: false, mapped: model }
  const routingOf = (a) => normalizeModelRouting(a.model_routing)
  for (const a of enabled) {
    const to = mappingLookup(routingOf(a))[model]
    if (to) return { allowed: true, account: a, platform: a.platform, mapped: to, reason: 'map' }
  }
  for (const a of enabled) {
    const r = routingOf(a)
    if (r.whitelist.includes(model)) {
      return { allowed: true, account: a, platform: a.platform, mapped: model, reason: 'white' }
    }
  }
  for (const a of enabled) {
    const r = routingOf(a)
    if (exposedModelNames(r).length) continue
    const ids =
      (catalogs && catalogs.byId && a.id != null && catalogs.byId[a.id]) ||
      (catalogs && catalogs[a.platform])
    if (ids && ids.has(model)) {
      return { allowed: true, account: a, platform: a.platform, mapped: model, reason: 'catalog' }
    }
  }
  return { allowed: false, mapped: model }
}

/** Sync match without awaiting catalogs — whitelist/mapping only (+ cached catalog). */
export function modelMatchesCompat(model, accounts, catalogs) {
  const disp = pickProviderRoute(model, accounts, catalogs || {})
  return !!disp.allowed
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

async function fetchUpstream(url, { method = 'GET', headers = {}, body, timeoutMs = 120000 } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, {
      method,
      headers,
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
      signal: ctrl.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

export async function loadCompatCatalog(account, force = false, platformHint) {
  const platform = (account && account.platform) || platformHint || 'grok'
  const routing = account ? account.model_routing : {}
  const fallback = () => {
    const exposed = exposedModelNames(routing)
    return {
      list: exposed.map((id) => ({ id, object: 'model', owned_by: platform })),
      ids: new Set(exposed),
    }
  }
  if (account && account.auth_type === 'oauth' && platform === 'openai') {
    const ids = CODEX_MODELS
    return { list: ids.map((id) => ({ id, object: 'model', owned_by: 'openai' })), ids: new Set(ids) }
  }
  if (!account || !account.api_key) return fallback()
  const now = Date.now()
  const cached = catalogCache.get(account.id)
  if (!force && cached && cached.at && now - cached.at < CATALOG_TTL_MS) return cached
  try {
    const res = await fetchUpstream(`${compatBase(account)}/models`, {
      headers: { Authorization: `Bearer ${account.api_key}` },
      timeoutMs: 20000,
    })
    const json = await res.json().catch(() => null)
    const rows = (json && Array.isArray(json.data) ? json.data : []).map((m) => ({
      id: m.id,
      object: 'model',
      owned_by: platform,
      name: m.id,
    }))
    const state = { at: now, list: rows, ids: new Set(rows.map((m) => m.id)) }
    if (account.id != null) catalogCache.set(account.id, state)
    return state
  } catch (e) {
    console.warn('[aily-compat]', platform, '/models failed:', e?.message || e)
    const state = { ...fallback(), at: now }
    if (account.id != null) catalogCache.set(account.id, state)
    return state
  }
}

export async function catalogsForAccounts(accounts) {
  const catalogs = { grok: new Set(), openai: new Set(), byId: {} }
  for (const a of (accounts || []).filter((x) => x.enabled !== false && isCompatPlatform(x.platform))) {
    const cat = await loadCompatCatalog(a)
    catalogs.byId[a.id] = cat.ids
    if (!catalogs[a.platform]) catalogs[a.platform] = new Set()
    for (const id of cat.ids) catalogs[a.platform].add(id)
  }
  return catalogs
}

export async function runOpenAICompatibleTurn(account, openaiBody, hooks = {}) {
  const base = compatBase(account)
  if (!account.api_key) return { error: `no ${account.platform} api key`, status: 401 }
  if (!base) return { error: 'no base url', status: 400 }
  const url = `${base}/chat/completions`
  const upstream_req_body = { ...openaiBody }
  const upstream_req_headers = {
    Authorization: `Bearer ${account.api_key}`,
    'Content-Type': 'application/json',
  }
  let upstream
  try {
    upstream = await fetchUpstream(url, {
      method: 'POST',
      headers: upstream_req_headers,
      body: JSON.stringify(upstream_req_body),
      timeoutMs: 300000,
    })
  } catch (e) {
    return {
      error: e?.message || String(e),
      status: 502,
      upstream_url: url,
      upstream_req_body,
      upstream_req_headers,
    }
  }
  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '')
    return {
      error: errText || `error ${upstream.status}`,
      status: upstream.status,
      upstream_url: url,
      upstream_req_body,
      upstream_req_headers,
    }
  }
  hooks.onStart?.()
  const routing = { resolved_model: openaiBody.model }
  let text = ''
  let think = ''
  const toolAcc = []
  let usage = null
  let stopReason = 'stop'
  const finishTools = () =>
    toolAcc.filter(Boolean).map((tc) => {
      let args = tc.arguments
      try {
        args = typeof args === 'string' ? JSON.parse(args || '{}') : args || {}
      } catch {
        args = {}
      }
      return { id: tc.id, name: tc.name, arguments: args }
    })

  if (upstream_req_body.stream && upstream.body) {
    const feed = createSseParser((ev) => {
      if (ev && ev.usage) usage = ev.usage
      const ch = ev && ev.choices && ev.choices[0]
      if (!ch) return
      if (ch.finish_reason) stopReason = ch.finish_reason
      const d = ch.delta || {}
      if (d.content) {
        text += d.content
        hooks.onText?.(d.content, routing)
      }
      if (d.reasoning_content) {
        think += d.reasoning_content
        hooks.onThink?.(d.reasoning_content, routing)
      }
      if (Array.isArray(d.tool_calls)) {
        for (const tc of d.tool_calls) {
          const i = Number(tc.index) || 0
          if (!toolAcc[i]) toolAcc[i] = { id: tc.id || '', name: '', arguments: '' }
          if (tc.id) toolAcc[i].id = tc.id
          if (tc.function && tc.function.name) toolAcc[i].name = tc.function.name
          if (tc.function && tc.function.arguments) toolAcc[i].arguments += tc.function.arguments
        }
      }
    })
    const reader = upstream.body.getReader?.()
    if (reader) {
      const dec = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        feed(dec.decode(value, { stream: true }))
      }
      feed(dec.decode())
    } else {
      feed(await upstream.text().catch(() => ''))
    }
    return {
      text,
      think,
      toolCalls: finishTools(),
      usage,
      stopReason,
      routing,
      upstream_url: url,
      upstream_req_body,
      upstream_req_headers,
    }
  }

  const json = await upstream.json().catch(() => null)
  const msg = (json && json.choices && json.choices[0] && json.choices[0].message) || {}
  text = msg.content || ''
  think = msg.reasoning_content || ''
  usage = json && json.usage
  stopReason = (json && json.choices && json.choices[0] && json.choices[0].finish_reason) || 'stop'
  const tcs = Array.isArray(msg.tool_calls)
    ? msg.tool_calls.map((tc) => {
        let args = tc.function && tc.function.arguments
        try {
          args = typeof args === 'string' ? JSON.parse(args || '{}') : args || {}
        } catch {
          args = {}
        }
        return { id: tc.id, name: tc.function && tc.function.name, arguments: args }
      })
    : []
  if (hooks.onText && text) hooks.onText(text, routing)
  if (hooks.onThink && think) hooks.onThink(think, routing)
  return {
    text,
    think,
    toolCalls: tcs,
    usage,
    stopReason,
    routing,
    upstream_url: url,
    upstream_req_body,
    upstream_req_headers,
  }
}

/** Codex OAuth path (OpenAI oauth → chatgpt.com responses). */
export async function runCodexTurn(account, openaiBody, hooks = {}) {
  const oauth = account.oauth || {}
  const access = oauth.access_token || account.api_key
  const accountId = oauth.account_id
  if (!access) return { error: 'no openai oauth access_token', status: 401 }
  if (!accountId) return { error: 'no chatgpt account_id', status: 401 }
  const base = compatBase(account)
  const url = `${base}/backend-api/codex/responses`
  const upstream_req_body = chatToResponsesBody(openaiBody)
  const upstream_req_headers = {
    Authorization: `Bearer ${access}`,
    'chatgpt-account-id': accountId,
    'Content-Type': 'application/json',
    Accept: openaiBody.stream ? 'text/event-stream' : 'application/json',
    'OpenAI-Beta': 'responses=experimental',
    originator: 'codex_cli_rs',
  }
  let upstream
  try {
    upstream = await fetchUpstream(url, {
      method: 'POST',
      headers: upstream_req_headers,
      body: JSON.stringify(upstream_req_body),
      timeoutMs: 300000,
    })
  } catch (e) {
    return {
      error: e?.message || String(e),
      status: 502,
      upstream_url: url,
      upstream_req_body,
      upstream_req_headers,
    }
  }
  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '')
    return {
      error: errText || `error ${upstream.status}`,
      status: upstream.status,
      upstream_url: url,
      upstream_req_body,
      upstream_req_headers,
    }
  }
  hooks.onStart?.()
  const routing = { resolved_model: openaiBody.model }
  let text = ''
  let think = ''
  const toolAcc = []
  let usage = null
  const finishTools = () =>
    toolAcc.filter(Boolean).map((tc) => {
      let args = tc.arguments
      try {
        args = typeof args === 'string' ? JSON.parse(args || '{}') : args || {}
      } catch {
        args = {}
      }
      return { id: tc.id, name: tc.name, arguments: args }
    })
  const onEv = (ev) => {
    if (!ev || typeof ev !== 'object') return
    const t = ev.type
    if (t === 'response.output_text.delta' && ev.delta) {
      text += ev.delta
      hooks.onText?.(ev.delta, routing)
    }
    if ((t === 'response.reasoning_summary_text.delta' || t === 'response.reasoning_text.delta') && ev.delta) {
      think += ev.delta
      hooks.onThink?.(ev.delta, routing)
    }
    if (t === 'response.output_item.added' && ev.item && ev.item.type === 'function_call') {
      toolAcc.push({
        id: ev.item.call_id || ev.item.id,
        name: ev.item.name,
        arguments: ev.item.arguments || '',
      })
    }
    if (t === 'response.function_call_arguments.delta' && ev.delta) {
      const last = toolAcc[toolAcc.length - 1]
      if (last) last.arguments += ev.delta
    }
    if (t === 'response.completed' && ev.response && ev.response.usage) usage = ev.response.usage
  }
  if (upstream_req_body.stream && upstream.body) {
    const feed = createSseParser(onEv)
    const reader = upstream.body.getReader?.()
    if (reader) {
      const dec = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        feed(dec.decode(value, { stream: true }))
      }
      feed(dec.decode())
    } else {
      feed(await upstream.text().catch(() => ''))
    }
    return {
      text,
      think,
      toolCalls: finishTools(),
      usage,
      stopReason: toolAcc.length ? 'tool_calls' : 'stop',
      routing,
      upstream_url: url,
      upstream_req_body,
      upstream_req_headers,
    }
  }
  const json = await upstream.json().catch(() => null)
  usage = json && json.usage
  for (const item of (json && json.output) || []) {
    if (!item) continue
    if (item.type === 'reasoning') {
      const bits = (item.summary || []).map((s) => s && s.text).filter(Boolean)
      think += bits.join('')
    }
    if (item.type === 'function_call') {
      toolAcc.push({ id: item.call_id || item.id, name: item.name, arguments: item.arguments || '' })
    }
    if (item.type === 'message') {
      for (const c of item.content || []) {
        if (c && (c.type === 'output_text' || c.type === 'text') && c.text) text += c.text
      }
    }
  }
  if (hooks.onText && text) hooks.onText(text, routing)
  if (hooks.onThink && think) hooks.onThink(think, routing)
  return {
    text,
    think,
    toolCalls: finishTools(),
    usage,
    stopReason: toolAcc.length ? 'tool_calls' : 'stop',
    routing,
    upstream_url: url,
    upstream_req_body,
    upstream_req_headers,
  }
}

export async function runCompatTurn(disp, openaiBody, hooks) {
  const body = { ...openaiBody, model: disp.mapped }
  if (disp.account?.auth_type === 'oauth' && disp.platform === 'openai') {
    return runCodexTurn(disp.account, body, hooks)
  }
  return runOpenAICompatibleTurn(disp.account, body, hooks)
}

/* ── Protocol helpers (responses / completions) ── */

function contentPartsFromResponses(content) {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content)
  const parts = []
  for (const p of content) {
    if (typeof p === 'string') parts.push({ type: 'text', text: p })
    else if (!p || typeof p !== 'object') continue
    else if (p.type === 'input_text' || p.type === 'output_text' || p.type === 'text')
      parts.push({ type: 'text', text: p.text || '' })
    else if (p.type === 'input_image' || p.type === 'image_url') {
      const url =
        typeof p.image_url === 'string' ? p.image_url : (p.image_url && p.image_url.url) || p.url || ''
      if (url) parts.push({ type: 'image_url', image_url: { url } })
    }
  }
  if (!parts.length) return ''
  if (parts.every((x) => x.type === 'text')) return parts.map((x) => x.text).join('')
  return parts
}

export function responsesInputToMessages(body = {}) {
  const msgs = []
  if (body.instructions) msgs.push({ role: 'system', content: body.instructions })
  const input = body.input != null ? body.input : body.messages
  if (typeof input === 'string') {
    msgs.push({ role: 'user', content: input })
    return msgs
  }
  if (!Array.isArray(input)) return msgs
  for (const item of input) {
    if (typeof item === 'string') {
      msgs.push({ role: 'user', content: item })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const type = item.type
    if (type === 'function_call') {
      msgs.push({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: item.call_id || item.id,
            type: 'function',
            function: {
              name: item.name,
              arguments:
                typeof item.arguments === 'string'
                  ? item.arguments
                  : JSON.stringify(item.arguments || {}),
            },
          },
        ],
      })
      continue
    }
    if (type === 'function_call_output') {
      const out = item.output
      msgs.push({
        role: 'tool',
        tool_call_id: item.call_id || item.id,
        content: typeof out === 'string' ? out : JSON.stringify(out ?? ''),
      })
      continue
    }
    if (type === 'reasoning') continue
    msgs.push({ role: item.role || 'user', content: contentPartsFromResponses(item.content) })
  }
  return msgs
}

export function responsesToolsToChat(tools) {
  if (!Array.isArray(tools)) return undefined
  return tools
    .map((t) => {
      if (!t) return null
      if (t.type === 'function' && t.function) return t
      if (t.name || t.type === 'function') {
        return {
          type: 'function',
          function: {
            name: t.name || t.function?.name,
            description: t.description || t.function?.description || '',
            parameters: t.parameters || t.input_schema || { type: 'object', properties: {} },
          },
        }
      }
      return null
    })
    .filter(Boolean)
}

export function chatBodyFromResponses(body = {}) {
  return {
    model: body.model,
    messages: responsesInputToMessages(body),
    tools: responsesToolsToChat(body.tools),
    temperature: body.temperature,
    max_tokens: body.max_output_tokens || body.max_tokens,
    stream: body.stream === true,
    reasoning: body.reasoning,
    reasoning_effort: body.reasoning_effort || (body.reasoning && body.reasoning.effort),
  }
}

export function chatToResponsesBody(body = {}) {
  const messages = Array.isArray(body.messages) ? body.messages : []
  let instructions = ''
  const input = []
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue
    if (m.role === 'system' && !instructions) {
      instructions = typeof m.content === 'string' ? m.content : ''
      continue
    }
    if (m.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: m.tool_call_id,
        output: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
      })
      continue
    }
    if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
      for (const tc of m.tool_calls) {
        input.push({
          type: 'function_call',
          call_id: tc.id,
          name: tc.function?.name,
          arguments: tc.function?.arguments || '{}',
        })
      }
      continue
    }
    input.push({
      role: m.role || 'user',
      content:
        typeof m.content === 'string'
          ? [{ type: 'input_text', text: m.content }]
          : m.content || '',
    })
  }
  const out = {
    model: body.model,
    input,
    stream: body.stream === true,
  }
  if (instructions) out.instructions = instructions
  if (body.max_tokens || body.max_completion_tokens) {
    out.max_output_tokens = body.max_tokens || body.max_completion_tokens
  }
  if (body.tools) out.tools = body.tools
  return out
}

export function buildCompletionsUpstreamBody(body = {}) {
  const prompt = Array.isArray(body.prompt) ? body.prompt.join('') : body.prompt ?? ''
  const out = {
    prompt: typeof prompt === 'string' ? prompt : String(prompt ?? ''),
    max_tokens: body.max_tokens || body.max_completion_tokens || 128,
    temperature: body.temperature ?? 0,
    stream: body.stream === true,
  }
  if (body.suffix != null) out.suffix = body.suffix
  if (body.stop != null) out.stop = body.stop
  if (body.model) out.model = body.model
  if (body.language) out.language = body.language
  if (body.file_path || body.path) out.file_path = body.file_path || body.path
  if (body.extra_body && typeof body.extra_body === 'object') Object.assign(out, body.extra_body)
  return out
}

export function completionTextFromJson(json) {
  if (json == null) return ''
  if (typeof json === 'string') return json
  if (typeof json.text === 'string') return json.text
  if (typeof json.completion === 'string') return json.completion
  if (typeof json.content === 'string') return json.content
  if (Array.isArray(json.choices) && json.choices[0]) {
    const c = json.choices[0]
    if (typeof c.text === 'string') return c.text
    if (typeof c.message?.content === 'string') return c.message.content
  }
  const data = json.data
  if (data && typeof data === 'object') return completionTextFromJson(data)
  return ''
}

export function wrapCompletion({ id, model, text, finish, usage }) {
  const resp = {
    id,
    object: 'text_completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ text: text || '', index: 0, logprobs: null, finish_reason: finish || 'stop' }],
  }
  if (usage) resp.usage = usage
  return resp
}

export function makeCompletionChunk(id, model, text, finish) {
  return {
    id,
    object: 'text_completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ text: text || '', index: 0, logprobs: null, finish_reason: finish ?? null }],
  }
}

export function buildResponsesOutput({ text, think, toolCalls, ids }) {
  const out = []
  const id = (p, i) => (ids && ids[p]) || `${p}_${i || '1'}`
  if (think) {
    out.push({ type: 'reasoning', id: id('rs'), summary: [{ type: 'summary_text', text: think }] })
  }
  for (const tc of toolCalls || []) {
    out.push({
      type: 'function_call',
      id: tc.id,
      call_id: tc.id,
      name: tc.name,
      arguments:
        typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments || {}),
      status: 'completed',
    })
  }
  out.push({
    type: 'message',
    id: id('msg'),
    role: 'assistant',
    status: 'completed',
    content: text ? [{ type: 'output_text', text }] : [],
  })
  return out
}

export function wrapResponse({ id, model, output, usage, status }) {
  const resp = {
    id,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: status || 'completed',
    model,
    output: output || [],
  }
  if (usage) {
    resp.usage = {
      input_tokens: usage.prompt_tokens || usage.input_tokens || 0,
      output_tokens: usage.completion_tokens || usage.output_tokens || 0,
      total_tokens: usage.total_tokens || 0,
      input_tokens_details: { cached_tokens: usage.cache_tokens || 0 },
    }
  }
  return resp
}

export function createAilyCompat({ getAccounts }) {
  async function resolve(requested) {
    const accounts = typeof getAccounts === 'function' ? getAccounts() : []
    const catalogs = await catalogsForAccounts(accounts)
    return pickProviderRoute(requested, accounts, catalogs)
  }

  function matchSync(model) {
    const accounts = typeof getAccounts === 'function' ? getAccounts() : []
    // Use cached catalogs only (no network in sync match)
    const catalogs = { grok: new Set(), openai: new Set(), byId: {} }
    for (const a of accounts.filter((x) => x.enabled !== false && isCompatPlatform(x.platform))) {
      const cached = catalogCache.get(a.id)
      if (cached?.ids) {
        catalogs.byId[a.id] = cached.ids
        if (!catalogs[a.platform]) catalogs[a.platform] = new Set()
        for (const id of cached.ids) catalogs[a.platform].add(id)
      }
    }
    return modelMatchesCompat(model, accounts, catalogs)
  }

  async function testAccount(acc) {
    const started = Date.now()
    const cat = await loadCompatCatalog(acc, true, acc.platform)
    return {
      ok: true,
      models: (cat.list || []).length,
      sample: (cat.list || []).slice(0, 8).map((m) => m.id),
      latency_ms: Date.now() - started,
      platform: acc.platform,
    }
  }

  return {
    resolve,
    matchSync,
    runCompatTurn,
    loadCompatCatalog,
    catalogsForAccounts,
    testAccount,
    publicModelList,
    compatBase,
  }
}
