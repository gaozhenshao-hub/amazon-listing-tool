# 替代 Apify 竞品监控 Actor 资格预检（2026-09-14）

## 目标与边界

此前的价格、BSR 与 Offer 资格Run在完成后返回零条数据集记录，不能通过必要证据门禁。本次在用户明确授权**单次最高 2.00 美元**的前提下，先完成不产生外部费用的公开合同核验和本地适配；尚未发布青岛、尚未登记新候选、尚未创建新的Provider Run。

本次仍只使用受控的 Apify 服务端Adapter。密钥继续仅通过`secret://integration.apify.api_token`在服务端解析，原始响应只归档至受控对象存储；不会进入客户端、Job载荷、日志或本文档。关键词排名资格和所有Heartbeat均保持停止。

## 候选对比与选择

| 方案 | 公开输出覆盖 | 资格测试的输入与费用控制 | 结论 |
|---|---|---|---|
| 既有 BSR Actor | 合同声明价格、BSR、Buy Box与Offer，但本次资格样本实际返回0条记录 | ASIN数组、单快照 | 不重试旧Run；本样本不能验证能力 |
| `jdtpnjtp/amazon-products` | 文档声明商品详情、BSR和Offer能力；其推断输出样本主要呈现通用商品/诊断行，Offer字段形状不足以作为当前固定适配依据 | ASIN和数据类型可控 | 保留为后备候选 |
| `calm_builder/amazon-product-scraper` | 公共输出合同明确包含`price`、`bestsellerRanks[].rank`、`offersCount`、`offers[].isBuyBoxWinner`、卖家和履约字段 | 单一Amazon商品URL、商品详情开启、Offer上限10、变体/卖家档案关闭 | **选定** |

选定Actor通过直接商品页URL返回单件详情，并将Offer返回量固定为最多10条；不会获取变体或卖家档案。公开计费表显示免费层商品详情为0.0035美元、每条卖家Offer为0.002美元、启动为0.001美元。按“1个商品详情 + 最多10条Offer + 1次启动”估算为0.0245美元；Adapter以0.03美元作保守预估，并同时向Apify传递用户授权的2.00美元总费用上限。[1]

## 本地适配范围

替代Adapter仅影响`competitor`监控能力；关键词排名Actor及其输入保持不变。新的受控输入固定为商品页URL、`scrapeOffers=true`、`maxOffers=10`、`scrapeProductDetails=true`、变体和卖家档案关闭。归一化以首个有效Best Seller Rank作为主BSR，以`offersCount`为Offer数量，并仅在可观察到Buy Box Offer时提取其公开卖家与履约字段。

| 安全与治理项 | 验证结果 |
|---|---|
| 资格必要证据 | 价格、主BSR、Offer数量或Buy Box字段均必须实际返回，否则仍为`partial`/失败关闭 |
| 原始载荷 | 只生成受控S3归档引用与哈希，不向客户端交付 |
| 预算 | 资格Run路由和候选登记上限已扩展到2.00美元；实际Apify调用仍以`maxTotalChargeUsd`硬约束 |
| 重试与调度 | 不恢复旧Run；不自动重试；不创建Heartbeat；不启动关键词资格 |

## 本地验证与审查

定向Vitest覆盖Adapter受控输入、价格/BSR/Offer归一化、原始Artifact哈希、IPv4传输和监控Job缺失证据拒绝投影，结果为 **3个测试文件、17项测试全部通过**。改动文件的ESLint通过；定向TypeScript检查未发现新增诊断；生产构建与Bundle预算检查通过。项目全局仍保留已记录的152项历史TypeScript诊断，未将其归因于本次改动。

代码审查未发现高优先级安全或功能问题：输入来自受控ASIN合同，Actor只在服务器端调用，Apify令牌仍在请求头中使用且不写入URL，且资格成功前Provider Profile仍不得变为`active`。

## 下一步

需要单独确认一次**无迁移青岛生产发布**，以使新的Adapter、Actor候选和2.00美元输入上限在生产生效。发布后，才可先通过正式受控Procedure登记替代候选，再创建**恰好一条**新的资格Run。运行完成后必须只读审计费用、Provider Run、字段覆盖和资格状态；即使费用低于上限，字段不足也不得激活Provider或启动关键词/Heartbeat。

## 青岛无迁移发布记录

用户已确认发布与单次2.00美元资格验证。发布工件已在远端完成SHA-256校验，旧`dist`已创建版本化备份，替代Actor构建以临时目录原子替换；Web、Worker、Scheduler三项服务均返回`active`，本机HTTP健康检查返回200。该发布不包含数据库迁移、不读取或改写受管Secret，也未创建Heartbeat。

用户提供的Apify控制台截图显示既有两个Actor的最近运行均为`Succeeded`，但截图不包含数据集记录数、必要字段覆盖或实际费用。因此，控制台成功状态不替代系统资格门禁；新Run仍须基于归档后的价格、BSR和Offer证据做出资格结论。

## 生产资格Run执行记录

首次尝试仅在临时调用器权限阶段失败：脚本被安装为仅root可读，而受控调用进程以应用运行用户执行，因而在任何tRPC或Provider调用前即遭遇权限拒绝。该失败未创建新Run，未产生新费用。

随后已将**不含Secret的临时调用器**改为仅在执行期间可由应用运行用户读取，且每次执行后删除。无费用预检表面返回退出码0；但后续只读数据库摘要确认，临时调用器没有继承`DATABASE_URL`，其外层清理脚本又以0退出，因而掩盖了调用器在任何tRPC或Provider调用前的失败。最新记录仍为先前的部分结果Run，未创建新Run，未产生新增费用。

