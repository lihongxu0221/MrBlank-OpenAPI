/**
 * Boot guard for the point-denominated data files (unit_version 2 = micro-points).
 * A legacy raw-unit file must be converted by server/scripts/migrate-points-unit.js first;
 * serving on top of it would misread raw as mp (fail closed instead).
 */
import fs from 'node:fs'
import { UNIT_VERSION } from './quotaUnit.js'

/**
 * @param {{ creditsPath?: string, groupsPath?: string, keysPath?: string, ledgerPath?: string }} paths
 * @returns {{ file: string, reason: string }[]}
 */
export function findLegacyUnitFiles(paths = {}) {
  const out = []
  for (const p of [paths.creditsPath, paths.groupsPath, paths.keysPath]) {
    if (!p || !fs.existsSync(p)) continue
    let doc
    try {
      doc = JSON.parse(fs.readFileSync(p, 'utf8'))
    } catch {
      out.push({ file: p, reason: 'unreadable JSON' })
      continue
    }
    if (Number(doc?.unit_version) !== UNIT_VERSION) {
      out.push({ file: p, reason: `unit_version=${doc?.unit_version ?? 'missing'} (need ${UNIT_VERSION})` })
    }
  }
  if (paths.ledgerPath && fs.existsSync(paths.ledgerPath)) {
    let legacy = 0
    for (const line of fs.readFileSync(paths.ledgerPath, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const e = JSON.parse(line)
        if (e && e.points_mp == null) legacy += 1
      } catch {
        /* malformed lines are skipped by the ledger loader */
      }
    }
    if (legacy) out.push({ file: paths.ledgerPath, reason: `${legacy} rows without points_mp` })
  }
  return out
}
