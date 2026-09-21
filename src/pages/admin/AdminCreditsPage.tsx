import { useEffect, useState, type FormEvent } from 'react'
import { Gift, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { formatCredits, setQuotaPerUnit } from '../../lib/format'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'

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

const Q = 500_000

function blankCode(): RedeemCode {
  return {
    code: '',
    quota: 5 * Q,
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
  const [codes, setCodes] = useState<RedeemCode[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [grantUserId, setGrantUserId] = useState('')
  const [grantPoints, setGrantPoints] = useState('1')

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
      setCodes(s.codes || [])
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
        .map((c) => ({
          ...c,
          code: String(c.code || '')
            .trim()
            .toUpperCase(),
        }))
        .filter((c) => c.code)
      const res = await api.put<{ codes: RedeemCode[] }>('/api/admin/credits/codes', { codes: cleaned })
      setCodes(res.codes || [])
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
      await api.post('/api/admin/credits/grant', {
        user_id: grantUserId.trim(),
        amount: Math.round(points * Q),
        note: 'admin-grant',
      })
      setMsg(P('已发放额度'))
      setGrantUserId('')
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
              {config.note || data?.credit_unit?.note || P('1 点 = 500000 内部单位；日界 Asia/Shanghai。')}
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
                  value={config.daily_grant_min / Q}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      daily_grant_min: Math.round(Number(e.target.value || 0) * Q),
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
                  value={config.daily_grant_max / Q}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      daily_grant_max: Math.round(Number(e.target.value || 0) * Q),
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
              {P('下限=上限时固定发放；否则在区间内随机。单位与 Phase E 一致。')}
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
            onClick={() => setCodes((prev) => [...prev, blankCode()])}
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
                <tr key={`${c.code}-${i}`}>
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
                      value={c.quota / Q}
                      onChange={(e) =>
                        updateCode(i, { quota: Math.round(Number(e.target.value || 0) * Q) })
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
        <strong>{P('手动发放')}</strong>
        <form className="guest-aily-form" onSubmit={doGrant} style={{ marginTop: 10 }}>
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
          <button type="submit" className="button">
            {P('发放')}
          </button>
        </form>
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
