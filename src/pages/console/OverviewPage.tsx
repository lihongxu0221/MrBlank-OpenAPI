import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { formatCredits, setQuotaPerUnit } from '../../lib/format'
import { P } from '../../i18n'
import { navigate } from '../../router/hash'
import { ConsoleLayout } from './ConsoleLayout'

export function OverviewPage({ path }: { path: string }) {
  const [self, setSelf] = useState<any>(null)
  const [days, setDays] = useState<{ date: string; requests: number }[]>([])

  useEffect(() => {
    api.get<{ quota_per_unit: number }>('/api/status', { auth: false }).then((s) => setQuotaPerUnit(s.quota_per_unit))
    api.get('/api/user/self').then(setSelf).catch(() => {})
    api.get<{ days: { date: string; requests: number }[] }>('/api/user/dashboard').then((d) => setDays(d.days || [])).catch(() => {})
  }, [])

  const maxReq = Math.max(1, ...days.map((d) => d.requests))

  return (
    <ConsoleLayout path={path} title={P('概览')} subtitle={P('每一次好奇，都值得认真回应。')}>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">{P('可用额度')}</div>
          <div className="value">{self ? formatCredits(self.quota) : '—'}</div>
          <div className="hint">{P('签到与兑换所得')}</div>
        </div>
        <div className="stat-card">
          <div className="label">{P('累计使用')}</div>
          <div className="value">{self ? formatCredits(self.used_quota ?? self.settled_quota ?? 0) : '—'}</div>
          <div className="hint">{P('账户实际累计消耗')}</div>
        </div>
        <div className="stat-card">
          <div className="label">{P('调用次数')}</div>
          <div className="value">{self?.request_count ?? '—'}</div>
          <div className="hint">{P('账户累计模型请求')}</div>
        </div>
        <div className="stat-card">
          <div className="label">{P('账户并发')}</div>
          <div className="value">{self?.concurrency_limit ?? 5}</div>
          <div className="hint">{P('同时进行中的请求上限')}</div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="panel">
          <h3>{P('近 7 日调用')}</h3>
          <div className="chart-row">
            {days.map((d) => (
              <div key={d.date} className="chart-column" style={{ height: `${(d.requests / maxReq) * 100}%` }}>
                <span className="chart-day">{d.date.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <h3>{P('连接你的下一个好想法')}</h3>
          <p style={{ color: 'var(--muted)' }}>{P('创建密钥，再把这个地址填入客户端的 Base URL。')}</p>
          <div className="endpoint-row">https://welfare.darkforger.com/v1</div>
          <button type="button" className="button" onClick={() => navigate('/keys')}>
            {P('管理 API 密钥')}
          </button>
        </div>
      </div>
    </ConsoleLayout>
  )
}
