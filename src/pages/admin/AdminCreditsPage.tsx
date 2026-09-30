import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Gift, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { POINT_MP, formatCredits, formatQuotaUnitLabel, getQuotaPerUnit, setQuotaPerUnit } from '../../lib/format'
import { ConsoleHero } from '../../components/ConsoleHero'
import { fmtShanghai } from '../../lib/listUi'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'

type AdminLedgerItem = {
  id: string
  created_at: number
  user_id: string
  ip: string | null
  direction: 'in' | 'out'
  channel_label: string
  /** mp (1 点 = 1e6 mp), fixed at write time */
  amount_mp: number
  operator: string | null
  detail_text: string
}

type CreditConfig = {
  checkin_enabled: boolean
  daily_grant_min: number
  daily_grant_max: number
  timezone?: string
  note?: string
}

type RedeemCode = {
  code: string
  quota: number
  max_uses: number
  used_count: number
  once_per_user: boolean
  enabled: boolean
  note?: string
  expires_at?: string | null
}

type RedeemCodeRow = RedeemCode & {
  /** Client-only identity; editable fields must not be used as React keys. */
  rowKey: string
}

type Summary = {
  config: CreditConfig
  codes: RedeemCode[]
  users: {
    user_id: string
    balance: number
    granted_total: number
    consumed_total: number
    checkins: number
    redeemed: number
  }[]
  credit_unit?: { raw_per_point: number; note?: string }
}

function blankCode(): RedeemCode {
  return {
    code: '',
    quota: 5 * POINT_MP,
    max_uses: 0,
    used_count: 0,
    once_per_user: true,
    enabled: true,
    note: '',
    expires_at: null,
  }
}

