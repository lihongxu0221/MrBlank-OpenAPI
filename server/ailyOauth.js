/**
 * Upstream Grok / OpenAI OAuth helpers (design §6.4).
 * Separate from CPA /admin/oauth provider pills.
 * Localhost callback works when adapter/BFF runs on the admin's machine;
 * on remote VPS prefer pasting OAuth JSON via accounts API.
 */
import http from 'node:http'
import crypto from 'node:crypto'
import { parseOAuthSecret } from './ailyAccounts.js'

export const OPENAI_OAUTH = {
  platform: 'openai',
  type: 'codex',
  issuer: 'https://auth.openai.com',
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  scope: 'openid profile email offline_access api.connectors.read api.connectors.invoke',
  originator: 'codex_cli_rs',
  ports: [1455, 1457],
}

export const GROK_OAUTH = {
  platform: 'grok',
  type: 'grok',
  issuer: process.env.GROK_OAUTH_ISSUER || 'https://auth.x.ai',
  clientId: process.env.GROK_OAUTH_CLIENT_ID || '',
  scope: 'openid profile email offline_access',
  originator: 'grok_cli',
  ports: [1456, 1458],
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function makePkce() {
  const verifier = b64url(crypto.randomBytes(32))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

function decodeJwtPayload(token) {
  try {
    const p = String(token || '').split('.')[1]
    if (!p) return null
    return JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  } catch {
    return null
  }
}

function extractCodexAccountId(accessToken) {
  const claims = decodeJwtPayload(accessToken)
  const auth = claims && claims['https://api.openai.com/auth']
  const id = auth && (auth.chatgpt_account_id || auth.account_id)
  return id ? String(id).trim() : ''
}

function extractEmailFromJwt(token) {
  const claims = decodeJwtPayload(token)
  if (!claims) return ''
  if (claims.email) return String(claims.email)
  const auth = claims['https://api.openai.com/auth']
  return auth && auth.email ? String(auth.email) : ''
}

function providerOf(platform) {
  return platform === 'grok' ? GROK_OAUTH : OPENAI_OAUTH
}

function htmlPage(title, body) {
  return (
    '<!doctype html><meta charset="utf-8"><title>' +
    title +
    '</title>' +
    '<body style="font-family:sans-serif;padding:48px;text-align:center;background:#111;color:#eee">' +
    '<h2>' +
    title +
    '</h2><p>' +
    body +
    '</p>' +
    '<script>setTimeout(function(){window.close()},1200)</script></body>'
  )
}

/**
 * @param {{ accountsStore: ReturnType<import('./ailyAccounts.js').createAilyAccountsStore> }} deps
 */
export function createAilyOauth({ accountsStore }) {
  const pending = new Map()
  let inflight = null

  function closeServer(sess) {
    if (sess && sess.server) {
      try {
        sess.server.close()
      } catch {
        /* ignore */
      }
      sess.server = null
    }
  }

  function cancelOAuth(state) {
    const sess = state ? pending.get(state) : inflight
    if (!sess) return { ok: true }
    sess.status = 'error'
    sess.message = '已取消'
    closeServer(sess)
    if (inflight && inflight.state === sess.state) inflight = null
    return { ok: true }
  }

  function bindPort(ports) {
    return new Promise((resolve, reject) => {
      const tryAt = (i) => {
        if (i >= ports.length) {
          reject(new Error('OAuth 回调端口被占用：' + ports.join('/')))
          return
        }
        const server = http.createServer()
        const onErr = () => {
          server.close()
          tryAt(i + 1)
        }
        server.once('error', onErr)
        server.listen(ports[i], '127.0.0.1', () => {
          server.removeListener('error', onErr)
          resolve({ server, port: ports[i] })
        })
      }
      tryAt(0)
    })
  }

  async function exchangeCode(prov, args) {
    const tokenUrl = prov.issuer.replace(/\/+$/, '') + '/oauth/token'
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code: args.code,
      redirect_uri: args.redirectUri,
      client_id: prov.clientId,
      code_verifier: args.verifier,
    })
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json || !json.access_token) {
      throw new Error((json && (json.error_description || json.error)) || 'oauth token ' + res.status)
    }
    return json
  }

  function oauthFromTokenResponse(prov, json, prev) {
    prev = prev || {}
    const access = String(json.access_token || '').trim()
    const refresh = String(json.refresh_token || prev.refresh_token || '').trim()
    const expiresIn = Number(json.expires_in) || 0
    const expired =
      expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : prev.expired || ''
    let account_id = prev.account_id || ''
    if (prov.platform === 'openai') account_id = extractCodexAccountId(access) || account_id
    const email =
      extractEmailFromJwt(access) || extractEmailFromJwt(json.id_token) || prev.email || ''
    return {
      access_token: access,
      refresh_token: refresh,
      account_id,
      email,
      expired,
      last_refresh: new Date().toISOString(),
      type: prev.type || prov.type,
      id_token: json.id_token || prev.id_token || '',
      issuer: prov.issuer,
      client_id: prov.clientId,
    }
  }

  function saveOauthAccount(sess, oauth) {
    const draft = sess.draft || {}
    const fields = {
      platform: sess.platform,
      name: draft.name,
      remark: draft.remark,
      auth_type: 'oauth',
      custom_upstream: !!draft.custom_upstream,
      base_url: draft.base_url,
      enabled: draft.enabled !== false,
      api_key: JSON.stringify(oauth),
      oauth,
    }
    if (sess.accountId) return accountsStore.update(sess.accountId, fields)
    return accountsStore.create(fields)
  }

  async function finishCallback(sess, url) {
    const code = url.searchParams.get('code') || ''
    const state = url.searchParams.get('state') || ''
    const err = url.searchParams.get('error')
    if (err) throw new Error(url.searchParams.get('error_description') || err)
    if (!code) throw new Error('缺少 code')
    if (state !== sess.state) throw new Error('state 不匹配')
    const json = await exchangeCode(providerOf(sess.platform), {
      code,
      redirectUri: sess.redirectUri,
      verifier: sess.verifier,
    })
    const oauth = oauthFromTokenResponse(providerOf(sess.platform), json)
    if (sess.platform === 'openai' && !oauth.account_id) {
      throw new Error('未能从 token 解析 ChatGPT account_id')
    }
    const row = saveOauthAccount(sess, oauth)
    sess.status = 'ok'
    sess.accountId = row.id
    sess.message = 'ok'
    return row
  }

  async function startOAuth(body = {}) {
    const platform = body.platform === 'grok' ? 'grok' : 'openai'
    const prov = providerOf(platform)
    if (!prov.clientId) {
      throw new Error(
        platform === 'grok'
          ? 'Grok 未配置公开 OAuth 客户端。请粘贴 OAuth JSON，或设置 GROK_OAUTH_CLIENT_ID'
          : '缺少 OAuth client_id',
      )
    }
    if (inflight && inflight.status === 'pending') cancelOAuth(inflight.state)
    const pkce = makePkce()
    const state = makePkce().verifier
    const bound = await bindPort(prov.ports)
    const server = bound.server
    const port = bound.port
    const redirectUri = 'http://localhost:' + port + '/auth/callback'
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: prov.clientId,
      redirect_uri: redirectUri,
      scope: prov.scope,
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
      state,
      originator: prov.originator,
    })
    if (platform === 'openai') {
      params.set('id_token_add_organizations', 'true')
      params.set('codex_cli_simplified_flow', 'true')
    }
    const authorizeUrl = prov.issuer.replace(/\/+$/, '') + '/oauth/authorize?' + params.toString()
    const sess = {
      state,
      platform,
      status: 'pending',
      verifier: pkce.verifier,
      redirectUri,
      server,
      accountId: body.account_id || null,
      draft: {
        name: body.name || '',
        remark: body.remark || '',
        custom_upstream: !!body.custom_upstream,
        base_url: body.base_url || '',
        enabled: body.enabled !== false,
      },
      message: '',
      createdAt: Date.now(),
    }
    pending.set(state, sess)
    inflight = sess
    server.on('request', async (req, res) => {
      const u = new URL(req.url, 'http://localhost:' + port)
      const send = (code, html) => {
        res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html)
      }
      if (u.pathname === '/cancel') {
        cancelOAuth(state)
        send(200, htmlPage('已取消', '可以关闭窗口'))
        return
      }
      if (u.pathname !== '/auth/callback') {
        res.writeHead(404)
        res.end()
        return
      }
      try {
        await finishCallback(sess, u)
        send(200, htmlPage('授权成功', '可以关闭此窗口，回到管理页。'))
      } catch (e) {
        sess.status = 'error'
        sess.message = e.message || '授权失败'
        send(400, htmlPage('授权失败', sess.message))
      } finally {
        closeServer(sess)
        if (inflight && inflight.state === state) inflight = null
      }
    })
    setTimeout(() => {
      if (sess.status === 'pending') {
        sess.status = 'error'
        sess.message = '授权超时'
        closeServer(sess)
        if (inflight && inflight.state === state) inflight = null
      }
    }, 10 * 60 * 1000)
    return {
      state,
      platform,
      authorize_url: authorizeUrl,
      redirect_uri: redirectUri,
      note: '本机回调仅在 BFF 与浏览器同机时可用；远程 VPS 请改用粘贴 OAuth JSON。',
    }
  }

  function oauthStatus(state) {
    const sess = state ? pending.get(state) : inflight
    if (!sess) return { status: 'none' }
    return {
      status: sess.status,
      platform: sess.platform,
      message: sess.message || '',
      account_id: sess.accountId || null,
      redirect_uri: sess.redirectUri,
    }
  }

  async function refreshOAuthToken(account) {
    const oauth = account && account.oauth
    if (!oauth || !oauth.refresh_token) throw new Error('没有 refresh_token')
    const prov = providerOf(account.platform)
    const clientId = oauth.client_id || prov.clientId
    if (!clientId) throw new Error('缺少 OAuth client_id')
    const tokenUrl = (oauth.issuer || prov.issuer).replace(/\/+$/, '') + '/oauth/token'
    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: oauth.refresh_token,
      client_id: clientId,
    })
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json || !json.access_token) {
      throw new Error(
        (json && (json.error_description || json.error)) || 'oauth refresh ' + res.status,
      )
    }
    return oauthFromTokenResponse(prov, json, oauth)
  }

  return {
    startOAuth,
    oauthStatus,
    cancelOAuth,
    refreshOAuthToken,
    parseOAuthSecret,
    extractCodexAccountId,
    extractEmailFromJwt,
  }
}
