import { useEffect, useState } from 'react'
import { Copy } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleLayout } from './ConsoleLayout'
import { ConsoleHero } from '../../components/ConsoleHero'
import { useToast } from '../../hooks/useStore'
import { navigate } from '../../router/hash'

type Model = {
  id: string
  name: string
  provider?: string
  kind: string
  text_price?: number
  text_out_price?: number
  image_price?: number
  video_price?: number
  planned?: boolean
}

function costLabel(m: Model) {
  if (m.kind === 'image' || m.image_price) return `${m.image_price ?? 0} / img`
  if (m.kind === 'video' || m.video_price) return `${m.video_price ?? 0} / s`
  const inn = m.text_price ?? 0
  const out = m.text_out_price ?? inn
  return `${inn} in · ${out} out`
}

function kindLabel(kind: string) {
  if (kind === 'image') return P('图片')
  if (kind === 'video') return P('视频')
  return P('文本')
}

export function ModelsPage({ path }: { path: string }) {
  const [models, setModels] = useState<Model[]>([])
  const { toast, showToast } = useToast()

  useEffect(() => {
    api
      .get<{ model_details: Model[] }>('/api/token/options')
      .then((d) => setModels((d.model_details || []).filter((m) => !m.planned)))
      .catch(() => {})
  }, [])

  function copyId(id: string) {
    navigator.clipboard?.writeText(id)
    showToast(P('已复制'))
  }

  return (
    <ConsoleLayout path={path} bare>
      <ConsoleHero title={P('模型广场')} subtitle={P('把每一份社区资源，用在新的可能上。')} />

      <div className="panel models-panel">
        <div className="info-banner">
          {P('模型列表来自 CPA + 本站 Aily（若已配置路由/凭证），经本站服务端合并。价格字段若为 0 表示暂未接入计费展示。')}{' '}
          <button type="button" className="text-link inline" onClick={() => navigate('/channels')}>
            {P('服务状态')}
          </button>
        </div>

        <div className="table-wrap borderless">
          <table className="data models-table">
            <thead>
              <tr>
                <th>{P('模型')}</th>
                <th>{P('类型')}</th>
                <th>{P('消耗标准（点）')}</th>
                <th>{P('API ID')}</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id}>
                  <td>
                    <strong>{m.name}</strong>
                    <div className="model-provider">{m.provider || 'xAI'}</div>
                  </td>
                  <td>{kindLabel(m.kind)}</td>
                  <td className="mono">{costLabel(m)}</td>
                  <td>
                    <div className="api-id-cell">
                      <code>{m.id}</code>
                      <button type="button" className="button ghost compact" onClick={() => copyId(m.id)}>
                        <Copy size={13} /> {P('复制')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {toast ? <div className="toast">{toast}</div> : null}
    </ConsoleLayout>
  )
}
