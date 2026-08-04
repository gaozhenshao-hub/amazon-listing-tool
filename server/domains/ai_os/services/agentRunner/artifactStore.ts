import { TRPCError, registerAgentArtifactLifecycleIndex, EmperorAgentNode, AgentContextArtifactRef, AgentContextResourceKind, AgentContextResourceRef, AgentArtifactType, agentArtifactStoreState, hashArtifactContent, rawExecute, parseJson, stringifyJson } from "./runtimeCore";
import { addEvent } from "./checkpointStore";
import { getRunRow } from "./contextPackage";
const AGENT_ARTIFACT_TYPES = new Set<AgentArtifactType>(["json", "text", "markdown", "html", "image", "file", "table", "other"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeArtifactType(value: unknown): AgentArtifactType | null {
  const normalized = String(value || "").trim().toLowerCase();
  return AGENT_ARTIFACT_TYPES.has(normalized as AgentArtifactType) ? normalized as AgentArtifactType : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) return Math.floor(num);
  }
  return null;
}

function inferArtifactType(content: unknown, metadata: Record<string, unknown> = {}): AgentArtifactType {
  const declared = normalizeArtifactType(metadata.artifactType || metadata.type);
  if (declared) return declared;
  const mimeType = firstString(metadata.mimeType, metadata.contentType);
  const fileName = firstString(metadata.fileName, metadata.name);
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.includes("spreadsheet") || mimeType === "text/csv" || mimeType?.includes("tab-separated-values")) return "table";
  if (fileName && /\.(png|jpe?g|webp|gif|svg)$/i.test(fileName)) return "image";
  if (fileName && /\.(csv|xlsx?|tsv)$/i.test(fileName)) return "table";
  if (Object.keys(asRecord(metadata.image)).length > 0) return "image";
  if (Object.keys(asRecord(metadata.table)).length > 0) return "table";
  if (Object.keys(asRecord(metadata.file)).length > 0) return "file";
  if (typeof content === "string") return "text";
  if (content && typeof content === "object") return "json";
  return "other";
}

function normalizeArtifactMetadata(content: unknown, rawMetadata: unknown) {
  const metadata = asRecord(rawMetadata);
  const contentRecord = asRecord(content);
  const file = asRecord(metadata.file || contentRecord.file);
  const image = asRecord(metadata.image || contentRecord.image);
  const table = asRecord(metadata.table || contentRecord.table);
  const mimeType = firstString(metadata.mimeType, metadata.contentType, file.mimeType, file.contentType, image.mimeType, table.mimeType);
  const fileName = firstString(metadata.fileName, metadata.name, file.fileName, file.name, image.fileName, table.fileName);
  const fileSizeBytes = firstNumber(metadata.fileSizeBytes, metadata.sizeBytes, metadata.size, file.fileSizeBytes, file.sizeBytes, file.size, image.fileSizeBytes, table.fileSizeBytes);
  const storageUri = firstString(metadata.storageUri, metadata.uri, metadata.url, file.storageUri, file.uri, file.url, image.storageUri, image.url, table.storageUri);
  const artifactType = inferArtifactType(content, { ...metadata, mimeType, fileName });
  return {
    artifactType,
    mimeType,
    fileName,
    fileSizeBytes,
    storageUri,
    metadata: {
      ...metadata,
      artifactType,
      file: Object.keys(file).length > 0 ? file : undefined,
      image: Object.keys(image).length > 0 ? image : undefined,
      table: Object.keys(table).length > 0 ? table : undefined,
      mimeType,
      fileName,
      fileSizeBytes,
      storageUri,
    },
  };
}

function summarizeArtifactContent(content: unknown): string {
  if (typeof content === "string") return content.slice(0, 500);
  try {
    return JSON.stringify(content ?? null).slice(0, 500);
  } catch {
    return "";
  }
}

function contextStringLimit(value?: number, fallback = 4000): number {
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(Number(value)), 200), 50000) : fallback;
}

function contextNumberLimit(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), min), max) : fallback;
}

function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value ?? "");
  }
}

export function estimateAgentContextTokens(value: unknown): number {
  return Math.max(1, Math.ceil(safeSerialize(value).length / 4));
}

