import { createHash, randomUUID } from "crypto";
import { sql as drizzleSql } from "drizzle-orm";
import { getDb, withDbTransaction, type DbExecutor } from "../../../repositories/dbClient";
import { safeHttpRequest } from "../../../infrastructure/http/safeHttpClient";
import { buildStorageUri, parseStorageUri, storageGet, storagePut, type StorageProvider } from "../../../storage";

export type ArtifactDomain = "listing" | "image" | "ads" | "video" | "agent" | "project" | "file" | "ops" | "tool" | "other";
export type UnifiedArtifactType = "json" | "text" | "markdown" | "html" | "image" | "file" | "table" | "video" | "audio" | "other";
export type ArtifactSourceType = "upload" | "ai_output" | "user_edit" | "import" | "tool_output" | "system" | "archive";
export type RetentionClass = "hot" | "warm" | "cold" | "archive";
export type DataArchiveMode = "count" | "archive" | "delete";

export type RegisteredArtifact = {
  id?: number;
  artifactId: string;
  ref: string;
  versionRef: string;
  currentRef: string;
  version: number;
  storageObjectId?: number | null;
};

export type UnifiedArtifactScope = {
  workspaceId?: number | null;
  domain: ArtifactDomain;
  artifactKey: string;
  sourceTable?: string | null;
  sourceRowId?: string | number | null;
  projectId?: number | null;
  runId?: string | null;
  nodeId?: string | null;
};

