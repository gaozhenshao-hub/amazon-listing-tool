import { z } from "zod";
import { normalizeMarketplaceCode } from "./marketplaceIdentity";
import {
  MONTHLY_FINANCIAL_LIMITS, MONTHLY_FINANCIAL_METRICS, MonthlyFinancialRawSchema,
  MonthlyFinancialMetricsSchema, MonthlyFinancialDetailsSchema,
  aggregateMonthlyFinancialDetails, buildMonthlyFinancialDetails,
  monthlyFinancialJsonBytes, parseMonthlyFinancialJson,
  type MonthlyFinancialMetrics,
} from "./monthlyFinancialReadDetails";
export * from "./monthlyFinancialReadDetails";

/** Read-only friend snapshot compatibility. Never uploads, confirms, revokes or runs AI. */
export class MonthlyFinancialReadError extends Error {
  constructor(public readonly code: string, message = "月报来源结构、完整性或读取限额无法核验；不截断、不回退旧批次") { super(message); this.name = "MonthlyFinancialReadError"; }
}
const id = z.number().int().positive().safe().max(2_147_483_647);
const text = (max: number) => z.string().min(1).max(max).refine(value => value === value.trim());
const month = z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/u);
const country = text(50).transform(normalizeMarketplaceCode);
const databaseTime = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/u).refine(value => {
  const [year, month, day, hour, minute, second] = value.split(/[- :.]/u).slice(0, 6).map(Number);
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1000 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && hour <= 23 && minute <= 59 && second <= 59;
}, "Valid database calendar date required; timezone is deliberately unspecified");
const identitySchema = z.object({ userId: id, workspaceId: id }).strict();
export type MonthlyFinancialReadIdentity = z.infer<typeof identitySchema>;
const baseScopeSchema = z.object({ yearMonth: month, storeName: text(200), country }).strict();
export const MonthlyFinancialBusinessScopeSchema = baseScopeSchema.extend({ parentAsin: text(500) }).strict();
export type MonthlyFinancialBusinessScope = z.infer<typeof MonthlyFinancialBusinessScopeSchema>;
const pageInput = { rowOffset: z.number().int().min(0).max(MONTHLY_FINANCIAL_LIMITS.rows), pageSize: z.number().int().min(1).max(100) };
export const MonthlyFinancialHistoryInputSchema = z.object({ expectedWorkspaceId: id, cursor: id.nullable(), limit: z.number().int().min(1).max(50) }).strict();
export const MonthlyFinancialBatchInputSchema = z.object({ expectedWorkspaceId: id, batchId: id, scope: MonthlyFinancialBusinessScopeSchema.optional(), ...pageInput }).strict();
export const MonthlyFinancialSnapshotInputSchema = baseScopeSchema.extend({ expectedWorkspaceId: id, parentAsin: text(500).optional(), ...pageInput }).strict();
export type MonthlyFinancialHistoryInput = z.infer<typeof MonthlyFinancialHistoryInputSchema>;
export type MonthlyFinancialBatchInput = z.infer<typeof MonthlyFinancialBatchInputSchema>;
export type MonthlyFinancialSnapshotInput = z.infer<typeof MonthlyFinancialSnapshotInputSchema>;

