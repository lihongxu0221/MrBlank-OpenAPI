import { useState } from 'react'
import { Gift } from 'lucide-react'
import { api } from '../../lib/api'
import { formatCredits, setQuotaPerUnit } from '../../lib/format'
import { P, qt } from '../../i18n'
import { ConsoleLayout } from './ConsoleLayout'
import { ConsoleHero } from '../../components/ConsoleHero'
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
    <ConsoleLayout path={path} bare>
      <ConsoleHero title={P('兑换码')} subtitle={P('把每一份社区资源，用在新的可能上。')} />

      <div className="panel action-card redeem-card">
        <div className="action-card-top">
          <div className="action-icon">
            <Gift size={18} />
          </div>
          <span className="pill">{P('来自社区的心意')}</span>
        </div>
        <h3>{P('给灵感，添一份惊喜')}</h3>
        <p>{P('输入社区发放的兑换码，领取额外额度。')}</p>
        <div className="field">
          <label>{P('社区兑换码')}</label>
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder={P('在这里粘贴兑换码')} />
        </div>
        <button
          type="button"
          className="button secondary block"
          disabled={!key.trim() || busy}
          onClick={redeem}
        >
          <Gift size={16} /> {busy ? P('正在兑换…') : P('兑换额度')}
        </button>
        <div className="redeem-notes">
          <p className="field-note">{P('每个兑换码仅可使用一次。')}</p>
          <p className="field-note">{P('本站仅通过每日签到与兑换码发放额度。')}</p>
        </div>
      </div>
      {toast ? <div className="toast">{toast}</div> : null}
    </ConsoleLayout>
  )
}
