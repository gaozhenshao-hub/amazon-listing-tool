---
name: 聚合分析
description: 小L复用已有竞品结论，整理功能与用户获益、归并评论并建立可编辑连线及来源；不重新分析原始评论。
---

左侧按基础质量、设计加分、细节把控、必要性描述、差异化功能、待改进功能归类；右侧按主要卖点、次要卖点、必要卖点、差异化卖点、待实现卖点归类。

保留每个结论的真实来源，区分直接证据、推导获益、用户补充。差异化必须有本品依据和比较范围；资料缺失不能当成产品缺少功能。功能与获益可多对多关联。已有人工布局、名称、分类、标注和连线不得被更新汇总覆盖。

运行入口 listing.aggregation.graph.v1，完整输出与证据规则维护在 [listingSkillPrompts.ts](../../server/domains/listing/listingSkillPrompts.ts) 的 AGGREGATION_SKILL_PROMPT。
