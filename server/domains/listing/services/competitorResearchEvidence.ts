import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { TrpcContext } from "../../../_core/context";
import { buildCompetitorResearchEvidencePlan, summarizeCompetitorResearchEvidencePlan,
  CompetitorResearchEvidenceError } from "../../../../shared/competitorResearchEvidence";
import { competitorReviewRead, competitorReviewSourceSchema } from "./competitorReviewRead";

export const competitorResearchEvidenceSchema = competitorReviewSourceSchema.extend({
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
});
type Request = z.infer<typeof competitorResearchEvidenceSchema>;
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const defaults = { readFullCorpus: competitorReviewRead.readFullCorpus };
function fail(code: "CONFLICT" | "PRECONDITION_FAILED", message: string): never { throw new TRPCError({ code, message }); }
function safeError(error: unknown): never {
  if (error instanceof z.ZodError) throw new TRPCError({ code: "BAD_REQUEST", message: "COMPETITOR_EVIDENCE_INPUT_INVALID" });
  if (error instanceof TRPCError && /^COMPETITOR_(?:REVIEWS|EVIDENCE)_[A-Z_]+$/u.test(error.message)) throw error;
  if (error instanceof CompetitorResearchEvidenceError) {
    const message = error.code === "EVIDENCE_REVIEW_TOO_LARGE" ? "COMPETITOR_EVIDENCE_REVIEW_TOO_LARGE" : "COMPETITOR_EVIDENCE_SOURCE_INVALID";
    fail("PRECONDITION_FAILED", message);
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "COMPETITOR_EVIDENCE_PREVIEW_FAILED" });
}

/** Inputs come only from a complete authorized, revision-pinned saved source.
 * This prepares evidence, not prompts or a research result. It performs no model
 * calls/writes and never treats the legacy AI summary as original evidence. */
export function createCompetitorResearchEvidenceService(dependencies: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...dependencies };
  async function load(ctx: TrpcContext, raw: Request) {
    try {
      const input = competitorResearchEvidenceSchema.parse(raw);
      const source = await deps.readFullCorpus(ctx, input), identity = source.identity;
      const workspaceId = ctx.workspaceId !== undefined ? ctx.workspaceId : ctx.user?.defaultWorkspaceId;
      if (!ctx.user || identity.userId !== ctx.user.id || identity.workspaceId !== workspaceId
        || identity.workspaceId !== input.expectedWorkspaceId || identity.projectId !== input.projectId
        || identity.analysisId !== input.analysisId || identity.revision !== input.expectedRevision
        || (identity.sourceWorkspaceId !== null && identity.sourceWorkspaceId !== identity.workspaceId))
        fail("CONFLICT", "COMPETITOR_EVIDENCE_SCOPE_CHANGED");
      const { title, bulletPoints } = source.listing;
      // Preserve exact source strings. Empty title is missing; malformed or
      // excessive content is rejected explicitly, never sliced to fit a prompt.
      if (title !== null && (typeof title !== "string" || title.length > 32_000))
        fail("PRECONDITION_FAILED", "COMPETITOR_EVIDENCE_LISTING_INVALID");
      let bullets: unknown = [];
      if (bulletPoints !== null) {
        if (typeof bulletPoints !== "string" || Buffer.byteLength(bulletPoints, "utf8") > 2 * 1024 * 1024)
          fail("PRECONDITION_FAILED", "COMPETITOR_EVIDENCE_LISTING_INVALID");
        try { bullets = JSON.parse(bulletPoints); }
        catch { fail("PRECONDITION_FAILED", "COMPETITOR_EVIDENCE_LISTING_INVALID"); }
      }
      if (!Array.isArray(bullets) || bullets.length > 100
        || !bullets.every(value => typeof value === "string" && value.trim() && value.length <= 32_000))
        fail("PRECONDITION_FAILED", "COMPETITOR_EVIDENCE_LISTING_INVALID");
      return buildCompetitorResearchEvidencePlan({ identity, title: title?.trim() ? title : null, bullets, reviews: source.reviews }, digest);
    } catch (error) { return safeError(error); }
  }
  async function preview(ctx: TrpcContext, raw: Request) {
    try { return summarizeCompetitorResearchEvidencePlan(await load(ctx, raw), digest); }
    catch (error) { return safeError(error); }
  }
  // Full source never crosses the browser API. A future approved model adapter
  // can call load and must separately pin Skill/model config and save checkpoints.
  return { load, preview };
}
export const competitorResearchEvidence = createCompetitorResearchEvidenceService();
