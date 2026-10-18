import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { CompetitorAnalysis } from "../../../../drizzle/schema/project";
import { CompetitorDeepAdoptionArtifactSchema, CompetitorDeepAdoptionRefSchema, COMPETITOR_DEEP_ADOPTION_MAX_BYTES,
  competitorDeepAdoptionCanonical as canonical, competitorDeepAdoptionHash as hash, competitorDeepAdoptionSourceFingerprint, competitorDeepAdoptionArtifactId,
  matchesCurrentCompetitorDeepAdoptionReview,
  type CompetitorDeepAdoptionIdentity, type CompetitorDeepAdoptionRef } from "../../../../shared/competitorDeepAdoption";
import { COMPETITOR_DEEP_EXECUTION_JOB_KIND } from "../../../../shared/competitorDeepExecutionJob";
import { getDb, type DbExecutor } from "../../../repositories/dbClient";
import { competitorRevision } from "../../../repositories/project/competitorWritePolicy";
import { COMPETITOR_DEEP_INPUT_MAX_BYTES, competitorDeepPublicationReceiptSchema, decodeCompetitorDeepExecutionInput } from "../../../repositories/listing/competitorDeepExecutionRepository";
import { buildCompetitorDeepResult, COMPETITOR_DEEP_RESULT_MAX_BYTES, type CompetitorDeepResult } from "./competitorDeepResult";
import { forgetActiveCompetitorResearch, issueActiveCompetitorResearch, type ActiveCompetitorResearch } from "../../../services/competitorActiveResearch";
export { cloneActiveResearch, getActiveCompetitorResearchDelivery, readActiveCompetitorResearch,
  renderActiveCompetitorResearchContext, type ActiveCompetitorResearch } from "../../../services/competitorActiveResearch";
type Verified = { identity: CompetitorDeepAdoptionIdentity; analysis: CompetitorAnalysis; currentRevision: string;
  result: CompetitorDeepResult; receipt: ReturnType<typeof competitorDeepPublicationReceiptSchema.parse>;
  stored: ReturnType<typeof decodeCompetitorDeepExecutionInput>; job: Record<string, unknown> };
const unavailable = (): ActiveCompetitorResearch => ({ status: "unavailable", reasonCode: "DEEP_ADOPTION_NOT_CURRENT_OR_UNVERIFIED" });
const digestText = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
function rawObject(row: { rawData?: unknown }): Record<string, unknown> | null {
  try { const raw: unknown = row.rawData == null || row.rawData === "" ? {} : JSON.parse(String(row.rawData));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  } catch { return null; }
}
function statement(text: string, params: unknown[]) {
  const parts = text.split("?"); if (parts.length !== params.length + 1) throw new Error("DEEP_ADOPTION_SQL_INVALID");
  return sql.join(parts.flatMap((part, index) => index < params.length ? [sql.raw(part), sql`${params[index]}`] : [sql.raw(part)]), sql.raw(""));
}
async function rows(tx: DbExecutor, text: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  const value = await tx.execute(statement(text, params));
  if (!Array.isArray(value) || !Array.isArray(value[0])) throw new Error("DEEP_ADOPTION_READ_INVALID"); return value[0];
}
function payloadSelect(column: string, prefix: string, limit: number) {
  const text = `CAST(${column} AS CHAR CHARACTER SET utf8mb4)`;
  return `IF(OCTET_LENGTH(${text})<=${limit * 8},${text},NULL) AS ${prefix}Text,OCTET_LENGTH(${text}) AS ${prefix}Bytes,SHA2(${text},256) AS ${prefix}WireHash`;
}
function payload(row: Record<string, unknown>, prefix: string, limit: number): unknown {
  const text = row[`${prefix}Text`], bytes = row[`${prefix}Bytes`];
  if (typeof text !== "string" || !Number.isSafeInteger(bytes) || Number(bytes) > limit * 8
    || Buffer.byteLength(text, "utf8") !== bytes || digestText(text) !== row[`${prefix}WireHash`]) throw new Error("DEEP_ADOPTION_PAYLOAD_INVALID");
  const value: unknown = JSON.parse(text); if (Buffer.byteLength(canonical(value), "utf8") > limit) throw new Error("DEEP_ADOPTION_PAYLOAD_TOO_LARGE"); return value;
}
const artifactSelect = `SELECT workspaceId,artifactId,domain,artifactKey,artifactType,sourceType,sourceId,sourceTable,sourceRowId,
  runId,agentSlug,nodeId,projectId,userId,status,version,isCurrent,contentHash,mimeType,fileSizeBytes,retentionClass,sourceSkillRunId,sourceAiJobRunId,
  ${payloadSelect("contentJson", "content", COMPETITOR_DEEP_ADOPTION_MAX_BYTES)},${payloadSelect("metadata", "metadata", 16 * 1024)}
  FROM ai_artifacts WHERE artifactId=? AND sourceAiJobRunId=? FOR SHARE`;
