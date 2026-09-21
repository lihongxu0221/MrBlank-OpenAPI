import type { Plugin } from 'vite'
import { fail, handlers, ok } from './store'

function readBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(Buffer.from(c)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function send(res: any, status: number, data: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(data))
}

function pathOf(url = '') {
  return url.split('?')[0]
}

function q(url = '') {
  const i = url.indexOf('?')
  return new URLSearchParams(i >= 0 ? url.slice(i + 1) : '')
}

function mount(server: { middlewares: { use: (fn: any) => void } }) {
  server.middlewares.use(async (req: any, res: any, next: any) => {
    const url = req.url || ''
    if (!url.startsWith('/api/')) return next()
    const path = pathOf(url)
    const method = (req.method || 'GET').toUpperCase()
    const query = q(url)
    let body: Record<string, unknown> = {}
    if (method === 'POST' || method === 'PUT') {
      try {
        const raw = await readBody(req)
        body = raw ? JSON.parse(raw) : {}
      } catch {
        return send(res, 400, fail('请求格式无效'))
      }
    }

    const needsAuth =
      path.startsWith('/api/user/') || path.startsWith('/api/token') || path.startsWith('/api/log/')
    const authExempt =
      path === '/api/user/auth/refresh' || path === '/api/user/auth/logout'
    if (needsAuth && !authExempt) {
      const auth = String(req.headers['authorization'] || '')
      if (!auth.startsWith('Bearer ')) {
        return send(res, 401, fail('请先使用 Linux.do 登录。'))
      }
    }

    try {
      if (path === '/api/status' && method === 'GET') return send(res, 200, handlers.status())
      if (path === '/api/welfare/config' && method === 'GET') return send(res, 200, handlers.config())
      if (path === '/api/welfare/availability' && method === 'GET') return send(res, 200, handlers.availability())
      if (path === '/api/welfare/pool' && method === 'GET') return send(res, 200, handlers.pool())
      if (path === '/api/welfare/leaderboard' && method === 'GET')
        return send(
          res,
          200,
          handlers.leaderboard(query.get('period') || 'today', query.get('sort') || 'credits', Number(query.get('p') || 1)),
        )
      if (path === '/api/welfare/activity' && method === 'GET')
        return send(res, 200, handlers.activity(query.get('period') || 'today'))
      if (path === '/api/welfare/notices' && method === 'GET')
        return send(res, 200, handlers.notices(Number(query.get('size') || 50)))
      if (path === '/api/welfare/challenge' && method === 'POST')
        return send(res, 200, handlers.challenge(String(body.purpose || 'login')))
      if (path === '/api/welfare/verify' && method === 'POST') return send(res, 200, handlers.verify())

      if (path === '/api/oauth/state' && method === 'POST') {
        return send(res, 200, {
          ...handlers.oauthState(),
          message: '演示环境未连接真实 Linux.do OAuth，请使用「开发者模拟登录」。',
        })
      }
      if (path === '/api/oauth/linuxdo' && method === 'GET') {
        return send(res, 400, fail('演示环境请使用开发者模拟登录。'))
      }

      if (path === '/api/user/self' && method === 'GET') return send(res, 200, handlers.self())
      if (path === '/api/user/dashboard' && method === 'GET') return send(res, 200, handlers.dashboard())
      if (path === '/api/user/checkin' && method === 'GET')
        return send(res, 200, handlers.checkinGet(query.get('month') || undefined))
      if (path === '/api/user/checkin' && method === 'POST') return send(res, 200, handlers.checkinPost())
      if (path === '/api/user/topup' && method === 'POST')
        return send(res, 200, handlers.topup(String(body.key || '')))
      if (path === '/api/user/auth/refresh' && method === 'POST') {
        return send(
          res,
          200,
          ok({
            access_token: 'mock-refreshed',
            token_type: 'Bearer',
            access_expires_at: Math.floor(Date.now() / 1000) + 3600,
            session: { sid: 'mock-sid', current: true },
            user: handlers.self().data,
          }),
        )
      }
      if (path === '/api/user/auth/logout' && method === 'POST') return send(res, 200, ok(true))

      if ((path === '/api/token/' || path === '/api/token') && method === 'GET')
        return send(res, 200, handlers.tokens(Number(query.get('p') || 1), Number(query.get('size') || 10)))
      if ((path === '/api/token/' || path === '/api/token') && method === 'POST')
        return send(res, 200, handlers.tokenCreate(body as never))
      if ((path === '/api/token/' || path === '/api/token') && method === 'PUT' && query.get('status_only') === 'true')
        return send(res, 200, handlers.tokenStatus(Number(body.id), body.status as 1 | 2))
      if ((path === '/api/token/' || path === '/api/token') && method === 'PUT')
        return send(res, 200, handlers.tokenUpdate(body as never))
      if (path === '/api/token/options' && method === 'GET') return send(res, 200, handlers.tokenOptions())

      const keyMatch = path.match(/^\/api\/token\/(\d+)\/key$/)
      if (keyMatch && method === 'POST') return send(res, 200, handlers.tokenKey(Number(keyMatch[1])))
      const delMatch = path.match(/^\/api\/token\/(\d+)$/)
      if (delMatch && method === 'DELETE') return send(res, 200, handlers.tokenDelete(Number(delMatch[1])))

      if (path === '/api/log/self' && method === 'GET')
        return send(res, 200, handlers.logs(Number(query.get('p') || 1), Number(query.get('page_size') || 10)))

      return send(res, 404, fail('接口不存在'))
    } catch (e) {
      return send(res, 500, fail((e as Error).message || '操作失败，请重试。'))
    }
  })
}

export function mockApiPlugin(): Plugin {
  return {
    name: 'welfare-mock-api',
    configureServer(server) {
      mount(server)
    },
    configurePreviewServer(server) {
      mount(server)
    },
  }
}
