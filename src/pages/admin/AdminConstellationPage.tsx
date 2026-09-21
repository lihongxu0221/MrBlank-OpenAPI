import { useEffect, useState } from 'react'
import { Plus, RefreshCw, Save, Sparkles, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { P } from '../../i18n'
import { ConsoleHero } from '../../components/ConsoleHero'
import { AdminLayout } from './AdminLayout'
import { useAdminGate } from './useAdminGate'

type Card = {
  id: string
  title: string
  status: string
  description: string
  tags: string[]
  model_ids: string[]
  sort_order: number
  enabled: boolean
}

type Constellation = {
  eyebrow: string
  heading: string
  lead: string
  cards: Card[]
  updated_at?: string | null
}

function blankCard(order: number): Card {
  return {
    id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: '',
    status: '规划中',
    description: '',
    tags: [],
    model_ids: [],
    sort_order: order,
    enabled: true,
  }
}

export function AdminConstellationPage({ path }: { path: string }) {
  const gate = useAdminGate()
  const [data, setData] = useState<Constellation | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  async function load() {
    if (!gate.allowed) return
    setLoading(true)
    setErr(null)
    try {
      setData(await api.get<Constellation>('/api/admin/constellation'))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (gate.allowed) load()
  }, [gate.allowed])

  function updateMeta<K extends keyof Constellation>(key: K, value: Constellation[K]) {
    setData((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  function updateCard(index: number, patch: Partial<Card>) {
    setData((prev) => {
      if (!prev) return prev
      const cards = prev.cards.map((c, i) => (i === index ? { ...c, ...patch } : c))
      return { ...prev, cards }
    })
  }

  function removeCard(index: number) {
    setData((prev) => {
      if (!prev) return prev
      return { ...prev, cards: prev.cards.filter((_, i) => i !== index) }
    })
  }

  function addCard() {
    setData((prev) => {
      if (!prev) return prev
      const nextOrder = (prev.cards.at(-1)?.sort_order || 0) + 10
      return { ...prev, cards: [...prev.cards, blankCard(nextOrder)] }
    })
  }

  async function save() {
    if (!data) return
    setSaving(true)
    setErr(null)
    setMsg(null)
    try {
      const saved = await api.put<Constellation>('/api/admin/constellation', {
        eyebrow: data.eyebrow,
        heading: data.heading,
        lead: data.lead,
        cards: data.cards,
      })
      setData(saved)
      setMsg(P('已保存，首页将立即使用新配置。'))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function seedFromModels() {
    setSaving(true)
    setErr(null)
    setMsg(null)
    try {
      const saved = await api.post<Constellation & { seeded?: number }>(
        '/api/admin/constellation/seed-from-models',
      )
      setData(saved)
      setMsg(
        P(
          `已从 CPA 模型列表生成 ${saved.seeded ?? saved.cards?.length ?? 0} 条，可继续编辑后保存。`,
        ),
      )
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdminLayout path={path} allowed={gate.allowed} checked={gate.checked}>
      <ConsoleHero
        title={P('模型星座')}
        subtitle={P('配置首页「模型星座」卡片：状态、文案与标签。样式沿用本站视觉系统。')}
      />
      <div className="channels-toolbar">
        <span className="muted">
          {P('更新于')}：
          {data?.updated_at
            ? new Date(data.updated_at).toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai',
                hour12: false,
              })
            : '—'}
        </span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="button secondary compact" onClick={load} disabled={loading || saving}>
            <RefreshCw size={14} /> {P('刷新')}
          </button>
          <button
            type="button"
            className="button secondary compact"
            onClick={seedFromModels}
            disabled={saving || !gate.allowed}
          >
            <Sparkles size={14} /> {P('从 CPA 模型生成')}
          </button>
          <button type="button" className="button compact" onClick={save} disabled={saving || !data}>
            <Save size={14} /> {saving ? P('保存中…') : P('保存')}
          </button>
        </div>
      </div>
      {err ? <p style={{ color: 'var(--error)' }}>{err}</p> : null}
      {msg ? <p style={{ color: 'var(--success, var(--accent))' }}>{msg}</p> : null}

      {data ? (
        <>
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="field">
              <label>{P('眉题 eyebrow')}</label>
              <input value={data.eyebrow} onChange={(e) => updateMeta('eyebrow', e.target.value)} />
            </div>
            <div className="field">
              <label>{P('标题')}</label>
              <input value={data.heading} onChange={(e) => updateMeta('heading', e.target.value)} />
            </div>
            <div className="field">
              <label>{P('说明')}</label>
              <textarea
                rows={2}
                value={data.lead}
                onChange={(e) => updateMeta('lead', e.target.value)}
              />
            </div>
          </div>

          <div className="channels-toolbar">
            <h3 style={{ margin: 0 }}>{P('卡片列表')}</h3>
            <button type="button" className="button secondary compact" onClick={addCard}>
              <Plus size={14} /> {P('添加卡片')}
            </button>
          </div>

          <div className="model-catalog" style={{ marginTop: 12 }}>
            {data.cards.map((card, index) => (
              <article key={card.id} className="catalog-card" style={{ textAlign: 'left' }}>
                <div className="field">
                  <label>{P('标题')}</label>
                  <input
                    value={card.title}
                    onChange={(e) => updateCard(index, { title: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>{P('状态')}</label>
                  <input
                    value={card.status}
                    placeholder={P('已上线 / 规划中')}
                    onChange={(e) => updateCard(index, { status: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>{P('描述')}</label>
                  <textarea
                    rows={2}
                    value={card.description}
                    onChange={(e) => updateCard(index, { description: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>{P('标签（逗号分隔）')}</label>
                  <input
                    value={card.tags.join(', ')}
                    onChange={(e) =>
                      updateCard(index, {
                        tags: e.target.value
                          .split(/[,，]/)
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label>{P('关联模型 ID（可选）')}</label>
                  <input
                    value={card.model_ids.join(', ')}
                    onChange={(e) =>
                      updateCard(index, {
                        model_ids: e.target.value
                          .split(/[,，\s]+/)
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label>{P('排序')}</label>
                  <input
                    type="number"
                    value={card.sort_order}
                    onChange={(e) => updateCard(index, { sort_order: Number(e.target.value) || 0 })}
                  />
                </div>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                  <input
                    type="checkbox"
                    checked={card.enabled}
                    onChange={(e) => updateCard(index, { enabled: e.target.checked })}
                  />
                  {P('在首页显示')}
                </label>
                <button
                  type="button"
                  className="button ghost compact"
                  onClick={() => removeCard(index)}
                >
                  <Trash2 size={14} /> {P('删除')}
                </button>
              </article>
            ))}
          </div>
        </>
      ) : loading ? (
        <p className="inline-loading">{P('加载中…')}</p>
      ) : null}
    </AdminLayout>
  )
}
