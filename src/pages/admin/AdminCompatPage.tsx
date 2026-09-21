import { useEffect, useState } from 'react'
import { RefreshCw, Save } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'

type CompatItem = {
  name: string
  base_url: string
  prefix: string
  disabled: boolean
  models: { name: string; alias: string; display_name: string }[]
  api_key_count: number
}

export function AdminCompatPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const [items, setItems] = useState<CompatItem[]>([])
  const [raw, setRaw] = useState('[]')
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  async function load() {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    setMsg(null)
    try {
      const d = await api.get<{ items: CompatItem[] }>('/api/admin/openai-compatibility')
      setItems(d.items || [])
      setRaw(JSON.stringify(d.items || [], null, 2))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    if (!gate.allowed) return
    setSaving(true)
    setErr(null)
    setMsg(null)
    try {
      const parsed = JSON.parse(raw)
      const d = await api.put<{ items: CompatItem[] }>('/api/admin/openai-compatibility', { items: parsed })
      setItems(d.items || [])
      setRaw(JSON.stringify(d.items || [], null, 2))
      setMsg(P('已保存到 CPA。'))
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
        title={P('OpenAI 兼容')}
        subtitle={P('CPA openai-compatibility 列表；PUT 直接写回 CPA（body 为数组）。')}
      />
      <div className="channels-toolbar">
        <span className="muted">{items.length ? `${items.length} entries` : ''}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="button secondary compact" onClick={load} disabled={loading}>
            <RefreshCw size={14} /> {P('刷新')}
          </button>
          <button type="button" className="button compact" onClick={save} disabled={saving}>
            <Save size={14} /> {P('保存')}
          </button>
        </div>
      </div>
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}
      {msg ? <p className="muted">{msg}</p> : null}

      <div className="panel" style={{ marginTop: 12 }}>
        <h3>{P('当前条目')}</h3>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{P('名称')}</th>
                <th>base_url</th>
                <th>prefix</th>
                <th>{P('模型数')}</th>
                <th>keys</th>
                <th>{P('状态')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={`${it.name}-${it.base_url}`}>
                  <td>{it.name || '—'}</td>
                  <td>
                    <code>{it.base_url || '—'}</code>
                  </td>
                  <td>{it.prefix || '—'}</td>
                  <td>{it.models?.length || 0}</td>
                  <td>{it.api_key_count || 0}</td>
                  <td>{it.disabled ? P('禁用') : P('启用')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !items.length ? <p className="empty-state">{P('暂无兼容条目。')}</p> : null}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3>{P('JSON 编辑')}</h3>
        <p className="muted">{P('高级：直接编辑数组后保存。请确保字段与 CPA 期望一致。')}</p>
        <textarea
          className="input"
          style={{ width: '100%', minHeight: 220, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
      </div>
    </AdminLayout>
  )
}
