import { createHash, randomUUID } from "crypto";
import { sql as drizzleSql } from "drizzle-orm";
import { getDb } from "../../../db";
import { buildStorageUri, parseStorageUri, type StorageProvider } from "../../../storage";

export type ArtifactDomain = "listing" | "image" | "ads" | "video" | "agent" | "project" | "file" | "ops" | "tool" | "other";
export type UnifiedArtifactType = "json" | "text" | "markdown" | "html" | "image" | "file" | "table" | "video" | "audio" | "other";
export type ArtifactSourceType = "upload" | "ai_output" | "user_edit" | "import" | "tool_output" | "system" | "archive";
export type RetentionClass = "hot" | "warm" | "cold" | "archive";
export type DataArchiveMode = "count" | "archive" | "delete";

export type RegisteredArtifact = {
  id?: number;
  artifactId: string;
  ref: string;
  version: number;
  storageObjectId?: number | null;
};

export type DataLifecyclePolicy = {
  slug: string;
  tableName: string;
  idColumn: string;
  timeColumn: string;
  workspaceColumn?: string;
  lifecycleColumn?: string;
  archiveBatchColumn?: string;
  terminalWhere?: string;
  archiveAfterDays: number;
  deleteAfterDays?: number;
  archiveValue: string;
  deleteValue?: string;
  reason: string;
};

export const ARTIFACT_INLINE_LIMIT_BYTES = 12_000;

export const DATA_LIFECYCLE_POLICIES: DataLifecyclePolicy[] = [
  {
    slug: "ai_jobs.completed",
    tableName: "ai_jobs",
    idColumn: "runId",
    timeColumn: "createdAt",
    workspaceColumn: "workspaceId",
    lifecycleColumn: "retentionClass",
    archiveBatchColumn: "archiveBatchId",
    terminalWhere: "status IN ('succeeded','failed','canceled')",
    archiveAfterDays: 180,
    deleteAfterDays: 730,
    archiveValue: "archive",
    reason: "AI Job 执行记录保留 180 天热数据，之后转冷归档。",
  },
  {
    slug: "tool_runs.completed",
    tableName: "emperor_tool_runs",
    idColumn: "toolRunId",
    timeColumn: "createdAt",
    workspaceColumn: "workspaceId",
    lifecycleColumn: "retentionClass",
    archiveBatchColumn: "archiveBatchId",
    terminalWhere: "status IN ('succeeded','failed','blocked')",
    archiveAfterDays: 180,
    deleteAfterDays: 730,
    archiveValue: "archive",
    reason: "Tool Run 日志支撑审计和事故复盘，180 天后转冷。",
  },
  {
    slug: "agent_events.stream",
    tableName: "emperor_agent_events",
    idColumn: "id",
    timeColumn: "createdAt",
    workspaceColumn: "workspaceId",
    lifecycleColumn: "retentionClass",
    archiveBatchColumn: "archiveBatchId",
    archiveAfterDays: 90,
    deleteAfterDays: 365,
    archiveValue: "archive",
    reason: "Agent Event 增长最快，90 天后转冷，保留聚合指标。",
  },
  {
    slug: "ai_os_metrics.detail",
    tableName: "emperor_ai_os_metrics",
    idColumn: "id",
    timeColumn: "createdAt",
    workspaceColumn: "workspaceId",
    lifecycleColumn: "retentionClass",
    archiveBatchColumn: "archiveBatchId",
    archiveAfterDays: 365,
    deleteAfterDays: 1095,
    archiveValue: "archive",
    reason: "观测明细热数据保留一年，长期趋势由聚合报表承接。",
  },
  {
    slug: "project_files.uploads",
    tableName: "projectFiles",
    idColumn: "id",
    timeColumn: "createdAt",
    workspaceColumn: "workspaceId",
    lifecycleColumn: "lifecycleState",
    terminalWhere: "status IN ('completed','failed')",
    archiveAfterDays: 180,
    deleteAfterDays: 730,
    archiveValue: "archived",
    deleteValue: "deleted",
    reason: "原始上传和解析内容由 Storage/Artifact 承接，180 天后转冷。",
  },
  {
    slug: "ai_artifacts.versions",
    tableName: "ai_artifacts",
    idColumn: "artifactId",
    timeColumn: "createdAt",
    workspaceColumn: "workspaceId",
    lifecycleColumn: "retentionClass",
    terminalWhere: "status IN ('final','superseded','archived')",
    archiveAfterDays: 365,
    deleteAfterDays: 1095,
    archiveValue: "archive",
    reason: "统一产物版本保留较长热窗口，避免 Listing/图片复用链路断裂。",
  },
];

