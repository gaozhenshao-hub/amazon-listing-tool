import { z } from "zod";
import {
  SaihuReportIdentitySchema,
  SaihuReportScopeSchema,
  SaihuReportHash,
  SaihuReportShopSchema,
  SaihuReportReceiptSchema,
  SaihuReportPublicRunSchema,
  SaihuReportCoverageSchema,
  SaihuReportDailyRowSchema,
  SaihuReportMonthlyRowSchema,
} from "./saihuReportSync";
import { MonthlyFinancialWriteImpactSchema } from "./monthlyFinancialWrite";
export const SaihuReportOptionsResultSchema = z
  .object({
    identity: SaihuReportIdentitySchema,
    scope: SaihuReportScopeSchema,
    historyHash: SaihuReportHash,
    configurationHash: SaihuReportHash.nullable(),
    shops: z.array(SaihuReportShopSchema).max(100),
    capability: z
      .object({
        status: z.enum(["available", "unavailable"]),
        reasonCode: z.string().nullable(),
      })
      .strict(),
    reportingCalendar: z.enum(["saturday_friday", "settlement_month"]),
    currency: z.literal("USD"),
    autoApply: z.literal(false),
  })
  .strict();
export const SaihuReportCheckResultSchema = z
  .object({
    receipt: SaihuReportReceiptSchema.nullable(),
    run: SaihuReportPublicRunSchema.nullable(),
  })
  .strict();
export const SaihuReportHistoryResultSchema = z
  .object({
    identity: SaihuReportIdentitySchema,
    runs: z.array(SaihuReportPublicRunSchema).max(50),
    nextCursor: z.number().int().positive().nullable(),
    hasMore: z.boolean(),
  })
  .strict();
export const SaihuReportInspectResultSchema = z
  .object({
    run: SaihuReportPublicRunSchema,
    historyHash: SaihuReportHash,
    coverage: SaihuReportCoverageSchema,
    rows: z
      .array(
        z.union([
          SaihuReportDailyRowSchema.omit({ raw: true }),
          SaihuReportMonthlyRowSchema.omit({ raw: true }),
        ])
      )
      .max(100),
    rowPage: z
      .object({
        offset: z.number().int().nonnegative(),
        limit: z.number().int().min(1).max(100),
        total: z.number().int().nonnegative().max(10000),
        hasMore: z.boolean(),
      })
      .strict(),
    monthlyImpact: MonthlyFinancialWriteImpactSchema.nullable(),
    monthlyBatchVersion: SaihuReportHash.nullable(),
    dailyOverview: z.array(z.unknown()).max(10000),
    canApply: z.boolean(),
    applyBlockingReason: z.string().nullable(),
    canRevoke: z.boolean(),
  })
  .strict();
export type SaihuReportOptionsResult = z.infer<
  typeof SaihuReportOptionsResultSchema
>;
export type SaihuReportInspectResult = z.infer<
  typeof SaihuReportInspectResultSchema
>;
