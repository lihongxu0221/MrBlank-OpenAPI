import { useEffect, useMemo, useState } from 'react'
import { Clock3, RefreshCw, Sparkles, Zap } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleLayout } from './ConsoleLayout'
import { ConsoleHero } from '../../components/ConsoleHero'

type Model = {
  id: string
  name?: string
  status: string
  latency_ms?: number
  availability?: number
  history?: { checked_at: string; status: string; latency_ms?: number }[]
}
type Group = { name?: string; checked_at?: string; models: Model[] }
type Endpoint = { path: string; status: string; latency_ms?: number | null }
type Totals = {
  models?: number
  operational?: number
  avg_latency_ms?: number | null
  total_tokens?: number
  total_requests?: number
}

const ENDPOINT_META: { title: string; path: string; desc: string }[] = [
  { title: 'OpenAI Chat', path: '/v1/chat/completions', desc: '兼容 Chat Completions，快速接入现有客户端。' },
  { title: 'Anthropic Messages', path: '/v1/messages', desc: 'Messages API 风格，适合 Claude 生态工具。' },
  { title: 'OpenAI Responses', path: '/v1/responses', desc: 'Responses 协议，统一多模态输出。' },
  { title: 'Images', path: '/v1/images/generations', desc: '图像生成接口，按张计费。' },
  { title: 'Videos', path: '/v1/videos', desc: '视频生成接口，按秒计费。' },
]

function statusLabel(status: string) {
  if (status === 'operational') return P('正常')
  if (status === 'degraded') return P('部分异常')
  if (status === 'disabled') return P('未启用')
  return P('暂不可用')
}

function statusClass(status: string) {
  if (status === 'operational') return 'ok'
  if (status === 'degraded') return 'warn'
  if (status === 'disabled') return 'off'
  return 'down'
}

