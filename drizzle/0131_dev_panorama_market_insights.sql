-- Panorama market structure and major-competitor analysis.
-- Runtime prompt source: emperor_skills.manifest.implementation.systemPrompt (方案 A).

CREATE TABLE IF NOT EXISTS `dev_panorama_market_insights` (
  `id` int NOT NULL AUTO_INCREMENT,
  `workspaceId` int NULL,
  `projectId` int NOT NULL,
  `userId` int NOT NULL,
  `status` enum('pending','queued','running','ready','editing','confirmed','failed','canceled') NOT NULL DEFAULT 'pending',
  `rawResult` json NULL,
  `editedResult` json NULL,
  `runId` varchar(96) NULL,
  `runProgress` int NOT NULL DEFAULT 0,
  `runError` text NULL,
  `version` int NOT NULL DEFAULT 1,
  `confirmedBy` int NULL,
  `confirmedAt` timestamp NULL,
  `runStartedAt` timestamp NULL,
  `runCompletedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_dev_panorama_market_insights_project` (`projectId`),
  KEY `idx_dev_panorama_market_insights_workspace_project` (`workspaceId`,`projectId`,`updatedAt`),
  KEY `idx_dev_panorama_market_insights_run` (`runId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @dev_panorama_market_insights_prompt = '你是亚马逊产品开发市场结构与主要竞争对手分析专家。请仅根据输入中的竞品、父ASIN销量/销售额、属性标签和评论样本输出严格JSON。

数据口径必须遵守：
1. 输入已经按父ASIN去重；不得使用、推算或补造子ASIN销量及子ASIN销售额。
2. 同一父ASIN只允许计入一次，代表行为该父ASIN下报告父体销量最高的子ASIN行。
3. 从输入候选中选择2-3个主要竞争对手，不得编造ASIN。
4. 价格按市场结构划分为4-5个连续、互不重叠的区间；区间命名应包含价格范围。
5. 没有证据的矩阵单元格留空，不得臆造参数、评论或功能。
6. “我们的”列是人工填写区，AI只能给出建议并明确标注为建议。

输出结构：
{
  "priceBands": [
    {"label":"$0-$20 入门段","min":0,"max":20,"reason":"划分依据"}
  ],
  "competitors": [
    {"asin":"输入中的ASIN","name":"产品简称","brand":"品牌","reason":"选择为主要竞品的证据"}
  ],
  "sections": [
    {
      "key":"selling_points",
      "label":"卖点分析",
      "rows":[{"item":"卖点/功能","necessity":"必须要|升级项|可选","cells":{"竞品ASIN":"✓或证据说明"},"ours":"建议（待人工确认）","manualNote":""}]
    },
    {
      "key":"parameters",
      "label":"参数分析",
      "rows":[{"item":"参数类型","necessity":"主流参数或判断","cells":{"竞品ASIN":"参数值"},"ours":"建议（待人工确认）","manualNote":""}]
    },
    {
      "key":"positive_reviews",
      "label":"评论分析-好评",
      "rows":[{"item":"好评主题","necessity":"评论备注","cells":{"竞品ASIN":"✓或证据摘要"},"ours":"可借鉴方向（待人工确认）","manualNote":""}]
    },
    {
      "key":"negative_reviews",
      "label":"评论分析-差评",
      "rows":[{"item":"差评主题","necessity":"差评备注","cells":{"竞品ASIN":"✓或证据摘要"},"ours":"规避方案（待人工确认）","manualNote":""}]
    }
  ],
  "summary":"主要竞品差异、优秀点和开发机会总结"
}

sections必须按 selling_points、parameters、positive_reviews、negative_reviews 顺序输出且恰好4项。只输出JSON，不要Markdown代码块。';

INSERT INTO `emperor_skills`
  (`workspaceId`,`slug`,`name`,`description`,`category`,`owner`,`riskTier`,`status`,`scope`,`version`,`isSystem`,`manifest`,`when_to_use`,`timeout_seconds`,`execution_mode`)
VALUES
  (NULL,'dev.panorama.market_insights','全景市场结构与主要竞争对手分析','为全景分析表生成4-5个价格段，并输出可人工编辑确认的主要竞争对手矩阵。','产品开发','system','L1','Released','global',1,1,
    JSON_OBJECT(
      'implementation', JSON_OBJECT(
        'systemPrompt', @dev_panorama_market_insights_prompt,
        'userPromptTemplate', '{{context}}',
        'supportsJsonMode', TRUE,
        'maxTokens', 6144
      ),
      'contract', JSON_OBJECT(
        'mode', 'json',
        'schemaVersion', '1.0',
        'executionMode', 'ai_job',
        'humanConfirmationRequired', TRUE,
        'salesPolicy', 'deduplicated_parent_asin_only',
        'priceBandCount', '4-5'
      )
    ),
    '全景分析数据准备完成后，用于价格标签和主要竞争对手矩阵生成；结果需人工编辑并确认锁定。',240,'background')
ON DUPLICATE KEY UPDATE
  `name`=VALUES(`name`),
  `description`=VALUES(`description`),
  `category`=VALUES(`category`),
  `status`='Released',
  `version`=`version`+1,
  `manifest`=JSON_MERGE_PATCH(COALESCE(`manifest`,JSON_OBJECT()),VALUES(`manifest`)),
  `when_to_use`=VALUES(`when_to_use`),
  `timeout_seconds`=VALUES(`timeout_seconds`),
  `execution_mode`=VALUES(`execution_mode`);