export type UnifiedArtifactRecord = Record<string, any> & {
  artifactId: string;
  artifactKey: string;
  version: number;
  isCurrent: number;
  status: string;
  content: unknown;
  ref: string;
  currentRef: string;
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

async function rawExecute(
  sqlStr: string,
  params: unknown[] = [],
  executor?: DbExecutor,
): Promise<any[]> {
  const db = executor || await getDb();
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

export function buildUnifiedArtifactRef(artifactId: string, version: number | "current" = "current") {
  return `ai-artifact://${artifactId}@${version}`;
}

export function buildUnifiedArtifactCurrentRef(scope: UnifiedArtifactScope) {
  const encodedScope = Buffer.from(JSON.stringify({
    workspaceId: scope.workspaceId ?? null,
    domain: scope.domain,
    artifactKey: scope.artifactKey,
    sourceTable: scope.sourceTable ?? null,
    sourceRowId: scope.sourceRowId === undefined || scope.sourceRowId === null ? null : String(scope.sourceRowId),
    runId: scope.runId ?? null,
    nodeId: scope.nodeId ?? null,
  }), "utf8").toString("base64url");
  return `ai-artifact-scope://${encodedScope}@current`;
}

export function parseUnifiedArtifactRef(ref: string):
  | { kind: "version"; artifactId: string; version: number | "current" }
  | { kind: "current"; scope: UnifiedArtifactScope }
  | null {
  const versionMatch = /^ai-artifact:\/\/([^@]+)@(current|[1-9]\d*)$/.exec(ref);
  if (versionMatch) {
    return {
      kind: "version",
      artifactId: versionMatch[1],
      version: versionMatch[2] === "current" ? "current" : Number(versionMatch[2]),
    };
  }
  const currentMatch = /^ai-artifact-scope:\/\/([^@]+)@current$/.exec(ref);
  if (!currentMatch) return null;
  try {
    const decoded = JSON.parse(Buffer.from(currentMatch[1], "base64url").toString("utf8"));
    if (!decoded?.domain || !decoded?.artifactKey) return null;
    return {
      kind: "current",
      scope: {
        workspaceId: decoded.workspaceId ?? null,
        domain: normalizeArtifactDomain(decoded.domain),
        artifactKey: String(decoded.artifactKey),
        sourceTable: decoded.sourceTable ?? null,
        sourceRowId: decoded.sourceRowId ?? null,
        runId: decoded.runId ?? null,
        nodeId: decoded.nodeId ?? null,
      },
    };
  } catch {
    return null;
  }
}

function safeArtifactPathPart(value: unknown) {
  return String(value || "artifact")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "artifact";
}

function artifactStorageKey(input: {
  workspaceId?: number | null;
  domain: ArtifactDomain;
  artifactKey: string;
  contentHash: string;
  artifactType: UnifiedArtifactType;
}) {
  const extension = input.artifactType === "text" || input.artifactType === "markdown" || input.artifactType === "html"
    ? "txt"
    : "json";
  return [
    "ai-artifacts",
    safeArtifactPathPart(input.workspaceId ?? "global"),
    safeArtifactPathPart(input.domain),
    safeArtifactPathPart(input.artifactKey),
    `${input.contentHash}.${extension}`,
  ].join("/");
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
  executor?: DbExecutor;
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
      input.executor,
    );
    const rows = await rawExecute(
      "SELECT id,storageId,storageUri FROM ai_storage_objects WHERE storageId=? LIMIT 1",
      [storageId],
      input.executor,
    );
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
  parentArtifactId?: string | null;
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
  executor?: DbExecutor;
  failOnError?: boolean;
}): Promise<RegisteredArtifact | null> {
  if (!lifecycleStoreAvailable) {
    if (input.failOnError) throw new Error("Artifact lifecycle store is unavailable");
    return null;
  }
  if (!input.executor) {
    try {
      return await withDbTransaction("Register unified Artifact", (tx) => registerUnifiedArtifact({
        ...input,
        executor: tx,
        failOnError: true,
      }));
    } catch (error) {
      if (input.failOnError) throw error;
      if (isMissingLifecycleSchema(error)) lifecycleStoreAvailable = false;
      else console.warn("[Artifact Lifecycle] Failed to register artifact:", error);
      return null;
    }
  }
  const domain = normalizeArtifactDomain(input.domain || "other");
  const artifactType = normalizeArtifactType(input.artifactType || "json");
  const sourceType = normalizeSourceType(input.sourceType || "ai_output");
  const status = input.status || "final";
  const isCurrent = status === "final" && (input.isCurrent ?? true);
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
    const matching = input.content !== undefined
      ? (await rawExecute(
        `SELECT id,artifactId,version,isCurrent,status,storageObjectId FROM ai_artifacts
         WHERE ${scopeWhere} AND contentHash=?
         ORDER BY version DESC LIMIT 1`,
        [...scopeParams, contentHash],
        input.executor,
      ))[0]
      : null;
    if (matching) {
      if (isCurrent) {
        await rawExecute(
          `UPDATE ai_artifacts SET status='superseded',isCurrent=0,updatedAt=NOW()
           WHERE ${scopeWhere} AND isCurrent=1 AND artifactId<>?`,
          [...scopeParams, matching.artifactId],
          input.executor,
        );
        await rawExecute(
          "UPDATE ai_artifacts SET status='final',isCurrent=1,currentSince=NOW(),selectedBy=?,updatedAt=NOW() WHERE artifactId=?",
          [input.selectedBy ?? input.userId ?? null, matching.artifactId],
          input.executor,
        );
      }
      const version = Number(matching.version || 1);
      const currentRef = buildUnifiedArtifactCurrentRef({
        workspaceId: input.workspaceId ?? null,
        domain,
        artifactKey: input.artifactKey,
        sourceTable: input.sourceTable || null,
        sourceRowId: input.sourceRowId ?? input.sourceId ?? null,
        runId: input.runId || null,
        nodeId: input.nodeId || null,
      });
      return {
        id: matching.id,
        artifactId: matching.artifactId,
        version,
        storageObjectId: matching.storageObjectId ?? null,
        ref: buildUnifiedArtifactRef(matching.artifactId, version),
        currentRef,
        versionRef: buildUnifiedArtifactRef(matching.artifactId, version),
      };
    }

    const version = input.version || Number((await rawExecute(
      `SELECT COALESCE(MAX(version),0)+1 as nextVersion FROM ai_artifacts WHERE ${scopeWhere}`,
      scopeParams,
      input.executor,
    ))[0]?.nextVersion || 1);
    const artifactId = input.artifactId || buildStableId("art", [
      input.workspaceId ?? "global",
      domain,
      input.sourceTable || input.runId || "",
      input.sourceRowId ?? input.sourceId ?? input.nodeId ?? "",
      input.artifactKey,
      version,
    ]);
    const previousCurrent = (await rawExecute(
      `SELECT artifactId FROM ai_artifacts WHERE ${scopeWhere} AND isCurrent=1 ORDER BY version DESC LIMIT 1`,
      scopeParams,
      input.executor,
    ))[0];

    let storageObjectId = input.storageObjectId ?? null;
    let storageUri = input.storageUri || null;
    let inlineContent = input.content;
    let storagePending = false;
    if (input.content !== undefined && !shouldInlineArtifactContent(input.content) && storageUri) {
      inlineContent = undefined;
    } else if (input.content !== undefined && !shouldInlineArtifactContent(input.content)) {
      const serialized = safeStringify(input.content);
      const objectKey = artifactStorageKey({
        workspaceId: input.workspaceId,
        domain,
        artifactKey: input.artifactKey,
        contentHash,
        artifactType,
      });
      try {
        const stored = await storagePut(
          objectKey,
          serialized,
          artifactType === "text" || artifactType === "markdown" || artifactType === "html"
            ? "text/plain; charset=utf-8"
            : "application/json",
        );
        const storage = await registerStorageObject({
          workspaceId: input.workspaceId ?? null,
          storageUri: stored.storageUri,
          publicUrl: stored.url,
          objectKey: stored.key,
          mimeType: artifactType === "text" || artifactType === "markdown" || artifactType === "html"
            ? "text/plain; charset=utf-8"
            : "application/json",
          fileName: `${safeArtifactPathPart(input.artifactKey)}-${contentHash.slice(0, 12)}.${artifactType === "text" ? "txt" : "json"}`,
          sizeBytes: Buffer.byteLength(serialized, "utf8"),
          contentHash,
          sourceDomain: domain,
          sourceType,
          sourceId: input.sourceRowId ?? input.sourceId ?? input.runId ?? null,
          metadata: { artifactId, artifactKey: input.artifactKey, version },
          createdBy: input.userId ?? null,
          executor: input.executor,
        });
        storageUri = stored.storageUri;
        storageObjectId = storage?.id ?? null;
        inlineContent = undefined;
      } catch (error) {
        storagePending = true;
        console.warn(`[Artifact Lifecycle] Storage upload deferred for ${input.artifactKey}@${version}:`, error);
      }
    }

    if (isCurrent) {
      await rawExecute(
        `UPDATE ai_artifacts SET status='superseded',isCurrent=0,updatedAt=NOW() WHERE ${scopeWhere} AND isCurrent=1 AND artifactId<>?`,
        [...scopeParams, artifactId],
        input.executor,
      );
    }

    await rawExecute(
      `INSERT INTO ai_artifacts
       (workspaceId,artifactId,domain,artifactKey,artifactType,sourceType,sourceId,sourceTable,sourceRowId,runId,agentSlug,nodeId,projectId,userId,status,version,isCurrent,parentArtifactId,currentSince,selectedBy,contentJson,searchableText,summary,contentHash,storageObjectId,storageUri,mimeType,fileName,fileSizeBytes,retentionClass,archiveAfter,deleteAfter,metadata,sourceSkillRunId,sourceAiJobRunId)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,DATE_ADD(NOW(), INTERVAL 365 DAY),DATE_ADD(NOW(), INTERVAL 1095 DAY),?,?,?)
       ON DUPLICATE KEY UPDATE artifactId=VALUES(artifactId)`,
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
        input.parentArtifactId || previousCurrent?.artifactId || null,
        isCurrent ? new Date() : null,
        isCurrent ? input.selectedBy ?? input.userId ?? null : null,
        inlineContent === undefined ? null : safeStringify(inlineContent),
        input.searchableText ?? searchableText(input.content),
        input.summary || summarizeArtifactPayload(input.content ?? input.storageUri ?? null),
        contentHash,
        storageObjectId,
        storageUri,
        input.mimeType || null,
        input.fileName || null,
        input.fileSizeBytes ?? null,
        input.retentionClass || "hot",
        safeStringify({ ...toRecord(input.metadata), storagePending }),
        input.sourceSkillRunId || null,
        input.sourceAiJobRunId || null,
      ],
      input.executor,
    );
    const rows = await rawExecute(
      "SELECT id,artifactId,version,storageObjectId,contentHash FROM ai_artifacts WHERE artifactId=? LIMIT 1",
      [artifactId],
      input.executor,
    );
    if (rows[0] && String(rows[0].contentHash || "") !== contentHash) {
      if (input.artifactId) {
        throw new Error(`Artifact ${artifactId} already exists with different immutable content`);
      }
      return registerUnifiedArtifact({
        ...input,
        artifactId: undefined,
        version: version + 1,
        executor: input.executor,
        failOnError: true,
      });
    }
    return {
      id: rows[0]?.id,
      artifactId,
      version,
      storageObjectId: rows[0]?.storageObjectId ?? storageObjectId,
      ref: buildUnifiedArtifactRef(artifactId, version),
      currentRef: buildUnifiedArtifactCurrentRef({
        workspaceId: input.workspaceId ?? null,
        domain,
        artifactKey: input.artifactKey,
        sourceTable: input.sourceTable || null,
        sourceRowId: input.sourceRowId ?? input.sourceId ?? null,
        runId: input.runId || null,
        nodeId: input.nodeId || null,
      }),
      versionRef: buildUnifiedArtifactRef(artifactId, version),
    };
  } catch (error) {
    if (input.failOnError) throw error;
    if (isMissingLifecycleSchema(error)) lifecycleStoreAvailable = false;
    else console.warn("[Artifact Lifecycle] Failed to register artifact:", error);
    return null;
  }
}

