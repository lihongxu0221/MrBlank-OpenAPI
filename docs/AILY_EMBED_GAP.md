# Aily 内嵌移植差距（相对 aily-openai-adapter / 设计文档）

> 约束：只在 MrBlank BFF/站点侧**增量**移植；不删除既有站点功能；**不修改 CPA 内核**（进程 / config.yaml / CPA 管理语义）。未命中 Aily 路由的 `/v1` 仍走 CPA。

## 已上线（本轮）

| 能力 | 位置 | 对应设计文档 |
|------|------|----------------|
| 内嵌 Aily 桥（chat + models catalog） | `server/ailyUpstream.js`，由 `AILY_MODEL_ROUTES` 选择性命中 | §6.2 部分、§8.1 chat/models |
| Aily 凭证管理（邮箱码 / 粘贴 token / 刷新 / 清除 / 连通测试） | `server/aily.js` + `/api/admin/aily/*` + `AdminOauthPage` | §7.3、§6.7 Aily 登录 |
| **模型白名单 / 映射 / 同步** 持久化 | `server/ailyModelRouting.js` → `server/data/aily-model-routing.json` | §6.3 `model_routing` |
| Admin GET/PUT `/api/admin/aily/models` | `server/index.js` | §8.2 模型 API |
| 运行时：`/v1/models` 与 chat 解析应用 whitelist+mappings | `ailyUpstream`（空=不限制） | §6.3、§7.1 |
| Admin OAuth 页「模型限制（可选）」UI | `AdminOauthPage` Aily 区（与 CPA 只读区分离） | 截图 + §6.3 |
| `next_refresh_at` 状态字段 | `aily.js` publicStatus | 截图「下次刷新」 |

## 未做 / 残留（按优先级）

| 缺口 | 说明 | 文档 |
|------|------|------|
| **上游账号 Grok/OpenAI CRUD + OAuth + pickProviderRoute** | 尚未移植；截图「上游账号」面板未做。计划独立 store（如 `aily-upstream-accounts.json`）+ AdminOauth 新区块，不并入 CPA providers。 | §6.3–6.4、§8.2 accounts |
| `/v1/responses`、`/v1/completions` 内嵌 | 仍对内嵌路径返回 501；CPA 路径不受影响 | §8.1 |
| Aily.Local 折叠摘要与适配器像素级一致 | 有摘要条 + 管理授权折叠骨架；文案/分段可再贴齐截图 | 截图 |
| 自动刷新定时器 | 仅暴露 `next_refresh_at`；未移植适配器后台 schedule refresh | adapter service |
| 多账号 per-account model_routing | 现仅站点级一份 routing（嵌入式 Aily） | §6.3 |
| 诊断弹窗 | **已有**，不重做 | — |

## 明确不在范围内（保持现状）

- CPA 内核、`config.yaml`、CPA 管理页语义（auth-files / providers / plugins / logs）
- 站点登录、本地用户/组/积分/签到、Linux.do OAuth、site-usage、星座、社区脉搏等既有能力
- 重新引入独立 `:8088` aily-openai-adapter 依赖

## 验证建议

1. `/admin/overview`、`/admin/users`、`/admin/usage` 仍可用  
2. 未配置 `AILY_MODEL_ROUTES` 时 `/v1` 仍只走 CPA  
3. Admin → OAuth → Aily：同步白名单 → 保存 → 命中路由的 `/v1/models` 仅见白名单/映射名  

修订：2026-09-21（Asia/Shanghai）
