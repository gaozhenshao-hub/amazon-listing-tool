import { createHash } from "node:crypto";
import { getTableColumns } from "drizzle-orm";
import { listings } from "../../../../drizzle/schema/listing";
import { listingBulletCandidates } from "../../../../drizzle/schema/listingRevisions";
import { listingConfiguredHash as hash, listingConfiguredCanonical as canonical, type ListingConfiguredApplyInput, type ListingConfiguredIdentity } from "../../../../shared/listingConfiguredWorkflow";
import { listingConfiguredCompleteRows as complete, listingConfiguredRows as rows, listingConfiguredWrite as write, listingConfiguredFail as fail,
  listingConfiguredJson as json, type ListingConfiguredSource, type ListingConfiguredExecutor } from "./listingConfiguredSource";
import { stableJson } from "./listingCandidateReviewService";
import { validateReviewedBulletClaims, validateCrossBulletDistinctness } from "./listingCandidateFactGate";
import type { ListingConfiguredRuntimeSnapshot } from "./listingConfiguredRuntimeContract";

type Run = { id: number; runId: string; identity: ListingConfiguredIdentity; source: ListingConfiguredSource; runtimeSnapshot: ListingConfiguredRuntimeSnapshot;
  steps: Array<{ attempt: { operation: string; modelIndex: number }; dispatch: { receipt: { runId: string } } | null; returned: { candidate: Record<string, unknown> | null; issues: string[] } | null }> };
