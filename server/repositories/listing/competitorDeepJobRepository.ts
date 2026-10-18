import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { COMPETITOR_DEEP_EXECUTION_JOB_KIND, CompetitorDeepOperationInputSchema, type CompetitorDeepOperationInput } from "../../../shared/competitorDeepExecutionJob";
import { getDb, type DbExecutor } from "../dbClient";
import { assertResourceAction } from "../../services/securityGovernance";
import { assertAssistantRuleConfirmationJournalSchema } from "../../domains/ai_os/repositories/assistantRuleConfirmationJournal";
import { deepRuntimeHash } from "../../domains/listing/services/competitorDeepRuntimeContract";
import { decodeCompetitorDeepExecutionInput, competitorDeepPublicationReceiptSchema, COMPETITOR_DEEP_INPUT_MAX_BYTES, type CompetitorDeepStoredInput } from "./competitorDeepExecutionRepository";
import { competitorRevision } from "../project/competitorWritePolicy";
import type { CompetitorAnalysis } from "../../../drizzle/schema/project";
export type DeepIdentity = { userId: number; workspaceId: number | null };
export type DeepScope = DeepIdentity & { projectId: number; analysisId: number };
export type DeepJob = { runId: string; userId: number; workspaceId: number | null; projectId: number; status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  progress: number; attempt: number; lockedBy: string | null; leaseUntil: Date | string | null; input: CompetitorDeepStoredInput; output: unknown; errorMessage: string | null };
export const deepRunId = (identity: DeepIdentity, operationId: string) => `deep_${deepRuntimeHash({ identity: { userId: identity.userId, workspaceId: identity.workspaceId }, operationId })}`;
const exactScope = (scope: DeepScope): DeepScope => ({ userId: scope.userId, workspaceId: scope.workspaceId, projectId: scope.projectId, analysisId: scope.analysisId });
export function deepJobError(message: string, code: "CONFLICT" | "FORBIDDEN" | "NOT_FOUND" | "PRECONDITION_FAILED" | "INTERNAL_SERVER_ERROR" = "PRECONDITION_FAILED"): never {
  throw new TRPCError({ code, message: `COMPETITOR_DEEP_${message}` });
}
function statement(text: string, values: unknown[]) { const parts = text.split("?"); if (parts.length !== values.length + 1) deepJobError("SQL_BIND_INVALID");
  return sql.join(parts.flatMap((part, i) => i < values.length ? [sql.raw(part), sql`${values[i]}`] : [sql.raw(part)]), sql.raw("")); }
const statusSchema = z.enum(["queued", "running", "succeeded", "failed", "canceled"]);
const analysisTextColumns = ["asin", "title", "bulletPoints", "imageUrls", "price", "rating", "reviewCount", "reviewAnalysis", "keywords", "rawData", "aiSummary", "summary", "summaryStatus"] as const;
const analysisSelect = `SELECT id,projectId,summaryVersion,summaryConfirmedBy,summaryConfirmedAt,createdAt,updatedAt,
  ${analysisTextColumns.map(column => `IF(OCTET_LENGTH(${column})<=65535,${column},NULL) AS ${column}`).join(",")},
  IF(${analysisTextColumns.map(column => `(${column} IS NULL OR OCTET_LENGTH(${column})<=65535)`).join(" AND ")},1,0) AS columnsWithinLimit
  FROM competitorAnalyses WHERE projectId=? AND id=? FOR UPDATE`;
