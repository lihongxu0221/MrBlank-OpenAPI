import { useEffect, useState } from 'react'
import { Plus, RefreshCw, Save, Trash2, Users } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { formatCredits } from '../../lib/format'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'

type Promotion = {
  min_account_days: number
  min_request_count: number
  min_used_quota: number
  min_checkins: number
  notes?: string
}

type Group = {
  id: string
  name: string
  level: number
  description: string
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

  async function load() {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      const [g, m] = await Promise.all([
        api.get<{ groups: Group[] }>('/api/admin/groups'),
        api.get<{ members: Member[]; groups: Group[] }>('/api/admin/groups/members'),
      ])
      setGroups(g.groups || [])
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
      prev.map((g, i) =>
        i === index ? { ...g, quotas: { ...g.quotas, [key]: value } } : g,
      ),
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
      const saved = await api.put<{ groups: Group[] }>('/api/admin/groups', { groups })
      setGroups(saved.groups || [])
      setMsg(P('用户组已保存。'))
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
        subtitle={P('类 Linux.do 信任等级：额度窗口、模型白名单与晋级条件。1 点 = 500000 内部单位；BFF /v1 强制滚动额度与模型白名单。')}
      />
      <div className="channels-toolbar">
        <span className="muted">{loading ? P('加载中…') : `${groups.length} ${P('个用户组')}`}</span>
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
              <label>{P('5 小时额度')}</label>
              <input
                type="number"
                value={g.quotas.window_5h}
                onChange={(e) => updateQuota(index, 'window_5h', Number(e.target.value) || 0)}
              />
              <div className="field-note">{formatCredits(g.quotas.window_5h)}</div>
            </div>
            <div className="field">
              <label>{P('周额度')}</label>
              <input
                type="number"
                value={g.quotas.week}
                onChange={(e) => updateQuota(index, 'week', Number(e.target.value) || 0)}
              />
              <div className="field-note">{formatCredits(g.quotas.week)}</div>
            </div>
            <div className="field">
              <label>{P('月额度')}</label>
              <input
                type="number"
                value={g.quotas.month}
                onChange={(e) => updateQuota(index, 'month', Number(e.target.value) || 0)}
              />
              <div className="field-note">{formatCredits(g.quotas.month)}</div>
            </div>
            <div className="field">
              <label>{P('模型白名单（空=全部；逗号分隔 model id）')}</label>
              <input
                value={g.model_ids.join(', ')}
                onChange={(e) =>
                  updateGroup(index, {
                    model_ids: e.target.value
                      .split(/[,，\s]+/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
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
              <label>{P('累计用量额度 ≥')}</label>
              <input
                type="number"
                value={g.promotion.min_used_quota}
                onChange={(e) => updatePromo(index, 'min_used_quota', Number(e.target.value) || 0)}
              />
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
          {P('覆盖分配会固定用户组（不再自动晋级）。用户 ID 为 Linux.do 数字 id 或本站 local:… 形式。')}
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
