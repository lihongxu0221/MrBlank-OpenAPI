# MrBlank OpenAPI

Vite + React 控制台，部署于 [openapi.juc114.cn](https://openapi.juc114.cn)。支持 **Linux.do OAuth** 与 **本站用户名/密码** 双登录、会话 Cookie，以及对接 **CPA 内核**（与 www CPAMP 同源）的模型 / 密钥 / 用量。

> **Base URL**：`https://openapi.juc114.cn/v1`  
> 本域名 nginx 将 `/v1/` 反代到本机 CPA billing shim（`127.0.0.1:8320`）→ cli-proxy-api。控制台 BFF（`:8787`）用服务端持有的 Management / Admin Key 调用 CPA / CPAMP，**不会把这些密钥下发到浏览器**。

## 站名与 Base URL（可配置）

编辑 `public/site-config.json`（生产可直接改该文件后刷新）：

```json
{
  "siteName": "MrBlank OpenAPI",
  "brandShort": "公益站",
  "siteTagline": "为每一种好奇，打开可能",
  "siteTaglineEn": "More room for every idea",
  "apiBaseUrl": "https://openapi.juc114.cn/v1",
  "footerLine": "Built for curiosity, shared with care."
}
```

源码默认值见 `src/config/site.ts`。

## 架构

客户端调用始终经 **CPA 内核**（非并行 aily 网关）：

```
浏览器 / SDK
  → https://openapi.juc114.cn/v1
  → nginx → BFF :8787
       ├─ 默认 → CPA billing :8320 → cli-proxy-api :8317
       └─ 可选（AILY_MODEL_ROUTES 命中）→ aily-openai-adapter :8088
BFF 先做用户组治理（额度 429 / 模型 403 / models 过滤），再落盘诊断（含 route_via）
站登录 = 本站本地用户 + Linux.do（不用 aily）
Aily 上游凭证 = 共享 ~/.config/aily-project/.aily，管理入口 #/admin/aily
```

| 组件 | 地址 | 用途 |
|---|---|---|
| 本站静态 + BFF | openapi.juc114.cn → `:8787` | Linux.do / 本站账号登录、控制台 `/api`、诊断捕获 |
| `/v1` | openapi.juc114.cn/v1 → BFF `:8787` → `:8320`（默认） | 对外 OpenAI 兼容；CPA 为模型源 |
| CPA | `127.0.0.1:8317` | cli-proxy-api；Management Key 管 api-keys |
| CPAMP | `127.0.0.1:18317`（www） | 用量汇总；Admin Key **仅服务端**；勿改 www UI |
| Aily adapter | `127.0.0.1:8088` / aily.juc114.cn | 上游 Aily token 与 OpenAI 适配；**不是** openapi 对外主入口 |

控制台能力：

- **模型**：BFF `GET /api/token/options` ← CPA `GET /v1/models`（demo key）
- **密钥**：登录用户创建时 BFF 调 CPA `PUT /v0/management/api-keys`，并在磁盘映射 `linux.do user → key`
- **请求诊断（管理员）**：`#/admin/usage` 双击行打开「请求诊断详情」；正文来自 BFF `/v1` 落盘（CPAMP 汇总无 body）
- **Aily 上游（管理员）**：`#/admin/aily` 管理共享凭证 / 连通测试；可选 `AILY_MODEL_ROUTES` 旁路；见 `docs/PHASE_D_CHECKLIST.md`
- **用户组治理（Phase E）**：`#/admin/groups` 配置额度/白名单/晋级；BFF `/v1` 对映射密钥强制 429/403；控制台展示剩余与晋级进度；见 `docs/PHASE_E_CHECKLIST.md`
- **用量**：BFF `GET /api/log/self` ← CPAMP `GET /v0/management/usage`，按密钥 sha256 过滤
- **社区排行 / 号池 / 调用实况 / 服务状态**：BFF 聚合 CPAMP usage + auth-files + CPA `/v1/models` 与 health（短缓存）；无数据时返回空列表
- **签到 / 兑换**：仍为进程内逻辑（未接 CPA 配额）

## 环境变量（服务端，勿提交 git）

| 变量 | 说明 |
|---|---|
| `LINUXDO_CLIENT_ID` / `LINUXDO_CLIENT_SECRET` | Linux.do OAuth |
| `LINUXDO_REDIRECT_URI` | 如 `https://openapi.juc114.cn/oauth/linuxdo` |
| `SESSION_SECRET` | 会话签名 |
| `PORT` / `HOST` / `SITE_ORIGIN` | 默认 `8787` / `127.0.0.1` / 本站 origin |
| `CPA_BASE_URL` | 默认 `http://127.0.0.1:8317` |
| `CPA_BILLING_URL` | 默认 `http://127.0.0.1:8320` |
| `CPAMP_BASE_URL` | 默认 `http://127.0.0.1:18317` |
| `PUBLIC_API_BASE_URL` | 默认 `https://openapi.juc114.cn/v1` |
| `CPA_DEMO_API_KEY_FILE` | demo client key 文件路径 |
| `CPA_MANAGEMENT_KEY_FILE` | CPA management key 文件路径 |
| `CPAMP_ADMIN_KEY_FILE` | CPAMP admin key 文件路径 |
| `USER_KEYS_PATH` | 用户密钥映射 JSON（默认 `server/data/user-keys.json`） |
| `BOOTSTRAP_ADMIN_USER` / `BOOTSTRAP_ADMIN_PASSWORD` | 首次启动创建本站管理员（若用户名不存在）；勿提交真实密码 |
| `LOCAL_USERS_PATH` | 本地用户 JSON（默认 `server/data/local-users.json`） |
| `ADMIN_LOCAL_USERNAMES` | 可选：额外将指定本站用户名视为管理员（本地 `role=admin` 已足够） |
| `AILY_ADAPTER_URL` | 预留阶段 D 上游转发/诊断（**不用于站登录**） |

也可用 `CPA_DEMO_API_KEY` / `CPA_MANAGEMENT_KEY` / `CPAMP_ADMIN_KEY` 直接注入（勿写入仓库）。示例见 `server/.env.example`。

## 本地开发

```bash
# 终端 1：OAuth + API
cp server/.env.example .env   # 填入真实密钥
npm install --prefix server
npm run server

# 终端 2：前端（代理 /api 与 /oauth → :8787）
npm install
npm run dev
```

Linux.do 登录需使用已登记的 Redirect URI。生产回调为 `https://openapi.juc114.cn/oauth/linuxdo`。

## 生产

```bash
npm run build
npm install --omit=dev --prefix server
npm start   # 建议 systemd：mrblank-openapi.service
```

Nginx：

- 静态根目录 → `dist/`
- `/api/`、`/oauth/` → `http://127.0.0.1:8787`
- `/v1/` → `http://127.0.0.1:8787`（BFF 诊断捕获 → CPA billing `:8320`）

## 路由

| Hash | 说明 |
|---|---|
| `#/` | 首页 |
| `#/guide` | 接入指南 |
| `#/availability` | 服务状态（CPA 探测 + CPAMP 延迟） |
| `#/community` | 社区动态（排行/号池/调用实况来自 CPAMP） |
| `#/about` | 关于 |
| `#/console` 等 | 控制台（需登录；普通用户落地） |
| `#/admin` 等 | 运营控制台（白名单管理员；CPAMP/CPA 子集） |

## 声明

站名与布局参考了公开公益站前端；本仓库用于私人部署与学习。请勿冒充官方 Darkforger 服务。模型上游为本地 CPA，而非 Darkforger。


## 管理员白名单（`#/admin`）

### 运维分工

| 面板 | 用途 |
|------|------|
| **www CPAMP**（`https://www.juc114.cn/management.html`） | **完整运维**：高级配置、供应商/账号深度操作 |
| **openapi `#/admin`**（本站） | **日常运营子集**（MrBlank Geist / CSS 变量风格）：连接状态、号池健康、CPA 密钥、用量汇总，以及星座 / 用户组 / 本站账号 |

**不会** iframe 嵌入或修改 www 的 management UI。清单见 [`docs/PHASE_B_CHECKLIST.md`](docs/PHASE_B_CHECKLIST.md)。

OpenAPI 站内运营控制台是 **CPAMP 能力的兼容风格子集**（概览 / 上游账号 / CPA 密钥 / 用量 / 连接状态）。

在 VPS `.env`（或 systemd 环境）中设置：

```bash
# 数字 ID、用户名、和/或邮箱（逗号或空格分隔；邮箱/用户名大小写不敏感）
ADMIN_LINUXDO_IDS=123456
ADMIN_LINUXDO_USERNAMES=your_linuxdo_name
ADMIN_LINUXDO_EMAILS=you@example.com
BOOTSTRAP_ADMIN_USER=admin
# BOOTSTRAP_ADMIN_PASSWORD=set_on_server_only
ADMIN_LOCAL_USERNAMES=
```

匹配 Linux.do OAuth 返回的 `id` / `username` / `name`（display_name）/ `email`；
本站密码登录用户按本地 `role=admin`（或 `ADMIN_LOCAL_USERNAMES`）判定；Linux.do 仍走白名单。
管理员登录后进入 `#/admin`，普通用户进入 `#/console`。

- 未配置任一项时：**无人**可进入管理接口（403）
- 仅白名单用户能看见导航「管理」并访问 `#/admin`
- 浏览器只拿到脱敏数据；`CPAMP_ADMIN_KEY` / `CPA_MANAGEMENT_KEY` 仅服务端读取
- 完整高级配置仍使用 www CPAMP 面板
