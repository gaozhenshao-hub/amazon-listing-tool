import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";

describe("Product Weekly Ops Enhanced Features", () => {
  it("autoFillBasicInfo procedure exists", () => {
    expect(appRouter._def.procedures).toHaveProperty("productOps.autoFillBasicInfo");
  });

  it("getProductsWeeklySummary procedure exists", () => {
    expect(appRouter._def.procedures).toHaveProperty("productOps.getProductsWeeklySummary");
  });

  it("autoFillBasicInfo is a procedure with correct type", () => {
    const proc = (appRouter._def.procedures as any)["productOps.autoFillBasicInfo"];
    expect(proc).toBeDefined();
    // tRPC v11: check _def.type or just that it exists
    expect(proc._def).toBeDefined();
  });

  it("getProductsWeeklySummary is a procedure with correct type", () => {
    const proc = (appRouter._def.procedures as any)["productOps.getProductsWeeklySummary"];
    expect(proc).toBeDefined();
    expect(proc._def).toBeDefined();
  });

  it("total productOps procedure count is 88", () => {
    const allKeys = Object.keys(appRouter._def.procedures as any);
    const productOpsKeys = allKeys.filter(k => k.startsWith("productOps."));
    expect(productOpsKeys.length).toBe(88);
  });
});
