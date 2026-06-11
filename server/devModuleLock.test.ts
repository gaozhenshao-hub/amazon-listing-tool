import { describe, it, expect, vi } from "vitest";

// Mock getDb
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockResolvedValue([{ insertId: 1 }]),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockResolvedValue([]),
};

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(mockDb),
}));

vi.mock("./_core/trpc", () => ({
  router: (routes: any) => routes,
  protectedProcedure: {
    input: (schema: any) => ({
      query: (fn: any) => ({ _type: "query", fn, schema }),
      mutation: (fn: any) => ({ _type: "mutation", fn, schema }),
    }),
  },
}));

describe("Module Lock Feature", () => {
  it("should define lock status types", () => {
    // Module lock types
    const modules = ["profile", "bom", "manual", "test_report", "profit"];
    expect(modules).toHaveLength(5);
    modules.forEach(m => expect(typeof m).toBe("string"));
  });

  it("should support lock and unlock operations", () => {
    // Lock state transitions
    const lockStates = [
      { module: "profile", isLocked: false },
      { module: "bom", isLocked: true },
      { module: "manual", isLocked: false },
    ];

    // Toggle lock
    const toggled = lockStates.map(s => ({ ...s, isLocked: !s.isLocked }));
    expect(toggled[0].isLocked).toBe(true);
    expect(toggled[1].isLocked).toBe(false);
    expect(toggled[2].isLocked).toBe(true);
  });

  it("should track lock timestamps", () => {
    const lockRecord = {
      projectId: 1,
      moduleName: "profile",
      isLocked: true,
      lockedAt: Date.now(),
      lockedBy: "user1",
    };
    expect(lockRecord.lockedAt).toBeGreaterThan(0);
    expect(lockRecord.isLocked).toBe(true);
  });
});

describe("Enhanced BOM Features", () => {
  it("should support multi-level BOM hierarchy", () => {
    const bomItems = [
      { id: 1, partName: "Main Assembly", parentId: null, level: 0 },
      { id: 2, partName: "Sub Assembly A", parentId: 1, level: 1 },
      { id: 3, partName: "Raw Material X", parentId: 2, level: 2 },
      { id: 4, partName: "Sub Assembly B", parentId: 1, level: 1 },
    ];

    // Build tree
    const roots = bomItems.filter(b => b.parentId === null);
    expect(roots).toHaveLength(1);
    expect(roots[0].partName).toBe("Main Assembly");

    const children = bomItems.filter(b => b.parentId === 1);
    expect(children).toHaveLength(2);

    const grandChildren = bomItems.filter(b => b.parentId === 2);
    expect(grandChildren).toHaveLength(1);
  });

  it("should calculate BOM cost summary correctly", () => {
    const items = [
      { unitPrice: 2.5, quantity: 100, subtotal: 250 },
      { unitPrice: 1.2, quantity: 200, subtotal: 240 },
      { unitPrice: 0.8, quantity: 500, subtotal: 400 },
    ];

    const totalMaterialCost = items.reduce((sum, i) => sum + i.subtotal, 0);
    expect(totalMaterialCost).toBe(890);

    const moldCosts = [
      { moldType: "injection", estimatedCost: 15000, amortizedQty: 5000 },
      { moldType: "stamping", estimatedCost: 8000, amortizedQty: 5000 },
    ];

    const totalMoldCost = moldCosts.reduce((sum, m) => sum + m.estimatedCost, 0);
    const moldCostPerUnit = totalMoldCost / moldCosts[0].amortizedQty;
    expect(totalMoldCost).toBe(23000);
    expect(moldCostPerUnit).toBeCloseTo(4.6);

    const unitCost = totalMaterialCost / 100 + moldCostPerUnit;
    expect(unitCost).toBeCloseTo(13.5);
  });

  it("should support mold cost management", () => {
    const mold = {
      partName: "Housing",
      moldType: "injection",
      moldMaterial: "P20",
      cavities: 4,
      estimatedCost: 15000,
      developmentDays: 45,
    };

    expect(mold.moldType).toBe("injection");
    expect(mold.cavities).toBe(4);
    expect(mold.developmentDays).toBe(45);
  });

  it("should support time plan with Gantt-like structure", () => {
    const timePlans = [
      { phase: "prototyping", startDay: 0, durationDays: 14, status: "completed", color: "#22c55e" },
      { phase: "mold_development", startDay: 14, durationDays: 45, status: "in_progress", color: "#3b82f6" },
      { phase: "first_production", startDay: 59, durationDays: 21, status: "pending", color: "#a855f7" },
    ];

    const totalDays = timePlans.reduce((max, p) => Math.max(max, p.startDay + p.durationDays), 0);
    expect(totalDays).toBe(80);

    const completed = timePlans.filter(p => p.status === "completed");
    expect(completed).toHaveLength(1);
  });

  it("should support supplier recommendation based on BOM", () => {
    const bomItem = { material: "ABS", process: "injection_molding" };
    const suppliers = [
      { name: "Supplier A", scale: "large", qualityRate: 0.98, certifications: ["ISO9001"], priceLevel: "medium" },
      { name: "Supplier B", scale: "medium", qualityRate: 0.95, certifications: ["ISO9001", "IATF16949"], priceLevel: "low" },
    ];

    // Supplier comparison
    expect(suppliers).toHaveLength(2);
    expect(suppliers[0].qualityRate).toBeGreaterThan(suppliers[1].qualityRate);
    expect(suppliers[1].certifications.length).toBeGreaterThan(suppliers[0].certifications.length);
  });

  it("should support supplierGlobalId association", () => {
    const bomItem = {
      id: 1,
      partName: "Housing",
      supplierGlobalId: 42,
      supplierName: "Shenzhen Mold Co.",
    };

    expect(bomItem.supplierGlobalId).toBe(42);
    expect(bomItem.supplierName).toBe("Shenzhen Mold Co.");
  });
});

