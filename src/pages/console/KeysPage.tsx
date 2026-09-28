import { useEffect, useState, type ChangeEvent } from 'react'
import { KeyRound, Plus } from 'lucide-react'
import { api } from '../../lib/api'
import { formatCredits, pointsToQuota, quotaToPoints, setQuotaPerUnit, stName } from '../../lib/format'
import { P } from '../../i18n'
import { ConsoleLayout } from './ConsoleLayout'
import { ConsoleHero } from '../../components/ConsoleHero'
import { useToast } from '../../hooks/useStore'
import { Modal } from '../../components/Modal'

type RateWindow = { id: string; label: string; used: number; cap: number; pct: number }

type Token = {
  id: number
  name: string
  key: string
  status: number
  unlimited_quota: boolean
  remain_quota: number
  used_quota?: number
  used_amount?: number
  max_concurrency?: number
  rate_limit_enabled?: boolean
  rate_limit_5h?: number
  rate_limit_7d?: number
  rate_limit_30d?: number
  rate_windows?: RateWindow[]
  expired_time: number
}

type KeyForm = {
  name: string
  max_concurrency: number | string
  unlimited_quota: boolean
  remain_quota: number | string
  rate_limit_enabled: boolean
  rate_limit_5h: number | string
  rate_limit_7d: number | string
  rate_limit_30d: number | string
  enabled: boolean
}

const empty: KeyForm = {
  name: '',
  max_concurrency: 0,
  unlimited_quota: true,
  remain_quota: 10,
  rate_limit_enabled: false,
  rate_limit_5h: 0,
  rate_limit_7d: 0,
  rate_limit_30d: 0,
  enabled: true,
}

function pointsTip(n: number) {
  return formatCredits(Number(n) || 0) + ' 点'
}

function rateWindowsOf(t: Token): RateWindow[] {
  if (Array.isArray(t.rate_windows) && t.rate_windows.length) return t.rate_windows
  if (!t?.rate_limit_enabled) return []
  return [
    { id: '5h', label: '5h', used: 0, cap: Number(t.rate_limit_5h) || 0, pct: 0 },
    { id: 'week', label: '周', used: 0, cap: Number(t.rate_limit_7d) || 0, pct: 0 },
    { id: 'month', label: '月', used: 0, cap: Number(t.rate_limit_30d) || 0, pct: 0 },
  ]
}

export function RateBars({ windows }: { windows: RateWindow[] }) {
  if (!windows?.length) return <span className="muted">—</span>
  return (
    <div className="rate-bars">
      {windows.map((w) => {
        const cap = Number(w.cap) || 0
        const used = Number(w.used) || 0
        const pct = cap > 0 ? Math.min(100, Number(w.pct) || 0) : 0
        const cls = !cap ? '' : pct >= 100 ? 'over' : pct >= 80 ? 'hot' : ''
        const label = cap ? String(pct).replace(/\.0$/, '') + '%' : '不限'
        return (
          <div className="rate-bar" key={w.id} title={pointsTip(used) + ' / ' + (cap ? pointsTip(cap) : '不限')}>
            <span className="rate-lab">{w.label}</span>
            <div className="rate-track">
              <i className={cls} style={{ width: pct + '%' }} />
            </div>
            <span className="rate-pct">{label}</span>
          </div>
        )
      })}
    </div>
  )
}

