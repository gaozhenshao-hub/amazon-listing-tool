import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { CompetitorAnalysis } from "../../../drizzle/schema/project";
import type { DbExecutor } from "../../repositories/dbClient";
import { competitorRevision } from "../../repositories/project/competitorWritePolicy";
import { encodeResearchJson } from "../../repositories/listing/competitorResearchJobRepository";
import { assertResourceAction } from "../../services/securityGovernance";
import { NormalizedAmazonSnapshotSchema } from "../acquisition/contracts";

const id = z.number().int().positive().safe();
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const scopeSchema = z.object({ workspaceId: id, userId: id, projectId: id,
  asin: z.string().regex(/^[A-Z0-9]{10}$/u), confirmedSnapshotId: id }).strict();
const captureSchema = z.object({ version: z.literal(1), confirmedSnapshotId: id, contentHash: hash, sourceHash: hash }).strict();
type Scope = z.infer<typeof scopeSchema>;
function fail(message: string, code: "PRECONDITION_FAILED" | "CONFLICT" | "NOT_FOUND" | "FORBIDDEN" | "INTERNAL_SERVER_ERROR" = "PRECONDITION_FAILED"): never {
  throw new TRPCError({ code, message: `COMPETITOR_CAPTURE_${message}` });
}
function json(value: unknown): unknown { return typeof value === "string" ? JSON.parse(value) : value; }
function object(value: unknown): Record<string, unknown> {
  const result = json(value);
  if (!result || typeof result !== "object" || Array.isArray(result)) fail("SOURCE_INVALID");
  encodeResearchJson(result);
  return result as Record<string, unknown>;
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, stable(item)]));
  return value;
}

/** Called ONLY inside the acquisition admission/cache transaction. No model,
 * file upload, independent connection, or generic upsert is involved. */
