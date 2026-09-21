import { useEffect, useState, type FormEvent } from 'react'
import {
  RefreshCw,
  ExternalLink,
  Cable,
  KeyRound,
  LogIn,
  Trash2,
} from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'
import { useToast } from '../../hooks/useStore'

type AilyStatus = {
  auth_file?: string
  upstream?: string
  upstream_from_env?: boolean
  aily_base_url?: string
  aily_base_from_env?: boolean
  has_access_token?: boolean
  has_refresh_token?: boolean
  access_preview?: string
  refresh_preview?: string
  updated_at?: string | null
  model_routes?: string[]
  bridge?: string
  cpa_note?: string
  cpa_openai_compatibility?:
    | { name: string; base_url: string; prefix?: string; disabled?: boolean; models: { name: string; alias: string }[]; api_key_count: number }[]
    | { error?: string }
  architecture?: Record<string, string>
}

type TestResult = {
  upstream?: { ok?: boolean; message?: string; user?: string | null; upstream?: string }
  models?: {
    ok?: boolean
    message?: string
    sample?: string[]
    models?: string[]
    latency_ms?: number
    upstream?: string
    embedded?: boolean
  }
  adapter?: {
    ok?: boolean
    message?: string
    sample?: string[]
    models?: string[]
    latency_ms?: number
  }
}

const PRIMARY = ['anthropic', 'codex', 'antigravity', 'kimi', 'xai', 'devin']
const OPTIONAL = ['qwen', 'iflow', 'gemini-cli']

