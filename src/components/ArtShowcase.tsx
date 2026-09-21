import { useEffect, useState } from 'react'
import { Pause, Play, Shuffle } from 'lucide-react'
import { P } from '../i18n'

const ART = [
  { id: 'melencolia-i', title: 'Melencolia I', artist: 'Albrecht Dürer', year: '1514', file: 'melencolia-i-hero.webp' },
  { id: 'vitruvian-man', title: 'Vitruvian Man', artist: 'Leonardo da Vinci', year: 'c. 1490', file: 'vitruvian-man-hero.webp' },
  { id: 'rhinoceros', title: 'Rhinoceros', artist: 'Albrecht Dürer', year: '1515', file: 'rhinoceros-hero.webp' },
]

export function ArtShowcase() {
  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)
  const art = ART[idx]

  useEffect(() => {
    if (paused) return
    const t = setInterval(() => setIdx((i) => (i + 1) % ART.length), 30000)
    return () => clearInterval(t)
  }, [paused])

  return (
    <section className="section">
      <div className="section-heading">
        <div className="eyebrow">{P('经典画作互动展台', 'Interactive art study')}</div>
        <h2>{P('灵感，不止一种形态', 'AN IDEA TAKES SHAPE')}</h2>
        <p>{P('经典艺术 × 互动光点 · 公有领域作品', 'Classical art × interactive light · Public domain works')}</p>
      </div>
      <div className="art-showcase">
        <div className="art-plate">
          <img src={`/art/${art.file}`} alt={art.title} />
        </div>
        <div className="art-caption">
          <div>
            <div className="eyebrow">{art.year}</div>
            <strong>{art.title}</strong>
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>{art.artist}</div>
          </div>
          <div className="art-controls">
            <button type="button" className="icon-button" onClick={() => setPaused((p) => !p)}>
              {paused ? <Play size={16} /> : <Pause size={16} />}
            </button>
            <button type="button" className="icon-button" onClick={() => setIdx((i) => (i + 1) % ART.length)}>
              <Shuffle size={16} />
            </button>
          </div>
        </div>
        <div className="art-selector">
          {ART.map((a, i) => (
            <button type="button" key={a.id} className={`button ${i === idx ? '' : 'secondary'}`} onClick={() => setIdx(i)}>
              {a.title}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
