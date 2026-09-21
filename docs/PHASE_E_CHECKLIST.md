# Phase E checklist — 分组治理深化

Date: 2026-09-21 (Asia/Shanghai)  
Deploy: `openapi.juc114.cn` · service `mrblank-openapi.service`  
Scope: Configurable promotion + **BFF `/v1` enforcement** of rolling quotas & model allowlists; user console progress.

## Credit unit（额度单位）

| 概念 | 说明 |
|------|------|
| 内部单位 (raw) | 整数；用户组 `quotas.window_5h / week / month` 按此计量 |
| 展示「点」 | `raw / 500000`（与站点 `quota_per_unit` 一致，约 $1 展示换算） |
| `/v1` 计入 | 成功调用的 `prompt_tokens + completion_tokens` → raw（MVP：1 token ≈ 1 raw）；至少计 1 |
| API 字段 | `GET /api/status` → `credit_unit`；`GET /api/user/group` → `credit_unit` + `remaining` / `used` / `limits` |

空 `model_ids` = 不限制模型；非空 = 白名单（列表过滤 + 补全拒绝）。

## Goals vs delivery

| Goal | Status | Notes |
|------|--------|-------|
| 可配晋级规则（天数 / 请求 / 用量 / 签到） | ✅ | `#/admin/groups` 可编辑并保存；`user-groups.json` |
| BFF `/v1` 滚动额度 5h/周/月 → 429 | ✅ | 仅当 Bearer 密钥能映射到本站用户；未映射（如 CPA demo）放行 |
| 模型白名单：`/v1/models` 过滤 + chat 403 | ✅ | `x-mrblank-governance: model_not_allowed` |
| 控制台：当前组、剩余额度、距下一组进度 | ✅ | `#/console` Overview；含已用/上限与进度分子分母 |
| 自动晋级（登录 + `/v1`） | ✅ | `resolveUserGroup`；管理员 override 不自动升 |
| 文档 + 冒烟 | ✅ | 本清单 + ROADMAP；不改 www/aily/new-api/hermes |

## Enforcement path

```
Client Bearer sk-mrblank-<userId>-…
  → POST/GET https://openapi.juc114.cn/v1/…
  → BFF governance
       ├─ findByApiKey → userId
       ├─ resolveUserGroup (auto-promote unless override)
       ├─ consuming? assertQuota → 429 + retry-after
       ├─ consuming + model? assertModelAllowed → 403
       ├─ GET /v1/models? filter response data[]
       └─ upstream CPA (or aily bypass) → on success recordUsage
```

## Smoke

| Check | Expect |
|-------|--------|
| `GET /api/status` | 200；`quota_per_unit=500000`；`credit_unit.note` 非空 |
| `GET /api/user/group` (cookie) | 200；`group` / `remaining` / `progress` / `credit_unit` |
| Admin `#/admin/groups` 改晋级阈值并保存 | 刷新后仍在 |
| 本站密钥 `GET /v1/models`（组有白名单） | 仅白名单 id |
| 本站密钥 `POST /v1/chat/completions` 非白名单 model | **403** `model_not_allowed` |
| 将组 `window_5h` 临时调极小后反复调用 | **429** `quota_*_exhausted`；`x-mrblank-governance` |
| 登录后 Overview | 显示组名、剩余、距下一组进度 |
| CPA demo 密钥（未进 user-keys） | 仍可调 `/v1`（无站点组限制） |
| 站点 / aily / www HTTP | 200 / 302 / 307（未动） |

## Files

- `server/groups.js` — credit_unit、lifetime、model assert、response filter、quota codes  
- `server/userKeys.js` — `findByApiKey`  
- `server/v1Proxy.js` — governance enforce / filter / onComplete  
- `server/index.js` — wire governance；promote-on-login；status.credit_unit  
- `src/pages/console/OverviewPage.tsx` — 剩余/已用/进度  
- `src/pages/admin/AdminGroupsPage.tsx` — 文案  
- `docs/ROADMAP.md`、本清单、README  

## Live smoke (2026-09-21 Asia/Shanghai)

| Check | Result |
|-------|--------|
| Deploy `5ed671a` + `systemctl restart mrblank-openapi` | ✅ active；v1_proxy on→:8320 |
| `GET /api/status` credit_unit | ✅ `quota_per_unit=500000`；`credit_unit.note` 非空 |
| Admin save groups + member assign | ✅ `/api/admin/groups` PUT 200 |
| Mapped key `GET /v1/models`（白名单仅 `__phase_e_deny__`） | ✅ `data` 空列表（过滤生效） |
| Mapped key disallowed model | ✅ **403** `x-mrblank-governance: model_not_allowed` |
| `window_5h=0` 后 chat | ✅ **429** `quota_5h_exhausted`；`retry-after: 300` |
| `GET /api/user/group` | ✅ group / remaining / progress / credit_unit |
| CPA demo 密钥（未映射） | ✅ `/v1/models` 200；12 models（旁路站点组限制） |
| openapi / aily / www | ✅ 200 / 302 / 307（未改进程） |
| 恢复默认 groups | ✅ newcomer `model_ids=[]`，5h=1000000 |

How to verify UI: login → https://openapi.juc114.cn/#/console （用户组卡片）；admin → https://openapi.juc114.cn/#/admin/groups 。
