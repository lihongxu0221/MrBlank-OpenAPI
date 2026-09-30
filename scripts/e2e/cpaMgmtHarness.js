/**
 * Test-only harness (not used in production): serves the real /api/admin/cpa-mgmt BFF
 * router against a LOCAL throwaway CPA so the ported UI can be exercised end-to-end.
 *   CPA_BASE_URL=http://127.0.0.1:18417 CPA_MANAGEMENT_KEY=... node scripts/e2e/cpaMgmtHarness.js
 * The admin guard is replaced by a stub; never point this at a live CPA.
 */
import express from '../../server/node_modules/express/index.js'
import { createCpaMgmtRouter } from '../../server/cpaMgmtProxy.js'

const cpaBaseUrl = process.env.CPA_BASE_URL || 'http://127.0.0.1:18417'
if (!/^http:\/\/127\.0\.0\.1:18\d{3}$/.test(cpaBaseUrl)) {
  throw new Error('harness only talks to a local throwaway CPA on 127.0.0.1:18xxx')
}
const app = express()
app.use(express.json({ limit: '8mb' }))
app.use('/api/admin/cpa-mgmt', (req, _res, next) => {
  req.auth = { user: { id: 'e2e', username: 'e2e-admin' } }
  next()
}, createCpaMgmtRouter({
  cpaCfg: { cpaBaseUrl, managementKey: process.env.CPA_MANAGEMENT_KEY || '' },
  express,
}))
const port = Number(process.env.PORT || 8787)
app.listen(port, '127.0.0.1', () => console.log(`cpa-mgmt harness on :${port} -> ${cpaBaseUrl}`))
