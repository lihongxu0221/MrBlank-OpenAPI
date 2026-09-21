import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSiteUsageStore } from '../siteUsage.js'
import { createUsageImportSessions } from '../usageImportSessions.js'
import { createCodexInspectionStore } from '../codexInspection.js'

test('usage export/import append + merge dedupe', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wavec-usage-'))
  const store = createSiteUsageStore(path.join(dir, 'u.json'), { maxEvents: 1000, maxAgeMs: 86400000 * 30 })
  const ts = new Date().toISOString()
  store.recordEvent({
    ts,
    model: 'gpt-a',
    success: true,
    tokens: 10,
    prompt_tokens: 4,
    completion_tokens: 6,
    keyHash: 'abc',
  })
  store.flush()

  const bundle = store.exportBundle({ period: 'all' })
  assert.equal(bundle.source, 'site-usage')
  assert.equal(bundle.count, 1)
  assert.ok(Array.isArray(bundle.events))

  const append = store.importEvents(
    { events: [{ ts: new Date(Date.now() - 1000).toISOString(), model: 'gpt-b', success: true, tokens: 3 }] },
    { mode: 'append' },
  )
  assert.equal(append.added, 1)
  assert.equal(append.total_events, 2)

  const merge = store.importEvents(bundle, { mode: 'merge' })
  assert.equal(merge.added, 0)
  assert.equal(merge.skipped, 1)
  assert.equal(merge.total_events, 2)

  assert.throws(
    () => store.importEvents({ nope: true }),
    (err) => err && err.status === 400,
  )

  fs.rmSync(dir, { recursive: true, force: true })
})

test('chunked usage import sessions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wavec-sess-'))
  const store = createSiteUsageStore(path.join(dir, 'u.json'), { maxEvents: 5000 })
  const sessions = createUsageImportSessions(path.join(dir, 'imports'), store)
  const meta = sessions.start({ mode: 'append' })
  assert.equal(meta.status, 'open')
  sessions.addChunk(meta.id, {
    events: [
      { ts: new Date().toISOString(), model: 'm1', success: true, tokens: 1 },
      { ts: new Date().toISOString(), model: 'm2', success: false, tokens: 0 },
    ],
  })
  const done = sessions.complete(meta.id)
  assert.equal(done.status, 'completed')
  assert.equal(done.result.added, 2)
  assert.equal(store.stats().events, 2)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('codex inspection lite: run + safe actions + delete requires confirm', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wavec-codex-'))
  const deleted = []
  const disabled = []
  const refreshed = []
  const store = createCodexInspectionStore(path.join(dir, 'codex.json'), {
    listAccounts: async () => [
      {
        name: 'codex-ok.json',
        label: 'ok@x.com',
        provider: 'codex',
        status: 'ok',
        success: 5,
        failed: 0,
      },
      {
        name: 'codex-bad.json',
        label: 'bad@x.com',
        provider: 'openai',
        status: 'expired',
        status_message: 'token expired',
        success: 0,
        failed: 3,
      },
      {
        name: 'claude.json',
        label: 'c@x.com',
        provider: 'claude',
        status: 'ok',
      },
    ],
    refreshAuthFile: async (name) => {
      refreshed.push(name)
      return { ok: true }
    },
    setAuthFileDisabled: async (name, d) => {
      disabled.push([name, d])
      return { ok: true }
    },
    deleteAuthFile: async (name) => {
      deleted.push(name)
      return { ok: true }
    },
    refreshCollector: async () => ({ ok: true }),
  })

  const run = await store.startRun({ async: false })
  assert.equal(run.status, 'completed')
  assert.equal(run.summary.scanned, 2)
  assert.equal(run.summary.ok, 1)
  assert.equal(run.summary.expired, 1)

  const listed = store.listRuns()
  assert.ok(typeof listed.note === 'string' && listed.note.length > 0)
  assert.equal(listed.total, 1)

  const detail = store.getRun(run.id)
  assert.equal(detail.findings.length, 2)

  const acts = await store.applyActions(run.id, {
    actions: [
      { type: 'refresh', name: 'codex-bad.json' },
      { type: 'disable', name: 'codex-bad.json' },
      { type: 'delete', name: 'codex-bad.json' },
      { type: 'delete', name: 'codex-bad.json', confirm: true },
    ],
  })
  assert.equal(acts.results[0].ok, true)
  assert.equal(acts.results[1].ok, true)
  assert.equal(acts.results[2].ok, false)
  assert.match(String(acts.results[2].error || ''), /confirm/i)
  assert.equal(acts.results[3].ok, true)
  assert.deepEqual(refreshed, ['codex-bad.json'])
  assert.deepEqual(disabled, [['codex-bad.json', true]])
  assert.deepEqual(deleted, ['codex-bad.json'])

  fs.rmSync(dir, { recursive: true, force: true })
})
