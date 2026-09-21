import { useEffect, useState } from 'react'
import { RefreshCw, ExternalLink } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'
import { useToast } from '../../hooks/useStore'

type Provider = { id: string; path: string }

const PRIMARY = ['anthropic', 'codex', 'antigravity', 'kimi', 'xai', 'devin']
const OPTIONAL = ['qwen', 'iflow', 'gemini-cli']

export function AdminOauthPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const { showToast } = useToast()
  const [providers, setProviders] = useState<Provider[]>([])
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

  useEffect(() => {
    if (!gate.allowed) return
    api
      .get<{ providers: Provider[] }>('/api/admin/oauth/providers')
      .then((d) => setProviders(d.providers || []))
      .catch((e) => setErr((e as Error).message))
    loadAlias()
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
      showToast(P('已保存 model-alias'))
    } catch (e) {
      showToast((e as Error).message)
    }
  }

  async function saveExcluded() {
    try {
      const parsed = JSON.parse(excludedJson)
      await api.put('/api/admin/oauth/excluded-models', { excluded: parsed })
      showToast(P('已保存 excluded-models'))
    } catch (e) {
      showToast((e as Error).message)
    }
  }

  const buttons = [...PRIMARY, ...OPTIONAL]

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero
        title={P('OAuth 登录')}
        subtitle={P('启动 CPA *-auth-url，粘贴回调 URL，轮询 get-auth-status。')}
      />
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}

      <div className="panel" style={{ marginTop: 12 }}>
        <h3>{P('启动授权')}</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {buttons.map((id) => (
            <button
              key={id}
              type="button"
              className="button secondary compact"
              disabled={busy || unavailable.includes(id)}
              title={unavailable.includes(id) ? '此 CPA 构建不可用 (404)' : ''}
              onClick={() => start(id)}
            >
              {id}
              {unavailable.includes(id) ? ' (N/A)' : ''}
            </button>
          ))}
        </div>
        {providers.length ? (
          <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            API · {providers.map((p) => p.id).join(' · ')}
          </p>
        ) : null}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3>{P('当前流程')}</h3>
        <p>
          <span className="muted">state</span> · <code>{state || '—'}</code>
        </p>
        {userCode ? (
          <p>
            <span className="muted">user_code</span> · <code>{userCode}</code>
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
          <label>{P('粘贴回调 URL')}</label>
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
            <RefreshCw size={14} /> {P('轮询状态')}
          </button>
        </div>
        {status ? (
          <pre style={{ marginTop: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12 }}>
            {JSON.stringify(status, null, 2)}
          </pre>
        ) : null}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3>oauth-model-alias</h3>
        <textarea rows={6} style={{ width: '100%', fontFamily: 'monospace' }} value={aliasJson} onChange={(e) => setAliasJson(e.target.value)} />
        <button type="button" className="button" style={{ marginTop: 8 }} onClick={saveAlias}>
          {P('保存')}
        </button>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3>oauth-excluded-models</h3>
        <textarea
          rows={4}
          style={{ width: '100%', fontFamily: 'monospace' }}
          value={excludedJson}
          onChange={(e) => setExcludedJson(e.target.value)}
        />
        <button type="button" className="button" style={{ marginTop: 8 }} onClick={saveExcluded}>
          {P('保存')}
        </button>
      </div>
    </AdminLayout>
  )
}
