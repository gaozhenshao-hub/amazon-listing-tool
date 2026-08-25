import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, "../client/src/pages/ops/OpsProducts.tsx"),
  "utf8",
);

describe("产品总览领星日快照适配", () => {
  it("映射已汇总的广告、流量和转化指标，而不是写死为0", () => {
    expect(source).toContain("totalCvr: nullableNumber(week.totalCvr)");
    expect(source).toContain("adCvr: nullableNumber(week.adCvr)");
    expect(source).toContain("adOrders: Number(week.adOrders || 0)");
    expect(source).toContain("adClicks: Number(week.adClicks || 0)");
    expect(source).toContain("adImpressions: Number(week.adImpressions || 0)");
    expect(source).not.toContain("totalCvr: 0, adCvr: 0, organicCvr: 0, adOrders: 0");
  });

  it("将无法由日快照推导的指标标记为数据未提供", () => {
    expect(source).toContain('title="数据未提供"');
    expect(source).toContain("<MetricValue value={w.organicCvr}");
    expect(source).toContain("<MetricValue value={w.rating}");
    expect(source).toContain("<MetricValue value={w.reviewCount}");
  });
});
