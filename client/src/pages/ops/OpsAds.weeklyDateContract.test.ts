import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const frontend = readFileSync(new URL("./OpsAds.tsx", import.meta.url), "utf8");
const backend = readFileSync(new URL("../../../../server/routers/adLocalAnalysis.ts", import.meta.url), "utf8");

describe("广告概览已导入周报口径", () => {
  it("单日控件将所选日期传给实际查询，显示为所在报告周", () => {
    expect(frontend).toContain("params.selectedDate = selectedDate");
    expect(frontend).toContain("[adStateFilter, dateMode, startDate, endDate, selectedDate]");
    expect(frontend).toContain("所选日期所在周");
    expect(frontend).toContain("非单日指标");
  });

  it("按日期与周报区间交集选择，而不是跳过筛选或伪造单日业绩", () => {
    expect(backend).toContain("lte(adCampaignReports.weekStartDate, input.selectedDate)");
    expect(backend).toContain("gte(adCampaignReports.weekEndDate, input.selectedDate)");
    expect(backend).toContain("gte(adCampaignReports.weekEndDate, input.weekStartDate)");
    expect(backend).toContain("lte(adCampaignReports.weekStartDate, input.weekEndDate)");
  });
});
