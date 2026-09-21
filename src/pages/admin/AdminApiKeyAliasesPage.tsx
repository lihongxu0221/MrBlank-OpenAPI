import { useCallback, useEffect, useState } from 'react'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'
import { useToast } from '../../hooks/useStore'

type Alias = { hash: string; label: string; note?: string; updated_at?: string | null }

export function AdminApiKeyAliasesPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const { showToast } = useToast()
  const [items, setItems] = useState<Alias[]>([])
  const [hash, setHash] = useState('')
  const [label, setLabel] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      const d = await api.get<{ items: Alias[] }>('/api/admin/api-key-aliases')
      setItems(d.items || [])
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [gate.allowed])

  useEffect(() => {
    if (gate.allowed) load()
  }, [gate.allowed, load])

  async function save() {
    try {
      const d = await api.put<{ items: Alias[] }>('/api/admin/api-key-aliases', {
        hash: hash.trim(),
        label: label.trim(),
        note: note.trim(),
      })
      setItems(d.items || [])
      setHash('')
      setLabel('')
      setNote('')
      showToast(P('别名已保存'))
    } catch (e) {
      showToast((e as Error).message)
    }
  }

  async function remove(h: string) {
    try {
      const d = await api.delete<{ items: Alias[] }>('/api/admin/api-key-aliases', { hash: h })
      setItems(d.items || [])
      showToast(P('已删除'))
    } catch (e) {
      showToast((e as Error).message)
    }
  }

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero
        title={P('密钥别名')}
        subtitle={P('本站 hash↔标签映射，用于用量展示（非 CPA / CPAMP 原生）。')}
      />
      <div className="channels-toolbar">
        <span className="muted">{items.length} {P('条')}</span>
        <button type="button" className="button secondary compact" onClick={load} disabled={loading}>
          <RefreshCw size={14} /> {P('刷新')}
        </button>
      </div>
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>{P('新增 / 更新')}</h3>
        <div className="field">
          <label>hash</label>
          <input className="field-input" value={hash} onChange={(e) => setHash(e.target.value)} placeholder="sha256…" />
        </div>
        <div className="field">
          <label>{P('标签')}</label>
          <input className="field-input" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="field">
          <label>{P('备注')}</label>
          <input className="field-input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button type="button" className="button compact" onClick={save} disabled={!hash.trim() || !label.trim()}>
          <Plus size={14} /> {P('保存')}
        </button>
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{P('标签')}</th>
                <th>hash</th>
                <th>{P('备注')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.hash}>
                  <td>{a.label}</td>
                  <td>
                    <code>{a.hash}</code>
                  </td>
                  <td className="muted">{a.note || '—'}</td>
                  <td>
                    <button type="button" className="button secondary compact" onClick={() => remove(a.hash)}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {!items.length ? (
                <tr>
                  <td colSpan={4} className="muted">
                    {P('暂无别名')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  )
}
