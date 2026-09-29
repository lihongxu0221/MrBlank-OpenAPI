import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '../../lib/api'
import { formatCredits, setQuotaPerUnit } from '../../lib/format'
import { P, qt } from '../../i18n'
import { ConsoleLayout } from './ConsoleLayout'
import { ConsoleHero } from '../../components/ConsoleHero'
import { CheckinClaimCard } from '../../components/CheckinClaimCard'
import { useToast } from '../../hooks/useStore'

export function CheckinPage({ path }: { path: string }) {
  const [data, setData] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [viewMonth, setViewMonth] = useState('')
  const { toast, showToast } = useToast()

  async function load(m?: string) {
    const status = await api.get<{ quota_per_unit: number }>('/api/status', { auth: false })
    setQuotaPerUnit(status.quota_per_unit)
    const q = m ? `?month=${m}` : ''
    const res = await api.get(`/api/user/checkin${q}`)
    setData(res)
    setViewMonth((res as any).month || m || '')
  }

  useEffect(() => {
    load().catch((e) => showToast(e.message))
  }, [])

  async function claim() {
    setBusy(true)
    try {
      const res = await api.post<{ quota_awarded: number }>('/api/user/checkin', {})
      showToast(qt(P('签到成功！已获得 {quota}。'), { quota: formatCredits(res.quota_awarded) + ' ' + P('点') }))
      await load(viewMonth)
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const records: { checkin_date: string; quota_awarded: number }[] = data?.stats?.records || []
  const month = viewMonth || data?.month || ''
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  const checked = new Set(records.map((r) => r.checkin_date))
  const monthQuota = records.reduce((s, r) => s + r.quota_awarded, 0)

  const calendar = useMemo(() => {
    if (!month) return { cells: [] as (number | null)[], label: '', daysInMonth: 0 }
    const y = Number(month.slice(0, 4))
    const mo = Number(month.slice(5, 7))
    const daysInMonth = new Date(y, mo, 0).getDate()
    // Monday-first offset
    const first = new Date(y, mo - 1, 1)
    let weekday = first.getDay() // 0 Sun
    weekday = weekday === 0 ? 6 : weekday - 1
    const cells: (number | null)[] = Array.from({ length: weekday }, () => null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(d)
    while (cells.length % 7 !== 0) cells.push(null)
    const label = P(`${y}年${mo}月`, `${y}-${String(mo).padStart(2, '0')}`)
    return { cells, label, daysInMonth, y, mo }
  }, [month])

  function shiftMonth(delta: number) {
    if (!month) return
    const y = Number(month.slice(0, 4))
    const mo = Number(month.slice(5, 7))
    const d = new Date(y, mo - 1 + delta, 1)
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    load(next).catch((e) => showToast(e.message))
  }

  const currentMonth = today.slice(0, 7)

  return (
    <ConsoleLayout path={path} bare>
      <ConsoleHero title={P('每日签到')} subtitle={P('把每一份社区资源，用在新的可能上。')} />

      <div className="checkin-layout">
        <CheckinClaimCard
          data={data}
          className="checkin-claim"
          actionDisabled={!data?.claimable || busy}
          actionBusy={busy}
          onAction={claim}
        />

        <div className="panel checkin-calendar">
          <div className="eyebrow">YOUR DAILY MOMENTS</div>
          <div className="cal-toolbar">
            <button type="button" className="icon-btn" onClick={() => shiftMonth(-1)} aria-label="prev">
              <ChevronLeft size={16} />
            </button>
            <strong>{calendar.label}</strong>
            <button type="button" className="icon-btn" onClick={() => shiftMonth(1)} aria-label="next">
              <ChevronRight size={16} />
            </button>
            {month !== currentMonth ? (
              <button type="button" className="button ghost compact" onClick={() => load(currentMonth)}>
                {P('本月')}
              </button>
            ) : (
              <span className="pill">{P('本月')}</span>
            )}
          </div>
          <div className="cal-stats">
            <div>
              {qt(P('{n} 天的好奇心'), { n: data?.stats?.checkin_count ?? 0 })}
            </div>
            <div>
              {qt(P('本月已领取 {n} 点'), { n: formatCredits(monthQuota) })}
            </div>
          </div>
          <div className="calendar-weekdays">
            {['一', '二', '三', '四', '五', '六', '日'].map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="calendar-grid">
            {calendar.cells.map((day, i) => {
              if (day == null) return <div key={`e-${i}`} className="calendar-day empty" />
              const date = `${month}-${String(day).padStart(2, '0')}`
              return (
                <div
                  key={date}
                  className={`calendar-day ${checked.has(date) ? 'checked' : ''} ${date === today ? 'today' : ''}`}
                >
                  <span className="day-num">{day}</span>
                  {date === today ? <span className="day-tag">{P('今天')}</span> : <span className="day-dot" />}
                </div>
              )
            })}
          </div>
          <p className="cal-tip">{P('记录每一次小小的积累。每天北京时间零点开启新一天。')}</p>
        </div>
      </div>
      {toast ? <div className="toast">{toast}</div> : null}
    </ConsoleLayout>
  )
}
