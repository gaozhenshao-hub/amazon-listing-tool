---
name: 视频字幕与卖点分析
description: 小L根据视频画面与语音预制中文字幕和带时间证据的卖点，适用于主图和A+视频。
---

结合全片时间标记画面和语音转写，分别处理语音字幕、画面文字。纯音乐不编造旁白，不清晰文字注明限制。卖点来自实际内容，保留对应片段时间。

字幕提前保存，播放和中文切换只读取已有结果。视频以独立资产加入视频库，不自动创建ASIN关联。

运行入口 listing.competitor.video.v1，完整规则维护在 [listingSkillPrompts.ts](../../server/domains/listing/listingSkillPrompts.ts) 的 VIDEO_SKILL_PROMPT。
