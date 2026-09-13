# A8 Amazon监控迁移与旧爬虫退役验证记录

**日期：** 2026-09-13  
**范围：** 竞品价格/Offer/BSR监控、关键词排名监控、Heartbeat、旧爬虫退役  
**环境：** Manus开发环境；青岛生产未迁移、未发布

## 交付摘要

A8已把竞品价格/排名和关键词排名从旧Node内嵌HTML爬虫、进程内Scheduler迁移为受控Provider、持久化Monitor Run、皇帝Agent/Job审计和平台Heartbeat。用户操作仍保留单次、批量和计划能力，但所有执行均先检查独立能力资格与预算；资格未通过时失败关闭，不会调用旧爬虫或浏览器采集。

| 模块 | 当前实现 | 失败关闭条件 |
|---|---|---|
| 竞品价格/Offer/BSR | 固定候选[Apify Amazon BSR / Buy Box Scraper](https://apify.com/marketplace-scrapers/amazon-bsr-scraper)，独立Profile、Adapter、Run与历史快照投影。 | 未资格、用户上限低于预估、日/月预算不足、价格或BSR未返回、Offer与Buy Box均未返回时不投影。 |
| 关键词排名 | 固定候选[Apify Amazon Rank Tracker](https://apify.com/doesaiknow/amazon-rank-tracker)，关键词、ASIN、邮编、扫描深度均进入请求哈希和证据。 | 未资格、缺关键词、未固定地点、没有自然排名观察证据或Schema漂移时不投影。 |
| Heartbeat | `/api/scheduled/amazon-monitor`仅接受经平台认证的cron身份，按`taskUid`查找业务计划，以日桶幂等键创建持久化Job后立即返回。 | 普通用户403；孤儿taskUid返回2xx skipped；所有者或监控不一致失败关闭；不执行长耗时Provider调用。 |
| 系统设置 | 原代理、User-Agent、重试、即时抓取表单与写接口退役，页面改为Provider治理说明并链接监控中心。 | 兼容Procedure统一抛出退役错误；旧配置不能再改变Amazon采集行为。 |

## Provider资格与费用边界

本阶段只核对候选Actor的公开说明、输入Schema和API可调用边界，没有运行Actor。候选登记本身不产生费用；真实资格Job必须由超级管理员逐次填写公开ASIN、关键词和`maxChargeUsd`并明确确认。用户授权上限单独写入Monitor Run，Worker只能原样复用该额度，不能被Profile更高上限扩大。

资格成功必须同时满足：Provider运行成功、费用不越界、原始响应归档至S3、结构化Schema通过、必需字段证据完整。竞品能力至少需要价格、BSR以及Offer或Buy Box证据；关键词能力至少需要定位后的自然排名观察。任何缺项保持`qualification_pending`并把Run标记为`partial/schema_drift`。

## 数据与架构

0201为纯新增迁移，创建`amazon_monitor_schedules`与`amazon_monitor_runs`两张表。Schedule持久化`heartbeat_task_uid`并建立唯一索引；Run持久化能力、请求哈希、幂等键、预估费用、用户授权费用上限、实际费用、Provider Run ID、原始S3对象Key/哈希、标准化结果和Agent/AI Job引用。开发数据库已执行并核验，青岛生产尚未执行。

旧`scraper.ts`、`crawlerEngine.ts`和`antiBot.ts`在全库业务代码运行时导入归零后删除；图片知识库遗留不可达辅助入口改为显式失败关闭；旧HTML解析测试删除。历史数据库快照、手工上传和已存在监控结果不删除。

## 验证结果

| 验证 | 结果 |
|---|---|
| A8新增监控测试 | 20项通过：能力合同、稳定哈希、Adapter归一化、预算失败关闭、必需字段证据、Monitor Job、S3证据、Agent Tool节点、Heartbeat身份/taskUid/幂等和退役守卫。 |
| A1–A8采集领域完整回归 | 21个文件、68项通过；1项真实凭证联网测试按设计跳过。 |
| 相邻模块回归 | 10个文件、93项通过；1项跳过，覆盖监控中心契约、图片知识库局部刷新、转化评分、主要竞品全图和表达联动。 |
| 定向TypeScript | A8触达文件无新增诊断；全项目仍有既有历史诊断，未归因于A8。 |
| 定向ESLint | 通过，无A8错误或Hook警告。 |
| 生产构建与Bundle预算 | 通过；客户端入口约0.89MB，Bundle预算通过。 |
| 页面验证 | Amazon监控中心和系统设置桌面页面正常；监控中心390×844移动布局无横向溢出。 |

## 未执行与发布门禁

本阶段没有运行真实Provider资格任务、没有创建真实Heartbeat、没有产生新的Provider费用，也没有执行青岛0198–0201迁移或生产发布。下一阶段需分别获得：真实资格ASIN/关键词与单次预算授权、青岛迁移/发布授权、发布后Heartbeat创建授权。资格验证失败时必须保持Provider不可执行；不得恢复任何旧HTML爬虫作为降级方案。
