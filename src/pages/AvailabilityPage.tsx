import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { P } from '../i18n'

type Model = {
  id: string
  status: string
  latency_ms?: number
  history?: { checked_at: string; status: string; latency_ms?: number }[]
}
type Group = { name?: string; checked_at?: string; models: Model[] }

export function AvailabilityPage() {
  const [groups, setGroups] = useState<Group[]>([])
  const [checkedAt, setCheckedAt] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    setErr(null)
    try {
      const data = await api.get<{ checked_at: string; groups: Group[] }>('/api/welfare/availability', {
        auth: false,
      })
      setGroups(data.groups || [])
      setCheckedAt(data.checked_at || '')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div className="page">
      <div className="eyebrow">SYSTEM STATUS</div>
      <h1>{P('每一次响应，清晰可见')}</h1>
      <p className="page-lead">{P('从对话到创作，查看模型最近实测结果与检测历史。')}</p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}>
        <button type="button" className="button secondary" onClick={load}>
          {P('刷新状态')}
        </button>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>
          {checkedAt ? `${P('最近检测')} · ${checkedAt}` : ''}
        </span>
      </div>
      {loading ? <p className="inline-loading">{P('正在获取最近检测记录…')}</p> : null}
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}
      <div className="model-health-list">
        {groups.flatMap((g) =>
          (g.models || []).map((m) => (
            <div key={m.id} className="model-health-row">
              <div>
                <strong>{m.id}</strong>
                {g.name ? <div style={{ color: 'var(--muted)', fontSize: 12 }}>{g.name}</div> : null}
              </div>
              <span className={`health-badge ${m.status === 'operational' ? '' : 'warn'}`}>
                {m.status === 'operational' ? P('正常') : m.status === 'degraded' ? P('部分受限') : P('暂不可用')}
              </span>
              <div>{m.latency_ms != null ? `${m.latency_ms} ms` : '—'}</div>
              <div className="history-track">
                {(m.history || []).slice(0, 24).reverse().map((h, i) => (
                  <div key={i} className={`history-bar ${h.status === 'operational' ? 'ok' : ''}`} style={{ height: `${Math.min(28, Math.max(4, (h.latency_ms || 100) / 40))}px` }} />
                ))}
              </div>
            </div>
          )),
        )}
      </div>
      {!loading && !groups.length && !err ? <p className="empty-state">{P('尚无模型检测记录，请稍后回来。')}</p> : null}
    </div>
  )
}
