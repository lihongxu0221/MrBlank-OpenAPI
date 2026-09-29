import { CalendarCheck2 } from 'lucide-react'
import { formatCredits } from '../lib/format'
import { P, qt } from '../i18n'

/** Shared daily check-in claim card — Overview embed and #/checkin must stay identical. */
export function CheckinClaimCard({
  data,
  className,
  actionDisabled,
  actionBusy,
  actionLabel,
  onAction,
}: {
  data: any | null
  className?: string
  actionDisabled?: boolean
  actionBusy?: boolean
  /** CTA label. Overview navigate-only should pass「去签到」; claim page keeps default. */
  actionLabel?: string
  onAction: () => void
}) {
  const checkedIn = !!data?.stats?.checked_in_today
  // Never fall back to a static 0–5 (or 0–0) range while stats are loading.
  const rangeReady =
    data != null &&
    Number.isFinite(Number(data.min_quota)) &&
    Number.isFinite(Number(data.max_quota))
  const minQ = rangeReady ? formatCredits(Number(data.min_quota)) : '—'
  const maxQ = rangeReady ? formatCredits(Number(data.max_quota)) : '—'

  return (
    <div className={`panel action-card${className ? ` ${className}` : ''}`}>
      <div className="action-card-top">
        <div className="action-icon">
          <CalendarCheck2 size={18} />
        </div>
        <span className="pill">{P('每日一份好奇心')}</span>
      </div>
      <h3>{checkedIn ? P('今天的探索额度，已到账') : P('新的一天，新的可能')}</h3>
      <p>{P('完成轻量验证，领取今天的公益额度。')}</p>
      <div className="quota-range">
        {rangeReady ? (
          <>
            {minQ} {P('点')} — {maxQ} {P('点')}
          </>
        ) : (
          <>—</>
        )}
      </div>
      <div className="hint-line">{P('每日签到额度 · 以服务器日期为准')}</div>
      <div className="tag-row">
        <span className="pill">{P('轻量人机验证')}</span>
        <span className="pill">{P('后台自动检查')}</span>
      </div>
      {checkedIn ? (
        <div className="alert-box">{P('今日已签到')}</div>
      ) : (
        <>
          <button
            type="button"
            className="button block soft"
            disabled={!!actionDisabled || !!actionBusy}
            onClick={onAction}
          >
            {actionLabel || P('验证并签到')} →
          </button>
          {data?.unavailable_reason ? (
            <div className="alert-box">{data.unavailable_reason}</div>
          ) : data?.claimable ? (
            <div className="alert-box" style={{ opacity: 0.85 }}>
              {P('签到日界为北京时间零点；额度将记入本站积分钱包。')}
            </div>
          ) : null}
        </>
      )}
      <div className="action-foot">
        {qt(P('本月签到 {month} 天 · 累计 {total} 天'), {
          month: data?.stats?.checkin_count ?? 0,
          total: data?.stats?.total_checkins ?? 0,
        })}
      </div>
    </div>
  )
}
