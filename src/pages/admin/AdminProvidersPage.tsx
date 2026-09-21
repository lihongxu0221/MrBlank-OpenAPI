import { useEffect, useState } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'
import { useToast } from '../../hooks/useStore'

const TYPES = [
  'gemini-api-key',
  'claude-api-key',
  'codex-api-key',
  'vertex-api-key',
  'xai-api-key',
  'interactions-api-key',
] as const

type KeyItem = { id: number; 'api-key': string; length: number; auth_index?: string | null }

export function AdminProvidersPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const { showToast } = useToast()
  const [tab, setTab] = useState<(typeof TYPES)[number]>('gemini-api-key')
  const [items, setItems] = useState<KeyItem[]>([])
  const [newKey, setNewKey] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load(type = tab) {
    if (!gate.allowed) return
    setBusy(true)
    setErr(null)
    try {
      const d = await api.get<{ items: KeyItem[] }>(`/api/admin/providers/${type}`)
      setItems(d.items || [])
    } catch (e) {
      setErr((e as Error).message)
      setItems([])
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (gate.allowed) load(tab)
  }, [gate.allowed, tab])

  async function add() {
    if (!newKey.trim()) return
    setBusy(true)
    try {
      await api.post(`/api/admin/providers/${tab}`, { 'api-key': newKey.trim() })
      setNewKey('')
      showToast(P('已添加'))
      await load()
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(masked: string) {
    if (!confirm(P('确认删除该提供商密钥？'))) return
    setBusy(true)
    try {
      await api.delete(`/api/admin/providers/${tab}`, { masked })
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
      <ConsoleHero
        title={P('AI 提供商密钥')}
        subtitle={P('CPA gemini/claude/codex/vertex/xai/interactions API Key；浏览器仅见脱敏值。')}
      />
      <div className="channels-toolbar" style={{ flexWrap: 'wrap', gap: 6 }}>
        {TYPES.map((t) => (
          <button
            key={t}
            type="button"
            className={`button compact ${tab === t ? '' : 'secondary'}`}
            onClick={() => setTab(t)}
          >
            {t.replace(/-api-key$/, '')}
          </button>
        ))}
        <button type="button" className="button secondary compact" onClick={() => load()} disabled={busy}>
          <RefreshCw size={14} /> {P('刷新')}
        </button>
      </div>
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}

      <div className="panel" style={{ marginTop: 12 }}>
        <h3>
          {P('添加')} · <code>{tab}</code>
        </h3>
        <div className="field" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            style={{ flex: 1, minWidth: 220 }}
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="api key…"
            autoComplete="off"
          />
          <button type="button" className="button" disabled={busy || !newKey.trim()} onClick={add}>
            {P('添加')}
          </button>
        </div>
      </div>

      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table className="data">
          <thead>
            <tr>
              <th>#</th>
              <th>{P('密钥')}</th>
              <th>{P('长度')}</th>
              <th>auth-index</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((k) => (
              <tr key={k.id}>
                <td>{k.id}</td>
                <td>
                  <code>{k['api-key']}</code>
                </td>
                <td>{k.length}</td>
                <td>
                  <code>{k.auth_index || '—'}</code>
                </td>
                <td>
                  <button type="button" className="button secondary compact" disabled={busy} onClick={() => remove(k['api-key'])}>
                    <Trash2 size={14} /> {P('删除')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!busy && !items.length && !err ? <p className="empty-state">{P('暂无密钥。')}</p> : null}
    </AdminLayout>
  )
}
