import { useEffect, useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { P } from '../i18n'
import { api } from '../lib/api'
import { setSession, type Session } from '../lib/session'
import { getHashQuery, navigate } from '../router/hash'

type Mode = 'login' | 'register'

export function GuestPanel({ onLoggedIn }: { onLoggedIn?: () => void }) {
  const [mode, setMode] = useState<Mode>('login')
  const [busy, setBusy] = useState(false)
  const [formBusy, setFormBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')

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

  function afterAuth(data: Session & { is_admin?: boolean }) {
    setPassword('')
    setPassword2('')
    setSession(data)
    onLoggedIn?.()
    const next = getHashQuery().get('next')
    if (next && next.startsWith('/') && !next.startsWith('//')) {
      navigate(next)
    } else {
      navigate(data.is_admin ? '/admin' : '/console')
    }
  }

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

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const u = username.trim()
    if (!u || !password) {
      setMsg(P('请输入用户名和密码。', 'Enter username and password.'))
      return
    }
    if (mode === 'register') {
      if (password.length < 6) {
        setMsg(P('密码至少 6 个字符。', 'Password must be at least 6 characters.'))
        return
      }
      if (password !== password2) {
        setMsg(P('两次输入的密码不一致。', 'Passwords do not match.'))
        return
      }
    }
    setFormBusy(true)
    setMsg(null)
    try {
      const path = mode === 'register' ? '/api/auth/register' : '/api/auth/login'
      const data = await api.post<Session & { is_admin?: boolean }>(path, { username: u, password }, { auth: false })
      afterAuth(data)
    } catch (err) {
      setMsg((err as Error).message)
    } finally {
      setFormBusy(false)
    }
  }

  const anyBusy = busy || formBusy

  return (
    <div className="guest-state">
      <div className="guest-icon">
        <KeyRound size={22} />
      </div>
      <h2>{mode === 'register' ? P('创建本站账号') : P('你的探索，从登录开始')}</h2>
      <p>
        {mode === 'register'
          ? P('注册后即可领取每日额度、管理密钥并查看用量。')
          : P('登录后可以领取每日额度、兑换社区礼物、管理密钥并查看真实用量。')}
      </p>

      <form className="guest-login-form" onSubmit={onSubmit}>
        <div className="field">
          <input
            id="login-username"
            name="username"
            autoComplete="username"
            aria-label={P('用户名', 'Username')}
            value={username}
            disabled={anyBusy}
            onChange={(ev) => setUsername(ev.target.value)}
            placeholder={P('用户名', 'Username')}
          />
        </div>
        <div className="field">
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            aria-label={P('密码', 'Password')}
            value={password}
            disabled={anyBusy}
            onChange={(ev) => setPassword(ev.target.value)}
            placeholder={P('密码', 'Password')}
          />
        </div>
        {mode === 'register' ? (
          <div className="field">
            <input
              id="login-password2"
              name="password2"
              type="password"
              autoComplete="new-password"
              aria-label={P('确认密码', 'Confirm password')}
              value={password2}
              disabled={anyBusy}
              onChange={(ev) => setPassword2(ev.target.value)}
              placeholder={P('确认密码', 'Confirm password')}
            />
          </div>
        ) : null}
        <button type="submit" className="button soft block guest-login-btn" disabled={anyBusy}>
          {formBusy
            ? mode === 'register'
              ? P('正在注册…', 'Registering…')
              : P('正在登录…', 'Signing in…')
            : mode === 'register'
              ? P('注册账号', 'Create account')
              : P('账号登录', 'Sign in')}{' '}
          →
        </button>
      </form>

      <button
        type="button"
        className="guest-switch"
        disabled={anyBusy}
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login')
          setMsg(null)
          setPassword2('')
        }}
      >
        {mode === 'login' ? P('没有账号？注册') : P('已有账号？去登录')}
      </button>

      <div className="guest-divider" role="separator">
        <span>{P('或', 'or')}</span>
      </div>

      <div className="guest-oauth">
        <button type="button" className="button soft block guest-login-btn" disabled={anyBusy} onClick={tryLinuxDo}>
          <span className="linuxdo-mark" />
          {busy ? P('正在跳转…', 'Redirecting…') : P('使用 Linux.do 登录')} →
        </button>
      </div>

      {msg ? <p className="guest-error">{msg}</p> : null}
    </div>
  )
}
