import { z } from "zod";
import { ProfitAnalysisPreviewInputSchema, ProfitAnalysisResultSchema, type ProfitAnalysisResult } from "./profitAnalysis";
import { ProfitAnalysisOperationInputSchema, ProfitAnalysisSaveOperationInputSchema, ProfitAnalysisWorkflowStateSchema } from "./profitAnalysisWorkflow";

/** Public projections only: no source raw rows, private snapshot, execution
 * pins, prompts, configuration body or model credentials may cross this API.
 * Hash shape/source bindings do not replace fresh authorization or server CAS. */
const id = z.number().int().safe().positive().max(2_147_483_647);
const revision = z.number().int().safe().min(0).max(2_147_483_647);
const uuid = z.string().uuid().refine(value => value === value.toLowerCase(), "Operation UUID must be lowercase");
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const errorCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/u);
const reasonCode = z.string().min(1).max(200).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value));
const time = z.string().regex(/^[1-9]\d{3}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]) (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}$/u)
  .refine(value => {
    const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  }, "Invalid database calendar date");
const issue = (ctx: z.RefinementCtx, message: string) => ctx.addIssue({ code: "custom", message });
export const ProfitAnalysisWorkflowIdentitySchema = z.object({ workspaceId: id, userId: id }).strict();
export type ProfitAnalysisWorkflowIdentity = z.infer<typeof ProfitAnalysisWorkflowIdentitySchema>;

export const ProfitAnalysisPublicRunSchema = z.object({
  operationId: uuid,
  state: ProfitAnalysisWorkflowStateSchema,
  errorCode: errorCode.nullable(),
  sourceHash: hash.nullable(),
  resultHash: hash.nullable(),
  result: ProfitAnalysisResultSchema.nullable(),
  stale: z.boolean().nullable(),
  createdAt: time,
  updatedAt: time,
  completedAt: time.nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.state === "succeeded") {
    if (!value.result || value.resultHash === null || value.sourceHash === null || value.completedAt === null || value.errorCode !== null) issue(ctx, "Successful run requires its complete result and source binding");
  } else if (value.result !== null) issue(ctx, "Uncommitted run must not expose result content");
  if (value.result && value.sourceHash !== value.result.sourceHash) issue(ctx, "Run result/source hash mismatch");
  if (value.resultHash !== null && value.sourceHash === null) issue(ctx, "Result hash requires a source binding");
  if (value.sourceHash === null && value.stale !== null) issue(ctx, "Unknown source cannot claim a freshness verdict");
});
export type ProfitAnalysisPublicRun = z.infer<typeof ProfitAnalysisPublicRunSchema>;

export const ProfitAnalysisReportSchema = z.object({
  version: revision,
  activeOperationId: uuid.nullable(),
  latestOperationId: uuid.nullable(),
  savedOperationId: uuid.nullable(),
  updatedAt: time,
  savedAt: time.nullable(),
}).strict().superRefine((value, ctx) => {
  if ((value.savedOperationId === null) !== (value.savedAt === null)) issue(ctx, "Saved report identity/time mismatch");
});
export type ProfitAnalysisReport = z.infer<typeof ProfitAnalysisReportSchema>;

export const ProfitAnalysisGenerationCapabilitySchema = z.object({
  available: z.boolean(),
  reasonCode: reasonCode.nullable(),
  modelRequired: z.boolean().nullable(),
  configuration: z.object({ revision: id, hash }).strict().nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.available !== (value.reasonCode === null)) issue(ctx, "Generation capability must explain unavailability");
  if (value.available && (value.modelRequired === null || value.modelRequired && value.configuration === null)) issue(ctx, "Available model execution requires an explicit approved configuration reference");
});
export type ProfitAnalysisGenerationCapability = z.infer<typeof ProfitAnalysisGenerationCapabilitySchema>;

function sameResultContext(result: ProfitAnalysisResult, identity: ProfitAnalysisWorkflowIdentity, request: z.infer<typeof ProfitAnalysisPreviewInputSchema>) {
  return result.identity.userId === identity.userId && result.identity.workspaceId === identity.workspaceId
    && result.month === request.month && result.scope.storeName === request.scope.storeName && result.scope.country === request.scope.country
    && result.scope.parentAsin === request.scope.parentAsin && result.scope.currency === request.scope.currency && result.scope.basis === request.scope.basis;
}
export const ProfitAnalysisViewResultSchema = z.object({
  version: z.literal(1),
  identity: ProfitAnalysisWorkflowIdentitySchema,
  request: ProfitAnalysisPreviewInputSchema,
  report: ProfitAnalysisReportSchema.nullable(),
  currentSourceHash: hash.nullable(),
  sourceStatus: z.enum(["ready", "blocked", "unavailable"]),
  generation: ProfitAnalysisGenerationCapabilitySchema,
  run: ProfitAnalysisPublicRunSchema.nullable(),
  draft: ProfitAnalysisPublicRunSchema.nullable(),
  saved: ProfitAnalysisPublicRunSchema.nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.identity.workspaceId !== value.request.expectedWorkspaceId) issue(ctx, "View workspace/request mismatch");
  if (value.sourceStatus !== "unavailable" && value.currentSourceHash === null) issue(ctx, "Available source requires its current hash");
  if (value.generation.available && value.sourceStatus !== "ready") issue(ctx, "Generation cannot be available for blocked or missing source");
  for (const run of [value.run, value.draft, value.saved]) {
    if (run?.result && !sameResultContext(run.result, value.identity, value.request)) issue(ctx, "Run result outside private view identity, scope or month");
    // A missing current source cannot validate an old result as fresh. History
    // has no current-source field, so its freshness must be computed by service.
    if (run && run.stale !== (run.sourceHash === null ? null : value.currentSourceHash === null || run.sourceHash !== value.currentSourceHash)) issue(ctx, "Run freshness/current source mismatch");
  }
  if (value.draft && value.draft.state !== "succeeded" || value.saved && value.saved.state !== "succeeded") issue(ctx, "Draft and saved projections require successful runs");
  if (value.draft && (!value.report || value.report.latestOperationId !== value.draft.operationId)) issue(ctx, "Draft result/report pointer mismatch");
  if (value.saved && (!value.report || value.report.savedOperationId !== value.saved.operationId)) issue(ctx, "Saved result/report pointer mismatch");
});
export type ProfitAnalysisViewResult = z.infer<typeof ProfitAnalysisViewResultSchema>;

