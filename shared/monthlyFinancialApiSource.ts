import { z } from "zod";
import {
  parseMonthlyFinancialBatch,
  type MonthlyFinancialBatchRecord,
} from "./monthlyFinancialRead";
import { monthlyFinancialImportHash } from "./monthlyFinancialImport";
import {
  SaihuReportCoverageSchema,
  SaihuReportHash,
  SaihuReportId,
  SaihuReportIdentitySchema,
  SaihuReportUuid,
} from "./saihuReportSync";

export const MonthlyFinancialApiPreparedSchema = z
  .object({
    kind: z.literal("saihu_api_v1"),
    identity: SaihuReportIdentitySchema,
    operationId: SaihuReportUuid,
    sourceRunId: SaihuReportId,
    runId: z.string().regex(/^saihur_[a-f0-9]{64}$/u),
    sourceArtifactId: z.string().regex(/^saihus_[a-f0-9]{64}$/u),
    sourceHash: SaihuReportHash,
    contractHash: SaihuReportHash,
    connectionVersion: SaihuReportHash,
  })
  .strict();
export const MonthlyFinancialApiManifestSchema = z
  .object({
    kind: z.literal("saihu_api_manifest_v1"),
    format: z.literal("saihu_api_json"),
    sourceHash: SaihuReportHash,
    payloadHash: SaihuReportHash,
    contractHash: SaihuReportHash,
    sourceRunId: SaihuReportId,
    coverage: SaihuReportCoverageSchema,
    counts: z
      .object({ normalizedRows: z.number().int().nonnegative().max(10000) })
      .strict(),
    blockingReasons: z.array(z.string()).max(100),
  })
  .strict();
export type MonthlyFinancialApiPrepared = z.infer<
  typeof MonthlyFinancialApiPreparedSchema
>;
export type MonthlyFinancialApiManifest = z.infer<
  typeof MonthlyFinancialApiManifestSchema
>;
export function isMonthlyFinancialApiArtifact(value: {
  prepared: unknown;
  manifest: unknown;
}): value is {
  prepared: MonthlyFinancialApiPrepared;
  manifest: MonthlyFinancialApiManifest;
} {
  return (
    !!value.prepared &&
    typeof value.prepared === "object" &&
    "kind" in value.prepared &&
    value.prepared.kind === "saihu_api_v1"
  );
}
export function validateMonthlyFinancialApiArtifact(
  record: MonthlyFinancialBatchRecord,
  rawPrepared: unknown,
  rawManifest: unknown,
  payloadHash: string
) {
  const prepared = MonthlyFinancialApiPreparedSchema.parse(rawPrepared),
    manifest = MonthlyFinancialApiManifestSchema.parse(rawManifest),
    parsed = parseMonthlyFinancialBatch(record),
    rows = parsed.rows.map(
      ({
        yearMonth,
        parentAsin,
        asin,
        sku,
        title,
        storeName,
        site,
        operator,
        raw,
        metrics,
      }) => ({
        yearMonth,
        parentAsin,
        asin,
        sku,
        title,
        storeName,
        site,
        operator,
        raw,
        ...metrics,
      })
    );
  if (
    prepared.identity.workspaceId !== record.workspaceId ||
    prepared.identity.userId !== record.userId ||
    prepared.sourceRunId !== record.sourceRunId ||
    record.fileReferenceKind !== "saihu_sync_run" ||
    prepared.sourceRunId !== manifest.sourceRunId ||
    prepared.sourceHash !== manifest.sourceHash ||
    prepared.contractHash !== manifest.contractHash ||
    payloadHash !== manifest.payloadHash ||
    monthlyFinancialImportHash(rows) !== payloadHash ||
    record.fileHash !== payloadHash ||
    manifest.counts.normalizedRows !== record.totalRows ||
    !manifest.coverage.complete ||
    manifest.coverage.blockingReasons.length ||
    manifest.blockingReasons.length ||
    record.skippedRows !== 0
  )
    throw new Error("MONTHLY_API_ARTIFACT_MISMATCH");
  return { prepared, manifest, rows };
}
