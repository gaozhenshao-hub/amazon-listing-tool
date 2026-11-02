import { retiredFeatureError } from "@shared/_core/errors";
import { z } from "zod";
import { router } from "../_core/trpc";
import { protectedProcedure } from "../domains/ops/workspaceProcedure";

export const dashboardUpgradeRouter = router({
  getPromotionCalendar: protectedProcedure
    .input(z.object({ sid: z.number().optional(), startDate: z.string().optional(), endDate: z.string().optional() }).optional())
    .query(() => ({ events: [], dealCount: 0, couponCount: 0, source: "import_required" as const })),

  getShopHealth: protectedProcedure
    .input(z.object({ sid: z.number().optional() }).optional())
    .query(() => null),

  getAlertsList: protectedProcedure
    .input(z.object({ marketplace: z.string().optional() }).optional())
    .query(() => ({ lowStockAlerts: [], returnAlerts: [], source: "inventory_planning" as const })),

  aiDailyBriefing: protectedProcedure
    .input(z.object({ marketplace: z.string().optional() }).optional())
    .mutation(() => ({ status: "import_required" as const })),
});
