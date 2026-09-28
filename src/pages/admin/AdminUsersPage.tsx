import { useEffect, useState, type FormEvent } from 'react'
import { Pencil, Plus, RefreshCw, KeyRound, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { Modal } from '../../components/Modal'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'

type LocalUser = {
  id: string
  username: string
  display_name: string
  role: 'admin' | 'user' | string
  group_id?: string | null
  disabled?: boolean
  created_at?: string
  updated_at?: string
}

type CreateForm = {
  username: string
  password: string
  display_name: string
  role: string
  group_id: string
}

type EditForm = {
  display_name: string
  role: string
  group_id: string
  disabled: boolean
}

const emptyCreate: CreateForm = {
  username: '',
  password: '',
  display_name: '',
  role: 'user',
  group_id: '',
}

export function AdminUsersPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const [users, setUsers] = useState<LocalUser[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [allowHint, setAllowHint] = useState<any>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<CreateForm>(emptyCreate)

  const [editUser, setEditUser] = useState<LocalUser | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({
    display_name: '',
    role: 'user',
    group_id: '',
    disabled: false,
  })

  const [resetUser, setResetUser] = useState<LocalUser | null>(null)
  const [resetPassword, setResetPassword] = useState('')

  async function load() {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      const [data, me] = await Promise.all([
        api.get<{ users: LocalUser[] }>('/api/admin/users'),
        api.get<any>('/api/admin/me').catch(() => null),
      ])
      setUsers(data.users || [])
      setAllowHint(me?.allowlist_hint || null)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (gate.allowed) load()
  }, [gate.allowed])

  function openCreate() {
    setCreateForm(emptyCreate)
    setErr(null)
    setCreateOpen(true)
  }

  function openEdit(u: LocalUser) {
    setEditUser(u)
    setEditForm({
      display_name: u.display_name || '',
      role: u.role || 'user',
      group_id: u.group_id || '',
      disabled: !!u.disabled,
    })
    setErr(null)
  }

  function openReset(u: LocalUser) {
    setResetUser(u)
    setResetPassword('')
    setErr(null)
  }

  async function createUser(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    setErr(null)
    setSaving(true)
    try {
      await api.post('/api/admin/users', {
        username: createForm.username.trim(),
        password: createForm.password,
        display_name: createForm.display_name.trim() || createForm.username.trim(),
        role: createForm.role,
        group_id: createForm.group_id.trim() || null,
      })
      setCreateOpen(false)
      setCreateForm(emptyCreate)
      setMsg(P('用户已创建'))
      await load()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault()
    if (!editUser) return
    setMsg(null)
    setErr(null)
    setSaving(true)
    try {
      await api.put(`/api/admin/users/${encodeURIComponent(editUser.id)}`, {
        display_name: editForm.display_name.trim() || editUser.username,
        role: editForm.role,
        group_id: editForm.group_id.trim() || null,
        disabled: editForm.disabled,
      })
      setEditUser(null)
      setMsg(P('用户已更新'))
      await load()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function doResetPassword(e: FormEvent) {
    e.preventDefault()
    if (!resetUser) return
    setMsg(null)
    setErr(null)
    setSaving(true)
    try {
      await api.post(`/api/admin/users/${encodeURIComponent(resetUser.id)}/password`, {
        password: resetPassword,
      })
      setResetUser(null)
      setResetPassword('')
      setMsg(P('密码已重置'))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function removeUser(u: LocalUser) {
    if (!confirm(P(`确认删除用户 ${u.username}？`))) return
    setErr(null)
    setMsg(null)
    try {
      await api.delete(`/api/admin/users/${encodeURIComponent(u.id)}`)
      setMsg(P('用户已删除'))
      await load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const modalErr = err && (createOpen || editUser || resetUser) ? err : null
  const pageErr = err && !createOpen && !editUser && !resetUser ? err : null

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero
        title={P('本站账号')}
        subtitle={P('创建本地用户名密码账号、设置角色与重置密码。Linux.do 用户不在此列表。')}
      />

      <details className="panel" style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{P('多管理员白名单')}</summary>
        <p className="page-lead" style={{ marginBottom: 6, marginTop: 8 }}>
          {allowHint?.note ||
            P('本站用户可将角色设为 admin；Linux.do 管理员请在服务端 .env 配置 ADMIN_LINUXDO_IDS / USERNAMES / EMAILS（逗号分隔）。')}
        </p>
        {allowHint?.counts ? (
          <div className="tag-row">
            <span className="pill">IDs {allowHint.counts.linuxdo_ids}</span>
            <span className="pill">Usernames {allowHint.counts.linuxdo_usernames}</span>
            <span className="pill">Emails {allowHint.counts.linuxdo_emails}</span>
            <span className="pill">Local {allowHint.counts.local_usernames}</span>
          </div>
        ) : null}
        <p className="field-note">{P('白名单仅服务端可读；此处只显示数量提示，不展示具体名单。')}</p>
      </details>

      <div className="panel" style={{ marginTop: 16 }}>
        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            marginBottom: 12,
          }}
        >
          <strong>{P('账号列表')}</strong>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="button ghost" onClick={load} disabled={loading}>
              <RefreshCw size={14} /> {P('刷新')}
            </button>
            <button type="button" className="button" onClick={openCreate}>
              <Plus size={14} /> {P('新建账号')}
            </button>
          </div>
        </div>

        {msg ? <p style={{ color: 'var(--success, #3d9)', marginBottom: 10 }}>{msg}</p> : null}
        {pageErr ? <p style={{ color: 'var(--error)', marginBottom: 10 }}>{pageErr}</p> : null}

        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{P('账号')}</th>
                <th>{P('显示名')}</th>
                <th>{P('角色')}</th>
                <th>{P('状态')}</th>
                <th>{P('组')}</th>
                <th>{P('操作')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <code>{u.username}</code>
                  </td>
                  <td>{u.display_name || '—'}</td>
                  <td>{u.role === 'admin' ? P('管理员') : P('普通用户')}</td>
                  <td>{u.disabled ? P('停用') : P('正常')}</td>
                  <td>
                    <code>{u.group_id || '—'}</code>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button type="button" className="button ghost compact" onClick={() => openEdit(u)}>
                        <Pencil size={14} /> {P('编辑')}
                      </button>
                      <button type="button" className="button ghost compact" onClick={() => openReset(u)}>
                        <KeyRound size={14} /> {P('重置密码')}
                      </button>
                      <button type="button" className="button ghost compact" onClick={() => removeUser(u)}>
                        <Trash2 size={14} /> {P('删除')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!users.length && !loading ? (
                <tr>
                  <td colSpan={6}>{P('暂无本地用户。可用 BOOTSTRAP_ADMIN_* 或在此创建。')}</td>
                </tr>
              ) : null}
              {loading && !users.length ? (
                <tr>
                  <td colSpan={6}>{P('加载中…')}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {createOpen ? (
        <Modal title={P('新建账号')} onClose={() => setCreateOpen(false)}>
          <form className="guest-aily-form" onSubmit={createUser}>
            <div className="field">
              <label>{P('账号')}</label>
              <input
                value={createForm.username}
                onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
                required
                minLength={2}
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label>{P('密码')}</label>
              <input
                type="password"
                value={createForm.password}
                onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>
            <div className="field">
              <label>{P('显示名')}</label>
              <input
                value={createForm.display_name}
                onChange={(e) => setCreateForm({ ...createForm, display_name: e.target.value })}
                placeholder={P('可选，默认与账号相同')}
              />
            </div>
            <div className="field">
              <label>{P('角色')}</label>
              <select
                value={createForm.role}
                onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}
              >
                <option value="user">{P('普通用户')}</option>
                <option value="admin">{P('管理员')}</option>
              </select>
            </div>
            <div className="field">
              <label>{P('用户组 ID（可选）')}</label>
              <input
                value={createForm.group_id}
                onChange={(e) => setCreateForm({ ...createForm, group_id: e.target.value })}
                placeholder="g-..."
              />
            </div>
            {modalErr ? <p style={{ color: 'var(--error)' }}>{modalErr}</p> : null}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="submit" className="button" disabled={saving}>
                <Plus size={14} /> {P('创建')}
              </button>
              <button type="button" className="button ghost" onClick={() => setCreateOpen(false)}>
                {P('取消')}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {editUser ? (
        <Modal title={P('编辑账号')} onClose={() => setEditUser(null)}>
          <form className="guest-aily-form" onSubmit={saveEdit}>
            <div className="field">
              <label>{P('账号')}</label>
              <input value={editUser.username} readOnly disabled />
            </div>
            <div className="field">
              <label>{P('显示名')}</label>
              <input
                value={editForm.display_name}
                onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })}
              />
            </div>
            <div className="field">
              <label>{P('角色')}</label>
              <select
                value={editForm.role}
                onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
              >
                <option value="user">{P('普通用户')}</option>
                <option value="admin">{P('管理员')}</option>
              </select>
            </div>
            <div className="field">
              <label>{P('用户组 ID（可选）')}</label>
              <input
                value={editForm.group_id}
                onChange={(e) => setEditForm({ ...editForm, group_id: e.target.value })}
                placeholder="g-..."
              />
            </div>
            <div className="field">
              <label>{P('状态')}</label>
              <select
                value={editForm.disabled ? 'disabled' : 'active'}
                onChange={(e) =>
                  setEditForm({ ...editForm, disabled: e.target.value === 'disabled' })
                }
              >
                <option value="active">{P('正常')}</option>
                <option value="disabled">{P('停用')}</option>
              </select>
            </div>
            {modalErr ? <p style={{ color: 'var(--error)' }}>{modalErr}</p> : null}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="submit" className="button" disabled={saving}>
                {P('保存')}
              </button>
              <button type="button" className="button ghost" onClick={() => setEditUser(null)}>
                {P('取消')}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {resetUser ? (
        <Modal title={P('重置密码')} onClose={() => setResetUser(null)}>
          <form className="guest-aily-form" onSubmit={doResetPassword}>
            <p className="appearance-intro" style={{ marginBottom: 8 }}>
              {P('为账号')} <strong>{resetUser.username}</strong> {P('设置新密码')}
            </p>
            <div className="field">
              <label>{P('新密码')}</label>
              <input
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>
            {modalErr ? <p style={{ color: 'var(--error)' }}>{modalErr}</p> : null}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="submit" className="button" disabled={saving}>
                <KeyRound size={14} /> {P('确认重置')}
              </button>
              <button type="button" className="button ghost" onClick={() => setResetUser(null)}>
                {P('取消')}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </AdminLayout>
  )
}
