export type CredModel = { id: string; name?: string; provider?: string }

export function parseExcludedModels(raw: unknown): string[] {
  if (raw == null || raw === '') return []
  if (Array.isArray(raw)) {
    return dedupeStrings(raw.map((x) => String(x ?? '').trim()).filter(Boolean))
  }
  if (typeof raw === 'string') {
    return dedupeStrings(
      raw
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    )
  }
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    const nested = o.excluded_models ?? o['excluded-models'] ?? o.excludedModels ?? o.models ?? o.items
    if (nested != null && nested !== raw) return parseExcludedModels(nested)
  }
  return []
}

export function normalizeAuthFileModels(raw: unknown): CredModel[] {
  const list = extractModelsArray(raw)
  const seen = new Set<string>()
  const out: CredModel[] = []
  for (const item of list) {
    const m = coerceModel(item)
    if (!m) continue
    const key = m.id.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(m)
  }
  return out
}

export function isModelExcluded(modelId: string, excludedRules: Iterable<string>): boolean {
  const id = String(modelId || '').trim()
  if (!id) return false
  const idLower = id.toLowerCase()
  for (const rule of excludedRules || []) {
    const r = String(rule || '').trim()
    if (!r) continue
    if (r === id || r.toLowerCase() === idLower) return true
    if (r.includes('*') && wildcardMatch(r.toLowerCase(), idLower)) return true
  }
  return false
}

export function computeModelFilterCounts(models: CredModel[], excludedRules: Iterable<string>) {
  const rules = [...(excludedRules || [])]
  let available = 0
  let disabled = 0
  for (const m of models || []) {
    if (isModelExcluded(m.id, rules)) disabled += 1
    else available += 1
  }
  return { all: (models || []).length, available, disabled }
}

export function toggleExcludedModel(draft: string[], modelId: string, disable: boolean): string[] {
  const id = String(modelId || '').trim()
  if (!id) return parseExcludedModels(draft)
  const cur = parseExcludedModels(draft)
  const lower = id.toLowerCase()
  const without = cur.filter((x) => x.toLowerCase() !== lower)
  if (disable) without.push(id)
  return dedupeStrings(without)
}

export function excludedListsEqual(a: string[], b: string[]): boolean {
  const aa = [...parseExcludedModels(a)].map((x) => x.toLowerCase()).sort()
  const bb = [...parseExcludedModels(b)].map((x) => x.toLowerCase()).sort()
  if (aa.length !== bb.length) return false
  return aa.every((v, i) => v === bb[i])
}

function dedupeStrings(arr: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of arr) {
    const k = s.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out
}

function extractModelsArray(raw: unknown): unknown[] {
  if (raw == null) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'object') return []
  const o = raw as Record<string, unknown>
  for (const key of ['models', 'data', 'items', 'files', 'result']) {
    const v = o[key]
    if (Array.isArray(v)) return v
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = v as Record<string, unknown>
      for (const k2 of ['models', 'data', 'items']) {
        if (Array.isArray(nested[k2])) return nested[k2] as unknown[]
      }
    }
  }
  return []
}

function coerceModel(item: unknown): CredModel | null {
  if (item == null) return null
  if (typeof item === 'string') {
    const id = item.trim()
    return id ? { id } : null
  }
  if (typeof item !== 'object' || Array.isArray(item)) return null
  const r = item as Record<string, unknown>
  const idRaw = r.id ?? r.model ?? r.name ?? r.model_id ?? r.modelId ?? r.model_name ?? r.modelName
  const id = String(idRaw ?? '').trim()
  if (!id) return null
  const out: CredModel = { id }
  const display =
    r.display_name ?? r.displayName ?? r.title ?? (typeof r.name === 'string' && r.name !== id ? r.name : null)
  if (typeof display === 'string' && display.trim()) out.name = display.trim()
  const provider = r.provider ?? r.owned_by ?? r.ownedBy ?? r.type ?? r.platform ?? r.vendor
  if (typeof provider === 'string' && provider.trim()) out.provider = provider.trim()
  return out
}

function wildcardMatch(pattern: string, value: string): boolean {
  const parts = pattern.split('*').map(escapeRegex)
  const re = new RegExp(`^${parts.join('.*')}$`, 'i')
  return re.test(value)
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