function pushUnique(list: string[], value: string) {
  if (!list.includes(value)) list.push(value);
}

type ContextTrimStats = {
  truncatedFields: string[];
  summarizedFields: string[];
};

type ContextTrimOptions = {
  maxStringLength: number;
  maxArrayItems: number;
  maxObjectKeys: number;
  path: string;
  stats: ContextTrimStats;
};

function trimContextValueWithOptions(value: unknown, options: ContextTrimOptions): unknown {
  if (typeof value === "string") {
    if (value.length <= options.maxStringLength) return value;
    pushUnique(options.stats.truncatedFields, options.path);
    return {
      __truncated: true,
      originalLength: value.length,
      preview: value.slice(0, options.maxStringLength),
    };
  }
  if (Array.isArray(value)) {
    const maxItems = options.maxArrayItems;
    const source = value.length > maxItems ? value.slice(0, maxItems) : value;
    const items = source.map((item, index) => trimContextValueWithOptions(item, {
      ...options,
      path: `${options.path}[${index}]`,
    }));
    if (value.length <= maxItems) return items;
    pushUnique(options.stats.summarizedFields, options.path);
    return {
      __summary: true,
      kind: "array",
      originalLength: value.length,
      sample: items,
      omittedItems: value.length - source.length,
    };
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const maxKeys = options.maxObjectKeys;
    const selectedEntries = entries.length > maxKeys ? entries.slice(0, maxKeys) : entries;
    const trimmed = Object.fromEntries(
      selectedEntries.map(([key, item]) => [key, trimContextValueWithOptions(item, {
        ...options,
        path: `${options.path}.${key}`,
      })]),
    );
    if (entries.length <= maxKeys) return trimmed;
    pushUnique(options.stats.summarizedFields, options.path);
    return {
      ...trimmed,
      __summary: true,
      __truncatedKeys: entries.slice(maxKeys).map(([key]) => key),
      __omittedKeyCount: entries.length - selectedEntries.length,
    };
  }
  return value;
}

function summarizeContextValue(value: unknown, targetChars: number, path: string, stats: ContextTrimStats): unknown {
  pushUnique(stats.summarizedFields, path);
  const maxPreviewLength = Math.min(Math.max(Math.floor(targetChars), 200), 8000);
  if (typeof value === "string") {
    return {
      __summary: true,
      kind: "string",
      originalLength: value.length,
      preview: value.slice(0, maxPreviewLength),
    };
  }
  if (Array.isArray(value)) {
    const sampleSize = Math.min(value.length, 5);
    return {
      __summary: true,
      kind: "array",
      originalLength: value.length,
      sample: value.slice(0, sampleSize).map((item, index) => trimContextValueWithOptions(item, {
        maxStringLength: Math.min(maxPreviewLength, 1000),
        maxArrayItems: 8,
        maxObjectKeys: 20,
        path: `${path}[${index}]`,
        stats,
      })),
      omittedItems: Math.max(value.length - sampleSize, 0),
    };
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const previewEntries = entries.slice(0, 12);
    return {
      __summary: true,
      kind: "object",
      originalLength: safeSerialize(value).length,
      keys: entries.map(([key]) => key).slice(0, 80),
      preview: Object.fromEntries(previewEntries.map(([key, item]) => [key, trimContextValueWithOptions(item, {
        maxStringLength: Math.min(maxPreviewLength, 1000),
        maxArrayItems: 8,
        maxObjectKeys: 20,
        path: `${path}.${key}`,
        stats,
      })])),
    };
  }
  return value;
}

function fitValueToTokenBudget(value: unknown, limitTokens: number, path: string, stats: ContextTrimStats): unknown {
  if (estimateAgentContextTokens(value) <= limitTokens) return value;
  return summarizeContextValue(value, limitTokens * 4, path, stats);
}

