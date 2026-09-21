import { useEffect, useState } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'

type Conn = {
  checked_at?: string
  cpa_base?: string
  billing_base?: string
  cpamp_base?: string
  public_api_base?: string
  secrets?: { demo: boolean; management: boolean; admin: boolean }
  health?: any
  models?: { ok: boolean; count: number; latency_ms?: number | null; base?: string | null; error?: string | null }
  collector?: { ok?: boolean; lastSync?: string | null; error?: string | null; latency_ms?: number | null; account_count?: number }
  cpa_latency_ms?: number
  note?: string
}

export function AdminConnectionPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const [data, setData] = useState<Conn | null>(null)
  const [cfg, setCfg] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      const [c, config] = await Promise.all([
        api.get<Conn>('/api/admin/connection'),
        api.get<{ config: any }>('/api/admin/config').catch(() => ({ config: null })),
      ])
      setData(c)
      setCfg(config.config)
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
      <ConsoleHero title={P('连接状态')} subtitle={P('本机 CPA / billing 可达性、collector 心跳与脱敏配置摘要。CPAMP 可选。')} />
      <div className="channels-toolbar">
        <span className="muted">
          {data?.checked_at
            ? new Date(data.checked_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
            : ''}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <a className="button secondary compact" href="/admin/oauth">
            Aily
          </a>
          <a className="button secondary compact" href="https://www.juc114.cn/management.html" target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> www CPAMP
          </a>
          <button type="button" className="button secondary compact" onClick={load} disabled={loading}>
            <RefreshCw size={14} /> {P('刷新')}
          </button>
        </div>
      </div>
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}

      
      {data?.collector ? (
        <div className="panel" style={{ marginTop: 12 }}>
          <h3>{P('CPA auth-files 采集器')}</h3>
          <p className="muted">
            {data.collector.ok ? P('正常') : P('异常/等待')}
            {data.collector.lastSync
              ? ` · ${P('上次同步')} ${new Date(data.collector.lastSync).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`
              : ''}
            {data.collector.latency_ms != null ? ` · ${data.collector.latency_ms} ms` : ''}
            {data.collector.account_count != null ? ` · ${data.collector.account_count} accounts` : ''}
          </p>
          {data.collector.error ? <p style={{ color: 'var(--error)' }}>{data.collector.error}</p> : null}
          {data?.cpa_latency_ms != null ? (
            <p className="muted">{P('CPA 探测延迟')} · {data.cpa_latency_ms} ms</p>
          ) : null}
        </div>
      ) : null}

      <div className="panel">
        <h3>{P('端点')}</h3>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{P('名称')}</th>
                <th>{P('地址')}</th>
                <th>{P('状态')}</th>
                <th>{P('延迟')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>CPA</td>
                <td>
                  <code>{data?.cpa_base || '—'}</code>
                </td>
                <td>
                  <span className={`health-badge ${data?.health?.cpa?.ok ? 'ok' : 'down'}`}>
                    ● {data?.health?.cpa?.ok ? P('正常') : P('异常')}
                  </span>
                </td>
                <td>{data?.health?.cpa?.latency_ms != null ? `${data.health.cpa.latency_ms} ms` : '—'}</td>
              </tr>
              <tr>
                <td>Billing</td>
                <td>
                  <code>{data?.billing_base || '—'}</code>
                </td>
                <td>
                  <span className={`health-badge ${data?.health?.billing?.ok ? 'ok' : 'down'}`}>
                    ● {data?.health?.billing?.ok ? P('正常') : P('异常')}
                  </span>
                </td>
                <td>
                  {data?.health?.billing?.latency_ms != null ? `${data.health.billing.latency_ms} ms` : '—'}
                </td>
              </tr>
              <tr>
                <td>CPAMP</td>
                <td>
                  <code>{data?.cpamp_base || '—'}</code>
                </td>
                <td>
                  <span className={`health-badge ${data?.health?.cpamp?.ok ? 'ok' : 'down'}`}>
                    ● {data?.health?.cpamp?.ok ? P('正常') : P('异常')}
                  </span>
                </td>
                <td>
                  {data?.health?.cpamp?.latency_ms != null ? `${data.health.cpamp.latency_ms} ms` : '—'}
                </td>
              </tr>
              <tr>
                <td>/v1/models</td>
                <td>
                  <code>{data?.models?.base || data?.public_api_base || '—'}</code>
                </td>
                <td>
                  <span className={`health-badge ${data?.models?.ok ? 'ok' : 'down'}`}>
                    ● {data?.models?.ok ? `${P('正常')} (${data.models.count})` : P('异常')}
                  </span>
                </td>
                <td>{data?.models?.latency_ms != null ? `${data.models.latency_ms} ms` : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          secrets · demo={String(!!data?.secrets?.demo)} · mgmt={String(!!data?.secrets?.management)} ·
          admin={String(!!data?.secrets?.admin)}
        </p>
        <p className="muted">
          {data?.note || P('CPA 为主；CPAMP 可选。配置请用「CPA 配置 / OpenAI 兼容 / 请求日志」页面。')}
        </p>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3>{P('配置摘要（已脱敏）')}</h3>
        <pre
          style={{
            overflow: 'auto',
            maxHeight: 420,
            fontSize: 12,
            background: 'var(--surface)',
            padding: 12,
            borderRadius: 8,
          }}
        >
          {cfg ? JSON.stringify(cfg, null, 2) : P('暂无配置或无权读取')}
        </pre>
      </div>
    </AdminLayout>
  )
}
