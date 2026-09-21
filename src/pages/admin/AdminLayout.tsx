import { useEffect, type ReactNode } from 'react'
import {
  Activity,
  Cable,
  KeyRound,
  LayoutDashboard,
  Shield,
  Sparkles,
  UserCog,
  UserRound,
  Users,
  Cloud,
  Gift,
  Settings,
  Blocks,
  ScrollText,
  SlidersHorizontal,
  KeySquare,
  LogIn,
  Puzzle,
  FileText,
} from 'lucide-react'
import { P } from '../../i18n'
import { navigate, navigateWithQuery } from '../../router/hash'
import { useSession } from '../../hooks/useStore'

const ITEMS = [
  { path: '/admin', label: '管理概览', icon: LayoutDashboard },
  { path: '/admin/accounts', label: '上游账号', icon: Users },
  { path: '/admin/settings', label: '基础设置', icon: SlidersHorizontal },
  { path: '/admin/providers', label: 'AI 提供商', icon: KeySquare },
  { path: '/admin/oauth', label: 'OAuth 登录', icon: LogIn },
  { path: '/admin/plugins', label: '插件管理', icon: Puzzle },
  { path: '/admin/logs', label: '日志查看', icon: FileText },
  { path: '/admin/aily', label: 'Aily 上游', icon: Cloud },
  { path: '/admin/keys', label: 'CPA 密钥', icon: KeyRound },
  { path: '/admin/usage', label: '用量监控', icon: Activity },
  { path: '/admin/connection', label: '连接状态', icon: Cable },
  { path: '/admin/config', label: 'CPA 配置', icon: Settings },
  { path: '/admin/compat', label: 'OpenAI 兼容', icon: Blocks },
  { path: '/admin/request-log', label: '请求日志', icon: ScrollText },
  { path: '/admin/constellation', label: '模型星座', icon: Sparkles },
  { path: '/admin/groups', label: '用户组', icon: UserCog },
  { path: '/admin/credits', label: '签到兑换', icon: Gift },
  { path: '/admin/users', label: '本站账号', icon: UserRound },
]

function isActive(path: string, itemPath: string) {
  if (itemPath === '/admin') return path === '/admin'
  return path === itemPath || path.startsWith(`${itemPath}/`)
}

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

  useEffect(() => {
    if (!session) navigateWithQuery('/login', { next: path })
  }, [session, path])

  let body: ReactNode
  if (!session) body = <p className="inline-loading">{P('正在前往登录…')}</p>
  else if (!checked) body = <p className="inline-loading">{P('正在校验管理员权限…')}</p>
  else if (!allowed)
    body = (
      <div className="panel" style={{ marginTop: 12 }}>
        <h2>{P('需要管理员权限')}</h2>
        <p className="page-lead">
          {P('当前账号不是管理员。请使用本站管理员账号，或配置 ADMIN_LINUXDO_* 白名单的 Linux.do 账号。')}
        </p>
        <p className="muted" style={{ marginTop: 8 }}>
          {P('非管理员不可见顶部「管理」导航；/api/admin/* 返回 403。')}
        </p>
        <button
          type="button"
          className="button secondary"
          style={{ marginTop: 12 }}
          onClick={() => navigate('/console')}
        >
          {P('返回用户控制台')}
        </button>
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
        {allowed
          ? ITEMS.map((item) => {
              const Icon = item.icon
              const active = isActive(path, item.path)
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
            })
          : null}
        <div className="console-aside-note">
          <div>{P('内核：CPA Management Key')}</div>
          <div>{P('用量：本站 site-usage（非 CPAMP）')}</div>
          <div>{P('CPAMP 可选，不再作为生产依赖')}</div>
          <a href="https://www.juc114.cn/management.html" target="_blank" rel="noreferrer">
            {P('www CPAMP（可选）')} ↗
          </a>
          <a
            href="/console"
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
