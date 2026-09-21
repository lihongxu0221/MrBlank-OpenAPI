import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'
import { DiagnosisModal } from './diagnosis/DiagnosisModal'

type Usage = {
  total_requests: number
  success_count: number
  failure_count: number
  total_tokens: number
  by_model: { model: string; calls: number; failed: number; tokens: number }[]
  by_endpoint: { endpoint: string; calls: number; failed: number; tokens: number }[]
  source?: string
}

type DiagItem = {
  id: string
  created_at?: string
  endpoint?: string
  model_name?: string
  requested_model?: string
  status_code?: number
  duration_ms?: number | null
  ip?: string
  token_name?: string
  has_detail?: boolean
  type?: number
  prompt_tokens?: number
  completion_tokens?: number
}

type DiagList = {
  items: DiagItem[]
  total: number
  stats?: { total: number; with_detail: number; path?: string }
  note?: string
}

function fmtTime(iso?: string) {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return String(iso)
  }
}

export function AdminUsagePage({ path }: { path: string }) {
  const gate = useAdminGate()
  const [data, setData] = useState<Usage | null>(null)
  const [logs, setLogs] = useState<DiagList | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [diagId, setDiagId] = useState<string | null>(null)
  const coarse = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches,
    [],
  )

  const load = useCallback(async () => {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      const [usage, diag] = await Promise.all([
        api.get<Usage>('/api/admin/usage'),
        api.get<DiagList>('/api/admin/diagnosis/logs?limit=50'),
      ])
      setData(usage)
      setLogs(diag)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [gate.allowed])

  useEffect(() => {
    if (gate.allowed) load()
  }, [gate.allowed, load])

  const successRate = useMemo(() => {
    if (!data) return null
    const total = Number(data.total_requests) || 0
    if (!total) return null
    return ((Number(data.success_count) || 0) / total) * 100
  }, [data])

  function openRow(row: DiagItem, fromButton = false) {
    if (fromButton) return
    if (!gate.allowed) return
    setDiagId(row.id)
  }

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero
        title={P('用量监控')}
        subtitle={P('CPAMP 汇总 + BFF 请求诊断（双击行打开「请求诊断详情」；触控单击）。')}
      />
      <div className="channels-toolbar">
        <span className="muted">
          {data
            ? `${P('请求')} ${data.total_requests.toLocaleString('zh-CN')} · tokens ${data.total_tokens.toLocaleString('zh-CN')}${
                successRate != null ? ` · ${P('成功率')} ${successRate.toFixed(1)}%` : ''
              }`
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
        <div className="stat-card">
          <div className="label">{P('成功率')}</div>
          <div className="value">{successRate != null ? `${successRate.toFixed(1)}%` : '—'}</div>
        </div>
        <div className="stat-card">
          <div className="label">tokens</div>
          <div className="value">{data?.total_tokens?.toLocaleString('zh-CN') ?? '—'}</div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3>{P('请求诊断')}</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          {logs?.note ||
            P('经本站 BFF /v1 转发的调用会落盘 req/res Body（脱敏）。CPAMP 汇总不含正文。')}
          {logs?.stats
            ? ` · 已捕获 ${logs.stats.total} 条（含正文 ${logs.stats.with_detail}）`
            : ''}
        </p>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{P('时间')}</th>
                <th>{P('路径')}</th>
                <th>{P('模型')}</th>
                <th>HTTP</th>
                <th>{P('耗时')}</th>
                <th>IP</th>
                <th>{P('正文')}</th>
              </tr>
            </thead>
            <tbody>
              {(logs?.items || []).map((row) => {
                const bad = Number(row.status_code) >= 400 || Number(row.type) === 5
                return (
                  <tr
                    key={row.id}
                    className="diag-row"
                    title={coarse ? P('单击打开诊断') : P('双击打开诊断')}
                    onDoubleClick={() => {
                      if (!coarse) openRow(row)
                    }}
                    onClick={() => {
                      if (coarse) openRow(row)
                    }}
                  >
                    <td>{fmtTime(row.created_at)}</td>
                    <td>
                      <code>{row.endpoint || '-'}</code>
                    </td>
                    <td>{row.requested_model || row.model_name || '-'}</td>
                    <td>
                      <span className={`st-badge ${bad ? 'bad' : 'ok'}`}>{row.status_code || '-'}</span>
                    </td>
                    <td>{row.duration_ms != null ? `${row.duration_ms} ms` : '-'}</td>
                    <td>{row.ip || '-'}</td>
                    <td>{row.has_detail ? P('有') : P('无')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {!loading && !(logs?.items || []).length ? (
          <p className="empty-state">
            {P('暂无 BFF 诊断记录。请用任意 API Key 调用 https://openapi.juc114.cn/v1/... 后再刷新。')}
          </p>
        ) : null}
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

      {diagId ? <DiagnosisModal id={diagId} onClose={() => setDiagId(null)} /> : null}
    </AdminLayout>
  )
}
