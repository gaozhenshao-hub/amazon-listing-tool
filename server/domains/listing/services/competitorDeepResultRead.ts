import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { TrpcContext } from "../../../_core/context";
import type { CompetitorAnalysis } from "../../../../drizzle/schema/project";
import { COMPETITOR_DEEP_EXECUTION_JOB_KIND } from "../../../../shared/competitorDeepExecutionJob";
import { canonicalCompetitorResearchEvidence as canonical } from "../../../../shared/competitorResearchEvidence";
import { getDb, type DbExecutor } from "../../../repositories/dbClient";
import { COMPETITOR_DEEP_INPUT_MAX_BYTES, competitorDeepPublicationReceiptSchema,
  decodeCompetitorDeepExecutionInput } from "../../../repositories/listing/competitorDeepExecutionRepository";
import { competitorRevision } from "../../../repositories/project/competitorWritePolicy";
import { assertResourceAction } from "../../../services/securityGovernance";
import { buildCompetitorDeepResult, COMPETITOR_DEEP_RESULT_MAX_BYTES, type CompetitorDeepResult } from "./competitorDeepResult";

const id = z.number().int().positive().safe(), hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const competitorDeepResultReadSchema = z.object({ projectId: id, analysisId: id,
  expectedWorkspaceId: id.nullable(), expectedRevision: hash }).strict();
const pointerSchema = z.object({ artifactId: z.string().regex(/^deep_[a-f0-9]{64}$/u),
  jobRunId: z.string().min(1).max(80).refine(value => value.trim() === value), resultHash: hash }).strict();
type Request = z.infer<typeof competitorDeepResultReadSchema>;
type Scope = { userId: number; workspaceId: number | null; projectId: number; analysisId: number };
type Identity = Scope & { sourceWorkspaceId: number | null; asin: string };
export type AuthorizedCompetitorDeepResult = { identity: Identity; currentRevision: string; reviewRequired: true } &
  ({ status: "not_available"; sourceChanged: false } | { status: "available"; sourceChanged: boolean; result: CompetitorDeepResult });
export interface CompetitorDeepResultReadDatabase { transaction?<T>(body: (tx: DbExecutor) => Promise<T>): Promise<T> }
type ErrorCode = "BAD_REQUEST" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "PRECONDITION_FAILED" | "INTERNAL_SERVER_ERROR";
function fail(message: string, code: ErrorCode = "PRECONDITION_FAILED"): never { throw new TRPCError({ code, message }); }
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const OUTPUT_LIMIT = 16 * 1024;
// MySQL JSON text adds spaces/escapes relative to canonical JSON. Bound transport
// separately, then enforce the canonical limit; neither limit implies truncation.
const WIRE_FACTOR = 8;
function payloadSelect(column: string, prefix: string, maximum: number) {
  const text = `CAST(${column} AS CHAR CHARACTER SET utf8mb4)`;
  return `IF(OCTET_LENGTH(${text})<=${maximum * WIRE_FACTOR},${text},NULL) AS ${prefix}Text,
    OCTET_LENGTH(${text}) AS ${prefix}Bytes,SHA2(${text},256) AS ${prefix}WireHash`;
}
const textColumns = ["asin", "title", "bulletPoints", "imageUrls", "price", "rating", "reviewCount", "reviewAnalysis", "keywords", "rawData", "aiSummary", "summary", "summaryStatus"] as const;
const analysisSelect = `SELECT id,projectId,summaryVersion,summaryConfirmedBy,summaryConfirmedAt,createdAt,updatedAt,
  ${textColumns.map(column => `IF(OCTET_LENGTH(${column})<=65535,${column},NULL) AS ${column}`).join(",")},
  IF(${textColumns.map(column => `(${column} IS NULL OR OCTET_LENGTH(${column})<=65535)`).join(" AND ")},1,0) AS columnsWithinLimit
  FROM competitorAnalyses WHERE projectId=? AND id=? FOR SHARE`;
const jobSelect = `SELECT runId,kind,module,userId,workspaceId,projectId,status,progress,attempt,maxAttempts,
  lockedBy,leaseUntil,errorMessage,completedAt,${payloadSelect("input", "input", COMPETITOR_DEEP_INPUT_MAX_BYTES)},
  ${payloadSelect("output", "output", OUTPUT_LIMIT)} FROM ai_jobs WHERE runId=? FOR SHARE`;
