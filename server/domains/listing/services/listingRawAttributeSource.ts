import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { aiArtifacts } from "../../../../drizzle/schema/ai_os";
import { getDb } from "../../../repositories/dbClient";
import { parseStorageUri, storageGet } from "../../../storage";
import { safeHttpRequest } from "../../../infrastructure/http/safeHttpClient";

type RawAttributeFile = {
  id?: number;
  projectId?: number;
  userId?: number;
  workspaceId?: number | null;
  fileType?: string;
  rawContent?: string | null;
  rawContentHash?: string | null;
  rawStorageUri?: string | null;
};
const maximumSourceBytes = 2 * 1024 * 1024;
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const sourceHash = (text: string) => createHash("sha256").update(JSON.stringify(text)).digest("hex");
const incompleteSource = () => new Error("产品属性原文仅有截断预览或已失去完整来源；请重新选择画像生成、补充导入或人工核实资料");

/** Dedicated inline lookup only. This must never use an artifact resolver that
 * can hydrate an external URI, or fall back to an unverified 4,000-char preview. */
async function readInlineAttributeText(file: RawAttributeFile, workspaceId: number | null, preview: string) {
  if (!positiveId(file.id) || !positiveId(file.projectId) || !positiveId(file.userId)
    || (workspaceId !== null && !positiveId(workspaceId)) || file.workspaceId !== workspaceId
    || file.fileType !== "product_attributes" || !/^[a-f0-9]{64}$/.test(file.rawContentHash ?? "")) throw incompleteSource();
  const database = await getDb();
  if (!database) throw incompleteSource();
  const rows = await database.select({
    workspaceId: aiArtifacts.workspaceId, domain: aiArtifacts.domain, artifactKey: aiArtifacts.artifactKey,
    sourceTable: aiArtifacts.sourceTable, sourceRowId: aiArtifacts.sourceRowId, sourceId: aiArtifacts.sourceId,
    projectId: aiArtifacts.projectId, userId: aiArtifacts.userId, runId: aiArtifacts.runId, nodeId: aiArtifacts.nodeId,
    status: aiArtifacts.status, isCurrent: aiArtifacts.isCurrent, contentHash: aiArtifacts.contentHash,
    contentJsonText: sql<string>`CAST(${aiArtifacts.contentJson} AS CHAR CHARACTER SET utf8mb4)`,
  }).from(aiArtifacts).where(and(
    workspaceId === null ? isNull(aiArtifacts.workspaceId) : eq(aiArtifacts.workspaceId, workspaceId),
    eq(aiArtifacts.domain, "listing"), eq(aiArtifacts.artifactKey, "project_file.product_attributes.raw"),
    eq(aiArtifacts.sourceTable, "projectFiles"), eq(aiArtifacts.sourceRowId, String(file.id)), eq(aiArtifacts.sourceId, String(file.id)),
    eq(aiArtifacts.projectId, file.projectId), eq(aiArtifacts.userId, file.userId),
    isNull(aiArtifacts.runId), isNull(aiArtifacts.nodeId), eq(aiArtifacts.status, "final"), eq(aiArtifacts.isCurrent, 1),
  )).limit(2);
  if (!Array.isArray(rows) || rows.length !== 1) throw incompleteSource();
  const artifact = rows[0];
  // Keep readback checks even though the real SQL applies the same predicates.
  if (artifact.workspaceId !== workspaceId || artifact.domain !== "listing" || artifact.artifactKey !== "project_file.product_attributes.raw"
    || artifact.sourceTable !== "projectFiles" || artifact.sourceRowId !== String(file.id) || artifact.sourceId !== String(file.id)
    || artifact.projectId !== file.projectId || artifact.userId !== file.userId || artifact.runId !== null || artifact.nodeId !== null
    || artifact.status !== "final" || artifact.isCurrent !== 1 || artifact.contentHash !== file.rawContentHash
    || typeof artifact.contentJsonText !== "string") throw incompleteSource();
  let full: unknown;
  try { full = JSON.parse(artifact.contentJsonText); } catch { throw incompleteSource(); }
  if (typeof full !== "string" || !full.trim() || Buffer.byteLength(full, "utf8") > maximumSourceBytes) throw incompleteSource();
  const normalized = full.replace(/\r\n?/gu, "\n").trim();
  if (sourceHash(normalized) !== file.rawContentHash || (preview && !normalized.startsWith(preview))) {
    throw new Error("产品属性原始来源指纹不匹配，停止事实核验");
  }
  return normalized;
}

/** projectFile.rawContent is only a 4,000-character preview. Never compare AI
 * extraction to that preview if its actual source may extend beyond 4,000. */
export async function readCompleteAttributeText(file: RawAttributeFile, workspaceId: number | null): Promise<string> {
  const preview = file.rawContent || "";
  if (preview.length > 0 && preview.length < 4_000) return preview;
  if (!file.rawStorageUri) return readInlineAttributeText(file, workspaceId, preview);
  if (!file.rawContentHash) throw incompleteSource();
  const parsed = parseStorageUri(file.rawStorageUri);
  if (!parsed || !new Set(["forge", "s3", "oss"]).has(parsed.provider)) {
    throw new Error("产品属性原始存储路径不受控，停止事实核验");
  }
  const { url: signedUrl } = await storageGet(parsed.key, { expectedProvider: parsed.provider });
  const url = new URL(signedUrl);
  const response = await safeHttpRequest(url, {
    method: "GET", timeoutMs: 20_000, maxResponseBytes: maximumSourceBytes,
    allowedHosts: [url.hostname],
    auditContext: { workspaceId, operation: "listing.product_attribute_source.read" },
  });
  if (!response.ok) throw new Error("完整属性原文暂时不可读取，停止事实核验");
  const full = await response.text();
  const normalized = full.replace(/\r\n?/gu, "\n").trim();
  const hash = sourceHash(normalized);
  if (hash !== file.rawContentHash || (preview && !normalized.startsWith(preview))) {
    throw new Error("产品属性原始来源指纹不匹配，停止事实核验");
  }
  return normalized;
}
