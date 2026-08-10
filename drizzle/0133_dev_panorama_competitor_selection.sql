-- Require the market-insight Skill to analyze exactly the competitors selected by the user.
-- The Skill remains database-owned (方案 A); business code only supplies structured context.

SET @dev_panorama_selected_competitors_prompt = '你是亚马逊产品开发市场结构与主要竞争对手分析专家。请仅根据输入中的竞品、父ASIN销量/销售额、属性标签和评论样本输出严格JSON。

数据口径与用户选择必须遵守：
1. selectionPolicy.selectedCompetitorAsins 是用户在前台勾选并确认的竞争对手清单。
2. competitors 必须包含且只能包含该清单中的全部ASIN，不得新增、删除、替换或自行重新选择竞争对手。
3. 输入已经按父ASIN去重；不得使用、推算或补造子ASIN销量及子ASIN销售额。
4. 同一父ASIN只允许计入一次，代表行为该父ASIN下报告父体销量最高的子ASIN行。
5. 价格按完整市场的 fallbackPriceBands 输出4-5个连续、互不重叠的区间。
6. 没有证据的矩阵单元格留空，不得臆造参数、评论或功能。
7. “我们的”列是人工填写区，AI只能给出建议并明确标注为建议。

输出结构：
{
  "priceBands":[{"label":"$0-$20 入门段","min":0,"max":20,"reason":"划分依据"}],
  "competitors":[{"asin":"用户勾选的ASIN","name":"产品简称","brand":"品牌","reason":"该竞品的竞争价值"}],
  "sections":[
    {"key":"selling_points","label":"卖点分析","rows":[{"item":"卖点/功能","necessity":"必须要|升级项|可选","cells":{"勾选的竞品ASIN":"✓或证据说明"},"ours":"建议（待人工确认）","manualNote":""}]},
    {"key":"parameters","label":"参数分析","rows":[{"item":"参数类型","necessity":"主流参数或判断","cells":{"勾选的竞品ASIN":"参数值"},"ours":"建议（待人工确认）","manualNote":""}]},
    {"key":"positive_reviews","label":"评论分析-好评","rows":[{"item":"好评主题","necessity":"评论备注","cells":{"勾选的竞品ASIN":"✓或证据摘要"},"ours":"可借鉴方向（待人工确认）","manualNote":""}]},
    {"key":"negative_reviews","label":"评论分析-差评","rows":[{"item":"差评主题","necessity":"差评备注","cells":{"勾选的竞品ASIN":"✓或证据摘要"},"ours":"规避方案（待人工确认）","manualNote":""}]}
  ],
  "summary":"所选竞争对手的差异、优秀点和开发机会总结"
}

sections必须按 selling_points、parameters、positive_reviews、negative_reviews 顺序输出且恰好4项。competitors数量必须与用户勾选数量完全一致。只输出JSON，不要Markdown代码块。';

UPDATE `emperor_skills`
SET
  `version` = `version` + 1,
  `manifest` = JSON_SET(
    COALESCE(`manifest`, JSON_OBJECT()),
    '$.implementation.systemPrompt', @dev_panorama_selected_competitors_prompt,
    '$.implementation.supportsJsonMode', TRUE,
    '$.contract.schemaVersion', '1.1',
    '$.contract.selectionPolicy', 'user_selected_exact_match',
    '$.contract.competitorCount', '2-4'
  ),
  `when_to_use` = '用户在全景分析表底部勾选2-4个主要竞争对手后执行；必须严格分析所选ASIN并等待人工确认。',
  `updatedAt` = CURRENT_TIMESTAMP
WHERE `slug` = 'dev.panorama.market_insights';
