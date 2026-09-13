# A7 统一采集消费者迁移验证记录

**日期：** 2026-09-13  
**范围：** Listing知识库、产品知识库、项目竞品分析、转化率采集  
**环境：** Manus开发环境；青岛生产未发布

## 交付摘要

A7已把四类Amazon商品详情消费者从旧Node内嵌爬虫迁移到统一Acquisition Job、人工审核Snapshot、Consumer Link与确认后投影链。业务入口只创建持久化采集任务；只有Confirmed Snapshot可写入知识库、项目竞品或转化评分上下文。Provider失败不会自动调用旧`scraper.ts`或`crawlerEngine.ts`。

| 消费者 | 迁移结果 | 人工决策边界 |
|---|---|---|
| Listing知识库 | 单ASIN、批量、美国站链接均创建`kb_listing` Acquisition Job；确认后投影文案字段并排队结构化分析。 | AI结果为`pending_review`，用户编辑/确认后才入库；失败占位可重试。 |
| 产品知识库 | 单ASIN、批量、美国站链接均创建`kb_product` Job；确认后投影基础信息、卖点与Confirmed图库引用。 | 图片仅保存稳定S3引用，交付时生成临时URL；AI结果待人工确认。 |
| 项目竞品分析 | 自动ASIN与批量入口创建`project_competitor` Job；缓存命中也建立Consumer Link并排队分析。 | 继续使用现有摘要编辑、确认、解锁和Artifact版本链；手工/文件路径保留。 |
| 转化率采集 | 评分前为全部ASIN创建或复用`conversion_collector` Job；缺少Confirmed Snapshot时停止评分并返回审核任务。 | 全部确认后才合并Snapshot与领星广告事实；排名、Coupon、Deal标记为A8未覆盖。 |

## 数据与AI治理

知识库业务表不再保存新的Provider原始大JSON，只保存Confirmed Snapshot ID、内容哈希、确认版本和必要投影字段。项目竞品的`rawData`仅包含AI结构化分析与Snapshot证据引用。所有新AI分析均运行在服务端持久化Job中，绑定独立单节点Agent与皇帝Skill；Job完成后进入人工等待状态。确认后排队失败不会回滚Snapshot确认，页面会提示从AI任务中心恢复。

| 门禁 | 结果 |
|---|---|
| workspace隔离 | Confirmed Snapshot、目标知识库行和项目均按workspace校验。 |
| ASIN一致性 | Consumer Ref、目标记录和Confirmed Snapshot的ASIN不一致时失败关闭。 |
| 资产安全 | 只投影Confirmed Asset且要求稳定storage引用；签名URL不写数据库。 |
| 缺字段语义 | 只覆盖`confirmed`字段；未返回字段不清空历史内容。A+/品牌故事无图时标记覆盖未知。 |
| 旧爬虫回退 | 四类A7消费者源码守卫确认不存在`scrapeAmazonProduct()`或旧scraper导入。 |

## 验证结果

| 验证 | 结果 |
|---|---|
| A7新增测试 | 18项通过：Consumer Ref、能力合同、workspace/ASIN门禁、Snapshot引用、Agent/Skill Job绑定、非阻断排队与源码迁移守卫。 |
| A7及相邻回归 | 11个文件，71项通过，1项显式凭证测试跳过；覆盖采集合同、图片知识库投影、审核与转化评分。 |
| 定向TypeScript | A7新增及触达文件无诊断；项目仍保留既有全局历史诊断，未归因于A7。 |
| 定向ESLint | 通过，无A7错误或Hook警告。 |
| 生产构建与Bundle预算 | 通过；客户端入口约0.89MB，Bundle预算通过。 |
| 页面验证 | Listing知识库、产品知识库和竞品分析开发页面正常加载并显示受控采集文案；转化评分位于产品详情子页，独立错误路径截图不作为页面故障。 |

## 未执行与后续边界

本阶段没有调用真实Amazon Provider、没有运行真实LLM分析、没有产生新的外部费用，也没有执行青岛迁移或发布。A8仍需迁移竞品价格/销售排名、关键词排名监控和系统设置中的旧代理/UA/重试入口；只有全库业务代码对旧执行器运行时调用为0后，才能删除或封锁`scraper.ts`、`crawlerEngine.ts`和旧调度入口。