/** Exact-month run history, bounded independently of the six-month board.
 * The server owns numeric IDs and cursor ordering; clients receive no run ID. */
export const ProfitAnalysisHistoryResultSchema = z.object({
  version: z.literal(1),
  identity: ProfitAnalysisWorkflowIdentitySchema,
  request: ProfitAnalysisPreviewInputSchema,
  items: z.array(ProfitAnalysisPublicRunSchema).max(20),
  nextBeforeId: id.nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.identity.workspaceId !== value.request.expectedWorkspaceId) issue(ctx, "History workspace/request mismatch");
  if (new Set(value.items.map(run => run.operationId)).size !== value.items.length) issue(ctx, "Duplicate history operation");
  if (!value.items.length && value.nextBeforeId !== null) issue(ctx, "Empty history cannot advertise a next cursor");
  for (const run of value.items) if (run.result && !sameResultContext(run.result, value.identity, value.request)) issue(ctx, "History result outside private identity, scope or month");
});
export type ProfitAnalysisHistoryResult = z.infer<typeof ProfitAnalysisHistoryResultSchema>;

export const ProfitAnalysisSaveReceiptSchema = z.object({
  saveId: uuid,
  operationId: uuid,
  requestHash: hash,
  resultHash: hash,
  sourceHash: hash,
  reportVersion: id,
  savedAt: time,
}).strict().refine(value => value.saveId !== value.operationId, { path: ["saveId"], message: "Save and generation operations must be distinct" });
export type ProfitAnalysisSaveReceipt = z.infer<typeof ProfitAnalysisSaveReceiptSchema>;
export const ProfitAnalysisSaveResultSchema = z.object({
  version: z.literal(1),
  identity: ProfitAnalysisWorkflowIdentitySchema,
  request: ProfitAnalysisSaveOperationInputSchema,
  status: z.enum(["absent", "committed", "canceled"]),
  receipt: ProfitAnalysisSaveReceiptSchema.nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.identity.workspaceId !== value.request.expectedWorkspaceId) issue(ctx, "Save workspace/request mismatch");
  if ((value.status === "committed") !== (value.receipt !== null)) issue(ctx, "Only a committed save may expose a receipt");
  if (value.receipt && value.receipt.saveId !== value.request.saveOperationId) issue(ctx, "Save receipt/request UUID mismatch");
});
export type ProfitAnalysisSaveResult = z.infer<typeof ProfitAnalysisSaveResultSchema>;

/** Cancellation is metadata-only. It must remain possible to fence one's own
 * durable operation without re-exposing financial content after source changes.
 * The returned state, not the fact that cancel was requested, is authoritative. */
export const ProfitAnalysisCancelResultSchema = z.object({
  version: z.literal(1),
  identity: ProfitAnalysisWorkflowIdentitySchema,
  request: ProfitAnalysisOperationInputSchema,
  operationId: uuid,
  state: ProfitAnalysisWorkflowStateSchema,
  errorCode: errorCode.nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.identity.workspaceId !== value.request.expectedWorkspaceId) issue(ctx, "Cancel workspace/request mismatch");
  if (value.operationId !== value.request.operationId) issue(ctx, "Cancel operation/request UUID mismatch");
});
export type ProfitAnalysisCancelResult = z.infer<typeof ProfitAnalysisCancelResultSchema>;

// Explicit workflow names are the service/router's stable public imports.
export const ProfitAnalysisWorkflowViewResultSchema = ProfitAnalysisViewResultSchema;
export const ProfitAnalysisWorkflowHistoryResultSchema = ProfitAnalysisHistoryResultSchema;
export const ProfitAnalysisWorkflowSaveResultSchema = ProfitAnalysisSaveResultSchema;
export const ProfitAnalysisWorkflowCancelResultSchema = ProfitAnalysisCancelResultSchema;
export type ProfitAnalysisWorkflowViewResult = ProfitAnalysisViewResult;
export type ProfitAnalysisWorkflowHistoryResult = ProfitAnalysisHistoryResult;
export type ProfitAnalysisWorkflowSaveResult = ProfitAnalysisSaveResult;
export type ProfitAnalysisWorkflowCancelResult = ProfitAnalysisCancelResult;
