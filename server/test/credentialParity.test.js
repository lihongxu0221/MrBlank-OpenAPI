import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { convertPasteToAuthFiles } from '../authFileConvert.js'
import { createQuotaSnapshotStore } from '../quotaSnapshots.js'
import { deriveDisplayStatus, mapAdminAccounts, summarizeAccounts, resolvePlanType, extractAuthFileQuota } from '../admin.js'
import {
  normalizeAuthFileModels,
  parseExcludedModels,
  coerceExcludedRule,
  mergeExcludedIntoModels,
  isModelExcluded,
  computeModelFilterCounts,
  toggleExcludedModel,
  excludedListsEqual,
  reconcileExcludedAfterFetch,
  buildExcludedSavePayload,
} from '../credModels.js'
import { normalizeAuthFilePatchFields } from '../cpa.js'

test('deriveDisplayStatus maps reauth / disabled / running', () => {
  assert.equal(deriveDisplayStatus({ disabled: true }), 'disabled')
  assert.equal(deriveDisplayStatus({ status_message: 'need reauth token expired' }), 'need_reauth')
  assert.equal(deriveDisplayStatus({ unavailable: true }), 'unavailable')
  assert.equal(deriveDisplayStatus({ status: 'ok' }), 'running')
})

test('mapAdminAccounts exposes display_status and fields', () => {
  const items = mapAdminAccounts({
    files: [
      {
        name: 'codex-a.json',
        provider: 'codex',
        disabled: false,
        note: 'n1',
        priority: 3,
        weight: 2,
        recent_requests: [],
      },
    ],
  })
  assert.equal(items[0].display_status, 'running')
  assert.equal(items[0].note, 'n1')
  assert.equal(items[0].priority, 3)
  assert.equal(items[0].weight, 2)
  const pool = summarizeAccounts(items)
  assert.equal(pool.total, 1)
  assert.equal(pool.active, 1)
})

test('convertPasteToAuthFiles session → codex', () => {
  const out = convertPasteToAuthFiles('session', JSON.stringify({
    accessToken: 'tok-abc',
    refreshToken: 'ref-1',
    user: { email: 'a@example.com' },
    account: { id: 'acc1' },
  }))
  assert.equal(out.files.length, 1)
  assert.equal(out.files[0].authJson.type, 'codex')
  assert.equal(out.files[0].authJson.access_token, 'tok-abc')
  assert.match(out.files[0].fileName, /codex-a@example\.com\.json/)
})

test('convertPasteToAuthFiles sub2api multi', () => {
  const out = convertPasteToAuthFiles('sub2api', JSON.stringify({
    accounts: [
      { email: 'u1@x.com', access_token: 't1' },
      { email: 'u2@x.com', access_token: 't2' },
    ],
  }))
  assert.equal(out.files.length, 2)
  assert.equal(out.convertedSourceCount, 2)
})

test('quotaSnapshots ingest + latest query', () => {
  const file = path.join(os.tmpdir(), `qs-${process.pid}-${Date.now()}.json`)
  try {
    const store = createQuotaSnapshotStore(file)
    store.ingest([
      { account: 'a.json', remaining_ratio: 0.8, provider: 'codex' },
      { account: 'a.json', remaining_ratio: 0.15, provider: 'codex' },
      { account: 'b.json', remaining_ratio: 0, provider: 'claude' },
    ])
    const q = store.query({ accounts: ['a.json', 'b.json'], latest_only: true })
    assert.equal(q.count, 2)
    const a = q.items.find((x) => x.account === 'a.json')
    assert.equal(a.remaining_ratio, 0.15)
    assert.equal(a.risk, 'critical')
    const b = q.items.find((x) => x.account === 'b.json')
    assert.equal(b.risk, 'exhausted')
  } finally {
    try {
      fs.unlinkSync(file)
    } catch {
      /* ignore */
    }
  }
})


test('normalizeAuthFileModels accepts strings, objects, nested payloads', () => {
  assert.deepEqual(normalizeAuthFileModels(['gpt-4', 'gpt-4', ' o1 ']).map((m) => m.id), [
    'gpt-4',
    'o1',
  ])
  const objs = normalizeAuthFileModels([
    { id: 'claude-sonnet', display_name: 'Sonnet', owned_by: 'anthropic' },
    { model: 'codex-mini', name: 'Codex Mini', provider: 'codex' },
    { name: 'only-name' },
    null,
    12,
  ])
  assert.equal(objs.length, 3)
  assert.equal(objs[0].name, 'Sonnet')
  assert.equal(objs[0].provider, 'anthropic')
  assert.equal(objs[1].id, 'codex-mini')
  assert.equal(objs[2].id, 'only-name')
  assert.deepEqual(
    normalizeAuthFileModels({ models: { data: [{ id: 'a' }, { id: 'b' }] } }).map((m) => m.id),
    ['a', 'b'],
  )
})

