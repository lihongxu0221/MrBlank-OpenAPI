import { useSyncExternalStore } from 'react'
import { getSiteConfig, subscribeSiteConfig } from '../config/site'
import { P } from '../i18n'

export function AboutPage() {
  const site = useSyncExternalStore(subscribeSiteConfig, getSiteConfig, getSiteConfig)
  return (
    <div className="page">
      <div className="eyebrow">{P('关于公益')}</div>
      <h1>
        {P('每一份善意，')}
        <br />
        {P('都值得被认真对待。')}
      </h1>
      <div className="about-grid" style={{ marginTop: 28 }}>
        <article className="panel">
          <h3>{P('关于公益')}</h3>
          <p>{P(`${site.siteName} 是一个由社区共享模型额度的公益站控制台。`, `${site.siteName} is a community welfare console for shared model credits.`)}</p>
          <p>
            {P(
              '本站不提供充值。额度通过每日签到和社区兑换码发放，仅用于本站模型调用，不具有现金价值。',
            )}
          </p>
          <p>
            {P(
              '从 Grok 起步，逐步拓展 Claude、GPT 等模型生态。后续计划不代表已经可用；开放模型、额度与服务能力以实际账户及接口返回为准。',
            )}
          </p>
        </article>
        <article className="panel">
          <h3>{P('公平使用')}</h3>
          <p>
            {P(
              '每日签到使用轻量 Cloudflare 验证与自动安全检查。我们不允许自动签到、批量账号、转售或共享密钥滥用资源。',
            )}
          </p>
          <p>
            {P(
              '签到日界以服务器设定时区为准；兑换码只可兑换一次。账户或接口异常时，请保留错误时间和信息。',
            )}
          </p>
        </article>
        <article className="panel">
          <h3>{P('身份与隐私')}</h3>
          <p>
            {P(
              '登录通过 Linux.do 授权完成，本站不收集你的 Linux.do 密码。为提供账户、配额与安全服务，会处理社区身份信息、调用用量与必要的安全日志。',
            )}
          </p>
          <p>
            {P(
              '人机验证由 Cloudflare Turnstile 提供。请妥善保管自己的 API 密钥，避免向模型提交个人敏感信息。',
            )}
          </p>
          <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noreferrer">
            {P('Cloudflare 隐私说明')}
          </a>
        </article>
        <article className="panel">
          <h3>{P('项目与许可')}</h3>
          <p>
            {P(
              '模型请求通过本站统一接口进行认证、额度核算与转发。本站是独立的社区项目，与模型提供商不存在官方隶属关系。',
            )}
          </p>
          <p>
            {P(
              '感谢 GeToken（Apache-2.0）及 Grok2API（MIT）等开源项目。相关组件遵循各自许可证。',
            )}
          </p>
          <p style={{ color: 'var(--muted)' }}>
            {P('本站为独立部署的 OpenAPI 控制台；模型调用走配置的 Base URL，默认指向 Darkforger welfare，并非宣称自建上游。', 'This is a self-hosted OpenAPI console; model calls use the configured Base URL (default Darkforger welfare), not a claim of hosting upstream models.')}
          </p>
        </article>
      </div>
    </div>
  )
}
