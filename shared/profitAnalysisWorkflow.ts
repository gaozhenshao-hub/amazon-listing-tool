import { z } from "zod";
import { ProfitAnalysisPreviewInputSchema } from "./profitAnalysis";

/** Private profit workflow protocol only. Parsing a caller's expected hash,
 * workspace or version does not authorize a source, Skill, model or write.
 * Fresh server authorization and exact-scope transactional CAS remain required.
 * This module neither chooses a Qingdao manifest nor enables model execution. */
const uuid = z.string().uuid().refine(value => value === value.toLowerCase(), "Operation UUID must be lowercase");
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const version = z.number().int().safe().min(0).max(2_147_483_647);
const id = z.number().int().safe().positive().max(2_147_483_647);

/** Zero is the caller's expected absent-report version, not permission to
 * overwrite an existing report. Regeneration is explicit intent, never force. */
export const ProfitAnalysisStartInputSchema = ProfitAnalysisPreviewInputSchema.extend({
  operationId: uuid,
  expectedReportVersion: version,
  expectedSourceHash: hash,
  regenerateConfirmed: z.boolean(),
}).strict();
export const ProfitAnalysisOperationInputSchema = ProfitAnalysisPreviewInputSchema.extend({ operationId: uuid }).strict();

/** Saving an already-generated draft is a separate, non-model operation. The
 * server must retain old saved results until this exact draft is committed. */
export const ProfitAnalysisSaveInputSchema = ProfitAnalysisPreviewInputSchema.extend({
  saveOperationId: uuid,
  runOperationId: uuid,
  expectedReportVersion: version,
  expectedResultHash: hash,
  expectedSourceHash: hash,
}).strict().refine(value => value.saveOperationId !== value.runOperationId, {
  path: ["saveOperationId"], message: "Saving requires a distinct operation UUID",
});
export const ProfitAnalysisSaveOperationInputSchema = ProfitAnalysisPreviewInputSchema.extend({ saveOperationId: uuid }).strict();

/** Cursor history for one exact private report/month, not six-month business
 * data or a caller-selected owner. A server response must expose continuation. */
export const ProfitAnalysisHistoryInputSchema = ProfitAnalysisPreviewInputSchema.extend({
  beforeId: id.optional(),
  limit: z.number().int().min(1).max(20).default(10),
}).strict();

export type ProfitAnalysisStartInput = z.infer<typeof ProfitAnalysisStartInputSchema>;
export type ProfitAnalysisOperationInput = z.infer<typeof ProfitAnalysisOperationInputSchema>;
export type ProfitAnalysisSaveInput = z.infer<typeof ProfitAnalysisSaveInputSchema>;
export type ProfitAnalysisSaveOperationInput = z.infer<typeof ProfitAnalysisSaveOperationInputSchema>;
export type ProfitAnalysisHistoryInput = z.infer<typeof ProfitAnalysisHistoryInputSchema>;

export const PROFIT_ANALYSIS_WORKFLOW_STATES = [
  "queued", "dispatched", "result_ready", "succeeded", "failed", "canceled", "unknown",
] as const;
export const ProfitAnalysisWorkflowStateSchema = z.enum(PROFIT_ANALYSIS_WORKFLOW_STATES);
export type ProfitAnalysisWorkflowState = z.infer<typeof ProfitAnalysisWorkflowStateSchema>;

const transitions: Readonly<Record<ProfitAnalysisWorkflowState, readonly ProfitAnalysisWorkflowState[]>> = {
  // Direct queued -> result_ready is ONLY for a server-validated deterministic
  // no-comparable-change result. It cannot skip source validation or fabricate AI.
  queued: ["dispatched", "result_ready", "failed", "canceled"],
  // Once dispatched, uncertain transport/provider outcomes are unknown, never
  // a retriable pre-call failure. Dispatch itself is never retried after expiry.
  dispatched: ["result_ready", "canceled", "unknown"],
  // Local commit failure retains the durable paid result for local recovery;
  // it must not become failed or trigger another provider invocation.
  result_ready: ["succeeded", "canceled"],
  succeeded: [],
  failed: [],
  canceled: [],
  unknown: ["canceled"],
};

/** Describes legal state changes, not authority to perform them. Durable
 * request identity, lease ownership and SQL CAS must also match. Cancellation
 * never reverses provider charges or deletes a previously saved report. */
export function canTransitionProfitAnalysisWorkflow(from: ProfitAnalysisWorkflowState, to: ProfitAnalysisWorkflowState): boolean {
  return transitions[ProfitAnalysisWorkflowStateSchema.parse(from)].includes(ProfitAnalysisWorkflowStateSchema.parse(to));
}

export type ProfitAnalysisLeaseRecovery = "reclaim" | "mark_unknown" | "finish_locally" | "none";

/** Recovery of an expired lease. Only queued work may be claimed for a first
 * dispatch; a durable result is finalized locally without calling the model. */
export function profitAnalysisLeaseRecovery(state: ProfitAnalysisWorkflowState): ProfitAnalysisLeaseRecovery {
  switch (ProfitAnalysisWorkflowStateSchema.parse(state)) {
    case "queued": return "reclaim";
    case "dispatched": return "mark_unknown";
    case "result_ready": return "finish_locally";
    default: return "none";
  }
}
