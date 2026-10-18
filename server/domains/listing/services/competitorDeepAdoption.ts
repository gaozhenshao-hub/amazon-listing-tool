import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../../../_core/context";
import { CompetitorDeepAdoptionInputSchema, CompetitorDeepAdoptionOperationInputSchema, CompetitorDeepAdoptionResultSchema,
  competitorDeepAdoptionHash, competitorDeepAdoptionSourceFingerprint, matchesCurrentCompetitorDeepAdoptionReview, type CompetitorDeepAdoptionReceipt,
  type CompetitorDeepAdoptionRef, type CompetitorDeepAdoptionInput, type CompetitorDeepAdoptionOperationInput } from "../../../../shared/competitorDeepAdoption";
import type { CompetitorAnalysis } from "../../../../drizzle/schema/project";
import { competitorReviewWorkspace } from "./competitorSummaryReview";
import { competitorDeepResultRead, competitorDeepResultReadSchema } from "./competitorDeepResultRead";
import { competitorDeepAdoptionRepository, createCompetitorDeepAdoptionRepository, deepAdoptionEmptyReceipt,
  deepAdoptionError, deepAdoptionRequestHash, type CompetitorDeepAdoptionScope } from "../../../repositories/listing/competitorDeepAdoptionRepository";
import { competitorRevision } from "../../../repositories/project/competitorWritePolicy";

