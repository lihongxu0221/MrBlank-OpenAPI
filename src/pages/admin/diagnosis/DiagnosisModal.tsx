import { useEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { api } from '../../../lib/api'
import { P } from '../../../i18n'

export type DiagnosisRec = {
  id: string
  created_at?: string
  type?: number
  method?: string
  endpoint?: string
  upstream_url?: string
  status_code?: number
  duration_ms?: number | null
  ttft_ms?: number | null
  ip?: string
  model_name?: string
  requested_model?: string
  token_name?: string
  prompt_tokens?: number
  completion_tokens?: number
  cache_tokens?: number
  is_stream?: boolean
  group?: string
  content?: string
  has_detail?: boolean
  req_headers?: Record<string, string> | string
  req_body?: string
  res_headers?: Record<string, string> | string
  res_body?: string
  upstream_req_headers?: Record<string, string> | string
  upstream_req_body?: string
}

type MainTab = 'overview' | 'request' | 'upstream'
type UpTab = 'ov' | 'req' | 'res' | 'err' | 'more'

const ROLE_LABEL: Record<string, string> = {
  system: '系统',
  user: '请求',
  assistant: '响应',
  thinking: '思考',
  tool: '工具',
}

function fmtTime(iso?: string) {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return String(iso)
  }
}

function fmtMs(n?: number | null) {
  if (n == null || Number.isNaN(Number(n))) return '-'
  return `${Number(n).toLocaleString('en-US')} ms`
}

function fmtTok(n?: number) {
  if (n == null || Number.isNaN(Number(n))) return '-'
  return Number(n).toLocaleString('en-US')
}

function parseBody(v: unknown): { kind: 'empty' | 'json' | 'text'; value?: unknown; pretty?: string } {
  if (v == null || v === '') return { kind: 'empty' }
  if (typeof v === 'object') {
    try {
      return { kind: 'json', value: v, pretty: JSON.stringify(v, null, 2) }
    } catch {
      return { kind: 'text', value: String(v), pretty: String(v) }
    }
  }
  const s = String(v)
  try {
    const val = JSON.parse(s)
    return { kind: 'json', value: val, pretty: JSON.stringify(val, null, 2) }
  } catch {
    return { kind: 'text', value: s, pretty: s }
  }
}

function prettyHeaders(v: unknown) {
  if (v == null || v === '') return ''
  let obj: unknown = v
  if (typeof v === 'string') {
    try {
      obj = JSON.parse(v)
    } catch {
      return v
    }
  }
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.entries(obj as Record<string, unknown>)
      .map(([k, val]) => `${k}: ${Array.isArray(val) ? val.join(', ') : String(val)}`)
      .join('\n')
  }
  return String(v)
}

function Card({ label, value, wide }: { label: string; value: unknown; wide?: boolean }) {
  return (
    <div className={`diag-card${wide ? ' wide' : ''}`}>
      <span>{label}</span>
      <b>{value == null || value === '' ? '-' : String(value)}</b>
    </div>
  )
}

