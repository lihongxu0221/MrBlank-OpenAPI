import { useEffect, useState, type FormEvent } from 'react'
import { RefreshCw, Cable, KeyRound, LogIn, Trash2, ShieldAlert } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'

type AilyStatus = {
  auth_file?: string
  adapter_url?: string
  upstream?: string
  upstream_from_env?: boolean
  has_access_token?: boolean
  has_refresh_token?: boolean
  access_preview?: string
  refresh_preview?: string
  updated_at?: string | null
  adapter_api_key_configured?: boolean
  admin_proxy_configured?: boolean
  model_routes?: string[]
  cpa_note?: string
  cpa_openai_compatibility?:
    | { name: string; base_url: string; prefix?: string; disabled?: boolean; models: { name: string; alias: string }[]; api_key_count: number }[]
    | { error?: string }
  architecture?: Record<string, string>
}

type TestResult = {
  upstream?: { ok?: boolean; message?: string; user?: string | null; upstream?: string }
  adapter?: { ok?: boolean; message?: string; sample?: string[]; models?: string[]; latency_ms?: number }
}

export function AdminAilyPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const [status, setStatus] = useState<AilyStatus | null>(null)
  const [test, setTest] = useState<TestResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [access, setAccess] = useState('')
  const [refresh, setRefresh] = useState('')

  async function load() {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      const d = await api.get<AilyStatus>('/api/admin/aily/status')
      setStatus(d)
      if (!baseUrl && d.upstream) setBaseUrl(d.upstream)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (gate.allowed) load()
  }, [gate.allowed])

  async function runTest() {
    setMsg(null)
    setErr(null)
    try {
      const d = await api.post<TestResult>('/api/admin/aily/test')
      setTest(d)
      setMsg(P('连通测试完成'))
      await load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function sendCode() {
    setMsg(null)
    setErr(null)
    try {
      await api.post('/api/admin/aily/send-code', {
        email: email.trim(),
        aily_base_url: baseUrl.trim() || undefined,
      })
      setMsg(P('验证码已发送（若邮箱有效）'))
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function doLogin(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    setErr(null)
    try {
      await api.post('/api/admin/aily/login', {
        email: email.trim(),
        code: code.trim(),
        aily_base_url: baseUrl.trim() || undefined,
      })
      setMsg(P('Aily 上游登录成功，token 已写入共享凭证文件'))
      setCode('')
      await load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function saveTokens(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    setErr(null)
    try {
      await api.post('/api/admin/aily/tokens', {
        access_token: access.trim() || undefined,
        refresh_token: refresh.trim() || undefined,
        aily_base_url: baseUrl.trim() || undefined,
      })
      setMsg(P('Token 已保存'))
      setAccess('')
      setRefresh('')
      await load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function doRefresh() {
    setMsg(null)
    setErr(null)
    try {
      await api.post('/api/admin/aily/refresh')
      setMsg(P('已刷新 access_token'))
      await load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function doClear() {
    if (!confirm(P('确认清除本机 Aily access/refresh token？这会影响 aily-openai-adapter 上游鉴权。'))) return
    setMsg(null)
    setErr(null)
    try {
      await api.post('/api/admin/aily/logout')
      setMsg(P('已清除'))
      await load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const compat = Array.isArray(status?.cpa_openai_compatibility)
    ? status!.cpa_openai_compatibility
    : null
  const compatErr =
    status?.cpa_openai_compatibility && !Array.isArray(status.cpa_openai_compatibility)
      ? (status.cpa_openai_compatibility as { error?: string }).error
      : null

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero
        title={P('Aily 上游')}
        subtitle={P('管理 Aily 凭证与连通测试；客户端 /v1 仍走 CPA。本页不参与站登录。')}
      />

      <div className="channels-toolbar">
        <span className="muted">
          {status?.updated_at
            ? `${P('凭证更新')} · ${new Date(status.updated_at).toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai',
                hour12: false,
              })}`
            : ''}
        </span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="button secondary compact" onClick={load} disabled={loading}>
            <RefreshCw size={14} /> {P('刷新状态')}
          </button>
          <button type="button" className="button compact" onClick={runTest}>
            <Cable size={14} /> {P('连通测试')}
          </button>
        </div>
      </div>

      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}
      {msg ? <p style={{ color: 'var(--success, #16a34a)' }}>{msg}</p> : null}

      <div className="panel" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>
          <ShieldAlert size={16} style={{ marginRight: 6 }} />
          {P('架构（CPA-first）')}
        </h3>
        <p className="page-lead" style={{ marginBottom: 8 }}>
          {P(
            '客户端 → openapi /v1 → BFF → CPA billing(:8320)。Aily adapter(:8088) 仅作上游凭证与可选模型旁路；不是并行对外网关。',
          )}
        </p>
        <ul className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>
            {P('适配器')} · <code>{status?.adapter_url || '—'}</code>
          </li>
          <li>
            {P('上游')} · <code>{status?.upstream || '—'}</code>
            {status?.upstream_from_env ? ' (env)' : ''}
          </li>
          <li>
            {P('选择性路由')} ·{' '}
            {status?.model_routes?.length
              ? status.model_routes.join(', ')
              : P('未配置（全部走 CPA）')}
          </li>
          <li>{status?.cpa_note || ''}</li>
        </ul>
      </div>

      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card">
          <div className="label">{P('Access Token')}</div>
          <div className="value" style={{ fontSize: 16 }}>
            {status?.has_access_token ? status.access_preview : P('未配置')}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">{P('Refresh Token')}</div>
          <div className="value" style={{ fontSize: 16 }}>
            {status?.has_refresh_token ? status.refresh_preview : P('未配置')}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">{P('Adapter API Key')}</div>
          <div className="value" style={{ fontSize: 16 }}>
            {status?.adapter_api_key_configured ? P('已配置') : P('未配置')}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">{P('CPA openai-compat')}</div>
          <div className="value" style={{ fontSize: 16 }}>
            {compat ? compat.length : compatErr ? P('读取失败') : '0'}
          </div>
        </div>
      </div>

      {test ? (
        <div className="panel" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>{P('最近测试')}</h3>
          <p>
            <strong>{P('上游 /auth/me')}</strong> ·{' '}
            <span style={{ color: test.upstream?.ok ? 'var(--success, #16a34a)' : 'var(--error)' }}>
              {test.upstream?.message || '—'}
            </span>
          </p>
          <p>
            <strong>{P('Adapter /v1/models')}</strong> ·{' '}
            <span style={{ color: test.adapter?.ok ? 'var(--success, #16a34a)' : 'var(--error)' }}>
              {test.adapter?.message || '—'}
            </span>
            {test.adapter?.sample?.length ? (
              <span className="muted"> · {test.adapter.sample.join(', ')}</span>
            ) : null}
          </p>
        </div>
      ) : null}

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <h3>{P('邮箱验证码登录（写入共享 .aily）')}</h3>
        </div>
        <form className="guest-login-form" onSubmit={doLogin} style={{ padding: 16 }}>
          <div className="field">
            <label>{P('上游 Base URL')}</label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.yiyu.pro"
            />
          </div>
          <div className="field">
            <label>{P('邮箱')}</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
          </div>
          <div className="field">
            <label>{P('验证码')}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={code} onChange={(e) => setCode(e.target.value)} style={{ flex: 1 }} />
              <button type="button" className="button secondary" onClick={sendCode}>
                {P('发送验证码')}
              </button>
            </div>
          </div>
          <button type="submit" className="button">
            <LogIn size={14} /> {P('登录并保存 Token')}
          </button>
        </form>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <h3>{P('粘贴 Token')}</h3>
        </div>
        <form className="guest-login-form" onSubmit={saveTokens} style={{ padding: 16 }}>
          <div className="field">
            <label>access_token</label>
            <textarea value={access} onChange={(e) => setAccess(e.target.value)} rows={3} />
          </div>
          <div className="field">
            <label>refresh_token</label>
            <textarea value={refresh} onChange={(e) => setRefresh(e.target.value)} rows={3} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="submit" className="button">
              <KeyRound size={14} /> {P('保存')}
            </button>
            <button type="button" className="button secondary" onClick={doRefresh}>
              <RefreshCw size={14} /> {P('刷新 Token')}
            </button>
            <button type="button" className="button secondary" onClick={doClear}>
              <Trash2 size={14} /> {P('清除')}
            </button>
          </div>
        </form>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>{P('CPA openai-compatibility（只读）')}</h3>
        {compatErr ? <p style={{ color: 'var(--error)' }}>{compatErr}</p> : null}
        {!compatErr && (!compat || !compat.length) ? (
          <p className="muted">
            {P(
              '当前为空。完整 Aily 模型目录无法自动进入 CPA：Docker 内 CPA 访问不到宿主机 127.0.0.1:8088。可在 VPS 修好网络后手工配置 openai-compatibility，或设置 AILY_MODEL_ROUTES 让 BFF 按模型旁路到 aily。',
            )}
          </p>
        ) : null}
        {compat?.length ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{P('名称')}</th>
                  <th>Base URL</th>
                  <th>{P('模型数')}</th>
                  <th>Keys</th>
                  <th>{P('状态')}</th>
                </tr>
              </thead>
              <tbody>
                {compat.map((row) => (
                  <tr key={row.name + row.base_url}>
                    <td>{row.name}</td>
                    <td>
                      <code>{row.base_url}</code>
                    </td>
                    <td>{row.models?.length || 0}</td>
                    <td>{row.api_key_count}</td>
                    <td>{row.disabled ? P('停用') : P('启用')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </AdminLayout>
  )
}
