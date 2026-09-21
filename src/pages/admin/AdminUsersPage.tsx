import { useEffect, useState, type FormEvent } from 'react'
import { Plus, RefreshCw, KeyRound, Trash2, UserPlus } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
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

export function AdminUsersPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const [users, setUsers] = useState<LocalUser[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    username: '',
    password: '',
    display_name: '',
    role: 'user',
    group_id: '',
  })
  const [resetId, setResetId] = useState<string | null>(null)
  const [resetPassword, setResetPassword] = useState('')

  async function load() {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      const data = await api.get<{ users: LocalUser[] }>('/api/admin/users')
      setUsers(data.users || [])
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (gate.allowed) load()
  }, [gate.allowed])

  async function createUser(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    setErr(null)
    try {
      await api.post('/api/admin/users', {
        username: form.username.trim(),
        password: form.password,
        display_name: form.display_name.trim() || form.username.trim(),
        role: form.role,
        group_id: form.group_id.trim() || null,
      })
      setForm({ username: '', password: '', display_name: '', role: 'user', group_id: '' })
      setMsg(P('用户已创建'))
      await load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function toggleRole(u: LocalUser) {
    setErr(null)
    try {
      await api.put(`/api/admin/users/${encodeURIComponent(u.id)}`, {
        role: u.role === 'admin' ? 'user' : 'admin',
      })
      await load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function toggleDisabled(u: LocalUser) {
    setErr(null)
    try {
      await api.put(`/api/admin/users/${encodeURIComponent(u.id)}`, {
        disabled: !u.disabled,
      })
      await load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function doResetPassword(e: FormEvent) {
    e.preventDefault()
    if (!resetId) return
    setErr(null)
    try {
      await api.post(`/api/admin/users/${encodeURIComponent(resetId)}/password`, {
        password: resetPassword,
      })
      setResetId(null)
      setResetPassword('')
      setMsg(P('密码已重置'))
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function removeUser(u: LocalUser) {
    if (!confirm(P(`确认删除用户 ${u.username}？`))) return
    setErr(null)
    try {
      await api.delete(`/api/admin/users/${encodeURIComponent(u.id)}`)
      await load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero
        title={P('本站账号')}
        subtitle={P('创建本地用户名密码账号、设置角色与重置密码。Linux.do 用户不在此列表。')}
      />

      <div className="panel" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
          <UserPlus size={16} />
          <strong>{P('新建账号')}</strong>
          <button type="button" className="button ghost" onClick={load} disabled={loading}>
            <RefreshCw size={14} /> {P('刷新')}
          </button>
        </div>
        <form className="guest-aily-form" onSubmit={createUser}>
          <div className="field">
            <label>{P('用户名')}</label>
            <input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              required
              minLength={2}
            />
          </div>
          <div className="field">
            <label>{P('密码')}</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              minLength={6}
            />
          </div>
          <div className="field">
            <label>{P('显示名')}</label>
            <input
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            />
          </div>
          <div className="field">
            <label>{P('角色')}</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="user">{P('普通用户')}</option>
              <option value="admin">{P('管理员')}</option>
            </select>
          </div>
          <div className="field">
            <label>{P('用户组 ID（可选）')}</label>
            <input
              value={form.group_id}
              onChange={(e) => setForm({ ...form, group_id: e.target.value })}
              placeholder="g-..."
            />
          </div>
          <button type="submit" className="button">
            <Plus size={14} /> {P('创建')}
          </button>
        </form>
      </div>

      {msg ? <p style={{ color: 'var(--success, #3d9)', marginTop: 12 }}>{msg}</p> : null}
      {err ? <p style={{ color: 'var(--error)', marginTop: 12 }}>{err}</p> : null}

      <div className="panel" style={{ marginTop: 16, overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>{P('用户名')}</th>
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
                <td>{u.username}</td>
                <td>{u.display_name}</td>
                <td>{u.role}</td>
                <td>{u.disabled ? P('停用') : P('正常')}</td>
                <td>{u.group_id || '—'}</td>
                <td style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="button ghost" onClick={() => toggleRole(u)}>
                    {u.role === 'admin' ? P('降为用户') : P('设为管理员')}
                  </button>
                  <button type="button" className="button ghost" onClick={() => toggleDisabled(u)}>
                    {u.disabled ? P('启用') : P('停用')}
                  </button>
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() => {
                      setResetId(u.id)
                      setResetPassword('')
                    }}
                  >
                    <KeyRound size={14} /> {P('重置密码')}
                  </button>
                  <button type="button" className="button ghost" onClick={() => removeUser(u)}>
                    <Trash2 size={14} /> {P('删除')}
                  </button>
                </td>
              </tr>
            ))}
            {!users.length && !loading ? (
              <tr>
                <td colSpan={6}>{P('暂无本地用户。可用 BOOTSTRAP_ADMIN_* 或在此创建。')}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {resetId ? (
        <div className="panel" style={{ marginTop: 16 }}>
          <form onSubmit={doResetPassword} className="guest-aily-form">
            <div className="field">
              <label>{P('新密码')}</label>
              <input
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <button type="submit" className="button">
              {P('确认重置')}
            </button>
            <button type="button" className="button ghost" onClick={() => setResetId(null)}>
              {P('取消')}
            </button>
          </form>
        </div>
      ) : null}
    </AdminLayout>
  )
}
