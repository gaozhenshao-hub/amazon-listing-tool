import { describe, expect, it } from "vitest";
import { competitorAcquisitionStatus } from "./competitorAcquisitionStatus";
describe("truthful acquisition status", () => {
  it("does not call an accepted task cache reuse or completed analysis", () => {
    const value = competitorAcquisitionStatus("direct_ingestion_pending", true);
    expect(value.title).toContain("尚未完成"); expect(value.description).toContain("不会自动");
    expect(value.title).not.toMatch(/已复用|已排队|分析完成/);
  });
  it("shows capture separately from queued analysis", () => {
    expect(competitorAcquisitionStatus("collected", true).title).toContain("待选择分析");
    expect(competitorAcquisitionStatus("analysis_queued", false).title).toContain("已排队");
  });
  it("does not mask queue errors or unknown states as success", () => {
    expect(competitorAcquisitionStatus("analysis_queue_failed", false).failed).toBe(true);
    expect(competitorAcquisitionStatus("unexpected", false).title).toContain("待核对");
  });
});
