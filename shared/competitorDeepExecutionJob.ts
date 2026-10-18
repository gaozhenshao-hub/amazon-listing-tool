import { z } from "zod";

/** Domain-owned lane; generic AI retry/recovery must never dispatch it. */
export const COMPETITOR_DEEP_EXECUTION_JOB_KIND = "listing_competitor_deep_v1";
const id = z.number().int().positive().safe();
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const scope = z.object({ projectId: id, analysisId: id, expectedWorkspaceId: id.nullable() }).strict();
const identity = z.object({ userId: id, workspaceId: id.nullable() }).strict();
const reason = z.string().regex(/^[A-Z][A-Z0-9_]{0,119}$/u).nullable();
export const CompetitorDeepOptionsInputSchema = scope.extend({ expectedRevision: hash }).strict();
export const CompetitorDeepStartInputSchema = CompetitorDeepOptionsInputSchema.extend({ expectedEvidenceHash: hash, operationId: uuid }).strict();
export const CompetitorDeepOperationInputSchema = scope.extend({ operationId: uuid }).strict();
export const CompetitorDeepOptionsResultSchema = z.object({ identity, projectId: id, analysisId: id, revision: hash,
  evidenceHash: hash, capability: z.object({ available: z.boolean(), reasonCode: reason }).strict().refine(value => value.available === (value.reasonCode === null)),
  workerEnabled: z.boolean(), reviewRequired: z.literal(true) }).strict();
export const CompetitorDeepJobViewSchema = z.object({ identity, projectId: id, analysisId: id, operationId: uuid,
  runId: z.string().regex(/^deep_[a-f0-9]{64}$/u).nullable(),
  status: z.enum(["queued", "running", "succeeded", "failed", "canceled", "unknown", "not_found"]),
  stage: z.string().min(1).max(80).nullable(), progress: z.number().int().min(0).max(100).nullable(),
  sourceRevision: hash.nullable(), evidenceHash: hash.nullable(), sourceChanged: z.boolean(), canCancel: z.boolean(),
  reviewRequired: z.literal(true), deepResearchComplete: z.literal(false), committedRevision: hash.nullable(), reasonCode: reason,
}).strict().superRefine((value, ctx) => {
  if (value.status === "succeeded" && (!value.committedRevision || !value.sourceRevision || !value.evidenceHash || value.progress !== 100 || value.canCancel)
    || value.status !== "succeeded" && value.committedRevision !== null
    || ["not_found", "unknown"].includes(value.status) && value.progress !== null
    || ["succeeded", "canceled"].includes(value.status) && value.canCancel)
    ctx.addIssue({ code: "custom", message: "Inconsistent job receipt" });
});
export type CompetitorDeepOptionsInput = z.infer<typeof CompetitorDeepOptionsInputSchema>;
export type CompetitorDeepStartInput = z.infer<typeof CompetitorDeepStartInputSchema>;
export type CompetitorDeepOperationInput = z.infer<typeof CompetitorDeepOperationInputSchema>;
export type CompetitorDeepOptionsResult = z.infer<typeof CompetitorDeepOptionsResultSchema>;
export type CompetitorDeepJobView = z.infer<typeof CompetitorDeepJobViewSchema>;
