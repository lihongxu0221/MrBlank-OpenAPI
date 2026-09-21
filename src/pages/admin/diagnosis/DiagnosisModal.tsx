import { useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { api } from '../../../lib/api'
import { P } from '../../../i18n'
import { Files, FormatPane, loadTurns, ROLE } from './format-pane'
import { BodyView, EmptyPane, parseBody, prettyHeaders } from './json-tree'

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
  amount?: number | string | null
  is_stream?: boolean
  group?: string
  content?: string
  has_detail?: boolean
  dialog?: unknown
  req_headers?: Record<string, string> | string
  req_body?: string
  res_headers?: Record<string, string> | string
  res_body?: string
  upstream_req_headers?: Record<string, string> | string
  upstream_req_body?: string
}

type MainTab = 'overview' | 'request' | 'upstream'
type UpTab = 'ov' | 'req' | 'res' | 'err' | 'fmt'

type Turn = {
  role: string
  content?: string
  files?: unknown[]
  n?: number
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

function fmtMoney(v?: number | string | null) {
  if (v == null || v === '') return '-'
  const n = Number(v)
  if (Number.isNaN(n)) return String(v)
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 6 })
}

function Card({ label, value, wide }: { label: string; value: unknown; wide?: boolean }) {
  return (
    <div className={`diag-card${wide ? ' wide' : ''}`}>
      <span>{label}</span>
      <b>{value == null || value === '' ? '-' : String(value)}</b>
    </div>
  )
}

