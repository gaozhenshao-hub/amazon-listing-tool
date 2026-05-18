import { describe, it, expect, vi, beforeEach } from "vitest";

// Test mock data functions in lingxingAdapter
describe("Lingxing Adapter Stub for Product Detail APIs", () => {
  it("stub should return empty data for product API calls", async () => {
    const { getLingxingAdapter } = await import("../lingxingAdapter");
    const adapter = getLingxingAdapter();
    const result = await adapter.request({ path: "/erp/sc/data/product" });
    expect(result.code).toBe("200");
    expect(result.data).toBeDefined();
  });
  it("stub should return mock data for competitor paths", async () => {
    const { getLingxingAdapter } = await import("../lingxingAdapter");
    const adapter = getLingxingAdapter();
    const result = await adapter.request({ path: "/competitor/data" });
    expect(result.code).toBe("200");
    expect(result.data).toBeDefined();
  });
});
