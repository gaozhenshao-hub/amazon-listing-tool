import { createHash } from "node:crypto";
import sharp from "sharp";
import { getTableName, type Table } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbExecutor } from "./repositories/dbClient";
import { createImageAssetReceipt } from "./domains/image/services/imageAssetReceipt";
import { createImageAssetPolicyService } from "./domains/image/services/imageAssetPolicyService";
import {
  createImageAssetTrustLedgerService,
  type ImageAssetTrustLedgerStore,
  type StoredEvidence,
  type StoredReceipt,
  type VerifyCurrentPolicyEvidenceInput,
} from "./domains/image/services/imageAssetTrustLedgerService";

const originalSecret = process.env.JWT_SECRET;
const baseTime = new Date("2031-01-02T03:04:05.000Z");
const owner = {
  workspaceId: 7,
  projectId: 51,
  actorId: 17,
  actorRole: "user",
} as const;
const reviewer = {
  workspaceId: 7,
  projectId: 51,
  actorId: 99,
  actorRole: "admin",
} as const;

type MemoryState = {
  projects: Map<number, { workspaceId: number; userId: number }>;
  receipts: StoredReceipt[];
  evidence: StoredEvidence[];
};

function memoryStore(state: MemoryState): ImageAssetTrustLedgerStore {
  let id = 1;
  return {
    async transaction(callback) {
      return callback({} as never);
    },
    async lockAuthorizedProject(_tx, input) {
      const project = state.projects.get(input.projectId);
      if (!project || project.workspaceId !== input.workspaceId)
        throw new Error("unexpected workspace");
      if (
        project.userId !== input.actorId &&
        !["admin", "super_admin"].includes(input.actorRole)
      ) {
        throw new Error("unexpected actor");
      }
    },
    async findProjectWorkspace(_tx, projectId) {
      return state.projects.get(projectId)?.workspaceId ?? null;
    },
    async findReceiptForSignedReference(_tx, input) {
      return (
        state.receipts.find(
          receipt =>
            receipt.projectId === input.projectId &&
            receipt.uploadedBy === input.uploadedBy &&
            receipt.receiptKey === input.receiptKey &&
            receipt.assetKind === input.assetKind
        ) ?? null
      );
    },
    async findReceiptByStorageKey(_tx, storageKey) {
      return (
        state.receipts.find(receipt => receipt.storageKey === storageKey) ??
        null
      );
    },
    async findReceiptById(_tx, receiptId) {
      return state.receipts.find(receipt => receipt.id === receiptId) ?? null;
    },
    async insertReceipt(_tx, receipt) {
      const saved = { ...receipt, id: id++ };
      state.receipts.push(saved);
      return saved;
    },
    async findLatestEvidence(_tx, evidenceRecordId) {
      return (
        state.evidence
          .filter(item => item.evidenceRecordId === evidenceRecordId)
          .sort((left, right) => right.version - left.version)[0] ?? null
      );
    },
    async listEvidenceForProject(_tx, input) {
      return state.evidence
        .filter(item => item.workspaceId === input.workspaceId && item.projectId === input.projectId)
        .sort((left, right) => right.version - left.version);
    },
    async insertEvidence(_tx, evidence) {
      const saved = { ...evidence, id: id++ };
      state.evidence.push(saved);
      return saved;
    },
  };
}

function newState(): MemoryState {
  return {
    projects: new Map([
      [51, { workspaceId: 7, userId: 17 }],
      [52, { workspaceId: 8, userId: 18 }],
    ]),
    receipts: [],
    evidence: [],
  };
}

function controlledKey(projectId = 51, suffix = "owned.png") {
  return `image-workflow/${projectId}/step4-refs/${suffix}`;
}

function storage(key: string) {
  return { key, storageUri: `storage://forge/${key}` };
}

function signedReceipt(key: string, projectId = 51, userId = 17) {
  return createImageAssetReceipt({
    url: `https://assets.example.invalid/${key}`,
    key,
    kind: "step4-ref",
    projectId,
    userId,
  });
}

function policyEvidence(proofRecordId: string) {
  return {
    proofRecordId,
    proofType: "signed_license",
    grantSummary:
      "The creator grants use of this own-product image for this project.",
  };
}

