# Phase F checklist — 可选增强（签到/兑换/排行榜）

Date: 2026-09-21 (Asia/Shanghai)  
Deploy: `openapi.juc114.cn` · service `mrblank-openapi.service`  
Scope: Real check-in & redeem → site credit wallet; leaderboard display names; light admin/docs polish.

## Credit unit（与 Phase E 一致）

| 概念 | 说明 |
|------|------|
| 内部单位 (raw) | 整数；签到/兑换发放与 `/v1` 扣减均用此单位 |
| 展示「点」 | `raw / 500000` |
| 本站积分钱包 | `server/data/site-credits.json`；`GET /api/user/self` → `quota` |
| 与组额度关系 | 组滚动窗口仍强制；**用尽后**若站点积分 > 0 仍可调用；成功调用同时 `recordUsage` + `consume` 站点积分 |
| 日界 | `Asia/Shanghai` 日历日 |

## Goals vs delivery

| Goal | Status | Notes |
|------|--------|-------|
| 签到发真额度 | ✅ | `POST /api/user/checkin` → 持久化余额；晋级 `min_checkins` 读磁盘 |
| 兑换码真额度 | ✅ | `POST /api/user/topup`；管理员可配码；每人每码一次 |
| 管理员可配每日发放 / 兑换码 | ✅ | `#/admin/credits`；`PUT /api/admin/credits/config` / `codes` |
| 排行榜显示名 | ✅ | 映射 Linux.do / 本站 profile；未映射 `k***` / `u***` |
| 多管理员白名单 UI 提示 | ✅ | `#/admin/users` 显示 env 数量提示（不泄露名单） |
| Cloudflare 说明 | ✅ | README 小节 |
| 不破坏 A–E | ✅ | 组 429/403 逻辑保留；站点积分仅为 overflow |
| 文档 + 冒烟 | ✅ | 本清单 + ROADMAP |

## Smoke

| Check | Expect |
|-------|--------|
| 登录后 `#/checkin` 签到 | Toast 显示获得点数；`#/console`「可用额度」增加 |
| 同日再签 | 「今日已签到」 |
| `#/redeem` 输入 `WELCOME`（首次） | 成功 +5 点；再兑失败 |
| 管理员 `#/admin/credits` 改每日发放并保存 | 刷新后仍在；`site-credits.json` 更新 |
| 管理员新增兑换码并保存 | 用户可兑 |
| 组 `window_5h` 调极小且站点积分为 0 | `/v1` chat → **429** |
| 同上但先签到/兑换有余额 | `/v1` 仍可成功；余额下降 |
| `#/community` 排行榜 | 已知用户显示昵称；未知脱敏 |
| openapi / aily / www | 未改其它站点进程 |

## Files

- `server/credits.js` — 钱包 / 签到 / 兑换码
- `server/index.js` — API + `/v1` overflow + admin routes
- `server/cpa.js` — leaderboard `mapped` 标记
- `src/pages/admin/AdminCreditsPage.tsx`、`AdminLayout`、`App.tsx`
- `src/pages/console/CheckinPage.tsx`、`OverviewPage.tsx`
- `src/pages/CommunityPage.tsx`、`AdminUsersPage.tsx`
- `docs/ROADMAP.md`、本清单、README

## How to test on https://openapi.juc114.cn

1. **签到**：登录 → https://openapi.juc114.cn/#/checkin →「验证并签到」→ 回控制台看「可用额度」。
2. **兑换**：https://openapi.juc114.cn/#/redeem → 输入管理员配置的码（默认种子含 `WELCOME` 等，每人一次）。
3. **排行榜**：https://openapi.juc114.cn/#/community → 探索者排行榜；已登录并建密钥的用户应显示昵称。
4. **管理**：管理员 → https://openapi.juc114.cn/#/admin/credits 调整每日发放与兑换码。

## Live smoke

_(fill after deploy)_