export function createCollectedListingSaver(permission = assertResourceAction) {
  return async function save(input: Scope & { db: DbExecutor }): Promise<{ analysisId: number }> {
    try {
      const { db, ...rawScope } = input;
      const scope = scopeSchema.parse(rawScope);
      async function execute(query: string, values: unknown[] = []) {
        const parts = query.split("?");
        if (parts.length !== values.length + 1) fail("QUERY_INVALID");
        return db.execute(sql.join(parts.flatMap((part, i) => i < values.length ? [sql.raw(part), sql`${values[i]}`] : [sql.raw(part)]), sql.raw("")));
      }
      async function rows(query: string, values: unknown[] = []): Promise<Record<string, unknown>[]> {
        const result = await execute(query, values);
        if (!Array.isArray(result) || !Array.isArray(result[0])) fail("READ_INVALID", "INTERNAL_SERVER_ERROR");
        return result[0];
      }
      const [actor] = await rows("SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE", [scope.userId]);
      if (!actor || actor.id !== scope.userId || actor.status !== "active" || actor.defaultWorkspaceId !== scope.workspaceId || typeof actor.role !== "string") fail("ACTOR_CHANGED", "FORBIDDEN");
      await permission({ actor: { id: scope.userId, role: actor.role, defaultWorkspaceId: scope.workspaceId }, resource: "project", action: "update",
        workspaceId: scope.workspaceId, projectId: scope.projectId, resourceId: scope.projectId,
        authorizationRead: { executor: db, strict: true, lock: true } });
      const [parent] = await rows("SELECT id,userId,workspaceId FROM projects WHERE id=? FOR UPDATE", [scope.projectId]);
      if (!parent || parent.id !== scope.projectId || parent.userId !== scope.userId || parent.workspaceId !== scope.workspaceId) fail("PROJECT_UNAVAILABLE", "NOT_FOUND");
      const [confirmed] = await rows("SELECT id,workspace_id AS workspaceId,snapshot_id AS snapshotId,revision_id AS revisionId,asin,marketplace,content_hash AS contentHash,confirmed_data AS confirmedData,confirmed_asset_ids AS confirmedAssetIds,is_current AS isCurrent FROM acquisition_confirmed_snapshots WHERE id=? AND workspace_id=? FOR SHARE", [scope.confirmedSnapshotId, scope.workspaceId]);
      if (!confirmed || confirmed.id !== scope.confirmedSnapshotId || confirmed.workspaceId !== scope.workspaceId || confirmed.asin !== scope.asin || confirmed.marketplace !== "US" || confirmed.isCurrent !== 1 || confirmed.revisionId !== null) fail("SNAPSHOT_CHANGED", "CONFLICT");
      id.parse(confirmed.snapshotId); hash.parse(confirmed.contentHash);
      const data = NormalizedAmazonSnapshotSchema.parse(json(confirmed.confirmedData));
      const approvedIds = z.array(id).max(1000).parse(json(confirmed.confirmedAssetIds));
      if (new Set(approvedIds).size !== approvedIds.length || data.asin !== scope.asin || data.marketplace !== "US") fail("SNAPSHOT_INVALID");
      const [source] = await rows("SELECT id,workspace_id AS workspaceId,asin,marketplace,raw_artifact_id AS rawArtifactId,normalized_data AS normalizedData FROM acquisition_source_snapshots WHERE id=? AND workspace_id=? FOR SHARE", [confirmed.snapshotId, scope.workspaceId]);
      if (!source || source.id !== confirmed.snapshotId || source.workspaceId !== scope.workspaceId || source.asin !== scope.asin || source.marketplace !== "US"
        || !isDeepStrictEqual(data, NormalizedAmazonSnapshotSchema.parse(json(source.normalizedData)))) fail("SNAPSHOT_SOURCE_MISMATCH");
      id.parse(source.rawArtifactId);
      // v1 contentHash used insertion-order JSON before MySQL normalizes keys.
      // Bind that persisted identity; do not falsely claim it can be recomputed
      // from reordered JSON. The new sourceHash below is canonical and includes
      // the actual saved asset identities used by this projection.
      const assets = await rows("SELECT id,workspace_id AS workspaceId,snapshot_id AS snapshotId,source_artifact_id AS sourceArtifactId,role,position_index AS positionIndex,source_json_path AS sourcePath,source_url_hash AS sourceUrlHash,storage_key AS storageKey,content_hash AS contentHash,review_status AS reviewStatus FROM acquisition_asset_candidates WHERE snapshot_id=? AND workspace_id=? FOR SHARE", [confirmed.snapshotId, scope.workspaceId]);
      const approved = approvedIds.map(assetId => {
        const matches = assets.filter(asset => asset.id === assetId);
        if (matches.length !== 1) fail("ASSET_UNAVAILABLE");
        const asset = matches[0];
        if (asset.workspaceId !== scope.workspaceId || asset.snapshotId !== confirmed.snapshotId || asset.sourceArtifactId !== source.rawArtifactId || asset.reviewStatus !== "approved"
          || typeof asset.storageKey !== "string" || !asset.storageKey.trim() || !hash.safeParse(asset.contentHash).success
          || !data.assets.some(ref => ref.role === asset.role && ref.positionIndex === asset.positionIndex && ref.sourcePath === asset.sourcePath && ref.sourceUrlHash === asset.sourceUrlHash)) fail("ASSET_INVALID");
        return asset;
      }).sort((a, b) => Number(a.id) - Number(b.id));
      const gallery = approved.filter(asset => asset.role === "main" || asset.role === "secondary")
        .sort((a, b) => (a.role === b.role ? Number(a.positionIndex) - Number(b.positionIndex) : a.role === "main" ? -1 : 1)).map(asset => asset.storageKey);
      const sourceHash = createHash("sha256").update(encodeResearchJson(stable({ data, assets: approved }), 512 * 1024)).digest("hex");
      const capture = { version: 1 as const, confirmedSnapshotId: scope.confirmedSnapshotId, contentHash: confirmed.contentHash as string, sourceHash };
      const matches = await rows("SELECT * FROM competitorAnalyses WHERE projectId=? AND asin=? LIMIT 2 FOR UPDATE", [scope.projectId, scope.asin]);
      if (matches.length > 1) fail("DUPLICATE_RECORD", "CONFLICT");
      const existing = matches[0] as CompetitorAnalysis | undefined;
      const oldRaw = existing?.rawData ? object(existing.rawData) : {};
      if (existing) {
        competitorRevision(existing);
        if (existing.projectId !== scope.projectId || existing.asin !== scope.asin) fail("IDENTITY_CHANGED", "CONFLICT");
        if (oldRaw.acquisitionCapture !== undefined) {
          const previous = captureSchema.parse(oldRaw.acquisitionCapture);
          if (previous.confirmedSnapshotId > scope.confirmedSnapshotId) fail("OLDER_SNAPSHOT", "CONFLICT");
          if (previous.confirmedSnapshotId === scope.confirmedSnapshotId && !isDeepStrictEqual(previous, capture)) fail("SNAPSHOT_CHANGED", "CONFLICT");
        }
      }
      const values = { title: data.title, bulletPoints: encodeResearchJson(data.bulletPoints), imageUrls: encodeResearchJson(gallery),
        price: data.price ? `${data.price.value} ${data.price.currency}` : null, rating: data.rating, reviewCount: data.reviewCount === null ? null : String(data.reviewCount) };
      for (const [key, maximum] of [["title", 65535], ["price", 50], ["rating", 10], ["reviewCount", 20]] as const) {
        if (values[key] !== null && Buffer.byteLength(values[key], "utf8") > maximum) fail("VALUE_TOO_LARGE");
      }
      const sourceUnchanged = existing && isDeepStrictEqual(oldRaw.acquisitionCapture, capture)
        && Object.entries(values).every(([key, value]) => existing[key as keyof CompetitorAnalysis] === value)
        && oldRaw.source === "unified_amazon_acquisition" && oldRaw.confirmedSnapshotId === scope.confirmedSnapshotId && oldRaw.contentHash === confirmed.contentHash;
      if (sourceUnchanged) return { analysisId: existing.id };
      const rawData = encodeResearchJson({ ...oldRaw, source: "unified_amazon_acquisition", confirmedSnapshotId: scope.confirmedSnapshotId,
        contentHash: confirmed.contentHash, acquisitionCapture: capture, captureOnly: true, analysisStale: true });
      const columns = { ...values, rawData };
      let analysisId: number;
      if (existing) {
        const result = await execute("UPDATE competitorAnalyses SET title=?,bulletPoints=?,imageUrls=?,price=?,rating=?,reviewCount=?,rawData=?,updatedAt=CURRENT_TIMESTAMP WHERE id=? AND projectId=?", [...Object.values(columns), existing.id, scope.projectId]);
        if (result?.[0]?.affectedRows !== 1 || result[0].warningStatus !== 0) fail("WRITE_NOT_ACKNOWLEDGED", "CONFLICT");
        analysisId = existing.id;
      } else {
        const result = await execute("INSERT INTO competitorAnalyses (projectId,asin,title,bulletPoints,imageUrls,price,rating,reviewCount,rawData) VALUES (?,?,?,?,?,?,?,?,?)", [scope.projectId, scope.asin, ...Object.values(columns)]);
        if (result?.[0]?.affectedRows !== 1 || result[0].warningStatus !== 0 || !id.safeParse(result[0].insertId).success) fail("WRITE_NOT_ACKNOWLEDGED", "CONFLICT");
        analysisId = result[0].insertId;
      }
      const [saved] = await rows("SELECT * FROM competitorAnalyses WHERE id=? AND projectId=? FOR UPDATE", [analysisId, scope.projectId]);
      if (!saved || saved.id !== analysisId || saved.projectId !== scope.projectId || saved.asin !== scope.asin || Object.entries(columns).some(([key, value]) => saved[key] !== value)) fail("READBACK_FAILED", "CONFLICT");
      competitorRevision(saved as CompetitorAnalysis);
      if (existing && ["reviewAnalysis", "keywords", "aiSummary", "summary", "summaryStatus", "summaryVersion", "summaryConfirmedBy", "summaryConfirmedAt"].some(key => !isDeepStrictEqual(existing[key as keyof CompetitorAnalysis], saved[key]))) fail("HISTORY_CHANGED", "CONFLICT");
      return { analysisId };
    } catch (error) {
      if (error instanceof TRPCError && error.message.startsWith("COMPETITOR_CAPTURE_")) throw error;
      if (error instanceof TRPCError && error.code === "FORBIDDEN") fail("ACCESS_DENIED", "FORBIDDEN");
      if (error instanceof z.ZodError || error instanceof SyntaxError) fail("SOURCE_INVALID");
      fail("SAVE_FAILED", "INTERNAL_SERVER_ERROR");
    }
  };
}

export const saveCollectedListing = createCollectedListingSaver();
