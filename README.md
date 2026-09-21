# MrBlank-OpenAPI

Darkforger 公益站（https://welfare.darkforger.com/）的**前端演示克隆**，使用 Vite + React + TypeScript 重建 UI，并通过 Vite 中间件提供 Mock `/api/*`。

> 本项目**不是**官方 Darkforger 服务，也未接入真实 Linux.do OAuth / Turnstile / 上游模型。仅供学习与本地预览。

## 快速开始

```bash
npm install
npm run dev
```

浏览器打开终端提示的本地地址（默认 `http://localhost:5173`）。

```bash
npm run build    # 产出 dist/
npm run preview  # 预览构建结果（同样挂载 Mock API）
```

## 已实现路由

| Hash 路由 | 说明 |
|---|---|
| `#/` | 首页（英雄区、模型星座、三步、FAQ、艺术展台） |
| `#/guide` | 接入指南与代码示例 |
| `#/availability` | 服务状态 / 模型健康 |
| `#/community` | 排行榜、号池、模型调用实况 |
| `#/about` | 关于公益 / 公平使用 / 隐私 / 许可 |
| `#/console` | 控制台概览（需登录） |
| `#/checkin` | 每日签到 |
| `#/redeem` | 兑换码 |
| `#/keys` | API 密钥 CRUD |
| `#/usage` | 用量记录 |
| `#/models` | 模型广场 |
| `#/channels` | 控制台内服务状态 |

## 登录说明

- 保留「使用 Linux.do 登录」按钮（演示环境会提示未接真实 OAuth）。
- 额外提供 **「开发者模拟登录」**，写入内存/sessionStorage mock session，即可使用签到、兑换、密钥、用量等页面。

## Mock API

开发/预览服务器拦截 `/api/*`，返回 `{ success, data, message }` 信封，覆盖状态、配置、公告、可用性、排行榜、签到、兑换、Token、日志等。

演示兑换码：`WELCOME` / `GROK2026` / `COMMUNITY` / `DARKFORGER`（或任意 `DF-` 前缀）。

## 主题

- `localStorage`：`welfare.theme` / `welfare.accent` / `welfare.language`
- 明暗 + 极昼蓝 / 香槟金 / 蔷薇 / 石墨
- 控制台区域使用中性色覆盖（忽略 accent）

## 与原站差距

- 无真实 Linux.do OAuth / Cloudflare Turnstile / PoW worker 校验
- 艺术展台为静态 hero 图轮播，非粒子 canvas
- 部分动效、公告「今日不再提示」细节、密钥高级字段未完全对齐
- `/v1/*` 上游代理未实现（仅文档与示例）

## 声明

品牌、文案与设计参考自 Darkforger 公益站公开前端；本仓库为私人学习用途的重建，请勿用于冒充官方服务。
