import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import {
  IMAGE_ASSET_ALLOWED_USES,
  IMAGE_ASSET_ORIGIN_KINDS,
  IMAGE_ASSET_REVIEW_STATES,
  imageAssetPolicyRevisions,
  imageAssetSourceReferences,
  imageAssets,
} from "../../../../drizzle/schema/imageAssetPolicies";
import { projects } from "../../../../drizzle/schema/project";
import type { DbExecutor } from "../../../repositories/dbClient";
import { getDb } from "../../../repositories/dbClient";
import { requireImageAssetReceipt, type ImageAssetKind } from "./imageAssetReceipt";
import { imageAssetTrustLedgerService } from "./imageAssetTrustLedgerService";
import type {
  AssetLicenseEvidence, CurrentPolicyEvidenceVerifier, LicenseEvidenceVerifier,
  ReceiptAssetResolver, VerifiedReceiptAsset,
} from "./imageAssetTypes";
export type {
  AssetLicenseEvidence, CurrentPolicyEvidenceVerifier, LicenseEvidenceVerifier,
  ReceiptAssetResolver, VerifiedReceiptAsset,
} from "./imageAssetTypes";

export type ImageAssetAllowedUse = (typeof IMAGE_ASSET_ALLOWED_USES)[number];
export type ImageAssetOriginKind = (typeof IMAGE_ASSET_ORIGIN_KINDS)[number];
export type ImageAssetReviewState = (typeof IMAGE_ASSET_REVIEW_STATES)[number];
export type ImageAssetSourceRole = "main" | "secondary" | "aplus" | "brand_story" | "video" | "unknown";

export type ImageAssetSource = {
  sourceSnapshotId?: number | null;
  sourceRole: ImageAssetSourceRole;
  sourceModule?: string | null;
  sourcePosition: number;
};

export type StoredAsset = {
  id?: number;
  assetId: string;
  workspaceId: number;
  contentHash: string | null;
  storageRef: string;
  contentType?: string | null;
  sizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  createdBy: number;
};

export type StoredSourceReference = {
  id?: number;
  assetId: string;
  workspaceId: number;
  projectId: number;
  sourceSnapshotId?: number | null;
  originRecordType: string;
  originRecordId: string;
  sourceRole: ImageAssetSourceRole;
  sourceModule: string;
  sourcePosition: number;
  sourceReferenceKey: string;
  createdBy: number;
};

export type StoredPolicy = {
  id?: number;
  assetId: string;
  workspaceId: number;
  projectId: number;
  sourceReferenceId?: number | null;
  originKind: ImageAssetOriginKind;
  originRecordType: string;
  originRecordId: string;
  contentHash: string | null;
  allowedUsesJson: unknown;
  licenseEvidenceJson: unknown;
  reviewState: ImageAssetReviewState;
  revision: number;
  policyHash: string;
  createdBy: number;
  reviewedBy?: number | null;
  reviewedAt?: Date | null;
  reviewNote?: string | null;
};

export type ImageAssetPolicyStore = {
  transaction<T>(callback: (tx: DbExecutor) => Promise<T>): Promise<T>;
  lockAuthorizedProject(tx: DbExecutor, input: ScopeActor): Promise<void>;
  findAssetByContentHash(tx: DbExecutor, workspaceId: number, contentHash: string): Promise<StoredAsset | null>;
  findAssetById(tx: DbExecutor, workspaceId: number, assetId: string): Promise<StoredAsset | null>;
  insertAsset(tx: DbExecutor, asset: StoredAsset): Promise<StoredAsset>;
  findSourceReference(tx: DbExecutor, input: Pick<StoredSourceReference, "workspaceId" | "projectId" | "sourceReferenceKey">): Promise<StoredSourceReference | null>;
  insertSourceReference(tx: DbExecutor, reference: StoredSourceReference): Promise<StoredSourceReference>;
  findLatestPolicy(tx: DbExecutor, input: AssetScope): Promise<StoredPolicy | null>;
  listPolicies(tx: DbExecutor, input: ScopeActor): Promise<StoredPolicy[]>;
  insertPolicy(tx: DbExecutor, policy: StoredPolicy): Promise<StoredPolicy>;
};

