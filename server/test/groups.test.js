import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createGroupStore, GROUP_QUOTA_UNIT } from '../groups.js'

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grp-'))
  const store = createGroupStore(path.join(dir, 'groups.json'))
  return { dir, store }
}

describe('groups quota / allowlist / promotion', () => {
  it('empty model_ids allows all; non-empty is allowlist', () => {
    const { dir, store } = tmpStore()
    const open = { model_ids: [] }
    const limited = { model_ids: ['gpt-4o', 'claude-3'] }
    assert.equal(store.isModelAllowed(open, 'anything'), true)
    assert.equal(store.isModelAllowed(limited, 'gpt-4o'), true)
    assert.equal(store.isModelAllowed(limited, 'nope'), false)
    assert.equal(store.assertModelAllowed(limited, 'nope').ok, false)
    assert.equal(store.assertModelAllowed(limited, 'gpt-4o').ok, true)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('rolling windows sum usage and assertQuotaAvailable', () => {
    const { dir, store } = tmpStore()
    store.saveGroups([
      {
        id: 'tiny',
        name: 'tiny',
        level: 1,
        quotas: { window_5h: 100, week: 1000, month: 5000 },
        model_ids: [],
        promotion: { min_account_days: 0, min_request_count: 0, min_used_quota: 0, min_checkins: 0 },
        enabled: true,
      },
    ])
    const uid = 'u1'
    store.ensureUser(uid)
    assert.equal(store.assertQuotaAvailable(uid).ok, true)
    store.recordUsage(uid, { quota: 100, requests: 1 })
    const denied = store.assertQuotaAvailable(uid)
    assert.equal(denied.ok, false)
    assert.equal(denied.code, 'quota_5h_exhausted')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('auto-promotes when metrics meet next group rules unless override', () => {
    const { dir, store } = tmpStore()
    store.saveGroups([
      {
        id: 'g1',
        name: 'G1',
        level: 1,
        quotas: { window_5h: GROUP_QUOTA_UNIT, week: GROUP_QUOTA_UNIT, month: GROUP_QUOTA_UNIT },
        promotion: { min_account_days: 0, min_request_count: 0, min_used_quota: 0, min_checkins: 0 },
        enabled: true,
      },
      {
        id: 'g2',
        name: 'G2',
        level: 2,
        quotas: { window_5h: GROUP_QUOTA_UNIT * 2, week: GROUP_QUOTA_UNIT * 2, month: GROUP_QUOTA_UNIT * 2 },
        promotion: { min_account_days: 1, min_request_count: 5, min_used_quota: 10, min_checkins: 2 },
        enabled: true,
      },
    ])
    const uid = 'promo-user'
    let info = store.resolveUserGroup(uid, {
      account_days: 0,
      request_count: 0,
      used_quota: 0,
      checkins: 0,
    })
    assert.equal(info.group.id, 'g1')
    info = store.resolveUserGroup(uid, {
      account_days: 2,
      request_count: 5,
      used_quota: 10,
      checkins: 2,
    })
    assert.equal(info.group.id, 'g2')
    store.assignMember(uid, { group_id: 'g1', override: true })
    info = store.resolveUserGroup(uid, {
      account_days: 99,
      request_count: 999,
      used_quota: 9999,
      checkins: 99,
    })
    assert.equal(info.group.id, 'g1')
    assert.equal(info.override, true)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('filterModelsResponseBody filters OpenAI-style list', () => {
    const { dir, store } = tmpStore()
    const group = { model_ids: ['a', 'c'] }
    const body = JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] })
    const out = JSON.parse(store.filterModelsResponseBody(body, group))
    assert.deepEqual(
      out.data.map((m) => m.id),
      ['a', 'c'],
    )
    fs.rmSync(dir, { recursive: true, force: true })
  })
})


describe('groups membership single source of truth', () => {
  it('mergeAlias folds username key into canonical id and keeps override', () => {
    const { dir, store } = tmpStore()
    const canonical = 'local:abc123'
    store.ensureUser(canonical)
    store.assignMember('admin', { group_id: 'leader', override: true })
    // Simulate duplicate: canonical still newcomer, orphan username has leader override
    const before = store.listMembers()
    assert.equal(before.length >= 2, true)
    store.mergeAlias(canonical, 'admin')
    const members = store.listMembers()
    assert.equal(members.length, 1)
    assert.equal(members[0].user_id, canonical)
    assert.equal(members[0].group_id, 'leader')
    assert.equal(members[0].override, true)
    const info = store.resolveUserGroup(canonical, {})
    assert.equal(info.group.id, 'leader')
    assert.equal(info.override, true)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('assignMember merge_from removes aliases in one write', () => {
    const { dir, store } = tmpStore()
    const canonical = 'local:deadbeef'
    store.ensureUser(canonical)
    store.assignMember('admin', { group_id: 'basic', override: true })
    const row = store.assignMember(canonical, {
      group_id: 'leader',
      override: true,
      merge_from: ['admin'],
    })
    assert.equal(row.user_id, canonical)
    assert.equal(row.group_id, 'leader')
    assert.equal(store.listMembers().length, 1)
    assert.equal(store.listMembers()[0].user_id, canonical)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('resolveUserGroup aliasKeys absorbs orphan before evaluating', () => {
    const { dir, store } = tmpStore()
    const canonical = 'local:cafe'
    store.ensureUser(canonical)
    store.assignMember('admin', { group_id: 'leader', override: true })
    const info = store.resolveUserGroup(canonical, {}, { aliasKeys: ['admin'] })
    assert.equal(info.group.id, 'leader')
    assert.equal(info.override, true)
    assert.equal(store.listMembers().length, 1)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('display_name must not be treated as membership alias (no collision merge)', () => {
    // Contract: aliasKeys = username + exact id only (never display_name).
    // findUserIdsByUsername must not invent display_name keys (see userKeys test).
    const { dir, store } = tmpStore()
    const a = 'local:user-a'
    const b = 'local:user-b'
    store.ensureUser(a)
    store.ensureUser(b)
    store.assignMember(a, { group_id: 'leader', override: true })
    store.assignMember(b, { group_id: 'basic', override: true })
    // SharedNick is not a membership key → no-op; B untouched
    store.resolveUserGroup(a, {}, { aliasKeys: ['alice', 'SharedNick'] })
    assert.equal(store.listMembers().length, 2)
    assert.equal(store.resolveUserGroup(a, {}).group.id, 'leader')
    assert.equal(store.resolveUserGroup(b, {}).group.id, 'basic')
    // Username-keyed orphan still merges when explicitly listed
    store.assignMember('alice', { group_id: 'leader', override: true })
    const info = store.resolveUserGroup(a, {}, { aliasKeys: ['alice'] })
    assert.equal(info.group.id, 'leader')
    assert.equal(store.listMembers().length, 2)
    assert.equal(store.listMembers().some((m) => m.user_id === b), true)
    assert.equal(store.listMembers().some((m) => m.user_id === 'alice'), false)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('model_quotas / assertModelQuota', () => {
  it('normalizes model_quotas: default {}, clamps negatives, 0=unlimited', () => {
    const { dir, store } = tmpStore()
    const saved = store.saveGroups([
      {
        id: 'mq',
        name: 'MQ',
        level: 1,
        quotas: { window_5h: 1e9, week: 1e9, month: 1e9 },
        model_ids: ['gpt-4o'],
        model_quotas: { 'gpt-4o': 1000, neg: -5, zero: 0 },
        promotion: { min_account_days: 0, min_request_count: 0, min_used_quota: 0, min_checkins: 0 },
        enabled: true,
      },
    ])
    const g = saved[0]
    assert.equal(g.model_quotas['gpt-4o'], 1000)
    assert.equal(g.model_quotas.neg, 0)
    assert.equal(g.model_quotas.zero, 0)
    assert.equal(g.model_quotas.missing, undefined)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('assertModelQuota: missing/0 unlimited; limit blocks; records model on usage', () => {
    const { dir, store } = tmpStore()
    store.saveGroups([
      {
        id: 'mq2',
        name: 'MQ2',
        level: 1,
        quotas: { window_5h: 1e12, week: 1e12, month: 1e12 },
        model_ids: [],
        model_quotas: { 'gpt-4o': 500, open: 0 },
        promotion: { min_account_days: 0, min_request_count: 0, min_used_quota: 0, min_checkins: 0 },
        enabled: true,
      },
    ])
    const uid = 'mq-user'
    store.ensureUser(uid)
    const group = store.listGroups()[0]
    assert.equal(store.assertModelQuota(uid, group, 'open').ok, true)
    assert.equal(store.assertModelQuota(uid, group, 'unlisted').ok, true)
    assert.equal(store.assertModelQuota(uid, group, 'gpt-4o').ok, true)
    store.recordUsage(uid, { quota: 500, requests: 1, model: 'gpt-4o' })
    const denied = store.assertModelQuota(uid, group, 'gpt-4o')
    assert.equal(denied.ok, false)
    assert.equal(denied.code, 'model_quota_exhausted')
    store.recordUsage(uid, { quota: 9999, requests: 1, model: 'other' })
    assert.equal(store.assertModelQuota(uid, group, 'gpt-4o').ok, false)
    assert.equal(store.usedForModel(uid, 'gpt-4o'), 500)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('empty model_ids still all-open; filterModels honors allowlist', () => {
    const { dir, store } = tmpStore()
    const open = { model_ids: [], model_quotas: {} }
    assert.equal(store.isModelAllowed(open, 'any-model'), true)
    const details = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    assert.deepEqual(
      store.filterModels(details, open).map((m) => m.id),
      ['a', 'b', 'c'],
    )
    assert.deepEqual(
      store.filterModels(details, { model_ids: ['b'] }).map((m) => m.id),
      ['b'],
    )
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('effectiveModelAllowlist is intersection (stricter)', () => {
    const { dir, store } = tmpStore()
    assert.deepEqual(store.effectiveModelAllowlist({ model_ids: [] }, ''), [])
    assert.deepEqual(store.effectiveModelAllowlist({ model_ids: ['a', 'b'] }, ''), ['a', 'b'])
    assert.deepEqual(store.effectiveModelAllowlist({ model_ids: [] }, 'a,c'), ['a', 'c'])
    assert.deepEqual(store.effectiveModelAllowlist({ model_ids: ['a', 'b'] }, 'b,c'), ['b'])
    assert.equal(store.assertKeyModelAllowed('a,b', 'c').ok, false)
    assert.equal(store.assertKeyModelAllowed('a,b', 'a').ok, true)
    assert.equal(store.assertKeyModelAllowed('', 'anything').ok, true)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('updateGroupModels patches model_ids and model_quotas', () => {
    const { dir, store } = tmpStore()
    const g0 = store.listGroups()[0]
    const updated = store.updateGroupModels(g0.id, {
      model_ids: ['gpt-4o', 'aily/claude'],
      model_quotas: { 'gpt-4o': 10000000, 'aily/claude': 0 },
    })
    assert.deepEqual(updated.model_ids, ['gpt-4o', 'aily/claude'])
    assert.equal(updated.model_quotas['gpt-4o'], 10000000)
    assert.equal(updated.model_quotas['aily/claude'], 0)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
