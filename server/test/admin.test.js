import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isAdminUser, loadAdminAllowlist, sanitizeConfig, maskSecretValue } from '../admin.js'

describe('admin allowlist + sanitize', () => {
  it('local role=admin is admin; linuxdo needs allowlist', () => {
    const al = loadAdminAllowlist({
      ADMIN_LINUXDO_IDS: '42',
      ADMIN_LINUXDO_USERNAMES: 'boss',
      ADMIN_LOCAL_USERNAMES: 'rootish',
    })
    assert.equal(
      isAdminUser({ auth_provider: 'local', role: 'admin', username: 'x' }, al),
      true,
    )
    assert.equal(
      isAdminUser({ auth_provider: 'local', role: 'user', username: 'rootish' }, al),
      true,
    )
    assert.equal(
      isAdminUser({ auth_provider: 'local', role: 'user', username: 'nope' }, al),
      false,
    )
    assert.equal(
      isAdminUser({ auth_provider: 'linuxdo', id: 42, username: 'u' }, al),
      true,
    )
    assert.equal(
      isAdminUser({ auth_provider: 'linuxdo', id: 99, username: 'boss' }, al),
      true,
    )
    assert.equal(
      isAdminUser({ auth_provider: 'linuxdo', id: 99, username: 'pleb' }, al),
      false,
    )
  })

  it('sanitizeConfig masks secrets', () => {
    const out = sanitizeConfig({
      public_url: 'https://x',
      management_key: 'abcdefghijklmnop',
      nested: { api_token: 'tokentokentoken' },
    })
    assert.equal(out.public_url, 'https://x')
    assert.match(out.management_key, /\*\*\*\*/)
    assert.match(out.nested.api_token, /\*\*\*\*/)
    assert.equal(maskSecretValue(''), '')
  })
})
