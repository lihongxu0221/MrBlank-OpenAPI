import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { P } from '../i18n'
import { mockDevLogin } from '../lib/session'
import { navigate } from '../router/hash'
import { api } from '../lib/api'

export function GuestPanel({ onLoggedIn }: { onLoggedIn?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function tryLinuxDo() {
    setBusy(true)
    setMsg(null)
    try {
      const data = await api.post<{ flow_token: string; authorization_url: string | null }>(
        '/api/oauth/state',
        { provider: 'linuxdo', intent: 'login' },
        { auth: false, proof: 'mock-grant' },
      )
      if (data.authorization_url) {
        location.href = data.authorization_url
        return
      }
      setMsg(
        P(
          '演示环境未连接真实 Linux.do OAuth。请使用下方「开发者模拟登录」。',
          'Demo mode has no real Linux.do OAuth. Use Developer mock login below.',
        ),
      )
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function devLogin() {
    mockDevLogin()
    onLoggedIn?.()
    navigate('/console')
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
        {P('使用 Linux.do 登录')} →
      </button>
      <button type="button" className="button secondary block dev-login" onClick={devLogin}>
        {P('开发者模拟登录', 'Developer mock login')}
      </button>
      <div className="field-note">{P('只申请必要的社区身份信息')}</div>
      {msg ? <p style={{ color: 'var(--error)', marginTop: 14 }}>{msg}</p> : null}
    </div>
  )
}
