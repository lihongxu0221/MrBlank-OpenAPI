import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'

type Bucket = { t: number; requests: number; success: number; failure: number; tokens: number }
type ModelRow = {
  model: string
  requests: number
  success: number
  failure: number
  tokens: number
  series: number[]
}
type Analytics = {
  from_ms: number
  to_ms: number
  bucket_ms: number
  totals: { requests: number; success: number; failure: number; tokens: number }
  buckets: Bucket[]
  by_model: ModelRow[]
  source?: string
}

type SnapshotList = { items: { id: string; created_at?: string; model?: string; status_code?: number; endpoint?: string; content?: string }[]; note?: string }

const RANGES = [
  { id: '1h', label: '1 小时', ms: 3600000 },
  { id: '6h', label: '6 小时', ms: 6 * 3600000 },
  { id: '24h', label: '24 小时', ms: 24 * 3600000 },
  { id: '7d', label: '7 天', ms: 7 * 86400000 },
]

function fmtTime(ms: number) {
  return new Date(ms).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}

export function AdminMonitoringPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const [range, setRange] = useState('24h')
  const [data, setData] = useState<Analytics | null>(null)
  const [snaps, setSnaps] = useState<SnapshotList | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      const span = RANGES.find((r) => r.id === range)?.ms || 86400000
      const toMs = Date.now()
      const fromMs = toMs - span
      const [analytics, headerSnaps] = await Promise.all([
        api.post<Analytics>('/api/admin/monitoring/analytics', { from_ms: fromMs, to_ms: toMs }),
        api.get<SnapshotList>('/api/admin/monitoring/header-snapshots?limit=20'),
      ])
      setData(analytics)
      setSnaps(headerSnaps)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [gate.allowed, range])

  useEffect(() => {
    if (!gate.allowed) return
    load()
  }, [gate.allowed, load])

  const maxReq = useMemo(() => Math.max(1, ...(data?.buckets.map((b) => b.requests) || [1])), [data])

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero
        title={P('请求监控')}
        subtitle={P('基于本站 site-usage 的时间序列分析（非 CPAMP usage.sqlite）。')}
      />
      <div className="channels-toolbar">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`button compact ${range === r.id ? '' : 'secondary'}`}
              onClick={() => setRange(r.id)}
            >
              {P(r.label)}
            </button>
          ))}
        </div>
        <button type="button" className="button secondary compact" onClick={load} disabled={loading}>
          <RefreshCw size={14} /> {P('刷新')}
        </button>
      </div>
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">{P('请求')}</div>
          <div className="value">{data?.totals.requests?.toLocaleString('zh-CN') ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="label">{P('成功')}</div>
          <div className="value">{data?.totals.success?.toLocaleString('zh-CN') ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="label">{P('失败')}</div>
          <div className="value">{data?.totals.failure?.toLocaleString('zh-CN') ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="label">{P('Tokens')}</div>
          <div className="value">{data?.totals.tokens?.toLocaleString('zh-CN') ?? '—'}</div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>{P('时间桶')}</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          {data
            ? `${fmtTime(data.from_ms)} → ${fmtTime(data.to_ms)} · bucket ${(data.bucket_ms / 60000).toFixed(0)} min`
            : '—'}
        </p>
        <div className="mini-bars">
          {(data?.buckets || []).map((b) => (
            <div key={b.t} className="mini-bar" title={`${fmtTime(b.t)} · ${b.requests} req`}>
              <div
                className="mini-bar-fill"
                style={{ height: `${Math.max(4, (b.requests / maxReq) * 100)}%` }}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>{P('按模型')}</h3>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{P('模型')}</th>
                <th>{P('请求')}</th>
                <th>{P('成功')}</th>
                <th>{P('失败')}</th>
                <th>{P('Tokens')}</th>
              </tr>
            </thead>
            <tbody>
              {(data?.by_model || []).slice(0, 40).map((m) => (
                <tr key={m.model}>
                  <td>
                    <code>{m.model}</code>
                  </td>
                  <td>{m.requests}</td>
                  <td>{m.success}</td>
                  <td>{m.failure}</td>
                  <td>{m.tokens.toLocaleString('zh-CN')}</td>
                </tr>
              ))}
              {!data?.by_model?.length ? (
                <tr>
                  <td colSpan={5} className="muted">
                    {P('暂无数据')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>{P('Header / 错误快照')}</h3>
        <p className="muted">{snaps?.note || P('来自诊断失败记录（CPA 无 header-snapshots）。')}</p>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{P('时间')}</th>
                <th>{P('模型')}</th>
                <th>{P('状态')}</th>
                <th>{P('端点')}</th>
              </tr>
            </thead>
            <tbody>
              {(snaps?.items || []).map((s) => (
                <tr key={s.id}>
                  <td>{s.created_at ? fmtTime(Date.parse(s.created_at)) : '—'}</td>
                  <td>{s.model || '—'}</td>
                  <td>{s.status_code ?? '—'}</td>
                  <td>
                    <code>{s.endpoint || '—'}</code>
                  </td>
                </tr>
              ))}
              {!snaps?.items?.length ? (
                <tr>
                  <td colSpan={4} className="muted">
                    {P('暂无快照')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  )
}