const statusSchema = z.enum(["previewing", "completed", "deleted"]);
const commonMetadata = { id, status: statusSchema, createdAt: databaseTime, confirmedAt: databaseTime.nullable(), timestampBasis: z.literal("database_datetime_without_timezone") };
const originSchema = z.object({ kind: z.enum(["uploaded_file", "saihu_sync", "unknown"]), hashBasis: z.enum(["original_file_bytes", "mapped_json_bytes", "unknown"]), sourceRunId: id.nullable() }).strict();
export const MonthlyFinancialBatchMetadataSchema = z.object({ ...commonMetadata, visibility: z.literal("full"), workspaceId: id, userId: id, fileName: z.string().min(1).max(512), fileHash: z.string().regex(/^[a-fA-F0-9]{64}$/u), totalRows: z.number().int().nonnegative().max(MONTHLY_FINANCIAL_LIMITS.rows), skippedRows: z.number().int().nonnegative().safe(), unallocatedRows: z.number().int().nonnegative().max(MONTHLY_FINANCIAL_LIMITS.rows), months: z.array(month).max(1200), origin: originSchema }).strict();
const scopedMetadataSchema = z.object({ ...commonMetadata, visibility: z.literal("scoped") }).strict();
export const MonthlyFinancialVisibleBatchMetadataSchema = z.union([MonthlyFinancialBatchMetadataSchema, scopedMetadataSchema]);
export type MonthlyFinancialBatchMetadata = z.infer<typeof MonthlyFinancialBatchMetadataSchema>;
export type MonthlyFinancialVisibleBatchMetadata = z.infer<typeof MonthlyFinancialVisibleBatchMetadataSchema>;
export type MonthlyFinancialBatchRecord = {
  id: number; workspaceId: number; userId: number; fileName: string; fileHash: string; status: string;
  totalRows: number; skippedRows: number; unallocatedRows: number; months: unknown; payload?: unknown;
  createdAt: string; confirmedAt: string | null;
  fileUrl?: string; fileReferenceKind?: "saihu_sync_run" | "storage" | "unknown"; sourceRunId?: number | null;
};
const storedRowSchema = z.object({ yearMonth: month, parentAsin: z.string().max(500), asin: z.string().max(500), sku: z.string().max(2000), title: z.string().max(4000), storeName: text(200), site: text(200), operator: z.string().max(2000).nullable(), raw: MonthlyFinancialRawSchema, ...MonthlyFinancialMetricsSchema.shape }).strict();
const currencyEvidenceSchema = z.object({ status: z.enum(["explicit", "unknown", "conflict"]), values: z.array(z.string()), rawPaths: z.array(z.string()), note: z.string() }).strict();
export const MonthlyFinancialReadRowSchema = z.object({
  batchId: id, rowIndex: z.number().int().nonnegative().max(MONTHLY_FINANCIAL_LIMITS.rows - 1),
  yearMonth: month, parentAsin: z.string().max(500), asin: z.string().max(500), sku: z.string().max(2000), title: z.string().max(4000), storeName: text(200), site: text(200), country, operator: z.string().max(2000).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/u).nullable(), currencyEvidence: currencyEvidenceSchema,
  allocation: z.enum(["child", "parent_only", "unallocated", "ambiguous"]),
  amountConvention: z.literal("stored_normalized_values_and_original_raw_signs"),
  metrics: MonthlyFinancialMetricsSchema, raw: MonthlyFinancialRawSchema, details: MonthlyFinancialDetailsSchema,
}).strict();
export type MonthlyFinancialReadRow = z.infer<typeof MonthlyFinancialReadRowSchema>;
const sourceRefSchema = z.object({ batchId: id, rowIndex: z.number().int().nonnegative().max(MONTHLY_FINANCIAL_LIMITS.rows - 1) }).strict();
export const MonthlyFinancialAggregateSchema = z.object({
  dimension: z.enum(["parent", "asin", "unallocated"]),
  basis: z.enum(["child_rows", "reported_parent_row", "unallocated_rows"]),
  scope: baseScopeSchema.extend({ currency: z.string().regex(/^[A-Z]{3}$/u).nullable() }).strict(),
  parentAsin: z.string().nullable(), asin: z.string().nullable(), rowCount: z.number().int().nonnegative(),
  sourceRows: z.array(sourceRefSchema).max(MONTHLY_FINANCIAL_LIMITS.rows), metrics: MonthlyFinancialMetricsSchema,
  details: MonthlyFinancialDetailsSchema, missingReason: z.string().nullable(),
}).strict();
export type MonthlyFinancialAggregate = z.infer<typeof MonthlyFinancialAggregateSchema>;
const responseBase = { identity: identitySchema, status: z.enum(["ready", "missing", "not_found", "invalid"]), reasonCode: z.string().nullable(), missingReason: z.string().nullable(), timestampBasis: z.literal("database_datetime_without_timezone") };
const rowPageSchema = z.object({ rowOffset: z.number().int().nonnegative(), pageSize: z.number().int().min(1).max(100), totalRows: z.number().int().nonnegative().nullable(), matchedRows: z.number().int().nonnegative(), nextOffset: z.number().int().nonnegative().nullable(), hasMore: z.boolean() }).strict();
const historyBaseSchema = z.object({ ...responseBase, batches: z.array(MonthlyFinancialBatchMetadataSchema).max(50), page: z.object({ cursor: id.nullable(), limit: z.number().int().min(1).max(50), nextCursor: id.nullable(), hasMore: z.boolean() }).strict() }).strict();
const batchBaseSchema = z.object({ ...responseBase, batch: MonthlyFinancialVisibleBatchMetadataSchema.nullable(), scope: MonthlyFinancialBusinessScopeSchema.nullable(), rows: z.array(MonthlyFinancialReadRowSchema).max(100), aggregates: z.array(MonthlyFinancialAggregateSchema).max(20000), page: rowPageSchema }).strict();
const snapshotBaseSchema = z.object({ ...responseBase, scope: baseScopeSchema.extend({ parentAsin: text(500).optional() }).strict(), batch: MonthlyFinancialVisibleBatchMetadataSchema.nullable(), selectedBatchId: id.nullable(), winningScopes: z.array(baseScopeSchema.extend({ batchId: id }).strict()).max(1), selection: z.object({ rule: z.literal("latest_completed_batch_per_month_store_site"), complete: z.boolean(), scannedCount: z.number().int().min(0).max(MONTHLY_FINANCIAL_LIMITS.scanBatches).nullable() }).strict(), rows: z.array(MonthlyFinancialReadRowSchema).max(100), aggregates: z.array(MonthlyFinancialAggregateSchema).max(20000), page: rowPageSchema }).strict();
function validateResponse(value: { status: string; reasonCode: string | null; missingReason: string | null }, ctx: z.RefinementCtx) {
  if (value.status === "ready" ? value.reasonCode !== null || value.missingReason !== null : !value.reasonCode?.trim() || !value.missingReason?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Response state/reason mismatch" });
  try { if (monthlyFinancialJsonBytes(value) > MONTHLY_FINANCIAL_LIMITS.resultBytes) throw new Error(); }
  catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Bounded JSON result required" }); }
}
function issue(ctx: z.RefinementCtx, message: string) { ctx.addIssue({ code: z.ZodIssueCode.custom, message }); }
function validateMetadata(value: MonthlyFinancialVisibleBatchMetadata, workspaceId: number, ctx: z.RefinementCtx) {
  if (value.status === "completed" && value.confirmedAt === null) issue(ctx, "Completed batch requires confirmation time");
  if (value.visibility === "full" && (value.workspaceId !== workspaceId || new Set(value.months).size !== value.months.length || value.unallocatedRows > value.totalRows || (value.origin.kind === "saihu_sync" ? value.origin.sourceRunId === null || value.origin.hashBasis !== "mapped_json_bytes" : value.origin.sourceRunId !== null || value.origin.hashBasis !== (value.origin.kind === "uploaded_file" ? "original_file_bytes" : "unknown")))) issue(ctx, "Batch metadata scope/origin inconsistent");
}
function validateRowPage(value: z.infer<typeof batchBaseSchema> | z.infer<typeof snapshotBaseSchema>, ctx: z.RefinementCtx) {
  const { page, rows, aggregates, batch, scope } = value;
  if (value.status !== "ready") {
    if (batch !== null || rows.length || aggregates.length || page.totalRows !== null || page.matchedRows || page.nextOffset !== null || page.hasMore) issue(ctx, "Unavailable response must not contain partial data");
    return;
  }
  if (!batch) { issue(ctx, "Ready response requires batch"); return; }
  validateMetadata(batch, value.identity.workspaceId, ctx);
  if (rows.length !== Math.min(page.pageSize, Math.max(0, page.matchedRows - page.rowOffset)) || page.hasMore !== (page.rowOffset + rows.length < page.matchedRows) || page.nextOffset !== (page.hasMore ? page.rowOffset + rows.length : null)) issue(ctx, "Row page continuity mismatch");
  if (page.matchedRows > MONTHLY_FINANCIAL_LIMITS.rows || (batch.visibility === "scoped" ? !scope || !("parentAsin" in scope) || page.totalRows !== null : page.totalRows !== batch.totalRows || page.matchedRows > batch.totalRows)) issue(ctx, "Scope count disclosure/mismatch");
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row.batchId !== batch.id || index > 0 && row.rowIndex <= rows[index - 1].rowIndex || batch.visibility === "full" && row.rowIndex >= batch.totalRows || scope && !monthlyFinancialRowMatchesScope(row, scope)) issue(ctx, "Row identity/scope/order mismatch");
    if ((row.currencyEvidence.status === "explicit") !== (row.currency !== null) || row.currency !== null && (row.currencyEvidence.values.length !== 1 || row.currencyEvidence.values[0] !== row.currency)) issue(ctx, "Currency evidence mismatch");
  }
  for (const aggregate of aggregates) {
    const refs = aggregate.sourceRows.map(ref => `${ref.batchId}:${ref.rowIndex}`);
    if (!aggregate.rowCount || aggregate.rowCount !== refs.length || new Set(refs).size !== refs.length || aggregate.sourceRows.some(ref => ref.batchId !== batch.id || batch.visibility === "full" && ref.rowIndex >= batch.totalRows)) issue(ctx, "Aggregate source membership mismatch");
    if (scope && (aggregate.scope.yearMonth !== scope.yearMonth || aggregate.scope.storeName !== scope.storeName || aggregate.scope.country !== scope.country || "parentAsin" in scope && scope.parentAsin !== undefined && aggregate.parentAsin !== scope.parentAsin)) issue(ctx, "Aggregate scope mismatch");
    if (aggregate.basis === "reported_parent_row" && (aggregate.dimension !== "parent" || aggregate.rowCount !== 1) || aggregate.basis === "unallocated_rows" && aggregate.dimension !== "unallocated" || aggregate.dimension === "unallocated" && (aggregate.parentAsin !== null || aggregate.asin !== null) || aggregate.dimension === "parent" && (!aggregate.parentAsin || aggregate.asin !== null) || aggregate.dimension === "asin" && !aggregate.asin) issue(ctx, "Aggregate dimension mismatch");
    if (aggregate.scope.currency === null && aggregate.rowCount !== 1) issue(ctx, "Unknown currency cannot be merged across rows");
  }
}
export const MonthlyFinancialHistoryResultSchema = historyBaseSchema.superRefine((value, ctx) => {
  validateResponse(value, ctx);
  const { batches, page } = value;
  if (value.status !== "ready" && (batches.length || page.hasMore || page.nextCursor !== null) || batches.length > page.limit || page.hasMore && batches.length !== page.limit || page.nextCursor !== (page.hasMore ? batches.at(-1)?.id : null)) issue(ctx, "History page continuity mismatch");
  for (let index = 0; index < batches.length; index++) {
    validateMetadata(batches[index], value.identity.workspaceId, ctx);
    if (page.cursor !== null && batches[index].id >= page.cursor || index > 0 && batches[index].id >= batches[index - 1].id) issue(ctx, "History keyset order mismatch");
  }
});
export const MonthlyFinancialBatchResultSchema = batchBaseSchema.superRefine((value, ctx) => { validateResponse(value, ctx); validateRowPage(value, ctx); });
export const MonthlyFinancialSnapshotResultSchema = snapshotBaseSchema.superRefine((value, ctx) => {
  validateResponse(value, ctx); validateRowPage(value, ctx);
  if (value.status === "ready") {
    const winner = value.winningScopes[0];
    if (!value.selection.complete || value.batch?.status !== "completed" || value.selectedBatchId !== value.batch?.id || value.winningScopes.length !== 1 || !winner || winner.batchId !== value.selectedBatchId || winner.yearMonth !== value.scope.yearMonth || winner.storeName !== value.scope.storeName || winner.country !== value.scope.country || (value.batch.visibility === "scoped" ? value.selection.scannedCount !== null : value.selection.scannedCount === null || value.selection.scannedCount < 1)) issue(ctx, "Effective snapshot selection mismatch");
  } else if (value.selectedBatchId !== null || value.winningScopes.length || value.selection.scannedCount !== null || value.selection.complete !== (value.status === "not_found")) issue(ctx, "Unavailable snapshot cannot claim completed selection");
});
export type MonthlyFinancialHistoryResult = z.infer<typeof MonthlyFinancialHistoryResultSchema>;
export type MonthlyFinancialBatchResult = z.infer<typeof MonthlyFinancialBatchResultSchema>;
export type MonthlyFinancialSnapshotResult = z.infer<typeof MonthlyFinancialSnapshotResultSchema>;
export type MonthlyFinancialParsedBatch = { batch: MonthlyFinancialBatchMetadata; rows: MonthlyFinancialReadRow[] };
export type MonthlyFinancialSnapshotSelection = { selected: MonthlyFinancialParsedBatch | null; scannedBatchIds: number[]; complete: boolean };

