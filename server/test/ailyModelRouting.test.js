import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  normalizeModelRouting,
  publicModelList,
  syncModelWhitelist,
  applyModelRouting,
  createAilyModelRoutingStore,
} from '../ailyModelRouting.js'

describe('ailyModelRouting', () => {
  it('empty whitelist+mappings = no restriction', () => {
    const catalog = [{ id: 'auto' }, { id: 'glm' }]
    const r = normalizeModelRouting({})
    assert.deepEqual(r, { whitelist: [], mappings: [] })
    assert.deepEqual(
      publicModelList(catalog, r).map((m) => m.id),
      ['auto', 'glm'],
    )
  })

  it('whitelist filters public list; mappings expose from-side', () => {
    const catalog = [{ id: 'auto' }, { id: 'glm' }]
    const r = normalizeModelRouting({
      whitelist: ['glm'],
      mappings: [{ from: 'gpt-x', to: 'glm' }],
    })
    assert.deepEqual(
      publicModelList(catalog, r).map((m) => m.id).sort(),
      ['glm', 'gpt-x'].sort(),
    )
  })

  it('sync latest/upstream/clear', () => {
    const catalog = [{ id: 'auto' }, { id: 'glm' }, { id: 'aily-auto' }]
    assert.ok(syncModelWhitelist(catalog, 'latest').includes('aily-auto'))
    assert.ok(!syncModelWhitelist(catalog, 'upstream').includes('aily-auto'))
    assert.deepEqual(syncModelWhitelist(catalog, 'clear'), [])
  })

  it('applyModelRouting maps and gates', () => {
    const index = { presets: new Set(['auto']), models: new Set(['glm']) }
    const resolve = (m) => ({ requested: m, presetId: m === 'auto' ? 'auto' : undefined, selectModel: m === 'glm' ? 'glm' : undefined })
    const r = { whitelist: ['gpt-x'], mappings: [{ from: 'gpt-x', to: 'glm' }] }
    const ok = applyModelRouting('gpt-x', index, r, resolve)
    assert.equal(ok.allowed, true)
    assert.equal(ok.mapped, 'glm')
    const denied = applyModelRouting('other', index, r, resolve)
    assert.equal(denied.allowed, false)
  })

  it('store persists', () => {
    const file = path.join(os.tmpdir(), `aily-routing-${process.pid}.json`)
    try {
      fs.rmSync(file, { force: true })
      const store = createAilyModelRoutingStore(file)
      store.update({ whitelist: ['a'], mappings: [{ from: 'b', to: 'a' }] })
      const store2 = createAilyModelRoutingStore(file)
      assert.deepEqual(store2.get().whitelist, ['a'])
      assert.equal(store2.get().mappings[0].from, 'b')
    } finally {
      fs.rmSync(file, { force: true })
    }
  })
})