export function KeysPage({ path }: { path: string }) {
  const [list, setList] = useState<Token[] | null>(null)
  const [edit, setEdit] = useState<number | 'new' | null>(null)
  const [form, setForm] = useState(empty)
  const [msg, setMsg] = useState<{ cls: string; text: string } | null>(null)
  const [created, setCreated] = useState<string | null>(null)
  const [windows, setWindows] = useState<RateWindow[]>([])
  const [apiBase, setApiBase] = useState('https://openapi.juc114.cn/v1')
  const [demoMasked, setDemoMasked] = useState<string | null>(null)
  const { toast, showToast } = useToast()

  async function load() {
    const status = await api.get<{ quota_per_unit: number; raw_per_point?: number; credit_unit?: { raw_per_point?: number } }>('/api/status', { auth: false })
    const rawPerPoint = Number(status.raw_per_point || status.credit_unit?.raw_per_point || status.quota_per_unit) || 500000
    setQuotaPerUnit(rawPerPoint)
    const data = await api.get<{
      items: Token[]
      total: number
      api_base_url?: string
      demo_key_masked?: string | null
    }>('/api/token/?p=1&page_size=100')
    setList(data.items || [])
    if (data.api_base_url) setApiBase(data.api_base_url)
    if (data.demo_key_masked !== undefined) setDemoMasked(data.demo_key_masked)
  }

  useEffect(() => {
    load().catch((e) => {
      setList([])
      showToast(e.message)
    })
  }, [])

  const set =
    (k: keyof KeyForm) => (e: ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({
        ...f,
        [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
      }))

  function openCreate() {
    setEdit('new')
    setForm(empty)
    setWindows([])
    setMsg(null)
  }

  function openEdit(t: Token) {
    setEdit(t.id)
    setWindows(rateWindowsOf(t))
    setForm({
      name: t.name,
      max_concurrency: t.max_concurrency || 0,
      unlimited_quota: !!t.unlimited_quota,
      remain_quota: t.unlimited_quota ? 10 : quotaToPoints(t.remain_quota),
      rate_limit_enabled: !!t.rate_limit_enabled,
      rate_limit_5h: quotaToPoints(t.rate_limit_5h || 0),
      rate_limit_7d: quotaToPoints(t.rate_limit_7d || 0),
      rate_limit_30d: quotaToPoints(t.rate_limit_30d || 0),
      enabled: t.status === 1,
    })
    setMsg(null)
  }

  async function save() {
    const body = {
      name: String(form.name).trim(),
      max_concurrency: Number(form.max_concurrency) || 0,
      unlimited_quota: form.unlimited_quota,
      remain_quota: form.unlimited_quota ? 0 : pointsToQuota(Number(form.remain_quota)),
      rate_limit_enabled: form.rate_limit_enabled,
      rate_limit_5h: pointsToQuota(Number(form.rate_limit_5h)),
      rate_limit_7d: pointsToQuota(Number(form.rate_limit_7d)),
      rate_limit_30d: pointsToQuota(Number(form.rate_limit_30d)),
      status: form.enabled ? 1 : 2,
      expired_time: -1,
    }
    try {
      if (edit === 'new') {
        const createdTok = await api.post<Token>('/api/token/', body)
        if (createdTok?.key && !String(createdTok.key).includes('****')) {
          setCreated(createdTok.key)
        }
        showToast(P('密钥已创建'))
      } else {
        await api.put(`/api/token/${edit}`, body)
        showToast(P('已保存'))
      }
      setEdit(null)
      await load()
    } catch (e) {
      setMsg({ cls: 'err', text: (e as Error).message || P('失败') })
    }
  }

  async function del(id: number) {
    if (!confirm(P('删除该 Key？'))) return
    try {
      await api.delete(`/api/token/${id}`)
      await load()
      showToast(P('已删除'))
    } catch (e) {
      showToast((e as Error).message)
    }
  }

  async function copyKey(id: number) {
    try {
      const data = await api.get<{ key: string } | string>(`/api/token/${id}/key`)
      const key = typeof data === 'string' ? data : data?.key
      if (key) {
        await navigator.clipboard.writeText(String(key))
        showToast(P('已复制'))
      }
    } catch (e) {
      showToast((e as Error).message)
    }
  }

  async function resetLimit(id: number | 'new') {
    if (id === 'new') return
    if (!confirm(P('确定重置该 Key 的限流窗口已用量？窗口内已消费将从现在起重新累计。'))) return
    try {
      const data = await api.put<Token>(`/api/token/${id}`, { reset_rate_limit_usage: true })
      if (edit === id && data) setWindows(rateWindowsOf(data))
      setMsg({ cls: 'ok', text: P('限额已重置') })
      showToast(P('限额已重置'))
      await load()
    } catch (e) {
      setMsg({ cls: 'err', text: (e as Error).message || P('重置失败') })
    }
  }

  return (
    <ConsoleLayout path={path} bare>
      <ConsoleHero title={P('API 密钥')} subtitle={P('Bearer sk-... 调用 /v1，完整密钥仅创建时可见')} />

      <div className="keys-toolbar">
        <p>{P('为每一个工具，创建专属的访问密钥。')}</p>
        <button type="button" className="button" onClick={openCreate}>
          <Plus size={16} /> {P('新建')}
        </button>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="eyebrow">Base URL</div>
        <div className="endpoint-row" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <code>{apiBase}</code>
          <button
            type="button"
            className="button ghost compact"
            onClick={() => {
              navigator.clipboard?.writeText(apiBase)
              showToast(P('已复制'))
            }}
          >
            {P('复制')}
          </button>
        </div>
        {demoMasked ? (
          <p className="field-note" style={{ marginTop: 8 }}>
            {P('共享演示密钥（只读展示）')}：<code>{demoMasked}</code>
            {' — '}
            {P('请创建你自己的密钥用于调用；管理密钥不会下发到浏览器。')}
          </p>
        ) : null}
      </div>

      {created ? (
        <div className="status ok keys-created">
          {P('新密钥（只显示一次）')}：<code>{created}</code>
          <button
            type="button"
            className="button ghost compact"
            style={{ marginLeft: 8 }}
            onClick={() => {
              navigator.clipboard?.writeText(created)
              showToast(P('已复制'))
            }}
          >
            {P('复制')}
          </button>
          <button type="button" className="button ghost compact" onClick={() => setCreated(null)}>
            {P('关闭')}
          </button>
        </div>
      ) : null}

      {!edit && msg ? <div className={'status ' + msg.cls}>{msg.text}</div> : null}

      {list === null ? (
        <div className="empty-state panel">{P('加载中…')}</div>
      ) : !list.length ? (
        <div className="empty-state panel empty-state-rich">
          <div className="empty-icon">
            <KeyRound size={36} strokeWidth={1.4} />
          </div>
          <h3>{P('还没有 API 密钥')}</h3>
          <p>{P('创建一个密钥，让你的工具连接公益模型。')}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{P('名称')}</th>
                <th>{P('状态')}</th>
                <th>Key</th>
                <th>{P('并发')}</th>
                <th>{P('剩余点数')}</th>
                <th>{P('已用点数')}</th>
                <th>{P('限速')}</th>
                <th>{P('操作')}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.name}</strong>
                  </td>
                  <td>
                    <span className="badge">{stName(t.status)}</span>
                  </td>
                  <td>
                    <code className="masked-key">{t.key}</code>
                  </td>
                  <td className="num">{t.max_concurrency || P('不限')}</td>
                  <td className="num">{t.unlimited_quota ? P('无限') : formatCredits(t.remain_quota) + ' ' + P('点')}</td>
                  <td className="num">{formatCredits(t.used_quota || 0) + ' ' + P('点')}</td>
                  <td>
                    {t.rate_limit_enabled ? (
                      <div className="rate-cell">
                        <RateBars windows={rateWindowsOf(t)} />
                        <button type="button" className="rate-reset" onClick={() => resetLimit(t.id)}>
                          {P('重置限额')}
                        </button>
                      </div>
                    ) : (
                      <span className="muted">{P('关闭')}</span>
                    )}
                  </td>
                  <td className="row-actions">
                    <button type="button" className="button ghost" onClick={() => copyKey(t.id)}>
                      {P('复制')}
                    </button>
                    <button type="button" className="button ghost" onClick={() => openEdit(t)}>
                      {P('编辑')}
                    </button>
                    <button type="button" className="button ghost" onClick={() => del(t.id)}>
                      {P('删除')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit ? (
        <Modal title={edit === 'new' ? P('新建 API Key') : P('编辑 API Key')} onClose={() => setEdit(null)}>
          <div className="field">
            <label>{P('名称')}</label>
            <input value={form.name} onChange={set('name')} />
          </div>
          <div className="field">
            <label>{P('并发数（0 不限）')}</label>
            <input type="number" min={0} value={form.max_concurrency} onChange={set('max_concurrency')} />
          </div>
          <label className="chk">
            <input type="checkbox" checked={form.unlimited_quota} onChange={set('unlimited_quota')} /> {P('无限点数')}
          </label>
          <div className="field">
            <label>{P('额度（点）')}</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.remain_quota}
              disabled={form.unlimited_quota}
              onChange={set('remain_quota')}
            />
          </div>
          <label className="chk">
            <input type="checkbox" checked={form.rate_limit_enabled} onChange={set('rate_limit_enabled')} />{' '}
            {P('速率限制')}
          </label>
          {form.rate_limit_enabled ? (
            <>
              <p className="field-note">{P('0 = 不限制。进度按当前窗口已用点数计算。')}</p>
              {windows.length ? <RateBars windows={windows} /> : null}
              <div className="rate-fields">
                <label>
                  {P('5小时（点）')}
                  <input type="number" min={0} step="0.01" value={form.rate_limit_5h} onChange={set('rate_limit_5h')} />
                </label>
                <label>
                  {P('周（点）')}
                  <input type="number" min={0} step="0.01" value={form.rate_limit_7d} onChange={set('rate_limit_7d')} />
                </label>
                <label>
                  {P('月（点）')}
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.rate_limit_30d}
                    onChange={set('rate_limit_30d')}
                  />
                </label>
              </div>
              {edit !== 'new' ? (
                <button type="button" className="button secondary rate-reset-btn" onClick={() => resetLimit(edit)}>
                  {P('重置限额')}
                </button>
              ) : null}
            </>
          ) : null}
          <label className="chk">
            <input type="checkbox" checked={form.enabled} onChange={set('enabled')} /> {P('启用')}
          </label>
          <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end', display: 'flex', gap: 8 }}>
            <button type="button" className="button secondary" onClick={() => setEdit(null)}>
              {P('取消')}
            </button>
            <button type="button" className="button" onClick={() => save()}>
              {P('保存')}
            </button>
          </div>
          {msg ? <div className={'status ' + msg.cls}>{msg.text}</div> : null}
        </Modal>
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </ConsoleLayout>
  )
}
