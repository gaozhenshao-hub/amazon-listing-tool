import { describe, it, expect } from "vitest";
import { APP_ERROR_CODES } from "@shared/_core/errors";

// Test mock data functions in lingxingAdapter
describe("Lingxing Adapter Stub for Product Detail APIs", () => {
  it("rejects removed product API calls", async () => {
    const { getLingxingAdapter } = await import("../lingxingAdapter");
    const adapter = getLingxingAdapter();
    await expect(adapter.request({ path: "/erp/sc/data/product" })).rejects.toMatchObject({
      code: APP_ERROR_CODES.DATA_SOURCE_UNAVAILABLE,
    });
  });
  it("rejects removed competitor API calls", async () => {
    const { getLingxingAdapter } = await import("../lingxingAdapter");
    const adapter = getLingxingAdapter();
    await expect(adapter.request({ path: "/competitor/data" })).rejects.toMatchObject({
      code: APP_ERROR_CODES.DATA_SOURCE_UNAVAILABLE,
    });
  });
});
