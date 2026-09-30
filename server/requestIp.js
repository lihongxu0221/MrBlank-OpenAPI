/**
 * Client IP behind the site nginx.
 * nginx sets `X-Real-IP $remote_addr` (overwritten, not client-controllable) and APPENDS to
 * X-Forwarded-For, so the FIRST XFF entry is client-supplied and must not be trusted.
 * Order: X-Real-IP → req.ip (express `trust proxy 1` = right-most XFF hop) → socket address.
 */
function clean(ip) {
  const s = String(ip || '').trim()
  if (!s) return ''
  return s.startsWith('::ffff:') ? s.slice(7) : s
}

export function requestIp(req) {
  if (!req) return ''
  const real = req.headers?.['x-real-ip']
  if (typeof real === 'string' && real.trim()) return clean(real.split(',')[0])
  if (req.ip) return clean(req.ip)
  const xff = req.headers?.['x-forwarded-for']
  if (typeof xff === 'string' && xff.trim()) {
    const parts = xff.split(',').map((x) => x.trim()).filter(Boolean)
    if (parts.length) return clean(parts[parts.length - 1])
  }
  return clean(req.socket?.remoteAddress)
}
