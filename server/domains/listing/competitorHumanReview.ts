import { z } from "zod";

export type ComparisonSellingPointRow = {
  id: string;
  theme: string;
  competitorPoints: Array<{
    analysisId: number;
    asin: string;
    bulletIndex: number;
    text: string;
  }>;
  aiRecommendation: string;
  humanNote: string;
  selected: boolean;
};

export const comparisonSellingPointRowsSchema = z.array(z.object({
  id: z.string().max(120),
  theme: z.string().min(1).max(200),
  competitorPoints: z.array(z.object({
    analysisId: z.number(),
    asin: z.string().max(20),
    bulletIndex: z.number().int().min(0).max(20),
    text: z.string().max(5000),
  })).max(8),
  aiRecommendation: z.string().max(5000),
  humanNote: z.string().max(5000),
  selected: z.boolean(),
})).max(30);

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => typeof item === "string" ? item : JSON.stringify(item)).filter(Boolean);
}

function markdownList(items: string[], emptyText: string): string {
  return items.length > 0 ? items.map(item => `- ${item}`).join("\n") : `- ${emptyText}`;
}

export function formatCompetitorAnalysisSummary(analysisData: any): string {
  const summary = analysisData?.summary;
  if (typeof summary === "string" && summary.trim()) return summary.trim();
  const overview = summary?.overview
    || analysisData?.competitivePositioning
    || "AI 尚未提供定位概览，请结合标题、价格、评分与评论数据补充。";
  const coreSellingPoints = asStringList(summary?.coreSellingPoints).length > 0
    ? asStringList(summary.coreSellingPoints)
    : asStringList(analysisData?.bulletPointsAnalysis).map((item: string) => {
      try {
        const parsed = JSON.parse(item);
        return parsed.sellingPoint || parsed.point || item;
      } catch {
        return item;
      }
    });
  const strengths = asStringList(summary?.strengths).length > 0
    ? asStringList(summary.strengths)
    : asStringList(analysisData?.advantages);
  const weaknesses = asStringList(summary?.weaknesses).length > 0
    ? asStringList(summary.weaknesses)
    : asStringList(analysisData?.weaknesses);
  const listingLessons = asStringList(summary?.listingLessons);

  return [
    "## 定位概览",
    String(overview),
    "",
    "## 核心卖点",
    markdownList(coreSellingPoints, "暂无明确核心卖点"),
    "",
    "## 值得参考的优秀点",
    markdownList(strengths, "暂无明确优势"),
    "",
    "## 可超越的弱点",
    markdownList(weaknesses, "暂无明确弱点"),
    "",
    "## Listing 借鉴建议",
    markdownList(listingLessons, "请根据已确认产品属性补充差异化表达"),
  ].join("\n");
}

export function comparisonSelectionKey(analysisIds: number[]): string {
  return [...new Set(analysisIds)].sort((a, b) => a - b).join("-");
}

export function formatComparisonSummary(data: any): string {
  if (typeof data?.summary === "string" && data.summary.trim()) return data.summary.trim();
  const keywordOpportunities = data?.keywordOpportunities || {};
  return [
    "## 市场概览",
    String(data?.marketOverview || "暂无市场概览"),
    "",
    "## 关键差异分析",
    markdownList(asStringList(data?.keyDifferences), "暂无关键差异"),
    "",
    "## 关键词机会",
    `- 共同核心词：${asStringList(keywordOpportunities.shared).join("、") || "暂无"}`,
    `- 差异化关键词：${asStringList(keywordOpportunities.differentiated).join("、") || "暂无"}`,
    `- 未覆盖关键词：${asStringList(keywordOpportunities.uncovered).join("、") || "暂无"}`,
    "",
    "## 用户痛点与机会",
    markdownList(asStringList(data?.customerOpportunities), "暂无用户机会"),
    "",
    "## 卖点策略建议",
    markdownList(asStringList(data?.sellingPointStrategy), "暂无卖点策略"),
    "",
    "## Listing 优化行动清单",
    markdownList(asStringList(data?.actionItems), "暂无行动项"),
  ].join("\n");
}

export function normalizeSellingPointRows(data: any, selectedAnalyses: any[]): ComparisonSellingPointRow[] {
  const analysisByAsin = new Map(selectedAnalyses.map(analysis => [String(analysis.asin).toUpperCase(), analysis]));
  const rawRows = Array.isArray(data?.sellingPointRows) ? data.sellingPointRows : [];
  const normalized = rawRows.map((row: any, rowIndex: number) => {
    const points = (Array.isArray(row?.competitorPoints) ? row.competitorPoints : [])
      .map((point: any) => {
        const analysis = analysisByAsin.get(String(point?.asin || "").toUpperCase());
        if (!analysis || !String(point?.text || "").trim()) return null;
        let storedBullets: string[] = [];
        try { storedBullets = JSON.parse(analysis.bulletPoints || "[]"); } catch { storedBullets = []; }
        const claimedText = String(point.text).trim();
        const exactIndex = storedBullets.findIndex(bullet => bullet.trim() === claimedText);
        const requestedIndex = Math.max(0, Number(point?.bulletIndex) || 0);
        const bulletIndex = exactIndex >= 0 ? exactIndex : requestedIndex;
        if (!storedBullets[bulletIndex]) return null;
        return {
          analysisId: analysis.id,
          asin: analysis.asin,
          bulletIndex,
          text: storedBullets[bulletIndex],
        };
      })
      .filter(Boolean);
    if (points.length === 0) return null;
    return {
      id: `selling-point-${rowIndex + 1}`,
      theme: String(row?.theme || `卖点主题 ${rowIndex + 1}`),
      competitorPoints: points,
      aiRecommendation: String(row?.aiRecommendation || ""),
      humanNote: "",
      selected: false,
    } as ComparisonSellingPointRow;
  }).filter(Boolean) as ComparisonSellingPointRow[];

  if (normalized.length > 0) return normalized;

  const maxBullets = Math.max(0, ...selectedAnalyses.map(analysis => {
    try { return JSON.parse(analysis.bulletPoints || "[]").length; } catch { return 0; }
  }));
  return Array.from({ length: maxBullets }, (_, rowIndex) => ({
    id: `selling-point-${rowIndex + 1}`,
    theme: `卖点主题 ${rowIndex + 1}`,
    competitorPoints: selectedAnalyses.flatMap(analysis => {
      let bullets: string[] = [];
      try { bullets = JSON.parse(analysis.bulletPoints || "[]"); } catch { bullets = []; }
      return bullets[rowIndex] ? [{
        analysisId: analysis.id,
        asin: analysis.asin,
        bulletIndex: rowIndex,
        text: bullets[rowIndex],
      }] : [];
    }),
    aiRecommendation: "AI 未完成语义归并，请人工调整主题并确认。",
    humanNote: "",
    selected: false,
  }));
}

export function serializeComparisonReport(report: any) {
  if (!report) return null;
  return {
    ...report,
    analysisIds: JSON.parse(report.analysisIds || "[]"),
    analyzedAsins: JSON.parse(report.analyzedAsins || "[]"),
    sellingPointRows: JSON.parse(report.sellingPointRows || "[]"),
  };
}
