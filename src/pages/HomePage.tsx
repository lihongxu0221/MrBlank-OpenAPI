import { ArrowRight } from 'lucide-react'
import { P } from '../i18n'
import { navigate } from '../router/hash'
import { ArtShowcase } from '../components/ArtShowcase'
import { useSession } from '../hooks/useStore'

export function HomePage() {
  const session = useSession()
  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <div className="eyebrow">{P('Darkforger 公益站')}</div>
          <h1>
            {P('为每一种好奇，')}
            <span>{P('打开可能')}</span>
          </h1>
          <p className="hero-lead">
            {P(
              '社区共享的模型入口。从 Grok 起步，逐步拓展更多可能。无需充值，每日签到领取额度。',
              'A community-shared model gateway. Starting with Grok, growing from there. No top-ups — claim daily credits.',
            )}
          </p>
          <div className="hero-actions">
            <button type="button" className="button" onClick={() => navigate(session ? '/console' : '/console')}>
              {P('开始探索')} <ArrowRight size={16} />
            </button>
            <button type="button" className="button secondary" onClick={() => navigate('/guide')}>
              {P('接入指南')}
            </button>
          </div>
          <div className="hero-trust">
            <span>Linux.do</span>
            <span>{P('无需充值')}</span>
            <span>{P('社区共享')}</span>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <div className="eyebrow">{P('模型星座')}</div>
          <h2>{P('一个入口，多种智能')}</h2>
          <p>{P('当前以 Grok 为主力；Claude / GPT 等仍在规划中。')}</p>
        </div>
        <div className="catalog-grid">
          {[
            { name: 'Grok', phase: P('已上线'), note: P('实时信息与深度推理'), tags: ['grok-4.6', 'grok-imagine'] },
            { name: 'Claude', phase: P('规划中'), note: P('长文理解与写作协作'), tags: ['Messages', 'Tools'] },
            { name: 'GPT', phase: P('规划中'), note: P('通用智能与工具调用'), tags: ['Chat', 'Vision'] },
          ].map((m) => (
            <article key={m.name} className="catalog-card">
              <div className="catalog-phase">{m.phase}</div>
              <h3>{m.name}</h3>
              <p>{m.note}</p>
              <div className="catalog-tags">
                {m.tags.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <div className="eyebrow">{P('三步开始')}</div>
          <h2>{P('登录 · 签到 · 连接')}</h2>
        </div>
        <div className="steps-grid">
          {[
            { n: '01', t: P('社区登录'), d: P('使用 Linux.do 完成身份验证') },
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
          <p>{P('OpenAI 兼容接口。Base URL：')}</p>
        </div>
        <div className="panel">
          <div className="endpoint-row">https://welfare.darkforger.com/v1</div>
          <pre className="code-block">{`curl https://welfare.darkforger.com/v1/chat/completions \\
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
            [P('现在可以用哪些模型？'), P('目前以 Grok 为主。Claude、GPT 等仍在规划，请以服务状态与账户模型列表为准。')],
            [P('签到需要复杂验证码吗？'), P('不需要。使用轻量 Cloudflare 验证，必要时简单点击即可。')],
            [P('有什么使用限制？'), P('请勿自动签到、批量注册、转售或公开共享密钥，让资源惠及更多真实探索者。')],
          ].map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      <ArtShowcase />

      <section className="section closing">
        <div className="closing-card">
          <h2>{P('好想法，不必等待。')}</h2>
          <p>{P('把好奇交给模型，把创造留给自己。')}</p>
          <div className="closing-actions">
            <button type="button" className="button" onClick={() => navigate('/console')}>
              {P('使用 Linux.do 开始')}
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
