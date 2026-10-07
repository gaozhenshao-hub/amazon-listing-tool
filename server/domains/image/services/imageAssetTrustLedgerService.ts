import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import sharp from "sharp";
import {
  imageAssetLicenseEvidenceRevisions,
  imageControlledUploadReceipts,
} from "../../../../drizzle/schema/imageAssetTrustLedger";
import { projects } from "../../../../drizzle/schema/project";
import type { DbExecutor } from "../../../repositories/dbClient";
import { getDb } from "../../../repositories/dbClient";
import { createPrivateEvidencePreviewUrl } from "../../../storage";
import {
  requireImageAssetReceipt,
  type ImageAssetKind,
} from "./imageAssetReceipt";
import type {
  AssetLicenseEvidence,
  LicenseEvidenceVerifier,
  ReceiptAssetResolver,
  VerifiedReceiptAsset,
} from "./imageAssetTypes";
import { validateImageBytes } from "./validateImageBytes";

export type ControlledImageAssetKind = ImageAssetKind;
export type EvidenceOriginKind = "own_product" | "designer_upload";
export type LicenseEvidenceStatus =
  | "pending_review"
  | "verified"
  | "rejected"
  | "revoked";
export type ControlledImageUploadPurpose =
  | "step4_reference"
  | "designer_attachment"
  | "expression_group_research";

type ScopeActor = {
  workspaceId: number;
  projectId: number;
  actorId: number;
  actorRole: string;
};

export type StoredReceipt = {
  id?: number;
  workspaceId: number;
  projectId: number;
  uploadedBy: number;
  receiptKey: string;
  assetKind: ControlledImageAssetKind;
  intendedUse: ControlledImageUploadPurpose;
  storageKey: string;
  storageUri: string;
  contentHash: string;
  contentType: string;
  sizeBytes: number;
  width: number;
  height: number;
  expiresAt: Date;
  revokedAt?: Date | null;
  revokedBy?: number | null;
  createdAt?: Date;
};

export type StoredEvidence = {
  id?: number;
  evidenceRecordId: string;
  version: number;
  workspaceId: number;
  projectId: number;
  controlledUploadReceiptId: number;
  assetId: string;
  assetContentHash: string;
  assetOriginKind: EvidenceOriginKind;
  proofType: string;
  proofMaterialStorageUri: string;
  proofMaterialSha256: string;
  authorizationStatement: string;
  status: LicenseEvidenceStatus;
  reviewedBy?: number | null;
  reviewedAt?: Date | null;
  reviewNote?: string | null;
  expiresAt?: Date | null;
  createdBy: number;
  createdAt?: Date;
};

export type ImageAssetTrustLedgerStore = {
  transaction<T>(callback: (tx: DbExecutor) => Promise<T>): Promise<T>;
  lockAuthorizedProject(tx: DbExecutor, input: ScopeActor): Promise<void>;
  findProjectWorkspace(
    tx: DbExecutor,
    projectId: number
  ): Promise<number | null>;
  findReceiptForSignedReference(
    tx: DbExecutor,
    input: {
      projectId: number;
      uploadedBy: number;
      receiptKey: string;
      assetKind: ControlledImageAssetKind;
    }
  ): Promise<StoredReceipt | null>;
  findReceiptByStorageKey(
    tx: DbExecutor,
    storageKey: string
  ): Promise<StoredReceipt | null>;
  findReceiptById(tx: DbExecutor, id: number): Promise<StoredReceipt | null>;
  insertReceipt(tx: DbExecutor, receipt: StoredReceipt): Promise<StoredReceipt>;
  findLatestEvidence(
    tx: DbExecutor,
    evidenceRecordId: string
  ): Promise<StoredEvidence | null>;
  listEvidenceForProject(
    tx: DbExecutor,
    input: Pick<ScopeActor, "workspaceId" | "projectId">
  ): Promise<StoredEvidence[]>;
  insertEvidence(
    tx: DbExecutor,
    evidence: StoredEvidence
  ): Promise<StoredEvidence>;
};

/**
 * Input is internal to the controlled upload path. It intentionally receives
 * raw server-held bytes and never accepts a caller-supplied content hash, size,
 * content type, or dimensions. Call it only after storagePut has succeeded.
 */
export type RecordControlledUploadInput = ScopeActor & {
  kind: ControlledImageAssetKind;
  intendedUse: ControlledImageUploadPurpose;
  storage: { key: string; storageUri: string };
  bytes: Buffer;
  expiresAt: Date;
};

