/**
 * Editable site content (homepage constellation, etc.).
 * Persisted under server/data/site-content.json — never commit secrets here.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const DEFAULT_CONSTELLATION = [
  {
    id: 'grok',
    title: 'Grok',
    status: '已上线',
    description: '实时信息与深度推理',
    tags: ['grok-4.6', 'grok-imagine'],
    model_ids: ['grok-4.6', 'grok-imagine'],
    sort_order: 10,
    enabled: true,
  },
  {
    id: 'claude',
    title: 'Claude',
    status: '规划中',
    description: '长文理解与写作协作',
    tags: ['Messages', 'Tools'],
    model_ids: [],
    sort_order: 20,
    enabled: true,
  },
  {
    id: 'gpt',
    title: 'GPT',
    status: '规划中',
    description: '通用智能与工具调用',
    tags: ['Chat', 'Vision'],
    model_ids: [],
    sort_order: 30,
    enabled: true,
  },
]

function defaultDoc() {
  return {
    constellation: {
      eyebrow: '模型星座',
      heading: '一个入口，多种智能',
      lead: '当前以 Grok 为主力；Claude / GPT 等仍在规划中。',
      cards: DEFAULT_CONSTELLATION,
    },
    updated_at: null,
  }
}

function normalizeCard(raw, index = 0) {
  const title = String(raw?.title || raw?.name || '').trim()
  const id =
    String(raw?.id || '').trim() ||
    title.toLowerCase().replace(/\s+/g, '-') ||
    crypto.randomBytes(4).toString('hex')
  const tags = Array.isArray(raw?.tags)
    ? raw.tags.map((t) => String(t).trim()).filter(Boolean)
    : String(raw?.tags || '')
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean)
  const model_ids = Array.isArray(raw?.model_ids)
    ? raw.model_ids.map((t) => String(t).trim()).filter(Boolean)
    : String(raw?.model_ids || '')
        .split(/[,，\s]+/)
        .map((t) => t.trim())
        .filter(Boolean)
  return {
    id,
    title: title || id,
    status: String(raw?.status || raw?.phase || '规划中').trim() || '规划中',
    description: String(raw?.description || raw?.note || '').trim(),
    tags,
    model_ids,
    sort_order: Number.isFinite(Number(raw?.sort_order)) ? Number(raw.sort_order) : (index + 1) * 10,
    enabled: raw?.enabled !== false,
  }
}

function normalizeDoc(raw) {
  const base = defaultDoc()
  const c = raw?.constellation && typeof raw.constellation === 'object' ? raw.constellation : {}
  const cardsIn = Array.isArray(c.cards) ? c.cards : base.constellation.cards
  return {
    constellation: {
      eyebrow: String(c.eyebrow || base.constellation.eyebrow),
      heading: String(c.heading || base.constellation.heading),
      lead: String(c.lead || base.constellation.lead),
      cards: cardsIn.map((card, i) => normalizeCard(card, i)),
    },
    updated_at: raw?.updated_at || null,
  }
}

export function createSiteContentStore(filePath) {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })

  function read() {
    if (!fs.existsSync(filePath)) {
      const doc = defaultDoc()
      write(doc)
      return doc
    }
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      return normalizeDoc(raw)
    } catch {
      return defaultDoc()
    }
  }

  function write(doc) {
    const normalized = normalizeDoc(doc)
    normalized.updated_at = new Date().toISOString()
    const tmp = `${filePath}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2), { mode: 0o644 })
    fs.renameSync(tmp, filePath)
    return normalized
  }

  return {
    get() {
      return read()
    },
    getPublicConstellation() {
      const doc = read()
      const cards = doc.constellation.cards
        .filter((c) => c.enabled)
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title))
      return {
        eyebrow: doc.constellation.eyebrow,
        heading: doc.constellation.heading,
        lead: doc.constellation.lead,
        cards: cards.map(({ id, title, status, description, tags, model_ids, sort_order }) => ({
          id,
          title,
          status,
          description,
          tags,
          model_ids,
          sort_order,
        })),
        updated_at: doc.updated_at,
      }
    },
    getAdminConstellation() {
      const doc = read()
      return {
        ...doc.constellation,
        cards: doc.constellation.cards
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title)),
        updated_at: doc.updated_at,
      }
    },
    saveConstellation(payload) {
      const doc = read()
      const next = {
        ...doc,
        constellation: {
          eyebrow: payload?.eyebrow ?? doc.constellation.eyebrow,
          heading: payload?.heading ?? doc.constellation.heading,
          lead: payload?.lead ?? doc.constellation.lead,
          cards: Array.isArray(payload?.cards) ? payload.cards : doc.constellation.cards,
        },
      }
      return write(next).constellation
    },
    seedFromModelIds(modelIds = []) {
      const doc = read()
      if (doc.constellation.cards.length) return doc.constellation
      const ids = (modelIds || []).map(String).filter(Boolean)
      if (!ids.length) return write(doc).constellation
      const cards = ids.slice(0, 12).map((mid, i) =>
        normalizeCard(
          {
            id: mid,
            title: mid,
            status: '已上线',
            description: '',
            tags: [mid],
            model_ids: [mid],
            sort_order: (i + 1) * 10,
            enabled: true,
          },
          i,
        ),
      )
      return write({
        ...doc,
        constellation: {
          ...doc.constellation,
          lead: '以下模型来自 CPA /v1/models，可在管理台继续编辑。',
          cards,
        },
      }).constellation
    },
  }
}
