import { useEffect, useState } from 'react'
import { Activity, Cable, ExternalLink, KeyRound, RefreshCw, Users } from 'lucide-react'
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
}

export function AdminOverviewPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const [data, setData] = useState<Overview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      setData(await api.get<Overview>('/api/admin/overview'))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (gate.allowed) load()
  }, [gate.allowed])

  const checkedLabel = data?.checked_at
    ? new Date(data.checked_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
    : '—'

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero title={P('管理概览')} subtitle={P('CPA / CPAMP 运营摘要（密钥仅留在服务端）。')} />

      <div className="panel" style={{ marginTop: 4, marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>{P('运维分工')}</h3>
        <p className="page-lead" style={{ marginBottom: 8 }}>
          {P('www CPAMP = 完整运维面板；本站 #/admin = MrBlank 风格的日常运营子集（连接 / 号池 / 密钥 / 用量），不嵌入 management.html。')}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a className="button secondary compact" href="https://www.juc114.cn/management.html" target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> www CPAMP
          </a>
          <button type="button" className="button secondary compact" onClick={() => navigate('/admin/connection')}>
            <Cable size={14} /> {P('连接状态')}
          </button>
          <button type="button" className="button secondary compact" onClick={() => navigate('/admin/accounts')}>
            <Users size={14} /> {P('号池')}
          </button>
          <button type="button" className="button secondary compact" onClick={() => navigate('/admin/keys')}>
            <KeyRound size={14} /> {P('密钥')}
          </button>
          <button type="button" className="button secondary compact" onClick={() => navigate('/admin/usage')}>
            <Activity size={14} /> {P('用量')}
          </button>
        </div>
      </div>

      <div className="channels-toolbar">
        <span className="muted">
          {P('最后更新')}：{checkedLabel}
        </span>
        <button type="button" className="button secondary compact" onClick={load} disabled={loading}>
          <RefreshCw size={14} /> {P('刷新')}
        </button>
      </div>
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="label">{P('模型可用')}</div>
            <Cable size={14} className="stat-icon" />
          </div>
          <div className="value">{data?.models?.ok ? data.models.count : '—'}</div>
          <div className="hint">
            {data?.models?.ok
              ? `${data.models.latency_ms ?? '—'} ms`
              : data?.models?.error || P('探测失败')}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="label">{P('上游账号')}</div>
            <Users size={14} className="stat-icon" />
          </div>
          <div className="value">
            {data?.accounts ? `${data.accounts.active}/${data.accounts.total}` : '—'}
          </div>
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
            <div className="label">{P('累计请求')}</div>
            <Activity size={14} className="stat-icon" />
          </div>
          <div className="value">{data?.usage?.total_requests?.toLocaleString('zh-CN') ?? '—'}</div>
          <div className="hint">
            tokens {data?.usage?.total_tokens?.toLocaleString('zh-CN') ?? '—'}
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3>{P('组件健康')}</h3>
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
            {P('号池提供方')} ·{' '}
            {data.pool.by_provider.map((p) => `${p.provider}:${p.count}`).join(' · ')}
          </p>
        ) : null}
        {data?.public_api_base ? (
          <p className="muted" style={{ marginTop: 10 }}>
            Base URL · <code>{data.public_api_base}</code>
          </p>
        ) : null}
      </div>
    </AdminLayout>
  )
}
