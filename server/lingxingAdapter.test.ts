import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateSign, getLingxingAdapter, buildLingxingProxyUrl, type LingxingProxyConfig } from "./lingxingAdapter";

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

describe("Lingxing Adapter - Sign Generation (7-step official algorithm)", () => {
  it("should generate AES-encrypted Base64 sign", () => {
    const sign = generateSign("testAppId123", "test_access_token", 1700000000);
    // AES result is Base64 encoded, not hex MD5
    expect(sign.length).toBeGreaterThan(0);
    // Base64 characters: A-Z, a-z, 0-9, +, /, =
    expect(sign).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("should produce different signs for different timestamps", () => {
    const sign1 = generateSign("key", "token", 1700000000);
    const sign2 = generateSign("key", "token", 1700000001);
    expect(sign1).not.toBe(sign2);
  });

  it("should produce deterministic signs", () => {
    const sign1 = generateSign("key", "token", 1700000000);
    const sign2 = generateSign("key", "token", 1700000000);
    expect(sign1).toBe(sign2);
  });

  it("should match official CryptoJS reference output", () => {
    // Test data from Lingxing official sign test page
    const sign = generateSign(
      "testAppId123",
      "32573a1b-xxxx-xxxx-xxxx-a85fc12de26a",
      1680593889,
      { start_date: "2023-03-01 00:00:00", end_date: "2023-03-28 10:44:55", date_type: 2 }
    );
    expect(sign).toBe("KzFqrZ+mU4ZbhRrFCqoTcMzWZcZxD0icnAgd/aa/c8rfX+Br+gNdhQfcrARMvBo1");
  });

  it("should handle body params with objects/arrays", () => {
    const sign = generateSign("appId", "token", 1700000000, {
      ids: [1, 2, 3],
      filter: { status: "active" }
    });
    expect(sign).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

describe("Lingxing Adapter - Mock Mode", () => {
  let originalMock: boolean;

  beforeEach(() => {
    const adapter = getLingxingAdapter();
    originalMock = adapter.isMockMode();
    adapter.setMockMode(true); // Force mock for all tests in this suite
    adapter.clearCache();
  });

  afterEach(() => {
    const adapter = getLingxingAdapter();
    adapter.setMockMode(originalMock); // Restore
  });

  it("should initialize adapter", () => {
    const adapter = getLingxingAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.isMockMode()).toBe("boolean");
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
    const res = await adapter.request({ path: "/erp/sc/routing/fba/fbaStock/fbaList", body: { sid: 1 } });
    expect(res.code).toBe("200");
    const items = (res.data as any)?.list || res.data;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    // Mock uses seller_sku; real API uses msku
    expect(items[0]).toHaveProperty("seller_sku");
    expect(items[0]).toHaveProperty("product_name");
  });

  it("should return mock profit list", async () => {
    const adapter = getLingxingAdapter();
    const res = await adapter.request({ path: "/bd/profit/report/open/report/msku/list", body: {} });
    expect(res.code).toBe("200");
    const items = (res.data as any)?.records || res.data;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    // Mock returns daily profit data with date/revenue/profit fields
    expect(items[0]).toHaveProperty("date");
    expect(items[0]).toHaveProperty("revenue");
    expect(items[0]).toHaveProperty("profit");
  });

  it("should return mock ad campaigns", async () => {
    const adapter = getLingxingAdapter();
    const res = await adapter.request({ path: "/pb/openapi/newad/spCampaigns", body: { sid: 1 } });
    expect(res.code).toBe("200");
    const items = (res.data as any)?.records || (res.data as any)?.list || res.data;
    expect(Array.isArray(items)).toBe(true);
  });

  it("should return mock search terms", async () => {
    const adapter = getLingxingAdapter();
    const res = await adapter.request({ path: "/pb/openapi/newad/queryWordReports", body: { sid: 1, report_date: "2026-03-01" } });
    expect(res.code).toBe("200");
    const items = Array.isArray(res.data) ? res.data : (res.data as any)?.records || (res.data as any)?.list || [];
    expect(Array.isArray(items)).toBe(true);
  });

  it("should return mock replenishment data", async () => {
    const adapter = getLingxingAdapter();
    const res = await adapter.request({ path: "/erp/sc/data/replenish/salesForecast", body: {} });
    expect(res.code).toBe("200");
    const items = (res.data as any)?.list || res.data;
    expect(Array.isArray(items)).toBe(true);
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
    const wasMock = adapter.isMockMode();
    adapter.setMockMode(true); // Force mock for this test
    await adapter.request({ path: "/erp/sc/data/seller/lists", skipCache: true });
    const logs = adapter.getRecentLogs();
    expect(logs.length).toBeGreaterThan(0);
    const lastLog = logs[logs.length - 1];
    expect(lastLog.endpoint).toBe("/erp/sc/data/seller/lists");
    expect(lastLog.isMock).toBe(true);
    adapter.setMockMode(wasMock); // Restore
  });

  it("should return empty data for unknown endpoints in mock mode", async () => {
    const adapter = getLingxingAdapter();
    const wasMock = adapter.isMockMode();
    adapter.setMockMode(true); // Force mock for this test
    adapter.clearCache();
    const res = await adapter.request({ path: "/unknown/endpoint", skipCache: true });
    expect(res.code).toBe("200");
    expect(res.msg).toContain("no data");
    adapter.setMockMode(wasMock); // Restore
  });

  it("should toggle mock mode", () => {
    const adapter = getLingxingAdapter();
    const original = adapter.isMockMode();
    adapter.setMockMode(true);
    expect(adapter.isMockMode()).toBe(true);
    adapter.setMockMode(false);
    expect(adapter.isMockMode()).toBe(false);
    adapter.setMockMode(original); // Restore
  });
});

describe("Lingxing Adapter - Proxy URL Builder", () => {
  it("returns undefined when proxy is disabled", () => {
    const config: LingxingProxyConfig = {
      enabled: false,
      protocol: "http",
      host: "proxy.example.com",
      port: "8080",
    };
    expect(buildLingxingProxyUrl(config)).toBeUndefined();
  });

  it("returns directUrl when provided", () => {
    const config: LingxingProxyConfig = {
      enabled: true,
      protocol: "http",
      host: "",
      port: "",
      directUrl: "socks5://user:pass@proxy.example.com:1080",
    };
    expect(buildLingxingProxyUrl(config)).toBe("socks5://user:pass@proxy.example.com:1080");
  });

  it("builds URL from components without auth", () => {
    const config: LingxingProxyConfig = {
      enabled: true,
      protocol: "http",
      host: "proxy.example.com",
      port: "8080",
    };
    expect(buildLingxingProxyUrl(config)).toBe("http://proxy.example.com:8080");
  });

  it("builds URL from components with auth", () => {
    const config: LingxingProxyConfig = {
      enabled: true,
      protocol: "socks5",
      host: "proxy.example.com",
      port: "1080",
      username: "user",
      password: "p@ss",
    };
    expect(buildLingxingProxyUrl(config)).toBe("socks5://user:p%40ss@proxy.example.com:1080");
  });

  it("returns undefined when enabled but no host or directUrl", () => {
    const config: LingxingProxyConfig = {
      enabled: true,
      protocol: "http",
      host: "",
      port: "",
    };
    expect(buildLingxingProxyUrl(config)).toBeUndefined();
  });

  it("trims whitespace from directUrl", () => {
    const config: LingxingProxyConfig = {
      enabled: true,
      protocol: "http",
      host: "",
      port: "",
      directUrl: "  http://proxy.example.com:8080  ",
    };
    expect(buildLingxingProxyUrl(config)).toBe("http://proxy.example.com:8080");
  });

  it("ignores empty directUrl and falls back to components", () => {
    const config: LingxingProxyConfig = {
      enabled: true,
      protocol: "https",
      host: "myproxy.com",
      port: "443",
      directUrl: "",
    };
    expect(buildLingxingProxyUrl(config)).toBe("https://myproxy.com:443");
  });
});

describe("Lingxing Adapter - Proxy Config Management", () => {
  it("should update proxy config on adapter", () => {
    const adapter = getLingxingAdapter();
    expect(adapter.isProxyEnabled()).toBe(false);

    adapter.updateProxyConfig({
      enabled: true,
      protocol: "http",
      host: "test-proxy.com",
      port: "8080",
    });
    expect(adapter.isProxyEnabled()).toBe(true);

    const config = adapter.getProxyConfig();
    expect(config.enabled).toBe(true);
    expect(config.host).toBe("test-proxy.com");
    expect(config.port).toBe("8080");
    expect(config.protocol).toBe("http");

    // Cleanup
    adapter.updateProxyConfig({ enabled: false, host: "", port: "" });
    expect(adapter.isProxyEnabled()).toBe(false);
  });

  it("should report proxy status in getConfig", () => {
    const adapter = getLingxingAdapter();
    adapter.updateProxyConfig({ enabled: false });
    const config1 = adapter.getConfig();
    expect(config1.proxyEnabled).toBe(false);

    adapter.updateProxyConfig({ enabled: true, host: "test.com", port: "80" });
    const config2 = adapter.getConfig();
    expect(config2.proxyEnabled).toBe(true);

    // Cleanup
    adapter.updateProxyConfig({ enabled: false, host: "", port: "" });
  });

  it("should include usedProxy in API call logs", async () => {
    const adapter = getLingxingAdapter();
    adapter.setMockMode(true);
    await adapter.request({ path: "/erp/sc/data/seller/lists", skipCache: true });
    const logs = adapter.getRecentLogs();
    const lastLog = logs[logs.length - 1];
    expect(lastLog).toHaveProperty("usedProxy");
    expect(typeof lastLog.usedProxy).toBe("boolean");
  });
});

describe("Lingxing Adapter - LX_PROXY_KEYS", () => {
  it("should have correct key definitions", async () => {
    const { LX_PROXY_KEYS } = await import("./routers/systemSettings");
    expect(LX_PROXY_KEYS.ENABLED).toBe("lx_proxy_enabled");
    expect(LX_PROXY_KEYS.PROTOCOL).toBe("lx_proxy_protocol");
    expect(LX_PROXY_KEYS.HOST).toBe("lx_proxy_host");
    expect(LX_PROXY_KEYS.PORT).toBe("lx_proxy_port");
    expect(LX_PROXY_KEYS.USERNAME).toBe("lx_proxy_username");
    expect(LX_PROXY_KEYS.PASSWORD).toBe("lx_proxy_password");
    expect(LX_PROXY_KEYS.URL).toBe("lx_proxy_url");
  });
});
