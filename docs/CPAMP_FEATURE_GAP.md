# CPAMP Feature Gap Inventory (MrBlank-OpenAPI)

Updated: 2026-09-21 (Asia/Shanghai) — Wave A implemented  
Sources: `https://www.juc114.cn/management.html` (SPA bundle), VPS `seakee/cpa-manager-plus:v1.13.1` on `:18317`, CPA `eceasy/cli-proxy-api:v7.3.10` on `:8317`, local `src/pages/admin/*` + `server/index.js`.

**Scope:** inventory + gap only — no feature implementation in this change.

**Auth notes (probe):**
- CPAMP admin: `Authorization: Bearer <cpamp-admin-key>`
- CPA management: `Authorization: Bearer <cpa-management-key>` (also accepts bare `Authorization: <key>` / `X-Management-Key`)
- CPAMP proxies many CPA `/v0/management/*` paths and adds CPAMP-only collector APIs backed by `/data/usage.sqlite`.

---

## 1. Complete CPAMP UI inventory (nav / hash routes)

From i18n `nav:*` + embedded React Router paths in `management.html`:

| Nav label (zh) | Hash / path | Purpose |
|----------------|-------------|---------|
| 仪表盘 | `/dashboard` | RPM/TPM, today totals, model cost rank, health cards |
| 基础设置 | `/settings` | debug, proxy-url, logging-to-file, logs size, request-log, force-model-prefix, ws-auth, usage-statistics |
| API 密钥 | `/api-keys` | CPA proxy API keys CRUD + aliases (CPAMP) |
| AI 提供商 | `/ai-providers/*` | Gemini / Claude / Codex / OpenAI-compat / Vertex provider keys & entries |
| 凭证管理 | `/accounts` | auth-files list, quota panels, priority/note, disable/enable, download |
| OAuth 登录 | `/oauth` | Start OAuth for Codex / Anthropic / Antigravity / Kimi / xAI / Devin / Qwen / iFlow / plugins; callback paste |
| 插件管理 | `/plugins` | CPA plugins enable/dir/list |
| 插件商店 | `/plugin-store` | Plugin marketplace UI |
| 插件页面 | `/plugin-pages/:pluginId/:menuIndex` | Plugin-provided pages |
| 用量分析 | `/usage-analytics` | Global usage from CPAMP collector (not raw CPA) |
| 请求监控 | `/monitoring` | Analytics, header snapshots, account window usage |
| 认证异常 | `/monitoring/account-actions` | Account action candidates (ignore/resolve/enable/delete auth-file) |
| Codex 巡检 | `/monitoring/codex-inspection` (+ `/server`) | Codex inspection runs / cancel / actions |
| 模型价格 | `/monitoring/model-prices` (+ `/model-prices`) | Price table, sync, runtime models, usage-summary cost |
| 配置面板 | `/config` | Raw / structured config editor (`config` + `config.yaml`) |
| 日志查看 | `/logs` | CPA file logs (needs logging-to-file) |
| 系统信息 | `/system` | Version / runtime info |
| 系统更新 | `/system/updates` | Channel / update check UI |
| 登录 | `/login` | CPAMP admin key login + first-run CPA connection wizard |

Quota sub-UIs embedded under accounts / monitoring (i18n modules): Antigravity / Claude / Codex / Kimi / xAI / Devin quota cards; Vertex JSON import; OAuth model alias / excluded models.

---

## 2. CPAMP / CPA API inventory

### 2.1 CPA-native (`:8317`) — confirmed live (GET unless noted)