function JsonNode({ value, name, defaultOpen = false }: { value: unknown; name?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen)
  if (value === null) {
    return (
      <div className="jl">
        {name != null ? <span className="jk">{name}: </span> : null}
        <span className="jnull">null</span>
      </div>
    )
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return (
      <div className="jl">
        {name != null ? <span className="jk">{name}: </span> : null}
        <span className={typeof value === 'boolean' ? 'jb' : 'jn'}>{String(value)}</span>
      </div>
    )
  }
  if (typeof value === 'string') {
    if (value.length > 160) {
      return (
        <details className="jd" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
          <summary>
            {name != null ? <span className="jk">{name}: </span> : null}
            <span className="js">{JSON.stringify(value.slice(0, 96) + '…')}</span>
            <span className="jm"> {value.length}</span>
          </summary>
          {open ? <pre className="diag-dump">{value}</pre> : null}
        </details>
      )
    }
    return (
      <div className="jl">
        {name != null ? <span className="jk">{name}: </span> : null}
        <span className="js">{JSON.stringify(value)}</span>
      </div>
    )
  }
  if (Array.isArray(value)) {
    if (!value.length) {
      return (
        <div className="jl">
          {name != null ? <span className="jk">{name}: </span> : null}
          <span className="jm">[]</span>
        </div>
      )
    }
    return (
      <details className="jd" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary>
          {name != null ? <span className="jk">{name}: </span> : null}
          <span className="jm">[{value.length}]</span>
        </summary>
        {open ? value.slice(0, 40).map((x, i) => <JsonNode key={i} value={x} name={String(i)} />) : null}
        {open && value.length > 40 ? <div className="jm">…还有 {value.length - 40} 项</div> : null}
      </details>
    )
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as object)
    if (!keys.length) {
      return (
        <div className="jl">
          {name != null ? <span className="jk">{name}: </span> : null}
          <span className="jm">{'{}'}</span>
        </div>
      )
    }
    return (
      <details className="jd" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary>
          {name != null ? <span className="jk">{name}: </span> : null}
          <span className="jm">{'{…}'}</span>
        </summary>
        {open
          ? keys.map((k) => <JsonNode key={k} value={(value as Record<string, unknown>)[k]} name={k} />)
          : null}
      </details>
    )
  }
  return (
    <div className="jl">
      {name != null ? <span className="jk">{name}: </span> : null}
      {String(value)}
    </div>
  )
}

function BodyBlock({ title, raw, onCopy }: { title: string; raw: unknown; onCopy: (t: string) => void }) {
  const parsed = useMemo(() => parseBody(raw), [raw])
  const [src, setSrc] = useState(false)
  if (parsed.kind === 'empty') return null
  if (parsed.kind === 'text') {
    return (
      <div className="diag-body-block">
        <div className="diag-body-cap">
          <p className="sub">{title} · 文本</p>
          <button type="button" className="button secondary compact" onClick={() => onCopy(String(parsed.value || ''))}>
            复制
          </button>
        </div>
        <pre className="diag-dump">{String(parsed.value)}</pre>
      </div>
    )
  }
  return (
    <div className="diag-body-block">
      <div className="diag-body-cap">
        <p className="sub">{title} · JSON</p>
        <button type="button" className="button secondary compact" onClick={() => setSrc((v) => !v)}>
          {src ? '树形' : 'View source'}
        </button>
        <button type="button" className="button secondary compact" onClick={() => onCopy(parsed.pretty || '')}>
          复制
        </button>
      </div>
      {src ? <pre className="diag-dump">{parsed.pretty}</pre> : (
        <div className="diag-json-tree">
          <JsonNode value={parsed.value} defaultOpen />
        </div>
      )}
    </div>
  )
}

function extractTurns(rec: DiagnosisRec) {
  const turns: { role: string; content: string }[] = []
  const req = parseBody(rec.req_body)
  if (req.kind === 'json' && req.value && typeof req.value === 'object') {
    const r = req.value as Record<string, unknown>
    if (Array.isArray(r.messages)) {
      for (const m of r.messages as any[]) {
        if (!m) continue
        const role = String(m.role || 'user')
        let content = ''
        if (typeof m.content === 'string') content = m.content
        else if (Array.isArray(m.content)) {
          content = m.content
            .map((p: any) => (typeof p === 'string' ? p : p?.text || ''))
            .filter(Boolean)
            .join('\n')
        } else if (m.content != null) content = JSON.stringify(m.content, null, 2)
        if (content) turns.push({ role, content })
      }
    } else if (typeof r.input === 'string') turns.push({ role: 'user', content: r.input })
    else if (typeof r.prompt === 'string') turns.push({ role: 'user', content: r.prompt })
  }
  const res = parseBody(rec.res_body)
  if (res.kind === 'json' && res.value && typeof res.value === 'object') {
    const s = res.value as any
    if (Array.isArray(s.choices)) {
      for (const ch of s.choices) {
        const msg = ch?.message
        if (msg?.reasoning_content) turns.push({ role: 'thinking', content: String(msg.reasoning_content) })
        if (msg?.content) turns.push({ role: 'assistant', content: String(msg.content) })
        else if (typeof ch?.text === 'string') turns.push({ role: 'assistant', content: ch.text })
      }
    } else if (typeof s.content === 'string') turns.push({ role: 'assistant', content: s.content })
  } else if (res.kind === 'text' && res.value) {
    const texts: string[] = []
    for (const line of String(res.value).split('\n')) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const j = JSON.parse(payload)
        const delta = j?.choices?.[0]?.delta?.content || j?.choices?.[0]?.message?.content
        if (delta) texts.push(String(delta))
      } catch {
        /* ignore */
      }
    }
    if (texts.length) turns.push({ role: 'assistant', content: texts.join('') })
  }
  return turns
}