let lifecycleStoreAvailable = true;

function isMissingLifecycleSchema(error: unknown) {
  return /doesn't exist|unknown column|no such table|no such column/i.test(String((error as Error).message));
}

async function rawExecute(sqlStr: string, params: unknown[] = []): Promise<any[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let result: any;
  if (params.length > 0) {
    const parts = sqlStr.split("?");
    const chunks: any[] = [];
    for (let i = 0; i < parts.length; i += 1) {
      chunks.push(drizzleSql.raw(parts[i]));
      if (i < params.length) chunks.push(drizzleSql`${params[i]}`);
    }
    result = await db.execute(drizzleSql.join(chunks, drizzleSql.raw("")));
  } else {
    result = await db.execute(drizzleSql.raw(sqlStr));
  }

  const rows = Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) : [];
  return Array.isArray(rows) ? rows as any[] : [];
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value ?? "");
  }
}

function parseJson(value: unknown, fallback: unknown = null): unknown {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z0-9_]+$/.test(identifier)) {
    throw new Error(`Unsafe lifecycle identifier: ${identifier}`);
  }
  return `\`${identifier}\``;
}

function buildStableId(prefix: string, parts: unknown[]) {
  const hash = createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("|"))
    .digest("hex")
    .slice(0, 32);
  return `${prefix}_${hash}`;
}

export function createContentHash(value: unknown): string {
  return createHash("sha256").update(safeStringify(value)).digest("hex");
}

export function estimatePayloadBytes(value: unknown): number {
  return Buffer.byteLength(safeStringify(value), "utf8");
}

export function shouldInlineArtifactContent(value: unknown, limitBytes = ARTIFACT_INLINE_LIMIT_BYTES): boolean {
  return estimatePayloadBytes(value) <= limitBytes;
}

export function summarizeArtifactPayload(value: unknown, maxChars = 1000): string {
  if (typeof value === "string") return value.slice(0, maxChars);
  const record = toRecord(value);
  if (Object.keys(record).length > 0) {
    const keys = Object.keys(record).slice(0, 20).join(", ");
    const preview = safeStringify(record).slice(0, maxChars);
    return keys ? `keys: ${keys}\n${preview}` : preview;
  }
  return safeStringify(value).slice(0, maxChars);
}

function searchableText(value: unknown, maxChars = 16_000): string | null {
  if (value === undefined || value === null) return null;
  return (typeof value === "string" ? value : safeStringify(value)).slice(0, maxChars);
}

function normalizeArtifactDomain(value: unknown): ArtifactDomain {
  const normalized = String(value || "other");
  return ["listing", "image", "ads", "video", "agent", "project", "file", "ops", "tool", "other"].includes(normalized)
    ? normalized as ArtifactDomain
    : "other";
}

function normalizeArtifactType(value: unknown): UnifiedArtifactType {
  const normalized = String(value || "json");
  return ["json", "text", "markdown", "html", "image", "file", "table", "video", "audio", "other"].includes(normalized)
    ? normalized as UnifiedArtifactType
    : "json";
}

function normalizeSourceType(value: unknown): ArtifactSourceType {
  const normalized = String(value || "ai_output");
  return ["upload", "ai_output", "user_edit", "import", "tool_output", "system", "archive"].includes(normalized)
    ? normalized as ArtifactSourceType
    : "ai_output";
}

function artifactRef(artifactId: string, version: number | "current" = "current") {
  return `ai-artifact://${artifactId}@${version}`;
}

function exactNullableClause(column: string, value: unknown, params: unknown[]) {
  if (value === undefined || value === null) return `${quoteIdentifier(column)} IS NULL`;
  params.push(value);
  return `${quoteIdentifier(column)}=?`;
}

function artifactScopeWhere(input: {
  workspaceId?: number | null;
  domain: ArtifactDomain;
  artifactKey: string;
  sourceTable?: string | null;
  sourceRowId?: string | number | null;
  runId?: string | null;
  nodeId?: string | null;
}, params: unknown[]) {
  const clauses = [
    exactNullableClause("workspaceId", input.workspaceId ?? null, params),
    "`domain`=?",
    "`artifactKey`=?",
  ];
  params.push(input.domain, input.artifactKey);
  if (input.sourceTable || input.sourceRowId !== undefined) {
    clauses.push(exactNullableClause("sourceTable", input.sourceTable ?? null, params));
    clauses.push(exactNullableClause("sourceRowId", input.sourceRowId === undefined || input.sourceRowId === null ? null : String(input.sourceRowId), params));
  } else {
    clauses.push(exactNullableClause("runId", input.runId ?? null, params));
    clauses.push(exactNullableClause("nodeId", input.nodeId ?? null, params));
  }
  return clauses.join(" AND ");
}

