# MrBlank OpenAPI

Vite + React 公益站控制台 + Node BFF。支持 **Linux.do OAuth** 与 **本站用户名/密码** 双登录，对外提供 OpenAI 兼容的 `/v1` 接口；模型、密钥与用量统一经 **CPA 内核** 处理。

> 所有上游管理密钥只保存在服务端环境变量 / 文件中，**不会下发到浏览器**，也不应提交到仓库。

## 站名与 Base URL（可配置）

编辑 `public/site-config.json`（生产环境可直接修改后刷新）：

```json
{
  "siteName": "MrBlank OpenAPI",
  "brandShort": "公益站",
  "siteTagline": "为每一种好奇，打开可能",
  "siteTaglineEn": "More room for every idea",
  "apiBaseUrl": "https://your-domain.example/v1",
  "footerLine": "Built for curiosity, shared with care."
}
```

源码默认值见 `src/config/site.ts`。

## 架构

```
浏览器 / SDK
  → https://<站点域名>/v1
  → 反向代理 → BFF（Node，server/）
       ├─ 用户组治理：窗口额度 429 / 模型白名单 403 / 单模型硬上限 / models 过滤
       ├─ 组额度用尽时可使用钱包余额（本站积分）继续调用
       ├─ 请求诊断落盘（仅管理员可查看）
       └─ 转发 → CPA 内核（模型源、API Key 管理、计费）
```

| 组件 | 用途 |
|---|---|
| 静态前端（`dist/`） | 首页、接入指南、社区、控制台、运营后台 |
| BFF（`server/`） | 登录会话、控制台 `/api`、`/v1` 代理与治理、诊断、钱包 / 签到 / 兑换、用户组 |
| CPA 内核 | 内嵌上游：模型列表、API Key、实际转发与计费 |

## 功能

**控制台（普通用户）**

- **概览**：钱包余额、用户组与剩余额度、晋级进度
- **每日签到 / 兑换码**：发放本站积分（点），日界为北京时间零点
- **钱包**：收入 / 支出流水（时间、IP、方式、途径、点数、详细信息），支持时间预设（今天 / 昨天 / 近 24 小时 / 近 7 天 / 近 30 天 / 本月 / 上月 / 全部 / 自定义）、方式与途径筛选、分页；时间边界统一为 Asia/Shanghai
- **API 密钥**：创建 / 管理个人密钥（额度、模型限制、并发）
- **用量记录**：请求明细、分布与趋势；消费以「点」显示
- **模型广场 / 服务状态**

**运营后台（管理员）**

- 凭证管理（列表 / 健康巡检 / OAuth / 凭证文件）、AI 提供商、日志与请求监控
- 模型价格（价格本同步与继承）、用量监控（含请求诊断详情）
- 用户组：窗口额度（5 小时 / 周 / 月）、模型白名单、晋级规则
- **组模型配额**：按组为单个模型设置滚动硬上限
- 签到兑换：签到发放区间、兑换码、手动发放 / 扣减、钱包流水
- 本站账号、模型星座、配置面板

## 计量单位

- **1 USD = 500,000 token**（固定）
- **1 点 = N token**，N 由管理员在后台配置（`raw_per_point`）
- 展示点数 = token ÷ N；模型消费按「Token × 模型单价 → USD → token → 点」折算
- 钱包流水同时记录 token 原值与记账时的 N，界面按当前 N 显示

## 环境变量（服务端，勿提交 git）

完整示例见 `server/.env.example`，常用项：

| 变量 | 说明 |
|---|---|
| `LINUXDO_CLIENT_ID` / `LINUXDO_CLIENT_SECRET` / `LINUXDO_REDIRECT_URI` | Linux.do OAuth |
| `SESSION_SECRET` | 会话签名 |
| `PORT` / `HOST` / `SITE_ORIGIN` | BFF 监听与站点 origin |
| `CPA_BASE_URL` / `CPA_BILLING_URL` | CPA 内核地址 |
| `CPA_MANAGEMENT_KEY` 或 `CPA_MANAGEMENT_KEY_FILE` | CPA 管理密钥（仅服务端） |
| `PUBLIC_API_BASE_URL` | 对外展示的 `/v1` 地址 |
| `BOOTSTRAP_ADMIN_USER` / `BOOTSTRAP_ADMIN_PASSWORD` | 首次启动创建本站管理员；勿提交真实密码 |
| `ADMIN_LINUXDO_IDS` / `ADMIN_LINUXDO_USERNAMES` / `ADMIN_LINUXDO_EMAILS` / `ADMIN_LOCAL_USERNAMES` | 管理员白名单 |
| `SITE_CREDITS_PATH` / `WALLET_LEDGER_PATH` | 站点积分 JSON / 钱包流水 JSONL（默认 `server/data/`） |
| `USER_GROUPS_PATH` / `USER_KEYS_PATH` / `LOCAL_USERS_PATH` | 用户组 / 密钥映射 / 本站用户（默认 `server/data/`） |

`server/data/` 为运行时数据目录，已被 git 忽略；部署时请保留，勿覆盖。

## 本地开发

```bash
# 终端 1：BFF
cp server/.env.example .env   # 填入本地配置
npm install --prefix server
npm run server

# 终端 2：前端（开发服务器代理 /api 与 /oauth 到 BFF）
npm install
npm run dev
```

测试与构建：

```bash
npm test         # server/test/*.test.js
npm run build    # tsc -b && vite build
```

钱包历史回填（服务启动时会自动执行，幂等）：

```bash
node server/scripts/backfill-wallet.js --dry-run   # 仅预览
```

## 生产部署

```bash
npm run build
npm install --omit=dev --prefix server
npm start        # 建议使用 systemd 等进程管理
```

反向代理要点：

- 静态根目录 → `dist/`，未知路径回退 `index.html`（SPA）
- `/api/`、`/oauth/`、`/v1/` → BFF
- 设置 `X-Real-IP`（BFF 以此记录客户端 IP，不信任客户端自带的 `X-Forwarded-For` 首项）

## 路由

| 路径 | 说明 |
|---|---|
| `/` | 首页 |
| `/guide` | 接入指南 |
| `/availability` | 服务状态 |
| `/community` | 社区动态 |
| `/about` | 关于 |
| `/console` | 控制台概览（需登录） |
| `/checkin` / `/redeem` / `/wallet` | 每日签到 / 兑换码 / 钱包 |
| `/keys` / `/usage` / `/models` / `/channels` | API 密钥 / 用量记录 / 模型广场 / 服务状态 |
| `/admin` 等 | 运营后台（仅管理员） |

## 管理员

- 本站密码登录用户按本地 `role=admin`（或 `ADMIN_LOCAL_USERNAMES`）判定；Linux.do 用户按白名单（id / 用户名 / 邮箱）判定
- 未配置任何管理员时，无人可访问管理接口（403）
- 管理员登录后进入 `/admin`，普通用户进入 `/console`
- 浏览器只获得脱敏数据；管理密钥仅服务端读取

## 声明

站名与布局参考了公开公益站前端；本仓库用于私人部署与学习。请勿冒充官方 Darkforger 服务。
