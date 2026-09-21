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
  toPublicAilyId,
  stripAilyPrefix,
  isAilyPrefixed,
  resolveMappedModel,
  exposedIncludes,
} from '../ailyModelRouting.js'

describe('ailyModelRouting', () => {
  it('empty whitelist+mappings = no restriction; public ids prefixed', () => {
    const catalog = [{ id: 'auto' }, { id: 'glm' }]
    const r = normalizeModelRouting({})
    assert.deepEqual(r, { whitelist: [], mappings: [] })
    assert.deepEqual(
      publicModelList(catalog, r).map((m) => m.id),
      ['aily/auto', 'aily/glm'],
    )
  })

  it('whitelist filters public list; mappings expose from-side as aily/', () => {
    const catalog = [{ id: 'auto' }, { id: 'glm' }]
    const r = normalizeModelRouting({
      whitelist: ['glm'],
      mappings: [{ from: 'gpt-x', to: 'glm' }],
    })
    assert.deepEqual(
      publicModelList(catalog, r).map((m) => m.id).sort(),
      ['aily/glm', 'aily/gpt-x'].sort(),
    )
  })

  it('prefix helpers', () => {
    assert.equal(isAilyPrefixed('aily/glm-5.3'), true)
    assert.equal(isAilyPrefixed('glm-5.3'), false)
    assert.equal(stripAilyPrefix('aily/glm-5.3'), 'glm-5.3')
    assert.equal(toPublicAilyId('glm-5.3'), 'aily/glm-5.3')
    assert.equal(toPublicAilyId('aily/glm-5.3'), 'aily/glm-5.3')
  })

  it('resolveMappedModel accepts aily/ or bare from', () => {
    const r = {
      whitelist: [],
      mappings: [{ from: 'glm-5.3', to: 'glm-5.3-upstream' }],
    }
    assert.equal(resolveMappedModel('aily/glm-5.3', r), 'glm-5.3-upstream')
    assert.equal(resolveMappedModel('glm-5.3', r), 'glm-5.3-upstream')
    assert.equal(resolveMappedModel('aily/other', r), 'other')
  })

  it('exposedIncludes matches bare and prefixed', () => {
    const r = { whitelist: ['glm-5.3'], mappings: [] }
    assert.equal(exposedIncludes(r, 'aily/glm-5.3'), true)
    assert.equal(exposedIncludes(r, 'glm-5.3'), true)
    assert.equal(exposedIncludes(r, 'other'), false)
  })

  it('sync latest/upstream/clear', () => {
    const catalog = [{ id: 'auto' }, { id: 'glm' }, { id: 'aily-auto' }]
    assert.ok(syncModelWhitelist(catalog, 'latest').includes('aily-auto'))
    assert.ok(!syncModelWhitelist(catalog, 'upstream').includes('aily-auto'))
    assert.deepEqual(syncModelWhitelist(catalog, 'clear'), [])
  })

  it('applyModelRouting maps aily/ prefix and gates', () => {
    const index = { presets: new Set(['auto']), models: new Set(['glm']) }
    const resolve = (m) => ({
      requested: m,
      presetId: m === 'auto' ? 'auto' : undefined,
      selectModel: m === 'glm' ? 'glm' : undefined,
    })
    const r = { whitelist: ['gpt-x'], mappings: [{ from: 'gpt-x', to: 'glm' }] }
    const ok = applyModelRouting('gpt-x', index, r, resolve)
    assert.equal(ok.allowed, true)
    assert.equal(ok.mapped, 'glm')
    const viaPrefix = applyModelRouting('aily/gpt-x', index, r, resolve)
    assert.equal(viaPrefix.allowed, true)
    assert.equal(viaPrefix.mapped, 'glm')
    const denied = applyModelRouting('other', index, r, resolve)
    assert.equal(denied.allowed, false)
  })

  it('store persists bare ids (strips aily/ on save)', () => {
    const file = path.join(os.tmpdir(), `aily-routing-${process.pid}.json`)
    try {
      fs.rmSync(file, { force: true })
      const store = createAilyModelRoutingStore(file)
      store.update({ whitelist: ['aily/a'], mappings: [{ from: 'aily/b', to: 'aily/a' }] })
      const store2 = createAilyModelRoutingStore(file)
      assert.deepEqual(store2.get().whitelist, ['a'])
      assert.equal(store2.get().mappings[0].from, 'b')
      assert.equal(store2.get().mappings[0].to, 'a')
    } finally {
      fs.rmSync(file, { force: true })
    }
  })
})