test('parseExcludedModels + filter counts + toggle', () => {
  assert.deepEqual(parseExcludedModels('a, b\nc'), ['a', 'b', 'c'])
  assert.deepEqual(parseExcludedModels({ 'excluded-models': ['x', 'x'] }), ['x'])
  const models = normalizeAuthFileModels(['gpt-4', 'o1', 'claude-3'])
  const draft = ['gpt-4', 'claude-*']
  assert.equal(isModelExcluded('gpt-4', draft), true)
  assert.equal(isModelExcluded('claude-3', draft), true)
  assert.equal(isModelExcluded('o1', draft), false)
  const counts = computeModelFilterCounts(models, draft)
  assert.equal(counts.all, 3)
  assert.equal(counts.disabled, 2)
  assert.equal(counts.available, 1)
  const next = toggleExcludedModel(draft, 'o1', true)
  assert.equal(isModelExcluded('o1', next), true)
  const restored = toggleExcludedModel(next, 'gpt-4', false)
  assert.equal(isModelExcluded('gpt-4', restored), false)
  assert.equal(excludedListsEqual(['A', 'b'], ['b', 'a']), true)
  assert.equal(excludedListsEqual(['A'], ['b']), false)
})

test('parseExcludedModels handles object / rule shapes from CPA/CPAMP', () => {
  assert.equal(coerceExcludedRule({ model_id: 'gpt-4o' }), 'gpt-4o')
  assert.equal(coerceExcludedRule({ modelId: 'o1' }), 'o1')
  assert.equal(coerceExcludedRule({ model: 'claude-3' }), 'claude-3')
  assert.equal(coerceExcludedRule({ id: 'x', name: 'ignored' }), 'x')
  assert.equal(coerceExcludedRule({ pattern: 'gpt-*' }), 'gpt-*')
  assert.equal(coerceExcludedRule({ nested: true }), null)
  assert.deepEqual(
    parseExcludedModels([
      { model_id: 'a' },
      { id: 'b' },
      { pattern: 'c-*' },
      'd',
      { model: 'a' }, // dedupe
    ]),
    ['a', 'b', 'c-*', 'd'],
  )
  assert.deepEqual(parseExcludedModels({ model: 'solo' }), ['solo'])
  assert.deepEqual(parseExcludedModels({ rules: [{ id: 'r1' }, { pattern: 'r*' }] }), ['r1', 'r*'])
  // Must NOT produce "[object Object]"
  const bad = parseExcludedModels([{ foo: 1 }, { id: 'ok' }])
  assert.deepEqual(bad, ['ok'])
  assert.ok(!bad.some((x) => x.includes('[object')))
})

test('mergeExcludedIntoModels synthesizes excluded-only ids for 已禁用 filter', () => {
  const models = normalizeAuthFileModels([{ id: 'gpt-4' }, { id: 'o1' }])
  const rules = ['gpt-4', 'missing-model', 'wild-*', { model_id: 'also-missing' }]
  const parsed = parseExcludedModels(rules)
  const merged = mergeExcludedIntoModels(models, parsed)
  const ids = merged.map((m) => m.id)
  assert.ok(ids.includes('gpt-4'))
  assert.ok(ids.includes('o1'))
  assert.ok(ids.includes('missing-model'))
  assert.ok(ids.includes('also-missing'))
  assert.ok(!ids.includes('wild-*')) // wildcards not synthesized as rows
  const syn = merged.find((m) => m.id === 'missing-model')
  assert.equal(syn?.synthetic, true)
  const counts = computeModelFilterCounts(merged, parsed)
  assert.equal(counts.disabled, 3) // gpt-4 + missing-model + also-missing (wild does not match o1)
  assert.equal(counts.available, 1) // o1
  // Filter 「已禁用」 view
  const disabledOnly = merged.filter((m) => isModelExcluded(m.id, parsed))
  assert.deepEqual(
    disabledOnly.map((m) => m.id).sort(),
    ['also-missing', 'gpt-4', 'missing-model'].sort(),
  )
  // toggle → save cycle: restore missing-model
  const after = toggleExcludedModel(parsed, 'missing-model', false)
  assert.equal(isModelExcluded('missing-model', after), false)
  const remount = mergeExcludedIntoModels(models, after)
  assert.ok(!remount.some((m) => m.id === 'missing-model'))
})


