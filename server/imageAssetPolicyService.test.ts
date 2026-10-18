import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbExecutor } from "./repositories/dbClient";
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

async function approvedState(origin: "own_product" | "competitor_reference" = "own_product") {
  const state: MemoryState = { assets: [], sources: [], policies: [] };
  const setup = service(state);
  const registered = origin === "own_product"
    ? await setup.registerReceiptAsset({ ...baseScope, expectedRevision: 0, originKind: "own_product",
      receiptReference: receipt(), requestedUses: ["step4_reference"], licenseEvidence: evidence,
      source: { sourceRole: "main", sourcePosition: 0 } })
    : await setup.registerCompetitorResearchAsset({ ...baseScope, expectedRevision: 0,
      acquisitionRecordId: "candidate-88", verifiedAsset: { contentHash, storageRef: "storage://forge/research.png" },
      source: { sourceSnapshotId: 91, sourceRole: "main", sourcePosition: 0 } });
  const approved = await setup.reviewAssetPolicy({ ...baseScope, actorRole: "admin", assetId: registered.assetId,
    expectedRevision: registered.revision, decision: "approve",
    allowedUses: origin === "own_product" ? ["step4_reference"] : ["analysis_reference_only"] });
  return { state, setup, input: { ...baseScope, assetId: approved.assetId, expectedRevision: approved.revision,
    allowedUse: origin === "own_product" ? "step4_reference" as const : "analysis_reference_only" as const } };
}

