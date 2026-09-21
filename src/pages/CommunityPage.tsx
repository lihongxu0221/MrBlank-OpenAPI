import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { P } from '../i18n'

type BoardRow = { rank: number; name: string; calls: number; credits: number; mapped?: boolean }
type PoolItem = {
  name: string
  provider?: string
  tier?: string
  status?: string
  success?: number
  failed?: number
  quotas?: { mode: string; known?: boolean; used?: number; limit?: number | null }[]
}
type ActivityRow = {
  model: string
  calls: number
  successful: number
  credits: number
  tokens?: number
}

function pct(used?: number, limit?: number | null) {
  if (limit == null || limit <= 0) return null
  const u = Number(used) || 0
  return Math.max(0, Math.min(100, Math.round((u / limit) * 100)))
}

export function CommunityPage() {
  const [period, setPeriod] = useState<'today' | '7d' | 'all'>('today')
  const [activityPeriod, setActivityPeriod] = useState<'today' | '7d'>('today')
  const [sort, setSort] = useState<'credits' | 'calls'>('credits')
  const [board, setBoard] = useState<BoardRow[]>([])
  const [pool, setPool] = useState<PoolItem[]>([])
  const [activity, setActivity] = useState<ActivityRow[]>([])
  const [notes, setNotes] = useState<{ board?: string; pool?: string; activity?: string }>({})
  const [boardPage, setBoardPage] = useState(1)
  const [boardTotal, setBoardTotal] = useState(0)
  const [loadingBoard, setLoadingBoard] = useState(true)
  const [loadingPool, setLoadingPool] = useState(true)
  const [loadingActivity, setLoadingActivity] = useState(true)

  const loadBoard = useCallback(async () => {
    setLoadingBoard(true)
    try {
      const d = await api.get<{
        items: BoardRow[]
        total?: number
        note?: string
        privacy_note?: string
      }>(`/api/welfare/leaderboard?period=${period}&sort=${sort}&p=${boardPage}`, { auth: false })
      setBoard(d.items || [])
      setBoardTotal(Number(d.total) || (d.items || []).length)
      setNotes((n) => ({ ...n, board: d.note || d.privacy_note }))
    } catch {
      setBoard([])
      setNotes((n) => ({ ...n, board: P('排行榜暂时无法加载') }))
    } finally {
      setLoadingBoard(false)
    }
  }, [period, sort, boardPage])

  const loadPool = useCallback(async () => {
    setLoadingPool(true)
    try {
      const d = await api.get<{ items: PoolItem[]; note?: string }>('/api/welfare/pool', { auth: false })
      setPool(d.items || [])
      setNotes((n) => ({ ...n, pool: d.note }))
    } catch {
      setPool([])
      setNotes((n) => ({ ...n, pool: P('号池暂时无法加载') }))
    } finally {
      setLoadingPool(false)
    }
  }, [])

  const loadActivity = useCallback(async () => {
    setLoadingActivity(true)
    try {
      const d = await api.get<{ items: ActivityRow[]; note?: string }>(
        `/api/welfare/activity?period=${activityPeriod}`,
        { auth: false },
      )
      setActivity(d.items || [])
      setNotes((n) => ({ ...n, activity: d.note }))
    } catch {
      setActivity([])
      setNotes((n) => ({ ...n, activity: P('调用实况暂时无法加载') }))
    } finally {
      setLoadingActivity(false)
    }
  }, [activityPeriod])

  useEffect(() => {
    void loadBoard()
  }, [loadBoard])
  useEffect(() => {
    void loadPool()
  }, [loadPool])
  useEffect(() => {
    void loadActivity()
  }, [loadActivity])

  useEffect(() => {
    const boardTimer = window.setInterval(() => {
      void loadBoard()
      void loadActivity()
    }, 30_000)
    const poolTimer = window.setInterval(() => void loadPool(), 60_000)
    return () => {
      window.clearInterval(boardTimer)
      window.clearInterval(poolTimer)
    }
  }, [loadBoard, loadPool, loadActivity])

  const pageSize = 10
  const maxPage = Math.max(1, Math.ceil((boardTotal || 1) / pageSize))
  const availablePool = useMemo(
    () => pool.filter((p) => String(p.status || '').toLowerCase() === 'available').length,
    [pool],
  )

  return (
    <section className="community-pulse community-full page">
      <header className="pulse-heading">
        <div>
          <div className="eyebrow">{P('THE COMMUNITY, IN MOTION')}</div>
          <h2>
            {P('让每一份额度')}
            <span> {P('都被看见')}</span>
          </h2>
        </div>
        <p>{P('探索者排行榜来自本站密钥用量；号池观测来自 CPA auth-files。数据为空时不造假。')}</p>
      </header>

      <div className="pulse-grid">
        <article className="pulse-card rank-card">
          <header>
            <div>
              <div className="pulse-icon">🏅</div>
              <h3>{P('探索者排行榜')}</h3>
            </div>
            <div className="pulse-live">
              <i />
              {P('约 30 秒更新')}
            </div>
          </header>

          <div className="rank-controls">
            <div className="pulse-segments" role="tablist" aria-label={P('时间范围')}>
              {(
                [
                  ['today', P('今日')],
                  ['7d', P('7 天')],
                  ['all', P('全部')],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={period === id}
                  onClick={() => {
                    setBoardPage(1)
                    setPeriod(id)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <label>
              <span className="sr-only">{P('排序')}</span>
              <select
                value={sort}
                onChange={(e) => {
                  setBoardPage(1)
                  setSort(e.target.value as 'credits' | 'calls')
                }}
              >
                <option value="credits">{P('积分消费')}</option>
                <option value="calls">{P('成功调用')}</option>
              </select>
            </label>
          </div>

          <div className="rank-table-wrap">
            <table className="rank-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{P('成员')}</th>
                  <th>{P('调用')}</th>
                  <th>{P('点数')}</th>
                </tr>
              </thead>
              <tbody>
                {board.map((r) => (
                  <tr key={`${r.rank}-${r.name}`}>
                    <td>
                      <span className={r.rank <= 3 ? 'rank-medal' : ''}>{r.rank}</span>
                    </td>
                    <td>
                      <strong>{r.name}</strong>
                      {r.mapped ? null : <small>{P('脱敏')}</small>}
                    </td>
                    <td>
                      {r.calls}
                      <span className="rank-unit">{P('次')}</span>
                    </td>
                    <td>
                      {r.credits}
                      <span className="rank-unit">{P('点')}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loadingBoard && !board.length ? (
              <p className="pulse-empty">{notes.board || P('暂无本站密钥用量，排行榜为空。')}</p>
            ) : null}
          </div>

          <footer className="rank-footer">
            <div>
              <button type="button" disabled={boardPage <= 1} onClick={() => setBoardPage((p) => Math.max(1, p - 1))}>
                ‹
              </button>
              <span>
                {boardPage} / {maxPage}
              </span>
              <button
                type="button"
                disabled={boardPage >= maxPage}
                onClick={() => setBoardPage((p) => Math.min(maxPage, p + 1))}
              >
                ›
              </button>
            </div>
            <span>{loadingBoard ? P('刷新中…') : notes.board || P('仅统计本站密钥')}</span>
          </footer>
        </article>

        <article className="pulse-card pool-card">
          <header>
            <div>
              <div className="pulse-icon">🌊</div>
              <h3>{P('号池实时观测')}</h3>
            </div>
            <div className="pulse-live">
              <i />
              {P('约 60 秒更新')}
            </div>
          </header>
          <div className="pool-intro">
            <div>
              <strong>{pool.length}</strong>
              <span>{P('上游账号')}</span>
            </div>
            <div>
              <strong>{availablePool}</strong>
              <span>{P('可用')}</span>
            </div>
          </div>
          <div className="pool-list">
            {pool.map((item) => {
              const q = (item.quotas || [])[0]
              const bar = pct(q?.used, q?.limit)
              return (
                <div key={`${item.name}-${item.provider}`} className="pool-account">
                  <div className="pool-account-head">
                    <div>
                      <strong>{item.name}</strong>
                      <span>
                        {item.provider || 'cpa'} · {item.tier || 'oauth'}
                      </span>
                    </div>
                    <span className={`pool-state ${item.status === 'available' ? '' : 'pending'}`}>
                      {item.status || '—'}
                    </span>
                  </div>
                  <div className="pool-meter-label">
                    <span>{q?.mode || 'observed'}</span>
                    <strong>
                      {q?.used ?? 0}/{q?.limit ?? '—'}
                    </strong>
                  </div>
                  <div className={`pool-meter ${bar == null ? 'unknown' : ''}`}>
                    <span style={{ width: bar == null ? '30%' : `${bar}%` }} />
                  </div>
                  <small>
                    ok {item.success ?? 0} · fail {item.failed ?? 0}
                  </small>
                </div>
              )
            })}
            {!loadingPool && !pool.length ? (
              <p className="pulse-empty">{notes.pool || P('暂无上游账号可观测。')}</p>
            ) : null}
          </div>
          <p className="pulse-caption">{loadingPool ? P('刷新中…') : P('来源：CPA auth-files（Management Key）')}</p>
        </article>
      </div>

      <article className="pulse-card model-activity">
        <header>
          <div>
            <div className="pulse-icon">📡</div>
            <h3>{P('模型调用实况')}</h3>
          </div>
          <div className="pulse-segments" role="tablist">
            {(
              [
                ['today', P('今日')],
                ['7d', P('7 天')],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={activityPeriod === id}
                onClick={() => setActivityPeriod(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </header>
        <div className="rank-table-wrap">
          <table className="rank-table">
            <thead>
              <tr>
                <th>{P('模型')}</th>
                <th>{P('调用')}</th>
                <th>{P('成功率')}</th>
                <th>{P('Tokens / 点数')}</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((a) => {
                const rate = a.calls ? Math.round((a.successful / a.calls) * 1000) / 10 : 0
                return (
                  <tr key={a.model}>
                    <td>
                      <strong>{a.model}</strong>
                    </td>
                    <td>{a.calls}</td>
                    <td>
                      <div className="pool-meter-label" style={{ margin: 0 }}>
                        <span>{rate}%</span>
                        <strong>
                          {a.successful}/{a.calls}
                        </strong>
                      </div>
                      <div className="pool-meter" style={{ marginTop: 6 }}>
                        <span style={{ width: `${Math.max(0, Math.min(100, rate))}%` }} />
                      </div>
                    </td>
                    <td>
                      {a.tokens ?? a.credits}
                      <span className="rank-unit">tok</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!loadingActivity && !activity.length ? (
            <p className="pulse-empty">{notes.activity || P('暂无本站模型调用记录。')}</p>
          ) : null}
        </div>
      </article>
    </section>
  )
}