test('reconcileExcludedAfterFetch keeps local draft when API returns empty after save', () => {
  const local = ['model-a', 'model-b']
  const r = reconcileExcludedAfterFetch({
    wasDirty: false,
    localDraft: local,
    apiExcluded: [],
    apiDefined: true,
    preferLocalIfApiEmpty: true,
  })
  assert.deepEqual(r.rules, local)
  assert.equal(r.applyToDraft, false)

  const wipe = reconcileExcludedAfterFetch({
    wasDirty: false,
    localDraft: local,
    apiExcluded: [],
    apiDefined: true,
    preferLocalIfApiEmpty: false,
  })
  assert.deepEqual(wipe.rules, [])
  assert.equal(wipe.applyToDraft, true)

  const dirty = reconcileExcludedAfterFetch({
    wasDirty: true,
    localDraft: ['x'],
    apiExcluded: ['y'],
    apiDefined: true,
  })
  assert.deepEqual(dirty.rules, ['x'])
  assert.equal(dirty.applyToDraft, false)

  const fresh = reconcileExcludedAfterFetch({
    wasDirty: false,
    localDraft: [],
    apiExcluded: ['a', 'b'],
    apiDefined: true,
  })
  assert.deepEqual(fresh.rules, ['a', 'b'])
  assert.equal(fresh.applyToDraft, true)
})

test('toggle A then B → save payload contains BOTH ids', () => {
  const payload = buildExcludedSavePayload([], ['model-a', 'model-b'])
  assert.ok(payload.includes('model-a'))
  assert.ok(payload.includes('model-b'))
  assert.equal(payload.length, 2)
})

test('normalizeAuthFilePatchFields emits excluded-models kebab for CPA', () => {
  const body = normalizeAuthFilePatchFields({ excluded_models: ['gpt-4', 'o1'], note: 'x' })
  assert.deepEqual(body['excluded-models'], ['gpt-4', 'o1'])
  assert.equal(body.excluded_models, undefined)
  assert.equal(body.note, 'x')
})

test('resolvePlanType reads plan from id_token JWT (CPAMP gu)', () => {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ plan_type: 'pro', email: 'a@b.com' })).toString('base64url')
  const jwt = `${header}.${payload}.sig`
  assert.equal(resolvePlanType({ id_token: jwt }), 'pro')
  assert.equal(resolvePlanType({ plan_type: 'Plus' }), 'plus')
  assert.equal(resolvePlanType({ attributes: { planType: 'team' } }), 'team')
  assert.equal(resolvePlanType({}), null)

  const items = mapAdminAccounts({
    files: [{ name: 'x.json', provider: 'codex', id_token: jwt, recent_requests: [] }],
  })
  assert.equal(items[0].plan_type, 'pro')
})

test('extractAuthFileQuota maps used_percent / quota_windows when present', () => {
  const { quota, quota_windows } = extractAuthFileQuota({
    name: 'a.json',
    used_percent: 25,
    quota_windows: [
      { label: '5h', used_percent: 40, resets_at: '2026-09-28T12:00:00Z' },
      { window: 'week', remaining_ratio: 0.8 },
    ],
  })
  assert.ok(quota)
  assert.equal(quota.remaining_ratio, 0.75)
  assert.equal(quota.source, 'cpa:auth-files')
  assert.equal(quota_windows.length, 2)
  assert.equal(quota_windows[0].remaining_ratio, 0.6)
})

test('cred list CSS: no forced 1240 min-width; models panel not height-clipped', () => {
  const css = fs.readFileSync(new URL('../../src/styles/app.css', import.meta.url), 'utf8')
  const cardList = css.match(/\.cred-card-list\s*\{[^}]+\}/)
  assert.ok(cardList, 'cred-card-list rule missing')
  assert.ok(!/min-width:\s*1240px/.test(cardList[0]))
  assert.ok(/min-width:\s*0/.test(cardList[0]))
  const drawer = css.match(/\.cred-drawer\s*\{[^}]+\}/)
  assert.ok(drawer && /100dvh/.test(drawer[0]))
  const panel = css.match(/\.cred-models-panel\s*\{[^}]+\}/)
  assert.ok(panel, 'cred-models-panel rule missing')
  const panelNoComments = panel[0].replace(/\/\*[\s\S]*?\*\//g, '')
  assert.ok(!/height:\s*100%/.test(panelNoComments))
  assert.ok(/height:\s*auto/.test(panel[0]))
  assert.ok(!/minmax\(280px,\s*3fr\)/.test(css))
  assert.ok(/minmax\(0,\s*3fr\)/.test(css), 'quota column should be minmax(0, 3fr)')
  for (const cls of ['.cred-grid-card-header', '.cred-grid-history', '.cred-grid-recent', '.cred-spark-h', '.cred-quota-stack', '.cred-grid-card-footer', '.cred-plan-badge']) {
    assert.ok(css.includes(cls), `missing ${cls}`)
  }
})
