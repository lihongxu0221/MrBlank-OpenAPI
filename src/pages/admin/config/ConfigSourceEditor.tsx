import type { ReactNode } from 'react'
import { P } from '../../../i18n'
import { lineDiff } from './diff'

export function ConfigSourceEditor({
  value,
  onChange,
  baseline,
  writeEnabled,
}: {
  value: string
  onChange: (v: string) => void
  baseline: string
  writeEnabled: boolean
}) {
  const dirty = value !== baseline
  return (
    <div>
      <p className="muted">
        {P('源文件编辑 config.yaml（已脱敏）。空内容与 {} 会被服务端拒绝；保存前自动备份。')}
        {!writeEnabled ? ` · ${P('写入已禁用')}` : ''}
      </p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={28}
        spellCheck={false}
        style={{
          width: '100%',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: 12,
          lineHeight: 1.45,
          padding: 12,
          borderRadius: 8,
          background: 'var(--surface)',
          color: 'inherit',
          border: '1px solid var(--border, #333)',
        }}
        placeholder={P('YAML…')}
      />
      {dirty ? (
        <p className="muted" style={{ marginTop: 8 }}>
          {P('有未保存的更改')} · {value.length} chars
        </p>
      ) : null}
    </div>
  )
}

export function ConfigDiffPreview({ before, after }: { before: string; after: string }): ReactNode {
  const rows = lineDiff(before, after)
  const changes = rows.filter((r) => r.kind !== 'same')
  if (!changes.length) {
    return <p className="muted">{P('无变更')}</p>
  }
  return (
    <pre
      style={{
        maxHeight: 360,
        overflow: 'auto',
        fontSize: 12,
        lineHeight: 1.4,
        background: 'var(--surface)',
        padding: 12,
        borderRadius: 8,
      }}
    >
      {rows.map((r, i) => (
        <div
          key={i}
          style={{
            color: r.kind === 'add' ? 'var(--success, #3d9)' : r.kind === 'del' ? 'var(--error)' : 'inherit',
            opacity: r.kind === 'same' ? 0.45 : 1,
          }}
        >
          {r.kind === 'add' ? '+ ' : r.kind === 'del' ? '- ' : '  '}
          {r.text}
        </div>
      ))}
    </pre>
  )
}
