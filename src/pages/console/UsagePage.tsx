import { useEffect, useState } from 'react'
import { Activity } from 'lucide-react'
import { api } from '../../lib/api'
import { formatCredits, formatDateTime, setQuotaPerUnit } from '../../lib/format'
import { getLanguage, P, qt } from '../../i18n'
import { navigate } from '../../router/hash'
import { ConsoleLayout } from './ConsoleLayout'
import { ConsoleHero } from '../../components/ConsoleHero'

export function UsagePage({ path }: { path: string }) {
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [items, setItems] = useState<any[]>([])

  useEffect(() => {
    api.get<{ quota_per_unit: number }>('/api/status', { auth: false }).then((s) => setQuotaPerUnit(s.quota_per_unit))
    api
      .get<{ items: any[]; total: number }>(`/api/log/self?p=${page}&page_size=10&type=2`)
      .then((d) => {
        setItems(d.items || [])
        setTotal(d.total || 0)
      })
      .catch(() => {})
  }, [page])

  const pages = Math.max(1, Math.ceil(total / 10) || 1)

  return (
    <ConsoleLayout path={path} bare>
      <ConsoleHero title={P('用量记录')} subtitle={P('把每一份社区资源，用在新的可能上。')} />

      {!items.length ? (
        <div className="empty-state panel empty-state-rich">
          <div className="empty-icon">
            <Activity size={36} strokeWidth={1.4} />
          </div>
          <h3>{P('还没有调用记录')}</h3>
          <p>{P('第一次模型请求后，你可以在这里查看用量。')}</p>
          <button type="button" className="text-link" onClick={() => navigate('/guide')}>
            {P('查看接入指南')} →
          </button>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{P('时间')}</th>
                <th>{P('模型')}</th>
                <th>{P('密钥')}</th>
                <th>{P('输入 / 输出 Token')}</th>
                <th>{P('消耗额度')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.created_at, getLanguage())}</td>
                  <td>{row.model_name}</td>
                  <td>{row.token_name}</td>
                  <td>
                    {row.prompt_tokens} / {row.completion_tokens}
                  </td>
                  <td>{formatCredits(row.quota)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="pagination">
        <span>{qt(P('共 {total} 条'), { total })}</span>
        <div className="pager-controls">
          <button type="button" className="button ghost compact" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ‹
          </button>
          <span>
            {page} / {pages}
          </span>
          <button
            type="button"
            className="button ghost compact"
            disabled={page * 10 >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            ›
          </button>
        </div>
      </div>
    </ConsoleLayout>
  )
}
