import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import type { CompetitorAnalysis } from "../../../drizzle/schema/project";
import { COMPETITOR_DEEP_ADOPTION_MAX_BYTES, COMPETITOR_DEEP_ADOPTION_RAW_KEY, CompetitorDeepAdoptionArtifactSchema,
  CompetitorDeepAdoptionReceiptSchema, CompetitorDeepAdoptionRefSchema, competitorDeepAdoptionCanonical as canonical,
  competitorDeepAdoptionHash as hash, competitorDeepAdoptionSourceFingerprint as fingerprint, competitorDeepAdoptionArtifactId,
  type CompetitorDeepAdoptionInput, type CompetitorDeepAdoptionOperationInput, type CompetitorDeepAdoptionReceipt,
  type CompetitorDeepAdoptionRef } from "../../../shared/competitorDeepAdoption";
import { getDb, type DbExecutor } from "../dbClient";
import { assertResourceAction } from "../../services/securityGovernance";
import { assertAssistantRuleConfirmationJournalSchema } from "../../domains/ai_os/repositories/assistantRuleConfirmationJournal";
import { loadVerifiedCompetitorDeepResult, lockCompetitorDeepAdoptionTarget, type CompetitorDeepResultScope,
  type CompetitorDeepResultReadDatabase } from "../../domains/listing/services/competitorDeepResultRead";
import { competitorRevision } from "../project/competitorWritePolicy";
import { invalidateConfirmedCompetitorComparisons } from "../project/projectAssetRepository";

type Scope = CompetitorDeepResultScope & { jobRunId: string; operationId: string };
type Verified = Awaited<ReturnType<typeof loadVerifiedCompetitorDeepResult>>;
const ACTION = "listing.deep.adoption.final", RESOURCE = "listing_deep_adoption", SNAPSHOT_BYTES = 2 * 1024 * 1024;
const id = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
export function deepAdoptionError(suffix: string, code: "PRECONDITION_FAILED" | "CONFLICT" | "FORBIDDEN" | "NOT_FOUND" | "INTERNAL_SERVER_ERROR" = "PRECONDITION_FAILED"): never {
  throw new TRPCError({ code, message: `DEEP_ADOPTION_${suffix}` });
}
export const deepAdoptionArtifactId = competitorDeepAdoptionArtifactId;
export function deepAdoptionRequestHash(scope: CompetitorDeepResultScope, request: CompetitorDeepAdoptionInput) {
  return hash({ identity: { userId: scope.userId, workspaceId: scope.workspaceId }, request });
}
const targetScope = (scope: Scope) => ({ userId: scope.userId, workspaceId: scope.workspaceId, projectId: scope.projectId, analysisId: scope.analysisId, jobRunId: scope.jobRunId });
function statement(text: string, values: unknown[]): SQL {
  const parts = text.split("?"); if (parts.length !== values.length + 1) deepAdoptionError("SQL_INVALID");
  return sql.join(parts.flatMap((part, i) => i < values.length ? [sql.raw(part), sql`${values[i]}`] : [sql.raw(part)]), sql.raw(""));
}
function encode(value: unknown, maximum: number) {
  const text = canonical(value);
  if (Buffer.byteLength(text, "utf8") > maximum || Buffer.from(text, "utf8").toString("utf8") !== text) deepAdoptionError("PAYLOAD_TOO_LARGE");
  return text;
}
function snapshot(row: CompetitorAnalysis) { return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value])); }
function snapshotRecord(value: unknown): CompetitorAnalysis {
  if (!value || typeof value !== "object" || Array.isArray(value)) deepAdoptionError("AUDIT_INVALID");
  const row = { ...value } as Record<string, unknown>;
  for (const field of ["createdAt", "updatedAt", "summaryConfirmedAt"]) {
    const date = row[field]; if (date === null && field === "summaryConfirmedAt") continue;
    if (typeof date !== "string" || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString() !== date) deepAdoptionError("AUDIT_INVALID");
    row[field] = new Date(date);
  }
  const record = row as CompetitorAnalysis; competitorRevision(record); return record;
}
export function deepAdoptionEmptyReceipt(scope: Scope, status: "cancelled" | "unknown"): CompetitorDeepAdoptionReceipt {
  return CompetitorDeepAdoptionReceiptSchema.parse({ version: 1, identity: { userId: scope.userId, workspaceId: scope.workspaceId },
    projectId: scope.projectId, analysisId: scope.analysisId, jobRunId: scope.jobRunId, operationId: scope.operationId,
    status, requestHash: null, ref: null, committedRevision: null, reasonCode: status === "cancelled" ? "DEEP_ADOPTION_CANCELLED" : "DEEP_ADOPTION_UNKNOWN" });
}