| Path | Role |
|------|------|
| `/v0/management/config` | Full management config JSON |
| `/v0/management/config.yaml` | Raw YAML GET; PUT writes config (**dangerous**) |
| `/v0/management/api-keys` | List / PUT replace / DELETE `?value=` |
| `/v0/management/auth-files` | Upstream account pool |
| `/v0/management/auth-files/download` | Download auth file (`name` required) |
| `/v0/management/gemini-api-key` | Gemini keys |
| `/v0/management/claude-api-key` | Claude keys |
| `/v0/management/codex-api-key` | Codex keys |
| `/v0/management/vertex-api-key` | Vertex keys |
| `/v0/management/xai-api-key` | xAI keys |
| `/v0/management/interactions-api-key` | Interactions keys |
| `/v0/management/openai-compatibility` | OpenAI-compat upstreams |
| `/v0/management/oauth-model-alias` | OAuth model aliases |
| `/v0/management/oauth-excluded-models` | Excluded OAuth models |
| `/v0/management/force-model-prefix` | Force model prefix flag |
| `/v0/management/ws-auth` | WebSocket auth flag |
| `/v0/management/logging-to-file` | File logging flag |
| `/v0/management/logs-max-total-size-mb` | Log size cap |
| `/v0/management/request-log` | Request log flag (`PUT {"value":bool}`) |
| `/v0/management/debug` | Debug flag |
| `/v0/management/proxy-url` | Outbound proxy URL |
| `/v0/management/plugins` | Plugins enabled/dir/list |
| `/v0/management/usage-statistics-enabled` | CPA usage stats toggle |
| `/v0/management/get-auth-status` | OAuth poll status |
| `/v0/management/oauth-callback` | Submit remote browser callback |
| `/v0/management/anthropic-auth-url` | Start Anthropic OAuth |
| `/v0/management/codex-auth-url` | Start Codex OAuth |
| `/v0/management/antigravity-auth-url` | Start Antigravity OAuth |
| `/v0/management/kimi-auth-url` | Start Kimi device OAuth |
| `/v0/management/xai-auth-url` | Start xAI device OAuth |
| `/v0/management/devin-auth-url` | Start Devin OAuth |
| `/v0/management/logs` | File logs (400 if logging-to-file off) |

Also present in CPA binary / UI (may need query body / version-specific): `auth-files` fields/status/refresh/upload, `vertex/import`, `qwen-auth-url` / `iflow-auth-url` / `gemini-cli-auth-url` (404 on this v7.3.10 build), `oauth-session`, `switch-preview-model`, `switch-project`, `api-call`, `latest-version`.

**CPA does not expose:** `/v0/management/usage`, dashboard summary, monitoring analytics, model-prices, account-action-candidates, api-key-aliases, codex-inspection, quota-snapshots (all 404 on `:8317`).

### 2.2 CPAMP-only (`:18317`) — confirmed

| Path | Methods | Role |
|------|---------|------|
| `/health` | GET | `{ok, service: cpa-manager-plus}` |
| `/v0/management/usage` | GET | Aggregated usage tree (from usage.sqlite collector) |
| `/v0/management/usage/export` | GET | Full event export JSON |
| `/v0/management/usage/import` | POST | Import usage blob |
| `/v0/management/usage/import-sessions` | POST | Start chunked import session |
| `/v0/management/usage/import-sessions/:id` | GET/… | Session status |
| `/v0/management/usage/import-sessions/:id/chunk` | POST | Upload chunk |
| `/v0/management/usage/import-sessions/:id/complete` | POST | Finish import |
| `/v0/management/dashboard/summary` | GET | Requires `today_start_ms`; today + 30m RPM/TPM + model ranks |
| `/v0/management/monitoring/analytics` | POST | Requires `from_ms`/`to_ms`; time-series analytics |
| `/v0/management/monitoring/account-history` | POST | Per-account history |
| `/v0/management/monitoring/account-window-usage` | POST | Quota window usage |
| `/v0/management/monitoring/header-snapshots` | GET | Recent header/quota error snapshots |
| `/v0/management/account-action-candidates` | GET | Auth failure candidates |
| `/v0/management/account-action-candidates/:id/{ignore,resolve,enable,auth-file}` | POST/… | Candidate actions |
| `/v0/management/api-key-aliases` | GET/PUT/DELETE | Friendly aliases for api key hashes |
| `/v0/management/model-prices` | GET/PUT | Price book |
| `/v0/management/model-prices/sync` | POST | Sync prices |
| `/v0/management/model-prices/runtime-models` | GET | Models seen at runtime |
| `/v0/management/model-prices/usage-summary` | GET | Costed usage by model |
| `/v0/management/quota-snapshots` | POST | Ingest quota snapshots |
| `/v0/management/quota-snapshots/query` | POST | Query snapshots |
| `/v0/management/codex-inspection/run` | POST | Start inspection |
| `/v0/management/codex-inspection/runs` | GET | List runs |
| `/v0/management/codex-inspection/runs/:id` | GET | Run detail |
| `/v0/management/codex-inspection/runs/:id/cancel` | POST | Cancel |
| `/v0/management/codex-inspection/runs/:id/actions` | POST | Apply actions |
| `/v0/management/usage-queue` | GET | Collector queue peek |
| `/v0/management/usage-statistics-enabled` | GET | Proxied / mirrored |
| `/v0/management/cpa-connection/validate` | POST | Validate CPA URL + management key (setup wizard) |

