# Phase A checklist — MrBlank OpenAPI

Date: 2026-09-21 (Asia/Shanghai)  
Deploy: `openapi.juc114.cn` · service `mrblank-openapi.service`  
Commits: `8253b97` (roadmap) · `98873ff` (native local login) · `b58c3b3` (checklist) · see HEAD for `/login` page

## Result summary

| Area | Result | Notes |
|------|--------|-------|
| ROADMAP committed/pushed | PASS | `docs/ROADMAP.md` |
| VPS full sync + restart | PASS | `groups.js` + `siteContent.js` + `localUsers.js` live |
| Dual login UI | PASS | 账号登录 first, Linux.do below divider; `#/login?next=` page; MrBlank styles |
| Local password auth | PASS | `POST /api/auth/login` → local JSON + scrypt; **not** Aily adapter |
| Post-login redirect | PASS | local `role=admin` → `#/admin`; else `#/console` (Linux.do allowlist unchanged) |
| Constellation | PASS | public `/api/welfare/constellation` + admin editor routes |
| User groups | PASS | admin CRUD; console `/api/user/group` shows group/quotas; model filter on token options |
| Admin local users | PASS | `#/admin/users` CRUD + password reset |
| Smoke APIs | PASS | see below |
| Aily adapter login | N/A removed | `AILY_ADAPTER_URL` reserved for Phase D only |

## Smoke (live)

| Check | HTTP | Result |
|-------|------|--------|
| `GET /api/status` | 200 | `quota_per_unit` present |
| `GET /api/admin/me` (no cookie) | 401 | 请先登录 |
| `POST /api/auth/login` bad password | 401 | 用户名或密码错误 |
| `POST /api/auth/login` bootstrap admin | 200 | `is_admin=true`, `auth_provider=local` |
| `GET /api/admin/me` (session) | 200 | `is_admin=true` |
| `GET /api/welfare/constellation` | 200 | cards present |
| `GET /api/admin/groups` (admin) | 200 | 5 groups |
| `GET /api/admin/users` (admin) | 200 | lists local users |
| `GET /api/user/group` (session) | 200 | group + remaining quotas |
| `GET /api/token/options` (session) | 200 | models filtered by group allowlist (empty allowlist = all) |
| Built JS contains `账号登录` + `/api/auth/login` | PASS | no Aily login service string |

Bootstrap admin credentials were written once to VPS  
`/home/ubuntu/sites/MrBlank-OpenAPI/server/data/.bootstrap-admin.txt` (mode 600).  
**Rotate/delete after first interactive login.** Not stored in git.

Env on VPS (names only): `AILY_ADAPTER_URL`, `ADMIN_LINUXDO_EMAILS`, `ADMIN_AILY_USERNAMES` (legacy→local allowlist), `BOOTSTRAP_ADMIN_USER`.

## Known gaps → later phases

### Phase B — admin console hardening
- Overview/accounts/keys/usage/connection exist but need polish vs CPAMP subset UX
- Non-admin nav hiding is gated; keep auditing every `/api/admin/*` for 403
- Document www CPAMP vs openapi operator split in-product

### Phase C — request diagnosis
- No req/res body capture on `/v1` yet
- No double-click diagnostic modal on usage rows
- Do **not** start until B stable

### Phase D — Aily ↔ CPA forwarding
- `AILY_ADAPTER_URL` intentionally unused for login now
- Upstream Aily credential mgmt + forwarding/diagnosis still TODO
- Must not break www / aily / new-api nginx

### Phase E — group governance deepen
- Promotion rules stored but soft; 5h/week/month hard enforce is MVP (`assertQuotaAvailable` on key create path) — extend to completion requests
- `/v1/models` public path may still be unfiltered by group (BFF `/api/token/options` filters); align gateway path
- Console progress UI present; tune thresholds / mapping

### Ops / product nits
- Sign-in / redeem still in-process (not CPA wallet)
- Leaderboard display-name mapping still hashed
- Rotate bootstrap admin password; clear `.bootstrap-admin.txt`