type ScopeActor = {
  workspaceId: number;
  projectId: number;
  actorId: number;
  actorRole: string;
};

type AssetScope = Pick<ScopeActor, "workspaceId" | "projectId"> & { assetId: string };

export type RegisterReceiptAssetInput = ScopeActor & {
  expectedRevision: number;
  originKind: "own_product" | "designer_upload";
  receiptReference: string;
  requestedUses: ImageAssetAllowedUse[];
  licenseEvidence: AssetLicenseEvidence;
  source: ImageAssetSource;
};

/** Internal-only bridge for a current human-confirmed acquisition asset. It is not exposed by the tRPC router. */
export type RegisterCompetitorResearchAssetInput = ScopeActor & {
  expectedRevision: number;
  acquisitionRecordId: string;
  verifiedAsset: VerifiedReceiptAsset;
  source: ImageAssetSource & { sourceSnapshotId: number };
};

export type ReviewAssetPolicyInput = ScopeActor & {
  assetId: string;
  expectedRevision: number;
  decision: "approve" | "reject" | "revoke";
  allowedUses?: ImageAssetAllowedUse[];
  licenseEvidence?: AssetLicenseEvidence;
  reviewNote?: string;
};

export type CurrentAssetUseInput = ScopeActor & {
  assetId: string;
  allowedUse: ImageAssetAllowedUse;
  expectedRevision: number;
};

export type PublicPolicySummary = {
  assetId: string;
  originKind: ImageAssetOriginKind;
  allowedUses: ImageAssetAllowedUse[];
  reviewState: ImageAssetReviewState;
  revision: number;
  reviewedAt: Date | null;
  hasLicenseEvidence: boolean;
};

export type AuthorizedAssetUse = PublicPolicySummary & { contentHash: string; storageRef: string };

function fail(code: "BAD_REQUEST" | "CONFLICT" | "FORBIDDEN" | "NOT_FOUND" | "PRECONDITION_FAILED" | "INTERNAL_SERVER_ERROR", message: string): never {
  throw new TRPCError({ code, message });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}

function digest(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function ensureContentHash(value: string): string {
  const hash = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(hash)) fail("PRECONDITION_FAILED", "素材缺少服务端校验的 SHA-256 内容哈希");
  return hash;
}

function normalizeUses(value: ImageAssetAllowedUse[]): ImageAssetAllowedUse[] {
  const uses = [...new Set(value)].sort() as ImageAssetAllowedUse[];
  if (!uses.length || uses.some(use => !IMAGE_ASSET_ALLOWED_USES.includes(use))) fail("BAD_REQUEST", "图片用途包含不支持的值");
  return uses;
}

function normalizeEvidence(value: AssetLicenseEvidence): AssetLicenseEvidence {
  const evidence = {
    proofRecordId: value?.proofRecordId?.trim(),
    proofType: value?.proofType?.trim(),
    grantSummary: value?.grantSummary?.trim(),
  };
  if (!evidence.proofRecordId || !evidence.proofType || !evidence.grantSummary) {
    fail("PRECONDITION_FAILED", "必须提供可核验的许可证明记录、类型和授权说明");
  }
  return evidence as AssetLicenseEvidence;
}

function receiptKind(originKind: "own_product" | "designer_upload"): ImageAssetKind {
  return originKind === "designer_upload" ? "designer" : "step4-ref";
}