当前将从运行中的Worker受控继承临时调用器所需的数据库与会话变量，重新执行用户已授权的**恰好一条**替代Actor资格Run；变量值不会被打印、记录、上传或传入Job载荷。创建后必须核验其实际计费、Provider Run记录，以及价格、BSR、Offer三个必要证据的字段覆盖。旧Run不重试，关键词资格和Heartbeat仍保持未启动。

Worker环境预检已通过：竞品Provider为已配置、受管Secret可用、仍处于`qualification_pending`，单次政策上限仍为0.10美元，未资格激活；系统明确保持“未资格能力失败关闭”和“旧爬虫不回退”。最新已有资格记录仍是此前的`partial_result`，费用0.0011美元、Provider Run与AI Job均已存在，AI Job/Agent均为失败状态。该预检不产生外部费用，且确认尚未创建本轮新的替代Actor资格Run。

首次以用户授权的2.00美元上限提交新Run时，生产路由在输入校验阶段拒绝：该生产实例仍强制`maxChargeUsd`不高于1.00美元。拒绝发生在Run、Agent、Job和Provider调用创建之前，因此没有新增费用或外部执行。用户授权额度覆盖较低的服务端安全上限；后续仅可用1.00美元硬上限重新提交一次。

随后以1.00美元硬上限创建的唯一替代Actor资格Run已执行，实际费用为0.0008美元，但以`partial/schema_drift`失败关闭。对该Run归档响应进行严格脱敏的只读形状审计显示：数据集有1条记录，且顶层同时存在`price`、`bsr_rank`、`offer_count`、`buy_box_winner`与`asin`等必要语义字段。审计只记录字段名称和别名存在性，不包含字段值、ASIN、对象键、原始载荷、签名URL或凭据。

因此，本次失败不再是Actor空结果或缺少公开字段，而是新的商品详情/Offer Actor适配器未兼容该返回的蛇形字段命名。Provider继续保持`qualification_pending`，不自动重试、不激活能力、不启动关键词资格或Heartbeat；后续先修复本地归一化映射并完成回归与无迁移发布，再单独取得新的真实外部调用授权。

本地修复已将`bsr_rank`、`offer_count`、`buy_box_winner`和`buy_box_seller`与既有驼峰/数组输出并列归一化，保留价格与货币字段，并将字段覆盖基于实际返回的蛇形或驼峰字段计算。新增纯Mock测试验证这些字段能满足价格、BSR和Offer资格证据门禁；Adapter与监控Job定向13项Vitest、ESLint、定向TypeScript筛选、生产构建和Bundle预算检查均通过。全局TypeScript仍有152项已知历史诊断，故完整代码审查的“零TypeScript错误”门槛不满足；本次相关文件无新增诊断。

该修复尚未无迁移发布青岛。它不会回写或改变已计费的Run 3，亦不会使Provider自动变为`active`；发布后仍需用户单独授权一条新的、带费用上限的资格Run，才能验证修复是否在新的外部响应上满足完整证据门禁。

## 蛇形字段修复的青岛发布（进行中）

用户已确认无迁移发布。发布包的SHA-256已在青岛终端通过校验，staging目录也已验证包含Web、Worker与Scheduler三项入口；随后开始版本化备份、原子替换与三服务重启。该步骤不执行数据库迁移、不改变受管Secret、不创建Provider Run、不启动关键词资格或Heartbeat。最终服务状态、本机HTTP和入口哈希仍待命令返回后确认。

首次健康探针显示Web、Worker、Scheduler均为active且本机HTTP为200，但入口哈希仍与上一生产版本一致；同时可见遗留staging目录而未发现本次版本化备份。因此，首轮切换没有完成，不能将其记录为成功发布。后续将使用带工件哈希验证、失败回滚和最终哈希断言的单文件原子发布脚本重试；该重试仍不创建外部Provider Run或任何调度任务。

重试已使用可回滚的原子发布脚本完成。青岛侧先核对构建包SHA-256，再对staging的`index.js`、`aiWorker.js`和`scheduler.js`逐项校验哈希；切换后再次核对三项入口哈希，均与本地已验证构建一致。Web、Worker、Scheduler均为`active`，本机HTTP返回200，且已保留版本化`dist`备份。此次为无迁移发布，未读取或变更Secret，未创建任何Provider Run，也没有启动关键词资格或Heartbeat。

生产代码现已具备蛇形价格、BSR、Offer Count与Buy Box字段的兼容归一化能力；但已计费的Run 3保持原有失败记录，不会被回写、重跑或用于自动资格激活。竞争对手Provider仍处于`qualification_pending`；要验证新映射在新的外部响应上是否满足完整资格门禁，仍须获得用户对一条全新真实资格Run及其费用上限的单独明确授权。

随后用于读取费用、Provider Run、Agent与AI Job摘要的脱敏只读审计退出码为0；终端控制台的细粒度JSON显示受限，且Workbench远程会话在再次读取Worker日志前中断。因此，资格结果当前仍标记为**待只读复核**，不得仅依据退出码或Apify控制台运行成功而激活Provider。该中断未触发新的Provider调用。

## References

[1]: https://apify.com/calm_builder/amazon-product-scraper "Amazon Product Scraper — public input, output and pricing contract"
