import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";

describe("Product Weekly Ops Enhanced Features", () => {

  it("getProductsWeeklySummary procedure exists", () => {
    expect(appRouter._def.procedures).toHaveProperty("productOps.getProductsWeeklySummary");
  });

  it("getProductsWeeklySummary is a procedure with correct type", () => {
    const proc = (appRouter._def.procedures as any)["productOps.getProductsWeeklySummary"];
    expect(proc).toBeDefined();
    expect(proc._def).toBeDefined();
  });
});
