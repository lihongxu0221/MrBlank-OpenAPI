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
