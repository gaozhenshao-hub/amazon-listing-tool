import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";

describe("Product Overview With Weeks", () => {
  const router = appRouter;

  it("should have getProductOverviewWithWeeks procedure", () => {
    expect(router._def.procedures).toHaveProperty("productOps.getProductOverviewWithWeeks");
  });

  it("getProductOverviewWithWeeks should be a query", () => {
    const proc = (router._def.procedures as any)["productOps.getProductOverviewWithWeeks"];
    expect(proc).toBeDefined();
    expect(proc._def?.type || proc._type).toBe("query");
  });

  it("should have all required productOps procedures for the overview page", () => {
    const requiredProcs = [
      "productOps.getProductOverviewWithWeeks",
      "productOps.createProduct",
      "productOps.deleteProduct",
      "productOps.syncFromLingxing",
      "productOps.batchSyncWeeklyOps",
      "productOps.batchAssignOperator",
      "productOps.listOperators",
    ];
    for (const procName of requiredProcs) {
      expect(router._def.procedures, `${procName} should exist`).toHaveProperty(procName);
    }
  });

  it("should have syncWeeklyOpsFromLingxing as mutation", () => {
    const proc = (router._def.procedures as any)["productOps.syncWeeklyOpsFromLingxing"];
    expect(proc).toBeDefined();
    expect(proc._def?.type || proc._type).toBe("mutation");
  });

  it("should have batchSyncWeeklyOps as mutation", () => {
    const proc = (router._def.procedures as any)["productOps.batchSyncWeeklyOps"];
    expect(proc).toBeDefined();
    expect(proc._def?.type || proc._type).toBe("mutation");
  });

  it("should have listOperators as query", () => {
    const proc = (router._def.procedures as any)["productOps.listOperators"];
    expect(proc).toBeDefined();
    expect(proc._def?.type || proc._type).toBe("query");
  });

  it("should have deleteProduct as mutation", () => {
    const proc = (router._def.procedures as any)["productOps.deleteProduct"];
    expect(proc).toBeDefined();
    expect(proc._def?.type || proc._type).toBe("mutation");
  });

  // ─── WoW calculation logic test ───
  it("should correctly calculate week-over-week percentage changes", () => {
    function calcChange(current: number, previous: number | null): { value: number; pct: number | null } {
      if (previous === null || previous === 0) return { value: current, pct: null };
      const pct = ((current - previous) / Math.abs(previous)) * 100;
      return { value: current, pct: Math.round(pct * 100) / 100 };
    }

    // Normal increase
    const increase = calcChange(150, 100);
    expect(increase.pct).toBe(50);

    // Normal decrease
    const decrease = calcChange(50, 100);
    expect(decrease.pct).toBe(-50);

    // No change
    const noChange = calcChange(100, 100);
    expect(noChange.pct).toBe(0);

    // Previous is 0 -> null pct
    const fromZero = calcChange(100, 0);
    expect(fromZero.pct).toBeNull();

    // Previous is null -> null pct
    const fromNull = calcChange(100, null);
    expect(fromNull.pct).toBeNull();

    // Large increase
    const largeIncrease = calcChange(1000, 10);
    expect(largeIncrease.pct).toBe(9900);

    // Negative values
    const negToPos = calcChange(50, -100);
    expect(negToPos.pct).toBe(150);
  });

  // ─── Date formatting test ───
  it("should format week dates correctly", () => {
    function fmtWeekDate(dateStr: string) {
      const d = new Date(dateStr + "T00:00:00");
      return `${d.getMonth() + 1}月${d.getDate()}日`;
    }

    expect(fmtWeekDate("2026-04-07")).toBe("4月7日");
    expect(fmtWeekDate("2026-01-01")).toBe("1月1日");
    expect(fmtWeekDate("2026-12-31")).toBe("12月31日");
  });

  // ─── Currency formatting test ───
  it("should format currency values correctly", () => {
    function fmtCurrency(val: number) {
      if (Math.abs(val) >= 10000) return `$${(val / 1000).toFixed(1)}K`;
      return `$${val.toFixed(2)}`;
    }

    expect(fmtCurrency(1234.56)).toBe("$1234.56");
    expect(fmtCurrency(0)).toBe("$0.00");
    expect(fmtCurrency(-500)).toBe("$-500.00");
    expect(fmtCurrency(15000)).toBe("$15.0K");
    expect(fmtCurrency(-15000)).toBe("$-15.0K");
  });

  // ─── Percentage formatting test ───
  it("should format percentage values correctly", () => {
    function fmtPct(val: number, digits = 2) {
      return `${val.toFixed(digits)}%`;
    }

    expect(fmtPct(12.345, 1)).toBe("12.3%");
    expect(fmtPct(0, 2)).toBe("0.00%");
    expect(fmtPct(100, 0)).toBe("100%");
  });
});
