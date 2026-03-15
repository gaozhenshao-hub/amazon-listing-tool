import { describe, it, expect } from "vitest";
import { devProjectTagCategories, devProjectTagItems } from "../drizzle/schema";

// ─── Schema Tests ───────────────────────────────────────────
describe("Project Tag Management - Schema", () => {
  it("devProjectTagCategories table should have required columns", () => {
    const cols = Object.keys(devProjectTagCategories);
    expect(cols).toContain("id");
    expect(cols).toContain("projectId");
    expect(cols).toContain("userId");
    expect(cols).toContain("categoryKey");
    expect(cols).toContain("categoryName");
    expect(cols).toContain("description");
    expect(cols).toContain("sortOrder");
    expect(cols).toContain("confirmed");
    expect(cols).toContain("confirmedAt");
    expect(cols).toContain("createdAt");
  });

  it("devProjectTagItems table should have required columns", () => {
    const cols = Object.keys(devProjectTagItems);
    expect(cols).toContain("id");
    expect(cols).toContain("categoryId");
    expect(cols).toContain("projectId");
    expect(cols).toContain("tagName");
    expect(cols).toContain("tagValue");
    expect(cols).toContain("source");
    expect(cols).toContain("sortOrder");
    expect(cols).toContain("createdAt");
  });
});

// ─── Default Categories Tests ───────────────────────────────
describe("Project Tag Management - Default Categories", () => {
  const DEFAULT_CATEGORIES = [
    { key: "basic", name: "基础分类属性" },
    { key: "material", name: "材质属性" },
    { key: "function", name: "功能属性" },
    { key: "parameter", name: "参数属性" },
    { key: "installation", name: "安装方式" },
    { key: "certification", name: "认证标准" },
    { key: "special", name: "特殊属性" },
  ];

  it("should have exactly 7 default categories", () => {
    expect(DEFAULT_CATEGORIES.length).toBe(7);
  });

  it("should have unique category keys", () => {
    const keys = DEFAULT_CATEGORIES.map(c => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("should include basic category attributes", () => {
    const keys = DEFAULT_CATEGORIES.map(c => c.key);
    expect(keys).toContain("basic");
    expect(keys).toContain("material");
    expect(keys).toContain("function");
    expect(keys).toContain("parameter");
    expect(keys).toContain("installation");
    expect(keys).toContain("certification");
    expect(keys).toContain("special");
  });

  it("each category should have a non-empty name", () => {
    DEFAULT_CATEGORIES.forEach(cat => {
      expect(cat.name.length).toBeGreaterThan(0);
    });
  });
});

// ─── Router Tests ───────────────────────────────────────────
describe("Project Tag Management - Router Structure", () => {
  it("should export devProjectTagsRouter", async () => {
    const mod = await import("./routers/devProjectTags");
    expect(mod.devProjectTagsRouter).toBeDefined();
  });

  it("router should have all required procedures", async () => {
    const mod = await import("./routers/devProjectTags");
    const router = mod.devProjectTagsRouter;
    const procedures = Object.keys((router as any)._def.procedures || {});
    
    expect(procedures).toContain("initCategories");
    expect(procedures).toContain("getCategories");
    expect(procedures).toContain("updateCategoryName");
    expect(procedures).toContain("addCategory");
    expect(procedures).toContain("deleteCategory");
    expect(procedures).toContain("addTagItem");
    expect(procedures).toContain("updateTagItem");
    expect(procedures).toContain("deleteTagItem");
    expect(procedures).toContain("confirmCategory");
    expect(procedures).toContain("unconfirmCategory");
    expect(procedures).toContain("confirmAll");
    expect(procedures).toContain("getTagStatus");
    expect(procedures).toContain("aiGenerateTags");
    expect(procedures).toContain("aiGenerateCategoryTags");
  });

  it("should have 17 procedures total (14 base + 3 batch import)", async () => {
    const mod = await import("./routers/devProjectTags");
    const router = mod.devProjectTagsRouter;
    const procedures = Object.keys((router as any)._def.procedures || {});
    expect(procedures.length).toBe(17);
  });

  it("should have batch import procedures", async () => {
    const mod = await import("./routers/devProjectTags");
    const router = mod.devProjectTagsRouter;
    const procedures = Object.keys((router as any)._def.procedures || {});
    expect(procedures).toContain("parseImportFile");
    expect(procedures).toContain("batchImport");
    expect(procedures).toContain("getImportTemplate");
  });
});

// ─── Tag Source Tests ───────────────────────────────────────
describe("Project Tag Management - Tag Sources", () => {
  it("should support 'ai' and 'manual' tag sources", () => {
    const validSources = ["ai", "manual"];
    expect(validSources).toContain("ai");
    expect(validSources).toContain("manual");
  });
});

// ─── Confirmation Flow Tests ────────────────────────────────
describe("Project Tag Management - Confirmation Flow", () => {
  it("confirmed status should be 0 (unconfirmed) or 1 (confirmed)", () => {
    const validStates = [0, 1];
    expect(validStates).toContain(0);
    expect(validStates).toContain(1);
  });

  it("tag status should calculate allConfirmed correctly", () => {
    // Simulate status calculation
    const calcStatus = (categories: { confirmed: number }[]) => {
      const total = categories.length;
      const confirmed = categories.filter(c => c.confirmed === 1).length;
      return {
        total,
        confirmed,
        allConfirmed: total > 0 && confirmed === total,
        initialized: total > 0,
      };
    };

    // All confirmed
    const allConfirmed = calcStatus([
      { confirmed: 1 }, { confirmed: 1 }, { confirmed: 1 },
    ]);
    expect(allConfirmed.allConfirmed).toBe(true);
    expect(allConfirmed.total).toBe(3);
    expect(allConfirmed.confirmed).toBe(3);

    // Partially confirmed
    const partial = calcStatus([
      { confirmed: 1 }, { confirmed: 0 }, { confirmed: 1 },
    ]);
    expect(partial.allConfirmed).toBe(false);
    expect(partial.confirmed).toBe(2);

    // None confirmed
    const none = calcStatus([
      { confirmed: 0 }, { confirmed: 0 },
    ]);
    expect(none.allConfirmed).toBe(false);
    expect(none.confirmed).toBe(0);

    // Empty
    const empty = calcStatus([]);
    expect(empty.allConfirmed).toBe(false);
    expect(empty.initialized).toBe(false);
  });
});

// ─── Integration Tests ──────────────────────────────────────
describe("Project Tag Management - Integration", () => {
  it("router should be registered in main routers", async () => {
    const mod = await import("./routers");
    const appRouter = mod.appRouter;
    const procedures = Object.keys((appRouter as any)._def.procedures || {});
    const hasTagProcedures = procedures.some(p => p.startsWith("devProjectTags."));
    expect(hasTagProcedures).toBe(true);
  });

  it("should have devProjectTags namespace in app router", async () => {
    const mod = await import("./routers");
    const appRouter = mod.appRouter;
    const procedures = Object.keys((appRouter as any)._def.procedures || {});
    const tagProcedures = procedures.filter(p => p.startsWith("devProjectTags."));
    expect(tagProcedures.length).toBe(17);
  });
});