async function imageBytes() {
  return sharp({
    create: {
      width: 2,
      height: 3,
      channels: 4,
      background: { r: 12, g: 34, b: 56, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

async function registerVerifiedEvidence(input: {
  state: MemoryState;
  now: () => Date;
  bytes: Buffer;
  projectId?: number;
  workspaceId?: number;
  actorId?: number;
  evidenceId: string;
  review?: boolean;
  evidenceExpiresAt?: Date;
}) {
  const projectId = input.projectId ?? 51;
  const workspaceId = input.workspaceId ?? 7;
  const actorId = input.actorId ?? 17;
  const key = controlledKey(projectId, `${input.evidenceId}.png`);
  const service = createImageAssetTrustLedgerService({
    store: memoryStore(input.state),
    now: input.now,
    newEvidenceRecordId: () => input.evidenceId,
  });
  await service.recordControlledUpload({
    workspaceId,
    projectId,
    actorId,
    actorRole: "user",
    kind: "step4-ref",
    intendedUse: "step4_reference",
    storage: storage(key),
    bytes: input.bytes,
    expiresAt: new Date(baseTime.valueOf() + 86_400_000),
  });
  const receipt = signedReceipt(key, projectId, actorId);
  const pending = await service.createPendingLicenseEvidence({
    workspaceId,
    projectId,
    actorId,
    actorRole: "user",
    originKind: "own_product",
    receiptReference: receipt.url,
    proofType: "signed_license",
    authorizationStatement: policyEvidence(input.evidenceId).grantSummary,
    proofMaterial: {
      storageKey: `license-material/${projectId}/${input.evidenceId}.pdf`,
      storageUri: `storage://forge/license-material/${projectId}/${input.evidenceId}.pdf`,
      bytes: Buffer.from("synthetic proof bytes only", "utf8"),
    },
    expiresAt: input.evidenceExpiresAt,
  });
  const trustedAsset = await service.resolveReceiptAsset({
    receipt: { key, url: receipt.url.split("#")[0], kind: "step4-ref" },
    projectId,
    uploadedBy: actorId,
  });
  if (input.review === false)
    return { service, receipt, pending, approved: null, trustedAsset, key };
  const approved = await service.reviewLicenseEvidence({
    workspaceId,
    projectId,
    actorId: 99,
    actorRole: "admin",
    evidenceRecordId: pending.evidenceRecordId,
    expectedVersion: pending.version,
    decision: "verify",
    reviewNote: "Synthetic offline review.",
  });
  return { service, receipt, pending, approved, trustedAsset, key };
}

beforeEach(() => {
  process.env.JWT_SECRET = "local-only-trust-ledger-test-secret";
});
afterEach(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

describe("Phase C image asset trust ledger", () => {
  it("runs the real default policy and ledger readers on one caller executor with all six existing row locks", async () => {
    const state = newState();
    const evidenceId = "license_00000000-0000-4000-8000-000000000044";
    const primary = await registerVerifiedEvidence({ state, now: () => baseTime, bytes: await imageBytes(), evidenceId });
    const contentHash = primary.trustedAsset.contentHash;
    const assetId = `asset_${contentHash}`;
    const rows: Record<string, unknown[]> = {
      projects: [{ id: 51, workspaceId: 7, userId: 17 }],
      image_assets: [{ id: 1, assetId, workspaceId: 7, contentHash, storageRef: primary.trustedAsset.storageRef, createdBy: 17 }],
      image_asset_policy_revisions: [{ assetId, workspaceId: 7, projectId: 51, originKind: "own_product",
        originRecordType: "controlled_upload_receipt", originRecordId: primary.key, contentHash,
        allowedUsesJson: ["step4_reference"], licenseEvidenceJson: policyEvidence(evidenceId), reviewState: "approved",
        revision: 2, policyHash: "a".repeat(64), createdBy: 17, reviewedBy: 99, reviewedAt: baseTime }],
      image_controlled_upload_receipts: state.receipts,
      image_asset_license_evidence_revisions: [state.evidence[state.evidence.length - 1]],
    };
    const locks: string[] = [];
    const transaction = vi.fn(async () => { throw new Error("nested transaction forbidden"); });
    const tx = { transaction, select() {
      let tableName = "";
      const query = {
        from(table: Table) { tableName = getTableName(table); return query; },
        where() { return query; }, orderBy() { return query; },
        limit(value: number) { expect(value).toBe(1); return query; },
        async for(lock: string) { expect(lock).toBe("update"); locks.push(tableName); return rows[tableName] ?? []; },
      };
      return query;
    } } as unknown as DbExecutor;
    // No store overrides: both services execute their unchanged Drizzle readers.
    const ledger = createImageAssetTrustLedgerService({ now: () => baseTime });
    const policy = createImageAssetPolicyService({ verifyCurrentPolicyEvidenceInTransaction: ledger.verifyCurrentPolicyEvidenceInTransaction });
    const input = { ...owner, assetId, expectedRevision: 2, allowedUse: "step4_reference" as const };
    await expect(policy.requireCurrentApprovedAssetUseInTransaction(tx, input)).resolves.toMatchObject({ assetId, revision: 2, contentHash });
    expect(locks).toEqual(["projects", "image_assets", "image_asset_policy_revisions",
      "image_controlled_upload_receipts", "image_asset_license_evidence_revisions", "image_controlled_upload_receipts"]);
    expect(transaction).not.toHaveBeenCalled();
    await expect(policy.requireCurrentApprovedAssetUseInTransaction(tx, { ...input, actorId: 18 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(policy.requireCurrentApprovedAssetUseInTransaction(tx, { ...input, workspaceId: 8 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    state.receipts[0].revokedAt = baseTime;
    await expect(policy.requireCurrentApprovedAssetUseInTransaction(tx, input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("reuses the caller executor for both receipt and latest license family without opening or committing a transaction", async () => {
    const state = newState();
    const evidenceId = "license_00000000-0000-4000-8000-000000000040";
    const primary = await registerVerifiedEvidence({ state, now: () => baseTime, bytes: await imageBytes(), evidenceId });
    const tx = {} as DbExecutor;
    const store = memoryStore(state);
    const transaction = vi.fn(async () => { throw new Error("nested transaction forbidden"); });
    const order: string[] = [];
    const subject = createImageAssetTrustLedgerService({ now: () => baseTime, store: { ...store, transaction,
      async findReceiptByStorageKey(actualTx, key) { expect(actualTx).toBe(tx); order.push("receipt-key"); return store.findReceiptByStorageKey(actualTx, key); },
      async findLatestEvidence(actualTx, id) { expect(actualTx).toBe(tx); order.push("latest-evidence"); return store.findLatestEvidence(actualTx, id); },
      async findReceiptById(actualTx, id) { expect(actualTx).toBe(tx); order.push("receipt-id"); return store.findReceiptById(actualTx, id); },
    } });
    const input: VerifyCurrentPolicyEvidenceInput = { workspaceId: 7, projectId: 51, originKind: "own_product",
      originRecordType: "controlled_upload_receipt", originRecordId: primary.key,
      asset: primary.trustedAsset, evidence: policyEvidence(evidenceId) };
    const before = structuredClone(state);
    await expect(primary.service.verifyCurrentPolicyEvidence(input)).resolves.toBe(true);
    await expect(subject.verifyCurrentPolicyEvidenceInTransaction(tx, input)).resolves.toBe(true);
    expect(order).toEqual(["receipt-key", "latest-evidence", "receipt-id"]);
    expect(transaction).not.toHaveBeenCalled();
    expect(state).toEqual(before);
  });

  it.each([
    "receipt-revoked", "receipt-expired", "evidence-revoked", "evidence-expired", "evidence-unreviewed",
    "newer-pending", "workspace", "project", "content-hash", "storage-ref", "origin-record",
    "origin-kind", "proof-type", "grant", "uploader", "receipt-id", "evidence-asset-id",
  ] as const)("retains the original %s denial in the caller transaction", async failure => {
    const state = newState();
    const evidenceId = "license_00000000-0000-4000-8000-000000000041";
    const primary = await registerVerifiedEvidence({ state, now: () => baseTime, bytes: await imageBytes(), evidenceId });
    const input: VerifyCurrentPolicyEvidenceInput = { workspaceId: 7, projectId: 51, originKind: "own_product",
      originRecordType: "controlled_upload_receipt", originRecordId: primary.key,
      asset: { contentHash: primary.trustedAsset.contentHash, storageRef: primary.trustedAsset.storageRef }, evidence: policyEvidence(evidenceId) };
    const latest = state.evidence[state.evidence.length - 1];
    if (failure === "receipt-revoked") state.receipts[0].revokedAt = baseTime;
    if (failure === "receipt-expired") state.receipts[0].expiresAt = baseTime;
    if (failure === "evidence-revoked") latest.status = "revoked";
    if (failure === "evidence-expired") latest.expiresAt = baseTime;
    if (failure === "evidence-unreviewed") latest.reviewedBy = null;
    if (failure === "newer-pending") state.evidence.push({ ...latest, version: latest.version + 1, status: "pending_review" });
    if (failure === "workspace") input.workspaceId = 8;
    if (failure === "project") input.projectId = 52;
    if (failure === "content-hash") input.asset.contentHash = "f".repeat(64);
    if (failure === "storage-ref") input.asset.storageRef = "storage://forge/unapproved.png";
    if (failure === "origin-record") input.originRecordType = "legacy_url";
    if (failure === "origin-kind") input.originKind = "designer_upload";
    if (failure === "proof-type") input.evidence!.proofType = "changed";
    if (failure === "grant") input.evidence!.grantSummary = "changed";
    if (failure === "uploader") latest.createdBy = 18;
    if (failure === "receipt-id") latest.controlledUploadReceiptId = 999;
    if (failure === "evidence-asset-id") latest.assetId = "asset_other";
    const before = structuredClone(state);
    const transaction = vi.fn(async () => { throw new Error("nested transaction forbidden"); });
    const subject = createImageAssetTrustLedgerService({ now: () => baseTime, store: { ...memoryStore(state), transaction } });
    await expect(primary.service.verifyCurrentPolicyEvidence(input)).resolves.toBe(false);
    await expect(subject.verifyCurrentPolicyEvidenceInTransaction({} as DbExecutor, input)).resolves.toBe(false);
    expect(transaction).not.toHaveBeenCalled();
    expect(state).toEqual(before);
  });

  it("does not change the legacy method's two owned transactions", async () => {
    const state = newState();
    const evidenceId = "license_00000000-0000-4000-8000-000000000042";
    const primary = await registerVerifiedEvidence({ state, now: () => baseTime, bytes: await imageBytes(), evidenceId });
    const store = memoryStore(state);
    const transaction = vi.spyOn(store, "transaction");
    const subject = createImageAssetTrustLedgerService({ now: () => baseTime, store });
    await expect(subject.verifyCurrentPolicyEvidence({ workspaceId: 7, projectId: 51, originKind: "own_product",
      originRecordType: "controlled_upload_receipt", originRecordId: primary.key,
      asset: primary.trustedAsset, evidence: policyEvidence(evidenceId) })).resolves.toBe(true);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("refuses unavailable license storage without opening a fallback transaction", async () => {
    const state = newState();
    const evidenceId = "license_00000000-0000-4000-8000-000000000043";
    const primary = await registerVerifiedEvidence({ state, now: () => baseTime, bytes: await imageBytes(), evidenceId });
    const transaction = vi.fn(async () => { throw new Error("nested transaction forbidden"); });
    const subject = createImageAssetTrustLedgerService({ now: () => baseTime, store: { ...memoryStore(state), transaction,
      async findLatestEvidence() { throw new Error("synthetic missing ledger table"); },
    } });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(subject.verifyCurrentPolicyEvidenceInTransaction({} as DbExecutor, { workspaceId: 7, projectId: 51,
        originKind: "own_product", originRecordType: "controlled_upload_receipt", originRecordId: primary.key,
        asset: primary.trustedAsset, evidence: policyEvidence(evidenceId) })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(transaction).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it("captures actual server bytes and rejects blank bytes or storage-key reuse", async () => {
    const state = newState();
    const bytes = await imageBytes();
    const key = controlledKey();
    const service = createImageAssetTrustLedgerService({
      store: memoryStore(state),
      now: () => baseTime,
    });

    await expect(
      service.recordControlledUpload({
        ...owner,
        kind: "step4-ref",
        intendedUse: "step4_reference",
        storage: storage(key),
        bytes: Buffer.alloc(0),
        expiresAt: new Date(baseTime.valueOf() + 1_000),
      })
    ).rejects.toThrow(/大小不合法|内容为空/);

    const recorded = await service.recordControlledUpload({
      ...owner,
      kind: "step4-ref",
      intendedUse: "step4_reference",
      storage: storage(key),
      bytes,
      expiresAt: new Date(baseTime.valueOf() + 86_400_000),
    });
    expect(recorded).toMatchObject({
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      storageUri: `storage://forge/${key}`,
      contentType: "image/png",
      sizeBytes: bytes.length,
      width: 2,
      height: 3,
    });
    await expect(
      service.recordControlledUpload({
        ...owner,
        kind: "step4-ref",
        intendedUse: "step4_reference",
        storage: storage(key),
        bytes,
        expiresAt: new Date(baseTime.valueOf() + 86_400_000),
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("requires a human-verified matching server evidence record; blank client JSON and wrong byte identity fail closed", async () => {
    const state = newState();
    const bytes = await imageBytes();
    const evidenceId = "license_00000000-0000-4000-8000-000000000001";
    const now = () => baseTime;
    const { service, pending, trustedAsset } = await registerVerifiedEvidence({
      state,
      now,
      bytes,
      evidenceId,
      review: false,
    });
    const evidence = policyEvidence(evidenceId);

    expect(pending.status).toBe("pending_review");
    await expect(
      service.verifyLicenseEvidence({
        evidence,
        asset: trustedAsset,
        originKind: "own_product",
        projectId: 51,
      })
    ).resolves.toBe(false);
    const approved = await service.reviewLicenseEvidence({
      ...reviewer,
      evidenceRecordId: evidenceId,
      expectedVersion: pending.version,
      decision: "verify",
      reviewNote: "Synthetic offline review.",
    });
    expect(approved).toMatchObject({
      status: "verified",
      version: 2,
      reviewedAt: baseTime,
    });
    await expect(
      service.verifyLicenseEvidence({
        evidence,
        asset: trustedAsset,
        originKind: "own_product",
        projectId: 51,
      })
    ).resolves.toBe(true);
    await expect(
      service.verifyLicenseEvidence({
        evidence: { proofRecordId: "", proofType: "", grantSummary: "" },
        asset: trustedAsset,
        originKind: "own_product",
        projectId: 51,
      })
    ).resolves.toBe(false);
    await expect(
      service.verifyLicenseEvidence({
        evidence,
        asset: { ...trustedAsset, contentHash: "f".repeat(64) },
        originKind: "own_product",
        projectId: 51,
      })
    ).resolves.toBe(false);
  });

  it("rejects a user-forged receipt identity and never turns a competitor origin into licensable production material", async () => {
    const state = newState();
    const bytes = await imageBytes();
    const key = controlledKey();
    const service = createImageAssetTrustLedgerService({
      store: memoryStore(state),
      now: () => baseTime,
    });
    await service.recordControlledUpload({
      ...owner,
      kind: "step4-ref",
      intendedUse: "step4_reference",
      storage: storage(key),
      bytes,
      expiresAt: new Date(baseTime.valueOf() + 86_400_000),
    });
    const forgedForOtherUser = signedReceipt(key, 51, 18);
    await expect(
      service.resolveReceiptAsset({
        receipt: {
          key,
          url: forgedForOtherUser.url.split("#")[0],
          kind: "step4-ref",
        },
        projectId: 51,
        uploadedBy: 18,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    const ownerReceipt = signedReceipt(key);
    await expect(
      service.createPendingLicenseEvidence({
        ...owner,
        originKind: "competitor_research" as never,
        receiptReference: ownerReceipt.url,
        proofType: "signed_license",
        authorizationStatement: "Not eligible.",
        proofMaterial: {
          storageKey: "license-material/51/competitor.pdf",
          storageUri: "storage://forge/license-material/51/competitor.pdf",
          bytes: Buffer.from("synthetic proof bytes only"),
        },
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("fails closed across workspaces and when trusted evidence is expired or revoked", async () => {
    const state = newState();
    const bytes = await imageBytes();
    let clock = baseTime;
    const now = () => clock;
    const primaryId = "license_00000000-0000-4000-8000-000000000002";
    const primary = await registerVerifiedEvidence({
      state,
      now,
      bytes,
      evidenceId: primaryId,
      evidenceExpiresAt: new Date(baseTime.valueOf() + 3_600_000),
    });
    const primaryEvidence = policyEvidence(primaryId);

    const foreignId = "license_00000000-0000-4000-8000-000000000003";
    const foreign = await registerVerifiedEvidence({
      state,
      now,
      bytes,
      projectId: 52,
      workspaceId: 8,
      actorId: 18,
      evidenceId: foreignId,
    });
    await expect(
      foreign.service.verifyLicenseEvidence({
        evidence: policyEvidence(foreignId),
        asset: foreign.trustedAsset,
        originKind: "own_product",
        projectId: 51,
      })
    ).resolves.toBe(false);

    clock = new Date(baseTime.valueOf() + 3_600_000);
    await expect(
      primary.service.verifyLicenseEvidence({
        evidence: primaryEvidence,
        asset: primary.trustedAsset,
        originKind: "own_product",
        projectId: 51,
      })
    ).resolves.toBe(false);

    clock = new Date(baseTime.valueOf() + 86_400_000);
    await expect(
      primary.service.resolveReceiptAsset({
        receipt: {
          key: primary.key,
          url: primary.receipt.url.split("#")[0],
          kind: "step4-ref",
        },
        projectId: 51,
        uploadedBy: 17,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      primary.service.verifyLicenseEvidence({
        evidence: primaryEvidence,
        asset: primary.trustedAsset,
        originKind: "own_product",
        projectId: 51,
      })
    ).resolves.toBe(false);

    clock = baseTime;
    if (!primary.approved)
      throw new Error("expected verified synthetic evidence");
    const revoke = await primary.service.reviewLicenseEvidence({
      ...reviewer,
      evidenceRecordId: primaryId,
      expectedVersion: primary.approved.version,
      decision: "revoke",
      reviewNote: "Synthetic revocation.",
    });
    expect(revoke).toMatchObject({ status: "revoked", version: 3 });
    await expect(
      primary.service.verifyLicenseEvidence({
        evidence: primaryEvidence,
        asset: primary.trustedAsset,
        originKind: "own_product",
        projectId: 51,
      })
    ).resolves.toBe(false);
  });

  it("rechecks the controlled receipt/evidence family for current policy use and rejects arbitrary storage references", async () => {
    const state = newState();
    const bytes = await imageBytes();
    const evidenceId = "license_00000000-0000-4000-8000-000000000004";
    const primary = await registerVerifiedEvidence({
      state,
      now: () => baseTime,
      bytes,
      evidenceId,
    });
    const evidence = policyEvidence(evidenceId);
    await expect(primary.service.verifyCurrentPolicyEvidence({
      workspaceId: 7,
      projectId: 51,
      originKind: "own_product",
      originRecordType: "controlled_upload_receipt",
      originRecordId: primary.key,
      asset: { contentHash: primary.trustedAsset.contentHash, storageRef: primary.trustedAsset.storageRef },
      evidence,
    })).resolves.toBe(true);
    await expect(primary.service.verifyCurrentPolicyEvidence({
      workspaceId: 7,
      projectId: 51,
      originKind: "own_product",
      originRecordType: "controlled_upload_receipt",
      originRecordId: "arbitrary/client-storage-ref.png",
      asset: { contentHash: primary.trustedAsset.contentHash, storageRef: primary.trustedAsset.storageRef },
      evidence,
    })).resolves.toBe(false);
    await expect(primary.service.verifyCurrentPolicyEvidence({
      workspaceId: 7,
      projectId: 51,
      originKind: "own_product",
      originRecordType: "legacy_url",
      originRecordId: primary.key,
      asset: { contentHash: primary.trustedAsset.contentHash, storageRef: primary.trustedAsset.storageRef },
      evidence,
    })).resolves.toBe(false);
  });

  it("creates a proof preview only for an administrator's current scoped evidence version and returns no storage identifier", async () => {
    const state = newState();
    const evidenceId = "license_00000000-0000-4000-8000-000000000005";
    const previewFactory = vi.fn().mockResolvedValue("https://private.example.invalid/proof?expires=300");
    const primary = await registerVerifiedEvidence({
      state,
      now: () => baseTime,
      bytes: await imageBytes(),
      evidenceId,
    });
    const service = createImageAssetTrustLedgerService({
      store: memoryStore(state),
      now: () => baseTime,
      createEvidencePreviewUrl: previewFactory,
    });

    const preview = await service.createLicenseEvidencePreview({
      ...reviewer,
      evidenceRecordId: evidenceId,
      expectedVersion: primary.approved?.version ?? 2,
    });
    expect(preview).toEqual({ previewUrl: "https://private.example.invalid/proof?expires=300" });
    expect(JSON.stringify(preview)).not.toContain("license-material");
    expect(previewFactory).toHaveBeenCalledWith(`storage://forge/license-material/51/${evidenceId}.pdf`);

    await expect(service.createLicenseEvidencePreview({
      ...owner,
      evidenceRecordId: evidenceId,
      expectedVersion: 2,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.createLicenseEvidencePreview({
      ...reviewer,
      evidenceRecordId: evidenceId,
      expectedVersion: 1,
    })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service.createLicenseEvidencePreview({
      ...reviewer,
      workspaceId: 8,
      evidenceRecordId: evidenceId,
      expectedVersion: 2,
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(previewFactory).toHaveBeenCalledTimes(1);
  });
});
