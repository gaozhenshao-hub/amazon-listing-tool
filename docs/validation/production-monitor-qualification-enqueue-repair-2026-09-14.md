# 生产资格任务排队修复验证记录

**日期：** 2026-09-14  
**范围：** Amazon价格 / Offer / BSR Provider资格任务的排队链，不包含新的Provider调用、关键词资格任务或Heartbeat创建。

## 生产只读审计结论

首项资格任务已有一条持久化的Monitor Run。该记录保留原始0.10美元费用上限，但没有Provider Run、Agent Run、AI Job或原始S3证据，已计费用为空。因而它不是已执行或部分执行的外部调用，也不能通过新建第二条Run来“重试”。

| 审计字段 | 结果 | 安全含义 |
|---|---|---|
| Monitor Run | 1条，状态`queued` | 可识别的单一授权记录 |
| Provider Run / 原始证据 | 均不存在 | 未触发Actor或采集费用 |
| Agent Run / AI Job | 均不存在 | 失败发生于Provider执行之前 |
| 原始费用上限 | 0.10美元 | 恢复必须原样复用，不得扩大 |

## 根因与修复

`monitorAgentDag()`曾声明`operation_node`，但皇帝Agent运行时只接受`input_node`、`skill_node`、`llm_node`、`condition_node`、`loop_node`、`human_review`、`http_node`、`code_node`、`mcp_node`、`knowledge_node`和`output_node`。因此DAG校验在创建Agent Run和AI Job前停止，留下无执行痕迹的排队Run。

修复将监控Provider表示为受控`http_node`并附加`internal.amazon.monitor.provider` Tool标识。任务登记失败将补偿更新Monitor Run为`failed`和`job_enqueue_failed`；恢复服务只接受无任何Provider、Agent、AI Job、S3证据和计费痕迹的原始资格记录。恢复时复用同一Run和费用上限，不会创建第二个Provider Run。

## 本地验证

| 检查 | 结果 |
|---|---|
| 监控Agent与Job定向回归 | 10项通过 |
| 统一采集领域回归 | 72项通过，1项凭证联网测试按设计跳过 |
| 修复范围TypeScript筛选 | 无新增诊断 |
| 修复范围ESLint | 通过 |
| 生产构建与Bundle预算 | 通过 |

## 未执行边界

该修复尚未发布青岛。未恢复生产Run，未启动Apify Actor，未产生新的费用，未开始关键词排名资格任务，也未创建Heartbeat计划。生产恢复须在补丁验签、备份、原子替换和健康核验后执行，并先以只读查询确认原Run仍满足全部恢复门禁。
