import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import {
  RefreshCw,
  Download,
  Trash2,
  Upload,
  ClipboardPaste,
  RotateCw,
  Settings2,
  BarChart3,
  Eye,
  EyeOff,
  Table2,
  LayoutGrid,
  CheckSquare,
  Square,
} from 'lucide-react'
import { P } from '../../../i18n'
import type { Account, Pool, ViewMode } from './types'
import {
  accountName,
  deriveListMetrics,
  formatPlanType,
  fmtCompact,
  fmtMoney,
  fmtPct,
  fmtResetRelative,
  fmtTimeShort,
  healthBadge,
  maskEmail,
  maskId,
  providerLabel,
  quotaWindows,
  sparkSegments,
  usageStats,
} from './helpers'
import type { QuotaWindow } from './types'

const STATUS_OPTS = [
  { id: 'all', label: '全部状态' },
  { id: 'available', label: '可用' },
  { id: 'disabled', label: '禁用' },
  { id: 'problem', label: '异常' },
  { id: 'low', label: '低额度' },
  { id: 'exhausted', label: '已耗尽' },
  { id: 'need_reauth', label: '需重登' },
  { id: 'unconfirmed', label: '未判定' },
]

const OPERATIONAL_OPTS = [
  { id: 'all', label: '全部运行状态' },
  { id: 'reauth', label: '需要重新认证' },
  { id: 'cooldown', label: '额度冷却中' },
  { id: 'disabled', label: '已禁用' },
]

const PLAN_OPTS = [{ id: 'all', label: '全部套餐' }]

const QUOTA_OPTS = [
  { id: 'all', label: '全部额度' },
  { id: 'ge50', label: '>=50%' },
  { id: 'mid', label: '20%-50%' },
  { id: 'lt20', label: '<20%' },
  { id: 'spent', label: '已耗尽' },
]

const SORT_OPTS = [
  { id: 'recent', label: '最近请求' },
  { id: 'name', label: '凭证名称' },
  { id: 'priority', label: '优先使用靠前' },
  { id: 'success', label: '请求最多' },
  { id: 'quota', label: '剩余额度最多' },
  { id: 'created', label: '认证文件最新' },
]

const PAGE_SIZES = [10, 20, 50, 100]

