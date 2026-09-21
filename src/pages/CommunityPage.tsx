import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { P } from '../i18n'

export function CommunityPage() {
  const [period, setPeriod] = useState('today')
  const [sort, setSort] = useState('credits')
  const [board, setBoard] = useState<{ rank: number; name: string; calls: number; credits: number }[]>([])
  const [pool, setPool] = useState<any[]>([])
  const [activity, setActivity] = useState<any[]>([])
  const [notes, setNotes] = useState<{ board?: string; pool?: string; activity?: string }>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const activityPeriod = period === 'all' ? 'all' : period
    Promise.all([
      api
        .get<{ items: any[]; note?: string }>(
          `/api/welfare/leaderboard?period=${period}&sort=${sort}&p=1`,
          { auth: false },
        )
        .then((d) => ({ board: d.items || [], boardNote: d.note }))
        .catch(() => ({ board: [] as any[], boardNote: P('排行榜暂时无法加载') })),
      api
        .get<{ items: any[]; note?: string }>('/api/welfare/pool', { auth: false })
        .then((d) => ({ pool: d.items || [], poolNote: d.note }))
        .catch(() => ({ pool: [] as any[], poolNote: P('号池暂时无法加载') })),
      api
        .get<{ items: any[]; note?: string }>(`/api/welfare/activity?period=${activityPeriod}`, {
          auth: false,
        })
        .then((d) => ({ activity: d.items || [], activityNote: d.note }))
        .catch(() => ({ activity: [] as any[], activityNote: P('调用实况暂时无法加载') })),
    ]).then((parts) => {
      if (cancelled) return
      const a = parts[0]
      const b = parts[1]
      const c = parts[2]
      setBoard(a.board)
      setPool(b.pool)
      setActivity(c.activity)
      setNotes({ board: a.boardNote, pool: b.poolNote, activity: c.activityNote })
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [period, sort])

  return (
    <div className="page">
      <div className="eyebrow">{P('社区脉搏')}</div>
      <h1>{P('共享资源，此刻正在发生')}</h1>
      <p className="page-lead">{P('探索者排行榜、号池观测与模型调用实况。')}</p>

      <div className="panel" style={{ marginTop: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>{P('探索者排行榜')}</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['today', '7d', 'all'] as const).map((p) => (
              <button
                type="button"
                key={p}
                className={`button ${period === p ? '' : 'secondary'}`}
                onClick={() => setPeriod(p)}
              >
                {p === 'today' ? P('今日') : p === '7d' ? P('7 天') : P('全部')}
              </button>
            ))}
            {(['credits', 'calls'] as const).map((s) => (
              <button
                type="button"
                key={s}
                className={`button ${sort === s ? '' : 'secondary'}`}
                onClick={() => setSort(s)}
              >
                {s === 'credits' ? P('积分消费') : P('成功调用')}
              </button>
            ))}
          </div>
        </div>
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>{P('成员')}</th>
                <th>{P('调用次数')}</th>
                <th>{P('消耗点数')}</th>
              </tr>
            </thead>
            <tbody>
              {board.map((r) => (
                <tr key={r.rank}>
                  <td>{r.rank}</td>
                  <td>{r.name}</td>
                  <td>{r.calls}</td>
                  <td>{r.credits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !board.length ? (
          <p className="empty-state">{notes.board || P('暂无用量数据，排行榜为空。')}</p>
        ) : null}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3>{P('号池实时观测')}</h3>
        <div className="pool-strip">
          {pool.map((item) => (
            <div key={item.name} className="panel" style={{ boxShadow: 'none', marginTop: 8 }}>
              <strong>{item.name}</strong> · {item.provider} · {item.status}
              <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                {(item.quotas || []).map((q: any, i: number) => (
                  <span key={i} style={{ marginRight: 10 }}>
                    {q.mode}: {q.used}/{q.limit ?? '—'}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        {!loading && !pool.length ? (
          <p className="empty-state">{notes.pool || P('暂无上游账号可观测。')}</p>
        ) : null}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3>{P('模型调用实况')}</h3>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{P('模型')}</th>
                <th>{P('调用次数')}</th>
                <th>{P('成功')}</th>
                <th>{P('消耗点数')}</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((a) => (
                <tr key={a.model}>
                  <td>{a.model}</td>
                  <td>{a.calls}</td>
                  <td>{a.successful}</td>
                  <td>{a.credits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !activity.length ? (
          <p className="empty-state">{notes.activity || P('暂无模型调用记录。')}</p>
        ) : null}
      </div>
    </div>
  )
}
