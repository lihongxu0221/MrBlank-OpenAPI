# MrBlank OpenAPI — 总需求与阶段计划

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
| 管理后台骨架 `#/admin` | ✅ | MrBlank 风格，非嵌 CPAMP |
| 管理员白名单 | ✅ | `lihongxu0330@gmail.com` |
| 站名/Base URL 可配置 | ✅ | `site-config.json` |
| 本站用户名密码登录 | 🟡 | Phase A：本地用户库（非 Aily adapter） |
| 模型星座可配置 | 🟡 | 同上，需验收 |
| 用户分组+额度+模型白名单 | 🟡 | 提交 `e7731f9`，需验收与加固 |

---

## 未完成 / 待加固

| 项 | 优先级 | 说明 |
|----|--------|------|
| 登录后分流 | P0 | 管理员 → `#/admin`；普通用户 → `#/console` |
| 管理员后台能力对齐 CPAMP | P0 | 账号/供应商健康、密钥、用量、连接；仅管理员 |
| UI 风格一致 | P0 | 登录表单、管理页、诊断弹窗均用现站 token |
| 请求响应诊断（aily 完整移植） | P0 | 仅管理员；双击使用记录；见 aily 诊断文档 |
| Aily 上游转发 + 请求响应基于 CPA | P0 | 站登录已本站化；阶段 D 只做上游转发/诊断对接 CPA |
| 用户分组晋升规则可配 | P1 | 仿 Linux.do TL；5h/周/月额度；模型白名单强制生效 |
| 签到/兑换发额度 | P2 | CPA 无此能力时需自建额度层 |
| 排行榜用户名映射 | P2 | 现有 hash 脱敏，映射登录用户展示名 |

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

### 阶段 B — 管理后台加固（CPAMP 能力子集）
1. 补齐管理页：连接状态、账号/号池、密钥、用量列表  
2. 权限：非管理员不可见入口且 API 403  
3. 与 www CPAMP 分工写清：完整运维仍用 www；openapi 为同风格运营台  

**完成标准**：白名单管理员可完成日常看用量/管密钥/看连接，无需打开 CPAMP 也能完成子集操作。

### 阶段 C — 请求诊断（管理员）
1. 代理/调用链路落盘 `req_body` / `res_body` / upstream 字段（脱敏）  
2. 使用记录列表 + 双击「请求诊断详情」弹窗（概览 / 请求信息 / 上游诊断）  
3. 对照 `/opt/aily-openai-adapter/docs/使用记录-请求诊断详情.md` 功能清单打勾  
4. 普通用户不可见正文  

**完成标准**：管理员对一次真实 `/v1` 调用可打开完整诊断；普通用户双击无效。

### 阶段 D — Aily ↔ CPA 转发整合
1. 明确架构：客户端 → openapi `/v1` → CPA；（Aily 上游账号由 CPA/管理侧维护或 BFF 配置）  
2. Aily 凭证管理入口（管理员）：测试连通、刷新 token（若仍需直连 Aily 管理能力则 BFF 代理 8088，不暴露密钥）  
3. 转发日志足以支撑阶段 C 诊断  
4. 不改坏 www / aily 独立站，除非必要且单独评审  

**完成标准**：经 openapi 的调用走 CPA；Aily 相关鉴权可被管理员配置；诊断可看到上下游。

### 阶段 E — 分组治理深化
1. 晋升规则引擎（可配阈值：注册天数、调用次数、token 等）  
2. 5h / 周 / 月额度在 BFF 强制校验  
3. `/v1/models` 与补全请求按组过滤模型  
4. 用户控制台：当前组、剩余额度、距下一组进度  

**完成标准**：换组后额度与模型立即生效；越权模型 403；额度用尽 429。

### 阶段 F — 可选增强
1. 签到/兑换真额度  
2. 排行榜显示名美化  
3. Cloudflare 小橙云 / 多管理员白名单 UI  

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
