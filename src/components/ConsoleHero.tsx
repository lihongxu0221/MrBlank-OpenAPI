import type { ReactNode } from 'react'
import { MemberBadge } from './MemberBadge'

export function ConsoleHero({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children?: ReactNode
}) {
  return (
    <div className="console-hero panel">
      <div className="console-hero-text">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
        {children}
      </div>
      <MemberBadge />
    </div>
  )
}
