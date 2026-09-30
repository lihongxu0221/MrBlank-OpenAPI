import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createSiteUsageStore,
  classifyDashboardEvent,
  dashboardModelName,
  isModelsListEndpoint,
} from '../siteUsage.js'

function mkStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-top-'))
  const store = createSiteUsageStore(path.join(dir, 'u.json'), { maxEvents: 1000, maxAgeMs: 86400000 * 30 })
  return { dir, store }
}

test('helpers: models endpoint, display name, classification', () => {
  assert.equal(isModelsListEndpoint('/v1/models'), true)
  assert.equal(isModelsListEndpoint('/v1/models?key=x'), true)
  assert.equal(isModelsListEndpoint('/v1/models/gpt-x'), true)
  assert.equal(isModelsListEndpoint('/v1/chat/completions'), false)
  assert.equal(dashboardModelName({ model: 'gemini-3.8-flash', model_requested: 'gemini-3.8-flash-high' }), 'gemini-3.8-flash-high')
  assert.equal(dashboardModelName({ model: 'glm-5.3' }), 'glm-5.3')
  assert.equal(dashboardModelName({}), '')
  assert.equal(classifyDashboardEvent({ status: 401, success: false }), 'rejected_unauth')
  assert.equal(classifyDashboardEvent({ status: 404, success: false, model: 'x' }), 'rejected_unauth')
  assert.equal(classifyDashboardEvent({ status: 401, success: false, userId: 'local:u' }), 'normal')
  assert.equal(classifyDashboardEvent({ status: 204, success: true }), 'preflight')
  assert.equal(classifyDashboardEvent({ method: 'OPTIONS', status: 204 }), 'preflight')
  assert.equal(classifyDashboardEvent({ status: 200, success: true }), 'normal')
})

test('recordEvent drops OPTIONS preflights', () => {
  const { dir, store } = mkStore()
  assert.equal(store.recordEvent({ method: 'OPTIONS', status: 204, endpoint: '/v1/chat/completions' }), null)
  assert.ok(store.recordEvent({ method: 'POST', status: 200, model: 'm', success: true, tokens: 1 }))
  store.flush()
  assert.equal(store.summarize({ period: 'all' }).total_requests, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('Top models: only successful model calls with tokens; probes/rejects/list calls excluded', () => {
  const { dir, store } = mkStore()
  const now = Date.now()
  const at = (m) => new Date(now - m * 60000).toISOString()
  const rec = (m, e) => store.recordEvent({ ts: at(m), endpoint: '/v1/chat/completions', ...e })
  // Mirrors today's live audit/smoke traffic
  rec(60, { model: 'x', status: 401, success: false, token_name: 'sk-inval…-000' })
  rec(60, { model: 'x', status: 404, success: false, endpoint: '/v1/nonexistent-xyz' })
  rec(59, { model: 'gpt-x-probe', status: 401, success: false })
  rec(59, { model: 'aily/auto-fast', status: 404, success: false, endpoint: '/v1/embeddings' })
  rec(58, { model: 'gpt-4o-mini', status: 401, success: false })
  rec(58, { model: 'claude-opus-4-1', status: 401, success: false })
  rec(57, { status: 204, success: true }) // legacy preflight row
  rec(56, { status: 200, success: true, endpoint: '/v1/models' }) // anonymous list
  rec(56, { status: 200, success: true, endpoint: '/v1/models', userId: 'local:u2' })
  rec(56, { status: 401, success: false, endpoint: '/v1/models' })
  // Real model calls (upstream answers the base name for the -high alias)
  rec(55, { model: 'gemini-3.8-flash', model_requested: 'gemini-3.8-flash-high', status: 200, success: true, tokens: 110, userId: 'local:u2' })
  rec(54, { model: 'gemini-3.8-flash', model_requested: 'gemini-3.8-flash-high', status: 200, success: true, tokens: 55, userId: 'local:u2' })
  rec(53, { model: 'gemini-3.8-flash', model_requested: 'gemini-3.8-flash-high', status: 502, success: false, tokens: 0, userId: 'local:u2' })
  rec(52, { model: 'glm-5.3', model_requested: 'aily/auto-max', status: 200, success: true, tokens: 0, userId: 'local:u2' }) // 0 tokens
  rec(51, { model: 'grok-4.7', status: 429, success: false, userId: 'local:u2' }) // authenticated failure only
  store.flush()

  const dash = store.dashboardSummary({ todayStartMs: now - 24 * 3600000 })
  const names = dash.top_models_by_tokens.map((m) => m.model)
  assert.deepEqual(names, ['gemini-3.8-flash-high'])
  assert.deepEqual(dash.top_models_by_calls.map((m) => m.model), ['gemini-3.8-flash-high'])
  const g = dash.top_models_by_tokens[0]
  assert.equal(g.calls, 2)
  assert.equal(g.tokens, 165)
  assert.equal(g.failures, 1)
  assert.ok(!names.includes('unknown'))
  // Authenticated failures reported separately
  const fails = Object.fromEntries(dash.model_failures_authenticated.map((r) => [r.model, r.failures]))
  assert.deepEqual(fails, { 'gemini-3.8-flash-high': 1, 'grok-4.7': 1 })
  // Headline: OPTIONS + unauthenticated rejects excluded, reported separately
  assert.equal(dash.today.preflight, 1)
  assert.equal(dash.today.rejected_unauthenticated, 7)
  assert.equal(dash.today.requests, 7)
  assert.equal(dash.today.success, 5)
  assert.equal(dash.today.failure, 2)
  assert.equal(dash.today.tokens, 165)
  fs.rmSync(dir, { recursive: true, force: true })
})
