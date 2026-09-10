import { describe, expect, it } from "vitest";
import { isCompleteNaturalWeek, summarizeParentAsinAdMcpWeek } from "./domains/ops/productOverview/adMcpWeeklySummary";

describe("父ASIN广告MCP自然周聚合", () => {
  it("只以广告商品事实聚合KPI，并用最新活动日事实补充状态和预算", () => {
    const result = summarizeParentAsinAdMcpWeek({
      weekStartDate: "2026-09-07", weekEndDate: "2026-09-13",
      products: [
        { profileId: "p1", reportDate: "2026-09-07", adType: "SP", campaignId: "c1", campaignName: "Campaign A", adGroupId: "g1", adId: "a1", advertisedAsin: "CHILD-1", impressions: 100, clicks: 10, spend: "20", sales: "80", orders: 2 },
        { profileId: "p1", reportDate: "2026-09-08", adType: "SP", campaignId: "c1", campaignName: "Campaign A", adGroupId: "g1", adId: "a1", advertisedAsin: "CHILD-1", impressions: 200, clicks: 20, spend: "30", sales: "120", orders: 3 },
      ],
      campaigns: [{ profileId: "p1", reportDate: "2026-09-08", adType: "SP", campaignId: "c1", campaignName: "Campaign A", campaignStatus: "enabled", budget: "50", currency: "USD" }],
    });
    expect(result.summary).toMatchObject({ impressions: 300, clicks: 30, spend: 50, sales: 200, orders: 5, ctr: 10, cpc: 1.67, acos: 25, cvr: 16.6667, roas: 4, advertisedAsinCount: 1, productFactCount: 2 });
    expect(result.campaigns).toEqual([expect.objectContaining({ campaignId: "c1", campaignStatus: "enabled", budget: 50, statusAvailable: true, linkedChildAsins: ["CHILD-1"] })]);
  });

  it("拒绝非完整自然周，避免详情页与产品总览混用任意七天窗口", () => {
    expect(isCompleteNaturalWeek("2026-09-07", "2026-09-13")).toBe(true);
    expect(() => summarizeParentAsinAdMcpWeek({ weekStartDate: "2026-09-08", weekEndDate: "2026-09-14", products: [], campaigns: [] })).toThrow("周一至周日完整自然周");
  });
});