export function competitorDeepJobSession(executor: DbExecutor, permission = assertResourceAction) {
  async function rows(text: string, values: unknown[] = []): Promise<Record<string, unknown>[]> {
    const response = await executor.execute(statement(text, values));
    if (!Array.isArray(response) || !Array.isArray(response[0])) deepJobError("STORAGE_INVALID"); return response[0];
  }
  async function write(text: string, values: unknown[]) {
    const response = await executor.execute(statement(text, values)), ack = Array.isArray(response) ? response[0] : null;
    if (ack?.affectedRows !== 1 || ack.warningStatus !== 0) deepJobError("WRITE_NOT_ACKNOWLEDGED", "CONFLICT");
  }
  async function admit() {
    const required = ["ai_jobs", "users", "workspaces", "workspace_memberships", "projects", "competitorAnalyses", "emperor_agent_runs", "emperor_agent_checkpoints",
      "emperor_skills", "emperor_model_providers", "security_access_policies", "role_permissions", "ai_artifacts"];
    const tables = await rows(`SELECT TABLE_NAME AS name,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${required.map(() => "?").join(",")})`, required);
    if (tables.length !== required.length || required.some(name => tables.filter(row => row.name === name && row.engine === "InnoDB").length !== 1)) deepJobError("SCHEMA_UNAVAILABLE");
    const unique = await rows("SELECT INDEX_NAME AS name,SEQ_IN_INDEX AS seq,COLUMN_NAME AS columnName,SUB_PART AS prefix FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ai_jobs' AND NON_UNIQUE=0 ORDER BY INDEX_NAME,SEQ_IN_INDEX");
    if (!unique.some(row => row.columnName === "runId" && row.seq === 1 && row.prefix === null && unique.filter(other => other.name === row.name).length === 1)) deepJobError("SCHEMA_UNAVAILABLE");
    await assertAssistantRuleConfirmationJournalSchema(executor);
  }
  async function job(runId: string): Promise<DeepJob | null> {
    const found = await rows(`SELECT runId,kind,module,userId,workspaceId,projectId,status,progress,attempt,maxAttempts,lockedBy,leaseUntil,errorMessage,
      IF(OCTET_LENGTH(CAST(input AS CHAR CHARACTER SET utf8mb4))<=${COMPETITOR_DEEP_INPUT_MAX_BYTES},CAST(input AS CHAR CHARACTER SET utf8mb4),NULL) AS inputText,
      IF(OCTET_LENGTH(CAST(output AS CHAR CHARACTER SET utf8mb4))<=16384,CAST(output AS CHAR CHARACTER SET utf8mb4),NULL) AS outputText
      FROM ai_jobs WHERE runId=? FOR UPDATE`, [runId]);
    if (!found.length) return null;
    if (found.length !== 1) deepJobError("JOB_INVALID"); const row = found[0];
    if (typeof row.inputText !== "string") deepJobError("JOB_INVALID");
    const input = decodeCompetitorDeepExecutionInput(row.inputText), identity = input.evidence.identity;
    if (!input.reservation || row.kind !== COMPETITOR_DEEP_EXECUTION_JOB_KIND || row.module !== "listing" || row.maxAttempts !== 1
      || row.runId !== deepRunId(identity, input.reservation.request.operationId) || row.userId !== identity.userId || row.workspaceId !== identity.workspaceId || row.projectId !== identity.projectId
      || !statusSchema.safeParse(row.status).success || !Number.isInteger(row.progress) || Number(row.progress) < 0 || Number(row.progress) > 100) deepJobError("JOB_INVALID");
    let output: unknown = null;
    if (row.outputText !== null) { if (typeof row.outputText !== "string") deepJobError("JOB_INVALID"); output = JSON.parse(row.outputText); }
    if (row.status === "succeeded") { const receipt = competitorDeepPublicationReceiptSchema.parse(output);
      if (receipt.runId !== row.runId || receipt.analysisId !== identity.analysisId || receipt.evidenceHash !== input.evidence.evidenceHash || receipt.sourceRevision !== identity.revision
        || receipt.journalHash !== input.journal.journalHash) deepJobError("RECEIPT_INVALID"); }
    return { ...row, input, output } as DeepJob;
  }
  async function authorize(scope: DeepScope, action: "read" | "run" | "cancel") {
    const users = await rows("SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR UPDATE", [scope.userId]), actor = users[0];
    if (users.length !== 1 || actor.id !== scope.userId || actor.status !== "active" || actor.defaultWorkspaceId !== scope.workspaceId || typeof actor.role !== "string") deepJobError("ACCESS_DENIED", "FORBIDDEN");
    if (scope.workspaceId !== null) {
      const workspaces = await rows("SELECT id,status FROM workspaces WHERE id=? FOR SHARE", [scope.workspaceId]);
      const members = await rows("SELECT userId,workspaceId,status FROM workspace_memberships WHERE userId=? AND workspaceId=? FOR SHARE", [scope.userId, scope.workspaceId]);
      if (workspaces.length !== 1 || workspaces[0].id !== scope.workspaceId || workspaces[0].status !== "active" || members.length !== 1
        || members[0].userId !== scope.userId || members[0].workspaceId !== scope.workspaceId || members[0].status !== "active") deepJobError("ACCESS_DENIED", "FORBIDDEN");
    }
    await permission({ actor: { id: scope.userId, role: actor.role, defaultWorkspaceId: scope.workspaceId }, resource: "project", action,
      workspaceId: scope.workspaceId, projectId: scope.projectId, resourceId: scope.projectId, authorizationRead: { executor, strict: true, lock: true } });
    const projects = await rows("SELECT id,userId,workspaceId FROM projects WHERE id=? FOR UPDATE", [scope.projectId]), parent = projects[0];
    if (projects.length !== 1 || parent.userId !== scope.userId || parent.id !== scope.projectId || parent.workspaceId !== null && parent.workspaceId !== scope.workspaceId) deepJobError("ACCESS_DENIED", "FORBIDDEN");
    const analyses = await rows(analysisSelect, [scope.projectId, scope.analysisId]);
    if (analyses.length !== 1 || analyses[0].columnsWithinLimit !== 1) deepJobError("SOURCE_UNAVAILABLE", "NOT_FOUND");
    const { columnsWithinLimit: _limit, ...record } = analyses[0], analysis = record as CompetitorAnalysis;
    return { actor, analysis, revision: competitorRevision(analysis), sourceWorkspaceId: parent.workspaceId };
  }
  async function fence(scope: DeepScope, operationId: string) {
    scope = exactScope(scope);
    const auditId = `deep_cancel_${deepRuntimeHash({ identity: { userId: scope.userId, workspaceId: scope.workspaceId }, operationId })}`;
    const entries = await rows("SELECT auditId,actorUserId,workspaceId,action,resourceType,resourceId,IF(OCTET_LENGTH(CAST(metadata AS CHAR CHARACTER SET utf8mb4))<=4096,CAST(metadata AS CHAR CHARACTER SET utf8mb4),NULL) AS body FROM security_audit_logs WHERE auditId=? FOR UPDATE", [auditId]);
    if (!entries.length) return false;
    const entry = entries[0]; let body: unknown;
    try { body = typeof entry.body === "string" ? JSON.parse(entry.body) : null; } catch { deepJobError("CANCEL_RECEIPT_INVALID"); }
    if (entries.length !== 1 || entry.auditId !== auditId || entry.actorUserId !== scope.userId || entry.workspaceId !== scope.workspaceId
      || entry.action !== "listing.deep.cancel" || entry.resourceType !== "listing_deep_operation" || entry.resourceId !== operationId
      || deepRuntimeHash(body) !== deepRuntimeHash({ version: 1, scope, operationId, status: "canceled" })) deepJobError("OPERATION_SCOPE_CONFLICT", "CONFLICT");
    return true;
  }
  function bound(row: DeepJob, scope: DeepScope, operationId: string) {
    if (row.userId !== scope.userId || row.workspaceId !== scope.workspaceId || row.projectId !== scope.projectId
      || row.input.evidence.identity.analysisId !== scope.analysisId || row.input.reservation?.request.operationId !== operationId) deepJobError("OPERATION_SCOPE_CONFLICT", "CONFLICT");
  }
  function lease(row: DeepJob, token: string) {
    if (row.status !== "running" || row.lockedBy !== token || row.attempt !== 1 || !row.leaseUntil || !(new Date(row.leaseUntil).getTime() > Date.now())) deepJobError("LEASE_LOST", "CONFLICT");
  }
  async function agent(input: CompetitorDeepStoredInput) {
    const identity = input.evidence.identity;
    const agents = await rows("SELECT runId,agentSlug,userId,workspaceId,projectId,status FROM emperor_agent_runs WHERE runId=? FOR SHARE", [input.agentRunId]);
    const nodes = await rows("SELECT runId,agentSlug,nodeId,workspaceId,status FROM emperor_agent_checkpoints WHERE runId=? AND nodeId='N1' FOR SHARE", [input.agentRunId]);
    const current = agents[0], node = nodes[0];
    if (agents.length !== 1 || nodes.length !== 1 || current.runId !== input.agentRunId || current.agentSlug !== "listing.full.workflow"
      || current.userId !== identity.userId || current.workspaceId !== identity.workspaceId || current.projectId !== identity.projectId
      || node.runId !== input.agentRunId || node.agentSlug !== "listing.full.workflow" || node.nodeId !== "N1" || node.workspaceId !== identity.workspaceId
      || !["running", "waiting_human", "paused", "completed", "failed"].includes(String(current.status))
      || !["pending", "ready", "running", "waiting_human", "confirmed", "skipped", "failed"].includes(String(node.status))) deepJobError("AGENT_UNAVAILABLE");
  }
  return { executor, rows, write, admit, job, authorize, fence, bound, lease, agent,
    async reserve(input: CompetitorDeepStoredInput) {
      const stored = decodeCompetitorDeepExecutionInput(input); if (!stored.reservation) deepJobError("RUNTIME_REQUIRED");
      if (stored.reservation.runtime.version !== 2) deepJobError("CONFIGURATION_SNAPSHOT_REQUIRED");
      const b = stored.evidence.identity, runId = deepRunId(b, stored.reservation.request.operationId);
      await write("INSERT INTO ai_jobs (runId,kind,module,`procedure`,workspaceId,userId,projectId,skillSlug,input,status,progress,queueName,attempt,maxAttempts,timeoutSeconds) VALUES (?,?,?,?,?,?,?,?,?,'queued',0,'analysis',0,1,7200)",
        [runId, COMPETITOR_DEEP_EXECUTION_JOB_KIND, "listing", "analysis.startCompetitorDeepResearch", b.workspaceId, b.userId, b.projectId, stored.skills.title.skillSlug, JSON.stringify(stored)]);
      const saved = await job(runId); if (!saved || deepRuntimeHash(saved.input) !== deepRuntimeHash(stored)) deepJobError("RESERVE_READBACK_FAILED"); return saved;
    },
    async cancel(scope: DeepScope, operationId: string, actorRole: string, current: DeepJob | null) {
      scope = exactScope(scope);
      if (current?.status === "succeeded" || current?.status === "canceled") return current;
      if (!await fence(scope, operationId)) {
        const auditId = `deep_cancel_${deepRuntimeHash({ identity: { userId: scope.userId, workspaceId: scope.workspaceId }, operationId })}`;
        await write("INSERT INTO security_audit_logs (auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,status,riskLevel,metadata) VALUES (?,?,?,?,?,?,?,'success','low',?)",
          [auditId, scope.workspaceId, scope.userId, actorRole, "listing.deep.cancel", "listing_deep_operation", operationId, JSON.stringify({ version: 1, scope, operationId, status: "canceled" })]);
        if (!await fence(scope, operationId)) deepJobError("CANCEL_READBACK_FAILED");
      }
      if (!current) return null;
      await write("UPDATE ai_jobs SET status='canceled',errorMessage='COMPETITOR_DEEP_CANCELED',lockedBy=NULL,leaseUntil=NULL,completedAt=NOW(),updatedAt=NOW() WHERE runId=? AND status=?", [current.runId, current.status]);
      const saved = await job(current.runId); if (!saved || saved.status !== "canceled") deepJobError("CANCEL_READBACK_FAILED"); return saved;
    },
  };
}
export type CompetitorDeepJobSession = ReturnType<typeof competitorDeepJobSession>;
export function createCompetitorDeepJobRepository(deps: { database?: typeof getDb; permission?: typeof assertResourceAction } = {}) {
  return {
    async transaction<T>(body: (session: CompetitorDeepJobSession) => Promise<T>): Promise<T> {
      try { const db = await (deps.database ?? getDb)(); if (!db || typeof db.transaction !== "function") deepJobError("TRANSACTION_REQUIRED");
        return await db.transaction(async tx => { const session = competitorDeepJobSession(tx, deps.permission); await session.admit(); return body(session); });
      } catch (error) { if (error instanceof TRPCError && /^COMPETITOR_DEEP_[A-Z_]+$/u.test(error.message)) throw error;
        if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(error.code)) deepJobError("ACCESS_DENIED", "FORBIDDEN");
        deepJobError("STORAGE_OUTCOME_UNKNOWN", "INTERNAL_SERVER_ERROR"); }
    },
    async next(afterRunId: string | null = null): Promise<{ runId: string } | null> {
      const db = await (deps.database ?? getDb)(); if (!db) deepJobError("TRANSACTION_REQUIRED");
      const result = await db.execute(sql`SELECT runId FROM ai_jobs WHERE kind=${COMPETITOR_DEEP_EXECUTION_JOB_KIND} AND (${afterRunId} IS NULL OR runId>${afterRunId}) AND (status='queued' OR (status='running' AND leaseUntil<NOW())) ORDER BY runId LIMIT 1`);
      const found = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : null;
      if (!found || found.length > 1 || found[0] && !/^deep_[a-f0-9]{64}$/u.test(String(found[0].runId))) deepJobError("QUEUE_INVALID");
      return found[0] ? { runId: String(found[0].runId) } : null;
    },
  };
}
export const competitorDeepJobRepository = createCompetitorDeepJobRepository();
export function deepOperationScope(identity: DeepIdentity, input: CompetitorDeepOperationInput): DeepScope {
  CompetitorDeepOperationInputSchema.parse({ projectId: input.projectId, analysisId: input.analysisId, expectedWorkspaceId: input.expectedWorkspaceId, operationId: input.operationId });
  return { userId: identity.userId, workspaceId: identity.workspaceId, projectId: input.projectId, analysisId: input.analysisId };
}