const textColumns = ["asin", "title", "bulletPoints", "imageUrls", "price", "rating", "reviewCount", "reviewAnalysis", "keywords", "rawData", "aiSummary", "summary", "summaryStatus"] as const;
const analysisSelect = `SELECT id,projectId,summaryVersion,summaryConfirmedBy,summaryConfirmedAt,createdAt,updatedAt,
  ${textColumns.map(column => `IF(OCTET_LENGTH(${column})<=65535,${column},NULL) AS ${column}`).join(",")},
  IF(${textColumns.map(column => `(${column} IS NULL OR OCTET_LENGTH(${column})<=65535)`).join(" AND ")},1,0) AS columnsWithinLimit
  FROM competitorAnalyses WHERE projectId=? AND id=?`;

/** Reuse an already locked/replayed candidate in the write transaction. This
 * does not take job/parent locks in reverse order or grant caller permissions. */
export async function loadActiveCompetitorResearchFromVerified(tx: DbExecutor, verified: Verified,
  explicitRef?: CompetitorDeepAdoptionRef, lockArtifacts = true): Promise<ActiveCompetitorResearch> {
  forgetActiveCompetitorResearch(verified.analysis);
  const row = verified.analysis, raw = rawObject(row), parsed = CompetitorDeepAdoptionRefSchema.safeParse(explicitRef ?? raw?.deepAdoptionRef);
  if (!parsed.success) return unavailable();
  const ref = parsed.data;
  if (ref.artifactId !== competitorDeepAdoptionArtifactId({ ...verified.identity, operationId: ref.operationId })
    || canonical(raw?.deepAdoptionRef ?? null) !== canonical(ref)) return unavailable();
  if (!matchesCurrentCompetitorDeepAdoptionReview(row, ref)
    || competitorDeepAdoptionSourceFingerprint(row) !== ref.sourceFingerprint || competitorRevision(row) !== verified.currentRevision) return unavailable();
  const found = await rows(tx, lockArtifacts ? artifactSelect : artifactSelect.replace(/ FOR SHARE$/u, ""), [ref.artifactId, ref.jobRunId]); if (found.length !== 1) return unavailable();
  const artifact = found[0], body = CompetitorDeepAdoptionArtifactSchema.parse(payload(artifact, "content", COMPETITOR_DEEP_ADOPTION_MAX_BYTES));
  const identity = verified.identity, finalModel = verified.stored.journal.steps.find(item => item.stage === "summary")?.modelReceipt;
  const expected = { workspaceId: identity.workspaceId, artifactId: ref.artifactId, domain: "listing",
    artifactKey: `listing.competitor_deep_adopt.${identity.asin}`, artifactType: "json", sourceType: "user_edit",
    sourceId: String(identity.analysisId), sourceTable: "competitorAnalyses", sourceRowId: String(identity.analysisId),
    runId: verified.stored.agentRunId, agentSlug: "listing.full.workflow", nodeId: "N1", projectId: identity.projectId,
    userId: identity.userId, status: "final", version: ref.summaryVersion, isCurrent: 0, contentHash: ref.projectionHash,
    mimeType: "application/json", fileSizeBytes: Buffer.byteLength(canonical(body), "utf8"), retentionClass: "hot",
    sourceSkillRunId: finalModel?.runId, sourceAiJobRunId: ref.jobRunId };
  if (!finalModel || Object.entries(expected).some(([key, value]) => artifact[key] !== value) || hash(body) !== ref.projectionHash
    || canonical(body.identity) !== canonical(identity) || body.summary !== row.summary || hash(body.summary) !== ref.summaryHash
    || body.operationId !== ref.operationId || body.jobRunId !== ref.jobRunId || body.resultHash !== ref.resultHash
    || body.evidenceHash !== ref.evidenceHash || body.sourceFingerprint !== ref.sourceFingerprint
    || body.summaryVersion !== ref.summaryVersion || body.adoptedBy !== ref.adoptedBy || body.adoptedAt !== ref.adoptedAt
    || body.originalArtifactId !== verified.receipt.artifactId || body.publicationRevision !== verified.receipt.committedRevision
    || body.skillPlanHash !== verified.receipt.skillPlanHash || body.journalHash !== verified.receipt.journalHash
    || body.resultHash !== verified.result.resultHash || body.evidenceHash !== verified.receipt.evidenceHash
    || canonical(body.result) !== canonical(verified.result)) return unavailable();
  const metadata = payload(artifact, "metadata", 16 * 1024) as Record<string, unknown>;
  if (!metadata || Object.keys(metadata).sort().join() !== "identity,kind,ref,requestHash,version"
    || metadata.version !== 1 || metadata.kind !== "competitor_deep_adoption" || canonical(metadata.ref) !== canonical(ref)
    || canonical(metadata.identity) !== canonical(identity) || typeof metadata.requestHash !== "string" || !/^[a-f0-9]{64}$/u.test(metadata.requestHash)) return unavailable();
  const active: Extract<ActiveCompetitorResearch, { status: "adopted_deep" }> = { status: "adopted_deep", identity, ref,
    currentRevision: verified.currentRevision, summary: body.summary, result: verified.result };
  return issueActiveCompetitorResearch(row, active);
}

