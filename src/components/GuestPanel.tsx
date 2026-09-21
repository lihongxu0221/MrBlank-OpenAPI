import { useEffect, useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { P } from '../i18n'
import { api } from '../lib/api'
import { setSession, type Session } from '../lib/session'
import { navigate } from '../router/hash'

export function GuestPanel({ onLoggedIn }: { onLoggedIn?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [ailyBusy, setAilyBusy] = useState(false)
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

  async function tryAily(e: FormEvent) {
    e.preventDefault()
    const u = username.trim()
    if (!u || !password) {
      setMsg(P('请输入用户名和密码。', 'Enter username and password.'))
      return
    }
    setAilyBusy(true)
    setMsg(null)
    try {
      const data = await api.post<Session & { is_admin?: boolean }>(
        '/api/auth/aily',
        { username: u, password },
        { auth: false },
      )
      setPassword('')
      setSession(data)
      onLoggedIn?.()
      navigate(data.is_admin ? '/admin' : '/console')
    } catch (err) {
      setMsg((err as Error).message)
    } finally {
      setAilyBusy(false)
    }
  }

  const anyBusy = busy || ailyBusy

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
      <button type="button" className="button block" disabled={anyBusy} onClick={tryLinuxDo}>
        <span className="linuxdo-mark" />
        {busy ? P('正在跳转…', 'Redirecting…') : P('使用 Linux.do 登录')} →
      </button>
      <div className="field-note">{P('只申请必要的社区身份信息')}</div>

      <div className="guest-divider" role="separator">
        <span>{P('或', 'or')}</span>
      </div>

      <form className="guest-aily-form" onSubmit={tryAily}>
        <div className="field">
          <label htmlFor="aily-username">{P('用户名', 'Username')}</label>
          <input
            id="aily-username"
            name="username"
            autoComplete="username"
            value={username}
            disabled={anyBusy}
            onChange={(ev) => setUsername(ev.target.value)}
            placeholder={P('Aily 账号用户名', 'Aily username')}
          />
        </div>
        <div className="field">
          <label htmlFor="aily-password">{P('密码', 'Password')}</label>
          <input
            id="aily-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={anyBusy}
            onChange={(ev) => setPassword(ev.target.value)}
            placeholder={P('密码', 'Password')}
          />
        </div>
        <button type="submit" className="button secondary block" disabled={anyBusy}>
          {ailyBusy ? P('正在登录…', 'Signing in…') : P('使用 Aily 账号登录', 'Sign in with Aily')} →
        </button>
        <div className="field-note">{P('由本站校验 Aily 账号，不会把上游会话写入浏览器')}</div>
      </form>

      {msg ? <p style={{ color: 'var(--error)', marginTop: 14 }}>{msg}</p> : null}
    </div>
  )
}
