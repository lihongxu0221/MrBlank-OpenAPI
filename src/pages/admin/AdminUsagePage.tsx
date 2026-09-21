import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'

type Usage = {
  total_requests: number
  success_count: number
  failure_count: number
  total_tokens: number
  by_model: { model: string; calls: number; failed: number; tokens: number }[]
  by_endpoint: { endpoint: string; calls: number; failed: number; tokens: number }[]
}

export function AdminUsagePage({ path }: { path: string }) {
  const gate = useAdminGate()
  const [data, setData] = useState<Usage | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      setData(await api.get<Usage>('/api/admin/usage'))
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
      <ConsoleHero title={P('用量监控')} subtitle={P('CPAMP 全局用量汇总（非单用户过滤）。')} />
      <div className="channels-toolbar">
        <span className="muted">
          {data
            ? `${P('请求')} ${data.total_requests.toLocaleString('zh-CN')} · tokens ${data.total_tokens.toLocaleString('zh-CN')}`
            : ''}
        </span>
        <button type="button" className="button secondary compact" onClick={load} disabled={loading}>
          <RefreshCw size={14} /> {P('刷新')}
        </button>
      </div>
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">{P('成功')}</div>
          <div className="value">{data?.success_count?.toLocaleString('zh-CN') ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="label">{P('失败')}</div>
          <div className="value">{data?.failure_count?.toLocaleString('zh-CN') ?? '—'}</div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3>{P('按模型')}</h3>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{P('模型')}</th>
                <th>{P('调用次数')}</th>
                <th>{P('失败')}</th>
                <th>tokens</th>
              </tr>
            </thead>
            <tbody>
              {(data?.by_model || []).map((r) => (
                <tr key={r.model}>
                  <td>{r.model}</td>
                  <td>{r.calls}</td>
                  <td>{r.failed}</td>
                  <td>{r.tokens.toLocaleString('zh-CN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !(data?.by_model || []).length ? <p className="empty-state">{P('暂无用量数据。')}</p> : null}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3>{P('按接口')}</h3>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{P('接口')}</th>
                <th>{P('调用次数')}</th>
                <th>{P('失败')}</th>
                <th>tokens</th>
              </tr>
            </thead>
            <tbody>
              {(data?.by_endpoint || []).map((r) => (
                <tr key={r.endpoint}>
                  <td>
                    <code>{r.endpoint}</code>
                  </td>
                  <td>{r.calls}</td>
                  <td>{r.failed}</td>
                  <td>{r.tokens.toLocaleString('zh-CN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  )
}