CPAMP also **proxies** the CPA-native paths above (same `/v0/management/...` with admin Bearer).

### 2.3 CPAMP data plane (rebuild target)

Volume `/data` in container:
- `usage.sqlite` (+ WAL) — primary collector DB (~44MB on probe host)
- `data.key` — encryption key for manager data
- `usage-imports/` — import staging

Notable tables: `usage_events`, hourly/daily rollups, `usage_monitoring_*`, `account_quota_*`, `account_action_candidates`, `api_key_aliases`, `model_prices*`, `codex_inspection_*`, `settings`, `dead_letter_events`.

Compose env: `USAGE_COLLECTOR_MODE=auto`, `USAGE_POLL_INTERVAL_MS=500`, `USAGE_BATCH_SIZE=100`, `USAGE_QUERY_LIMIT=50000`.

---

## 3. MrBlank now (admin UI + APIs)

### 3.1 Admin nav (`AdminLayout.tsx`)

| Path | Page |
|------|------|
| `/admin` | Overview (CPA health, accounts count, keys count, site-usage totals) |
| `/admin/accounts` | CPA auth-files via collector (read-only list + force refresh) |
| `/admin/aily` | Aily upstream tokens (site-specific, not CPAMP) |
| `/admin/keys` | CPA api-keys add/delete |
| `/admin/usage` | **site-usage** summarize + BFF diagnosis logs |
| `/admin/connection` | CPA / billing / optional CPAMP health + collector heartbeat |
| `/admin/config` | Sanitized CPA config (read-only) |
| `/admin/compat` | openai-compatibility JSON edit |
| `/admin/request-log` | request-log toggle (also under settings) |
| `/admin/settings` | Basic settings field writers (Wave A) |
| `/admin/providers` | AI provider keys CRUD (Wave A) |
| `/admin/oauth` | OAuth start/callback/status + aliases (Wave A) |
| `/admin/plugins` | Plugins list (+ PUT if CPA supports) (Wave A) |
| `/admin/logs` | CPA file logs viewer (Wave A) |
| `/admin/constellation` | Homepage constellation (site-specific) |
| `/admin/groups` | User groups (site-specific) |
| `/admin/credits` | Check-in / redeem (site-specific) |
| `/admin/users` | Local users (site-specific) |

### 3.2 `/api/admin/*` (relevant to CPAMP parity)

Present: `me`, `overview`, `connection`, `accounts`, `usage` (site-usage), `keys` CRUD, `config` (GET sanitized), `request-log` GET/PUT, `openai-compatibility` GET/PUT, `diagnosis/logs`, plus site-only users/groups/credits/aily/constellation.

Wave A done: settings writers, provider CRUD, auth-file mutate/download/upload, OAuth console, plugins GET, logs viewer. Still absent (Wave B/C): dashboard summary, monitoring analytics, model-prices, account-actions, api-key-aliases, usage import/export, codex-inspection, quota snapshots, raw config.yaml write.

Architecture intent (`docs/CPA_KERNEL.md`): CPA Management Key is production kernel; **site-usage** replaces CPAMP global usage for leaderboard/admin; CPAMP optional.

---

## 4. Side-by-side gap table

Legend — **Native:** implement via CPA Management API. **Rebuild:** needs site collector / new BFF store (CPA lacks data). **Site-only:** MrBlank feature with no CPAMP equivalent (keep). **Skip/optional:** low priority for openapi admin.