function assertAllowedUses(originKind: ImageAssetOriginKind, uses: ImageAssetAllowedUse[]) {
  if (originKind === "competitor_research" && (uses.length !== 1 || uses[0] !== "analysis_reference_only")) {
    fail("FORBIDDEN", "竞品图片仅能作为研究证据，不能成为我方素材、设计师附件、图生图输入或交付物");
  }
  if (originKind === "legacy_unclassified") {
    fail("PRECONDITION_FAILED", "历史未分类图片必须先完成受控归类，不能通过当前用途审核");
  }
  if (uses.includes("step4_reference") && !["own_product", "designer_upload"].includes(originKind)) {
    fail("FORBIDDEN", "仅受签且许可已核验的本品图片或设计师上传可用作 Step 4 参考");
  }
}

function assertReviewActor(role: string) {
  if (!["admin", "super_admin"].includes(role)) fail("FORBIDDEN", "仅管理员可完成人工图片用途审核");
}

function sourceReference(input: {
  workspaceId: number;
  projectId: number;
  assetId: string;
  originRecordType: string;
  originRecordId: string;
  source: ImageAssetSource;
  createdBy: number;
}): StoredSourceReference {
  const sourceModule = input.source.sourceModule?.trim() || "";
  const sourceSnapshotId = input.source.sourceSnapshotId ?? null;
  if (!Number.isInteger(input.source.sourcePosition) || input.source.sourcePosition < 0) fail("BAD_REQUEST", "图片来源位置无效");
  return {
    assetId: input.assetId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    sourceSnapshotId,
    originRecordType: input.originRecordType,
    originRecordId: input.originRecordId,
    sourceRole: input.source.sourceRole,
    sourceModule,
    sourcePosition: input.source.sourcePosition,
    sourceReferenceKey: digest({
      workspaceId: input.workspaceId, projectId: input.projectId, originRecordType: input.originRecordType,
      originRecordId: input.originRecordId, sourceSnapshotId, sourceRole: input.source.sourceRole,
      sourceModule, sourcePosition: input.source.sourcePosition,
    }),
    createdBy: input.createdBy,
  };
}

function sameSource(existing: StoredSourceReference, intended: StoredSourceReference) {
  return existing.assetId === intended.assetId
    && existing.originRecordType === intended.originRecordType
    && existing.originRecordId === intended.originRecordId
    && existing.sourceSnapshotId === intended.sourceSnapshotId
    && existing.sourceRole === intended.sourceRole
    && existing.sourceModule === intended.sourceModule
    && existing.sourcePosition === intended.sourcePosition;
}

function policyHash(input: Omit<StoredPolicy, "id" | "policyHash" | "createdBy" | "reviewedBy" | "reviewedAt">) {
  return digest(input);
}

function policySummary(policy: StoredPolicy): PublicPolicySummary {
  return {
    assetId: policy.assetId,
    originKind: policy.originKind,
    allowedUses: normalizeUses(policy.allowedUsesJson as ImageAssetAllowedUse[]),
    reviewState: policy.reviewState,
    revision: policy.revision,
    reviewedAt: policy.reviewedAt ?? null,
    hasLicenseEvidence: Boolean(policy.licenseEvidenceJson),
  };
}

function assertRevision(current: StoredPolicy | null, expectedRevision: number) {
  if ((current?.revision ?? 0) !== expectedRevision) {
    fail("CONFLICT", "图片用途策略已更新，请刷新后基于当前修订重试");
  }
}

function requireCurrentApproval(policy: StoredPolicy | null, input: CurrentAssetUseInput): StoredPolicy {
  assertRevision(policy, input.expectedRevision);
  if (!policy || policy.reviewState !== "approved") fail("PRECONDITION_FAILED", "图片用途尚未由人工审核通过或已过期");
  if (policy.originKind === "legacy_unclassified") fail("PRECONDITION_FAILED", "历史未分类图片不能进入当前工作流");
  if (!normalizeUses(policy.allowedUsesJson as ImageAssetAllowedUse[]).includes(input.allowedUse)) {
    fail("FORBIDDEN", "该图片未被批准用于当前工作流步骤");
  }
  return policy;
}

