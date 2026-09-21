import { useEffect, useState, useSyncExternalStore } from 'react'
import { CalendarCheck2, Copy, Gift, Settings2, Shield, Wand2 } from 'lucide-react'
import { api } from '../../lib/api'
import { formatCredits, setQuotaPerUnit } from '../../lib/format'
import { P, qt } from '../../i18n'
import { navigate } from '../../router/hash'
import { getSiteConfig, subscribeSiteConfig } from '../../config/site'
import { useSession, useToast } from '../../hooks/useStore'
import { ConsoleLayout } from './ConsoleLayout'
import { ConsoleHero } from '../../components/ConsoleHero'

export function OverviewPage({ path }: { path: string }) {
  const session = useSession()
  const site = useSyncExternalStore(subscribeSiteConfig, getSiteConfig, getSiteConfig)
  const name = session?.user?.display_name || session?.user?.username || P('探索者')
  const [self, setSelf] = useState<any>(null)
  const [days, setDays] = useState<{ date: string; requests: number }[]>([])
  const [keyTotal, setKeyTotal] = useState(0)
  const [modelCount, setModelCount] = useState(0)
  const [checkin, setCheckin] = useState<any>(null)
  const [groupInfo, setGroupInfo] = useState<any>(null)
  const [redeem, setRedeem] = useState('')
  const [busy, setBusy] = useState(false)
  const { toast, showToast } = useToast()

  useEffect(() => {
    api.get<{ quota_per_unit: number }>('/api/status', { auth: false }).then((s) => setQuotaPerUnit(s.quota_per_unit))
    api.get('/api/user/self').then(setSelf).catch(() => {})
    api
      .get<{ days: { date: string; requests: number }[] }>('/api/user/dashboard')
      .then((d) => setDays(d.days || []))
      .catch(() => {})
    api
      .get<{ items: unknown[]; total: number }>('/api/token/?p=1&size=10')
      .then((d) => setKeyTotal(d.total ?? d.items?.length ?? 0))
      .catch(() => {})
    api
      .get<{ model_details: unknown[] }>('/api/token/options')
      .then((d) => setModelCount((d.model_details || []).filter((m: any) => !m.planned).length))
      .catch(() => {})
    api.get('/api/user/checkin').then(setCheckin).catch(() => {})
    api.get('/api/user/group').then(setGroupInfo).catch(() => {})
  }, [])

  const maxReq = Math.max(1, ...days.map((d) => d.requests))
  const totalReq = days.reduce((s, d) => s + d.requests, 0)

  async function doRedeem() {
    setBusy(true)
    try {
      const status = await api.get<{ quota_per_unit: number }>('/api/status', { auth: false })
      setQuotaPerUnit(status.quota_per_unit)
      const awarded = await api.post<number>('/api/user/topup', { key: redeem })
      showToast(qt(P('兑换成功，获得 {quota}。'), { quota: formatCredits(awarded) + ' ' + P('点') }))
      setRedeem('')
      setSelf(await api.get('/api/user/self'))
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function copyBase() {
    navigator.clipboard?.writeText(site.apiBaseUrl)
    showToast(P('已复制'))
  }

  return (
    <ConsoleLayout path={path} bare>
      <ConsoleHero title={qt(P('你好，{name}。'), { name })} subtitle={P('每一次好奇，都值得认真回应。')} />


      {groupInfo?.group ? (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-head">
            <h3>
              <Shield size={16} style={{ marginRight: 8, verticalAlign: 'middle' }} />
              {P('用户组')} · {groupInfo.group.name}
            </h3>
            <span className="muted-chip">Lv.{groupInfo.group.level}</span>
          </div>
          <p className="page-lead" style={{ marginTop: 0 }}>
            {groupInfo.group.description || P('你的额度窗口与可用模型由用户组决定。')}
          </p>
          <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
            {groupInfo.credit_unit?.note ||
              P('额度单位：1 点 = 500000 内部单位；BFF /v1 滚动窗口按 token 计入。')}
          </p>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="label">{P('近 5 小时剩余')}</div>
              <div className="value">
                {formatCredits(groupInfo.remaining?.window_5h ?? 0)} <span className="unit">{P('点')}</span>
              </div>
              <div className="hint">
                {P('已用')} {formatCredits(groupInfo.used?.window_5h ?? 0)} /{' '}
                {formatCredits(groupInfo.limits?.window_5h ?? 0)}
              </div>
            </div>
            <div className="stat-card">
              <div className="label">{P('本周剩余')}</div>
              <div className="value">
                {formatCredits(groupInfo.remaining?.week ?? 0)} <span className="unit">{P('点')}</span>
              </div>
              <div className="hint">
                {P('已用')} {formatCredits(groupInfo.used?.week ?? 0)} /{' '}
                {formatCredits(groupInfo.limits?.week ?? 0)}
              </div>
            </div>
            <div className="stat-card">
              <div className="label">{P('本月剩余')}</div>
              <div className="value">
                {formatCredits(groupInfo.remaining?.month ?? 0)} <span className="unit">{P('点')}</span>
              </div>
              <div className="hint">
                {P('已用')} {formatCredits(groupInfo.used?.month ?? 0)} /{' '}
                {formatCredits(groupInfo.limits?.month ?? 0)}
              </div>
            </div>
            <div className="stat-card">
              <div className="label">{P('模型范围')}</div>
              <div className="value" style={{ fontSize: '1rem' }}>
                {(groupInfo.group.model_ids || []).length
                  ? `${groupInfo.group.model_ids.length}`
                  : P('全部')}
              </div>
              <div className="hint">
                {(groupInfo.group.model_ids || []).length
                  ? groupInfo.group.model_ids.slice(0, 3).join(', ')
                  : P('未限制白名单')}
              </div>
            </div>
          </div>
          {groupInfo.progress ? (
            <div style={{ marginTop: 12 }}>
              <div className="muted">
                {P('距下一组进度')} → {groupInfo.progress.next_group_name}
                {groupInfo.override ? ` · ${P('已由管理员固定，不自动晋级')}` : ''}
              </div>
              <div className="tag-row" style={{ marginTop: 8 }}>
                <span className="pill">
                  {P('天数')} {groupInfo.progress.current?.account_days ?? 0}/
                  {groupInfo.progress.requirements?.min_account_days ?? 0} (
                  {Math.round((groupInfo.progress.ratios.account_days || 0) * 100)}%)
                </span>
                <span className="pill">
                  {P('请求')} {groupInfo.progress.current?.request_count ?? 0}/
                  {groupInfo.progress.requirements?.min_request_count ?? 0} (
                  {Math.round((groupInfo.progress.ratios.request_count || 0) * 100)}%)
                </span>
                <span className="pill">
                  {P('用量')} {formatCredits(groupInfo.progress.current?.used_quota ?? 0)}/
                  {formatCredits(groupInfo.progress.requirements?.min_used_quota ?? 0)} (
                  {Math.round((groupInfo.progress.ratios.used_quota || 0) * 100)}%)
                </span>
                <span className="pill">
                  {P('签到')} {groupInfo.progress.current?.checkins ?? 0}/
                  {groupInfo.progress.requirements?.min_checkins ?? 0} (
                  {Math.round((groupInfo.progress.ratios.checkins || 0) * 100)}%)
                </span>
              </div>
            </div>
          ) : (
            <div className="muted" style={{ marginTop: 8 }}>
              {groupInfo.override
                ? P('管理员已覆盖分配本用户组。')
                : P('你已处于当前配置的最高用户组。')}
            </div>
          )}
        </div>
      ) : null}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-top">
            <div className="label">{P('可用额度')}</div>
            <Wand2 size={14} className="stat-icon" />
          </div>
          <div className="value">
            {self ? formatCredits(self.quota) : '—'} <span className="unit">{P('点')}</span>
          </div>
          <div className="hint">{P('签到与兑换所得')}</div>
        </div>
        <div className="stat-card">
          <div className="label">{P('累计使用')}</div>
          <div className="value">
            {self ? formatCredits(self.used_quota ?? self.settled_quota ?? 0) : '—'}{' '}
            <span className="unit">{P('点')}</span>
          </div>
          <div className="hint">{P('账户实际累计消耗')}</div>
        </div>
        <div className="stat-card">
          <div className="label">{P('调用次数')}</div>
          <div className="value">{self?.request_count ?? '—'}</div>
          <div className="hint">{P('账户累计模型请求')}</div>
        </div>
        <div className="stat-card">
          <div className="label">{P('账户并发')}</div>
          <div className="value">{self?.concurrency_limit ?? 5}</div>
          <div className="hint">{P('所有 API 密钥共享')}</div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="panel chart-panel">
          <div className="panel-head">
            <h3>{P('请求趋势')}</h3>
            <span className="muted-chip">{P('最近七天')}</span>
          </div>
          <div className="chart-summary">
            {qt(P('{n} 次请求 · 最近七天'), { n: totalReq })}
          </div>
          <div className="chart-row">
            {days.map((d) => (
              <div key={d.date} className="chart-col-wrap">
                <div
                  className="chart-column"
                  style={{ height: `${Math.max(4, (d.requests / maxReq) * 100)}%` }}
                />
                <span className="chart-day">{d.date.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel workspace-panel">
          <div className="panel-head">
            <h3>{P('工作空间')}</h3>
            <Settings2 size={16} className="muted-icon" />
          </div>
          <button type="button" className="workspace-row" onClick={() => navigate('/keys')}>
            <span>{P('有效密钥')}</span>
            <strong>
              {keyTotal} <span className="chev">→</span>
            </strong>
          </button>
          <button type="button" className="workspace-row" onClick={() => navigate('/models')}>
            <span>{P('已接入模型')}</span>
            <strong>
              {modelCount} <span className="chev">→</span>
            </strong>
          </button>
          <button type="button" className="workspace-row" onClick={() => navigate('/channels')}>
            <span>{P('服务状态')}</span>
            <strong>
              <span className="chev">→</span>
            </strong>
          </button>
          <p className="workspace-note">
            {P('注册不会直接获得额度。完成每日签到可领取 0–5 点公益额度（以当日社区池为准）。')}
          </p>
        </div>
      </div>

      <div className="dashboard-grid duo-cards">
        <div className="panel action-card">
          <div className="action-card-top">
            <div className="action-icon">
              <CalendarCheck2 size={18} />
            </div>
            <span className="pill">{P('每日一份好奇心')}</span>
          </div>
          <h3>{P('新的一天，新的可能')}</h3>
          <p>{P('完成轻量验证，领取今天的公益额度。')}</p>
          <div className="quota-range">0 {P('点')} — 5 {P('点')}</div>
          <div className="tag-row">
            <span className="pill">{P('轻量人机验证')}</span>
            <span className="pill">{P('后台自动检查')}</span>
          </div>
          <button type="button" className="button block soft" onClick={() => navigate('/checkin')}>
            {P('验证并签到')} →
          </button>
          <div className="alert-box">
            {checkin?.unavailable_reason || P('今日社区签到额度已发放完毕，请在北京时间零点后再来')}
          </div>
          <div className="action-foot">
            {qt(P('本月签到 {month} 天 · 累计 {total} 天'), {
              month: checkin?.stats?.checkin_count ?? 0,
              total: checkin?.stats?.total_checkins ?? 0,
            })}
          </div>
        </div>

        <div className="panel action-card">
          <div className="action-card-top">
            <div className="action-icon">
              <Gift size={18} />
            </div>
            <span className="pill">{P('来自社区的心意')}</span>
          </div>
          <h3>{P('给灵感，添一份惊喜')}</h3>
          <p>{P('输入社区发放的兑换码，领取额外额度。')}</p>
          <div className="field">
            <input
              value={redeem}
              onChange={(e) => setRedeem(e.target.value)}
              placeholder={P('在这里粘贴兑换码')}
            />
          </div>
          <button
            type="button"
            className="button secondary block"
            disabled={!redeem.trim() || busy}
            onClick={doRedeem}
          >
            <Gift size={16} /> {busy ? P('正在兑换…') : P('兑换额度')}
          </button>
        </div>
      </div>

      <div className="panel connect-panel">
        <div className="connect-copy">
          <h3>{P('连接你的下一个好想法')}</h3>
          <p>{P('创建密钥，再把这个地址填入客户端的 Base URL。')}</p>
          <div className="endpoint-row">
            <code>{site.apiBaseUrl}</code>
            <button type="button" className="button ghost compact" onClick={copyBase}>
              <Copy size={14} /> {P('复制')}
            </button>
          </div>
        </div>
        <button type="button" className="button" onClick={() => navigate('/keys')}>
          {P('管理 API 密钥')} →
        </button>
      </div>

      <div className="console-disclaimer">
        <Shield size={14} />
        <span>{P('额度仅用于本站模型调用。模型可用性以实际请求与可用列表为准。')}</span>
      </div>

      {toast ? <div className="toast">{toast}</div> : null}
    </ConsoleLayout>
  )
}
