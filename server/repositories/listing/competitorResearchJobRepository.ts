import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { COMPETITOR_RESEARCH_JOB_KIND } from "../../../shared/competitorResearchJob";
import type { CompetitorAnalysis } from "../../../drizzle/schema/project";
import { getDb, type DbExecutor } from "../dbClient";
import { competitorRevision } from "../project/competitorWritePolicy";

const id = z.number().int().positive().safe();
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const competitorResearchBindingSchema = z.object({
  version: z.literal(1), userId: id, workspaceId: id.nullable(), projectId: id, analysisId: id,
  asin: z.string().regex(/^[A-Z0-9]{10}$/u), sourceHash: hash,
}).strict();
const snapshotSchema = z.object({ version: z.string().min(1).max(128), status: z.literal("Released"),
  systemPromptHash: z.string().min(1).max(64), userPromptHash: z.string().min(1).max(64), manifestHash: z.string().min(1).max(64) }).strict();
const checkpointSchema = z.object({
  stage: z.enum(["reserved", "model_dispatched", "analysis_ready", "analysis_committed"]),
  analysisJson: z.string().nullable(), analysisHash: hash.nullable(), summary: z.string().nullable(), keywordsJson: z.string().nullable(),
  skillRunId: z.string().min(1).max(80).nullable(), skillSnapshot: snapshotSchema.nullable(), committedVersion: id.nullable(),
}).strict();
const inputSchema = z.object({ version: z.literal(1), binding: competitorResearchBindingSchema, expectedRevision: hash,
  agentRunId: z.string().min(1).max(80), agentNodeId: z.literal("N1"), checkpoint: checkpointSchema }).strict();
