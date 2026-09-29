/**
 * Protected CPA config.yaml BFF helpers.
 * - GET: fetch CPA YAML, mask secrets for browser
 * - PUT: auto-backup, reject empty/{} dangerous clears, restore masked secrets
 *
 * Never log or return raw secret-key / api-keys.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { maskKey } from './cpa.js'

const MASK_SENTINEL = '__UNCHANGED__'
const DEFAULT_BACKUP_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  'data/config-yaml-backups',
)

export function isConfigYamlWriteEnabled(env = process.env) {
  const v = String(env.CONFIG_YAML_WRITE_ENABLED ?? 'true').trim().toLowerCase()
  return v !== '0' && v !== 'false' && v !== 'no' && v !== 'off'
}

function requireMgmt(cfg) {
  if (!cfg?.managementKey) {
    throw Object.assign(new Error('CPA management key not configured'), { status: 503 })
  }
}

export async function fetchCpaConfigYamlRaw(cfg) {
  requireMgmt(cfg)
  const url = `${cfg.cpaBaseUrl}/v0/management/config.yaml`
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${cfg.managementKey}`,
      Accept: 'application/yaml, text/yaml, text/plain, */*',
    },
  })
  const text = await res.text()
  if (!res.ok) {
    const err = new Error(`CPA GET config.yaml failed (${res.status})`)
    err.status = res.status
    err.payload = text.slice(0, 200)
    throw err
  }
  return text
}

