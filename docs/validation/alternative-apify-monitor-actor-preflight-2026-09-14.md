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

## References

[1]: https://apify.com/calm_builder/amazon-product-scraper "Amazon Product Scraper — public input, output and pricing contract"