function unifiedArtifactScopeFromRow(row: Record<string, any>): UnifiedArtifactScope {
  return {
    workspaceId: row.workspaceId ?? null,
    domain: normalizeArtifactDomain(row.domain),
    artifactKey: String(row.artifactKey),
    sourceTable: row.sourceTable || null,
    sourceRowId: row.sourceRowId ?? row.sourceId ?? null,
    runId: row.runId || null,
    nodeId: row.nodeId || null,
  };
}

function unifiedArtifactQueryWhere(input: UnifiedArtifactScope & {
  artifactId?: string | null;
  version?: number | null;
  currentOnly?: boolean;
  confirmedOnly?: boolean;
}, params: unknown[]) {
  if (input.artifactId) {
    params.push(input.artifactId);
    const clauses = ["a.`artifactId`=?"];
    if (input.workspaceId !== undefined) clauses.push(exactNullableClause("workspaceId", input.workspaceId, params).replace("`workspaceId`", "a.`workspaceId`"));
    return clauses.join(" AND ");
  }
  const clauses: string[] = [];
  if (input.workspaceId !== undefined) {
    clauses.push(exactNullableClause("workspaceId", input.workspaceId, params).replace("`workspaceId`", "a.`workspaceId`"));
  }
  params.push(input.domain, input.artifactKey);
  clauses.push("a.`domain`=?", "a.`artifactKey`=?");
  if (input.sourceTable !== undefined) {
    clauses.push(exactNullableClause("sourceTable", input.sourceTable, params).replace("`sourceTable`", "a.`sourceTable`"));
  }
  if (input.sourceRowId !== undefined) {
    clauses.push(exactNullableClause(
      "sourceRowId",
      input.sourceRowId === null ? null : String(input.sourceRowId),
      params,
    ).replace("`sourceRowId`", "a.`sourceRowId`"));
  }
  if (input.projectId !== undefined) {
    clauses.push(exactNullableClause("projectId", input.projectId, params).replace("`projectId`", "a.`projectId`"));
  }
  if (input.runId !== undefined) {
    clauses.push(exactNullableClause("runId", input.runId, params).replace("`runId`", "a.`runId`"));
  }
  if (input.nodeId !== undefined) {
    clauses.push(exactNullableClause("nodeId", input.nodeId, params).replace("`nodeId`", "a.`nodeId`"));
  }
  if (input.version) {
    params.push(input.version);
    clauses.push("a.`version`=?");
  }
  if (input.currentOnly !== false && !input.version) clauses.push("a.`isCurrent`=1");
  if (input.confirmedOnly !== false) clauses.push("a.`status` IN ('final','superseded')");
  return clauses.join(" AND ");
}

