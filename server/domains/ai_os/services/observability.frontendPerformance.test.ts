import { describe, expect, it, vi } from "vitest";

vi.mock("../../../repositories/dbClient", () => ({ getDb: vi.fn() }));

import { buildFrontendPerformanceSummary } from "./observability";
import { getDb } from "../../../repositories/dbClient";

describe("前端性能汇总", () => {
  it("仅按工作空间聚合匿名路由指标并计算分位数", async () => {
    const execute = vi.fn().mockResolvedValueOnce([[
      { entityId: "/listing/image-workflow", metricName: "frontend.lcp", metricValue: 1000, status: "good", createdAt: "2026-10-06T00:00:00.000Z" },
      { entityId: "/listing/image-workflow", metricName: "frontend.lcp", metricValue: 2500, status: "needs-improvement", createdAt: "2026-10-06T01:00:00.000Z" },
      { entityId: "/listing/image-workflow", metricName: "frontend.lcp", metricValue: 5100, status: "poor", createdAt: "2026-10-06T02:00:00.000Z" },
    ]]);
    vi.mocked(getDb).mockResolvedValue({ execute } as any);

    const summary = await buildFrontendPerformanceSummary({ workspaceId: 7, days: 14 });

    expect(summary.sampleCount).toBe(3);
    expect(summary.routes).toEqual([expect.objectContaining({ routeKey: "/listing/image-workflow", metricName: "LCP", sampleCount: 3, p50: 2500, p75: 5100, p95: 5100 })]);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
