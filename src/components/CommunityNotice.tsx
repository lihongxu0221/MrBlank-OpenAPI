import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowUpRight } from 'lucide-react'
import { api } from '../lib/api'
import { P } from '../i18n'
import { Modal } from './Modal'

type Notice = {
  id: string
  level: string
  title: string
  body: string
  published_at: string
  ack_identity: string
}

export function CommunityNotice() {
  const [items, setItems] = useState<Notice[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    api
      .get<{ items: Notice[] }>('/api/welfare/notices?size=50', { auth: false })
      .then((d) => setItems(d.items || []))
      .catch(() => {})
  }, [])

  if (!items.length) return null
  const top = items[0]
  const levelLabel =
    top.level === 'danger' ? P('重要公告') : top.level === 'warning' ? P('使用提醒') : P('社区动态')

  return (
    <>
      <div className="community-notice">
        <div className="community-notice-inner">
          <div>
            <AlertTriangle size={14} style={{ display: 'inline', marginRight: 8, verticalAlign: -2 }} />
            <strong>{levelLabel}</strong>
            {top.title}
          </div>
          <button type="button" className="linkish" onClick={() => setOpen(true)}>
            {P('全部公告')} <ArrowUpRight size={14} />
          </button>
        </div>
      </div>
      {open ? (
        <Modal title={P('社区公告')} onClose={() => setOpen(false)} wide>
          <p className="appearance-intro">
            {P('重要的变化，都在这里。时间统一为北京时间。', 'Everything you need to know. All times are Beijing time.')}
          </p>
          <div style={{ display: 'grid', gap: 12 }}>
            {items.map((n) => (
              <article key={n.id} className="panel" style={{ boxShadow: 'none' }}>
                <div className="eyebrow">{n.level}</div>
                <h3 style={{ margin: '6px 0' }}>{n.title}</h3>
                <p style={{ color: 'var(--muted)', margin: 0, lineHeight: 1.6 }}>{n.body}</p>
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>{n.published_at}</div>
              </article>
            ))}
          </div>
        </Modal>
      ) : null}
    </>
  )
}
