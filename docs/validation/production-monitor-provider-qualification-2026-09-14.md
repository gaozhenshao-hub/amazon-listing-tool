# 青岛 Amazon 监控 Provider 资格执行记录（2026-09-14）

## 已授权范围

用户已授权按固定顺序执行两项生产资格验证：第一项为美国站公开 ASIN 的价格、Offer 与 BSR 资格验证，第二项为关键词排名资格验证（美国邮编 `10001`、前 `3` 页）。每项的费用上限均为 **0.10 美元**，任一任务出现预算、权限、迁移、健康或字段证据门禁失败时，后续任务必须停止。用户随后指定 `gaozhen shao` 为本次资格任务的唯一审计发起人。

## 已完成的生产发布核验

青岛独立站已完成受控发布与只读核验。迁移 `0198` 至 `0201` 的表及四个系统 Skill 已存在；已发布的 `index.js`、`aiWorker.js` 和 `scheduler.js` 已完成哈希核验；Web、Worker、Scheduler 三项服务均处于 active 状态，且本机 HTTP 健康检查通过。

## 当前资格任务状态

| 项目 | 状态 | 说明 |
|---|---|---|
| 价格 / Offer / BSR 资格验证 | **失败关闭，未计费** | 已恢复同一条既有Monitor Run并建立Agent/AI Job；Actor请求前失败，未记录Provider Run，`chargedUsd=null`。 |
| 关键词排名资格验证 | **尚未排队** | 必须在首个任务取得终态后再启动。 |
| 费用 | **0.00 美元（尚未发生）** | 尚未提交任何外部 Provider Run。 |
| 审计发起人 | 已指定 | 仅精确匹配活跃超级管理员、默认工作空间后继续。 |

## 资格预检结果

已通过用户指定的 `gaozhen shao` 账号完成无费用身份与默认工作空间匹配，并经已发布的本机 `crawler.getProviderReadiness` Procedure 读取了价格/Offer/BSR Provider 就绪状态。该 Procedure 返回 `configured=false`、`status=qualification_pending`、`perRunMaxUsd=0.10`，且 **`secretConfigured=false`**。

因此，资格验证在外部调用前被正确失败关闭：生产服务环境尚未注入 `APIFY_API_TOKEN`，不得注册候选后发起 Provider Run、不得创建 Heartbeat，也不得将 Manus 侧受管凭据复制、打印或写入青岛服务器。到此为止，外部费用仍为 **0.00 美元**。

## 门禁与临时执行器

生产运行环境未配置 `OWNER_OPEN_ID` 或 `OWNER_NAME`，且只读聚合审计显示有两名活跃超级管理员、共享一个默认工作空间。因此临时资格调用器已调整为优先使用用户明确指定的 `gaozhen shao` 名称，且仅在该名称精确匹配**唯一活跃超级管理员**和**活动默认工作空间**时，以五分钟短期会话调用已发布的 `crawler.qualifyProvider` Procedure。调用器不输出身份标识、会话令牌或任何凭据。

下一步需由用户通过受管密钥渠道将有效的 `APIFY_API_TOKEN` 注入青岛服务运行环境，并重启服务后再重做无费用预检。仅当预检返回 `secretConfigured=true` 时，才允许排队首个 `competitor` 资格任务。不得直接写入 Run、绕过 tRPC Procedure、绕过预算门禁或使用旧 HTML 爬虫。

## 受控API连接后台保存后的补充记录

受控API连接管理后台及其IPv4优先轻量校验补丁已先后无迁移发布青岛，并完成构建哈希、Web/Worker/Scheduler active状态和本机HTTP健康核验。用户在生产后台完成Apify保存与轻量校验后，以指定审计发起人`gaozhen shao`执行的无费用预检返回：`secretConfigured=true`、`status=qualification_pending`、`perRunMaxUsd=0.10`、`qualified=false`。该预检未运行Actor、未创建Provider Run、未发生费用。

随后已在既有“1+2+3”授权与首项0.10美元硬上限内，向正式Agent/Job/Run链提交价格/Offer/BSR资格任务的排队命令。Workbench在该命令提交后断开，未返回任务创建标识或任务终态。因此不得重试该首项任务，也不得启动关键词资格任务；后续只能先通过生产任务中心或对`amazon_monitor_runs`进行只读状态核验，确认首项资格任务是否存在、其状态及费用字段后再决定下一步。

## 首项既有Run恢复与零计费失败

