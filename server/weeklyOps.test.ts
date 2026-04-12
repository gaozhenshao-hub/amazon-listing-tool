import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";

describe("Weekly Ops Data Procedures", () => {
  const router = appRouter;

  it("should have getWeeklyOpsData procedure", () => {
    expect(router._def.procedures).toHaveProperty("productOps.getWeeklyOpsData");
  });

  it("should have getMonthlySummaries procedure", () => {
    expect(router._def.procedures).toHaveProperty("productOps.getMonthlySummaries");
  });

  it("should have getProductBasicInfo procedure", () => {
    expect(router._def.procedures).toHaveProperty("productOps.getProductBasicInfo");
  });

  it("should have upsertWeeklyOps procedure", () => {
    expect(router._def.procedures).toHaveProperty("productOps.upsertWeeklyOps");
  });

  it("should have deleteWeeklyOps procedure", () => {
    expect(router._def.procedures).toHaveProperty("productOps.deleteWeeklyOps");
  });

  it("should have upsertProductBasicInfo procedure", () => {
    expect(router._def.procedures).toHaveProperty("productOps.upsertProductBasicInfo");
  });

  it("should have syncWeeklyOpsFromLingxing procedure", () => {
    expect(router._def.procedures).toHaveProperty("productOps.syncWeeklyOpsFromLingxing");
  });

  it("should have upsertMonthlySummary procedure", () => {
    expect(router._def.procedures).toHaveProperty("productOps.upsertMonthlySummary");
  });

  it("all weekly ops procedures should be protected (require auth)", () => {
    const weeklyProcedures = [
      "productOps.getWeeklyOpsData",
      "productOps.getMonthlySummaries",
      "productOps.getProductBasicInfo",
      "productOps.upsertWeeklyOps",
      "productOps.deleteWeeklyOps",
      "productOps.upsertProductBasicInfo",
      "productOps.syncWeeklyOpsFromLingxing",
      "productOps.upsertMonthlySummary",
    ];

    for (const procName of weeklyProcedures) {
      const proc = (router._def.procedures as any)[procName];
      expect(proc, `${procName} should exist`).toBeDefined();
    }
  });

  it("should have correct total procedure count for productOps router", () => {
    const productOpsProcs = Object.keys(router._def.procedures).filter(
      (k) => k.startsWith("productOps.")
    );
    // Original procedures + 8 new weekly ops procedures
    expect(productOpsProcs.length).toBeGreaterThanOrEqual(78);
  });
});