export function AdminOauthPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const { showToast } = useToast()
  const [state, setState] = useState('')
  const [authUrl, setAuthUrl] = useState('')
  const [userCode, setUserCode] = useState('')
  const [callbackUrl, setCallbackUrl] = useState('')
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [aliasJson, setAliasJson] = useState('{}')
  const [excludedJson, setExcludedJson] = useState('[]')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [unavailable, setUnavailable] = useState<string[]>([])

  // Aily upstream state
  const [ailyStatus, setAilyStatus] = useState<AilyStatus | null>(null)
  const [ailyTest, setAilyTest] = useState<TestResult | null>(null)
  const [ailyErr, setAilyErr] = useState<string | null>(null)
  const [ailyMsg, setAilyMsg] = useState<string | null>(null)
  const [ailyLoading, setAilyLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [access, setAccess] = useState('')
  const [refresh, setRefresh] = useState('')

  useEffect(() => {
    if (!gate.allowed) return
    // Keep fetching providers list for side-effect readiness (errors surface via start)
    api.get('/api/admin/oauth/providers').catch((e) => setErr((e as Error).message))
    loadAlias()
    loadAily()
  }, [gate.allowed])

  async function loadAlias() {
    try {
      const a = await api.get<{ alias: unknown }>('/api/admin/oauth/model-alias')
      setAliasJson(JSON.stringify(a.alias ?? {}, null, 2))
      const e = await api.get<{ excluded: unknown }>('/api/admin/oauth/excluded-models')
      setExcludedJson(JSON.stringify(e.excluded ?? [], null, 2))
    } catch {
      /* ignore */
    }
  }

  async function loadAily() {
    if (!gate.allowed) return
    setAilyLoading(true)
    setAilyErr(null)
    try {
      const d = await api.get<AilyStatus>('/api/admin/aily/status')
      setAilyStatus(d)
      if (d.aily_base_from_env || d.upstream_from_env) {
        setBaseUrl(d.upstream || '')
      } else {
        setBaseUrl(d.aily_base_url || '')
      }
    } catch (e) {
      setAilyErr((e as Error).message)
    } finally {
      setAilyLoading(false)
    }
  }

  async function start(id: string) {
    setBusy(true)
    setErr(null)
    setAuthUrl('')
    setUserCode('')
    setStatus(null)
    try {
      const d = await api.post<{
        state?: string
        url?: string
        user_code?: string
        status?: string
      }>(`/api/admin/oauth/start/${id}`)
      setState(String(d.state || ''))
      setAuthUrl(String(d.url || ''))
      setUserCode(String(d.user_code || ''))
      showToast(P('已启动 OAuth'))
    } catch (e) {
      const msg = (e as Error).message
      if (/not available|404/i.test(msg)) {
        setUnavailable((prev) => (prev.includes(id) ? prev : [...prev, id]))
      }
      setErr(msg)
      showToast(msg)
    } finally {
      setBusy(false)
    }
  }

  async function poll() {
    if (!state) return
    setBusy(true)
    try {
      const d = await api.get<Record<string, unknown>>(`/api/admin/oauth/status?state=${encodeURIComponent(state)}`)
      setStatus(d)
      showToast(P('已刷新状态'))
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function submitCallback() {
    if (!state || !callbackUrl.trim()) return
    setBusy(true)
    try {
      await api.post('/api/admin/oauth/callback', { state, redirect_url: callbackUrl.trim() })
      showToast(P('已提交回调'))
      setCallbackUrl('')
      await poll()
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function saveAlias() {
    try {
      const parsed = JSON.parse(aliasJson)
      await api.put('/api/admin/oauth/model-alias', { alias: parsed })
      showToast(P('已保存模型别名'))
    } catch (e) {
      showToast((e as Error).message)
    }
  }

  async function saveExcluded() {
    try {
      const parsed = JSON.parse(excludedJson)
      await api.put('/api/admin/oauth/excluded-models', { excluded: parsed })
      showToast(P('已保存排除模型'))
    } catch (e) {
      showToast((e as Error).message)
    }
  }

  async function runAilyTest() {
    setAilyMsg(null)
    setAilyErr(null)
    try {
      const d = await api.post<TestResult>('/api/admin/aily/test')
      setAilyTest(d)
      setAilyMsg(P('连通测试完成'))
      await loadAily()
    } catch (e) {
      setAilyErr((e as Error).message)
    }
  }

  async function sendCode() {
    setAilyMsg(null)
    setAilyErr(null)
    try {
      await api.post('/api/admin/aily/send-code', {
        email: email.trim(),
        aily_base_url: baseUrl.trim() || undefined,
      })
      setAilyMsg(P('验证码已发送（若邮箱有效）'))
    } catch (e) {
      setAilyErr((e as Error).message)
    }
  }

  async function doLogin(e: FormEvent) {
    e.preventDefault()
    setAilyMsg(null)
    setAilyErr(null)
    try {
      await api.post('/api/admin/aily/login', {
        email: email.trim(),
        code: code.trim(),
        aily_base_url: baseUrl.trim() || undefined,
      })
      setAilyMsg(P('Aily 上游登录成功，token 已写入共享凭证文件'))
      setCode('')
      await loadAily()
    } catch (e) {
      setAilyErr((e as Error).message)
    }
  }

  async function saveTokens(e: FormEvent) {
    e.preventDefault()
    setAilyMsg(null)
    setAilyErr(null)
    try {
      await api.post('/api/admin/aily/tokens', {
        access_token: access.trim() || undefined,
        refresh_token: refresh.trim() || undefined,
        aily_base_url: baseUrl.trim() || undefined,
      })
      setAilyMsg(P('Token 已保存'))
      setAccess('')
      setRefresh('')
      await loadAily()
    } catch (e) {
      setAilyErr((e as Error).message)
    }
  }

  async function doRefresh() {
    setAilyMsg(null)
    setAilyErr(null)
    try {
      await api.post('/api/admin/aily/refresh')
      setAilyMsg(P('已刷新 access_token'))
      await loadAily()
    } catch (e) {
      setAilyErr((e as Error).message)
    }
  }

  async function doClear() {
    if (!confirm(P('确认清除本机 Aily access/refresh token？这会影响内嵌 Aily 上游鉴权。'))) return
    setAilyMsg(null)
    setAilyErr(null)
    try {
      await api.post('/api/admin/aily/logout')
      setAilyMsg(P('已清除'))
      await loadAily()
    } catch (e) {
      setAilyErr((e as Error).message)
    }
  }

  const buttons = [...PRIMARY, ...OPTIONAL]

  const compat = Array.isArray(ailyStatus?.cpa_openai_compatibility)
    ? ailyStatus!.cpa_openai_compatibility
    : null
  const compatErr =
    ailyStatus?.cpa_openai_compatibility && !Array.isArray(ailyStatus.cpa_openai_compatibility)
      ? (ailyStatus.cpa_openai_compatibility as { error?: string }).error
      : null

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero
        title={P('OAuth 登录')}
        subtitle={P('选择提供商 → 打开授权页 → 粘贴回调地址 → 确认状态。也可在本页管理 Aily 上游凭证。')}
      />
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}

      <div className="panel" style={{ marginTop: 12 }}>
        <h3>{P('选择提供商')}</h3>
        <p className="muted" style={{ marginTop: 0, marginBottom: 10, fontSize: 13 }}>
          {P('点击下方按钮启动授权流程，完成后在「授权进度」中粘贴回调地址。')}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {buttons.map((id) => (
            <button
              key={id}
              type="button"
              className="button secondary compact"
              disabled={busy || unavailable.includes(id)}
              title={unavailable.includes(id) ? P('此提供商当前不可用') : ''}
              onClick={() => start(id)}
            >
              {id}
              {unavailable.includes(id) ? ' (N/A)' : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3>{P('授权进度')}</h3>
        <p>
          <span className="muted">{P('会话标识')}</span> · <code>{state || '—'}</code>
        </p>
        {userCode ? (
          <p>
            <span className="muted">{P('设备码')}</span> · <code>{userCode}</code>
          </p>
        ) : null}
        {authUrl ? (
          <p>
            <a href={authUrl} target="_blank" rel="noreferrer">
              {P('打开授权页')} <ExternalLink size={14} />
            </a>
            <div className="muted" style={{ wordBreak: 'break-all', fontSize: 12, marginTop: 4 }}>
              {authUrl}
            </div>
          </p>
        ) : null}
        <div className="field" style={{ marginTop: 12 }}>
          <label>{P('回调地址')}</label>
          <input
            style={{ width: '100%' }}
            value={callbackUrl}
            onChange={(e) => setCallbackUrl(e.target.value)}
            placeholder="http://localhost:.../callback?code=..."
          />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="button" className="button" disabled={busy || !state || !callbackUrl.trim()} onClick={submitCallback}>
            {P('提交回调')}
          </button>
          <button type="button" className="button secondary" disabled={busy || !state} onClick={poll}>
            <RefreshCw size={14} /> {P('刷新状态')}
          </button>
        </div>
        {status ? (
          <pre style={{ marginTop: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12 }}>
            {JSON.stringify(status, null, 2)}
          </pre>
        ) : null}
      </div>

      <details className="panel" style={{ marginTop: 16 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, userSelect: 'none' }}>
          {P('高级设置')}
        </summary>
        <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          {P('模型别名与排除列表，一般无需修改。')}
        </p>
        <div style={{ marginTop: 12 }}>
          <h4 style={{ margin: '0 0 8px' }}>{P('模型别名')} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>oauth-model-alias</span></h4>
          <textarea rows={6} style={{ width: '100%', fontFamily: 'monospace' }} value={aliasJson} onChange={(e) => setAliasJson(e.target.value)} />
          <button type="button" className="button" style={{ marginTop: 8 }} onClick={saveAlias}>
            {P('保存别名')}
          </button>
        </div>
        <div style={{ marginTop: 16 }}>
          <h4 style={{ margin: '0 0 8px' }}>{P('排除模型')} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>oauth-excluded-models</span></h4>
          <textarea
            rows={4}
            style={{ width: '100%', fontFamily: 'monospace' }}
            value={excludedJson}
            onChange={(e) => setExcludedJson(e.target.value)}
          />
          <button type="button" className="button" style={{ marginTop: 8 }} onClick={saveExcluded}>
            {P('保存排除列表')}
          </button>
        </div>
      </details>

      {/* ── Aily 上游（原独立页面功能） ── */}
      <div className="panel" style={{ marginTop: 24 }}>
        <div className="channels-toolbar" style={{ marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>{P('Aily 上游')}</h3>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
              {P('管理 Aily 凭证与连通测试；客户端默认走 CPA，命中路由时用内嵌桥接。')}
              {ailyStatus?.updated_at
                ? ` · ${P('凭证更新')} ${new Date(ailyStatus.updated_at).toLocaleString('zh-CN', {
                    timeZone: 'Asia/Shanghai',
                    hour12: false,
                  })}`
                : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="button secondary compact" onClick={loadAily} disabled={ailyLoading}>
              <RefreshCw size={14} /> {P('刷新状态')}
            </button>
            <button type="button" className="button compact" onClick={runAilyTest}>
              <Cable size={14} /> {P('连通测试')}
            </button>
          </div>
        </div>

        {ailyErr ? <p style={{ color: 'var(--error)' }}>{ailyErr}</p> : null}
        {ailyMsg ? <p style={{ color: 'var(--success, #16a34a)' }}>{ailyMsg}</p> : null}

        <ul className="muted" style={{ margin: '0 0 12px', paddingLeft: 18, lineHeight: 1.7, fontSize: 13 }}>
          <li>
            {P('桥接')} · {P('内嵌于本站 BFF')}
            {ailyStatus?.bridge ? ` (${ailyStatus.bridge})` : ''}
          </li>
          <li>
            {P('上游')} · <code>{ailyStatus?.upstream || '—'}</code>
            {ailyStatus?.upstream_from_env || ailyStatus?.aily_base_from_env ? ' (env)' : ''}
          </li>
          <li>
            {P('选择性路由')} ·{' '}
            {ailyStatus?.model_routes?.length
              ? ailyStatus.model_routes.join(', ')
              : P('未配置（全部走 CPA）')}
          </li>
        </ul>

        <div className="stats-grid" style={{ marginBottom: 16 }}>
          <div className="stat-card">
            <div className="label">{P('Access Token')}</div>
            <div className="value" style={{ fontSize: 16 }}>
              {ailyStatus?.has_access_token ? ailyStatus.access_preview : P('未配置')}
            </div>
          </div>
          <div className="stat-card">
            <div className="label">{P('Refresh Token')}</div>
            <div className="value" style={{ fontSize: 16 }}>
              {ailyStatus?.has_refresh_token ? ailyStatus.refresh_preview : P('未配置')}
            </div>
          </div>
          <div className="stat-card">
            <div className="label">{P('凭证状态')}</div>
            <div className="value" style={{ fontSize: 16 }}>
              {ailyStatus?.has_access_token ? P('已授权') : P('未配置')}
            </div>
          </div>
          <div className="stat-card">
            <div className="label">{P('CPA openai-compat')}</div>
            <div className="value" style={{ fontSize: 16 }}>
              {compat ? compat.length : compatErr ? P('读取失败') : '0'}
            </div>
          </div>
        </div>

        {ailyTest ? (
          <div style={{ marginBottom: 16, padding: 12, background: 'var(--surface-2, rgba(0,0,0,0.03))', borderRadius: 8 }}>
            <h4 style={{ marginTop: 0 }}>{P('最近测试')}</h4>
            <p>
              <strong>{P('上游 /auth/me')}</strong> ·{' '}
              <span style={{ color: ailyTest.upstream?.ok ? 'var(--success, #16a34a)' : 'var(--error)' }}>
                {ailyTest.upstream?.message || '—'}
              </span>
            </p>
            <p style={{ marginBottom: 0 }}>
              <strong>{P('内嵌模型目录')}</strong> ·{' '}
              <span
                style={{
                  color: (ailyTest.models || ailyTest.adapter)?.ok
                    ? 'var(--success, #16a34a)'
                    : 'var(--error)',
                }}
              >
                {(ailyTest.models || ailyTest.adapter)?.message || '—'}
              </span>
              {(ailyTest.models || ailyTest.adapter)?.sample?.length ? (
                <span className="muted">
                  {' '}
                  · {(ailyTest.models || ailyTest.adapter)!.sample!.join(', ')}
                </span>
              ) : null}
            </p>
          </div>
        ) : null}

        <div style={{ marginBottom: 16 }}>
          <h4 style={{ marginTop: 0 }}>{P('邮箱验证码登录')}</h4>
          <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
            {P('用邮箱验证码登录，或直接粘贴已有 Token。中国区 Token 应对 api.yiyu.pro，国际区对 api.aily.pro。')}
          </p>
          <form className="guest-login-form" onSubmit={doLogin}>
            <div className="field">
              <label>{P('Aily 区域')}</label>
              <select
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                disabled={!!(ailyStatus?.aily_base_from_env || ailyStatus?.upstream_from_env)}
              >
                <option value="">{P('自动（按 Token 的 region）')}</option>
                <option value="https://api.yiyu.pro">{P('中国 · api.yiyu.pro')}</option>
                <option value="https://api.aily.pro">{P('国际 · api.aily.pro')}</option>
              </select>
              <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>
                {ailyStatus?.aily_base_from_env || ailyStatus?.upstream_from_env
                  ? `${P('当前由 AILY_BASE_URL 指定：')}${ailyStatus?.upstream || ''}`
                  : `${P('当前上游')} ${ailyStatus?.upstream || P('（未配置）')}；${P('未手动指定时按 Token 的 region 自动选择')}`}
              </p>
            </div>
            <div className="field">
              <label>{P('邮箱')}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  required
                  placeholder="you@example.com"
                  style={{ flex: 1 }}
                />
                <button type="button" className="button secondary" onClick={sendCode}>
                  {P('发送验证码')}
                </button>
              </div>
            </div>
            <div className="field">
              <label>{P('验证码')}</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={P('6 位验证码')}
              />
            </div>
            <button type="submit" className="button">
              <LogIn size={14} /> {P('登录并保存 Token')}
            </button>
          </form>
        </div>

        <div style={{ marginBottom: 16 }}>
          <h4 style={{ marginTop: 0 }}>{P('粘贴 Token')}</h4>
          <form className="guest-login-form" onSubmit={saveTokens}>
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

        <div>
          <h4 style={{ marginTop: 0 }}>{P('CPA openai-compatibility（只读）')}</h4>
          {compatErr ? <p style={{ color: 'var(--error)' }}>{compatErr}</p> : null}
          {!compatErr && (!compat || !compat.length) ? (
            <p className="muted" style={{ fontSize: 13 }}>
              {P('当前为空。默认用 AILY_MODEL_ROUTES 走本站内嵌 Aily 桥接；CPA openai-compatibility 仍可选。')}
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
      </div>
    </AdminLayout>
  )
}
