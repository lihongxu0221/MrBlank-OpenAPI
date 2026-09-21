import { P } from '../i18n'

export function AboutPage() {
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
          <p>{P('Darkforger 是一个由社区共享模型额度的公益站。')}</p>
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
            {P('本仓库为前端演示克隆，并非官方 Darkforger 服务。', 'This repo is a front-end demo clone, not the official Darkforger service.')}
          </p>
        </article>
      </div>
    </div>
  )
}
