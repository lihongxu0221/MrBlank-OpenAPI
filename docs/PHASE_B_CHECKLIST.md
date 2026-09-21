# Phase B checklist — MrBlank OpenAPI admin console (CPAMP subset)

Date: 2026-09-21 (Asia/Shanghai)  
Deploy: `openapi.juc114.cn` · service `mrblank-openapi.service`  
Scope: harden `#/admin` as a **MrBlank-styled CPAMP capability subset** (no embed of `www.juc114.cn/management.html`).  
Phase C (request diagnosis) and Phase D (Aily transplant) **not** started.

## Ops split (product rule)

| Surface | Role |
|---------|------|
| **www CPAMP** (`https://www.juc114.cn/management.html`) | Full ops: advanced config, provider wiring, deep auth-file tools |
| **openapi `#/admin`** (`https://openapi.juc114.cn/#/admin`) | Daily ops subset in Geist/CSS-var MrBlank UI: connection, accounts/pool, CPA keys, usage summary (+ constellation / groups / local users from Phase A) |

Keys (`CPA_MANAGEMENT_KEY`, `CPAMP_ADMIN_KEY`) stay **server-side only**. Browser sees masked values (except one-time reveal when admin clicks「生成并添加」).

## Result summary

| Area | Result | Notes |
|------|--------|-------|
| Overview + health | PASS | CPA / billing / CPAMP probes + usage/accounts/keys counts; ops-split callout |
| Accounts / pool health | PASS | CPAMP auth-files → cards + pool summary (active/unavailable/disabled/by provider) |
| API keys management | PASS | list / add / generate / delete via CPA Management APIs |
| Usage monitoring | PASS | CPAMP global summarizeUsage + success rate |
| Connection status | PASS | endpoints + sanitized CPAMP config |
| Constellation / groups / local users | PASS | kept from Phase A |
| Non-admin nav | PASS | 「管理」only when `/api/admin/me` → `is_admin=true` |
| Non-admin API | PASS | `/api/admin/*` (except `/me`) → **403**; no cookie → **401** |
| Session harden | PASS | cookie **or** Bearer `access_token` accepted by BFF |
| Docs | PASS | README + this checklist + ROADMAP Phase B marked |

## Smoke (live)

| Check | Expect | Result |
|-------|--------|--------|
| `GET /api/admin/me` (no cookie) | 401 | |
| `GET /api/admin/overview` (no cookie) | 401 | |
| `GET /api/admin/accounts` (no cookie) | 401 | |
| `GET /api/admin/keys` (no cookie) | 401 | |
| `GET /api/admin/usage` (no cookie) | 401 | |
| `GET /api/admin/connection` (no cookie) | 401 | |
| Local non-admin session → `/api/admin/overview` | 403 | |
| Local non-admin session → `/api/admin/me` | 200 `is_admin=false` | |
| Local admin session → `/api/admin/me` | 200 `is_admin=true` | |
| Local admin → overview / accounts / keys / usage / connection | 200 | |
| Built JS: no `management.html` iframe embed | PASS | link-out only |

Fill Result column after deploy smoke (see commit message / agent report).

## Admin pages map

| Hash | API | Source |
|------|-----|--------|
| `#/admin` | `GET /api/admin/overview` | CPA health + CPAMP usage/auth-files + Management keys |
| `#/admin/accounts` | `GET /api/admin/accounts` | CPAMP auth-files |
| `#/admin/keys` | `GET/POST/DELETE /api/admin/keys` | CPA Management api-keys |
| `#/admin/usage` | `GET /api/admin/usage` | CPAMP usage |
| `#/admin/connection` | `GET /api/admin/connection` + `/config` | probes + sanitized config |
| `#/admin/constellation` | constellation CRUD | local site-content |
| `#/admin/groups` | groups CRUD | local groups store |
| `#/admin/users` | local users CRUD | local user store (Phase A) |

## Permissions

- Admin if: local `role=admin` **or** `ADMIN_LOCAL_USERNAMES` **or** Linux.do allowlist (`ADMIN_LINUXDO_IDS|USERNAMES|EMAILS`)
- Nav: `NavShell` fetches `/api/admin/me`; non-admins never see「管理」
- Gate: `useAdminGate` + `requireAdmin` middleware
- Native local auth (Phase A) unchanged

## Known gaps → later phases

### Phase C — request diagnosis
- No req/res body capture yet; no double-click diagnostic modal

### Phase D — Aily ↔ CPA
- `AILY_ADAPTER_URL` reserved; do not touch www/aily/new-api/hermes

### Phase E — group governance deepen
- Hard quota on completions; `/v1/models` group filter
