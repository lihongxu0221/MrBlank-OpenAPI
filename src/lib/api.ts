import { getLanguage, P, qt } from '../i18n'
import { getSession, setSession } from './session'

type Envelope<T> = { success: boolean; data: T; message?: string; code?: string }

export class ApiError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { proof?: string; auth?: boolean; sessionHeader?: boolean } = {},
): Promise<T> {
  const headers = new Headers(init.headers || {})
  headers.set('Accept', 'application/json')
  headers.set('Accept-Language', getLanguage() === 'en' ? 'en' : 'zh')
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const session = getSession()
  if (init.auth !== false && session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`)
  }
  if (init.proof) headers.set('X-Welfare-Proof', init.proof)
  if (init.sessionHeader && session?.session?.sid) {
    headers.set('X-Auth-Session', session.session.sid)
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20000)
  try {
    const res = await fetch(path, {
      ...init,
      headers,
      credentials: 'include',
      cache: 'no-store',
      signal: ctrl.signal,
    })
    if (res.status === 401) {
      setSession(null)
      throw new ApiError(P('请先使用 Linux.do 登录。'))
    }
    const json = (await res.json()) as Envelope<T>
    if (!json.success) {
      throw new ApiError(
        json.message || qt(P('请求未成功（{status}）'), { status: res.status }),
        json.code,
      )
    }
    return json.data
  } catch (e) {
    if (e instanceof ApiError) throw e
    if ((e as Error).name === 'AbortError') throw new ApiError(P('暂时无法连接服务，请稍后重试。'))
    throw new ApiError(P('服务暂不可用，请稍后重试。'))
  } finally {
    clearTimeout(timer)
  }
}

export const api = {
  get: <T>(path: string, opts?: { auth?: boolean }) => request<T>(path, opts),
  post: <T>(
    path: string,
    body?: unknown,
    extra?: { proof?: string; auth?: boolean; sessionHeader?: boolean },
  ) =>
    request<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...extra,
    }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