function sameRegistration(policy: StoredPolicy, input: {
  originKind: ImageAssetOriginKind;
  originRecordType: string;
  originRecordId: string;
  contentHash: string;
  uses: ImageAssetAllowedUse[];
}) {
  return policy.originKind === input.originKind
    && policy.originRecordType === input.originRecordType
    && policy.originRecordId === input.originRecordId
    && policy.contentHash === input.contentHash
    && stableJson(normalizeUses(policy.allowedUsesJson as ImageAssetAllowedUse[])) === stableJson(input.uses);
}

async function unavailableReceiptResolver(): Promise<VerifiedReceiptAsset> {
  fail("PRECONDITION_FAILED", "受签上传回执尚未连接不可变字节元数据；拒绝用浏览器哈希或旧图库 URL 登记素材");
}

async function unavailableLicenseVerifier(): Promise<boolean> {
  return false;
}

async function unavailableCurrentPolicyEvidenceVerifier(): Promise<boolean> {
  return false;
}

function drizzleStore(): ImageAssetPolicyStore {
  return {
    async transaction<T>(callback: (tx: DbExecutor) => Promise<T>) {
      const database = await getDb();
      if (!database) fail("INTERNAL_SERVER_ERROR", "图片用途账本暂不可用");
      if (typeof (database as any).transaction !== "function") {
        fail("PRECONDITION_FAILED", "图片用途账本缺少事务支持，已拒绝非原子审核与登记");
      }
      return (database as any).transaction(callback);
    },
    async lockAuthorizedProject(tx, input) {
      const rows = await tx.select().from(projects).where(eq(projects.id, input.projectId)).limit(1).for("update");
      const project = rows[0] as { workspaceId?: number | null; userId: number } | undefined;
      if (!project || Number(project.workspaceId) !== input.workspaceId) fail("FORBIDDEN", "项目不属于当前已授权工作空间");
      if (project.userId !== input.actorId && !["admin", "super_admin"].includes(input.actorRole)) {
        fail("FORBIDDEN", "当前用户无权修改此项目的图片资产策略");
      }
    },
    async findAssetByContentHash(tx, workspaceId, contentHash) {
      const rows = await tx.select().from(imageAssets).where(and(
        eq(imageAssets.workspaceId, workspaceId), eq(imageAssets.contentHash, contentHash),
      )).limit(1).for("update");
      return (rows[0] as StoredAsset | undefined) ?? null;
    },
    async findAssetById(tx, workspaceId, assetId) {
      const rows = await tx.select().from(imageAssets).where(and(
        eq(imageAssets.workspaceId, workspaceId), eq(imageAssets.assetId, assetId),
      )).limit(1).for("update");
      return (rows[0] as StoredAsset | undefined) ?? null;
    },
    async insertAsset(tx, asset) {
      const [created] = await tx.insert(imageAssets).values(asset).$returningId();
      return { ...asset, id: Number(created.id) };
    },
    async findSourceReference(tx, input) {
      const rows = await tx.select().from(imageAssetSourceReferences).where(and(
        eq(imageAssetSourceReferences.workspaceId, input.workspaceId),
        eq(imageAssetSourceReferences.projectId, input.projectId),
        eq(imageAssetSourceReferences.sourceReferenceKey, input.sourceReferenceKey),
      )).limit(1).for("update");
      return (rows[0] as StoredSourceReference | undefined) ?? null;
    },
    async insertSourceReference(tx, reference) {
      const [created] = await tx.insert(imageAssetSourceReferences).values(reference).$returningId();
      return { ...reference, id: Number(created.id) };
    },
    async findLatestPolicy(tx, input) {
      const rows = await tx.select().from(imageAssetPolicyRevisions).where(and(
        eq(imageAssetPolicyRevisions.workspaceId, input.workspaceId),
        eq(imageAssetPolicyRevisions.projectId, input.projectId),
        eq(imageAssetPolicyRevisions.assetId, input.assetId),
      )).orderBy(desc(imageAssetPolicyRevisions.revision), desc(imageAssetPolicyRevisions.id)).limit(1).for("update");
      return (rows[0] as StoredPolicy | undefined) ?? null;
    },
    async listPolicies(tx, input) {
      return tx.select().from(imageAssetPolicyRevisions).where(and(
        eq(imageAssetPolicyRevisions.workspaceId, input.workspaceId),
        eq(imageAssetPolicyRevisions.projectId, input.projectId),
      )).orderBy(desc(imageAssetPolicyRevisions.revision), desc(imageAssetPolicyRevisions.id)) as Promise<StoredPolicy[]>;
    },
    async insertPolicy(tx, policy) {
      const [created] = await tx.insert(imageAssetPolicyRevisions).values(policy).$returningId();
      return { ...policy, id: Number(created.id) };
    },
  };
}

