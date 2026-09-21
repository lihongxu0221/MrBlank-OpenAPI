import { useState, useSyncExternalStore } from 'react'
import { P } from '../i18n'
import { getSiteConfig, subscribeSiteConfig } from '../config/site'

function samples(base: string): Record<string, string> {
  return {
    curl: `curl ${base}/chat/completions \\
  -H "Authorization: Bearer $WELFARE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"grok-4.6","messages":[{"role":"user","content":"Hello"}]}'`,
    python: `from openai import OpenAI
client = OpenAI(base_url="${base}", api_key="YOUR_KEY")
print(client.chat.completions.create(
  model="grok-4.6",
  messages=[{"role":"user","content":"Hello"}],
))`,
    javascript: `import OpenAI from "openai";
const client = new OpenAI({
  baseURL: "${base}",
  apiKey: process.env.WELFARE_API_KEY,
});
const res = await client.chat.completions.create({
  model: "grok-4.6",
  messages: [{ role: "user", content: "Hello" }],
});`,
  }
}

export function GuidePage() {
  const site = useSyncExternalStore(subscribeSiteConfig, getSiteConfig, getSiteConfig)
  const base = site.apiBaseUrl
  const SAMPLES = samples(base)
  const [lang, setLang] = useState('curl')
  return (
    <div className="page">
      <div className="eyebrow">{P('接入指南')}</div>
      <h1>{P('三步，把灵感接上线')}</h1>
      <p className="page-lead">
        {P(
          '使用 OpenAI 兼容客户端连接本站 /v1（nginx 反代至 CPA）。控制台负责 Linux.do 登录与密钥管理。',
          'Use an OpenAI-compatible client against this host /v1 (nginx → CPA). The console handles Linux.do login and API keys.',
        )}
      </p>

      <div className="steps-grid" style={{ marginTop: 28 }}>
        {[
          [P('登录并领取额度'), P('用 Linux.do 登录，完成每日签到或输入兑换码。')],
          [P('创建 API Key'), P('设置名称、额度上限与有效期，妥善保存密钥。')],
          [P('连接客户端'), P('填入 Base URL 与密钥，选择账户可用模型。')],
        ].map(([t, d], i) => (
          <article key={t} className="step-card">
            <div className="step-index">0{i + 1}</div>
            <h3>{t}</h3>
            <p>{d}</p>
          </article>
        ))}
      </div>

      <div className="panel" style={{ marginTop: 28 }}>
        <div className="eyebrow">{P('Base URL')}</div>
        <div className="endpoint-row">{base}</div>
        <div className="code-toolbar">
          {Object.keys(SAMPLES).map((k) => (
            <button type="button" key={k} className={lang === k ? 'is-active' : ''} onClick={() => setLang(k)}>
              {k}
            </button>
          ))}
        </div>
        <pre className="code-block">{SAMPLES[lang]}</pre>
      </div>

      <div className="protocol-grid">
        {['Chat Completions', 'Messages', 'Responses', 'Images', 'Videos'].map((p) => (
          <div key={p} className="panel">
            <strong>{p}</strong>
            <p style={{ color: 'var(--muted)', marginBottom: 0 }}>{P('协议兼容示意，请以实际上线模型为准。')}</p>
          </div>
        ))}
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <h3>{P('开始之前')}</h3>
        <ul>
          <li>{P('额度仅用于站内模型调用，不提供充值，也没有现金价值。')}</li>
          <li>{P('Claude、GPT 等后续模型未上线前不可调用。')}</li>
          <li>{P('请勿自动签到、批量注册或共享、转售密钥与额度。')}</li>
          <li>{P('模型输出可能有误；请勿提交密码或敏感信息。')}</li>
        </ul>
      </div>
    </div>
  )
}
