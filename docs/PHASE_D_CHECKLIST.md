# Phase D checklist — Aily ↔ CPA 转发整合

Date: 2026-09-21 (Asia/Shanghai)  
Deploy: `openapi.juc114.cn` · service `mrblank-openapi.service`  
Scope: Aily upstream credential admin + request path stays on **CPA kernel** (not a parallel gateway).

## Architecture chosen (CPA-first)

```
Client
  → https://openapi.juc114.cn/v1/*
  → nginx → BFF :8787
       ├─ default → CPA billing :8320 → cli-proxy-api :8317   ← primary
       └─ if model ∈ AILY_MODEL_ROUTES → aily-openai-adapter :8088  ← optional bypass
Diagnosis: BFF always records req/res (route_via=cpa|aily)
Aily credentials: shared ~/.config/aily-project/.aily (same file adapter reads)
Site login: native local users + Linux.do only — NEVER aily /admin/auth
```

| Component | Role |
|-----------|------|
| CPA / CPAMP | Source of truth for public `/v1` models & keys (unchanged Phase B/C) |
| aily :8088 | Upstream Aily.pro/yiyu token store + OpenAI adapter; credential UI targets this |
| openapi `#/admin/aily` | Admin-only credential / test / refresh; secrets stay server-side |
| CPA `openai-compatibility` | Preferred place to register aily-backed models **if** Docker can reach host `:8088` |

## Goals vs delivery

| Goal | Status | Notes |
|------|--------|-------|
| Admin UI for Aily credentials / connection test | ✅ | `#/admin/aily` → BFF `/api/admin/aily/*` |
| Prefer CPA for `/v1`; no parallel public gateway | ✅ | Default upstream remains billing `:8320` |
| Selective aily path when needed | ✅ | `AILY_MODEL_ROUTES` + `AILY_ADAPTER_API_KEY` |
| Diagnosis on whatever path | ✅ | `route_via` on dump; Phase C modal still works |
| Docs + honest gaps | ✅ | This file + ROADMAP + README |
| Do not break www / aily / revert A–C | ✅ | No CPA docker-compose / aily process code changes |

## Honest gaps

1. **Full Aily catalog cannot auto-live inside CPA** without manual `openai-compatibility` setup **and** Docker networking so `cli-proxy-api` can reach host `aily:8088`. Verified: from container, `172.17.0.1:8088` is **not** reachable; host `127.0.0.1:8088` works. Until that is fixed, CPA `GET /v0/management/openai-compatibility` stays `[]`.
2. **`AILY_MODEL_ROUTES` is opt-in.** Empty = all `/v1` traffic → CPA only. Populate e.g. `aily-*,glm-5.3,deepseek-v4-flash` to bypass matching models to adapter while still diagnosing.
3. **Adapter probe/bypass needs `AILY_ADAPTER_API_KEY`** (server env / file). Without it, credential UI still manages `.aily` tokens, but adapter `/v1/models` test and selective routing stay off.
4. **Aily admin session proxy** (`AILY_ADAPTER_ADMIN_*`) is optional; credential flows use shared auth file + upstream APIs (email code / paste token / refresh / me) and do not require knowing the aily console password.

## How admin tests Aily ↔ CPA path

1. Sign in as openapi admin → https://openapi.juc114.cn/#/admin/aily  
2. **连通测试**: upstream `/api/v1/auth/me` (needs stored access_token) + adapter `/v1/models` (needs `AILY_ADAPTER_API_KEY`).  
3. Optional: email login or paste tokens → writes shared `.aily` (aily adapter picks up on next `getToken()`).  
4. Confirm CPA remains primary: call a **CPA** model via `POST /v1/chat/completions` → diagnosis `route_via=cpa`, `upstream_url` contains `:8320`.  
5. Optional bypass: set `AILY_MODEL_ROUTES` + key, call a matched model → diagnosis `route_via=aily`, `upstream_url` contains `:8088`, response header `x-mrblank-route: aily`.  
6. CPA catalog registration (manual ops): after fixing Docker→host reachability, add `openai-compatibility` entry `base-url: http://<host-gateway>:8088/v1` with an aily API key and explicit model list in www CPAMP / CPA config — then clients still hit openapi→CPA only.

## Smoke

| Check | Expect |
|-------|--------|
| `GET /api/admin/aily/status` no cookie | 401 |
| Non-admin → same | 403 |
| Admin → status | 200; architecture note; `cpa_openai_compatibility` array or error |
| Admin → `POST /api/admin/aily/test` | upstream + adapter results (adapter may fail if no key) |
| `POST /v1/...` CPA model | diagnosis `route_via=cpa` |
| `#/admin/aily` in built UI | nav「Aily 上游」 |
| Site password login | still local users (not aily) |

## Files

- `server/aily.js` — auth file + upstream + adapter helpers  
- `server/v1Proxy.js` — selective aily route + diagnosis `route_via`  
- `server/diagnosis.js` — persist `route_via`  
- `server/cpa.js` — `fetchOpenaiCompatibility` (read-only)  
- `server/index.js` — `/api/admin/aily/*`, wire proxy  
- `src/pages/admin/AdminAilyPage.tsx` + layout / App routes  
- `server/.env.example`, README, ROADMAP  

## Live smoke

_(filled after deploy)_