export function parseMonthlyFinancialBatchMetadata(record: MonthlyFinancialBatchRecord): MonthlyFinancialBatchMetadata {
  try {
    let kind = record.fileReferenceKind ?? "unknown", run = record.sourceRunId ?? null;
    if (kind === "unknown" && record.fileUrl) {
      const match = /^saihu-sync-run:([1-9]\d*)$/u.exec(record.fileUrl);
      if (match && id.safeParse(Number(match[1])).success) { kind = "saihu_sync_run"; run = Number(match[1]); }
      else if (/^(?:https:\/\/|s3:\/\/|oss:\/\/)/u.test(record.fileUrl)) kind = "storage";
    }
    if (kind === "saihu_sync_run" && !id.safeParse(run).success || kind !== "saihu_sync_run" && run !== null) throw new Error();
    const months = parseMonthlyFinancialJson(record.months, 64 * 1024);
    const batch = MonthlyFinancialBatchMetadataSchema.parse({ id: record.id, workspaceId: record.workspaceId, userId: record.userId, fileName: record.fileName, fileHash: record.fileHash, status: record.status, totalRows: record.totalRows, skippedRows: record.skippedRows, unallocatedRows: record.unallocatedRows, months, createdAt: record.createdAt, confirmedAt: record.confirmedAt, timestampBasis: "database_datetime_without_timezone", visibility: "full", origin: { kind: kind === "saihu_sync_run" ? "saihu_sync" : kind === "storage" ? "uploaded_file" : "unknown", hashBasis: kind === "saihu_sync_run" ? "mapped_json_bytes" : kind === "storage" ? "original_file_bytes" : "unknown", sourceRunId: run } });
    if (new Set(batch.months).size !== batch.months.length || batch.unallocatedRows > batch.totalRows || batch.status === "completed" && batch.confirmedAt === null) throw new Error();
    return batch;
  } catch { throw new MonthlyFinancialReadError("invalid_metadata"); }
}
function currencyFromRaw(raw: z.infer<typeof MonthlyFinancialRawSchema>) {
  const candidates: Array<{ path: string; value: unknown }> = [];
  if (Object.hasOwn(raw, "currency")) candidates.push({ path: "currency", value: raw.currency });
  if (raw.api && typeof raw.api === "object" && !Array.isArray(raw.api) && Object.hasOwn(raw.api, "currency")) candidates.push({ path: "api.currency", value: raw.api.currency });
  for (const [path, value] of Object.entries(raw)) if (/^\d+:(?:币种|货币)\//u.test(path)) candidates.push({ path, value });
  const values = [...new Set(candidates.filter(item => typeof item.value === "string" && /^[A-Za-z]{3}$/u.test(item.value.trim())).map(item => String(item.value).trim().toUpperCase()))];
  const conflict = values.length > 1 || candidates.some(item => typeof item.value !== "string" || !/^[A-Za-z]{3}$/u.test(item.value.trim()));
  const status = conflict ? "conflict" as const : values.length === 1 ? "explicit" as const : "unknown" as const;
  return { currency: status === "explicit" ? values[0] : null, currencyEvidence: { status, values, rawPaths: candidates.map(item => item.path), note: "只采用原字段明确币种；不从站点、文件名、$符号或页面 USD 文案推断" } };
}
export function parseMonthlyFinancialBatch(record: MonthlyFinancialBatchRecord): MonthlyFinancialParsedBatch {
  const batch = parseMonthlyFinancialBatchMetadata(record);
  try {
    const payload = z.array(storedRowSchema).max(MONTHLY_FINANCIAL_LIMITS.rows).parse(parseMonthlyFinancialJson(record.payload, MONTHLY_FINANCIAL_LIMITS.payloadBytes, MONTHLY_FINANCIAL_LIMITS.payloadBytes * 8));
    if (payload.length !== batch.totalRows || payload.filter(row => !row.parentAsin).length !== batch.unallocatedRows || [...new Set(payload.map(row => row.yearMonth))].sort().join() !== [...batch.months].sort().join()) throw new MonthlyFinancialReadError("count_mismatch");
    const seen = new Set<string>();
    const rows = payload.map((row, rowIndex): MonthlyFinancialReadRow => {
      const market = normalizeMarketplaceCode(row.site);
      const key = JSON.stringify([row.yearMonth, row.storeName, market, row.asin, row.sku]);
      if (row.asin && seen.has(key)) throw new MonthlyFinancialReadError("duplicate_business_row");
      if (row.asin) seen.add(key);
      const { currency, currencyEvidence } = currencyFromRaw(row.raw);
      const metrics = Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(metric => [metric, row[metric]])) as MonthlyFinancialMetrics;
      const api = row.raw.api && typeof row.raw.api === "object" && !Array.isArray(row.raw.api) ? row.raw.api : null;
      const parents = api && Array.isArray(api.parentAsinList) ? [...new Set(api.parentAsinList.filter(parent => typeof parent === "string" && parent !== row.asin && parent !== "-" && parent !== ""))] : [];
      const allocation = parents.length > 1 ? "ambiguous" : !row.parentAsin ? "unallocated" : row.asin ? "child" : "parent_only";
      const details = buildMonthlyFinancialDetails(metrics, row.raw, currency !== null);
      for (const metric of MONTHLY_FINANCIAL_METRICS) for (const component of details.fields[metric].components) component.rawPath = `${batch.id}:${rowIndex}:${component.rawPath}`;
      for (const metric of ["adOrders", "adSales"] as const) details[metric].rawPaths = details[metric].rawPaths.map(path => `${batch.id}:${rowIndex}:${path}`);
      return MonthlyFinancialReadRowSchema.parse({ batchId: batch.id, rowIndex, yearMonth: row.yearMonth, parentAsin: row.parentAsin, asin: row.asin, sku: row.sku, title: row.title, storeName: row.storeName, site: row.site, country: market, operator: row.operator, currency, currencyEvidence, allocation, amountConvention: "stored_normalized_values_and_original_raw_signs", metrics, raw: row.raw, details });
    });
    return { batch, rows };
  } catch (error) { if (error instanceof MonthlyFinancialReadError) throw error; throw new MonthlyFinancialReadError("invalid_payload"); }
}
export function monthlyFinancialRowMatchesScope(row: MonthlyFinancialReadRow, scope: { yearMonth: string; storeName: string; country: string; parentAsin?: string }) {
  return row.yearMonth === scope.yearMonth && row.storeName === scope.storeName && row.country === normalizeMarketplaceCode(scope.country) && (scope.parentAsin === undefined || row.parentAsin === scope.parentAsin && row.allocation !== "ambiguous");
}
export function aggregateMonthlyFinancialRows(rows: MonthlyFinancialReadRow[]): MonthlyFinancialAggregate[] {
  const groups = new Map<string, { dimension: MonthlyFinancialAggregate["dimension"]; basis: MonthlyFinancialAggregate["basis"]; rows: MonthlyFinancialReadRow[]; parentAsin: string | null; asin: string | null }>();
  for (const row of rows) {
    const dimensions: Array<{ dimension: MonthlyFinancialAggregate["dimension"]; parentAsin: string | null; asin: string | null }> = row.allocation === "unallocated" || row.allocation === "ambiguous" ? [{ dimension: "unallocated", parentAsin: null, asin: null }] : [
      ...(row.parentAsin ? [{ dimension: "parent" as const, parentAsin: row.parentAsin, asin: null }] : []),
      ...(row.asin ? [{ dimension: "asin" as const, parentAsin: row.parentAsin || null, asin: row.asin }] : []),
    ];
    for (const dimension of dimensions) {
      const basis = row.allocation === "parent_only" ? "reported_parent_row" as const : dimension.dimension === "unallocated" ? "unallocated_rows" as const : "child_rows" as const;
      // Unknown currency is never silently merged across source rows.
      // A reported parent total is not additive with child-derived totals or
      // another reported parent total; retain each reported total separately.
      const key = JSON.stringify([row.yearMonth, row.storeName, row.country, row.currency, dimension, basis, row.currency === null || basis === "reported_parent_row" ? [row.batchId, row.rowIndex] : null]);
      const group = groups.get(key) ?? { ...dimension, basis, rows: [] }; group.rows.push(row); groups.set(key, group);
    }
  }
  return [...groups.values()].map(group => {
    const first = group.rows[0], values = aggregateMonthlyFinancialDetails(group.rows, first.currency !== null);
    return { dimension: group.dimension, basis: group.basis, scope: { yearMonth: first.yearMonth, storeName: first.storeName, country: first.country, currency: first.currency }, parentAsin: group.parentAsin, asin: group.asin, rowCount: group.rows.length, sourceRows: group.rows.map(row => ({ batchId: row.batchId, rowIndex: row.rowIndex })), ...values, missingReason: first.currency === null ? "来源币种未知；不跨行合计金额" : group.basis === "reported_parent_row" ? "原报表父体合计，独立保留；不可与子体派生合计相加" : group.dimension === "unallocated" ? "未分配或父体有歧义，独立保留，不摊给产品" : null };
  });
}
function checkedIdentity(identity: MonthlyFinancialReadIdentity, workspaceId: number) {
  const result = identitySchema.parse(identity); if (result.workspaceId !== workspaceId) throw new MonthlyFinancialReadError("identity_mismatch"); return result;
}
function checkedResult<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  try {
    // Bound before Zod's defensive cloning as well as in the public schema.
    if (monthlyFinancialJsonBytes(value) > MONTHLY_FINANCIAL_LIMITS.resultBytes) throw new Error();
    return schema.parse(value);
  } catch { throw new MonthlyFinancialReadError("invalid_result"); }
}
function visibleMetadata(batch: MonthlyFinancialBatchMetadata, visibility: "full" | "scoped"): MonthlyFinancialVisibleBatchMetadata {
  return visibility === "full" ? batch : { visibility: "scoped", id: batch.id, status: batch.status, createdAt: batch.createdAt, confirmedAt: batch.confirmedAt, timestampBasis: batch.timestampBasis };
}
function paged(rows: MonthlyFinancialReadRow[], input: { rowOffset: number; pageSize: number }, totalRows: number | null) {
  const pageRows = rows.slice(input.rowOffset, input.rowOffset + input.pageSize);
  const hasMore = input.rowOffset + pageRows.length < rows.length;
  return { rows: pageRows, aggregates: aggregateMonthlyFinancialRows(rows), page: { rowOffset: input.rowOffset, pageSize: input.pageSize, totalRows, matchedRows: rows.length, nextOffset: hasMore ? input.rowOffset + pageRows.length : null, hasMore } };
}
type Failure = { identity: MonthlyFinancialReadIdentity; status: "missing" | "not_found" | "invalid"; reasonCode: string; missingReason: string };
const base = (identity: MonthlyFinancialReadIdentity) => ({ identity, status: "ready" as const, reasonCode: null, missingReason: null, timestampBasis: "database_datetime_without_timezone" as const });
export function buildMonthlyFinancialHistoryFailure(value: Failure & { input: MonthlyFinancialHistoryInput }): MonthlyFinancialHistoryResult {
  return checkedResult(MonthlyFinancialHistoryResultSchema, { ...base(checkedIdentity(value.identity, value.input.expectedWorkspaceId)), status: value.status, reasonCode: value.reasonCode, missingReason: value.missingReason, batches: [], page: { cursor: value.input.cursor, limit: value.input.limit, nextCursor: null, hasMore: false } });
}
export function buildMonthlyFinancialBatchFailure(value: Failure & { input: MonthlyFinancialBatchInput }): MonthlyFinancialBatchResult {
  return checkedResult(MonthlyFinancialBatchResultSchema, { ...base(checkedIdentity(value.identity, value.input.expectedWorkspaceId)), status: value.status, reasonCode: value.reasonCode, missingReason: value.missingReason, batch: null, scope: value.input.scope ?? null, ...paged([], value.input, null) });
}
export function buildMonthlyFinancialSnapshotFailure(value: Failure & { input: MonthlyFinancialSnapshotInput }): MonthlyFinancialSnapshotResult {
  const { expectedWorkspaceId, rowOffset, pageSize, ...scope } = value.input;
  return checkedResult(MonthlyFinancialSnapshotResultSchema, { ...base(checkedIdentity(value.identity, expectedWorkspaceId)), status: value.status, reasonCode: value.reasonCode, missingReason: value.missingReason, scope, batch: null, selectedBatchId: null, winningScopes: [], selection: { rule: "latest_completed_batch_per_month_store_site", complete: value.status === "not_found", scannedCount: null }, ...paged([], { rowOffset, pageSize }, null) });
}
export function buildMonthlyFinancialHistoryResult(value: { identity: MonthlyFinancialReadIdentity; input: MonthlyFinancialHistoryInput; records: MonthlyFinancialBatchRecord[]; tableMissing?: boolean }): MonthlyFinancialHistoryResult {
  const input = MonthlyFinancialHistoryInputSchema.parse(value.input), identity = checkedIdentity(value.identity, input.expectedWorkspaceId);
  if (value.tableMissing) return buildMonthlyFinancialHistoryFailure({ identity, input, status: "missing", reasonCode: "table_missing", missingReason: "完整月报批次表尚未接通，不表示已有零条历史" });
  if (value.records.length > input.limit + 1) throw new MonthlyFinancialReadError("history_limit");
  const batches = value.records.map(parseMonthlyFinancialBatchMetadata);
  for (let index = 0; index < batches.length; index++) if (batches[index].workspaceId !== identity.workspaceId || input.cursor !== null && batches[index].id >= input.cursor || index > 0 && batches[index].id >= batches[index - 1].id) throw new MonthlyFinancialReadError("history_order_or_scope");
  const hasMore = batches.length > input.limit, pageBatches = batches.slice(0, input.limit);
  return checkedResult(MonthlyFinancialHistoryResultSchema, { ...base(identity), batches: pageBatches, page: { cursor: input.cursor, limit: input.limit, nextCursor: hasMore ? pageBatches.at(-1)!.id : null, hasMore } });
}
export function buildMonthlyFinancialBatchResult(value: { identity: MonthlyFinancialReadIdentity; input: MonthlyFinancialBatchInput; record: MonthlyFinancialBatchRecord | null; tableMissing?: boolean; metadataVisibility?: "full" | "scoped" }): MonthlyFinancialBatchResult {
  const input = MonthlyFinancialBatchInputSchema.parse(value.input), identity = checkedIdentity(value.identity, input.expectedWorkspaceId);
  if (value.tableMissing || !value.record) return buildMonthlyFinancialBatchFailure({ identity, input, status: value.tableMissing ? "missing" : "not_found", reasonCode: value.tableMissing ? "table_missing" : "batch_not_found", missingReason: value.tableMissing ? "完整月报批次表尚未接通" : "没有可读取的指定月报批次" });
  const parsed = parseMonthlyFinancialBatch(value.record);
  if (parsed.batch.workspaceId !== identity.workspaceId || parsed.batch.id !== input.batchId) throw new MonthlyFinancialReadError("batch_identity_mismatch");
  const visibility = value.metadataVisibility ?? "full";
  if (visibility === "scoped" && !input.scope) throw new MonthlyFinancialReadError("exact_scope_required");
  const rows = input.scope ? parsed.rows.filter(row => monthlyFinancialRowMatchesScope(row, input.scope!)) : parsed.rows;
  return checkedResult(MonthlyFinancialBatchResultSchema, { ...base(identity), batch: visibleMetadata(parsed.batch, visibility), scope: input.scope ?? null, ...paged(rows, input, visibility === "full" ? parsed.batch.totalRows : null) });
}
export function findMonthlyFinancialSnapshot(records: MonthlyFinancialBatchRecord[], scope: { yearMonth: string; storeName: string; country: string }, scanComplete: boolean): MonthlyFinancialSnapshotSelection {
  if (records.length > MONTHLY_FINANCIAL_LIMITS.scanBatches) throw new MonthlyFinancialReadError("scan_limit");
  const scannedBatchIds: number[] = [];
  for (const record of records) {
    if (record.status !== "completed" || scannedBatchIds.length && record.id >= scannedBatchIds.at(-1)!) throw new MonthlyFinancialReadError("snapshot_order");
    scannedBatchIds.push(record.id);
    const parsed = parseMonthlyFinancialBatch(record);
    // Deliberately ignore parent/uploader here: a newer scope replaces the entire old scope.
    if (parsed.rows.some(row => monthlyFinancialRowMatchesScope(row, { yearMonth: scope.yearMonth, storeName: scope.storeName, country: scope.country }))) return { selected: parsed, scannedBatchIds, complete: true };
  }
  return { selected: null, scannedBatchIds, complete: scanComplete };
}
export function buildMonthlyFinancialSnapshotResult(value: { identity: MonthlyFinancialReadIdentity; input: MonthlyFinancialSnapshotInput; selection: MonthlyFinancialSnapshotSelection; tableMissing?: boolean; metadataVisibility?: "full" | "scoped" }): MonthlyFinancialSnapshotResult {
  const input = MonthlyFinancialSnapshotInputSchema.parse(value.input), identity = checkedIdentity(value.identity, input.expectedWorkspaceId);
  const { expectedWorkspaceId: _workspace, rowOffset: _offset, pageSize: _size, ...scope } = input;
  if (value.tableMissing || !value.selection.complete || !value.selection.selected) return buildMonthlyFinancialSnapshotFailure({ identity, input, status: value.tableMissing ? "missing" : value.selection.complete ? "not_found" : "invalid", reasonCode: value.tableMissing ? "table_missing" : value.selection.complete ? "scope_not_found" : "scan_incomplete", missingReason: value.tableMissing ? "完整月报批次表尚未接通" : value.selection.complete ? "没有该完整月份、店铺、站点的已确认快照" : "扫描未完成或超过限额，不用旧快照代替当前快照" });
  const { selected, scannedBatchIds } = value.selection;
  if (selected.batch.workspaceId !== identity.workspaceId || selected.batch.status !== "completed" || scannedBatchIds.length > MONTHLY_FINANCIAL_LIMITS.scanBatches || scannedBatchIds.at(-1) !== selected.batch.id || scannedBatchIds.some((value, index) => !id.safeParse(value).success || index > 0 && value >= scannedBatchIds[index - 1]) || !selected.rows.some(row => monthlyFinancialRowMatchesScope(row, { yearMonth: input.yearMonth, storeName: input.storeName, country: input.country }))) throw new MonthlyFinancialReadError("snapshot_identity_mismatch");
  const visibility = value.metadataVisibility ?? "full";
  if (visibility === "scoped" && !input.parentAsin) throw new MonthlyFinancialReadError("exact_scope_required");
  const rows = selected.rows.filter(row => monthlyFinancialRowMatchesScope(row, scope));
  return checkedResult(MonthlyFinancialSnapshotResultSchema, { ...base(identity), scope, batch: visibleMetadata(selected.batch, visibility), selectedBatchId: selected.batch.id, winningScopes: [{ yearMonth: input.yearMonth, storeName: input.storeName, country: input.country, batchId: selected.batch.id }], selection: { rule: "latest_completed_batch_per_month_store_site", complete: true, scannedCount: visibility === "full" ? scannedBatchIds.length : null }, ...paged(rows, input, visibility === "full" ? selected.batch.totalRows : null) });
}
