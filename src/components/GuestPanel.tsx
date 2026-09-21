import { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { P } from '../i18n'
import { api } from '../lib/api'

export function GuestPanel({ onLoggedIn }: { onLoggedIn?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

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
      <button type="button" className="button block" disabled={busy} onClick={tryLinuxDo}>
        <span className="linuxdo-mark" />
        {busy ? P('正在跳转…', 'Redirecting…') : P('使用 Linux.do 登录')} →
      </button>
      <div className="field-note">{P('只申请必要的社区身份信息')}</div>
      {msg ? <p style={{ color: 'var(--error)', marginTop: 14 }}>{msg}</p> : null}
    </div>
  )
}
