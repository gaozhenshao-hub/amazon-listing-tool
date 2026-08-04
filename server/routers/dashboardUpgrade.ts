import { retiredFeatureError } from "@shared/_core/errors";
import { z } from "zod";
import { router } from "../_core/trpc";
import { protectedProcedure } from "../domains/ops/workspaceProcedure";

function retiredDashboardSource(feature: string, replacementProcedure: string): any {
  throw retiredFeatureError(feature, replacementProcedure, {
    replacementProcedure,
    migrationGuide: "请先在数据导入中心上传对应 Excel 报告，再从运营分析读取本地数据。",
  });
}

export const dashboardUpgradeRouter = router({
  getPromotionCalendar: protectedProcedure
    .input(z.object({ sid: z.number().optional(), startDate: z.string().optional(), endDate: z.string().optional() }).optional())
    .query(() => retiredDashboardSource("旧促销日历 API", "dataImport.getHistory")),

  getShopHealth: protectedProcedure
    .input(z.object({ sid: z.number().optional() }).optional())
    .query(() => retiredDashboardSource("旧店铺健康 API", "dataImport.getProductOverviewFromImport")),

  getAlertsList: protectedProcedure
    .input(z.object({ marketplace: z.string().optional() }).optional())
    .query(() => retiredDashboardSource("旧库存预警 API", "dataImport.getInventoryStatus")),

  aiDailyBriefing: protectedProcedure
    .input(z.object({ marketplace: z.string().optional() }).optional())
    .mutation(() => retiredDashboardSource("旧领星每日简报 API", "productOps.getProductDashboard")),
});