/** No implicit connection fallback and no model calls. All business changes,
 * comparison invalidation and final UUID receipt share the supplied transaction. */
export function createCompetitorDeepAdoptionRepository(deps: { database?: () => Promise<CompetitorDeepResultReadDatabase | null>;
  permission?: typeof assertResourceAction; now?: () => Date; enabled?: () => boolean;
  invalidate?: typeof invalidateConfirmedCompetitorComparisons } = {}) {
  const permission = deps.permission ?? assertResourceAction, enabled = deps.enabled ?? (() => process.env.ENABLE_LISTING_DEEP_ADOPTION_WRITES === "true");
  async function transaction<T>(body: (session: ReturnType<typeof sessionFor>) => Promise<T>): Promise<T> {
    const db = await (deps.database ?? getDb)(); if (!db || typeof db.transaction !== "function") deepAdoptionError("TRANSACTION_REQUIRED");
    return db.transaction(async tx => { const session = sessionFor(tx); await session.admit(); return body(session); });
  }
  function sessionFor(tx: DbExecutor) {
    async function rows(text: string, values: unknown[] = []): Promise<Record<string, unknown>[]> {
      const result = await tx.execute(statement(text, values));
      if (!Array.isArray(result) || !Array.isArray(result[0])) deepAdoptionError("READ_INVALID"); return result[0];
    }
    async function write(text: string, values: unknown[]) {
      const result = await tx.execute(statement(text, values)), ack = Array.isArray(result) ? result[0] : null;
      if (ack?.affectedRows !== 1 || ack.warningStatus !== 0) deepAdoptionError("WRITE_NOT_ACKNOWLEDGED", "CONFLICT");
    }
    async function admit() {
      const required = ["ai_jobs", "ai_artifacts", "users", "workspaces", "workspace_memberships", "projects", "competitorAnalyses", "competitorComparisonReports", "security_access_policies", "role_permissions"];
      const found = await rows(`SELECT TABLE_NAME AS name,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${required.map(() => "?").join(",")})`, required);
      if (found.length !== required.length || required.some(name => found.filter(row => row.name === name && row.engine === "InnoDB").length !== 1)) deepAdoptionError("SCHEMA_UNAVAILABLE");
      for (const [table, column] of [["ai_jobs", "runId"], ["ai_artifacts", "artifactId"]]) {
        const unique = await rows("SELECT INDEX_NAME AS name,SEQ_IN_INDEX AS seq,COLUMN_NAME AS columnName,SUB_PART AS prefix FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND NON_UNIQUE=0 ORDER BY INDEX_NAME,SEQ_IN_INDEX", [table]);
        if (!unique.some(row => row.columnName === column && Number(row.seq) === 1 && row.prefix === null && unique.filter(other => other.name === row.name).length === 1)) deepAdoptionError("SCHEMA_UNAVAILABLE");
      }
      await assertAssistantRuleConfirmationJournalSchema(tx);
      const snapshots = await rows("SELECT COLUMN_NAME AS name,DATA_TYPE AS type,EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='security_audit_logs' AND COLUMN_NAME IN ('beforeSnapshot','afterSnapshot')");
      if (snapshots.length !== 2 || ["beforeSnapshot", "afterSnapshot"].some(name => snapshots.filter(row => row.name === name && row.type === "json" && row.extra === "").length !== 1)) deepAdoptionError("SCHEMA_UNAVAILABLE");
    }
    async function target(scope: Scope) { return lockCompetitorDeepAdoptionTarget(tx, targetScope(scope), permission); }
    async function verified(scope: Scope, revision: string) { return loadVerifiedCompetitorDeepResult(tx, targetScope(scope), revision, { lock: "update", permission }); }
    function json(value: unknown, maximum: number): unknown {
      if (typeof value !== "string" || Buffer.byteLength(value) > maximum * 8) deepAdoptionError("PAYLOAD_INVALID");
      let decoded: unknown; try { decoded = JSON.parse(value); } catch { return deepAdoptionError("PAYLOAD_INVALID"); }
      encode(decoded, maximum); return decoded;
    }
    async function final(scope: Scope) {
      const auditId = deepAdoptionArtifactId(scope), found = await rows(`SELECT auditId,workspaceId,actorUserId,action,resourceType,resourceId,projectId,status,riskLevel,
        IF(OCTET_LENGTH(CAST(metadata AS CHAR CHARACTER SET utf8mb4))<=131072,CAST(metadata AS CHAR CHARACTER SET utf8mb4),NULL) AS metadataText,
        IF(OCTET_LENGTH(CAST(beforeSnapshot AS CHAR CHARACTER SET utf8mb4))<=${SNAPSHOT_BYTES * 8},CAST(beforeSnapshot AS CHAR CHARACTER SET utf8mb4),NULL) AS beforeText,
        IF(OCTET_LENGTH(CAST(afterSnapshot AS CHAR CHARACTER SET utf8mb4))<=${SNAPSHOT_BYTES * 8},CAST(afterSnapshot AS CHAR CHARACTER SET utf8mb4),NULL) AS afterText
        FROM security_audit_logs WHERE auditId=? AND BINARY auditId=BINARY ? LIMIT 2 FOR UPDATE`, [auditId, auditId]);
      if (!found.length) return null;
      const row = found[0];
      if (found.length !== 1 || row.auditId !== auditId || row.workspaceId !== scope.workspaceId || row.actorUserId !== scope.userId || row.action !== ACTION
        || row.resourceType !== RESOURCE || row.resourceId !== scope.operationId || row.projectId !== scope.projectId || row.status !== "success" || row.riskLevel !== "medium") deepAdoptionError("OPERATION_SCOPE_CONFLICT", "CONFLICT");
      const metadata = json(row.metadataText, 16 * 1024) as Record<string, unknown>;
      if (!metadata || metadata.version !== 1 || metadata.kind !== "competitor_deep_adoption" || Object.keys(metadata).sort().join() !== ["afterHash", "beforeHash", "kind", "receipt", "version"].sort().join()) deepAdoptionError("AUDIT_INVALID");
      const receipt = CompetitorDeepAdoptionReceiptSchema.parse(metadata.receipt);
      if (receipt.status === "unknown" || receipt.identity.userId !== scope.userId || receipt.identity.workspaceId !== scope.workspaceId
        || receipt.projectId !== scope.projectId || receipt.analysisId !== scope.analysisId || receipt.jobRunId !== scope.jobRunId || receipt.operationId !== scope.operationId) deepAdoptionError("OPERATION_SCOPE_CONFLICT", "CONFLICT");
      if (receipt.status === "committed") {
        const before = snapshotRecord(json(row.beforeText, SNAPSHOT_BYTES)), after = snapshotRecord(json(row.afterText, SNAPSHOT_BYTES));
        if (before.id !== scope.analysisId || after.id !== scope.analysisId || before.projectId !== scope.projectId || after.projectId !== scope.projectId
          || competitorRevision(before) !== metadata.beforeHash || competitorRevision(after) !== metadata.afterHash || metadata.afterHash !== receipt.committedRevision
          || hash(JSON.parse(after.rawData!)[COMPETITOR_DEEP_ADOPTION_RAW_KEY]) !== hash(receipt.ref)) deepAdoptionError("AUDIT_INVALID");
      } else if (metadata.beforeHash !== null || metadata.afterHash !== null || row.beforeText !== null || row.afterText !== null) deepAdoptionError("AUDIT_INVALID");
      return receipt;
    }
    async function artifact(scope: Scope, ref: CompetitorDeepAdoptionRef, checked: Verified) {
      const found = await rows(`SELECT workspaceId,artifactId,domain,artifactKey,artifactType,sourceType,sourceId,sourceTable,sourceRowId,runId,agentSlug,nodeId,projectId,userId,status,version,isCurrent,contentHash,mimeType,fileSizeBytes,retentionClass,sourceSkillRunId,sourceAiJobRunId,
        IF(OCTET_LENGTH(CAST(contentJson AS CHAR CHARACTER SET utf8mb4))<=${COMPETITOR_DEEP_ADOPTION_MAX_BYTES * 8},CAST(contentJson AS CHAR CHARACTER SET utf8mb4),NULL) AS contentText,
        IF(OCTET_LENGTH(CAST(metadata AS CHAR CHARACTER SET utf8mb4))<=131072,CAST(metadata AS CHAR CHARACTER SET utf8mb4),NULL) AS metadataText FROM ai_artifacts WHERE artifactId=? LIMIT 2 FOR SHARE`, [ref.artifactId]);
      const row = found[0];
      const expected = { workspaceId: scope.workspaceId, artifactId: ref.artifactId, domain: "listing", artifactKey: `listing.competitor_deep_adopt.${checked.identity.asin}`,
        artifactType: "json", sourceType: "user_edit", sourceId: String(scope.analysisId), sourceTable: "competitorAnalyses", sourceRowId: String(scope.analysisId),
        runId: checked.stored.agentRunId, agentSlug: "listing.full.workflow", nodeId: "N1", projectId: scope.projectId, userId: scope.userId,
        status: "final", version: ref.summaryVersion, isCurrent: 0, contentHash: ref.projectionHash, mimeType: "application/json", retentionClass: "hot",
        sourceSkillRunId: checked.stored.journal.steps.find(step => step.stage === "summary")?.modelReceipt?.runId, sourceAiJobRunId: scope.jobRunId };
      if (found.length !== 1 || Object.entries(expected).some(([key, value]) => row[key] !== value)) deepAdoptionError("ARTIFACT_INVALID");
      const body = CompetitorDeepAdoptionArtifactSchema.parse(json(row.contentText, COMPETITOR_DEEP_ADOPTION_MAX_BYTES));
      const metadata = json(row.metadataText, 16 * 1024) as Record<string, unknown>;
      if (hash(body) !== ref.projectionHash || Buffer.byteLength(canonical(body)) !== row.fileSizeBytes || hash(body.identity) !== hash(checked.identity)
        || body.operationId !== ref.operationId || body.jobRunId !== scope.jobRunId || body.originalArtifactId !== checked.receipt.artifactId
        || body.publicationRevision !== checked.receipt.committedRevision || body.resultHash !== checked.result.resultHash || body.evidenceHash !== checked.receipt.evidenceHash
        || body.skillPlanHash !== checked.receipt.skillPlanHash || body.journalHash !== checked.receipt.journalHash || body.sourceFingerprint !== ref.sourceFingerprint
        || body.summaryVersion !== ref.summaryVersion || body.adoptedBy !== ref.adoptedBy || body.adoptedAt !== ref.adoptedAt || hash(body.summary) !== ref.summaryHash
        || hash(body.result) !== hash(checked.result) || metadata.version !== 1 || metadata.kind !== "competitor_deep_adoption" || hash(metadata.ref) !== hash(ref)
        || hash(metadata.identity) !== hash(checked.identity) || typeof metadata.requestHash !== "string" || !/^[a-f0-9]{64}$/u.test(metadata.requestHash)
        || Object.keys(metadata).sort().join() !== ["version", "kind", "ref", "identity", "requestHash"].sort().join()
        || ref.artifactId !== deepAdoptionArtifactId({ ...scope, operationId: ref.operationId })) deepAdoptionError("ARTIFACT_INVALID");
      return body;
    }
    async function active(scope: Scope, checked: Verified) {
      const raw = JSON.parse(checked.analysis.rawData!);
      if (!Object.hasOwn(raw, COMPETITOR_DEEP_ADOPTION_RAW_KEY)) return null;
      const ref = CompetitorDeepAdoptionRefSchema.parse(raw[COMPETITOR_DEEP_ADOPTION_RAW_KEY]);
      if (ref.jobRunId !== scope.jobRunId || ref.resultHash !== checked.result.resultHash || ref.evidenceHash !== checked.receipt.evidenceHash) deepAdoptionError("CANDIDATE_CHANGED", "CONFLICT");
      const body = await artifact(scope, ref, checked);
      if (fingerprint(checked.analysis) !== ref.sourceFingerprint) deepAdoptionError("SOURCE_CHANGED", "CONFLICT");
      return { ref, body };
    }
    async function insertFinal(scope: Scope, role: string, receipt: CompetitorDeepAdoptionReceipt, before: CompetitorAnalysis | null, after: CompetitorAnalysis | null) {
      const previous = await final(scope); if (previous) deepAdoptionError(previous.status === "cancelled" ? "CANCELLED" : "OPERATION_CONFLICT", "CONFLICT");
      const metadata = { version: 1, kind: "competitor_deep_adoption", receipt, beforeHash: before ? competitorRevision(before) : null, afterHash: after ? competitorRevision(after) : null };
      await write("INSERT INTO security_audit_logs (auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,projectId,status,riskLevel,beforeSnapshot,afterSnapshot,metadata) VALUES (?,?,?,?,?,?,?,?,'success','medium',?,?,?)",
        [deepAdoptionArtifactId(scope), scope.workspaceId, scope.userId, role, ACTION, RESOURCE, scope.operationId, scope.projectId,
          before ? encode(snapshot(before), SNAPSHOT_BYTES) : null, after ? encode(snapshot(after), SNAPSHOT_BYTES) : null, encode(metadata, 16 * 1024)]);
      const saved = await final(scope); if (!saved || hash(saved) !== hash(receipt)) deepAdoptionError("AUDIT_READBACK_FAILED", "CONFLICT"); return saved;
    }
    async function adopt(scope: Scope, input: CompetitorDeepAdoptionInput, checked: Verified) {
      if (!enabled()) deepAdoptionError("WRITES_DISABLED");
      if (checked.currentRevision !== input.expectedRevision || checked.result.resultHash !== input.expectedResultHash || checked.receipt.evidenceHash !== input.expectedEvidenceHash) deepAdoptionError("SOURCE_CHANGED", "CONFLICT");
      const previous = await active(scope, checked);
      if (!previous && checked.receipt.committedRevision !== checked.currentRevision) deepAdoptionError("SOURCE_CHANGED", "CONFLICT");
      const current = checked.analysis;
      if (!id(current.summaryVersion) || current.summaryVersion >= 2147483647) deepAdoptionError("VERSION_LIMIT");
      if (Buffer.byteLength(input.summary, "utf8") > 65535) deepAdoptionError("PAYLOAD_TOO_LARGE");
      const time = (deps.now ?? (() => new Date()))();
      if (!(time instanceof Date) || !Number.isFinite(time.getTime())) deepAdoptionError("TIME_INVALID");
      const stamp = new Date(Math.floor(time.getTime() / 1000) * 1000), adoptedAt = stamp.toISOString(), summaryVersion = current.summaryVersion + 1;
      if (stamp < current.updatedAt) deepAdoptionError("TIME_INVALID");
      const requestHash = deepAdoptionRequestHash(scope, input), sourceFingerprint = fingerprint(current);
      const body = CompetitorDeepAdoptionArtifactSchema.parse({ version: 1, kind: "adopted_competitor_deep_research", identity: checked.identity,
        operationId: scope.operationId, jobRunId: scope.jobRunId, originalArtifactId: checked.receipt.artifactId, publicationRevision: checked.receipt.committedRevision,
        resultHash: checked.result.resultHash, evidenceHash: checked.receipt.evidenceHash, skillPlanHash: checked.receipt.skillPlanHash, journalHash: checked.receipt.journalHash,
        sourceFingerprint, summary: input.summary, summaryVersion, adoptedBy: scope.userId, adoptedAt, result: checked.result });
      const bodyText = encode(body, COMPETITOR_DEEP_ADOPTION_MAX_BYTES), ref = CompetitorDeepAdoptionRefSchema.parse({ version: 1, kind: "competitor_deep_adoption",
        artifactId: deepAdoptionArtifactId(scope), operationId: scope.operationId, jobRunId: scope.jobRunId, resultHash: body.resultHash, evidenceHash: body.evidenceHash,
        sourceFingerprint, projectionHash: hash(body), summaryHash: hash(input.summary), summaryVersion, adoptedBy: scope.userId, adoptedAt });
      const rawData = encode({ ...JSON.parse(current.rawData!), [COMPETITOR_DEEP_ADOPTION_RAW_KEY]: ref }, 65535);
      const after: CompetitorAnalysis = { ...current, rawData, summary: input.summary, summaryStatus: "confirmed", summaryVersion,
        summaryConfirmedBy: scope.userId, summaryConfirmedAt: stamp, updatedAt: stamp };
      const receipt = CompetitorDeepAdoptionReceiptSchema.parse({ version: 1, identity: { userId: scope.userId, workspaceId: scope.workspaceId },
        projectId: scope.projectId, analysisId: scope.analysisId, jobRunId: scope.jobRunId, operationId: scope.operationId, status: "committed", requestHash,
        ref, committedRevision: competitorRevision(after), reasonCode: null });
      await write("INSERT INTO ai_artifacts (workspaceId,artifactId,domain,artifactKey,artifactType,sourceType,sourceId,sourceTable,sourceRowId,runId,agentSlug,nodeId,projectId,userId,status,version,isCurrent,contentJson,contentHash,mimeType,fileSizeBytes,retentionClass,metadata,sourceSkillRunId,sourceAiJobRunId) VALUES (?,?,'listing',?,'json','user_edit',?,'competitorAnalyses',?,?, 'listing.full.workflow','N1',?,?,'final',?,0,?,?,'application/json',?,'hot',?,?,?)",
        [scope.workspaceId, ref.artifactId, `listing.competitor_deep_adopt.${checked.identity.asin}`, String(scope.analysisId), String(scope.analysisId), checked.stored.agentRunId,
          scope.projectId, scope.userId, summaryVersion, bodyText, ref.projectionHash, Buffer.byteLength(bodyText),
          encode({ version: 1, kind: "competitor_deep_adoption", ref, identity: checked.identity, requestHash }, 16 * 1024),
          checked.stored.journal.steps.find(step => step.stage === "summary")!.modelReceipt!.runId, scope.jobRunId]);
      await write("UPDATE competitorAnalyses SET rawData=?,summary=?,summaryStatus='confirmed',summaryVersion=?,summaryConfirmedBy=?,summaryConfirmedAt=?,updatedAt=? WHERE id=? AND projectId=? AND summaryVersion=?",
        [rawData, input.summary, summaryVersion, scope.userId, stamp, stamp, scope.analysisId, scope.projectId, current.summaryVersion]);
      const saved = await target(scope);
      if (saved.currentRevision !== receipt.committedRevision) deepAdoptionError("READBACK_FAILED", "CONFLICT");
      await artifact(scope, ref, { ...checked, analysis: saved.analysis, currentRevision: saved.currentRevision });
      await (deps.invalidate ?? invalidateConfirmedCompetitorComparisons)(tx, scope, scope.analysisId, stamp);
      await insertFinal(scope, checked.actorRole, receipt, current, saved.analysis);
      return receipt;
    }
    return { executor: tx, admit, target, verified, final, artifact, active, adopt,
      async cancel(scope: Scope, role: string) { return await final(scope) ?? insertFinal(scope, role, deepAdoptionEmptyReceipt(scope, "cancelled"), null, null); } };
  }
  return { transaction, enabled };
}
export type CompetitorDeepAdoptionRepository = ReturnType<typeof createCompetitorDeepAdoptionRepository>;
export type CompetitorDeepAdoptionScope = Scope;
export const competitorDeepAdoptionRepository = createCompetitorDeepAdoptionRepository();
export type CompetitorDeepAdoptionOperation = CompetitorDeepAdoptionOperationInput;
