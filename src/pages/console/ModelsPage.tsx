import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleLayout } from './ConsoleLayout'

export function ModelsPage({ path }: { path: string }) {
  const [models, setModels] = useState<any[]>([])
  useEffect(() => {
    api
      .get<{ model_details: any[] }>('/api/token/options')
      .then((d) => setModels(d.model_details || []))
      .catch(() => {})
  }, [])

  return (
    <ConsoleLayout path={path} title={P('模型广场')} subtitle={P('了解定价与能力，选择适合问题的工具。')}>
      <div className="catalog-grid">
        {models.map((m) => (
          <article key={m.id} className="catalog-card">
            <div className="catalog-phase">{m.planned ? P('规划中') : P('可用')}</div>
            <h3>{m.name}</h3>
            <p style={{ color: 'var(--muted)' }}>{m.id}</p>
            <div className="catalog-tags">
              <span>{m.kind}</span>
              {m.text_price ? <span>text × {m.text_price}</span> : null}
              {m.image_price ? <span>image × {m.image_price}</span> : null}
              {m.video_price ? <span>video × {m.video_price}</span> : null}
            </div>
          </article>
        ))}
      </div>
    </ConsoleLayout>
  )
}
