import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { RefreshCw } from 'lucide-react'
import { P, qt } from '../../i18n'
import { api } from '../../lib/api'
import { formatCredits, setQuotaPerUnit } from '../../lib/format'
import { fmtShanghai, pageNums, RANGE_LABELS } from '../../lib/listUi'
import { navigate } from '../../router/hash'
import { ConsoleLayout } from './ConsoleLayout'
import { ConsoleHero } from '../../components/ConsoleHero'

type LedgerItem = {
  id: string
  created_at: number
  ip: string | null
  direction: 'in' | 'out'
  direction_label: string
  channel: string
  channel_label: string
  raw: number
  points: number
  detail_text: string
}

type LedgerResp = {
  items: LedgerItem[]
  total: number
  page: number
  page_size: number
  summary: { in_raw: number; out_raw: number; in_count?: number; out_count?: number }
  balance: number
  credit_unit?: { raw_per_point?: number; quota_per_unit?: number }
}

type ChannelOpt = { value: string; label: string; used?: boolean }

const RANGES = ['today', 'yesterday', '24h', '7d', '30d', 'month', 'last_month', 'all', 'custom'] as const
const DEFAULT_RANGE = '30d'

export function WalletPage({ path }: { path: string }) {
  const [range, setRange] = useState<string>(DEFAULT_RANGE)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [direction, setDirection] = useState('')
  const [channelDraft, setChannelDraft] = useState('')
  const [channel, setChannel] = useState('')
  const [channels, setChannels] = useState<ChannelOpt[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [data, setData] = useState<LedgerResp | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const qs = useMemo(() => {
    const q = new URLSearchParams()
    q.set('range', range)
    if (range === 'custom') {
      if (startDate) q.set('start_date', startDate)
      if (endDate) q.set('end_date', endDate)
    }
    if (direction) q.set('direction', direction)
    if (channel) q.set('channel', channel)
    q.set('p', String(page))
    q.set('page_size', String(pageSize))
    return q.toString()
  }, [range, startDate, endDate, direction, channel, page, pageSize])

  const load = useCallback(async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await api.get<LedgerResp>('/api/wallet/ledger?' + qs)
      const n = Number(r?.credit_unit?.raw_per_point || r?.credit_unit?.quota_per_unit)
      if (n > 0) setQuotaPerUnit(n)
      setData(r)
    } catch (e) {
      setErr((e as Error).message)
    }
    setBusy(false)
  }, [qs])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    api
      .get<{ channels: ChannelOpt[] }>('/api/wallet/channels')
      .then((r) => setChannels(r?.channels || []))
      .catch(() => setChannels([]))
  }, [])

  function applyChannel(v: string) {
    setChannel(v.trim())
    setPage(1)
  }

  function onChannelInput(v: string) {
    setChannelDraft(v)
    // Picking a suggestion (or clearing) applies immediately; free text applies on 查询 / Enter.
    if (!v.trim() || channels.some((c) => c.label === v)) applyChannel(v)
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    applyChannel(channelDraft)
    if (channelDraft.trim() === channel) void load()
  }

  function reset() {
    setRange(DEFAULT_RANGE)
    setStartDate('')
    setEndDate('')
    setDirection('')
    setChannelDraft('')
    setChannel('')
    setPage(1)
  }

  const items = data?.items || []
  const total = data?.total || 0
  const pages = Math.max(1, Math.ceil(total / pageSize) || 1)
  const from = total ? (page - 1) * pageSize + 1 : 0
  const to = Math.min(total, page * pageSize)
  const rangeLabel = RANGE_LABELS[range] || ''
  const s = data?.summary

  return (
    <ConsoleLayout path={path} bare>
      <ConsoleHero title={P('钱包')} subtitle={P('本站积分的收入与支出明细：签到、兑换码、管理员调整，以及组额度用尽后使用余额的 API 调用。')} />
      <div className="usage-records wallet-page">
        <div className="channels-toolbar usage-toolbar">
          <span className="muted">
            {total ? qt(P('共 {n} 条'), { n: total.toLocaleString('en-US') }) : busy ? P('加载中') : P('没有匹配记录')}
          </span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <a
              className="muted wallet-usage-link"
              href="/usage"
              onClick={(e) => {
                e.preventDefault()
                navigate('/usage')
              }}
            >
              {P('组额度消耗见用量记录')} →
            </a>
            <button type="button" className="button secondary compact" disabled={busy} onClick={() => void load()}>
              <RefreshCw size={14} /> {busy ? P('加载中') : P('刷新')}
            </button>
          </div>
        </div>

        <div className="stats-grid usage-kpis">
          <div className="stat-card">
            <div className="label">{P('当前余额')}</div>
            <div className="value">
              {data ? formatCredits(data.balance || 0) : '—'} <span className="unit">{P('点')}</span>
            </div>
            <div className="muted">{P('签到与兑换码发放，组额度用尽后可继续调用')}</div>
          </div>
          <div className="stat-card">
            <div className="label">{P('本期收入')}</div>
            <div className="value wallet-in">
              {s ? '+' + formatCredits(s.in_raw || 0) : '—'} <span className="unit">{P('点')}</span>
            </div>
            <div className="muted">
              {rangeLabel} · {qt(P('{n} 笔'), { n: s?.in_count || 0 })}
            </div>
          </div>
          <div className="stat-card">
            <div className="label">{P('本期支出')}</div>
            <div className="value wallet-out">
              {s ? '-' + formatCredits(s.out_raw || 0) : '—'} <span className="unit">{P('点')}</span>
            </div>
            <div className="muted">
              {rangeLabel} · {qt(P('{n} 笔'), { n: s?.out_count || 0 })}
            </div>
          </div>
        </div>

        <div className="panel">
          <form className="usage-filter-grid wallet-filter-grid" onSubmit={onSubmit}>
            <label className="usage-fld">
              <span>{P('时间日期')}</span>
              <select
                value={range}
                onChange={(e) => {
                  setRange(e.target.value)
                  setPage(1)
                }}
              >
                {RANGES.map((r) => (
                  <option key={r} value={r}>
                    {P(RANGE_LABELS[r])}
                  </option>
                ))}
              </select>
            </label>
            {range === 'custom' ? (
              <>
                <label className="usage-fld">
                  <span>{P('开始日期')}</span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value)
                      setPage(1)
                    }}
                  />
                </label>
                <label className="usage-fld">
                  <span>{P('结束日期')}</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => {
                      setEndDate(e.target.value)
                      setPage(1)
                    }}
                  />
                </label>
              </>
            ) : null}
            <label className="usage-fld">
              <span>{P('方式')}</span>
              <select
                value={direction}
                onChange={(e) => {
                  setDirection(e.target.value)
                  setPage(1)
                }}
              >
                <option value="">{P('全部')}</option>
                <option value="in">{P('收入')}</option>
                <option value="out">{P('支出')}</option>
              </select>
            </label>
            <label className="usage-fld">
              <span>{P('途径')}</span>
              <input
                list="wallet-channels"
                placeholder={P('输入或选择途径...')}
                value={channelDraft}
                onChange={(e) => onChannelInput(e.target.value)}
              />
              <datalist id="wallet-channels">
                {channels.map((c) => (
                  <option key={c.value} value={c.label} />
                ))}
              </datalist>
            </label>
            <div className="usage-filter-actions">
              <button type="submit" className="button secondary compact" disabled={busy}>
                {P('查询')}
              </button>
              <button type="button" className="button ghost compact" onClick={reset}>
                {P('重置')}
              </button>
            </div>
          </form>

          <div className="usage-pager">
            <div>
              {qt(P('显示 {from} 至 {to} 共 {total} 条结果'), {
                from: from.toLocaleString('en-US'),
                to: to.toLocaleString('en-US'),
                total: total.toLocaleString('en-US'),
              })}
              {'　' + P('每页') + ': '}
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

          {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}

          <div className="table-wrap">
            {!items.length ? (
              <div className="empty-state">{busy ? P('加载中') : P('暂无记录')}</div>
            ) : (
              <table className="data wallet-table">
                <thead>
                  <tr>
                    <th>{P('时间日期')}</th>
                    <th>{P('IP地址')}</th>
                    <th>{P('方式')}</th>
                    <th>{P('途径')}</th>
                    <th className="num">{P('点数')}</th>
                    <th className="detail">{P('详细信息')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((x) => (
                    <tr key={x.id}>
                      <td className="muted">{fmtShanghai(x.created_at)}</td>
                      <td>{x.ip || '—'}</td>
                      <td>
                        <span className={'tag ' + (x.direction === 'in' ? 'wallet-tag-in' : 'wallet-tag-out')}>
                          {x.direction === 'in' ? P('收入') : P('支出')}
                        </span>
                      </td>
                      <td>{P(x.channel_label)}</td>
                      <td className={'num ' + (x.direction === 'in' ? 'wallet-in' : 'wallet-out')}>
                        {(x.direction === 'in' ? '+' : '-') + formatCredits(x.raw)}
                      </td>
                      <td className="detail">{x.detail_text || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </ConsoleLayout>
  )
}
