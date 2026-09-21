import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  Cable,
  ExternalLink,
  Gauge,
  KeyRound,
  RefreshCw,
  Users,
  Zap,
} from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'
import { navigate } from '../../router/hash'

type Overview = {
  checked_at?: string
  health?: any
  models?: { ok: boolean; count: number; latency_ms?: number | null; error?: string | null }
  usage?: { total_requests: number; success_count: number; failure_count: number; total_tokens: number } | null
  accounts?: { total: number; active: number; unavailable: number }
  api_keys?: { total: number }
  public_api_base?: string
  pool?: { total: number; active: number; unavailable: number; disabled: number; by_provider: { provider: string; count: number }[] }
  ops?: { www_cpamp?: string; openapi_admin?: string; note?: string }
  collector?: { ok?: boolean; lastSync?: string | null; error?: string | null; latency_ms?: number | null; account_count?: number }
}

type DashSummary = {
  today?: {
    requests: number
    success: number
    failure: number
    tokens: number
    success_rate?: number | null
  }
  last_30m?: { requests: number; tokens: number; rpm: number; tpm: number }
  top_models_by_tokens?: { model: string; calls: number; tokens: number }[]
  top_models_by_calls?: { model: string; calls: number; tokens: number }[]
  collector?: {
    ok?: boolean
    lastSync?: string | null
    error?: string | null
    latency_ms?: number | null
    account_count?: number
  }
  source?: string
}

function shanghaiTodayStartMs() {
  const now = Date.now()
  const today = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  // Walk back hour-by-hour until calendar day changes (same approach as server periodStartMs)
  let t = now
  for (let i = 0; i < 48; i++) {
    const d = new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
    if (d !== today) return t + 1
    t -= 3600000
  }
  return now - 86400000
}

