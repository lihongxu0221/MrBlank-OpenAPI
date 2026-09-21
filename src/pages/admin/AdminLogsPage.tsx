import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'
import { navigate } from '../../router/hash'

export function AdminLogsPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const [raw, setRaw] = useState<unknown>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [disabledHint, setDisabledHint] = useState(false)

  async function load() {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    setDisabledHint(false)
    try {
      const d = await api.get<unknown>('/api/admin/logs?limit=200')
      setRaw(d)
    } catch (e) {
      const msg = (e as Error).message
      setErr(msg)
      setRaw(null)
      if (/logging-to-file|文件日志未开启/i.test(msg)) setDisabledHint(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (gate.allowed) load()
  }, [gate.allowed])

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero title={P('日志查看')} subtitle={P('CPA /v0/management/logs（需开启 logging-to-file）。')} />
      <div className="channels-toolbar">
        <button type="button" className="button secondary compact" onClick={load} disabled={loading}>
          <RefreshCw size={14} /> {P('刷新')}
        </button>
        {disabledHint ? (
          <button type="button" className="button compact" onClick={() => navigate('/admin/settings')}>
            {P('前往基础设置')}
          </button>
        ) : null}
      </div>
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}
      <div className="panel" style={{ marginTop: 12 }}>
        {raw ? (
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12, maxHeight: 560, overflow: 'auto' }}>
            {typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)}
          </pre>
        ) : !loading && !err ? (
          <p className="empty-state">{P('暂无日志。')}</p>
        ) : null}
      </div>
    </AdminLayout>
  )
}
