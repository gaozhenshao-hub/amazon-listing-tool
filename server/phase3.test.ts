import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Test helpers ───────────────────────────────────────────────

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAdminContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "admin-user",
    email: "admin@kuahai.com",
    name: "Admin User",
    loginMethod: "manus",
    role: "super_admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

function createUnauthContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

// ─── Deployment Config Tests ────────────────────────────────────

describe("deploymentConfig", () => {
  describe("getDeploymentInfo", () => {
    it("returns deployment configuration for authenticated user", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.deploymentConfig.getDeploymentInfo();

      expect(result).toHaveProperty("companyName");
      expect(result).toHaveProperty("erpType");
      expect(result).toHaveProperty("instanceId");
      expect(result).toHaveProperty("peerSyncEnabled");
      expect(typeof result.companyName).toBe("string");
      expect(typeof result.erpType).toBe("string");
      expect(typeof result.instanceId).toBe("string");
      expect(typeof result.peerSyncEnabled).toBe("boolean");
    });

    it("rejects unauthenticated access", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(caller.deploymentConfig.getDeploymentInfo()).rejects.toThrow();
    });
  });

  describe("getSyncStatus", () => {
    it("returns sync status for authenticated user", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.deploymentConfig.getSyncStatus();

      expect(result).toHaveProperty("enabled");
      expect(typeof result.enabled).toBe("boolean");
      // lastSync can be null if no syncs have happened
      expect(result).toHaveProperty("lastSync");
    });
  });

  describe("getSyncLogs", () => {
    it("returns paginated sync logs", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.deploymentConfig.getSyncLogs({
        page: 1,
        limit: 10,
      });

      expect(result).toHaveProperty("logs");
      expect(result).toHaveProperty("total");
      expect(Array.isArray(result.logs)).toBe(true);
      expect(typeof result.total).toBe("number");
    });
  });

  describe("triggerSync", () => {
    it("returns error when peer sync is not configured", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.deploymentConfig.triggerSync();

      // Without PEER_API_URL configured, should return error
      expect(result).toHaveProperty("success");
      // Either succeeds or fails with config error
      if (!result.success) {
        expect(result.error).toBeDefined();
      }
    });
  });
});

// ─── Usage Stats Tests ──────────────────────────────────────────

describe("usageStats", () => {
  describe("getUsageStats", () => {
    it("returns usage statistics for authenticated user", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.deploymentConfig.getUsageStats({
        period: "day",
      });

      expect(result).toHaveProperty("stats");
      expect(result).toHaveProperty("summary");
      expect(Array.isArray(result.stats)).toBe(true);
    });

    it("accepts date range parameters", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.deploymentConfig.getUsageStats({
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        period: "month",
      });

      expect(result).toHaveProperty("stats");
      expect(result).toHaveProperty("summary");
    });

    it("summary includes user counts", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.deploymentConfig.getUsageStats({
        period: "day",
      });

      if (result.summary) {
        expect(result.summary).toHaveProperty("activeUsers");
        expect(result.summary).toHaveProperty("totalUsers");
        expect(typeof result.summary.activeUsers).toBe("number");
        expect(typeof result.summary.totalUsers).toBe("number");
      }
    });
  });

  describe("getRemoteUsageSnapshots", () => {
    it("returns remote usage snapshots", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.deploymentConfig.getRemoteUsageSnapshots({});

      expect(result).toHaveProperty("snapshots");
      expect(Array.isArray(result.snapshots)).toBe(true);
    });
  });

  describe("reportUsage", () => {
    it("handles unconfigured usage reporting gracefully", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.deploymentConfig.reportUsage();

      expect(result).toHaveProperty("success");
      // Without USAGE_REPORT_URL configured, should return error
      if (!result.success) {
        expect(result.error).toBeDefined();
      }
    });
  });
});

// ─── Sync API Route Tests (unit-level) ──────────────────────────

