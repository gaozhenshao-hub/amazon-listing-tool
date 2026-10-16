import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { PROFILE_IMPORT_JOB_KIND } from "../../../shared/profileImportJob";
import { getDb, type DbExecutor } from "../dbClient";

const id = z.number().int().positive().safe();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const profileImportBindingSchema = z.object({
  version: z.literal(1), userId: id, workspaceId: id.nullable(), listingProjectId: id,
  devProjectId: id, profileId: id, sourceHash: hash, converterVersion: z.literal(1),
}).strict();
const checkpointSchema = z.object({
  stage: z.enum(["reserved", "model_dispatched", "analysis_ready", "file_committed"]),
  analysisJson: z.string().nullable(), analysisHash: hash.nullable(), fileId: id.nullable(),
  skillRunId: z.string().min(1).max(80).nullable(),
}).strict();
const storedSchema = z.object({
  version: z.literal(1), binding: profileImportBindingSchema, checkpoint: checkpointSchema,
  agentRunId: z.string().min(1).max(80), agentNodeId: z.literal("N3"),
}).strict();
export type ProfileImportBinding = z.infer<typeof profileImportBindingSchema>;
export type ProfileImportStoredInput = z.infer<typeof storedSchema>;
export type ProfileImportJobRow = Record<string, unknown> & {
  runId: string; kind: string; module: string; workspaceId: number | null; userId: number;
  projectId: number; status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  progress: number; attempt: number; lockedBy: string | null; leaseUntil: Date | string | null;
  input: ProfileImportStoredInput; createdAt: Date;
};
export type ProfileImportLease = { runId: string; attempt: number; lockedBy: string; signal: AbortSignal };
export interface ProfileImportDatabase {
  execute(statement: SQL): Promise<unknown>;
  transaction?<T>(callback: (tx: DbExecutor) => Promise<T>): Promise<T>;
}

