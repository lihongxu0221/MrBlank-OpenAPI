# MrBlank OpenAPI — 总需求与阶段计划


## P0–P4 — CPA Kernel (2026-09-21) ✅

| Phase | Status | Notes |
|-------|--------|-------|
| P0 CPA wiring | ✅ | auth-files/config via Management Key; CPAMP optional |
| P1 site usage + collector | ✅ | `siteUsage.js` + `cpaCollector.js`; leaderboard/activity site-only |
| P2 Admin UI parity | ✅ | config / compat / request-log pages; accounts/usage/connection refreshed |
| P3 Community pulse | ✅ | `/community` pulse layout; pool from CPA; board/activity from site-usage |
| P4 Docs + verify | ✅ | `docs/CPA_KERNEL.md`; tests/build; deploy from main |


更新：2026-09-21  
站点：https://openapi.juc114.cn  
仓库：https://github.com/lihongxu0221/MrBlank-OpenAPI  
内核：CPA（cli-proxy-api）+ CPAMP；Aily Adapter：127.0.0.1:8088 / aily.juc114.cn

## 目标一句话

把福利站风格的 **MrBlank OpenAPI** 做成：双登录 + CPA 真调用 + 分组额度/模型 + 管理后台（含诊断）+ 可配置前台内容；UI 统一现站风格。

---

## 已完成（基线）

| 项 | 状态 | 说明 |
|----|------|------|
| 福利站 UI 复刻 | ✅ | Vite + React |
| GitHub 私有库 | ✅ | `MrBlank-OpenAPI` |
| 域名 HTTPS | ✅ | `openapi.juc114.cn` |
| Linux.do OAuth | ✅ | `/oauth/linuxdo` |
| CPA `/v1` 反代 | ✅ | → billing shim `:8320` |
| 控制台密钥/模型/用量 | ✅ | BFF ↔ CPA/CPAMP |
| 动态排行榜/号池/调用实况/服务状态 | ✅ | 无数据则空，不造假 |
| 管理后台 `#/admin`（CPAMP 子集） | ✅ | Phase B + C 诊断；见 PHASE_B/C_CHECKLIST |
| 管理员白名单 | ✅ | `lihongxu0330@gmail.com` |
| 站名/Base URL 可配置 | ✅ | `site-config.json` |
| 本站用户名密码登录 | 🟡 | Phase A：本地用户库（非 Aily adapter） |
| 模型星座可配置 | 🟡 | 同上，需验收 |
| 用户分组+额度+模型白名单 | ✅ | Phase E：BFF 强制 + 控制台进度；见 PHASE_E_CHECKLIST |

---

## 未完成 / 待加固

| 项 | 优先级 | 说明 |
|----|--------|------|
| 登录后分流 | P0 | 管理员 → `#/admin`；普通用户 → `#/console` |
| 管理员后台能力对齐 CPAMP | ✅ B | 日常子集完成；完整运维仍用 www |
| UI 风格一致 | P0 | 登录表单、管理页、诊断弹窗均用现站 token |
| 请求响应诊断（aily 完整移植） | ✅ C | 管理员 `#/admin/usage`；BFF `/v1` 落盘；见 PHASE_C_CHECKLIST |
| Aily 上游转发 + 请求响应基于 CPA | ✅ D | 凭证管理 + CPA-first `/v1`；见 PHASE_D_CHECKLIST |
| 用户分组晋升规则可配 | ✅ E | 可配晋级 + BFF `/v1` 强制 5h/周/月与模型白名单；见 PHASE_E_CHECKLIST |
| 签到/兑换发额度 | ✅ F | 本站积分钱包 + 管理可配；见 PHASE_F_CHECKLIST |
| 排行榜用户名映射 | ✅ F | 已知用户显示昵称，未映射脱敏 |

---

## 阶段划分

### 阶段 A — 验收与收口（当前）
1. 验收双登录（Linux.do + **本站本地用户名密码**）与错误提示  
   - 本地用户库（JSON + scrypt）；`POST /api/auth/login`  
   - **不再**调用 aily-openai-adapter `/admin/auth` 做站登录  
   - `BOOTSTRAP_ADMIN_USER` / `BOOTSTRAP_ADMIN_PASSWORD` 可引导首个管理员  
   - 管理台可创建用户 / 重置密码 / 设角色  
2. 验收登录分流（admin / user：本地 `role=admin` 或 Linux.do 白名单）  
3. 验收模型星座读写（后台配置 → 首页）  
4. 验收用户分组基础（分组 CRUD、额度字段、模型白名单、控制台展示）  
5. 修回归：构建、部署、冒烟 `/v1/models`、会话、admin 401/403  

