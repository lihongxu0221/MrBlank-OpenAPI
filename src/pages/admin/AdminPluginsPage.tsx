import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'
import { useToast } from '../../hooks/useStore'

type PluginsResp = {
  plugins_enabled: boolean
  plugins_dir: string
  plugins: unknown[]
  note?: string
}

export function AdminPluginsPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const { showToast } = useToast()
  const [data, setData] = useState<PluginsResp | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      setData(await api.get<PluginsResp>('/api/admin/plugins'))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (gate.allowed) load()
  }, [gate.allowed])

  async function toggle(next: boolean) {
    try {
      await api.put('/api/admin/plugins', { plugins_enabled: next })
      showToast(P('已更新'))
      await load()
    } catch (e) {
      showToast((e as Error).message)
    }
  }

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero title={P('插件管理')} subtitle={P('CPA /v0/management/plugins（本构建 PUT 可能不可用）。')} />
      <div className="channels-toolbar">
        <span className="muted">
          {data ? `${data.plugins_enabled ? P('已启用') : P('已关闭')} · dir ${data.plugins_dir}` : ''}
        </span>
        <button type="button" className="button secondary compact" onClick={load} disabled={loading}>
          <RefreshCw size={14} /> {P('刷新')}
        </button>
      </div>
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}
      {data?.note ? <p className="muted">{data.note}</p> : null}

      <div className="panel" style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <strong>plugins_enabled</strong>
        <button type="button" className="button compact" onClick={() => toggle(true)}>
          {P('开启')}
        </button>
        <button type="button" className="button secondary compact" onClick={() => toggle(false)}>
          {P('关闭')}
        </button>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3>{P('插件列表')}</h3>
        {data?.plugins?.length ? (
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12 }}>
            {JSON.stringify(data.plugins, null, 2)}
          </pre>
        ) : (
          <p className="empty-state">{P('暂无插件。')}</p>
        )}
      </div>
    </AdminLayout>
  )
}