export type CompetitorResearchBinding = z.infer<typeof competitorResearchBindingSchema>;
export type CompetitorResearchStoredInput = z.infer<typeof inputSchema>;
export type CompetitorResearchLease = { runId: string; lockedBy: string; attempt: number; signal: AbortSignal };
export type CompetitorResearchJobRow = Record<string, unknown> & {
  runId: string; kind: string; module: string; userId: number; workspaceId: number | null; projectId: number;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled"; progress: number; attempt: number;
  lockedBy: string | null; leaseUntil: Date | string | null; input: CompetitorResearchStoredInput; createdAt: Date;
};
export interface CompetitorResearchDatabase { execute(statement: SQL): Promise<unknown>; transaction?<T>(callback: (tx: DbExecutor) => Promise<T>): Promise<T> }
export function researchError(code: "CONFLICT" | "PRECONDITION_FAILED" | "NOT_FOUND" | "FORBIDDEN" | "INTERNAL_SERVER_ERROR", message: string): never {
  throw new TRPCError({ code, message });
}
export const researchHash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
/** Plain lossless UTF-8 JSON only; no getters, toJSON, truncation or implicit omissions. */
export function encodeResearchJson(value: unknown, maximum = 65535): string {
  const seen = new Set<object>();
  function visit(v: unknown, depth: number): void {
    if (depth > 64) researchError("PRECONDITION_FAILED", "COMPETITOR_RESEARCH_JSON_INVALID");
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "string" && Buffer.from(v, "utf8").toString("utf8") === v) return;
    if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER && !Object.is(v, -0)) return;
    if (!v || typeof v !== "object" || seen.has(v)) researchError("PRECONDITION_FAILED", "COMPETITOR_RESEARCH_JSON_INVALID");
    const array = Array.isArray(v), keys = Reflect.ownKeys(v);
    if ((!array && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) || (array && keys.length !== v.length + 1)) researchError("PRECONDITION_FAILED", "COMPETITOR_RESEARCH_JSON_INVALID");
    seen.add(v);
    for (const key of keys) {
      if (array && key === "length") continue;
      const field = Object.getOwnPropertyDescriptor(v, key)!;
      if (typeof key !== "string" || !field.enumerable || !("value" in field) || (array && (!/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= v.length))) researchError("PRECONDITION_FAILED", "COMPETITOR_RESEARCH_JSON_INVALID");
      visit(field.value, depth + 1);
    }
    seen.delete(v);
  }
  visit(value, 0);
  const result = JSON.stringify(value);
  if (Buffer.byteLength(result, "utf8") > maximum) researchError("PRECONDITION_FAILED", "COMPETITOR_RESEARCH_TEXT_TOO_LARGE");
  return result;
}
export function competitorResearchRunId(binding: CompetitorResearchBinding) { return `competitor_${researchHash(JSON.stringify(competitorResearchBindingSchema.parse(binding)))}`; }
export function decodeCompetitorResearchInput(value: unknown): CompetitorResearchStoredInput {
  try {
    const raw = typeof value === "string" ? JSON.parse(value) : value;
    encodeResearchJson(raw, 512 * 1024);
    const input = inputSchema.parse(raw), cp = input.checkpoint;
    const ready = cp.stage === "analysis_ready" || cp.stage === "analysis_committed";
    if ((cp.stage !== "reserved") !== (cp.skillSnapshot !== null)) throw new Error();
    if (ready) {
      if (!cp.analysisJson || !cp.analysisHash || !cp.skillRunId || !cp.summary?.trim() || researchHash(cp.analysisJson) !== cp.analysisHash) throw new Error();
      const parsed = JSON.parse(cp.analysisJson);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Object.keys(parsed).length || encodeResearchJson(parsed) !== cp.analysisJson) throw new Error();
      if ((cp.keywordsJson !== null && encodeResearchJson(JSON.parse(cp.keywordsJson)) !== cp.keywordsJson) || Buffer.byteLength(cp.summary, "utf8") > 65535) throw new Error();
    } else if ([cp.analysisJson, cp.analysisHash, cp.skillRunId, cp.summary, cp.keywordsJson].some(v => v !== null)) throw new Error();
    if ((cp.stage === "analysis_committed") !== (cp.committedVersion !== null)) throw new Error();
    return input;
  } catch { return researchError("PRECONDITION_FAILED", "COMPETITOR_RESEARCH_CHECKPOINT_INVALID"); }
}
function statement(text: string, values: unknown[]) {
  const parts = text.split("?");
  if (parts.length !== values.length + 1) throw new Error("COMPETITOR_RESEARCH_SQL_BIND_MISMATCH");
  return sql.join(parts.flatMap((part, i) => i < values.length ? [sql.raw(part), sql`${values[i]}`] : [sql.raw(part)]), sql.raw(""));
}
function storageError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  let current = error;
  for (let i = 0; i < 5 && current && typeof current === "object"; i++) {
    const e = current as { errno?: number; cause?: unknown };
    if (e.errno === 1062 || e.errno === 1213) researchError("CONFLICT", "COMPETITOR_RESEARCH_STORAGE_CONFLICT");
    if (e.errno === 1146 || e.errno === 1054) researchError("PRECONDITION_FAILED", "COMPETITOR_RESEARCH_SCHEMA_UNAVAILABLE");
    current = e.cause;
  }
  return researchError("INTERNAL_SERVER_ERROR", "COMPETITOR_RESEARCH_STORAGE_FAILED");
}
export function competitorResearchSession(executor: DbExecutor) {
  async function execute(text: string, values: unknown[] = []) { try { return await executor.execute(statement(text, values)); } catch (error) { return storageError(error); } }
  async function rows(text: string, values: unknown[] = []): Promise<Record<string, unknown>[]> {
    const result = await execute(text, values);
    if (!Array.isArray(result) || !Array.isArray(result[0])) researchError("INTERNAL_SERVER_ERROR", "COMPETITOR_RESEARCH_READ_INVALID");
    return result[0];
  }
  async function write(text: string, values: unknown[]) {
    const result = await execute(text, values), ack = Array.isArray(result) ? result[0] : null;
    if (ack?.affectedRows !== 1 || ack.warningStatus !== 0) researchError("CONFLICT", "COMPETITOR_RESEARCH_WRITE_NOT_ACKNOWLEDGED");
  }
  function decode(row: Record<string, unknown>): CompetitorResearchJobRow {
    const input = decodeCompetitorResearchInput(row.input), b = input.binding, cp = input.checkpoint;
    if (row.kind !== COMPETITOR_RESEARCH_JOB_KIND || row.module !== "listing" || row.skillSlug !== "listing.competitor.analyze" || row.maxAttempts !== 1 || row.runId !== competitorResearchRunId(b)
      || row.userId !== b.userId || row.workspaceId !== b.workspaceId || row.projectId !== b.projectId
      || !["queued", "running", "succeeded", "failed", "canceled"].includes(String(row.status))
      || (row.status === "succeeded") !== (cp.stage === "analysis_committed")) researchError("PRECONDITION_FAILED", "COMPETITOR_RESEARCH_BINDING_INVALID");
    if (cp.stage === "analysis_committed") {
      let receipt: unknown;
      try { receipt = typeof row.output === "string" ? JSON.parse(row.output) : row.output; } catch { researchError("PRECONDITION_FAILED", "COMPETITOR_RESEARCH_RECEIPT_INVALID"); }
      if (!isDeepStrictEqual(receipt, receiptFor(String(row.runId), input))) researchError("PRECONDITION_FAILED", "COMPETITOR_RESEARCH_RECEIPT_INVALID");
    }
    const createdAt = new Date(row.createdAt as string | Date);
    if (!Number.isFinite(createdAt.getTime()) || !Number.isInteger(row.progress) || Number(row.progress) < 0 || Number(row.progress) > 100) researchError("PRECONDITION_FAILED", "COMPETITOR_RESEARCH_BINDING_INVALID");
    return { ...row, input, createdAt } as CompetitorResearchJobRow;
  }
  function receiptFor(runId: string, input: CompetitorResearchStoredInput) {
    return { runId, analysisId: input.binding.analysisId, sourceHash: input.binding.sourceHash, analysisHash: input.checkpoint.analysisHash,
      summaryVersion: input.checkpoint.committedVersion, artifactId: `research_${researchHash(runId)}` };
  }
  async function job(runId: string) { const found = await rows("SELECT * FROM ai_jobs WHERE runId=? FOR UPDATE", [runId]); return found[0] ? decode(found[0]) : null; }
  function assertLease(row: CompetitorResearchJobRow, lease: CompetitorResearchLease) {
    if (lease.signal.aborted || row.runId !== lease.runId || row.status !== "running" || !lease.lockedBy || row.lockedBy !== lease.lockedBy || row.attempt !== lease.attempt
      || !Number.isSafeInteger(lease.attempt) || lease.attempt < 1 || !row.leaseUntil || !(new Date(row.leaseUntil).getTime() > Date.now())) researchError("CONFLICT", "COMPETITOR_RESEARCH_LEASE_LOST");
  }
  return {
    executor, rows, job, assertLease,
    async user(userId: number) { return (await rows("SELECT * FROM users WHERE id=? FOR SHARE", [userId]))[0] ?? null; },
    async target(projectId: number) { return (await rows("SELECT * FROM projects WHERE id=? FOR UPDATE", [projectId]))[0] ?? null; },
    async analysis(projectId: number, analysisId: number): Promise<CompetitorAnalysis | null> {
      const found = await rows("SELECT * FROM competitorAnalyses WHERE projectId=? AND id=? FOR UPDATE", [projectId, analysisId]);
      if (!found[0]) return null;
      const result = found[0] as CompetitorAnalysis;
      competitorRevision(result);
      return result;
    },
    async agent(input: CompetitorResearchStoredInput, allowCanceled = false) {
      const b = input.binding;
      const agents = await rows("SELECT runId,agentSlug,userId,workspaceId,projectId,status FROM emperor_agent_runs WHERE runId=? FOR SHARE", [input.agentRunId]);
      const nodes = await rows("SELECT runId,nodeId,workspaceId,status FROM emperor_agent_checkpoints WHERE runId=? AND nodeId='N1' FOR SHARE", [input.agentRunId]);
      if (agents.length !== 1 || agents[0].runId !== input.agentRunId || agents[0].agentSlug !== "listing.full.workflow" || agents[0].userId !== b.userId || agents[0].workspaceId !== b.workspaceId || agents[0].projectId !== b.projectId
        || nodes.length !== 1 || nodes[0].runId !== input.agentRunId || nodes[0].nodeId !== "N1" || nodes[0].workspaceId !== b.workspaceId) researchError("PRECONDITION_FAILED", "COMPETITOR_RESEARCH_AGENT_INVALID");
      const canceled = agents[0].status === "canceled" || nodes[0].status === "canceled";
      if (canceled && !allowCanceled) researchError("CONFLICT", "COMPETITOR_RESEARCH_AGENT_CANCELED");
      return { canceled };
    },
    async list(userId: number, workspaceId: number | null, projectId: number) {
      return (await rows("SELECT * FROM ai_jobs WHERE userId=? AND workspaceId<=>? AND projectId=? AND kind=? ORDER BY id DESC LIMIT 100 FOR SHARE", [userId, workspaceId, projectId, COMPETITOR_RESEARCH_JOB_KIND])).map(decode);
    },
    async reserve(input: CompetitorResearchStoredInput) {
      decodeCompetitorResearchInput(input);
      const b = input.binding, runId = competitorResearchRunId(b);
      await write("INSERT INTO ai_jobs (runId,kind,module,`procedure`,workspaceId,userId,projectId,skillSlug,input,status,progress,queueName,attempt,maxAttempts,timeoutSeconds) VALUES (?,?,?,?,?,?,?,?,?,'queued',0,'analysis',0,1,600)",
        [runId, COMPETITOR_RESEARCH_JOB_KIND, "listing", "analysis.startCompetitorResearchJob", b.workspaceId, b.userId, b.projectId, "listing.competitor.analyze", JSON.stringify(input)]);
      const created = await job(runId);
      if (!created || !isDeepStrictEqual(created.input, input)) researchError("CONFLICT", "COMPETITOR_RESEARCH_RESERVE_READBACK_FAILED");
      return created;
    },
    async checkpoint(row: CompetitorResearchJobRow, input: CompetitorResearchStoredInput, lease: CompetitorResearchLease) {
      assertLease(row, lease); decodeCompetitorResearchInput(input);
      if (!isDeepStrictEqual({ ...input, checkpoint: null }, { ...row.input, checkpoint: null })
        || !((row.input.checkpoint.stage === "reserved" && input.checkpoint.stage === "model_dispatched")
          || (row.input.checkpoint.stage === "model_dispatched" && input.checkpoint.stage === "analysis_ready"
            && isDeepStrictEqual(row.input.checkpoint.skillSnapshot, input.checkpoint.skillSnapshot)))) researchError("CONFLICT", "COMPETITOR_RESEARCH_STAGE_CHANGED");
      await write("UPDATE ai_jobs SET input=?,updatedAt=CURRENT_TIMESTAMP WHERE runId=? AND status='running' AND lockedBy=? AND attempt=? AND leaseUntil>CURRENT_TIMESTAMP", [JSON.stringify(input), row.runId, lease.lockedBy, lease.attempt]);
      const saved = await job(row.runId);
      if (!saved || !isDeepStrictEqual(saved.input, input)) researchError("CONFLICT", "COMPETITOR_RESEARCH_CHECKPOINT_READBACK_FAILED");
      assertLease(saved, lease); return saved;
    },
    async resume(row: CompetitorResearchJobRow) {
      if (!["failed", "canceled"].includes(row.status) || !["reserved", "analysis_ready"].includes(row.input.checkpoint.stage)) researchError("PRECONDITION_FAILED", "COMPETITOR_RESEARCH_RESUME_UNSAFE");
      await write("UPDATE ai_jobs SET status='queued',progress=?,errorMessage=NULL,lockedBy=NULL,leaseUntil=NULL,nextRunAt=NULL,completedAt=NULL,deadLetterAt=NULL,deadLetterReason=NULL,updatedAt=CURRENT_TIMESTAMP WHERE runId=? AND status=?", [row.input.checkpoint.stage === "analysis_ready" ? 70 : 0, row.runId, row.status]);
      const saved = await job(row.runId);
      if (!saved || saved.status !== "queued" || !isDeepStrictEqual(saved.input, row.input)) researchError("CONFLICT", "COMPETITOR_RESEARCH_RESUME_READBACK_FAILED");
      return saved;
    },
    async cancel(row: CompetitorResearchJobRow) {
      if (row.status === "succeeded" || row.status === "canceled") return row;
      await write("UPDATE ai_jobs SET status='canceled',errorMessage='COMPETITOR_RESEARCH_CANCELED',lockedBy=NULL,leaseUntil=NULL,completedAt=CURRENT_TIMESTAMP,updatedAt=CURRENT_TIMESTAMP WHERE runId=? AND status=?", [row.runId, row.status]);
      const saved = await job(row.runId);
      if (!saved || saved.status !== "canceled" || !isDeepStrictEqual(saved.input, row.input)) researchError("CONFLICT", "COMPETITOR_RESEARCH_CANCEL_READBACK_FAILED");
      return saved;
    },
    async commit(row: CompetitorResearchJobRow, current: CompetitorAnalysis, lease: CompetitorResearchLease, actorRole: string) {
      assertLease(row, lease);
      const b = row.input.binding, cp = row.input.checkpoint;
      if (current.id !== b.analysisId || current.projectId !== b.projectId || competitorRevision(current) !== row.input.expectedRevision || current.summaryStatus === "confirmed") researchError("CONFLICT", "COMPETITOR_RESEARCH_RECORD_CHANGED");
      if (cp.stage !== "analysis_ready" || !cp.analysisJson || !cp.analysisHash || !cp.summary || !cp.skillRunId) researchError("PRECONDITION_FAILED", "COMPETITOR_RESEARCH_RESULT_MISSING");
      if (current.summaryVersion >= 2147483647 || !actorRole || actorRole.length > 64) researchError("PRECONDITION_FAILED", "COMPETITOR_RESEARCH_RECORD_INVALID");
      const prior = current.rawData?.trim() ? JSON.parse(current.rawData) : {};
      if (!prior || typeof prior !== "object" || Array.isArray(prior)) researchError("PRECONDITION_FAILED", "COMPETITOR_RESEARCH_SOURCE_INVALID");
      const analysis = JSON.parse(cp.analysisJson), raw = { ...prior };
      // Consumers still read these exact legacy top-level output fields. Replace
      // or remove them together; never combine a new summary with old advantages.
      for (const key of ["titleAnalysis", "bulletPointsAnalysis", "keywords", "advantages", "weaknesses", "summary", "competitivePositioning"]) {
        delete raw[key];
        if (Object.hasOwn(analysis, key)) raw[key] = analysis[key];
      }
      const rawData = encodeResearchJson({ ...raw, analysis, research: { version: 1, kind: "legacy_competitor_analysis", deepResearchComplete: false,
        sourceHash: b.sourceHash, jobRunId: row.runId, skillRunId: cp.skillRunId },
      ...(Object.hasOwn(prior, "deepAnalysis") && prior.deepAnalysis !== null ? { deepAnalysisStale: true } : {}), analysisStale: false, captureOnly: false });
      const summary = current.summary?.trim() && current.summary !== current.aiSummary ? current.summary : cp.summary;
      const version = current.summaryVersion + 1;
      await write("UPDATE competitorAnalyses SET aiSummary=?,summary=?,keywords=?,rawData=?,summaryVersion=?,updatedAt=CURRENT_TIMESTAMP WHERE id=? AND projectId=? AND summaryStatus='draft' AND summaryVersion=?",
        [cp.summary, summary, cp.keywordsJson, rawData, version, b.analysisId, b.projectId, current.summaryVersion]);
      const metadata = { sourceHash: b.sourceHash, expectedRevision: row.input.expectedRevision, agentRunId: row.input.agentRunId, agentNodeId: "N1", summaryVersion: version, reviewRequired: true, skillSnapshot: cp.skillSnapshot };
      const artifactId = `research_${researchHash(row.runId)}`;
      // A draft result is immutable evidence, not an automatic current/confirmed selection.
      await write("INSERT INTO ai_artifacts (workspaceId,artifactId,domain,artifactKey,artifactType,sourceType,sourceId,sourceTable,sourceRowId,runId,agentSlug,nodeId,projectId,userId,status,version,isCurrent,contentJson,contentHash,mimeType,fileSizeBytes,retentionClass,metadata,sourceSkillRunId,sourceAiJobRunId) VALUES (?,?,'listing',?,'json','ai_output',?,'competitorAnalyses',?,NULL,NULL,NULL,?,?,'draft',?,0,?,?,'application/json',?,'hot',?,?,?)",
        [b.workspaceId, artifactId, `listing.competitor_analysis.${b.asin}`, String(b.analysisId), String(b.analysisId), b.projectId, b.userId, version, cp.analysisJson, cp.analysisHash, Buffer.byteLength(cp.analysisJson, "utf8"), JSON.stringify(metadata), cp.skillRunId, row.runId]);
      const auditId = `research_audit_${researchHash(row.runId)}`;
      const after = { analysisId: b.analysisId, sourceHash: b.sourceHash, analysisHash: cp.analysisHash, summaryVersion: version };
      await write("INSERT INTO security_audit_logs (auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,projectId,agentRunId,toolSlug,status,riskLevel,afterSnapshot,metadata) VALUES (?,?,?,?,'analysis.research','project',?,?,?,'listing.competitor.analyze','success','medium',?,?)",
        [auditId, b.workspaceId, b.userId, actorRole, String(b.analysisId), b.projectId, row.input.agentRunId, JSON.stringify(after), JSON.stringify({ jobRunId: row.runId, skillRunId: cp.skillRunId, reviewRequired: true })]);
      const input: CompetitorResearchStoredInput = { ...row.input, checkpoint: { ...cp, stage: "analysis_committed", committedVersion: version } };
      assertLease(row, lease);
      await write("UPDATE ai_jobs SET input=?,output=?,status='succeeded',progress=100,errorMessage=NULL,completedAt=CURRENT_TIMESTAMP,leaseUntil=NULL,lockedBy=NULL,updatedAt=CURRENT_TIMESTAMP WHERE runId=? AND status='running' AND lockedBy=? AND attempt=? AND leaseUntil>CURRENT_TIMESTAMP",
        [JSON.stringify(input), JSON.stringify(receiptFor(row.runId, input)), row.runId, lease.lockedBy, lease.attempt]);
      const completed = await job(row.runId);
      if (!completed || !isDeepStrictEqual(completed.input, input)) researchError("CONFLICT", "COMPETITOR_RESEARCH_RECEIPT_INVALID");
      const updated = await rows("SELECT * FROM competitorAnalyses WHERE projectId=? AND id=? FOR UPDATE", [b.projectId, b.analysisId]);
      const expected = { ...current, aiSummary: cp.summary, summary, keywords: cp.keywordsJson, rawData, summaryVersion: version };
      if (updated.length !== 1 || !isDeepStrictEqual({ ...updated[0], updatedAt: current.updatedAt }, expected)) researchError("CONFLICT", "COMPETITOR_RESEARCH_ANALYSIS_READBACK_FAILED");
      const artifacts = await rows("SELECT *,CAST(contentJson AS CHAR CHARACTER SET utf8mb4) AS contentJsonText FROM ai_artifacts WHERE sourceAiJobRunId=? FOR SHARE", [row.runId]);
      const artifact = artifacts[0];
      if (artifacts.length !== 1 || artifact.artifactId !== artifactId || artifact.sourceTable !== "competitorAnalyses" || artifact.sourceRowId !== String(b.analysisId)
        || artifact.workspaceId !== b.workspaceId || artifact.projectId !== b.projectId || artifact.userId !== b.userId || artifact.status !== "draft" || artifact.isCurrent !== 0 || artifact.version !== version
        || artifact.domain !== "listing" || artifact.artifactKey !== `listing.competitor_analysis.${b.asin}` || artifact.artifactType !== "json" || artifact.sourceType !== "ai_output"
        || artifact.runId !== null || artifact.nodeId !== null || artifact.contentHash !== cp.analysisHash || artifact.sourceSkillRunId !== cp.skillRunId
        || !isDeepStrictEqual(JSON.parse(String(artifact.contentJsonText)), JSON.parse(cp.analysisJson))) researchError("CONFLICT", "COMPETITOR_RESEARCH_ARTIFACT_READBACK_FAILED");
      const audits = await rows("SELECT *,CAST(afterSnapshot AS CHAR CHARACTER SET utf8mb4) AS afterSnapshotText FROM security_audit_logs WHERE auditId=? FOR SHARE", [auditId]);
      if (audits.length !== 1 || audits[0].workspaceId !== b.workspaceId || audits[0].actorUserId !== b.userId || audits[0].actorRole !== actorRole || audits[0].action !== "analysis.research" || audits[0].resourceId !== String(b.analysisId)
        || !isDeepStrictEqual(JSON.parse(String(audits[0].afterSnapshotText)), after)) researchError("CONFLICT", "COMPETITOR_RESEARCH_AUDIT_READBACK_FAILED");
      assertLease(row, lease);
      return completed;
    },
  };
}
export type CompetitorResearchSession = ReturnType<typeof competitorResearchSession>;
export function createCompetitorResearchJobRepository(database: () => Promise<CompetitorResearchDatabase | null> = getDb) {
  return { async transaction<T>(callback: (session: CompetitorResearchSession) => Promise<T>) {
    const db = await database();
    if (!db || typeof db.transaction !== "function") researchError("PRECONDITION_FAILED", "COMPETITOR_RESEARCH_TRANSACTION_REQUIRED");
    try { return await db.transaction(tx => callback(competitorResearchSession(tx))); } catch (error) { return storageError(error); }
  } };
}
export const competitorResearchJobRepository = createCompetitorResearchJobRepository();