async function persistAgentArtifact(input: {
  run: any;
  node: EmperorAgentNode;
  status: "draft" | "final";
  content: unknown;
  sourceSkillRunId?: string | null;
  sourceAiJobRunId?: string | null;
  metadata?: unknown;
  selectedBy?: number | null;
}) {
  if (!agentArtifactStoreState.available) return;
  const artifactKey = input.node.outputKey || input.node.id;
  const artifactMetadata = normalizeArtifactMetadata(input.content, input.metadata);
  const currentSince = input.status === "final" ? new Date() : null;
  try {
    if (input.status === "final") {
      await rawExecute(
        "UPDATE emperor_agent_artifacts SET status='superseded',isCurrent=0,updatedAt=NOW() WHERE runId=? AND nodeId=? AND artifactKey=? AND isCurrent=1",
        [input.run.runId, input.node.id, artifactKey],
      );
    }

    const versionRows = await rawExecute(
      "SELECT COALESCE(MAX(version),0)+1 as nextVersion FROM emperor_agent_artifacts WHERE runId=? AND nodeId=? AND artifactKey=?",
      [input.run.runId, input.node.id, artifactKey],
    );
    const version = Number(versionRows[0]?.nextVersion || 1);

    await rawExecute(
      `INSERT INTO emperor_agent_artifacts
       (workspaceId,runId,agentSlug,nodeId,artifactKey,artifactType,status,version,isCurrent,currentSince,selectedBy,userId,projectId,content,contentHash,summary,metadata,mimeType,fileName,fileSizeBytes,storageUri,sourceSkillRunId,sourceAiJobRunId)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        input.run.workspaceId ?? null,
        input.run.runId,
        input.run.agentSlug,
        input.node.id,
        artifactKey,
        artifactMetadata.artifactType,
        input.status,
        version,
        input.status === "final" ? 1 : 0,
        currentSince,
        input.status === "final" ? input.selectedBy ?? input.run.userId ?? null : null,
        input.run.userId,
        input.run.projectId ?? null,
        stringifyJson(input.content),
        hashArtifactContent(input.content),
        summarizeArtifactContent(input.content),
        stringifyJson(artifactMetadata.metadata),
        artifactMetadata.mimeType,
        artifactMetadata.fileName,
        artifactMetadata.fileSizeBytes,
        artifactMetadata.storageUri,
        input.sourceSkillRunId || null,
        input.sourceAiJobRunId || null,
      ],
    );
    void registerAgentArtifactLifecycleIndex({
      workspaceId: input.run.workspaceId ?? null,
      runId: input.run.runId,
      agentSlug: input.run.agentSlug,
      nodeId: input.node.id,
      artifactKey,
      artifactType: artifactMetadata.artifactType,
      status: input.status,
      version,
      userId: input.run.userId,
      projectId: input.run.projectId ?? null,
      content: input.content,
      summary: summarizeArtifactContent(input.content),
      metadata: artifactMetadata.metadata,
      mimeType: artifactMetadata.mimeType,
      fileName: artifactMetadata.fileName,
      fileSizeBytes: artifactMetadata.fileSizeBytes,
      storageUri: artifactMetadata.storageUri,
      sourceSkillRunId: input.sourceSkillRunId || null,
      sourceAiJobRunId: input.sourceAiJobRunId || null,
    });
  } catch (error) {
    agentArtifactStoreState.available = false;
    console.warn("[Agent Artifact] Failed to persist artifact:", error);
  }
}

export async function listAgentArtifacts(input: {
  runId: string;
  userId?: number;
  nodeId?: string;
  artifactKey?: string;
  currentOnly?: boolean;
  skipOwnerCheck?: boolean;
}) {
  if (!agentArtifactStoreState.available) return [];
  const run = await getRunRow(input.runId);
  if (!input.skipOwnerCheck && input.userId && run.userId !== input.userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot read this Agent run" });
  }
  const params: unknown[] = [input.runId];
  let sql = "SELECT * FROM emperor_agent_artifacts WHERE runId=?";
  if (input.nodeId) {
    sql += " AND nodeId=?";
    params.push(input.nodeId);
  }
  if (input.artifactKey) {
    sql += " AND artifactKey=?";
    params.push(input.artifactKey);
  }
  if (input.currentOnly) {
    sql += " AND (isCurrent=1 OR status='final')";
  }
  sql += " ORDER BY createdAt DESC, id DESC LIMIT 200";
  try {
    const rows = await rawExecute(sql, params);
    return rows.map(parseAgentArtifactRow);
  } catch (error) {
    agentArtifactStoreState.available = false;
    console.warn("[Agent Artifact] Failed to list artifacts:", error);
    return [];
  }
}

function parseAgentArtifactRow(artifact: any) {
  const metadata = parseJson(artifact.metadata, {}) as Record<string, unknown>;
  const rawIsCurrent = artifact.isCurrent;
  const isCurrent = rawIsCurrent === undefined || rawIsCurrent === null
    ? artifact.status === "final"
    : Number(rawIsCurrent || 0) === 1 || rawIsCurrent === true;
  return {
    ...artifact,
    version: Number(artifact.version || 1),
    isCurrent,
    content: parseJson(artifact.content),
    metadata,
    contentHash: artifact.contentHash || hashArtifactContent(parseJson(artifact.content)),
    mimeType: artifact.mimeType || (metadata.mimeType as string | undefined) || null,
    fileName: artifact.fileName || (metadata.fileName as string | undefined) || null,
    fileSizeBytes: artifact.fileSizeBytes === undefined || artifact.fileSizeBytes === null ? (metadata.fileSizeBytes as number | undefined) ?? null : Number(artifact.fileSizeBytes),
    storageUri: artifact.storageUri || (metadata.storageUri as string | undefined) || null,
    ref: buildAgentArtifactRef(artifact),
    currentRef: buildAgentArtifactRef(artifact, "current"),
  };
}

export function buildAgentArtifactRef(
  artifact: Pick<AgentContextArtifactRef, "runId" | "nodeId" | "artifactKey"> & { version?: number | null },
  version: number | "current" = Number(artifact.version || 1),
) {
  return `artifact://${artifact.runId}/${artifact.nodeId}/${artifact.artifactKey}@${version}`;
}

function isCurrentAgentArtifact(artifact: any): boolean {
  return Number(artifact.isCurrent || 0) === 1 || (artifact.isCurrent === undefined && artifact.status === "final");
}

function artifactResourceKind(artifact: Pick<AgentContextArtifactRef, "artifactType" | "metadata" | "mimeType" | "fileName">): AgentContextResourceKind | null {
  const artifactType = normalizeArtifactType(artifact.artifactType);
  if (artifactType === "image") return "image";
  if (artifactType === "table") return "table";
  if (artifactType === "file") return "file";
  const metadata = asRecord(artifact.metadata);
  const mimeType = firstString(artifact.mimeType, metadata.mimeType, metadata.contentType);
  const fileName = firstString(artifact.fileName, metadata.fileName, metadata.name);
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.includes("spreadsheet") || mimeType === "text/csv" || mimeType?.includes("tab-separated-values")) return "table";
  if (fileName && /\.(png|jpe?g|webp|gif|svg)$/i.test(fileName)) return "image";
  if (fileName && /\.(csv|xlsx?|tsv)$/i.test(fileName)) return "table";
  if (Object.keys(asRecord(metadata.image)).length > 0) return "image";
  if (Object.keys(asRecord(metadata.table)).length > 0) return "table";
  if (Object.keys(asRecord(metadata.file)).length > 0) return "file";
  return null;
}

function buildAgentResourceRef(artifact: AgentContextArtifactRef): AgentContextResourceRef | null {
  const kind = artifactResourceKind(artifact);
  if (!kind) return null;
  return {
    kind,
    artifactId: artifact.artifactId,
    runId: artifact.runId,
    nodeId: artifact.nodeId,
    artifactKey: artifact.artifactKey,
    artifactType: artifact.artifactType,
    version: Number(artifact.version || 1),
    ref: artifact.ref || buildAgentArtifactRef(artifact),
    currentRef: artifact.currentRef || buildAgentArtifactRef(artifact, "current"),
    mimeType: artifact.mimeType || null,
    fileName: artifact.fileName || null,
    fileSizeBytes: artifact.fileSizeBytes ?? null,
    storageUri: artifact.storageUri || null,
    contentHash: artifact.contentHash || null,
    metadata: artifact.metadata || {},
  };
}

function compactArtifactForContext(artifact: AgentContextArtifactRef, includeContent: boolean, maxLength: number, stats: ContextTrimStats, path: string) {
  const ref = artifact.ref || buildAgentArtifactRef(artifact);
  const currentRef = artifact.currentRef || buildAgentArtifactRef(artifact, "current");
  const resource = buildAgentResourceRef(artifact);
  if (resource) {
    return {
      __artifactRef: currentRef,
      ref,
      currentRef,
      artifactType: artifact.artifactType,
      resourceKind: resource.kind,
      mimeType: artifact.mimeType || null,
      fileName: artifact.fileName || null,
      fileSizeBytes: artifact.fileSizeBytes ?? null,
      storageUri: artifact.storageUri || null,
      contentHash: artifact.contentHash || null,
      summary: summarizeArtifactContent(artifact.content),
      metadata: trimContextValueWithOptions(artifact.metadata || {}, {
        maxStringLength: Math.min(maxLength, 1000),
        maxArrayItems: 20,
        maxObjectKeys: 40,
        path: `${path}.metadata`,
        stats,
      }),
    };
  }
  if (!includeContent) return null;
  return trimContextValueWithOptions(artifact.content, {
    maxStringLength: maxLength,
    maxArrayItems: 80,
    maxObjectKeys: 120,
    path,
    stats,
  });
}

function parseAgentArtifactRef(ref: string) {
  const match = ref.match(/^artifact:\/\/([^/]+)\/([^/]+)\/([^@/]+)(?:@(\d+|current))?$/);
  if (!match) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid artifact ref" });
  }
  return {
    runId: match[1],
    nodeId: match[2],
    artifactKey: match[3],
    version: match[4] && match[4] !== "current" ? Number(match[4]) : null,
    current: !match[4] || match[4] === "current",
  };
}

