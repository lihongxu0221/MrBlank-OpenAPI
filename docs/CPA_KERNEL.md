# CPA Kernel Architecture

Updated: 2026-09-21

## Overview

**CPA (cli-proxy-api, `:8317`) is the production kernel** for MrBlank OpenAPI.

The BFF (`server/index.js`) talks to CPA with the **Management Key**
(`CPA_MANAGEMENT_KEY` / `CPA_MANAGEMENT_KEY_FILE`).

**CPAMP is optional / deprecated** for production paths. It is not required for:

- pool / upstream accounts
- admin config / openai-compatibility / request-log
- community leaderboard / activity
- API key management

CPA exposes management APIs such as:

| Endpoint | Role |
|----------|------|
| `/v0/management/config` | GET config (secrets sanitized in BFF) |
| `/v0/management/api-keys` | list / put / delete API keys |
| `/v0/management/auth-files` | upstream account pool |
| `/v0/management/openai-compatibility` | OpenAI-compat upstreams (PUT body = raw array) |
| `/v0/management/request-log` | GET `{ "request-log": bool }`; PUT `{ "value": bool }` |

CPA does **not** expose `/v0/management/usage` (404). Usage / realtime are rebuilt in this BFF.

## Environment (primary)

```bash
CPA_BASE_URL=http://127.0.0.1:8317
CPA_BILLING_URL=http://127.0.0.1:8320
CPA_MANAGEMENT_KEY_FILE=/path/to/cpa-management-key
CPA_DEMO_API_KEY_FILE=/path/to/demo-client-api-key
PUBLIC_API_BASE_URL=https://openapi.juc114.cn/v1
SITE_USAGE_PATH=/path/to/site-usage.json   # optional; default server/data/site-usage.json
CPA_COLLECTOR_INTERVAL_MS=20000            # optional
```

Deprecated (optional):

```bash
# CPAMP_BASE_URL=http://127.0.0.1:18317
# CPAMP_ADMIN_KEY_FILE=/path/to/cpamp-admin-key
```

## Collector

`server/cpaCollector.js` refreshes CPA `auth-files` on an interval (~20s).

- Pool (`/api/welfare/pool`) and admin accounts read from this cache.
- Admin connection page shows collector heartbeat (`lastSync`, latency, errors).
- Force refresh: admin accounts reload triggers `cpaCollector.refresh({ force: true })`.

## Site usage (leaderboard / activity / admin usage)

`server/siteUsage.js` stores JSON events at `SITE_USAGE_PATH`.

- Wired from `governance.onComplete` in the `/v1` proxy (success **and** failure).
- Only site-issued API keys (via `userKeyStore.hashToUserMap`) appear on the public leaderboard.
- Admin `/api/admin/usage` summarizes this store — **not** CPAMP global usage.

Prune policy: keep last ~50k events and drop events older than 14 days.

## Checklist: stop depending on CPAMP

1. Confirm `CPA_MANAGEMENT_KEY_FILE` is set and CPA `:8317` is healthy.
2. Confirm billing shim `:8320` (or CPA) answers `/v1/models`.
3. Restart `mrblank-openapi` so `cpaCollector` starts.
4. Verify:
   - `GET /api/welfare/pool` → `source: cpa:auth-files`
   - `GET /api/admin/accounts` works without CPAMP admin key
   - `GET /api/admin/config` returns CPA config
   - `GET /api/admin/usage` returns `source: site-usage`
   - Leaderboard empty until site `/v1` traffic exists (expected)
5. Optionally stop CPAMP process; community/admin must **not** fail.
6. Remove `CPAMP_*` from production env when ready.

## Admin UI pages (MrBlank style)

- `/admin/config` — sanitized CPA config
- `/admin/compat` — openai-compatibility list/edit
- `/admin/request-log` — toggle CPA request-log
- `/admin/accounts` — CPA auth-files + recent_requests + force refresh
- `/admin/usage` — site-usage tables, ~30s auto-refresh
- `/admin/connection` — collector heartbeat + CPA latency (CPAMP optional)
