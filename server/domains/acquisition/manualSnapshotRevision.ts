import { z } from "zod";
import type { SQL } from "drizzle-orm";
import type { AcquisitionReviewIdentity } from "../../../shared/acquisitionReview";
import { ACQUISITION_ASSET_ROLES } from "../../../shared/acquisition";
import { AcquisitionReviewDecisionsSchema, AcquisitionReviewPatchSchema, AcquisitionReviewReadInputSchema,
  acquisitionReviewCanonical, acquisitionReviewHash } from "../../../shared/acquisitionReview";
import { NormalizedAmazonSnapshotSchema } from "./contracts";

const id = z.number().int().min(1).max(2147483647), hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const ManualSnapshotSupplementSchema = z.object({ assetId: id, replacesAssetId: id.nullable(),
  operationId: z.string().uuid(), mode: z.enum(["retry_original", "supplement"]), sourceArtifactId: id,
  role: z.enum(ACQUISITION_ASSET_ROLES), positionIndex: z.number().int().nonnegative(), sourceJsonPath: z.string().min(1).max(512),
  sourceUrlHash: hash, storageKey: z.string().min(1).max(1024), contentHash: hash, contentType: z.string().min(1).max(128),
  sizeBytes: id, width: id.nullable(), height: id.nullable(),
}).strict();
export const ManualSnapshotRevisionSchema = z.object({ version: z.literal(1), kind: z.literal("manual_acquisition_review_v1"),
  scope: AcquisitionReviewReadInputSchema, userId: id, jobId: id, consumerType: z.string().min(1).max(64), consumerRef: z.string().min(1).max(128),
  baseSourceHash: hash, originalHash: hash, originalAssetIds: z.array(id).max(300), originalAssetsHash: hash, consumerLinksHash: hash,
  previousRevisionHash: hash.nullable(), revisionVersion: id, operationId: z.string().uuid(), createdAt: z.string().datetime(),
  status: z.enum(["pending_review", "confirmed", "rejected"]), patch: AcquisitionReviewPatchSchema,
  assetDecisions: AcquisitionReviewDecisionsSchema, supplements: z.array(ManualSnapshotSupplementSchema).max(300),
  note: z.string().min(1).max(2000).nullable(),
}).strict();
export type ManualSnapshotRevision = z.infer<typeof ManualSnapshotRevisionSchema>;
export type ManualSnapshotSupplement = z.infer<typeof ManualSnapshotSupplementSchema>;
export type ManualSnapshotSource = { id: number; workspaceId: number; jobId: number; sourceHash: string; normalizedData: unknown; rawArtifactId: number; asin: string; marketplace: string };
export type ManualSnapshotAsset = { id: number; workspaceId: number; snapshotId: number; sourceArtifactId: number; role: string; positionIndex: number;
  sourceJsonPath: string; sourceUrlHash: string; storageKey: string | null; contentHash: string | null; contentType: string | null;
  sizeBytes: number | null; width: number | null; height: number | null; fieldStatus: string; reviewStatus: string;
  providerAssetId: string | null; moduleType: string | null; moduleClass: string | null; reviewedBy: number | null; reviewedAt: string | null; createdAt: string; updatedAt: string };
export type ManualSnapshotRevisionRow = { id: number; workspaceId: number; snapshotId: number; version: number; baseContentHash: string;
  patch: unknown; revisionHash: string; reasonCode: string; note: string | null; createdBy: number; createdAt: string };
export interface ManualSnapshotReviewExecutor { execute(query: SQL): Promise<unknown> }
export type ManualSnapshotJob = { id: number; workspaceId: number; requestedBy: number; consumerType: string; consumerRef: string; marketplace: string; asin: string;
  status: string; requestedCapabilities: unknown; runId?: number };
export type ManualSnapshotLoadedSource = ManualSnapshotSource & { runId: number; marketplace: string; status: string; fieldStatuses: unknown; completeness: unknown; reviewedBy: number | null; reviewedAt: string | null; reviewNote: string | null; createdAt: string; updatedAt: string };
export interface ManualSnapshotPublishContext {
  tx: ManualSnapshotReviewExecutor; identity: AcquisitionReviewIdentity; actor: { id: number; role: string; defaultWorkspaceId: number };
  job: ManualSnapshotJob; snapshot: ManualSnapshotLoadedSource; revision: ManualSnapshotRevisionRow; envelope: ManualSnapshotRevision;
  effectiveData: Record<string, unknown>; assets: ManualSnapshotAsset[]; allAssets: ManualSnapshotAsset[]; confirmedSnapshotId: number;
}
function invalid(): never { throw new Error("ACQUISITION_REVIEW_REVISION_INVALID"); }
const stamp = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/u);
export const ManualSnapshotAssetSchema = z.object({ id, workspaceId: id, snapshotId: id, sourceArtifactId: id, role: z.enum(ACQUISITION_ASSET_ROLES),
  positionIndex: z.number().int().min(0).max(2147483647), sourceJsonPath: z.string().min(1).max(512), sourceUrlHash: hash,
  storageKey: z.string().min(1).max(1024).nullable(), contentHash: hash.nullable(), contentType: z.string().min(1).max(128).nullable(),
  sizeBytes: z.number().int().positive().max(15 * 1024 * 1024).nullable(), width: id.nullable(), height: id.nullable(),
  fieldStatus: z.string().min(1).max(64), reviewStatus: z.enum(["pending", "approved", "rejected"]), providerAssetId: z.string().max(255).nullable(),
  moduleType: z.string().max(64).nullable(), moduleClass: z.string().max(128).nullable(), reviewedBy: id.nullable(), reviewedAt: stamp.nullable(), createdAt: stamp, updatedAt: stamp,
}).strict();
export function manualSnapshotObject(value: unknown): Record<string, unknown> {
  const result: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (!result || typeof result !== "object" || Array.isArray(result)) invalid();
  acquisitionReviewCanonical(result); return result as Record<string, unknown>;
}
/** Original JSON is retained in full, including provider research/unknown keys.
 * The normalizer's schema validates its known projection but must not strip it. */