async function findAgentArtifact(input: {
  runId: string;
  nodeId: string;
  artifactKey: string;
  version?: number | null;
  current?: boolean;
}) {
  const params: unknown[] = [input.runId, input.nodeId, input.artifactKey];
  if (input.current || !input.version) {
    let rows = await rawExecute(
      `SELECT * FROM emperor_agent_artifacts
       WHERE runId=? AND nodeId=? AND artifactKey=? AND isCurrent=1
       ORDER BY version DESC LIMIT 1`,
      params,
    );
    if (!rows[0]) {
      rows = await rawExecute(
        `SELECT * FROM emperor_agent_artifacts
         WHERE runId=? AND nodeId=? AND artifactKey=? AND status='final'
         ORDER BY version DESC LIMIT 1`,
        params,
      );
    }
    return rows[0] ? parseAgentArtifactRow(rows[0]) : null;
  }
  const rows = await rawExecute(
    "SELECT * FROM emperor_agent_artifacts WHERE runId=? AND nodeId=? AND artifactKey=? AND version=? LIMIT 1",
    [...params, input.version],
  );
  return rows[0] ? parseAgentArtifactRow(rows[0]) : null;
}

export async function resolveAgentArtifactRef(input: {
  ref: string;
  userId?: number;
  skipOwnerCheck?: boolean;
}) {
  const parsed = parseAgentArtifactRef(input.ref);
  const run = await getRunRow(parsed.runId);
  if (!input.skipOwnerCheck && input.userId && run.userId !== input.userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot read this Artifact" });
  }
  const artifact = await findAgentArtifact(parsed);
  if (!artifact) throw new TRPCError({ code: "NOT_FOUND", message: "Artifact not found" });
  return artifact;
}

