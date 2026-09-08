import { describe, expect, it } from "vitest";
import { formatAsiaShanghaiAuditTime } from "./asiaShanghaiAuditTime";

describe("formatAsiaShanghaiAuditTime", () => {
  it("preserves the MySQL audit wall-clock components instead of adding the browser offset again", () => {
    // 16:20 was stored by the Asia/Shanghai MySQL clock; JSON serialisation
    // labels it as UTC, so a conventional local formatter would display 00:20
    // on the following day in China.
    expect(formatAsiaShanghaiAuditTime("2026-09-08T16:20:00.000Z")).toBe("2026/09/08 16:20");
  });

  it("does not transform business date-range strings", () => {
    expect("2026-08-31 ~ 2026-09-06").toBe("2026-08-31 ~ 2026-09-06");
  });

  it("returns a stable placeholder for empty or invalid values", () => {
    expect(formatAsiaShanghaiAuditTime(null)).toBe("-");
    expect(formatAsiaShanghaiAuditTime("not-a-time")).toBe("-");
  });
});
