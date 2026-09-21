import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'

export function AdminRequestLogPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  async function load() {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      const d = await api.get<{ enabled: boolean }>('/api/admin/request-log')
      setEnabled(!!d.enabled)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function toggle(next: boolean) {
    if (!gate.allowed) return
    setSaving(true)
    setErr(null)
    setMsg(null)
    try {
      const d = await api.put<{ enabled: boolean }>('/api/admin/request-log', { enabled: next })
      setEnabled(!!d.enabled)
      setMsg(P('已更新 CPA request-log。'))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (gate.allowed) load()
  }, [gate.allowed])

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero
        title={P('请求日志')}
        subtitle={P('CPA /v0/management/request-log 开关（PUT {"value":bool}）。')}
      />
      <div className="channels-toolbar">
        <span className="muted">
          {enabled == null ? '—' : enabled ? P('当前：开启') : P('当前：关闭')}
        </span>
        <button type="button" className="button secondary compact" onClick={load} disabled={loading}>
          <RefreshCw size={14} /> {P('刷新')}
        </button>
      </div>
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}
      {msg ? <p className="muted">{msg}</p> : null}
      <div className="panel" style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
        <strong>{P('request-log')}</strong>
        <button
          type="button"
          className={`button ${enabled ? '' : 'secondary'} compact`}
          disabled={saving || enabled === true}
          onClick={() => toggle(true)}
        >
          {P('开启')}
        </button>
        <button
          type="button"
          className={`button ${enabled === false ? '' : 'secondary'} compact`}
          disabled={saving || enabled === false}
          onClick={() => toggle(false)}
        >
          {P('关闭')}
        </button>
      </div>
    </AdminLayout>
  )
}
