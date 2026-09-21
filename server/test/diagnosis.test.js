import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  redactHeaders,
  maskTokenNameFromAuth,
  extractModelFromReqBody,
  extractUsageFromBody,
} from '../diagnosis.js'

describe('diagnosis redaction helpers', () => {
  it('redacts Authorization and api-key headers', () => {
    const out = redactHeaders({
      Authorization: 'Bearer sk-abcdefghijklmnopqrstuvwxyz',
      'Content-Type': 'application/json',
      'x-api-key': 'short',
      Cookie: 'session=abc123def456ghi789',
    })
    assert.match(out.Authorization, /…/)
    assert.equal(out['Content-Type'], 'application/json')
    assert.equal(out['x-api-key'], '***')
    assert.match(out.Cookie, /…/)
  })

  it('maskTokenNameFromAuth masks bearer tokens', () => {
    assert.equal(maskTokenNameFromAuth('Bearer short'), '***')
    assert.match(maskTokenNameFromAuth('Bearer sk-1234567890abcdef'), /…/)
    assert.equal(maskTokenNameFromAuth(''), '')
  })

  it('extractModelFromReqBody and usage', () => {
    assert.equal(extractModelFromReqBody('{"model":"gpt-4o"}'), 'gpt-4o')
    assert.equal(extractModelFromReqBody('not-json'), '')
    const usage = extractUsageFromBody(
      JSON.stringify({
        model: 'm1',
        usage: { prompt_tokens: 3, completion_tokens: 7 },
      }),
    )
    assert.equal(usage.prompt_tokens, 3)
    assert.equal(usage.completion_tokens, 7)
    assert.equal(usage.model_name, 'm1')
  })
})
