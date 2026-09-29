import { useEffect, useState } from 'react'
import { Plus, RefreshCw, Save, Trash2, Users } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { formatQuotaUnitLabel, getQuotaPerUnit, pointsToQuota, quotaToPoints, setQuotaPerUnit } from '../../lib/format'
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

export function AdminGroupsPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const [groups, setGroups] = useState<Group[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [assignUserId, setAssignUserId] = useState('')
  const [assignGroupId, setAssignGroupId] = useState('')
  const [quotaUnit, setQuotaUnitState] = useState(getQuotaPerUnit())

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
      setGroups((g.groups || []).map((row) => fromApiGroup(row, u)))
      setMembers(m.members || [])
      if (!assignGroupId && g.groups?.[0]) setAssignGroupId(g.groups[0].id)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (gate.allowed) load()
  }, [gate.allowed])

  function updateGroup(index: number, patch: Partial<Group>) {
    setGroups((prev) => prev.map((g, i) => (i === index ? { ...g, ...patch } : g)))
  }

  function updateQuota(index: number, key: keyof Group['quotas'], value: number) {
    setGroups((prev) =>
      prev.map((g, i) => (i === index ? { ...g, quotas: { ...g.quotas, [key]: value } } : g)),
    )
  }

  function updatePromo(index: number, key: keyof Promotion, value: number | string) {
    setGroups((prev) =>
      prev.map((g, i) =>
        i === index ? { ...g, promotion: { ...g.promotion, [key]: value } } : g,
      ),
    )
  }

  async function save() {
    setSaving(true)
    setErr(null)
    setMsg(null)
    try {
      const unit = quotaUnit || getQuotaPerUnit()
      const payload = groups.map((g) => toApiGroup(g, unit))
      const saved = await api.put<{ groups: Group[] }>('/api/admin/groups', { groups: payload })
      setGroups((saved.groups || []).map((row) => fromApiGroup(row, unit)))
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
          <button
            type="button"
            className="button secondary compact"
            onClick={() => setGroups((prev) => [...prev, blankGroup((prev.at(-1)?.level || 0) + 1)])}
          >
            <Plus size={14} /> {P('添加')}
          </button>
          <button type="button" className="button compact" onClick={save} disabled={saving}>
            <Save size={14} /> {saving ? P('保存中…') : P('保存用户组')}
          </button>
        </div>
      </div>
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}
      {msg ? <p style={{ color: 'var(--accent)' }}>{msg}</p> : null}

      <div className="model-catalog" style={{ marginTop: 8 }}>
        {groups.map((g, index) => (
          <article key={g.id} className="catalog-card" style={{ textAlign: 'left' }}>
            <div className="catalog-phase">Lv.{g.level}</div>
            <div className="field">
              <label>ID</label>
              <input value={g.id} onChange={(e) => updateGroup(index, { id: e.target.value })} />
            </div>
            <div className="field">
              <label>{P('名称')}</label>
              <input value={g.name} onChange={(e) => updateGroup(index, { name: e.target.value })} />
            </div>
            <div className="field">
              <label>{P('说明')}</label>
              <textarea
                rows={2}
                value={g.description}
                onChange={(e) => updateGroup(index, { description: e.target.value })}
              />
            </div>
            <div className="field">
              <label>{P('等级 level')}</label>
              <input
                type="number"
                value={g.level}
                onChange={(e) => updateGroup(index, { level: Number(e.target.value) || 0 })}
              />
            </div>
            <div className="field">
              <label>
                {P('5 小时额度')}（{P('点')}）
              </label>
              <input
                type="number"
                step="0.01"
                value={g.quotas.window_5h}
                onChange={(e) => updateQuota(index, 'window_5h', Number(e.target.value) || 0)}
              />
              <div className="field-note">
                = {pointsToQuota(g.quotas.window_5h, quotaUnit).toLocaleString('zh-CN')} token
              </div>
            </div>
            <div className="field">
              <label>
                {P('周额度')}（{P('点')}）
              </label>
              <input
                type="number"
                step="0.01"
                value={g.quotas.week}
                onChange={(e) => updateQuota(index, 'week', Number(e.target.value) || 0)}
              />
              <div className="field-note">
                = {pointsToQuota(g.quotas.week, quotaUnit).toLocaleString('zh-CN')} token
              </div>
            </div>
            <div className="field">
              <label>
                {P('月额度')}（{P('点')}）
              </label>
              <input
                type="number"
                step="0.01"
                value={g.quotas.month}
                onChange={(e) => updateQuota(index, 'month', Number(e.target.value) || 0)}
              />
              <div className="field-note">
                = {pointsToQuota(g.quotas.month, quotaUnit).toLocaleString('zh-CN')} token
              </div>
            </div>
            <div className="field">
              <label>{P('模型白名单 / 按模型额度')}</label>
              <div className="field-note">
                {(g.model_ids || []).length
                  ? `${(g.model_ids || []).length} ${P('个模型')}：${(g.model_ids || []).slice(0, 4).join(', ')}${(g.model_ids || []).length > 4 ? '…' : ''}`
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
            <h4 style={{ margin: '8px 0 6px' }}>{P('晋级条件（达到即可升至本组）')}</h4>
            <div className="field">
              <label>{P('注册天数 ≥')}</label>
              <input
                type="number"
                value={g.promotion.min_account_days}
                onChange={(e) => updatePromo(index, 'min_account_days', Number(e.target.value) || 0)}
              />
            </div>
            <div className="field">
              <label>{P('请求次数 ≥')}</label>
              <input
                type="number"
                value={g.promotion.min_request_count}
                onChange={(e) => updatePromo(index, 'min_request_count', Number(e.target.value) || 0)}
              />
            </div>
            <div className="field">
              <label>
                {P('累计用量额度 ≥')}（{P('点')}）
              </label>
              <input
                type="number"
                step="0.01"
                value={g.promotion.min_used_quota}
                onChange={(e) => updatePromo(index, 'min_used_quota', Number(e.target.value) || 0)}
              />
              <div className="field-note">
                = {pointsToQuota(g.promotion.min_used_quota, quotaUnit).toLocaleString('zh-CN')}{' '}
                token
              </div>
            </div>
            <div className="field">
              <label>{P('签到次数 ≥')}</label>
              <input
                type="number"
                value={g.promotion.min_checkins}
                onChange={(e) => updatePromo(index, 'min_checkins', Number(e.target.value) || 0)}
              />
            </div>
            <div className="field">
              <label>{P('备注 / 预留信任规则说明')}</label>
              <textarea
                rows={2}
                value={g.promotion.notes || ''}
                placeholder={P('例如：未来可接 Linux.do trust / 点赞数（尚未强制）')}
                onChange={(e) => updatePromo(index, 'notes', e.target.value)}
              />
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={g.enabled}
                onChange={(e) => updateGroup(index, { enabled: e.target.checked })}
              />
              {P('启用')}
            </label>
            <button
              type="button"
              className="button ghost compact"
              onClick={() => setGroups((prev) => prev.filter((_, i) => i !== index))}
            >
              <Trash2 size={14} /> {P('删除')}
            </button>
          </article>
        ))}
      </div>

      <section className="panel" style={{ marginTop: 20 }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 0 }}>
          <Users size={16} /> {P('成员覆盖分配')}
        </h3>
        <p className="page-lead">
          {P('覆盖分配会固定用户组（不再自动晋级）。可填本站用户名、local:… id，或 Linux.do 数字 id；同一用户只保留一行（用户名为别名时会合并到正式 id）。')}
        </p>
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
        <button type="button" className="button secondary" onClick={assign} disabled={saving}>
          {P('覆盖分配')}
        </button>

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