/** The receipt remains short-lived even though the stored object may be retained
 * for audit. A new review/policy must not rely on an indefinitely valid upload
 * receipt. */
export const CONTROLLED_UPLOAD_RECEIPT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Raised only after object storage has accepted bytes but the server ledger did
 * not durably record their identity. Callers must never mint an HMAC receipt in
 * this case: the object is an orphan, not a trusted asset.
 */
export class ControlledImageLedgerWriteError extends Error {
  readonly source = "trust_ledger";
  readonly conflict: boolean;

  constructor(readonly originalError: unknown) {
    super("可信素材账本写入失败；对象未获得可用于制作的上传回执");
    this.name = "ControlledImageLedgerWriteError";
    this.conflict = (originalError as { code?: unknown } | null)?.code === "CONFLICT";
  }
}

/** A proof material buffer is hashed here but is never persisted by this service. */
export type CreatePendingLicenseEvidenceInput = ScopeActor & {
  originKind: EvidenceOriginKind;
  receiptReference: string;
  proofType: string;
  authorizationStatement: string;
  proofMaterial: { storageKey: string; storageUri: string; bytes: Buffer };
  expiresAt?: Date | null;
};

export type ReviewLicenseEvidenceInput = ScopeActor & {
  evidenceRecordId: string;
  expectedVersion: number;
  decision: "verify" | "reject" | "revoke";
  reviewNote?: string;
};

export type CreateLicenseEvidencePreviewInput = ScopeActor & {
  evidenceRecordId: string;
  expectedVersion: number;
};

/**
 * Minimal integration contract (no router is wired here):
 *
 * Upload transaction order:
 * 1. Decode/validate bytes (recordControlledUpload invokes validateImageBytes),
 * 2. storagePut with a new server-generated key,
 * 3. in one DB transaction lock the authorized project and insert this receipt,
 * 4. only after that succeeds, createImageAssetReceipt using the same key.
 * An object left behind by a failed DB insertion is an orphan, never an approved
 * asset; retry must allocate a new storage key because duplicate keys conflict.
 *
 * Approval transaction order:
 * 1. imageAssetPolicyService checks the HMAC receipt,
 * 2. its resolveReceiptAsset dependency is this service's resolver,
 * 3. its verifyLicenseEvidence dependency is this service's verifier,
 * 4. the policy service locks the project and writes its immutable revision.
 * Before a policy can be approved, a separate administrator must create a
 * "verified" immutable evidence revision with review identity/date.
 */

export type TrustedLedgerReceiptAsset = VerifiedReceiptAsset & {
  trustedReceiptId: number;
  trustedWorkspaceId: number;
  trustedProjectId: number;
  trustedUploadedBy: number;
  trustedReceiptKey: string;
  trustedAssetKind: ControlledImageAssetKind;
};

/** Internal contract used by the policy gate to re-check human evidence at use
 * time. No storage URL, hash, or evidence material is exposed to a browser. */
export type VerifyCurrentPolicyEvidenceInput = {
  workspaceId: number;
  projectId: number;
  originKind: EvidenceOriginKind;
  originRecordType: string;
  originRecordId: string;
  asset: Pick<VerifiedReceiptAsset, "contentHash" | "storageRef">;
  evidence: AssetLicenseEvidence | null;
};

function fail(
  code:
    | "BAD_REQUEST"
    | "CONFLICT"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "PRECONDITION_FAILED"
    | "INTERNAL_SERVER_ERROR",
  message: string
): never {
  throw new TRPCError({ code, message });
}

function nowDate(now: () => Date) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.valueOf()))
    fail("INTERNAL_SERVER_ERROR", "可信素材账本时钟无效");
  return value;
}

function strictlyAfter(left: Date | null | undefined, right: Date) {
  return Boolean(left && left.valueOf() > right.valueOf());
}

function requireFuture(value: Date, now: Date, label: string) {
  if (
    !(value instanceof Date) ||
    Number.isNaN(value.valueOf()) ||
    value.valueOf() <= now.valueOf()
  ) {
    fail("PRECONDITION_FAILED", `${label}必须是未来的服务器时间`);
  }
  return value;
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireSha256(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized))
    fail("PRECONDITION_FAILED", "可信记录缺少有效 SHA-256");
  return normalized;
}