export function DiagnosisModal({ id, onClose }: { id: string; onClose: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const preMax = useRef<{ w: string; h: string } | null>(null)
  const [maximized, setMaximized] = useState(false)
  const [tab, setTab] = useState<MainTab>('overview')
  const [upTab, setUpTab] = useState<UpTab>('ov')
  const [rec, setRec] = useState<DiagnosisRec | null>(null)
  const [err, setErr] = useState('')
  const [toast, setToast] = useState('')
  const [turns, setTurns] = useState<{ role: string; content: string }[]>([])
  const [building, setBuilding] = useState(false)

  useEffect(() => {
    let stop = false
    setRec(null)
    setErr('')
    setTab('overview')
    setUpTab('ov')
    setTurns([])
    setBuilding(false)
    api
      .get<DiagnosisRec>(`/api/admin/diagnosis/logs/${encodeURIComponent(id)}`)
      .then((d) => {
        if (stop) return
        if (!d?.id) {
          setErr('记录不存在')
          return
        }
        setRec(d)
        setBuilding(true)
        requestAnimationFrame(() => {
          if (stop) return
          setTurns(extractTurns(d))
          setBuilding(false)
        })
      })
      .catch((e) => {
        if (!stop) setErr((e as Error).message || '加载失败')
      })
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      stop = true
      document.removeEventListener('keydown', onKey)
    }
  }, [id, onClose])

  function ping(msg: string) {
    setToast(msg)
    window.clearTimeout((ping as unknown as { _t?: number })._t)
    ;(ping as unknown as { _t?: number })._t = window.setTimeout(() => setToast(''), 1600)
  }

  function copyText(text: string) {
    if (!text) return
    navigator.clipboard.writeText(text).then(() => ping('已复制')).catch(() => ping(text))
  }

  function onResizeDown(e: React.MouseEvent) {
    if (maximized) return
    const box = boxRef.current
    if (!box) return
    e.preventDefault()
    e.stopPropagation()
    const r = box.getBoundingClientRect()
    const sx = e.clientX
    const sy = e.clientY
    const sw = r.width
    const sh = r.height
    function move(ev: MouseEvent) {
      box!.style.width = `${Math.min(window.innerWidth - 16, Math.max(480, sw + ev.clientX - sx))}px`
      box!.style.height = `${Math.min(window.innerHeight - 16, Math.max(320, sh + ev.clientY - sy))}px`
    }
    function up() {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  function maximize() {
    const box = boxRef.current
    if (!box || maximized) return
    preMax.current = { w: box.style.width || '', h: box.style.height || '' }
    box.style.width = ''
    box.style.height = ''
    setMaximized(true)
  }

  function restore() {
    const box = boxRef.current
    const prev = preMax.current
    if (box && prev) {
      if (prev.w) box.style.width = prev.w
      if (prev.h) box.style.height = prev.h
    }
    preMax.current = null
    setMaximized(false)
  }

  const code = rec ? Number(rec.status_code) || 0 : 0
  const failed = !!(rec && (code >= 400 || Number(rec.type) === 5))
  const headers = rec ? prettyHeaders(rec.req_headers) : ''
  const upReqH = rec ? prettyHeaders(rec.upstream_req_headers) : ''
  const resH = rec ? prettyHeaders(rec.res_headers) : ''
  const errText = rec && failed && rec.content ? rec.content : ''

  return (
    <div
      className={`diag-backdrop${maximized ? ' max' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      data-testid="request-diagnosis-modal"
    >
      <div className={`diag-modal${maximized ? ' maximized' : ''}`} ref={boxRef} onClick={(e) => e.stopPropagation()}>
        {!maximized ? <div className="diag-resize" onMouseDown={onResizeDown} /> : null}
        <div className="diag-head">
          <div className="diag-title-row">
            <div className="diag-title">
              <h2>{P('请求诊断详情')}</h2>
              {code ? <span className={`st-badge ${failed ? 'bad' : 'ok'}`}>{code}</span> : null}
            </div>
            <nav className="diag-tabs" role="tablist" aria-label={P('请求诊断详情')}>
              <button type="button" role="tab" aria-selected={tab === 'overview'} className={tab === 'overview' ? 'on' : ''} onClick={() => setTab('overview')}>
                {P('请求概览')}
              </button>
              <button type="button" role="tab" aria-selected={tab === 'request'} className={tab === 'request' ? 'on' : ''} onClick={() => setTab('request')}>
                {P('请求信息')}
              </button>
              <button type="button" role="tab" aria-selected={tab === 'upstream'} className={tab === 'upstream' ? 'on' : ''} onClick={() => setTab('upstream')}>
                {P('上游诊断')} <span className="n">1</span>
              </button>
            </nav>
            <div className="diag-actions">
              {!maximized ? (
                <button type="button" className="button secondary compact" onClick={maximize}>
                  <Maximize2 size={14} /> {P('最大化')}
                </button>
              ) : (
                <button type="button" className="button secondary compact" onClick={restore}>
                  <Minimize2 size={14} /> {P('还原')}
                </button>
              )}
              <button type="button" className="icon-button" onClick={onClose} aria-label={P('关闭')}>
                <X size={18} />
              </button>
            </div>
          </div>
          <p className="diag-meta">
            {rec ? [rec.id, rec.ip, rec.endpoint, fmtTime(rec.created_at)].filter(Boolean).join(' · ') : P('加载中…')}
          </p>
        </div>

        <div className={`diag-body${tab === 'upstream' ? ' upstream' : ''}`}>
          {err ? (
            <div className="empty-pane">{err}</div>
          ) : !rec ? (
            <div className="empty-pane">{P('加载中…')}</div>
          ) : tab === 'overview' ? (
            <>
              <div className="diag-ov-grid">
                <Card label="请求模型" value={rec.requested_model || rec.model_name} />
                <Card label="上游模型" value={rec.model_name} />
                <Card label="客户端 Key" value={rec.token_name} />
                <Card label="客户端 IP" value={rec.ip} />
                <Card label="耗时" value={fmtMs(rec.duration_ms)} />
                <Card label="首字" value={fmtMs(rec.ttft_ms)} />
                <Card label="输入 Token" value={fmtTok(rec.prompt_tokens)} />
                <Card label="输出 Token" value={fmtTok(rec.completion_tokens)} />
                <Card label="缓存 Token" value={fmtTok(rec.cache_tokens)} />
                <Card label="流式" value={rec.is_stream ? '是' : '否'} />
                <Card label="分组" value={rec.group || '-'} />
                {errText ? <Card label="错误" value={errText} wide /> : null}
              </div>
              {building ? (
                <div className="empty-pane">正在解析对话回合…</div>
              ) : turns.length ? (
                turns.map((t, i) => (
                  <div className={`diag-turn${t.role === 'thinking' ? ' reasoning' : ''}`} key={i}>
                    <div className="diag-turn-hd">
                      <b>{`#${i + 1} · ${ROLE_LABEL[t.role] || t.role}`}</b>
                    </div>
                    <pre className="diag-turn-body">{t.content}</pre>
                  </div>
                ))
              ) : (
                <div className="empty-pane">暂无解析出的对话回合（可能尚未捕获 Body）。</div>
              )}
            </>
          ) : tab === 'request' ? (
            <>
              <div className="diag-req-path">
                <span className="m">{rec.method || 'POST'}</span>
                <code>{rec.endpoint || '-'}</code>
                <button type="button" className="button secondary compact" onClick={() => copyText(rec.endpoint || '')}>
                  复制
                </button>
              </div>
              {headers ? <pre className="diag-dump">{headers}</pre> : <div className="empty-pane">未记录到 HTTP 请求头。</div>}
              <BodyBlock title="请求 Body" raw={rec.req_body} onCopy={copyText} />
            </>
          ) : (
            <div className="diag-up-split">
              <aside className="diag-up-side">
                <p>{failed ? '失败尝试' : '尝试'}</p>
                <button type="button" className="on">
                  <span>尝试 #1</span>
                  <span className={`st-badge ${failed ? 'bad' : 'ok'}`}>{code || '-'}</span>
                </button>
              </aside>
              <div className="diag-up-main">
                <div className="diag-up-tabs">
                  <b style={{ marginRight: 'auto' }}>{failed ? `上游 HTTP ${code || ''}` : '上游'}</b>
                  {(
                    [
                      ['ov', '概览'],
                      ['req', '请求'],
                      ['res', failed ? '错误响应' : '响应'],
                      ['err', 'Error Chain'],
                      ['more', 'More'],
                    ] as const
                  ).map(([k, lab]) => (
                    <button
                      key={k}
                      type="button"
                      className={`button secondary compact${upTab === k ? ' on' : ''}`}
                      onClick={() => setUpTab(k)}
                    >
                      {lab}
                    </button>
                  ))}
                </div>
                {upTab === 'ov' ? (
                  <div className="diag-ov-grid">
                    <Card label="开始时间" value={fmtTime(rec.created_at)} />
                    <Card label="耗时" value={fmtMs(rec.duration_ms)} />
                    <Card label="请求方法" value={rec.method || 'POST'} />
                    <Card label="上游状态" value={code ? (failed ? `Error ${code}` : `HTTP ${code}`) : '-'} />
                    <Card label="请求路径" value={rec.endpoint} wide />
                    <Card label="上游 URL" value={rec.upstream_url || '未记录上游 URL'} wide />
                    {errText ? <Card label="错误详情" value={errText} wide /> : null}
                  </div>
                ) : null}
                {upTab === 'req' ? (
                  parseBody(rec.upstream_req_body || rec.req_body).kind === 'empty' && !upReqH ? (
                    <div className="empty-pane">未记录到上游请求。</div>
                  ) : (
                    <div className="diag-stretch">
                      <p className="sub">请求头</p>
                      <pre className="diag-dump">{upReqH || '未记录到 HTTP 请求头。'}</pre>
                      <BodyBlock title="上游请求 Body" raw={rec.upstream_req_body || rec.req_body} onCopy={copyText} />
                    </div>
                  )
                ) : null}
                {upTab === 'res' ? (
                  parseBody(rec.res_body).kind === 'empty' && !resH ? (
                    <div className="empty-pane">{failed ? '未记录到错误响应。' : '未记录到上游响应。'}</div>
                  ) : (
                    <div className="diag-stretch">
                      {resH ? (
                        <>
                          <p className="sub">响应头</p>
                          <pre className="diag-dump">{resH}</pre>
                        </>
                      ) : null}
                      <BodyBlock title="响应 Body" raw={rec.res_body} onCopy={copyText} />
                    </div>
                  )
                ) : null}
                {upTab === 'err' ? (
                  errText ? (
                    <div>
                      <p className="sub">1 层错误</p>
                      <pre className="diag-dump">#1 {errText}</pre>
                    </div>
                  ) : (
                    <div className="empty-pane">没有 Error Chain。</div>
                  )
                ) : null}
                {upTab === 'more' ? (
                  building ? (
                    <div className="empty-pane">正在解析…</div>
                  ) : turns.length ? (
                    turns.map((t, i) => (
                      <div className={`diag-turn${t.role === 'thinking' ? ' reasoning' : ''}`} key={i}>
                        <div className="diag-turn-hd">
                          <b>{`#${i + 1} · ${ROLE_LABEL[t.role] || t.role}`}</b>
                        </div>
                        <pre className="diag-turn-body">{t.content}</pre>
                      </div>
                    ))
                  ) : (
                    <div className="empty-pane">没有可显示的正文。</div>
                  )
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
      {toast ? <div className="toast ok">{toast}</div> : null}
    </div>
  )
}
