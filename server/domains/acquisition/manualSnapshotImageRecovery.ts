import { AcquisitionReviewIdentitySchema, AcquisitionReviewReadInputSchema, AcquisitionReviewImageInputSchema, AcquisitionReviewImageRecoverInputSchema,
  AcquisitionReviewWriteResultSchema, acquisitionReviewHash, acquisitionReviewImageRequestHash, type AcquisitionReviewIdentity, type AcquisitionReviewReadInput,
  type AcquisitionReviewImageInput, type AcquisitionReviewWriteResult } from "../../../shared/acquisitionReview";
import type { AcquisitionMarketplace } from "../../../shared/acquisition";
import { normalizeApifyAmazonArtifact } from "./amazonNormalizer";
import { createManualSnapshotReviewRepository } from "./manualSnapshotReviewRepository";
import { decodeManualSnapshotImageBase64, inspectManualSnapshotImageBytes, manualSnapshotImageBytesHash, manualSnapshotImageStorage,
  ManualSnapshotPreparedImageSchema, ManualSnapshotRawArtifactSchema, type ManualSnapshotPreparedImage } from "./manualSnapshotImageStorage";

export class ManualSnapshotImageRecoveryError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ManualSnapshotImageRecoveryError"; }
}
const fail = (code: string): never => { throw new ManualSnapshotImageRecoveryError(code); };
type JournalState = { final: AcquisitionReviewWriteResult | null; prepared: ManualSnapshotPreparedImage | null };
type ImageSession = {
  stateHash: string;
  snapshot: { id: number; workspaceId: number; runId: number; rawArtifactId: number; asin: string; marketplace: string; sourceHash: string };
  artifact: unknown;
  enabled(): boolean;
  assets: Array<{ id: number; snapshotId: number; workspaceId: number; sourceArtifactId: number; role: string; positionIndex: number; sourceJsonPath: string; sourceUrlHash: string; storageKey: string | null }>;
  journal(operationId: string): { read(): Promise<JournalState>; prepare(prepared: ManualSnapshotPreparedImage): Promise<{ created: boolean; prepared: ManualSnapshotPreparedImage }>;
    cancel(): Promise<AcquisitionReviewWriteResult> };
  completeImage(prepared: ManualSnapshotPreparedImage): Promise<AcquisitionReviewWriteResult>;
};
export type ManualSnapshotImageRecoveryRepository = {
  transaction<T>(identity: AcquisitionReviewIdentity, scope: AcquisitionReviewReadInput, mode: "read" | "write" | "recover", body: (session: ImageSession) => Promise<T>): Promise<T>;
};
export function manualSnapshotImageRequestHash(identity: AcquisitionReviewIdentity, input: AcquisitionReviewImageInput, bytes?: Uint8Array): string {
  if (input.mode === "retry_original") return acquisitionReviewImageRequestHash(identity, input);
  const body = bytes ?? decodeManualSnapshotImageBase64(input.base64);
  return acquisitionReviewImageRequestHash(identity, input, { contentHash: manualSnapshotImageBytesHash(body), byteSize: body.length });
}
function unknown(identity: AcquisitionReviewIdentity, scope: AcquisitionReviewReadInput, operationId: string): AcquisitionReviewWriteResult {
  return AcquisitionReviewWriteResultSchema.parse({ identity, scope, operationId, action: null, status: "unknown", requestHash: null,
    revisionId: null, revisionVersion: null, committedRevisionHash: null, confirmedSnapshotId: null, reasonCode: "OUTCOME_UNKNOWN" });
}
function sameBinding(prepared: ManualSnapshotPreparedImage, identity: AcquisitionReviewIdentity, scope: AcquisitionReviewReadInput, operationId: string) {
  if (acquisitionReviewHash(prepared.identity) !== acquisitionReviewHash(identity) || acquisitionReviewHash(prepared.scope) !== acquisitionReviewHash(scope)
    || prepared.operationId !== operationId) return fail("ACQUISITION_IMAGE_OPERATION_SCOPE_MISMATCH");
}
function safeReceipt(raw: AcquisitionReviewWriteResult, identity: AcquisitionReviewIdentity, scope: AcquisitionReviewReadInput, operationId: string): AcquisitionReviewWriteResult {
  const value = AcquisitionReviewWriteResultSchema.parse(raw);
  if (acquisitionReviewHash(value.identity) !== acquisitionReviewHash(identity) || acquisitionReviewHash(value.scope) !== acquisitionReviewHash(scope)
    || value.operationId !== operationId || value.status === "committed" && value.action !== "image") return fail("ACQUISITION_IMAGE_RECEIPT_SCOPE_MISMATCH");
  return value;
}
function fileMatchesMime(name: string, mime: string): boolean {
  const suffix = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return mime === "image/jpeg" ? ["jpg", "jpeg"].includes(suffix) : suffix === mime.slice(6);
}
const defaults = { repository: createManualSnapshotReviewRepository() as ManualSnapshotImageRecoveryRepository, storage: manualSnapshotImageStorage };