function current(ref: CompetitorDeepAdoptionRef | null, row: CompetitorAnalysis) {
  if (!ref || !matchesCurrentCompetitorDeepAdoptionReview(row, ref)) return false;
  try { return competitorDeepAdoptionHash(JSON.parse(row.rawData!)["deepAdoptionRef"]) === competitorDeepAdoptionHash(ref)
    && competitorDeepAdoptionSourceFingerprint(row) === ref.sourceFingerprint; } catch { return false; }
}
function response(receipt: CompetitorDeepAdoptionReceipt, row?: CompetitorAnalysis, currentActive = false) {
  return CompetitorDeepAdoptionResultSchema.parse({ ...receipt, currentRevision: row ? competitorRevision(row) : null,
    currentActive });
}
function known(error: unknown) { return error instanceof TRPCError && (/^DEEP_(?:ADOPTION|RESULT_READ)_[A-Z_]+$/u.test(error.message)
  || ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND", "CONFLICT", "BAD_REQUEST"].includes(error.code)); }
function safe(error: unknown): never {
  if (known(error)) throw error;
  throw new TRPCError({ code: "PRECONDITION_FAILED", message: "DEEP_ADOPTION_READ_UNAVAILABLE" });
}
/** Human-only adoption. No queued/model work or implicit retry. The UI keeps
 * the original UUID after an uncertain acknowledgement and checks/cancels it. */
export function createCompetitorDeepAdoptionService(deps: { repository?: ReturnType<typeof createCompetitorDeepAdoptionRepository>;
  reader?: Pick<typeof competitorDeepResultRead, "read"> } = {}) {
  const repository = deps.repository ?? competitorDeepAdoptionRepository, reader = deps.reader ?? competitorDeepResultRead;
  type Session = Parameters<Parameters<typeof repository.transaction>[0]>[0];
  async function checkedResponse(session: Session, target: CompetitorDeepAdoptionScope, receipt: CompetitorDeepAdoptionReceipt, row: CompetitorAnalysis) {
    let currentActive = false;
    if (receipt.status === "committed" && current(receipt.ref, row)) {
      try {
        const verified = await session.verified(target, competitorRevision(row)), proof = await session.active(target, verified);
        currentActive = proof !== null && competitorDeepAdoptionHash(proof.ref) === competitorDeepAdoptionHash(receipt.ref)
          && current(proof.ref, verified.analysis);
      } catch (error) {
        if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) throw error;
        // A durable committed receipt survives later proof retention/corruption.
        // It does not assert that the current source remains usable.
      }
    }
    return response(receipt, row, currentActive);
  }
  function scope(ctx: TrpcContext, input: CompetitorDeepAdoptionOperationInput): CompetitorDeepAdoptionScope {
    const workspaceId = competitorReviewWorkspace(ctx);
    if (input.expectedWorkspaceId !== workspaceId) deepAdoptionError("WORKSPACE_CHANGED", "CONFLICT");
    return { userId: ctx.user!.id, workspaceId, projectId: input.projectId, analysisId: input.analysisId, jobRunId: input.jobRunId, operationId: input.operationId };
  }
  async function options(ctx: TrpcContext, raw: Parameters<typeof reader.read>[1]) {
    const input = competitorDeepResultReadSchema.parse(raw), candidate = await reader.read(ctx, input);
    if (candidate.status === "not_available") return { candidate, capability: { available: false, reasonCode: "DEEP_ADOPTION_NO_CANDIDATE" }, currentAdoptionValid: false, activeAdoption: null, currentSummary: null };
    const request = { ...input, jobRunId: candidate.result.deepAnalysis.source.jobRunId, operationId: "00000000-0000-4000-8000-000000000000" };
    const target = scope(ctx, request);
    try {
      return await repository.transaction(async session => {
        const verified = await session.verified(target, input.expectedRevision), adopted = await session.active(target, verified);
        const fresh = { ...candidate, currentRevision: verified.currentRevision, sourceChanged: verified.receipt.committedRevision !== verified.currentRevision, result: verified.result };
        const reasonCode = !repository.enabled() ? "DEEP_ADOPTION_WRITES_DISABLED" : !adopted && fresh.sourceChanged ? "DEEP_ADOPTION_SOURCE_CHANGED" : null;
        const currentAdoptionValid = adopted !== null && current(adopted.ref, verified.analysis);
        return { candidate: fresh, capability: { available: reasonCode === null, reasonCode },
          currentAdoptionValid, activeAdoption: currentAdoptionValid ? adopted!.ref : null, currentSummary: verified.analysis.summary };
      });
    } catch (error) {
      // Readability does not confer edit authority. Only explicitly known
      // unavailable write prerequisites are represented as a disabled control.
      if (error instanceof TRPCError && ["PRECONDITION_FAILED", "CONFLICT"].includes(error.code)
        && /^DEEP_(?:ADOPTION|RESULT_READ)_[A-Z_]+$/u.test(error.message)) {
        return { candidate, capability: { available: false, reasonCode: error.message }, currentAdoptionValid: false, activeAdoption: null, currentSummary: null };
      }
      return safe(error);
    }
  }
  async function adopt(ctx: TrpcContext, raw: CompetitorDeepAdoptionInput) {
    const input = CompetitorDeepAdoptionInputSchema.parse(raw), target = scope(ctx, input), requestHash = deepAdoptionRequestHash(target, input);
    try {
      return await repository.transaction(async session => {
        const owned = await session.target(target), previous = await session.final(target);
        if (previous) {
          if (previous.status === "committed" && previous.requestHash !== requestHash) deepAdoptionError("OPERATION_CONTENT_CONFLICT", "CONFLICT");
          return checkedResponse(session, target, previous, owned.analysis);
        }
        if (!repository.enabled()) deepAdoptionError("WRITES_DISABLED");
        const verified = await session.verified(target, input.expectedRevision), receipt = await session.adopt(target, input, verified);
        const saved = await session.target(target);
        if (saved.currentRevision !== receipt.committedRevision) deepAdoptionError("READBACK_FAILED", "CONFLICT");
        return checkedResponse(session, target, receipt, saved.analysis);
      });
    } catch (error) {
      if (known(error)) throw error;
      return response(deepAdoptionEmptyReceipt(target, "unknown"));
    }
  }
  async function check(ctx: TrpcContext, raw: CompetitorDeepAdoptionOperationInput) {
    const input = CompetitorDeepAdoptionOperationInputSchema.parse(raw), target = scope(ctx, input);
    try { return await repository.transaction(async session => {
      const owned = await session.target(target), receipt = await session.final(target) ?? deepAdoptionEmptyReceipt(target, "unknown");
      return checkedResponse(session, target, receipt, owned.analysis);
    }); } catch (error) { return safe(error); }
  }
  async function cancel(ctx: TrpcContext, raw: CompetitorDeepAdoptionOperationInput) {
    const input = CompetitorDeepAdoptionOperationInputSchema.parse(raw), target = scope(ctx, input);
    try { return await repository.transaction(async session => {
      const owned = await session.target(target), receipt = await session.cancel(target, owned.actorRole);
      return checkedResponse(session, target, receipt, owned.analysis);
    }); } catch (error) {
      if (known(error)) throw error;
      return response(deepAdoptionEmptyReceipt(target, "unknown"));
    }
  }
  return { options, adopt, check, cancel };
}
export const competitorDeepAdoption = createCompetitorDeepAdoptionService();
