import { useEffect, type ReactNode } from 'react'
import {
  Activity,
  Gift,
  KeyRound,
  LayoutDashboard,
  Radio,
  Boxes,
  CalendarCheck2,
  Sparkles,
} from 'lucide-react'
import { P } from '../../i18n'
import { navigate, navigateWithQuery } from '../../router/hash'
import { useSession } from '../../hooks/useStore'

const ITEMS = [
  { path: '/console', label: '概览', icon: LayoutDashboard },
  { path: '/checkin', label: '每日签到', icon: CalendarCheck2 },
  { path: '/redeem', label: '兑换码', icon: Gift },
  { path: '/keys', label: 'API 密钥', icon: KeyRound },
  { path: '/usage', label: '用量记录', icon: Activity },
  { path: '/models', label: '模型广场', icon: Boxes },
  { path: '/channels', label: '服务状态', icon: Radio },
]

export function ConsoleLayout({
  path,
  children,
}: {
  path: string
  children: ReactNode
  bare?: boolean
}) {
  const session = useSession()

  useEffect(() => {
    if (!session) navigateWithQuery('/login', { next: path })
  }, [session, path])

  if (!session) {
    return (
      <div className="page">
        <p className="inline-loading">{P('正在前往登录…')}</p>
      </div>
    )
  }

  return (
    <div className="console-shell">
      <aside className="console-nav">
        <div className="eyebrow">{P('你的探索空间')}</div>
        {ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <a
              key={item.path}
              href={`#${item.path}`}
              className={path === item.path ? 'is-active' : ''}
              onClick={(e) => {
                e.preventDefault()
                navigate(item.path)
              }}
            >
              <Icon size={16} />
              {P(item.label)}
            </a>
          )
        })}
        <div className="console-aside-note">
          <div className="star">
            <Sparkles size={14} />
          </div>
          <div>{P('好奇心，是最好的起点。')}</div>
          <div>{P('社区共享 · 公平使用')}</div>
          <a
            href="/guide"
            onClick={(e) => {
              e.preventDefault()
              navigate('/guide')
            }}
          >
            {P('接入指南')} →
          </a>
        </div>
      </aside>
      <div className="console-main">{children}</div>
    </div>
  )
}
