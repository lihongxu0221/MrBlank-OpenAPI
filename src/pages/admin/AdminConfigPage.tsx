import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'

type ConfigResp = {
  config: Record<string, unknown>
  request_log?: { enabled?: boolean } | null
  source?: string
  writable?: { request_log?: boolean; openai_compatibility?: boolean; note?: string }
}

export function AdminConfigPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const [data, setData] = useState<ConfigResp | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      setData(await api.get<ConfigResp>('/api/admin/config'))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (gate.allowed) load()
  }, [gate.allowed])

  const entries = Object.entries(data?.config || {})

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero
        title={P('CPA 配置')}
        subtitle={P('只读脱敏视图（来自 CPA /v0/management/config；密钥已打码）。')}
      />
      <div className="channels-toolbar">
        <span className="muted">
          {data?.source ? `source · ${data.source}` : ''}
          {data?.request_log ? ` · request-log ${data.request_log.enabled ? 'on' : 'off'}` : ''}
        </span>
        <button type="button" className="button secondary compact" onClick={load} disabled={loading}>
          <RefreshCw size={14} /> {P('刷新')}
        </button>
      </div>
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}
      {data?.writable?.note ? <p className="muted">{data.writable.note}</p> : null}
      <div className="panel" style={{ marginTop: 12 }}>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{P('字段')}</th>
                <th>{P('值')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([k, v]) => (
                <tr key={k}>
                  <td>
                    <code>{k}</code>
                  </td>
                  <td>
                    <code style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {typeof v === 'string' ? v : JSON.stringify(v, null, 2)}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !entries.length && !err ? <p className="empty-state">{P('暂无配置数据。')}</p> : null}
      </div>
    </AdminLayout>
  )
}