/** Data-proof loader only. Existing callers must authorize their project. It
 * never impersonates the original adopter or invents an authorization context. */
type LockedParent = { id: number; userId: number; workspaceId: number | null };
export async function hydrateActiveCompetitorResearch(row: CompetitorAnalysis, existingTx?: DbExecutor, database = getDb): Promise<void> {
  return hydrateResearch(row, existingTx, database);
}

/** Internal lock-aware adapter. The caller must already hold the current
 * parent and exact analysis row locks in this transaction and authorize them.
 * Do not re-read those rows from an older REPEATABLE READ snapshot; immutable
 * terminal job/artifact reads take no reverse locks and never grant access. */
export async function hydrateActiveCompetitorResearchForLockedRow(row: CompetitorAnalysis, tx: DbExecutor, parent: LockedParent): Promise<void> {
  if (!tx || typeof tx.execute !== "function" || !parent) { forgetActiveCompetitorResearch(row); return; }
  return hydrateResearch(row, tx, getDb, parent);
}

async function hydrateResearch(row: CompetitorAnalysis, existingTx: DbExecutor | undefined, database: typeof getDb, lockedParent?: LockedParent): Promise<void> {
  forgetActiveCompetitorResearch(row);
  const raw = rawObject(row), parsed = CompetitorDeepAdoptionRefSchema.safeParse(raw?.deepAdoptionRef);
  if (!parsed.success) return;
  try {
    if (lockedParent) {
      competitorRevision(row);
      if (![lockedParent.id, lockedParent.userId].every(value => Number.isSafeInteger(value) && value > 0)
        || lockedParent.workspaceId !== null && (!Number.isSafeInteger(lockedParent.workspaceId) || lockedParent.workspaceId <= 0)
        || lockedParent.id !== row.projectId
        || textColumns.some(column => row[column] !== null && (typeof row[column] !== "string" || Buffer.byteLength(row[column]!, "utf8") > 65_535))) return;
    }
    const run = async (tx: DbExecutor) => {
      // Existing write callers already hold the parent/analysis lock. Terminal
      // job and immutable artifacts are read without taking locks in reverse
      // order. This path never creates a nested transaction or grants access.
      const lock = existingTx ? "" : " FOR SHARE";
      const ref = parsed.data;
      const jobs = await rows(tx, `SELECT runId,kind,module,userId,workspaceId,projectId,status,progress,attempt,maxAttempts,lockedBy,leaseUntil,errorMessage,completedAt,
        ${payloadSelect("input", "input", COMPETITOR_DEEP_INPUT_MAX_BYTES)},${payloadSelect("output", "output", 16 * 1024)} FROM ai_jobs WHERE runId=?${lock}`, [ref.jobRunId]);
      const job = jobs[0]; if (jobs.length !== 1 || job.kind !== COMPETITOR_DEEP_EXECUTION_JOB_KIND || job.module !== "listing"
        || job.status !== "succeeded" || job.progress !== 100 || job.maxAttempts !== 1 || !Number.isSafeInteger(job.attempt) || Number(job.attempt) < 1
        || job.lockedBy !== null || job.leaseUntil !== null || job.errorMessage !== null || !(job.completedAt instanceof Date)
        || !Number.isFinite(job.completedAt.getTime())) return;
      const parents = lockedParent ? [lockedParent] : await rows(tx, `SELECT id,userId,workspaceId FROM projects WHERE id=?${lock}`, [row.projectId]);
      if (!lockedParent) {
        const current = await rows(tx, `${analysisSelect}${lock}`, [row.projectId, row.id]);
        if (parents.length !== 1 || current.length !== 1 || current[0].columnsWithinLimit !== 1) return;
        const { columnsWithinLimit: _limit, ...currentRow } = current[0];
        if (competitorRevision(currentRow as CompetitorAnalysis) !== competitorRevision(row)) return;
      }
      const stored = decodeCompetitorDeepExecutionInput(payload(job, "input", COMPETITOR_DEEP_INPUT_MAX_BYTES));
      const receipt = competitorDeepPublicationReceiptSchema.parse(payload(job, "output", 16 * 1024)), identity = stored.evidence.identity;
      if (parents[0].id !== row.projectId || parents[0].userId !== identity.userId || parents[0].workspaceId !== identity.sourceWorkspaceId
        || identity.projectId !== row.projectId || identity.analysisId !== row.id || identity.asin !== row.asin
        || identity.userId !== job.userId || identity.workspaceId !== job.workspaceId || job.projectId !== row.projectId
        || ref.adoptedBy !== identity.userId || ref.jobRunId !== job.runId || receipt.runId !== job.runId
        || receipt.analysisId !== row.id || receipt.evidenceHash !== stored.evidence.evidenceHash
        || receipt.skillPlanHash !== stored.journal.skillPlanHash || receipt.journalHash !== stored.journal.journalHash
        || receipt.sourceRevision !== identity.revision || receipt.artifactId !== `deep_${digestText(ref.jobRunId)}`) return;
      const { committedRevision: _committed, ...baseReceipt } = receipt;
      if (canonical(raw?.deepResearchPublication) !== canonical(baseReceipt)
        || canonical(raw?.deepAnalysisRef) !== canonical({ artifactId: receipt.artifactId, jobRunId: ref.jobRunId, resultHash: receipt.resultHash })) return;
      const result = buildCompetitorDeepResult({ evidence: stored.evidence, skills: stored.skills, journal: stored.journal,
        jobRunId: receipt.runId, generatedAt: receipt.generatedAt });
      if (Buffer.byteLength(canonical(result), "utf8") > COMPETITOR_DEEP_RESULT_MAX_BYTES || result.resultHash !== receipt.resultHash
        || hash(result) !== receipt.artifactHash || !result.summaryText || result.deepAnalysis.status !== "ready_for_review") return;
      const originals = await rows(tx, existingTx ? artifactSelect.replace(/ FOR SHARE$/u, "") : artifactSelect, [receipt.artifactId, ref.jobRunId]);
      const original = originals[0];
      const finalModel = stored.journal.steps.find(item => item.stage === "summary")?.modelReceipt;
      const originalExpected = { workspaceId: identity.workspaceId, artifactId: receipt.artifactId, domain: "listing",
        artifactKey: `listing.competitor_deep.${identity.asin}`, artifactType: "json", sourceType: "ai_output",
        sourceId: String(row.id), sourceTable: "competitorAnalyses", sourceRowId: String(row.id), runId: stored.agentRunId,
        agentSlug: "listing.full.workflow", nodeId: "N1", projectId: row.projectId, userId: identity.userId, status: "draft",
        version: receipt.summaryVersion, isCurrent: 0, contentHash: receipt.artifactHash, mimeType: "application/json",
        fileSizeBytes: Buffer.byteLength(canonical(result), "utf8"), retentionClass: "hot", sourceSkillRunId: finalModel?.runId, sourceAiJobRunId: ref.jobRunId };
      if (originals.length !== 1 || !finalModel || Object.entries(originalExpected).some(([key, value]) => original[key] !== value)
        || canonical(payload(original, "content", COMPETITOR_DEEP_RESULT_MAX_BYTES)) !== canonical(result)
        || canonical(payload(original, "metadata", 16 * 1024)) !== canonical({ ...baseReceipt, agentRunId: stored.agentRunId, agentNodeId: "N1" })) return;
      // Evidence identity includes its original revision; delivery identity is
      // deliberately the exact six-field current authorization scope.
      const activeIdentity = { userId: identity.userId, workspaceId: identity.workspaceId, sourceWorkspaceId: identity.sourceWorkspaceId,
        projectId: identity.projectId, analysisId: identity.analysisId, asin: identity.asin };
      await loadActiveCompetitorResearchFromVerified(tx, { identity: activeIdentity, analysis: row, currentRevision: competitorRevision(row), result, receipt, stored, job }, ref, !existingTx);
    };
    if (existingTx) await run(existingTx);
    else { const db = await database(); if (db && typeof db.transaction === "function") await db.transaction(run); }
  } catch { forgetActiveCompetitorResearch(row); /* Unknown/invalid proof or failed transaction ACK is never active/legacy. */ }
}