export function AdminCreditsPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const [data, setData] = useState<Summary | null>(null)
  const [config, setConfig] = useState<CreditConfig | null>(null)
  const [codes, setCodes] = useState<RedeemCodeRow[]>([])
  const nextCodeKey = useRef(0)

  function withRowKey(code: RedeemCode): RedeemCodeRow {
    nextCodeKey.current += 1
    return { ...code, rowKey: `redeem-code-${nextCodeKey.current}` }
  }
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [grantUserId, setGrantUserId] = useState('')
  const [grantPoints, setGrantPoints] = useState('1')
  const [grantMode, setGrantMode] = useState<'grant' | 'deduct'>('grant')
  const [grantNote, setGrantNote] = useState('')
  const [ledger, setLedger] = useState<AdminLedgerItem[]>([])
  const [ledgerUser, setLedgerUser] = useState('')

  async function loadLedger(userFilter = ledgerUser) {
    try {
      const q = new URLSearchParams({ range: 'all', page_size: '50' })
      if (userFilter.trim()) q.set('user_id', userFilter.trim())
      const r = await api.get<{ items: AdminLedgerItem[] }>('/api/admin/wallet/ledger?' + q.toString())
      setLedger(r.items || [])
    } catch {
      setLedger([])
    }
  }

  async function load() {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      const status = await api.get<{ quota_per_unit: number }>('/api/status', { auth: false })
      setQuotaPerUnit(status.quota_per_unit)
      const s = await api.get<Summary>('/api/admin/credits')
      setData(s)
      setConfig(s.config)
      setCodes((s.codes || []).map(withRowKey))
      void loadLedger()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (gate.allowed) load()
  }, [gate.allowed])

  async function saveConfig() {
    if (!config) return
    setSaving(true)
    setMsg(null)
    setErr(null)
    try {
      const saved = await api.put<CreditConfig>('/api/admin/credits/config', config)
      setConfig(saved)
      setMsg(P('签到配置已保存'))
      await load()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function saveCodes() {
    setSaving(true)
    setMsg(null)
    setErr(null)
    try {
      const cleaned = codes
        .map(({ rowKey: _rowKey, ...c }) => ({
          ...c,
          code: String(c.code || '')
            .trim()
            .toUpperCase(),
        }))
        .filter((c) => c.code)
      const res = await api.put<{ codes: RedeemCode[] }>('/api/admin/credits/codes', { codes: cleaned })
      setCodes((res.codes || []).map(withRowKey))
      setMsg(P('兑换码已保存'))
      await load()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function doGrant(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    setMsg(null)
    const points = Number(grantPoints)
    if (!grantUserId.trim() || !Number.isFinite(points) || points <= 0) {
      setErr(P('请填写用户 ID 与正数点数'))
      return
    }
    try {
      const body = {
        user_id: grantUserId.trim(),
        // 点 (server stores mp; independent of the 点↔token ratio)
        points,
        note: grantNote.trim(),
      }
      if (grantMode === 'deduct') {
        const r = await api.post<{ deducted: number; requested: number }>('/api/admin/credits/deduct', body)
        setMsg(
          r && r.deducted < r.requested
            ? P('余额不足，已按实际余额扣减') + ' ' + formatCredits(r.deducted) + ' ' + P('点')
            : P('已扣减额度'),
        )
      } else {
        await api.post('/api/admin/credits/grant', body)
        setMsg(P('已发放额度'))
      }
      setGrantUserId('')
      setGrantNote('')
      await load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  function updateCode(index: number, patch: Partial<RedeemCode>) {
    setCodes((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  }

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero
        title={P('签到与兑换')}
        subtitle={P('配置每日签到发放额度与兑换码；额度进入本站积分钱包，可在组额度用尽时继续调用。')}
      />

      <div className="panel" style={{ marginTop: 12 }}>
        <strong>{P('点数 ↔ token')}</strong>
        <p className="muted" style={{ margin: '6px 0 0' }}>
          {formatQuotaUnitLabel(getQuotaPerUnit())}
        </p>
        <p className="field-note" style={{ margin: '4px 0 0' }}>
          {P('换算比例只影响模型价格与每次调用扣除的点数；用户余额、签到额度、兑换码额度均以点计，不随比例变化。')}
        </p>
      </div>

      {err ? <div className="alert-box">{err}</div> : null}
      {msg ? <div className="toast">{msg}</div> : null}

      <div className="panel" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
          <Gift size={16} />
          <strong>{P('每日签到')}</strong>
          <button type="button" className="button ghost" onClick={load} disabled={loading}>
            <RefreshCw size={14} /> {P('刷新')}
          </button>
          <button type="button" className="button" onClick={saveConfig} disabled={saving || !config}>
            <Save size={14} /> {P('保存配置')}
          </button>
        </div>
        {config ? (
          <>
            <p className="muted" style={{ fontSize: 13 }}>
              {formatQuotaUnitLabel(data?.credit_unit?.raw_per_point || getQuotaPerUnit())}
            </p>
            <div className="stats-grid" style={{ marginTop: 8 }}>
              <div className="field">
                <label>{P('启用签到')}</label>
                <select
                  value={config.checkin_enabled ? '1' : '0'}
                  onChange={(e) => setConfig({ ...config, checkin_enabled: e.target.value === '1' })}
                >
                  <option value="1">{P('开启')}</option>
                  <option value="0">{P('关闭')}</option>
                </select>
              </div>
              <div className="field">
                <label>{P('每日发放下限（点）')}</label>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={config.daily_grant_min / POINT_MP}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      daily_grant_min: Math.round(Number(e.target.value || 0) * POINT_MP),
                    })
                  }
                />
              </div>
              <div className="field">
                <label>{P('每日发放上限（点）')}</label>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={config.daily_grant_max / POINT_MP}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      daily_grant_max: Math.round(Number(e.target.value || 0) * POINT_MP),
                    })
                  }
                />
              </div>
              <div className="field">
                <label>{P('时区')}</label>
                <input value={config.timezone || 'Asia/Shanghai'} disabled />
              </div>
            </div>
            <p className="field-note">
              {P('下限=上限时固定发放；否则在区间内随机。点数不随「点数 ↔ token」换算比例变化。')}
            </p>
          </>
        ) : (
          <p className="inline-loading">{loading ? P('加载中…') : P('无数据')}</p>
        )}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
          <strong>{P('兑换码')}</strong>
          <button
            type="button"
            className="button ghost"
            onClick={() => setCodes((prev) => [...prev, withRowKey(blankCode())])}
          >
            <Plus size={14} /> {P('添加')}
          </button>
          <button type="button" className="button" onClick={saveCodes} disabled={saving}>
            <Save size={14} /> {P('保存兑换码')}
          </button>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{P('代码')}</th>
                <th>{P('额度（点）')}</th>
                <th>{P('全局上限')}</th>
                <th>{P('已兑')}</th>
                <th>{P('启用')}</th>
                <th>{P('备注')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {codes.map((c, i) => (
                <tr key={c.rowKey}>
                  <td>
                    <input
                      value={c.code}
                      onChange={(e) => updateCode(i, { code: e.target.value.toUpperCase() })}
                      placeholder="WELCOME"
                      style={{ width: 120 }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={c.quota / POINT_MP}
                      onChange={(e) =>
                        updateCode(i, { quota: Math.round(Number(e.target.value || 0) * POINT_MP) })
                      }
                      style={{ width: 80 }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      value={c.max_uses}
                      onChange={(e) => updateCode(i, { max_uses: Number(e.target.value) || 0 })}
                      title={P('0 = 不限全局次数（仍每人一次）')}
                      style={{ width: 70 }}
                    />
                  </td>
                  <td>{c.used_count}</td>
                  <td>
                    <select
                      value={c.enabled ? '1' : '0'}
                      onChange={(e) => updateCode(i, { enabled: e.target.value === '1' })}
                    >
                      <option value="1">{P('是')}</option>
                      <option value="0">{P('否')}</option>
                    </select>
                  </td>
                  <td>
                    <input
                      value={c.note || ''}
                      onChange={(e) => updateCode(i, { note: e.target.value })}
                      style={{ width: 140 }}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button ghost compact"
                      onClick={() => setCodes((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="field-note">{P('默认每人每个码仅可兑一次；全局上限 0 表示不限制总次数。')}</p>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <strong>{P('手动发放 / 扣减')}</strong>
        <form className="guest-aily-form" onSubmit={doGrant} style={{ marginTop: 10 }}>
          <div className="field">
            <label>{P('操作')}</label>
            <select value={grantMode} onChange={(e) => setGrantMode(e.target.value as 'grant' | 'deduct')}>
              <option value="grant">{P('发放')}</option>
              <option value="deduct">{P('扣减')}</option>
            </select>
          </div>
          <div className="field">
            <label>{P('用户 ID')}</label>
            <input
              value={grantUserId}
              onChange={(e) => setGrantUserId(e.target.value)}
              placeholder="local:… 或 linux.do id"
            />
          </div>
          <div className="field">
            <label>{P('点数')}</label>
            <input
              type="number"
              min={0.001}
              step={0.1}
              value={grantPoints}
              onChange={(e) => setGrantPoints(e.target.value)}
            />
          </div>
          <div className="field">
            <label>{P('备注（用户可见）')}</label>
            <input value={grantNote} maxLength={120} onChange={(e) => setGrantNote(e.target.value)} placeholder={P('可选')} />
          </div>
          <button type="submit" className="button">
            {grantMode === 'deduct' ? P('扣减') : P('发放')}
          </button>
        </form>
        <p className="field-note">{P('扣减不会低于 0；每次操作都会记入该用户钱包流水（用户侧不显示管理员 IP 与操作人）。')}</p>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>{P('钱包流水（最近 50 条）')}</strong>
          <input
            value={ledgerUser}
            onChange={(e) => setLedgerUser(e.target.value)}
            placeholder={P('按用户 ID 过滤')}
            style={{ maxWidth: 240 }}
          />
          <button type="button" className="button ghost" onClick={() => void loadLedger()}>
            <RefreshCw size={14} /> {P('查询')}
          </button>
        </div>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="data wallet-table">
            <thead>
              <tr>
                <th>{P('时间日期')}</th>
                <th>{P('用户')}</th>
                <th>{P('IP地址')}</th>
                <th>{P('方式')}</th>
                <th>{P('途径')}</th>
                <th className="num">{P('点数')}</th>
                <th>{P('操作人')}</th>
                <th className="detail">{P('详细信息')}</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((x) => (
                <tr key={x.id}>
                  <td className="muted">{fmtShanghai(x.created_at)}</td>
                  <td>
                    <code>{x.user_id}</code>
                  </td>
                  <td>{x.ip || '—'}</td>
                  <td>{x.direction === 'in' ? P('收入') : P('支出')}</td>
                  <td>{P(x.channel_label)}</td>
                  <td className={'num ' + (x.direction === 'in' ? 'wallet-in' : 'wallet-out')}>
                    {(x.direction === 'in' ? '+' : '-') + formatCredits(x.amount_mp)}
                  </td>
                  <td>{x.operator || '—'}</td>
                  <td className="detail">{x.detail_text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!ledger.length ? <p className="empty-state">{P('暂无记录')}</p> : null}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <strong>{P('用户额度快照')}</strong>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="data">
            <thead>
              <tr>
                <th>{P('用户')}</th>
                <th>{P('余额')}</th>
                <th>{P('累计发放')}</th>
                <th>{P('累计消耗')}</th>
                <th>{P('签到')}</th>
                <th>{P('兑换')}</th>
              </tr>
            </thead>
            <tbody>
              {(data?.users || []).map((u) => (
                <tr key={u.user_id}>
                  <td>
                    <code>{u.user_id}</code>
                  </td>
                  <td>
                    {formatCredits(u.balance)} {P('点')}
                  </td>
                  <td>{formatCredits(u.granted_total)}</td>
                  <td>{formatCredits(u.consumed_total)}</td>
                  <td>{u.checkins}</td>
                  <td>{u.redeemed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data?.users?.length ? <p className="empty-state">{P('尚无签到/兑换记录。')}</p> : null}
      </div>
    </AdminLayout>
  )
}
