import { useEffect, useState, useSyncExternalStore } from 'react'
import { ArrowRight } from 'lucide-react'
import { P } from '../i18n'
import { navigate } from '../router/hash'
import { ArtShowcase } from '../components/ArtShowcase'
import { useSession } from '../hooks/useStore'
import { getSiteConfig, subscribeSiteConfig } from '../config/site'
import { api } from '../lib/api'

type ConstellationCard = {
  id: string
  title: string
  status: string
  description: string
  tags: string[]
  model_ids?: string[]
  sort_order?: number
}

type Constellation = {
  eyebrow?: string
  heading?: string
  lead?: string
  cards: ConstellationCard[]
}

export function HomePage() {
  const session = useSession()
  const site = useSyncExternalStore(subscribeSiteConfig, getSiteConfig, getSiteConfig)
  const base = site.apiBaseUrl
  const [constellation, setConstellation] = useState<Constellation | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<Constellation>('/api/welfare/constellation', { auth: false })
      .then((data) => {
        if (!cancelled) setConstellation(data)
      })
      .catch(() => {
        if (!cancelled) setConstellation({ cards: [] })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const cards = constellation?.cards || []

  return (
    <>
      <section className="landing-hero">
        <div className="hero-mesh" aria-hidden />
        <div className="hero-layout">
          <div className="hero-copy">
            <div className="eyebrow">
              {site.siteName} · {P(site.brandShort)}
            </div>
            <h1>
              {P('为每一种好奇，')}
              <span>{P('打开可能')}</span>
            </h1>
            <p className="hero-lede">
              {P(
                '社区共享的模型入口。支持本站账号与 Linux.do 登录。无需充值，每日签到领取额度。',
                'A community-shared model gateway. Sign in with a site account or Linux.do. No top-ups — claim daily credits.',
              )}
            </p>
            <div className="hero-actions">
              <button type="button" className="button" onClick={() => navigate('/console')}>
                {P('开始探索')} <ArrowRight size={16} />
              </button>
              <button type="button" className="button secondary" onClick={() => navigate('/guide')}>
                {P('接入指南')}
              </button>
            </div>
            <div className="hero-trust">
              <span>Linux.do</span>
              <span>{P('本站账号')}</span>
              <span>{P('无需充值')}</span>
              <span>{P('社区共享')}</span>
              {session ? <span>{P('已登录')}</span> : null}
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <div className="eyebrow">{constellation?.eyebrow || P('模型星座')}</div>
          <h2>{constellation?.heading || P('一个入口，多种智能')}</h2>
          <p>{constellation?.lead || P('开放模型以管理台配置与账户列表为准。')}</p>
        </div>
        {cards.length ? (
          <div className="model-catalog">
            {cards.map((m) => (
              <article key={m.id} className="catalog-card">
                <div className="catalog-phase">{m.status}</div>
                <h3>{m.title}</h3>
                <p>{m.description}</p>
                <div className="catalog-tags">
                  {(m.tags || []).map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">{P('暂无星座卡片，请管理员在运营控制台配置。')}</p>
        )}
      </section>

      <section className="section">
        <div className="section-heading">
          <div className="eyebrow">{P('三步开始')}</div>
          <h2>{P('登录 · 签到 · 连接')}</h2>
        </div>
        <div className="steps-grid">
          {[
            { n: '01', t: P('社区登录'), d: P('使用本站账号或 Linux.do 完成身份验证') },
            { n: '02', t: P('每日签到'), d: P('轻量验证后领取当日额度') },
            { n: '03', t: P('创建密钥'), d: P('在熟悉的客户端填入 Base URL') },
          ].map((s) => (
            <article key={s.n} className="step-card">
              <div className="step-index">{s.n}</div>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <div className="eyebrow">API</div>
          <h2>{P('开发者快速接入')}</h2>
          <p>
            {P(
              '客户端使用 OpenAI SDK 兼容写法。Base URL 为本站 /v1（nginx → CPA billing shim）：',
              'Use an OpenAI-compatible client. Base URL is this host /v1 (nginx → CPA billing shim):',
            )}
          </p>
        </div>
        <div className="panel">
          <div className="endpoint-row">{base}</div>
          <pre className="code-block">{`curl ${base}/chat/completions \\
  -H "Authorization: Bearer $WELFARE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"grok-4.6","messages":[{"role":"user","content":"Hello"}]}'`}</pre>
          <button type="button" className="button secondary" onClick={() => navigate('/guide')}>
            {P('查看完整指南')}
          </button>
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <div className="eyebrow">FAQ</div>
          <h2>{P('开始之前，你可能想知道')}</h2>
        </div>
        <div className="faq-list">
          {[
            [P('真的不需要充值吗？'), P('本站不提供充值。额度来自每日签到与社区兑换码，不具有现金价值。')],
            [
              P('现在可以用哪些模型？'),
              P('请以首页模型星座、服务状态与账户模型列表为准；管理员可在后台更新星座展示。'),
            ],
            [P('签到需要复杂验证码吗？'), P('不需要。使用轻量 Cloudflare 验证，必要时简单点击即可。')],
            [P('有什么使用限制？'), P('请勿自动签到、批量注册、转售或公开共享密钥，让资源惠及更多真实探索者。')],
            [
              P('这里的 OpenAI 接口是真的吗？'),
              P(
                '本站提供控制台与本站账号 / Linux.do 登录；模型请求使用本站 Base URL（https://openapi.juc114.cn/v1 → CPA）。',
                'This site provides the console and site-account / Linux.do login; model requests use this host Base URL (https://openapi.juc114.cn/v1 → CPA).',
              ),
            ],
          ].map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      <ArtShowcase />

      <section className="section closing-section">
        <div className="closing-card">
          <h2>{P('好想法，不必等待。')}</h2>
          <p>{P('把好奇交给模型，把创造留给自己。')}</p>
          <div className="closing-actions">
            <button type="button" className="button" onClick={() => navigate('/console')}>
              {P('开始登录')}
            </button>
            <button type="button" className="button secondary" onClick={() => navigate('/guide')}>
              {P('先看看接入方式')}
            </button>
          </div>
        </div>
      </section>
    </>
  )
}
