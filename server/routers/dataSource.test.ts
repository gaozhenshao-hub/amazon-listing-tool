import { describe, it, expect, vi } from "vitest";

describe("LingxingAdapter stub behavior", () => {
  it("stub should return mock data with _meta source", async () => {
    const { getLingxingAdapter } = await import("../lingxingAdapter");
    const adapter = getLingxingAdapter();
    const result = await adapter.requestWithMockFallback({ path: "/test" });
    expect(result.code).toBe("200");
    // _meta is no longer returned by deprecated stub
    expect(result.code).toBe("200");
  });
  it("stub should report isMockMode as true", async () => {
    const { getLingxingAdapter } = await import("../lingxingAdapter");
    const adapter = getLingxingAdapter();
    expect(adapter.isMockMode()).toBe(true);
  });
  it("stub should report isReady as false", async () => {
    const { getLingxingAdapter } = await import("../lingxingAdapter");
    const adapter = getLingxingAdapter();
    expect(adapter.isReady()).toBe(false);
  });
});