export async function registerStorageObject(input: {
  workspaceId?: number | null;
  storageId?: string;
  provider?: StorageProvider | "external";
  bucket?: string | null;
  objectKey?: string | null;
  storageUri?: string | null;
  publicUrl?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  sizeBytes?: number | null;
  content?: unknown;
  contentHash?: string | null;
  sourceDomain?: ArtifactDomain;
  sourceType?: ArtifactSourceType;
  sourceId?: string | number | null;
  metadata?: unknown;
  createdBy?: number | null;
}) {
  if (!lifecycleStoreAvailable) return null;
  const parsedUri = input.storageUri ? parseStorageUri(input.storageUri) : null;
  const provider = input.provider || (parsedUri?.provider as StorageProvider | undefined) || "forge";
  const objectKey = input.objectKey || parsedUri?.key || input.publicUrl || "";
  if (!objectKey) return null;
  const storageUri = input.storageUri || buildStorageUri(objectKey, provider === "external" ? "external" : provider);
  const sourceDomain = normalizeArtifactDomain(input.sourceDomain);
  const sourceType = normalizeSourceType(input.sourceType || "upload");
  const storageId = input.storageId || buildStableId("stor", [
    input.workspaceId ?? "global",
    provider,
    objectKey,
    sourceDomain,
    sourceType,
    input.sourceId ?? "",
  ]);
  const contentHash = input.contentHash || (input.content === undefined ? null : createContentHash(input.content));

  try {
    await rawExecute(
      `INSERT INTO ai_storage_objects
       (workspaceId,storageId,provider,bucket,objectKey,storageUri,publicUrl,mimeType,fileName,sizeBytes,contentHash,sourceDomain,sourceType,sourceId,metadata,createdBy)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE publicUrl=VALUES(publicUrl),mimeType=VALUES(mimeType),fileName=VALUES(fileName),sizeBytes=VALUES(sizeBytes),contentHash=VALUES(contentHash),metadata=VALUES(metadata),updatedAt=NOW()`,
      [
        input.workspaceId ?? null,
        storageId,
        provider,
        input.bucket || null,
        objectKey,
        storageUri,
        input.publicUrl || null,
        input.mimeType || null,
        input.fileName || null,
        input.sizeBytes ?? null,
        contentHash,
        sourceDomain,
        sourceType,
        input.sourceId === undefined || input.sourceId === null ? null : String(input.sourceId),
        input.metadata === undefined ? null : safeStringify(input.metadata),
        input.createdBy || null,
      ],
    );
    const rows = await rawExecute("SELECT id,storageId,storageUri FROM ai_storage_objects WHERE storageId=? LIMIT 1", [storageId]);
    return rows[0] || { storageId, storageUri };
  } catch (error) {
    if (isMissingLifecycleSchema(error)) lifecycleStoreAvailable = false;
    else console.warn("[Artifact Lifecycle] Failed to register storage object:", error);
    return null;
  }
}

