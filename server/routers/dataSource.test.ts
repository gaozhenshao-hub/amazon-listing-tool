import { describe, it, expect } from "vitest";
import { APP_ERROR_CODES } from "@shared/_core/errors";

describe("LingxingAdapter stub behavior", () => {
  it("rejects requests instead of returning fabricated success data", async () => {
    const { getLingxingAdapter } = await import("../lingxingAdapter");
    const adapter = getLingxingAdapter();
    await expect(adapter.requestWithMockFallback({ path: "/test" })).rejects.toMatchObject({
      code: APP_ERROR_CODES.DATA_SOURCE_UNAVAILABLE,
      statusCode: 503,
    });
  });
  it("does not report a fake mock mode", async () => {
    const { getLingxingAdapter } = await import("../lingxingAdapter");
    const adapter = getLingxingAdapter();
    expect(adapter.isMockMode()).toBe(false);
  });
  it("stub should report isReady as false", async () => {
    const { getLingxingAdapter } = await import("../lingxingAdapter");
    const adapter = getLingxingAdapter();
    expect(adapter.isReady()).toBe(false);
  });
});
