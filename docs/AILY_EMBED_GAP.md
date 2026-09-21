# Aily 内嵌移植差距（相对 aily-openai-adapter / 设计文档）

> 约束：只在 MrBlank BFF/站点侧**增量**移植；不删除既有站点功能；**不修改 CPA 内核**（进程 / config.yaml / CPA 管理语义）。未命中 Aily/compat 路由的 `/v1` 仍走 CPA。

## 已上线

| 能力 | 位置 | 对应设计文档 |
|------|------|----------------|
| 内嵌 Aily 桥（chat + models catalog） | `server/ailyUpstream.js`；命中：`aily/` 前缀 / `AILY_MODEL_ROUTES` / compat；站点 routing 只做白名单映射，**不再**用裸名抢 CPA | §6.2、§8.1 chat/models |
| Aily 凭证管理 | `server/aily.js` + `/api/admin/aily/*` + `AdminOauthPage` | §7.3、§6.7 |
| 模型白名单 / 映射 / 同步 | `server/ailyModelRouting.js` → `server/data/aily-model-routing.json` | §6.3 |
| Admin GET/PUT `/api/admin/aily/models` | `server/index.js` | §8.2 |
| 运行时：`/v1/models` 与 chat 应用 whitelist+mappings | `ailyUpstream` | §6.3、§7.1 |
| Admin OAuth 页「模型限制（可选）」UI | `AdminOauthPage` Aily 区 | §6.3 |
| `next_refresh_at` 状态字段 | `aily.js` publicStatus | 截图 |
| **上游账号 Grok/OpenAI CRUD + test + OAuth start/status** | `server/ailyAccounts.js` + `ailyCompat.js` + `ailyOauth.js`；Admin `/api/admin/aily/accounts*`、`/api/admin/aily/oauth/*`；`AdminOauthPage`「上游账号」面板 | §6.3–6.4、§8.2 |
| **pickProviderRoute + runOpenAICompatibleTurn / Codex** | `server/ailyCompat.js`；命中账号白名单/映射/目录时 `/v1` 不经 CPA | §6.3、relay |
| **`/v1/responses`、`/v1/completions` 内嵌路径** | `ailyUpstream.handleV1`（仅 Aily/compat 命中时；未命中仍走 CPA 代理） | §8.1 |
| **用户「模型广场」合并 Aily** | `GET /api/token/options` 合并 CPA + Aily（对外 id=`aily/{name}`）；`ModelsPage` 文案 | 用户控制台 |

## 未做 / 残留

| 缺口 | 说明 | 文档 |
|------|------|------|
| 远程 VPS 上 OpenAI/Grok 本机 OAuth 回调 | `ailyOauth` 绑 `127.0.0.1` 端口，适合本机；远程请粘贴 OAuth JSON | §6.4 |
| 自动刷新定时器（Aily token / OAuth） | 仅暴露 `next_refresh_at`；未移植 schedule refresh | adapter |
| Aily.Local 折叠摘要与适配器像素级一致 | 有摘要条 + 管理授权骨架 | 截图 |
| 多账号 per-account 与站点级 Aily routing 完全统一 UI | 站点级 Aily routing + 账号级 model_routing 并存 | §6.3 |
| 诊断弹窗 | **已有**，不重做 | — |

## 明确不在范围内

- CPA 内核、`config.yaml`、CPA 管理页语义（auth-files / providers / plugins / logs）
- 站点登录、本地用户/组/积分/签到、Linux.do OAuth、site-usage、星座、社区脉搏等既有能力
- 重新引入独立 `:8088` aily-openai-adapter 依赖
- **部署时 rsync `--delete` 覆盖 `server/data/` 或 `.env`**（硬禁止）

## 路由判定（`/v1`）

命中以下任一则走内嵌桥（Aily 或 compat），否则 **CPA 不变**：

1. 请求 model 以 `aily/` 开头（广场对外 id；去掉前缀后再做 mapping / 上游 resolve）  
2. `AILY_MODEL_ROUTES` 环境模式匹配（可选：让裸名也走 Aily）  
3. 已启用 grok/openai 账号的 whitelist / mapping /（空暴露时）缓存 catalog  

**不再**仅因站点 `aily-model-routing.json` 白名单/映射出现裸名（如 `glm-5.3`）就劫持 CPA。

广场合并：Aily 行的 API id 一律 `aily/{upstream或映射名}`，`provider: 'Aily'`；显示名可友好。

## 验证建议

1. `/admin/overview`、`/admin/users`、`/admin/usage` 未登录仍 401  
2. 裸名 `glm-5.3` → CPA；`aily/glm-5.3` → Aily（需 token）；`AILY_MODEL_ROUTES` 可覆盖裸名  
3. 配置了 mappings 后：广场可见 `aily/...`；Admin「模型限制」仍管理上游裸 id  
4. Admin → OAuth →「上游账号」可增删测 Grok/OpenAI  

修订：2026-09-21（Asia/Shanghai）· aily/ 前缀消歧