function requireStorageKey(value: string) {
  const key = value.trim();
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/u.test(key) ||
    key.includes("//") ||
    key.includes("/../") ||
    key.startsWith("../")
  ) {
    fail("BAD_REQUEST", "存储键不是受控对象键");
  }
  return key;
}

function requireCanonicalStorageUri(value: string, key: string) {
  const uri = value.trim();
  const match = /^storage:\/\/([a-z0-9-]+)\/(.+)$/iu.exec(uri);
  if (
    !match ||
    !["forge", "s3", "oss"].includes(match[1].toLowerCase()) ||
    requireStorageKey(match[2]) !== key
  ) {
    fail("BAD_REQUEST", "存储引用必须是与受控对象键一致的 storage URI");
  }
  return `storage://${match[1].toLowerCase()}/${key}`;
}

function requireNonBlank(value: string, label: string, maxLength: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength)
    fail("BAD_REQUEST", `${label}无效`);
  return normalized;
}

function requireEvidenceRecordId(value: string) {
  const id = value.trim();
  if (!/^license_[0-9a-f-]{36}$/u.test(id))
    fail("PRECONDITION_FAILED", "许可证明记录标识无效");
  return id;
}

function assertReviewActor(role: string) {
  if (!(["admin", "super_admin"] as string[]).includes(role))
    fail("FORBIDDEN", "仅管理员可人工核验证明材料");
}

function requireEvidenceOriginKind(value: string): EvidenceOriginKind {
  if (value !== "own_product" && value !== "designer_upload") {
    fail(
      "FORBIDDEN",
      "竞品研究图片及其他非本品来源不能创建许可证明或升格为制作素材"
    );
  }
  return value;
}

function assertPurposeMatchesKind(
  kind: ControlledImageAssetKind,
  intendedUse: ControlledImageUploadPurpose
) {
  const valid =
    (kind === "step4-ref" && intendedUse === "step4_reference") ||
    (kind === "designer" && intendedUse === "designer_attachment") ||
    (kind === "expression-group" &&
      intendedUse === "expression_group_research");
  if (!valid) fail("BAD_REQUEST", "受控上传用途与图片类型不匹配");
}

async function inspectTrustedImageBytes(bytes: Buffer) {
  if (!Buffer.isBuffer(bytes))
    fail("BAD_REQUEST", "受控上传必须提供服务端字节");
  const { mimeType } = await validateImageBytes(bytes);
  // validateImageBytes has already forced a full sharp decode. metadata here only
  // reads the validated bytes to persist their actual dimensions.
  const metadata = await sharp(bytes, {
    failOn: "warning",
    pages: 1,
  }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    fail("PRECONDITION_FAILED", "受控上传图片缺少可核验尺寸");
  }
  return {
    contentHash: sha256(bytes),
    contentType: mimeType,
    sizeBytes: bytes.length,
    width,
    height,
  };
}

function toTrustedAsset(receipt: StoredReceipt): TrustedLedgerReceiptAsset {
  if (!receipt.id || receipt.id < 1)
    fail("INTERNAL_SERVER_ERROR", "可信上传记录缺少稳定标识");
  return {
    contentHash: requireSha256(receipt.contentHash),
    storageRef: requireCanonicalStorageUri(
      receipt.storageUri,
      requireStorageKey(receipt.storageKey)
    ),
    contentType: receipt.contentType,
    sizeBytes: receipt.sizeBytes,
    width: receipt.width,
    height: receipt.height,
    trustedReceiptId: receipt.id,
    trustedWorkspaceId: receipt.workspaceId,
    trustedProjectId: receipt.projectId,
    trustedUploadedBy: receipt.uploadedBy,
    trustedReceiptKey: receipt.receiptKey,
    trustedAssetKind: receipt.assetKind,
  };
}

function isTrustedLedgerReceiptAsset(
  asset: VerifiedReceiptAsset
): asset is TrustedLedgerReceiptAsset {
  const candidate = asset as Partial<TrustedLedgerReceiptAsset>;
  return (
    Number.isInteger(candidate.trustedReceiptId) &&
    Number.isInteger(candidate.trustedWorkspaceId) &&
    Number.isInteger(candidate.trustedProjectId) &&
    Number.isInteger(candidate.trustedUploadedBy) &&
    typeof candidate.trustedReceiptKey === "string" &&
    typeof candidate.trustedAssetKind === "string"
  );
}

