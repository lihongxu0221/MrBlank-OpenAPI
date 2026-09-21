import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mapCatalogToModels, catalogIndex } from '../ailyUpstream.js'

describe('ailyUpstream catalog helpers', () => {
  it('maps presets and aliases', () => {
    const payload = {
      data: {
        model_presets: {
          auto: { display_name: 'Auto', model: 'x', aliases: ['aily-auto'] },
          'auto-fast': { display_name: 'Fast' },
        },
        models: { 'glm-5.3': { display_name: 'GLM' } },
      },
    }
    const list = mapCatalogToModels(payload)
    const ids = list.map((m) => m.id)
    assert.ok(ids.includes('auto'))
    assert.ok(ids.includes('aily-auto'))
    assert.ok(ids.includes('aily-fast'))
    assert.ok(ids.includes('glm-5.3'))
    const idx = catalogIndex(payload)
    assert.ok(idx.presets.has('auto'))
    assert.ok(idx.models.has('glm-5.3'))
  })
})
