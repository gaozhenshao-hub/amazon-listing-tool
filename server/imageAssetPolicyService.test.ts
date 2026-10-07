import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ImageAssetPolicyStore, StoredAsset, StoredPolicy, StoredSourceReference } from "./domains/image/services/imageAssetPolicyService";
import { createImageAssetPolicyService } from "./domains/image/services/imageAssetPolicyService";
import { createImageAssetReceipt } from "./domains/image/services/imageAssetReceipt";

const originalSecret = process.env.JWT_SECRET;
const contentHash = "a".repeat(64);
const evidence = { proofRecordId: "license-17", proofType: "signed_license", grantSummary: "Own-product creative approved for this project." };
const baseScope = { workspaceId: 7, projectId: 51, actorId: 17, actorRole: "user" };

type MemoryState = {
  assets: StoredAsset[];
  sources: StoredSourceReference[];
  policies: StoredPolicy[];
};

function memoryStore(state: MemoryState): ImageAssetPolicyStore {
  let id = 1;
  return {
    async transaction(callback) { return callback({} as never); },
    async lockAuthorizedProject(_tx, input) {
      if (input.workspaceId !== 7 || input.projectId !== 51) throw new Error("unexpected project scope");
      if (input.actorId !== 17 && !["admin", "super_admin"].includes(input.actorRole)) throw new Error("unexpected actor");
    },
    async findAssetByContentHash(_tx, workspaceId, hash) {
      return state.assets.find(asset => asset.workspaceId === workspaceId && asset.contentHash === hash) ?? null;
    },
    async findAssetById(_tx, workspaceId, assetId) {
      return state.assets.find(asset => asset.workspaceId === workspaceId && asset.assetId === assetId) ?? null;
    },
    async insertAsset(_tx, asset) {
      const saved = { ...asset, id: id++ };
      state.assets.push(saved);
      return saved;
    },
    async findSourceReference(_tx, input) {
      return state.sources.find(source => source.workspaceId === input.workspaceId
        && source.projectId === input.projectId && source.sourceReferenceKey === input.sourceReferenceKey) ?? null;
    },
    async insertSourceReference(_tx, source) {
      const saved = { ...source, id: id++ };
      state.sources.push(saved);
      return saved;
    },
    async findLatestPolicy(_tx, input) {
      return state.policies.filter(policy => policy.workspaceId === input.workspaceId
        && policy.projectId === input.projectId && policy.assetId === input.assetId)
        .sort((left, right) => right.revision - left.revision)[0] ?? null;
    },
    async listPolicies() { return [...state.policies].sort((left, right) => right.revision - left.revision); },
    async insertPolicy(_tx, policy) {
      const saved = { ...policy, id: id++ };
      state.policies.push(saved);
      return saved;
    },
  };
}

function receipt(kind: "step4-ref" | "designer" = "step4-ref", userId = 17) {
  return createImageAssetReceipt({
    url: "https://storage.example.invalid/private/owned.png",
    key: "image-workflow/51/step4-ref/owned.png",
    kind,
    projectId: 51,
    userId,
  }).url;
}

function service(state: MemoryState, licenseValid = true, currentEvidenceValid = true) {
  return createImageAssetPolicyService({
    store: memoryStore(state),
    resolveReceiptAsset: async ({ receipt: signed }) => ({
      contentHash,
      storageRef: signed.url,
      contentType: "image/png",
      sizeBytes: 1200,
      width: 1200,
      height: 1200,
    }),
    verifyLicenseEvidence: async () => licenseValid,
    verifyCurrentPolicyEvidence: async () => currentEvidenceValid,
  });
}

