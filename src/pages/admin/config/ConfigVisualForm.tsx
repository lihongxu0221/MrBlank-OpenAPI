import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Activity,
  Code2,
  Diamond,
  KeyRound,
  Network,
  Radio,
  Settings,
  Shield,
  Timer,
  type LucideIcon,
} from 'lucide-react'
import { ConfigApiKeysPanel } from './ConfigApiKeysPanel'
import type { SecretKeyAction } from './types'
import { P } from '../../../i18n'

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function setPath(cfg: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  const next = structuredClone(cfg)
  let cur: any = next
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i]
    if (!cur[k] || typeof cur[k] !== 'object' || Array.isArray(cur[k])) cur[k] = {}
    cur = cur[k]
  }
  cur[path[path.length - 1]] = value
  return next
}

function numOrEmpty(v: unknown): string {
  if (v == null || v === '') return ''
  return String(v)
}

function parseNum(s: string): number | '' {
  if (s.trim() === '') return ''
  const n = Number(s)
  return Number.isFinite(n) ? n : ''
}

function Field({
  label,
  hint,
  children,
  wide,
}: {
  label: string
  hint?: string
  children: ReactNode
  wide?: boolean
}) {
  return (
    <label className={`cfg-field${wide ? ' cfg-field--wide' : ''}`}>
      <span className="cfg-field__label">{label}</span>
      <span className="cfg-field__control">{children}</span>
      {hint ? <span className="cfg-field__hint">{hint}</span> : null}
    </label>
  )
}

function BoolRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="cfg-toggle">
      <span className="cfg-toggle__copy">
        <span className="cfg-toggle__title">{label}</span>
        {hint ? <span className="cfg-toggle__desc">{hint}</span> : null}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

function SectionCard({
  id,
  title,
  description,
  icon: Icon,
  sectionRef,
  children,
}: {
  id: string
  title: string
  description?: string
  icon: LucideIcon
  sectionRef: (el: HTMLElement | null) => void
  children: ReactNode
}) {
  return (
    <section
      id={`cfg-sec-${id}`}
      ref={sectionRef}
      className="cfg-section"
      data-cfg-section={id}
    >
      <header className="cfg-section__header">
        <span className="cfg-section__icon">
          <Icon size={16} />
        </span>
        <div className="cfg-section__heading">
          <h2 className="cfg-section__title">{title}</h2>
          {description ? <p className="cfg-section__desc">{description}</p> : null}
        </div>
      </header>
      <div className="cfg-section__content">{children}</div>
    </section>
  )
}

function SubSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="cfg-subsection">
      <div className="cfg-subsection__header">
        <strong className="cfg-subsection__title">{title}</strong>
        {description ? <p className="cfg-subsection__desc">{description}</p> : null}
      </div>
      <div className="cfg-section-stack">{children}</div>
    </div>
  )
}

/** CPAMP VisualConfigEditor section order (no freestyle IA). */
const SECTIONS: { id: string; title: string; description: string; icon: LucideIcon }[] = [
  { id: 'server', title: '服务器配置', description: '基础服务器设置', icon: Settings },
  { id: 'tls', title: 'TLS/SSL 配置', description: 'HTTPS 安全连接设置', icon: Shield },
  { id: 'remote', title: '远程管理', description: '远程访问和控制面板设置', icon: Network },
  { id: 'auth', title: '认证配置', description: 'API 密钥与认证文件目录设置', icon: KeyRound },
  { id: 'system', title: '系统配置', description: '调试、日志、统计与性能调试设置', icon: Diamond },
  { id: 'network', title: '网络配置', description: '代理、重试和路由设置', icon: Activity },
  { id: 'quota', title: '配额回退', description: '配额耗尽时的回退策略', icon: Timer },
  { id: 'streaming', title: '流式传输配置', description: 'Keepalive 与 bootstrap 重试设置', icon: Radio },
  { id: 'payload', title: 'Payload 配置', description: '设置请求参数的默认值、覆盖值和过滤规则', icon: Code2 },
]