const artifactSelect = `SELECT workspaceId,artifactId,domain,artifactKey,artifactType,sourceType,sourceId,sourceTable,sourceRowId,
  runId,agentSlug,nodeId,projectId,userId,status,version,isCurrent,contentHash,mimeType,fileSizeBytes,retentionClass,sourceSkillRunId,sourceAiJobRunId,
  ${payloadSelect("contentJson", "content", COMPETITOR_DEEP_RESULT_MAX_BYTES)},${payloadSelect("metadata", "metadata", OUTPUT_LIMIT)}
  FROM ai_artifacts WHERE artifactId=? AND sourceAiJobRunId=? FOR SHARE`;
function jsonPayload(row: Record<string, unknown>, prefix: string, maximum: number): unknown {
  const text = row[`${prefix}Text`], bytes = row[`${prefix}Bytes`], wireHash = row[`${prefix}WireHash`];
  if (!Number.isSafeInteger(bytes) || Number(bytes) < 1 || Number(bytes) > maximum * WIRE_FACTOR
    || typeof text !== "string" || Buffer.byteLength(text, "utf8") !== bytes || digest(text) !== wireHash) fail("DEEP_RESULT_READ_PAYLOAD_INVALID");
  let value: unknown;
  try { value = JSON.parse(text); } catch { return fail("DEEP_RESULT_READ_PAYLOAD_INVALID"); }
  if (Buffer.byteLength(canonical(value), "utf8") > maximum) fail("DEEP_RESULT_READ_PAYLOAD_TOO_LARGE");
  return value;
}
function pointer(raw: string | null) {
  let value: unknown;
  try { value = raw?.trim() ? JSON.parse(raw) : {}; } catch { return fail("DEEP_RESULT_READ_POINTER_INVALID"); }
  if (!object(value)) fail("DEEP_RESULT_READ_POINTER_INVALID");
  if (!Object.hasOwn(value, "deepAnalysisRef")) return null;
  const parsed = pointerSchema.safeParse(value.deepAnalysisRef);
  if (!parsed.success) fail("DEEP_RESULT_READ_POINTER_INVALID");
  return parsed.data;
}
function safeError(error: unknown): never {
  if (error instanceof TRPCError && /^DEEP_RESULT_READ_[A-Z_]+$/u.test(error.message)) throw error;
  if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(error.code)) fail("DEEP_RESULT_READ_ACCESS_DENIED", "FORBIDDEN");
  let current = error;
  for (let i = 0; i < 5 && current && typeof current === "object"; i++) {
    const item = current as { errno?: number; cause?: unknown };
    if ([1205, 1213].includes(item.errno ?? 0)) fail("DEEP_RESULT_READ_CONFLICT", "CONFLICT");
    if ([1146, 1054].includes(item.errno ?? 0)) fail("DEEP_RESULT_READ_SCHEMA_UNAVAILABLE");
    current = item.cause;
  }
  return fail("DEEP_RESULT_READ_FAILED", "INTERNAL_SERVER_ERROR");
}
function statement(text: string, params: unknown[]): SQL {
  const parts = text.split("?");
  if (parts.length !== params.length + 1) fail("DEEP_RESULT_READ_SQL_INVALID", "INTERNAL_SERVER_ERROR");
  return sql.join(parts.flatMap((part, i) => i < params.length ? [sql.raw(part), sql`${params[i]}`] : [sql.raw(part)]), sql.raw(""));
}

/** Read only a saved selected-analysis reference. No client-supplied job/plan,
 * model execution, lease recovery, current Skill approval or publication occurs.
 * Changed sources may expose a verified historical candidate as explicitly stale,
 * never silently convert it to current evidence or confirmed research. */
