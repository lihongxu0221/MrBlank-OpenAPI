import { useEffect } from 'react'
import { navigate } from '../../router/hash'

/** Legacy route: redirect /admin/aily → /admin/oauth (site-local Aily/Grok). */
export function AdminAilyPage(_props: { path: string }) {
  useEffect(() => {
    navigate('/admin/oauth')
  }, [])
  return <p className="inline-loading">正在前往本站上游…</p>
}
