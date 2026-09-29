import { useCallback, useEffect, useState } from 'react'
import { Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { api } from '../../../lib/api'
import { P } from '../../../i18n'
import { useToast } from '../../../hooks/useStore'

type KeyItem = { id: number; key: string; length: number }
type Alias = { hash: string; label: string; note?: string; updated_at?: string | null }

/** Instant api-keys CRUD + aliases (embedded in config visual auth section). */
export function ConfigApiKeysPanel({ enabled }: { enabled: boolean }) {
  const { showToast } = useToast()
  const [items, setItems] = useState<KeyItem[]>([])
  const [aliases, setAliases] = useState<Alias[]>([])
  const [note, setNote] = useState('')
  const [newKey, setNewKey] = useState('')
  const [revealed, setRevealed] = useState<string | null>(null)
  const [hash, setHash] = useState('')
  const [label, setLabel] = useState('')
  const [aliasNote, setAliasNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!enabled) return
    setBusy(true)
    setErr(null)
    try {
      const [keys, als] = await Promise.all([
        api.get<{ items: KeyItem[]; note?: string }>('/api/admin/keys'),
        api.get<{ items: Alias[] }>('/api/admin/api-key-aliases').catch(() => ({ items: [] as Alias[] })),
      ])
      setItems(keys.items || [])
      setNote(keys.note || '')
      setAliases(als.items || [])
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [enabled])

  useEffect(() => {
    if (enabled) load()
  }, [enabled, load])

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

  async function saveAlias() {
    try {
      const d = await api.put<{ items: Alias[] }>('/api/admin/api-key-aliases', {
        hash: hash.trim(),
        label: label.trim(),
        note: aliasNote.trim(),
      })
      setAliases(d.items || [])
      setHash('')
      setLabel('')
      setAliasNote('')
      showToast(P('别名已保存'))
    } catch (e) {
      showToast((e as Error).message)
    }
  }

  async function removeAlias(h: string) {
    try {
      const d = await api.delete<{ items: Alias[] }>('/api/admin/api-key-aliases', { hash: h })
      setAliases(d.items || [])
      showToast(P('已删除'))
    } catch (e) {
      showToast((e as Error).message)
    }
  }

  return (
    <div>
      <div className="panel-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{P('API 密钥')} · api-keys</h3>
        <button type="button" className="button secondary compact" onClick={load} disabled={busy}>
          <RefreshCw size={14} /> {P('刷新')}
        </button>
      </div>
      <p className="muted" style={{ marginTop: 6 }}>
        {P('即时写入 CPA（不走 YAML 保存）。浏览器仅见脱敏值（生成时除外）。')}
      </p>
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}
      {note ? <p className="muted">{note}</p> : null}

      <div className="field" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
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
      </div>
      {revealed ? (
        <div className="panel" style={{ marginTop: 12, background: 'var(--surface)' }}>
          <p className="muted" style={{ marginBottom: 6 }}>
            {P('请立即复制完整密钥（仅显示一次）：')}
          </p>
          <code style={{ wordBreak: 'break-all' }}>{revealed}</code>
        </div>
      ) : null}

      <div className="table-wrap" style={{ marginTop: 12 }}>
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
                  <button
                    type="button"
                    className="button secondary compact"
                    disabled={busy}
                    onClick={() => removeKey(k.key)}
                  >
                    <Trash2 size={14} /> {P('删除')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!busy && !items.length && !err ? <p className="empty-state">{P('暂无 CPA 密钥。')}</p> : null}

      <h4 style={{ marginTop: 20 }}>{P('密钥别名')}</h4>
      <p className="muted">{P('本站 hash↔标签映射，用于用量展示。')}</p>
      <div className="field" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <input style={{ flex: 1, minWidth: 160 }} value={hash} onChange={(e) => setHash(e.target.value)} placeholder="sha256 hash" />
        <input style={{ width: 140 }} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={P('标签')} />
        <input style={{ flex: 1, minWidth: 120 }} value={aliasNote} onChange={(e) => setAliasNote(e.target.value)} placeholder={P('备注')} />
        <button type="button" className="button compact" onClick={saveAlias} disabled={!hash.trim() || !label.trim()}>
          <Plus size={14} /> {P('保存')}
        </button>
      </div>
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table className="data">
          <thead>
            <tr>
              <th>hash</th>
              <th>{P('标签')}</th>
              <th>{P('备注')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {aliases.map((a) => (
              <tr key={a.hash}>
                <td>
                  <code style={{ fontSize: 11 }}>{a.hash.slice(0, 12)}…</code>
                </td>
                <td>{a.label}</td>
                <td className="muted">{a.note || '—'}</td>
                <td>
                  <button type="button" className="button secondary compact" onClick={() => removeAlias(a.hash)}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
