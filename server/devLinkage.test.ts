import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock devDb module
vi.mock("./devDb", () => ({
  getDevProductProfile: vi.fn(),
  getDevBomItems: vi.fn(),
  getDevMoldCosts: vi.fn(),
  getDevBomSummary: vi.fn(),
  saveDevBomItem: vi.fn(),
  getDevGlobalSuppliers: vi.fn(),
  saveDevGlobalSupplier: vi.fn(),
  deleteDevGlobalSupplier: vi.fn(),
}));

import * as devDb from "./devDb";

const mockedDevDb = vi.mocked(devDb);

function createAuthContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-user",
      email: "test@example.com",
      name: "Test User",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("devLinkage router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getProfileCostData", () => {
    it("returns available=false when no profile exists", async () => {
      mockedDevDb.getDevProductProfile.mockResolvedValue(null as any);
      const caller = appRouter.createCaller(createAuthContext());
      const result = await caller.devLinkage.getProfileCostData({ projectId: 1 });
      expect(result.available).toBe(false);
      expect(result.breakdown).toEqual([]);
      expect(result.totalCost).toBe(0);
    });

    it("returns available=false when profile has no cost data", async () => {
      mockedDevDb.getDevProductProfile.mockResolvedValue({
        id: 1,
        projectId: 1,
        costConfirmed: 0,
        costBreakdown: null,
        costAiSuggestion: null,
        updatedAt: new Date(),
      } as any);
      const caller = appRouter.createCaller(createAuthContext());
      const result = await caller.devLinkage.getProfileCostData({ projectId: 1 });
      expect(result.available).toBe(false);
    });

    it("returns structured cost data when profile has cost breakdown", async () => {
      const costData = {
        breakdown: [
          { item: "PCB板", estimatedCost: "15.00", percentage: "30%", note: "FR4材质" },
          { item: "外壳", estimatedCost: "8.50", percentage: "17%", note: "ABS注塑" },
        ],
        targetRetailPrice: "$29.99",
        targetMargin: "35%",
        costOptimizationTips: ["批量采购可降低成本"],
      };
      mockedDevDb.getDevProductProfile.mockResolvedValue({
        id: 1,
        projectId: 1,
        costConfirmed: 1,
        costBreakdown: JSON.stringify(costData),
        costAiSuggestion: null,
        updatedAt: new Date("2026-03-17"),
      } as any);

      const caller = appRouter.createCaller(createAuthContext());
      const result = await caller.devLinkage.getProfileCostData({ projectId: 1 });

      expect(result.available).toBe(true);
      expect(result.confirmed).toBe(true);
      expect(result.breakdown).toHaveLength(2);
      expect(result.breakdown[0].item).toBe("PCB板");
      expect(result.totalCost).toBe(23.5);
      expect(result.targetRetailPrice).toBe("$29.99");
      expect(result.costOptimizationTips).toHaveLength(1);
    });
  });

  describe("getLinkageStatus", () => {
    it("returns empty status when no data exists", async () => {
      mockedDevDb.getDevProductProfile.mockResolvedValue(null as any);
      mockedDevDb.getDevBomItems.mockResolvedValue([]);
      mockedDevDb.getDevMoldCosts.mockResolvedValue([]);
      mockedDevDb.getDevBomSummary.mockResolvedValue(null as any);

      const caller = appRouter.createCaller(createAuthContext());
      const result = await caller.devLinkage.getLinkageStatus({ projectId: 1 });

      expect(result.profileCost.available).toBe(false);
      expect(result.bom.hasData).toBe(false);
      expect(result.profitSummary.hasData).toBe(false);
      expect(result.syncWarnings.profileNewerThanBom).toBe(false);
      expect(result.syncWarnings.bomNewerThanSummary).toBe(false);
    });

    it("detects profile newer than BOM sync warning", async () => {
      const profileDate = new Date("2026-03-17T10:00:00Z");
      const bomDate = new Date("2026-03-17T08:00:00Z");

      mockedDevDb.getDevProductProfile.mockResolvedValue({
        id: 1,
        projectId: 1,
        costConfirmed: 1,
        costBreakdown: JSON.stringify({ breakdown: [{ item: "A", estimatedCost: "10" }] }),
        updatedAt: profileDate,
      } as any);
      mockedDevDb.getDevBomItems.mockResolvedValue([
        { id: 1, partName: "Part A", unitPrice: "10", quantity: 1, updatedAt: bomDate } as any,
      ]);
      mockedDevDb.getDevMoldCosts.mockResolvedValue([]);
      mockedDevDb.getDevBomSummary.mockResolvedValue(null as any);

      const caller = appRouter.createCaller(createAuthContext());
      const result = await caller.devLinkage.getLinkageStatus({ projectId: 1 });

      expect(result.profileCost.available).toBe(true);
      expect(result.profileCost.confirmed).toBe(true);
      expect(result.bom.hasData).toBe(true);
      expect(result.bom.totalMaterialCost).toBe(10);
      expect(result.syncWarnings.profileNewerThanBom).toBe(true);
    });

    it("calculates BOM totals correctly", async () => {
      mockedDevDb.getDevProductProfile.mockResolvedValue(null as any);
      mockedDevDb.getDevBomItems.mockResolvedValue([
        { id: 1, partName: "A", unitPrice: "5.50", quantity: 2, updatedAt: new Date() } as any,
        { id: 2, partName: "B", unitPrice: "3.00", quantity: 3, updatedAt: new Date() } as any,
      ]);
      mockedDevDb.getDevMoldCosts.mockResolvedValue([
        { id: 1, estimatedCost: "2000" } as any,
      ]);
      mockedDevDb.getDevBomSummary.mockResolvedValue(null as any);

      const caller = appRouter.createCaller(createAuthContext());
      const result = await caller.devLinkage.getLinkageStatus({ projectId: 1 });

      expect(result.bom.itemCount).toBe(2);
      expect(result.bom.totalMaterialCost).toBe(20); // 5.5*2 + 3*3
      expect(result.bom.totalMoldCost).toBe(2000);
    });
  });

  describe("getBomCostForProfit", () => {
    it("returns BOM and profile cost data for profit calculator", async () => {
      mockedDevDb.getDevBomItems.mockResolvedValue([
        { id: 1, partName: "A", unitPrice: "10", quantity: 2, updatedAt: new Date() } as any,
      ]);
      mockedDevDb.getDevMoldCosts.mockResolvedValue([
        { id: 1, estimatedCost: "5000" } as any,
      ]);
      mockedDevDb.getDevProductProfile.mockResolvedValue({
        costBreakdown: JSON.stringify({
          breakdown: [{ item: "X", estimatedCost: "25" }],
          targetRetailPrice: "$35.99",
          targetMargin: "30%",
        }),
        costConfirmed: 1,
      } as any);

      const caller = appRouter.createCaller(createAuthContext());
      const result = await caller.devLinkage.getBomCostForProfit({ projectId: 1 });

      expect(result.bomAvailable).toBe(true);
      expect(result.totalMaterialCost).toBe(20);
      expect(result.totalMoldCost).toBe(5000);
      expect(result.profileCostAvailable).toBe(true);
      expect(result.profileTotalCost).toBe(25);
      expect(result.targetRetailPrice).toBe("$35.99");
    });
  });

  describe("importProfileCostToBom", () => {
    it("imports profile cost items as BOM items", async () => {
      mockedDevDb.saveDevBomItem.mockResolvedValue({ id: 1 } as any);

      const caller = appRouter.createCaller(createAuthContext());
      const result = await caller.devLinkage.importProfileCostToBom({
        projectId: 1,
        items: [
          { partName: "PCB板", unitCost: "15.00", quantity: 1, notes: "FR4" },
          { partName: "外壳", unitCost: "8.50", quantity: 1 },
        ],
      });

      expect(result.imported).toBe(2);
      expect(mockedDevDb.saveDevBomItem).toHaveBeenCalledTimes(2);
      expect(mockedDevDb.saveDevBomItem).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 1,
          userId: 1,
          partName: "PCB板",
          unitPrice: "15.00",
          remark: "[画像导入] FR4",
        })
      );
    });
  });
});

describe("devBom supplier association", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves BOM item with supplierGlobalId and supplierName", async () => {
    mockedDevDb.saveDevBomItem.mockResolvedValue({ id: 1 } as any);

    const caller = appRouter.createCaller(createAuthContext());
    await caller.devBom.add({
      projectId: 1,
      partName: "Test Part",
      supplierGlobalId: 5,
      supplierName: "Test Supplier Co.",
      unitCost: "10.00",
      quantity: 2,
    });

    expect(mockedDevDb.saveDevBomItem).toHaveBeenCalledWith(
      expect.objectContaining({
        partName: "Test Part",
        supplierGlobalId: 5,
        supplierName: "Test Supplier Co.",
        unitPrice: "10.00",
        quantity: 2,
      })
    );
  });

  it("updates BOM item supplier association", async () => {
    mockedDevDb.saveDevBomItem.mockResolvedValue({ id: 1 } as any);

    const caller = appRouter.createCaller(createAuthContext());
    await caller.devBom.update({
      id: 1,
      supplierGlobalId: 10,
      supplierName: "New Supplier",
    });

    expect(mockedDevDb.saveDevBomItem).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        supplierGlobalId: 10,
        supplierName: "New Supplier",
      })
    );
  });
});
