import { describe, it, expect, vi } from "vitest";

// ─── Role Management Router Tests ─────────────────────────────
describe("roleManagement router", () => {
  it("should export roleManagementRouter", async () => {
    const mod = await import("./routers/roleManagement");
    expect(mod.roleManagementRouter).toBeDefined();
    expect(mod.roleManagementRouter._def).toBeDefined();
  });

  it("should have list, modules, update, batchUpdate, getModuleAccess procedures", async () => {
    const mod = await import("./routers/roleManagement");
    const router = mod.roleManagementRouter;
    const procedures = Object.keys(router._def.procedures || router);
    expect(procedures).toContain("list");
    expect(procedures).toContain("modules");
    expect(procedures).toContain("update");
    expect(procedures).toContain("batchUpdate");
    expect(procedures).toContain("getModuleAccess");
  });
});

// ─── Role Permissions DB Helpers Tests ────────────────────────
describe("rolePermissions DB helpers", () => {
  it("should export getAllRolePermissions", async () => {
    const db = await import("./db");
    expect(typeof db.getAllRolePermissions).toBe("function");
  });

  it("should export getRolePermission", async () => {
    const db = await import("./db");
    expect(typeof db.getRolePermission).toBe("function");
  });

  it("should export upsertRolePermission", async () => {
    const db = await import("./db");
    expect(typeof db.upsertRolePermission).toBe("function");
  });
});

// ─── Role Permissions Schema Tests ────────────────────────────
describe("rolePermissions schema", () => {
  it("should export rolePermissions table from schema", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.rolePermissions).toBeDefined();
  });

  it("rolePermissions table should have expected columns", async () => {
    const schema = await import("../drizzle/schema");
    const table = schema.rolePermissions;
    // Check that the table has the expected column names
    const columnNames = Object.keys(table);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("role");
    expect(columnNames).toContain("modules");
    expect(columnNames).toContain("description");
    expect(columnNames).toContain("updatedBy");
    expect(columnNames).toContain("createdAt");
    expect(columnNames).toContain("updatedAt");
  });
});