export function ChannelsPage({ path }: { path: string }) {
  const [groups, setGroups] = useState<Group[]>([])
  const [checkedAt, setCheckedAt] = useState('')
  const [range, setRange] = useState<'24h' | '7d'>('7d')
  const [loading, setLoading] = useState(true)
  const [totals, setTotals] = useState<Totals>({})
  const [endpoints, setEndpoints] = useState<Endpoint[]>([])
  const [overall, setOverall] = useState('unavailable')

  async function load() {
    setLoading(true)
    try {
      const data = await api.get<{
        checked_at: string
        groups: Group[]
        totals?: Totals
        endpoints?: Endpoint[]
        overall?: string
      }>('/api/welfare/availability', {
        auth: false,
      })
      setGroups(data.groups || [])
      setCheckedAt(data.checked_at || '')
      setTotals(data.totals || {})
      setEndpoints(data.endpoints || [])
      setOverall(data.overall || 'unavailable')
    } catch {
      /* keep previous */
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const models = useMemo(() => groups.flatMap((g) => g.models || []), [groups])
  const active = totals.operational ?? models.filter((m) => m.status === 'operational').length
  const totalModels = totals.models ?? models.length
  const avgLatency =
    totals.avg_latency_ms ??
    (models.filter((m) => m.latency_ms != null).reduce((s, m) => s + (m.latency_ms || 0), 0) /
      Math.max(1, models.filter((m) => m.latency_ms != null).length) ||
      0)
  const tokenTotal = totals.total_tokens ?? 0

  const checkedLabel = checkedAt
    ? new Date(checkedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
    : '—'

  const endpointByPath = useMemo(() => {
    const m = new Map<string, Endpoint>()
    for (const ep of endpoints) m.set(ep.path, ep)
    return m
  }, [endpoints])

  return (
    <ConsoleLayout path={path} bare>
      <ConsoleHero
        title={P('服务状态')}
        subtitle={P('把握每一秒机型灵感，用稳定的性能支撑你的探索。')}
      />

      <div className="channels-metrics">
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="label">{P('活跃渠道数量')}</div>
            <Zap size={14} className="stat-icon" />
          </div>
          <div className="value">
            {active} / {totalModels}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="label">{P('平均响应耗时')}</div>
            <Clock3 size={14} className="stat-icon" />
          </div>
          <div className="value">{avgLatency ? `${(avgLatency / 1000).toFixed(2)} s` : '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="label">{P('累计消耗额度')}</div>
            <Sparkles size={14} className="stat-icon" />
          </div>
          <div className="value">{tokenTotal ? tokenTotal.toLocaleString('zh-CN') : '0'}</div>
        </div>
      </div>

      <div className="channels-toolbar">
        <span className="muted">
          {P('最后更新')}：{checkedLabel}
          {overall ? ` · ${statusLabel(overall)}` : ''}
        </span>
        <div className="range-tabs">
          <button type="button" className={range === '24h' ? 'is-active' : ''} onClick={() => setRange('24h')}>
            {P('24 小时')}
          </button>
          <button type="button" className={range === '7d' ? 'is-active' : ''} onClick={() => setRange('7d')}>
            {P('7 天')}
          </button>
          <button type="button" className="button secondary compact" onClick={load} disabled={loading}>
            <RefreshCw size={14} /> {P('刷新状态')}
          </button>
        </div>
      </div>

      <div className="status-legend">
        <span>
          <i className="dot ok" /> {P('正常')}
        </span>
        <span>
          <i className="dot warn" /> {P('部分异常')}
        </span>
        <span>
          <i className="dot down" /> {P('服务不可用')}
        </span>
        <span>
          <i className="dot off" /> {P('未启用')}
        </span>
      </div>

      {groups.map((g) => (
        <div key={g.name || 'default'} className="channel-group">
          <div className="eyebrow">MODEL COLLECTION / {g.name || P('默认分组')}</div>
          <div className="channel-grid">
            {(g.models || []).map((m) => {
              const hist = (m.history || []).slice(0, range === '24h' ? 24 : 7).reverse()
              const avail =
                m.availability ??
                (hist.length
                  ? (hist.filter((h) => h.status === 'operational').length / hist.length) * 100
                  : 0)
              return (
                <article key={m.id} className="channel-card panel">
                  <div className={`health-badge ${statusClass(m.status)}`}>
                    ● {statusLabel(m.status)}
                  </div>
                  <h3>{m.name || m.id}</h3>
                  <div className="channel-meta">
                    <div>
                      <span className="label">{P('最快响应耗时')}</span>
                      <strong>{m.latency_ms != null ? `${(m.latency_ms / 1000).toFixed(2)} s` : '—'}</strong>
                    </div>
                    <div>
                      <span className="label">{P('可用性分布')}</span>
                      <strong>{avail.toFixed(1)}%</strong>
                    </div>
                  </div>
                  <div className="history-track tall">
                    {hist.map((h, i) => (
                      <div
                        key={i}
                        className={`history-bar ${h.status === 'operational' ? 'ok' : h.status === 'degraded' ? 'warn' : ''}`}
                        style={{
                          height: `${Math.min(36, Math.max(6, (h.latency_ms || 200) / 50))}px`,
                        }}
                      />
                    ))}
                  </div>
                  <div className="channel-foot">
                    <span>
                      {P('最近检测')} · {checkedLabel}
                    </span>
                    <details>
                      <summary>{P('API 模型标识')}</summary>
                      <code>{m.id}</code>
                    </details>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      ))}

      {!loading && !models.length ? <p className="empty-state">{P('尚无模型检测记录，请稍后回来。')}</p> : null}

      <div className="capability-section">
        <h2>{P('接口能力，一眼了解。')}</h2>
        <div className="capability-grid">
          {ENDPOINT_META.map((ep) => {
            const live = endpointByPath.get(ep.path)
            const st = live?.status || overall || 'down'
            return (
              <article key={ep.path} className="panel capability-card">
                <div className={`health-badge ${statusClass(st)}`}>● {statusLabel(st)}</div>
                <h3>{ep.title}</h3>
                <code>{ep.path}</code>
                <p>{P(ep.desc)}</p>
                {live?.latency_ms != null ? (
                  <p className="muted" style={{ fontSize: 13 }}>
                    {live.latency_ms} ms
                  </p>
                ) : null}
              </article>
            )
          })}
        </div>
      </div>
    </ConsoleLayout>
  )
}