export async function selectAgentArtifactVersion(input: {
  runId: string;
  nodeId: string;
  artifactKey: string;
  version: number;
  userId: number;
}) {
  const run = await getRunRow(input.runId);
  if (run.userId !== input.userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot select this Artifact" });
  }
  const artifact = await findAgentArtifact({ ...input, current: false });
  if (!artifact) throw new TRPCError({ code: "NOT_FOUND", message: "Artifact not found" });
  await rawExecute(
    "UPDATE emperor_agent_artifacts SET status='superseded',isCurrent=0,updatedAt=NOW() WHERE runId=? AND nodeId=? AND artifactKey=? AND isCurrent=1",
    [input.runId, input.nodeId, input.artifactKey],
  );
  await rawExecute(
    "UPDATE emperor_agent_artifacts SET status='final',isCurrent=1,currentSince=NOW(),selectedBy=?,updatedAt=NOW() WHERE runId=? AND nodeId=? AND artifactKey=? AND version=?",
    [input.userId, input.runId, input.nodeId, input.artifactKey, input.version],
  );
  await rawExecute(
    "UPDATE emperor_agent_checkpoints SET userEdit=?,updatedAt=NOW() WHERE runId=? AND nodeId=?",
    [stringifyJson(artifact.content), input.runId, input.nodeId],
  );
  await addEvent(input.runId, run.agentSlug, input.nodeId, "artifact.version_selected", `Artifact ${input.artifactKey}@${input.version} 已设为当前版本`, {
    artifactKey: input.artifactKey,
    version: input.version,
  });
  return {
    ...artifact,
    status: "final",
    isCurrent: true,
  };
}

