import { useSyncExternalStore } from 'react'
import { P } from '../i18n'
import { navigate } from '../router/hash'
import { getSiteConfig, subscribeSiteConfig } from '../config/site'

export function SiteFooter() {
  const site = useSyncExternalStore(subscribeSiteConfig, getSiteConfig, getSiteConfig)
  const year = new Date().getFullYear()
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div>
          <a
            className="brand"
            href="#/"
            onClick={(e) => {
              e.preventDefault()
              navigate('/')
            }}
          >
            <img src="/mark.svg" alt="" width={24} height={24} />
            <span>{site.siteName}</span>
          </a>
          <p style={{ color: 'var(--muted)', margin: '10px 0 0' }}>{P('让好奇心自由生长。')}</p>
          <p className="footer-copy">
            © {year} {site.siteName} · {site.footerLine}
          </p>
          <p className="footer-copy">
            {P(
              '本站为 OpenAPI 控制台 UI；模型调用走配置的 Base URL（非本域名 /v1）。',
              'This is an OpenAPI console UI; model calls use the configured Base URL (not /v1 on this host).',
            )}
          </p>
        </div>
        <div className="footer-links">
          <a
            href="#/guide"
            onClick={(e) => {
              e.preventDefault()
              navigate('/guide')
            }}
          >
            {P('接入指南')}
          </a>
          <a
            href="#/about"
            onClick={(e) => {
              e.preventDefault()
              navigate('/about')
            }}
          >
            {P('公平使用与隐私')}
          </a>
          <a
            href="#/availability"
            onClick={(e) => {
              e.preventDefault()
              navigate('/availability')
            }}
          >
            {P('服务状态')}
          </a>
        </div>
      </div>
    </footer>
  )
}