/** Explicit image recovery only. Authorization and CAS are freshly checked by
 * each repository transaction; storage I/O never holds a database transaction.
 * The unique durable prepare ACK is the only authority for a single PUT. */
export function createManualSnapshotImageRecovery(dependencies: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...dependencies };
  async function state(identity: AcquisitionReviewIdentity, scope: AcquisitionReviewReadInput, operationId: string) {
    return deps.repository.transaction(identity, scope, "read", async session => {
      const previous = await session.journal(operationId).read();
      if (previous.prepared) sameBinding(ManualSnapshotPreparedImageSchema.parse(previous.prepared), identity, scope, operationId);
      if (previous.final) safeReceipt(previous.final, identity, scope, operationId);
      return { ...previous, enabled: session.enabled(), stateHash: session.stateHash, snapshot: structuredClone(session.snapshot),
        artifact: structuredClone(session.artifact), assets: structuredClone(session.assets) };
    });
  }
  async function complete(identity: AcquisitionReviewIdentity, scope: AcquisitionReviewReadInput, operationId: string, prepared: ManualSnapshotPreparedImage) {
    return deps.repository.transaction(identity, scope, "recover", async session => {
      const current = await session.journal(operationId).read();
      if (current.final) return safeReceipt(current.final, identity, scope, operationId);
      if (!current.prepared || acquisitionReviewHash(current.prepared) !== acquisitionReviewHash(prepared)) return fail("ACQUISITION_IMAGE_PREPARE_CHANGED");
      return safeReceipt(await session.completeImage(current.prepared), identity, scope, operationId);
    });
  }
  async function upload(rawIdentity: AcquisitionReviewIdentity, rawInput: AcquisitionReviewImageInput): Promise<AcquisitionReviewWriteResult> {
    const identity = AcquisitionReviewIdentitySchema.parse(rawIdentity), input = AcquisitionReviewImageInputSchema.parse(rawInput);
    const scope = AcquisitionReviewReadInputSchema.parse({ expectedWorkspaceId: input.expectedWorkspaceId, expectedProjectId: input.expectedProjectId, snapshotId: input.snapshotId });
    const previous = await state(identity, scope, input.operationId);
    const supplementBytes = input.mode === "supplement" ? decodeManualSnapshotImageBase64(input.base64) : undefined;
    const requestHash = manualSnapshotImageRequestHash(identity, input, supplementBytes);
    if (previous.final) {
      if (previous.final.status === "committed" && previous.final.requestHash !== requestHash) return fail("ACQUISITION_IMAGE_OPERATION_CONTENT_CONFLICT");
      return previous.final;
    }
    if (previous.prepared) {
      if (previous.prepared.requestHash !== requestHash) return fail("ACQUISITION_IMAGE_OPERATION_CONTENT_CONFLICT");
      return unknown(identity, scope, input.operationId); // Never PUT a replay, even if the object is currently missing.
    }
    if (!previous.enabled) return fail("ACQUISITION_REVIEW_WRITES_DISABLED");
    if (previous.stateHash !== input.expectedRevisionHash) return fail("ACQUISITION_REVIEW_REVISION_CONFLICT");
    const snapshot = previous.snapshot;
    if (snapshot.id !== scope.snapshotId || snapshot.workspaceId !== identity.workspaceId || identity.workspaceId !== scope.expectedWorkspaceId) return fail("ACQUISITION_IMAGE_SOURCE_SCOPE_MISMATCH");
    const sourceAsset = input.sourceAssetId === null ? null : previous.assets.find(asset => asset.id === input.sourceAssetId);
    if (input.sourceAssetId !== null && (!sourceAsset || sourceAsset.workspaceId !== identity.workspaceId || sourceAsset.snapshotId !== snapshot.id
      || sourceAsset.sourceArtifactId !== snapshot.rawArtifactId)) return fail("ACQUISITION_IMAGE_SOURCE_SCOPE_MISMATCH");
    let bytes: Buffer, metadata: Awaited<ReturnType<typeof inspectManualSnapshotImageBytes>>, role: ManualSnapshotPreparedImage["role"], sourceJsonPath: string, sourceUrlHash: string;
    if (input.mode === "retry_original") {
      if (sourceAsset?.storageKey !== null) return fail("ACQUISITION_IMAGE_ORIGINAL_ALREADY_STORED");
      const artifact = ManualSnapshotRawArtifactSchema.parse(previous.artifact);
      if (artifact.id !== snapshot.rawArtifactId || artifact.workspaceId !== snapshot.workspaceId || artifact.runId !== snapshot.runId || !sourceAsset) return fail("ACQUISITION_IMAGE_SOURCE_SCOPE_MISMATCH");
      let normalized: ReturnType<typeof normalizeApifyAmazonArtifact>;
      try { normalized = normalizeApifyAmazonArtifact({ bytes: await deps.storage.readRawArtifact(artifact), expectedAsin: snapshot.asin, marketplace: snapshot.marketplace as AcquisitionMarketplace }); }
      catch { return fail("ACQUISITION_IMAGE_ORIGINAL_ARTIFACT_UNVERIFIED"); }
      if (normalized.sourceHash !== snapshot.sourceHash) return fail("ACQUISITION_IMAGE_ORIGINAL_ARTIFACT_UNVERIFIED");
      const matches = normalized.sourceAssets.filter(asset => asset.role === sourceAsset.role && asset.positionIndex === sourceAsset.positionIndex
        && asset.sourcePath === sourceAsset.sourceJsonPath && asset.sourceUrlHash === sourceAsset.sourceUrlHash);
      if (matches.length !== 1 || !["main", "secondary", "aplus", "brand_story"].includes(matches[0].role)) return fail("ACQUISITION_IMAGE_ORIGINAL_REQUIRES_SUPPLEMENT");
      const source = matches[0], fetched = await deps.storage.fetchOriginal(source.sourceUrl, source.sourceUrlHash, identity.workspaceId);
      bytes = fetched.bytes; metadata = fetched.metadata; role = source.role as typeof role; sourceJsonPath = source.sourcePath; sourceUrlHash = source.sourceUrlHash;
    } else {
      bytes = supplementBytes!; metadata = await inspectManualSnapshotImageBytes(bytes);
      if (!fileMatchesMime(input.fileName, metadata.contentType)) return fail("ACQUISITION_IMAGE_FILE_TYPE_MISMATCH");
      role = input.role; sourceJsonPath = `$.manualSupplement.${input.operationId}`;
      sourceUrlHash = acquisitionReviewHash({ kind: "manual_supplement", contentHash: metadata.contentHash });
    }
    const prepared = deps.storage.prepare({ identity, scope, operationId: input.operationId, expectedRevisionHash: input.expectedRevisionHash, requestHash,
      mode: input.mode, sourceAssetId: input.sourceAssetId, role, sourceArtifactId: snapshot.rawArtifactId, sourceJsonPath, sourceUrlHash,
      fileName: input.mode === "supplement" ? input.fileName : null, metadata });
    const permission = await deps.repository.transaction(identity, scope, "write", async session => {
      const journal = session.journal(input.operationId), current = await journal.read();
      if (current.final) return { final: safeReceipt(current.final, identity, scope, input.operationId), created: false };
      if (session.stateHash !== input.expectedRevisionHash) return fail("ACQUISITION_REVIEW_REVISION_CONFLICT");
      const saved = await journal.prepare(prepared);
      if (acquisitionReviewHash(saved.prepared) !== acquisitionReviewHash(prepared)) return fail("ACQUISITION_IMAGE_PREPARE_CHANGED");
      return { final: null, created: saved.created };
    });
    if (permission.final) {
      if (permission.final.status === "committed" && permission.final.requestHash !== requestHash) return fail("ACQUISITION_IMAGE_OPERATION_CONTENT_CONFLICT");
      return permission.final;
    }
    if (!permission.created) return unknown(identity, scope, input.operationId);
    try { await deps.storage.putOnce(prepared, bytes); await deps.storage.readVerified(prepared); }
    catch { return unknown(identity, scope, input.operationId); }
    return complete(identity, scope, input.operationId, prepared);
  }
  async function recover(rawIdentity: AcquisitionReviewIdentity, rawInput: unknown): Promise<AcquisitionReviewWriteResult> {
    const identity = AcquisitionReviewIdentitySchema.parse(rawIdentity), input = AcquisitionReviewImageRecoverInputSchema.parse(rawInput);
    const scope = AcquisitionReviewReadInputSchema.parse({ expectedWorkspaceId: input.expectedWorkspaceId, expectedProjectId: input.expectedProjectId, snapshotId: input.snapshotId });
    if (input.decision === "cancel") return deps.repository.transaction(identity, scope, "recover", async session =>
      safeReceipt(await session.journal(input.operationId).cancel(), identity, scope, input.operationId));
    const previous = await state(identity, scope, input.operationId);
    if (previous.final) return previous.final;
    if (!previous.prepared) return unknown(identity, scope, input.operationId);
    try { await deps.storage.readVerified(previous.prepared); } catch { return unknown(identity, scope, input.operationId); }
    if (input.decision === "check") return unknown(identity, scope, input.operationId);
    return complete(identity, scope, input.operationId, previous.prepared);
  }
  return { upload, recover };
}
export const manualSnapshotImageRecovery = createManualSnapshotImageRecovery();
