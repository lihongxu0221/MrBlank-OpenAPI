import { useEffect, useMemo, useState } from 'react'
import { Boxes, RefreshCw, Save, Search } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { formatQuotaUnitLabel, getQuotaPerUnit, pointsToQuota, quotaToPoints, setQuotaPerUnit } from '../../lib/format'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'
import { navigate } from '../../router/hash'

type Group = {
  id: string
  name: string
  level: number
  description?: string
  model_ids: string[]
  model_quotas?: Record<string, number>
  enabled?: boolean
}

type CatalogModel = {
  id: string
  name?: string
  owned_by?: string
}

export function AdminGroupModelsPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const [groups, setGroups] = useState<Group[]>([])
  const [catalog, setCatalog] = useState<CatalogModel[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  /** UI state: quotas in 点 */
  const [quotaPoints, setQuotaPoints] = useState<Record<string, number>>({})
  const [search, setSearch] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [quotaUnit, setQuotaUnitState] = useState(getQuotaPerUnit())
  const [catalogSource, setCatalogSource] = useState<string>('')

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === selectedId) || null,
    [groups, selectedId],
  )

  function applyGroupToEditor(g: Group | null, unit: number) {
    if (!g) {
      setSelectedIds(new Set())
      setQuotaPoints({})
      return
    }
    setSelectedIds(new Set((g.model_ids || []).map(String)))
    const qp: Record<string, number> = {}
    for (const [mid, raw] of Object.entries(g.model_quotas || {})) {
      qp[mid] = quotaToPoints(Number(raw) || 0, unit)
    }
    setQuotaPoints(qp)
  }

  async function load() {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      const status = await api.get<{ quota_per_unit: number }>('/api/status', { auth: false })
      const unit = Number(status.quota_per_unit) || 500000
      setQuotaPerUnit(unit)
      setQuotaUnitState(unit)

      const [gRes, cat] = await Promise.all([
        api.get<{ groups: Group[]; quota_unit?: number }>('/api/admin/groups'),
        api.get<{
          models: CatalogModel[]
          source?: string
          quota_unit?: number
          error?: string | null
        }>('/api/admin/groups/model-catalog'),
      ])
      const u = Number(gRes.quota_unit || cat.quota_unit || unit) || unit
      setQuotaUnitState(u)
      setQuotaPerUnit(u)
      const list = gRes.groups || []
      setGroups(list)
      setCatalog(cat.models || [])
      setCatalogSource(cat.source || '')
      if (cat.error) setErr(P('部分目录加载失败：') + cat.error)
      const nextId = selectedId && list.some((x) => x.id === selectedId) ? selectedId : list[0]?.id || ''
      setSelectedId(nextId)
      applyGroupToEditor(list.find((x) => x.id === nextId) || null, u)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (gate.allowed) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate.allowed])

  function pickGroup(id: string) {
    setSelectedId(id)
    setMsg(null)
    applyGroupToEditor(groups.find((g) => g.id === id) || null, quotaUnit)
  }

  function toggleModel(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function setModelQuotaPoints(id: string, points: number) {
    setQuotaPoints((prev) => ({ ...prev, [id]: points }))
  }

  function selectAllVisible(ids: string[]) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const id of ids) next.add(id)
      return next
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  async function save() {
    if (!selectedId) return
    setSaving(true)
    setErr(null)
    setMsg(null)
    try {
      const unit = quotaUnit || getQuotaPerUnit()
      const model_ids = [...selectedIds]
      const model_quotas: Record<string, number> = {}
      // Persist quotas for selected models, and any explicit quota rows (when allowlist empty = all-open)
      const quotaKeys = new Set([...model_ids, ...Object.keys(quotaPoints)])
      for (const mid of quotaKeys) {
        if (model_ids.length && !selectedIds.has(mid)) continue
        const pts = Number(quotaPoints[mid])
        if (!Number.isFinite(pts)) continue
        model_quotas[mid] = pointsToQuota(Math.max(0, pts), unit)
      }
      const res = await api.put<{ group: Group }>(`/api/admin/groups/${encodeURIComponent(selectedId)}/models`, {
        model_ids,
        model_quotas,
      })
      const g = res.group
      setGroups((prev) => prev.map((row) => (row.id === g.id ? { ...row, ...g } : row)))
      applyGroupToEditor(g, unit)
      setMsg(
        P('组模型配额已保存。') +
          ` （${model_ids.length ? `${model_ids.length} ${P('个白名单模型')}` : P('未限制白名单（全部）')}；` +
          `${formatQuotaUnitLabel(unit)}）`,
      )
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const filteredCatalog = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return catalog
    return catalog.filter(
      (m) =>
        String(m.id).toLowerCase().includes(q) ||
        String(m.name || '')
          .toLowerCase()
          .includes(q),
    )
  }, [catalog, search])

  // Ensure selected / quota-only models appear even if catalog missed them
  const extraIds = useMemo(() => {
    const known = new Set(catalog.map((m) => m.id))
    const extras: CatalogModel[] = []
    for (const id of selectedIds) {
      if (!known.has(id)) extras.push({ id, name: id, owned_by: 'custom' })
    }
    for (const id of Object.keys(quotaPoints)) {
      if (!known.has(id) && !selectedIds.has(id)) extras.push({ id, name: id, owned_by: 'custom' })
    }
    return extras
  }, [catalog, selectedIds, quotaPoints])

  const rows = useMemo(() => {
    const base = [...extraIds, ...filteredCatalog]
    const seen = new Set<string>()
    return base.filter((m) => {
      if (seen.has(m.id)) return false
      seen.add(m.id)
      return true
    })
  }, [extraIds, filteredCatalog])

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero
        title={P('组模型配额')}
        subtitle={P(
          `为用户组配置模型白名单与按模型滚动 30 日额度（点）。空白名单=全部可用；额度 0=不限。${formatQuotaUnitLabel(quotaUnit)}`,
        )}
      />
      <div className="channels-toolbar">
        <span className="muted">
          {loading
            ? P('加载中…')
            : `${groups.length} ${P('个用户组')} · ${catalog.length} ${P('个模型')}${
                catalogSource ? ` · ${catalogSource}` : ''
              }`}
        </span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="button secondary compact" onClick={load} disabled={loading || saving}>
            <RefreshCw size={14} /> {P('刷新')}
          </button>
          <button
            type="button"
            className="button ghost compact"
            onClick={() => navigate('/admin/groups')}
          >
            {P('返回用户组')}
          </button>
          <button type="button" className="button compact" onClick={save} disabled={saving || !selectedId}>
            <Save size={14} /> {saving ? P('保存中…') : P('保存')}
          </button>
        </div>
      </div>
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}
      {msg ? <p style={{ color: 'var(--accent)' }}>{msg}</p> : null}

      <div
        className="group-models-layout"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(180px, 240px) 1fr',
          gap: 16,
          marginTop: 12,
          alignItems: 'start',
        }}
      >
        <aside className="panel" style={{ padding: 12 }}>
          <h3 style={{ margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <Boxes size={15} /> {P('用户组')}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {groups.map((g) => {
              const active = g.id === selectedId
              const count = (g.model_ids || []).length
              return (
                <button
                  key={g.id}
                  type="button"
                  className={active ? 'button compact' : 'button secondary compact'}
                  style={{ justifyContent: 'flex-start', textAlign: 'left', width: '100%' }}
                  onClick={() => pickGroup(g.id)}
                >
                  <span style={{ display: 'block', width: '100%' }}>
                    <strong>
                      Lv.{g.level} {g.name}
                    </strong>
                    <span className="muted" style={{ display: 'block', fontSize: 11, marginTop: 2 }}>
                      {count ? `${count} ${P('个模型')}` : P('全部模型')}
                    </span>
                  </span>
                </button>
              )
            })}
            {!groups.length ? <p className="muted">{P('暂无用户组')}</p> : null}
          </div>
        </aside>

        <section className="panel" style={{ padding: 14 }}>
          {!selectedGroup ? (
            <p className="muted">{P('请选择左侧用户组')}</p>
          ) : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <strong>
                    {selectedGroup.name}（{selectedGroup.id}）
                  </strong>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {selectedIds.size
                      ? P('已限制白名单：仅勾选模型可用')
                      : P('未限制白名单（全部模型可用）；仍可为单模型设置额度')}
                  </div>
                </div>
                <div style={{ flex: 1 }} />
                <button
                  type="button"
                  className="button ghost compact"
                  onClick={() => selectAllVisible(rows.map((r) => r.id))}
                >
                  {P('全选当前列表')}
                </button>
                <button type="button" className="button ghost compact" onClick={clearSelection}>
                  {P('清空白名单')}
                </button>
              </div>

              <div className="field" style={{ marginBottom: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Search size={14} /> {P('搜索模型')}
                </label>
                <input
                  value={search}
                  placeholder={P('id / 名称')}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th style={{ width: 48 }}>{P('选用')}</th>
                      <th>{P('模型')}</th>
                      <th style={{ width: 160 }}>
                        {P('月额度')}（{P('点')}）
                      </th>
                      <th style={{ width: 140 }}>{P('换算')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((m) => {
                      const checked = selectedIds.has(m.id)
                      const pts = quotaPoints[m.id] ?? 0
                      return (
                        <tr key={m.id}>
                          <td>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleModel(m.id)}
                              aria-label={m.id}
                            />
                          </td>
                          <td>
                            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>{m.id}</div>
                            <div className="muted" style={{ fontSize: 11 }}>
                              {m.name && m.name !== m.id ? m.name + ' · ' : ''}
                              {m.owned_by || '—'}
                            </div>
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.01"
                              min={0}
                              value={pts}
                              title={P('0 = 不限')}
                              onChange={(e) => setModelQuotaPoints(m.id, Number(e.target.value) || 0)}
                              style={{ width: '100%' }}
                            />
                            <div className="field-note">{P('0 = 不限')}</div>
                          </td>
                          <td className="muted" style={{ fontSize: 12 }}>
                            {pts > 0
                              ? `${pointsToQuota(pts, quotaUnit).toLocaleString('zh-CN')} token`
                              : P('不限')}
                          </td>
                        </tr>
                      )
                    })}
                    {!rows.length ? (
                      <tr>
                        <td colSpan={4} className="muted">
                          {P('无匹配模型。请检查 CPA / Aily 目录或刷新。')}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
      <style>{`
        @media (max-width: 860px) {
          .group-models-layout { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </AdminLayout>
  )
}