async function resolveStoredArtifactContent(row: Record<string, any>) {
  if (row.contentJson !== undefined && row.contentJson !== null) {
    return parseJson(row.contentJson, row.contentJson);
  }
  const parsedUri = row.storageUri ? parseStorageUri(String(row.storageUri)) : null;
  let downloadUrl = row.storagePublicUrl || row.publicUrl || null;
  if (!downloadUrl && parsedUri?.provider === "forge") {
    downloadUrl = (await storageGet(parsedUri.key)).url;
  }
  if (!downloadUrl && /^https?:\/\//i.test(String(row.storageUri || ""))) {
    downloadUrl = row.storageUri;
  }
  if (!downloadUrl) return null;
  const url = new URL(downloadUrl);
  const response = await safeHttpRequest(url, {
    method: "GET",
    timeoutMs: 60_000,
    maxResponseBytes: 50 * 1024 * 1024,
    allowedHosts: [url.hostname],
    auditContext: {
      workspaceId: row.workspaceId ?? null,
      operation: "artifact.storage.read",
    },
  });
  if (!response.ok) throw new Error(`Artifact storage read failed (${response.status})`);
  const content = await response.text();
  return ["json", "table", "file", "image", "video", "audio", "other"].includes(String(row.artifactType))
    ? parseJson(content, content)
    : content;
}

