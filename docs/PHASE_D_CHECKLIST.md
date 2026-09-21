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
       └─ if model ∈ AILY_MODEL_ROUTES → in-process Aily bridge (embedded)  ← default bypass
       └─ legacy: separate aily-openai-adapter :8088 is optional and not required
Diagnosis: BFF always records req/res (route_via=cpa|aily)
Aily credentials: shared ~/.config/aily-project/.aily (same file adapter reads)
Site login: native local users + Linux.do only — NEVER aily /admin/auth
```

| Component | Role |
|-----------|------|
| CPA / CPAMP | Source of truth for public `/v1` models & keys (unchanged Phase B/C) |
| 内嵌 Aily 桥接 | BFF `server/ailyUpstream.js`：用共享 `.aily` token 直连上游 OpenAI 兼容接口 |
| openapi `#/admin/aily` | Admin-only credential / test / refresh; secrets stay server-side |
| CPA `openai-compatibility` | Preferred place to register aily-backed models **if** Docker can reach host `:8088` |

## Goals vs delivery

| Goal | Status | Notes |
|------|--------|-------|
| Admin UI for Aily credentials / connection test | ✅ | `#/admin/aily` → BFF `/api/admin/aily/*` |
| Prefer CPA for `/v1`; no parallel public gateway | ✅ | Default upstream remains billing `:8320` |
| Selective aily path when needed | ✅ | `AILY_MODEL_ROUTES` → embedded bridge (no adapter key) |
| Diagnosis on whatever path | ✅ | `route_via` on dump; Phase C modal still works |
| Docs + honest gaps | ✅ | This file + ROADMAP + README |
| Do not break www / aily / revert A–C | ✅ | No CPA docker-compose / aily process code changes |

## Honest gaps

1. **Full Aily catalog cannot auto-live inside CPA** without manual `openai-compatibility` setup **and** Docker networking so `cli-proxy-api` can reach host `aily:8088`. Verified: from container, `172.17.0.1:8088` is **not** reachable; host `127.0.0.1:8088` works. Until that is fixed, CPA `GET /v0/management/openai-compatibility` stays `[]`.
2. **`AILY_MODEL_ROUTES` is opt-in.** Empty = all `/v1` traffic → CPA only. Populate e.g. `aily-*,glm-5.3,deepseek-v4-flash` to use the **in-process** Aily bridge while still diagnosing.
3. **No separate `:8088` adapter required** for models test or selective routing. Bridge uses shared `.aily` access/refresh tokens; refresh on 401 when possible.
4. **`AILY_ADAPTER_URL` / `AILY_ADAPTER_API_KEY`** are legacy no-ops for the happy path. Separate adapter process may still run but openapi does not depend on it.

## How admin tests Aily ↔ CPA path

1. Sign in as openapi admin → https://openapi.juc114.cn/#/admin/aily  
2. **连通测试**: upstream `/api/v1/auth/me` + **内嵌** `model_catalog` / models（needs stored access_token）.  
3. Optional: email login or paste tokens → writes shared `.aily` (embedded bridge reads it).  
4. Confirm CPA remains primary: call a **CPA** model via `POST /v1/chat/completions` → diagnosis `route_via=cpa`, `upstream_url` contains `:8320`.  
5. Optional bypass: set `AILY_MODEL_ROUTES`, call a matched model → diagnosis `route_via=aily`, `upstream_url` is Aily upstream (`/api/v2/chat_stateless`), header `x-mrblank-route: aily`.  
6. CPA openai-compatibility pointing at a separate adapter is **optional/legacy**; preferred path is embedded bridge via `AILY_MODEL_ROUTES`.

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

- `server/aily.js` — auth file + upstream credential APIs  
- `server/ailyUpstream.js` — in-process OpenAI bridge (models + chat/completions)  
- `server/v1Proxy.js` — selective aily route (embedded) + diagnosis `route_via`  
- `server/diagnosis.js` — persist `route_via`  
- `server/cpa.js` — `fetchOpenaiCompatibility` (read-only)  
- `server/index.js` — `/api/admin/aily/*`, wire proxy  
- `src/pages/admin/AdminAilyPage.tsx` + layout / App routes  
- `server/.env.example`, README, ROADMAP  

## Live smoke (2026-09-21 Asia/Shanghai)

| Check | Result |
|-------|--------|
| Deploy `1c1ae13` + env `AILY_ADAPTER_API_KEY` / auth file paths | ✅ |
| Service log `aily_adapter=http://127.0.0.1:8088 aily_routes=0` | ✅ |
| `GET /api/admin/aily/status` no auth | ✅ 401 |
| Admin status | ✅ 200; `has_access_token`; `cpa_openai_compatibility=[]`; architecture CPA-first |
| Admin `POST /api/admin/aily/test` | ✅ upstream `/auth/me` OK (yiyu); adapter `/v1/models` 5 models |
| `POST /v1/chat/completions` CPA model | ✅ 200; `x-mrblank-route: cpa`; diagnosis `route_via=cpa` → `:8320` |
| Temporary `AILY_MODEL_ROUTES=aily-*,glm-5.3` then `aily-fast` | ✅ 200; `route_via=aily` → `:8088`; then routes cleared back to 0 |
| openapi / aily / www HTTP | ✅ 200 / 302 / 307 (untouched) |

How to test UI: admin → https://openapi.juc114.cn/#/admin/oauth（Aily 区块）→ 连通测试 / 邮箱登录或粘贴 token。默认 `/v1` 仍走 CPA；旁路在 VPS `.env` 设置 `AILY_MODEL_ROUTES`（内嵌桥接，无需 :8088）。
