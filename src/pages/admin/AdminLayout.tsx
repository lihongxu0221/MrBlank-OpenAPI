import type { ReactNode } from 'react'
import {
  Activity,
  Cable,
  KeyRound,
  LayoutDashboard,
  Shield,
  Sparkles,
  UserCog,
  Users,
} from 'lucide-react'
import { P } from '../../i18n'
import { navigate } from '../../router/hash'
import { GuestPanel } from '../../components/GuestPanel'
import { useSession } from '../../hooks/useStore'

const ITEMS = [
  { path: '/admin', label: '管理概览', icon: LayoutDashboard },
  { path: '/admin/accounts', label: '上游账号', icon: Users },
  { path: '/admin/keys', label: 'CPA 密钥', icon: KeyRound },
  { path: '/admin/usage', label: '用量监控', icon: Activity },
  { path: '/admin/connection', label: '连接状态', icon: Cable },
  { path: '/admin/constellation', label: '模型星座', icon: Sparkles },
  { path: '/admin/groups', label: '用户组', icon: UserCog },
]

export function AdminLayout({
  path,
  children,
  allowed,
  checked,
}: {
  path: string
  children: ReactNode
  allowed: boolean
  checked: boolean
}) {
  const session = useSession()

  let body: ReactNode
  if (!session) body = <GuestPanel />
  else if (!checked) body = <p className="inline-loading">{P('正在校验管理员权限…')}</p>
  else if (!allowed)
    body = (
      <div className="panel" style={{ marginTop: 12 }}>
        <h2>{P('需要管理员权限')}</h2>
        <p className="page-lead">
          {P('当前账号不在管理员白名单中。请配置 ADMIN_LINUXDO_* / ADMIN_AILY_USERNAMES，或使用具备 Aily 管理角色的账号登录。')}
        </p>
      </div>
    )
  else body = children

  return (
    <div className="console-shell">
      <aside className="console-nav">
        <div className="eyebrow">
          <Shield size={14} style={{ marginRight: 6 }} />
          {P('运营控制台')}
        </div>
        {ITEMS.map((item) => {
          const Icon = item.icon
          const active = path === item.path
          return (
            <a
              key={item.path}
              href={`#${item.path}`}
              className={active ? 'is-active' : ''}
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
          <div>{P('兼容风格的 CPAMP 子集')}</div>
          <div>{P('完整高级面板仍在 www')}</div>
          <a
            href="#/console"
            onClick={(e) => {
              e.preventDefault()
              navigate('/console')
            }}
          >
            {P('返回用户控制台')} →
          </a>
        </div>
      </aside>
      <div className="console-main">{body}</div>
    </div>
  )
}