export type CredListTabProps = {
  items: Account[]
  pool: Pool | null
  loading: boolean
  err: string | null
  busyName: string | null
  selected: Record<string, boolean>
  setSelected: (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => void
  onRefresh: () => void
  onPasteJson: () => void
  onUploadFile: (file: File) => void
  onOpenDetail: (a: Account, tab?: 'overview' | 'quota' | 'config' | 'models' | 'diagnosis') => void
  onForceRefresh: (name: string) => void
  onDownload: (name: string) => void
  onRemove: (name: string) => void
  onSetDisabled: (name: string, disabled: boolean) => void
  onRefreshQuota: (names: string[]) => void
  onBatch: (action: 'enable' | 'disable' | 'delete' | 'priority' | 'weight' | 'download') => void
  batchBusy: boolean
}

export function CredListTab(props: CredListTabProps) {
  const {
    items,
    loading,
    err,
    busyName,
    selected,
    setSelected,
    onRefresh,
    onPasteJson,
    onUploadFile,
    onOpenDetail,
    onForceRefresh,
    onDownload,
    onRemove,
    onSetDisabled,
    onRefreshQuota,
    onBatch,
    batchBusy,
  } = props

  const [q, setQ] = useState('')
  const [providerFilter, setProviderFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [operationalFilter, setOperationalFilter] = useState('all')
  const [planFilter, setPlanFilter] = useState('all')
  const [quotaFilter, setQuotaFilter] = useState('all')
  const [sortBy, setSortBy] = useState('recent')
  const [viewMode, setViewMode] = useState<ViewMode>('table')
  const [showFullId, setShowFullId] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [jump, setJump] = useState('1')

  const providerCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of items) {
      const p = String(a.provider || 'unknown')
      m.set(p, (m.get(p) || 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [items])

  const planOptions = useMemo(() => {
    const set = new Set<string>()
    for (const a of items) {
      const p = a.plan_type || a.quota?.plan_type
      if (p) set.add(String(p))
    }
    return [{ id: 'all', label: '全部套餐' }, ...[...set].sort().map((id) => ({ id, label: id }))]
  }, [items])

  const metrics = useMemo(() => deriveListMetrics(items), [items])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let list = items.filter((a) => {
      const name = accountName(a)
      const hb = healthBadge(a)
      if (providerFilter !== 'all' && String(a.provider || '') !== providerFilter) return false

      if (statusFilter !== 'all') {
        if (statusFilter === 'available' && hb.label !== P('可用')) return false
        if (statusFilter === 'disabled' && !(a.disabled || hb.label === P('已禁用'))) return false
        if (statusFilter === 'problem' && hb.label !== P('异常')) return false
        if (statusFilter === 'low' && hb.label !== P('低额度')) return false
        if (statusFilter === 'exhausted' && hb.label !== P('已耗尽')) return false
        if (statusFilter === 'need_reauth' && hb.label !== P('需重登')) return false
        if (statusFilter === 'unconfirmed' && hb.label !== P('未判定')) return false
      }

      if (operationalFilter === 'reauth' && hb.label !== P('需重登')) return false
      if (operationalFilter === 'disabled' && !a.disabled) return false
      if (operationalFilter === 'cooldown' && !/cool|冷却/.test(String(a.status_message || a.cooling || ''))) {
        return false
      }

      if (planFilter !== 'all') {
        const plan = String(a.plan_type || a.quota?.plan_type || '')
        if (plan !== planFilter) return false
      }

      if (quotaFilter !== 'all') {
        const r = a.quota?.remaining_ratio
        if (quotaFilter === 'spent') {
          if (!(a.quota?.risk === 'exhausted' || (r != null && r <= 0))) return false
        } else if (r == null) return false
        else if (quotaFilter === 'ge50' && !(r >= 0.5)) return false
        else if (quotaFilter === 'mid' && !(r >= 0.2 && r < 0.5)) return false
        else if (quotaFilter === 'lt20' && !(r < 0.2 && r > 0)) return false
      }

      if (needle) {
        const hay = `${name} ${a.email || ''} ${a.note || ''} ${a.label || ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })

    list = [...list].sort((a, b) => {
      if (sortBy === 'priority') return Number(b.priority || 0) - Number(a.priority || 0)
      if (sortBy === 'success') {
        return Number(b.success || 0) + Number(b.failed || 0) - (Number(a.success || 0) + Number(a.failed || 0))
      }
      if (sortBy === 'quota') {
        const ra = a.quota?.remaining_ratio
        const rb = b.quota?.remaining_ratio
        if (ra == null && rb == null) return 0
        if (ra == null) return 1
        if (rb == null) return -1
        return rb - ra
      }
      if (sortBy === 'created') {
        const ta = Date.parse(String(a.created_at || a.updated_at || 0)) || 0
        const tb = Date.parse(String(b.created_at || b.updated_at || 0)) || 0
        return tb - ta
      }
      if (sortBy === 'name') return accountName(a).localeCompare(accountName(b))
      // recent default
      const ta = Date.parse(String(a.last_refresh || a.updated_at || 0)) || 0
      const tb = Date.parse(String(b.last_refresh || b.updated_at || 0)) || 0
      return tb - ta
    })
    return list
  }, [items, q, providerFilter, statusFilter, operationalFilter, planFilter, quotaFilter, sortBy])

  useEffect(() => {
    setPage(1)
  }, [q, providerFilter, statusFilter, operationalFilter, planFilter, quotaFilter, sortBy, pageSize])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, safePage, pageSize])

  const selectedNames = useMemo(
    () => filtered.map(accountName).filter((n) => selected[n]),
    [filtered, selected],
  )

  const allPageSelected = pageItems.length > 0 && pageItems.every((a) => selected[accountName(a)])

  function toggleRow(name: string) {
    setSelected((prev) => {
      const next = { ...prev }
      if (next[name]) delete next[name]
      else next[name] = true
      return next
    })
  }

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

  function onFilePick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) onUploadFile(f)
  }

  const rangeStart = filtered.length ? (safePage - 1) * pageSize + 1 : 0
  const rangeEnd = Math.min(safePage * pageSize, filtered.length)

  return (
    <div className="cred-list">
      <div className="cred-list-top">
        <div className="cred-list-title-row">
          <h2 className="cred-list-title">{P('凭证管理')}</h2>
          <div className="cred-list-header-actions">
            <button type="button" className="button secondary compact" onClick={onRefresh} disabled={loading}>
              <RefreshCw size={14} /> {P('刷新')}
            </button>
            <button type="button" className="button secondary compact" onClick={onPasteJson}>
              <ClipboardPaste size={14} /> {P('粘贴 JSON')}
            </button>
            <label className="button compact" style={{ cursor: 'pointer', margin: 0 }}>
              <Upload size={14} /> {P('+ 上传文件')}
              <input type="file" accept=".json,application/json,text/plain" hidden onChange={onFilePick} />
            </label>
          </div>
        </div>
      </div>

      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}

      <div className="cred-provider-chips" role="tablist" aria-label={P('平台筛选')}>
        <button
          type="button"
          className={providerFilter === 'all' ? 'on' : ''}
          onClick={() => setProviderFilter('all')}
        >
          {P('全部')}({items.length})
        </button>
        {providerCounts.map(([p, n]) => (
          <button
            key={p}
            type="button"
            className={providerFilter === p ? 'on' : ''}
            onClick={() => setProviderFilter(p)}
            title={p}
          >
            {providerLabel(p)}({n})
          </button>
        ))}
      </div>

      <div className="cred-list-toolbar-filters">
        <input
          className="cred-list-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={P('搜索凭证/账号/邮箱/备注')}
          aria-label={P('搜索凭证')}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {STATUS_OPTS.map((o) => (
            <option key={o.id} value={o.id}>
              {P(o.label)}
            </option>
          ))}
        </select>
        <select value={operationalFilter} onChange={(e) => setOperationalFilter(e.target.value)}>
          {OPERATIONAL_OPTS.map((o) => (
            <option key={o.id} value={o.id}>
              {P(o.label)}
            </option>
          ))}
        </select>
        <select value={planFilter} onChange={(e) => setPlanFilter(e.target.value)}>
          {(planOptions.length > 1 ? planOptions : PLAN_OPTS).map((o) => (
            <option key={o.id} value={o.id}>
              {P(o.label)}
            </option>
          ))}
        </select>
        <select value={quotaFilter} onChange={(e) => setQuotaFilter(e.target.value)}>
          {QUOTA_OPTS.map((o) => (
            <option key={o.id} value={o.id}>
              {P(o.label)}
            </option>
          ))}
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label={P('排序')}>
          {SORT_OPTS.map((o) => (
            <option key={o.id} value={o.id}>
              {P(o.label)}
            </option>
          ))}
        </select>
      </div>

      <section className="cred-metrics" aria-label={P('凭证状态汇总')}>
        {(
          [
            ['total', metrics.total, '总凭证', '全部受管凭证'],
            ['available', metrics.available, '正常可用', '已确认健康且可用'],
            ['attention', metrics.attention, '需要处理', '重新认证、异常或待处理操作'],
            ['quotaRisk', metrics.quotaRisk, '额度风险', '低额度、部分可用、已耗尽或冷却中'],
            ['disabled', metrics.disabled, '已禁用', '当前禁用的凭证'],
            ['unconfirmed', metrics.unconfirmed, '状态待确认', '缺少可用的健康或额度证据'],
          ] as const
        ).map(([key, value, label, meta]) => (
          <article key={key} className="cred-metric-card">
            <div className="cred-metric-label">{P(label)}</div>
            <div className="cred-metric-value">{value}</div>
            <div className="cred-metric-meta">{P(meta)}</div>
            <div className="cred-metric-spark" aria-hidden />
          </article>
        ))}
      </section>

      <div className="cred-batch-bar">
        <div className="cred-batch-summary">
          <span>
            {P('已选')} {selectedNames.length} {P('个凭证')}
          </span>
          <small>{P('选择凭证后可批量启用、禁用、调整优先级或删除。')}</small>
        </div>
        <div className="cred-batch-actions">
          <button
            type="button"
            className={`button secondary compact ${selectMode ? 'on' : ''}`}
            onClick={() => setSelectMode((v) => !v)}
          >
            {selectMode ? <CheckSquare size={14} /> : <Square size={14} />} {P('选择')}
          </button>
          <button
            type="button"
            className="button secondary compact"
            onClick={() => setShowFullId((v) => !v)}
            title={showFullId ? P('显示脱敏凭证标识') : P('显示完整凭证标识')}
          >
            {showFullId ? <Eye size={14} /> : <EyeOff size={14} />} {P('脱敏')}
          </button>
          <button
            type="button"
            className="button secondary compact"
            disabled={batchBusy || (!selectedNames.length && !filtered.length)}
            onClick={() => onRefreshQuota(selectedNames.length ? selectedNames : filtered.map(accountName))}
          >
            <RefreshCw size={14} /> {P('刷新额度')}
          </button>
          <div className="cred-view-switch" role="group" aria-label={P('视图模式')}>
            <button
              type="button"
              className={`button compact ${viewMode === 'table' ? '' : 'secondary'}`}
              onClick={() => setViewMode('table')}
            >
              <Table2 size={14} /> {P('表格')}
            </button>
            <button
              type="button"
              className={`button compact ${viewMode === 'card' ? '' : 'secondary'}`}
              onClick={() => setViewMode('card')}
            >
              <LayoutGrid size={14} /> {P('卡片')}
            </button>
          </div>
          {selectMode || selectedNames.length ? (
            <>
              <button type="button" className="button secondary compact" onClick={toggleAllPage}>
                {allPageSelected ? P('取消本页') : P('全选本页')}
              </button>
              <button type="button" className="button compact" disabled={batchBusy || !selectedNames.length} onClick={() => onBatch('enable')}>
                {P('批量启用')}
              </button>
              <button type="button" className="button secondary compact" disabled={batchBusy || !selectedNames.length} onClick={() => onBatch('disable')}>
                {P('批量禁用')}
              </button>
              <button type="button" className="button secondary compact" disabled={batchBusy || !selectedNames.length} onClick={() => onBatch('delete')}>
                {P('批量删除')}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {viewMode === 'table' ? (
        <div className="cred-table-scroller">
          <div className="cred-card-list">
            <div className="cred-card-header" data-account-list-header="true">
              <span>{P('凭证')}</span>
              <span>{P('套餐')}</span>
              <span>{P('可用状态')}</span>
              <span>{P('最近请求')}</span>
              <span>{P('历史用量')}</span>
              <span>{P('操作')}</span>
            </div>
            {pageItems.map((a) => (
              <CredRow
                key={a.id || accountName(a)}
                a={a}
                showFullId={showFullId}
                selectMode={selectMode}
                selected={!!selected[accountName(a)]}
                busy={busyName === accountName(a)}
                onToggleSelect={() => toggleRow(accountName(a))}
                onOpenDetail={onOpenDetail}
                onForceRefresh={onForceRefresh}
                onDownload={onDownload}
                onRemove={onRemove}
                onSetDisabled={onSetDisabled}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="cred-grid-list">
          {pageItems.map((a) => (
            <CredGridCard
              key={a.id || accountName(a)}
              a={a}
              showFullId={showFullId}
              selectMode={selectMode}
              selected={!!selected[accountName(a)]}
              busy={busyName === accountName(a)}
              onToggleSelect={() => toggleRow(accountName(a))}
              onOpenDetail={onOpenDetail}
              onForceRefresh={onForceRefresh}
              onDownload={onDownload}
              onRemove={onRemove}
              onSetDisabled={onSetDisabled}
            />
          ))}
        </div>
      )}

      <div className="cred-pagination">
        <span className="muted">
          {P('第')} {safePage}/{pageCount} {P('页')} · {P('显示')} {rangeStart}-{rangeEnd}/{filtered.length}
        </span>
        <div className="cred-pagination-controls">
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            aria-label={P('每页数量')}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} {P('条/页')}
              </option>
            ))}
          </select>
          <button type="button" className="button secondary compact" disabled={safePage <= 1} onClick={() => setPage((p) => p - 1)}>
            {P('上一页')}
          </button>
          <button
            type="button"
            className="button secondary compact"
            disabled={safePage >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            {P('下一页')}
          </button>
          <label className="cred-jump">
            {P('前往')}
            <input
              value={jump}
              onChange={(e) => setJump(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const n = Math.max(1, Math.min(pageCount, Number(jump) || 1))
                  setPage(n)
                  setJump(String(n))
                }
              }}
            />
            {P('页')}
          </label>
        </div>
      </div>

      {!loading && !filtered.length && !err ? <p className="empty-state">{P('没有匹配凭证')}</p> : null}
    </div>
  )
}

function CredRow({
  a,
  showFullId,
  selectMode,
  selected,
  busy,
  onToggleSelect,
  onOpenDetail,
  onForceRefresh,
  onDownload,
  onRemove,
  onSetDisabled,
}: {
  a: Account
  showFullId: boolean
  selectMode: boolean
  selected: boolean
  busy: boolean
  onToggleSelect: () => void
  onOpenDetail: CredListTabProps['onOpenDetail']
  onForceRefresh: (name: string) => void
  onDownload: (name: string) => void
  onRemove: (name: string) => void
  onSetDisabled: (name: string, disabled: boolean) => void
}) {
  const name = accountName(a)
  const hb = healthBadge(a)
  const sparks = sparkSegments(a)
  const windows = quotaWindows(a)
  const email = maskEmail(a.email || a.label, showFullId) || maskId(name, showFullId)
  const file = maskId(name, showFullId)

  return (
    <article
      className={`cred-card-row ${selected ? 'is-selected' : ''} ${selectMode ? 'is-select-mode' : ''}`}
      data-account-card={name}
      aria-selected={selected}
      onClick={selectMode ? onToggleSelect : undefined}
    >
      <div className="cred-cell-identity">
        {(selectMode || selected) && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => {
              e.stopPropagation()
              onToggleSelect()
            }}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        <div className="cred-provider-logo" aria-hidden>
          <span>{String(a.provider || '?').slice(0, 2).toUpperCase()}</span>
        </div>
        <div className="cred-identity-text">
          <div className="cred-identity-title-row">
            <div className="cred-identity-title">{email}</div>
            {formatPlanType(a.plan_type || a.quota?.plan_type) ? (
              <span className="cred-plan-badge">{formatPlanType(a.plan_type || a.quota?.plan_type)}</span>
            ) : null}
          </div>
          <div className="cred-identity-file">
            <code>{file}</code>
          </div>
        </div>
      </div>

      <div className="cred-cell-plan">
        <div className="cred-plan-name">{formatPlanType(a.plan_type || a.quota?.plan_type) || '—'}</div>
      </div>

      <div className="cred-cell-health">
        <span className={hb.className}>● {hb.label}</span>
        <div className="cred-priority-meta">
          {P('优先级')} {a.priority != null && !Number.isNaN(Number(a.priority)) ? a.priority : 0}
        </div>
      </div>

      <div className="cred-cell-recent">
        <div>{fmtTimeShort(a.last_refresh || a.updated_at)}</div>
        <div className="cred-spark" title={P('最近请求')}>
          {sparks.map((v, i) => (
            <i key={i} style={{ opacity: 0.25 + v * 0.75, transform: `scaleY(${0.2 + v * 0.8})` }} />
          ))}
        </div>
      </div>

      <div className="cred-cell-history">
        <HistoryMetrics a={a} variant="table" />
      </div>

      <div className="cred-cell-quota">
        <QuotaBars windows={windows} layout="grid" />
      </div>

      <div className="cred-cell-actions" onClick={(e) => e.stopPropagation()}>
        <RowActions
          a={a}
          busy={busy}
          onOpenDetail={onOpenDetail}
          onForceRefresh={onForceRefresh}
          onDownload={onDownload}
          onRemove={onRemove}
          onSetDisabled={onSetDisabled}
        />
      </div>
    </article>
  )
}

function RowActions({
  a,
  busy,
  onOpenDetail,
  onForceRefresh,
  onDownload,
  onRemove,
  onSetDisabled,
}: {
  a: Account
  busy: boolean
  onOpenDetail: CredListTabProps['onOpenDetail']
  onForceRefresh: (name: string) => void
  onDownload: (name: string) => void
  onRemove: (name: string) => void
  onSetDisabled: (name: string, disabled: boolean) => void
}) {
  const name = accountName(a)
  return (
    <div className="cred-row-actions" onClick={(e) => e.stopPropagation()}>
      <div className="cred-icon-grid" aria-label={P('操作')}>
        <button type="button" className="cred-icon-btn" disabled={busy} title={P('刷新')} onClick={() => onForceRefresh(name)}>
          <RotateCw size={14} />
        </button>
        <button type="button" className="cred-icon-btn" disabled={busy} title={P('配置')} onClick={() => onOpenDetail(a, 'config')}>
          <Settings2 size={14} />
        </button>
        <button type="button" className="cred-icon-btn" disabled={busy} title={P('额度')} onClick={() => onOpenDetail(a, 'quota')}>
          <BarChart3 size={14} />
        </button>
        <button type="button" className="cred-icon-btn" disabled={busy} title={P('下载')} onClick={() => onDownload(name)}>
          <Download size={14} />
        </button>
        <button type="button" className="cred-icon-btn danger" disabled={busy} title={P('删除')} onClick={() => onRemove(name)}>
          <Trash2 size={14} />
        </button>
      </div>
      <span className="cred-actions-divider" aria-hidden />
      <div className="cred-row-actions-side">
        <div className="cred-status-switch-wrap">
          <label className="cred-switch" title={a.disabled ? P('启用') : P('禁用')}>
            <input
              type="checkbox"
              checked={!a.disabled}
              disabled={busy}
              onChange={(e) => onSetDisabled(name, !e.target.checked)}
            />
            <span />
          </label>
        </div>
        <button type="button" className="cred-detail-btn" onClick={() => onOpenDetail(a)}>
          {P('详情')}
        </button>
      </div>
    </div>
  )
}

function CredGridCard({
  a,
  showFullId,
  selectMode,
  selected,
  busy,
  onToggleSelect,
  onOpenDetail,
  onForceRefresh,
  onDownload,
  onRemove,
  onSetDisabled,
}: {
  a: Account
  showFullId: boolean
  selectMode: boolean
  selected: boolean
  busy: boolean
  onToggleSelect: () => void
  onOpenDetail: CredListTabProps['onOpenDetail']
  onForceRefresh: (name: string) => void
  onDownload: (name: string) => void
  onRemove: (name: string) => void
  onSetDisabled: (name: string, disabled: boolean) => void
}) {
  const name = accountName(a)
  const hb = healthBadge(a)
  const windows = quotaWindows(a)
  const sparks = sparkSegments(a, 24)
  const usage = usageStats(a)
  const email = maskEmail(a.email || a.label, showFullId) || maskId(name, showFullId)
  const file = maskId(name, showFullId)
  const plan = formatPlanType(a.plan_type || a.quota?.plan_type)
  const ok = Number(a.success || 0)
  const fail = Number(a.failed || 0)
  const ratePct = usage.successRate != null ? `${(usage.successRate * 100).toFixed(0)}%` : '—'

  return (
    <article
      className={`cred-grid-card panel ${selected ? 'is-selected' : ''} ${a.disabled ? 'is-disabled' : ''} ${selectMode ? 'is-select-mode' : ''}`}
      data-account-card={name}
      aria-selected={selected}
      onClick={selectMode ? onToggleSelect : () => onOpenDetail(a, 'overview')}
    >
      <div className="cred-grid-card-header">
        <div className="cred-grid-card-identity">
          {(selectMode || selected) && (
            <input
              type="checkbox"
              checked={selected}
              onChange={(e) => {
                e.stopPropagation()
                onToggleSelect()
              }}
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <div className="cred-provider-logo" aria-hidden>
            <span>{String(a.provider || '?').slice(0, 2).toUpperCase()}</span>
          </div>
          <div className="cred-identity-text">
            <div className="cred-identity-title">{email}</div>
            <div className="cred-identity-file">
              <code>{file}</code>
            </div>
          </div>
        </div>
        <div className="cred-grid-card-header-right" onClick={(e) => e.stopPropagation()}>
          <span className={hb.className}>{hb.label}</span>
          <label className="cred-switch" title={a.disabled ? P('启用') : P('禁用')}>
            <input
              type="checkbox"
              checked={!a.disabled}
              disabled={busy}
              onChange={(e) => onSetDisabled(name, !e.target.checked)}
            />
            <span />
          </label>
        </div>
      </div>

      <div className="cred-grid-card-meta">
        <div className="cred-grid-card-meta-badges">
          {plan ? <span className="cred-plan-badge">{plan}</span> : null}
          <span className="cred-priority-chip">
            {P('优先级')} {a.priority != null && !Number.isNaN(Number(a.priority)) ? a.priority : 0}
          </span>
        </div>
        <div className={`cred-grid-card-note ${a.note?.trim() ? '' : 'is-empty'}`}>
          <span aria-hidden>📝</span>
          <span>{a.note?.trim() || P('备注')}</span>
        </div>
      </div>

      <HistoryMetrics a={a} variant="card" onOpen={() => onOpenDetail(a, 'quota')} />

      <div
        className="cred-grid-recent"
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation()
          onOpenDetail(a, 'overview')
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            e.stopPropagation()
            onOpenDetail(a, 'overview')
          }
        }}
      >
        <div className="cred-grid-recent-head">
          <span className="cred-grid-recent-title">{P('最近状态')}</span>
          <div className="cred-grid-recent-pills">
            <span className="ok" title={P('成功')}>
              + {ok}
            </span>
            <span className={fail > 0 ? 'bad' : ''} title={P('失败')}>
              − {fail}
            </span>
            <span className="rate">{ratePct}</span>
          </div>
        </div>
        <div className="cred-spark-h" title={P('最近状态')}>
          {sparks.map((v, i) => (
            <i key={i} className={v > 0 ? 'on' : 'off'} style={{ opacity: 0.2 + v * 0.8 }} />
          ))}
        </div>
      </div>

      <div
        className="cred-grid-quota"
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation()
          onOpenDetail(a, 'quota')
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            e.stopPropagation()
            onOpenDetail(a, 'quota')
          }
        }}
      >
        <QuotaBars windows={windows} layout="grid" />
      </div>

      <div className="cred-grid-card-footer" onClick={(e) => e.stopPropagation()}>
        <div className="cred-grid-footer-left">
          <button type="button" className="cred-icon-btn danger" disabled={busy} title={P('删除')} onClick={() => onRemove(name)}>
            <Trash2 size={14} />
          </button>
          <button type="button" className="cred-icon-btn" disabled={busy} title={P('下载')} onClick={() => onDownload(name)}>
            <Download size={14} />
          </button>
        </div>
        <div className="cred-grid-footer-right">
          <button type="button" className="cred-icon-btn" disabled={busy} title={P('刷新')} onClick={() => onForceRefresh(name)}>
            <RotateCw size={14} />
          </button>
          <button type="button" className="cred-icon-btn" disabled={busy} title={P('配置')} onClick={() => onOpenDetail(a, 'config')}>
            <Settings2 size={14} />
          </button>
          <button type="button" className="cred-detail-btn" onClick={() => onOpenDetail(a)}>
            {P('详情')}
          </button>
        </div>
      </div>
    </article>
  )
}

function HistoryMetrics({
  a,
  variant,
  onOpen,
}: {
  a: Account
  variant: 'table' | 'card'
  onOpen?: () => void
}) {
  const usage = usageStats(a)
  const items = [
    { key: 'requests', label: P('请求'), value: fmtCompact(usage.requests), cls: 'requests' },
    { key: 'tokens', label: 'Token', value: usage.tokens != null ? fmtCompact(usage.tokens) : '—', cls: 'tokens' },
    { key: 'cost', label: P('费用'), value: fmtMoney(usage.cost), cls: 'cost' },
    { key: 'success', label: P('成功率'), value: fmtPct(usage.successRate), cls: 'success' },
  ]
  if (variant === 'table') {
    return (
      <div className="cred-history-grid">
        {items.map((it) => (
          <span key={it.key} className={`cred-history-metric is-${it.cls}`} title={it.label}>
            <span className="cred-history-icon" aria-hidden>
              {it.cls === 'requests' ? '✈' : it.cls === 'tokens' ? '⚡' : it.cls === 'cost' ? '$' : '✓'}
            </span>
            <strong>{it.value}</strong>
          </span>
        ))}
      </div>
    )
  }
  return (
    <div
      className="cred-grid-history"
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={(e) => {
        if (!onOpen) return
        e.stopPropagation()
        onOpen()
      }}
      onKeyDown={(e) => {
        if (!onOpen) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          onOpen()
        }
      }}
    >
      <span className="cred-grid-history-title">{P('历史用量')}</span>
      <div className="cred-grid-history-grid">
        {items.map((it) => (
          <span key={it.key} className={`cred-grid-history-metric is-${it.cls}`} aria-label={`${it.label}: ${it.value}`}>
            <span className="cred-history-icon" aria-hidden>
              {it.cls === 'requests' ? '✈' : it.cls === 'tokens' ? '⚡' : it.cls === 'cost' ? '$' : '✓'}
            </span>
            <span className="cred-grid-history-label">{it.label}</span>
            <strong>{it.value}</strong>
          </span>
        ))}
      </div>
    </div>
  )
}

function QuotaBars({ windows, layout }: { windows: QuotaWindow[]; layout: 'grid' | 'stack' }) {
  if (!windows.length) {
    return <div className={layout === 'stack' ? 'cred-quota-empty stacked' : 'cred-quota-empty'}>{P('暂无额度数据')}</div>
  }
  const list = windows.slice(0, 4)
  const gridCls =
    layout === 'stack'
      ? 'cred-quota-stack'
      : `cred-quota-grid cols-${list.length >= 2 ? 2 : 1}`
  return (
    <div className={gridCls}>
      {list.map((w, i) => {
        const ratio = w.remaining_ratio
        const pct = ratio != null && Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : null
        const risk = String(w.risk || '')
        const barCls =
          risk === 'exhausted' || (pct != null && pct <= 0)
            ? 'bad'
            : risk === 'low' || risk === 'critical' || (pct != null && pct < 0.5)
              ? 'warn'
              : 'good'
        // CPAMP GEe: trusted current → show $ / tokens; else empty (we still render
        // `$0.00 / —` so every 5h+weekly cell keeps left meta + right reset).
        const hasCost = w.used_cost != null && Number.isFinite(Number(w.used_cost))
        const hasTokens = w.used_tokens != null && Number.isFinite(Number(w.used_tokens))
        const hasForecastCost = w.forecast_cost != null && Number.isFinite(Number(w.forecast_cost))
        const hasForecastTokens = w.forecast_tokens != null && Number.isFinite(Number(w.forecast_tokens))
        const showUsage = hasCost || hasTokens
        const showForecast = hasForecastCost || hasForecastTokens
        const resetLabel = w.resets_at ? fmtResetRelative(w.resets_at) : ''
        return (
          <div key={i} className="cred-quota-window">
            <div className="cred-quota-window-head">
              <span className="cred-quota-pill" title={w.label}>
                {w.label}
              </span>
              <span className="cred-quota-remaining">
                {pct != null ? (
                  <>
                    <span className="cred-quota-remaining-prefix">{P('剩余')}</span>
                    <strong>{Math.round(pct * 100)}%</strong>
                  </>
                ) : (
                  <strong>—</strong>
                )}
              </span>
            </div>
            <div className="cred-quota-track" aria-hidden>
              <i className={barCls} style={{ width: pct != null ? `${pct * 100}%` : '0%' }} />
            </div>
            <div className="cred-quota-window-foot">
              {showUsage ? (
                <span className="cred-quota-extra-bit is-cost" title={P('当前预计金额 / Token')}>
                  <i className="is-usage" aria-hidden />
                  {fmtMoney(hasCost ? w.used_cost : 0)}
                  {' / '}
                  {hasTokens ? fmtCompact(w.used_tokens) : '—'}
                </span>
              ) : (
                <span className="cred-quota-extra-bit is-cost is-empty" title={P('当前预计金额 / Token')}>
                  <i className="is-usage" aria-hidden />
                  {fmtMoney(0)}
                  {' / —'}
                </span>
              )}
              {showForecast ? (
                <span className="cred-quota-extra-bit is-forecast" title={P('预测')}>
                  <i className="is-forecast" aria-hidden />
                  {fmtMoney(hasForecastCost ? w.forecast_cost : 0)}
                  {' / '}
                  {hasForecastTokens ? fmtCompact(w.forecast_tokens) : '—'}
                </span>
              ) : null}
              <div className="cred-quota-window-meta">{resetLabel || '—'}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