| Feature | CPAMP how | MrBlank now | Missing | CPA-native vs rebuild |
|---------|-----------|-------------|---------|------------------------|
| Dashboard RPM/TPM / today / model cost | `/dashboard` + `dashboard/summary` | Overview counters (site-usage + pool) | Rich 30m RPM/TPM, cost rank, health alert cards | **Rebuild** (site-usage rollups) or optional CPAMP |
| Basic settings (debug/proxy/logging/ws-auth/force-prefix/usage-stats) | `/settings` field endpoints | Only `request-log` page; config read-only | Writable toggles for remaining fields | **CPA-native** |
| API keys CRUD | `/api-keys` → CPA `api-keys` | `/admin/keys` | — mostly done | CPA-native (done) |
| API key aliases | CPAMP `api-key-aliases` | none | Aliases UI + API | **Rebuild** (map hashes↔labels in site DB) |
| AI provider keys (gemini/claude/codex/vertex/xai/interactions) | `/ai-providers/*` | none | Full provider CRUD pages | **CPA-native** |
| OpenAI compatibility | AI providers + compat | `/admin/compat` | — done (JSON editor) | CPA-native (done) |
| Auth-files list / status | `/accounts` | `/admin/accounts` read-only | Mutate: note/priority/disable/delete/download/upload | **CPA-native** (extend accounts) |
| Per-account quota panels | Accounts + quota-snapshots | none | Quota windows / forecasts | **Rebuild** (header snapshots + site store) or CPAMP |
| OAuth login flows | `/oauth` + `*-auth-url` / callback / status | none | Start/poll/cancel OAuth in admin | **CPA-native** |
| OAuth model alias / excluded | settings/accounts modules | none | Editors | **CPA-native** |
| Plugins + plugin store | `/plugins`, `/plugin-store` | none | List/enable; store optional | **CPA-native** (store = Skip/optional) |
| Usage analytics (global CPA traffic) | `/usage-analytics` + `/usage` | `/admin/usage` = **site BFF only** | Global CPA-path usage (non-BFF keys) | **Rebuild** collector **or** keep site-only policy |
| Usage import/export | usage/export + import-sessions | none | Import/export tooling | **Rebuild** |
| Request monitoring analytics | `/monitoring` POST analytics | Diagnosis logs only | Charts, selectors, search | **Rebuild** |
| Header snapshots | `monitoring/header-snapshots` | none | Error/quota header feed | **Rebuild** (can sample via CPA if exposed) |
| Account action candidates | `/monitoring/account-actions` | none | Fail-auth triage workflow | **Rebuild** from diagnosis + auth-files |
| Codex inspection | codex-inspection runs | none | Full inspection workflow | **Rebuild**/optional (CPAMP-only) |
| Model prices + cost | model-prices + usage-summary | none | Price book + costed usage | **Rebuild** (prices file + site-usage) |
| Config panel (raw YAML) | `/config` + `config.yaml` PUT | sanitized GET only | Structured editors; **avoid raw PUT** | **CPA-native** (prefer field PUTs; YAML write = dangerous) |
| Logs viewer | `/logs` | none | Tail CPA logs when logging-to-file on | **CPA-native** |
| System info / updates | `/system`, `/system/updates` | connection page partial | Version/update channel UI | Skip/optional |
| Connection / CPA validate wizard | login wizard + `cpa-connection/validate` | `/admin/connection` | — mostly done | Site BFF (done) |
| Local users / groups / credits / constellation / Aily | n/a | full pages | — | **Site-only** (keep; no CPAMP parity needed) |

---

## 5. Recommended implementation order (→ functional parity)

Parity definition for MrBlank: **every CPAMP ops capability needed to run the gateway without opening www**, in MrBlank visual style, preferring CPA kernel + site collector; CPAMP remains optional.

### Phase G1 — CPA-native settings & providers (high value, no collector) ✅ DONE (Wave A)

1. ✅ Basic settings writers: `debug`, `proxy-url`, `logging-to-file`, `logs-max-total-size-mb`, `force-model-prefix`, `ws-auth`, `usage-statistics-enabled`, `request-log` via `/api/admin/settings` (+ per-field GET/PUT). UI: `/admin/settings`.
2. ✅ AI provider key pages: gemini / claude / codex / vertex / xai / interactions CRUD. UI: `/admin/providers`. CPA shape: PUT `[{ "api-key" }]` / DELETE `?api-key=`.
3. ✅ Auth-files mutations: disable/enable (`PATCH .../auth-files/status`), fields/note (`PATCH .../fields`), force refresh (`POST .../refresh`), download, upload (multipart), delete (`DELETE ?name=`). UI: `/admin/accounts`. **Never POST JSON to `/auth-files?name=`** (overwrites credential file).
4. ✅ OAuth panel: start `*-auth-url`, poll `get-auth-status`, `oauth-callback` paste. UI: `/admin/oauth`. `qwen`/`iflow`/`gemini-cli` 404 on v7.3.10 — skipped gracefully.
5. ✅ OAuth model alias + excluded models editors (GET/PUT).
6. ✅ Plugins list (GET). PUT `/plugins` returns **404 on CPA v7.3.10** — UI shows 501/note.
7. ✅ Logs viewer gated on `logging-to-file` (`/api/admin/logs` + `/admin/logs`).

### Phase G2 — Site usage depth (rebuild; replaces CPAMP usage.sqlite for openapi)

