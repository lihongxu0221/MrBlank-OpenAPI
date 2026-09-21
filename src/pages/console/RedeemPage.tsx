import { useState } from 'react'
import { api } from '../../lib/api'
import { formatCredits, setQuotaPerUnit } from '../../lib/format'
import { P, qt } from '../../i18n'
import { ConsoleLayout } from './ConsoleLayout'
import { useToast } from '../../hooks/useStore'

export function RedeemPage({ path }: { path: string }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const { toast, showToast } = useToast()

  async function redeem() {
    setBusy(true)
    try {
      const status = await api.get<{ quota_per_unit: number }>('/api/status', { auth: false })
      setQuotaPerUnit(status.quota_per_unit)
      const awarded = await api.post<number>('/api/user/topup', { key })
      showToast(qt(P('兑换成功，获得 {quota}。'), { quota: formatCredits(awarded) + ' ' + P('点') }))
      setKey('')
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConsoleLayout path={path} title={P('兑换码')} subtitle={P('来自社区的心意')}>
      <div className="panel">
        <div className="eyebrow">{P('给灵感，添一份惊喜')}</div>
        <h2>{P('输入社区发放的兑换码，领取额外额度。')}</h2>
        <div className="field">
          <label>{P('社区兑换码')}</label>
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder={P('在这里粘贴兑换码')} />
        </div>
        <button type="button" className="button" disabled={!key.trim() || busy} onClick={redeem}>
          {busy ? P('正在兑换…') : P('兑换额度')}
        </button>
        <p className="field-note">{P('每个兑换码仅可使用一次。')}</p>
        <p className="field-note">{P('本站仅通过每日签到与兑换码发放额度。')}</p>
        <p className="field-note">{P('演示可用：WELCOME / GROK2026 / COMMUNITY / DARKFORGER', 'Demo codes: WELCOME / GROK2026 / COMMUNITY / DARKFORGER')}</p>
      </div>
      {toast ? <div className="toast">{toast}</div> : null}
    </ConsoleLayout>
  )
}
