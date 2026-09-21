import { useEffect, useState } from 'react'
import { RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'
import { useToast } from '../../hooks/useStore'

type KeyItem = { id: number; key: string; length: number }

export function AdminKeysPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const { showToast } = useToast()
  const [items, setItems] = useState<KeyItem[]>([])
  const [note, setNote] = useState('')
  const [newKey, setNewKey] = useState('')
  const [revealed, setRevealed] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    if (!gate.allowed) return
    setBusy(true)
    setErr(null)
    try {
      const d = await api.get<{ items: KeyItem[]; note?: string }>('/api/admin/keys')
      setItems(d.items || [])
      setNote(d.note || '')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (gate.allowed) load()
  }, [gate.allowed])

  async function addKey() {
    setBusy(true)
    setRevealed(null)
    try {
      await api.post('/api/admin/keys', { key: newKey.trim() })
      setNewKey('')
      showToast(P('已添加'))
      await load()
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function generateKey() {
    setBusy(true)
    setRevealed(null)
    try {
      const d = await api.post<{ key: string; masked: string; generated?: boolean }>('/api/admin/keys', {
        generate: true,
      })
      if (d.generated && d.key) setRevealed(d.key)
      showToast(P('已生成并写入 CPA'))
      await load()
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function removeKey(masked: string) {
    if (!confirm(P('确认从 CPA 删除该密钥？'))) return
    setBusy(true)
    try {
      await api.delete('/api/admin/keys', { masked })
      showToast(P('已删除'))
      await load()
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero title={P('CPA 密钥')} subtitle={P('通过服务端 Management Key 管理；浏览器只见脱敏值（生成时除外）。')} />
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}
      {note ? <p className="muted">{note}</p> : null}

      <div className="panel" style={{ marginTop: 12 }}>
        <h3>{P('添加密钥')}</h3>
        <div className="field" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            style={{ flex: 1, minWidth: 220 }}
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="sk-..."
            autoComplete="off"
          />
          <button type="button" className="button" disabled={busy || !newKey.trim()} onClick={addKey}>
            {P('添加')}
          </button>
          <button type="button" className="button secondary" disabled={busy} onClick={generateKey}>
            <Sparkles size={14} /> {P('生成并添加')}
          </button>
          <button type="button" className="button secondary" disabled={busy} onClick={load}>
            <RefreshCw size={14} /> {P('刷新')}
          </button>
        </div>
        {revealed ? (
          <div className="panel" style={{ marginTop: 12, background: 'var(--surface)' }}>
            <p className="muted" style={{ marginBottom: 6 }}>
              {P('请立即复制完整密钥（仅显示一次）：')}
            </p>
            <code style={{ wordBreak: 'break-all' }}>{revealed}</code>
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="button secondary compact"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(revealed)
                    showToast(P('已复制'))
                  } catch {
                    showToast(P('复制失败，请手动选择'))
                  }
                }}
              >
                {P('复制')}
              </button>
              <button type="button" className="button secondary compact" style={{ marginLeft: 8 }} onClick={() => setRevealed(null)}>
                {P('关闭')}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table className="data">
          <thead>
            <tr>
              <th>#</th>
              <th>{P('密钥')}</th>
              <th>{P('长度')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((k) => (
              <tr key={k.id}>
                <td>{k.id}</td>
                <td>
                  <code>{k.key}</code>
                </td>
                <td>{k.length}</td>
                <td>
                  <button type="button" className="button secondary compact" disabled={busy} onClick={() => removeKey(k.key)}>
                    <Trash2 size={14} /> {P('删除')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!busy && !items.length && !err ? <p className="empty-state">{P('暂无 CPA 密钥。')}</p> : null}
    </AdminLayout>
  )
}
