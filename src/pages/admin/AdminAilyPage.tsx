import { useEffect } from 'react'
import { navigate } from '../../router/hash'

/** Legacy route: redirect bookmarks /admin/aily → /admin/oauth (Aily UI merged there). */
export function AdminAilyPage(_props: { path: string }) {
  useEffect(() => {
    navigate('/admin/oauth')
  }, [])
  return <p className="inline-loading">正在前往 OAuth 登录…</p>
}
