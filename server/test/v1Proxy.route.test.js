import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { selectUpstreamRoute } from '../v1Proxy.js'
import { modelMatchesAilyRoute } from '../aily.js'

describe('v1Proxy route selection (cpa vs aily embedded)', () => {
  const match = (model) => modelMatchesAilyRoute(model, ['aily-*', 'special-model'])

  it('defaults to CPA', () => {
    const r = selectUpstreamRoute({
      requestedModel: 'gpt-4o',
      cpaBase: 'http://cpa:8320',
      match,
      embedded: true,
    })
    assert.equal(r.routeVia, 'cpa')
    assert.equal(r.upstreamBase, 'http://cpa:8320')
    assert.equal(r.authOverride, null)
  })

  it('routes matching models to embedded Aily (no :8088 required)', () => {
    const r = selectUpstreamRoute({
      requestedModel: 'aily-chat',
      cpaBase: 'http://cpa:8320/',
      match,
      embedded: true,
    })
    assert.equal(r.routeVia, 'aily')
    assert.equal(r.mode, 'embedded')
    assert.equal(r.upstreamBase, '')
    assert.equal(r.authOverride, null)
  })

  it('legacy mode still needs base+key when embedded=false', () => {
    const r = selectUpstreamRoute({
      requestedModel: 'aily-chat',
      cpaBase: 'http://cpa:8320',
      ailyBase: 'http://aily:8088',
      ailyApiKey: '',
      match,
      embedded: false,
    })
    assert.equal(r.routeVia, 'cpa')
  })

  it('legacy mode routes to adapter when base+key present', () => {
    const r = selectUpstreamRoute({
      requestedModel: 'aily-chat',
      cpaBase: 'http://cpa:8320',
      ailyBase: 'http://aily:8088/',
      ailyApiKey: 'secret-key',
      match,
      embedded: false,
    })
    assert.equal(r.routeVia, 'aily')
    assert.equal(r.mode, 'legacy')
    assert.equal(r.upstreamBase, 'http://aily:8088')
    assert.equal(r.authOverride, 'secret-key')
  })

  it('modelMatchesAilyRoute supports exact and prefix*', () => {
    assert.equal(modelMatchesAilyRoute('special-model', ['special-model']), true)
    assert.equal(modelMatchesAilyRoute('aily-foo', ['aily-*']), true)
    assert.equal(modelMatchesAilyRoute('other', ['aily-*']), false)
    assert.equal(modelMatchesAilyRoute('', ['aily-*']), false)
  })
})
