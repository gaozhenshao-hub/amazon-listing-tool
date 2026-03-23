import { describe, it, expect } from "vitest";
import { generateSign, getLingxingAdapter } from "./lingxingAdapter";

describe("Lingxing Adapter - Secrets & Initialization", () => {
  it("should have LINGXING_APP_ID env set", () => {
    const appId = process.env.LINGXING_APP_ID;
    expect(appId).toBeDefined();
    expect(appId!.length).toBeGreaterThan(0);
    expect(appId).toContain("ak_");
  });

  it("should have LINGXING_APP_SECRET env set", () => {
    const secret = process.env.LINGXING_APP_SECRET;
    expect(secret).toBeDefined();
    expect(secret!.length).toBeGreaterThan(0);
  });

  it("should have LINGXING_API_HOST env set", () => {
    const host = process.env.LINGXING_API_HOST;
    expect(host).toBeDefined();
    expect(host).toContain("lingxing.com");
  });
});

describe("Lingxing Adapter - Sign Generation", () => {
  it("should generate correct MD5 sign", () => {
    const sign = generateSign("test_app_key", 1700000000, "test_secret");
    expect(sign).toHaveLength(32);
    expect(sign).toMatch(/^[a-f0-9]{32}$/);
  });

  it("should produce different signs for different timestamps", () => {
    const sign1 = generateSign("key", 1700000000, "secret");
    const sign2 = generateSign("key", 1700000001, "secret");
    expect(sign1).not.toBe(sign2);
  });

  it("should produce deterministic signs", () => {
    const sign1 = generateSign("key", 1700000000, "secret");
    const sign2 = generateSign("key", 1700000000, "secret");
    expect(sign1).toBe(sign2);
  });
});

describe("Lingxing Adapter - Mock Mode", () => {
  it("should initialize adapter in mock mode", () => {
    const adapter = getLingxingAdapter();
    expect(adapter).toBeDefined();
    expect(adapter.isMockMode()).toBe(true);
  });

  it("should return mock seller list", async () => {
    const adapter = getLingxingAdapter();
    const res = await adapter.request({ path: "/erp/sc/data/seller/lists" });
    expect(res.code).toBe("200");
    expect(Array.isArray(res.data)).toBe(true);
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data[0]).toHaveProperty("sid");
    expect(res.data[0]).toHaveProperty("marketplace");
  });

  it("should return mock exchange rates", async () => {
    const adapter = getLingxingAdapter();
    const res = await adapter.request({ path: "/erp/sc/data/exchange_rate" });
    expect(res.code).toBe("200");
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data[0]).toHaveProperty("currency");
    expect(res.data[0]).toHaveProperty("rate");
  });

  it("should return mock FBA inventory", async () => {
    const adapter = getLingxingAdapter();
    const res = await adapter.request({ path: "/erp/sc/routing/storage/fbaInventory", body: { sid: 1 } });
    expect(res.code).toBe("200");
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data[0]).toHaveProperty("seller_sku");
    expect(res.data[0]).toHaveProperty("afn_fulfillable_quantity");
    expect(res.data[0]).toHaveProperty("avg_daily_sales_30d");
    expect(res.data[0]).toHaveProperty("days_of_supply");
  });

  it("should return mock profit list", async () => {
    const adapter = getLingxingAdapter();
    const res = await adapter.request({ path: "/erp/sc/data/profit/list", body: {} });
    expect(res.code).toBe("200");
    expect(res.data.length).toBe(30);
    expect(res.data[0]).toHaveProperty("date");
    expect(res.data[0]).toHaveProperty("revenue");
    expect(res.data[0]).toHaveProperty("profit");
    expect(res.data[0]).toHaveProperty("profit_margin");
  });

  it("should return mock ad campaigns", async () => {
    const adapter = getLingxingAdapter();
    const res = await adapter.request({ path: "/erp/sc/data/ad_manage/campaign/list", body: {} });
    expect(res.code).toBe("200");
    expect(res.data.length).toBe(5);
    expect(res.data[0]).toHaveProperty("campaign_name");
    expect(res.data[0]).toHaveProperty("acos");
    expect(res.data[0]).toHaveProperty("spend");
  });

  it("should return mock search terms", async () => {
    const adapter = getLingxingAdapter();
    const res = await adapter.request({ path: "/erp/sc/data/ad_manage/searchTerm/list", body: {} });
    expect(res.code).toBe("200");
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data[0]).toHaveProperty("search_term");
    expect(res.data[0]).toHaveProperty("keyword_text");
  });

  it("should return mock replenishment data", async () => {
    const adapter = getLingxingAdapter();
    const res = await adapter.request({ path: "/erp/sc/routing/storage/replenish/getReplenishmentData", body: {} });
    expect(res.code).toBe("200");
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data[0]).toHaveProperty("urgency");
    expect(res.data[0]).toHaveProperty("suggested_qty");
  });

  it("should cache mock responses", async () => {
    const adapter = getLingxingAdapter();
    const res1 = await adapter.request({ path: "/erp/sc/data/seller/lists" });
    const res2 = await adapter.request({ path: "/erp/sc/data/seller/lists" });
    // Same cached response
    expect(res1.data).toEqual(res2.data);
  });

  it("should log API calls", async () => {
    const adapter = getLingxingAdapter();
    await adapter.request({ path: "/erp/sc/data/seller/lists", skipCache: true });
    const logs = adapter.getRecentLogs();
    expect(logs.length).toBeGreaterThan(0);
    const lastLog = logs[logs.length - 1];
    expect(lastLog.endpoint).toBe("/erp/sc/data/seller/lists");
    expect(lastLog.isMock).toBe(true);
  });

  it("should return empty data for unknown endpoints", async () => {
    const adapter = getLingxingAdapter();
    const res = await adapter.request({ path: "/unknown/endpoint" });
    expect(res.code).toBe("200");
    expect(res.msg).toContain("no data");
  });

  it("should toggle mock mode", () => {
    const adapter = getLingxingAdapter();
    expect(adapter.isMockMode()).toBe(true);
    adapter.setMockMode(false);
    expect(adapter.isMockMode()).toBe(false);
    adapter.setMockMode(true); // Reset
  });
});
