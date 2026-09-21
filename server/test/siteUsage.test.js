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
  })
  store.recordEvent({
    userId: 'u1',
    keyHash: 'abc123',
    model: 'gpt-test',
    success: false,
    tokens: 0,
  })
  store.recordEvent({
    userId: 'u2',
    keyHash: 'zzz999',
    model: 'other',
    success: true,
    tokens: 3,
  })
  store.flush()

  const hashToUser = new Map([
    ['abc123', { userId: 'u1', display_name: 'Alice', username: 'alice' }],
  ])
  const board = store.leaderboard({ period: 'all', sort: 'credits', hashToUser })
  assert.equal(board.length, 1)
  assert.equal(board[0].name, 'Alice')
  assert.equal(board[0].credits, 12)

  const act = store.activityByModel({ period: 'all' })
  assert.ok(act.some((a) => a.model === 'gpt-test'))

  const sum = store.summarize({ period: 'all' })
  assert.equal(sum.total_requests, 3)
  assert.equal(sum.success_count, 2)
  assert.equal(sum.failure_count, 1)

  fs.rmSync(dir, { recursive: true, force: true })
})
