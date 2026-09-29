import { useCallback, useEffect, useMemo, useState } from 'react'
import { dump as yamlDump, load as yamlLoad } from 'js-yaml'
import { RefreshCw, Save } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'
import { useToast } from '../../hooks/useStore'
import { getHashQuery, navigateWithQuery } from '../../router/hash'
import { ConfigVisualForm } from './config/ConfigVisualForm'
import { ConfigSourceEditor, ConfigDiffPreview } from './config/ConfigSourceEditor'
import { ConfigConnectionPanel } from './config/ConfigConnectionPanel'
import type { ConfigTab, ConfigYamlPayload, SecretKeyAction } from './config/types'

function dumpDraft(cfg: Record<string, unknown>): string {
  return yamlDump(cfg ?? {}, { lineWidth: -1, noRefs: true })
}

function parseDraft(text: string): Record<string, unknown> | null {
  try {
    const doc = yamlLoad(text)
    if (doc && typeof doc === 'object' && !Array.isArray(doc)) return doc as Record<string, unknown>
    return null
  } catch {
    return null
  }
}

export function AdminConfigPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const { showToast } = useToast()
  const qs = getHashQuery()
  const initialTab = (qs.get('tab') as ConfigTab) || 'visual'
  const [tab, setTab] = useState<ConfigTab>(['visual', 'source', 'connection'].includes(initialTab) ? initialTab : 'visual')

  const [baselineYaml, setBaselineYaml] = useState('')
  const [baselineConfig, setBaselineConfig] = useState<Record<string, unknown>>({})
  const [draftConfig, setDraftConfig] = useState<Record<string, unknown>>({})
  const [sourceText, setSourceText] = useState('')
  const [etag, setEtag] = useState('')
  const [writeEnabled, setWriteEnabled] = useState(true)
  const [secretMeta, setSecretMeta] = useState<{ present: boolean; masked: string }>({ present: false, masked: '' })
  const [secretKeyAction, setSecretKeyAction] = useState<SecretKeyAction>('keep')
  const [secretKeyInput, setSecretKeyInput] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [diffOpen, setDiffOpen] = useState(false)
  const [pendingYaml, setPendingYaml] = useState<string | null>(null)
  const [lastBackup, setLastBackup] = useState<string | null>(null)

  const dirty = useMemo(() => {
    if (tab === 'connection') return false
    if (tab === 'source') return sourceText !== baselineYaml
    return dumpDraft(draftConfig) !== dumpDraft(baselineConfig)
  }, [tab, sourceText, baselineYaml, draftConfig, baselineConfig])

  const load = useCallback(async () => {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      const d = await api.get<ConfigYamlPayload>('/api/admin/config.yaml')
      const cfg = (d.config || {}) as Record<string, unknown>
      const y = d.yaml || dumpDraft(cfg)
      setBaselineYaml(y)
      setBaselineConfig(cfg)
      setDraftConfig(structuredClone(cfg))
      setSourceText(y)
      setEtag(d.etag || '')
      setWriteEnabled(d.write_enabled !== false)
      setSecretMeta({ present: !!d.secret_key?.present, masked: d.secret_key?.masked || '' })
      setSecretKeyAction((d.secret_key?.action_default as SecretKeyAction) || (d.secret_key?.present ? 'keep' : 'replace'))
      setSecretKeyInput('')
      setLastBackup(null)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [gate.allowed])

  useEffect(() => {
    if (gate.allowed) load()
  }, [gate.allowed, load])

  function switchTab(next: ConfigTab) {
    if (dirty && next !== tab) {
      if (!confirm(P('切换标签将丢弃未保存的修改，确定继续吗？'))) return
      // reset draft from baseline
      setDraftConfig(structuredClone(baselineConfig))
      setSourceText(baselineYaml)
      setSecretKeyAction(secretMeta.present ? 'keep' : 'replace')
      setSecretKeyInput('')
    }
    setTab(next)
    navigateWithQuery('/admin/config', next === 'visual' ? {} : { tab: next })
  }

  function reloadConfirm() {
    if (dirty && !confirm(P('重新加载将丢弃你当前未保存的修改，确定继续吗？'))) return
    load()
  }

  function requestSave() {
    if (!writeEnabled) {
      showToast(P('写入已禁用'))
      return
    }
    let yamlOut = ''
    if (tab === 'source') {
      if (!sourceText.trim()) {
        setErr(P('拒绝空 YAML'))
        showToast(P('拒绝空 YAML'))
        return
      }
      const parsed = parseDraft(sourceText)
      if (!parsed || Object.keys(parsed).length === 0) {
        setErr(P('拒绝空配置 {}'))
        showToast(P('拒绝空配置 {}'))
        return
      }
      yamlOut = sourceText
    } else {
      yamlOut = dumpDraft(draftConfig)
      if (!yamlOut.trim() || yamlOut.trim() === '{}') {
        setErr(P('拒绝空配置 {}'))
        showToast(P('拒绝空配置 {}'))
        return
      }
    }
    setPendingYaml(yamlOut)
    setDiffOpen(true)
  }

  async function confirmSave() {
    if (!pendingYaml) return
    setSaving(true)
    setErr(null)
    try {
      const body: Record<string, unknown> = {
        yaml: pendingYaml,
        secret_key_action: secretKeyAction,
        etag,
      }
      if (secretKeyAction === 'replace') body.secret_key = secretKeyInput
      const d = await api.put<ConfigYamlPayload>('/api/admin/config.yaml', body)
      const cfg = (d.config || {}) as Record<string, unknown>
      const y = d.yaml || dumpDraft(cfg)
      setBaselineYaml(y)
      setBaselineConfig(cfg)
      setDraftConfig(structuredClone(cfg))
      setSourceText(y)
      setEtag(d.etag || '')
      setSecretMeta({ present: !!d.secret_key?.present, masked: d.secret_key?.masked || '' })
      setSecretKeyAction(d.secret_key?.present ? 'keep' : 'replace')
      setSecretKeyInput('')
      if (d.backup?.name) setLastBackup(d.backup.name)
      setDiffOpen(false)
      setPendingYaml(null)
      showToast(P('配置已保存'))
    } catch (e) {
      setErr((e as Error).message)
      showToast((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const statusLabel = loading
    ? P('加载中')
    : err
      ? P('失败')
      : dirty
        ? P('未保存')
        : P('已加载')

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero
        title={P('配置面板')}
        subtitle={P('通过可视化或者源文件方式编辑 config.yaml；第三页为本站连接（非 CPAMP usage-service）。')}
      />

      <div className="channels-toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(
            [
              ['visual', P('可视化')],
              ['source', P('源文件')],
              ['connection', P('本站连接')],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`button compact ${tab === id ? '' : 'secondary'}`}
              onClick={() => switchTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className={`muted ${dirty ? 'cred-models-dirty is-dirty' : ''}`} style={{ marginLeft: 'auto' }}>
          {statusLabel}
          {lastBackup ? ` · bak ${lastBackup}` : ''}
          {writeEnabled ? '' : ` · ${P('只读')}`}
        </span>
        <button type="button" className="button secondary compact" onClick={reloadConfirm} disabled={loading}>
          <RefreshCw size={14} /> {P('重新加载')}
        </button>
        {tab !== 'connection' ? (
          <button type="button" className="button compact" onClick={requestSave} disabled={loading || saving || !dirty || !writeEnabled}>
            <Save size={14} /> {P('保存')}
          </button>
        ) : null}
      </div>

      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}

      {tab === 'visual' ? (
        <ConfigVisualForm
          draft={draftConfig}
          onChange={setDraftConfig}
          secretKeyAction={secretKeyAction}
          onSecretKeyAction={setSecretKeyAction}
          secretKeyInput={secretKeyInput}
          onSecretKeyInput={setSecretKeyInput}
          secretKeyPresent={secretMeta.present}
          secretKeyMasked={secretMeta.masked}
          enabled={gate.allowed}
        />
      ) : null}
      {tab === 'source' ? (
        <div className="panel" style={{ marginTop: 12 }}>
          <ConfigSourceEditor
            value={sourceText}
            onChange={setSourceText}
            baseline={baselineYaml}
            writeEnabled={writeEnabled}
          />
        </div>
      ) : null}
      {tab === 'connection' ? (
        <div style={{ marginTop: 12 }}>
          <ConfigConnectionPanel enabled={gate.allowed} />
        </div>
      ) : null}

      {diffOpen ? (
        <div
          role="dialog"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            zIndex: 80,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => !saving && setDiffOpen(false)}
        >
          <div
            className="panel"
            style={{ maxWidth: 720, width: '100%', maxHeight: '90vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>{P('确认保存配置')}</h3>
            <p className="muted">
              {P('保存前将自动备份当前 CPA config.yaml。secret-key 动作')} · {secretKeyAction}
            </p>
            <ConfigDiffPreview before={baselineYaml} after={pendingYaml || ''} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="button secondary" disabled={saving} onClick={() => setDiffOpen(false)}>
                {P('取消')}
              </button>
              <button type="button" className="button" disabled={saving} onClick={confirmSave}>
                {saving ? P('保存中') : P('确认')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AdminLayout>
  )
}
