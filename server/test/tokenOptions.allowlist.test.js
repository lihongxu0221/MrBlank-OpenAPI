/**
 * Contract: console「已接入模型」(Overview count + ModelsPage /models)
 * is fed by GET /api/token/options, which must apply groupStore.filterModels
 * with the same empty=all / non-empty=allowlist rules as /v1/models (v1Proxy)
 * and plaza merge.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createGroupStore } from '../groups.js'

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-opts-'))
  const store = createGroupStore(path.join(dir, 'groups.json'))
  return { dir, store }
}

/** Mirrors server/index.js GET /api/token/options post-merge filter step. */
function plazaFilterModels(store, merged, group) {
  return store.filterModels(merged, group)
}

describe('token/options allowlist (= console 已接入模型 / 模型广场)', () => {
  it('empty model_ids keeps full merged catalog', () => {
    const { dir, store } = tmpStore()
    const group = { model_ids: [] }
    const merged = [
      { id: 'grok-4.7' },
      { id: 'aily/glm-5.3' },
      { id: 'claude-sonnet-4-6' },
    ]
    const out = plazaFilterModels(store, merged, group)
    assert.deepEqual(
      out.map((m) => m.id),
      ['grok-4.7', 'aily/glm-5.3', 'claude-sonnet-4-6'],
    )
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('non-empty model_ids returns only allowlisted ids (CPA + aily/)', () => {
    const { dir, store } = tmpStore()
    store.saveGroups([
      {
        id: 'newcomer',
        name: '新人',
        level: 1,
        quotas: { window_5h: 1e9, week: 1e9, month: 1e9 },
        model_ids: ['aily/glm-5.3', 'gemini-3.8-flash-high'],
        promotion: { min_account_days: 0, min_request_count: 0, min_used_quota: 0, min_checkins: 0 },
        enabled: true,
      },
    ])
    const uid = 'local:newcomer-user'
    store.assignMember(uid, { group_id: 'newcomer', override: true })
    const group = store.resolveUserGroup(uid, {}).group
    const merged = [
      { id: 'grok-4.7' },
      { id: 'gemini-3.8-flash-high' },
      { id: 'aily/glm-5.3' },
      { id: 'aily/auto-fast' },
      { id: 'claude-sonnet-4-6' },
    ]
    const out = plazaFilterModels(store, merged, group)
    assert.deepEqual(
      out.map((m) => m.id).sort(),
      ['aily/glm-5.3', 'gemini-3.8-flash-high'],
    )
    // Same helper as v1Proxy filterModelsResponseBody for OpenAI list shape
    const body = JSON.stringify({ object: 'list', data: merged.map((m) => ({ id: m.id, object: 'model' })) })
    const filteredBody = JSON.parse(store.filterModelsResponseBody(body, group))
    assert.deepEqual(
      filteredBody.data.map((m) => m.id).sort(),
      ['aily/glm-5.3', 'gemini-3.8-flash-high'],
    )
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('uses authenticated user group via membership (canonical id)', () => {
    const { dir, store } = tmpStore()
    store.saveGroups([
      {
        id: 'basic',
        name: '基本',
        level: 2,
        quotas: { window_5h: 1e9, week: 1e9, month: 1e9 },
        model_ids: ['gpt-oss-120b-medium'],
        promotion: { min_account_days: 0, min_request_count: 0, min_used_quota: 0, min_checkins: 0 },
        enabled: true,
      },
      {
        id: 'leader',
        name: '老',
        level: 5,
        quotas: { window_5h: 1e9, week: 1e9, month: 1e9 },
        model_ids: ['grok-4.7', 'gpt-oss-120b-medium'],
        promotion: { min_account_days: 0, min_request_count: 0, min_used_quota: 0, min_checkins: 0 },
        enabled: true,
      },
    ])
    const uid = 'local:canon'
    store.assignMember(uid, { group_id: 'basic', override: true, merge_from: ['canon'] })
    const group = store.resolveUserGroup(uid, {}, { aliasKeys: ['canon'] }).group
    assert.equal(group.id, 'basic')
    const merged = [{ id: 'grok-4.7' }, { id: 'gpt-oss-120b-medium' }, { id: 'claude-sonnet-4-6' }]
    assert.deepEqual(
      plazaFilterModels(store, merged, group).map((m) => m.id),
      ['gpt-oss-120b-medium'],
    )
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