1. Extend `siteUsage.js` rollups: 30m RPM/TPM, today success rate, by-model / by-key / by-account snapshots.
2. Admin dashboard cards parity with CPAMP `dashboard/summary` using site data.
3. Optional api-key alias table in site DB (hash → label) for nicer usage UI.
4. Model price table (JSON/SQLite in BFF) + cost estimate on site-usage summarize.
5. Keep policy clear: **leaderboard stays site-issued keys only**; admin may show “BFF-observed” vs “CPA-global” if a second collector is added later.

### Phase G3 — Monitoring / triage (rebuild)

1. Header / failure feed from BFF diagnosis + auth-files status (account-actions lite).
2. Account history / window usage only if quota headers are persisted from `/v1` or periodic CPA probes.
3. Codex inspection: **defer** unless product-required (CPAMP-only complexity).

### Phase G4 — Optional CPAMP bridge

1. Keep `CPAMP_*` optional: if configured, allow “import CPAMP usage export” into site store.
2. Do **not** hard-depend on usage.sqlite for production paths.

---

## 6. Explicit CPAMP-only capabilities that require rebuilding

These are **not** available on CPA `:8317` and must be rebuilt in MrBlank (or kept on www CPAMP):

1. **`usage.sqlite` collector** — poll CPA usage statistics / redis queue into durable events + rollups.
2. **`GET /v0/management/usage` (+ export/import-sessions)** — global usage API.
3. **`GET /v0/management/dashboard/summary`** — today / 30m RPM-TPM dashboard.
4. **`POST /v0/management/monitoring/analytics`** (+ account-history, account-window-usage).
5. **`GET /v0/management/monitoring/header-snapshots`**.
6. **`account-action-candidates`** workflow APIs.
7. **`api-key-aliases`**.
8. **`model-prices` (+ sync / runtime-models / usage-summary cost)**.
9. **`quota-snapshots` ingest/query** (+ account_quota_* tables).
10. **`codex-inspection/*`** run orchestration.
11. **Setup `cpa-connection/validate`** (MrBlank already has connection checks; wizard UX optional).
12. **Plugin store marketplace UI** (CPA has plugins list only).

MrBlank already chose a partial rebuild path via `server/siteUsage.js` + `cpaCollector.js` for BFF `/v1` traffic and auth-files cache — sufficient for community + subset admin, **not** full CPAMP global monitoring parity.

---

## 7. Probe environment snapshot

| Component | Image / note |
|-----------|----------------|
| CPAMP | `seakee/cpa-manager-plus:v1.13.1` → `127.0.0.1:18317` |
| CPA | `eceasy/cli-proxy-api:v7.3.10` → `127.0.0.1:8317` |
| Panel | `https://www.juc114.cn/management.html` |
| MrBlank admin | `#/admin/*` + `/api/admin/*` in this repo |

**Incident note (2026-09-21):** during inventory, a probe `PUT /v0/management/config.yaml` with `{}` wiped CPA config and disabled remote-management. Restored from `cliproxyapi/config.yaml.bak.20260920-093041` (+ probe api-key). Treat raw YAML PUT as unsafe; MrBlank should not expose it.

---

## 8. Top missing items (summary)

1. Writable basic settings beyond request-log  
2. AI provider key management UI  
3. Auth-file mutations + OAuth login console  
4. Dashboard / monitoring depth (RPM-TPM, analytics) via **site usage rebuild**  
5. Model prices + costed usage  
6. Account-action triage + header snapshots  
7. Plugins / logs viewer  
8. Explicit non-goals for 100% www clone: plugin-store, codex-inspection, raw config.yaml PUT, full usage.sqlite clone (unless product insists)

---

## Wave A implementation notes (2026-09-21 CST)

- BFF proxies CPA Management with server-side key under `/api/admin/*` + `requireAdmin`.
- **Safety:** no `config.yaml` PUT; field endpoints only.
- **Probe incident:** exploratory `DELETE auth-files?name=` and `POST auth-files?name=` with JSON corrupted/removed probe credentials (`262879651@qq.com` deleted; `lihongxu0330@gmail.com` antigravity file overwritten then removed). Remaining: `antigravity-lihongxu0331@gmail.com.json`, `xai-lihongxu0330@hotmail.com.json`. Re-auth via `/admin/oauth` as needed.
- CPA endpoints **404 on this build:** `qwen-auth-url`, `iflow-auth-url`, `gemini-cli-auth-url`, `PUT /plugins`.
