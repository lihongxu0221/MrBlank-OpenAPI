import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createHonorModelSseTransformer,
  honorModelName,
  honorRequestedModelInBody,
  isUpstreamVariantOfRequested,
} from '../honorRequestedModel.js'

describe('isUpstreamVariantOfRequested', () => {
  it('detects grok-4.7 → grok-4.7-build', () => {
    assert.equal(isUpstreamVariantOfRequested('grok-4.7', 'grok-4.7-build'), true)
    assert.equal(isUpstreamVariantOfRequested('grok-4.7', 'grok-4.7-build-fast'), true)
  })

  it('does not treat shorter ids as prefixes (grok-4 vs grok-4.7)', () => {
    assert.equal(isUpstreamVariantOfRequested('grok-4', 'grok-4.7'), false)
    assert.equal(isUpstreamVariantOfRequested('grok-4', 'grok-4.7-build'), false)
  })

  it('does not rewrite when user explicitly asked for build/fast', () => {
    assert.equal(isUpstreamVariantOfRequested('grok-4.7-build', 'grok-4.7-build'), false)
    assert.equal(isUpstreamVariantOfRequested('grok-4.7-build-fast', 'grok-4.7-build-fast'), false)
    assert.equal(isUpstreamVariantOfRequested('grok-4.7-build', 'grok-4.7-build-extra'), false)
  })

  it('requires exact requested base before separator', () => {
    assert.equal(isUpstreamVariantOfRequested('grok-4.7', 'grok-4.70'), false)
    assert.equal(isUpstreamVariantOfRequested('grok-4.7', 'other-grok-4.7-build'), false)
  })
})

describe('honorRequestedModelInBody', () => {
  it('rewrites non-stream chat.completion model', () => {
    const body = JSON.stringify({
      id: 'x',
      object: 'chat.completion',
      model: 'grok-4.7-build',
      choices: [{ message: { role: 'assistant', content: 'OK' } }],
    })
    const { text, changed } = honorRequestedModelInBody(body, 'grok-4.7')
    assert.equal(changed, true)
    const parsed = JSON.parse(text)
    assert.equal(parsed.model, 'grok-4.7')
    assert.equal(parsed.choices[0].message.content, 'OK')
  })

  it('rewrites SSE response.created model fields', () => {
    const sse = [
      'event: response.created',
      'data: {"type":"response.created","response":{"model":"grok-4.7-build","id":"1"}}',
      '',
      'data: {"type":"response.completed","response":{"model":"grok-4.7-build","id":"1"},"model":"grok-4.7-build"}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    const { text, changed } = honorRequestedModelInBody(sse, 'grok-4.7')
    assert.equal(changed, true)
    assert.match(text, /"model":"grok-4\.7"/)
    assert.doesNotMatch(text, /grok-4\.7-build/)
  })

  it('leaves explicitly requested build-fast alone', () => {
    const body = JSON.stringify({ model: 'grok-4.7-build-fast', choices: [] })
    const { text, changed } = honorRequestedModelInBody(body, 'grok-4.7-build-fast')
    assert.equal(changed, false)
    assert.equal(JSON.parse(text).model, 'grok-4.7-build-fast')
  })
})

describe('honorModelName + SSE transformer', () => {
  it('honorModelName prefers requested for variants', () => {
    assert.equal(honorModelName('grok-4.7-build', 'grok-4.7'), 'grok-4.7')
    assert.equal(honorModelName('grok-4.7-build-fast', 'grok-4.7-build-fast'), 'grok-4.7-build-fast')
    assert.equal(honorModelName('gpt-4o', 'grok-4.7'), 'gpt-4o')
  })

  it('SSE transformer rewrites across chunk boundaries', () => {
    const t = createHonorModelSseTransformer('grok-4.7')
    const a = t.push('data: {"model":"grok-4.7-bu')
    assert.equal(a, '') // incomplete line held
    const b = t.push('ild","id":"1"}\n')
    assert.match(b, /"model":"grok-4\.7"/)
    assert.doesNotMatch(b, /build/)
    assert.equal(t.flush(), '')
  })
})
