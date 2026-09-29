import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mergeOpenAiModelData,
  mergeAilyIntoModelsBody,
  collectAilyPublicModelRows,
  enrichModelsBodyWithAily,
} from '../mergedV1Models.js'

test('mergeOpenAiModelData keeps CPA ids and appends aily/*', () => {
  const merged = mergeOpenAiModelData(
    [{ id: 'grok-4.7', owned_by: 'cpa' }, { id: 'claude-sonnet-4-6' }],
    [{ id: 'aily/glm-5.3', owned_by: 'aily' }, { id: 'grok-4.7', owned_by: 'aily' }],
  )
  const ids = merged.map((m) => m.id)
  assert.deepEqual(ids, ['grok-4.7', 'claude-sonnet-4-6', 'aily/glm-5.3'])
  assert.equal(merged[0].owned_by, 'cpa')
})

test('mergeAilyIntoModelsBody enriches OpenAI list JSON', () => {
  const body = JSON.stringify({
    object: 'list',
    data: [{ id: 'gpt-oss-120b-medium', object: 'model' }],
  })
  const out = JSON.parse(
    mergeAilyIntoModelsBody(body, [{ id: 'aily/glm-5.3', object: 'model', owned_by: 'aily' }]),
  )
  assert.equal(out.object, 'list')
  assert.deepEqual(
    out.data.map((m) => m.id),
    ['gpt-oss-120b-medium', 'aily/glm-5.3'],
  )
})

test('collectAilyPublicModelRows returns [] when aily routing disabled', async () => {
  const rows = await collectAilyPublicModelRows({
    getRouting: () => ({ whitelist: [], mappings: [] }),
    getEnvRoutes: () => [],
    listAilyModels: async () => {
      throw new Error('should not call')
    },
  })
  assert.deepEqual(rows, [])
})

test('collectAilyPublicModelRows emits aily/ ids from whitelist + catalog', async () => {
  const rows = await collectAilyPublicModelRows({
    getRouting: () => ({ whitelist: ['glm-5.3', 'kimi-k2.5'], mappings: [] }),
    getEnvRoutes: () => [],
    listAilyModels: async () => ({
      ok: true,
      data: [
        { id: 'glm-5.3', name: 'GLM 5.3' },
        { id: 'kimi-k2.5', name: 'Kimi' },
        { id: 'other', name: 'Other' },
      ],
    }),
  })
  const ids = rows.map((r) => r.id).sort()
  assert.deepEqual(ids, ['aily/glm-5.3', 'aily/kimi-k2.5'])
  assert.ok(rows.every((r) => r.owned_by === 'aily'))
})

test('enrichModelsBodyWithAily no-ops when disabled', async () => {
  const body = JSON.stringify({ object: 'list', data: [{ id: 'grok-4.7' }] })
  const out = await enrichModelsBodyWithAily(body, {
    getRouting: () => ({ whitelist: [], mappings: [] }),
    getEnvRoutes: () => [],
    listAilyModels: async () => ({ data: [] }),
  })
  assert.equal(out, body)
})

test('enrichModelsBodyWithAily merges into CPA body when enabled', async () => {
  const body = JSON.stringify({
    object: 'list',
    data: [{ id: 'grok-4.7' }, { id: 'gemini-3.8-flash-high' }],
  })
  const out = JSON.parse(
    await enrichModelsBodyWithAily(body, {
      getRouting: () => ({ whitelist: ['glm-5.3'], mappings: [] }),
      getEnvRoutes: () => [],
      listAilyModels: async () => ({ data: [{ id: 'glm-5.3' }] }),
    }),
  )
  assert.deepEqual(
    out.data.map((m) => m.id),
    ['grok-4.7', 'gemini-3.8-flash-high', 'aily/glm-5.3'],
  )
})

test('enrichModelsBodyWithAily returns aily-only when CPA body is an error', async () => {
  const body = JSON.stringify({ error: { message: 'upstream down' } })
  const out = JSON.parse(
    await enrichModelsBodyWithAily(body, {
      getRouting: () => ({ whitelist: ['glm-5.3'], mappings: [] }),
      getEnvRoutes: () => [],
      listAilyModels: async () => ({ data: [{ id: 'glm-5.3' }] }),
    }),
  )
  assert.deepEqual(
    out.data.map((m) => m.id),
    ['aily/glm-5.3'],
  )
})
