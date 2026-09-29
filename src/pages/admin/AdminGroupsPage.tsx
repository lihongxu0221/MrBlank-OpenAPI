import { useEffect, useMemo, useState } from 'react'
import { Boxes, Plus, RefreshCw, Save, Trash2, Users } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { formatQuotaCompact, formatQuotaUnitLabel, getQuotaPerUnit, pointsToQuota, quotaToPoints, setQuotaPerUnit } from '../../lib/format'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { navigate } from '../../router/hash'
import { useAdminGate } from './useAdminGate'

type Promotion = {
  min_account_days: number
  min_request_count: number
  min_used_quota: number // stored as 点 in UI state; converted to raw on save
  min_checkins: number
  notes?: string
}

type Group = {
  id: string
  name: string
  level: number
  description: string
  /** UI state: quotas in 点 (display). Converted to raw on save. */
  quotas: { window_5h: number; week: number; month: number }
  model_ids: string[]
  promotion: Promotion
  enabled: boolean
  sort_order: number
}

type Member = {
  user_id: string
  group_id: string
  override: boolean
  joined_at?: string
  display_name?: string
  username?: string
  email?: string
}

function blankGroup(level: number): Group {
  return {
    id: `g-${Date.now().toString(36)}`,
    name: P('新用户组'),
    level,
    description: '',
    quotas: { window_5h: 0, week: 0, month: 0 },
    model_ids: [],
    promotion: {
      min_account_days: 0,
      min_request_count: 0,
      min_used_quota: 0,
      min_checkins: 0,
      notes: '',
    },
    enabled: true,
    sort_order: level * 10,
  }
}

/** API raw → UI 点 */
function fromApiGroup(g: Group, unit: number): Group {
  return {
    ...g,
    quotas: {
      window_5h: quotaToPoints(g.quotas?.window_5h || 0, unit),
      week: quotaToPoints(g.quotas?.week || 0, unit),
      month: quotaToPoints(g.quotas?.month || 0, unit),
    },
    promotion: {
      ...g.promotion,
      min_used_quota: quotaToPoints(g.promotion?.min_used_quota || 0, unit),
    },
  }
}

/** UI 点 → API raw */
function toApiGroup(g: Group, unit: number): Group {
  return {
    ...g,
    quotas: {
      window_5h: pointsToQuota(g.quotas.window_5h, unit),
      week: pointsToQuota(g.quotas.week, unit),
      month: pointsToQuota(g.quotas.month, unit),
    },
    promotion: {
      ...g.promotion,
      min_used_quota: pointsToQuota(g.promotion.min_used_quota, unit),
    },
  }
}

/** Points (UI) → compact token hint under rolling window quotas.
 * Window 0 = exhausted / no allotment (NOT unlimited). model_quotas keep 0=不限. */
function quotaPointsHint(points: number, unit: number): string {
  const pts = Number(points) || 0
  if (pts <= 0) return `${P('0 = 无额度')} · ≈ ${P('无额度')}`
  const raw = pointsToQuota(pts, unit)
  return `${P('0 = 无额度')} · ≈ ${formatQuotaCompact(raw)} token`
}