function useBoxResize(ref: React.RefObject<HTMLDivElement | null>, maximized: boolean) {
  return (e: React.MouseEvent) => {
    if (maximized) return
    const box = ref.current
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
}

export function DiagnosisModal({ id, onClose }: { id: string; onClose: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const preMax = useRef<{ w: string; h: string } | null>(null)
  const [maximized, setMaximized] = useState(false)
  const onResize = useBoxResize(boxRef, maximized)
  const [tab, setTab] = useState<MainTab>('overview')
  const [upTab, setUpTab] = useState<UpTab>('ov')
  const [rec, setRec] = useState<DiagnosisRec | null>(null)
  const [err, setErr] = useState('')
  const [toast, setToast] = useState('')
  const [turnsBuilding, setTurnsBuilding] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const toastTimer = useRef<number | null>(null)

  useEffect(() => {
    let stop = false
    let gen = 0
    setRec(null)
    setErr('')
    setTab('overview')
    setUpTab('ov')
    setMaximized(false)
    preMax.current = null
    setTurns([])
    setTurnsBuilding(false)
    api
      .get<DiagnosisRec>(`/api/admin/diagnosis/logs/${encodeURIComponent(id)}`)
      .then((d) => {
        if (stop) return
        if (!d?.id) {
          setErr('记录不存在')
          return
        }
        setRec(d)
        const my = ++gen
        setTurnsBuilding(true)
        setTurns([])
        const paint = () =>
          new Promise<void>((resolve) => {
            if (typeof requestAnimationFrame === 'function') {
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            } else setTimeout(resolve, 0)
          })
        paint()
          .then(() => new Promise<void>((r) => setTimeout(r, 0)))
          .then(() => {
            if (stop || my !== gen) return
            const built = loadTurns(d) as Turn[]
            if (stop || my !== gen) return
            setTurns(built)
            setTurnsBuilding(false)
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
      gen += 1
      document.removeEventListener('keydown', onKey)
    }
  }, [id, onClose])

  function ping(msg: string) {
    setToast(msg)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 1600)
  }

  function copyText(text: string) {
    if (!text) return
    navigator.clipboard.writeText(text).then(() => ping('已复制')).catch(() => ping(text))
  }

  function copyField(field: string, pretty?: string) {
    if (!rec) return
    if (pretty) {
      copyText(pretty)
      return
    }
    const v = (rec as Record<string, unknown>)[field]
    if (v == null || v === '') {
      ping('无可复制内容')
      return
    }
    const p = parseBody(v)
    copyText(p.kind === 'json' ? JSON.stringify(p.value, null, 2) : String(v))
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

  function close() {
    setMaximized(false)
    preMax.current = null
    onClose()
  }

  const code = rec ? Number(rec.status_code) || 0 : 0
  const failed = !!(rec && (code >= 400 || Number(rec.type) === 5))
  const headers = rec ? prettyHeaders(rec.req_headers) : ''
  const upReqH = rec ? prettyHeaders(rec.upstream_req_headers) : ''
  const resH = rec ? prettyHeaders(rec.res_headers) : ''
  const errText = rec && failed && rec.content ? rec.content : ''

  function upPane() {
    if (!rec) return null
    if (upTab === 'fmt') return <FormatPane rec={rec} building={turnsBuilding} />
    if (upTab === 'req') {
      const emptyBody = parseBody(rec.upstream_req_body || rec.req_body).kind === 'empty'
      if (!upReqH && emptyBody) return <EmptyPane>未记录到上游请求。</EmptyPane>
      return (
        <div className="body-view stretch-stack">
          <div className="stretch-headers">
            <p className="sub">请求头</p>
            <div className="diag-dump stretch-dump">{upReqH || '未记录到 HTTP 请求头。'}</div>
          </div>
          {!emptyBody ? (
            <BodyView
              title="上游请求 Body"
              raw={rec.upstream_req_body || rec.req_body}
              field="upstream_req_body"
              onCopy={copyField}
            />
          ) : null}
        </div>
      )
    }
    if (upTab === 'res') {
      const hasBody = parseBody(rec.res_body).kind !== 'empty'
      if (!resH && !hasBody) {
        return <EmptyPane>{failed ? '未记录到错误响应。' : '未记录到上游响应。'}</EmptyPane>
      }
      return (
        <div className="body-view stretch-stack">
          {resH ? (
            <div className="stretch-headers compact">
              <p className="sub">响应头</p>
              <div className="diag-dump stretch-dump">{resH}</div>
            </div>
          ) : null}
          {hasBody ? (
            <BodyView title="响应 Body" raw={rec.res_body} field="res_body" onCopy={copyField} />
          ) : null}
        </div>
      )
    }
    if (upTab === 'err') {
      return errText ? (
        <div className="body-view">
          <p className="sub">1 层错误</p>
          <div className="diag-dump">#1 {errText}</div>
        </div>
      ) : (
        <EmptyPane>没有 Error Chain。</EmptyPane>
      )
    }
    return (
      <div className="diag-ov-grid">
        <Card label="开始时间" value={fmtTime(rec.created_at)} />
        <Card label="耗时" value={fmtMs(rec.duration_ms)} />
        <Card label="请求方法" value={rec.method || 'POST'} />
        <Card label="上游状态" value={code ? (failed ? `Error ${code}` : `HTTP ${code}`) : '-'} />
        <Card label="请求路径" value={rec.endpoint} wide />
        <Card label="上游 URL" value={rec.upstream_url || '未记录上游 URL'} wide />
        {errText ? <Card label="错误详情" value={errText} wide /> : null}
      </div>
    )
  }

  return (
    <div
      className={`diag-backdrop${maximized ? ' max' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
      data-testid="request-diagnosis-modal"
    >
      <div
        className={`diag-modal${maximized ? ' maximized' : ''}`}
        ref={boxRef}
        onClick={(e) => e.stopPropagation()}
      >
        {!maximized ? <div className="diag-resize" onMouseDown={onResize} /> : null}
        <div className="diag-head">
          <div className="diag-title-row">
            <div className="diag-title">
              <h2>{P('请求诊断详情')}</h2>
              {code ? <span className={`st-badge ${failed ? 'bad' : 'ok'}`}>{code}</span> : null}
            </div>
            <nav className="diag-tabs" role="tablist" aria-label={P('请求诊断详情')}>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'overview'}
                className={tab === 'overview' ? 'on' : ''}
                onClick={() => setTab('overview')}
              >
                {P('请求概览')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'request'}
                className={tab === 'request' ? 'on' : ''}
                onClick={() => setTab('request')}
              >
                {P('请求信息')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'upstream'}
                className={tab === 'upstream' ? 'on' : ''}
                onClick={() => setTab('upstream')}
              >
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
              <button type="button" className="icon-button" onClick={close} aria-label={P('关闭')}>
                <X size={18} />
              </button>
            </div>
          </div>
          <p className="diag-meta">
            {rec
              ? [rec.id, rec.ip, rec.endpoint, fmtTime(rec.created_at)].filter(Boolean).join(' · ')
              : P('加载中…')}
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
                <Card label="金额" value={fmtMoney(rec.amount)} />
                <Card label="流式" value={rec.is_stream ? '是' : '否'} />
                <Card label="分组" value={rec.group || '-'} />
                {errText ? <Card label="错误" value={errText} wide /> : null}
              </div>
              {turnsBuilding ? (
                <div className="empty-pane" data-testid="diagnosis-timeline-skeleton">
                  正在解析对话回合…
                </div>
              ) : turns.length ? (
                turns.map((t, i) => (
                  <div
                    className={`diag-turn turn${t.role === 'thinking' || t.role === 'reasoning' ? ' reasoning' : ''}`}
                    key={i}
                  >
                    <div className="diag-turn-hd turn-hd">
                      <b>{`#${i + 1} · ${(ROLE as Record<string, string>)[t.role] || t.role}`}</b>
                    </div>
                    {t.content ? (
                      <pre className="diag-turn-body turn-body">{t.content}</pre>
                    ) : (
                      <div className="turn-empty">无文本</div>
                    )}
                    <Files files={t.files} />
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
                <button
                  type="button"
                  className="button secondary compact"
                  onClick={() => copyText(rec.endpoint || '')}
                >
                  复制
                </button>
              </div>
              {headers ? (
                <div className="diag-dump">{headers}</div>
              ) : (
                <EmptyPane>未记录到 HTTP 请求头。</EmptyPane>
              )}
              <BodyView title="请求 Body" raw={rec.req_body} field="req_body" onCopy={copyField} />
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
                      ['fmt', 'More'],
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
                {upPane()}
              </div>
            </div>
          )}
        </div>
      </div>
      {toast ? <div className="toast ok">{toast}</div> : null}
    </div>
  )
}