export async function registerUnifiedArtifact(input: {
  workspaceId?: number | null;
  artifactId?: string;
  domain?: ArtifactDomain;
  artifactKey: string;
  artifactType?: UnifiedArtifactType;
  sourceType?: ArtifactSourceType;
  sourceId?: string | number | null;
  sourceTable?: string | null;
  sourceRowId?: string | number | null;
  runId?: string | null;
  agentSlug?: string | null;
  nodeId?: string | null;
  projectId?: number | null;
  userId?: number | null;
  status?: "draft" | "final" | "superseded" | "archived" | "deleted";
  version?: number | null;
  isCurrent?: boolean;
  selectedBy?: number | null;
  content?: unknown;
  searchableText?: string | null;
  summary?: string | null;
  contentHash?: string | null;
  storageObjectId?: number | null;
  storageUri?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  fileSizeBytes?: number | null;
  retentionClass?: RetentionClass;
  metadata?: unknown;
  sourceSkillRunId?: string | null;
  sourceAiJobRunId?: string | null;
}): Promise<RegisteredArtifact | null> {
  if (!lifecycleStoreAvailable) return null;
  const domain = normalizeArtifactDomain(input.domain || "other");
  const artifactType = normalizeArtifactType(input.artifactType || "json");
  const sourceType = normalizeSourceType(input.sourceType || "ai_output");
  const status = input.status || "final";
  const isCurrent = input.isCurrent ?? status === "final";
  const contentHash = input.contentHash || createContentHash(input.content ?? input.storageUri ?? input.summary ?? null);
  const scopeParams: unknown[] = [];
  const scopeWhere = artifactScopeWhere({
    workspaceId: input.workspaceId ?? null,
    domain,
    artifactKey: input.artifactKey,
    sourceTable: input.sourceTable || null,
    sourceRowId: input.sourceRowId ?? input.sourceId ?? null,
    runId: input.runId || null,
    nodeId: input.nodeId || null,
  }, scopeParams);

  try {
    const version = input.version || Number((await rawExecute(
      `SELECT COALESCE(MAX(version),0)+1 as nextVersion FROM ai_artifacts WHERE ${scopeWhere}`,
      scopeParams,
    ))[0]?.nextVersion || 1);
    const artifactId = input.artifactId || buildStableId("art", [
      input.workspaceId ?? "global",
      domain,
      input.sourceTable || input.runId || "",
      input.sourceRowId ?? input.sourceId ?? input.nodeId ?? "",
      input.artifactKey,
      version,
    ]);

    if (isCurrent) {
      await rawExecute(
        `UPDATE ai_artifacts SET status='superseded',isCurrent=0,updatedAt=NOW() WHERE ${scopeWhere} AND isCurrent=1 AND artifactId<>?`,
        [...scopeParams, artifactId],
      );
    }

    const inlineContent = input.content !== undefined && shouldInlineArtifactContent(input.content)
      ? input.content
      : null;
    await rawExecute(
      `INSERT INTO ai_artifacts
       (workspaceId,artifactId,domain,artifactKey,artifactType,sourceType,sourceId,sourceTable,sourceRowId,runId,agentSlug,nodeId,projectId,userId,status,version,isCurrent,currentSince,selectedBy,contentJson,searchableText,summary,contentHash,storageObjectId,storageUri,mimeType,fileName,fileSizeBytes,retentionClass,archiveAfter,deleteAfter,metadata,sourceSkillRunId,sourceAiJobRunId)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,DATE_ADD(NOW(), INTERVAL 365 DAY),DATE_ADD(NOW(), INTERVAL 1095 DAY),?,?,?)
       ON DUPLICATE KEY UPDATE status=VALUES(status),isCurrent=VALUES(isCurrent),currentSince=VALUES(currentSince),selectedBy=VALUES(selectedBy),contentJson=VALUES(contentJson),searchableText=VALUES(searchableText),summary=VALUES(summary),contentHash=VALUES(contentHash),storageObjectId=VALUES(storageObjectId),storageUri=VALUES(storageUri),metadata=VALUES(metadata),updatedAt=NOW()`,
      [
        input.workspaceId ?? null,
        artifactId,
        domain,
        input.artifactKey,
        artifactType,
        sourceType,
        input.sourceId === undefined || input.sourceId === null ? null : String(input.sourceId),
        input.sourceTable || null,
        input.sourceRowId === undefined || input.sourceRowId === null ? (input.sourceId === undefined || input.sourceId === null ? null : String(input.sourceId)) : String(input.sourceRowId),
        input.runId || null,
        input.agentSlug || null,
        input.nodeId || null,
        input.projectId ?? null,
        input.userId ?? null,
        status,
        version,
        isCurrent ? 1 : 0,
        isCurrent ? new Date() : null,
        isCurrent ? input.selectedBy ?? input.userId ?? null : null,
        inlineContent === null ? null : safeStringify(inlineContent),
        input.searchableText ?? searchableText(input.content),
        input.summary || summarizeArtifactPayload(input.content ?? input.storageUri ?? null),
        contentHash,
        input.storageObjectId ?? null,
        input.storageUri || null,
        input.mimeType || null,
        input.fileName || null,
        input.fileSizeBytes ?? null,
        input.retentionClass || "hot",
        input.metadata === undefined ? null : safeStringify(input.metadata),
        input.sourceSkillRunId || null,
        input.sourceAiJobRunId || null,
      ],
    );
    const rows = await rawExecute("SELECT id,artifactId,version,storageObjectId FROM ai_artifacts WHERE artifactId=? LIMIT 1", [artifactId]);
    return {
      id: rows[0]?.id,
      artifactId,
      version,
      storageObjectId: rows[0]?.storageObjectId ?? input.storageObjectId ?? null,
      ref: artifactRef(artifactId, "current"),
    };
  } catch (error) {
    if (isMissingLifecycleSchema(error)) lifecycleStoreAvailable = false;
    else console.warn("[Artifact Lifecycle] Failed to register artifact:", error);
    return null;
  }
}

