import { z } from "zod";
import {
  monthlyFinancialImportCanonical,
  monthlyFinancialImportHash,
} from "./monthlyFinancialImport";
import {
  MonthlyFinancialMetricsSchema,
  MonthlyFinancialRawSchema,
} from "./monthlyFinancialReadDetails";
import { normalizeMarketplaceCode } from "./marketplaceIdentity";

export const SAIHU_REPORT_KIND = "ops.saihu_report_capture.v1";
export const SAIHU_REPORT_SOURCE_KEY = "ops.saihu_report.source.v1";
export const SAIHU_REPORT_PREVIEW_KEY = "ops.saihu_report.preview.v1";
export const SAIHU_REPORT_APPLY_KEY = "ops.saihu_report.apply.v1";
export const SAIHU_REPORT_LIMITS = Object.freeze({
  rows: 10000,
  pages: 500,
  responseBytes: 2 * 1024 * 1024,
  sourceBytes: 8 * 1024 * 1024,
  scans: 200,
});
export const saihuReportHash = monthlyFinancialImportHash;
export const saihuReportCanonical = monthlyFinancialImportCanonical;
export const SaihuReportId = z.number().int().positive().max(2147483647);
export const SaihuReportHash = z.string().regex(/^[a-f0-9]{64}$/u);
export const SaihuReportUuid = z
  .string()
  .uuid()
  .transform(value => value.toLowerCase());
const text = z
  .string()
  .min(1)
  .max(200)
  .refine(
    value => value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value)
  );
export const SaihuReportDate = z
  .string()
  .regex(/^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u)
  .refine(value => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  });
export const SaihuReportMonth = z
  .string()
  .regex(/^20\d{2}-(?:0[1-9]|1[0-2])$/u);
export const SaihuReportIdentitySchema = z
  .object({ userId: SaihuReportId, workspaceId: SaihuReportId })
  .strict();
export type SaihuReportIdentity = z.infer<typeof SaihuReportIdentitySchema>;
export const SaihuReportScopeSchema = z.union([
  z
    .object({
      kind: z.literal("daily"),
      start: SaihuReportDate,
      end: SaihuReportDate,
    })
    .strict()
    .refine(
      value =>
        value.end >= value.start &&
        (Date.parse(value.end) - Date.parse(value.start)) / 86400000 < 31
    ),
  z
    .object({
      kind: z.literal("monthly"),
      start: SaihuReportMonth,
      end: SaihuReportMonth,
    })
    .strict()
    .refine(value => value.start === value.end),
]);
export type SaihuReportScope = z.infer<typeof SaihuReportScopeSchema>;
export const SaihuReportShopSchema = z
  .object({
    shopId: text,
    storeName: text,
    country: text.refine(value => normalizeMarketplaceCode(value) === value),
  })
  .strict();
export type SaihuReportShop = z.infer<typeof SaihuReportShopSchema>;
const base = z.object({ expectedWorkspaceId: SaihuReportId }).strict();
export const SaihuReportPreviewInputSchema = base
  .extend({ scope: SaihuReportScopeSchema })
  .strict();
export const SaihuReportStartInputSchema = base
  .extend({
    scope: SaihuReportScopeSchema,
    operationId: SaihuReportUuid,
    expectedConfigurationHash: SaihuReportHash,
    expectedHistoryHash: SaihuReportHash,
  })
  .strict();
export const SaihuReportOperationInputSchema = base
  .extend({ operationId: SaihuReportUuid })
  .strict();
