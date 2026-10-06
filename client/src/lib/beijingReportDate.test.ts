import { describe, expect, it } from "vitest";
import { beijingReportDateDaysAgo } from "./beijingReportDate";

describe("广告周报的北京时间默认日期", () => {
  it("北京时间零点刚过时不会错误沿用前一 UTC 日", () => {
    const justAfterBeijingMidnight = Date.UTC(2026, 9, 5, 16, 1);
    expect(beijingReportDateDaysAgo(0, justAfterBeijingMidnight)).toBe("2026-10-06");
    expect(beijingReportDateDaysAgo(2, justAfterBeijingMidnight)).toBe("2026-10-04");
  });

  it("不依赖浏览器时区，在北京时间午夜前正确处理日期", () => {
    const justBeforeBeijingMidnight = Date.UTC(2026, 9, 5, 15, 59);
    expect(beijingReportDateDaysAgo(0, justBeforeBeijingMidnight)).toBe("2026-10-05");
  });
});
