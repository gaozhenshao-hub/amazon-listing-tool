---
name: 竞品分析
description: 小L分析亚马逊竞品内容和评论，提取具体、可核对的结论并保留证据；不负责跨竞品聚合。
---

按内容、评论职责调用已发布的业务技能。评论标题直接表达评价方向与具体表现，小字解释主要原因；高频拉链故障独立列项。保持星级分类和评论证据，比例由系统去重计算。

运行规则维护在 [listingSkillPrompts.ts](../../server/domains/listing/listingSkillPrompts.ts) 的 REVIEW_SKILL_PROMPT，实际入口为 listing.competitor.reviews.v2；内容分析沿用 listing.competitor.content.v2。不把竞品属性当成本品事实。调整只作用于当前结果，用户确认用于改进时创建独立草稿。
