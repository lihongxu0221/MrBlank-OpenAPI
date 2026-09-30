/**
 * App-level security headers (applied to every BFF response) + optional SPA static serving
 * with correct cache semantics (index.html no-cache, hashed /assets long-cache).
 */
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' data: blob: https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

export function securityHeaders() {
  return function securityHeadersMiddleware(_req, res, next) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY)
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
    next()
  }
}

/** API responses must never be cached by shared caches. */
export function noStoreApi() {
  return function noStore(_req, res, next) {
    if (!res.getHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-store')
    next()
  }
}

/**
 * Serve the built SPA (used when the BFF serves dist directly; nginx normally does this).
 * index.html → no-cache; /assets/* (content-hashed) → 1 year immutable; other files → 1 hour.
 */
export function spaStatic(distDir) {
  const router = express.Router()
  if (!distDir || !fs.existsSync(path.join(distDir, 'index.html'))) return router
  const indexFile = path.join(distDir, 'index.html')
  const sendIndex = (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.sendFile(indexFile)
  }
  router.get(['/', '/index.html'], sendIndex)
  router.use(
    '/assets',
    express.static(path.join(distDir, 'assets'), {
      immutable: true,
      maxAge: '365d',
      fallthrough: false,
      dotfiles: 'deny',
    }),
  )
  router.use(
    express.static(distDir, {
      index: false,
      maxAge: '1h',
      dotfiles: 'deny',
    }),
  )
  // SPA fallback for client routes (never for API / OAuth / v1 / dotfiles)
  router.get(/^\/(?!api\/|oauth\/|v1\/|\.)[^.]*$/, sendIndex)
  return router
}