const text = (value: unknown, max = 65535) => { if (typeof value !== "string" || Buffer.byteLength(value) > max) fail("OUTPUT_TEXT_LIMIT"); return value; };
/** Caller owns the project lock, source/draft CAS and final journal transaction. */
export async function applyListingConfiguredCandidate(tx: ListingConfiguredExecutor, run: Run, input: ListingConfiguredApplyInput) {
  const successful = run.steps.filter(step => step.returned?.candidate && !step.returned.issues.length);
  const outputs = Object.fromEntries(successful.map(step => [step.attempt.operation, step.returned!.candidate!]));
  const oldRows = await complete(tx, listings, "projectId=?", [input.projectId]);
  if (hash(oldRows) !== input.expectedDraftHash) fail("DRAFT_CHANGED");
  const active = oldRows.filter(row => row.isActive === 1); if (active.length > 1) fail("DRAFT_AMBIGUOUS");
  const old = active[0], changes: Record<string, unknown> = {};
  const locked = old?.lockedSteps == null ? [] : json(old.lockedSteps);
  if (!Array.isArray(locked) || locked.some(value => !Number.isInteger(value))) fail("DRAFT_INVALID");
  for (const [operation, stage] of [["title", 2], ["description", 3], ["searchTerms", 4], ["qa", 6]] as const) if (outputs[operation] && locked.includes(stage)) fail("DRAFT_STAGE_LOCKED");
  if (outputs.title) {
    const titles = outputs.title.titles; if (!Array.isArray(titles) || input.titleIndex === null || !titles[input.titleIndex]) fail("TITLE_SELECTION_REQUIRED");
    const title = titles[input.titleIndex] as Record<string, unknown>; changes.title = text(title.title); changes.itemHighlights = text(title.itemHighlights); changes.titleCn = null; changes.itemHighlightsCn = null;
  } else if (input.titleIndex !== null) fail("TITLE_SELECTION_INVALID");
  if (outputs.description) { changes.description = text(outputs.description.description); changes.descriptionCn = null; }
  if (outputs.searchTerms) { changes.searchTerms = text(outputs.searchTerms.searchTerms); changes.searchTermsCn = null; }
  if (outputs.qa) { changes.qaContent = text(canonical(outputs.qa.qaItems)); changes.qaContentCn = null; }
  let listingId = old ? Number(old.id) : null;
  if (Object.keys(changes).length) {
    if (old) {
      if (!Number.isInteger(old.version) || Number(old.version) >= 2147483647) fail("DRAFT_VERSION_INVALID");
      const columns = getTableColumns(listings), fields = Object.entries(columns);
      const predicates = fields.map(([key, column]) => /^(?:timestamp|datetime)/u.test(column.getSQLType())
        ? `DATE_FORMAT(\`${column.name}\`,'%Y-%m-%dT%H:%i:%s.%fZ') <=> ?` : `\`${column.name}\` <=> ?`);
      await write(tx, `UPDATE listings SET ${Object.keys(changes).map(key => `\`${key}\`=?`).join(",")},version=version+1,updatedAt=NOW() WHERE ${predicates.join(" AND ")}`,
        [...Object.values(changes), ...fields.map(([key]) => old[key])]);
    } else {
      const result = await write(tx, `INSERT INTO listings (projectId,version,isActive,${Object.keys(changes).map(key => `\`${key}\``).join(",")}) VALUES (?,1,1,${Object.keys(changes).map(() => "?").join(",")})`, [input.projectId, ...Object.values(changes)]);
      if (!Number.isSafeInteger(result.insertId) || result.insertId < 1) fail("WRITE_UNCONFIRMED"); listingId = result.insertId;
    }
  }
  const candidateIds: number[] = [], candidates: Record<string, unknown>[] = [];
  for (const operation of ["singleBullet", "bullets"] as const) {
    if (!outputs[operation]) continue;
    const step = successful.find(value => value.attempt.operation === operation)!;
    const entry = run.runtimeSnapshot.entries.find(value => value.approval.operation === operation)!;
    const skillRuns = await rows(tx, "SELECT id,runId,userId,workspaceId,skillSlug,status FROM emperor_skill_runs WHERE runId=? AND BINARY runId=BINARY ? LIMIT 2 FOR SHARE", [step.dispatch!.receipt.runId, step.dispatch!.receipt.runId], 1);
    const skillRun = skillRuns[0];
    if (!skillRun || !Number.isInteger(skillRun.id) || skillRun.userId !== run.identity.userId || skillRun.workspaceId !== run.identity.workspaceId || skillRun.skillSlug !== entry.skill.slug || skillRun.status !== "succeeded") fail("SKILL_RECEIPT_INVALID");
    const bullets = operation === "singleBullet" ? [outputs[operation]] : outputs[operation].bulletPoints;
    if (!Array.isArray(bullets) || bullets.length !== run.source.cores.length) fail("CORE_OUTPUT_MAPPING_INVALID");
    const previous = run.source.tables.listing_bullet_candidates.filter(row => row.status === "confirmed");
    for (let i = 0; i < bullets.length; i++) {
      const bullet = bullets[i] as Record<string, unknown>, core = run.source.cores[i];
      if (bullet.coreRevisionId !== core.id || bullet.sellingPointIndex !== core.sellingPointIndex) fail("CORE_OUTPUT_MAPPING_INVALID");
      const subtitle = text(bullet.subtitle, 500).trim(), fullText = text(bullet.fullText).trim();
      const evidenceFactIds = [...core.factRevisionIdsJson as number[]].sort((a, b) => a - b);
      const approvedFacts = run.source.confirmedFacts.filter(fact => evidenceFactIds.includes(Number(fact.id))).map(fact => ({ id: Number(fact.id), attributeKey: String(fact.attributeKey), value: String(fact.value) }));
      const issues = [...validateReviewedBulletClaims({ subtitle, fullText, evidenceFactIds, approvedFacts }), ...validateCrossBulletDistinctness({ subtitle, fullText,
        previous: [...previous.filter(row => row.coreRevisionId !== core.id), ...candidates].map(row => ({ subtitle: String(row.subtitle), fullText: String(row.fullText) })) })];
      if (issues.length) fail("CANDIDATE_FACT_REVIEW_REQUIRED");
      const model = entry.models[step.attempt.modelIndex].model.slug;
      const gateResult = { passed: true, issues: [], requiresHumanReview: true, provenance: { source: "ai", jobId: run.id, skillRunId: skillRun.id,
        promptVersion: String(entry.skill.version), actualModel: model, plannedModel: model, fallbackReason: step.attempt.modelIndex ? "approved_known_response_fallback" : null, schemaVersion: "listing_generation_original_output_v1" } };
      const contentHash = createHash("sha256").update(stableJson({ coreRevisionId: core.id, inputHash: core.inputHash, subtitle, fullText, evidenceFactIds, gateResult })).digest("hex");
      const candidateKey = `lstg_${hash({ identity: run.identity, applyOperationId: input.applyOperationId, coreRevisionId: core.id })}`;
      const inserted = await write(tx, "INSERT INTO listing_bullet_candidates (candidateKey,candidateRevision,parentCandidateId,workspaceId,projectId,coreRevisionId,jobId,skillRunId,promptVersion,actualModel,inputHash,subtitle,fullText,evidenceFactIdsJson,gateResultJson,status,contentHash,createdBy) VALUES (?,1,NULL,?,?,?,?,?,?,?,?,?,?,?,?,'review_required',?,?)",
        [candidateKey, run.identity.workspaceId, input.projectId, core.id, run.id, skillRun.id, String(entry.skill.version), model, core.inputHash, subtitle, fullText, canonical(evidenceFactIds), canonical(gateResult), contentHash, run.identity.userId]);
      const saved = await complete(tx, listingBulletCandidates, "id=?", [inserted.insertId], 1), actual = saved[0];
      const expected = { candidateKey, candidateRevision: 1, parentCandidateId: null, workspaceId: run.identity.workspaceId, projectId: input.projectId, coreRevisionId: core.id,
        jobId: run.id, skillRunId: skillRun.id, promptVersion: String(entry.skill.version), actualModel: model, inputHash: core.inputHash, subtitle, fullText, evidenceFactIdsJson: evidenceFactIds,
        gateResultJson: gateResult, status: "review_required", contentHash, createdBy: run.identity.userId, staleAt: null };
      if (!actual || Object.entries(expected).some(([key, value]) => canonical(actual[key]) !== canonical(value))) fail("PUBLICATION_ACK_UNKNOWN");
      candidateIds.push(Number(actual.id)); candidates.push(actual);
    }
  }
  const afterListings = await complete(tx, listings, "projectId=?", [input.projectId]), after = listingId === null ? null : afterListings.find(row => row.id === listingId);
  if (Object.keys(changes).length && (!after || Object.entries(changes).some(([key, value]) => after[key] !== value)
    || after.version !== (old ? Number(old.version) + 1 : 1) || Object.keys(old ?? {}).some(key => !Object.hasOwn(changes, key) && !["version", "updatedAt"].includes(key) && canonical(old[key]) !== canonical(after[key])))) fail("PUBLICATION_ACK_UNKNOWN");
  return { afterHash: hash({ listings: afterListings, candidates }), listingId, candidateIds, after: { listings: afterListings, candidates } };
}
