import { useEffect, useState } from 'react'
import { RefreshCw, Download, Power, Ban, RotateCw, Trash2, Upload } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'
import { useToast } from '../../hooks/useStore'

type Account = {
  id: string
  name?: string | null
  label?: string
  email?: string | null
  provider?: string | null
  status?: string | null
  disabled?: boolean
  unavailable?: boolean
  success?: number
  failed?: number
  last_refresh?: string | null
  status_message?: string
  note?: string | null
  priority?: number | null
  recent_requests?: { time?: string; success?: number; failed?: number }[]
}

type Pool = {
  total: number
  active: number
  unavailable: number
  disabled: number
  by_provider: { provider: string; count: number }[]
}

export function AdminAccountsPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const { showToast } = useToast()
  const [items, setItems] = useState<Account[]>([])
  const [pool, setPool] = useState<Pool | null>(null)
  const [observedAt, setObservedAt] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busyName, setBusyName] = useState<string | null>(null)
  const [uploadName, setUploadName] = useState('')
  const [uploadContent, setUploadContent] = useState('')
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({})

  async function load() {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      const d = await api.get<{ items: Account[]; observed_at?: string; pool?: Pool }>('/api/admin/accounts')
      setItems(d.items || [])
      setPool(d.pool || null)
      setObservedAt(d.observed_at || '')
      const drafts: Record<string, string> = {}
      for (const a of d.items || []) {
        const n = a.name || a.id
        drafts[n] = a.note != null ? String(a.note) : ''
      }
      setNoteDraft(drafts)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (gate.allowed) load()
  }, [gate.allowed])

  async function setDisabled(name: string, disabled: boolean) {
    setBusyName(name)
    try {
      await api.patch('/api/admin/accounts/status', { name, disabled })
      showToast(disabled ? P('已禁用') : P('已启用'))
      await load()
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusyName(null)
    }
  }

  async function patchFields(name: string, fields: Record<string, unknown>) {
    await api.patch('/api/admin/accounts/fields', { name, ...fields })
  }

  async function forceRefresh(name: string) {
    setBusyName(name)
    try {
      await api.post('/api/admin/accounts/refresh', { name })
      showToast(P('已强制刷新'))
      await load()
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusyName(null)
    }
  }

  async function download(name: string) {
    setBusyName(name)
    try {
      const d = await api.get<{ content: unknown; warning?: string }>(
        `/api/admin/accounts/download?name=${encodeURIComponent(name)}`,
      )
      const text = JSON.stringify(d.content, null, 2)
      const blob = new Blob([text], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
      showToast(d.warning || P('已下载'))
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusyName(null)
    }
  }

  async function remove(name: string) {
    if (!confirm(P('确认删除该凭证文件？此操作不可恢复。'))) return
    setBusyName(name)
    try {
      await api.delete('/api/admin/accounts', { name })
      showToast(P('已删除'))
      await load()
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusyName(null)
    }
  }

  async function saveNote(name: string) {
    setBusyName(name)
    try {
      await patchFields(name, { note: noteDraft[name] ?? '' })
      showToast(P('备注已保存'))
      await load()
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusyName(null)
    }
  }

  async function doUpload() {
    if (!uploadName.trim() || !uploadContent.trim()) return
    setBusyName('upload')
    try {
      await api.post('/api/admin/accounts/upload', {
        filename: uploadName.trim(),
        content: uploadContent,
      })
      showToast(P('已上传'))
      setUploadName('')
      setUploadContent('')
      await load()
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusyName(null)
    }
  }

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero
        title={P('上游账号')}
        subtitle={P('CPA auth-files：刷新 / 启用禁用 / 下载 / 上传 / 备注（fields）。切勿向 auth-files?name= POST JSON。')}
      />
      <div className="channels-toolbar">
        <span className="muted">
          {observedAt
            ? `${P('观测时间')} · ${new Date(observedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`
            : ''}
        </span>
        <button type="button" className="button secondary compact" onClick={load} disabled={loading}>
          <RefreshCw size={14} /> {P('刷新列表')}
        </button>
      </div>
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}

      {pool ? (
        <div className="stats-grid" style={{ marginBottom: 16 }}>
          <div className="stat-card">
            <div className="label">{P('号池总数')}</div>
            <div className="value">{pool.total}</div>
          </div>
          <div className="stat-card">
            <div className="label">{P('可用')}</div>
            <div className="value">{pool.active}</div>
          </div>
          <div className="stat-card">
            <div className="label">{P('不可用')}</div>
            <div className="value">{pool.unavailable}</div>
          </div>
          <div className="stat-card">
            <div className="label">{P('已禁用')}</div>
            <div className="value">{pool.disabled}</div>
          </div>
        </div>
      ) : null}

      <div className="panel" style={{ marginBottom: 16 }}>
        <h3>
          <Upload size={14} /> {P('上传凭证 JSON')}
        </h3>
        <div className="field" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            style={{ minWidth: 220 }}
            value={uploadName}
            onChange={(e) => setUploadName(e.target.value)}
            placeholder="provider-email.json"
          />
          <button type="button" className="button" disabled={busyName === 'upload'} onClick={doUpload}>
            {P('上传')}
          </button>
        </div>
        <textarea
          rows={4}
          style={{ width: '100%', marginTop: 8, fontFamily: 'monospace', fontSize: 12 }}
          value={uploadContent}
          onChange={(e) => setUploadContent(e.target.value)}
          placeholder='{"type":"...", "access_token":"...", ...}'
        />
      </div>

      <div className="channel-grid">
        {items.map((a) => {
          const name = a.name || a.id
          const bad = a.disabled || a.unavailable
          const busy = busyName === name
          return (
            <article key={a.id} className="channel-card panel">
              <div className={`health-badge ${bad ? 'down' : 'ok'}`}>
                ● {a.disabled ? P('已禁用') : bad ? P('异常') : a.status || P('正常')}
              </div>
              <h3>{a.label || a.email || a.id}</h3>
              <div className="channel-meta">
                <div>
                  <span className="label">{P('提供方')}</span>
                  <strong>{a.provider || '—'}</strong>
                </div>
                <div>
                  <span className="label">OK / Fail</span>
                  <strong>
                    {a.success ?? 0} / {a.failed ?? 0}
                  </strong>
                </div>
              </div>
              <p className="muted" style={{ fontSize: 12 }}>
                <code>{name}</code>
              </p>
              {a.status_message ? <p className="muted">{a.status_message}</p> : null}
              <div className="field" style={{ marginTop: 8 }}>
                <input
                  style={{ width: '100%' }}
                  value={noteDraft[name] ?? ''}
                  onChange={(e) => setNoteDraft((prev) => ({ ...prev, [name]: e.target.value }))}
                  placeholder={P('备注 / note')}
                />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                <button type="button" className="button secondary compact" disabled={busy} onClick={() => saveNote(name)}>
                  {P('保存备注')}
                </button>
                <button type="button" className="button secondary compact" disabled={busy} onClick={() => forceRefresh(name)}>
                  <RotateCw size={14} /> {P('强制刷新')}
                </button>
                {a.disabled ? (
                  <button type="button" className="button compact" disabled={busy} onClick={() => setDisabled(name, false)}>
                    <Power size={14} /> {P('启用')}
                  </button>
                ) : (
                  <button type="button" className="button secondary compact" disabled={busy} onClick={() => setDisabled(name, true)}>
                    <Ban size={14} /> {P('禁用')}
                  </button>
                )}
                <button type="button" className="button secondary compact" disabled={busy} onClick={() => download(name)}>
                  <Download size={14} /> {P('下载')}
                </button>
                <button type="button" className="button secondary compact" disabled={busy} onClick={() => remove(name)}>
                  <Trash2 size={14} /> {P('删除')}
                </button>
              </div>
              <div className="channel-foot">
                <span>
                  {P('最近刷新')} ·{' '}
                  {a.last_refresh
                    ? new Date(a.last_refresh).toLocaleString('zh-CN', {
                        timeZone: 'Asia/Shanghai',
                        hour12: false,
                      })
                    : '—'}
                </span>
              </div>
            </article>
          )
        })}
      </div>
      {!loading && !items.length && !err ? <p className="empty-state">{P('暂无上游账号。')}</p> : null}
    </AdminLayout>
  )
}
