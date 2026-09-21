import { useEffect, useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { P } from '../i18n'
import { api } from '../lib/api'
import { setSession, type Session } from '../lib/session'
import { navigate } from '../router/hash'

export function GuestPanel({ onLoggedIn }: { onLoggedIn?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [loginBusy, setLoginBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const err = params.get('oauth_error')
    if (err) {
      setMsg(
        P(
          `Linux.do 登录失败（${err}）。请重试。`,
          `Linux.do login failed (${err}). Please try again.`,
        ),
      )
      params.delete('oauth_error')
      const qs = params.toString()
      history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`)
    }
    void onLoggedIn
  }, [onLoggedIn])

  async function tryLinuxDo() {
    setBusy(true)
    setMsg(null)
    try {
      const data = await api.post<{ flow_token: string; authorization_url: string | null }>(
        '/api/oauth/state',
        { provider: 'linuxdo', intent: 'login' },
        { auth: false },
      )
      if (data.authorization_url) {
        location.href = data.authorization_url
        return
      }
      setMsg(P('暂时无法启动 Linux.do 登录，请稍后重试。', 'Unable to start Linux.do login. Try again later.'))
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function tryPasswordLogin(e: FormEvent) {
    e.preventDefault()
    const u = username.trim()
    if (!u || !password) {
      setMsg(P('请输入用户名和密码。', 'Enter username and password.'))
      return
    }
    setLoginBusy(true)
    setMsg(null)
    try {
      // Prefer native local login; fall back to legacy path name during cutover.
      let data: Session & { is_admin?: boolean }
      try {
        data = await api.post('/api/auth/login', { username: u, password }, { auth: false })
      } catch {
        data = await api.post('/api/auth/aily', { username: u, password }, { auth: false })
      }
      setPassword('')
      setSession(data)
      onLoggedIn?.()
      navigate(data.is_admin ? '/admin' : '/console')
    } catch (err) {
      setMsg((err as Error).message)
    } finally {
      setLoginBusy(false)
    }
  }

  const anyBusy = busy || loginBusy

  return (
    <div className="guest-state">
      <div className="guest-icon">
        <KeyRound size={22} />
      </div>
      <h2>{P('你的探索，从登录开始')}</h2>
      <p>
        {P('登录后可以领取每日额度、兑换社区礼物、')}
        {P('管理密钥并查看真实用量。')}
      </p>

      <form className="guest-login-form" onSubmit={tryPasswordLogin}>
        <div className="field">
          <label htmlFor="login-username">{P('用户名', 'Username')}</label>
          <input
            id="login-username"
            name="username"
            autoComplete="username"
            value={username}
            disabled={anyBusy}
            onChange={(ev) => setUsername(ev.target.value)}
            placeholder={P('用户名', 'Username')}
          />
        </div>
        <div className="field">
          <label htmlFor="login-password">{P('密码', 'Password')}</label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={anyBusy}
            onChange={(ev) => setPassword(ev.target.value)}
            placeholder={P('密码', 'Password')}
          />
        </div>
        <button type="submit" className="button soft block guest-login-btn" disabled={anyBusy}>
          {loginBusy ? P('正在登录…', 'Signing in…') : P('账号登录', 'Sign in')} →
        </button>
      </form>

      <div className="guest-divider" role="separator">
        <span>{P('或', 'or')}</span>
      </div>

      <div className="guest-oauth">
        <button type="button" className="button soft block guest-login-btn" disabled={anyBusy} onClick={tryLinuxDo}>
          <span className="linuxdo-mark" />
          {busy ? P('正在跳转…', 'Redirecting…') : P('使用 Linux.do 登录')} →
        </button>
        <div className="field-note">{P('只申请必要的社区身份信息')}</div>
      </div>

      {msg ? <p className="guest-error">{msg}</p> : null}
    </div>
  )
}