export async function putCpaConfigYamlRaw(cfg, yamlText) {
  requireMgmt(cfg)
  const url = `${cfg.cpaBaseUrl}/v0/management/config.yaml`
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${cfg.managementKey}`,
      'Content-Type': 'application/yaml',
      Accept: 'application/json, application/yaml, text/plain, */*',
    },
    body: yamlText,
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text ? { raw: text } : null
  }
  if (!res.ok) {
    const err = new Error(
      json?.error || json?.message || `CPA PUT config.yaml failed (${res.status})`,
    )
    err.status = res.status
    err.payload = json
    throw err
  }
  return json
}

export function parseConfigYaml(text) {
  if (text == null || String(text).trim() === '') {
    const err = Object.assign(new Error('config.yaml is empty'), { status: 400, code: 'empty_yaml' })
    throw err
  }
  let doc
  try {
    doc = yaml.load(String(text), { schema: yaml.DEFAULT_SCHEMA })
  } catch (e) {
    const err = Object.assign(new Error(`invalid YAML: ${e.message || e}`), {
      status: 400,
      code: 'invalid_yaml',
    })
    throw err
  }
  return doc
}

export function dumpConfigYaml(doc) {
  return yaml.dump(doc ?? {}, {
    lineWidth: -1,
    noRefs: true,
    sortingKeys: false,
  })
}

function isMaskedString(v) {
  if (typeof v !== 'string') return false
  if (v === MASK_SENTINEL) return true
  if (v === '[redacted]') return true
  return v.includes('****')
}

function maskSecretString(v) {
  if (typeof v !== 'string' || !v) return v
  if (v.length < 8) return '****'
  return maskKey(v)
}

function isSecretKeyName(key) {
  const lower = String(key || '').toLowerCase()
  return (
    lower === 'secret-key' ||
    lower === 'api-key' ||
    lower === 'api-keys' ||
    lower.endsWith('-api-key') ||
    lower.includes('password') ||
    lower.includes('token') ||
    (lower.includes('secret') && lower !== 'secret-key-action')
  )
}

/** Deep-clone and mask secret leaf values for browser. */
export function maskConfigObject(doc) {
  if (doc == null) return doc
  if (typeof doc === 'string') return maskSecretString(doc)
  if (Array.isArray(doc)) {
    return doc.map((item) => {
      if (typeof item === 'string') return maskSecretString(item)
      if (item && typeof item === 'object') return maskConfigObject(item)
      return item
    })
  }
  if (typeof doc !== 'object') return doc
  const out = {}
  for (const [k, v] of Object.entries(doc)) {
    if (isSecretKeyName(k)) {
      if (Array.isArray(v)) {
        out[k] = v.map((item) => {
          if (typeof item === 'string') return maskSecretString(item)
          if (item && typeof item === 'object') {
            const copy = { ...item }
            for (const kk of Object.keys(copy)) {
              if (isSecretKeyName(kk) && typeof copy[kk] === 'string') {
                copy[kk] = maskSecretString(copy[kk])
              }
            }
            return copy
          }
          return '[redacted]'
        })
      } else if (typeof v === 'string') {
        out[k] = maskSecretString(v)
      } else if (v && typeof v === 'object') {
        out[k] = maskConfigObject(v)
      } else {
        out[k] = v == null ? v : '[redacted]'
      }
      continue
    }
    if (v && typeof v === 'object') out[k] = maskConfigObject(v)
    else out[k] = v
  }
  return out
}

export function secretKeyMeta(doc) {
  const sk = doc?.['remote-management']?.['secret-key']
  const present = typeof sk === 'string' && sk.length > 0
  return {
    present,
    masked: present ? maskSecretString(sk) : '',
    action_default: present ? 'keep' : 'replace',
  }
}

/**
 * Restore masked/unchanged secrets from current CPA doc into the incoming doc.
 * secretKeyAction: 'keep' | 'clear' | 'replace'
 */
export function restoreMaskedSecrets(incoming, current, { secretKeyAction = 'keep', secretKey } = {}) {
  const out = structuredClone(incoming ?? {})
  const cur = current && typeof current === 'object' ? current : {}

  // remote-management.secret-key
  if (!out['remote-management'] || typeof out['remote-management'] !== 'object') {
    out['remote-management'] = out['remote-management'] || {}
  }
  const rm = out['remote-management']
  const curRm = cur['remote-management'] && typeof cur['remote-management'] === 'object' ? cur['remote-management'] : {}
  const curSk = typeof curRm['secret-key'] === 'string' ? curRm['secret-key'] : ''
  const action = String(secretKeyAction || 'keep').toLowerCase()

  if (action === 'clear') {
    rm['secret-key'] = ''
  } else if (action === 'replace') {
    const next = typeof secretKey === 'string' ? secretKey : typeof rm['secret-key'] === 'string' ? rm['secret-key'] : ''
    if (!next || isMaskedString(next)) {
      const err = Object.assign(
        new Error('secret-key replace requires a new non-masked value'),
        { status: 400, code: 'secret_key_replace_invalid' },
      )
      throw err
    }
    rm['secret-key'] = next
  } else {
    // keep: ignore client value (even if empty/masked)
    if (curSk) rm['secret-key'] = curSk
    else if (typeof rm['secret-key'] === 'string' && isMaskedString(rm['secret-key'])) {
      rm['secret-key'] = ''
    }
  }

  // Restore other secret arrays/strings when client sent masks
  restoreSecretTrees(out, cur)
  return out
}

function restoreSecretTrees(incoming, current, keyPath = []) {
  if (!incoming || !current) return
  if (Array.isArray(incoming) && Array.isArray(current)) {
    // api-keys style: list of strings
    if (incoming.every((x) => typeof x === 'string') && current.every((x) => typeof x === 'string')) {
      const curByMask = new Map(current.map((k) => [maskSecretString(k), k]))
      for (let i = 0; i < incoming.length; i++) {
        const v = incoming[i]
        if (isMaskedString(v) && curByMask.has(v)) incoming[i] = curByMask.get(v)
        else if (isMaskedString(v)) {
          // try positional restore if lengths match
          if (incoming.length === current.length && isMaskedString(v) && maskSecretString(current[i]) === v) {
            incoming[i] = current[i]
          }
        }
      }
      return
    }
    const n = Math.min(incoming.length, current.length)
    for (let i = 0; i < n; i++) {
      if (incoming[i] && typeof incoming[i] === 'object' && current[i] && typeof current[i] === 'object') {
        restoreSecretTrees(incoming[i], current[i], keyPath.concat(String(i)))
      }
    }
    return
  }
  if (typeof incoming !== 'object' || typeof current !== 'object') return
  for (const [k, v] of Object.entries(incoming)) {
    if (k === 'secret-key') continue // handled above
    const curV = current[k]
    if (isSecretKeyName(k)) {
      if (typeof v === 'string' && typeof curV === 'string') {
        if (isMaskedString(v) || v === MASK_SENTINEL || maskSecretString(curV) === v) {
          incoming[k] = curV
        }
      } else if (Array.isArray(v) && Array.isArray(curV)) {
        restoreSecretTrees(v, curV, keyPath.concat(k))
      } else if (v && typeof v === 'object' && curV && typeof curV === 'object') {
        restoreSecretTrees(v, curV, keyPath.concat(k))
      }
      continue
    }
    if (v && typeof v === 'object' && curV && typeof curV === 'object') {
      restoreSecretTrees(v, curV, keyPath.concat(k))
    }
  }
}

/**
 * Reject empty / {} / dangerous clears that previously wiped CPA.
 */
export function assertSafeConfigWrite(incoming, current) {
  if (incoming == null || typeof incoming !== 'object' || Array.isArray(incoming)) {
    throw Object.assign(new Error('refusing non-object config'), {
      status: 400,
      code: 'dangerous_clear',
    })
  }
  const keys = Object.keys(incoming)
  if (keys.length === 0) {
    throw Object.assign(new Error('refusing empty config {}'), {
      status: 400,
      code: 'dangerous_clear',
    })
  }
  const cur = current && typeof current === 'object' ? current : {}
  if (cur['remote-management'] && !incoming['remote-management']) {
    throw Object.assign(new Error('refusing to remove remote-management block'), {
      status: 400,
      code: 'dangerous_clear',
    })
  }
  const curKeys = Array.isArray(cur['api-keys']) ? cur['api-keys'] : []
  const nextKeys = Array.isArray(incoming['api-keys']) ? incoming['api-keys'] : []
  if (curKeys.length > 0 && nextKeys.length === 0) {
    throw Object.assign(
      new Error('refusing to clear all api-keys via config.yaml; use /api/admin/keys'),
      { status: 400, code: 'dangerous_clear' },
    )
  }
  // port must stay a plausible number if present
  if (incoming.port != null) {
    const p = Number(incoming.port)
    if (!Number.isFinite(p) || p < 1 || p > 65535) {
      throw Object.assign(new Error('invalid port'), { status: 400, code: 'invalid_port' })
    }
  }
  return true
}

export function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex')
}

export function backupConfigYaml(rawText, backupDir = DEFAULT_BACKUP_DIR) {
  fs.mkdirSync(backupDir, { recursive: true })
  const stamp = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const name = `config.yaml.bak.${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`
  const filePath = path.join(backupDir, name)
  fs.writeFileSync(filePath, rawText, 'utf8')
  // retain last 30 backups
  try {
    const files = fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith('config.yaml.bak.'))
      .sort()
    while (files.length > 30) {
      const old = files.shift()
      try {
        fs.unlinkSync(path.join(backupDir, old))
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return { path: filePath, name, sha256: sha256Text(rawText) }
}

export function buildMaskedConfigPayload(rawText) {
  const doc = parseConfigYaml(rawText)
  if (doc == null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw Object.assign(new Error('config.yaml did not parse to an object'), {
      status: 502,
      code: 'invalid_config_shape',
    })
  }
  const masked = maskConfigObject(doc)
  const maskedYaml = dumpConfigYaml(masked)
  return {
    yaml: maskedYaml,
    config: masked,
    etag: sha256Text(rawText),
    bytes: Buffer.byteLength(rawText, 'utf8'),
    secret_key: secretKeyMeta(doc),
    write_enabled: true, // caller may override
  }
}

/**
 * Prepare PUT body: accept { yaml } or { config } (+ secret_key_action / secret_key).
 * Returns { yamlText, backup, etag }.
 */
export async function prepareAndPutConfigYaml(cfg, body, { backupDir, env } = {}) {
  if (!isConfigYamlWriteEnabled(env || process.env)) {
    throw Object.assign(new Error('config.yaml write is disabled (CONFIG_YAML_WRITE_ENABLED)'), {
      status: 403,
      code: 'write_disabled',
    })
  }
  const rawCurrent = await fetchCpaConfigYamlRaw(cfg)
  if (!String(rawCurrent).trim()) {
    throw Object.assign(new Error('current CPA config.yaml is empty — refusing write'), {
      status: 502,
      code: 'current_empty',
    })
  }
  const currentDoc = parseConfigYaml(rawCurrent)

  let incomingDoc
  if (typeof body?.yaml === 'string') {
    if (!body.yaml.trim()) {
      throw Object.assign(new Error('refusing empty yaml body'), {
        status: 400,
        code: 'empty_yaml',
      })
    }
    incomingDoc = parseConfigYaml(body.yaml)
  } else if (body?.config && typeof body.config === 'object' && !Array.isArray(body.config)) {
    incomingDoc = structuredClone(body.config)
  } else {
    throw Object.assign(new Error('body must include yaml string or config object'), {
      status: 400,
      code: 'bad_body',
    })
  }

  if (incomingDoc == null || typeof incomingDoc !== 'object' || Array.isArray(incomingDoc)) {
    throw Object.assign(new Error('refusing empty/non-object config'), {
      status: 400,
      code: 'dangerous_clear',
    })
  }
  if (Object.keys(incomingDoc).length === 0) {
    throw Object.assign(new Error('refusing empty config {}'), {
      status: 400,
      code: 'dangerous_clear',
    })
  }

  const secretKeyAction = body?.secret_key_action || body?.secretKeyAction || 'keep'
  const secretKey = body?.secret_key ?? body?.secretKey
  const restored = restoreMaskedSecrets(incomingDoc, currentDoc, {
    secretKeyAction,
    secretKey,
  })
  assertSafeConfigWrite(restored, currentDoc)

  const yamlText = dumpConfigYaml(restored)
  if (!yamlText.trim() || yamlText.trim() === '{}' || yamlText.trim() === 'null') {
    throw Object.assign(new Error('refusing empty serialized yaml'), {
      status: 400,
      code: 'dangerous_clear',
    })
  }

  const backup = backupConfigYaml(rawCurrent, backupDir || DEFAULT_BACKUP_DIR)
  await putCpaConfigYamlRaw(cfg, yamlText)
  const after = await fetchCpaConfigYamlRaw(cfg)
  const payload = buildMaskedConfigPayload(after)
  return {
    ...payload,
    backup: { name: backup.name, sha256: backup.sha256 },
    write_enabled: isConfigYamlWriteEnabled(env || process.env),
  }
}

export { MASK_SENTINEL, DEFAULT_BACKUP_DIR }
