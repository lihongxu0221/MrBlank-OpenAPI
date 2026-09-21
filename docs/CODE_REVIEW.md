# Code review — MrBlank-OpenAPI

Date: 2026-09-21 (Asia/Shanghai)  
Scope: `server/` (auth, groups, credits, v1Proxy, diagnosis, cpa, admin), `src/` auth/routing/admin, config.  
Method: static review + unit tests (`npm test`). No secrets from `.env` / bootstrap printed.

## Summary

| Severity | Found | Fixed this PR |
|----------|------:|--------------:|
| Critical | 1 | 1 |
| High | 4 | 4 |
| Medium | 7 | 1 (`once_per_user`) |
| Low | 5 | 0 (documented) |

`npm test`: **21** assertions across 6 suites. `npm run build` required green before merge.

---

## Critical

### C1. Unlimited free site credits via ad-hoc `DF-*` redeem codes — **FIXED**
- **Where:** `server/credits.js` `redeem()` (former ephemeral `DF-` branch)
- **Issue:** Any unique string starting with `DF-` was accepted for `5 * Q` credits with only once-per-user tracking. Attackers could mint unlimited codes (`DF-1`, `DF-2`, …) for free overflow capacity.
- **Impact:** Quota/economic bypass of Phase E/F governance.
- **Fix:** Require admin-registered codes only. Unknown codes (including former smoke `DF-PHASEF-SMOKE`) return「兑换码无效」unless added under `#/admin/credits`.
- **Note:** Phase F live smoke used an ephemeral DF code; re-run smoke with a registered code (e.g. `WELCOME` or admin-created).

---

## High

### H1. Site credits deducted on every successful `/v1` call — **FIXED**
- **Where:** `server/index.js` governance `onComplete` (~783)
- **Issue:** Phase F defines site credits as **overflow** after group rolling windows are exhausted, but `creditStore.consume` ran on every successful consuming call, draining check-in/redeem balances while group quota remained.
- **Fix:** Set `useSiteCredits` when allowing via overflow in `enforce`; `onComplete` consumes only if that flag is set. Group `recordUsage` still always runs.

### H2. Governance errors fail open — **FIXED**
- **Where:** `server/v1Proxy.js` catch around `governance.enforce`
- **Issue:** If `enforce` threw, the proxy logged and continued upstream with no quota/model checks (authz bypass under fault).
- **Fix:** Respond **503** `governance_error` and return (fail closed).

### H3. Empty `model` bypasses group allowlist — **FIXED**
- **Where:** `server/index.js` enforce; `server/groups.js` `isModelAllowed` treats empty model as allowed
- **Issue:** Consuming requests without a parseable `model` skipped allowlist enforcement when `model_ids` was non-empty.
- **Fix:** If group has a non-empty allowlist and the consuming request has no model → **403** `model_required`. Explicit models still checked via `assertModelAllowed`.

### H4. `access_token` + full session cached in `sessionStorage` — **documented (not changed)**
- **Where:** `src/lib/session.ts` `STORAGE_KEY`; `src/lib/api.ts` Bearer header
- **Issue:** XSS in the SPA can read `access_token` (and sid metadata). Cookie is already `httpOnly`; Bearer is a secondary path.
- **Why not fixed here:** Cookie-backed `/api/user/session` already restores auth; stripping storage without a coordinated client change risks breaking multi-tab restore. Recommend follow-up: store non-secret user profile only; rely on cookie + optional memory Bearer.
- **Mitigation today:** `sameSite=lax`, `secure`, `httpOnly` cookie; CSP / XSS hygiene on static assets.

---

## Medium

### M1. `once_per_user: false` ignored — **FIXED**
- **Where:** `server/credits.js` `redeem`
- **Was:** Always blocked on `u.redeemed[code]` before reading the flag.
- **Fix:** Honor `once_per_user`; when false, allow repeats subject to `max_uses`.

### M2. JSON store TOCTOU / no file lock
- **Where:** `credits.js`, `groups.js`, `localUsers.js`, `userKeys.js` read→modify→write
- **Issue:** Concurrent check-in / redeem / usage can double-apply under parallel requests.
- **Rec:** Per-file mutex or single-writer queue; or SQLite.