beforeEach(() => { process.env.JWT_SECRET = "stage-c-local-test-secret"; });
afterEach(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

describe("Phase C image asset policy service", () => {
  it("lists identical latest summaries in the supplied transaction without exposing older evidence or taking ownership", async () => {
    const { state, setup } = await approvedState();
    const expected = await setup.listCurrentPolicies(baseScope);
    const before = structuredClone(state);
    const tx = {} as DbExecutor;
    const store = memoryStore(state);
    const transaction = vi.fn(async () => { throw new Error("nested transaction forbidden"); });
    const order: string[] = [];
    const subject = createImageAssetPolicyService({ store: { ...store, transaction,
      async lockAuthorizedProject(actualTx, input) { expect(actualTx).toBe(tx); order.push("project"); return store.lockAuthorizedProject(actualTx, input); },
      async listPolicies(actualTx, input) { expect(actualTx).toBe(tx); order.push("policies"); return store.listPolicies(actualTx, input); },
    } });
    await expect(subject.listCurrentPoliciesInTransaction(tx, baseScope)).resolves.toEqual(expected);
    expect(expected).toHaveLength(1);
    expect(expected[0].revision).toBe(2);
    expect(JSON.stringify(expected)).not.toContain(evidence.grantSummary);
    expect(order).toEqual(["project", "policies"]);
    expect(transaction).not.toHaveBeenCalled();
    expect(state).toEqual(before);
  });

  it.each(["workspace", "actor"] as const)("keeps %s denial before reading policy summaries in the caller transaction", async failure => {
    const { state } = await approvedState();
    const store = memoryStore(state);
    const list = vi.spyOn(store, "listPolicies");
    const transaction = vi.spyOn(store, "transaction");
    const subject = createImageAssetPolicyService({ store });
    await expect(subject.listCurrentPoliciesInTransaction({} as DbExecutor, { ...baseScope,
      ...(failure === "workspace" ? { workspaceId: 8 } : { actorId: 18 }),
    })).rejects.toThrow(failure === "workspace" ? "unexpected project scope" : "unexpected actor");
    expect(list).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("keeps legacy list transaction ownership and fails before reads if a caller transaction is missing", async () => {
    const { state } = await approvedState();
    const store = memoryStore(state);
    const transaction = vi.spyOn(store, "transaction");
    const subject = createImageAssetPolicyService({ store });
    await expect(subject.listCurrentPolicies(baseScope)).resolves.toHaveLength(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    const lock = vi.spyOn(store, "lockAuthorizedProject");
    await expect(subject.listCurrentPoliciesInTransaction(null as unknown as DbExecutor, baseScope)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(lock).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("uses exactly the caller transaction for policy and evidence without calling either legacy transaction path", async () => {
    const { state, setup, input } = await approvedState();
    const expected = await setup.requireCurrentApprovedAssetUse(input);
    const before = structuredClone(state);
    const tx = {} as DbExecutor;
    const store = memoryStore(state);
    const transaction = vi.fn(async () => { throw new Error("nested transaction forbidden"); });
    const legacyVerifier = vi.fn(async () => { throw new Error("legacy verifier forbidden"); });
    const order: string[] = [];
    const verifier = vi.fn(async (actualTx, actualInput) => {
      expect(actualTx).toBe(tx);
      expect(actualInput).toMatchObject({ workspaceId: 7, projectId: 51, originKind: "own_product", evidence });
      order.push("evidence");
      return true;
    });
    const subject = createImageAssetPolicyService({ store: { ...store, transaction,
      async lockAuthorizedProject(actualTx, value) { expect(actualTx).toBe(tx); order.push("project"); return store.lockAuthorizedProject(actualTx, value); },
      async findAssetById(actualTx, ...args) { expect(actualTx).toBe(tx); order.push("asset"); return store.findAssetById(actualTx, ...args); },
      async findLatestPolicy(actualTx, value) { expect(actualTx).toBe(tx); order.push("policy"); return store.findLatestPolicy(actualTx, value); },
    }, verifyCurrentPolicyEvidence: legacyVerifier, verifyCurrentPolicyEvidenceInTransaction: verifier });
    await expect(subject.requireCurrentApprovedAssetUseInTransaction(tx, input)).resolves.toEqual(expected);
    expect(order).toEqual(["project", "asset", "policy", "evidence"]);
    expect(transaction).not.toHaveBeenCalled();
    expect(legacyVerifier).not.toHaveBeenCalled();
    expect(verifier).toHaveBeenCalledTimes(1);
    expect(state).toEqual(before);
  });

  it("never falls back to the legacy verifier when the explicit transaction verifier is missing", async () => {
    const { state, input } = await approvedState();
    const legacyVerifier = vi.fn(async () => true);
    const transaction = vi.fn(async () => { throw new Error("nested transaction forbidden"); });
    const subject = createImageAssetPolicyService({ store: { ...memoryStore(state), transaction }, verifyCurrentPolicyEvidence: legacyVerifier });
    await expect(subject.requireCurrentApprovedAssetUseInTransaction({} as DbExecutor, input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(legacyVerifier).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each(["revision", "revoked", "scope", "actor", "use", "evidence"] as const)("preserves the existing %s rejection in the transaction bridge", async failure => {
    const { state, setup, input } = await approvedState();
    if (failure === "revision") input.expectedRevision -= 1;
    if (failure === "revoked") state.policies[state.policies.length - 1].reviewState = "revoked";
    if (failure === "scope") input.workspaceId = 8;
    if (failure === "actor") input.actorId = 18;
    if (failure === "use") input.allowedUse = "analysis_reference_only";
    const original = failure === "evidence" ? service(state, true, false) : setup;
    const before = structuredClone(state);
    const transaction = vi.fn(async () => { throw new Error("nested transaction forbidden"); });
    const subject = createImageAssetPolicyService({ store: { ...memoryStore(state), transaction },
      verifyCurrentPolicyEvidenceInTransaction: async () => failure !== "evidence" });
    const legacyOutcome = await original.requireCurrentApprovedAssetUse(input).then(() => null, (error: Error) => error);
    expect(legacyOutcome).toBeInstanceOf(Error);
    await expect(subject.requireCurrentApprovedAssetUseInTransaction({} as DbExecutor, input)).rejects.toThrow(legacyOutcome!.message);
    expect(transaction).not.toHaveBeenCalled();
    expect(state).toEqual(before);
  });

  it("keeps competitor research evidence analysis-only without invoking a production license verifier", async () => {
    const { state, input } = await approvedState("competitor_reference");
    const verifier = vi.fn(async () => { throw new Error("unexpected license lookup"); });
    const subject = createImageAssetPolicyService({ store: memoryStore(state), verifyCurrentPolicyEvidenceInTransaction: verifier });
    await expect(subject.requireCurrentApprovedAssetUseInTransaction({} as DbExecutor, input)).resolves.toMatchObject({ originKind: "competitor_research" });
    await expect(subject.requireCurrentApprovedAssetUseInTransaction({} as DbExecutor, { ...input, allowedUse: "step4_reference" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(verifier).not.toHaveBeenCalled();
  });

  it("keeps the legacy public transaction ownership and verifier unchanged", async () => {
    const { state, input } = await approvedState();
    const store = memoryStore(state);
    const transaction = vi.spyOn(store, "transaction");
    const legacyVerifier = vi.fn(async () => true);
    const txVerifier = vi.fn(async () => { throw new Error("unexpected new path"); });
    const subject = createImageAssetPolicyService({ store, verifyCurrentPolicyEvidence: legacyVerifier, verifyCurrentPolicyEvidenceInTransaction: txVerifier });
    await expect(subject.requireCurrentApprovedAssetUse(input)).resolves.toMatchObject({ reviewState: "approved" });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(legacyVerifier).toHaveBeenCalledTimes(1);
    expect(txVerifier).not.toHaveBeenCalled();
  });

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
      expectedRevision: registered.revision, decision: "approve", licenseEvidence: evidence });
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
      expectedRevision: registered.revision, decision: "approve", licenseEvidence: evidence });
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
      expectedRevision: registered.revision, decision: "approve", licenseEvidence: evidence });
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
