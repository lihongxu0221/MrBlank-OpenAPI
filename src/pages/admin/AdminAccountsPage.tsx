import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'
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
  LayoutGrid,
  Table2,
  Eye,
  EyeOff,
  X,
  ScanSearch,
} from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'
import { useToast } from '../../hooks/useStore'
import { getHashQuery, navigate, navigateWithQuery } from '../../router/hash'

type QuotaSnap = {
  remaining_ratio?: number | null
  remaining?: number | null
  limit?: number | null
  window?: string | null
  resets_at?: string | null
  risk?: string | null
  plan_type?: string | null
  observed_at_ms?: number
  source?: string
}

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
  created_at?: string | null
  updated_at?: string | null
  status_message?: string
  note?: string | null
  priority?: number | null
  weight?: number | null
  proxy_url?: string | null
  prefix?: string | null
  websockets?: boolean | null
  cooling?: unknown
  excluded_models?: unknown
  plan_type?: string | null
  auth_index?: string | number | null
  recent_requests?: { time?: string; success?: number; failed?: number }[]
  quota?: QuotaSnap | null
}

type Pool = {
  total: number
  active: number
  unavailable: number
  disabled: number
  need_reauth?: number
  attention?: number
  quota_risk?: number
  by_provider: { provider: string; count: number }[]
}

type TabId = 'list' | 'health' | 'oauth' | 'credentials'
type ViewMode = 'table' | 'card'
type DetailTab = 'overview' | 'quota' | 'config' | 'models'

type InspectionFinding = {
  id: string
  name?: string | null
  label?: string | null
  provider?: string | null
  status?: string | null
  status_message?: string
  disabled?: boolean
  verdict?: string
  severity?: string
  suggested_actions?: string[]
}

type InspectionRun = {
  id: string
  status: string
  created_at?: string
  finished_at?: string | null
  summary?: { scanned?: number; ok?: number; expired?: number; error?: number; disabled?: number } | null
  finding_count?: number
  findings?: InspectionFinding[]
  note?: string
  error?: string | null
}

const OAUTH_PROVIDERS = [
  'anthropic',
  'codex',
  'antigravity',
  'kimi',
  'xai',
  'devin',
  'qwen',
  'iflow',
  'gemini-cli',
]

const STATUS_FILTERS: { id: string; label: string }[] = [
  { id: 'all', label: '全部状态' },
  { id: 'running', label: '运行中' },
  { id: 'disabled', label: '已禁用' },
  { id: 'unavailable', label: '不可用' },
  { id: 'need_reauth', label: '需重新认证' },
  { id: 'quota_risk', label: '额度风险' },
]

const SORT_OPTS: { id: string; label: string }[] = [
  { id: 'name', label: '名称' },
  { id: 'priority', label: '优先级' },
  { id: 'success', label: '请求量' },
  { id: 'quota', label: '额度剩余' },
  { id: 'updated', label: '更新时间' },
]

const PAGE_SIZES = [20, 50, 100, 200]

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

function maskId(name: string, show: boolean) {
  if (show || name.length <= 10) return name
  return `${name.slice(0, 4)}…${name.slice(-4)}`
}

function fmtTime(iso?: string | null) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
  } catch {
    return String(iso)
  }
}

function fmtRatio(r?: number | null) {
  if (r == null || !Number.isFinite(r)) return '—'
  return `${Math.round(r * 1000) / 10}%`
}

function readInitialTab(): TabId {
  const t = getHashQuery().get('tab')
  if (t === 'health' || t === 'oauth' || t === 'credentials' || t === 'list') return t
  return 'list'
}