function projectFileArtifactType(fileType: string): UnifiedArtifactType {
  return fileType === "search_term_report" || fileType === "aba_keywords" ? "table" : "text";
}

function normalizeMaybeJson(value: unknown): unknown {
  if (typeof value === "string") return parseJson(value, value);
  return value;
}

export async function registerProjectFileArtifactBundle(input: {
  workspaceId?: number | null;
  projectId: number;
  userId: number;
  projectFileId: number;
  fileType: string;
  filename: string;
  fileSizeBytes?: number | null;
  rawStorageUri?: string | null;
  parsedStorageUri?: string | null;
  fileUrl?: string | null;
  rawContent?: string | null;
  parsedData?: unknown;
  analysisResult?: unknown;
  analysisSourceType?: ArtifactSourceType;
  changeNote?: string | null;
}) {
  const sourceId = String(input.projectFileId);
  const rawHash = input.rawContent ? createContentHash(input.rawContent) : null;
  const parsedData = normalizeMaybeJson(input.parsedData);
  const parsedHash = input.parsedData === undefined || input.parsedData === null ? null : createContentHash(parsedData);
  const rawStorageUri = input.rawStorageUri || null;
  const rawStorage = rawStorageUri || input.fileUrl
    ? await registerStorageObject({
      workspaceId: input.workspaceId ?? null,
      storageUri: rawStorageUri || null,
      objectKey: rawStorageUri ? parseStorageUri(rawStorageUri)?.key || rawStorageUri : input.fileUrl,
      publicUrl: input.fileUrl || null,
      mimeType: "application/octet-stream",
      fileName: input.filename,
      sizeBytes: input.fileSizeBytes ?? null,
      contentHash: rawHash,
      sourceDomain: "listing",
      sourceType: "upload",
      sourceId,
      metadata: { fileType: input.fileType },
      createdBy: input.userId,
    })
    : null;

  const rawArtifact = input.rawContent || rawStorageUri || input.fileUrl
    ? await registerUnifiedArtifact({
      workspaceId: input.workspaceId ?? null,
      domain: "listing",
      artifactKey: `project_file.${input.fileType}.raw`,
      artifactType: projectFileArtifactType(input.fileType),
      sourceType: "upload",
      sourceId,
      sourceTable: "projectFiles",
      sourceRowId: sourceId,
      projectId: input.projectId,
      userId: input.userId,
      content: input.rawContent || null,
      contentHash: rawHash,
      storageObjectId: rawStorage?.id ?? null,
      storageUri: rawStorageUri || input.fileUrl || null,
      mimeType: "text/plain",
      fileName: input.filename,
      fileSizeBytes: input.fileSizeBytes ?? null,
      retentionClass: "warm",
      metadata: { fileType: input.fileType, role: "raw_upload" },
    })
    : null;

  const parsedArtifact = input.parsedData !== undefined && input.parsedData !== null
    ? await registerUnifiedArtifact({
      workspaceId: input.workspaceId ?? null,
      domain: "listing",
      artifactKey: `project_file.${input.fileType}.parsed`,
      artifactType: input.fileType === "search_term_report" || input.fileType === "aba_keywords" ? "table" : "json",
      sourceType: "import",
      sourceId,
      sourceTable: "projectFiles",
      sourceRowId: sourceId,
      projectId: input.projectId,
      userId: input.userId,
      content: parsedData,
      contentHash: parsedHash,
      storageUri: input.parsedStorageUri || null,
      mimeType: "application/json",
      fileName: `${input.filename}.parsed.json`,
      retentionClass: "warm",
      metadata: { fileType: input.fileType, role: "parsed_data" },
    })
    : null;

  const analysisArtifact = input.analysisResult !== undefined && input.analysisResult !== null
    ? await registerUnifiedArtifact({
      workspaceId: input.workspaceId ?? null,
      domain: "listing",
      artifactKey: `project_file.${input.fileType}.analysis`,
      artifactType: "json",
      sourceType: input.analysisSourceType || "ai_output",
      sourceId,
      sourceTable: "projectFiles",
      sourceRowId: sourceId,
      projectId: input.projectId,
      userId: input.userId,
      content: normalizeMaybeJson(input.analysisResult),
      retentionClass: "hot",
      metadata: {
        fileType: input.fileType,
        role: "analysis_result",
        changeNote: input.changeNote || null,
      },
    })
    : null;

  if (rawHash || parsedHash || rawStorageUri || input.parsedStorageUri || analysisArtifact?.artifactId) {
    await rawExecute(
      `UPDATE projectFiles
       SET rawStorageUri=COALESCE(?,rawStorageUri),
           parsedStorageUri=COALESCE(?,parsedStorageUri),
           analysisArtifactId=COALESCE(?,analysisArtifactId),
           rawContentHash=COALESCE(?,rawContentHash),
           parsedDataHash=COALESCE(?,parsedDataHash),
           archiveAfter=COALESCE(archiveAfter,DATE_ADD(createdAt, INTERVAL 180 DAY)),
           deleteAfter=COALESCE(deleteAfter,DATE_ADD(createdAt, INTERVAL 730 DAY)),
           updatedAt=NOW()
       WHERE id=?`,
      [
        rawStorageUri || null,
        input.parsedStorageUri || null,
        analysisArtifact?.artifactId || null,
        rawHash,
        parsedHash,
        input.projectFileId,
      ],
    ).catch((error) => {
      if (!isMissingLifecycleSchema(error)) console.warn("[Artifact Lifecycle] Failed to update project file artifact refs:", error);
    });
  }

  return {
    rawArtifact,
    parsedArtifact,
    analysisArtifact,
    rawStorageObject: rawStorage,
  };
}

