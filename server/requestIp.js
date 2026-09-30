/**
 * Client IP behind the site reverse proxy.
 * nginx sets `X-Real-IP $remote_addr` (overwritten, not client-controllable) and APPENDS to
 * X-Forwarded-For, so the FIRST XFF entry is client-supplied and must never be trusted.
 *
 * Proxy headers are honoured only when the TCP peer is loopback (the local nginx); a direct
 * connection (e.g. BFF accidentally bound to 0.0.0.0) gets its socket address instead.
 * Order for trusted peers: X-Real-IP → req.ip (express `trust proxy 1` = right-most XFF hop)
 * → right-most XFF → socket address.
 */
function clean(ip) {
  const s = String(ip || '').trim()
  if (!s) return ''
  return s.startsWith('::ffff:') ? s.slice(7) : s
}

export function isLoopback(ip) {
  const s = clean(ip)
  return s === '::1' || s === 'localhost' || /^127\./.test(s)
}

export function requestIp(req) {
  if (!req) return ''
  const peer = clean(req.socket?.remoteAddress)
  // Unknown peer (tests / synthetic req) is treated as the local proxy.
  const trusted = !peer || isLoopback(peer)
  if (!trusted) return peer
  const real = req.headers?.['x-real-ip']
  if (typeof real === 'string' && real.trim()) return clean(real.split(',')[0])
  if (req.ip && !isLoopback(req.ip)) return clean(req.ip)
  const xff = req.headers?.['x-forwarded-for']
  if (typeof xff === 'string' && xff.trim()) {
    const parts = xff.split(',').map((x) => x.trim()).filter(Boolean)
    if (parts.length) return clean(parts[parts.length - 1])
  }
  return clean(req.ip) || peer
}
