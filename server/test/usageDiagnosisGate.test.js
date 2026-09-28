/**
 * Smoke: console diagnosis routes must 403; admin diagnosis allowed when authed as admin.
 * Uses lightweight Express app mounting the same gate handlers pattern.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import http from 'node:http'

function fail(message) {
  return { success: false, message }
}
function ok(data) {
  return { success: true, data }
}

test('console diagnosis endpoints return 403; admin diagnosis returns 200', async () => {
  const app = express()
  const diagnosis = {
    get(id) {
      if (id === 'd1') return { id: 'd1', req_body: '{"x":1}', res_body: '{}' }
      return null
    },
  }
  const requireAuth = (req, _res, next) => {
    req.auth = { user: { id: 'u1', role: 'user' } }
    next()
  }
  const requireAdmin = (req, res, next) => {
    if (req.headers['x-admin'] === '1') {
      req.auth = { user: { id: 'admin', role: 'admin' } }
      return next()
    }
    res.status(403).json(fail('需要管理员'))
  }

  // Console must NEVER get diagnosis bodies
  app.get('/api/log/:id', requireAuth, (_req, res) => {
    res.status(403).json(fail('诊断详情仅管理员可用'))
  })
  app.get('/api/diagnosis/:id', requireAuth, (_req, res) => {
    res.status(403).json(fail('诊断详情仅管理员可用'))
  })
  app.get('/api/diagnosis/logs/:id', requireAuth, (_req, res) => {
    res.status(403).json(fail('诊断详情仅管理员可用'))
  })
  app.get('/api/admin/diagnosis/logs/:id', requireAdmin, (req, res) => {
    const rec = diagnosis.get(req.params.id)
    if (!rec) return res.status(404).json(fail('记录不存在'))
    res.json(ok(rec))
  })

  const server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  const base = `http://127.0.0.1:${port}`

  async function hit(path, headers = {}) {
    const res = await fetch(base + path, { headers })
    const body = await res.json().catch(() => ({}))
    return { status: res.status, body }
  }

  const c1 = await hit('/api/log/d1')
  assert.equal(c1.status, 403)
  assert.match(String(c1.body.message || ''), /诊断|管理员/)

  const c2 = await hit('/api/diagnosis/d1')
  assert.equal(c2.status, 403)

  const c3 = await hit('/api/diagnosis/logs/d1')
  assert.equal(c3.status, 403)

  const denied = await hit('/api/admin/diagnosis/logs/d1')
  assert.equal(denied.status, 403)

  const admin = await hit('/api/admin/diagnosis/logs/d1', { 'x-admin': '1' })
  assert.equal(admin.status, 200)
  assert.equal(admin.body.data.id, 'd1')
  assert.ok(admin.body.data.req_body)

  await new Promise((r) => server.close(r))
})
