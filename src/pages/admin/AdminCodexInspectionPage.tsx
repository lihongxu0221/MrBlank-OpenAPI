import { useCallback, useEffect, useState } from 'react'
import { Ban, Play, RefreshCw, ShieldOff } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'
import { useToast } from '../../hooks/useStore'

type Finding = {
  id: string
  name?: string | null
  label?: string | null
  provider?: string | null
  status?: string | null
  status_message?: string
  disabled?: boolean
  verdict?: string
  severity?: string
  suggested_actions?: string[]
}

type RunSummary = {
  id: string
  status: string
  created_at?: string
  finished_at?: string | null
  summary?: {
    scanned?: number
    ok?: number
    expired?: number
    error?: number
    disabled?: number
  } | null
  finding_count?: number
  note?: string
}

type RunDetail = RunSummary & {
  findings?: Finding[]
  error?: string | null
  actions_log?: { at: string; results: { type: string; name?: string | null; ok: boolean; error?: string }[] }[]
}

type ListResp = { note?: string; items: RunSummary[]; total: number }

function fmtTime(iso?: string | null) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return String(iso)
  }
}

export function AdminCodexInspectionPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const { showToast } = useToast()
  const [list, setList] = useState<ListResp | null>(null)
  const [selected, setSelected] = useState<RunDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const loadList = useCallback(async () => {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      setList(await api.get<ListResp>('/api/admin/codex-inspection/runs?limit=30'))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [gate.allowed])

  useEffect(() => {
    if (gate.allowed) loadList()
  }, [gate.allowed, loadList])

  async function startRun() {
    setBusy('run')
    try {
      const run = await api.post<RunDetail>('/api/admin/codex-inspection/run', { async: false })
      showToast(P('巡检完成'))
      setSelected(run)
      await loadList()
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function openRun(id: string) {
    setBusy(`open:${id}`)
    try {
      setSelected(await api.get<RunDetail>(`/api/admin/codex-inspection/runs/${id}`))
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function cancelRun(id: string) {
    setBusy(`cancel:${id}`)
    try {
      await api.post(`/api/admin/codex-inspection/runs/${id}/cancel`)
      showToast(P('已取消'))
      await loadList()
      if (selected?.id === id) await openRun(id)
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function applyAction(type: string, name: string, confirmDelete = false) {
    if (!selected) return
    if (type === 'delete') {
      if (!confirmDelete) return
      if (!window.confirm(P('确认删除该 auth-file？此操作不可恢复。'))) return
    }
    setBusy(`act:${type}:${name}`)
    try {
      const body =
        type === 'delete'
          ? { actions: [{ type: 'delete', name, confirm: true }] }
          : { actions: [{ type, name }] }
      const res = await api.post<{ results: { ok: boolean; error?: string; type: string }[] }>(
        `/api/admin/codex-inspection/runs/${selected.id}/actions`,
        body,
      )
      const bad = (res.results || []).find((r) => !r.ok)
      showToast(bad ? bad.error || P('操作失败') : P('操作已执行'))
      await openRun(selected.id)
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero
        title={P('Codex 巡检')}
        subtitle={P('本站版 Codex 巡检（基于 CPA auth-files，非 CPAMP 原版）')}
      />
      <div className="channels-toolbar">
        <span className="muted">
          {list?.note || P('本站版 Codex 巡检（基于 CPA auth-files，非 CPAMP 原版）')} · {P('记录')}{' '}
          {list?.total ?? '—'}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="button secondary compact" onClick={loadList} disabled={loading}>
            <RefreshCw size={14} /> {P('刷新')}
          </button>
          <button type="button" className="button compact" onClick={startRun} disabled={busy === 'run'}>
            <Play size={14} /> {P('开始巡检')}
          </button>
        </div>
      </div>
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}

      <div className="panel" style={{ marginTop: 8 }}>
        <h3>{P('巡检记录')}</h3>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>ID</th>
                <th>{P('状态')}</th>
                <th>{P('时间')}</th>
                <th>{P('摘要')}</th>
                <th>{P('操作')}</th>
              </tr>
            </thead>
            <tbody>
              {(list?.items || []).map((r) => (
                <tr key={r.id}>
                  <td>
                    <code>{r.id}</code>
                  </td>
                  <td>{r.status}</td>
                  <td>{fmtTime(r.created_at)}</td>
                  <td className="muted">
                    {r.summary
                      ? `scan ${r.summary.scanned ?? 0} · ok ${r.summary.ok ?? 0} · exp ${r.summary.expired ?? 0} · err ${r.summary.error ?? 0}`
                      : `findings ${r.finding_count ?? 0}`}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="button secondary compact"
                        disabled={busy === `open:${r.id}`}
                        onClick={() => openRun(r.id)}
                      >
                        {P('详情')}
                      </button>
                      {r.status === 'running' || r.status === 'queued' ? (
                        <button
                          type="button"
                          className="button secondary compact"
                          disabled={busy === `cancel:${r.id}`}
                          onClick={() => cancelRun(r.id)}
                        >
                          <Ban size={14} /> {P('取消')}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !(list?.items || []).length ? <p className="empty-state">{P('暂无巡检记录。')}</p> : null}
      </div>

      {selected ? (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3>
            {P('详情')} <code>{selected.id}</code> · {selected.status}
          </h3>
          <p className="muted">{selected.note}</p>
          {selected.error ? <p style={{ color: 'var(--error)' }}>{selected.error}</p> : null}
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{P('账号')}</th>
                  <th>{P('判定')}</th>
                  <th>{P('状态')}</th>
                  <th>{P('安全操作')}</th>
                </tr>
              </thead>
              <tbody>
                {(selected.findings || []).map((f) => (
                  <tr key={f.id}>
                    <td>
                      <div>{f.label || f.name}</div>
                      <div className="muted">{f.provider}</div>
                      {f.status_message ? (
                        <div className="muted" style={{ fontSize: 12 }}>
                          {f.status_message.slice(0, 120)}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <code>{f.verdict}</code>
                    </td>
                    <td>{f.status || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {f.name ? (
                          <>
                            <button
                              type="button"
                              className="button secondary compact"
                              disabled={!!busy}
                              onClick={() => applyAction('refresh', f.name!)}
                            >
                              <RefreshCw size={14} /> {P('刷新')}
                            </button>
                            {!f.disabled ? (
                              <button
                                type="button"
                                className="button secondary compact"
                                disabled={!!busy}
                                onClick={() => applyAction('disable', f.name!)}
                              >
                                <ShieldOff size={14} /> {P('禁用')}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="button secondary compact"
                              style={{ color: 'var(--error)' }}
                              disabled={!!busy}
                              onClick={() => applyAction('delete', f.name!, true)}
                              title={P('危险：需二次确认')}
                            >
                              {P('删除…')}
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!selected.findings?.length ? <p className="empty-state">{P('无 Codex/相关 auth-file 发现项。')}</p> : null}
        </div>
      ) : null}
    </AdminLayout>
  )
}
