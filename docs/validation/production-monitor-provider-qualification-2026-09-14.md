# 青岛 Amazon 监控 Provider 资格执行记录（2026-09-14）

## 已授权范围

用户已授权按固定顺序执行两项生产资格验证：第一项为美国站公开 ASIN 的价格、Offer 与 BSR 资格验证，第二项为关键词排名资格验证（美国邮编 `10001`、前 `3` 页）。每项的费用上限均为 **0.10 美元**，任一任务出现预算、权限、迁移、健康或字段证据门禁失败时，后续任务必须停止。用户随后指定 `gaozhen shao` 为本次资格任务的唯一审计发起人。

## 已完成的生产发布核验

青岛独立站已完成受控发布与只读核验。迁移 `0198` 至 `0201` 的表及四个系统 Skill 已存在；已发布的 `index.js`、`aiWorker.js` 和 `scheduler.js` 已完成哈希核验；Web、Worker、Scheduler 三项服务均处于 active 状态，且本机 HTTP 健康检查通过。

## 当前资格任务状态

| 项目 | 状态 | 说明 |
|---|---|---|
| 价格 / Offer / BSR 资格验证 | **尚未排队** | 尚未创建 Monitor Run，未调用外部 Provider。 |
| 关键词排名资格验证 | **尚未排队** | 必须在首个任务取得终态后再启动。 |
| 费用 | **0.00 美元（尚未发生）** | 尚未提交任何外部 Provider Run。 |
| 审计发起人 | 已指定 | 仅精确匹配活跃超级管理员、默认工作空间后继续。 |

## 资格预检结果

已通过用户指定的 `gaozhen shao` 账号完成无费用身份与默认工作空间匹配，并经已发布的本机 `crawler.getProviderReadiness` Procedure 读取了价格/Offer/BSR Provider 就绪状态。该 Procedure 返回 `configured=false`、`status=qualification_pending`、`perRunMaxUsd=0.10`，且 **`secretConfigured=false`**。

因此，资格验证在外部调用前被正确失败关闭：生产服务环境尚未注入 `APIFY_API_TOKEN`，不得注册候选后发起 Provider Run、不得创建 Heartbeat，也不得将 Manus 侧受管凭据复制、打印或写入青岛服务器。到此为止，外部费用仍为 **0.00 美元**。

## 门禁与临时执行器

生产运行环境未配置 `OWNER_OPEN_ID` 或 `OWNER_NAME`，且只读聚合审计显示有两名活跃超级管理员、共享一个默认工作空间。因此临时资格调用器已调整为优先使用用户明确指定的 `gaozhen shao` 名称，且仅在该名称精确匹配**唯一活跃超级管理员**和**活动默认工作空间**时，以五分钟短期会话调用已发布的 `crawler.qualifyProvider` Procedure。调用器不输出身份标识、会话令牌或任何凭据。

下一步需由用户通过受管密钥渠道将有效的 `APIFY_API_TOKEN` 注入青岛服务运行环境，并重启服务后再重做无费用预检。仅当预检返回 `secretConfigured=true` 时，才允许排队首个 `competitor` 资格任务。不得直接写入 Run、绕过 tRPC Procedure、绕过预算门禁或使用旧 HTML 爬虫。