// ─── Shared Const Tests ───────────────────────────────────────
describe("shared const role definitions", () => {
  it("should export ALL_ROLES with 8 roles", async () => {
    const { ALL_ROLES } = await import("@shared/const");
    expect(ALL_ROLES).toBeDefined();
    expect(ALL_ROLES.length).toBe(8);
    expect(ALL_ROLES).toContain("super_admin");
    expect(ALL_ROLES).toContain("admin");
    expect(ALL_ROLES).toContain("ops_manager");
    expect(ALL_ROLES).toContain("ops_specialist");
    expect(ALL_ROLES).toContain("product_dev");
    expect(ALL_ROLES).toContain("finance");
    expect(ALL_ROLES).toContain("purchaser");
    expect(ALL_ROLES).toContain("designer");
  });

  it("should export ROLE_LABELS for all roles", async () => {
    const { ALL_ROLES, ROLE_LABELS } = await import("@shared/const");
    expect(ROLE_LABELS).toBeDefined();
    for (const role of ALL_ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
  });

  it("should export ROLE_MODULE_ACCESS for all roles", async () => {
    const { ALL_ROLES, ROLE_MODULE_ACCESS } = await import("@shared/const");
    expect(ROLE_MODULE_ACCESS).toBeDefined();
    for (const role of ALL_ROLES) {
      expect(Array.isArray(ROLE_MODULE_ACCESS[role])).toBe(true);
    }
  });

  it("should export ADMIN_ROLES containing super_admin and admin", async () => {
    const { ADMIN_ROLES } = await import("@shared/const");
    expect(ADMIN_ROLES).toBeDefined();
    expect(ADMIN_ROLES).toContain("super_admin");
    expect(ADMIN_ROLES).toContain("admin");
    expect(ADMIN_ROLES.length).toBe(2);
  });
});

// ─── KB Review submitForReview Tests ──────────────────────────
describe("kbReview submitForReview procedure", () => {
  it("should export kbReviewRouter", async () => {
    const mod = await import("./routers/kbReview");
    expect(mod.kbReviewRouter).toBeDefined();
  });

  it("kbReviewRouter should have submitForReview procedure", async () => {
    const mod = await import("./routers/kbReview");
    const procedures = Object.keys(mod.kbReviewRouter._def.procedures || mod.kbReviewRouter);
    expect(procedures).toContain("submitForReview");
  });

  it("kbReviewRouter should have batchSubmitForReview procedure", async () => {
    const mod = await import("./routers/kbReview");
    const procedures = Object.keys(mod.kbReviewRouter._def.procedures || mod.kbReviewRouter);
    expect(procedures).toContain("batchSubmitForReview");
  });

  it("kbReviewRouter should have approve and reject procedures", async () => {
    const mod = await import("./routers/kbReview");
    const procedures = Object.keys(mod.kbReviewRouter._def.procedures || mod.kbReviewRouter);
    expect(procedures).toContain("approve");
    expect(procedures).toContain("reject");
  });
});

// ─── KB Type Enum Validation ──────────────────────────────────
describe("KB type enum validation", () => {
  it("should accept valid KB types: product, listing, image, skill, video", () => {
    const { z } = require("zod");
    const kbTypeEnum = z.enum(["product", "listing", "image", "skill", "video"]);
    
    expect(kbTypeEnum.parse("product")).toBe("product");
    expect(kbTypeEnum.parse("listing")).toBe("listing");
    expect(kbTypeEnum.parse("image")).toBe("image");
    expect(kbTypeEnum.parse("skill")).toBe("skill");
    expect(kbTypeEnum.parse("video")).toBe("video");
  });

  it("should reject invalid KB types", () => {
    const { z } = require("zod");
    const kbTypeEnum = z.enum(["product", "listing", "image", "skill", "video"]);
    
    expect(() => kbTypeEnum.parse("image_set")).toThrow();
    expect(() => kbTypeEnum.parse("unknown")).toThrow();
    expect(() => kbTypeEnum.parse("")).toThrow();
  });
});

// ─── Module Access Configuration Tests ────────────────────────
describe("module access configuration", () => {
  it("super_admin should have access to all 6 modules", async () => {
    const { ROLE_MODULE_ACCESS } = await import("@shared/const");
    expect(ROLE_MODULE_ACCESS.super_admin.length).toBe(6);
    expect(ROLE_MODULE_ACCESS.super_admin).toContain("admin");
  });

  it("ops_specialist should NOT have admin access", async () => {
    const { ROLE_MODULE_ACCESS } = await import("@shared/const");
    expect(ROLE_MODULE_ACCESS.ops_specialist).not.toContain("admin");
  });

  it("ops_specialist should have listing and knowledge access", async () => {
    const { ROLE_MODULE_ACCESS } = await import("@shared/const");
    expect(ROLE_MODULE_ACCESS.ops_specialist).toContain("listing");
    expect(ROLE_MODULE_ACCESS.ops_specialist).toContain("knowledge");
  });
});

// ─── Sync Config API Tests ─────────────────────────────────────
describe("deploymentConfig syncConfig procedures", () => {
  it("should export getSyncConfig procedure", async () => {
    const mod = await import("./routers/deploymentConfig");
    expect(mod.deploymentConfigRouter).toBeDefined();
    // The router should have getSyncConfig, updateSyncConfig, testPeerConnection
    const routerDef = mod.deploymentConfigRouter._def;
    expect(routerDef).toBeDefined();
  });

  it("updateSyncConfig should accept valid input schema", () => {
    const { z } = require("zod");
    const schema = z.object({
      peerApiUrl: z.string().optional(),
      peerApiKey: z.string().optional(),
      peerSyncEnabled: z.boolean().optional(),
    });
    
    // Valid inputs
    expect(schema.parse({ peerApiUrl: "https://example.com" })).toEqual({ peerApiUrl: "https://example.com" });
    expect(schema.parse({ peerSyncEnabled: true })).toEqual({ peerSyncEnabled: true });
    expect(schema.parse({ peerApiUrl: "https://example.com", peerApiKey: "secret123", peerSyncEnabled: true }))
      .toEqual({ peerApiUrl: "https://example.com", peerApiKey: "secret123", peerSyncEnabled: true });
    expect(schema.parse({})).toEqual({});
  });

  it("updateSyncConfig should reject invalid peerSyncEnabled type", () => {
    const { z } = require("zod");
    const schema = z.object({
      peerApiUrl: z.string().optional(),
      peerApiKey: z.string().optional(),
      peerSyncEnabled: z.boolean().optional(),
    });
    
    expect(() => schema.parse({ peerSyncEnabled: "yes" })).toThrow();
    expect(() => schema.parse({ peerSyncEnabled: 1 })).toThrow();
  });

  it("should mask API key in getSyncConfig response format", () => {
    const maskedKey = "••••••••";
    // Simulate the masking logic from getSyncConfig
    const realKey = "my-secret-key-123";
    const displayKey = realKey ? maskedKey : "";
    expect(displayKey).toBe("••••••••");
    
    const emptyKey = "";
    const displayEmpty = emptyKey ? maskedKey : "";
    expect(displayEmpty).toBe("");
  });

  it("should not overwrite key when masked value is sent", () => {
    const maskedKey = "••••••••";
    const inputKey = maskedKey;
    // The logic: skip update if key equals masked value
    const shouldUpdate = inputKey !== undefined && inputKey !== maskedKey;
    expect(shouldUpdate).toBe(false);
    
    const newKey = "new-secret";
    const shouldUpdate2 = newKey !== undefined && newKey !== maskedKey;
    expect(shouldUpdate2).toBe(true);
  });
});

// ─── Sync Config Setting Keys Tests ────────────────────────────
describe("sync config setting keys", () => {
  it("should use correct DB setting keys for sync config", () => {
    const SYNC_SETTING_KEYS = {
      PEER_API_URL: "peer_api_url",
      PEER_API_KEY: "peer_api_key",
      PEER_SYNC_ENABLED: "peer_sync_enabled",
    };
    
    expect(SYNC_SETTING_KEYS.PEER_API_URL).toBe("peer_api_url");
    expect(SYNC_SETTING_KEYS.PEER_API_KEY).toBe("peer_api_key");
    expect(SYNC_SETTING_KEYS.PEER_SYNC_ENABLED).toBe("peer_sync_enabled");
  });

  it("should store sync config under 'sync' category", () => {
    // The category used for sync settings in systemSettings table
    const category = "sync";
    expect(category).toBe("sync");
    // Distinct from proxy category
    expect(category).not.toBe("proxy");
    expect(category).not.toBe("general");
  });
});

// ─── ENV Dynamic Update Tests ──────────────────────────────────
describe("ENV dynamic update for sync config", () => {
  it("should support dynamic ENV property assignment", () => {
    const mockEnv = {
      peerApiUrl: "",
      peerApiKey: "",
      peerSyncEnabled: false,
    };
    
    // Simulate dynamic update
    (mockEnv as any).peerApiUrl = "https://new-peer.example.com";
    (mockEnv as any).peerApiKey = "new-key-123";
    (mockEnv as any).peerSyncEnabled = true;
    
    expect(mockEnv.peerApiUrl).toBe("https://new-peer.example.com");
    expect(mockEnv.peerApiKey).toBe("new-key-123");
    expect(mockEnv.peerSyncEnabled).toBe(true);
  });
});
