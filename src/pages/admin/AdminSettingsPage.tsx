import { useEffect, useState } from 'react'
import { RefreshCw, Save } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'
import { useToast } from '../../hooks/useStore'

type SettingsMap = Record<string, unknown>

const BOOL_FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: 'debug', label: 'debug', hint: 'CPA 调试日志' },
  { key: 'logging-to-file', label: 'logging-to-file', hint: '写入文件日志（日志查看依赖此项）' },
  { key: 'force-model-prefix', label: 'force-model-prefix' },
  { key: 'ws-auth', label: 'ws-auth', hint: 'WebSocket 鉴权' },
  { key: 'usage-statistics-enabled', label: 'usage-statistics-enabled', hint: 'CPA 用量统计' },
  { key: 'request-log', label: 'request-log', hint: '请求日志开关' },
]

export function AdminSettingsPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const { showToast } = useToast()
  const [settings, setSettings] = useState<SettingsMap>({})
  const [proxyUrl, setProxyUrl] = useState('')
  const [logsMax, setLogsMax] = useState('0')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)

  async function load() {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      const d = await api.get<{ settings: SettingsMap; errors?: Record<string, string> }>('/api/admin/settings')
      setSettings(d.settings || {})
      setProxyUrl(String(d.settings?.['proxy-url'] ?? ''))
      setLogsMax(String(d.settings?.['logs-max-total-size-mb'] ?? 0))
      if (d.errors && Object.keys(d.errors).length) {
        setErr(Object.entries(d.errors).map(([k, v]) => `${k}: ${v}`).join(' · '))
      }
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (gate.allowed) load()
  }, [gate.allowed])

  async function putField(field: string, value: unknown) {
    setSaving(field)
    setErr(null)
    try {
      const d = await api.put<{ field: string; value: unknown }>(`/api/admin/settings/${field}`, { value })
      setSettings((prev) => ({ ...prev, [field]: d.value }))
      showToast(P('已更新'))
    } catch (e) {
      setErr((e as Error).message)
      showToast((e as Error).message)
    } finally {
      setSaving(null)
    }
  }

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero
        title={P('基础设置')}
        subtitle={P('CPA 字段端点（debug / proxy-url / logging / ws-auth / request-log 等）；禁止写 config.yaml。')}
      />
      <div className="channels-toolbar">
        <span className="muted">{P('来源')} · CPA Management</span>
        <button type="button" className="button secondary compact" onClick={load} disabled={loading}>
          <RefreshCw size={14} /> {P('刷新')}
        </button>
      </div>
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}

      <div className="panel" style={{ marginTop: 12 }}>
        <h3>{P('开关')}</h3>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{P('字段')}</th>
                <th>{P('当前')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {BOOL_FIELDS.map((f) => {
                const on = !!settings[f.key]
                return (
                  <tr key={f.key}>
                    <td>
                      <code>{f.label}</code>
                      {f.hint ? <div className="muted" style={{ fontSize: 12 }}>{P(f.hint)}</div> : null}
                    </td>
                    <td>{on ? P('开启') : P('关闭')}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className={`button ${on ? '' : 'secondary'} compact`}
                        disabled={saving === f.key || on}
                        onClick={() => putField(f.key, true)}
                      >
                        {P('开启')}
                      </button>
                      <button
                        type="button"
                        className={`button ${!on ? '' : 'secondary'} compact`}
                        disabled={saving === f.key || !on}
                        onClick={() => putField(f.key, false)}
                      >
                        {P('关闭')}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3>proxy-url</h3>
        <div className="field" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            style={{ flex: 1, minWidth: 240 }}
            value={proxyUrl}
            onChange={(e) => setProxyUrl(e.target.value)}
            placeholder="http://127.0.0.1:7890"
            autoComplete="off"
          />
          <button
            type="button"
            className="button"
            disabled={saving === 'proxy-url'}
            onClick={() => putField('proxy-url', proxyUrl)}
          >
            <Save size={14} /> {P('保存')}
          </button>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3>logs-max-total-size-mb</h3>
        <div className="field" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            style={{ width: 120 }}
            type="number"
            min={0}
            value={logsMax}
            onChange={(e) => setLogsMax(e.target.value)}
          />
          <button
            type="button"
            className="button"
            disabled={saving === 'logs-max-total-size-mb'}
            onClick={() => putField('logs-max-total-size-mb', Number(logsMax) || 0)}
          >
            <Save size={14} /> {P('保存')}
          </button>
        </div>
      </div>
    </AdminLayout>
  )
}