async function hydrateUnifiedArtifactRow(row: Record<string, any> | null): Promise<UnifiedArtifactRecord | null> {
  if (!row) return null;
  const content = await resolveStoredArtifactContent(row);
  return {
    ...row,
    version: Number(row.version || 1),
    isCurrent: Number(row.isCurrent || 0),
    content,
    ref: buildUnifiedArtifactRef(row.artifactId, Number(row.version || 1)),
    currentRef: buildUnifiedArtifactCurrentRef(unifiedArtifactScopeFromRow(row)),
  } as UnifiedArtifactRecord;
}

export async function resolveUnifiedArtifact(input: UnifiedArtifactScope & {
  artifactId?: string | null;
  version?: number | null;
  currentOnly?: boolean;
  confirmedOnly?: boolean;
  executor?: DbExecutor;
}): Promise<UnifiedArtifactRecord | null> {
  const params: unknown[] = [];
  const where = unifiedArtifactQueryWhere(input, params);
  const rows = await rawExecute(
    `SELECT a.*,s.publicUrl AS storagePublicUrl,s.storageId
     FROM ai_artifacts a
     LEFT JOIN ai_storage_objects s ON s.id=a.storageObjectId
     WHERE ${where}
     ORDER BY a.isCurrent DESC,a.version DESC LIMIT 1`,
    params,
    input.executor,
  );
  return hydrateUnifiedArtifactRow(rows[0] || null);
}

export async function resolveUnifiedArtifactRef(
  ref: string,
  options?: { workspaceId?: number | null; confirmedOnly?: boolean },
) {
  const parsed = parseUnifiedArtifactRef(ref);
  if (!parsed) throw new Error(`Invalid unified Artifact reference: ${ref}`);
  if (parsed.kind === "current") {
    return resolveUnifiedArtifact({
      ...parsed.scope,
      workspaceId: options?.workspaceId === undefined ? parsed.scope.workspaceId : options.workspaceId,
      currentOnly: true,
      confirmedOnly: options?.confirmedOnly ?? true,
    });
  }
  const artifact = await resolveUnifiedArtifact({
    artifactId: parsed.artifactId,
    workspaceId: options?.workspaceId,
    domain: "other",
    artifactKey: "reference",
    currentOnly: false,
    confirmedOnly: options?.confirmedOnly ?? true,
  });
  if (!artifact) return null;
  if (parsed.version !== "current" && artifact.version !== parsed.version) return null;
  if (parsed.version === "current") {
    return resolveUnifiedArtifact({
      ...unifiedArtifactScopeFromRow(artifact),
      workspaceId: options?.workspaceId === undefined ? artifact.workspaceId : options.workspaceId,
      currentOnly: true,
      confirmedOnly: options?.confirmedOnly ?? true,
    });
  }
  return artifact;
}

export async function listUnifiedArtifactVersions(input: UnifiedArtifactScope & {
  confirmedOnly?: boolean;
  includeContent?: boolean;
  limit?: number;
  executor?: DbExecutor;
}) {
  const params: unknown[] = [];
  const where = unifiedArtifactQueryWhere({
    ...input,
    currentOnly: false,
    confirmedOnly: input.confirmedOnly ?? false,
  }, params);
  params.push(Math.min(Math.max(input.limit || 50, 1), 200));
  const rows = await rawExecute(
    `SELECT a.*,s.publicUrl AS storagePublicUrl,s.storageId
     FROM ai_artifacts a
     LEFT JOIN ai_storage_objects s ON s.id=a.storageObjectId
     WHERE ${where}
     ORDER BY a.version DESC LIMIT ?`,
    params,
    input.executor,
  );
  if (input.includeContent) return Promise.all(rows.map((row) => hydrateUnifiedArtifactRow(row)));
  return rows.map((row) => ({
    ...row,
    version: Number(row.version || 1),
    isCurrent: Number(row.isCurrent || 0),
    content: null,
    ref: buildUnifiedArtifactRef(row.artifactId, Number(row.version || 1)),
    currentRef: buildUnifiedArtifactCurrentRef(unifiedArtifactScopeFromRow(row)),
  }) as UnifiedArtifactRecord);
}

