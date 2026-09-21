import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createAilyAccountsStore } from '../ailyAccounts.js'
import { pickProviderRoute, modelMatchesCompat } from '../ailyCompat.js'
import { exposedModelNames } from '../ailyModelRouting.js'

describe('ailyAccounts + pickProviderRoute', () => {
  let file
  let store

  before(() => {
    file = path.join(os.tmpdir(), `aily-accounts-${process.pid}.json`)
    try {
      fs.unlinkSync(file)
    } catch {
      /* ignore */
    }
    store = createAilyAccountsStore(file)
  })

  after(() => {
    try {
      fs.unlinkSync(file)
    } catch {
      /* ignore */
    }
  })

  it('CRUD grok account with whitelist', () => {
    const row = store.create({
      platform: 'grok',
      name: 'Grok1',
      api_key: 'xai-test-key-12345678',
      model_routing: { whitelist: ['grok-3'], mappings: [] },
    })
    assert.equal(row.platform, 'grok')
    assert.equal(row.has_key, true)
    assert.ok(store.listPublic().some((x) => x.id === row.id))

    const disp = pickProviderRoute('grok-3', store.loadAccounts(), {})
    assert.equal(disp.allowed, true)
    assert.equal(disp.platform, 'grok')
    assert.equal(disp.reason, 'white')

    assert.equal(modelMatchesCompat('grok-3', store.loadAccounts()), true)
    assert.equal(modelMatchesCompat('gpt-4o', store.loadAccounts()), false)

    store.remove(row.id)
    assert.equal(store.get(row.id), null)
  })

  it('mapping takes priority', () => {
    const row = store.create({
      platform: 'openai',
      api_key: 'sk-test-abcdefgh',
      model_routing: {
        whitelist: ['gpt-4o'],
        mappings: [{ from: 'alias-4o', to: 'gpt-4o' }],
      },
    })
    const disp = pickProviderRoute('alias-4o', store.loadAccounts(), {})
    assert.equal(disp.allowed, true)
    assert.equal(disp.mapped, 'gpt-4o')
    assert.equal(disp.reason, 'map')
    store.remove(row.id)
  })

  it('exposedModelNames drives plaza + route', () => {
    const names = exposedModelNames({
      whitelist: [],
      mappings: [
        { from: 'glm-5.3', to: 'glm-5.3' },
        { from: 'auto-max', to: 'auto-max' },
      ],
    })
    assert.deepEqual(names, ['glm-5.3', 'auto-max'])
  })
})