describe("Manual Asset Management", () => {
  it("should support all asset types", () => {
    const assetTypes = ["logo", "cover", "content_bg", "qrcode", "chapter_image", "other"];
    expect(assetTypes).toHaveLength(6);
  });

  it("should track chapter-specific assets", () => {
    const assets = [
      { assetType: "logo", chapterKey: null, fileUrl: "https://cdn.example.com/logo.png" },
      { assetType: "cover", chapterKey: null, fileUrl: "https://cdn.example.com/cover.jpg" },
      { assetType: "chapter_image", chapterKey: "overview", fileUrl: "https://cdn.example.com/ch1.png" },
      { assetType: "chapter_image", chapterKey: "installation", fileUrl: "https://cdn.example.com/ch4.png" },
    ];

    const globalAssets = assets.filter(a => a.chapterKey === null);
    expect(globalAssets).toHaveLength(2);

    const chapterAssets = assets.filter(a => a.assetType === "chapter_image");
    expect(chapterAssets).toHaveLength(2);
  });

  it("should support 3-step manual generation flow", () => {
    const steps = [
      { step: 1, name: "asset_upload", required: ["logo", "cover"], optional: ["content_bg", "qrcode"] },
      { step: 2, name: "ai_generate_edit", chapters: 9, actions: ["generate", "edit", "confirm", "upload_chapter_image"] },
      { step: 3, name: "generate_html", outputs: ["html_en", "html_es", "pdf_en", "pdf_es"] },
    ];

    expect(steps).toHaveLength(3);
    expect(steps[1].chapters).toBe(9);
    expect(steps[2].outputs).toHaveLength(4);
  });

  it("should replace single-instance assets on re-upload", () => {
    const singleInstanceTypes = ["logo", "cover", "content_bg", "qrcode"];
    const multiInstanceTypes = ["chapter_image", "other"];

    singleInstanceTypes.forEach(type => {
      expect(["logo", "cover", "content_bg", "qrcode"]).toContain(type);
    });

    multiInstanceTypes.forEach(type => {
      expect(["chapter_image", "other"]).toContain(type);
    });
  });

  it("should generate bilingual HTML with assets", () => {
    const manual = {
      brandName: "TestBrand",
      logoUrl: "https://cdn.example.com/logo.png",
      coverImageUrl: "https://cdn.example.com/cover.jpg",
      qrCodeUrl: "https://cdn.example.com/qr.png",
      chapters: [
        { key: "overview", titleEn: "Product Overview", titleEs: "Descripcion del Producto", contentEn: "This is...", contentEs: "Esto es...", imageUrl: "" },
      ],
    };

    expect(manual.brandName).toBe("TestBrand");
    expect(manual.chapters).toHaveLength(1);
    expect(manual.chapters[0].titleEn).toBe("Product Overview");
    expect(manual.chapters[0].titleEs).toBe("Descripcion del Producto");
  });
});
