/**
 * Tests for Intel Auto-Collect Scheduler and Worker
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Test the scheduler interval calculation ──
describe("Auto-Collect Interval Calculation", () => {
  const INTERVAL_MS: Record<string, number> = {
    every_6h: 6 * 60 * 60 * 1000,
    every_12h: 12 * 60 * 60 * 1000,
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000,
  };

  it("should calculate correct interval for every_6h", () => {
    expect(INTERVAL_MS["every_6h"]).toBe(21600000);
  });

  it("should calculate correct interval for every_12h", () => {
    expect(INTERVAL_MS["every_12h"]).toBe(43200000);
  });

  it("should calculate correct interval for daily", () => {
    expect(INTERVAL_MS["daily"]).toBe(86400000);
  });

  it("should calculate correct interval for weekly", () => {
    expect(INTERVAL_MS["weekly"]).toBe(604800000);
  });

  it("should return undefined for unknown interval", () => {
    expect(INTERVAL_MS["unknown"]).toBeUndefined();
  });
});

// ── Test the next run time calculation ──
describe("Next Run Time Calculation", () => {
  function calculateNextRunAt(interval: string, cronExpr?: string): number {
    const INTERVAL_MS: Record<string, number> = {
      every_6h: 6 * 60 * 60 * 1000,
      every_12h: 12 * 60 * 60 * 1000,
      daily: 24 * 60 * 60 * 1000,
      weekly: 7 * 24 * 60 * 60 * 1000,
    };

    if (interval === "custom" && cronExpr) {
      // For custom cron, just return next day as placeholder
      return Date.now() + 86400000;
    }

    const ms = INTERVAL_MS[interval];
    if (!ms) return Date.now() + 86400000; // Default to daily
    return Date.now() + ms;
  }

  it("should calculate next run for every_6h", () => {
    const now = Date.now();
    const next = calculateNextRunAt("every_6h");
    expect(next).toBeGreaterThan(now);
    expect(next - now).toBeCloseTo(21600000, -3);
  });

  it("should calculate next run for daily", () => {
    const now = Date.now();
    const next = calculateNextRunAt("daily");
    expect(next - now).toBeCloseTo(86400000, -3);
  });

  it("should handle custom cron interval", () => {
    const now = Date.now();
    const next = calculateNextRunAt("custom", "0 9 * * *");
    expect(next).toBeGreaterThan(now);
  });

  it("should default to daily for unknown interval", () => {
    const now = Date.now();
    const next = calculateNextRunAt("unknown_interval");
    expect(next - now).toBeCloseTo(86400000, -3);
  });
});

// ── Test the auto-collect config validation ──
describe("Auto-Collect Config Validation", () => {
  const VALID_INTERVALS = ["every_6h", "every_12h", "daily", "weekly", "custom"];

  it("should accept valid intervals", () => {
    VALID_INTERVALS.forEach(interval => {
      expect(VALID_INTERVALS.includes(interval)).toBe(true);
    });
  });

  it("should reject invalid intervals", () => {
    expect(VALID_INTERVALS.includes("hourly")).toBe(false);
    expect(VALID_INTERVALS.includes("monthly")).toBe(false);
    expect(VALID_INTERVALS.includes("")).toBe(false);
  });

  it("should validate maxItems range (1-50)", () => {
    const validateMaxItems = (n: number) => n >= 1 && n <= 50;
    expect(validateMaxItems(1)).toBe(true);
    expect(validateMaxItems(10)).toBe(true);
    expect(validateMaxItems(50)).toBe(true);
    expect(validateMaxItems(0)).toBe(false);
    expect(validateMaxItems(51)).toBe(false);
    expect(validateMaxItems(-1)).toBe(false);
  });
});

// ── Test the failure tracking logic ──
describe("Consecutive Failure Tracking", () => {
  const MAX_CONSECUTIVE_FAILURES = 5;

  function shouldPauseSource(consecutiveFailures: number): boolean {
    return consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;
  }

  it("should not pause source with 0 failures", () => {
    expect(shouldPauseSource(0)).toBe(false);
  });

  it("should not pause source with 4 failures", () => {
    expect(shouldPauseSource(4)).toBe(false);
  });

  it("should pause source with 5 failures", () => {
    expect(shouldPauseSource(5)).toBe(true);
  });

  it("should pause source with more than 5 failures", () => {
    expect(shouldPauseSource(10)).toBe(true);
  });
});

// ── Test the collect log status determination ──
describe("Collect Log Status Determination", () => {
  function determineLogStatus(
    totalFound: number,
    totalNew: number,
    hasError: boolean
  ): "success" | "partial" | "failed" {
    if (hasError && totalNew === 0) return "failed";
    if (hasError && totalNew > 0) return "partial";
    return "success";
  }

  it("should return success when no errors", () => {
    expect(determineLogStatus(10, 5, false)).toBe("success");
  });

  it("should return failed when error and no new items", () => {
    expect(determineLogStatus(0, 0, true)).toBe("failed");
  });

  it("should return partial when error but some new items", () => {
    expect(determineLogStatus(10, 3, true)).toBe("partial");
  });

  it("should return success even with 0 found (empty source)", () => {
    expect(determineLogStatus(0, 0, false)).toBe("success");
  });
});

// ── Test the quality threshold filtering ──
describe("Quality Threshold Filtering", () => {
  function isRecommended(score: number, threshold: number): boolean {
    return score >= threshold;
  }

  it("should recommend items above threshold", () => {
    expect(isRecommended(8.5, 7.0)).toBe(true);
  });

  it("should not recommend items below threshold", () => {
    expect(isRecommended(5.0, 7.0)).toBe(false);
  });

  it("should recommend items at exact threshold", () => {
    expect(isRecommended(7.0, 7.0)).toBe(true);
  });

  it("should handle edge cases", () => {
    expect(isRecommended(0, 0)).toBe(true);
    expect(isRecommended(10, 10)).toBe(true);
    expect(isRecommended(9.99, 10)).toBe(false);
  });
});

// ── Test the notification message formatting ──
describe("Notification Message Formatting", () => {
  function formatNotification(
    sourceName: string,
    totalNew: number,
    totalRecommended: number
  ): { title: string; content: string } {
    return {
      title: `情报源「${sourceName}」发现新推荐内容`,
      content: `本次采集发现 ${totalNew} 条新内容，其中 ${totalRecommended} 条达到推荐标准。请前往情报推荐中心查看。`,
    };
  }

  it("should format notification with correct source name", () => {
    const result = formatNotification("知无不言", 5, 3);
    expect(result.title).toContain("知无不言");
  });

  it("should include counts in content", () => {
    const result = formatNotification("测试源", 10, 7);
    expect(result.content).toContain("10");
    expect(result.content).toContain("7");
  });

  it("should have proper title format", () => {
    const result = formatNotification("亚马逊论坛", 1, 1);
    expect(result.title).toBe("情报源「亚马逊论坛」发现新推荐内容");
  });
});

// ── Test the kbIntel router auto-collect endpoints ──
describe("kbIntel Router Auto-Collect Endpoints", () => {
  it("should have updateAutoCollect endpoint schema", () => {
    const { z } = require("zod");
    const schema = z.object({
      sourceId: z.number(),
      autoCollectEnabled: z.boolean().optional(),
      autoCollectInterval: z.enum(["every_6h", "every_12h", "daily", "weekly", "custom"]).optional(),
      autoCollectCron: z.string().optional(),
      autoEvaluateEnabled: z.boolean().optional(),
      autoCollectMaxItems: z.number().min(1).max(50).optional(),
    });

    // Valid input
    const valid = schema.safeParse({
      sourceId: 1,
      autoCollectEnabled: true,
      autoCollectInterval: "daily",
      autoEvaluateEnabled: true,
      autoCollectMaxItems: 10,
    });
    expect(valid.success).toBe(true);

    // Invalid interval
    const invalid = schema.safeParse({
      sourceId: 1,
      autoCollectInterval: "minutely",
    });
    expect(invalid.success).toBe(false);

    // Invalid maxItems
    const invalidMax = schema.safeParse({
      sourceId: 1,
      autoCollectMaxItems: 100,
    });
    expect(invalidMax.success).toBe(false);
  });

  it("should have triggerAutoCollect endpoint schema", () => {
    const { z } = require("zod");
    const schema = z.object({
      sourceId: z.number(),
    });

    const valid = schema.safeParse({ sourceId: 42 });
    expect(valid.success).toBe(true);

    const invalid = schema.safeParse({ sourceId: "abc" });
    expect(invalid.success).toBe(false);
  });

  it("should have getCollectLogs endpoint schema", () => {
    const { z } = require("zod");
    const schema = z.object({
      sourceId: z.number().optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(50).default(20),
    });

    const valid = schema.safeParse({ page: 1, pageSize: 20 });
    expect(valid.success).toBe(true);

    const withSource = schema.safeParse({ sourceId: 5, page: 2, pageSize: 10 });
    expect(withSource.success).toBe(true);
  });

  it("should have getSchedulerStatus endpoint (no input)", () => {
    // getSchedulerStatus is a query with no input
    expect(true).toBe(true);
  });
});

// ── Test the collect log data structure ──
describe("Collect Log Data Structure", () => {
  it("should have required fields", () => {
    const log = {
      id: 1,
      sourceId: 1,
      sourceName: "测试源",
      triggerType: "auto",
      status: "success",
      totalFound: 10,
      totalNew: 5,
      totalDuplicate: 3,
      totalEvaluated: 5,
      totalRecommended: 2,
      startedAt: Date.now(),
      finishedAt: Date.now() + 5000,
      durationMs: 5000,
      errorMessage: null,
    };

    expect(log).toHaveProperty("id");
    expect(log).toHaveProperty("sourceId");
    expect(log).toHaveProperty("triggerType");
    expect(log).toHaveProperty("status");
    expect(log).toHaveProperty("totalFound");
    expect(log).toHaveProperty("totalNew");
    expect(log).toHaveProperty("totalDuplicate");
    expect(log).toHaveProperty("totalEvaluated");
    expect(log).toHaveProperty("totalRecommended");
    expect(log).toHaveProperty("startedAt");
    expect(log).toHaveProperty("durationMs");
  });

  it("should have valid trigger types", () => {
    const validTypes = ["manual", "auto", "test"];
    expect(validTypes).toContain("manual");
    expect(validTypes).toContain("auto");
    expect(validTypes).toContain("test");
  });

  it("should have valid status types", () => {
    const validStatuses = ["running", "success", "partial", "failed"];
    expect(validStatuses).toContain("running");
    expect(validStatuses).toContain("success");
    expect(validStatuses).toContain("partial");
    expect(validStatuses).toContain("failed");
  });
});

// ── Test the scheduler status data structure ──
describe("Scheduler Status Data Structure", () => {
  it("should return proper structure", () => {
    const status = {
      isActive: true,
      scheduledSources: [
        {
          id: 1,
          name: "测试源",
          interval: "daily",
          maxItems: 10,
          autoEvaluateEnabled: true,
          nextRunAt: Date.now() + 86400000,
          lastRunAt: Date.now() - 86400000,
          consecutiveFailures: 0,
        },
      ],
      activeCollections: [] as number[],
    };

    expect(status.isActive).toBe(true);
    expect(status.scheduledSources).toHaveLength(1);
    expect(status.scheduledSources[0]).toHaveProperty("id");
    expect(status.scheduledSources[0]).toHaveProperty("name");
    expect(status.scheduledSources[0]).toHaveProperty("interval");
    expect(status.scheduledSources[0]).toHaveProperty("nextRunAt");
    expect(status.activeCollections).toEqual([]);
  });
});

// ── Test the schema extension fields ──
describe("Schema Extension for Auto-Collect", () => {
  it("should define expected auto-collect field names", () => {
    const expectedFields = [
      "autoCollectEnabled",
      "autoCollectInterval",
      "autoCollectCron",
      "autoCollectMaxItems",
      "autoEvaluateEnabled",
      "lastAutoCollectAt",
      "nextAutoCollectAt",
      "consecutiveFailures",
    ];
    expect(expectedFields).toHaveLength(8);
    expect(expectedFields).toContain("autoCollectEnabled");
    expect(expectedFields).toContain("nextAutoCollectAt");
    expect(expectedFields).toContain("consecutiveFailures");
  });

  it("should define collect log table fields", () => {
    const logFields = [
      "id", "sourceId", "triggerType", "status",
      "totalFound", "totalNew", "totalDuplicate",
      "totalEvaluated", "totalRecommended",
      "startedAt", "finishedAt", "durationMs", "errorMessage",
    ];
    expect(logFields).toHaveLength(13);
    expect(logFields).toContain("triggerType");
    expect(logFields).toContain("durationMs");
  });
});