export const SaihuReportHistoryInputSchema = base
  .extend({
    cursor: SaihuReportId.nullable().default(null),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export const SaihuReportInspectInputSchema =
  SaihuReportOperationInputSchema.extend({
    rowOffset: z.number().int().min(0).max(10000).default(0),
    pageSize: z.number().int().min(1).max(100).default(50),
  }).strict();
// Public RPC is opsSaihuReport.applyPreview; `apply` is a reserved tRPC key.
// The same input is used by the repository's internal apply transition.
export const SaihuReportApplyInputSchema = base
  .extend({
    operationId: SaihuReportUuid,
    runOperationId: SaihuReportUuid,
    expectedPreviewHash: SaihuReportHash,
    expectedHistoryHash: SaihuReportHash,
    fullScopeAcknowledged: z.literal(true),
  })
  .strict();
export const SaihuReportApplyOperationInputSchema = base
  .extend({ operationId: SaihuReportUuid, runOperationId: SaihuReportUuid })
  .strict();
export const SaihuReportRevokeInputSchema = SaihuReportApplyInputSchema;
export type SaihuReportStartInput = z.infer<typeof SaihuReportStartInputSchema>;
export type SaihuReportOperationInput = z.infer<
  typeof SaihuReportOperationInputSchema
>;
export type SaihuReportApplyInput = z.infer<typeof SaihuReportApplyInputSchema>;
export type SaihuReportApplyOperationInput = z.infer<
  typeof SaihuReportApplyOperationInputSchema
>;
export const SAIHU_DAILY_FIELDS = [
  "salesQty",
  "orderQty",
  "salesAmount",
  "grossProfit",
  "sessionsTotal",
  "adOrders",
  "organicOrders",
  "adClicks",
  "adImpressions",
  "adSpend",
  "adSalesAmount",
  "refundQty",
  "returnQty",
  "organicClicks",
  "rating",
  "ratingCount",
] as const;
const metric = z.number().finite().nullable();
export const SaihuReportDailyMetricsSchema = z
  .object(
    Object.fromEntries(SAIHU_DAILY_FIELDS.map(key => [key, metric])) as Record<
      (typeof SAIHU_DAILY_FIELDS)[number],
      typeof metric
    >
  )
  .strict();
const rowBase = {
  period: z.string(),
  shop: SaihuReportShopSchema,
  asin: z.string().regex(/^[A-Z0-9]{10}$/u),
  parentAsin: z.string().regex(/^[A-Z0-9]{10}$/u),
  title: z.string().max(4000),
  sku: z.string().max(2000),
  operator: z.string().max(2000).nullable(),
  currency: z.literal("USD"),
  raw: MonthlyFinancialRawSchema,
};
export const SaihuReportDailyRowSchema = z
  .object({
    ...rowBase,
    period: SaihuReportDate,
    reportLevel: z.literal("asin"),
    metrics: SaihuReportDailyMetricsSchema,
  })
  .strict();
export const SaihuReportMonthlyRowSchema = z
  .object({
    ...rowBase,
    period: SaihuReportMonth,
    metrics: MonthlyFinancialMetricsSchema,
  })
  .strict();
export type SaihuReportDailyRow = z.infer<typeof SaihuReportDailyRowSchema>;
export type SaihuReportMonthlyRow = z.infer<typeof SaihuReportMonthlyRowSchema>;
export const SaihuReportCoverageSchema = z
  .object({
    complete: z.boolean(),
    expected: z
      .array(
        z.object({ period: z.string(), shop: SaihuReportShopSchema }).strict()
      )
      .max(3100),
    observed: z
      .array(
        z
          .object({
            period: z.string(),
            shop: SaihuReportShopSchema,
            rowCount: z.number().int().nonnegative().max(10000),
            explicitEmpty: z.boolean(),
          })
          .strict()
      )
      .max(3100),
    blockingReasons: z
      .array(z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/u))
      .max(100),
  })
  .strict();
export const SaihuReportSourceSchema = z
  .object({
    version: z.literal(1),
    identity: SaihuReportIdentitySchema,
    operationId: SaihuReportUuid,
    scope: SaihuReportScopeSchema,
    connectionVersion: SaihuReportHash,
    contractHash: SaihuReportHash,
    shops: z.array(SaihuReportShopSchema).min(1).max(100),
    pages: z
      .array(
        z
          .object({
            period: z.string(),
            pageNo: z.number().int().positive().max(500),
            receivedAt: z.number().int().positive().safe(),
            bytesHash: SaihuReportHash,
            byteLength: z
              .number()
              .int()
              .positive()
              .max(SAIHU_REPORT_LIMITS.responseBytes),
            originalUtf8: z.string().max(SAIHU_REPORT_LIMITS.responseBytes),
            body: MonthlyFinancialRawSchema,
          })
          .strict()
      )
      .min(1)
      .max(500),
  })
  .strict();
export type SaihuReportSource = z.infer<typeof SaihuReportSourceSchema>;
export const SaihuReportCapturePreviewSchema = z
  .object({
    version: z.literal(1),
    sourceHash: SaihuReportHash,
    scope: SaihuReportScopeSchema,
    contractHash: SaihuReportHash,
    coverage: SaihuReportCoverageSchema,
    dailyRows: z.array(SaihuReportDailyRowSchema).max(10000),
    monthlyRows: z.array(SaihuReportMonthlyRowSchema).max(10000),
    previewHash: SaihuReportHash,
  })
  .strict();
export type SaihuReportCapturePreview = z.infer<
  typeof SaihuReportCapturePreviewSchema
>;
export const SaihuReportReceiptSchema = z
  .object({
    identity: SaihuReportIdentitySchema,
    operationId: SaihuReportUuid,
    runOperationId: SaihuReportUuid,
    action: z.enum(["start", "apply", "revoke"]),
    status: z.enum(["committed", "cancelled", "unknown"]),
    requestHash: SaihuReportHash.nullable(),
    batchId: SaihuReportId.nullable(),
    resultHash: SaihuReportHash.nullable(),
  })
  .strict();
export type SaihuReportReceipt = z.infer<typeof SaihuReportReceiptSchema>;
export const SaihuReportPublicRunSchema = z
  .object({
    identity: SaihuReportIdentitySchema,
    operationId: SaihuReportUuid,
    scope: SaihuReportScopeSchema,
    state: z.enum([
      "queued",
      "running",
      "preview",
      "failed",
      "cancelled",
      "unknown",
    ]),
    previewHash: SaihuReportHash.nullable(),
    sourceHash: SaihuReportHash.nullable(),
    batchId: SaihuReportId.nullable(),
    applied: z.boolean(),
    revoked: z.boolean(),
    reasonCode: z.string().nullable(),
  })
  .strict();
export type SaihuReportPublicRun = z.infer<typeof SaihuReportPublicRunSchema>;
export function saihuReportPeriods(scope: SaihuReportScope): string[] {
  scope = SaihuReportScopeSchema.parse(scope);
  if (scope.kind === "monthly") return [scope.start];
  const result: string[] = [];
  for (
    let day = Date.parse(scope.start);
    day <= Date.parse(scope.end);
    day += 86400000
  )
    result.push(new Date(day).toISOString().slice(0, 10));
  return result;
}
export function saihuReportDailyKey(row: SaihuReportDailyRow) {
  return JSON.stringify([
    row.shop.shopId,
    row.shop.storeName,
    row.shop.country,
    row.period,
    row.asin,
    row.reportLevel,
  ]);
}
export function saihuReportWeek(day: string) {
  SaihuReportDate.parse(day);
  const time = Date.parse(day),
    weekDay = new Date(time).getUTCDay(),
    start = time - ((weekDay + 1) % 7) * 86400000;
  return {
    weekStartDate: new Date(start).toISOString().slice(0, 10),
    weekEndDate: new Date(start + 6 * 86400000).toISOString().slice(0, 10),
  };
}
