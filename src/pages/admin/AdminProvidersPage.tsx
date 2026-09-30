import { useEffect, useState } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'
import { useToast } from '../../hooks/useStore'
import { getHashQuery, navigateWithQuery } from '../../router/hash'

const TYPES = [
  'gemini-api-key',
  'claude-api-key',
  'codex-api-key',
  'vertex-api-key',
  'xai-api-key',
  'interactions-api-key',
] as const

type ProviderTab = (typeof TYPES)[number] | 'openai-compatibility'

type KeyItem = { id: number; 'api-key': string; length: number; auth_index?: string | null; 'base-url'?: string }

type CompatItem = {
  name: string
  base_url: string
  prefix: string
  disabled: boolean
  models: { name: string; alias: string; display_name: string }[]
  api_key_count: number
}

export function AdminProvidersPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const { showToast } = useToast()
  const qs = getHashQuery()
  const qTab = qs.get('tab') || ''
  const initial: ProviderTab =
    qTab === 'openai-compatibility' || qTab === 'openai-compat' ? 'openai-compatibility' : (TYPES.includes(qTab as any) ? (qTab as ProviderTab) : 'gemini-api-key')
  const [tab, setTab] = useState<ProviderTab>(initial)
  const [items, setItems] = useState<KeyItem[]>([])
  const [compatItems, setCompatItems] = useState<CompatItem[]>([])
  const [compatRaw, setCompatRaw] = useState('[]')
  const [newKey, setNewKey] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function selectTab(next: ProviderTab) {
    setTab(next)
    navigateWithQuery('/admin/providers', next === 'gemini-api-key' ? {} : { tab: next })
  }

  async function load(type: ProviderTab = tab) {
    if (!gate.allowed) return
    setBusy(true)
    setErr(null)
    try {
      if (type === 'openai-compatibility') {
        const d = await api.get<{ items: CompatItem[] }>('/api/admin/openai-compatibility')
        setCompatItems(d.items || [])
        setCompatRaw(JSON.stringify(d.items || [], null, 2))
      } else {
        const d = await api.get<{ items: KeyItem[] }>(`/api/admin/providers/${type}`)
        setItems(d.items || [])
      }
    } catch (e) {
      setErr((e as Error).message)
      setItems([])
      setCompatItems([])
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (gate.allowed) load(tab)
  }, [gate.allowed, tab])

  async function add() {
    if (tab === 'openai-compatibility' || !newKey.trim()) return
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

  async function remove(masked: string, baseUrl: string) {
    if (tab === 'openai-compatibility') return
    if (!confirm(P('确认删除该提供商密钥？'))) return
    setBusy(true)
    try {
      // base-url disambiguates entries sharing one api-key across different upstreams
      await api.delete(`/api/admin/providers/${tab}`, { masked, 'base-url': baseUrl })
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
        title={P('AI 提供商')}
        subtitle={P('CPA gemini/claude/codex/vertex/xai/interactions 密钥，以及 OpenAI 兼容上游。')}
      />
      <div className="channels-toolbar" style={{ flexWrap: 'wrap', gap: 6 }}>
        {TYPES.map((t) => (
          <button
            key={t}
            type="button"
            className={`button compact ${tab === t ? '' : 'secondary'}`}
            onClick={() => selectTab(t)}
          >
            {t.replace(/-api-key$/, '')}
          </button>
        ))}
        <button
          type="button"
          className={`button compact ${tab === 'openai-compatibility' ? '' : 'secondary'}`}
          onClick={() => selectTab('openai-compatibility')}
        >
          OpenAI 兼容
        </button>
        <button type="button" className="button secondary compact" onClick={() => load()} disabled={busy}>
          <RefreshCw size={14} /> {P('刷新')}
        </button>
      </div>
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}

      {tab === 'openai-compatibility' ? (
        <>
          <div className="panel" style={{ marginTop: 12 }}>
            <div className="channels-toolbar">
              <h3 style={{ margin: 0 }}>{P('OpenAI 兼容')} · openai-compatibility（{P('只读')}）</h3>
            </div>
            <div className="table-wrap" style={{ marginTop: 10 }}>
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
                  {compatItems.map((it) => (
                    <tr key={it.name || it.base_url}>
                      <td>{it.name || '—'}</td>
                      <td>
                        <code>{it.base_url || '—'}</code>
                      </td>
                      <td>
                        <code>{it.prefix || '—'}</code>
                      </td>
                      <td>{it.models?.length ?? 0}</td>
                      <td>{it.api_key_count ?? 0}</td>
                      <td>{it.disabled ? P('禁用') : P('启用')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!busy && !compatItems.length ? <p className="empty-state">{P('暂无条目。')}</p> : null}
          </div>
          <div className="panel" style={{ marginTop: 16 }}>
            <h3>{P('原始 JSON（只读视图）')}</h3>
            <p className="muted">
              {P('此处为脱敏后的摘要视图（不含上游密钥与请求头），不能写回 CPA。编辑 OpenAI 兼容上游请使用 CPA 管理面板。')}
            </p>
            <textarea
              rows={16}
              readOnly
              style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
              value={compatRaw}
              spellCheck={false}
            />
          </div>
        </>
      ) : (
        <>
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
                  <th>base-url</th>
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
                      <code>{k['base-url'] || '—'}</code>
                    </td>
                    <td>
                      <code>{k.auth_index || '—'}</code>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="button secondary compact"
                        disabled={busy}
                        onClick={() => remove(k['api-key'], k['base-url'] || '')}
                      >
                        <Trash2 size={14} /> {P('删除')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!busy && !items.length && !err ? <p className="empty-state">{P('暂无密钥。')}</p> : null}
        </>
      )}
    </AdminLayout>
  )
}