export async function registerAgentArtifactLifecycleIndex(input: {
  workspaceId?: number | null;
  runId: string;
  agentSlug: string;
  nodeId: string;
  artifactKey: string;
  artifactType: UnifiedArtifactType;
  status: "draft" | "final";
  version: number;
  userId: number;
  projectId?: number | null;
  content: unknown;
  summary?: string | null;
  metadata?: unknown;
  mimeType?: string | null;
  fileName?: string | null;
  fileSizeBytes?: number | null;
  storageUri?: string | null;
  sourceSkillRunId?: string | null;
  sourceAiJobRunId?: string | null;
}) {
  const metadata = toRecord(input.metadata);
  const domain = normalizeArtifactDomain(metadata.domain || metadata.businessDomain || "agent");
  const registered = await registerUnifiedArtifact({
    workspaceId: input.workspaceId ?? null,
    domain,
    artifactKey: input.artifactKey,
    artifactType: input.artifactType,
    sourceType: "ai_output",
    sourceId: `${input.runId}:${input.nodeId}:${input.artifactKey}:${input.version}`,
    sourceTable: "emperor_agent_artifacts",
    sourceRowId: `${input.runId}:${input.nodeId}:${input.artifactKey}:${input.version}`,
    runId: input.runId,
    agentSlug: input.agentSlug,
    nodeId: input.nodeId,
    projectId: input.projectId ?? null,
    userId: input.userId,
    status: input.status,
    version: input.version,
    isCurrent: input.status === "final",
    content: input.content,
    summary: input.summary || null,
    mimeType: input.mimeType || null,
    fileName: input.fileName || null,
    fileSizeBytes: input.fileSizeBytes ?? null,
    storageUri: input.storageUri || null,
    retentionClass: input.status === "final" ? "hot" : "warm",
    metadata: {
      ...metadata,
      runId: input.runId,
      nodeId: input.nodeId,
      legacyArtifactRef: `artifact://${input.runId}/${input.nodeId}/${input.artifactKey}@${input.version}`,
    },
    sourceSkillRunId: input.sourceSkillRunId || null,
    sourceAiJobRunId: input.sourceAiJobRunId || null,
  });

  if (registered?.artifactId) {
    await rawExecute(
      `UPDATE emperor_agent_artifacts
       SET unifiedArtifactId=COALESCE(unifiedArtifactId,?)
       WHERE runId=? AND nodeId=? AND artifactKey=? AND version=?`,
      [registered.artifactId, input.runId, input.nodeId, input.artifactKey, input.version],
    ).catch((error) => {
      if (!isMissingLifecycleSchema(error)) console.warn("[Artifact Lifecycle] Failed to link legacy Agent artifact:", error);
    });
  }

  return registered;
}

export function listDataLifecyclePolicies() {
  return DATA_LIFECYCLE_POLICIES;
}

