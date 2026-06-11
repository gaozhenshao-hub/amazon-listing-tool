import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as devDb from "../devDb";

/**
 * 阶段间数据联动路由
 * 
 * 数据流向:
 *   产品画像(成本子模块) → BOM物料清单 → 利润计算器
 * 
 * 功能:
 * 1. getProfileCostData - 从产品画像成本子模块提取结构化成本数据
 * 2. getLinkageStatus - 查询各阶段数据同步状态（时间戳、是否过期）
 * 3. getBomCostForProfit - BOM成本汇总，供利润计算器使用
 * 4. importProfileCostToBom - 将产品画像成本数据导入BOM
 */

// Helper: safely parse JSON
function safeParseJson(raw: any): any {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

export const devLinkageRouter = router({
  /**
   * 从产品画像的"成本"子模块提取结构化成本数据
   * 返回: 成本明细列表、合计、定价参数、确认状态
   */
  getProfileCostData: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const profile = await devDb.getDevProductProfile(input.projectId);
      if (!profile) {
        return {
          available: false,
          confirmed: false,
          breakdown: [] as { item: string; estimatedCost: string; percentage: string; note: string }[],
          totalCost: 0,
          targetRetailPrice: "",
          targetMargin: "",
          volumeDiscountNotes: "",
          costOptimizationTips: [] as string[],
          updatedAt: null as string | null,
        };
      }

      const costConfirmed = profile.costConfirmed === 1;
      const costData = safeParseJson(profile.costBreakdown) || safeParseJson(profile.costAiSuggestion);

      if (!costData) {
        return {
          available: false,
          confirmed: costConfirmed,
          breakdown: [],
          totalCost: 0,
          targetRetailPrice: "",
          targetMargin: "",
          volumeDiscountNotes: "",
          costOptimizationTips: [],
          updatedAt: profile.updatedAt ? profile.updatedAt.toISOString() : null,
        };
      }

      const breakdown = Array.isArray(costData.breakdown) ? costData.breakdown.map((b: any) => ({
        item: b.item || "",
        estimatedCost: b.estimatedCost || "",
        percentage: b.percentage || "",
        note: b.note || "",
      })) : [];

      const totalCost = breakdown.reduce((sum: number, b: any) => {
        const cost = parseFloat(String(b.estimatedCost).replace(/[^0-9.]/g, ""));
        return sum + (isNaN(cost) ? 0 : cost);
      }, 0);

      return {
        available: true,
        confirmed: costConfirmed,
        breakdown,
        totalCost: Math.round(totalCost * 100) / 100,
        targetRetailPrice: costData.targetRetailPrice || "",
        targetMargin: costData.targetMargin || "",
        volumeDiscountNotes: costData.volumeDiscountNotes || "",
        costOptimizationTips: Array.isArray(costData.costOptimizationTips) ? costData.costOptimizationTips : [],
        updatedAt: profile.updatedAt ? profile.updatedAt.toISOString() : null,
      };
    }),

  /**
   * 查询各阶段数据联动状态
   * 返回: 产品画像成本状态、BOM状态、利润计算器状态、是否有数据不同步
   */
  getLinkageStatus: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const profile = await devDb.getDevProductProfile(input.projectId);
      const bomItems = await devDb.getDevBomItems(input.projectId);
      const moldCosts = await devDb.getDevMoldCosts(input.projectId);
      const bomSummary = await devDb.getDevBomSummary(input.projectId);

      // Profile cost status
      const profileCostData = safeParseJson(profile?.costBreakdown) || safeParseJson(profile?.costAiSuggestion);
      const profileCostAvailable = !!profileCostData;
      const profileCostConfirmed = profile?.costConfirmed === 1;
      const profileUpdatedAt = profile?.updatedAt ? profile.updatedAt.toISOString() : null;

      // BOM status
      let bomTotalMaterial = 0;
      let bomLatestUpdatedAt: Date | null = null;
      for (const item of bomItems) {
        const price = parseFloat(item.unitPrice || "0");
        const qty = item.quantity || 1;
        bomTotalMaterial += price * qty;
        if (item.updatedAt && (!bomLatestUpdatedAt || item.updatedAt > bomLatestUpdatedAt)) {
          bomLatestUpdatedAt = item.updatedAt;
        }
      }

      let bomTotalMold = 0;
      for (const mold of moldCosts) {
        bomTotalMold += parseFloat(mold.estimatedCost || "0");
      }

      const bomHasData = bomItems.length > 0;
      const bomUpdatedAt = bomLatestUpdatedAt ? bomLatestUpdatedAt.toISOString() : null;

      // Check if profile cost was updated after BOM
      const profileNewerThanBom = profileUpdatedAt && bomUpdatedAt
        ? new Date(profileUpdatedAt) > new Date(bomUpdatedAt)
        : false;

      // Check if BOM was updated after profit summary
      const bomSummaryUpdatedAt = bomSummary?.updatedAt ? bomSummary.updatedAt.toISOString() : null;
      const bomNewerThanSummary = bomUpdatedAt && bomSummaryUpdatedAt
        ? new Date(bomUpdatedAt) > new Date(bomSummaryUpdatedAt)
        : false;

      return {
        profileCost: {
          available: profileCostAvailable,
          confirmed: profileCostConfirmed,
          updatedAt: profileUpdatedAt,
        },
        bom: {
          hasData: bomHasData,
          itemCount: bomItems.length,
          totalMaterialCost: Math.round(bomTotalMaterial * 100) / 100,
          totalMoldCost: Math.round(bomTotalMold * 100) / 100,
          updatedAt: bomUpdatedAt,
        },
        profitSummary: {
          hasData: !!bomSummary,
          updatedAt: bomSummaryUpdatedAt,
        },
        syncWarnings: {
          profileNewerThanBom,
          bomNewerThanSummary,
        },
      };
    }),

  /**
   * BOM成本汇总（增强版），供利润计算器使用
   * 包含数据来源标识和上游变更提示
   */
  getBomCostForProfit: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const bomItems = await devDb.getDevBomItems(input.projectId);
      const moldCosts = await devDb.getDevMoldCosts(input.projectId);
      const profile = await devDb.getDevProductProfile(input.projectId);

      // Calculate BOM totals
      let totalMaterialCost = 0;
      let bomLatestUpdatedAt: Date | null = null;
      for (const item of bomItems) {
        const price = parseFloat(item.unitPrice || "0");
        const qty = item.quantity || 1;
        totalMaterialCost += price * qty;
        if (item.updatedAt && (!bomLatestUpdatedAt || item.updatedAt > bomLatestUpdatedAt)) {
          bomLatestUpdatedAt = item.updatedAt;
        }
      }

      let totalMoldCost = 0;
      for (const mold of moldCosts) {
        totalMoldCost += parseFloat(mold.estimatedCost || "0");
      }

      // Extract profile cost for comparison
      const profileCostData = safeParseJson(profile?.costBreakdown) || safeParseJson(profile?.costAiSuggestion);
      let profileTotalCost = 0;
      if (profileCostData?.breakdown) {
        for (const b of profileCostData.breakdown) {
          const cost = parseFloat(String(b.estimatedCost).replace(/[^0-9.]/g, ""));
          if (!isNaN(cost)) profileTotalCost += cost;
        }
      }

      // Extract target retail price from profile
      const targetRetailPrice = profileCostData?.targetRetailPrice || "";
      const targetMargin = profileCostData?.targetMargin || "";

      return {
        bomAvailable: bomItems.length > 0,
        totalMaterialCost: Math.round(totalMaterialCost * 100) / 100,
        totalMoldCost: Math.round(totalMoldCost * 100) / 100,
        bomItemCount: bomItems.length,
        moldCount: moldCosts.length,
        bomUpdatedAt: bomLatestUpdatedAt ? bomLatestUpdatedAt.toISOString() : null,
        // Profile reference data
        profileCostAvailable: !!profileCostData,
        profileTotalCost: Math.round(profileTotalCost * 100) / 100,
        profileCostConfirmed: profile?.costConfirmed === 1,
        targetRetailPrice,
        targetMargin,
      };
    }),

  /**
   * 将产品画像成本明细导入BOM
   * 将画像中的成本项转换为BOM物料条目
   */
  importProfileCostToBom: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      items: z.array(z.object({
        partName: z.string(),
        material: z.string().optional(),
        unitCost: z.string().optional(),
        quantity: z.number().default(1),
        notes: z.string().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      let imported = 0;
      for (const item of input.items) {
        await devDb.saveDevBomItem({
          projectId: input.projectId,
          userId: ctx.user.id,
          partName: item.partName,
          material: item.material ?? null,
          unitPrice: item.unitCost ?? null,
          quantity: item.quantity,
          remark: item.notes ? `[画像导入] ${item.notes}` : "[画像导入]",
          process: null,
          specification: null,
        });
        imported++;
      }
      return { imported };
    }),
});