export async function rollbackAgentArtifactVersion(input: {
  runId: string;
  nodeId: string;
  artifactKey: string;
  targetVersion?: number | null;
  userId: number;
}) {
  const run = await getRunRow(input.runId);
  if (run.userId !== input.userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot rollback this Artifact" });
  }
  let targetVersion = input.targetVersion ?? null;
  if (!targetVersion) {
    const current = await findAgentArtifact({ runId: input.runId, nodeId: input.nodeId, artifactKey: input.artifactKey, current: true });
    const rows = await rawExecute(
      `SELECT * FROM emperor_agent_artifacts
       WHERE runId=? AND nodeId=? AND artifactKey=? AND version < ? AND status IN ('final','superseded')
       ORDER BY version DESC LIMIT 1`,
      [input.runId, input.nodeId, input.artifactKey, Number(current?.version || Number.MAX_SAFE_INTEGER)],
    );
    if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "No previous Artifact version to rollback" });
    targetVersion = Number(rows[0].version);
  }
  const selected = await selectAgentArtifactVersion({
    runId: input.runId,
    nodeId: input.nodeId,
    artifactKey: input.artifactKey,
    version: targetVersion,
    userId: input.userId,
  });
  await addEvent(input.runId, run.agentSlug, input.nodeId, "artifact.rollback", `Artifact ${input.artifactKey} 已回滚到 v${targetVersion}`, {
    artifactKey: input.artifactKey,
    version: targetVersion,
    ref: buildAgentArtifactRef(selected),
    currentRef: buildAgentArtifactRef(selected, "current"),
  });
  return selected;
}

type ArtifactDiffEntry = {
  path: string;
  type: "added" | "removed" | "changed";
  before?: unknown;
  after?: unknown;
};

function previewDiffValue(value: unknown): unknown {
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  if (value === null || value === undefined) return value ?? null;
  if (typeof value !== "object") return value;
  try {
    const serialized = JSON.stringify(value);
    return serialized.length > 500 ? { __preview: serialized.slice(0, 500), __truncated: true } : value;
  } catch {
    return String(value).slice(0, 500);
  }
}

function diffValues(before: unknown, after: unknown, path = "$", entries: ArtifactDiffEntry[] = [], limit = 200) {
  if (entries.length >= limit) return entries;
  if (JSON.stringify(before) === JSON.stringify(after)) return entries;
  const beforeIsObject = before && typeof before === "object" && !Array.isArray(before);
  const afterIsObject = after && typeof after === "object" && !Array.isArray(after);
  if (beforeIsObject && afterIsObject) {
    const beforeRecord = before as Record<string, unknown>;
    const afterRecord = after as Record<string, unknown>;
    const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]);
    for (const key of keys) {
      if (entries.length >= limit) break;
      const childPath = `${path}.${key}`;
      if (!(key in beforeRecord)) {
        entries.push({ path: childPath, type: "added", after: previewDiffValue(afterRecord[key]) });
      } else if (!(key in afterRecord)) {
        entries.push({ path: childPath, type: "removed", before: previewDiffValue(beforeRecord[key]) });
      } else {
        diffValues(beforeRecord[key], afterRecord[key], childPath, entries, limit);
      }
    }
    return entries;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const maxLength = Math.max(before.length, after.length);
    for (let index = 0; index < maxLength; index += 1) {
      if (entries.length >= limit) break;
      const childPath = `${path}[${index}]`;
      if (index >= before.length) {
        entries.push({ path: childPath, type: "added", after: previewDiffValue(after[index]) });
      } else if (index >= after.length) {
        entries.push({ path: childPath, type: "removed", before: previewDiffValue(before[index]) });
      } else {
        diffValues(before[index], after[index], childPath, entries, limit);
      }
    }
    return entries;
  }
  entries.push({ path, type: "changed", before: previewDiffValue(before), after: previewDiffValue(after) });
  return entries;
}

