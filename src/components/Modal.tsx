import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { P } from '../i18n'

export function Modal({
  title,
  children,
  onClose,
  wide,
  className,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
  className?: string
}) {
  const classes = ['modal', wide ? 'modal-wide' : '', className || ''].filter(Boolean).join(' ')
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className={classes} onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={P('关闭对话框')}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-inner">{children}</div>
      </div>
    </div>
  )
}
