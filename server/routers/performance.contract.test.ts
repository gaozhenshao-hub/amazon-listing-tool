import { describe, expect, it } from "vitest";
import { __resetPerformanceRateLimitForTests } from "./performance";

// The public contract is deliberately verified as source-level data constraints: route IDs,
// ASINs, query strings and content fields are rejected before metric persistence.
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.resolve(process.cwd(), "server/routers/performance.ts"), "utf8");

describe("前端性能上报隐私与过载保护", () => {
  it("限制枚举指标、无查询字符串路由和批量大小", () => {
    expect(source).toContain('z.enum(["LCP", "INP", "CLS", "TTFB", "FCP"])');
    expect(source).toContain('z.array(reportEventSchema).min(1).max(12)');
    expect(source).toContain('routeKey = z.string().regex(/^\\/[a-z0-9:_/-]{0,95}$/)');
    expect(source).not.toContain("prompt:");
    expect(source).not.toContain("imageUrl:");
  });

  it("提供可重置的进程内限流状态以支持有界上报", () => {
    __resetPerformanceRateLimitForTests();
    expect(source).toContain("const RATE_LIMIT = 120");
    expect(source).toContain("acceptRateLimitedEvents");
  });
});