export function diffAgentArtifactContent(before: unknown, after: unknown, limit = 200) {
  return diffValues(before, after, "$", [], Math.min(Math.max(Math.floor(limit), 1), 1000));
}

export function estimateAgentHumanEditRate(before: unknown, after: unknown): number {
  if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return 0;
  const beforeText = JSON.stringify(before ?? "");
  const afterText = JSON.stringify(after ?? "");
  const maxLength = Math.max(beforeText.length, afterText.length, 1);
  const lengthDelta = Math.abs(afterText.length - beforeText.length) / maxLength;
  const diffCount = diffAgentArtifactContent(before, after, 1000).length;
  const structuralDelta = Math.min(diffCount / 50, 1);
  return Math.round(Math.min(Math.max(Math.max(lengthDelta, structuralDelta), 0), 1) * 1000) / 1000;
}

export async function diffAgentArtifactVersions(input: {
  runId: string;
  nodeId: string;
  artifactKey: string;
  baseVersion?: number | null;
  targetVersion?: number | "current" | null;
  userId?: number;
  skipOwnerCheck?: boolean;
  limit?: number;
}) {
  const run = await getRunRow(input.runId);
  if (!input.skipOwnerCheck && input.userId && run.userId !== input.userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot diff this Artifact" });
  }
  const target = input.targetVersion && input.targetVersion !== "current"
    ? await findAgentArtifact({ runId: input.runId, nodeId: input.nodeId, artifactKey: input.artifactKey, version: input.targetVersion, current: false })
    : await findAgentArtifact({ runId: input.runId, nodeId: input.nodeId, artifactKey: input.artifactKey, current: true });
  if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Target Artifact not found" });

  let base = input.baseVersion
    ? await findAgentArtifact({ runId: input.runId, nodeId: input.nodeId, artifactKey: input.artifactKey, version: input.baseVersion, current: false })
    : null;
  if (!base) {
    const rows = await rawExecute(
      `SELECT * FROM emperor_agent_artifacts
       WHERE runId=? AND nodeId=? AND artifactKey=? AND version < ?
       ORDER BY version DESC LIMIT 1`,
      [input.runId, input.nodeId, input.artifactKey, Number(target.version || 1)],
    );
    base = rows[0] ? parseAgentArtifactRow(rows[0]) : null;
  }
  if (!base) throw new TRPCError({ code: "NOT_FOUND", message: "Base Artifact not found" });

  const entries = diffAgentArtifactContent(base.content, target.content, input.limit || 200);
  return {
    runId: input.runId,
    nodeId: input.nodeId,
    artifactKey: input.artifactKey,
    base: {
      version: base.version,
      ref: buildAgentArtifactRef(base),
      contentHash: base.contentHash,
    },
    target: {
      version: target.version,
      ref: buildAgentArtifactRef(target),
      contentHash: target.contentHash,
      isCurrent: target.isCurrent,
    },
    changed: entries.length > 0,
    entries,
  };
}

export { AGENT_ARTIFACT_TYPES, asRecord, normalizeArtifactType, firstString, firstNumber, inferArtifactType, normalizeArtifactMetadata, summarizeArtifactContent, contextStringLimit, contextNumberLimit, safeSerialize, pushUnique, ContextTrimStats, ContextTrimOptions, trimContextValueWithOptions, summarizeContextValue, fitValueToTokenBudget, persistAgentArtifact, parseAgentArtifactRow, isCurrentAgentArtifact, artifactResourceKind, buildAgentResourceRef, compactArtifactForContext, parseAgentArtifactRef, findAgentArtifact, ArtifactDiffEntry, previewDiffValue, diffValues };