export function buildLifecycleCandidateSql(policy: DataLifecyclePolicy, mode: DataArchiveMode = "archive", cutoffExpression = "?") {
  const table = quoteIdentifier(policy.tableName);
  const timeColumn = quoteIdentifier(policy.timeColumn);
  const clauses = [`${timeColumn} < ${cutoffExpression}`];
  if (policy.terminalWhere) clauses.push(`(${policy.terminalWhere})`);
  if (mode === "archive" && policy.lifecycleColumn) {
    const lifecycleColumn = quoteIdentifier(policy.lifecycleColumn);
    clauses.push(`(${lifecycleColumn} IS NULL OR ${lifecycleColumn} <> '${policy.archiveValue}')`);
  }
  if (mode === "delete" && policy.lifecycleColumn && policy.deleteValue) {
    const lifecycleColumn = quoteIdentifier(policy.lifecycleColumn);
    clauses.push(`${lifecycleColumn} <> '${policy.deleteValue}'`);
  }
  return `SELECT COUNT(*) AS candidateCount FROM ${table} WHERE ${clauses.join(" AND ")}`;
}

function cutoffDate(days: number, now = new Date()) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function candidateWhere(policy: DataLifecyclePolicy, mode: DataArchiveMode, params: unknown[], input: { workspaceId?: number | null; now?: Date }) {
  const timeColumn = quoteIdentifier(policy.timeColumn);
  const days = mode === "delete" ? policy.deleteAfterDays || policy.archiveAfterDays : policy.archiveAfterDays;
  const clauses = [`${timeColumn} < ?`];
  params.push(cutoffDate(days, input.now || new Date()));
  if (policy.terminalWhere) clauses.push(`(${policy.terminalWhere})`);
  if (policy.workspaceColumn && input.workspaceId !== undefined) {
    const workspaceColumn = quoteIdentifier(policy.workspaceColumn);
    if (input.workspaceId === null) clauses.push(`${workspaceColumn} IS NULL`);
    else {
      clauses.push(`${workspaceColumn}=?`);
      params.push(input.workspaceId);
    }
  }
  if (policy.lifecycleColumn) {
    const lifecycleColumn = quoteIdentifier(policy.lifecycleColumn);
    if (mode === "archive") clauses.push(`(${lifecycleColumn} IS NULL OR ${lifecycleColumn} <> '${policy.archiveValue}')`);
    if (mode === "delete" && policy.deleteValue) clauses.push(`${lifecycleColumn} <> '${policy.deleteValue}'`);
  }
  return clauses.join(" AND ");
}

