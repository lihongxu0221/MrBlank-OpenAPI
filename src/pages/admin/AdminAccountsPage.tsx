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
  Copy,
} from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'
import { useToast } from '../../hooks/useStore'
import { getHashQuery, navigate, navigateWithQuery } from '../../router/hash'
import {
  type CredModel,
  normalizeAuthFileModels,
  mergeExcludedIntoModels,
  parseExcludedModels,
  isModelExcluded,
  computeModelFilterCounts,
  toggleExcludedModel,
  excludedListsEqual,
  reconcileExcludedAfterFetch,
} from '../../lib/credModels'
import { CredListTab } from './cred/CredListTab'
import type { Account as CredAccount } from './cred/types'
import { formatPlanType } from './cred/helpers'

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
type DetailTab = 'overview' | 'quota' | 'config' | 'models' | 'diagnosis'

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

function maskEmail(email?: string | null) {
  const s = String(email || '').trim()
  if (!s || !s.includes('@')) return s || ''
  const [u, d] = s.split('@')
  if (u.length <= 2) return `${u[0] || '*'}***@${d}`
  return `${u.slice(0, 2)}***@${d}`
}

function detailHeaderLine(a: Account) {
  const label = a.label || maskEmail(a.email) || maskId(accountName(a), false)
  const bits = [label, a.provider || '—', a.plan_type || a.quota?.plan_type || null, accountName(a)].filter(Boolean)
  return bits.join(' · ')
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
  const [detailModels, setDetailModels] = useState<CredModel[]>([])
  const [detailModelsErr, setDetailModelsErr] = useState<string | null>(null)
  const [detailModelsLoading, setDetailModelsLoading] = useState(false)
  const [modelsSearch, setModelsSearch] = useState('')
  const [modelsFilter, setModelsFilter] = useState<'all' | 'available' | 'disabled'>('all')
  const [excludedDraft, setExcludedDraft] = useState<string[]>([])
  const [excludedBaseline, setExcludedBaseline] = useState<string[]>([])
  const [modelsSaving, setModelsSaving] = useState(false)
  const [diagCandidates, setDiagCandidates] = useState<unknown[] | null>(null)
  const [diagErr, setDiagErr] = useState<string | null>(null)
  const [configDraft, setConfigDraft] = useState({
    note: '',
    priority: '',
    weight: '',
    proxy_url: '',
    prefix: '',
    websockets: false,
    excluded_models_text: '',
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
    if (!detail) return
    const prevBody = document.body.style.overflow
    const prevHtml = document.documentElement.style.overflow
    document.body.classList.add('cred-drawer-open')
    document.documentElement.classList.add('cred-drawer-open')
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.classList.remove('cred-drawer-open')
      document.documentElement.classList.remove('cred-drawer-open')
      document.body.style.overflow = prevBody
      document.documentElement.style.overflow = prevHtml
    }
  }, [detail])

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

  function openDetail(a: Account, tab: DetailTab = 'overview') {
    setDetail(a)
    setDetailTab(tab)
    setDetailModels([])
    setDetailModelsErr(null)
    setModelsSearch('')
    setModelsFilter('all')
    const ex = parseExcludedModels(a.excluded_models)
    setExcludedDraft(ex)
    setExcludedBaseline(ex)
    setDiagCandidates(null)
    setDiagErr(null)
    setConfigDraft({
      note: a.note != null ? String(a.note) : '',
      priority: a.priority != null ? String(a.priority) : '',
      weight: a.weight != null ? String(a.weight) : '',
      proxy_url: a.proxy_url != null ? String(a.proxy_url) : '',
      prefix: a.prefix != null ? String(a.prefix) : '',
      websockets: !!a.websockets,
      excluded_models_text: ex.join('\n'),
    })
  }

  async function loadDetailModels(name: string) {
    setDetailModelsErr(null)
    setDetailModelsLoading(true)
    const wasDirty = !excludedListsEqual(excludedDraft, excludedBaseline)
    const localSnapshot = [...excludedDraft]
    try {
      const d = await api.get<{ models: unknown; excluded_models?: unknown }>(
        `/api/admin/accounts/models?name=${encodeURIComponent(name)}`,
      )
      const { rules, applyToDraft } = reconcileExcludedAfterFetch({
        wasDirty,
        localDraft: localSnapshot,
        apiExcluded: d.excluded_models,
        apiDefined: d.excluded_models !== undefined,
        preferLocalIfApiEmpty: true,
      })
      setDetailModels(mergeExcludedIntoModels(normalizeAuthFileModels(d.models), rules))
      if (applyToDraft) {
        setExcludedDraft(rules)
        setExcludedBaseline(rules)
        setConfigDraft((c) => ({ ...c, excluded_models_text: rules.join('\n') }))
      }
    } catch (e) {
      setDetailModelsErr((e as Error).message)
      setDetailModels([])
    } finally {
      setDetailModelsLoading(false)
    }
  }

  async function loadDetailDiagnosis(name: string) {
    setDiagErr(null)
    try {
      const d = await api.get<{ items?: unknown[] }>(`/api/admin/account-actions`)
      const items = Array.isArray(d.items) ? d.items : []
      const mine = items.filter((it) => {
        const row = it as { name?: string; account?: string; id?: string }
        const key = String(row.name || row.account || row.id || '')
        return key === name || key.includes(name) || name.includes(key)
      })
      setDiagCandidates(mine)
    } catch (e) {
      setDiagErr((e as Error).message)
      setDiagCandidates([])
    }
  }

  const detailAccountName = detail ? accountName(detail) : ''
  useEffect(() => {
    if (detailAccountName && detailTab === 'models') {
      void loadDetailModels(detailAccountName)
    }
    if (detailAccountName && detailTab === 'diagnosis') {
      void loadDetailDiagnosis(detailAccountName)
    }
    // Depend on account name + tab only — setDetail after save must not retrigger wipe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailAccountName, detailTab])

  const modelsDirty = !excludedListsEqual(excludedDraft, excludedBaseline)
  const modelsForUi = useMemo(
    () => mergeExcludedIntoModels(detailModels, excludedDraft),
    [detailModels, excludedDraft],
  )
  const modelCounts = useMemo(
    () => computeModelFilterCounts(modelsForUi, excludedDraft),
    [modelsForUi, excludedDraft],
  )
  const filteredModels = useMemo(() => {
    const q = modelsSearch.trim().toLowerCase()
    return modelsForUi.filter((m) => {
      const disabled = isModelExcluded(m.id, excludedDraft)
      if (modelsFilter === 'available' && disabled) return false
      if (modelsFilter === 'disabled' && !disabled) return false
      if (!q) return true
      const blob = `${m.id} ${m.name || ''} ${m.provider || ''}`.toLowerCase()
      return blob.includes(q)
    })
  }, [modelsForUi, excludedDraft, modelsFilter, modelsSearch])

  async function saveExcludedModels() {
    if (!detail || !modelsDirty) return
    const name = accountName(detail)
    const saved = [...excludedDraft]
    setModelsSaving(true)
    try {
      await api.patch('/api/admin/accounts/fields', { name, excluded_models: saved })
      // Local draft/baseline remain source of truth until a fresh read confirms
      setExcludedDraft(saved)
      setExcludedBaseline(saved)
      setConfigDraft((c) => ({ ...c, excluded_models_text: saved.join('\n') }))
      setDetailModels((models) => mergeExcludedIntoModels(models, saved))
      setDetail((d) => (d ? { ...d, excluded_models: saved } : d))
      showToast(P('模型规则已保存'))
      // Refresh list quietly; detailAccountName unchanged → no models reload wipe
      void load()
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setModelsSaving(false)
    }
  }

  function resetExcludedModels() {
    setExcludedDraft([...excludedBaseline])
    setConfigDraft((c) => ({ ...c, excluded_models_text: excludedBaseline.join('\n') }))
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      showToast(P('已复制'))
    } catch {
      showToast(P('复制失败'))
    }
  }

  async function saveDetailConfig() {
    if (!detail) return
    const name = accountName(detail)
    const fields: Record<string, unknown> = {
      note: configDraft.note,
      websockets: configDraft.websockets,
      excluded_models: parseExcludedModels(configDraft.excluded_models_text),
    }
    if (configDraft.priority !== '') fields.priority = Number(configDraft.priority)
    if (configDraft.weight !== '') fields.weight = Number(configDraft.weight)
    if (configDraft.proxy_url !== '') fields.proxy_url = configDraft.proxy_url
    else fields.proxy_url = ''
    if (configDraft.prefix !== '') fields.prefix = configDraft.prefix
    else fields.prefix = ''
    setBusyName(name)
    try {
      await api.patch('/api/admin/accounts/fields', { name, ...fields })
      const ex = parseExcludedModels(configDraft.excluded_models_text)
      setExcludedDraft(ex)
      setExcludedBaseline(ex)
      setDetail((d) => (d ? { ...d, excluded_models: ex } : d))
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
          '统一管理登录凭证、可用状态、剩余额度和巡检结果。完整 CPA OAuth 九大提供商仍在「OAuth 登录」页。',
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
        <CredListTab
          items={items as CredAccount[]}
          pool={pool}
          loading={loading}
          err={err}
          busyName={busyName}
          selected={selected}
          setSelected={setSelected}
          onRefresh={load}
          onPasteJson={() => switchTab('credentials')}
          onUploadFile={(file) => {
            const reader = new FileReader()
            reader.onload = () => {
              setUploadContent(String(reader.result || ''))
              setUploadName(file.name || 'upload.json')
              setPasteType('cpa')
              switchTab('credentials')
              showToast(P('已载入文件，请在「登录凭证」确认后上传'))
            }
            reader.readAsText(file)
          }}
          onOpenDetail={(a, tabId) => openDetail(a as Account, tabId)}
          onForceRefresh={forceRefresh}
          onDownload={download}
          onRemove={remove}
          onSetDisabled={setDisabled}
          onRefreshQuota={async (names) => {
            if (!names.length) {
              showToast(P('当前没有可刷新额度的凭证'))
              return
            }
            setBatchBusy(true)
            try {
              const res = await api.post<{
                success?: number
                total?: number
                rate_limited?: boolean
                results?: { name?: string; status?: string; error?: string }[]
              }>('/api/admin/accounts/refresh-quota', { names })
              const okN = Number(res?.success ?? 0)
              const total = Number(res?.total ?? names.length)
              const msg = `${P('额度刷新完成')}：${P('成功')} ${okN} / ${total}`
              showToast(res?.rate_limited ? `${msg}（部分因频率限制跳过）` : msg)
              await load()
            } catch (e: any) {
              showToast(e?.message || P('额度刷新失败'))
            } finally {
              setBatchBusy(false)
            }
          }}
          onBatch={runBatch}
          batchBusy={batchBusy}
        />
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
                            onClick={() => openDetail(a, 'models')}
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
          onClick={() => setDetail(null)}
        >
          <aside className="panel cred-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="cred-drawer-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <h2>{detail.label || maskEmail(detail.email) || accountName(detail)}</h2>
                <p className="cred-drawer-sub">
                  {detailHeaderLine(detail)}
                </p>
              </div>
              <button type="button" className="button secondary compact" onClick={() => setDetail(null)}>
                <X size={14} />
              </button>
            </div>

            <div className="diag-tabs cred-drawer-tabs">
              {(
                [
                  ['overview', '概览'],
                  ['quota', '额度'],
                  ['config', '配置'],
                  ['models', '模型'],
                  ['diagnosis', '诊断'],
                ] as [DetailTab, string][]
              ).map(([id, label]) => (
                <button key={id} type="button" className={detailTab === id ? 'on' : ''} onClick={() => setDetailTab(id)}>
                  {P(label)}
                </button>
              ))}
            </div>

            <div className="cred-drawer-body">
            {detailTab === 'overview' ? (
              <div>
                <div className="cred-section">
                  <h4>{P('可用性')}</h4>
                  <div className="cred-kv">
                    <span className="k">{P('状态')}</span>
                    <span>
                      <span className={badgeClass(resolveDisplay(detail))}>
                        ● {badgeLabel(resolveDisplay(detail), detail.status)}
                      </span>
                    </span>
                    <span className="k">{P('说明')}</span>
                    <span>{detail.status_message || '—'}</span>
                    <span className="k">OK / Fail</span>
                    <span>
                      {detail.success ?? 0} / {detail.failed ?? 0}
                    </span>
                    <span className="k">{P('套餐')}</span>
                    <span>{formatPlanType(detail.plan_type || detail.quota?.plan_type) || '—'}</span>
                    <span className="k">{P('最近刷新')}</span>
                    <span>{fmtTime(detail.last_refresh)}</span>
                    <span className="k">{P('更新时间')}</span>
                    <span>{fmtTime(detail.updated_at)}</span>
                  </div>
                </div>
                <div className="cred-section">
                  <h4>{P('额度摘要')}</h4>
                  {detail.quota ? (
                    <div className="cred-kv">
                      <span className="k">{P('剩余比例')}</span>
                      <span>
                        {fmtRatio(detail.quota.remaining_ratio)} ({detail.quota.risk || '—'})
                      </span>
                      <span className="k">{P('窗口')}</span>
                      <span>{detail.quota.window || '—'}</span>
                      <span className="k">{P('重置')}</span>
                      <span>{detail.quota.resets_at || '—'}</span>
                    </div>
                  ) : (
                    <p className="muted" style={{ fontSize: 12 }}>
                      {P('暂无额度快照（本站 Rebuild 采集后显示）。')}
                    </p>
                  )}
                </div>
                <div className="cred-section">
                  <h4>{P('最近请求')}</h4>
                  {detail.recent_requests && detail.recent_requests.length ? (
                    <div className="table-wrap">
                      <table className="data-table compact">
                        <thead>
                          <tr>
                            <th>{P('时间')}</th>
                            <th>OK</th>
                            <th>Fail</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.recent_requests.slice(-8).map((r, i) => (
                            <tr key={i}>
                              <td>{fmtTime(r.time)}</td>
                              <td>{r.success ?? 0}</td>
                              <td>{r.failed ?? 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="muted" style={{ fontSize: 12 }}>{P('CPA 未返回 recent_requests。')}</p>
                  )}
                </div>
                <div className="cred-diag-empty">
                  {P('近 200 分钟时间线 / 7 天活动 / 待处理候选：依赖本站 Rebuild 采集管线，当前为空态（非假数据）。')}
                </div>
              </div>
            ) : null}

            {detailTab === 'quota' ? (
              <div>
                {detail.quota ? (
                  <div className="cred-section">
                    <h4>{P('当前窗口')}</h4>
                    <div className="cred-kv">
                      <span className="k">{P('剩余比例')}</span>
                      <span>
                        {fmtRatio(detail.quota.remaining_ratio)} ({detail.quota.risk || '—'})
                      </span>
                      <span className="k">{P('剩余 / 上限')}</span>
                      <span>
                        {detail.quota.remaining ?? '—'} / {detail.quota.limit ?? '—'}
                      </span>
                      <span className="k">{P('窗口')}</span>
                      <span>{detail.quota.window || '—'}</span>
                      <span className="k">{P('套餐')}</span>
                      <span>{formatPlanType(detail.quota.plan_type || detail.plan_type) || '—'}</span>
                      <span className="k">{P('重置')}</span>
                      <span>{detail.quota.resets_at || '—'}</span>
                      <span className="k">{P('来源')}</span>
                      <span>{detail.quota.source || '—'}</span>
                      <span className="k">{P('观测时间')}</span>
                      <span>
                        {detail.quota.observed_at_ms
                          ? fmtTime(new Date(detail.quota.observed_at_ms).toISOString())
                          : '—'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="cred-diag-empty">
                    {P('暂无额度快照。可通过 POST /api/admin/quota-snapshots 写入本站 Rebuild 数据后在此展示。')}
                  </div>
                )}
                <div className="cred-diag-empty" style={{ marginTop: 10 }}>
                  {P('模型窗口 / 预测 / Header 诊断：需持续 Rebuild 采集；当前未接假数据。')}
                </div>
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
                <label>
                  {P('排除模型（excluded_models）')}
                  <textarea
                    style={{ width: '100%', minHeight: 88, fontFamily: 'inherit' }}
                    placeholder={P('每行或逗号分隔；仅作用于当前凭证')}
                    value={configDraft.excluded_models_text}
                    onChange={(e) => setConfigDraft((d) => ({ ...d, excluded_models_text: e.target.value }))}
                  />
                  <span className="muted" style={{ fontSize: 11 }}>
                    {P('全局别名和排除在「OAuth 配置」管理；模型 Tab 提供逐卡禁用/恢复。')}
                  </span>
                </label>
                <button type="button" className="button" onClick={saveDetailConfig}>
                  {P('保存配置')}
                </button>
              </div>
            ) : null}

            {detailTab === 'models' ? (
              <div className="cred-models-panel">
                <div className="cred-models-toolbar">
                  <div className="title">
                    {accountName(detail)} · {modelCounts.all} {P('个模型')}
                  </div>
                  <div className="actions">
                    <button
                      type="button"
                      className="button secondary compact"
                      onClick={() => {
                        setDetail(null)
                        switchTab('oauth')
                      }}
                    >
                      {P('管理全局规则')}
                    </button>
                    <button
                      type="button"
                      className="button secondary compact"
                      disabled={detailModelsLoading}
                      onClick={() => void loadDetailModels(accountName(detail))}
                    >
                      <RefreshCw size={14} /> {P('刷新')}
                    </button>
                  </div>
                </div>

                <div className={`cred-models-dirty${modelsDirty ? ' is-dirty' : ''}`}>
                  <span>
                    {modelsDirty ? P('已修改未保存') : P('尚未修改当前凭证的模型规则')}
                    {modelsDirty ? ` · ${P('凭证规则')} ${excludedDraft.length}` : ''}
                  </span>
                  <div className="dirty-actions">
                    <button type="button" className="button secondary compact" disabled={!modelsDirty || modelsSaving} onClick={resetExcludedModels}>
                      {P('重置')}
                    </button>
                    <button type="button" className="button compact" disabled={!modelsDirty || modelsSaving} onClick={() => void saveExcludedModels()}>
                      {P('保存')}
                    </button>
                  </div>
                </div>

                <input
                  className="cred-models-search"
                  placeholder={P('搜索模型 ID、名称或别名')}
                  value={modelsSearch}
                  onChange={(e) => setModelsSearch(e.target.value)}
                />

                <div className="cred-model-filters" role="tablist" aria-label={P('模型状态筛选')}>
                  <button type="button" className={modelsFilter === 'all' ? 'on' : ''} onClick={() => setModelsFilter('all')}>
                    {P('全部')}
                  </button>
                  <button type="button" className={modelsFilter === 'available' ? 'on' : ''} onClick={() => setModelsFilter('available')}>
                    {P('可用')}
                  </button>
                  <button type="button" className={modelsFilter === 'disabled' ? 'on' : ''} onClick={() => setModelsFilter('disabled')}>
                    {P('已禁用')} {modelCounts.disabled}
                  </button>
                </div>

                {detailModelsErr ? <p style={{ color: 'var(--error)' }}>{detailModelsErr}</p> : null}
                {detailModelsLoading && !detailModels.length ? <p className="muted">{P('加载中…')}</p> : null}
                {!detailModelsLoading && !detailModelsErr && !filteredModels.length ? (
                  <p className="muted">{P('没有匹配当前筛选条件的模型')}</p>
                ) : null}

                <div className="cred-model-list">
                  {filteredModels.map((m) => {
                    const disabled = isModelExcluded(m.id, excludedDraft)
                    return (
                      <div key={m.id} className={`cred-model-card${disabled ? ' is-disabled' : ''}`}>
                        <div className="row1">
                          <div className="id-line">
                            <code>{m.id}</code>
                            <button type="button" className="button secondary compact" title={P('复制')} onClick={() => void copyText(m.id)}>
                              <Copy size={12} />
                            </button>
                          </div>
                          <span className={disabled ? 'badge-disabled' : 'badge-avail'}>
                            {disabled ? P('当前凭证禁用') : P('可用')}
                          </span>
                        </div>
                        {m.name ? <div style={{ fontSize: 13 }}>{m.name}</div> : null}
                        <div className="meta">
                          {m.provider ? <span className="tag">{m.provider}</span> : null}
                          {disabled ? <span className="hint">{P('凭证规则')}</span> : null}
                        </div>
                        <div>
                          {disabled ? (
                            <button
                              type="button"
                              className="button secondary compact"
                              onClick={() => setExcludedDraft((d) => toggleExcludedModel(d, m.id, false))}
                            >
                              {P('恢复')}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="button secondary compact"
                              onClick={() => setExcludedDraft((d) => toggleExcludedModel(d, m.id, true))}
                            >
                              {P('对此凭证禁用')}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {detailTab === 'diagnosis' ? (
              <div>
                <div className="cred-section">
                  <h4>{P('诊断结论')}</h4>
                  <div className="cred-kv">
                    <span className="k">{P('状态')}</span>
                    <span>
                      <span className={badgeClass(resolveDisplay(detail))}>
                        ● {badgeLabel(resolveDisplay(detail), detail.status)}
                      </span>
                    </span>
                    <span className="k">{P('说明')}</span>
                    <span>{detail.status_message || '—'}</span>
                  </div>
                </div>
                <div className="cred-section">
                  <h4>{P('动作候选')}</h4>
                  {diagErr ? <p style={{ color: 'var(--error)' }}>{diagErr}</p> : null}
                  {diagCandidates == null ? <p className="muted">{P('加载中…')}</p> : null}
                  {diagCandidates && !diagCandidates.length ? (
                    <div className="cred-diag-empty">
                      {P('暂无与该凭证匹配的认证异常候选。巡检/Header 证据需本站 Rebuild；完整巡检见「健康巡检」Tab。')}
                    </div>
                  ) : null}
                  {diagCandidates && diagCandidates.length ? (
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                      {diagCandidates.slice(0, 12).map((it, i) => {
                        const row = it as { reason?: string; kind?: string; status_message?: string; id?: string }
                        return (
                          <li key={row.id || i}>
                            {row.kind || 'candidate'} · {row.reason || row.status_message || '—'}
                          </li>
                        )
                      })}
                    </ul>
                  ) : null}
                </div>
                <div className="cred-diag-empty">
                  {P('登录信息 / 检查建议 / 近 7 天事件：CPAMP Manager-only 深度能力未绑 DB；本站将逐步用 Rebuild 证据填充。')}
                </div>
              </div>
            ) : null}

            </div>

            <div className="cred-drawer-foot">
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
