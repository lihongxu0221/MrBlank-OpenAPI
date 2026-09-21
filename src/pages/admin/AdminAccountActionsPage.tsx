import { useCallback, useEffect, useState } from 'react'
import { Check, EyeOff, RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'
import { useToast } from '../../hooks/useStore'

type Candidate = {
  id: string
  kind: string
  name?: string | null
  label?: string
  provider?: string | null
  status?: string
  status_message?: string
  reason?: string
  failed?: number
  success?: number
  source?: string
}

type ListResp = { items: Candidate[]; total: number; note?: string; dismissed?: number }

export function AdminAccountActionsPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const { showToast } = useToast()
  const [data, setData] = useState<ListResp | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      setData(await api.get<ListResp>('/api/admin/account-actions'))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [gate.allowed])

  useEffect(() => {
    if (gate.allowed) load()
  }, [gate.allowed, load])

  async function act(id: string, action: 'ignore' | 'resolve') {
    setBusy(`${id}:${action}`)
    try {
      await api.post(`/api/admin/account-actions/${id}/${action}`)
      showToast(action === 'ignore' ? P('已忽略') : P('已标记解决'))
      await load()
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero
        title={P('认证异常')}
        subtitle={P('从 auth-files 状态与诊断失败生成候选项；忽略/解决仅本地归档，不会删除 CPA 凭证。')}
      />
      <div className="channels-toolbar">
        <span className="muted">
          {P('候选项')} {data?.total ?? '—'} · {P('已归档')} {data?.dismissed ?? 0}
        </span>
        <button type="button" className="button secondary compact" onClick={load} disabled={loading}>
          <RefreshCw size={14} /> {P('刷新')}
        </button>
      </div>
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}
      {data?.note ? <p className="muted">{data.note}</p> : null}

      <div className="panel" style={{ marginTop: 8 }}>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{P('标签')}</th>
                <th>{P('类型')}</th>
                <th>{P('原因')}</th>
                <th>{P('失败')}</th>
                <th>{P('来源')}</th>
                <th>{P('操作')}</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items || []).map((c) => (
                <tr key={c.id}>
                  <td>
                    <div>{c.label || c.name || c.id}</div>
                    {c.provider ? <div className="muted">{c.provider}</div> : null}
                    {c.status_message ? (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {c.status_message.slice(0, 120)}
                      </div>
                    ) : null}
                  </td>
                  <td>{c.kind}</td>
                  <td>
                    <code>{c.reason || c.status || '—'}</code>
                  </td>
                  <td>{c.failed ?? 0}</td>
                  <td className="muted">{c.source || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="button secondary compact"
                        disabled={busy === `${c.id}:ignore`}
                        onClick={() => act(c.id, 'ignore')}
                      >
                        <EyeOff size={14} /> {P('忽略')}
                      </button>
                      <button
                        type="button"
                        className="button compact"
                        disabled={busy === `${c.id}:resolve`}
                        onClick={() => act(c.id, 'resolve')}
                      >
                        <Check size={14} /> {P('解决')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!data?.items?.length ? (
                <tr>
                  <td colSpan={6} className="muted">
                    {P('暂无异常候选项')}
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