### M3. In-memory sessions lost on restart
- **Where:** `server/index.js` `sessions` Map
- **Issue:** Process restart logs everyone out; no revocation list for stolen Bearer tokens beyond TTL.
- **Rec:** Persist sessions or use signed JWT with short TTL + refresh; document ops expectation.

### M4. Unmapped API keys bypass site governance
- **Where:** `server/index.js` enforce — `if (!owner?.userId) return { allow: true }`
- **Issue:** Intentional for CPA demo / external keys, but any CPA-registered key not in `user-keys.json` skips group quota/model rules (CPA-side limits only).
- **Rec:** Optional `GOVERNANCE_REQUIRE_MAPPED_KEY=1` for stricter deploys.

### M5. Diagnosis redaction leaves prefix/suffix of secrets
- **Where:** `server/diagnosis.js` `redactHeaders` / `maskTokenNameFromAuth`
- **Issue:** Long Authorization values keep first 10 + last 4; useful for support, leaky if dumps leave admin disk.
- **Rec:** Hash-only token fingerprint in dumps; restrict dump FS permissions (already under `data/`).

### M6. Welfare challenge/verify is a stub
- **Where:** `server/index.js` `publicHandlers().challenge` / `verify`
- **Issue:** `verify` always grants. Not wired into check-in (good), but clients might assume PoW.
- **Rec:** Remove endpoints or implement real challenge binding before any grant path uses them.

### M7. Cookie parser secret unused for signing
- **Where:** `cookieParser(SESSION_SECRET)` but `res.cookie` without `signed: true`
- **Issue:** Sid is opaque random (OK) but SESSION_SECRET does not actually bind the cookie.
- **Rec:** Either signed cookies or drop the secret argument to avoid false confidence.

---

## Low

### L1. Local password minimum length 6 (`localUsers.js`)
Prefer ≥10 or zxcvbn-style checks for admin accounts.

### L2. API key format embeds `user.id` (`sk-mrblank-${userId}-…`)
Minor identity disclosure in logs/CDN; prefer opaque ids.

### L3. `ADMIN_ROUTES` const omits `/admin/aily`, `/admin/credits`
`isAdminRoute` uses `path.startsWith('/admin/')` so runtime is fine; update the const for clarity.

### L4. Lifetime promotion metrics only retain ~90d usage events
`lifetimeTotals` undercounts long-lived accounts after prune; may slow promotion.

### L5. `scrypt` params taken from stored hash string
File-write attacker could lower N; defend with fixed params + version field (defense-in-depth).

---

## Positive notes

- Passwords: `scrypt` + `timingSafeEqual`; `publicUser` strips hashes.
- Admin APIs consistently behind `requireAdmin` + allowlist / local `role`.
- Token list endpoints strip `fullKey`; reveal only via explicit `/api/token/:id/key` for owner.
- CPA/CPAMP management keys never returned raw to browser (`sanitizeConfig` / `maskSecretValue`).
- OAuth state is single-use with TTL; session cookie `httpOnly` + `secure` + `sameSite=lax`.
- Diagnosis bodies capped; sensitive header names redacted.
- Group model filter on `/v1/models` when key maps to a site user.

---

## Frontend auth / routing (spot check)

- `#/admin*` gated by `useAdminGate` → `/api/admin/me` (server is source of truth).
- Console routes expect session; API returns 401 → `setSession(null)`.
- Hash router has no path traversal concern; admin UI is not an auth boundary (API is).

---

## Recommendations (backlog)

1. File locks or SQLite for credits/groups/users.
2. Persist or sign sessions; avoid Bearer in `sessionStorage`.
3. Optional strict mode: unmapped keys → 401 on BFF `/v1`.
4. Rate-limit `/api/auth/login` and `/api/user/topup`.
5. Expand tests: governance enforce integration with mock fetch; IDOR on token ids (owner-scoped — currently OK).

---

## Test suite

| File | Focus |
|------|--------|
| `server/test/localUsers.test.js` | hash/verify/authenticate |
| `server/test/groups.test.js` | quota windows, allowlist, promotion, model filter |
| `server/test/credits.test.js` | Shanghai day, check-in once, redeem once, no DF-* mint |
| `server/test/diagnosis.test.js` | redact / mask / extract |
| `server/test/v1Proxy.route.test.js` | CPA vs Aily selection |
| `server/test/admin.test.js` | allowlist + sanitize |

Run: `npm test` (root) or `npm test` under `server/`.
