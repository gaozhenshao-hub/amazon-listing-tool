export function buildReportContext(reportType: string, products: any[], reviewStats: any, project: any): string {
  const productSummary = products.slice(0, 20).map(p =>
    `ASIN:${p.asin} | ${p.title} | ¥${p.price} | ${p.rating}★ | BSR:${p.bsr} | 月销:${p.monthlySales}`
  ).join("\n");

  const base = `项目: ${project.name}\n目标市场: ${project.targetMarket}\n关键词: ${project.keywords}\n\n产品数据(${products.length}个):\n${productSummary}\n\n评论统计: 总${reviewStats.total}条, 好评${reviewStats.positive}, 中评${reviewStats.neutral}, 差评${reviewStats.negative}`;

  const typePrompts: Record<string, string> = {
    market_overview: "请分析市场大盘：市场体量、均价、增速、头部集中度、成熟度",
    product_analysis: "请分析产品属性：属性维度分布、销售额占比、热门组合、差异化机会",
    price_analysis: "请分析价格段：价格段分布、最佳区间、价格与评分关系、定价建议",
    brand_analysis: "请分析品牌竞争：TOP品牌、集中度、中国vs非中国卖家、竞争格局",
    competitor_analysis: "请深度分析TOP5竞品：优劣势、定价策略、差异化特点",
    review_analysis: "请分析评论：评分分布、好评关键词、差评痛点、用户需求、改进建议",
    review_analysis_recent_2y: "请分析近两年评论：评分分布、好评关键词、差评痛点、用户需求、改进建议",
    external_analysis: "请分析站外数据：Google趋势、KOL推广、竞品站外策略、众筹趋势",
    ai_summary: "请生成AI总结报告：市场概况、产品机会、竞争格局、推荐定位、风险提示",
  };

  return `${base}\n\n${typePrompts[reportType] || "请生成分析报告"}`;
}

export function getReportTitle(reportType: string): string {
  const titles: Record<string, string> = {
    market_overview: "市场大盘分析",
    product_analysis: "产品属性分析",
    price_analysis: "价格段分析",
    brand_analysis: "品牌竞争分析",
    competitor_analysis: "竞品深度分析",
    review_analysis: "评论分析",
    review_analysis_recent_2y: "近两年评论分析",
    external_analysis: "站外数据分析",
    ai_summary: "AI总结报告",
  };
  return titles[reportType] || "分析报告";
}
