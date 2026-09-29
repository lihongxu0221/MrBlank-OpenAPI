/**
 * Honor client-requested model ids when upstream (e.g. xAI via CPA) echoes a
 * longer hyphen-suffixed variant in response payloads.
 *
 * Live bug: request model "grok-4.7" is forwarded upstream unchanged, but xAI
 * returns "model":"grok-4.7-build". oauth-model-alias cannot force-map
 * name===alias (CPA skips EqualFold pairs), and aliasing grok-4.7 →
 * grok-4.7-build breaks the request (xAI rejects grok-4.7-build as input).
 *
 * Rule: rewrite only when upstream id is the exact requested id plus a
 * separator suffix (e.g. "-build"). Never rewrite when the user explicitly
 * requested a build/fast variant. Never treat "grok-4" as a prefix of
 * "grok-4.7" (requires separator after the full requested id).
 */

/**
 * @param {string} requested
 * @param {string} upstream
 */
export function isUpstreamVariantOfRequested(requested, upstream) {
  const r = String(requested || '').trim()
  const u = String(upstream || '').trim()
  if (!r || !u) return false
  if (r === u) return false
  // User explicitly asked for a build / fast / preview variant — keep it.
  if (/(?:^|[-_.])(build|fast)(?:[-_.]|$)/i.test(r)) return false
  const rl = r.toLowerCase()
  const ul = u.toLowerCase()
  if (!ul.startsWith(rl)) return false
  const rest = ul.slice(rl.length)
  // Only hyphen/underscore mark a variant suffix. A following '.' is a version
  // bump (grok-4 → grok-4.7), not an upstream rename of the same request.
  return rest.length > 0 && /^[-_]/.test(rest)
}

/**
 * Prefer requested id for diagnosis / usage when upstream only renamed it.
 * @param {string} upstreamModel
 * @param {string} requestedModel
 */
export function honorModelName(upstreamModel, requestedModel) {
  const upstream = String(upstreamModel || '').trim()
  const requested = String(requestedModel || '').trim()
  if (!requested) return upstream
  if (!upstream) return requested
  if (isUpstreamVariantOfRequested(requested, upstream)) return requested
  return upstream
}

/**
 * Recursively rewrite object.model / nested response.model when they are
 * upstream variants of the requested id.
 * @param {unknown} value
 * @param {string} requested
 * @returns {unknown}
 */
export function rewriteModelFields(value, requested) {
  const req = String(requested || '').trim()
  if (!req || value == null) return value
  if (Array.isArray(value)) {
    return value.map((item) => rewriteModelFields(item, req))
  }
  if (typeof value !== 'object') return value
  const out = { ...value }
  if (typeof out.model === 'string' && isUpstreamVariantOfRequested(req, out.model)) {
    out.model = req
  }
  if (out.response && typeof out.response === 'object') {
    out.response = rewriteModelFields(out.response, req)
  }
  return out
}

/**
 * Rewrite JSON or SSE body text so client-visible model matches request.
 * @param {string} bodyText
 * @param {string} requestedModel
 * @returns {{ text: string, changed: boolean }}
 */
export function honorRequestedModelInBody(bodyText, requestedModel) {
  const requested = String(requestedModel || '').trim()
  const text = bodyText == null ? '' : String(bodyText)
  if (!requested || !text) return { text, changed: false }

  // Fast reject: body must mention a longer form of the requested id.
  const lower = text.toLowerCase()
  const reqLower = requested.toLowerCase()
  if (!lower.includes(reqLower)) return { text, changed: false }
  // Must contain requested + separator somewhere to be a variant rename.
  if (!lower.includes(reqLower + '-') && !lower.includes(reqLower + '_')) {
    return { text, changed: false }
  }

  const trimmed = text.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(text)
      const next = rewriteModelFields(parsed, requested)
      const out = JSON.stringify(next)
      return { text: out, changed: out !== JSON.stringify(parsed) }
    } catch {
      /* fall through to SSE / line rewriter */
    }
  }

  let changed = false
  const lines = text.split('\n')
  const outLines = lines.map((line) => {
    const m = /^(data:\s*)(\{.*\})\s*$/.exec(line)
    if (!m) return line
    try {
      const parsed = JSON.parse(m[2])
      const next = rewriteModelFields(parsed, requested)
      const serialized = JSON.stringify(next)
      if (serialized !== m[2]) {
        changed = true
        return m[1] + serialized
      }
    } catch {
      /* keep line */
    }
    return line
  })
  return { text: changed ? outLines.join('\n') : text, changed }
}

/**
 * Streaming SSE rewriter: line-buffer and honor model on complete data: lines.
 * @param {string} requestedModel
 */
export function createHonorModelSseTransformer(requestedModel) {
  const requested = String(requestedModel || '').trim()
  let pending = ''
  return {
    /**
     * @param {Buffer|string} chunk
     * @returns {string}
     */
    push(chunk) {
      if (!requested) return typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
      pending += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
      const parts = pending.split('\n')
      pending = parts.pop() ?? ''
      if (!parts.length) return ''
      const block = parts.join('\n') + '\n'
      return honorRequestedModelInBody(block, requested).text
    },
    flush() {
      if (!pending) return ''
      const left = pending
      pending = ''
      return honorRequestedModelInBody(left, requested).text
    },
  }
}