export async function runDataLifecycleArchive(input: {
  policySlug: string;
  mode?: DataArchiveMode;
  dryRun?: boolean;
  batchSize?: number;
  workspaceId?: number | null;
  userId?: number | null;
  now?: Date;
}) {
  const policy = DATA_LIFECYCLE_POLICIES.find((item) => item.slug === input.policySlug);
  if (!policy) throw new Error(`Unknown lifecycle policy: ${input.policySlug}`);
  const mode: DataArchiveMode = input.dryRun ? "count" : input.mode || "archive";
  const archiveRunId = `archive_${randomUUID()}`;
  const batchSize = Math.min(Math.max(Math.floor(input.batchSize || 1000), 1), 5000);
  const cutoff = cutoffDate(mode === "delete" ? policy.deleteAfterDays || policy.archiveAfterDays : policy.archiveAfterDays, input.now || new Date());
  await rawExecute(
    `INSERT INTO ai_data_archive_runs
     (workspaceId,archiveRunId,policySlug,tableName,status,mode,cutoffAt,batchSize,createdBy,startedAt,metadata)
     VALUES (?,?,?,?,?,?,?,?,?,NOW(),?)`,
    [
      input.workspaceId ?? null,
      archiveRunId,
      policy.slug,
      policy.tableName,
      mode === "count" ? "dry_run" : "running",
      mode,
      cutoff,
      batchSize,
      input.userId || null,
      safeStringify({ reason: policy.reason }),
    ],
  );

  try {
    const params: unknown[] = [];
    const where = candidateWhere(policy, mode === "count" ? "archive" : mode, params, {
      workspaceId: input.workspaceId,
      now: input.now,
    });
    const idColumn = quoteIdentifier(policy.idColumn);
    const timeColumn = quoteIdentifier(policy.timeColumn);
    const workspaceColumn = policy.workspaceColumn ? quoteIdentifier(policy.workspaceColumn) : "NULL";
    const table = quoteIdentifier(policy.tableName);
    const candidates = await rawExecute(
      `SELECT ${idColumn} as sourceId, ${timeColumn} as sourceCreatedAt, ${workspaceColumn} as rowWorkspaceId
       FROM ${table}
       WHERE ${where}
       ORDER BY ${timeColumn} ASC
       LIMIT ?`,
      [...params, batchSize],
    );

    if (mode === "count") {
      await rawExecute(
        "UPDATE ai_data_archive_runs SET candidateCount=?,archivedCount=0,deletedCount=0,completedAt=NOW(),updatedAt=NOW() WHERE archiveRunId=?",
        [candidates.length, archiveRunId],
      );
      return { archiveRunId, policy, mode, candidateCount: candidates.length, archivedCount: 0, deletedCount: 0 };
    }

    const ids = candidates.map((item) => String(item.sourceId));
    let archivedCount = 0;
    let deletedCount = 0;
    if (ids.length > 0) {
      const idPlaceholders = ids.map(() => "?").join(",");
      if (mode === "delete") {
        if (policy.deleteValue && policy.lifecycleColumn) {
          await rawExecute(
            `UPDATE ${table} SET ${quoteIdentifier(policy.lifecycleColumn)}=?,updatedAt=NOW() WHERE ${idColumn} IN (${idPlaceholders})`,
            [policy.deleteValue, ...ids],
          );
        } else {
          await rawExecute(`DELETE FROM ${table} WHERE ${idColumn} IN (${idPlaceholders})`, ids);
        }
        deletedCount = ids.length;
      } else if (policy.lifecycleColumn) {
        const sets = [
          `${quoteIdentifier(policy.lifecycleColumn)}=?`,
          "archivedAt=NOW()",
        ];
        const updateParams: unknown[] = [policy.archiveValue];
        if (policy.archiveBatchColumn) {
          sets.push(`${quoteIdentifier(policy.archiveBatchColumn)}=?`);
          updateParams.push(archiveRunId);
        }
        if (policy.tableName !== "emperor_agent_events" && policy.tableName !== "emperor_ai_os_metrics") {
          sets.push("updatedAt=NOW()");
        }
        await rawExecute(
          `UPDATE ${table} SET ${sets.join(",")} WHERE ${idColumn} IN (${idPlaceholders})`,
          [...updateParams, ...ids],
        );
        archivedCount = ids.length;
      }

      for (const row of candidates) {
        await rawExecute(
          `INSERT INTO ai_data_archive_items
           (workspaceId,archiveRunId,sourceTable,sourceId,sourceCreatedAt,status,metadata)
           VALUES (?,?,?,?,?,?,?)`,
          [
            row.rowWorkspaceId ?? input.workspaceId ?? null,
            archiveRunId,
            policy.tableName,
            String(row.sourceId),
            row.sourceCreatedAt || null,
            mode === "delete" ? "deleted" : "archived",
            safeStringify({ mode, policySlug: policy.slug }),
          ],
        );
      }
    }

    await rawExecute(
      "UPDATE ai_data_archive_runs SET status='succeeded',candidateCount=?,archivedCount=?,deletedCount=?,completedAt=NOW(),updatedAt=NOW() WHERE archiveRunId=?",
      [candidates.length, archivedCount, deletedCount, archiveRunId],
    );
    return { archiveRunId, policy, mode, candidateCount: candidates.length, archivedCount, deletedCount };
  } catch (error) {
    await rawExecute(
      "UPDATE ai_data_archive_runs SET status='failed',errorMessage=?,completedAt=NOW(),updatedAt=NOW() WHERE archiveRunId=?",
      [String((error as Error).message || error).slice(0, 2000), archiveRunId],
    ).catch(() => undefined);
    throw error;
  }
}

export async function runDataLifecycleSweep(input: {
  policySlug?: string;
  mode?: DataArchiveMode;
  dryRun?: boolean;
  batchSize?: number;
  workspaceId?: number | null;
  userId?: number | null;
} = {}) {
  const policies = input.policySlug
    ? DATA_LIFECYCLE_POLICIES.filter((policy) => policy.slug === input.policySlug)
    : DATA_LIFECYCLE_POLICIES;
  if (input.policySlug && policies.length === 0) throw new Error(`Unknown lifecycle policy: ${input.policySlug}`);
  const results = [];
  for (const policy of policies) {
    results.push(await runDataLifecycleArchive({
      policySlug: policy.slug,
      mode: input.mode,
      dryRun: input.dryRun,
      batchSize: input.batchSize,
      workspaceId: input.workspaceId,
      userId: input.userId,
    }));
  }
  return results;
}
