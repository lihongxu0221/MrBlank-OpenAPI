# MrBlank OpenAPI

Vite + React 控制台，部署于 [openapi.juc114.cn](https://openapi.juc114.cn)。支持 **真实 Linux.do OAuth**、会话 Cookie，以及签到 / 兑换 / 密钥等控制台 API（服务端进程内存储）。

> 本站是独立部署的 OpenAPI **控制台 UI**。模型调用请使用配置的 Base URL（默认 `https://welfare.darkforger.com/v1`）。**本域名默认不代理 `/v1`**，请勿把本站当成已托管的上游模型服务。

## 站名与 Base URL（可配置）

编辑 `public/site-config.json`（生产可直接改该文件后刷新，无需重新打包前端逻辑以外的文案依赖构建内默认值）：

```json
{
  "siteName": "MrBlank OpenAPI",
  "brandShort": "公益站",
  "siteTagline": "为每一种好奇，打开可能",
  "siteTaglineEn": "More room for every idea",
  "apiBaseUrl": "https://welfare.darkforger.com/v1",
  "footerLine": "Built for curiosity, shared with care."
}
```

源码默认值见 `src/config/site.ts`。

## 环境变量（服务端，勿提交 git）

| 变量 | 说明 |
|---|---|
| `LINUXDO_CLIENT_ID` | Linux.do OAuth Client ID |
| `LINUXDO_CLIENT_SECRET` | Client Secret |
| `LINUXDO_REDIRECT_URI` | 回调，如 `https://openapi.juc114.cn/oauth/linuxdo` |
| `SESSION_SECRET` | 会话签名密钥（随机长串） |
| `PORT` | 默认 `8787` |
| `HOST` | 默认 `127.0.0.1` |
| `SITE_ORIGIN` | 默认 `https://openapi.juc114.cn` |

示例见 `server/.env.example`。本地可在仓库根目录放 `.env`（已 gitignore）。

## 本地开发

```bash
# 终端 1：OAuth + API
cp server/.env.example .env   # 填入真实密钥；生产 redirect 用于线上测试
npm install --prefix server
npm run server

# 终端 2：前端（代理 /api 与 /oauth → :8787）
npm install
npm run dev
```

Linux.do 登录需使用已登记的 Redirect URI。当前生产回调为 `https://openapi.juc114.cn/oauth/linuxdo`，因此 **OAuth 请在该域名上验证**；本地主要联调 API。

已移除「开发者模拟登录」。

## 生产

```bash
npm run build                 # 产出 dist/
npm install --omit=dev --prefix server
npm start                     # node server/index.js （建议 systemd）
```

Nginx：静态根目录指向 `dist/`，并将 `/api/`、`/oauth/` 反代到 `http://127.0.0.1:8787`（`/oauth/linuxdo` 必须先于 SPA `try_files`）。

## 路由

| Hash | 说明 |
|---|---|
| `#/` | 首页 |
| `#/guide` | 接入指南 |
| `#/availability` | 服务状态 |
| `#/community` | 社区动态 |
| `#/about` | 关于 |
| `#/console` 等 | 控制台（需 Linux.do 登录） |

## 声明

站名、文案与布局参考了公开公益站前端；本仓库用于私人部署与学习。请勿冒充官方 Darkforger 服务。