export function createCompetitorDeepResultReadService(dependencies: {
  database?: () => Promise<CompetitorDeepResultReadDatabase | null>; permission?: typeof assertResourceAction;
} = {}) {
  const database = dependencies.database ?? getDb, permission = dependencies.permission ?? assertResourceAction;
  async function transaction<T>(body: (tx: DbExecutor) => Promise<T>): Promise<T> {
    const db = await database();
    if (!db || typeof db.transaction !== "function") fail("DEEP_RESULT_READ_TRANSACTION_REQUIRED");
    return db.transaction(body);
  }
  async function rows(tx: DbExecutor, text: string, params: unknown[]) {
    const value = await tx.execute(statement(text, params));
    if (!Array.isArray(value) || !Array.isArray(value[0])) fail("DEEP_RESULT_READ_RESPONSE_INVALID");
    return value[0] as Record<string, unknown>[];
  }
  async function authorized(tx: DbExecutor, scope: Scope, expectedRevision: string) {
    const users = await rows(tx, "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE", [scope.userId]), user = users[0];
    if (users.length !== 1 || user.id !== scope.userId || user.status !== "active" || user.defaultWorkspaceId !== scope.workspaceId
      || typeof user.role !== "string" || !user.role.trim()) fail("DEEP_RESULT_READ_ACTOR_CHANGED", "FORBIDDEN");
    await permission({ actor: { id: scope.userId, role: user.role, defaultWorkspaceId: scope.workspaceId }, resource: "project", action: "read",
      workspaceId: scope.workspaceId, projectId: scope.projectId, resourceId: scope.projectId,
      authorizationRead: { executor: tx, strict: true, lock: true } });
    const parents = await rows(tx, "SELECT id,userId,workspaceId FROM projects WHERE id=? FOR SHARE", [scope.projectId]), parent = parents[0];
    if (parents.length !== 1 || parent.id !== scope.projectId || parent.userId !== scope.userId
      || (parent.workspaceId !== null && parent.workspaceId !== scope.workspaceId)) fail("DEEP_RESULT_READ_PROJECT_UNAVAILABLE", "NOT_FOUND");
    const found = await rows(tx, analysisSelect, [scope.projectId, scope.analysisId]);
    if (found.length !== 1 || found[0].columnsWithinLimit !== 1) fail("DEEP_RESULT_READ_ANALYSIS_UNAVAILABLE", "NOT_FOUND");
    const { columnsWithinLimit: _limit, ...record } = found[0], analysis = record as CompetitorAnalysis;
    if (analysis.id !== scope.analysisId || analysis.projectId !== scope.projectId || !/^[A-Z0-9]{10}$/u.test(analysis.asin)) fail("DEEP_RESULT_READ_ANALYSIS_UNAVAILABLE", "NOT_FOUND");
    const currentRevision = competitorRevision(analysis);
    if (currentRevision !== expectedRevision) fail("DEEP_RESULT_READ_SOURCE_CHANGED", "CONFLICT");
    return { identity: { ...scope, sourceWorkspaceId: parent.workspaceId as number | null, asin: analysis.asin },
      analysis, currentRevision, pointer: pointer(analysis.rawData) };
  }
  async function read(ctx: TrpcContext, raw: Request): Promise<AuthorizedCompetitorDeepResult> {
    try {
      const parsed = competitorDeepResultReadSchema.safeParse(raw);
      if (!parsed.success) fail("DEEP_RESULT_READ_INPUT_INVALID", "BAD_REQUEST");
      const input = parsed.data, workspaceId = ctx.workspaceId !== undefined ? ctx.workspaceId : ctx.user?.defaultWorkspaceId;
      if (!ctx.user || !id.safeParse(ctx.user.id).success || (workspaceId !== null && !id.safeParse(workspaceId).success)) fail("DEEP_RESULT_READ_ACTOR_INVALID", "FORBIDDEN");
      if (workspaceId !== input.expectedWorkspaceId) fail("DEEP_RESULT_READ_WORKSPACE_CHANGED", "CONFLICT");
      const scope: Scope = { userId: ctx.user.id, workspaceId: workspaceId as number | null, projectId: input.projectId, analysisId: input.analysisId };
      // Discover only an authorized pointer first, releasing parent locks before
      // taking the job lock to match the publication job→actor→parent lock order.
      const initial = await transaction(tx => authorized(tx, scope, input.expectedRevision));
      if (!initial.pointer) return { status: "not_available", identity: initial.identity, currentRevision: initial.currentRevision,
        sourceChanged: false, reviewRequired: true };
      const reference = initial.pointer;
      return await transaction<AuthorizedCompetitorDeepResult>(async tx => {
        const jobs = await rows(tx, jobSelect, [reference.jobRunId]);
        const owned = await authorized(tx, scope, input.expectedRevision);
        if (canonical(owned.pointer) !== canonical(reference) || canonical(owned.identity) !== canonical(initial.identity)) fail("DEEP_RESULT_READ_SOURCE_CHANGED", "CONFLICT");
        const job = jobs[0];
        if (jobs.length !== 1 || job.runId !== reference.jobRunId || job.kind !== COMPETITOR_DEEP_EXECUTION_JOB_KIND || job.module !== "listing"
          || job.status !== "succeeded" || job.progress !== 100 || job.maxAttempts !== 1 || !id.safeParse(job.attempt).success
          || job.userId !== scope.userId || job.workspaceId !== scope.workspaceId || job.projectId !== scope.projectId
          || job.lockedBy !== null || job.leaseUntil !== null || job.errorMessage !== null
          || !(job.completedAt instanceof Date) || !Number.isFinite(job.completedAt.getTime())) fail("DEEP_RESULT_READ_JOB_INVALID");
        let stored: ReturnType<typeof decodeCompetitorDeepExecutionInput>;
        try { stored = decodeCompetitorDeepExecutionInput(jsonPayload(job, "input", COMPETITOR_DEEP_INPUT_MAX_BYTES)); }
        catch { return fail("DEEP_RESULT_READ_JOB_INPUT_INVALID"); }
        const receiptParsed = competitorDeepPublicationReceiptSchema.safeParse(jsonPayload(job, "output", OUTPUT_LIMIT));
        if (!receiptParsed.success) fail("DEEP_RESULT_READ_RECEIPT_INVALID");
        const receipt = receiptParsed.data, identity = stored.evidence.identity;
        if (identity.userId !== scope.userId || identity.workspaceId !== scope.workspaceId || identity.sourceWorkspaceId !== owned.identity.sourceWorkspaceId
          || identity.projectId !== scope.projectId || identity.analysisId !== scope.analysisId || identity.asin !== owned.identity.asin
          || receipt.runId !== job.runId || receipt.analysisId !== scope.analysisId || receipt.artifactId !== reference.artifactId
          || receipt.artifactId !== `deep_${digest(reference.jobRunId)}` || receipt.resultHash !== reference.resultHash
          || receipt.evidenceHash !== stored.evidence.evidenceHash || receipt.skillPlanHash !== stored.journal.skillPlanHash
          || receipt.journalHash !== stored.journal.journalHash || receipt.sourceRevision !== identity.revision
          || receipt.summaryVersion > owned.analysis.summaryVersion) fail("DEEP_RESULT_READ_BINDING_INVALID");
        const artifacts = await rows(tx, artifactSelect, [reference.artifactId, reference.jobRunId]), artifact = artifacts[0];
        const finalModel = stored.journal.steps.find(step => step.stage === "summary")?.modelReceipt;
        const expected = { workspaceId: scope.workspaceId, artifactId: receipt.artifactId, domain: "listing", artifactKey: `listing.competitor_deep.${identity.asin}`,
          artifactType: "json", sourceType: "ai_output", sourceId: String(scope.analysisId), sourceTable: "competitorAnalyses", sourceRowId: String(scope.analysisId),
          runId: stored.agentRunId, agentSlug: "listing.full.workflow", nodeId: "N1", projectId: scope.projectId, userId: scope.userId, status: "draft",
          version: receipt.summaryVersion, isCurrent: 0, contentHash: receipt.artifactHash, mimeType: "application/json", retentionClass: "hot",
          sourceSkillRunId: finalModel?.runId, sourceAiJobRunId: receipt.runId };
        if (artifacts.length !== 1 || !finalModel || Object.entries(expected).some(([key, value]) => artifact[key] !== value)) fail("DEEP_RESULT_READ_ARTIFACT_INVALID");
        const artifactBody = jsonPayload(artifact, "content", COMPETITOR_DEEP_RESULT_MAX_BYTES), contentText = canonical(artifactBody);
        const { committedRevision: _revision, ...baseReceipt } = receipt;
        const rawData = JSON.parse(owned.analysis.rawData!);
        if (!object(rawData) || canonical(rawData.deepResearchPublication ?? null) !== canonical(baseReceipt)) fail("DEEP_RESULT_READ_PUBLICATION_INVALID");
        if (canonical(jsonPayload(artifact, "metadata", OUTPUT_LIMIT)) !== canonical({ ...baseReceipt, agentRunId: stored.agentRunId, agentNodeId: "N1" })
          || Buffer.byteLength(contentText, "utf8") !== artifact.fileSizeBytes || digest(contentText) !== receipt.artifactHash) fail("DEEP_RESULT_READ_ARTIFACT_HASH_INVALID");
        let result: CompetitorDeepResult;
        try { result = buildCompetitorDeepResult({ evidence: stored.evidence, skills: stored.skills, journal: stored.journal,
          jobRunId: receipt.runId, generatedAt: receipt.generatedAt }); }
        catch { return fail("DEEP_RESULT_READ_REPLAY_INVALID"); }
        if (!result.summaryText || result.deepAnalysis.status !== "ready_for_review" || result.resultHash !== receipt.resultHash
          || canonical(result) !== contentText) fail("DEEP_RESULT_READ_REPLAY_MISMATCH");
        return { status: "available", identity: owned.identity, currentRevision: owned.currentRevision,
          sourceChanged: receipt.committedRevision !== owned.currentRevision, reviewRequired: true, result };
      });
    } catch (error) { return safeError(error); }
  }
  return { read };
}
export const competitorDeepResultRead = createCompetitorDeepResultReadService();
