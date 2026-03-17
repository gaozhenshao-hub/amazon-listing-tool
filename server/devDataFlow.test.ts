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

/**
 * End-to-end data flow tests:
 * Profile Cost → BOM Reference Panel → Profit Calculator
 *
 * Tests the complete data linkage chain to ensure:
 * 1. Profile cost data is correctly extracted and structured
 * 2. BOM cost summary correctly aggregates material + mold costs
 * 3. Profit calculator prioritizes BOM data over profile data
 * 4. Fallback to profile data when BOM is empty
 * 5. Linkage status accurately reflects data sync state
 * 6. Import from profile to BOM works correctly
 */

describe("End-to-End Data Flow: Profile → BOM → Profit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================
  // Scenario 1: No data at all (fresh project)
  // ============================================================
  describe("Scenario 1: Fresh project with no data", () => {
    it("all linkage endpoints return empty/unavailable state", async () => {
      mockedDevDb.getDevProductProfile.mockResolvedValue(null as any);
      mockedDevDb.getDevBomItems.mockResolvedValue([]);
      mockedDevDb.getDevMoldCosts.mockResolvedValue([]);
      mockedDevDb.getDevBomSummary.mockResolvedValue(null as any);

      const caller = appRouter.createCaller(createAuthContext());

      // Profile cost should be unavailable
      const profileCost = await caller.devLinkage.getProfileCostData({ projectId: 1 });
      expect(profileCost.available).toBe(false);
      expect(profileCost.totalCost).toBe(0);
      expect(profileCost.breakdown).toEqual([]);

      // BOM cost for profit should show no data
      const bomForProfit = await caller.devLinkage.getBomCostForProfit({ projectId: 1 });
      expect(bomForProfit.bomAvailable).toBe(false);
      expect(bomForProfit.totalMaterialCost).toBe(0);
      expect(bomForProfit.profileCostAvailable).toBe(false);

      // Linkage status should show all empty
      const status = await caller.devLinkage.getLinkageStatus({ projectId: 1 });
      expect(status.profileCost.available).toBe(false);
      expect(status.bom.hasData).toBe(false);
      expect(status.profitSummary.hasData).toBe(false);
      expect(status.syncWarnings.profileNewerThanBom).toBe(false);
      expect(status.syncWarnings.bomNewerThanSummary).toBe(false);
    });
  });

  // ============================================================
  // Scenario 2: Only profile cost data exists (no BOM)
  // ============================================================
  describe("Scenario 2: Profile cost only, no BOM", () => {
    const profileCostData = {
      breakdown: [
        { item: "PCB主板", estimatedCost: "18.50", percentage: "28%", note: "FR4双面板+SMT贴片" },
        { item: "蓝牙模组", estimatedCost: "12.00", percentage: "18%", note: "BT5.0+EDR" },
        { item: "喇叭单元", estimatedCost: "8.50", percentage: "13%", note: "40mm全频" },
        { item: "锂电池", estimatedCost: "9.00", percentage: "14%", note: "3.7V 2000mAh" },
        { item: "外壳", estimatedCost: "6.50", percentage: "10%", note: "ABS+PC注塑" },
        { item: "硅胶按键", estimatedCost: "1.50", percentage: "2%", note: "食品级硅胶" },
        { item: "USB-C接口", estimatedCost: "1.20", percentage: "2%", note: "Type-C充电口" },
        { item: "包装材料", estimatedCost: "3.80", percentage: "6%", note: "彩盒+内衬" },
        { item: "组装人工", estimatedCost: "4.50", percentage: "7%", note: "含测试" },
      ],
      targetRetailPrice: "$29.99",
      targetMargin: "35%",
      costOptimizationTips: [
        "PCB板可通过拼板降低10%成本",
        "外壳模具费分摊后单件成本可降至5元",
        "批量采购蓝牙模组可获得15%折扣",
      ],
    };

    beforeEach(() => {
      mockedDevDb.getDevProductProfile.mockResolvedValue({
        id: 1,
        projectId: 1,
        costConfirmed: 1,
        costBreakdown: JSON.stringify(profileCostData),
        costAiSuggestion: null,
        updatedAt: new Date("2026-03-17T10:00:00Z"),
      } as any);
      mockedDevDb.getDevBomItems.mockResolvedValue([]);
      mockedDevDb.getDevMoldCosts.mockResolvedValue([]);
      mockedDevDb.getDevBomSummary.mockResolvedValue(null as any);
    });

    it("profile cost data is correctly extracted with all 9 items", async () => {
      const caller = appRouter.createCaller(createAuthContext());
      const result = await caller.devLinkage.getProfileCostData({ projectId: 1 });

      expect(result.available).toBe(true);
      expect(result.confirmed).toBe(true);
      expect(result.breakdown).toHaveLength(9);
      expect(result.totalCost).toBe(65.5); // Sum of all 9 items
      expect(result.targetRetailPrice).toBe("$29.99");
      expect(result.targetMargin).toBe("35%");
      expect(result.costOptimizationTips).toHaveLength(3);
    });

    it("profit calculator falls back to profile cost when BOM is empty", async () => {
      const caller = appRouter.createCaller(createAuthContext());
      const result = await caller.devLinkage.getBomCostForProfit({ projectId: 1 });

      expect(result.bomAvailable).toBe(false);
      expect(result.totalMaterialCost).toBe(0);
      expect(result.profileCostAvailable).toBe(true);
      expect(result.profileTotalCost).toBe(65.5);
      expect(result.targetRetailPrice).toBe("$29.99");
      expect(result.targetMargin).toBe("35%");
    });

    it("linkage status shows profile available but no BOM", async () => {
      const caller = appRouter.createCaller(createAuthContext());
      const status = await caller.devLinkage.getLinkageStatus({ projectId: 1 });

      expect(status.profileCost.available).toBe(true);
      expect(status.profileCost.confirmed).toBe(true);
      expect(status.bom.hasData).toBe(false);
      expect(status.bom.itemCount).toBe(0);
    });
  });

  // ============================================================
  // Scenario 3: Both profile and BOM data exist
  // ============================================================
  describe("Scenario 3: Profile + BOM data (profit should use BOM)", () => {
    const bomDate = new Date("2026-03-17T12:00:00Z");

    beforeEach(() => {
      mockedDevDb.getDevProductProfile.mockResolvedValue({
        id: 1,
        projectId: 1,
        costConfirmed: 1,
        costBreakdown: JSON.stringify({
          breakdown: [
            { item: "PCB主板", estimatedCost: "18.50" },
            { item: "蓝牙模组", estimatedCost: "12.00" },
            { item: "喇叭单元", estimatedCost: "8.50" },
            { item: "锂电池", estimatedCost: "9.00" },
            { item: "外壳", estimatedCost: "6.50" },
            { item: "硅胶按键", estimatedCost: "1.50" },
            { item: "USB-C接口", estimatedCost: "1.20" },
            { item: "包装材料", estimatedCost: "3.80" },
            { item: "组装人工", estimatedCost: "4.50" },
          ],
          targetRetailPrice: "$29.99",
          targetMargin: "35%",
        }),
        updatedAt: new Date("2026-03-17T10:00:00Z"),
      } as any);

      mockedDevDb.getDevBomItems.mockResolvedValue([
        { id: 1, partName: "PCB主板", unitPrice: "20.00", quantity: 1, updatedAt: bomDate } as any,
        { id: 2, partName: "蓝牙模组", unitPrice: "13.50", quantity: 1, updatedAt: bomDate } as any,
        { id: 3, partName: "喇叭单元", unitPrice: "9.00", quantity: 1, updatedAt: bomDate } as any,
        { id: 4, partName: "锂电池", unitPrice: "10.00", quantity: 1, updatedAt: bomDate } as any,
        { id: 5, partName: "外壳上盖", unitPrice: "3.50", quantity: 1, updatedAt: bomDate } as any,
        { id: 6, partName: "外壳下盖", unitPrice: "3.00", quantity: 1, updatedAt: bomDate } as any,
        { id: 7, partName: "硅胶按键", unitPrice: "0.50", quantity: 3, updatedAt: bomDate } as any,
        { id: 8, partName: "USB-C接口", unitPrice: "1.30", quantity: 1, updatedAt: bomDate } as any,
      ]);
      mockedDevDb.getDevMoldCosts.mockResolvedValue([]);
      mockedDevDb.getDevBomSummary.mockResolvedValue(null as any);
    });

    it("BOM cost is correctly calculated (¥61.80)", async () => {
      const caller = appRouter.createCaller(createAuthContext());
      const result = await caller.devLinkage.getBomCostForProfit({ projectId: 1 });

      // 20 + 13.5 + 9 + 10 + 3.5 + 3 + 0.5*3 + 1.3 = 61.8
      expect(result.bomAvailable).toBe(true);
      expect(result.totalMaterialCost).toBe(61.8);
      expect(result.bomItemCount).toBe(8);
    });

    it("profit calculator uses BOM cost (¥61.8) not profile cost (¥65.5)", async () => {
      const caller = appRouter.createCaller(createAuthContext());
      const result = await caller.devLinkage.getBomCostForProfit({ projectId: 1 });

      // BOM total: ¥61.80 (different from profile ¥65.50)
      expect(result.bomAvailable).toBe(true);
      expect(result.totalMaterialCost).toBe(61.8);
      expect(result.profileCostAvailable).toBe(true);
      expect(result.profileTotalCost).toBe(65.5);
      // Both should be available for comparison
      expect(result.totalMaterialCost).not.toBe(result.profileTotalCost);
    });

    it("linkage status shows both profile and BOM with correct counts", async () => {
      const caller = appRouter.createCaller(createAuthContext());
      const status = await caller.devLinkage.getLinkageStatus({ projectId: 1 });

      expect(status.profileCost.available).toBe(true);
      expect(status.profileCost.confirmed).toBe(true);
      expect(status.bom.hasData).toBe(true);
      expect(status.bom.itemCount).toBe(8);
      expect(status.bom.totalMaterialCost).toBe(61.8);
    });

    it("no sync warning when BOM is newer than profile", async () => {
      const caller = appRouter.createCaller(createAuthContext());
      const status = await caller.devLinkage.getLinkageStatus({ projectId: 1 });

      // BOM (12:00) is newer than profile (10:00), so no warning
      expect(status.syncWarnings.profileNewerThanBom).toBe(false);
    });
  });

  // ============================================================
  // Scenario 4: Profile updated after BOM (sync warning)
  // ============================================================
  describe("Scenario 4: Profile updated after BOM (stale BOM warning)", () => {
    it("triggers profileNewerThanBom sync warning", async () => {
      const profileDate = new Date("2026-03-17T14:00:00Z");
      const bomDate = new Date("2026-03-17T10:00:00Z");

      mockedDevDb.getDevProductProfile.mockResolvedValue({
        id: 1,
        projectId: 1,
        costConfirmed: 1,
        costBreakdown: JSON.stringify({
          breakdown: [{ item: "PCB主板", estimatedCost: "22.00" }],
        }),
        updatedAt: profileDate,
      } as any);
      mockedDevDb.getDevBomItems.mockResolvedValue([
        { id: 1, partName: "PCB主板", unitPrice: "18.50", quantity: 1, updatedAt: bomDate } as any,
      ]);
      mockedDevDb.getDevMoldCosts.mockResolvedValue([]);
      mockedDevDb.getDevBomSummary.mockResolvedValue(null as any);

      const caller = appRouter.createCaller(createAuthContext());
      const status = await caller.devLinkage.getLinkageStatus({ projectId: 1 });

      expect(status.syncWarnings.profileNewerThanBom).toBe(true);
    });
  });

  // ============================================================
  // Scenario 5: BOM with mold costs
  // ============================================================
  describe("Scenario 5: BOM with mold costs included", () => {
    it("correctly aggregates material + mold costs for profit", async () => {
      mockedDevDb.getDevProductProfile.mockResolvedValue(null as any);
      mockedDevDb.getDevBomItems.mockResolvedValue([
        { id: 1, partName: "外壳上盖", unitPrice: "3.50", quantity: 1, updatedAt: new Date() } as any,
        { id: 2, partName: "外壳下盖", unitPrice: "3.00", quantity: 1, updatedAt: new Date() } as any,
      ]);
      mockedDevDb.getDevMoldCosts.mockResolvedValue([
        { id: 1, moldName: "上盖模具", estimatedCost: "15000" } as any,
        { id: 2, moldName: "下盖模具", estimatedCost: "12000" } as any,
      ]);
      mockedDevDb.getDevBomSummary.mockResolvedValue(null as any);

      const caller = appRouter.createCaller(createAuthContext());
      const result = await caller.devLinkage.getBomCostForProfit({ projectId: 1 });

      expect(result.bomAvailable).toBe(true);
      expect(result.totalMaterialCost).toBe(6.5); // 3.5 + 3.0
      expect(result.totalMoldCost).toBe(27000); // 15000 + 12000
      expect(result.moldCount).toBe(2);
    });
  });

  // ============================================================
  // Scenario 6: Import profile cost items to BOM
  // ============================================================
  describe("Scenario 6: Import profile cost to BOM", () => {
    it("imports all profile cost items as BOM items with correct mapping", async () => {
      mockedDevDb.saveDevBomItem.mockResolvedValue({ id: 1 } as any);

      const caller = appRouter.createCaller(createAuthContext());
      const result = await caller.devLinkage.importProfileCostToBom({
        projectId: 1,
        items: [
          { partName: "PCB主板", unitCost: "18.50", quantity: 1, notes: "FR4双面板+SMT贴片" },
          { partName: "蓝牙模组", unitCost: "12.00", quantity: 1, notes: "BT5.0+EDR" },
          { partName: "喇叭单元", unitCost: "8.50", quantity: 1, notes: "40mm全频" },
        ],
      });

      expect(result.imported).toBe(3);
      expect(mockedDevDb.saveDevBomItem).toHaveBeenCalledTimes(3);

      // Verify first item mapping
      expect(mockedDevDb.saveDevBomItem).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 1,
          userId: 1,
          partName: "PCB主板",
          unitPrice: "18.50",
          quantity: 1,
          remark: "[画像导入] FR4双面板+SMT贴片",
        })
      );
    });

    it("handles items without notes gracefully", async () => {
      mockedDevDb.saveDevBomItem.mockResolvedValue({ id: 1 } as any);

      const caller = appRouter.createCaller(createAuthContext());
      await caller.devLinkage.importProfileCostToBom({
        projectId: 1,
        items: [
          { partName: "外壳", unitCost: "6.50", quantity: 1 },
        ],
      });

      expect(mockedDevDb.saveDevBomItem).toHaveBeenCalledWith(
        expect.objectContaining({
          partName: "外壳",
          remark: "[画像导入]",
        })
      );
    });
  });

  // ============================================================
  // Scenario 7: Profile with AI suggestion fallback (no user edit)
  // ============================================================
  describe("Scenario 7: Profile with AI suggestion only (no user edit)", () => {
    it("falls back to AI suggestion when costBreakdown is null", async () => {
      const aiSuggestion = {
        breakdown: [
          { item: "PCB板", estimatedCost: "15.00", percentage: "30%", note: "标准FR4" },
          { item: "外壳", estimatedCost: "8.00", percentage: "16%", note: "ABS" },
        ],
        targetRetailPrice: "$24.99",
        targetMargin: "30%",
      };

      mockedDevDb.getDevProductProfile.mockResolvedValue({
        id: 1,
        projectId: 1,
        costConfirmed: 0,
        costBreakdown: null,
        costAiSuggestion: JSON.stringify(aiSuggestion),
        updatedAt: new Date("2026-03-17T10:00:00Z"),
      } as any);
      mockedDevDb.getDevBomItems.mockResolvedValue([]);
      mockedDevDb.getDevMoldCosts.mockResolvedValue([]);
      mockedDevDb.getDevBomSummary.mockResolvedValue(null as any);

      const caller = appRouter.createCaller(createAuthContext());
      const result = await caller.devLinkage.getProfileCostData({ projectId: 1 });

      expect(result.available).toBe(true);
      expect(result.confirmed).toBe(false); // Not confirmed since costConfirmed=0
      expect(result.breakdown).toHaveLength(2);
      expect(result.totalCost).toBe(23);
      expect(result.targetRetailPrice).toBe("$24.99");
    });
  });

  // ============================================================
  // Scenario 8: BOM items with varying quantities
  // ============================================================
  describe("Scenario 8: BOM items with varying quantities", () => {
    it("correctly calculates total with quantity multiplier", async () => {
      mockedDevDb.getDevProductProfile.mockResolvedValue(null as any);
      mockedDevDb.getDevBomItems.mockResolvedValue([
        { id: 1, partName: "螺丝M3", unitPrice: "0.05", quantity: 12, updatedAt: new Date() } as any,
        { id: 2, partName: "LED灯", unitPrice: "0.30", quantity: 4, updatedAt: new Date() } as any,
        { id: 3, partName: "电容", unitPrice: "0.02", quantity: 20, updatedAt: new Date() } as any,
      ]);
      mockedDevDb.getDevMoldCosts.mockResolvedValue([]);
      mockedDevDb.getDevBomSummary.mockResolvedValue(null as any);

      const caller = appRouter.createCaller(createAuthContext());
      const result = await caller.devLinkage.getBomCostForProfit({ projectId: 1 });

      // 0.05*12 + 0.30*4 + 0.02*20 = 0.6 + 1.2 + 0.4 = 2.2
      expect(result.totalMaterialCost).toBe(2.2);
      expect(result.bomItemCount).toBe(3);
    });
  });

  // ============================================================
  // Scenario 9: Cost data with non-numeric characters
  // ============================================================
  describe("Scenario 9: Profile cost with currency symbols in values", () => {
    it("strips non-numeric characters from cost values", async () => {
      mockedDevDb.getDevProductProfile.mockResolvedValue({
        id: 1,
        projectId: 1,
        costConfirmed: 1,
        costBreakdown: JSON.stringify({
          breakdown: [
            { item: "PCB板", estimatedCost: "¥15.00", percentage: "30%", note: "" },
            { item: "外壳", estimatedCost: "$8.50", percentage: "17%", note: "" },
          ],
        }),
        updatedAt: new Date(),
      } as any);

      const caller = appRouter.createCaller(createAuthContext());
      const result = await caller.devLinkage.getProfileCostData({ projectId: 1 });

      expect(result.available).toBe(true);
      expect(result.totalCost).toBe(23.5); // 15.00 + 8.50
    });
  });
});
