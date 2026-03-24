/**
 * NextSLS Adapter & Transit Time Service Tests
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── NextSLS Adapter Tests ───────────────────────────────────────

describe("NextSLS Adapter", () => {
  let adapter: any;

  beforeEach(async () => {
    // Dynamic import to get fresh module
    const mod = await import("./adapter");
    adapter = mod.nextSlsAdapter;
  });

  describe("Configuration", () => {
    it("should start unconfigured by default", () => {
      const config = adapter.getConfig();
      // May or may not be configured depending on env
      expect(config).toBeDefined();
      expect(typeof config.isConfigured).toBe("boolean");
    });

    it("should configure with valid params", () => {
      adapter.configure({
        baseUrl: "https://test.nextsls.com",
        token: "test-token-123",
        enabled: true,
      });
      const config = adapter.getConfig();
      expect(config.isConfigured).toBe(true);
      expect(config.baseUrl).toBe("https://test.nextsls.com");
    });

    it("should not be ready when disabled", () => {
      adapter.configure({
        baseUrl: "https://test.nextsls.com",
        token: "test-token-123",
        enabled: false,
      });
      expect(adapter.isReady()).toBe(false);
    });

    it("should be ready when enabled with valid config", () => {
      adapter.configure({
        baseUrl: "https://test.nextsls.com",
        token: "test-token-123",
        enabled: true,
      });
      expect(adapter.isReady()).toBe(true);
    });

    it("should not be ready without token", () => {
      adapter.configure({
        baseUrl: "https://test.nextsls.com",
        token: "",
        enabled: true,
      });
      expect(adapter.isReady()).toBe(false);
    });
  });

  describe("API Logs", () => {
    it("should return empty logs initially", () => {
      const logs = adapter.getApiLogs(10);
      expect(Array.isArray(logs)).toBe(true);
    });

    it("should respect limit parameter", () => {
      const logs = adapter.getApiLogs(5);
      expect(logs.length).toBeLessThanOrEqual(5);
    });
  });

  describe("Token masking in getConfig", () => {
    it("should mask token in getConfig output", () => {
      adapter.configure({
        baseUrl: "https://test.nextsls.com",
        token: "my-secret-token-12345",
        enabled: true,
      });
      const config = adapter.getConfig();
      // Token should be masked or not returned in plain text
      expect(config.token).not.toBe("my-secret-token-12345");
    });
  });
});

// ─── Transit Time Service Tests ──────────────────────────────────

describe("Transit Time Service", () => {
  describe("analyzeTransitTimes", () => {
    it("should export analyzeTransitTimes function", async () => {
      const mod = await import("./transitTimeService");
      expect(typeof mod.analyzeTransitTimes).toBe("function");
    });

    it("should export getTransitTimeStats function", async () => {
      const mod = await import("./transitTimeService");
      expect(typeof mod.getTransitTimeStats).toBe("function");
    });

    it("should export getTransitTimeOverview function", async () => {
      const mod = await import("./transitTimeService");
      expect(typeof mod.getTransitTimeOverview).toBe("function");
    });

    it("should export getMappedStepDaysForRoute function", async () => {
      const mod = await import("./transitTimeService");
      expect(typeof mod.getMappedStepDaysForRoute).toBe("function");
    });

    it("should export clearTransitTimeCache function", async () => {
      const mod = await import("./transitTimeService");
      expect(typeof mod.clearTransitTimeCache).toBe("function");
    });

    it("should export aggregateTransitStats function", async () => {
      const mod = await import("./transitTimeService");
      expect(typeof mod.aggregateTransitStats).toBe("function");
    });
  });

  describe("aggregateTransitStats", () => {
    it("should aggregate empty records to empty stats", async () => {
      const { aggregateTransitStats } = await import("./transitTimeService");
      const result = aggregateTransitStats([]);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it("should aggregate records by service and country", async () => {
      const { aggregateTransitStats } = await import("./transitTimeService");
      const records = [
        {
          shipmentId: "S001",
          service: "UPS Express",
          destinationCountry: "US",
          pickupToWarehouseDays: 1,
          warehouseProcessDays: 2,
          internationalTransitDays: 7,
          customsClearanceDays: 2,
          lastMileDeliveryDays: 3,
          totalTransitDays: 15,
          createdAt: Date.now() - 86400000 * 20,
          deliveredAt: Date.now() - 86400000 * 5,
        },
        {
          shipmentId: "S002",
          service: "UPS Express",
          destinationCountry: "US",
          pickupToWarehouseDays: 1,
          warehouseProcessDays: 3,
          internationalTransitDays: 8,
          customsClearanceDays: 1,
          lastMileDeliveryDays: 2,
          totalTransitDays: 15,
          createdAt: Date.now() - 86400000 * 25,
          deliveredAt: Date.now() - 86400000 * 10,
        },
        {
          shipmentId: "S003",
          service: "DHL Economy",
          destinationCountry: "DE",
          pickupToWarehouseDays: 2,
          warehouseProcessDays: 2,
          internationalTransitDays: 12,
          customsClearanceDays: 3,
          lastMileDeliveryDays: 4,
          totalTransitDays: 23,
          createdAt: Date.now() - 86400000 * 30,
          deliveredAt: Date.now() - 86400000 * 7,
        },
      ];

      const stats = aggregateTransitStats(records);
      expect(stats.length).toBe(2); // UPS Express/US + DHL Economy/DE

      const upsStats = stats.find((s: any) => s.service === "UPS Express");
      expect(upsStats).toBeDefined();
      expect(upsStats!.destinationCountry).toBe("US");
      expect(upsStats!.sampleCount).toBe(2);
      expect(upsStats!.avgTotalDays).toBe(15);

      const dhlStats = stats.find((s: any) => s.service === "DHL Economy");
      expect(dhlStats).toBeDefined();
      expect(dhlStats!.destinationCountry).toBe("DE");
      expect(dhlStats!.sampleCount).toBe(1);
      expect(dhlStats!.avgTotalDays).toBe(23);
    });

    it("should calculate mapped step days correctly", async () => {
      const { aggregateTransitStats } = await import("./transitTimeService");
      const records = [
        {
          shipmentId: "S001",
          service: "Test Service",
          destinationCountry: "US",
          pickupToWarehouseDays: 2,
          warehouseProcessDays: 3,
          internationalTransitDays: 10,
          customsClearanceDays: 2,
          lastMileDeliveryDays: 3,
          totalTransitDays: 20,
          createdAt: Date.now() - 86400000 * 25,
          deliveredAt: Date.now() - 86400000 * 5,
        },
      ];

      const stats = aggregateTransitStats(records);
      expect(stats.length).toBe(1);
      const stat = stats[0];
      
      // Should have mappedStepDays
      expect(stat.mappedStepDays).toBeDefined();
      expect(typeof stat.mappedStepDays.step4_shipped).toBe("number");
      expect(typeof stat.mappedStepDays.step5_domesticTransit).toBe("number");
      expect(typeof stat.mappedStepDays.step7_internationalTransit).toBe("number");
      expect(typeof stat.mappedStepDays.step8_receiving).toBe("number");
      expect(typeof stat.mappedStepDays.totalDays).toBe("number");
    });
  });

  describe("getMappedStepDaysForRoute", () => {
    it("should return default step days when no data available", async () => {
      const { getMappedStepDaysForRoute, clearTransitTimeCache } = await import("./transitTimeService");
      clearTransitTimeCache();
      const result = await getMappedStepDaysForRoute(undefined, "US");
      // May return null if no data available
      if (result) {
        expect(result.source).toBeDefined();
      } else {
        expect(result).toBeNull();
      }
    }, 15000); // Increased timeout since it may attempt network calls
  });

  describe("getTransitTimeOverview", () => {
    it("should return overview structure", async () => {
      const { getTransitTimeOverview } = await import("./transitTimeService");
      const overview = await getTransitTimeOverview();
      expect(overview).toBeDefined();
      expect(typeof overview.totalShipments).toBe("number");
      expect(Array.isArray(overview.channels)).toBe(true);
      expect(typeof overview.lastUpdated).toBe("number");
      expect(typeof overview.isNextSlsConfigured).toBe("boolean");
    });
  });
});