export function ConfigVisualForm({
  draft,
  onChange,
  secretKeyAction,
  onSecretKeyAction,
  secretKeyInput,
  onSecretKeyInput,
  secretKeyPresent,
  secretKeyMasked,
  enabled,
}: {
  draft: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  secretKeyAction: SecretKeyAction
  onSecretKeyAction: (a: SecretKeyAction) => void
  secretKeyInput: string
  onSecretKeyInput: (v: string) => void
  secretKeyPresent: boolean
  secretKeyMasked: string
  enabled: boolean
}) {
  const tls = asObj(draft.tls)
  const rm = asObj(draft['remote-management'])
  const plugins = asObj(draft.plugins)
  const streaming = asObj(draft.streaming)
  const quota = asObj(draft['quota-exceeded'] ?? draft.quota)
  const headers = asObj(draft['request-header-defaults'] ?? draft.headers)
  const claudeH = asObj(headers.claude)
  const codexH = asObj(headers.codex)
  const payload = asObj(draft.payload)
  const routing = asObj(draft.routing)
  const pprof = asObj(draft.pprof)

  const [activeId, setActiveId] = useState(SECTIONS[0].id)
  const sectionEls = useRef<Record<string, HTMLElement | null>>({})
  const mobileScroller = useRef<HTMLDivElement | null>(null)
  const mobileBtns = useRef<Record<string, HTMLButtonElement | null>>({})
  const scrollingFromClick = useRef(false)

  const sections = useMemo(() => SECTIONS, [])

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (scrollingFromClick.current) return
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        if (visible[0]?.target.id) {
          const id = visible[0].target.id.replace(/^cfg-sec-/, '')
          setActiveId(id)
        }
      },
      { rootMargin: '-18% 0px -58% 0px', threshold: [0.12, 0.3, 0.55] },
    )
    for (const s of sections) {
      const el = sectionEls.current[s.id]
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [sections, draft])

  useEffect(() => {
    const scroller = mobileScroller.current
    const btn = mobileBtns.current[activeId]
    if (!scroller || !btn) return
    const sRect = scroller.getBoundingClientRect()
    const bRect = btn.getBoundingClientRect()
    const nextLeft = scroller.scrollLeft + (bRect.left - sRect.left) - (scroller.clientWidth - bRect.width) / 2
    const max = Math.max(scroller.scrollWidth - scroller.clientWidth, 0)
    scroller.scrollTo({ left: Math.min(Math.max(nextLeft, 0), max), behavior: 'smooth' })
  }, [activeId])

  function jumpTo(id: string) {
    setActiveId(id)
    scrollingFromClick.current = true
    sectionEls.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.setTimeout(() => {
      scrollingFromClick.current = false
    }, 600)
  }

  function bindRef(id: string) {
    return (el: HTMLElement | null) => {
      sectionEls.current[id] = el
    }
  }

  const navList = (
    <div className="cfg-nav-list">
      {sections.map((s) => {
        const Icon = s.icon
        const active = activeId === s.id
        return (
          <button
            key={s.id}
            type="button"
            className={`cfg-nav-btn${active ? ' is-active' : ''}`}
            onClick={() => jumpTo(s.id)}
          >
            <span className="cfg-nav-btn__icon">
              <Icon size={14} />
            </span>
            <span className="cfg-nav-btn__main">
              <span className="cfg-nav-btn__title">{P(s.title)}</span>
              <span className="cfg-nav-btn__desc">{P(s.description)}</span>
            </span>
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="cfg-visual">
      <div className="cfg-workspace">
        <div className="cfg-mobile-nav" aria-label={P('快速跳转')}>
          <div className="cfg-mobile-nav__scroller" ref={mobileScroller}>
            {sections.map((s) => {
              const Icon = s.icon
              return (
                <button
                  key={s.id}
                  ref={(el) => {
                    mobileBtns.current[s.id] = el
                  }}
                  type="button"
                  className={`cfg-mobile-nav__btn${activeId === s.id ? ' is-active' : ''}`}
                  onClick={() => jumpTo(s.id)}
                >
                  <span className="cfg-mobile-nav__icon">
                    <Icon size={13} />
                  </span>
                  <span className="cfg-mobile-nav__label">{P(s.title)}</span>
                </button>
              )
            })}
          </div>
        </div>

        <aside className="cfg-sidebar" aria-label={P('配置分区')}>
          <div className="cfg-sidebar__rail">{navList}</div>
        </aside>

        <div className="cfg-sections">
          <SectionCard
            id="server"
            title={P('服务器配置')}
            description={P('基础服务器设置')}
            icon={Settings}
            sectionRef={bindRef('server')}
          >
            <div className="cfg-grid">
              <Field label={P('主机地址')}>
                <input
                  value={String(draft.host ?? '')}
                  onChange={(e) => onChange(setPath(draft, ['host'], e.target.value))}
                  placeholder="0.0.0.0"
                  autoComplete="off"
                />
              </Field>
              <Field label={P('端口')}>
                <input
                  value={numOrEmpty(draft.port)}
                  onChange={(e) => {
                    const n = parseNum(e.target.value)
                    onChange(setPath(draft, ['port'], n === '' ? undefined : n))
                  }}
                  placeholder="8317"
                  inputMode="numeric"
                />
              </Field>
            </div>
          </SectionCard>

          <SectionCard
            id="tls"
            title={P('TLS/SSL 配置')}
            description={P('HTTPS 安全连接设置')}
            icon={Shield}
            sectionRef={bindRef('tls')}
          >
            <div className="cfg-section-stack">
              <BoolRow
                label={P('启用 TLS')}
                hint={P('启用 HTTPS 安全连接')}
                checked={!!tls.enable}
                onChange={(v) => onChange(setPath(draft, ['tls', 'enable'], v))}
              />
              {tls.enable ? (
                <div className="cfg-grid">
                  <Field label={P('证书文件路径')}>
                    <input
                      value={String(tls.cert ?? '')}
                      onChange={(e) => onChange(setPath(draft, ['tls', 'cert'], e.target.value))}
                      placeholder="/path/to/cert.pem"
                      autoComplete="off"
                    />
                  </Field>
                  <Field label={P('私钥文件路径')}>
                    <input
                      value={String(tls.key ?? '')}
                      onChange={(e) => onChange(setPath(draft, ['tls', 'key'], e.target.value))}
                      placeholder="/path/to/key.pem"
                      autoComplete="off"
                    />
                  </Field>
                </div>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard
            id="remote"
            title={P('远程管理')}
            description={P('远程访问和控制面板设置')}
            icon={Network}
            sectionRef={bindRef('remote')}
          >
            <div className="cfg-section-stack">
              <BoolRow
                label={P('允许远程访问')}
                hint={P('允许从其他主机访问管理接口')}
                checked={!!rm['allow-remote']}
                onChange={(v) => onChange(setPath(draft, ['remote-management', 'allow-remote'], v))}
              />
              <BoolRow
                label={P('禁用控制面板')}
                hint={P('禁用内置的 Web 控制面板')}
                checked={!!rm['disable-control-panel']}
                onChange={(v) => onChange(setPath(draft, ['remote-management', 'disable-control-panel'], v))}
              />
              <BoolRow
                label={P('禁用面板自动更新')}
                hint={P('首次缺失时仍可下载，但不再从 GitHub 后台自动更新')}
                checked={!!rm['disable-auto-update-panel']}
                onChange={(v) => onChange(setPath(draft, ['remote-management', 'disable-auto-update-panel'], v))}
              />
              <div className="cfg-grid">
                <div className="cfg-field cfg-field--wide">
                  <span className="cfg-field__label">{P('管理密钥')}</span>
                  <p className="cfg-field__hint">
                    {secretKeyPresent
                      ? P('已配置管理密钥；保持「保留现有密钥」即可。')
                      : P('当前未配置管理密钥；空密钥会禁用 Management API。')}
                    {secretKeyPresent && secretKeyMasked ? (
                      <>
                        {' '}
                        <code>{secretKeyMasked}</code>
                      </>
                    ) : null}
                  </p>
                  <div className="cfg-secret-actions">
                    {(['keep', 'replace', 'clear'] as SecretKeyAction[]).map((a) => (
                      <button
                        key={a}
                        type="button"
                        className={`button compact ${secretKeyAction === a ? '' : 'secondary'}`}
                        onClick={() => onSecretKeyAction(a)}
                      >
                        {a === 'keep' ? P('保留现有密钥') : a === 'clear' ? P('清空密钥') : P('替换密钥')}
                      </button>
                    ))}
                  </div>
                  {secretKeyAction === 'replace' ? (
                    <Field label={P('新管理密钥')} hint={P('仅在选择「替换」时写入')}>
                      <input
                        type="password"
                        value={secretKeyInput}
                        onChange={(e) => onSecretKeyInput(e.target.value)}
                        placeholder={P('设置管理密钥')}
                        autoComplete="new-password"
                      />
                    </Field>
                  ) : null}
                  {secretKeyAction === 'clear' ? (
                    <p className="cfg-danger-note">{P('保存后将清空管理密钥并禁用 Management API。')}</p>
                  ) : null}
                </div>
                <Field label={P('面板仓库')} wide>
                  <input
                    value={String(rm['panel-github-repository'] ?? rm['panel-repo'] ?? '')}
                    onChange={(e) =>
                      onChange(setPath(draft, ['remote-management', 'panel-github-repository'], e.target.value))
                    }
                    placeholder="https://github.com/router-for-me/Cli-Proxy-API-Management-Center"
                    autoComplete="off"
                  />
                </Field>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            id="auth"
            title={P('认证配置')}
            description={P('API 密钥与认证文件目录设置')}
            icon={KeyRound}
            sectionRef={bindRef('auth')}
          >
            <div className="cfg-section-stack">
              <Field label={P('认证文件目录 (auth-dir)')} hint={P('存放认证文件的目录路径（支持 ~）')} wide>
                <input
                  value={String(draft['auth-dir'] ?? '')}
                  onChange={(e) => onChange(setPath(draft, ['auth-dir'], e.target.value))}
                  placeholder="~/.cli-proxy-api"
                  autoComplete="off"
                />
              </Field>
              <div className="cfg-subsection">
                <ConfigApiKeysPanel enabled={enabled} />
              </div>
            </div>
          </SectionCard>

          <SectionCard
            id="system"
            title={P('系统配置')}
            description={P('调试、日志、统计与性能调试设置')}
            icon={Diamond}
            sectionRef={bindRef('system')}
          >
            <div className="cfg-section-stack">
              <div className="cfg-grid">
                <BoolRow
                  label={P('调试模式')}
                  hint={P('启用详细的调试日志')}
                  checked={!!draft.debug}
                  onChange={(v) => onChange(setPath(draft, ['debug'], v))}
                />
                <BoolRow
                  label={P('启用 pprof 调试服务')}
                  hint={P('在指定的本地地址暴露 Go 性能分析端点')}
                  checked={!!(pprof.enable ?? draft['pprof-enable'])}
                  onChange={(v) => onChange(setPath(draft, ['pprof', 'enable'], v))}
                />
                <BoolRow
                  label={P('商业模式')}
                  hint={P('禁用高开销中间件以支持高并发')}
                  checked={!!draft['commercial-mode']}
                  onChange={(v) => onChange(setPath(draft, ['commercial-mode'], v))}
                />
                <BoolRow
                  label={P('启用用量统计')}
                  hint={P('允许 CPA 记录请求用量')}
                  checked={!!draft['usage-statistics-enabled']}
                  onChange={(v) => onChange(setPath(draft, ['usage-statistics-enabled'], v))}
                />
                <BoolRow
                  label={P('写入日志文件')}
                  hint={P('将日志保存到文件')}
                  checked={!!draft['logging-to-file']}
                  onChange={(v) => onChange(setPath(draft, ['logging-to-file'], v))}
                />
                <BoolRow
                  label="request-log"
                  hint={P('请求日志')}
                  checked={!!draft['request-log']}
                  onChange={(v) => onChange(setPath(draft, ['request-log'], v))}
                />
                <BoolRow
                  label={P('启用插件系统')}
                  hint={P('启用标准动态库插件加载；具体插件实例仍在插件管理页启停')}
                  checked={!!plugins.enabled}
                  onChange={(v) => onChange(setPath(draft, ['plugins', 'enabled'], v))}
                />
                <BoolRow
                  label={P('严格校验旁路签名')}
                  hint={P('仅在关闭签名缓存时生效')}
                  checked={!!draft['antigravity-signature-bypass-strict']}
                  onChange={(v) => onChange(setPath(draft, ['antigravity-signature-bypass-strict'], v))}
                />
              </div>
              <div className="cfg-grid">
                <Field label={P('pprof 监听地址')} hint={P('默认 127.0.0.1:8316，请勿将此调试端点暴露到公网。')}>
                  <input
                    value={String(pprof.addr ?? draft['pprof-addr'] ?? '')}
                    onChange={(e) => onChange(setPath(draft, ['pprof', 'addr'], e.target.value))}
                    placeholder="127.0.0.1:8316"
                    autoComplete="off"
                  />
                </Field>
                <Field label={P('插件目录 (plugins.dir)')} hint={P('CPA 加载插件动态库的目录；留空使用 CPA 默认值。')}>
                  <input
                    value={String(plugins.dir ?? '')}
                    onChange={(e) => onChange(setPath(draft, ['plugins', 'dir'], e.target.value))}
                    autoComplete="off"
                  />
                </Field>
                <Field label={P('日志文件大小限制 (MB)')}>
                  <input
                    value={numOrEmpty(draft['logs-max-total-size-mb'])}
                    onChange={(e) => {
                      const n = parseNum(e.target.value)
                      onChange(setPath(draft, ['logs-max-total-size-mb'], n === '' ? undefined : n))
                    }}
                    inputMode="numeric"
                  />
                </Field>
                <Field label={P('用量数据保留时间 (秒)')} hint={P('CPA 默认保留 60 秒，可配置 1 到 3600 秒；留空使用默认值。')}>
                  <input
                    value={numOrEmpty(draft['redis-usage-queue-retention-seconds'])}
                    onChange={(e) => {
                      const n = parseNum(e.target.value)
                      onChange(setPath(draft, ['redis-usage-queue-retention-seconds'], n === '' ? undefined : n))
                    }}
                    inputMode="numeric"
                  />
                </Field>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            id="network"
            title={P('网络配置')}
            description={P('代理、重试和路由设置')}
            icon={Activity}
            sectionRef={bindRef('network')}
          >
            <div className="cfg-section-stack">
              <div className="cfg-grid">
                <Field label={P('代理 URL')} wide>
                  <input
                    value={String(draft['proxy-url'] ?? '')}
                    onChange={(e) => onChange(setPath(draft, ['proxy-url'], e.target.value))}
                    placeholder="socks5://user:pass@127.0.0.1:1080/"
                    autoComplete="off"
                  />
                </Field>
                <Field label={P('请求重试次数')}>
                  <input
                    value={numOrEmpty(draft['request-retry'])}
                    onChange={(e) => {
                      const n = parseNum(e.target.value)
                      onChange(setPath(draft, ['request-retry'], n === '' ? undefined : n))
                    }}
                    placeholder="3"
                    inputMode="numeric"
                  />
                </Field>
                <Field label={P('最大重试间隔 (秒)')}>
                  <input
                    value={numOrEmpty(draft['max-retry-interval'])}
                    onChange={(e) => {
                      const n = parseNum(e.target.value)
                      onChange(setPath(draft, ['max-retry-interval'], n === '' ? undefined : n))
                    }}
                    placeholder="30"
                    inputMode="numeric"
                  />
                </Field>
                <Field label={P('路由策略')} hint={P('先按优先级筛选，再由策略分配请求')}>
                  <select
                    value={String(routing.strategy ?? '')}
                    onChange={(e) => onChange(setPath(draft, ['routing', 'strategy'], e.target.value || undefined))}
                  >
                    <option value="">—</option>
                    <option value="round-robin">{P('轮询 (Round Robin)')}</option>
                    <option value="weighted-round-robin">{P('加权轮询 (Weighted Round Robin)')}</option>
                    <option value="fill-first">{P('填充优先 (Fill First)')}</option>
                  </select>
                </Field>
                <Field label={P('会话粘性 TTL')}>
                  <input
                    value={String(draft['session-affinity-ttl'] ?? '')}
                    onChange={(e) => onChange(setPath(draft, ['session-affinity-ttl'], e.target.value))}
                    autoComplete="off"
                  />
                </Field>
              </div>
              <div className="cfg-grid">
                <BoolRow
                  label={P('强制模型前缀')}
                  hint={P('未带前缀的模型请求只使用无前缀凭据')}
                  checked={!!draft['force-model-prefix']}
                  onChange={(v) => onChange(setPath(draft, ['force-model-prefix'], v))}
                />
                <BoolRow
                  label={P('转发外部服务响应头')}
                  hint={P('将过滤后的外部服务响应头转发给客户端')}
                  checked={!!draft['passthrough-headers']}
                  onChange={(v) => onChange(setPath(draft, ['passthrough-headers'], v))}
                />
                <BoolRow
                  label={P('禁用冷却调度')}
                  hint={P('全局禁用认证/模型失败后的冷却窗口')}
                  checked={!!draft['disable-cooling']}
                  onChange={(v) => onChange(setPath(draft, ['disable-cooling'], v))}
                />
                <BoolRow
                  label={P('WebSocket 认证')}
                  hint={P('启用 WebSocket 连接认证 (/v1/ws)')}
                  checked={!!draft['ws-auth']}
                  onChange={(v) => onChange(setPath(draft, ['ws-auth'], v))}
                />
              </div>

              <SubSection
                title={P('Header 默认值')}
                description={P('Claude 与 Codex OAuth 请求在客户端缺少 Header 时使用的默认值')}
              >
                <SubSection title="Claude Header Defaults">
                  <div className="cfg-grid">
                    {(['user-agent', 'package-version', 'runtime-version', 'os', 'arch'] as const).map((k) => (
                      <Field key={`c-${k}`} label={k}>
                        <input
                          value={String(claudeH[k] ?? '')}
                          onChange={(e) =>
                            onChange(setPath(draft, ['request-header-defaults', 'claude', k], e.target.value))
                          }
                          autoComplete="off"
                        />
                      </Field>
                    ))}
                  </div>
                </SubSection>
                <SubSection title="Codex Header Defaults">
                  <div className="cfg-grid">
                    {(['user-agent', 'package-version', 'runtime-version', 'os', 'arch'] as const).map((k) => (
                      <Field key={`x-${k}`} label={k}>
                        <input
                          value={String(codexH[k] ?? '')}
                          onChange={(e) =>
                            onChange(setPath(draft, ['request-header-defaults', 'codex', k], e.target.value))
                          }
                          autoComplete="off"
                        />
                      </Field>
                    ))}
                    <BoolRow
                      label={P('启用 Codex 身份混淆')}
                      hint={P('写入 codex.identity-confuse，让 CPA 混合 Codex 请求身份 Header 以提升兼容性')}
                      checked={!!asObj(draft.codex)['identity-confuse']}
                      onChange={(v) => onChange(setPath(draft, ['codex', 'identity-confuse'], v))}
                    />
                  </div>
                </SubSection>
              </SubSection>
            </div>
          </SectionCard>

          <SectionCard
            id="quota"
            title={P('配额回退')}
            description={P('配额耗尽时的回退策略')}
            icon={Timer}
            sectionRef={bindRef('quota')}
          >
            <div className="cfg-grid">
              <BoolRow
                label={P('切换项目')}
                hint={P('配额耗尽时自动切换到其他项目')}
                checked={!!(quota['switch-project'] ?? draft['switch-project'])}
                onChange={(v) => onChange(setPath(draft, ['switch-project'], v))}
              />
              <BoolRow
                label={P('切换预览模型')}
                hint={P('配额耗尽时切换到预览版本模型')}
                checked={!!(quota['switch-preview-model'] ?? draft['switch-preview-model'])}
                onChange={(v) => onChange(setPath(draft, ['switch-preview-model'], v))}
              />
            </div>
          </SectionCard>

          <SectionCard
            id="streaming"
            title={P('流式传输配置')}
            description={P('Keepalive 与 bootstrap 重试设置')}
            icon={Radio}
            sectionRef={bindRef('streaming')}
          >
            <div className="cfg-grid">
              <Field label={P('Keepalive 秒数')} hint={P('设置为 0 或留空表示禁用')}>
                <input
                  value={numOrEmpty(streaming['keepalive-seconds'])}
                  onChange={(e) => {
                    const n = parseNum(e.target.value)
                    onChange(setPath(draft, ['streaming', 'keepalive-seconds'], n === '' ? undefined : n))
                  }}
                  inputMode="numeric"
                />
              </Field>
              <Field label={P('Bootstrap 重试次数')} hint={P('流式传输启动时（首包前）的重试次数')}>
                <input
                  value={numOrEmpty(streaming['bootstrap-retries'])}
                  onChange={(e) => {
                    const n = parseNum(e.target.value)
                    onChange(setPath(draft, ['streaming', 'bootstrap-retries'], n === '' ? undefined : n))
                  }}
                  inputMode="numeric"
                />
              </Field>
              <Field label={P('非流式 Keepalive 间隔 (秒)')} hint={P('设置为 0 或留空表示禁用')} wide>
                <input
                  value={numOrEmpty(draft['nonstream-keepalive-interval'] ?? streaming['nonstream-keepalive-interval'])}
                  onChange={(e) => {
                    const n = parseNum(e.target.value)
                    onChange(setPath(draft, ['streaming', 'nonstream-keepalive-interval'], n === '' ? undefined : n))
                  }}
                  inputMode="numeric"
                />
              </Field>
            </div>
          </SectionCard>

          <SectionCard
            id="payload"
            title={P('Payload 配置')}
            description={P('设置请求参数的默认值、覆盖值和过滤规则')}
            icon={Code2}
            sectionRef={bindRef('payload')}
          >
            <Field label="payload (JSON)" hint={P('直接编辑 payload 对象；非法 JSON 不会写入')} wide>
              <textarea
                rows={10}
                className="cfg-payload-textarea"
                value={JSON.stringify(payload, null, 2)}
                onChange={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value || '{}')
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                      onChange(setPath(draft, ['payload'], parsed))
                    }
                  } catch {
                    /* ignore while typing */
                  }
                }}
              />
            </Field>
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
