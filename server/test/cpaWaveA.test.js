import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CPA_SETTING_FIELDS,
  CPA_PROVIDER_KEY_TYPES,
  CPA_OAUTH_AUTH_URLS,
  matchMaskedProviderKey,
  maskKey,
} from '../cpa.js'

describe('Wave A CPA constants', () => {
  it('includes core settings + request-log', () => {
    for (const f of [
      'debug',
      'proxy-url',
      'logging-to-file',
      'request-log',
      'ws-auth',
      'force-model-prefix',
      'usage-statistics-enabled',
      'logs-max-total-size-mb',
    ]) {
      assert.ok(CPA_SETTING_FIELDS.includes(f), f)
    }
  })

  it('lists six provider key types', () => {
    assert.equal(CPA_PROVIDER_KEY_TYPES.length, 6)
    assert.ok(CPA_PROVIDER_KEY_TYPES.includes('gemini-api-key'))
  })

  it('oauth auth urls include primary providers', () => {
    for (const p of ['anthropic-auth-url', 'codex-auth-url', 'xai-auth-url']) {
      assert.ok(CPA_OAUTH_AUTH_URLS.includes(p), p)
    }
  })

  it('matchMaskedProviderKey resolves maskKey form', () => {
    const raw = [{ 'api-key': 'abcdefghijklmnop' }]
    const masked = maskKey('abcdefghijklmnop')
    assert.equal(matchMaskedProviderKey(raw, masked), 'abcdefghijklmnop')
  })
})