**完成标准**：上述路径人工点通；README 更新操作说明。  
**说明**：Aily adapter 仅留给阶段 D 转发/诊断，不参与登录。

### 阶段 B — 管理后台加固（CPAMP 能力子集） ✅
1. 补齐管理页：连接状态、账号/号池、密钥、用量列表  
2. 权限：非管理员不可见入口且 API 403  
3. 与 www CPAMP 分工写清：完整运维仍用 www；openapi 为同风格运营台  

**完成标准**：白名单管理员可完成日常看用量/管密钥/看连接，无需打开 CPAMP 也能完成子集操作。  
**验收清单**：[`docs/PHASE_B_CHECKLIST.md`](./PHASE_B_CHECKLIST.md)

### 阶段 C — 请求诊断（管理员） ✅
1. 代理/调用链路落盘 `req_body` / `res_body` / upstream 字段（脱敏）  
2. 使用记录列表 + 双击「请求诊断详情」弹窗（概览 / 请求信息 / 上游诊断）  
3. 对照 `/opt/aily-openai-adapter/docs/使用记录-请求诊断详情.md` 功能清单打勾  
4. 普通用户不可见正文  

**完成标准**：管理员对一次真实 `/v1` 调用可打开完整诊断；普通用户双击无效。  
**验收清单**：[`docs/PHASE_C_CHECKLIST.md`](./PHASE_C_CHECKLIST.md)（含与 aily 文档的差距说明；CPAMP 无 body）。

### 阶段 D — Aily ↔ CPA 转发整合 ✅
1. 架构（CPA-first）：客户端 → openapi `/v1` → BFF → CPA billing；可选 `AILY_MODEL_ROUTES` 走内嵌 Aily 桥接  
2. 管理员 `#/admin/aily`：共享 `.aily` 凭证、邮箱登录/粘贴 token、刷新、连通测试；CPA `openai-compatibility` 只读  
3. 诊断落盘含 `route_via=cpa|aily`（阶段 C 弹窗可用）  
4. 未改 www / aily 进程；诚实缺口：CPA Docker 暂无法直连宿主机 `:8088`，完整 aily 目录需手工 openai-compatibility + 网络  

**完成标准**：经 openapi 的默认调用走 CPA；Aily 鉴权可配置；诊断可见上下游。  
**验收清单**：[`docs/PHASE_D_CHECKLIST.md`](./PHASE_D_CHECKLIST.md)

### 阶段 E — 分组治理深化 ✅
1. 晋升规则引擎（可配阈值：注册天数、调用次数、累计用量、签到；管理员可编辑）  
2. 5h / 周 / 月额度在 BFF `/v1` 强制校验（映射到本站用户的 API 密钥）→ 429  
3. `/v1/models` 按组过滤；chat/completions 等越权模型 → 403  
4. 用户控制台：当前组、剩余/已用额度、距下一组进度；登录与每次 `/v1` 自动晋级（非 override）  
5. 额度单位文档：`1 点 = 500000` raw；token→raw MVP  

**完成标准**：换组后额度与模型立即生效；越权模型 403；额度用尽 429。  
**验收清单**：[`docs/PHASE_E_CHECKLIST.md`](./PHASE_E_CHECKLIST.md)

### 阶段 F — 可选增强 ✅
1. 签到/兑换真额度（持久化 `site-credits.json`；组额度用尽可用站点积分；管理员 `#/admin/credits`）  
2. 排行榜显示名美化（Linux.do / 本站昵称；未映射脱敏）  
3. Cloudflare 小橙云说明（README）+ 多管理员白名单 UI 提示（`#/admin/users`）  

**验收清单**：[`docs/PHASE_F_CHECKLIST.md`](./PHASE_F_CHECKLIST.md)

---

## 约束（全程）

- UI：现站 Geist + CSS 变量；不嵌 CPAMP/aily 原生页皮  
- 密钥：CPA Management / CPAMP Admin / Aily 密码只留服务端  
- 部署：只动 `MrBlank-OpenAPI` + 必要时 `openapi.juc114.cn` nginx  
- 不擅自改：www CPAMP、new-api、hermes、aily 进程（对接用本机端口即可）  

## 建议执行顺序

**A → B → C → D → E → F**  
每一阶段结束：构建、推送、VPS 部署、给用户可测清单。

## 重要更正（2026-09-21）
账号密码登录为本站原生用户体系（本地用户库+会话），**不**调用 aily-openai-adapter `/admin/auth`。Aily 仅用于阶段 D 的上游鉴权/转发/诊断。
