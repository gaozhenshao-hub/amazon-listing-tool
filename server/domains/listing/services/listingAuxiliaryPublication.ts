import { createHash } from "node:crypto";
import { listingBulletCandidates } from "../../../../drizzle/schema/listingRevisions";
import { listingAuxiliaryCanonical as canonical, listingAuxiliaryHash as hash, type ListingAuxiliaryApplyInput } from "../../../../shared/listingAuxiliaryWorkflow";
import { listingConfiguredCompleteRows as complete } from "./listingConfiguredSource";
import { listingAuxiliaryRows as rows, listingAuxiliaryWrite as write, listingAuxiliaryFail as fail, listingAuxiliaryOptimizationLineage, type ListingAuxiliaryExecutor } from "./listingAuxiliarySource";
import { stableJson } from "./listingCandidateReviewService";
import { validateListingAuxiliaryReturned } from "./listingAuxiliaryRuntime";
import type { ListingAuxiliarySource } from "./listingAuxiliarySource";
import type { ListingAuxiliaryRuntimeSnapshot } from "./listingAuxiliaryRuntimeContract";
import type { ListingAuxiliaryReturned, ListingAuxiliaryAttempt } from "./listingAuxiliaryRuntime";
type ListingAuxiliaryRun = { id: number; identity: ListingAuxiliarySource["identity"]; request: ListingAuxiliarySource["request"]; source: ListingAuxiliarySource; runtimeSnapshot: ListingAuxiliaryRuntimeSnapshot;
  steps: Array<{ attempt: ListingAuxiliaryAttempt; dispatch: { receipt: { runId: string } } | null; returned: ListingAuxiliaryReturned | null }> };
/** No text/draft/score write for FABE or checklists. Optimize appends an unconfirmed candidate only. */
export async function applyListingAuxiliaryCandidate(tx: ListingAuxiliaryExecutor, run: ListingAuxiliaryRun, input: ListingAuxiliaryApplyInput) {
  if (run.request.operation !== "optimizeBullet") return { candidateIds: [] as number[], after: null };
  const source = run.source, original = source.optimizationSource, payload = run.request.payload;
  if (!original) fail("CORE_UNAVAILABLE");
  const step = run.steps.find(value => value.returned?.candidate && !value.returned.issues.length);
  if (!step?.returned || !step.dispatch) fail("RESULT_INVALID");
  const parsed = validateListingAuxiliaryReturned(source, step.attempt, step.returned.content);
  if (!parsed.candidate || parsed.issues.length) fail("CANDIDATE_FACT_REVIEW_REQUIRED");
  const bullet = parsed.candidate, core = original.cores[0], entry = run.runtimeSnapshot.entries[0];
  const skillRuns = await rows(tx, "SELECT id,runId,userId,workspaceId,skillSlug,status FROM emperor_skill_runs WHERE runId=? AND BINARY runId=BINARY ? LIMIT 2 FOR SHARE", [step.dispatch.receipt.runId, step.dispatch.receipt.runId], 1), skillRun = skillRuns[0];
  if (!skillRun || !Number.isInteger(skillRun.id) || skillRun.userId !== run.identity.userId || skillRun.workspaceId !== run.identity.workspaceId || skillRun.skillSlug !== entry.skill.slug || skillRun.status !== "succeeded") fail("SKILL_RECEIPT_INVALID");
  const subtitle = String(bullet.subtitle).trim(), fullText = String(bullet.fullText).trim();
  if (Buffer.byteLength(subtitle) > 500 || Buffer.byteLength(fullText) > 65535) fail("OUTPUT_TEXT_LIMIT");
  const evidenceFactIds = [...core.factRevisionIdsJson as number[]].sort((a,b) => a-b), model = entry.models[step.attempt.modelIndex].model.slug;
  const parent = payload.sourceCandidateId === null ? null : source.tables.listing_bullet_candidates.find(row => row.id === payload.sourceCandidateId);
  if (payload.sourceCandidateId !== null && !parent) fail("CANDIDATE_SOURCE_CHANGED");
  const candidateRevision = parent ? Number(parent.candidateRevision) + 1 : 1;
  if (!Number.isSafeInteger(candidateRevision) || candidateRevision < 1 || candidateRevision > 2147483647) fail("CANDIDATE_VERSION_INVALID");
  const gateResult = { passed: true, issues: [], requiresHumanReview: true, provenance: { source: "ai", jobId: run.id, skillRunId: skillRun.id,
    promptVersion: String(entry.skill.version), actualModel: model, plannedModel: model, fallbackReason: step.attempt.modelIndex ? "approved_known_response_fallback" : null,
    schemaVersion: "listing_auxiliary_original_output_v1", auxiliaryOptimization: listingAuxiliaryOptimizationLineage(source), draftHash: source.draftHash } };
  const contentHash = createHash("sha256").update(stableJson({ coreRevisionId: core.id, inputHash: core.inputHash, subtitle, fullText, evidenceFactIds, gateResult })).digest("hex");
  const candidateKey = `laux_${hash({ identity: run.identity, applyOperationId: input.applyOperationId, coreRevisionId: core.id })}`;
  const inserted = await write(tx, "INSERT INTO listing_bullet_candidates (candidateKey,candidateRevision,parentCandidateId,workspaceId,projectId,coreRevisionId,jobId,skillRunId,promptVersion,actualModel,inputHash,subtitle,fullText,evidenceFactIdsJson,gateResultJson,status,contentHash,createdBy) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'review_required',?,?)",
    [candidateKey,candidateRevision,payload.sourceCandidateId,run.identity.workspaceId,input.projectId,core.id,run.id,skillRun.id,String(entry.skill.version),model,core.inputHash,subtitle,fullText,canonical(evidenceFactIds),canonical(gateResult),contentHash,run.identity.userId]);
  const saved = await complete(tx, listingBulletCandidates, "id=?", [inserted.insertId], 1), actual = saved[0];
  const expected = { candidateKey,candidateRevision,parentCandidateId:payload.sourceCandidateId,workspaceId:run.identity.workspaceId,projectId:input.projectId,coreRevisionId:core.id,
    jobId:run.id,skillRunId:skillRun.id,promptVersion:String(entry.skill.version),actualModel:model,inputHash:core.inputHash,subtitle,fullText,
    evidenceFactIdsJson:evidenceFactIds,gateResultJson:gateResult,status:"review_required",contentHash,createdBy:run.identity.userId,staleAt:null };
  if (!actual || Object.entries(expected).some(([key,value]) => canonical(actual[key]) !== canonical(value))) fail("PUBLICATION_ACK_UNKNOWN");
  return { candidateIds:[Number(actual.id)], after: { candidates:saved } };
}