export function createImageAssetPolicyService(dependencies: {
  store?: ImageAssetPolicyStore;
  resolveReceiptAsset?: ReceiptAssetResolver;
  verifyLicenseEvidence?: LicenseEvidenceVerifier;
  verifyCurrentPolicyEvidence?: CurrentPolicyEvidenceVerifier;
} = {}) {
  const store = dependencies.store ?? drizzleStore();
  const resolveReceiptAsset = dependencies.resolveReceiptAsset ?? unavailableReceiptResolver;
  const verifyLicenseEvidence = dependencies.verifyLicenseEvidence ?? unavailableLicenseVerifier;
  const verifyCurrentPolicyEvidence = dependencies.verifyCurrentPolicyEvidence ?? unavailableCurrentPolicyEvidenceVerifier;

  async function verifiedReceipt(input: {
    reference: string;
    kind: ImageAssetKind;
    projectId: number;
    userId: number;
  }) {
    const receipt = requireImageAssetReceipt({ reference: input.reference, kind: input.kind, projectId: input.projectId, userId: input.userId });
    const asset = await resolveReceiptAsset({ receipt, projectId: input.projectId, uploadedBy: input.userId });
    return { receipt, asset: { ...asset, contentHash: ensureContentHash(asset.contentHash) } };
  }

  async function getOrCreateAsset(tx: DbExecutor, scope: ScopeActor, asset: VerifiedReceiptAsset): Promise<StoredAsset> {
    const existing = await store.findAssetByContentHash(tx, scope.workspaceId, asset.contentHash);
    if (existing) return existing;
    const proposed: StoredAsset = {
      assetId: `asset_${asset.contentHash}`,
      workspaceId: scope.workspaceId,
      contentHash: asset.contentHash,
      storageRef: asset.storageRef,
      contentType: asset.contentType ?? null,
      sizeBytes: asset.sizeBytes ?? null,
      width: asset.width ?? null,
      height: asset.height ?? null,
      createdBy: scope.actorId,
    };
    try {
      return await store.insertAsset(tx, proposed);
    } catch (error) {
      // The workspace/contentHash unique key resolves concurrent byte registration.
      const winner = await store.findAssetByContentHash(tx, scope.workspaceId, asset.contentHash);
      if (winner) return winner;
      throw error;
    }
  }

  async function preserveSourceReference(tx: DbExecutor, source: StoredSourceReference): Promise<StoredSourceReference> {
    const current = await store.findSourceReference(tx, source);
    if (!current) {
      try {
        return await store.insertSourceReference(tx, source);
      } catch (error) {
        const winner = await store.findSourceReference(tx, source);
        if (!winner) throw error;
        if (!sameSource(winner, source)) fail("CONFLICT", "同一来源图位已指向不同字节，拒绝覆盖或合并角色引用");
        return winner;
      }
    }
    if (!sameSource(current, source)) fail("CONFLICT", "同一来源图位已指向不同字节，拒绝覆盖或合并角色引用");
    return current;
  }

  async function registerPolicy(input: {
    scope: ScopeActor;
    expectedRevision: number;
    originKind: "competitor_research" | "own_product" | "designer_upload";
    originRecordType: string;
    originRecordId: string;
    verifiedAsset: VerifiedReceiptAsset;
    source: ImageAssetSource;
    allowedUses: ImageAssetAllowedUse[];
    licenseEvidence: AssetLicenseEvidence | null;
  }) {
    const uses = normalizeUses(input.allowedUses);
    assertAllowedUses(input.originKind, uses);
    const asset = { ...input.verifiedAsset, contentHash: ensureContentHash(input.verifiedAsset.contentHash) };
    return store.transaction(async tx => {
      await store.lockAuthorizedProject(tx, input.scope);
      const savedAsset = await getOrCreateAsset(tx, input.scope, asset);
      const savedSource = await preserveSourceReference(tx, sourceReference({
        workspaceId: input.scope.workspaceId, projectId: input.scope.projectId, assetId: savedAsset.assetId,
        originRecordType: input.originRecordType, originRecordId: input.originRecordId,
        source: input.source, createdBy: input.scope.actorId,
      }));
      if (!savedSource.id) fail("INTERNAL_SERVER_ERROR", "图片来源引用未返回稳定标识");
      const latest = await store.findLatestPolicy(tx, { ...input.scope, assetId: savedAsset.assetId });
      assertRevision(latest, input.expectedRevision);
      if (latest) {
        if (!sameRegistration(latest, { originKind: input.originKind, originRecordType: input.originRecordType,
          originRecordId: input.originRecordId, contentHash: asset.contentHash, uses })) {
          fail("CONFLICT", "该资产已有不同的当前用途策略；请以人工复核创建下一修订");
        }
        return policySummary(latest);
      }
      const policyWithoutHash: Omit<StoredPolicy, "id" | "policyHash" | "createdBy" | "reviewedBy" | "reviewedAt"> = {
        assetId: savedAsset.assetId, workspaceId: input.scope.workspaceId, projectId: input.scope.projectId,
        sourceReferenceId: savedSource.id, originKind: input.originKind, originRecordType: input.originRecordType,
        originRecordId: input.originRecordId, contentHash: asset.contentHash, allowedUsesJson: uses,
        licenseEvidenceJson: input.licenseEvidence, reviewState: "pending_review", revision: 1, reviewNote: null,
      };
      const saved = await store.insertPolicy(tx, {
        ...policyWithoutHash, policyHash: policyHash(policyWithoutHash), createdBy: input.scope.actorId,
        reviewedBy: null, reviewedAt: null,
      });
      return policySummary(saved);
    });
  }

  async function registerReceiptAsset(input: RegisterReceiptAssetInput) {
    const evidence = normalizeEvidence(input.licenseEvidence);
    const resolved = await verifiedReceipt({ reference: input.receiptReference, kind: receiptKind(input.originKind),
      projectId: input.projectId, userId: input.actorId });
    if (!await verifyLicenseEvidence({ evidence, asset: resolved.asset, originKind: input.originKind, projectId: input.projectId })) {
      fail("PRECONDITION_FAILED", "许可证明未通过服务端核验，不能登记为可审阅素材");
    }
    return registerPolicy({ scope: input, expectedRevision: input.expectedRevision, originKind: input.originKind,
      originRecordType: "controlled_upload_receipt", originRecordId: resolved.receipt.key, verifiedAsset: resolved.asset,
      source: input.source, allowedUses: input.requestedUses, licenseEvidence: evidence });
  }

  async function registerCompetitorResearchAsset(input: RegisterCompetitorResearchAssetInput) {
    if (!input.acquisitionRecordId.trim()) fail("BAD_REQUEST", "受控采集素材缺少来源记录");
    return registerPolicy({ scope: input, expectedRevision: input.expectedRevision, originKind: "competitor_research",
      originRecordType: "acquisition_asset_candidate", originRecordId: input.acquisitionRecordId.trim(),
      verifiedAsset: input.verifiedAsset, source: input.source, allowedUses: ["analysis_reference_only"], licenseEvidence: null });
  }

  async function reviewAssetPolicy(input: ReviewAssetPolicyInput) {
    assertReviewActor(input.actorRole);
    return store.transaction(async tx => {
      await store.lockAuthorizedProject(tx, input);
      const asset = await store.findAssetById(tx, input.workspaceId, input.assetId);
      if (!asset) fail("NOT_FOUND", "图片资产不存在或不属于当前工作空间");
      const latest = await store.findLatestPolicy(tx, { ...input, assetId: input.assetId });
      assertRevision(latest, input.expectedRevision);
      if (!latest) fail("NOT_FOUND", "图片用途策略不存在");
      const uses = normalizeUses(input.allowedUses ?? latest.allowedUsesJson as ImageAssetAllowedUse[]);
      assertAllowedUses(latest.originKind, uses);
      const reviewState: ImageAssetReviewState = input.decision === "approve" ? "approved"
        : input.decision === "revoke" ? "revoked" : "rejected";
      let evidence = latest.licenseEvidenceJson as AssetLicenseEvidence | null;
      const receiptBackedOrigin = latest.originKind === "own_product" || latest.originKind === "designer_upload"
        ? latest.originKind : null;
      if (reviewState === "approved" && receiptBackedOrigin) {
        evidence = normalizeEvidence(input.licenseEvidence ?? evidence as AssetLicenseEvidence);
        const currentEvidenceValid = await verifyCurrentPolicyEvidence({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          originKind: receiptBackedOrigin,
          originRecordType: latest.originRecordType,
          originRecordId: latest.originRecordId,
          asset: { contentHash: asset.contentHash ?? "", storageRef: asset.storageRef },
          evidence,
        });
        if (!currentEvidenceValid) {
          fail("PRECONDITION_FAILED", "审核通过前未能复验已核验证据和当前受控上传回执；请先处理许可材料或重新登记素材");
        }
      }
      const nextWithoutHash: Omit<StoredPolicy, "id" | "policyHash" | "createdBy" | "reviewedBy" | "reviewedAt"> = {
        assetId: latest.assetId, workspaceId: latest.workspaceId, projectId: latest.projectId,
        sourceReferenceId: latest.sourceReferenceId ?? null, originKind: latest.originKind,
        originRecordType: latest.originRecordType, originRecordId: latest.originRecordId, contentHash: latest.contentHash,
        allowedUsesJson: uses, licenseEvidenceJson: evidence, reviewState, revision: latest.revision + 1,
        reviewNote: input.reviewNote?.trim() || null,
      };
      const saved = await store.insertPolicy(tx, {
        ...nextWithoutHash, policyHash: policyHash(nextWithoutHash), createdBy: latest.createdBy,
        reviewedBy: input.actorId, reviewedAt: new Date(),
      });
      return policySummary(saved);
    });
  }

  async function listCurrentPolicies(input: ScopeActor): Promise<PublicPolicySummary[]> {
    return store.transaction(async tx => {
      await store.lockAuthorizedProject(tx, input);
      const currentByAsset = new Map<string, StoredPolicy>();
      for (const policy of await store.listPolicies(tx, input)) if (!currentByAsset.has(policy.assetId)) currentByAsset.set(policy.assetId, policy);
      return [...currentByAsset.values()].map(policySummary);
    });
  }

  async function requireCurrentApprovedAssetUse(input: CurrentAssetUseInput): Promise<AuthorizedAssetUse> {
    return store.transaction(async tx => {
      await store.lockAuthorizedProject(tx, input);
      const asset = await store.findAssetById(tx, input.workspaceId, input.assetId);
      if (!asset?.contentHash) fail("NOT_FOUND", "图片资产不存在或缺少可核验字节身份");
      const policy = requireCurrentApproval(await store.findLatestPolicy(tx, input), input);
      if (policy.originKind === "own_product" || policy.originKind === "designer_upload") {
        const evidenceStillValid = await verifyCurrentPolicyEvidence({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          originKind: policy.originKind,
          originRecordType: policy.originRecordType,
          originRecordId: policy.originRecordId,
          asset: { contentHash: asset.contentHash, storageRef: asset.storageRef },
          evidence: policy.licenseEvidenceJson as AssetLicenseEvidence | null,
        });
        if (!evidenceStillValid) {
          fail("PRECONDITION_FAILED", "图片许可证明已失效、撤销或未与当前可信字节记录匹配");
        }
      }
      return { ...policySummary(policy), contentHash: asset.contentHash, storageRef: asset.storageRef };
    });
  }

  /**
   * Convert a server-signed receipt to its deterministic asset identity only by
   * resolving the byte ledger; a URL, storage key, or client-provided assetId
   * can never select a production asset. This gate deliberately accepts no
   * browser-supplied revision: it reads the current immutable revision.
   */
  async function requireApprovedReceiptAssetUse(input: ScopeActor & {
    receiptReference: string;
    kind: ImageAssetKind;
    allowedUse: ImageAssetAllowedUse;
  }): Promise<AuthorizedAssetUse> {
    const resolved = await verifiedReceipt({
      reference: input.receiptReference,
      kind: input.kind,
      projectId: input.projectId,
      userId: input.actorId,
    });
    const assetId = `asset_${resolved.asset.contentHash}`;
    return store.transaction(async tx => {
      await store.lockAuthorizedProject(tx, input);
      const asset = await store.findAssetById(tx, input.workspaceId, assetId);
      if (!asset?.contentHash || asset.contentHash !== resolved.asset.contentHash || asset.storageRef !== resolved.asset.storageRef) {
        fail("PRECONDITION_FAILED", "受签上传回执尚未完成与可信资产策略的一致登记");
      }
      const policy = await store.findLatestPolicy(tx, { ...input, assetId });
      if (!policy || policy.reviewState !== "approved") {
        fail("PRECONDITION_FAILED", "图片用途尚未由人工审核通过或已过期");
      }
      if (!normalizeUses(policy.allowedUsesJson as ImageAssetAllowedUse[]).includes(input.allowedUse)) {
        fail("FORBIDDEN", "该图片未被批准用于当前工作流步骤");
      }
      if (policy.originKind !== "own_product" && policy.originKind !== "designer_upload") {
        fail("FORBIDDEN", "竞品研究图片及其他非我方来源不能参与制作");
      }
      if (!await verifyCurrentPolicyEvidence({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        originKind: policy.originKind,
        originRecordType: policy.originRecordType,
        originRecordId: policy.originRecordId,
        asset: { contentHash: asset.contentHash, storageRef: asset.storageRef },
        evidence: policy.licenseEvidenceJson as AssetLicenseEvidence | null,
      })) {
        fail("PRECONDITION_FAILED", "图片许可证明已失效、撤销或未与当前可信字节记录匹配");
      }
      return { ...policySummary(policy), contentHash: asset.contentHash, storageRef: asset.storageRef };
    });
  }

  return { registerReceiptAsset, registerCompetitorResearchAsset, reviewAssetPolicy, listCurrentPolicies, requireCurrentApprovedAssetUse, requireApprovedReceiptAssetUse };
}

/** The production singleton has no fallback resolver/verifier. Missing ledger
 * tables or evidence makes registration and consumption fail closed. */
export const imageAssetPolicyService = createImageAssetPolicyService({
  resolveReceiptAsset: imageAssetTrustLedgerService.resolveReceiptAsset,
  verifyLicenseEvidence: imageAssetTrustLedgerService.verifyLicenseEvidence,
  verifyCurrentPolicyEvidence: imageAssetTrustLedgerService.verifyCurrentPolicyEvidence,
});
