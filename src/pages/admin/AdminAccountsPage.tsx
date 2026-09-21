import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'

type Account = {
  id: string
  label?: string
  email?: string | null
  provider?: string | null
  status?: string | null
  disabled?: boolean
  unavailable?: boolean
  success?: number
  failed?: number
  last_refresh?: string | null
  status_message?: string
  recent_requests?: { time?: string; success?: number; failed?: number }[]
}

type Pool = {
  total: number
  active: number
  unavailable: number
  disabled: number
  by_provider: { provider: string; count: number }[]
}

export function AdminAccountsPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const [items, setItems] = useState<Account[]>([])
  const [pool, setPool] = useState<Pool | null>(null)
  const [observedAt, setObservedAt] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      const d = await api.get<{ items: Account[]; observed_at?: string; pool?: Pool }>('/api/admin/accounts')
      setItems(d.items || [])
      setPool(d.pool || null)
      setObservedAt(d.observed_at || '')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (gate.allowed) load()
  }, [gate.allowed])

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero title={P('上游账号')} subtitle={P('来自 CPA auth-files（Management Key + collector）；可强制刷新。')} />
      <div className="channels-toolbar">
        <span className="muted">
          {observedAt
            ? `${P('观测时间')} · ${new Date(observedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`
            : ''}
        </span>
        <button type="button" className="button secondary compact" onClick={load} disabled={loading}>
          <RefreshCw size={14} /> {P('刷新')}
        </button>
      </div>
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}

      {pool ? (
        <div className="stats-grid" style={{ marginBottom: 16 }}>
          <div className="stat-card">
            <div className="label">{P('号池总数')}</div>
            <div className="value">{pool.total}</div>
          </div>
          <div className="stat-card">
            <div className="label">{P('可用')}</div>
            <div className="value">{pool.active}</div>
          </div>
          <div className="stat-card">
            <div className="label">{P('不可用')}</div>
            <div className="value">{pool.unavailable}</div>
          </div>
          <div className="stat-card">
            <div className="label">{P('已禁用')}</div>
            <div className="value">{pool.disabled}</div>
          </div>
        </div>
      ) : null}

      {pool?.by_provider?.length ? (
        <p className="muted" style={{ marginBottom: 12 }}>
          {P('按提供方')} · {pool.by_provider.map((p) => `${p.provider} ${p.count}`).join(' · ')}
        </p>
      ) : null}

      <div className="channel-grid">
        {items.map((a) => {
          const bad = a.disabled || a.unavailable
          return (
            <article key={a.id} className="channel-card panel">
              <div className={`health-badge ${bad ? 'down' : 'ok'}`}>
                ● {bad ? P('异常') : a.status || P('正常')}
              </div>
              <h3>{a.label || a.email || a.id}</h3>
              <div className="channel-meta">
                <div>
                  <span className="label">{P('提供方')}</span>
                  <strong>{a.provider || '—'}</strong>
                </div>
                <div>
                  <span className="label">OK / Fail</span>
                  <strong>
                    {a.success ?? 0} / {a.failed ?? 0}
                  </strong>
                </div>
              </div>
              {a.status_message ? <p className="muted">{a.status_message}</p> : null}
              <div className="channel-foot">
                <span>
                  {P('最近刷新')} ·{' '}
                  {a.last_refresh
                    ? new Date(a.last_refresh).toLocaleString('zh-CN', {
                        timeZone: 'Asia/Shanghai',
                        hour12: false,
                      })
                    : '—'}
                </span>
              </div>
              {a.recent_requests?.length ? (
                <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                  {P('近期请求')} ·{' '}
                  {a.recent_requests
                    .slice(-6)
                    .map((r, i) => `${r.time || i}: ${r.success ?? 0}/${r.failed ?? 0}`)
                    .join(' · ')}
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
      {!loading && !items.length && !err ? <p className="empty-state">{P('暂无上游账号。')}</p> : null}
    </AdminLayout>
  )
}