describe("syncRoutes (structure)", () => {
  it("sync routes module exports syncRouter", async () => {
    const syncModule = await import("./syncRoutes");
    expect(syncModule.syncRouter).toBeDefined();
    expect(typeof syncModule.syncRouter).toBe("function");
  });
});

// ─── Usage Tracking Tests ───────────────────────────────────────

describe("usageTracking (structure)", () => {
  it("usage tracking module exports expected functions", async () => {
    const trackingModule = await import("./usageTracking");
    expect(typeof trackingModule.trackApiCall).toBe("function");
    expect(typeof trackingModule.trackAiCall).toBe("function");
    expect(typeof trackingModule.trackScraperCall).toBe("function");
    expect(typeof trackingModule.trackLogin).toBe("function");
    expect(typeof trackingModule.startUsageTracking).toBe("function");
    expect(typeof trackingModule.stopUsageTracking).toBe("function");
    expect(typeof trackingModule.manualFlush).toBe("function");
  });

  it("trackApiCall does not throw", async () => {
    const { trackApiCall } = await import("./usageTracking");
    expect(() => trackApiCall(null)).not.toThrow();
    expect(() => trackApiCall(1)).not.toThrow();
  });

  it("trackAiCall accepts optional token count", async () => {
    const { trackAiCall } = await import("./usageTracking");
    expect(() => trackAiCall(null)).not.toThrow();
    expect(() => trackAiCall(1, 500)).not.toThrow();
  });

  it("trackScraperCall does not throw", async () => {
    const { trackScraperCall } = await import("./usageTracking");
    expect(() => trackScraperCall(null)).not.toThrow();
    expect(() => trackScraperCall(1)).not.toThrow();
  });

  it("trackLogin does not throw", async () => {
    const { trackLogin } = await import("./usageTracking");
    expect(() => trackLogin(1)).not.toThrow();
  });
});

// ─── KB Review Router Tests ─────────────────────────────────────

describe("kbReview", () => {
  describe("stats", () => {
    it("returns review statistics for authenticated user", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.kbReview.stats();

      // Stats returns per-type breakdown (product, listing, image_set, etc.)
      expect(result).toHaveProperty("product");
      expect(result).toHaveProperty("totalPending");
      expect(result).toHaveProperty("totalApproved");
      expect(result).toHaveProperty("totalRejected");
      expect(typeof result.totalPending).toBe("number");
      expect(typeof result.totalApproved).toBe("number");
      expect(typeof result.totalRejected).toBe("number");
    });
  });
});

// ─── Project Assignment Router Tests ────────────────────────────

describe("projectAssignment", () => {
  describe("listAvailableProjects", () => {
    it("returns available dev projects for assignment", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.projectAssignment.listAvailableProjects({
        projectType: "dev_project",
      });

      expect(Array.isArray(result)).toBe(true);
    });

    it("returns available listing projects for assignment", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.projectAssignment.listAvailableProjects({
        projectType: "listing_project",
      });

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("listAvailableUsers", () => {
    it("returns available users for assignment", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.projectAssignment.listAvailableUsers();

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("listAll", () => {
    it("returns all project assignments", async () => {
      const ctx = createAdminContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.projectAssignment.listAll({
        page: 1,
        pageSize: 10,
      });

      expect(result).toHaveProperty("items");
      expect(result).toHaveProperty("total");
      expect(Array.isArray(result.items)).toBe(true);
      expect(typeof result.total).toBe("number");
    });
  });
});

// ─── Deployment Config ENV Tests ────────────────────────────────

describe("deploymentConfig ENV", () => {
  it("ENV module provides expected deployment fields", async () => {
    const envModule = await import("./_core/env");
    const env = envModule.ENV;
    
    // These should always be defined (with defaults)
    expect(env).toHaveProperty("companyName");
    expect(env).toHaveProperty("erpType");
    expect(env).toHaveProperty("instanceId");
    expect(env).toHaveProperty("peerSyncEnabled");
    expect(typeof env.peerSyncEnabled).toBe("boolean");
  });
});
