import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const campaignAnalysisSource = readFileSync(resolve(process.cwd(), "server/routers/adLocalAnalysis.ts"), "utf8");
const keywordTrackingSource = readFileSync(resolve(process.cwd(), "server/routers/adTracking.ts"), "utf8");
const productOverviewSource = readFileSync(resolve(process.cwd(), "server/routers/dataImport.ts"), "utf8");

describe("广告历史事实下游消费边界", () => {
  it("广告活动看板按工作空间和用户读取活动历史事实并重算汇总指标", () => {
    expect(campaignAnalysisSource).toContain("getAdCampaignsLocal");
    expect(campaignAnalysisSource).toContain("from(adCampaignReports)");
    expect(campaignAnalysisSource).toContain("opsWorkspaceCondition(adCampaignReports, currentOpsWorkspaceId()");
    expect(campaignAnalysisSource).toContain("campMap[key].spend += n(r.spend)");
    expect(campaignAnalysisSource).toContain("acos: safePct(c.spend, c.sales)");
  });

  it("广告关键词看板按工作空间和用户读取关键词周事实，并兼容已确认的广告组合映射", () => {
    expect(keywordTrackingSource).toContain("getProductKeywords");
    expect(keywordTrackingSource).toContain("from(adKeywordWeekly)");
    expect(keywordTrackingSource).toContain("opsWorkspaceCondition(adKeywordWeekly, currentOpsWorkspaceId()");
    expect(keywordTrackingSource).toContain("from(adPortfolioMappings)");
    expect(keywordTrackingSource).toContain("mappedPortfolioCount");
    expect(keywordTrackingSource).toContain("eq(adKeywordWeekly.portfolioName, mapping.portfolioName)");
    expect(keywordTrackingSource).toContain("keywordGroups.get(key)!.weeks.push");
  });

  it("产品总览只使用ASIN日快照中的广告原子指标，不叠加活动或关键词历史表", () => {
    expect(productOverviewSource).toContain("opsAsinDailySnapshots");
    expect(productOverviewSource).not.toContain("adCampaignReports");
    expect(productOverviewSource).not.toContain("adKeywordWeekly");
  });
});
