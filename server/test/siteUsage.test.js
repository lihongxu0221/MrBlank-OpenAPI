import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSiteUsageStore } from '../siteUsage.js'

test('siteUsage records events and builds leaderboard/activity', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-usage-'))
  const file = path.join(dir, 'site-usage.json')
  const store = createSiteUsageStore(file, { maxEvents: 100, maxAgeMs: 86400000 * 30 })

  store.recordEvent({
    userId: 'u1',
    keyHash: 'abc123',
    model: 'gpt-test',
    endpoint: '/v1/chat/completions',
    success: true,
    tokens: 12,
    prompt_tokens: 5,
    completion_tokens: 7,
    rawQuota: 297696,
    points_mp: 297696,
    raw_per_point: 1_000_000,
  })
  store.recordEvent({
    userId: 'u1',
    keyHash: 'abc123',
    model: 'gpt-test',
    success: false,
    tokens: 0,
    rawQuota: 0,
  })
  store.recordEvent({
    userId: 'u2',
    keyHash: 'zzz999',
    model: 'other',
    success: true,
    tokens: 3,
    rawQuota: 1000,
  })
  store.flush()

  const hashToUser = new Map([
    ['abc123', { userId: 'u1', display_name: 'Alice', username: 'alice' }],
  ])
  const board = store.leaderboard({ period: 'all', sort: 'credits', hashToUser })
  assert.equal(board.length, 1)
  assert.equal(board[0].name, 'Alice')
  // credits = Σ points_mp charged at call time (not LLM tokens, not rescaled by current N).
  assert.equal(board[0].credits, 297696)

  const act = store.activityByModel({ period: 'all' })
  assert.ok(act.some((a) => a.model === 'gpt-test'))

  const sum = store.summarize({ period: 'all' })
  assert.equal(sum.total_requests, 3)
  assert.equal(sum.success_count, 2)
  assert.equal(sum.failure_count, 1)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('leaderboard credits = points charged at call time (mp), history fixed across N changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-usage-pts-'))
  const file = path.join(dir, 'site-usage.json')
  const store = createSiteUsageStore(file, { maxEvents: 100, maxAgeMs: 86400000 * 30 })

  // raw 297696 charged at N=500000 → 0.595392 点 ; later call raw 500000 at N=5,000,000 → 0.1 点
  store.recordEvent({
    userId: 'admin', keyHash: 'adm1', model: 'gpt-test', success: true,
    tokens: 12000, prompt_tokens: 8000, completion_tokens: 4000,
    rawQuota: 297696, points_mp: 595392, raw_per_point: 500_000,
  })
  store.recordEvent({
    userId: 'admin', keyHash: 'adm1', model: 'gpt-test', success: true,
    tokens: 10, prompt_tokens: 5, completion_tokens: 5,
    rawQuota: 500000, points_mp: 100000, raw_per_point: 5_000_000,
  })
  // migrated legacy event without points_mp but with raw_per_point → rawQuota × 1e6 ÷ N
  store.recordEvent({
    userId: 'admin', keyHash: 'adm1', model: 'gpt-test', success: true,
    tokens: 1, rawQuota: 1_000_000, raw_per_point: 1_000_000,
  })
  store.flush()

  const hashToUser = new Map([['adm1', { userId: 'admin', display_name: 'admin', username: 'admin' }]])
  const board = store.leaderboard({ period: 'all', sort: 'credits', hashToUser })
  assert.equal(board.length, 1)
  assert.equal(board[0].credits, 595392 + 100000 + 1_000_000)
  assert.notEqual(board[0].credits, 12011)
  const page = store.listEvents({ p: 1, page_size: 10, range: 'all' })
  const items = page.items || []
  assert.ok(items.some((x) => x.points_mp === 100000 && x.raw_per_point === 5_000_000))

  fs.rmSync(dir, { recursive: true, force: true })
})

test('siteUsage range=yesterday excludes today (Asia/Shanghai bounds)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-usage-y-'))
  try {
    const store = createSiteUsageStore(path.join(dir, 'u.json'), { maxEvents: 100, maxAgeMs: 86400000 * 30 })
    const OFF = 8 * 3600000
    const todayStart = Math.floor((Date.now() + OFF) / 86400000) * 86400000 - OFF
    const base = { userId: 'u1', model: 'm', success: true, tokens: 1 }
    store.recordEvent({ ...base, id: 'today', ts: new Date(Math.min(Date.now(), todayStart + 1000)).toISOString() })
    store.recordEvent({ ...base, id: 'yday', ts: new Date(todayStart - 3600000).toISOString() })
    store.recordEvent({ ...base, id: 'old', ts: new Date(todayStart - 86400000 - 1000).toISOString() })
    const y = store.listEvents({ range: 'yesterday', page_size: 100 })
    assert.deepEqual(y.items.map((i) => i.id), ['yday'])
    const t = store.listEvents({ range: 'today', page_size: 100 })
    assert.deepEqual(t.items.map((i) => i.id), ['today'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