async function recordArtifactSelectionEvent(input: {
  executor: DbExecutor;
  workspaceId?: number | null;
  projectId?: number | null;
  artifactKey: string;
  sourceTable?: string | null;
  sourceRowId?: string | null;
  fromArtifactId?: string | null;
  fromVersion?: number | null;
  toArtifactId: string;
  toVersion: number;
  action: "select" | "rollback" | "confirm";
  userId?: number | null;
  reason?: string | null;
}) {
  try {
    await rawExecute(
      `INSERT INTO ai_artifact_selection_events
       (selectionId,workspaceId,projectId,artifactKey,sourceTable,sourceRowId,fromArtifactId,fromVersion,toArtifactId,toVersion,action,userId,reason)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        `asel_${randomUUID().replace(/-/g, "")}`,
        input.workspaceId ?? null,
        input.projectId ?? null,
        input.artifactKey,
        input.sourceTable || null,
        input.sourceRowId || null,
        input.fromArtifactId || null,
        input.fromVersion ?? null,
        input.toArtifactId,
        input.toVersion,
        input.action,
        input.userId ?? null,
        input.reason || null,
      ],
      input.executor,
    );
  } catch (error) {
    if (!isMissingLifecycleSchema(error)) throw error;
  }
}

export async function selectUnifiedArtifactVersion(input: {
  artifactId: string;
  workspaceId?: number | null;
  userId?: number | null;
  action?: "select" | "rollback" | "confirm";
  reason?: string | null;
}) {
  const selectedId = await withDbTransaction("Select unified Artifact version", async (tx) => {
    const params: unknown[] = [input.artifactId];
    const workspaceClause = input.workspaceId === undefined
      ? ""
      : ` AND ${exactNullableClause("workspaceId", input.workspaceId, params)}`;
    const target = (await rawExecute(
      `SELECT * FROM ai_artifacts WHERE artifactId=?${workspaceClause} FOR UPDATE`,
      params,
      tx,
    ))[0];
    if (!target) throw new Error("Artifact version not found");
    if (!["final", "superseded"].includes(String(target.status))) {
      throw new Error("只有已确认的 Artifact 版本可以设为下游当前版本");
    }
    const scope = unifiedArtifactScopeFromRow(target);
    const scopeParams: unknown[] = [];
    const scopeWhere = artifactScopeWhere(scope, scopeParams);
    const previous = (await rawExecute(
      `SELECT artifactId,version FROM ai_artifacts WHERE ${scopeWhere} AND isCurrent=1 FOR UPDATE`,
      scopeParams,
      tx,
    ))[0];
    await rawExecute(
      `UPDATE ai_artifacts SET status='superseded',isCurrent=0,updatedAt=NOW() WHERE ${scopeWhere} AND isCurrent=1`,
      scopeParams,
      tx,
    );
    await rawExecute(
      "UPDATE ai_artifacts SET status='final',isCurrent=1,currentSince=NOW(),selectedBy=?,updatedAt=NOW() WHERE artifactId=?",
      [input.userId ?? null, target.artifactId],
      tx,
    );
    await recordArtifactSelectionEvent({
      executor: tx,
      workspaceId: target.workspaceId,
      projectId: target.projectId,
      artifactKey: target.artifactKey,
      sourceTable: target.sourceTable,
      sourceRowId: target.sourceRowId,
      fromArtifactId: previous?.artifactId || null,
      fromVersion: previous?.version ? Number(previous.version) : null,
      toArtifactId: target.artifactId,
      toVersion: Number(target.version),
      action: input.action || "select",
      userId: input.userId,
      reason: input.reason,
    });
    return String(target.artifactId);
  });
  return resolveUnifiedArtifact({
    artifactId: selectedId,
    workspaceId: input.workspaceId,
    domain: "other",
    artifactKey: "selected",
    currentOnly: false,
    confirmedOnly: false,
  });
}

export async function rollbackUnifiedArtifactVersion(input: {
  scope: UnifiedArtifactScope;
  targetVersion?: number | null;
  userId?: number | null;
  reason?: string | null;
}) {
  const versions = await listUnifiedArtifactVersions({ ...input.scope, confirmedOnly: true, limit: 200 });
  const current = versions.find((artifact) => artifact?.isCurrent === 1);
  const target = input.targetVersion
    ? versions.find((artifact) => artifact?.version === input.targetVersion)
    : versions.find((artifact) => current && artifact && artifact.version < current.version);
  if (!target) throw new Error("没有可回滚的 Artifact 历史版本");
  return selectUnifiedArtifactVersion({
    artifactId: target.artifactId,
    workspaceId: input.scope.workspaceId,
    userId: input.userId,
    action: "rollback",
    reason: input.reason,
  });
}

export async function recordUnifiedArtifactConsumption(input: {
  workspaceId?: number | null;
  artifact: Pick<UnifiedArtifactRecord, "artifactId" | "artifactKey" | "version" | "ref">;
  consumerDomain: ArtifactDomain;
  consumerType: "agent_node" | "ai_job" | "skill_run" | "business_operation";
  consumerId: string;
  projectId?: number | null;
  runId?: string | null;
  nodeId?: string | null;
  metadata?: Record<string, unknown>;
  executor?: DbExecutor;
}) {
  try {
    await rawExecute(
      `INSERT INTO ai_artifact_consumptions
       (consumptionId,workspaceId,projectId,artifactId,artifactKey,artifactVersion,artifactRef,consumerDomain,consumerType,consumerId,runId,nodeId,metadata)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        `acons_${randomUUID().replace(/-/g, "")}`,
        input.workspaceId ?? null,
        input.projectId ?? null,
        input.artifact.artifactId,
        input.artifact.artifactKey,
        input.artifact.version,
        input.artifact.ref,
        input.consumerDomain,
        input.consumerType,
        input.consumerId,
        input.runId || null,
        input.nodeId || null,
        safeStringify(input.metadata || {}),
      ],
      input.executor,
    );
  } catch (error) {
    if (!isMissingLifecycleSchema(error)) throw error;
  }
}

