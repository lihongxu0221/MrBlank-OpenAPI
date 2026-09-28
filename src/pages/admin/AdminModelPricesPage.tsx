import { useCallback, useEffect, useState } from 'react'
import { CloudDownload, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { formatCredits, getQuotaPerUnit, setQuotaPerUnit } from '../../lib/format'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'
import { useToast } from '../../hooks/useStore'

type Price = {
  model: string
  input_per_mtok: number
  output_per_mtok: number
  cache_read_per_mtok?: number | null
  cache_write_per_mtok?: number | null
  input_quota_per_mtok?: number | null
  output_quota_per_mtok?: number | null
  cache_read_quota_per_mtok?: number | null
  cache_write_quota_per_mtok?: number | null
  currency?: string
  note?: string
  manual?: boolean
  source?: string
  updated_at?: string | null
  stale?: boolean
}

type CostRow = {
  model: string
  calls: number
  tokens: number
  cost: number
  quota_raw?: number
  quota_points?: number
  priced: boolean
  currency?: string
  price_model?: string | null
  resolved_via?: string | null
  cache_tokens?: number
}

type SyncResult = {
  at?: string
  imported?: number
  updated?: number
  skipped?: number
  skipped_unsupported?: number
  stale_removed?: number
  failed_sources?: string[]
  sources?: Record<string, { ok?: boolean; count?: number; error?: string }>
  total_prices?: number
  supported_count?: number
  priced_count?: number
  priced_auto?: number
  priced_manual?: number
  unpriced_count?: number
  matched_from_sources?: number
  quota_per_unit?: number
}

function numOrEmpty(v: number | null | undefined): string {
  if (v == null || Number.isNaN(Number(v))) return ''
  return String(v)
}

function pointsFromUsd(usd: number, unit: number) {
  return Math.round((Number(usd) || 0) * unit)
}

export function AdminModelPricesPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const { showToast } = useToast()
  const [prices, setPrices] = useState<Price[]>([])
  const [runtime, setRuntime] = useState<string[]>([])
  const [costed, setCosted] = useState<{
    total_cost: number
    total_quota_points?: number
    by_model: CostRow[]
    period: string
    note?: string
  } | null>(null)
  const [period, setPeriod] = useState('today')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<SyncResult | null>(null)
  const [quotaUnit, setQuotaUnit] = useState(500000)
  const [quotaUnitDraft, setQuotaUnitDraft] = useState('500000')
  const [savingUnit, setSavingUnit] = useState(false)

  const load = useCallback(async () => {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      const [book, rt, usage, unit] = await Promise.all([
        api.get<{ prices: Price[]; last_sync?: SyncResult | null; quota_per_unit?: number }>(
          '/api/admin/model-prices',
        ),
        api.get<{ models: string[]; supported?: string[] }>('/api/admin/model-prices/runtime-models'),
        api.get<{
          total_cost: number
          total_quota_points?: number
          by_model: CostRow[]
          period: string
          note?: string
        }>(`/api/admin/model-prices/usage-summary?period=${encodeURIComponent(period)}`),
        api.get<{ quota_per_unit: number }>('/api/admin/quota-unit').catch(async () => {
          const s = await api.get<{ quota_per_unit: number }>('/api/status', { auth: false })
          return s
        }),
      ])
      setPrices(book.prices?.length ? book.prices : [])
      setRuntime(rt.supported || rt.models || [])
      setCosted(usage)
      if (book.last_sync) setLastSync(book.last_sync)
      const u = Number(unit.quota_per_unit || book.quota_per_unit) || 500000
      setQuotaUnit(u)
      setQuotaUnitDraft(String(u))
      setQuotaPerUnit(u)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [gate.allowed, period])

  useEffect(() => {
    if (gate.allowed) load()
  }, [gate.allowed, load])

  function updateRow(i: number, patch: Partial<Price>) {
    setPrices((prev) =>
      prev.map((p, idx) => {
        if (idx !== i) return p
        const next = { ...p, ...patch, manual: true, source: patch.source ?? p.source ?? 'manual' }
        if ('input_per_mtok' in patch) {
          next.input_quota_per_mtok = pointsFromUsd(Number(next.input_per_mtok) || 0, quotaUnit)
        }
        if ('output_per_mtok' in patch) {
          next.output_quota_per_mtok = pointsFromUsd(Number(next.output_per_mtok) || 0, quotaUnit)
        }
        if ('cache_read_per_mtok' in patch) {
          next.cache_read_quota_per_mtok =
            next.cache_read_per_mtok == null
              ? null
              : pointsFromUsd(Number(next.cache_read_per_mtok) || 0, quotaUnit)
        }
        if ('cache_write_per_mtok' in patch) {
          next.cache_write_quota_per_mtok =
            next.cache_write_per_mtok == null
              ? null
              : pointsFromUsd(Number(next.cache_write_per_mtok) || 0, quotaUnit)
        }
        return next
      }),
    )
  }

  function addRow(model = '') {
    setPrices((prev) => [
      ...prev,
      {
        model,
        input_per_mtok: 0,
        output_per_mtok: 0,
        cache_read_per_mtok: null,
        cache_write_per_mtok: null,
        input_quota_per_mtok: 0,
        output_quota_per_mtok: 0,
        currency: 'USD',
        note: '',
        manual: true,
        source: 'manual',
      },
    ])
  }

  function removeRow(i: number) {
    setPrices((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function saveQuotaUnit() {
    setSavingUnit(true)
    setErr(null)
    try {
      const d = await api.put<{ quota_per_unit: number }>('/api/admin/quota-unit', {
        quota_per_unit: Number(quotaUnitDraft),
      })
      setQuotaUnit(d.quota_per_unit)
      setQuotaUnitDraft(String(d.quota_per_unit))
      setQuotaPerUnit(d.quota_per_unit)
      showToast(P('点数换算已保存'))
      await load()
    } catch (e) {
      setErr((e as Error).message)
      showToast((e as Error).message)
    } finally {
      setSavingUnit(false)
    }
  }

  async function save() {
    setSaving(true)
    setErr(null)
    try {
      const cleaned = prices
        .filter((p) => String(p.model || '').trim())
        .map((p) => ({
          ...p,
          cache_read_per_mtok:
            p.cache_read_per_mtok === null ||
            p.cache_read_per_mtok === undefined ||
            (p.cache_read_per_mtok as unknown) === ''
              ? undefined
              : Number(p.cache_read_per_mtok),
          cache_write_per_mtok:
            p.cache_write_per_mtok === null ||
            p.cache_write_per_mtok === undefined ||
            (p.cache_write_per_mtok as unknown) === ''
              ? undefined
              : Number(p.cache_write_per_mtok),
          manual:
            p.manual === true || p.source === 'manual' || /\bmanual\b/i.test(String(p.note || '')),
          source: p.source || (p.manual ? 'manual' : p.source) || '',
        }))
      const d = await api.put<{ prices: Price[]; last_sync?: SyncResult | null }>('/api/admin/model-prices', {
        prices: cleaned,
      })
      setPrices(d.prices || [])
      if (d.last_sync) setLastSync(d.last_sync)
      showToast(P('价格表已保存'))
      await load()
    } catch (e) {
      setErr((e as Error).message)
      showToast((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function syncOfficial() {
    setSyncing(true)
    setErr(null)
    try {
      const d = await api.post<SyncResult & { prices?: Price[] }>(
        '/api/admin/model-prices/sync',
        {},
        { timeoutMs: 90000 },
      )
      setLastSync(d)
      showToast(
        P(
          `同步完成：支持 ${d.supported_count ?? '—'}，已定价 ${d.priced_count ?? 0}，未定价 ${d.unpriced_count ?? 0}，清除过期 ${d.stale_removed ?? 0}` +
            (d.failed_sources?.length ? `；失败源 ${d.failed_sources.join(',')}` : ''),
        ),
      )
      await load()
    } catch (e) {
      setErr((e as Error).message)
      showToast((e as Error).message)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero
        title={P('模型价格')}
        subtitle={P(
          '支持模型目录价格表（非 11k 全集）。USD/MTok 与平台点并列；计费按 aily 公式 raw = round(USD × quota_per_unit)。aily/ 继承裸名。',
        )}
      />

      <div className="panel" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>{P('点数 ↔ 内部单位')}</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          {P('展示点与内部额度单位换算（aily 对齐：默认 1 点 = 1 USD = 500000 内部单位）。价格同步、计费扣减、密钥额度、用户组滚动窗口共用此设置。')}
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
          <div className="field" style={{ minWidth: 220 }}>
            <label>{P('1 点 = N 内部单位')}</label>
            <input
              className="field-input"
              type="number"
              min={1}
              step={1}
              value={quotaUnitDraft}
              onChange={(e) => setQuotaUnitDraft(e.target.value)}
            />
          </div>
          <button type="button" className="button compact" onClick={saveQuotaUnit} disabled={savingUnit}>
            <Save size={14} /> {savingUnit ? P('保存中…') : P('保存换算')}
          </button>
          <div className="muted" style={{ fontSize: 13 }}>
            {P('当前')}：1 {P('点')} = {quotaUnit.toLocaleString('zh-CN')} {P('内部单位')} · 1 USD ={' '}
            {quotaUnit.toLocaleString('zh-CN')} {P('内部单位')}
          </div>
        </div>
      </div>

      <div className="channels-toolbar">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['today', '24h', '7d', 'all'] as const).map((p) => (
            <button
              key={p}
              type="button"
              className={`button compact ${period === p ? '' : 'secondary'}`}
              onClick={() => setPeriod(p)}
            >
              {p}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="button secondary compact" onClick={load} disabled={loading}>
            <RefreshCw size={14} /> {P('刷新')}
          </button>
          <button
            type="button"
            className="button secondary compact"
            onClick={syncOfficial}
            disabled={syncing || loading}
            title={P('仅同步当前支持模型（CPA /v1/models + aily），不覆盖 manual')}
          >
            <CloudDownload size={14} /> {syncing ? P('同步中...') : P('立即同步')}
          </button>
          <button type="button" className="button compact" onClick={save} disabled={saving}>
            <Save size={14} /> {P('保存价格表')}
          </button>
        </div>
      </div>
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}
      {lastSync ? (
        <p className="muted" style={{ marginTop: 0 }}>
          {P('上次同步')}：{' '}
          {lastSync.at
            ? new Date(lastSync.at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
            : '—'}{' '}
          · {P('支持')} {lastSync.supported_count ?? '—'} · {P('已定价')} {lastSync.priced_count ?? lastSync.total_prices ?? 0}{' '}
          · {P('未定价')} {lastSync.unpriced_count ?? '—'} · {P('清除过期')} {lastSync.stale_removed ?? 0} ·{' '}
          {P('新增')} {lastSync.imported ?? 0} · {P('更新')} {lastSync.updated ?? 0}
          {lastSync.failed_sources?.length ? ` · ${P('失败源')} ${lastSync.failed_sources.join(', ')}` : ''}
          {lastSync.quota_per_unit != null
            ? ` · ${P('换算')} 1=${lastSync.quota_per_unit.toLocaleString('zh-CN')}`
            : ''}
        </p>
      ) : (
        <p className="muted" style={{ marginTop: 0 }}>
          {P('尚未同步。可点击「立即同步」，或依赖服务启动后的定时同步（默认每日）。')}
        </p>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">{P('估算成本')}</div>
          <div className="value">{costed ? costed.total_cost.toFixed(4) : '—'}</div>
          <div className="hint">
            USD · {period}
            {costed?.total_quota_points != null
              ? ` · ≈ ${Number(costed.total_quota_points).toFixed(4)} ${P('点')}`
              : ''}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">{P('价格条目')}</div>
          <div className="value">{prices.length}</div>
        </div>
        <div className="stat-card">
          <div className="label">{P('支持模型')}</div>
          <div className="value">{runtime.length}</div>
          <div className="hint">{P('CPA + aily 目录')}</div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <div className="channels-toolbar" style={{ marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>{P('价格表')}</h3>
          <button type="button" className="button secondary compact" onClick={() => addRow()}>
            <Plus size={14} /> {P('添加')}
          </button>
        </div>
        {runtime.length ? (
          <p className="muted" style={{ marginTop: 0 }}>
            {P('快速添加支持模型')}：{' '}
            {runtime.slice(0, 24).map((m) => (
              <button
                key={m}
                type="button"
                className="button secondary compact"
                style={{ marginRight: 4, marginBottom: 4 }}
                onClick={() => {
                  if (!prices.some((p) => p.model === m || p.model === m.replace(/^aily\//, ''))) {
                    addRow(m.replace(/^aily\//, ''))
                  }
                }}
              >
                {m}
              </button>
            ))}
          </p>
        ) : null}
        <p className="muted" style={{ marginTop: 0 }}>
          {P(
            '提示：无需为 aily/xxx 单独定价。手动编辑会标记 manual。USD/MTok 旁显示对应平台点（quota = round(USD×N)）。',
          )}
        </p>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{P('模型')}</th>
                <th>input USD</th>
                <th>input {P('点')}</th>
                <th>output USD</th>
                <th>output {P('点')}</th>
                <th>cache read</th>
                <th>cache write</th>
                <th>{P('来源')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {prices.map((p, i) => (
                <tr key={`${p.model}-${i}`}>
                  <td>
                    <input
                      className="field-input"
                      value={p.model}
                      onChange={(e) => updateRow(i, { model: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="field-input"
                      type="number"
                      step="0.01"
                      value={p.input_per_mtok}
                      onChange={(e) => updateRow(i, { input_per_mtok: Number(e.target.value) || 0 })}
                    />
                  </td>
                  <td>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {(p.input_quota_per_mtok ?? pointsFromUsd(p.input_per_mtok, quotaUnit)).toLocaleString(
                        'zh-CN',
                      )}
                    </span>
                  </td>
                  <td>
                    <input
                      className="field-input"
                      type="number"
                      step="0.01"
                      value={p.output_per_mtok}
                      onChange={(e) => updateRow(i, { output_per_mtok: Number(e.target.value) || 0 })}
                    />
                  </td>
                  <td>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {(
                        p.output_quota_per_mtok ?? pointsFromUsd(p.output_per_mtok, quotaUnit)
                      ).toLocaleString('zh-CN')}
                    </span>
                  </td>
                  <td>
                    <input
                      className="field-input"
                      type="number"
                      step="0.01"
                      placeholder="—"
                      value={numOrEmpty(p.cache_read_per_mtok)}
                      onChange={(e) => {
                        const v = e.target.value
                        updateRow(i, {
                          cache_read_per_mtok: v === '' ? null : Number(v) || 0,
                        })
                      }}
                    />
                    {p.cache_read_per_mtok != null ? (
                      <div className="muted" style={{ fontSize: 11 }}>
                        {pointsFromUsd(Number(p.cache_read_per_mtok) || 0, quotaUnit).toLocaleString('zh-CN')}{' '}
                        {P('点')}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <input
                      className="field-input"
                      type="number"
                      step="0.01"
                      placeholder="—"
                      value={numOrEmpty(p.cache_write_per_mtok)}
                      onChange={(e) => {
                        const v = e.target.value
                        updateRow(i, {
                          cache_write_per_mtok: v === '' ? null : Number(v) || 0,
                        })
                      }}
                    />
                    {p.cache_write_per_mtok != null ? (
                      <div className="muted" style={{ fontSize: 11 }}>
                        {pointsFromUsd(Number(p.cache_write_per_mtok) || 0, quotaUnit).toLocaleString('zh-CN')}{' '}
                        {P('点')}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {p.manual ? 'manual' : p.source || '—'}
                    </span>
                  </td>
                  <td>
                    <button type="button" className="button secondary compact" onClick={() => removeRow(i)}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {!prices.length ? (
                <tr>
                  <td colSpan={9} className="muted">
                    {P('暂无价格条目，点击「立即同步」或手动添加')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>{P('成本汇总')}</h3>
        {costed?.note ? <p className="muted">{costed.note}</p> : null}
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{P('模型')}</th>
                <th>{P('调用')}</th>
                <th>{P('Tokens')}</th>
                <th>cache</th>
                <th>{P('成本')} USD</th>
                <th>{P('点')}</th>
                <th>{P('已定价')}</th>
              </tr>
            </thead>
            <tbody>
              {(costed?.by_model || []).map((r) => (
                <tr key={r.model}>
                  <td>
                    <code>{r.model}</code>
                    {r.resolved_via ? (
                      <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>
                        ← {r.resolved_via}
                      </span>
                    ) : null}
                  </td>
                  <td>{r.calls}</td>
                  <td>{r.tokens.toLocaleString('zh-CN')}</td>
                  <td>{(r.cache_tokens || 0).toLocaleString('zh-CN')}</td>
                  <td>{r.cost.toFixed(6)}</td>
                  <td>
                    {r.quota_points != null
                      ? Number(r.quota_points).toFixed(4)
                      : formatCredits(r.quota_raw ?? 0, getQuotaPerUnit())}
                  </td>
                  <td>{r.priced ? '✓' : '—'}</td>
                </tr>
              ))}
              {!costed?.by_model?.length ? (
                <tr>
                  <td colSpan={7} className="muted">
                    {P('暂无用量')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  )
}
