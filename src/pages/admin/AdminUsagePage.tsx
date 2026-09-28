import { useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { useToast } from '../../hooks/useStore'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'
import { UsageRecords } from '../../components/usage/UsageRecords'

export function AdminUsagePage({ path }: { path: string }) {
  const gate = useAdminGate()
  const { showToast } = useToast()
  const [ioBusy, setIoBusy] = useState(false)
  const [importMode, setImportMode] = useState<'append' | 'merge'>('merge')

  async function exportUsage() {
    setIoBusy(true)
    try {
      const bundle = await api.get<{ count?: number; events?: unknown[] }>('/api/admin/usage/export?period=all')
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `site-usage-export-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      showToast(P(`已导出 ${bundle.count ?? bundle.events?.length ?? 0} 条事件`))
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setIoBusy(false)
    }
  }

  async function onImportFile(file: File | null) {
    if (!file) return
    setIoBusy(true)
    try {
      const text = await file.text()
      let payload: unknown
      try {
        payload = JSON.parse(text)
      } catch {
        showToast(P('JSON 解析失败'))
        return
      }
      const result = await api.post<{
        added: number
        skipped: number
        invalid: number
        total_events: number
        mode: string
      }>('/api/admin/usage/import', { mode: importMode, ...(payload as object) })
      showToast(
        P(`导入完成：+${result.added} 跳过 ${result.skipped} 无效 ${result.invalid}（共 ${result.total_events}）`),
      )
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setIoBusy(false)
    }
  }

  const toolbarExtra = (
    <>
      <button type="button" className="button secondary compact" onClick={() => void exportUsage()} disabled={ioBusy}>
        <Download size={14} /> {P('导出 JSON')}
      </button>
      <label className="button secondary compact" style={{ cursor: 'pointer', margin: 0 }}>
        <Upload size={14} /> {P('导入 JSON')}
        <input
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          disabled={ioBusy}
          onChange={(e) => {
            const f = e.target.files?.[0] || null
            e.target.value = ''
            void onImportFile(f)
          }}
        />
      </label>
      <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {P('模式')}
        <select
          value={importMode}
          onChange={(e) => setImportMode(e.target.value === 'append' ? 'append' : 'merge')}
          disabled={ioBusy}
        >
          <option value="merge">merge</option>
          <option value="append">append</option>
        </select>
      </label>
    </>
  )

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero
        title={P('使用记录')}
        subtitle={P('aily 对齐：筛选 / 分布 / 分页；双击明细打开请求诊断（仅管理后台）。')}
      />
      {gate.allowed ? <UsageRecords mode="admin" toolbarExtra={toolbarExtra} /> : null}
    </AdminLayout>
  )
}