export async function resolveCurrentProjectArtifacts(input: {
  projectId: number;
  workspaceId?: number | null;
  domains?: ArtifactDomain[];
  artifactKeys?: string[];
  limit?: number;
}) {
  const params: unknown[] = [input.projectId];
  const clauses = ["a.projectId=?", "a.status='final'", "a.isCurrent=1"];
  if (input.workspaceId !== undefined) {
    clauses.push(exactNullableClause("workspaceId", input.workspaceId, params).replace("`workspaceId`", "a.`workspaceId`"));
  }
  if (input.domains?.length) {
    clauses.push(`a.domain IN (${input.domains.map(() => "?").join(",")})`);
    params.push(...input.domains);
  }
  if (input.artifactKeys?.length) {
    clauses.push(`a.artifactKey IN (${input.artifactKeys.map(() => "?").join(",")})`);
    params.push(...input.artifactKeys);
  }
  params.push(Math.min(Math.max(input.limit || 100, 1), 500));
  const rows = await rawExecute(
    `SELECT a.*,s.publicUrl AS storagePublicUrl,s.storageId
     FROM ai_artifacts a
     LEFT JOIN ai_storage_objects s ON s.id=a.storageObjectId
     WHERE ${clauses.join(" AND ")}
     ORDER BY a.currentSince DESC,a.version DESC LIMIT ?`,
    params,
  );
  return (await Promise.all(rows.map((row) => hydrateUnifiedArtifactRow(row))))
    .filter((artifact): artifact is UnifiedArtifactRecord => Boolean(artifact));
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
      storageObjectId: input.rawContent ? null : rawStorage?.id ?? null,
      storageUri: input.rawContent ? null : rawStorageUri || input.fileUrl || null,
      mimeType: "text/plain",
      fileName: input.filename,
      fileSizeBytes: input.fileSizeBytes ?? null,
      retentionClass: "warm",
      metadata: {
        fileType: input.fileType,
        role: "raw_upload",
        originalStorageUri: rawStorageUri || input.fileUrl || null,
      },
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