export function AdminGroupsPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const [groups, setGroups] = useState<Group[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [assignUserId, setAssignUserId] = useState('')
  const [assignGroupId, setAssignGroupId] = useState('')
  const [quotaUnit, setQuotaUnitState] = useState(getQuotaPerUnit())

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === selectedId) || null,
    [groups, selectedId],
  )
  const selectedIndex = useMemo(
    () => groups.findIndex((g) => g.id === selectedId),
    [groups, selectedId],
  )

  async function load() {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      const status = await api.get<{ quota_per_unit: number }>('/api/status', { auth: false })
      const unit = Number(status.quota_per_unit) || 500000
      setQuotaPerUnit(unit)
      setQuotaUnitState(unit)

      const [g, m] = await Promise.all([
        api.get<{ groups: Group[]; quota_unit?: number; credit_unit?: { raw_per_point?: number } }>(
          '/api/admin/groups',
        ),
        api.get<{ members: Member[]; groups: Group[] }>('/api/admin/groups/members'),
      ])
      const u = Number(g.quota_unit || g.credit_unit?.raw_per_point || unit) || unit
      setQuotaUnitState(u)
      setQuotaPerUnit(u)
      const list = (g.groups || []).map((row) => fromApiGroup(row, u))
      setGroups(list)
      setMembers(m.members || [])
      const nextId = selectedId && list.some((x) => x.id === selectedId) ? selectedId : list[0]?.id || ''
      setSelectedId(nextId)
      if (!assignGroupId && list[0]) setAssignGroupId(list[0].id)
      else if (assignGroupId && !list.some((x) => x.id === assignGroupId) && list[0]) {
        setAssignGroupId(list[0].id)
      }
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
  }

  function updateSelected(patch: Partial<Group>) {
    if (selectedIndex < 0) return
    setGroups((prev) => prev.map((g, i) => (i === selectedIndex ? { ...g, ...patch } : g)))
  }

  function updateQuota(key: keyof Group['quotas'], value: number) {
    if (selectedIndex < 0) return
    setGroups((prev) =>
      prev.map((g, i) =>
        i === selectedIndex ? { ...g, quotas: { ...g.quotas, [key]: value } } : g,
      ),
    )
  }

  function updatePromo(key: keyof Promotion, value: number | string) {
    if (selectedIndex < 0) return
    setGroups((prev) =>
      prev.map((g, i) =>
        i === selectedIndex ? { ...g, promotion: { ...g.promotion, [key]: value } } : g,
      ),
    )
  }

  function addGroup() {
    const next = blankGroup((groups.at(-1)?.level || 0) + 1)
    setGroups((prev) => [...prev, next])
    setSelectedId(next.id)
    setMsg(null)
  }

  function removeSelected() {
    if (selectedIndex < 0) return
    setGroups((prev) => {
      const next = prev.filter((_, i) => i !== selectedIndex)
      const fallback = next[Math.min(selectedIndex, next.length - 1)]?.id || next[0]?.id || ''
      setSelectedId(fallback)
      return next
    })
    setMsg(null)
  }

  async function save() {
    setSaving(true)
    setErr(null)
    setMsg(null)
    try {
      const unit = quotaUnit || getQuotaPerUnit()
      const payload = groups.map((g) => toApiGroup(g, unit))
      const saved = await api.put<{ groups: Group[] }>('/api/admin/groups', { groups: payload })
      const list = (saved.groups || []).map((row) => fromApiGroup(row, unit))
      setGroups(list)
      const nextId = selectedId && list.some((x) => x.id === selectedId) ? selectedId : list[0]?.id || ''
      setSelectedId(nextId)
      setMsg(
        P('用户组已保存。') +
          ` （${P('已按')} 1 ${P('点')}=${unit.toLocaleString('en-US')} token ${P('换算入库')}）`,
      )
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function assign() {
    if (!assignUserId.trim() || !assignGroupId) return
    setSaving(true)
    setErr(null)
    setMsg(null)
    try {
      await api.put(`/api/admin/groups/members/${encodeURIComponent(assignUserId.trim())}`, {
        group_id: assignGroupId,
        override: true,
      })
      setMsg(P('已覆盖分配用户组。'))
      await load()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero
        title={P('用户组')}
        subtitle={P(
          `类 Linux.do 信任等级：5h/周/月额度以「点」编辑。${formatQuotaUnitLabel(quotaUnit)}`,
        )}
      />
      <div className="channels-toolbar">
        <span className="muted">
          {loading ? P('加载中…') : `${groups.length} ${P('个用户组')}`} · {formatQuotaUnitLabel(quotaUnit)}
        </span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="button secondary compact" onClick={load} disabled={loading || saving}>
            <RefreshCw size={14} /> {P('刷新')}
          </button>
          <button type="button" className="button secondary compact" onClick={addGroup} disabled={saving}>
            <Plus size={14} /> {P('添加')}
          </button>
          <button
            type="button"
            className="button ghost compact"
            onClick={() => navigate('/admin/group-models')}
          >
            {P('组模型配额')}
          </button>
          <button type="button" className="button compact" onClick={save} disabled={saving || !groups.length}>
            <Save size={14} /> {saving ? P('保存中…') : P('保存用户组')}
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
                      {g.enabled ? P('启用') : P('停用')}
                      {' · '}
                      5h {g.quotas.window_5h || 0} {P('点')}
                      {Number(g.quotas.window_5h) > 0
                        ? ` ≈ ${formatQuotaCompact(pointsToQuota(g.quotas.window_5h, quotaUnit))} token`
                        : ''}
                    </span>
                  </span>
                </button>
              )
            })}
            {!groups.length ? <p className="muted">{P('暂无用户组')}</p> : null}
          </div>
        </aside>

        <section className="panel" style={{ padding: 14 }}>
          {!selectedGroup || selectedIndex < 0 ? (
            <p className="muted">{P('请选择左侧用户组')}</p>
          ) : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <strong>
                    {selectedGroup.name}（{selectedGroup.id}）
                  </strong>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    Lv.{selectedGroup.level}
                    {selectedGroup.description ? ` · ${selectedGroup.description}` : ''}
                  </div>
                </div>
                <div style={{ flex: 1 }} />
                <button type="button" className="button ghost compact" onClick={removeSelected} disabled={saving}>
                  <Trash2 size={14} /> {P('删除')}
                </button>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: 12,
                }}
              >
                <div className="field">
                  <label>ID</label>
                  <input
                    value={selectedGroup.id}
                    onChange={(e) => {
                      const nextId = e.target.value
                      updateSelected({ id: nextId })
                      setSelectedId(nextId)
                    }}
                  />
                </div>
                <div className="field">
                  <label>{P('名称')}</label>
                  <input
                    value={selectedGroup.name}
                    onChange={(e) => updateSelected({ name: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>{P('等级 level')}</label>
                  <input
                    type="number"
                    value={selectedGroup.level}
                    onChange={(e) => updateSelected({ level: Number(e.target.value) || 0 })}
                  />
                </div>
                <div className="field" style={{ gridColumn: '1 / -1' }}>
                  <label>{P('说明')}</label>
                  <textarea
                    rows={2}
                    value={selectedGroup.description}
                    onChange={(e) => updateSelected({ description: e.target.value })}
                  />
                </div>
              </div>

              <h4 style={{ margin: '14px 0 8px', fontSize: 13 }}>{P('滚动额度')}（{P('点')}）</h4>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 12,
                }}
              >
                <div className="field">
                  <label>
                    {P('5 小时额度')}（{P('点')}）
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={selectedGroup.quotas.window_5h}
                    onChange={(e) => updateQuota('window_5h', Number(e.target.value) || 0)}
                  />
                  <div className="field-note">
                    {quotaPointsHint(selectedGroup.quotas.window_5h, quotaUnit)}
                  </div>
                </div>
                <div className="field">
                  <label>
                    {P('周额度')}（{P('点')}）
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={selectedGroup.quotas.week}
                    onChange={(e) => updateQuota('week', Number(e.target.value) || 0)}
                  />
                  <div className="field-note">
                    {quotaPointsHint(selectedGroup.quotas.week, quotaUnit)}
                  </div>
                </div>
                <div className="field">
                  <label>
                    {P('月额度')}（{P('点')}）
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={selectedGroup.quotas.month}
                    onChange={(e) => updateQuota('month', Number(e.target.value) || 0)}
                  />
                  <div className="field-note">
                    {quotaPointsHint(selectedGroup.quotas.month, quotaUnit)}
                  </div>
                </div>
              </div>

              <div className="field" style={{ marginTop: 8 }}>
                <label>{P('模型白名单 / 按模型额度')}</label>
                <div className="field-note">
                  {(selectedGroup.model_ids || []).length
                    ? `${(selectedGroup.model_ids || []).length} ${P('个模型')}：${(selectedGroup.model_ids || []).slice(0, 4).join(', ')}${(selectedGroup.model_ids || []).length > 4 ? '…' : ''}`
                    : P('未限制白名单（全部）')}
                  {' · '}
                  <a
                    href="#/admin/group-models"
                    onClick={(e) => {
                      e.preventDefault()
                      navigate('/admin/group-models')
                    }}
                  >
                    {P('在「组模型配额」中编辑')}
                  </a>
                </div>
              </div>

              <h4 style={{ margin: '14px 0 8px', fontSize: 13 }}>{P('晋级条件（达到即可升至本组）')}</h4>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 12,
                }}
              >
                <div className="field">
                  <label>{P('注册天数 ≥')}</label>
                  <input
                    type="number"
                    value={selectedGroup.promotion.min_account_days}
                    onChange={(e) => updatePromo('min_account_days', Number(e.target.value) || 0)}
                  />
                </div>
                <div className="field">
                  <label>{P('请求次数 ≥')}</label>
                  <input
                    type="number"
                    value={selectedGroup.promotion.min_request_count}
                    onChange={(e) => updatePromo('min_request_count', Number(e.target.value) || 0)}
                  />
                </div>
                <div className="field">
                  <label>
                    {P('累计用量额度 ≥')}（{P('点')}）
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={selectedGroup.promotion.min_used_quota}
                    onChange={(e) => updatePromo('min_used_quota', Number(e.target.value) || 0)}
                  />
                  <div className="field-note">
                    = {pointsToQuota(selectedGroup.promotion.min_used_quota, quotaUnit).toLocaleString('zh-CN')}{' '}
                    token
                  </div>
                </div>
                <div className="field">
                  <label>{P('签到次数 ≥')}</label>
                  <input
                    type="number"
                    value={selectedGroup.promotion.min_checkins}
                    onChange={(e) => updatePromo('min_checkins', Number(e.target.value) || 0)}
                  />
                </div>
                <div className="field" style={{ gridColumn: '1 / -1' }}>
                  <label>{P('备注 / 预留信任规则说明')}</label>
                  <textarea
                    rows={2}
                    value={selectedGroup.promotion.notes || ''}
                    placeholder={P('例如：未来可接 Linux.do trust / 点赞数（尚未强制）')}
                    onChange={(e) => updatePromo('notes', e.target.value)}
                  />
                </div>
              </div>

              <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={selectedGroup.enabled}
                  onChange={(e) => updateSelected({ enabled: e.target.checked })}
                />
                {P('启用')}
              </label>
            </>
          )}
        </section>
      </div>
      <style>{`
        @media (max-width: 860px) {
          .group-models-layout { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <section className="panel" style={{ marginTop: 20 }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 0 }}>
          <Users size={16} /> {P('成员覆盖分配')}
        </h3>
        <p className="page-lead">
          {P('覆盖分配会固定用户组（不再自动晋级）。可填本站用户名、local:… id，或 Linux.do 数字 id；同一用户只保留一行（用户名为别名时会合并到正式 id）。')}
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12,
            alignItems: 'end',
          }}
        >
          <div className="field">
            <label>{P('用户 ID')}</label>
            <input value={assignUserId} onChange={(e) => setAssignUserId(e.target.value)} />
          </div>
          <div className="field">
            <label>{P('用户组')}</label>
            <select value={assignGroupId} onChange={(e) => setAssignGroupId(e.target.value)}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} (Lv.{g.level})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <button type="button" className="button secondary" onClick={assign} disabled={saving}>
              {P('覆盖分配')}
            </button>
          </div>
        </div>

        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table className="data">
            <thead>
              <tr>
                <th>{P('用户')}</th>
                <th>{P('用户组')}</th>
                <th>{P('覆盖')}</th>
                <th>{P('加入')}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.user_id}>
                  <td>
                    <div>{m.display_name || m.username || m.user_id}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {m.user_id}
                    </div>
                  </td>
                  <td>{m.group_id}</td>
                  <td>{m.override ? P('是') : P('否')}</td>
                  <td>
                    {m.joined_at
                      ? new Date(m.joined_at).toLocaleString('zh-CN', {
                          timeZone: 'Asia/Shanghai',
                          hour12: false,
                        })
                      : '—'}
                  </td>
                </tr>
              ))}
              {!members.length ? (
                <tr>
                  <td colSpan={4} className="muted">
                    {P('暂无成员记录（用户登录后会出现）。')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </AdminLayout>
  )
}
