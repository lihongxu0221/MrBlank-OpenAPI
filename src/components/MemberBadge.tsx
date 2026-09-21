import { P } from '../i18n'

export function MemberBadge() {
  return (
    <div className="member-badge" title="Linux.do">
      <span className="member-badge-mark" aria-hidden />
      <span>{P('Linux.do 成员')}</span>
    </div>
  )
}
