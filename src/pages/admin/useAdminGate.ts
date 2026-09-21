import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { useSession } from '../../hooks/useStore'

export function useAdminGate() {
  const session = useSession()
  const [checked, setChecked] = useState(false)
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!session) {
      setChecked(true)
      setAllowed(false)
      return
    }
    setChecked(false)
    api
      .get<{ is_admin: boolean }>('/api/admin/me')
      .then((d) => {
        if (!cancelled) {
          setAllowed(!!d.is_admin)
          setChecked(true)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAllowed(false)
          setChecked(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [session?.user?.id, session?.access_token])

  return { checked, allowed, session }
}
