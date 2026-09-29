import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { api } from '../../../lib/api'
import { P } from '../../../i18n'

type Conn = {
  checked_at?: string
  cpa_base?: string
  billing_base?: string
  public_api_base?: string
  secrets?: { demo: boolean; management: boolean; admin: boolean }
  health?: any
  models?: { ok: boolean; count: number; latency_ms?: number | null; base?: string | null; error?: string | null }
  collector?: {
    ok?: boolean
    lastSync?: string | null
    error?: string | null
    latency_ms?: number | null
    account_count?: number
  }
  cpa_latency_ms?: number
  aily?: { ok?: boolean; message?: string | null; model_count?: number; latency_ms?: number | null }
  note?: string
}

/** Local OpenAPI site connection (not CPAMP usage-service). */
export function ConfigConnectionPanel({ enabled }: { enabled: boolean }) {
  const [data, setData] = useState<Conn | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    if (!enabled) return
    setLoading(true)
    setErr(null)
    try {
      setData(await api.get<Conn>('/api/admin/connection'))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (enabled) load()
  }, [enabled])

  return (
    <div>
      <div className="channels-toolbar">
        <span className="muted">
          {P('本站连接')} · openapi.juc114.cn BFF ↔ CPA / billing
          {data?.checked_at
            ? ` · ${new Date(data.checked_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`
            : ''}
        </span>
        <button type="button" className="button secondary compact" onClick={load} disabled={loading}>
          <RefreshCw size={14} /> {P('刷新')}
        </button>
      </div>
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}

      {data?.collector ? (
        <div className="panel" style={{ marginTop: 12 }}>
          <h3>{P('CPA auth-files 采集器')}</h3>
          <p className="muted">
            {data.collector.ok ? P('正常') : P('异常/等待')}
            {data.collector.lastSync
              ? ` · ${P('上次同步')} ${new Date(data.collector.lastSync).toLocaleString('zh-CN', {
                  timeZone: 'Asia/Shanghai',
                  hour12: false,
                })}`
              : ''}
            {data.collector.latency_ms != null ? ` · ${data.collector.latency_ms} ms` : ''}
            {data.collector.account_count != null ? ` · ${data.collector.account_count} accounts` : ''}
          </p>
          {data.collector.error ? <p style={{ color: 'var(--error)' }}>{data.collector.error}</p> : null}
        </div>
      ) : null}

      <div className="panel" style={{ marginTop: 12 }}>
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
                <td>{data?.health?.billing?.latency_ms != null ? `${data.health.billing.latency_ms} ms` : '—'}</td>
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
              <tr>
                <td>Aily bridge</td>
                <td>
                  <code>embedded</code>
                </td>
                <td>
                  <span className={`health-badge ${data?.aily?.ok ? 'ok' : 'down'}`}>
                    ● {data?.aily?.ok ? `${P('正常')} (${data.aily.model_count ?? 0})` : P('异常')}
                  </span>
                </td>
                <td>{data?.aily?.latency_ms != null ? `${data.aily.latency_ms} ms` : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          secrets · demo={String(!!data?.secrets?.demo)} · mgmt={String(!!data?.secrets?.management)} · admin=
          {String(!!data?.secrets?.admin)}
        </p>
        <p className="muted">{data?.note || P('本页为 MrBlank OpenAPI 站点连接状态，非 CPAMP usage-service。')}</p>
      </div>
    </div>
  )
}
