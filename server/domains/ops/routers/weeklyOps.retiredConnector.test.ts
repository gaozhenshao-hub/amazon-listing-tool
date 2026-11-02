import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./weeklyOps.ts", import.meta.url), "utf8");

describe("退役的周报即时读取入口", () => {
  it("单产品同步在逐周 catch 和延迟之前明确失败", () => {
    const start = source.indexOf("syncWeeklyOpsFromLingxing: protectedProcedure");
    const end = source.indexOf("// ── Auto-fill product basic info", start);
    const body = source.slice(start, end);
    expect(body.indexOf('failUnavailableDataSource("旧周报即时读取接口')).toBeGreaterThan(0);
    expect(body.indexOf('failUnavailableDataSource("旧周报即时读取接口')).toBeLessThan(body.indexOf("for (const week of weekRanges)"));
    expect(body.indexOf('failUnavailableDataSource("旧周报即时读取接口')).toBeGreaterThan(body.indexOf('if (!product) throw new TRPCError'));
  });

  it("批量同步在数据查询和逐周处理前明确失败", () => {
    const start = source.indexOf("batchSyncWeeklyOps: protectedProcedure");
    const body = source.slice(start);
    expect(body.indexOf('failUnavailableDataSource("旧周报批量即时读取接口')).toBeGreaterThan(0);
    expect(body.indexOf('failUnavailableDataSource("旧周报批量即时读取接口')).toBeLessThan(body.indexOf("const db = await requireOpsDb()"));
  });
});
