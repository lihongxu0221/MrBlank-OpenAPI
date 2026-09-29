import type { ReactNode } from 'react'
import { ConfigApiKeysPanel } from './ConfigApiKeysPanel'
import type { SecretKeyAction } from './types'
import { P } from '../../../i18n'

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="field" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
      <span>
        {label}
        {hint ? <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{hint}</span> : null}
      </span>
      {children}
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
    <label
      className="field"
      style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, cursor: 'pointer' }}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint ? <div className="muted" style={{ fontSize: 12 }}>{hint}</div> : null}
      </span>
    </label>
  )
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="panel" id={`cfg-sec-${id}`} style={{ marginTop: 14 }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {description ? <p className="muted">{description}</p> : null}
      <div style={{ marginTop: 10 }}>{children}</div>
    </div>
  )
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

const SECTIONS = [
  { id: 'server', title: '服务器配置' },
  { id: 'tls', title: 'TLS/SSL 配置' },
  { id: 'remote', title: '远程管理' },
  { id: 'auth', title: '认证配置' },
  { id: 'system', title: '系统配置' },
  { id: 'headers', title: 'Header 默认值' },
  { id: 'network', title: '网络配置' },
  { id: 'quota', title: '配额回退' },
  { id: 'streaming', title: '流式传输配置' },
  { id: 'payload', title: 'Payload 配置' },
] as const

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

  return (
    <div>
      <div className="channels-toolbar" style={{ flexWrap: 'wrap', gap: 6 }}>
        <span className="muted">{P('快速跳转')}</span>
        {SECTIONS.map((s) => (
          <a key={s.id} className="button secondary compact" href={`#cfg-sec-${s.id}`} onClick={(e) => {
            e.preventDefault()
            document.getElementById(`cfg-sec-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}>
            {P(s.title)}
          </a>
        ))}
      </div>

      <Section id="server" title={P('服务器配置')} description={P('基础服务器设置')}>
        <Field label="host" hint={P('主机地址')}>
          <input
            value={String(draft.host ?? '')}
            onChange={(e) => onChange(setPath(draft, ['host'], e.target.value))}
            autoComplete="off"
          />
        </Field>
        <Field label="port" hint={P('端口')}>
          <input
            value={numOrEmpty(draft.port)}
            onChange={(e) => {
              const n = parseNum(e.target.value)
              onChange(setPath(draft, ['port'], n === '' ? undefined : n))
            }}
            inputMode="numeric"
          />
        </Field>
      </Section>

      <Section id="tls" title={P('TLS/SSL 配置')} description={P('HTTPS 安全连接设置')}>
        <BoolRow
          label={P('启用 TLS')}
          hint={P('启用 HTTPS 安全连接')}
          checked={!!tls.enable}
          onChange={(v) => onChange(setPath(draft, ['tls', 'enable'], v))}
        />
        <Field label="cert" hint={P('证书文件路径')}>
          <input
            value={String(tls.cert ?? '')}
            onChange={(e) => onChange(setPath(draft, ['tls', 'cert'], e.target.value))}
            autoComplete="off"
          />
        </Field>
        <Field label="key" hint={P('私钥文件路径')}>
          <input
            value={String(tls.key ?? '')}
            onChange={(e) => onChange(setPath(draft, ['tls', 'key'], e.target.value))}
            autoComplete="off"
          />
        </Field>
      </Section>

      <Section id="remote" title={P('远程管理')} description={P('远程访问和控制面板设置')}>
        <BoolRow
          label={P('允许远程访问')}
          hint="allow-remote"
          checked={!!rm['allow-remote']}
          onChange={(v) => onChange(setPath(draft, ['remote-management', 'allow-remote'], v))}
        />
        <BoolRow
          label={P('禁用控制面板')}
          hint="disable-control-panel"
          checked={!!rm['disable-control-panel']}
          onChange={(v) => onChange(setPath(draft, ['remote-management', 'disable-control-panel'], v))}
        />
        <BoolRow
          label={P('禁用面板自动更新')}
          hint="disable-auto-update-panel"
          checked={!!rm['disable-auto-update-panel']}
          onChange={(v) => onChange(setPath(draft, ['remote-management', 'disable-auto-update-panel'], v))}
        />
        <Field label={P('面板仓库')} hint="panel-github-repository">
          <input
            value={String(rm['panel-github-repository'] ?? rm['panel-repo'] ?? '')}
            onChange={(e) =>
              onChange(setPath(draft, ['remote-management', 'panel-github-repository'], e.target.value))
            }
            autoComplete="off"
          />
        </Field>
        <div style={{ marginTop: 8, padding: 10, background: 'var(--surface)', borderRadius: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{P('管理密钥')} · secret-key</div>
          <p className="muted" style={{ fontSize: 12 }}>
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
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
            <p style={{ color: 'var(--error)', fontSize: 13 }}>{P('保存后将清空管理密钥并禁用 Management API。')}</p>
          ) : null}
        </div>
      </Section>

      <Section id="auth" title={P('认证配置')} description={P('API 密钥与认证文件目录设置')}>
        <Field label="auth-dir" hint={P('存放认证文件的目录路径（支持 ~）')}>
          <input
            value={String(draft['auth-dir'] ?? '')}
            onChange={(e) => onChange(setPath(draft, ['auth-dir'], e.target.value))}
            autoComplete="off"
          />
        </Field>
        <div style={{ marginTop: 16, borderTop: '1px solid var(--border, #333)', paddingTop: 12 }}>
          <ConfigApiKeysPanel enabled={enabled} />
        </div>
      </Section>

      <Section id="system" title={P('系统配置')} description={P('调试、日志、统计与性能调试设置')}>
        <BoolRow label={P('调试模式')} hint="debug" checked={!!draft.debug} onChange={(v) => onChange(setPath(draft, ['debug'], v))} />
        <BoolRow
          label={P('写入日志文件')}
          hint="logging-to-file"
          checked={!!draft['logging-to-file']}
          onChange={(v) => onChange(setPath(draft, ['logging-to-file'], v))}
        />
        <BoolRow
          label={P('启用用量统计')}
          hint="usage-statistics-enabled"
          checked={!!draft['usage-statistics-enabled']}
          onChange={(v) => onChange(setPath(draft, ['usage-statistics-enabled'], v))}
        />
        <BoolRow
          label="request-log"
          checked={!!draft['request-log']}
          onChange={(v) => onChange(setPath(draft, ['request-log'], v))}
        />
        <BoolRow
          label={P('启用插件系统')}
          hint="plugins.enabled"
          checked={!!plugins.enabled}
          onChange={(v) => onChange(setPath(draft, ['plugins', 'enabled'], v))}
        />
        <Field label="plugins.dir" hint={P('插件目录')}>
          <input
            value={String(plugins.dir ?? '')}
            onChange={(e) => onChange(setPath(draft, ['plugins', 'dir'], e.target.value))}
            autoComplete="off"
          />
        </Field>
        <Field label="logs-max-total-size-mb" hint={P('日志文件大小限制 (MB)')}>
          <input
            value={numOrEmpty(draft['logs-max-total-size-mb'])}
            onChange={(e) => {
              const n = parseNum(e.target.value)
              onChange(setPath(draft, ['logs-max-total-size-mb'], n === '' ? undefined : n))
            }}
            inputMode="numeric"
          />
        </Field>
        <Field label="redis-usage-queue-retention-seconds" hint={P('用量数据保留时间 (秒)')}>
          <input
            value={numOrEmpty(draft['redis-usage-queue-retention-seconds'])}
            onChange={(e) => {
              const n = parseNum(e.target.value)
              onChange(setPath(draft, ['redis-usage-queue-retention-seconds'], n === '' ? undefined : n))
            }}
            inputMode="numeric"
          />
        </Field>
        <BoolRow
          label={P('严格校验旁路签名')}
          hint="antigravity-signature-bypass-strict"
          checked={!!draft['antigravity-signature-bypass-strict']}
          onChange={(v) => onChange(setPath(draft, ['antigravity-signature-bypass-strict'], v))}
        />
        <BoolRow
          label={P('商业模式')}
          hint="commercial-mode"
          checked={!!draft['commercial-mode']}
          onChange={(v) => onChange(setPath(draft, ['commercial-mode'], v))}
        />
      </Section>

      <Section id="headers" title={P('Header 默认值')} description={P('Claude 与 Codex OAuth 请求在客户端缺少 Header 时使用的默认值')}>
        <h4>Claude</h4>
        {(['user-agent', 'package-version', 'runtime-version', 'os', 'arch'] as const).map((k) => (
          <Field key={`c-${k}`} label={k}>
            <input
              value={String(claudeH[k] ?? '')}
              onChange={(e) => onChange(setPath(draft, ['request-header-defaults', 'claude', k], e.target.value))}
              autoComplete="off"
            />
          </Field>
        ))}
        <h4>Codex</h4>
        {(['user-agent', 'package-version', 'runtime-version', 'os', 'arch'] as const).map((k) => (
          <Field key={`x-${k}`} label={k}>
            <input
              value={String(codexH[k] ?? '')}
              onChange={(e) => onChange(setPath(draft, ['request-header-defaults', 'codex', k], e.target.value))}
              autoComplete="off"
            />
          </Field>
        ))}
        <BoolRow
          label={P('启用 Codex 身份混淆')}
          hint="codex.identity-confuse"
          checked={!!asObj(draft.codex)['identity-confuse']}
          onChange={(v) => onChange(setPath(draft, ['codex', 'identity-confuse'], v))}
        />
      </Section>

      <Section id="network" title={P('网络配置')} description={P('代理、重试和路由设置')}>
        <Field label="proxy-url" hint={P('代理 URL')}>
          <input
            value={String(draft['proxy-url'] ?? '')}
            onChange={(e) => onChange(setPath(draft, ['proxy-url'], e.target.value))}
            placeholder="http://127.0.0.1:7890"
            autoComplete="off"
          />
        </Field>
        <Field label="request-retry" hint={P('请求重试次数')}>
          <input
            value={numOrEmpty(draft['request-retry'])}
            onChange={(e) => {
              const n = parseNum(e.target.value)
              onChange(setPath(draft, ['request-retry'], n === '' ? undefined : n))
            }}
            inputMode="numeric"
          />
        </Field>
        <Field label="max-retry-interval" hint={P('最大重试间隔 (秒)')}>
          <input
            value={numOrEmpty(draft['max-retry-interval'])}
            onChange={(e) => {
              const n = parseNum(e.target.value)
              onChange(setPath(draft, ['max-retry-interval'], n === '' ? undefined : n))
            }}
            inputMode="numeric"
          />
        </Field>
        <BoolRow
          label={P('强制模型前缀')}
          hint="force-model-prefix"
          checked={!!draft['force-model-prefix']}
          onChange={(v) => onChange(setPath(draft, ['force-model-prefix'], v))}
        />
        <BoolRow
          label={P('WebSocket 认证')}
          hint="ws-auth"
          checked={!!draft['ws-auth']}
          onChange={(v) => onChange(setPath(draft, ['ws-auth'], v))}
        />
        <BoolRow
          label={P('禁用冷却调度')}
          hint="disable-cooling"
          checked={!!draft['disable-cooling']}
          onChange={(v) => onChange(setPath(draft, ['disable-cooling'], v))}
        />
        <BoolRow
          label={P('转发外部服务响应头')}
          hint="passthrough-headers"
          checked={!!draft['passthrough-headers']}
          onChange={(v) => onChange(setPath(draft, ['passthrough-headers'], v))}
        />
        <Field label={P('路由策略')} hint="routing.strategy">
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
        <Field label="session-affinity-ttl" hint={P('会话粘性 TTL')}>
          <input
            value={String(draft['session-affinity-ttl'] ?? '')}
            onChange={(e) => onChange(setPath(draft, ['session-affinity-ttl'], e.target.value))}
            autoComplete="off"
          />
        </Field>
      </Section>

      <Section id="quota" title={P('配额回退')} description={P('配额耗尽时的回退策略')}>
        <BoolRow
          label={P('切换项目')}
          hint="switch-project"
          checked={!!(quota['switch-project'] ?? draft['switch-project'])}
          onChange={(v) => onChange(setPath(draft, ['switch-project'], v))}
        />
        <BoolRow
          label={P('切换预览模型')}
          hint="switch-preview-model"
          checked={!!(quota['switch-preview-model'] ?? draft['switch-preview-model'])}
          onChange={(v) => onChange(setPath(draft, ['switch-preview-model'], v))}
        />
      </Section>

      <Section id="streaming" title={P('流式传输配置')} description={P('Keepalive 与 bootstrap 重试设置')}>
        <Field label="keepalive-seconds" hint={P('设置为 0 或留空表示禁用')}>
          <input
            value={numOrEmpty(streaming['keepalive-seconds'])}
            onChange={(e) => {
              const n = parseNum(e.target.value)
              onChange(setPath(draft, ['streaming', 'keepalive-seconds'], n === '' ? undefined : n))
            }}
            inputMode="numeric"
          />
        </Field>
        <Field label="bootstrap-retries" hint={P('流式传输启动时（首包前）的重试次数')}>
          <input
            value={numOrEmpty(streaming['bootstrap-retries'])}
            onChange={(e) => {
              const n = parseNum(e.target.value)
              onChange(setPath(draft, ['streaming', 'bootstrap-retries'], n === '' ? undefined : n))
            }}
            inputMode="numeric"
          />
        </Field>
        <Field label="nonstream-keepalive-interval" hint={P('非流式 Keepalive 间隔 (秒)')}>
          <input
            value={numOrEmpty(draft['nonstream-keepalive-interval'])}
            onChange={(e) => {
              const n = parseNum(e.target.value)
              onChange(setPath(draft, ['nonstream-keepalive-interval'], n === '' ? undefined : n))
            }}
            inputMode="numeric"
          />
        </Field>
      </Section>

      <Section id="payload" title={P('Payload 配置')} description={P('默认值 / 覆盖 / 过滤（JSON 对象，高级）')}>
        <Field label="payload (JSON)" hint={P('直接编辑 payload 对象；非法 JSON 不会写入')}>
          <textarea
            rows={8}
            style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, width: '100%' }}
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
      </Section>
    </div>
  )
}
