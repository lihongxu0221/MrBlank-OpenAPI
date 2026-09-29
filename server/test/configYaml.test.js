import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  parseConfigYaml,
  dumpConfigYaml,
  maskConfigObject,
  restoreMaskedSecrets,
  assertSafeConfigWrite,
  backupConfigYaml,
  buildMaskedConfigPayload,
  isConfigYamlWriteEnabled,
  sha256Text,
} from '../configYaml.js'
import { maskKey } from '../cpa.js'

const SAMPLE = `
host: ""
port: 8317
remote-management:
  allow-remote: true
  secret-key: super-secret-management-key-value-32
  disable-control-panel: false
auth-dir: "/root/.cli-proxy-api"
api-keys:
  - "sk-demo-abcdefghijklmnopqrstuvwxyz012345"
  - "sk-user-abcdefghijklmnopqrstuvwxyz678901"
debug: true
ws-auth: true
gemini-api-key:
  - api-key: "AIzaSyDemoKeyValueABCDEFGHIJKLMNOP"
`

describe('configYaml safety', () => {
  it('parse + dump roundtrip keeps core keys', () => {
    const doc = parseConfigYaml(SAMPLE)
    assert.equal(doc.port, 8317)
    assert.equal(doc['remote-management']['secret-key'].length > 10, true)
    const text = dumpConfigYaml(doc)
    assert.match(text, /port:\s*8317/)
  })

  it('rejects empty yaml', () => {
    assert.throws(() => parseConfigYaml('   '), /empty/)
  })

  it('maskConfigObject hides secrets', () => {
    const doc = parseConfigYaml(SAMPLE)
    const masked = maskConfigObject(doc)
    assert.ok(String(masked['remote-management']['secret-key']).includes('****'))
    assert.ok(!String(masked['remote-management']['secret-key']).includes('super-secret'))
    assert.ok(masked['api-keys'][0].includes('****'))
    assert.ok(!masked['api-keys'][0].includes('abcdefghijklmnopqrstuvwxyz012345'))
  })

  it('restore keep leaves secret-key unchanged', () => {
    const current = parseConfigYaml(SAMPLE)
    const incoming = maskConfigObject(structuredClone(current))
    incoming.debug = false
    const restored = restoreMaskedSecrets(incoming, current, { secretKeyAction: 'keep' })
    assert.equal(restored['remote-management']['secret-key'], current['remote-management']['secret-key'])
    assert.equal(restored['api-keys'][0], current['api-keys'][0])
    assert.equal(restored.debug, false)
  })

  it('restore clear empties secret-key', () => {
    const current = parseConfigYaml(SAMPLE)
    const incoming = maskConfigObject(structuredClone(current))
    const restored = restoreMaskedSecrets(incoming, current, { secretKeyAction: 'clear' })
    assert.equal(restored['remote-management']['secret-key'], '')
  })

  it('restore replace sets new secret', () => {
    const current = parseConfigYaml(SAMPLE)
    const incoming = maskConfigObject(structuredClone(current))
    const restored = restoreMaskedSecrets(incoming, current, {
      secretKeyAction: 'replace',
      secretKey: 'brand-new-management-secret-key-xx',
    })
    assert.equal(restored['remote-management']['secret-key'], 'brand-new-management-secret-key-xx')
  })

  it('assertSafeConfigWrite rejects {} and cleared api-keys', () => {
    const current = parseConfigYaml(SAMPLE)
    assert.throws(() => assertSafeConfigWrite({}, current), /empty config/)
    assert.throws(
      () =>
        assertSafeConfigWrite(
          { port: 1, 'remote-management': { 'allow-remote': true }, 'api-keys': [] },
          current,
        ),
      /clear all api-keys/,
    )
    assert.throws(
      () => assertSafeConfigWrite({ port: 1 }, current),
      /remote-management/,
    )
  })

  it('assertSafeConfigWrite allows normal merge', () => {
    const current = parseConfigYaml(SAMPLE)
    const next = structuredClone(current)
    next.debug = false
    assert.equal(assertSafeConfigWrite(next, current), true)
  })

  it('backup writes file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfgbak-'))
    const b = backupConfigYaml(SAMPLE, dir)
    assert.ok(fs.existsSync(b.path))
    assert.equal(fs.readFileSync(b.path, 'utf8'), SAMPLE)
    assert.equal(b.sha256, sha256Text(SAMPLE))
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('buildMaskedConfigPayload returns masked yaml + etag', () => {
    const p = buildMaskedConfigPayload(SAMPLE)
    assert.ok(p.yaml.includes('****'))
    assert.ok(!p.yaml.includes('super-secret-management-key-value-32'))
    assert.equal(p.etag.length, 64)
    assert.equal(p.secret_key.present, true)
    assert.ok(p.secret_key.masked.includes('****'))
  })

  it('feature flag defaults true', () => {
    assert.equal(isConfigYamlWriteEnabled({}), true)
    assert.equal(isConfigYamlWriteEnabled({ CONFIG_YAML_WRITE_ENABLED: 'false' }), false)
    assert.equal(isConfigYamlWriteEnabled({ CONFIG_YAML_WRITE_ENABLED: '1' }), true)
  })

  it('maskKey aligns with api-keys mask', () => {
    const k = 'sk-demo-abcdefghijklmnopqrstuvwxyz012345'
    assert.equal(maskConfigObject({ 'api-keys': [k] })['api-keys'][0], maskKey(k))
  })
})