排队链修复补丁发布并经服务健康核验后，系统只恢复了原有首项资格Run；恢复接口要求该记录属于指定审计发起人、当前工作空间、无Provider Run、无Agent/AI Job、无S3原始证据且未计费。恢复没有创建第二条Run，也没有启动关键词资格任务。

恢复后的只读审计表明：同一Monitor Run已创建一个Agent Run和一个AI Job，但在任何Provider Run创建之前失败；`providerRunRecorded=0`、`chargedUsd=null`，保留原`maxChargeUsd=0.10`。共享任务记录的脱敏错误为`monitor provider failed: unknown`。因此当前首项不构成成功资格，也不构成已收费外部调用；关键词资格继续停止。

本地根因隔离显示监控Adapter仍依赖默认`fetch`传输，而生产轻量校验已验证必须强制IPv4，避免IPv6黑洞。现已完成本地修复：Actor与数据集请求改为受控IPv4 HTTPS、令牌仅位于Authorization请求头、URL不含令牌，网络和Apify HTTP失败映射到固定脱敏分类。IPv4传输、账户轻量校验、固定失败分类及资格排队定向回归均采用Mock运行，未触发真实Provider；定向TypeScript、ESLint、生产构建与Bundle预算通过。

该修复已以无迁移方式发布青岛。远端发布脚本及构建包SHA-256均已验证，`dist`完成版本化备份和原子切换；`index.js`、`aiWorker.js`和`scheduler.js`入口哈希均与本地构建一致，Web/Worker/Scheduler均为active，本机HTTP返回200。发布过程未读取或改写密钥、未触碰数据库、未创建Heartbeat、未恢复或重试资格Run、未启动关键词任务或新的外部Provider调用。

下一步只能对首项失败Run执行只读可恢复性审计。除非用户在既有单项0.10美元授权范围内再次明确批准恢复同一条Run，否则不得新建资格Run、自动重试、启动关键词资格任务或执行任何新的外部Provider调用。

## IPv4补丁发布后的只读恢复门禁审计

IPv4监控传输补丁已完成青岛无迁移发布并通过入口哈希、三服务和本机HTTP核验。随后执行的只读审计显示，首项原资格Run当前为`failed`，`providerRunRecorded=0`、`chargedUsd=null`、`maxChargeUsd=0.10`，但已存在失败的Agent Run和AI Job。因此它不再满足“完全无Agent/AI Job执行痕迹”的安全恢复条件，系统未尝试恢复、重试或创建替代Run；关键词资格仍未启动。

如需继续价格/Offer/BSR资格验证，必须取得用户对**新建一条资格Run**的再次明确批准，并在0.10美元单项硬上限内执行。只有该新Run通过Provider与字段证据门禁后，才可再单独讨论关键词资格任务。

## 新建资格Run #2 的部分结果与只读形状审计

在用户再次明确批准的单项 **0.10 美元**硬上限内，系统先完成无费用预检与预算门禁，随后通过正式的 Agent / Job / Run 链创建了一条新的价格、Offer 与 BSR 资格任务。该任务记录了 Provider Run，并产生 **0.0011 美元**费用，低于上限；但终态为`partial`，固定失败类别为`partial_result`。已完成的只读覆盖度审计确认价格、BSR 和 Offer 三类必要证据均未返回，因此资格门禁未激活Provider Profile，关键词资格任务仍未排队。

为区分“字段别名不匹配”与“Provider未产生记录”，已对本次Run的S3原始归档执行严格脱敏的只读形状审计。审计仅返回记录数量、字段名和预定义别名存在性，不输出原始载荷、字段值、对象键、签名URL、ASIN或密钥。结果为 **0 条记录**，无任何顶层字段或候选别名可供归一化。因此，本次失败不是现有snake_case字段映射漏项；当前Adapter期望的`price`、`bsr_rank`、`buy_box_winner`与`offer_count`已与该Actor公开输出合同一致。[1]

该Actor的公开说明指出，无法在所选站点目录中找到的ASIN会被静默跳过；本次空数据集与该类行为相容，但在不新增外部调用的前提下，不能把它断言为唯一原因。[1] 当前结论是：**Provider在本资格样本中没有产出可验证的记录**。系统继续保持`qualification_pending`和失败关闭状态；不新增字段别名修复、不激活监控能力、不创建Heartbeat、不恢复或重试本Run，也不启动关键词资格任务。

如需继续，只能先形成替代Actor或样本的最小资格方案，并由用户对一条新的外部Provider Run单独明确授权，说明目标、单项费用上限及关键词仍保持停止。

## References

[1]: https://apify.com/marketplace-scrapers/amazon-bsr-scraper "Amazon BSR Scraper — public input and output contract"
