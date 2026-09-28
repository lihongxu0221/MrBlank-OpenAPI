import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import {
  RefreshCw,
  Download,
  Power,
  Ban,
  RotateCw,
  Trash2,
  Upload,
  ExternalLink,
  KeyRound,
  CheckSquare,
  Square,
} from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'
import { useToast } from '../../hooks/useStore'
import { getHashQuery, navigate } from '../../router/hash'

type Account = {
  id: string
  name?: string | null
  label?: string
  email?: string | null
  provider?: string | null
  status?: string | null
  display_status?: string | null
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

type TabId = 'list' | 'oauth'

const OAUTH_PROVIDERS = ['anthropic', 'codex', 'antigravity', 'kimi', 'xai', 'devin', 'qwen', 'iflow', 'gemini-cli']

const STATUS_FILTERS: { id: string; label: string }[] = [
  { id: 'all', label: '全部状态' },
  { id: 'running', label: '运行中' },
  { id: 'disabled', label: '已禁用' },
  { id: 'unavailable', label: '不可用' },
  { id: 'need_reauth', label: '需重新认证' },
]

function accountName(a: Account) {
  return String(a.name || a.id || '')
}

function badgeClass(display: string) {
  if (display === 'disabled') return 'health-badge off'
  if (display === 'unavailable' || display === 'need_reauth') return 'health-badge down'
  if (display === 'running') return 'health-badge ok'
  return 'health-badge warn'
}

function badgeLabel(display: string, raw?: string | null) {
  switch (display) {
    case 'running':
      return P('运行中')
    case 'disabled':
      return P('已禁用')
    case 'unavailable':
      return P('不可用')
    case 'need_reauth':
      return P('需重新认证')
    default:
      return raw || display || P('未知')
  }
}

function resolveDisplay(a: Account) {
  return String(a.display_status || (a.disabled ? 'disabled' : a.unavailable ? 'unavailable' : 'running'))
}

function readInitialTab(): TabId {
  const t = getHashQuery().get('tab')
  return t === 'oauth' ? 'oauth' : 'list'
}

export function AdminAccountsPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const { showToast } = useToast()
  const [tab, setTab] = useState<TabId>(readInitialTab)
  const [items, setItems] = useState<Account[]>([])
  const [pool, setPool] = useState<Pool | null>(null)
  const [observedAt, setObservedAt] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busyName, setBusyName] = useState<string | null>(null)
  const [uploadName, setUploadName] = useState('')
  const [uploadContent, setUploadContent] = useState('')
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({})
  const [priorityDraft, setPriorityDraft] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [q, setQ] = useState('')
  const [providerFilter, setProviderFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [batchPriority, setBatchPriority] = useState('0')
  const [batchBusy, setBatchBusy] = useState(false)

  // OAuth config tab state
  const [oauthBusy, setOauthBusy] = useState(false)
  const [oauthErr, setOauthErr] = useState<string | null>(null)
  const [oauthState, setOauthState] = useState('')
  const [authUrl, setAuthUrl] = useState('')
  const [userCode, setUserCode] = useState('')
  const [callbackUrl, setCallbackUrl] = useState('')
  const [oauthStatus, setOauthStatus] = useState<Record<string, unknown> | null>(null)
  const [unavailable, setUnavailable] = useState<string[]>([])
  const [aliasJson, setAliasJson] = useState('{}')
  const [excludedJson, setExcludedJson] = useState('[]')
  const [reauthProvider, setReauthProvider] = useState<string | null>(null)
  const [knownNames, setKnownNames] = useState<Set<string>>(new Set())

  function switchTab(next: TabId) {
    setTab(next)
    navigate(next === 'oauth' ? '/admin/accounts?tab=oauth' : '/admin/accounts')
  }

  async function load() {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      const d = await api.get<{ items: Account[]; observed_at?: string; pool?: Pool }>('/api/admin/accounts')
      const list = d.items || []
      setItems(list)
      setPool(d.pool || null)
      setObservedAt(d.observed_at || '')
      const drafts: Record<string, string> = {}
      const pri: Record<string, string> = {}
      const names = new Set<string>()
      for (const a of list) {
        const n = accountName(a)
        names.add(n)
        drafts[n] = a.note != null ? String(a.note) : ''
        pri[n] = a.priority != null && !Number.isNaN(Number(a.priority)) ? String(a.priority) : ''
      }
      setNoteDraft(drafts)
      setPriorityDraft(pri)
      setKnownNames(names)
      setSelected((prev) => {
        const next: Record<string, boolean> = {}
        for (const n of Object.keys(prev)) {
          if (names.has(n) && prev[n]) next[n] = true
        }
        return next
      })
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function loadOauthConfig() {
    try {
      const a = await api.get<{ alias: unknown }>('/api/admin/oauth/model-alias')
      setAliasJson(JSON.stringify(a.alias ?? {}, null, 2))
      const e = await api.get<{ excluded: unknown }>('/api/admin/oauth/excluded-models')
      setExcludedJson(JSON.stringify(e.excluded ?? [], null, 2))
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (!gate.allowed) return
    load()
    loadOauthConfig()
  }, [gate.allowed])

  useEffect(() => {
    const sync = () => setTab(readInitialTab())
    sync()
    window.addEventListener('popstate', sync)
    window.addEventListener('mrblank:route', sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener('mrblank:route', sync)
    }
  }, [path])

  const providers = useMemo(() => {
    const set = new Set<string>()
    for (const a of items) {
      if (a.provider) set.add(String(a.provider))
    }
    return [...set].sort()
  }, [items])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return items.filter((a) => {
      const name = accountName(a)
      const display = resolveDisplay(a)
      if (providerFilter !== 'all' && String(a.provider || '') !== providerFilter) return false
      if (statusFilter !== 'all' && display !== statusFilter) return false
      if (!needle) return true
      const hay = `${name} ${a.email || ''} ${a.note || ''} ${a.label || ''}`.toLowerCase()
      return hay.includes(needle)
    })
  }, [items, q, providerFilter, statusFilter])

  const selectedNames = useMemo(
    () => filtered.map(accountName).filter((n) => selected[n]),
    [filtered, selected],
  )

  const allFilteredSelected = filtered.length > 0 && filtered.every((a) => selected[accountName(a)])

  function toggleAllFiltered() {
    setSelected((prev) => {
      const next = { ...prev }
      if (allFilteredSelected) {
        for (const a of filtered) delete next[accountName(a)]
      } else {
        for (const a of filtered) next[accountName(a)] = true
      }
      return next
    })
  }

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
      await api.patch('/api/admin/accounts/fields', { name, note: noteDraft[name] ?? '' })
      showToast(P('备注已保存'))
      await load()
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusyName(null)
    }
  }

  async function savePriority(name: string) {
    const raw = priorityDraft[name]
    const priority = Number(raw)
    if (!Number.isFinite(priority)) {
      showToast(P('优先级须为数字'))
      return
    }
    setBusyName(name)
    try {
      await api.patch('/api/admin/accounts/fields', { name, priority })
      showToast(P('优先级已保存'))
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

  function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!uploadName.trim()) setUploadName(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      setUploadContent(String(reader.result || ''))
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  async function runBatch(action: 'enable' | 'disable' | 'delete' | 'priority') {
    if (!selectedNames.length) {
      showToast(P('请先勾选凭证'))
      return
    }
    if (action === 'delete' && !confirm(P('确认批量删除所选凭证？此操作不可恢复。'))) return
    let priority: number | undefined
    if (action === 'priority') {
      priority = Number(batchPriority)
      if (!Number.isFinite(priority)) {
        showToast(P('批量优先级须为数字'))
        return
      }
    }
    setBatchBusy(true)
    try {
      const d = await api.post<{
        ok_count?: number
        fail_count?: number
        results?: { name: string; ok: boolean; error?: string }[]
      }>('/api/admin/accounts/batch', {
        action,
        names: selectedNames,
        ...(action === 'priority' ? { priority } : {}),
      })
      const okCount = d.ok_count ?? 0
      const failCount = d.fail_count ?? 0
      showToast(`${P('批量完成')} · ok ${okCount} / fail ${failCount}`)
      if (failCount && d.results?.length) {
        const first = d.results.find((r) => !r.ok)
        if (first?.error) showToast(first.error)
      }
      setSelected({})
      await load()
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBatchBusy(false)
    }
  }

  async function startOauth(id: string, fromReauth = false) {
    setOauthBusy(true)
    setOauthErr(null)
    setAuthUrl('')
    setUserCode('')
    setOauthStatus(null)
    if (fromReauth) {
      setReauthProvider(id)
      switchTab('oauth')
    }
    try {
      const d = await api.post<{
        state?: string
        url?: string
        user_code?: string
      }>(`/api/admin/oauth/start/${id}`)
      setOauthState(String(d.state || ''))
      setAuthUrl(String(d.url || ''))
      setUserCode(String(d.user_code || ''))
      showToast(P('已启动 OAuth'))
    } catch (e) {
      const msg = (e as Error).message
      if (/not available|404/i.test(msg)) {
        setUnavailable((prev) => (prev.includes(id) ? prev : [...prev, id]))
      }
      setOauthErr(msg)
      showToast(msg)
    } finally {
      setOauthBusy(false)
    }
  }

  async function pollOauth() {
    if (!oauthState) return
    setOauthBusy(true)
    try {
      const d = await api.get<Record<string, unknown>>(
        `/api/admin/oauth/status?state=${encodeURIComponent(oauthState)}`,
      )
      setOauthStatus(d)
      showToast(P('已刷新状态'))
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setOauthBusy(false)
    }
  }

  async function submitOauthCallback() {
    if (!oauthState || !callbackUrl.trim()) return
    setOauthBusy(true)
    try {
      await api.post('/api/admin/oauth/callback', {
        state: oauthState,
        redirect_url: callbackUrl.trim(),
      })
      showToast(P('已提交回调'))
      setCallbackUrl('')
      await pollOauth()
      // Refresh credential list — pick up new auth-file if present
      const before = new Set(knownNames)
      await load()
      const after = await api.get<{ items: Account[] }>('/api/admin/accounts')
      const added = (after.items || []).map(accountName).filter((n) => n && !before.has(n))
      if (added.length) {
        showToast(`${P('检测到新凭证')} · ${added.slice(0, 3).join(', ')}`)
      }
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setOauthBusy(false)
    }
  }

  async function saveAlias() {
    try {
      const parsed = JSON.parse(aliasJson)
      await api.put('/api/admin/oauth/model-alias', { alias: parsed })
      showToast(P('已保存模型别名'))
    } catch (e) {
      showToast((e as Error).message)
    }
  }

  async function saveExcluded() {
    try {
      const parsed = JSON.parse(excludedJson)
      await api.put('/api/admin/oauth/excluded-models', { excluded: parsed })
      showToast(P('已保存排除模型'))
    } catch (e) {
      showToast((e as Error).message)
    }
  }

  function startReauth(a: Account) {
    const provider = String(a.provider || '')
      .toLowerCase()
      .replace(/-auth-url$/, '')
    if (!provider) {
      showToast(P('该凭证缺少 provider，请手动在 OAuth 配置页选择'))
      switchTab('oauth')
      return
    }
    const mapped = OAUTH_PROVIDERS.includes(provider)
      ? provider
      : OAUTH_PROVIDERS.find((p) => provider.includes(p) || p.includes(provider))
    if (!mapped) {
      showToast(`${P('未识别的提供商')} · ${provider}`)
      switchTab('oauth')
      return
    }
    void startOauth(mapped, true)
  }

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero
        title={P('凭证管理')}
        subtitle={P('CPA auth-files 工作台：列表筛选 / 批量操作 / 重新认证；OAuth 配置含提供商登录与模型别名。本站 Aily/Grok 请前往「本站上游」。')}
      />

      <div className="diag-tabs" style={{ marginBottom: 16 }}>
        <button type="button" className={tab === 'list' ? 'on' : ''} onClick={() => switchTab('list')}>
          {P('凭证列表')}
          {pool ? <span className="n">{pool.total}</span> : null}
        </button>
        <button type="button" className={tab === 'oauth' ? 'on' : ''} onClick={() => switchTab('oauth')}>
          {P('OAuth 配置')}
        </button>
      </div>

      {tab === 'list' ? (
        <>
          <div className="channels-toolbar">
            <span className="muted">
              {observedAt
                ? `${P('观测时间')} · ${new Date(observedAt).toLocaleString('zh-CN', {
                    timeZone: 'Asia/Shanghai',
                    hour12: false,
                  })}`
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
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <input
                style={{ minWidth: 220, flex: 1 }}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={P('搜索 id / email / 备注')}
              />
              <select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)}>
                <option value="all">{P('全部提供商')}</option>
                {providers.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                {STATUS_FILTERS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {P(s.label)}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12, alignItems: 'center' }}>
              <button type="button" className="button secondary compact" onClick={toggleAllFiltered}>
                {allFilteredSelected ? <CheckSquare size={14} /> : <Square size={14} />}{' '}
                {allFilteredSelected ? P('取消全选') : P('全选筛选结果')}
                {selectedNames.length ? ` (${selectedNames.length})` : ''}
              </button>
              <button
                type="button"
                className="button compact"
                disabled={batchBusy || !selectedNames.length}
                onClick={() => runBatch('enable')}
              >
                <Power size={14} /> {P('批量启用')}
              </button>
              <button
                type="button"
                className="button secondary compact"
                disabled={batchBusy || !selectedNames.length}
                onClick={() => runBatch('disable')}
              >
                <Ban size={14} /> {P('批量禁用')}
              </button>
              <button
                type="button"
                className="button secondary compact"
                disabled={batchBusy || !selectedNames.length}
                onClick={() => runBatch('delete')}
              >
                <Trash2 size={14} /> {P('批量删除')}
              </button>
              <input
                style={{ width: 72 }}
                value={batchPriority}
                onChange={(e) => setBatchPriority(e.target.value)}
                placeholder="prio"
                title={P('批量优先级')}
              />
              <button
                type="button"
                className="button secondary compact"
                disabled={batchBusy || !selectedNames.length}
                onClick={() => runBatch('priority')}
              >
                {P('批量调优先级')}
              </button>
            </div>
          </div>

          <div className="panel" style={{ marginBottom: 16 }}>
            <h3>
              <Upload size={14} /> {P('上传凭证 JSON')}
            </h3>
            <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
              {P('BFF 以 multipart 转发至 CPA auth-files；切勿向 auth-files?name= POST JSON。')}
            </p>
            <div className="field" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                style={{ minWidth: 220 }}
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                placeholder="provider-email.json"
              />
              <input type="file" accept=".json,application/json" onChange={onPickFile} />
              <button type="button" className="button" disabled={busyName === 'upload'} onClick={doUpload}>
                {P('上传')}
              </button>
            </div>
            <textarea
              rows={3}
              style={{ width: '100%', marginTop: 8, fontFamily: 'monospace', fontSize: 12 }}
              value={uploadContent}
              onChange={(e) => setUploadContent(e.target.value)}
              placeholder={P('或粘贴 JSON 内容')}
            />
          </div>

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 36 }} />
                  <th>{P('凭证')}</th>
                  <th>{P('提供商')}</th>
                  <th>{P('状态')}</th>
                  <th>OK/Fail</th>
                  <th>{P('优先级')}</th>
                  <th>{P('备注')}</th>
                  <th>{P('操作')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => {
                  const name = accountName(a)
                  const display = resolveDisplay(a)
                  const busy = busyName === name
                  return (
                    <tr key={a.id || name}>
                      <td>
                        <input
                          type="checkbox"
                          checked={!!selected[name]}
                          onChange={() =>
                            setSelected((prev) => {
                              const next = { ...prev }
                              if (next[name]) delete next[name]
                              else next[name] = true
                              return next
                            })
                          }
                        />
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{a.label || a.email || name}</div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          <code>{name}</code>
                          {a.email ? ` · ${a.email}` : ''}
                        </div>
                        {a.status_message ? (
                          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                            {a.status_message}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <code>{a.provider || '—'}</code>
                      </td>
                      <td>
                        <span className={badgeClass(display)}>● {badgeLabel(display, a.status)}</span>
                      </td>
                      <td>
                        {a.success ?? 0} / {a.failed ?? 0}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <input
                            style={{ width: 64 }}
                            value={priorityDraft[name] ?? ''}
                            onChange={(e) =>
                              setPriorityDraft((prev) => ({ ...prev, [name]: e.target.value }))
                            }
                          />
                          <button
                            type="button"
                            className="button secondary compact"
                            disabled={busy}
                            onClick={() => savePriority(name)}
                          >
                            {P('存')}
                          </button>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <input
                            style={{ minWidth: 100, width: '100%' }}
                            value={noteDraft[name] ?? ''}
                            onChange={(e) =>
                              setNoteDraft((prev) => ({ ...prev, [name]: e.target.value }))
                            }
                            placeholder={P('备注')}
                          />
                          <button
                            type="button"
                            className="button secondary compact"
                            disabled={busy}
                            onClick={() => saveNote(name)}
                          >
                            {P('存')}
                          </button>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          <button
                            type="button"
                            className="button secondary compact"
                            disabled={busy}
                            onClick={() => forceRefresh(name)}
                            title={P('强制刷新')}
                          >
                            <RotateCw size={14} />
                          </button>
                          {a.disabled ? (
                            <button
                              type="button"
                              className="button compact"
                              disabled={busy}
                              onClick={() => setDisabled(name, false)}
                            >
                              <Power size={14} /> {P('启用')}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="button secondary compact"
                              disabled={busy}
                              onClick={() => setDisabled(name, true)}
                            >
                              <Ban size={14} /> {P('禁用')}
                            </button>
                          )}
                          <button
                            type="button"
                            className="button secondary compact"
                            disabled={busy}
                            onClick={() => startReauth(a)}
                          >
                            <KeyRound size={14} /> {P('重新认证')}
                          </button>
                          <button
                            type="button"
                            className="button secondary compact"
                            disabled={busy}
                            onClick={() => download(name)}
                          >
                            <Download size={14} />
                          </button>
                          <button
                            type="button"
                            className="button secondary compact"
                            disabled={busy}
                            onClick={() => remove(name)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                          {a.last_refresh
                            ? `${P('最近刷新')} · ${new Date(a.last_refresh).toLocaleString('zh-CN', {
                                timeZone: 'Asia/Shanghai',
                                hour12: false,
                              })}`
                            : ''}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!loading && !filtered.length && !err ? (
            <p className="empty-state">{items.length ? P('无匹配凭证。') : P('暂无上游账号。')}</p>
          ) : null}
        </>
      ) : (
        <>
          <div className="panel" style={{ marginTop: 4 }}>
            <h3>{P('选择提供商')}</h3>
            <p className="muted" style={{ marginTop: 0, marginBottom: 10, fontSize: 13 }}>
              {P('启动 CPA OAuth → 打开授权页 → 粘贴回调地址。完成后会刷新凭证列表。')}
              {reauthProvider ? ` · ${P('重新认证')} · ${reauthProvider}` : ''}
            </p>
            {oauthErr ? <p style={{ color: 'var(--error)' }}>{oauthErr}</p> : null}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {OAUTH_PROVIDERS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="button secondary compact"
                  disabled={oauthBusy || unavailable.includes(id)}
                  title={unavailable.includes(id) ? P('此提供商当前不可用') : ''}
                  onClick={() => startOauth(id)}
                >
                  {id}
                  {unavailable.includes(id) ? ' (N/A)' : ''}
                </button>
              ))}
            </div>
          </div>

          <div className="panel" style={{ marginTop: 16 }}>
            <h3>{P('授权进度')}</h3>
            <p>
              <span className="muted">{P('会话标识')}</span> · <code>{oauthState || '—'}</code>
            </p>
            {userCode ? (
              <p>
                <span className="muted">{P('设备码')}</span> · <code>{userCode}</code>
              </p>
            ) : null}
            {authUrl ? (
              <p>
                <a href={authUrl} target="_blank" rel="noreferrer">
                  {P('打开授权页')} <ExternalLink size={14} />
                </a>
                <div className="muted" style={{ wordBreak: 'break-all', fontSize: 12, marginTop: 4 }}>
                  {authUrl}
                </div>
              </p>
            ) : null}
            <div className="field" style={{ marginTop: 12 }}>
              <label>{P('回调地址')}</label>
              <input
                style={{ width: '100%' }}
                value={callbackUrl}
                onChange={(e) => setCallbackUrl(e.target.value)}
                placeholder="http://localhost:.../callback?code=..."
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="button"
                disabled={oauthBusy || !oauthState || !callbackUrl.trim()}
                onClick={submitOauthCallback}
              >
                {P('提交回调')}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={oauthBusy || !oauthState}
                onClick={pollOauth}
              >
                <RefreshCw size={14} /> {P('刷新状态')}
              </button>
              <button type="button" className="button secondary" disabled={loading} onClick={load}>
                {P('刷新凭证列表')}
              </button>
            </div>
            {oauthStatus ? (
              <pre style={{ marginTop: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12 }}>
                {JSON.stringify(oauthStatus, null, 2)}
              </pre>
            ) : null}
          </div>

          <div className="panel" style={{ marginTop: 16 }}>
            <h3>{P('模型别名')} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>oauth-model-alias</span></h3>
            <textarea
              rows={6}
              style={{ width: '100%', fontFamily: 'monospace' }}
              value={aliasJson}
              onChange={(e) => setAliasJson(e.target.value)}
            />
            <button type="button" className="button" style={{ marginTop: 8 }} onClick={saveAlias}>
              {P('保存别名')}
            </button>
          </div>

          <div className="panel" style={{ marginTop: 16 }}>
            <h3>{P('排除模型')} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>oauth-excluded-models</span></h3>
            <textarea
              rows={4}
              style={{ width: '100%', fontFamily: 'monospace' }}
              value={excludedJson}
              onChange={(e) => setExcludedJson(e.target.value)}
            />
            <button type="button" className="button" style={{ marginTop: 8 }} onClick={saveExcluded}>
              {P('保存排除列表')}
            </button>
          </div>

          <p className="muted" style={{ marginTop: 16, fontSize: 13 }}>
            {P('Aily / Grok / 本站上游账号不在此页，请前往')}{' '}
            <a
              href="/admin/oauth"
              onClick={(e) => {
                e.preventDefault()
                navigate('/admin/oauth')
              }}
            >
              {P('本站上游')}
            </a>
            。
          </p>
        </>
      )}
    </AdminLayout>
  )
}
