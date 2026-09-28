import { useCallback, useEffect, useState } from 'react'
import { CloudDownload, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'
import { useToast } from '../../hooks/useStore'

type Price = {
  model: string
  input_per_mtok: number
  output_per_mtok: number
  currency?: string
  note?: string
  manual?: boolean
  source?: string
}

type CostRow = {
  model: string
  calls: number
  tokens: number
  cost: number
  priced: boolean
  currency?: string
  price_model?: string | null
  resolved_via?: string | null
}

type SyncResult = {
  at?: string
  imported?: number
  updated?: number
  skipped?: number
  failed_sources?: string[]
  sources?: Record<string, { ok?: boolean; count?: number; error?: string }>
  total_prices?: number
}

export function AdminModelPricesPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const { showToast } = useToast()
  const [prices, setPrices] = useState<Price[]>([])
  const [runtime, setRuntime] = useState<string[]>([])
  const [costed, setCosted] = useState<{ total_cost: number; by_model: CostRow[]; period: string; note?: string } | null>(
    null,
  )
  const [period, setPeriod] = useState('today')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<SyncResult | null>(null)

  const load = useCallback(async () => {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      const [book, rt, usage] = await Promise.all([
        api.get<{ prices: Price[]; last_sync?: SyncResult | null }>('/api/admin/model-prices'),
        api.get<{ models: string[] }>('/api/admin/model-prices/runtime-models'),
        api.get<{ total_cost: number; by_model: CostRow[]; period: string; note?: string }>(
          `/api/admin/model-prices/usage-summary?period=${encodeURIComponent(period)}`,
        ),
      ])
      setPrices(book.prices?.length ? book.prices : [])
      setRuntime(rt.models || [])
      setCosted(usage)
      if (book.last_sync) setLastSync(book.last_sync)
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
    // Any manual edit locks the row so official sync will not overwrite it.
    setPrices((prev) =>
      prev.map((p, idx) =>
        idx === i ? { ...p, ...patch, manual: true, source: patch.source ?? p.source ?? 'manual' } : p,
      ),
    )
  }

  function addRow(model = '') {
    setPrices((prev) => [
      ...prev,
      { model, input_per_mtok: 0, output_per_mtok: 0, currency: 'USD', note: '', manual: true, source: 'manual' },
    ])
  }

  function removeRow(i: number) {
    setPrices((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function save() {
    setSaving(true)
    setErr(null)
    try {
      const cleaned = prices
        .filter((p) => String(p.model || '').trim())
        .map((p) => ({
          ...p,
          manual:
            p.manual === true ||
            p.source === 'manual' ||
            /\bmanual\b/i.test(String(p.note || '')),
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
          `同步完成：新增 ${d.imported ?? 0}，更新 ${d.updated ?? 0}，跳过 ${d.skipped ?? 0}` +
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
          '本站价格表 × site-usage tokens 估算成本（非 CPAMP）。单位：每百万 tokens。aily/ 模型自动继承裸名价格。',
        )}
      />
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
            title={P('从 models.dev / LiteLLM / OpenRouter 拉取缺失价格（不覆盖 manual）')}
          >
            <CloudDownload size={14} /> {syncing ? P('同步中...') : P('同步官方/聚合价格')}
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
          · {P('新增')} {lastSync.imported ?? 0} · {P('更新')} {lastSync.updated ?? 0} · {P('跳过')}{' '}
          {lastSync.skipped ?? 0}
          {lastSync.failed_sources?.length
            ? ` · ${P('失败源')} ${lastSync.failed_sources.join(', ')}`
            : ''}
          {lastSync.total_prices != null ? ` · ${P('总计')} ${lastSync.total_prices}` : ''}
        </p>
      ) : null}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">{P('估算成本')}</div>
          <div className="value">{costed ? costed.total_cost.toFixed(4) : '—'}</div>
          <div className="hint">USD · {period}</div>
        </div>
        <div className="stat-card">
          <div className="label">{P('价格条目')}</div>
          <div className="value">{prices.length}</div>
        </div>
        <div className="stat-card">
          <div className="label">{P('运行时模型')}</div>
          <div className="value">{runtime.length}</div>
          <div className="hint">{P('site-usage + aily')}</div>
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
            {P('快速添加运行时模型')}：{' '}
            {runtime.slice(0, 16).map((m) => (
              <button
                key={m}
                type="button"
                className="button secondary compact"
                style={{ marginRight: 4, marginBottom: 4 }}
                onClick={() => {
                  if (!prices.some((p) => p.model === m)) addRow(m)
                }}
              >
                {m}
              </button>
            ))}
          </p>
        ) : null}
        <p className="muted" style={{ marginTop: 0 }}>
          {P('提示：无需为 aily/xxx 单独定价，成本汇总会回退到裸名 xxx 的价格。手动行请保留 note/source 含 manual，同步不会覆盖。')}
        </p>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{P('模型')}</th>
                <th>input / MTok</th>
                <th>output / MTok</th>
                <th>{P('币种')}</th>
                <th>{P('备注')}</th>
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
                    <input
                      className="field-input"
                      type="number"
                      step="0.01"
                      value={p.output_per_mtok}
                      onChange={(e) => updateRow(i, { output_per_mtok: Number(e.target.value) || 0 })}
                    />
                  </td>
                  <td>
                    <input
                      className="field-input"
                      value={p.currency || 'USD'}
                      onChange={(e) => updateRow(i, { currency: e.target.value })}
                      style={{ width: 72 }}
                    />
                  </td>
                  <td>
                    <input
                      className="field-input"
                      value={p.note || ''}
                      onChange={(e) => updateRow(i, { note: e.target.value })}
                    />
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
                  <td colSpan={7} className="muted">
                    {P('暂无价格条目，点击「同步官方/聚合价格」或手动添加')}
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
                <th>{P('成本')}</th>
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
                  <td>{r.cost.toFixed(6)}</td>
                  <td>{r.priced ? '✓' : '—'}</td>
                </tr>
              ))}
              {!costed?.by_model?.length ? (
                <tr>
                  <td colSpan={5} className="muted">
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
