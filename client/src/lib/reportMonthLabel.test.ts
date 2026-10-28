import { describe, expect, it } from "vitest";
import { reportMonthLabel, reportPeriodLabel } from "./reportMonthLabel";

describe("financial report period labels", () => {
  it("names the actual report month and three-month window", () => {
    expect(reportMonthLabel("2026-08")).toBe("8月");
    expect(reportPeriodLabel("2026-08", "2026-08")).toBe("8月");
    expect(reportPeriodLabel("2026-06", "2026-08")).toBe("6—8月");
  });
  it("makes cross-year comparisons unambiguous", () => {
    expect(reportPeriodLabel("2025-11", "2026-01")).toBe("2025年11月—2026年1月");
    expect(reportMonthLabel("2025-12", true)).toBe("2025年12月");
    expect(reportMonthLabel("2026-01", true)).toBe("2026年1月");
  });
});