function previewAliasRules(aliasJson: string, excludedJson: string) {
  let alias: unknown = {}
  let excluded: unknown = []
  const notes: string[] = []
  try {
    alias = JSON.parse(aliasJson || '{}')
  } catch {
    notes.push(P('模型别名 JSON 无效'))
  }
  try {
    excluded = JSON.parse(excludedJson || '[]')
  } catch {
    notes.push(P('排除模型 JSON 无效'))
  }
  const aliasKeys =
    alias && typeof alias === 'object' && !Array.isArray(alias) ? Object.keys(alias as object) : []
  const excludedCount = Array.isArray(excluded)
    ? excluded.length
    : excluded && typeof excluded === 'object'
      ? Object.keys(excluded as object).length
      : 0
  return {
    aliasProviders: aliasKeys,
    excludedCount,
    notes,
    summary: `${P('别名提供商')} ${aliasKeys.length || 0} · ${P('排除规则')} ${excludedCount}`,
  }
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

  const [q, setQ] = useState('')
  const [providerFilter, setProviderFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('name')
  const [viewMode, setViewMode] = useState<ViewMode>('table')
  const [showFullId, setShowFullId] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({})
  const [priorityDraft, setPriorityDraft] = useState<Record<string, string>>({})
  const [batchPriority, setBatchPriority] = useState('0')
  const [batchWeight, setBatchWeight] = useState('1')
  const [batchBusy, setBatchBusy] = useState(false)

  const [detail, setDetail] = useState<Account | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('overview')
  const [detailModels, setDetailModels] = useState<unknown>(null)
  const [detailModelsErr, setDetailModelsErr] = useState<string | null>(null)
  const [configDraft, setConfigDraft] = useState({
    note: '',
    priority: '',
    weight: '',
    proxy_url: '',
    prefix: '',
    websockets: false,
  })

  // OAuth config tab
  const [aliasJson, setAliasJson] = useState('{}')
  const [excludedJson, setExcludedJson] = useState('[]')

  // Credentials tab upload
  const [pasteType, setPasteType] = useState<'cpa' | 'session' | 'sub2api'>('cpa')
  const [uploadName, setUploadName] = useState('')
  const [uploadContent, setUploadContent] = useState('')
  const [credProviderFilter, setCredProviderFilter] = useState('all')

  // Health tab
  const [inspList, setInspList] = useState<{ items: InspectionRun[]; note?: string } | null>(null)
  const [inspSelected, setInspSelected] = useState<InspectionRun | null>(null)
  const [inspBusy, setInspBusy] = useState<string | null>(null)
  const [inspErr, setInspErr] = useState<string | null>(null)

  function switchTab(next: TabId) {
    setTab(next)
    if (next === 'list') navigate('/admin/accounts')
    else navigateWithQuery('/admin/accounts', { tab: next })
  }

  const load = useCallback(async () => {
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
  }, [gate.allowed])

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

  const loadInspection = useCallback(async () => {
    if (!gate.allowed) return
    setInspErr(null)
    try {
      const d = await api.get<{ items: InspectionRun[]; note?: string }>('/api/admin/codex-inspection/runs?limit=20')
      setInspList(d)
    } catch (e) {
      setInspErr((e as Error).message)
    }
  }, [gate.allowed])

  useEffect(() => {
    if (!gate.allowed) return
    load()
    loadOauthConfig()
  }, [gate.allowed, load])

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

  useEffect(() => {
    if (tab === 'health' && gate.allowed) loadInspection()
  }, [tab, gate.allowed, loadInspection])

  useEffect(() => {
    setPage(1)
  }, [q, providerFilter, statusFilter, sortBy, pageSize])

  const providers = useMemo(() => {
    const set = new Set<string>()
    for (const a of items) {
      if (a.provider) set.add(String(a.provider))
    }
    return [...set].sort()
  }, [items])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let list = items.filter((a) => {
      const name = accountName(a)
      const display = resolveDisplay(a)
      if (providerFilter !== 'all' && String(a.provider || '') !== providerFilter) return false
      if (statusFilter === 'quota_risk') {
        if (!a.quota || !['low', 'critical', 'exhausted'].includes(String(a.quota.risk || ''))) return false
      } else if (statusFilter !== 'all' && display !== statusFilter) return false
      if (!needle) return true
      const hay = `${name} ${a.email || ''} ${a.note || ''} ${a.label || ''}`.toLowerCase()
      return hay.includes(needle)
    })
    list = [...list].sort((a, b) => {
      if (sortBy === 'priority') return Number(b.priority || 0) - Number(a.priority || 0)
      if (sortBy === 'success') return Number(b.success || 0) + Number(b.failed || 0) - (Number(a.success || 0) + Number(a.failed || 0))
      if (sortBy === 'quota') {
        const ra = a.quota?.remaining_ratio
        const rb = b.quota?.remaining_ratio
        if (ra == null && rb == null) return 0
        if (ra == null) return 1
        if (rb == null) return -1
        return ra - rb
      }
      if (sortBy === 'updated') {
        const ta = Date.parse(String(a.updated_at || a.last_refresh || 0)) || 0
        const tb = Date.parse(String(b.updated_at || b.last_refresh || 0)) || 0
        return tb - ta
      }
      return accountName(a).localeCompare(accountName(b))
    })
    return list
  }, [items, q, providerFilter, statusFilter, sortBy])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])

  const selectedNames = useMemo(
    () => filtered.map(accountName).filter((n) => selected[n]),
    [filtered, selected],
  )

  const allPageSelected = pageItems.length > 0 && pageItems.every((a) => selected[accountName(a)])

  function toggleAllPage() {
    setSelected((prev) => {
      const next = { ...prev }
      if (allPageSelected) {
        for (const a of pageItems) delete next[accountName(a)]
      } else {
        for (const a of pageItems) next[accountName(a)] = true
      }
      return next
    })
  }

  function toggleAllFiltered() {
    setSelected((prev) => {
      const next = { ...prev }
      const all = filtered.length > 0 && filtered.every((a) => prev[accountName(a)])
      if (all) {
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
      if (detail && accountName(detail) === name) setDetail(null)
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
    const priority = Number(priorityDraft[name])
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

  async function resetQuota(a: Account) {
    const name = accountName(a)
    setBusyName(name)
    try {
      await api.post('/api/admin/accounts/reset-quota', {
        name,
        auth_index: a.auth_index ?? undefined,
      })
      showToast(P('已请求重置额度'))
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusyName(null)
    }
  }

  async function runBatch(action: 'enable' | 'disable' | 'delete' | 'priority' | 'weight' | 'download') {
    if (!selectedNames.length) {
      showToast(P('请先勾选凭证'))
      return
    }
    if (action === 'delete' && !confirm(P('确认批量删除所选凭证？此操作不可恢复。'))) return
    let priority: number | undefined
    let weight: number | undefined
    if (action === 'priority') {
      priority = Number(batchPriority)
      if (!Number.isFinite(priority)) {
        showToast(P('批量优先级须为数字'))
        return
      }
    }
    if (action === 'weight') {
      weight = Number(batchWeight)
      if (!Number.isFinite(weight)) {
        showToast(P('批量权重须为数字'))
        return
      }
    }
    setBatchBusy(true)
    try {
      const d = await api.post<{
        ok_count?: number
        fail_count?: number
        results?: { name: string; ok: boolean; error?: string }[]
        downloads?: { name: string; content: unknown }[]
      }>('/api/admin/accounts/batch', {
        action,
        names: selectedNames,
        ...(action === 'priority' ? { priority } : {}),
        ...(action === 'weight' ? { weight } : {}),
      })
      if (action === 'download' && d.downloads?.length) {
        for (const file of d.downloads) {
          const text = JSON.stringify(file.content, null, 2)
          const blob = new Blob([text], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = file.name
          a.click()
          URL.revokeObjectURL(url)
        }
      }
      showToast(`${P('批量完成')} · ok ${d.ok_count ?? 0} / fail ${d.fail_count ?? 0}`)
      const firstFail = d.results?.find((r) => !r.ok)
      if (firstFail?.error) showToast(firstFail.error)
      setSelected({})
      await load()
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBatchBusy(false)
    }
  }

  function openDetail(a: Account) {
    setDetail(a)
    setDetailTab('overview')
    setDetailModels(null)
    setDetailModelsErr(null)
    setConfigDraft({
      note: a.note != null ? String(a.note) : '',
      priority: a.priority != null ? String(a.priority) : '',
      weight: a.weight != null ? String(a.weight) : '',
      proxy_url: a.proxy_url != null ? String(a.proxy_url) : '',
      prefix: a.prefix != null ? String(a.prefix) : '',
      websockets: !!a.websockets,
    })
  }

  async function loadDetailModels(name: string) {
    setDetailModelsErr(null)
    try {
      const d = await api.get<{ models: unknown }>(`/api/admin/accounts/models?name=${encodeURIComponent(name)}`)
      setDetailModels(d.models)
    } catch (e) {
      setDetailModelsErr((e as Error).message)
      setDetailModels(null)
    }
  }

  useEffect(() => {
    if (detail && detailTab === 'models') {
      void loadDetailModels(accountName(detail))
    }
  }, [detail, detailTab])

  async function saveDetailConfig() {
    if (!detail) return
    const name = accountName(detail)
    const fields: Record<string, unknown> = {
      note: configDraft.note,
      websockets: configDraft.websockets,
    }
    if (configDraft.priority !== '') fields.priority = Number(configDraft.priority)
    if (configDraft.weight !== '') fields.weight = Number(configDraft.weight)
    if (configDraft.proxy_url !== '') fields.proxy_url = configDraft.proxy_url
    if (configDraft.prefix !== '') fields.prefix = configDraft.prefix
    setBusyName(name)
    try {
      await api.patch('/api/admin/accounts/fields', { name, ...fields })
      showToast(P('配置已保存'))
      await load()
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusyName(null)
    }
  }

  function startReauth(a: Account) {
    const provider = String(a.provider || '')
      .toLowerCase()
      .replace(/-auth-url$/, '')
    const mapped = OAUTH_PROVIDERS.includes(provider)
      ? provider
      : OAUTH_PROVIDERS.find((p) => provider.includes(p) || p.includes(provider))
    if (!mapped) {
      showToast(P('未识别提供商，请前往 OAuth 登录页手动选择'))
      navigate('/admin/oauth')
      return
    }
    navigateWithQuery('/admin/oauth', { provider: mapped, reauth: accountName(a) })
  }

  async function doConvertUpload() {
    if (!uploadContent.trim()) {
      showToast(P('请粘贴或选择 JSON'))
      return
    }
    setBusyName('upload')
    try {
      const d = await api.post<{
        ok_count?: number
        fail_count?: number
        convert_failures?: { error?: string }[]
      }>('/api/admin/accounts/convert-upload', {
        paste_type: pasteType,
        filename: uploadName.trim() || undefined,
        content: uploadContent,
      })
      showToast(`${P('上传完成')} · ok ${d.ok_count ?? 0} / fail ${d.fail_count ?? 0}`)
      if (d.convert_failures?.length) showToast(d.convert_failures[0].error || P('部分转换失败'))
      setUploadContent('')
      setUploadName('')
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
    reader.onload = () => setUploadContent(String(reader.result || ''))
    reader.readAsText(file)
    e.target.value = ''
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

  async function runInspection() {
    setInspBusy('run')
    try {
      await api.post('/api/admin/codex-inspection/run', {})
      showToast(P('已启动巡检'))
      await loadInspection()
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setInspBusy(null)
    }
  }

  async function openInspection(id: string) {
    setInspBusy(id)
    try {
      const d = await api.get<InspectionRun>(`/api/admin/codex-inspection/runs/${encodeURIComponent(id)}`)
      setInspSelected(d)
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setInspBusy(null)
    }
  }

  const aliasPreview = useMemo(() => previewAliasRules(aliasJson, excludedJson), [aliasJson, excludedJson])

  const credItems = useMemo(() => {
    if (credProviderFilter === 'all') return items
    return items.filter((a) => String(a.provider || '') === credProviderFilter)
  }, [items, credProviderFilter])

  function renderRowActions(a: Account, compact = false) {
    const name = accountName(a)
    const busy = busyName === name
    const cls = compact ? 'button secondary compact' : 'button secondary compact'
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        <button type="button" className={cls} disabled={busy} onClick={() => openDetail(a)}>
          {P('详情')}
        </button>
        <button type="button" className={cls} disabled={busy} onClick={() => forceRefresh(name)}>
          <RotateCw size={14} /> {P('刷新')}
        </button>
        {a.disabled ? (
          <button type="button" className="button compact" disabled={busy} onClick={() => setDisabled(name, false)}>
            <Power size={14} /> {P('启用')}
          </button>
        ) : (
          <button type="button" className={cls} disabled={busy} onClick={() => setDisabled(name, true)}>
            <Ban size={14} /> {P('禁用')}
          </button>
        )}
        <button type="button" className={cls} disabled={busy} onClick={() => startReauth(a)}>
          <KeyRound size={14} /> {P('重登')}
        </button>
        <button type="button" className={cls} disabled={busy} onClick={() => download(name)}>
          <Download size={14} />
        </button>
        <button type="button" className={cls} disabled={busy} onClick={() => remove(name)}>
          <Trash2 size={14} />
        </button>
      </div>
    )
  }

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero
        title={P('凭证管理')}
        subtitle={P(
          'CPA auth-files 工作台：凭证列表 / 健康巡检 / OAuth 配置 / 登录凭证。完整 CPA OAuth 九大提供商仍在「OAuth 登录」页；Aily/Grok 为「本站上游」。',
        )}
      />

      <div className="diag-tabs" style={{ marginBottom: 16 }}>
        <button type="button" className={tab === 'list' ? 'on' : ''} onClick={() => switchTab('list')}>
          {P('凭证列表')}
          {pool ? <span className="n">{pool.total}</span> : null}
        </button>
        <button type="button" className={tab === 'health' ? 'on' : ''} onClick={() => switchTab('health')}>
          {P('健康巡检')}
        </button>
        <button type="button" className={tab === 'oauth' ? 'on' : ''} onClick={() => switchTab('oauth')}>
          {P('OAuth 配置')}
        </button>
        <button type="button" className={tab === 'credentials' ? 'on' : ''} onClick={() => switchTab('credentials')}>
          {P('登录凭证')}
        </button>
      </div>

      {tab === 'list' ? (
        <>
          <div className="channels-toolbar">
            <span className="muted">
              {observedAt ? `${P('观测时间')} · ${fmtTime(observedAt)}` : ''}
            </span>
            <button type="button" className="button secondary compact" onClick={load} disabled={loading}>
              <RefreshCw size={14} /> {P('刷新列表')}
            </button>
          </div>
          {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}

          {pool ? (
            <div className="stats-grid" style={{ marginBottom: 16 }}>
              <div className="stat-card">
                <div className="label">{P('总凭证')}</div>
                <div className="value">{pool.total}</div>
              </div>
              <div className="stat-card">
                <div className="label">{P('正常可用')}</div>
                <div className="value">{pool.active}</div>
              </div>
              <div className="stat-card">
                <div className="label">{P('需处理')}</div>
                <div className="value">{pool.attention ?? pool.unavailable}</div>
              </div>
              <div className="stat-card">
                <div className="label">{P('额度风险')}</div>
                <div className="value">{pool.quota_risk ?? 0}</div>
              </div>
              <div className="stat-card">
                <div className="label">{P('已禁用')}</div>
                <div className="value">{pool.disabled}</div>
              </div>
              <div className="stat-card">
                <div className="label">{P('需重登')}</div>
                <div className="value">{pool.need_reauth ?? 0}</div>
              </div>
            </div>
          ) : null}

          <div className="panel" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <input
                style={{ minWidth: 220, flex: 1 }}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={P('搜索凭证 / 邮箱 / 备注')}
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
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                {SORT_OPTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {P('排序')} · {P(s.label)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={`button compact ${viewMode === 'table' ? '' : 'secondary'}`}
                onClick={() => setViewMode('table')}
                title={P('表格')}
              >
                <Table2 size={14} />
              </button>
              <button
                type="button"
                className={`button compact ${viewMode === 'card' ? '' : 'secondary'}`}
                onClick={() => setViewMode('card')}
                title={P('卡片')}
              >
                <LayoutGrid size={14} />
              </button>
              <button
                type="button"
                className="button secondary compact"
                onClick={() => setShowFullId((v) => !v)}
                title={P('切换标识脱敏')}
              >
                {showFullId ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12, alignItems: 'center' }}>
              <button type="button" className="button secondary compact" onClick={toggleAllPage}>
                {allPageSelected ? <CheckSquare size={14} /> : <Square size={14} />} {P('全选本页')}
              </button>
              <button type="button" className="button secondary compact" onClick={toggleAllFiltered}>
                {P('全选筛选')}
                {selectedNames.length ? ` (${selectedNames.length})` : ''}
              </button>
              <button type="button" className="button compact" disabled={batchBusy || !selectedNames.length} onClick={() => runBatch('enable')}>
                <Power size={14} /> {P('批量启用')}
              </button>
              <button type="button" className="button secondary compact" disabled={batchBusy || !selectedNames.length} onClick={() => runBatch('disable')}>
                <Ban size={14} /> {P('批量禁用')}
              </button>
              <button type="button" className="button secondary compact" disabled={batchBusy || !selectedNames.length} onClick={() => runBatch('delete')}>
                <Trash2 size={14} /> {P('批量删除')}
              </button>
              <button type="button" className="button secondary compact" disabled={batchBusy || !selectedNames.length} onClick={() => runBatch('download')}>
                <Download size={14} /> {P('批量下载')}
              </button>
              <input style={{ width: 64 }} value={batchPriority} onChange={(e) => setBatchPriority(e.target.value)} title={P('批量优先级')} />
              <button type="button" className="button secondary compact" disabled={batchBusy || !selectedNames.length} onClick={() => runBatch('priority')}>
                {P('批量优先级')}
              </button>
              <input style={{ width: 64 }} value={batchWeight} onChange={(e) => setBatchWeight(e.target.value)} title={P('批量权重')} />
              <button type="button" className="button secondary compact" disabled={batchBusy || !selectedNames.length} onClick={() => runBatch('weight')}>
                {P('批量权重')}
              </button>
            </div>
          </div>

          {viewMode === 'table' ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 36 }} />
                    <th>{P('凭证')}</th>
                    <th>{P('平台')}</th>
                    <th>{P('状态')}</th>
                    <th>{P('额度')}</th>
                    <th>OK/Fail</th>
                    <th>{P('优先级')}</th>
                    <th>{P('备注')}</th>
                    <th>{P('操作')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((a) => {
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
                            <code>{maskId(name, showFullId)}</code>
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
                          {a.plan_type || a.quota?.plan_type ? (
                            <div className="muted" style={{ fontSize: 11 }}>
                              {a.plan_type || a.quota?.plan_type}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <span className={badgeClass(display)}>● {badgeLabel(display, a.status)}</span>
                          {a.quota?.risk ? (
                            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                              quota · {a.quota.risk}
                            </div>
                          ) : null}
                        </td>
                        <td>{fmtRatio(a.quota?.remaining_ratio)}</td>
                        <td>
                          {a.success ?? 0} / {a.failed ?? 0}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <input
                              style={{ width: 56 }}
                              value={priorityDraft[name] ?? ''}
                              onChange={(e) => setPriorityDraft((prev) => ({ ...prev, [name]: e.target.value }))}
                            />
                            <button type="button" className="button secondary compact" disabled={busy} onClick={() => savePriority(name)}>
                              {P('存')}
                            </button>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <input
                              style={{ minWidth: 100, width: '100%' }}
                              value={noteDraft[name] ?? ''}
                              onChange={(e) => setNoteDraft((prev) => ({ ...prev, [name]: e.target.value }))}
                            />
                            <button type="button" className="button secondary compact" disabled={busy} onClick={() => saveNote(name)}>
                              {P('存')}
                            </button>
                          </div>
                        </td>
                        <td>{renderRowActions(a, true)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="channel-grid">
              {pageItems.map((a) => {
                const name = accountName(a)
                const display = resolveDisplay(a)
                return (
                  <article key={a.id || name} className="channel-card panel">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span className={badgeClass(display)}>● {badgeLabel(display, a.status)}</span>
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
                    </div>
                    <h3>{a.label || a.email || name}</h3>
                    <p className="muted" style={{ fontSize: 12 }}>
                      <code>{maskId(name, showFullId)}</code> · {a.provider || '—'}
                    </p>
                    <div className="channel-meta">
                      <div>
                        <span className="label">OK/Fail</span>
                        <strong>
                          {a.success ?? 0} / {a.failed ?? 0}
                        </strong>
                      </div>
                      <div>
                        <span className="label">{P('额度')}</span>
                        <strong>{fmtRatio(a.quota?.remaining_ratio)}</strong>
                      </div>
                    </div>
                    {renderRowActions(a)}
                  </article>
                )
              })}
            </div>
          )}

          <div className="channels-toolbar" style={{ marginTop: 12 }}>
            <span className="muted">
              {P('共')} {filtered.length} · {P('第')} {page}/{pageCount} {P('页')}
              {filtered.length > 200 ? ` · ${P('结果较多，建议收窄筛选')}` : ''}
            </span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}/{P('页')}
                  </option>
                ))}
              </select>
              <button type="button" className="button secondary compact" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                {P('上一页')}
              </button>
              <button type="button" className="button secondary compact" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
                {P('下一页')}
              </button>
            </div>
          </div>

          {!loading && !filtered.length && !err ? <p className="empty-state">{P('没有匹配凭证')}</p> : null}
        </>
      ) : null}

      {tab === 'health' ? (
        <>
          <div className="panel" style={{ marginBottom: 16 }}>
            <h3>
              <ScanSearch size={14} /> {P('健康巡检')}
            </h3>
            <p className="muted" style={{ fontSize: 13 }}>
              {P(
                '本站 lite 巡检（基于 CPA auth-files），不依赖 CPAMP Manager Server。完整独立页仍在「Codex 巡检」。部分深度能力需后续 Rebuild。',
              )}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="button" disabled={!!inspBusy} onClick={runInspection}>
                {P('启动巡检')}
              </button>
              <button type="button" className="button secondary" disabled={!!inspBusy} onClick={loadInspection}>
                <RefreshCw size={14} /> {P('刷新记录')}
              </button>
              <button type="button" className="button secondary" onClick={() => navigate('/admin/codex-inspection')}>
                <ExternalLink size={14} /> {P('打开完整巡检页')}
              </button>
              <button type="button" className="button secondary" onClick={() => navigate('/admin/account-actions')}>
                {P('认证异常候选')}
              </button>
            </div>
            {inspList?.note ? <p className="muted" style={{ marginTop: 8 }}>{inspList.note}</p> : null}
            {inspErr ? <p style={{ color: 'var(--error)' }}>{inspErr}</p> : null}
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>{P('状态')}</th>
                  <th>{P('摘要')}</th>
                  <th>{P('时间')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(inspList?.items || []).map((r) => (
                  <tr key={r.id}>
                    <td>
                      <code>{r.id.slice(0, 8)}</code>
                    </td>
                    <td>{r.status}</td>
                    <td>
                      {r.summary
                        ? `scan ${r.summary.scanned ?? 0} · ok ${r.summary.ok ?? 0} · exp ${r.summary.expired ?? 0} · err ${r.summary.error ?? 0}`
                        : r.finding_count != null
                          ? `${r.finding_count} findings`
                          : '—'}
                    </td>
                    <td>{fmtTime(r.created_at)}</td>
                    <td>
                      <button type="button" className="button secondary compact" onClick={() => openInspection(r.id)}>
                        {P('查看')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {inspSelected ? (
            <div className="panel" style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <h3>
                  {P('巡检详情')} · <code>{inspSelected.id.slice(0, 8)}</code>
                </h3>
                <button type="button" className="button secondary compact" onClick={() => setInspSelected(null)}>
                  <X size={14} />
                </button>
              </div>
              {inspSelected.error ? <p style={{ color: 'var(--error)' }}>{inspSelected.error}</p> : null}
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{P('凭证')}</th>
                      <th>{P('判定')}</th>
                      <th>{P('建议')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(inspSelected.findings || []).map((f) => (
                      <tr key={f.id}>
                        <td>
                          <div>{f.label || f.name}</div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {f.provider} · {f.status}
                          </div>
                        </td>
                        <td>
                          {f.verdict || '—'} {f.severity ? `(${f.severity})` : ''}
                        </td>
                        <td>{(f.suggested_actions || []).join(', ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {tab === 'oauth' ? (
        <>
          <div className="panel" style={{ marginBottom: 16 }}>
            <h3>{P('授权登录入口')}</h3>
            <p className="muted" style={{ fontSize: 13 }}>
              {P('完整 CPA 九大提供商 OAuth（启动 / 设备码 / 回调 / 轮询）在独立「OAuth 登录」页，避免与本站上游混淆。')}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button type="button" className="button" onClick={() => navigate('/admin/oauth')}>
                <ExternalLink size={14} /> {P('打开 OAuth 登录')}
              </button>
              {OAUTH_PROVIDERS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="button secondary compact"
                  onClick={() => navigateWithQuery('/admin/oauth', { provider: id })}
                >
                  {id}
                </button>
              ))}
            </div>
          </div>

          <div className="panel" style={{ marginBottom: 16 }}>
            <h3>
              {P('全局模型别名')} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>oauth-model-alias</span>
            </h3>
            <textarea
              rows={8}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
              value={aliasJson}
              onChange={(e) => setAliasJson(e.target.value)}
            />
            <button type="button" className="button" style={{ marginTop: 8 }} onClick={saveAlias}>
              {P('保存别名')}
            </button>
          </div>

          <div className="panel" style={{ marginBottom: 16 }}>
            <h3>
              {P('全局排除模型')} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>oauth-excluded-models</span>
            </h3>
            <textarea
              rows={6}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
              value={excludedJson}
              onChange={(e) => setExcludedJson(e.target.value)}
            />
            <button type="button" className="button" style={{ marginTop: 8 }} onClick={saveExcluded}>
              {P('保存排除')}
            </button>
          </div>

          <div className="panel">
            <h3>{P('规则预览')}</h3>
            <p className="muted" style={{ fontSize: 13 }}>
              {P('前端推演（非 CPA 专用预览 API）。')} {aliasPreview.summary}
            </p>
            {aliasPreview.aliasProviders.length ? (
              <p>
                <span className="muted">{P('别名提供商')}</span> · {aliasPreview.aliasProviders.join(', ')}
              </p>
            ) : (
              <p className="muted">{P('暂无别名规则')}</p>
            )}
            {aliasPreview.notes.map((n) => (
              <p key={n} style={{ color: 'var(--error)' }}>
                {n}
              </p>
            ))}
          </div>
        </>
      ) : null}

      {tab === 'credentials' ? (
        <>
          <div className="panel" style={{ marginBottom: 16 }}>
            <h3>
              <Upload size={14} /> {P('上传 / 粘贴登录凭证')}
            </h3>
            <p className="muted" style={{ fontSize: 12 }}>
              {P('支持 CPA 原始 JSON、ChatGPT Session→Codex、sub2api 多账号拆分。BFF 转换后 multipart 上传至 CPA auth-files。')}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <select value={pasteType} onChange={(e) => setPasteType(e.target.value as typeof pasteType)}>
                <option value="cpa">{P('CPA 认证 JSON')}</option>
                <option value="session">{P('Session 认证 JSON')}</option>
                <option value="sub2api">{P('sub2api 账号导出')}</option>
              </select>
              <input
                style={{ minWidth: 220 }}
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                placeholder="provider-email.json"
              />
              <input type="file" accept=".json,application/json" onChange={onPickFile} />
              <button type="button" className="button" disabled={busyName === 'upload'} onClick={doConvertUpload}>
                {P('转换并上传')}
              </button>
            </div>
            <textarea
              rows={6}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
              value={uploadContent}
              onChange={(e) => setUploadContent(e.target.value)}
              placeholder={
                pasteType === 'session'
                  ? '{"accessToken":"...","user":{"email":"..."},"account":{"id":"..."}}'
                  : pasteType === 'sub2api'
                    ? '{"accounts":[...]} / {"proxies":[...]}'
                    : '{"type":"codex","access_token":"..."}'
              }
            />
          </div>

          <div className="panel" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>{P('登录凭证表')}</strong>
              <select value={credProviderFilter} onChange={(e) => setCredProviderFilter(e.target.value)}>
                <option value="all">{P('全部提供商')}</option>
                {providers.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <button type="button" className="button secondary compact" onClick={load}>
                <RefreshCw size={14} />
              </button>
            </div>
          </div>

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{P('文件名')}</th>
                  <th>{P('提供商')}</th>
                  <th>{P('状态')}</th>
                  <th>{P('更新')}</th>
                  <th>{P('操作')}</th>
                </tr>
              </thead>
              <tbody>
                {credItems.map((a) => {
                  const name = accountName(a)
                  const display = resolveDisplay(a)
                  return (
                    <tr key={a.id || name}>
                      <td>
                        <code>{maskId(name, showFullId)}</code>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {a.email || a.label || ''}
                        </div>
                      </td>
                      <td>
                        <code>{a.provider || '—'}</code>
                      </td>
                      <td>
                        <span className={badgeClass(display)}>● {badgeLabel(display, a.status)}</span>
                      </td>
                      <td>{fmtTime(a.updated_at || a.last_refresh)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <button type="button" className="button secondary compact" onClick={() => openDetail(a)}>
                            {P('详情')}
                          </button>
                          <button
                            type="button"
                            className="button secondary compact"
                            onClick={() => {
                              setDetailTab('models')
                              openDetail(a)
                            }}
                          >
                            {P('模型')}
                          </button>
                          <button type="button" className="button secondary compact" onClick={() => download(name)}>
                            <Download size={14} />
                          </button>
                          <button type="button" className="button secondary compact" onClick={() => remove(name)}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!credItems.length ? <p className="empty-state">{P('暂无登录凭证')}</p> : null}
        </>
      ) : null}

      {detail ? (
        <div
          className="cred-drawer-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            zIndex: 80,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
          onClick={() => setDetail(null)}
        >
          <aside
            className="panel"
            style={{
              width: 'min(480px, 100%)',
              height: '100%',
              margin: 0,
              borderRadius: 0,
              overflow: 'auto',
              padding: 16,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div>
                <h2 style={{ margin: 0 }}>{detail.label || detail.email || accountName(detail)}</h2>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
                  <code>{accountName(detail)}</code> · {detail.provider || '—'}
                </p>
              </div>
              <button type="button" className="button secondary compact" onClick={() => setDetail(null)}>
                <X size={14} />
              </button>
            </div>

            <div className="diag-tabs" style={{ margin: '12px 0' }}>
              {(
                [
                  ['overview', '概览'],
                  ['quota', '额度'],
                  ['config', '配置'],
                  ['models', '模型'],
                ] as [DetailTab, string][]
              ).map(([id, label]) => (
                <button key={id} type="button" className={detailTab === id ? 'on' : ''} onClick={() => setDetailTab(id)}>
                  {P(label)}
                </button>
              ))}
            </div>

            {detailTab === 'overview' ? (
              <div>
                <p>
                  <span className={badgeClass(resolveDisplay(detail))}>
                    ● {badgeLabel(resolveDisplay(detail), detail.status)}
                  </span>
                </p>
                {detail.status_message ? <p className="muted">{detail.status_message}</p> : null}
                <p>
                  OK/Fail · {detail.success ?? 0} / {detail.failed ?? 0}
                </p>
                <p>
                  {P('最近刷新')} · {fmtTime(detail.last_refresh)}
                </p>
                <p>
                  {P('更新时间')} · {fmtTime(detail.updated_at)}
                </p>
                <p className="muted" style={{ fontSize: 12 }}>
                  {P('时间线 / 7 天活动 / 候选动作：需本站 Rebuild 采集，当前为空态。')}
                </p>
              </div>
            ) : null}

            {detailTab === 'quota' ? (
              <div>
                {detail.quota ? (
                  <>
                    <p>
                      {P('剩余比例')} · {fmtRatio(detail.quota.remaining_ratio)} ({detail.quota.risk || '—'})
                    </p>
                    <p>
                      {P('窗口')} · {detail.quota.window || '—'}
                    </p>
                    <p>
                      {P('套餐')} · {detail.quota.plan_type || detail.plan_type || '—'}
                    </p>
                    <p>
                      {P('重置')} · {detail.quota.resets_at || '—'}
                    </p>
                    <p className="muted" style={{ fontSize: 12 }}>
                      source · {detail.quota.source}
                    </p>
                  </>
                ) : (
                  <p className="muted">{P('暂无额度快照。可通过 POST /api/admin/quota-snapshots 写入本站 Rebuild 数据。')}</p>
                )}
                <button
                  type="button"
                  className="button secondary compact"
                  style={{ marginTop: 8 }}
                  disabled={busyName === accountName(detail)}
                  onClick={() => resetQuota(detail)}
                >
                  {P('请求 CPA reset-quota')}
                </button>
              </div>
            ) : null}

            {detailTab === 'config' ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <label>
                  {P('备注')}
                  <input
                    style={{ width: '100%' }}
                    value={configDraft.note}
                    onChange={(e) => setConfigDraft((d) => ({ ...d, note: e.target.value }))}
                  />
                </label>
                <label>
                  {P('优先级')}
                  <input
                    style={{ width: '100%' }}
                    value={configDraft.priority}
                    onChange={(e) => setConfigDraft((d) => ({ ...d, priority: e.target.value }))}
                  />
                </label>
                <label>
                  {P('权重')}
                  <input
                    style={{ width: '100%' }}
                    value={configDraft.weight}
                    onChange={(e) => setConfigDraft((d) => ({ ...d, weight: e.target.value }))}
                  />
                </label>
                <label>
                  proxy_url
                  <input
                    style={{ width: '100%' }}
                    value={configDraft.proxy_url}
                    onChange={(e) => setConfigDraft((d) => ({ ...d, proxy_url: e.target.value }))}
                  />
                </label>
                <label>
                  prefix
                  <input
                    style={{ width: '100%' }}
                    value={configDraft.prefix}
                    onChange={(e) => setConfigDraft((d) => ({ ...d, prefix: e.target.value }))}
                  />
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={configDraft.websockets}
                    onChange={(e) => setConfigDraft((d) => ({ ...d, websockets: e.target.checked }))}
                  />
                  websockets
                </label>
                <button type="button" className="button" onClick={saveDetailConfig}>
                  {P('保存配置')}
                </button>
              </div>
            ) : null}

            {detailTab === 'models' ? (
              <div>
                {detailModelsErr ? <p style={{ color: 'var(--error)' }}>{detailModelsErr}</p> : null}
                {detailModels ? (
                  <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11 }}>
                    {JSON.stringify(detailModels, null, 2)}
                  </pre>
                ) : !detailModelsErr ? (
                  <p className="muted">{P('加载中…')}</p>
                ) : null}
              </div>
            ) : null}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              {detail.disabled ? (
                <button type="button" className="button compact" onClick={() => setDisabled(accountName(detail), false)}>
                  <Power size={14} /> {P('启用')}
                </button>
              ) : (
                <button type="button" className="button secondary compact" onClick={() => setDisabled(accountName(detail), true)}>
                  <Ban size={14} /> {P('禁用')}
                </button>
              )}
              <button type="button" className="button secondary compact" onClick={() => startReauth(detail)}>
                <KeyRound size={14} /> {P('重登')}
              </button>
              <button type="button" className="button secondary compact" onClick={() => forceRefresh(accountName(detail))}>
                <RotateCw size={14} /> {P('刷新凭证')}
              </button>
              <button type="button" className="button secondary compact" onClick={() => download(accountName(detail))}>
                <Download size={14} /> {P('下载')}
              </button>
            </div>
          </aside>
        </div>
      ) : null}
    </AdminLayout>
  )
}
