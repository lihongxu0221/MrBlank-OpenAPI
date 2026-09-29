/**
 * Shared aily-parity usage records panel (console + admin).
 * Admin: dblclick / coarse click opens DiagnosisModal.
 * Console: never opens diagnosis; no diagnosis API calls.
 */
import { Fragment, useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import { fmtUsd } from '../../lib/format'
import { P } from '../../i18n'
import { DiagnosisModal } from '../../pages/admin/diagnosis/DiagnosisModal'

const PALETTE = ['#3b82f6', '#22c55e', '#f59e0b', '#a78bfa', '#22d3ee', '#f97316', '#94a3b8', '#ec4899']

type Filters = { username: string; token: string; model: string; group: string; stream: string }

type UsageItem = {
  id: string
  created_at?: number
  username?: string | null
  token_name?: string
  model_name?: string
  requested_model?: string
  endpoint?: string
  group?: string
  is_stream?: boolean
  prompt_tokens?: number
  completion_tokens?: number
  cache_tokens?: number
  amount?: number
  amountUsd?: number
  duration_ms?: number | null
  ttft_ms?: number | null
  ip?: string
  content?: string
  diagnosis_id?: string
  has_detail?: boolean
  type?: number
  status_code?: number
  /** aily: reasoning intensity (推理强度) */
  reasoning?: string
}

type Chart = {
  totals?: {
    requests?: number
    prompt_tokens?: number
    completion_tokens?: number
    cache_tokens?: number
    tokens?: number
    amount?: number
    avg_ms?: number
  }
  by_model?: DistItem[]
  by_group?: DistItem[]
  by_endpoint?: DistItem[]
  by_user?: DistItem[]
  series?: SeriesPoint[]
  days?: SeriesPoint[]
}

type DistItem = {
  name: string
  requests?: number
  tokens?: number
  amount?: number
  prompt_tokens?: number
  completion_tokens?: number
  keys?: DistItem[]
}

type SeriesPoint = {
  date: string
  prompt_tokens?: number
  completion_tokens?: number
  cache_tokens?: number
}

function fmtTok(n?: number) {
  const v = Number(n) || 0
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M'
  if (v >= 1_000) return (v / 1_000).toFixed(1) + 'k'
  return String(v)
}

function fmtSec(ms?: number | null) {
  const v = Number(ms)
  if (!Number.isFinite(v) || v <= 0) return '-'
  if (v < 1000) return Math.round(v) + 'ms'
  return (v / 1000).toFixed(2) + 's'
}

function fmtPct(a?: number, b?: number) {
  const x = Number(a) || 0
  const y = Number(b) || 0
  if (!y) return '0%'
  return Math.round((x / y) * 100) + '%'
}

function fmtTime(sec?: number) {
  if (!sec) return '-'
  try {
    return new Date(sec * 1000).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
  } catch {
    return String(sec)
  }
}

function usd(n?: number) {
  const v = Number(n)
  if (!Number.isFinite(v) || !v) return '-'
  return fmtUsd(v)
}

function distName(n?: string) {
  return !n || n === 'ungrouped' ? '默认分组' : n
}

function usageTokens(x: { prompt_tokens?: number; completion_tokens?: number; tokens?: number }) {
  const p = Number(x?.prompt_tokens) || 0
  const c = Number(x?.completion_tokens) || 0
  if (p || c) return p + c
  return Number(x?.tokens) || 0
}

function withTokens(items?: DistItem[]) {
  return (items || []).map((x) => ({
    ...x,
    tokens: usageTokens(x),
    keys: Array.isArray(x.keys) ? x.keys.map((k) => ({ ...k, tokens: usageTokens(k) })) : x.keys,
  }))
}

function Donut({ items, valueKey }: { items: DistItem[]; valueKey: 'tokens' | 'amount' }) {
  const metricTotal = items.reduce((s, x) => s + (Number(x[valueKey]) || 0), 0)
  // When selected metric is all-zero (e.g. no amount yet), fall back to requests so multi-row
  // distributions still split — matches aily visual expectation for mixed zero-token rows.
  const useRequests = metricTotal <= 0
  const total =
    (useRequests
      ? items.reduce((s, x) => s + (Number(x.requests) || 0), 0)
      : metricTotal) || 1
  const r = 38
  const c = 2 * Math.PI * r
  let off = 0
  return (
    <svg className="usage-donut" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--line, #e5e7eb)" strokeWidth="12" />
      {items.map((x, i) => {
        const val = useRequests ? Number(x.requests) || 0 : Number(x[valueKey]) || 0
        const dash = (val / total) * c
        const el = (
          <circle
            key={(x.name || '') + i}
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={PALETTE[i % PALETTE.length]}
            strokeWidth="12"
            strokeDasharray={dash + ' ' + (c - dash)}
            strokeDashoffset={-off}
            transform="rotate(-90 50 50)"
          />
        )
        off += dash
        return el
      })}
    </svg>
  )
}

function Dist({ title, items, nestKeys }: { title: string; items?: DistItem[]; nestKeys?: boolean }) {
  const [open, setOpen] = useState<Record<number, boolean>>({})
  const [metric, setMetric] = useState<'tokens' | 'amount'>('tokens')
  const col = nestKeys ? '模型' : title.includes('分组') ? '分组' : title.includes('端点') ? '端点' : '名称'
  const top = withTokens(items)
    .sort((a, b) => (Number(b[metric]) || 0) - (Number(a[metric]) || 0))
    .slice(0, 6)
  return (
    <div className="panel usage-dist-panel">
      <div className="usage-panel-head">
        <h3>{title}</h3>
        <div className="usage-seg">
          <button type="button" className={metric === 'tokens' ? 'on' : ''} onClick={() => setMetric('tokens')}>
            按 Token
          </button>
          <button type="button" className={metric === 'amount' ? 'on' : ''} onClick={() => setMetric('amount')}>
            按金额
          </button>
        </div>
      </div>
      {!top.length ? (
        <div className="empty-state">{P('暂无数据')}</div>
      ) : (
        <div className="usage-dist">
          <Donut items={top} valueKey={metric} />
          <div className="usage-dist-table">
            <table className="data usage-fit">
              <thead>
                <tr>
                  <th></th>
                  <th>{col}</th>
                  <th>请求</th>
                  <th>Token</th>
                  <th>实际</th>
                </tr>
              </thead>
              <tbody>
                {top.map((x, i) => {
                  const keys = nestKeys && Array.isArray(x.keys) ? x.keys : []
                  return (
                    <Fragment key={x.name}>
                      <tr>
                        <td>
                          {keys.length ? (
                            <button
                              type="button"
                              className="usage-tog"
                              onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}
                            >
                              {open[i] ? '▾' : '▸'}
                            </button>
                          ) : (
                            <i
                              style={{
                                display: 'inline-block',
                                width: 8,
                                height: 8,
                                borderRadius: 99,
                                background: PALETTE[i % PALETTE.length],
                              }}
                            />
                          )}
                        </td>
                        <td className="name">{distName(x.name)}</td>
                        <td className="num">{fmtTok(x.requests)}</td>
                        <td className="num">{fmtTok(x.tokens)}</td>
                        <td className="fee">{usd(x.amount)}</td>
                      </tr>
                      {open[i] &&
                        keys.map((k) => (
                          <tr key={k.name} className="usage-dist-child">
                            <td></td>
                            <td className="name">{k.name}</td>
                            <td className="num">{fmtTok(k.requests)}</td>
                            <td className="num">{fmtTok(k.tokens)}</td>
                            <td className="fee">{usd(k.amount)}</td>
                          </tr>
                        ))}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function pts(
  series: SeriesPoint[],
  key: keyof SeriesPoint,
  max: number,
  w: number,
  h: number,
  padL: number,
  padT: number,
  innerW: number,
  innerH: number,
) {
  if (!series.length) return ''
  return series
    .map((d, i) => {
      const x = padL + (series.length === 1 ? innerW / 2 : (i * innerW) / (series.length - 1))
      const y = padT + innerH - ((Number(d[key]) || 0) / max) * innerH
      return x + ',' + y
    })
    .join(' ')
}

function Trend({ series }: { series?: SeriesPoint[] }) {
  const rows = series || []
  const max = Math.max(
    1,
    ...rows.map((d) => Math.max(d.prompt_tokens || 0, d.completion_tokens || 0, d.cache_tokens || 0)),
  )
  const w = 640
  const h = 220
  const padL = 36
  const padB = 36
  const padT = 16
  const padR = 28
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const step = rows.length > 12 ? Math.ceil(rows.length / 6) : 1
  const hitPts = rows
    .map((d, i) => {
      const x = padL + (rows.length === 1 ? innerW / 2 : (i * innerW) / Math.max(1, rows.length - 1))
      const p = d.prompt_tokens || 0
      const r = p ? Math.min(1, (d.cache_tokens || 0) / p) : 0
      return x + ',' + (padT + innerH - r * innerH)
    })
    .join(' ')
  return (
    <div className="panel usage-dist-panel">
      <div className="usage-panel-head">
        <h3>Token 使用趋势</h3>
      </div>
      <div className="usage-legend">
        <span>
          <i style={{ background: '#3b82f6' }} />
          Input
        </span>
        <span>
          <i style={{ background: '#22c55e' }} />
          Output
        </span>
        <span>
          <i style={{ background: '#22d3ee' }} />
          Cache
        </span>
        <span>
          <i style={{ background: '#a78bfa' }} />
          Cache Hit Rate
        </span>
      </div>
      {!rows.length ? (
        <div className="empty-state">{P('暂无趋势')}</div>
      ) : (
        <svg className="usage-trend" viewBox={'0 0 ' + w + ' ' + h}>
          {[0, 0.5, 1].map((p) => {
            const y = padT + innerH * (1 - p)
            return (
              <g key={p}>
                <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="var(--chart-grid, #e5e7eb)" />
                <text x="4" y={y + 3} fontSize="9" fill="var(--muted)">
                  {fmtTok(max * p)}
                </text>
                <text x={w - 2} y={y + 3} fontSize="9" fill="var(--muted)" textAnchor="end">
                  {Math.round(p * 100)}%
                </text>
              </g>
            )
          })}
          <polyline
            fill="none"
            stroke="#3b82f6"
            strokeWidth="2"
            points={pts(rows, 'prompt_tokens', max, w, h, padL, padT, innerW, innerH)}
          />
          <polyline
            fill="none"
            stroke="#22c55e"
            strokeWidth="2"
            points={pts(rows, 'completion_tokens', max, w, h, padL, padT, innerW, innerH)}
          />
          <polyline
            fill="none"
            stroke="#22d3ee"
            strokeWidth="2"
            points={pts(rows, 'cache_tokens', max, w, h, padL, padT, innerW, innerH)}
          />
          <polyline fill="none" stroke="#a78bfa" strokeWidth="2" strokeDasharray="4 3" points={hitPts} />
          {rows.map((d, i) =>
            i % step ? null : (
              <text
                key={d.date + i}
                x={padL + (rows.length === 1 ? innerW / 2 : (i * innerW) / Math.max(1, rows.length - 1))}
                y={h - 10}
                fontSize="9"
                fill="var(--muted)"
                textAnchor="middle"
              >
                {String(d.date || '').slice(5)}
              </text>
            ),
          )}
        </svg>
      )}
    </div>
  )
}

function pageNums(cur: number, total: number) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const out: (number | string)[] = [1]
  if (cur > 3) out.push('...')
  for (let n = Math.max(2, cur - 1); n <= Math.min(total - 1, cur + 1); n++) out.push(n)
  if (cur < total - 2) out.push('...')
  out.push(total)
  return out
}

function startOfDay(s: string) {
  const [y, m, d] = String(s).split('-').map(Number)
  return Math.floor(new Date(y, m - 1, d).getTime() / 1000)
}
function endOfDay(s: string) {
  const [y, m, d] = String(s).split('-').map(Number)
  return Math.floor(new Date(y, m - 1, d, 23, 59, 59).getTime() / 1000)
}

function downloadCsv(rows: UsageItem[], admin: boolean) {
  const headers = (admin ? ['用户'] : []).concat([
    'API密钥',
    '模型',
    '推理强度',
    '端点',
    'IP',
    '分组',
    '类型',
    '输入TOKEN',
    '输出TOKEN',
    '费用',
    '首字',
    '总耗时',
    '时间',
  ])
  const lines = [headers.join(',')]
  for (const x of rows || []) {
    const dur = x.duration_ms || 0
    const cols = (admin ? [csvCell(x.username)] : []).concat([
      csvCell(x.token_name),
      csvCell(x.model_name),
      csvCell(x.reasoning || ''),
      csvCell(x.endpoint || ''),
      csvCell(x.ip || ''),
      csvCell(x.group || '默认分组'),
      x.is_stream ? '流式' : '非流式',
      String(x.prompt_tokens || 0),
      String(x.completion_tokens || 0),
      String(x.amount ?? x.amountUsd ?? ''),
      String(x.ttft_ms ?? ''),
      String(dur),
      csvCell(fmtTime(x.created_at)),
    ])
    lines.push(cols.join(','))
  }
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'usage.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}
function csvCell(v: unknown) {
  const t = String(v ?? '')
  if (/[",\n]/.test(t)) return '"' + t.replace(/"/g, '""') + '"'
  return t
}

export type UsageRecordsProps = {
  /** admin = full filters + diagnosis; console = scoped, no diagnosis */
  mode: 'admin' | 'console'
  /** Optional toolbar slot (e.g. admin import/export) */
  toolbarExtra?: ReactNode
}

export function UsageRecords({ mode, toolbarExtra }: UsageRecordsProps) {
  const admin = mode === 'admin'
  const emptyFilters: Filters = { username: '', token: '', model: '', group: '', stream: '' }
  const [detailId, setDetailId] = useState<string | null>(null)
  const [range, setRange] = useState('24h')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [grain, setGrain] = useState('hour')
  const [grainManual, setGrainManual] = useState(false)
  const [draft, setDraft] = useState<Filters>(emptyFilters)
  const [applied, setApplied] = useState<Filters>(emptyFilters)
  const [tokenNames, setTokenNames] = useState<string[]>([])
  const [modelNames, setModelNames] = useState<string[]>([])
  const [usernames, setUsernames] = useState<string[]>([])
  const [groups, setGroups] = useState<string[]>([])
  const [chart, setChart] = useState<Chart | null>(null)
  const [logs, setLogs] = useState<{ items: UsageItem[]; total: number }>({ items: [], total: 0 })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState('')
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<'detail' | 'error' | 'rank'>('detail')

  const coarse = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches,
    [],
  )

  const qs = useMemo(() => {
    const q = new URLSearchParams()
    if (admin && applied.username) q.set('username', applied.username)
    if (applied.token) q.set('token_name', applied.token)
    if (applied.model) q.set('model_name', applied.model)
    if (applied.group) q.set('group', applied.group)
    if (applied.stream) q.set('is_stream', applied.stream)
    if (range === 'custom' && startDate && endDate) {
      q.set('start_timestamp', String(startOfDay(startDate)))
      q.set('end_timestamp', String(endOfDay(endDate)))
    } else q.set('range', range)
    q.set('grain', grain)
    return q.toString()
  }, [applied, range, startDate, endDate, grain, admin])

  const chartPath = admin ? '/api/admin/usage/chart?' : '/api/log/chart?'
  const filtersPath = admin ? '/api/admin/usage/filters?' : '/api/log/filters?'
  const listPath = admin ? '/api/admin/usage/logs?' : '/api/log/self?'

  const load = useCallback(async () => {
    setBusy(true)
    setErr('')
    try {
      const logType = tab === 'error' ? 5 : 2
      const jobs: Promise<unknown>[] = [api.get(chartPath + qs), api.get(filtersPath + qs)]
      if (tab !== 'rank') {
        jobs.push(api.get(listPath + 'type=' + logType + '&p=' + page + '&page_size=' + pageSize + '&' + qs))
      }
      const [c, f, l] = (await Promise.all(jobs)) as [Chart, any, any]
      setChart(c || {})
      setTokenNames(f?.token_names || [])
      setModelNames(f?.model_names || [])
      setUsernames(f?.usernames || [])
      setGroups(f?.groups || [])
      if (tab === 'rank') {
        const rows = (c?.by_user || []) as DistItem[]
        setLogs({
          items: rows.map((r) => ({
            id: r.name,
            username: r.name,
            prompt_tokens: r.prompt_tokens,
            completion_tokens: r.completion_tokens,
            amount: r.amount,
            // requests stored in content for display
            content: String(r.requests || 0),
            tokens: r.tokens,
          })) as any,
          total: rows.length,
        })
        setHint(rows.length ? '共 ' + rows.length + ' 个用户' : '没有匹配记录')
      } else {
        setLogs({ items: l?.items || [], total: l?.total || 0 })
        const n = l?.total || 0
        setHint(n ? '共 ' + n.toLocaleString('en-US') + ' 条' : '没有匹配记录')
      }
    } catch (e) {
      setErr((e as Error).message)
      setHint('加载失败')
    }
    setBusy(false)
  }, [qs, page, pageSize, tab, chartPath, filtersPath, listPath])

  useEffect(() => {
    void load()
  }, [load])

  function resetFilters() {
    setDraft(emptyFilters)
    setApplied(emptyFilters)
    setPage(1)
  }
  function applyFilters() {
    setApplied({ ...draft })
    setPage(1)
  }
  function setField(key: keyof Filters, value: string) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  async function exportCsv() {
    try {
      const r = await api.get<{ items: UsageItem[] }>(listPath + 'type=2&p=1&page_size=100&' + qs)
      downloadCsv(r.items || [], admin)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  function openDiagnosis(row: UsageItem, ev?: MouseEvent) {
    if (!admin) return
    if (ev && (ev.target as HTMLElement).closest?.('button')) return
    const id = row.diagnosis_id || row.id
    if (!id) return
    setDetailId(id)
  }

  const t = chart?.totals || {}
  const items = logs.items || []
  const pages = Math.max(1, Math.ceil((logs.total || 0) / pageSize) || 1)
  const from = logs.total ? (page - 1) * pageSize + 1 : 0
  const to = Math.min(logs.total, page * pageSize)
  const rangeLabel =
    (
      {
        today: '今天',
        yesterday: '昨天',
        '24h': '近 24 小时',
        '7d': '近 7 天',
        '14d': '近 14 天',
        '30d': '近 30 天',
        month: '本月',
        last_month: '上月',
        custom: '自定义',
        all: '全部',
      } as Record<string, string>
    )[range] || '所选范围内'
  const spend = Number(t.amount)
  const spendText =
    Number.isFinite(spend) && spend !== 0
      ? '$' + spend.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })
      : '-'

  return (
    <div className="usage-records">
      <div className="channels-toolbar usage-toolbar">
        <span className="muted">{hint}</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {toolbarExtra}
          <button type="button" className="button secondary compact" disabled={busy} onClick={() => load()}>
            <RefreshCw size={14} /> {busy ? P('加载中') : P('刷新')}
          </button>
        </div>
      </div>

      <div className="stats-grid usage-kpis">
        <div className="stat-card">
          <div className="label">总请求数</div>
          <div className="value">{fmtTok(t.requests || 0)}</div>
          <div className="muted">{rangeLabel}</div>
        </div>
        <div className="stat-card">
          <div className="label">总 Token</div>
          <div className="value">{fmtTok(usageTokens(t) || 0)}</div>
          <div className="muted">
            输入: {fmtTok(t.prompt_tokens || 0)} / 输出: {fmtTok(t.completion_tokens || 0)} / 缓存:{' '}
            {fmtTok(t.cache_tokens || 0)}（占比 {fmtPct(t.cache_tokens, t.prompt_tokens)}）
          </div>
        </div>
        <div className="stat-card">
          <div className="label">总消费</div>
          <div className="value">{spendText}</div>
          <div className="muted">按 Token 与模型单价估算</div>
        </div>
        <div className="stat-card">
          <div className="label">平均耗时</div>
          <div className="value">{fmtSec(t.avg_ms || 0)}</div>
        </div>
      </div>

      <div className="usage-bar panel">
        <span className="muted">时间范围:</span>
        <select
          value={range === 'custom' ? 'custom' : range}
          onChange={(e) => {
            const v = e.target.value
            setRange(v)
            setPage(1)
            if (!grainManual) setGrain(v === '24h' || v === 'today' || v === 'yesterday' ? 'hour' : 'day')
          }}
        >
          <option value="today">今天</option>
          <option value="yesterday">昨天</option>
          <option value="24h">近 24 小时</option>
          <option value="7d">近 7 天</option>
          <option value="14d">近 14 天</option>
          <option value="30d">近 30 天</option>
          <option value="month">本月</option>
          <option value="last_month">上月</option>
          <option value="all">全部</option>
          <option value="custom">自定义</option>
        </select>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <span className="muted">→</span>
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        <button
          type="button"
          className="button ghost compact"
          onClick={() => {
            setRange('custom')
            setPage(1)
          }}
        >
          应用
        </button>
        <div className="usage-grow">
          <span className="muted">粒度:</span>
          <select
            value={grain}
            onChange={(e) => {
              setGrainManual(true)
              setGrain(e.target.value)
              setPage(1)
            }}
          >
            <option value="hour">按小时</option>
            <option value="day">按天</option>
          </select>
        </div>
      </div>

      <div className="usage-dash">
        <Dist title="模型分布" items={chart?.by_model} nestKeys />
        <Dist title="分组使用分布" items={chart?.by_group} />
        <Dist title="端点分布" items={chart?.by_endpoint} />
        <Trend series={chart?.series || chart?.days || []} />
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        {admin && (
          <div className="usage-subtabs">
            <button
              type="button"
              className={tab === 'detail' ? 'on' : ''}
              onClick={() => {
                setTab('detail')
                setPage(1)
              }}
            >
              用量明细
            </button>
            <button
              type="button"
              className={tab === 'error' ? 'on' : ''}
              onClick={() => {
                setTab('error')
                setPage(1)
              }}
            >
              错误请求
            </button>
            <button
              type="button"
              className={tab === 'rank' ? 'on' : ''}
              onClick={() => {
                setTab('rank')
                setPage(1)
              }}
            >
              用户排行
            </button>
          </div>
        )}

        {tab !== 'rank' && (
          <div className="usage-filter-grid">
            {admin && (
              <label className="usage-fld">
                <span>用户</span>
                <input
                  list="usage-users"
                  placeholder="搜索用户..."
                  value={draft.username}
                  onChange={(e) => setField('username', e.target.value)}
                />
                <datalist id="usage-users">
                  {usernames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </label>
            )}
            <label className="usage-fld">
              <span>API 密钥</span>
              <input
                list="usage-keys"
                placeholder="按名称搜索 API 密钥..."
                value={draft.token}
                onChange={(e) => setField('token', e.target.value)}
              />
              <datalist id="usage-keys">
                {tokenNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </label>
            <label className="usage-fld">
              <span>模型</span>
              <select value={draft.model} onChange={(e) => setField('model', e.target.value)}>
                <option value="">请选择</option>
                {modelNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="usage-fld">
              <span>分组</span>
              <select value={draft.group} onChange={(e) => setField('group', e.target.value)}>
                <option value="">请选择</option>
                {groups.map((n) => (
                  <option key={n} value={n}>
                    {n === 'ungrouped' ? '默认分组' : n}
                  </option>
                ))}
              </select>
            </label>
            <label className="usage-fld">
              <span>类型</span>
              <select value={draft.stream} onChange={(e) => setField('stream', e.target.value)}>
                <option value="">请选择</option>
                <option value="1">流式</option>
                <option value="0">非流式</option>
              </select>
            </label>
            <div className="usage-filter-actions">
              <button type="button" className="button secondary compact" disabled={busy} onClick={applyFilters}>
                刷新
              </button>
              <button type="button" className="button ghost compact" onClick={resetFilters}>
                重置
              </button>
              <button type="button" className="button secondary compact" onClick={() => void exportCsv()}>
                导出 CSV
              </button>
            </div>
          </div>
        )}

        {tab !== 'rank' && (
          <div className="usage-pager">
            <div>
              显示 {from.toLocaleString('en-US')} 至 {to.toLocaleString('en-US')} 共{' '}
              {(logs.total || 0).toLocaleString('en-US')} 条结果　每页:{' '}
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value))
                  setPage(1)
                }}
              >
                {[10, 20, 30, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="usage-nums">
              <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                ‹
              </button>
              {pageNums(page, pages).map((n, i) =>
                n === '...' ? (
                  <span key={'e' + i}>…</span>
                ) : (
                  <button
                    type="button"
                    key={n}
                    className={n === page ? 'on' : ''}
                    onClick={() => setPage(Number(n))}
                  >
                    {n}
                  </button>
                ),
              )}
              <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                ›
              </button>
            </div>
          </div>
        )}

        {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}

        <div className="table-wrap">
          {!items.length ? (
            <div className="empty-state">{P('暂无记录')}</div>
          ) : tab === 'rank' ? (
            <table className="data">
              <thead>
                <tr>
                  <th>用户</th>
                  <th>请求</th>
                  <th>Token</th>
                  <th>费用</th>
                </tr>
              </thead>
              <tbody>
                {items.map((x) => (
                  <tr key={x.id}>
                    <td>{x.username || '-'}</td>
                    <td className="num">{x.content || '-'}</td>
                    <td className="num">{fmtTok(usageTokens(x as any))}</td>
                    <td className="fee">{usd(x.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : tab === 'error' ? (
            <table className="data">
              <thead>
                <tr>
                  {admin && <th>用户</th>}
                  <th>API 密钥</th>
                  <th>模型</th>
                  <th>内容</th>
                  <th>时间</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {items.map((x) => (
                  <tr
                    key={x.id}
                    className={admin ? 'diag-row' : undefined}
                    title={admin ? (coarse ? '单击打开诊断' : '双击打开诊断') : undefined}
                    onDoubleClick={() => {
                      if (admin && !coarse) openDiagnosis(x)
                    }}
                    onClick={(e) => {
                      if (admin && coarse) openDiagnosis(x, e)
                    }}
                  >
                    {admin && <td>{x.username || '-'}</td>}
                    <td>{x.token_name || '-'}</td>
                    <td>{x.model_name || '-'}</td>
                    <td>{x.content || '-'}</td>
                    <td className="muted">{fmtTime(x.created_at)}</td>
                    <td>{x.ip || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  {admin && <th>用户</th>}
                  <th>API 密钥</th>
                  <th>模型</th>
                  <th>推理强度</th>
                  <th>端点</th>
                  <th>IP</th>
                  <th>分组</th>
                  <th>类型</th>
                  <th>TOKEN</th>
                  <th>金额</th>
                  <th>延迟</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {items.map((x) => {
                  const cache = Number(x.cache_tokens) || 0
                  const dur = x.duration_ms || 0
                  return (
                    <tr
                      key={x.id}
                      className={admin ? 'diag-row' : undefined}
                      title={admin ? (coarse ? '单击打开诊断' : '双击打开诊断') : undefined}
                      onDoubleClick={() => {
                        if (admin && !coarse) openDiagnosis(x)
                      }}
                      onClick={(e) => {
                        if (admin && coarse) openDiagnosis(x, e)
                      }}
                    >
                      {admin && <td>{x.username || '-'}</td>}
                      <td className="name">{x.token_name}</td>
                      <td>{x.model_name}</td>
                      <td>{x.reasoning || '-'}</td>
                      <td className="ep">
                        <code>{x.endpoint || '-'}</code>
                      </td>
                      <td>{x.ip || '-'}</td>
                      <td>
                        <span className="tag">{x.group || '默认分组'}</span>
                      </td>
                      <td>
                        {x.is_stream ? <span className="tag stream">流式</span> : <span className="tag">非流式</span>}
                      </td>
                      <td className="toks">
                        <span className="dn">↓ {fmtTok(x.prompt_tokens)}</span>{' '}
                        <span className="up">↑ {fmtTok(x.completion_tokens)}</span>
                        {cache ? <span className="cache"> cache {fmtTok(cache)}</span> : null}
                      </td>
                      <td className="fee">{usd(x.amount ?? x.amountUsd)}</td>
                      <td className="lat">
                        首字 {fmtSec(x.ttft_ms)}
                        <br />
                        总耗时 {fmtSec(dur)}
                      </td>
                      <td className="muted">{fmtTime(x.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {admin && detailId ? <DiagnosisModal id={detailId} onClose={() => setDetailId(null)} /> : null}
    </div>
  )
}
