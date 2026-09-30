import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isAdminUser, loadAdminAllowlist, sanitizeConfig, maskSecretValue } from '../admin.js'

describe('admin allowlist + sanitize', () => {
  it('local admin only via role; linuxdo only via numeric id or oauth email', () => {
    const al = loadAdminAllowlist({
      ADMIN_LINUXDO_IDS: '42',
      ADMIN_LINUXDO_USERNAMES: 'boss',
      ADMIN_LINUXDO_EMAILS: 'owner@example.com',
      ADMIN_LOCAL_USERNAMES: 'rootish',
    })
    assert.equal(isAdminUser({ auth_provider: 'local', role: 'admin', username: 'x' }, al), true)
    // username allowlist is bootstrap-only now
    assert.equal(isAdminUser({ auth_provider: 'local', role: 'user', username: 'rootish' }, al), false)
    assert.equal(isAdminUser({ auth_provider: 'local', role: 'user', username: 'nope' }, al), false)
    assert.equal(isAdminUser({ auth_provider: 'linuxdo', id: 42, username: 'u' }, al), true)
    assert.equal(isAdminUser({ auth_provider: 'linuxdo', id: '42', username: 'u' }, al), true)
    // mutable username / display name never grants admin
    assert.equal(isAdminUser({ auth_provider: 'linuxdo', id: 99, username: 'boss' }, al), false)
    assert.equal(
      isAdminUser({ auth_provider: 'linuxdo', id: 99, username: 'owner@example.com', name: 'owner@example.com' }, al),
      false,
    )
    assert.equal(isAdminUser({ auth_provider: 'linuxdo', id: 99, oauth_email: 'Owner@Example.com' }, al), false)
    assert.equal(
      isAdminUser({ auth_provider: 'linuxdo', id: 99, oauth_email: 'owner@example.com', email_verified: true }, al),
      true,
    )
    assert.equal(
      isAdminUser({ auth_provider: 'linuxdo', id: 99, oauth_email: 'owner@example.com', email_verified: false }, al),
      false,
    )
    assert.equal(isAdminUser({ auth_provider: 'linuxdo', id: 99, username: 'pleb' }, al), false)
    assert.equal(isAdminUser({ auth_provider: 'aily', role: 'admin', username: 'boss' }, al), false)
    assert.equal(isAdminUser(null, al), false)
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