beforeEach(() => { process.env.JWT_SECRET = "stage-c-local-test-secret"; });
afterEach(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

describe("Phase C image asset policy service", () => {
  it("shares byte identity while preserving every distinct source role reference", async () => {
    const state: MemoryState = { assets: [], sources: [], policies: [] };
    const subject = service(state);
    const first = await subject.registerReceiptAsset({ ...baseScope, expectedRevision: 0, originKind: "own_product",
      receiptReference: receipt(), requestedUses: ["step4_reference"], licenseEvidence: evidence,
      source: { sourceRole: "main", sourcePosition: 0 } });
    const second = await subject.registerReceiptAsset({ ...baseScope, expectedRevision: first.revision, originKind: "own_product",
      receiptReference: receipt(), requestedUses: ["step4_reference"], licenseEvidence: evidence,
      source: { sourceRole: "aplus", sourceModule: "module-1", sourcePosition: 0 } });

    expect(second.assetId).toBe(first.assetId);
    expect(state.assets).toHaveLength(1);
    expect(state.sources).toHaveLength(2);
    expect(state.sources.map(source => source.sourceRole).sort()).toEqual(["aplus", "main"]);
    expect(new Set(state.sources.map(source => source.sourceReferenceKey)).size).toBe(2);
    expect(state.policies).toHaveLength(1);
  });

  it("requires both a signed receipt and independently verified license evidence before registration", async () => {
    const state: MemoryState = { assets: [], sources: [], policies: [] };
    const subject = service(state, false);
    await expect(subject.registerReceiptAsset({ ...baseScope, expectedRevision: 0, originKind: "own_product",
      receiptReference: receipt(), requestedUses: ["step4_reference"], licenseEvidence: evidence,
      source: { sourceRole: "main", sourcePosition: 0 } })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(state.assets).toHaveLength(0);
    await expect(subject.registerReceiptAsset({ ...baseScope, expectedRevision: 0, originKind: "own_product",
      receiptReference: "https://competitor.invalid/copied.png", requestedUses: ["step4_reference"], licenseEvidence: evidence,
      source: { sourceRole: "main", sourcePosition: 0 } })).rejects.toThrow(/受控上传/);
  });

  it("permits competitor bytes only as research evidence and never as Step 4 material", async () => {
    const state: MemoryState = { assets: [], sources: [], policies: [] };
    const subject = service(state);
    const registered = await subject.registerCompetitorResearchAsset({ ...baseScope, expectedRevision: 0,
      acquisitionRecordId: "candidate-88", verifiedAsset: { contentHash, storageRef: "s3://controlled/research.png" },
      source: { sourceSnapshotId: 91, sourceRole: "aplus", sourceModule: "hero", sourcePosition: 2 } });
    await expect(subject.reviewAssetPolicy({ ...baseScope, actorRole: "admin", assetId: registered.assetId,
      expectedRevision: registered.revision, decision: "approve", allowedUses: ["step4_reference"] }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    const approved = await subject.reviewAssetPolicy({ ...baseScope, actorRole: "admin", assetId: registered.assetId,
      expectedRevision: registered.revision, decision: "approve", allowedUses: ["analysis_reference_only"] });
    await expect(subject.requireCurrentApprovedAssetUse({ ...baseScope, assetId: approved.assetId,
      expectedRevision: approved.revision, allowedUse: "step4_reference" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(subject.requireCurrentApprovedAssetUse({ ...baseScope, assetId: approved.assetId,
      expectedRevision: approved.revision, allowedUse: "analysis_reference_only" })).resolves.toMatchObject({ assetId: approved.assetId });
  });

  it("requires the latest approved policy revision and rejects stale CAS attempts", async () => {
    const state: MemoryState = { assets: [], sources: [], policies: [] };
    const subject = service(state);
    const registered = await subject.registerReceiptAsset({ ...baseScope, expectedRevision: 0, originKind: "own_product",
      receiptReference: receipt(), requestedUses: ["step4_reference"], licenseEvidence: evidence,
      source: { sourceRole: "main", sourcePosition: 0 } });
    await expect(subject.requireCurrentApprovedAssetUse({ ...baseScope, assetId: registered.assetId,
      expectedRevision: registered.revision, allowedUse: "step4_reference" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const approved = await subject.reviewAssetPolicy({ ...baseScope, actorRole: "admin", assetId: registered.assetId,
      expectedRevision: registered.revision, decision: "approve", receiptReference: receipt(), licenseEvidence: evidence });
    await expect(subject.requireCurrentApprovedAssetUse({ ...baseScope, assetId: approved.assetId,
      expectedRevision: registered.revision, allowedUse: "step4_reference" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(subject.requireCurrentApprovedAssetUse({ ...baseScope, assetId: approved.assetId,
      expectedRevision: approved.revision, allowedUse: "step4_reference" })).resolves.toMatchObject({ reviewState: "approved" });
  });

  it("does not let a signed receipt, storage reference, or pending review select a production asset", async () => {
    const state: MemoryState = { assets: [], sources: [], policies: [] };
    const subject = service(state);
    const signed = receipt();
    await expect(subject.requireApprovedReceiptAssetUse({ ...baseScope, receiptReference: signed,
      kind: "step4-ref", allowedUse: "step4_reference" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    const registered = await subject.registerReceiptAsset({ ...baseScope, expectedRevision: 0, originKind: "own_product",
      receiptReference: signed, requestedUses: ["step4_reference"], licenseEvidence: evidence,
      source: { sourceRole: "main", sourcePosition: 0 } });
    await expect(subject.requireApprovedReceiptAssetUse({ ...baseScope, receiptReference: signed,
      kind: "step4-ref", allowedUse: "step4_reference" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const approved = await subject.reviewAssetPolicy({ ...baseScope, actorRole: "admin", assetId: registered.assetId,
      expectedRevision: registered.revision, decision: "approve", receiptReference: signed, licenseEvidence: evidence });
    await expect(subject.requireApprovedReceiptAssetUse({ ...baseScope, receiptReference: signed,
      kind: "step4-ref", allowedUse: "step4_reference" })).resolves.toMatchObject({ assetId: approved.assetId });
  });

  it("fails closed at use time when verified human evidence is revoked or unavailable", async () => {
    const state: MemoryState = { assets: [], sources: [], policies: [] };
    const signed = receipt();
    const setup = service(state, true, true);
    const registered = await setup.registerReceiptAsset({ ...baseScope, expectedRevision: 0, originKind: "own_product",
      receiptReference: signed, requestedUses: ["step4_reference"], licenseEvidence: evidence,
      source: { sourceRole: "main", sourcePosition: 0 } });
    const approved = await setup.reviewAssetPolicy({ ...baseScope, actorRole: "admin", assetId: registered.assetId,
      expectedRevision: registered.revision, decision: "approve", receiptReference: signed, licenseEvidence: evidence });
    await expect(service(state, true, false).requireCurrentApprovedAssetUse({ ...baseScope,
      assetId: approved.assetId, expectedRevision: approved.revision, allowedUse: "step4_reference" }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("default singleton dependencies refuse registration rather than inferring trust from a signed URL", async () => {
    const state: MemoryState = { assets: [], sources: [], policies: [] };
    const subject = createImageAssetPolicyService({ store: memoryStore(state) });
    await expect(subject.registerReceiptAsset({ ...baseScope, expectedRevision: 0, originKind: "own_product",
      receiptReference: receipt(), requestedUses: ["step4_reference"], licenseEvidence: evidence,
      source: { sourceRole: "main", sourcePosition: 0 } })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(state.assets).toHaveLength(0);
  });

  it("fails closed for an old unclassified policy even when a malformed legacy row says approved", async () => {
    const state: MemoryState = {
      assets: [{ id: 1, assetId: "legacy-url", workspaceId: 7, contentHash, storageRef: "https://old-gallery.invalid/img.png", createdBy: 17 }],
      sources: [],
      policies: [{ id: 2, assetId: "legacy-url", workspaceId: 7, projectId: 51, sourceReferenceId: null,
        originKind: "legacy_unclassified", originRecordType: "legacy_url", originRecordId: "https://old-gallery.invalid/img.png",
        contentHash, allowedUsesJson: ["analysis_reference_only"], licenseEvidenceJson: null, reviewState: "approved",
        revision: 1, policyHash: "legacy", createdBy: 17, reviewedBy: 17, reviewedAt: new Date(), reviewNote: null }],
    };
    await expect(service(state).requireCurrentApprovedAssetUse({ ...baseScope, assetId: "legacy-url",
      expectedRevision: 1, allowedUse: "analysis_reference_only" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