export function applyManualSnapshotRevision(source: ManualSnapshotSource, assets: ManualSnapshotAsset[], raw: ManualSnapshotRevision) {
  const revision = ManualSnapshotRevisionSchema.parse(raw), original = manualSnapshotObject(source.normalizedData);
  NormalizedAmazonSnapshotSchema.parse(original);
  assets.forEach(asset => ManualSnapshotAssetSchema.parse(asset));
  if (revision.scope.snapshotId !== source.id || revision.scope.expectedWorkspaceId !== source.workspaceId || revision.jobId !== source.jobId
    || revision.baseSourceHash !== source.sourceHash || revision.originalHash !== acquisitionReviewHash(original)
    || assets.length > 300 || new Set(assets.map(asset => asset.id)).size !== assets.length
    || assets.some(asset => asset.workspaceId !== source.workspaceId || asset.snapshotId !== source.id)
    || new Set(revision.originalAssetIds).size !== revision.originalAssetIds.length) invalid();
  const originals = revision.originalAssetIds.map(assetId => assets.find(asset => asset.id === assetId) ?? invalid());
  if (acquisitionReviewHash(originals) !== revision.originalAssetsHash) invalid();
  const added = new Set<number>();
  for (const supplement of revision.supplements) {
    const asset = assets.find(item => item.id === supplement.assetId);
    if (!asset || added.has(asset.id) || revision.originalAssetIds.includes(asset.id) || supplement.sourceArtifactId !== source.rawArtifactId
      || supplement.replacesAssetId !== null && !assets.some(item => item.id === supplement.replacesAssetId)) invalid();
    added.add(asset.id);
    const { operationId: _operation, mode: _mode, replacesAssetId: _replaces, assetId: _asset, ...bound } = supplement;
    if (Object.entries(bound).some(([key, value]) => asset[key as keyof ManualSnapshotAsset] !== value)) invalid();
  }
  const ids = [...revision.originalAssetIds, ...added];
  if (ids.length !== assets.length || revision.assetDecisions.length !== ids.length
    || revision.assetDecisions.some(decision => !ids.includes(decision.assetId))) invalid();
  const selectedAssets = revision.assetDecisions.filter(item => item.decision === "keep").map(item => assets.find(asset => asset.id === item.assetId) ?? invalid());
  if (selectedAssets.some(asset => !asset.storageKey || !asset.contentHash || asset.fieldStatus !== "pending_review"
    || !asset.storageKey.startsWith(`storage://s3/acquisition/${source.workspaceId}/snapshots/${source.id}/`)
      && !asset.storageKey.startsWith(`storage://oss/acquisition/${source.workspaceId}/snapshots/${source.id}/`)
      && !asset.storageKey.startsWith(`storage://local/acquisition/${source.workspaceId}/snapshots/${source.id}/`)
      && !asset.storageKey.startsWith(`storage://s3/acquisition-review/${source.workspaceId}/snapshots/${source.id}/`)
      && !asset.storageKey.startsWith(`storage://oss/acquisition-review/${source.workspaceId}/snapshots/${source.id}/`))) invalid();
  const baseRefs = Array.isArray(original.assets) ? original.assets : invalid();
  const fieldEvidence = { ...manualSnapshotObject(original.fieldEvidence) };
  for (const [key, value] of Object.entries(revision.patch)) fieldEvidence[key] = {
    status: "pending_review", sourcePath: `manual_revision:${revision.operationId}:${key}`,
    valueHash: acquisitionReviewHash(value), noteCode: "manual_revision",
  };
  const effectiveData = { ...original, ...revision.patch, fieldEvidence, assets: [...baseRefs, ...revision.supplements.map(supplement => ({
    role: supplement.role, positionIndex: supplement.positionIndex, sourcePath: supplement.sourceJsonPath, sourceUrlHash: supplement.sourceUrlHash,
    providerAssetId: null, moduleType: null, moduleClass: null,
  }))] };
  NormalizedAmazonSnapshotSchema.parse(effectiveData); acquisitionReviewCanonical(effectiveData);
  return { revision, original, effectiveData, selectedAssets };
}
export function replayManualSnapshotRevision(input: { snapshot: ManualSnapshotSource; assets: ManualSnapshotAsset[]; revision: ManualSnapshotRevisionRow }) {
  const row = input.revision, envelope = ManualSnapshotRevisionSchema.parse(manualSnapshotObject(row.patch));
  if (row.workspaceId !== input.snapshot.workspaceId || row.snapshotId !== input.snapshot.id || row.baseContentHash !== input.snapshot.sourceHash
    || row.version !== envelope.revisionVersion || row.createdBy !== envelope.userId || row.note !== envelope.note
    || row.reasonCode !== "manual_review_v1" || row.revisionHash !== acquisitionReviewHash(envelope)) invalid();
  return applyManualSnapshotRevision(input.snapshot, input.assets, envelope);
}
