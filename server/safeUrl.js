/**
 * Literal-only guard for operator-configured upstream URLs.
 * Does not resolve DNS (rebinding is out of scope). Default rejects http and
 * private/link-local/metadata hosts. UPSTREAM_ALLOW_PRIVATE=1 allows http and
 * those hosts for a local bridge; non-http(s) and userinfo stay rejected.
 */

function allowPrivate(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String(env.UPSTREAM_ALLOW_PRIVATE || '').trim())
}

function ipv4ToInt(host) {
  const parts = String(host || '').split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const v = Number(part)
    if (v > 255) return null
    n = n * 256 + v
  }
  return n >>> 0
}

function inCidr(ip, base, bits) {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return ((ip & mask) >>> 0) === ((base & mask) >>> 0)
}

/** Private, loopback, link-local, CGNAT, unspecified, multicast. */
function isBlockedIpv4(host) {
  const ip = ipv4ToInt(host)
  if (ip === null) return false
  const blocks = [
    [0x00000000, 8], // 0.0.0.0/8
    [0x0a000000, 8], // 10/8
    [0x64400000, 10], // 100.64/10
    [0x7f000000, 8], // 127/8
    [0xa9fe0000, 16], // 169.254/16
    [0xac100000, 12], // 172.16/12
    [0xc0a80000, 16], // 192.168/16
    [0xe0000000, 4], // 224/4 multicast
  ]
  return blocks.some(([base, bits]) => inCidr(ip, base, bits))
}

function isBlockedHost(hostname) {
  const host = String(hostname || '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host === 'metadata.google.internal' || host === 'metadata.google.com') return true
  if (isBlockedIpv4(host)) return true
  if (host.includes(':')) {
    if (host === '::' || host === '::1') return true
    if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true
    if (/^fe[89ab][0-9a-f]:/i.test(host)) return true
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(host)
    if (mapped) return isBlockedHost(mapped[1])
    if (host.startsWith('::ffff:')) return true
  }
  return false
}

/**
 * @param {string} raw
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} origin + pathname, no trailing slash
 */
export function assertPublicHttpsUrl(raw, env = process.env) {
  const s = String(raw || '').trim()
  if (!s) {
    throw Object.assign(new Error('upstream URL is required'), { status: 400 })
  }
  let url
  try {
    url = new URL(s)
  } catch {
    throw Object.assign(new Error('upstream URL is invalid'), { status: 400 })
  }
  const open = allowPrivate(env)
  if (url.protocol !== 'https:' && !(open && url.protocol === 'http:')) {
    throw Object.assign(new Error('upstream URL must be https'), { status: 400 })
  }
  if (url.username || url.password) {
    throw Object.assign(new Error('upstream URL must not embed credentials'), { status: 400 })
  }
  if (!open && isBlockedHost(url.hostname)) {
    throw Object.assign(new Error('upstream URL host is not allowed'), { status: 400 })
  }
  const path = url.pathname.replace(/\/+$/, '')
  return `${url.origin}${path}`
}

/** Return a normalized URL, or '' if missing/rejected. Never throws. */
export function acceptPublicHttpsUrl(raw, env = process.env) {
  const s = String(raw || '').trim()
  if (!s) return ''
  try {
    return assertPublicHttpsUrl(s, env)
  } catch {
    return ''
  }
}
