import { useEffect } from 'react'
import { GuestPanel } from '../components/GuestPanel'
import { useSession } from '../hooks/useStore'
import { getHashQuery, navigate } from '../router/hash'

export function LoginPage() {
  const session = useSession()

  useEffect(() => {
    if (!session) return
    const next = getHashQuery().get('next')
    if (next && next.startsWith('/') && !next.startsWith('//')) {
      navigate(next)
      return
    }
    const admin = Boolean((session as { is_admin?: boolean }).is_admin)
    navigate(admin ? '/admin' : '/console')
  }, [session])

  if (session) {
    return (
      <div className="page login-page">
        <p className="inline-loading">正在进入…</p>
      </div>
    )
  }

  return (
    <div className="page login-page">
      <div className="login-page-wrap">
        <GuestPanel />
      </div>
    </div>
  )
}
