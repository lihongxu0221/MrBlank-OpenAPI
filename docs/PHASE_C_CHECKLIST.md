# Phase C checklist — 请求诊断（管理员）

Date: 2026-09-21 (Asia/Shanghai)  
Deploy: `openapi.juc114.cn` · service `mrblank-openapi.service`  
Scope: transplant aily-openai-adapter **request/response diagnosis** into MrBlank admin UI (Geist / CSS-var only).  
Phase D (Aily account transplant) **not** started except minimal BFF `/v1` hook for body capture.

## Architecture

| Path | Behavior |
|------|----------|
| Client → `https://openapi.juc114.cn/v1/*` | nginx → BFF `:8787` `/v1` → CPA billing `:8320` |
| BFF diagnosis store | `server/data/diagnosis/` (index.jsonl + dumps/*.json); secrets redacted |
| CPAMP `/v0/management/usage` | Still powers summary cards / by_model / by_endpoint — **no raw bodies** |
| Admin UI `#/admin/usage` | CPAMP summary + BFF diagnosis request table; dbl-click (coarse: click) → modal |

## Feature parity vs aily `使用记录-请求诊断详情.md`

| Requirement | Status | Notes |
|-------------|--------|-------|
| Admin-only entry from usage list | ✅ | `#/admin/usage` request table; non-admin no nav + API 403 |
| Desktop double-click / coarse single-click | ✅ | `pointer: coarse` → click; else dblclick |
| Modal title「请求诊断详情」+ status badge | ✅ | |
| Tabs: 请求概览 / 请求信息 / 上游诊断 | ✅ | Upstream sub-tabs: 概览 / 请求 / 响应 / Error Chain / More |
| Maximize / restore + resize handle | ✅ | |
| Close: button / backdrop / Escape | ✅ | |
| Overview cards (model/key/ip/latency/tokens/stream) | ✅ | amount/quota not shown (CPA billing unrelated) |
| Overview conversation turns `#n` | ✅ Partial | Chat `messages` + choices / SSE deltas; no image/file cards yet |
| Request tab: method/path/headers/body | ✅ | Headers redacted at persist |
| Upstream tab: upstream headers/body + response | ✅ | Single attempt (#1); upstream_url when known |
| JSON tree + View source + copy | ✅ | Array paginate / long-string collapse simplified |
| More timeline filters (全部/请求/思考/工具/回复) | ⚠️ Partial | More shows parsed turns; filter chips not ported |
| Image/file cards + lightbox | ❌ Gap | Not ported this phase |
| Mojibake repair / truncated JSON recover | ⚠️ Partial | Basic JSON parse only |
| List API omits bodies (`has_detail` only) | ✅ | `GET /api/admin/diagnosis/logs` |
| Detail API returns bodies (admin 200 / user 403) | ✅ | `GET /api/admin/diagnosis/logs/:id` |
| Capture `/v1/chat/completions` etc. success+fail | ✅ | Via BFF proxy when nginx routes `/v1` → BFF |
| CPAMP historical rows with bodies | ❌ Gap | CPAMP usage has **no** req/res body fields (verified) |

## Honest gaps

1. **CPAMP cannot supply bodies** — diagnosis bodies exist only for traffic that passed through BFF `/v1` after deploy. Pre-existing CPAMP usage remains summary-only.
2. **Image/file/lightbox / More filter chips** — deferred; overview + JSON tree cover the core “see the request/response” goal.
3. **Direct nginx→8320 bypass** — if `/v1` is pointed back at billing only, new dumps stop; keep nginx → BFF.

## Smoke

| Check | Expect |
|-------|--------|
| `GET /api/admin/diagnosis/logs` no cookie | 401 |
| Non-admin session → same | 403 |
| Admin → list | 200, items without `req_body`/`res_body` |
| Admin → detail `:id` | 200 with bodies when `has_detail` |
| Non-admin → detail | 403 |
| `POST /v1/chat/completions` (any valid key) then admin refresh | New row; dbl-click shows body |
| `#/admin/usage` non-admin | Gate / no「管理」nav (Phase B) |

## Files

- `server/diagnosis.js` — dump store + redaction
- `server/v1Proxy.js` — `/v1` reverse-proxy + capture
- `server/index.js` — mount `/v1`, admin diagnosis routes
- `src/pages/admin/AdminUsagePage.tsx` — table + modal entry
- `src/pages/admin/diagnosis/DiagnosisModal.tsx` — MrBlank-styled modal
- nginx `openapi.juc114.cn` — `/v1/` → `127.0.0.1:8787`