export function profileImportError(code: "CONFLICT" | "PRECONDITION_FAILED" | "NOT_FOUND" | "FORBIDDEN" | "INTERNAL_SERVER_ERROR", message: string): never {
  throw new TRPCError({ code, message });
}
export const profileImportHash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** Reject lossy JSON (including getters/toJSON), rather than silently storing a different result. */
export function encodeProfileImportJson(value: unknown, maximum = 65535): string {
  const ancestors = new Set<object>();
  function visit(item: unknown, depth: number): void {
    if (depth > 64) profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_JSON_INVALID");
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "string") {
      if (Buffer.from(item, "utf8").toString("utf8") !== item) profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_JSON_INVALID");
      return;
    }
    if (typeof item === "number" && Number.isFinite(item) && Math.abs(item) <= Number.MAX_SAFE_INTEGER && !Object.is(item, -0)) return;
    if (!item || typeof item !== "object" || ancestors.has(item)) profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_JSON_INVALID");
    const array = Array.isArray(item);
    if (!array && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_JSON_INVALID");
    const keys = Reflect.ownKeys(item);
    if (array && keys.length !== item.length + 1) profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_JSON_INVALID");
    ancestors.add(item);
    for (const key of keys) {
      if (array && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (typeof key !== "string" || !descriptor.enumerable || !("value" in descriptor)
        || (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length))) profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_JSON_INVALID");
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(item);
  }
  visit(value, 0);
  const result = JSON.stringify(value);
  if (Buffer.byteLength(result, "utf8") > maximum) profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_TEXT_TOO_LARGE");
  return result;
}

export function profileImportRunId(binding: ProfileImportBinding): string {
  const b = profileImportBindingSchema.parse(binding);
  return `profile_${profileImportHash(JSON.stringify(b))}`;
}
export function decodeProfileImportInput(value: unknown): ProfileImportStoredInput {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    encodeProfileImportJson(parsed, 256 * 1024);
    const input = storedSchema.parse(parsed);
    const cp = input.checkpoint;
    const ready = cp.stage === "analysis_ready" || cp.stage === "file_committed";
    if (ready) {
      if (cp.analysisJson === null || cp.analysisHash !== profileImportHash(cp.analysisJson) || !cp.skillRunId) throw new Error();
      const analysis = JSON.parse(cp.analysisJson);
      if (!analysis || typeof analysis !== "object" || Array.isArray(analysis) || encodeProfileImportJson(analysis) !== cp.analysisJson) throw new Error();
    } else if (cp.analysisJson !== null || cp.analysisHash !== null || cp.skillRunId !== null) throw new Error();
    if ((cp.stage === "file_committed") !== (cp.fileId !== null)) throw new Error();
    return input;
  } catch { return profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_CHECKPOINT_INVALID"); }
}
function statement(text: string, values: unknown[]): SQL {
  const parts = text.split("?");
  if (parts.length !== values.length + 1) throw new Error("PROFILE_IMPORT_SQL_BIND_MISMATCH");
  return sql.join(parts.flatMap((part, i) => i < values.length ? [sql.raw(part), sql`${values[i]}`] : [sql.raw(part)]), sql.raw(""));
}
function storageFailure(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  let current = error;
  for (let i = 0; i < 5 && current && typeof current === "object"; i++) {
    const e = current as { errno?: number; code?: string; cause?: unknown };
    if (e.errno === 1062 || e.errno === 1213) profileImportError("CONFLICT", "PROFILE_IMPORT_STORAGE_CONFLICT");
    if (e.errno === 1146 || e.errno === 1054) profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_SCHEMA_UNAVAILABLE");
    current = e.cause;
  }
  return profileImportError("INTERNAL_SERVER_ERROR", "PROFILE_IMPORT_STORAGE_FAILED");
}

export function profileImportSession(executor: DbExecutor) {
  function assertLease(row: ProfileImportJobRow, lease: ProfileImportLease) {
    if (lease.signal.aborted || row.runId !== lease.runId || row.status !== "running" || row.lockedBy !== lease.lockedBy
      || !lease.lockedBy || row.attempt !== lease.attempt || !Number.isSafeInteger(lease.attempt) || lease.attempt < 1
      || !row.leaseUntil || !(new Date(row.leaseUntil).getTime() > Date.now())) profileImportError("CONFLICT", "PROFILE_IMPORT_LEASE_LOST");
  }
  async function execute(text: string, params: unknown[] = []): Promise<unknown> {
    try { return await executor.execute(statement(text, params)); } catch (error) { return storageFailure(error); }
  }
  async function rows(text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    const result = await execute(text, params);
    if (!Array.isArray(result) || !Array.isArray(result[0])) profileImportError("INTERNAL_SERVER_ERROR", "PROFILE_IMPORT_READ_INVALID");
    return result[0];
  }
  async function write(text: string, params: unknown[]) {
    const result = await execute(text, params);
    const header = Array.isArray(result) ? result[0] as { affectedRows?: number; insertId?: number; warningStatus?: number } : null;
    if (header?.affectedRows !== 1 || header.warningStatus !== 0) profileImportError("CONFLICT", "PROFILE_IMPORT_WRITE_NOT_ACKNOWLEDGED");
    return header;
  }
  function decode(row: Record<string, unknown>): ProfileImportJobRow {
    const input = decodeProfileImportInput(row.input), b = input.binding;
    if (row.kind !== PROFILE_IMPORT_JOB_KIND || row.module !== "listing" || row.runId !== profileImportRunId(b)
      || row.userId !== b.userId || row.workspaceId !== b.workspaceId || row.projectId !== b.listingProjectId
      || !["queued", "running", "succeeded", "failed", "canceled"].includes(String(row.status))) profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_JOB_BINDING_INVALID");
    if ((row.status === "succeeded") !== (input.checkpoint.stage === "file_committed")) profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_RECEIPT_INVALID");
    if (input.checkpoint.stage === "file_committed") {
      let output: unknown;
      try { output = typeof row.output === "string" ? JSON.parse(row.output) : row.output; } catch { profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_RECEIPT_INVALID"); }
      const expected = { runId: row.runId, fileId: input.checkpoint.fileId, sourceHash: b.sourceHash, analysisHash: input.checkpoint.analysisHash };
      if (!output || typeof output !== "object" || Object.keys(output).length !== 4
        || Object.entries(expected).some(([key, value]) => (output as Record<string, unknown>)[key] !== value)) profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_RECEIPT_INVALID");
    }
    return { ...row, input, createdAt: new Date(row.createdAt as string | Date) } as ProfileImportJobRow;
  }
  async function job(runId: string) {
    const result = await rows("SELECT * FROM ai_jobs WHERE runId=? FOR UPDATE", [runId]);
    return result[0] ? decode(result[0]) : null;
  }
  async function checkpoint(row: ProfileImportJobRow, input: ProfileImportStoredInput, lease: ProfileImportLease) {
    assertLease(row, lease);
    decodeProfileImportInput(input);
    await write("UPDATE ai_jobs SET input=?,updatedAt=CURRENT_TIMESTAMP WHERE runId=? AND status='running' AND lockedBy=? AND attempt=? AND leaseUntil>CURRENT_TIMESTAMP", [JSON.stringify(input), row.runId, lease.lockedBy, lease.attempt]);
    const updated = await job(row.runId);
    if (!updated || !isDeepStrictEqual(updated.input, input)) profileImportError("CONFLICT", "PROFILE_IMPORT_CHECKPOINT_READBACK_FAILED");
    assertLease(updated, lease);
    return updated;
  }
  return {
    executor, rows, job,
    async user(userId: number) { return (await rows("SELECT * FROM users WHERE id=? FOR SHARE", [userId]))[0] ?? null; },
    async target(projectId: number) { return (await rows("SELECT * FROM projects WHERE id=? FOR SHARE", [projectId]))[0] ?? null; },
    async assertAgent(input: ProfileImportStoredInput, options: { allowCanceledRead?: boolean } = {}) {
      const b = input.binding;
      const agents = await rows("SELECT runId,agentSlug,userId,workspaceId,projectId,status FROM emperor_agent_runs WHERE runId=? FOR SHARE", [input.agentRunId]);
      const nodes = await rows("SELECT runId,nodeId,workspaceId,status FROM emperor_agent_checkpoints WHERE runId=? AND nodeId='N3' FOR SHARE", [input.agentRunId]);
      if (agents.length !== 1 || agents[0].runId !== input.agentRunId || agents[0].agentSlug !== "listing.full.workflow" || agents[0].userId !== b.userId
        || agents[0].workspaceId !== b.workspaceId || agents[0].projectId !== b.listingProjectId
        || nodes.length !== 1 || nodes[0].runId !== input.agentRunId || nodes[0].nodeId !== "N3" || nodes[0].workspaceId !== b.workspaceId) profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_AGENT_BINDING_INVALID");
      const canceled = agents[0].status === "canceled" || nodes[0].status === "canceled";
      if (canceled && !options.allowCanceledRead) profileImportError("CONFLICT", "PROFILE_IMPORT_AGENT_CANCELED");
      return { canceled };
    },
    async list(userId: number, workspaceId: number | null, projectId: number) {
      return (await rows("SELECT * FROM ai_jobs WHERE userId=? AND workspaceId<=>? AND projectId=? AND kind=? ORDER BY id DESC LIMIT 50 FOR SHARE", [userId, workspaceId, projectId, PROFILE_IMPORT_JOB_KIND])).map(decode);
    },
    async reserve(input: ProfileImportStoredInput) {
      decodeProfileImportInput(input);
      const b = input.binding, runId = profileImportRunId(b);
      await write("INSERT INTO ai_jobs (runId,kind,module,`procedure`,workspaceId,userId,projectId,skillSlug,input,status,progress,queueName,attempt,maxAttempts,timeoutSeconds) VALUES (?,?,?,?,?,?,?,?,?,'queued',0,'analysis',0,1,600)",
        [runId, PROFILE_IMPORT_JOB_KIND, "listing", "projectFile.startProfileImportJob", b.workspaceId, b.userId, b.listingProjectId, "analysis.rufus.attribute", JSON.stringify(input)]);
      const created = await job(runId);
      if (!created) profileImportError("INTERNAL_SERVER_ERROR", "PROFILE_IMPORT_JOB_MISSING");
      return created;
    },
    assertLease,
    checkpoint,
    async resume(row: ProfileImportJobRow) {
      if (!["failed", "canceled"].includes(row.status) || !["reserved", "analysis_ready"].includes(row.input.checkpoint.stage)) profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_RESUME_UNSAFE");
      await write("UPDATE ai_jobs SET status='queued',progress=?,errorMessage=NULL,lockedBy=NULL,leaseUntil=NULL,nextRunAt=NULL,completedAt=NULL,deadLetterAt=NULL,deadLetterReason=NULL,updatedAt=CURRENT_TIMESTAMP WHERE runId=?", [row.input.checkpoint.stage === "analysis_ready" ? 70 : 0, row.runId]);
      return (await job(row.runId))!;
    },
    async commitFile(row: ProfileImportJobRow, rawContent: string, parsedData: unknown, lease: ProfileImportLease, actorRole: string) {
      assertLease(row, lease);
      if (!actorRole || actorRole.length > 64) profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_ACTOR_CHANGED");
      const b = row.input.binding, cp = row.input.checkpoint;
      if (cp.stage !== "analysis_ready" || !cp.analysisJson || !cp.analysisHash) profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_RESULT_MISSING");
      const parsedJson = encodeProfileImportJson(parsedData, 65535);
      if (Buffer.byteLength(rawContent, "utf8") > 1024 * 1024) profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_TEXT_TOO_LARGE");
      const rawJson = encodeProfileImportJson(rawContent, 2 * 1024 * 1024);
      const rawHash = profileImportHash(rawJson), parsedHash = profileImportHash(parsedJson);
      const filename = `产品画像导入_${b.devProjectId}_${b.profileId}.txt`;
      const header = await write("INSERT INTO projectFiles (workspaceId,projectId,userId,fileType,filename,fileUrl,fileSize,rawContentHash,parsedDataHash,rawContent,parsedData,analysisResult,status,errorMessage) VALUES (?,?,?,'product_attributes',?,'',?,?,?,?,?,?,'completed',NULL)",
        [b.workspaceId, b.listingProjectId, b.userId, filename, Buffer.byteLength(rawContent, "utf8"), rawHash, parsedHash, Array.from(rawContent).slice(0, 4000).join(""), parsedJson, cp.analysisJson]);
      const fileId = header.insertId;
      if (!Number.isSafeInteger(fileId) || !fileId || fileId < 1) profileImportError("INTERNAL_SERVER_ERROR", "PROFILE_IMPORT_FILE_ID_INVALID");
      const artifactIds: string[] = [];
      for (const [suffix, type, content, contentHash, sourceType] of [
        ["raw", "text", rawJson, rawHash, "import"], ["parsed", "json", parsedJson, parsedHash, "import"],
        ["analysis", "json", cp.analysisJson, cp.analysisHash, "ai_output"],
      ]) {
        const artifactId = `profile_${profileImportHash(`${row.runId}:${suffix}`)}`;
        artifactIds.push(artifactId);
        // projectFiles artifacts keep the legacy NULL run/node scope. Agent identity
        // belongs to provenance, not a second current-version namespace.
        await write("INSERT INTO ai_artifacts (workspaceId,artifactId,domain,artifactKey,artifactType,sourceType,sourceId,sourceTable,sourceRowId,runId,agentSlug,nodeId,projectId,userId,status,version,isCurrent,selectedBy,contentJson,contentHash,mimeType,fileName,fileSizeBytes,retentionClass,metadata,sourceSkillRunId,sourceAiJobRunId) VALUES (?,?,'listing',?,?,?,?, 'projectFiles',?,?, NULL,NULL,?,?,'final',1,1,?,?,?,?,?,?,'hot',?,?,?)",
          [b.workspaceId, artifactId, `project_file.product_attributes.${suffix}`, type, sourceType, String(fileId), String(fileId), null,
            b.listingProjectId, b.userId, b.userId, content, contentHash, type === "text" ? "text/plain" : "application/json", filename,
            Buffer.byteLength(content, "utf8"), JSON.stringify({ role: suffix === "raw" ? "raw_upload" : suffix === "parsed" ? "parsed_data" : "analysis_result", agentRunId: row.input.agentRunId, agentNodeId: "N3", provenance: parsedData }), cp.skillRunId, row.runId]);
      }
      await write("UPDATE projectFiles SET analysisArtifactId=? WHERE id=?", [artifactIds[2], fileId]);
      await write("INSERT INTO analysisVersions (projectFileId,userId,version,analysisResult,changeType,changeNote) VALUES (?,?,1,?,'auto_analysis','从已绑定产品画像导入')", [fileId, b.userId, cp.analysisJson]);
      const auditId = `profile_audit_${profileImportHash(row.runId)}`;
      const auditSnapshot = { fileId, devProjectId: b.devProjectId, profileId: b.profileId, sourceHash: b.sourceHash };
      const auditMetadata = { source: "product_profile_import", converterVersion: 1, factReviewRequired: true,
        aiSuggestionsIncluded: false, aiJobRunId: row.runId, skillRunId: cp.skillRunId };
      await write("INSERT INTO security_audit_logs (auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,resourceName,projectId,agentRunId,toolSlug,status,riskLevel,ipAddress,userAgent,requestId,reason,beforeSnapshot,afterSnapshot,metadata) VALUES (?,?,?,?,'file.import_from_profile','file',?,?,?,?,'analysis.rufus.attribute','success','medium',NULL,NULL,NULL,NULL,NULL,?,?)",
        [auditId, b.workspaceId, b.userId, actorRole, String(fileId), filename, b.listingProjectId, row.input.agentRunId, JSON.stringify(auditSnapshot), JSON.stringify(auditMetadata)]);
      assertLease(row, lease);
      const input = { ...row.input, checkpoint: { ...cp, stage: "file_committed" as const, fileId } };
      const receipt = { runId: row.runId, fileId, sourceHash: b.sourceHash, analysisHash: cp.analysisHash };
      await write("UPDATE ai_jobs SET input=?,output=?,status='succeeded',progress=100,errorMessage=NULL,completedAt=CURRENT_TIMESTAMP,leaseUntil=NULL,lockedBy=NULL,updatedAt=CURRENT_TIMESTAMP WHERE runId=? AND status='running' AND lockedBy=? AND attempt=? AND leaseUntil>CURRENT_TIMESTAMP", [JSON.stringify(input), JSON.stringify(receipt), row.runId, lease.lockedBy, lease.attempt]);
      const complete = await job(row.runId);
      if (!complete || complete.input.checkpoint.fileId !== fileId) profileImportError("CONFLICT", "PROFILE_IMPORT_RECEIPT_INVALID");
      const files = await rows("SELECT * FROM projectFiles WHERE id=? FOR SHARE", [fileId]);
      const expectedFile = { workspaceId: b.workspaceId, projectId: b.listingProjectId, userId: b.userId, fileType: "product_attributes",
        filename, status: "completed", rawContentHash: rawHash, parsedDataHash: parsedHash, parsedData: parsedJson,
        analysisResult: cp.analysisJson, analysisArtifactId: artifactIds[2] };
      if (files.length !== 1 || Object.entries(expectedFile).some(([key, value]) => files[0][key] !== value)) profileImportError("CONFLICT", "PROFILE_IMPORT_FILE_READBACK_FAILED");
      const artifacts = await rows("SELECT *,CAST(contentJson AS CHAR CHARACTER SET utf8mb4) AS contentJsonText FROM ai_artifacts WHERE sourceAiJobRunId=? FOR SHARE", [row.runId]);
      if (artifacts.length !== 3) profileImportError("CONFLICT", "PROFILE_IMPORT_ARTIFACT_READBACK_FAILED");
      for (const [index, content] of [rawJson, parsedJson, cp.analysisJson].entries()) {
        const artifact = artifacts.find(item => item.artifactId === artifactIds[index]);
        const suffix = ["raw", "parsed", "analysis"][index];
        const expectedArtifact = { workspaceId: b.workspaceId, domain: "listing", projectId: b.listingProjectId, userId: b.userId,
          sourceTable: "projectFiles", sourceRowId: String(fileId), sourceId: String(fileId), sourceAiJobRunId: row.runId,
          sourceSkillRunId: cp.skillRunId, runId: null, nodeId: null, artifactKey: `project_file.product_attributes.${suffix}`,
          contentHash: profileImportHash(content), status: "final", isCurrent: 1, version: 1, storageUri: null, storageObjectId: null };
        if (!artifact || Object.entries(expectedArtifact).some(([key, value]) => artifact[key] !== value)
          || typeof artifact.contentJsonText !== "string"
          || !isDeepStrictEqual(JSON.parse(artifact.contentJsonText), JSON.parse(content))) profileImportError("CONFLICT", "PROFILE_IMPORT_ARTIFACT_READBACK_FAILED");
      }
      const versions = await rows("SELECT * FROM analysisVersions WHERE projectFileId=? FOR SHARE", [fileId]);
      if (versions.length !== 1 || versions[0].version !== 1 || versions[0].userId !== b.userId || versions[0].analysisResult !== cp.analysisJson
        || versions[0].changeType !== "auto_analysis") profileImportError("CONFLICT", "PROFILE_IMPORT_VERSION_READBACK_FAILED");
      const audits = await rows("SELECT *,CAST(afterSnapshot AS CHAR CHARACTER SET utf8mb4) AS afterSnapshotText,CAST(metadata AS CHAR CHARACTER SET utf8mb4) AS metadataText FROM security_audit_logs WHERE auditId=? FOR SHARE", [auditId]);
      const expectedAudit = { auditId, workspaceId: b.workspaceId, actorUserId: b.userId, actorRole,
        action: "file.import_from_profile", resourceType: "file", resourceId: String(fileId), resourceName: filename,
        projectId: b.listingProjectId, agentRunId: row.input.agentRunId, toolSlug: "analysis.rufus.attribute", status: "success", riskLevel: "medium",
        ipAddress: null, userAgent: null, requestId: null, reason: null, beforeSnapshot: null };
      if (audits.length !== 1 || Object.entries(expectedAudit).some(([key, value]) => audits[0][key] !== value)
        || typeof audits[0].afterSnapshotText !== "string" || typeof audits[0].metadataText !== "string"
        || !isDeepStrictEqual(JSON.parse(audits[0].afterSnapshotText), auditSnapshot)
        || !isDeepStrictEqual(JSON.parse(audits[0].metadataText), auditMetadata)) profileImportError("CONFLICT", "PROFILE_IMPORT_AUDIT_READBACK_FAILED");
      assertLease(row, lease);
      return complete;
    },
  };
}
export type ProfileImportSession = ReturnType<typeof profileImportSession>;
export function createProfileImportJobRepository(database: () => Promise<ProfileImportDatabase | null> = getDb) {
  return {
    async transaction<T>(callback: (session: ProfileImportSession) => Promise<T>) {
      const db = await database();
      if (!db || typeof db.transaction !== "function") profileImportError("PRECONDITION_FAILED", "PROFILE_IMPORT_TRANSACTION_REQUIRED");
      try { return await db.transaction(tx => callback(profileImportSession(tx))); } catch (error) { return storageFailure(error); }
    },
  };
}
export const profileImportJobRepository = createProfileImportJobRepository();