export function AdminOverviewPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const [data, setData] = useState<Overview | null>(null)
  const [dash, setDash] = useState<DashSummary | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      const todayStart = shanghaiTodayStartMs()
      const [overview, summary] = await Promise.all([
        api.get<Overview>('/api/admin/overview'),
        api.get<DashSummary>(`/api/admin/dashboard/summary?today_start_ms=${todayStart}`),
      ])
      setData(overview)
      setDash(summary)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [gate.allowed])

  useEffect(() => {
    if (!gate.allowed) return
    load()
    const id = window.setInterval(() => load(), 30_000)
    return () => window.clearInterval(id)
  }, [gate.allowed, load])

  const checkedLabel = data?.checked_at
    ? new Date(data.checked_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
    : '—'
  const collector = dash?.collector || data?.collector
  const collectorLabel = collector?.lastSync
    ? new Date(collector.lastSync).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
    : '—'

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero title={P('管理概览')} subtitle={P('仪表盘：今日用量 / 30 分钟 RPM·TPM / 号池心跳（site-usage + CPA collector）。')} />

      <div className="panel" style={{ marginTop: 4, marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>{P('运维分工')}</h3>
        <p className="page-lead" style={{ marginBottom: 8 }}>
          {P('CPA Management Key 为生产主路径。用量与排行榜走本站 site-usage。CPAMP 可选。')}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a className="button secondary compact" href="https://www.juc114.cn/management.html" target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> www CPAMP
          </a>
          <button type="button" className="button secondary compact" onClick={() => navigate('/admin/monitoring')}>
            <Activity size={14} /> {P('请求监控')}
          </button>
          <button type="button" className="button secondary compact" onClick={() => navigate('/admin/model-prices')}>
            <Zap size={14} /> {P('模型价格')}
          </button>
          <button type="button" className="button secondary compact" onClick={() => navigate('/admin/account-actions')}>
            <Users size={14} /> {P('认证异常')}
          </button>
          <button type="button" className="button secondary compact" onClick={() => navigate('/admin/connection')}>
            <Cable size={14} /> {P('连接状态')}
          </button>
        </div>
      </div>

      <div className="channels-toolbar">
        <span className="muted">
          {P('最后更新')}：{checkedLabel} · {P('自动刷新')} 30s
        </span>
        <button type="button" className="button secondary compact" onClick={load} disabled={loading}>
          <RefreshCw size={14} /> {P('刷新')}
        </button>
      </div>
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="label">{P('今日请求')}</div>
            <Activity size={14} className="stat-icon" />
          </div>
          <div className="value">{dash?.today?.requests?.toLocaleString('zh-CN') ?? '—'}</div>
          <div className="hint">
            {P('成功')} {dash?.today?.success ?? 0} · {P('失败')} {dash?.today?.failure ?? 0}
            {dash?.today?.success_rate != null
              ? ` · ${(dash.today.success_rate * 100).toFixed(1)}%`
              : ''}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="label">{P('今日 Tokens')}</div>
            <Zap size={14} className="stat-icon" />
          </div>
          <div className="value">{dash?.today?.tokens?.toLocaleString('zh-CN') ?? '—'}</div>
          <div className="hint">site-usage · Asia/Shanghai</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="label">30m RPM</div>
            <Gauge size={14} className="stat-icon" />
          </div>
          <div className="value">{dash?.last_30m?.rpm?.toLocaleString('zh-CN') ?? '—'}</div>
          <div className="hint">
            {P('请求')} {dash?.last_30m?.requests ?? 0} / 30min
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="label">30m TPM</div>
            <Gauge size={14} className="stat-icon" />
          </div>
          <div className="value">{dash?.last_30m?.tpm?.toLocaleString('zh-CN') ?? '—'}</div>
          <div className="hint">
            tokens {dash?.last_30m?.tokens?.toLocaleString('zh-CN') ?? 0} / 30min
          </div>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="label">{P('模型可用')}</div>
            <Cable size={14} className="stat-icon" />
          </div>
          <div className="value">{data?.models?.ok ? data.models.count : '—'}</div>
          <div className="hint">
            {data?.models?.ok ? `${data.models.latency_ms ?? '—'} ms` : data?.models?.error || P('探测失败')}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="label">{P('上游账号')}</div>
            <Users size={14} className="stat-icon" />
          </div>
          <div className="value">{data?.accounts ? `${data.accounts.active}/${data.accounts.total}` : '—'}</div>
          <div className="hint">
            {P('不可用')} {data?.accounts?.unavailable ?? 0}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="label">{P('CPA 密钥')}</div>
            <KeyRound size={14} className="stat-icon" />
          </div>
          <div className="value">{data?.api_keys?.total ?? '—'}</div>
          <div className="hint">{P('Management 列表')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="label">{P('Collector')}</div>
            <Cable size={14} className="stat-icon" />
          </div>
          <div className="value">{collector?.ok ? 'OK' : '—'}</div>
          <div className="hint">
            {collectorLabel}
            {collector?.account_count != null ? ` · ${collector.account_count} acct` : ''}
            {collector?.error ? ` · ${collector.error}` : ''}
          </div>
        </div>
      </div>

      <div className="dashboard-grid" style={{ marginTop: 8 }}>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>{P('今日 Top 模型（Tokens）')}</h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{P('模型')}</th>
                  <th>{P('调用')}</th>
                  <th>{P('Tokens')}</th>
                </tr>
              </thead>
              <tbody>
                {(dash?.top_models_by_tokens || []).slice(0, 8).map((m) => (
                  <tr key={m.model}>
                    <td>
                      <code>{m.model}</code>
                    </td>
                    <td>{m.calls}</td>
                    <td>{m.tokens.toLocaleString('zh-CN')}</td>
                  </tr>
                ))}
                {!dash?.top_models_by_tokens?.length ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      {P('暂无今日数据')}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>{P('组件健康')}</h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{P('组件')}</th>
                  <th>{P('状态')}</th>
                  <th>{P('延迟')}</th>
                </tr>
              </thead>
              <tbody>
                {(['cpa', 'billing', 'cpamp'] as const).map((k) => {
                  const row = data?.health?.[k]
                  return (
                    <tr key={k}>
                      <td>{k}</td>
                      <td>
                        <span className={`health-badge ${row?.ok ? 'ok' : 'down'}`}>
                          ● {row?.ok ? P('正常') : P('异常')}
                        </span>
                      </td>
                      <td>{row?.latency_ms != null ? `${row.latency_ms} ms` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {data?.pool?.by_provider?.length ? (
            <p className="muted" style={{ marginTop: 10 }}>
              {P('号池提供方')} · {data.pool.by_provider.map((p) => `${p.provider}:${p.count}`).join(' · ')}
            </p>
          ) : null}
          {data?.public_api_base ? (
            <p className="muted" style={{ marginTop: 10 }}>
              Base URL · <code>{data.public_api_base}</code>
            </p>
          ) : null}
        </div>
      </div>
    </AdminLayout>
  )
}