function recordSummary(record: StoredReceipt) {
  return {
    receiptId: record.id,
    contentHash: record.contentHash,
    storageUri: record.storageUri,
    contentType: record.contentType,
    sizeBytes: record.sizeBytes,
    width: record.width,
    height: record.height,
    expiresAt: record.expiresAt,
  };
}

function evidenceSummary(evidence: StoredEvidence) {
  return {
    evidenceRecordId: evidence.evidenceRecordId,
    version: evidence.version,
    status: evidence.status,
    reviewedAt: evidence.reviewedAt ?? null,
    expiresAt: evidence.expiresAt ?? null,
  };
}

/** Deliberately omits storage URI, SHA-256 and original authorization text. */
function evidenceReviewSummary(evidence: StoredEvidence) {
  return {
    ...evidenceSummary(evidence),
    proofType: evidence.proofType,
    assetOriginKind: evidence.assetOriginKind,
    createdAt: evidence.createdAt ?? null,
  };
}

/** The uploader may re-use their own proof metadata, but never storage internals. */
function evidenceOwnerSummary(evidence: StoredEvidence) {
  return {
    ...evidenceSummary(evidence),
    proofType: evidence.proofType,
    grantSummary: evidence.authorizationStatement,
  };
}

function drizzleStore(): ImageAssetTrustLedgerStore {
  return {
    async transaction<T>(callback: (tx: DbExecutor) => Promise<T>) {
      const database = await getDb();
      if (!database) fail("INTERNAL_SERVER_ERROR", "可信素材账本暂不可用");
      if (typeof (database as any).transaction !== "function") {
        fail("PRECONDITION_FAILED", "可信素材账本缺少事务支持，已拒绝非原子写入或审核");
      }
      return (database as any).transaction(callback);
    },
    async lockAuthorizedProject(tx, input) {
      const rows = await tx
        .select()
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .limit(1)
        .for("update");
      const project = rows[0] as
        | { workspaceId?: number | null; userId: number }
        | undefined;
      if (!project || Number(project.workspaceId) !== input.workspaceId)
        fail("FORBIDDEN", "项目不属于当前已授权工作空间");
      if (
        project.userId !== input.actorId &&
        !["admin", "super_admin"].includes(input.actorRole)
      ) {
        fail("FORBIDDEN", "当前用户无权写入此项目的可信素材记录");
      }
    },
    async findProjectWorkspace(tx, projectId) {
      const rows = await tx
        .select({ workspaceId: projects.workspaceId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      const workspaceId = (
        rows[0] as { workspaceId?: number | null } | undefined
      )?.workspaceId;
      return Number.isInteger(workspaceId) ? Number(workspaceId) : null;
    },
    async findReceiptForSignedReference(tx, input) {
      const rows = await tx
        .select()
        .from(imageControlledUploadReceipts)
        .where(
          and(
            eq(imageControlledUploadReceipts.projectId, input.projectId),
            eq(imageControlledUploadReceipts.uploadedBy, input.uploadedBy),
            eq(imageControlledUploadReceipts.receiptKey, input.receiptKey),
            eq(imageControlledUploadReceipts.assetKind, input.assetKind)
          )
        )
        .limit(1)
        .for("update");
      return (rows[0] as StoredReceipt | undefined) ?? null;
    },
    async findReceiptByStorageKey(tx, storageKey) {
      const rows = await tx
        .select()
        .from(imageControlledUploadReceipts)
        .where(eq(imageControlledUploadReceipts.storageKey, storageKey))
        .limit(1)
        .for("update");
      return (rows[0] as StoredReceipt | undefined) ?? null;
    },
    async findReceiptById(tx, id) {
      const rows = await tx
        .select()
        .from(imageControlledUploadReceipts)
        .where(eq(imageControlledUploadReceipts.id, id))
        .limit(1)
        .for("update");
      return (rows[0] as StoredReceipt | undefined) ?? null;
    },
    async insertReceipt(tx, receipt) {
      const [created] = await tx
        .insert(imageControlledUploadReceipts)
        .values(receipt)
        .$returningId();
      return { ...receipt, id: Number(created.id) };
    },
    async findLatestEvidence(tx, evidenceRecordId) {
      const rows = await tx
        .select()
        .from(imageAssetLicenseEvidenceRevisions)
        .where(
          eq(
            imageAssetLicenseEvidenceRevisions.evidenceRecordId,
            evidenceRecordId
          )
        )
        .orderBy(
          desc(imageAssetLicenseEvidenceRevisions.version),
          desc(imageAssetLicenseEvidenceRevisions.id)
        )
        .limit(1)
        .for("update");
      return (rows[0] as StoredEvidence | undefined) ?? null;
    },
    async listEvidenceForProject(tx, input) {
      return tx
        .select()
        .from(imageAssetLicenseEvidenceRevisions)
        .where(
          and(
            eq(imageAssetLicenseEvidenceRevisions.workspaceId, input.workspaceId),
            eq(imageAssetLicenseEvidenceRevisions.projectId, input.projectId)
          )
        )
        .orderBy(
          desc(imageAssetLicenseEvidenceRevisions.version),
          desc(imageAssetLicenseEvidenceRevisions.id)
        ) as Promise<StoredEvidence[]>;
    },
    async insertEvidence(tx, evidence) {
      const [created] = await tx
        .insert(imageAssetLicenseEvidenceRevisions)
        .values(evidence)
        .$returningId();
      return { ...evidence, id: Number(created.id) };
    },
  };
}

export function createImageAssetTrustLedgerService(
  dependencies: {
    store?: ImageAssetTrustLedgerStore;
    now?: () => Date;
    newEvidenceRecordId?: () => string;
    createEvidencePreviewUrl?: (storageUri: string) => Promise<string>;
  } = {}
) {
  const store = dependencies.store ?? drizzleStore();
  const now = dependencies.now ?? (() => new Date());
  const newEvidenceRecordId =
    dependencies.newEvidenceRecordId ?? (() => `license_${randomUUID()}`);
  const createEvidencePreviewUrl =
    dependencies.createEvidencePreviewUrl ?? createPrivateEvidencePreviewUrl;

  async function ledgerTransaction<T>(
    operation: string,
    callback: (tx: DbExecutor) => Promise<T>
  ) {
    try {
      return await store.transaction(callback);
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error(`[image trust ledger] ${operation} failed`, error);
      fail(
        "PRECONDITION_FAILED",
        "可信素材账本所需数据表尚未就绪或不可用；已拒绝本次许可材料操作，不能登记、审核或用于制作"
      );
    }
  }

  function assertActiveReceipt(receipt: StoredReceipt, at: Date) {
    if (receipt.revokedAt || !strictlyAfter(receipt.expiresAt, at)) {
      fail("PRECONDITION_FAILED", "受控上传记录已过期或撤销，拒绝作为素材依据");
    }
    if (receipt.receiptKey !== receipt.storageKey)
      fail("PRECONDITION_FAILED", "受控上传记录键不一致");
    requireSha256(receipt.contentHash);
    requireCanonicalStorageUri(
      receipt.storageUri,
      requireStorageKey(receipt.storageKey)
    );
  }

  async function recordControlledUpload(input: RecordControlledUploadInput) {
    const captured = await inspectTrustedImageBytes(input.bytes);
    const at = nowDate(now);
    assertPurposeMatchesKind(input.kind, input.intendedUse);
    const storageKey = requireStorageKey(input.storage.key);
    const storageUri = requireCanonicalStorageUri(
      input.storage.storageUri,
      storageKey
    );
    const expiresAt = requireFuture(
      input.expiresAt,
      at,
      "受控上传记录到期时间"
    );
    return ledgerTransaction("record controlled upload", async tx => {
      await store.lockAuthorizedProject(tx, input);
      if (await store.findReceiptByStorageKey(tx, storageKey)) {
        fail("CONFLICT", "受控上传存储键已登记；不得覆盖、重用或替换字节");
      }
      const proposed: StoredReceipt = {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        uploadedBy: input.actorId,
        receiptKey: storageKey,
        assetKind: input.kind,
        intendedUse: input.intendedUse,
        storageKey,
        storageUri,
        ...captured,
        expiresAt,
        revokedAt: null,
        revokedBy: null,
      };
      try {
        return recordSummary(await store.insertReceipt(tx, proposed));
      } catch (error) {
        if (await store.findReceiptByStorageKey(tx, storageKey)) {
          fail("CONFLICT", "受控上传存储键并发冲突；不得覆盖、重用或替换字节");
        }
        throw error;
      }
    });
  }

  const resolveReceiptAsset: ReceiptAssetResolver = async input =>
    ledgerTransaction("resolve controlled receipt", async tx => {
      const receipt = await store.findReceiptForSignedReference(tx, {
        projectId: input.projectId,
        uploadedBy: input.uploadedBy,
        receiptKey: requireStorageKey(input.receipt.key),
        assetKind: input.receipt.kind,
      });
      if (!receipt)
        fail("PRECONDITION_FAILED", "受签上传回执没有匹配的服务端字节记录");
      if (
        (await store.findProjectWorkspace(tx, input.projectId)) !==
        receipt.workspaceId
      ) {
        fail("PRECONDITION_FAILED", "受签上传回执的工作空间归属不一致");
      }
      assertActiveReceipt(receipt, nowDate(now));
      return toTrustedAsset(receipt);
    });

  async function createPendingLicenseEvidence(
    input: CreatePendingLicenseEvidenceInput
  ) {
    const originKind = requireEvidenceOriginKind(input.originKind);
    const proofType = requireNonBlank(input.proofType, "证明类型", 64);
    const authorizationStatement = requireNonBlank(
      input.authorizationStatement,
      "授权声明",
      4096
    );
    const proofStorageKey = requireStorageKey(input.proofMaterial.storageKey);
    const proofStorageUri = requireCanonicalStorageUri(
      input.proofMaterial.storageUri,
      proofStorageKey
    );
    if (
      !Buffer.isBuffer(input.proofMaterial.bytes) ||
      input.proofMaterial.bytes.length === 0
    ) {
      fail("BAD_REQUEST", "证明材料必须是服务端读取的非空字节");
    }
    const at = nowDate(now);
    const expiresAt =
      input.expiresAt == null
        ? null
        : requireFuture(input.expiresAt, at, "许可证明到期时间");
    const kind: ControlledImageAssetKind =
      originKind === "designer_upload" ? "designer" : "step4-ref";
    const signed = requireImageAssetReceipt({
      reference: input.receiptReference,
      kind,
      projectId: input.projectId,
      userId: input.actorId,
    });
    return ledgerTransaction("create license evidence", async tx => {
      await store.lockAuthorizedProject(tx, input);
      const receipt = await store.findReceiptForSignedReference(tx, {
        projectId: input.projectId,
        uploadedBy: input.actorId,
        receiptKey: signed.key,
        assetKind: signed.kind,
      });
      if (!receipt)
        fail("PRECONDITION_FAILED", "许可证明未绑定服务端受控上传记录");
      if (
        (await store.findProjectWorkspace(tx, input.projectId)) !==
        receipt.workspaceId
      ) {
        fail("PRECONDITION_FAILED", "许可证明绑定的上传记录工作空间不一致");
      }
      assertActiveReceipt(receipt, at);
      if (!receipt.id)
        fail("INTERNAL_SERVER_ERROR", "受控上传记录缺少稳定标识");
      const evidenceRecordId = requireEvidenceRecordId(newEvidenceRecordId());
      const proposed: StoredEvidence = {
        evidenceRecordId,
        version: 1,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        controlledUploadReceiptId: receipt.id,
        assetId: `asset_${requireSha256(receipt.contentHash)}`,
        assetContentHash: requireSha256(receipt.contentHash),
        assetOriginKind: originKind,
        proofType,
        proofMaterialStorageUri: proofStorageUri,
        proofMaterialSha256: sha256(input.proofMaterial.bytes),
        authorizationStatement,
        status: "pending_review",
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
        expiresAt,
        createdBy: input.actorId,
      };
      return evidenceSummary(await store.insertEvidence(tx, proposed));
    });
  }

  async function reviewLicenseEvidence(input: ReviewLicenseEvidenceInput) {
    assertReviewActor(input.actorRole);
    const evidenceRecordId = requireEvidenceRecordId(input.evidenceRecordId);
    const at = nowDate(now);
    return ledgerTransaction("review license evidence", async tx => {
      await store.lockAuthorizedProject(tx, input);
      const latest = await store.findLatestEvidence(tx, evidenceRecordId);
      if (
        !latest ||
        latest.workspaceId !== input.workspaceId ||
        latest.projectId !== input.projectId
      ) {
        fail("NOT_FOUND", "许可证明记录不存在或不属于当前项目");
      }
      if (latest.version !== input.expectedVersion)
        fail("CONFLICT", "许可证明已更新，请刷新后重试");
      const status: LicenseEvidenceStatus =
        input.decision === "verify"
          ? "verified"
          : input.decision === "reject"
            ? "rejected"
            : "revoked";
      const next: StoredEvidence = {
        ...latest,
        id: undefined,
        version: latest.version + 1,
        status,
        reviewedBy: input.actorId,
        reviewedAt: at,
        reviewNote: input.reviewNote?.trim() || null,
      };
      return evidenceSummary(await store.insertEvidence(tx, next));
    });
  }

  async function listLicenseEvidenceForReview(input: ScopeActor) {
    assertReviewActor(input.actorRole);
    return ledgerTransaction("list license evidence for review", async tx => {
      await store.lockAuthorizedProject(tx, input);
      const currentByRecord = new Map<string, StoredEvidence>();
      for (const evidence of await store.listEvidenceForProject(tx, input)) {
        if (!currentByRecord.has(evidence.evidenceRecordId)) {
          currentByRecord.set(evidence.evidenceRecordId, evidence);
        }
      }
      return [...currentByRecord.values()].map(evidenceReviewSummary);
    });
  }

  /** The uploader sees only the current status of their own evidence family. */
  async function listMyLicenseEvidence(input: ScopeActor) {
    return ledgerTransaction("list uploader license evidence status", async tx => {
      await store.lockAuthorizedProject(tx, input);
      const currentByRecord = new Map<string, StoredEvidence>();
      for (const evidence of await store.listEvidenceForProject(tx, input)) {
        if (evidence.createdBy === input.actorId && !currentByRecord.has(evidence.evidenceRecordId)) {
          currentByRecord.set(evidence.evidenceRecordId, evidence);
        }
      }
      return [...currentByRecord.values()].map(evidenceOwnerSummary);
    });
  }

  /**
   * The storage URI stays server-side. This performs all scope/current-version
   * checks before asking the storage adapter for a short-lived URL, so an admin
   * cannot use a stale version or another workspace/project as a document oracle.
   */
  async function createLicenseEvidencePreview(input: CreateLicenseEvidencePreviewInput) {
    assertReviewActor(input.actorRole);
    const evidenceRecordId = requireEvidenceRecordId(input.evidenceRecordId);
    const storageUri = await ledgerTransaction("authorize license evidence preview", async tx => {
      await store.lockAuthorizedProject(tx, input);
      const latest = await store.findLatestEvidence(tx, evidenceRecordId);
      if (
        !latest ||
        latest.workspaceId !== input.workspaceId ||
        latest.projectId !== input.projectId
      ) {
        fail("NOT_FOUND", "许可证明记录不存在或不属于当前项目");
      }
      if (latest.version !== input.expectedVersion) {
        fail("CONFLICT", "许可证明已更新，请刷新后重试");
      }
      // Re-validate the canonical reference before it reaches a storage adapter.
      const match = /^storage:\/\/(?:forge|s3|oss)\/(.+)$/iu.exec(latest.proofMaterialStorageUri);
      if (!match) fail("PRECONDITION_FAILED", "许可证明材料缺少受控私有存储引用");
      requireStorageKey(match[1]);
      return latest.proofMaterialStorageUri;
    });
    try {
      const previewUrl = await createEvidencePreviewUrl(storageUri);
      if (!previewUrl || typeof previewUrl !== "string") {
        fail("PRECONDITION_FAILED", "私有许可证明预览存储未返回短效访问地址");
      }
      return { previewUrl };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      // Do not log URI, key, proof hash, or the signed URL.
      fail(
        "PRECONDITION_FAILED",
        "私有许可证明预览不可用：需私有 S3/OSS 对象存储、STORAGE_PRIVATE_OBJECTS=true，且短效签名 TTL 为 60–300 秒"
      );
    }
  }

  const verifyLicenseEvidence: LicenseEvidenceVerifier = async input => {
    // A malformed client JSON must simply be unusable; never turn it into an
    // inferred entitlement or reveal whether an arbitrary proof id exists.
    if (!input.evidence || !isTrustedLedgerReceiptAsset(input.asset))
      return false;
    const trustedAsset: TrustedLedgerReceiptAsset = input.asset;
    const proofRecordId = input.evidence.proofRecordId?.trim();
    const proofType = input.evidence.proofType?.trim();
    const grantSummary = input.evidence.grantSummary?.trim();
    if (
      !proofRecordId ||
      !proofType ||
      !grantSummary ||
      !/^license_[0-9a-f-]{36}$/u.test(proofRecordId)
    )
      return false;
    return ledgerTransaction("verify license evidence", async tx => {
      const at = nowDate(now);
      const evidence = await store.findLatestEvidence(tx, proofRecordId);
      if (
        !evidence ||
        evidence.status !== "verified" ||
        !evidence.reviewedBy ||
        !evidence.reviewedAt
      )
        return false;
      if (evidence.expiresAt && evidence.expiresAt.valueOf() <= at.valueOf())
        return false;
      const receipt = await store.findReceiptById(
        tx,
        evidence.controlledUploadReceiptId
      );
      if (!receipt) return false;
      try {
        assertActiveReceipt(receipt, at);
        return (
          evidence.workspaceId === trustedAsset.trustedWorkspaceId &&
          evidence.projectId === input.projectId &&
          evidence.projectId === trustedAsset.trustedProjectId &&
          evidence.controlledUploadReceiptId ===
            trustedAsset.trustedReceiptId &&
          evidence.assetContentHash ===
            requireSha256(trustedAsset.contentHash) &&
          evidence.assetId ===
            `asset_${requireSha256(trustedAsset.contentHash)}` &&
          evidence.assetOriginKind === input.originKind &&
          evidence.proofType === proofType &&
          evidence.authorizationStatement === grantSummary &&
          receipt.workspaceId === trustedAsset.trustedWorkspaceId &&
          receipt.projectId === trustedAsset.trustedProjectId &&
          receipt.uploadedBy === trustedAsset.trustedUploadedBy &&
          evidence.createdBy === receipt.uploadedBy &&
          receipt.receiptKey === trustedAsset.trustedReceiptKey &&
          receipt.assetKind === trustedAsset.trustedAssetKind &&
          receipt.contentHash === requireSha256(trustedAsset.contentHash) &&
          receipt.storageUri === trustedAsset.storageRef
        );
      } catch {
        return false;
      }
    });
  };

  /**
   * Policy approval is not a permanent entitlement. Re-read the controlled
   * receipt and immutable evidence family whenever an approved asset is about
   * to be consumed, so expiry/revocation and a substituted storage reference
   * fail closed instead of leaving a stale approval usable.
   */
  async function verifyCurrentPolicyEvidence(
    input: VerifyCurrentPolicyEvidenceInput
  ): Promise<boolean> {
    if (
      input.originRecordType !== "controlled_upload_receipt" ||
      !input.evidence ||
      (input.originKind !== "own_product" &&
        input.originKind !== "designer_upload")
    ) {
      return false;
    }

    const trustedAsset = await ledgerTransaction("verify current policy evidence", async tx => {
      let receipt: StoredReceipt | null = null;
      try {
        receipt = await store.findReceiptByStorageKey(
          tx,
          requireStorageKey(input.originRecordId)
        );
        if (
          !receipt ||
          receipt.workspaceId !== input.workspaceId ||
          receipt.projectId !== input.projectId
        ) {
          return null;
        }
        assertActiveReceipt(receipt, nowDate(now));
        const trusted = toTrustedAsset(receipt);
        if (
          trusted.contentHash !== requireSha256(input.asset.contentHash) ||
          trusted.storageRef !== input.asset.storageRef
        ) {
          return null;
        }
        return trusted;
      } catch {
        return null;
      }
    });
    if (!trustedAsset) return false;

    return verifyLicenseEvidence({
      evidence: input.evidence,
      asset: trustedAsset,
      originKind: input.originKind,
      projectId: input.projectId,
    });
  }

  return {
    recordControlledUpload,
    createPendingLicenseEvidence,
    reviewLicenseEvidence,
    listLicenseEvidenceForReview,
    listMyLicenseEvidence,
    createLicenseEvidencePreview,
    resolveReceiptAsset,
    verifyLicenseEvidence,
    verifyCurrentPolicyEvidence,
  };
}

/**
 * This singleton is intentionally not wired into imageAssetPolicyService here.
 * The parent integration supplies resolveReceiptAsset and verifyLicenseEvidence
 * explicitly after the upload and review routes have adopted the transaction
 * ordering documented above.
 */
export const imageAssetTrustLedgerService =
  createImageAssetTrustLedgerService();

/**
 * The only production upload helper. The caller supplies bytes held by the
 * server and the `storagePut` result; expiry is server-derived. A caller may
 * create a signed receipt only after this resolves.
 */
export async function recordServerControlledImageUpload(
  input: Omit<RecordControlledUploadInput, "expiresAt">
) {
  try {
    return await imageAssetTrustLedgerService.recordControlledUpload({
      ...input,
      expiresAt: new Date(Date.now() + CONTROLLED_UPLOAD_RECEIPT_TTL_MS),
    });
  } catch (error) {
    throw new ControlledImageLedgerWriteError(error);
  }
}
