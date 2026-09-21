import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { formatCredits, setQuotaPerUnit } from '../../lib/format'
import { P, qt } from '../../i18n'
import { ConsoleLayout } from './ConsoleLayout'
import { useToast } from '../../hooks/useStore'

export function CheckinPage({ path }: { path: string }) {
  const [data, setData] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const { toast, showToast } = useToast()

  async function load() {
    const status = await api.get<{ quota_per_unit: number }>('/api/status', { auth: false })
    setQuotaPerUnit(status.quota_per_unit)
    setData(await api.get('/api/user/checkin'))
  }

  useEffect(() => {
    load().catch((e) => showToast(e.message))
  }, [])

  async function claim() {
    setBusy(true)
    try {
      const res = await api.post<{ quota_awarded: number }>('/api/user/checkin', {}, { proof: 'mock-grant' })
      showToast(qt(P('签到成功！已获得 {quota}。'), { quota: formatCredits(res.quota_awarded) + ' ' + P('点') }))
      await load()
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const records: { checkin_date: string; quota_awarded: number }[] = data?.stats?.records || []
  const month = data?.month || ''
  const daysInMonth = month ? new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate() : 30
  const checked = new Set(records.map((r) => r.checkin_date))
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })

  return (
    <ConsoleLayout path={path} title={P('每日签到')} subtitle={P('把每一份社区资源，用在新的可能上。')}>
      <div className="checkin-card panel">
        <div className="eyebrow">{P('每日一份好奇心')}</div>
        <h2>{data?.stats?.checked_in_today ? P('今天的探索额度，已到账') : P('新的一天，新的可能')}</h2>
        <p style={{ color: 'var(--muted)' }}>
          {data?.claimable
            ? P('完成轻量验证，领取今天的公益额度。')
            : data?.unavailable_reason || P('今日已签到')}
        </p>
        <div style={{ margin: '12px 0', color: 'var(--muted)', fontSize: 13 }}>
          {P('每日签到额度 · 以服务器日期为准')} · {formatCredits(data?.min_quota || 0)} – {formatCredits(data?.max_quota || 0)} {P('点')}
        </div>
        <button type="button" className="button" disabled={!data?.claimable || busy} onClick={claim}>
          {data?.stats?.checked_in_today ? P('今日已签到') : P('验证并签到')}
        </button>
        <div style={{ marginTop: 12, color: 'var(--muted)', fontSize: 13 }}>
          {qt(P('本月签到 {month} 天 · 累计 {total} 天'), {
            month: data?.stats?.checkin_count ?? 0,
            total: data?.stats?.total_checkins ?? 0,
          })}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3>{P('本月签到记录')}</h3>
        <div className="calendar-weekdays">
          {['一', '二', '三', '四', '五', '六', '日'].map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="calendar-grid">
          {Array.from({ length: daysInMonth }, (_, i) => {
            const date = `${month}-${String(i + 1).padStart(2, '0')}`
            return (
              <div
                key={date}
                className={`calendar-day ${checked.has(date) ? 'checked' : ''} ${date === today ? 'today' : ''}`}
              >
                {i + 1}
              </div>
            )
          })}
        </div>
      </div>
      {toast ? <div className="toast">{toast}</div> : null}
    </ConsoleLayout>
  )
}
