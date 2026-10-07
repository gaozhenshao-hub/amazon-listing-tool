import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { imageWorkflowSessions, imageWorkflowStep4ImageVersions } from "../../../../drizzle/schema/image";
import { projects } from "../../../../drizzle/schema/project";
import { getDb, type DbExecutor } from "../../../repositories/dbClient";
import { imageAssetPolicyService } from "./imageAssetPolicyService";

/**
 * Phase D local policy layer. It deliberately has no router, external-call, or DB
 * side effect: a persistence adapter must serialize scope changes and append
 * immutable snapshots/state events through the store contract below.
 */
export const IMAGE_WORKFLOW_STEPS = [0, 1, 2, 3, 4, 5, 6] as const;
export type ImageWorkflowStep = (typeof IMAGE_WORKFLOW_STEPS)[number];

export const IMAGE_WORKFLOW_ASSET_USES = [
  "analysis_reference_only",
  "step4_reference",
  "designer_attachment",
  "first_party_listing",
  "first_party_aplus",
  "image_generation_input",
  "approved_deliverable",
] as const;
export type ImageWorkflowAssetUse = (typeof IMAGE_WORKFLOW_ASSET_USES)[number];

export type SnapshotContentOrigin = "human_confirmed" | "legacy_human_confirmed" | "ai_draft";
export type SnapshotState = "confirmed" | "superseded" | "invalidated";
export type InvalidationReason =
  | "content_version_changed"
  | "upstream_content_version_changed"
  | "image_purpose_version_changed"
  | "snapshot_replaced";

export type ImageWorkflowVersionScope = {
  workspaceId: number;
  projectId: number;
  sessionId: number;
};

export type ImageWorkflowScopeActor = ImageWorkflowVersionScope & {
  actorId: number;
  actorRole: string;
};

export const IMAGE_WORKFLOW_VERSION_REPAIR_MESSAGE = "图片工作流版本快照尚未初始化或当前会话没有可核验版本；请管理员仅在开发库审核并执行 0206 增量迁移后，由操作者逐段重新人工确认。系统不会自动回填或修改历史会话数据。";

export type ImageAssetDependency = {
  assetId: string;
  /** Human-readable use in this step, e.g. `main-1 composition reference`. */
  purpose: string;
  allowedUse: ImageWorkflowAssetUse;
  originKind: "competitor_research" | "own_product" | "approved_knowledge_reference" | "designer_upload" | "legacy_unclassified";
  reviewState: "approved" | "pending_review" | "rejected" | "revoked" | "unclassified" | "superseded";
  policyRevision: number;
  policyHash: string;
  contentHash: string;
  /** Exact URL/token occurrences in content that this asset controls. */
  contentReferences?: readonly string[];
  /** True only when this asset is copied into the export package. */
  includedInExport?: boolean;
};

export type SnapshotDependency = {
  step: ImageWorkflowStep;
  version: number;
  snapshotDigest: string;
};

export type StageConfirmationRequest = ImageWorkflowVersionScope & {
  actorId: number;
  expectedScopeRevision: number;
  step: ImageWorkflowStep;
  content: unknown;
  /** Immutable revision of the human-confirmed content source. */
  contentRevision: number;
  contentOrigin: SnapshotContentOrigin;
  sourceConfirmed: boolean;
  assetDependencies?: readonly ImageAssetDependency[];
};

export type StageDraft = ImageWorkflowVersionScope & {
  step: ImageWorkflowStep;
  content: unknown;
  contentRevision: number;
  contentOrigin: Exclude<SnapshotContentOrigin, "ai_draft">;
  sourceConfirmed: true;
  contentDigest: string;
  assetDependencies: readonly ImageAssetDependency[];
  assetDependencyDigest: string;
  dependencies: readonly SnapshotDependency[];
  dependencyDigest: string;
};

export type ImmutableStageSnapshot = StageDraft & {
  version: number;
  snapshotDigest: string;
  confirmedBy: number;
  confirmedAt: Date;
};

export type StoredStageSnapshot = ImmutableStageSnapshot & {
  state: SnapshotState;
};

export type SnapshotStateEvent = ImageWorkflowVersionScope & {
  snapshotDigest: string;
  state: SnapshotState;
  reason: InvalidationReason;
  actorId: number;
  occurredAt: Date;
};

export type ConfirmationInvalidationPlan = {
  changed: boolean;
  reason: InvalidationReason | null;
  supersedeSteps: readonly ImageWorkflowStep[];
  invalidateSteps: readonly ImageWorkflowStep[];
};

export type ExportableImageWorkflowSnapshot = {
  schema: "image-workflow-approved-snapshot/1.0";
  workspaceId: number;
  projectId: number;
  sessionId: number;
  sections: readonly {
    step: ImageWorkflowStep;
    title: string;
    version: number;
    snapshotDigest: string;
    content: unknown;
    assetDependencies: readonly ImageAssetDependency[];
  }[];
  manifestDigest: string;
};

/**
 * Bound into an AI job at enqueue time. A worker must verify the same fence
 * immediately before inference and immediately before writing a draft result.
 */
export type ImageWorkflowWorkerFence = {
  scopeRevision: number;
  upstreamDigest: string;
};

export class ImageWorkflowVersionPolicyError extends Error {
  constructor(
    readonly code: "BAD_REQUEST" | "CONFLICT" | "PRECONDITION_FAILED" | "FORBIDDEN" | "INTEGRITY_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "ImageWorkflowVersionPolicyError";
  }
}

export function asImageWorkflowVersionTrpcError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof ImageWorkflowVersionPolicyError) {
    throw new TRPCError({
      code: error.code === "INTEGRITY_ERROR" ? "INTERNAL_SERVER_ERROR" : error.code,
      message: error.message,
      cause: error,
    });
  }
  throw error;
}

function fail(code: ImageWorkflowVersionPolicyError["code"], message: string): never {
  throw new ImageWorkflowVersionPolicyError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Canonical JSON prevents object-key order from changing an immutable digest. */
export function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("BAD_REQUEST", "版本快照不能包含非有限数字");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  fail("BAD_REQUEST", "版本快照不能包含 undefined、函数或非 JSON 值");
}

export function immutableDigest(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function authorizedAssetPolicyDigest(policy: {
  assetId: string;
  originKind: string;
  allowedUses: readonly string[];
  reviewState: string;
  revision: number;
  contentHash: string;
  storageRef: string;
}): string {
  // The asset policy service deliberately exposes only its authorized current
  // view. Hash that complete server-derived view rather than trusting a client
  // policy hash; export repeats the same calculation before release.
  return immutableDigest({
    assetId: policy.assetId,
    originKind: policy.originKind,
    allowedUses: [...policy.allowedUses].sort(),
    reviewState: policy.reviewState,
    revision: policy.revision,
    contentHash: policy.contentHash,
    storageRef: policy.storageRef,
  });
}

function assertPositiveInteger(value: number, label: string, allowZero = false) {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) fail("BAD_REQUEST", `${label}必须是${allowZero ? "非负" : "正"}整数`);
}

function assertScope(scope: ImageWorkflowVersionScope) {
  assertPositiveInteger(scope.workspaceId, "工作空间ID");
  assertPositiveInteger(scope.projectId, "项目ID");
  assertPositiveInteger(scope.sessionId, "会话ID");
}

function assertSha256(value: string, label: string) {
  if (!/^[a-f0-9]{64}$/u.test(value)) fail("BAD_REQUEST", `${label}必须是小写 SHA-256 哈希`);
}

function assertMeaningfulContent(content: unknown) {
  if (typeof content === "string" && !content.trim()) fail("PRECONDITION_FAILED", "确认内容不能为空");
  if (Array.isArray(content) && content.length === 0) fail("PRECONDITION_FAILED", "确认内容不能为空数组");
  if (isRecord(content) && Object.keys(content).length === 0) fail("PRECONDITION_FAILED", "确认内容不能为空对象");
  if (content === null || content === undefined) fail("PRECONDITION_FAILED", "确认内容不能为空");
}

function normalizeAssetDependencies(value: readonly ImageAssetDependency[] | undefined): readonly ImageAssetDependency[] {
  const normalized = (value ?? []).map((asset) => {
    const assetId = asset.assetId?.trim();
    const purpose = asset.purpose?.trim();
    if (!assetId || !purpose) fail("PRECONDITION_FAILED", "图片依赖必须包含资产ID和明确用途");
    if (!IMAGE_WORKFLOW_ASSET_USES.includes(asset.allowedUse)) fail("BAD_REQUEST", "图片依赖用途不在受控词表内");
    if (asset.originKind === "legacy_unclassified" || asset.reviewState !== "approved") {
      fail("PRECONDITION_FAILED", "历史未分类或未经人工批准的图片不能进入确认快照");
    }
    assertPositiveInteger(asset.policyRevision, "图片用途策略版本");
    assertSha256(asset.policyHash, "图片用途策略哈希");
    assertSha256(asset.contentHash, "图片字节哈希");
    const contentReferences = [...new Set((asset.contentReferences ?? []).map(reference => reference.trim()).filter(Boolean))].sort();
    if (asset.includedInExport && asset.allowedUse !== "approved_deliverable") {
      fail("PRECONDITION_FAILED", "纳入交付包的图片必须有人工批准的 approved_deliverable 用途");
    }
    return {
      ...asset,
      assetId,
      purpose,
      contentReferences,
      includedInExport: Boolean(asset.includedInExport),
    };
  }).sort((left, right) => `${left.assetId}\u0000${left.purpose}`.localeCompare(`${right.assetId}\u0000${right.purpose}`));

  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const current = normalized[index];
    if (previous.assetId === current.assetId && previous.purpose === current.purpose) {
      fail("CONFLICT", "同一图片资产用途不能在一个不可变快照中重复登记");
    }
  }
  return normalized;
}

function normalizeDependencies(step: ImageWorkflowStep, dependencies: readonly SnapshotDependency[]): readonly SnapshotDependency[] {
  const required = IMAGE_WORKFLOW_STEPS.filter(candidate => candidate < step);
  const sorted = [...dependencies].sort((left, right) => left.step - right.step);
  if (sorted.length !== required.length || sorted.some((item, index) => item.step !== required[index])) {
    fail("PRECONDITION_FAILED", `Step ${step} 必须依赖全部已确认的上游 Step 0–${step - 1}`);
  }
  for (const dependency of sorted) {
    assertPositiveInteger(dependency.version, "上游快照版本");
    assertSha256(dependency.snapshotDigest, "上游快照哈希");
  }
  return sorted;
}

function dependencyDigest(input: {
  scope: ImageWorkflowVersionScope;
  step: ImageWorkflowStep;
  contentRevision: number;
  contentDigest: string;
  assetDependencyDigest: string;
  dependencies: readonly SnapshotDependency[];
}) {
  return immutableDigest({
    schema: "image-workflow-dependency/1.0",
    scope: input.scope,
    step: input.step,
    contentRevision: input.contentRevision,
    contentDigest: input.contentDigest,
    assetDependencyDigest: input.assetDependencyDigest,
    dependencies: input.dependencies,
  });
}

/**
 * Creates a confirmable draft only from an actual human-confirmed source. AI
 * drafts can be displayed/editable upstream but can never cross this boundary.
 */
export function buildHumanConfirmedStageDraft(
  input: Omit<StageConfirmationRequest, "actorId" | "expectedScopeRevision">,
  dependencies: readonly SnapshotDependency[],
): StageDraft {
  assertScope(input);
  assertPositiveInteger(input.contentRevision, "内容版本");
  assertMeaningfulContent(input.content);
  if (!input.sourceConfirmed || input.contentOrigin === "ai_draft") {
    fail("PRECONDITION_FAILED", "AI 草案未经人工确认，不能写入已确认图片建议快照");
  }
  const assetDependencies = normalizeAssetDependencies(input.assetDependencies);
  const contentDigest = immutableDigest(input.content);
  const assetDependencyDigest = immutableDigest(assetDependencies);
  const normalizedDependencies = normalizeDependencies(input.step, dependencies);
  return {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    sessionId: input.sessionId,
    step: input.step,
    content: input.content,
    contentRevision: input.contentRevision,
    contentOrigin: input.contentOrigin,
    sourceConfirmed: true,
    contentDigest,
    assetDependencies,
    assetDependencyDigest,
    dependencies: normalizedDependencies,
    dependencyDigest: dependencyDigest({
      scope: input,
      step: input.step,
      contentRevision: input.contentRevision,
      contentDigest,
      assetDependencyDigest,
      dependencies: normalizedDependencies,
    }),
  };
}

export function materializeImmutableStageSnapshot(input: {
  draft: StageDraft;
  version: number;
  confirmedBy: number;
  confirmedAt?: Date;
}): ImmutableStageSnapshot {
  assertPositiveInteger(input.version, "快照版本");
  assertPositiveInteger(input.confirmedBy, "确认人ID");
  const confirmedAt = input.confirmedAt ?? new Date();
  const snapshotDigest = immutableDigest({
    schema: "image-workflow-approved-snapshot/1.0",
    scope: {
      workspaceId: input.draft.workspaceId,
      projectId: input.draft.projectId,
      sessionId: input.draft.sessionId,
    },
    step: input.draft.step,
    version: input.version,
    contentOrigin: input.draft.contentOrigin,
    sourceConfirmed: input.draft.sourceConfirmed,
    contentRevision: input.draft.contentRevision,
    contentDigest: input.draft.contentDigest,
    assetDependencyDigest: input.draft.assetDependencyDigest,
    dependencyDigest: input.draft.dependencyDigest,
  });
  return { ...input.draft, version: input.version, snapshotDigest, confirmedBy: input.confirmedBy, confirmedAt };
}

function reasonForChange(existing: ImmutableStageSnapshot, draft: StageDraft): InvalidationReason {
  if (existing.contentRevision !== draft.contentRevision || existing.contentDigest !== draft.contentDigest) return "content_version_changed";
  if (existing.assetDependencyDigest !== draft.assetDependencyDigest) return "image_purpose_version_changed";
  if (existing.dependencyDigest !== draft.dependencyDigest) return "upstream_content_version_changed";
  return "snapshot_replaced";
}

/**
 * Replacing an upstream confirmation never edits it in place. The old current
 * snapshot is superseded and every currently confirmed downstream step becomes
 * invalid until a user confirms a new version.
 */
export function planConfirmationInvalidation(input: {
  existing: ImmutableStageSnapshot | null;
  draft: StageDraft;
  confirmedSteps: readonly ImageWorkflowStep[];
}): ConfirmationInvalidationPlan {
  if (!input.existing) return { changed: false, reason: null, supersedeSteps: [], invalidateSteps: [] };
  const reason = reasonForChange(input.existing, input.draft);
  if (reason === "snapshot_replaced") return { changed: false, reason: null, supersedeSteps: [], invalidateSteps: [] };
  return {
    changed: true,
    reason,
    supersedeSteps: [input.draft.step],
    invalidateSteps: input.confirmedSteps.filter(step => step > input.draft.step),
  };
}

function currentConfirmedByStep(snapshots: readonly StoredStageSnapshot[], scope: ImageWorkflowVersionScope) {
  const current = new Map<ImageWorkflowStep, StoredStageSnapshot>();
  for (const snapshot of snapshots) {
    if (snapshot.workspaceId !== scope.workspaceId || snapshot.projectId !== scope.projectId || snapshot.sessionId !== scope.sessionId) {
      fail("INTEGRITY_ERROR", "版本仓储返回了跨工作空间、项目或会话的快照");
    }
    if (snapshot.state !== "confirmed") continue;
    if (current.has(snapshot.step)) fail("INTEGRITY_ERROR", `Step ${snapshot.step} 存在多个当前确认快照`);
    current.set(snapshot.step, snapshot);
  }
  return current;
}

function assertSnapshotIntegrity(snapshot: ImmutableStageSnapshot) {
  const rebuilt = buildHumanConfirmedStageDraft({
    workspaceId: snapshot.workspaceId,
    projectId: snapshot.projectId,
    sessionId: snapshot.sessionId,
    step: snapshot.step,
    content: snapshot.content,
    contentRevision: snapshot.contentRevision,
    contentOrigin: snapshot.contentOrigin,
    sourceConfirmed: snapshot.sourceConfirmed,
    assetDependencies: snapshot.assetDependencies,
  }, snapshot.dependencies);
  if (rebuilt.contentDigest !== snapshot.contentDigest
    || rebuilt.assetDependencyDigest !== snapshot.assetDependencyDigest
    || rebuilt.dependencyDigest !== snapshot.dependencyDigest) {
    fail("INTEGRITY_ERROR", `Step ${snapshot.step} 的不可变依赖摘要不匹配`);
  }
  const rebuiltSnapshot = materializeImmutableStageSnapshot({
    draft: rebuilt,
    version: snapshot.version,
    confirmedBy: snapshot.confirmedBy,
    confirmedAt: snapshot.confirmedAt,
  });
  if (rebuiltSnapshot.snapshotDigest !== snapshot.snapshotDigest) fail("INTEGRITY_ERROR", `Step ${snapshot.step} 的不可变快照哈希不匹配`);
}

export function externalImageReferences(content: unknown): string[] {
  const references = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(/(?:https?:\/\/[^\s"'<>\\]+|data:image\/[a-z0-9.+-]+[^\s"'<>\\]*)/giu)) references.add(match[0]);
      return;
    }
    if (Array.isArray(value)) value.forEach(visit);
    else if (isRecord(value)) Object.values(value).forEach(visit);
  };
  visit(content);
  return [...references].sort();
}

function canonicalImageReference(reference: string) {
  if (reference.startsWith("data:image/")) return reference;
  try {
    const url = new URL(reference);
    url.hash = "";
    return url.toString();
  } catch {
    return reference;
  }
}

type ContentAssetBinding = { reference: string; assetId: string };

function collectContentAssetBindings(content: unknown): ContentAssetBinding[] {
  const bindings: ContentAssetBinding[] = [];
  const visit = (value: unknown, inheritedAssetId?: string) => {
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, inheritedAssetId));
      return;
    }
    if (!isRecord(value)) return;
    const assetId = [value.assetId, value.imageAssetId, value.controlledAssetId]
      .find((candidate): candidate is string => typeof candidate === "string" && Boolean(candidate.trim()))
      ?.trim() || inheritedAssetId;
    const explicitReferences = [value.contentReference, ...(Array.isArray(value.contentReferences) ? value.contentReferences : [])]
      .filter((candidate): candidate is string => typeof candidate === "string" && Boolean(candidate.trim()));
    if (assetId) for (const reference of explicitReferences) bindings.push({ reference: reference.trim(), assetId });
    for (const [key, nested] of Object.entries(value)) {
      if (typeof nested === "string" && /(?:url|src|uri)$/iu.test(key) && assetId) {
        bindings.push({ reference: nested.trim(), assetId });
      }
      if (nested && typeof nested === "object") visit(nested, assetId);
    }
  };
  visit(content);
  return bindings;
}

/**
 * Resolves every image identity from the server-side policy ledger. A browser URL
 * and a browser-supplied policy revision are never sufficient: the URL must be
 * paired with an asset ID that is currently approved for this project.
 */
export async function bindConfirmedStageAssets(input: ImageWorkflowScopeActor & {
  step: ImageWorkflowStep;
  content: unknown;
}): Promise<readonly ImageAssetDependency[]> {
  const references = externalImageReferences(input.content);
  if (!references.length) return [];
  if (references.some(reference => reference.startsWith("data:image/"))) {
    fail("PRECONDITION_FAILED", "内联图片没有可审核的资产身份，不能确认图片建议快照");
  }
  const bindings = collectContentAssetBindings(input.content);
  const bindingByReference = new Map<string, string>();
  for (const binding of bindings) {
    const canonical = canonicalImageReference(binding.reference);
    const current = bindingByReference.get(canonical);
    if (current && current !== binding.assetId) fail("CONFLICT", "同一图片引用声明了冲突的受控资产身份");
    bindingByReference.set(canonical, binding.assetId);
  }
  const policies = await imageAssetPolicyService.listCurrentPolicies({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    actorId: input.actorId,
    actorRole: input.actorRole,
  });
  const policyByAsset = new Map(policies.map(policy => [policy.assetId, policy]));
  const dependencies: ImageAssetDependency[] = [];
  const analysisOnly = input.step === 0;
  for (const [index, reference] of references.entries()) {
    const canonical = canonicalImageReference(reference);
    const assetId = bindingByReference.get(canonical);
    if (!assetId) {
      fail("PRECONDITION_FAILED", `图片引用 ${reference} 缺少服务端受控资产身份；请在资产审核后重新绑定，不能用裸 URL 确认`);
    }
    const policy = policyByAsset.get(assetId);
    if (!policy) fail("PRECONDITION_FAILED", "图片资产没有当前受审核用途策略，不能确认");
    // Step 4 has the additional source-use gate. Its actual bundle inclusion is
    // independently checked as approved_deliverable below.
    if (input.step === 4) {
      await imageAssetPolicyService.requireCurrentApprovedAssetUse({
        workspaceId: input.workspaceId, projectId: input.projectId, actorId: input.actorId, actorRole: input.actorRole,
        assetId, allowedUse: "step4_reference", expectedRevision: policy.revision,
      });
    }
    const approved = await imageAssetPolicyService.requireCurrentApprovedAssetUse({
      workspaceId: input.workspaceId, projectId: input.projectId, actorId: input.actorId, actorRole: input.actorRole,
      assetId, allowedUse: analysisOnly ? "analysis_reference_only" : "approved_deliverable", expectedRevision: policy.revision,
    });
    if (canonicalImageReference(approved.storageRef) !== canonical) {
      fail("CONFLICT", "图片引用与服务端受控资产字节地址不一致，拒绝确认");
    }
    dependencies.push({
      assetId: approved.assetId,
      purpose: analysisOnly ? `Step 0 竞品研究证据 ${index + 1}` : `Step ${input.step} 导出图片引用 ${index + 1}`,
      allowedUse: analysisOnly ? "analysis_reference_only" : "approved_deliverable",
      originKind: approved.originKind,
      reviewState: approved.reviewState,
      policyRevision: approved.revision,
      policyHash: authorizedAssetPolicyDigest(approved),
      contentHash: approved.contentHash,
      contentReferences: [reference],
      includedInExport: !analysisOnly,
    });
  }
  return dependencies;
}

async function assertCurrentExportAssetPolicies(input: ImageWorkflowScopeActor, snapshots: readonly StoredStageSnapshot[]) {
  for (const snapshot of snapshots) for (const dependency of snapshot.assetDependencies) {
    const approved = await imageAssetPolicyService.requireCurrentApprovedAssetUse({
      workspaceId: input.workspaceId, projectId: input.projectId, actorId: input.actorId, actorRole: input.actorRole,
      assetId: dependency.assetId,
      allowedUse: dependency.allowedUse,
      expectedRevision: dependency.policyRevision,
    });
    if (authorizedAssetPolicyDigest(approved) !== dependency.policyHash || approved.contentHash !== dependency.contentHash
      || approved.reviewState !== "approved" || approved.originKind !== dependency.originKind) {
      fail("PRECONDITION_FAILED", `Step ${snapshot.step} 的图片用途策略或字节身份已变化，关闭导出并请重新确认`);
    }
  }
}

function assertExportAssetSafety(snapshot: ImmutableStageSnapshot) {
  const approvedReferences = new Set<string>();
  const researchReferences = new Set<string>();
  for (const asset of snapshot.assetDependencies) {
    if (asset.originKind === "legacy_unclassified" || asset.reviewState !== "approved") {
      fail("PRECONDITION_FAILED", `Step ${snapshot.step} 含有未分类或未人工批准图片，关闭导出`);
    }
    if (asset.originKind === "competitor_research") {
      if (snapshot.step !== 0 || asset.allowedUse !== "analysis_reference_only" || asset.includedInExport) {
        fail("PRECONDITION_FAILED", "竞品研究图片只能作为 Step 0 内部证据，不能作为制作或交付素材");
      }
      for (const reference of asset.contentReferences ?? []) researchReferences.add(canonicalImageReference(reference));
      continue;
    }
    if (asset.includedInExport) {
      if (asset.allowedUse !== "approved_deliverable") {
        fail("PRECONDITION_FAILED", `Step ${snapshot.step} 的导出图片未获 approved_deliverable 用途许可`);
      }
      for (const reference of asset.contentReferences ?? []) approvedReferences.add(canonicalImageReference(reference));
    }
  }
  for (const reference of externalImageReferences(snapshot.content)) {
    if (reference.startsWith("data:image/")) fail("PRECONDITION_FAILED", "内联图片没有可审核的资产身份，关闭导出");
    if (snapshot.step === 0 && researchReferences.has(canonicalImageReference(reference))) continue;
    if (!approvedReferences.has(canonicalImageReference(reference))) {
      fail("PRECONDITION_FAILED", `图片引用 ${reference} 未绑定受控 approved_deliverable 资产，关闭导出`);
    }
  }
}

/** Approved export may describe Step 0 research but never carries competitor image URLs. */
function redactResearchImageReferences(content: unknown): unknown {
  if (typeof content === "string") {
    return content.replace(/(?:https?:\/\/[^\s"'<>\\]+|data:image\/[a-z0-9.+-]+[^\s"'<>\\]*)/giu, "[竞品研究图片证据已省略]");
  }
  if (Array.isArray(content)) return content.map(redactResearchImageReferences);
  if (isRecord(content)) return Object.fromEntries(Object.entries(content).map(([key, value]) => [key, redactResearchImageReferences(value)]));
  return content;
}

/** Validates a complete, current, human-confirmed Step 0 + Step 1–6 manifest. */
export function buildExportableImageWorkflowSnapshot(input: {
  scope: ImageWorkflowVersionScope;
  snapshots: readonly StoredStageSnapshot[];
}): ExportableImageWorkflowSnapshot {
  assertScope(input.scope);
  const current = currentConfirmedByStep(input.snapshots, input.scope);
  if (current.size !== IMAGE_WORKFLOW_STEPS.length || IMAGE_WORKFLOW_STEPS.some(step => !current.has(step))) {
    fail("PRECONDITION_FAILED", "Step 0 研究与 Step 1–6 制作必须全部由人工确认且当前有效，才能导出");
  }
  const ordered = IMAGE_WORKFLOW_STEPS.map(step => current.get(step)!);
  for (const snapshot of ordered) {
    assertSnapshotIntegrity(snapshot);
    const expectedDependencies = ordered.filter(candidate => candidate.step < snapshot.step).map(candidate => ({
      step: candidate.step,
      version: candidate.version,
      snapshotDigest: candidate.snapshotDigest,
    }));
    if (stableJson(snapshot.dependencies) !== stableJson(expectedDependencies)) {
      fail("PRECONDITION_FAILED", `Step ${snapshot.step} 依赖的是旧上游版本，关闭导出`);
    }
    assertExportAssetSafety(snapshot);
  }
  const sections = ordered.map(snapshot => ({
    step: snapshot.step,
    title: snapshot.step === 0 ? "Step 0 竞品研究" : `Step ${snapshot.step} 图片制作`,
    version: snapshot.version,
    snapshotDigest: snapshot.snapshotDigest,
    content: snapshot.step === 0 ? redactResearchImageReferences(snapshot.content) : snapshot.content,
    assetDependencies: snapshot.assetDependencies.map(asset => asset.originKind === "competitor_research"
      ? { ...asset, contentReferences: [] }
      : asset),
  }));
  return {
    schema: "image-workflow-approved-snapshot/1.0",
    ...input.scope,
    sections,
    manifestDigest: immutableDigest({ schema: "image-workflow-approved-export-manifest/1.0", scope: input.scope, sections }),
  };
}

/**
 * DB adapter contract. `lockScope` must verify project/workspace membership and
 * hold a row lock; `advanceScopeRevision` must be a compare-and-swap update.
 * Snapshot content is append-only; state changes are append-only events.
 */
export type ImageWorkflowVersionStore<Tx = unknown> = {
  transaction<T>(callback: (tx: Tx) => Promise<T>): Promise<T>;
  lockScope(tx: Tx, scope: ImageWorkflowVersionScope): Promise<void>;
  getScopeRevision(tx: Tx, scope: ImageWorkflowVersionScope): Promise<number>;
  listSnapshots(tx: Tx, scope: ImageWorkflowVersionScope): Promise<readonly StoredStageSnapshot[]>;
  appendSnapshot(tx: Tx, snapshot: ImmutableStageSnapshot): Promise<void>;
  appendStateEvents(tx: Tx, events: readonly SnapshotStateEvent[]): Promise<void>;
  advanceScopeRevision(tx: Tx, input: ImageWorkflowVersionScope & { expectedRevision: number }): Promise<boolean>;
};

export type ImageWorkflowLegacyProjection = {
  /** The exact human-edited JSON that was bound into the immutable snapshot. */
  userEditJson: string;
  /** Step 4 needs its legacy display projection to use the same bound content. */
  mirrorAiResult?: boolean;
};

function repairRequired(error: unknown): never {
  if (error instanceof ImageWorkflowVersionPolicyError) throw error;
  if (error instanceof TRPCError) throw error;
  const message = error instanceof Error ? error.message : String(error || "");
  if (/image_workflow_(?:version_scopes|stage_snapshots|snapshot_state_events)|doesn't exist|does not exist|ER_NO_SUCH_TABLE/i.test(message)) {
    fail("PRECONDITION_FAILED", IMAGE_WORKFLOW_VERSION_REPAIR_MESSAGE);
  }
  fail("INTEGRITY_ERROR", `图片工作流版本账本不可用，已拒绝继续确认或导出：${message || "未知错误"}`);
}

function resultRows(value: unknown): any[] {
  if (Array.isArray(value) && Array.isArray(value[0])) return value[0] as any[];
  if (Array.isArray(value)) return value as any[];
  return [];
}

function affectedRows(value: unknown) {
  const result = value as any;
  return Number(result?.affectedRows ?? result?.[0]?.affectedRows ?? result?.rowsAffected ?? 0);
}

function jsonValue(value: unknown, label: string): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { fail("INTEGRITY_ERROR", `${label}不是有效 JSON`); }
}

function snapshotFromRow(row: any): StoredStageSnapshot {
  const confirmedAt = row.confirmedAt instanceof Date ? row.confirmedAt : new Date(String(row.confirmedAt));
  if (Number.isNaN(confirmedAt.getTime())) fail("INTEGRITY_ERROR", "版本快照确认时间无效");
  return {
    workspaceId: Number(row.workspaceId),
    projectId: Number(row.projectId),
    sessionId: Number(row.sessionId),
    step: Number(row.step) as ImageWorkflowStep,
    version: Number(row.version),
    content: jsonValue(row.contentJson, "快照正文"),
    contentRevision: Number(row.contentRevision),
    contentOrigin: row.contentOrigin,
    sourceConfirmed: true,
    contentDigest: String(row.contentDigest),
    assetDependencies: jsonValue(row.assetDependenciesJson, "图片依赖") as readonly ImageAssetDependency[],
    assetDependencyDigest: String(row.assetDependencyDigest),
    dependencies: jsonValue(row.dependenciesJson, "上游依赖") as readonly SnapshotDependency[],
    dependencyDigest: String(row.dependencyDigest),
    snapshotDigest: String(row.snapshotDigest),
    confirmedBy: Number(row.confirmedBy),
    confirmedAt,
    state: row.state as SnapshotState,
  };
}

/**
 * The 0206 tables intentionally have no generated Drizzle schema until that
 * additive migration is approved. This adapter is therefore both migration-gated
 * and fail-closed: absent tables never fall back to legacy session fields.
 */
export function createDrizzleImageWorkflowVersionStore(): ImageWorkflowVersionStore<DbExecutor> {
  return {
    async transaction<T>(callback: (tx: DbExecutor) => Promise<T>) {
      const database = await getDb();
      if (!database) fail("PRECONDITION_FAILED", IMAGE_WORKFLOW_VERSION_REPAIR_MESSAGE);
      try {
        if (typeof (database as any).transaction !== "function") {
          fail("PRECONDITION_FAILED", "图片工作流版本账本要求数据库事务支持；系统拒绝在无事务连接上确认、失效或导出");
        }
        return await (database as any).transaction(callback);
      } catch (error) {
        return repairRequired(error);
      }
    },
    async lockScope(tx, scope) {
      const membership = await tx.select({ sessionId: imageWorkflowSessions.id })
        .from(imageWorkflowSessions)
        .innerJoin(projects, eq(projects.id, imageWorkflowSessions.projectId))
        .where(and(
          eq(imageWorkflowSessions.id, scope.sessionId),
          eq(imageWorkflowSessions.projectId, scope.projectId),
          eq(projects.id, scope.projectId),
          eq(projects.workspaceId, scope.workspaceId),
        ))
        .limit(1)
        .for("update");
      if (!membership[0]) fail("FORBIDDEN", "会话不属于当前已授权工作空间或项目");
      try {
        await tx.execute(sql`
          INSERT INTO image_workflow_version_scopes (workspaceId, projectId, sessionId, revision)
          VALUES (${scope.workspaceId}, ${scope.projectId}, ${scope.sessionId}, 0)
          ON DUPLICATE KEY UPDATE sessionId = VALUES(sessionId)
        `);
      } catch (error) {
        repairRequired(error);
      }
    },
    async getScopeRevision(tx, scope) {
      try {
        const rows = resultRows(await tx.execute(sql`
          SELECT revision FROM image_workflow_version_scopes
          WHERE workspaceId = ${scope.workspaceId} AND projectId = ${scope.projectId} AND sessionId = ${scope.sessionId}
          FOR UPDATE
        `));
        if (!rows[0]) fail("INTEGRITY_ERROR", "图片工作流版本范围未在锁定后创建");
        return Number(rows[0].revision);
      } catch (error) {
        repairRequired(error);
      }
    },
    async listSnapshots(tx, scope) {
      try {
        const rows = resultRows(await tx.execute(sql`
          SELECT s.workspaceId, s.projectId, s.sessionId, s.step, s.version,
                 s.contentOrigin, s.contentRevision, s.contentJson, s.contentDigest,
                 s.assetDependenciesJson, s.assetDependencyDigest, s.dependenciesJson,
                 s.dependencyDigest, s.snapshotDigest, s.confirmedBy, s.confirmedAt,
                 e.state
          FROM image_workflow_stage_snapshots s
          INNER JOIN image_workflow_snapshot_state_events e
            ON e.id = (
              SELECT latest.id FROM image_workflow_snapshot_state_events latest
              WHERE latest.workspaceId = s.workspaceId
                AND latest.projectId = s.projectId
                AND latest.sessionId = s.sessionId
                AND latest.snapshotDigest = s.snapshotDigest
              ORDER BY latest.id DESC LIMIT 1
            )
          WHERE s.workspaceId = ${scope.workspaceId}
            AND s.projectId = ${scope.projectId}
            AND s.sessionId = ${scope.sessionId}
          ORDER BY s.step ASC, s.version ASC
        `));
        return rows.map(snapshotFromRow);
      } catch (error) {
        repairRequired(error);
      }
    },
    async appendSnapshot(tx, snapshot) {
      try {
        const inserted = await tx.execute(sql`
          INSERT INTO image_workflow_stage_snapshots
            (workspaceId, projectId, sessionId, step, version, contentOrigin, contentRevision,
             contentJson, contentDigest, assetDependenciesJson, assetDependencyDigest,
             dependenciesJson, dependencyDigest, snapshotDigest, confirmedBy, confirmedAt)
          VALUES
            (${snapshot.workspaceId}, ${snapshot.projectId}, ${snapshot.sessionId}, ${snapshot.step}, ${snapshot.version},
             ${snapshot.contentOrigin}, ${snapshot.contentRevision}, ${JSON.stringify(snapshot.content)}, ${snapshot.contentDigest},
             ${JSON.stringify(snapshot.assetDependencies)}, ${snapshot.assetDependencyDigest}, ${JSON.stringify(snapshot.dependencies)},
             ${snapshot.dependencyDigest}, ${snapshot.snapshotDigest}, ${snapshot.confirmedBy}, ${snapshot.confirmedAt})
        `);
        if (affectedRows(inserted) !== 1) fail("INTEGRITY_ERROR", "不可变版本快照未唯一写入，已拒绝继续确认");
      } catch (error) {
        repairRequired(error);
      }
    },
    async appendStateEvents(tx, events) {
      for (const event of events) {
        try {
          const inserted = await tx.execute(sql`
            INSERT INTO image_workflow_snapshot_state_events
              (workspaceId, projectId, sessionId, snapshotDigest, state, reason, actorId, occurredAt)
            SELECT workspaceId, projectId, sessionId, ${event.snapshotDigest}, ${event.state}, ${event.reason}, ${event.actorId}, ${event.occurredAt}
            FROM image_workflow_stage_snapshots
            WHERE workspaceId = ${event.workspaceId}
              AND projectId = ${event.projectId}
              AND sessionId = ${event.sessionId}
              AND snapshotDigest = ${event.snapshotDigest}
          `);
          if (affectedRows(inserted) !== 1) fail("INTEGRITY_ERROR", "版本状态事件没有唯一对应的快照");
        } catch (error) {
          repairRequired(error);
        }
      }
    },
    async advanceScopeRevision(tx, input) {
      try {
        const result = await tx.execute(sql`
          UPDATE image_workflow_version_scopes
          SET revision = revision + 1
          WHERE workspaceId = ${input.workspaceId}
            AND projectId = ${input.projectId}
            AND sessionId = ${input.sessionId}
            AND revision = ${input.expectedRevision}
        `);
        return affectedRows(result) === 1;
      } catch (error) {
        repairRequired(error);
      }
    },
  };
}

export function createImageWorkflowVersionPolicyService<Tx>(
  store: ImageWorkflowVersionStore<Tx>,
  hooks: {
    prepareRequest?: (request: StageConfirmationRequest, snapshots: readonly StoredStageSnapshot[]) => Promise<StageConfirmationRequest>;
    resolveContentRevision?: (request: StageConfirmationRequest, snapshots: readonly StoredStageSnapshot[]) => number;
    validateDependencies?: (request: StageConfirmationRequest, snapshots: readonly StoredStageSnapshot[]) => Promise<void>;
    afterConfirmed?: (tx: Tx, result: {
      request: StageConfirmationRequest;
      snapshot: ImmutableStageSnapshot;
      scopeRevision: number;
      invalidation: ConfirmationInvalidationPlan;
      unchanged: boolean;
    }) => Promise<void>;
  } = {},
) {
  async function confirmStage(request: StageConfirmationRequest): Promise<{
    snapshot: ImmutableStageSnapshot;
    scopeRevision: number;
    invalidation: ConfirmationInvalidationPlan;
    unchanged: boolean;
  }> {
    assertScope(request);
    assertPositiveInteger(request.actorId, "确认人ID");
    assertPositiveInteger(request.expectedScopeRevision, "会话版本", true);
    return store.transaction(async (tx) => {
      const scope: ImageWorkflowVersionScope = {
        workspaceId: request.workspaceId,
        projectId: request.projectId,
        sessionId: request.sessionId,
      };
      await store.lockScope(tx, scope);
      const currentRevision = await store.getScopeRevision(tx, scope);
      if (currentRevision !== request.expectedScopeRevision) {
        fail("CONFLICT", "图片建议会话已被其他确认更新，请刷新后重试");
      }
      const snapshots = await store.listSnapshots(tx, scope);
      const current = currentConfirmedByStep(snapshots, scope);
      const preparedRequest = hooks.prepareRequest ? await hooks.prepareRequest(request, snapshots) : request;
      const effectiveRequest = hooks.resolveContentRevision
        ? { ...preparedRequest, contentRevision: hooks.resolveContentRevision(preparedRequest, snapshots) }
        : preparedRequest;
      await hooks.validateDependencies?.(effectiveRequest, snapshots);
      const dependencies = IMAGE_WORKFLOW_STEPS.filter(step => step < effectiveRequest.step).map((step) => {
        const upstream = current.get(step);
        if (!upstream) fail("PRECONDITION_FAILED", `Step ${effectiveRequest.step} 缺少当前人工确认的上游 Step ${step}`);
        return { step, version: upstream.version, snapshotDigest: upstream.snapshotDigest };
      });
      const draft = buildHumanConfirmedStageDraft(effectiveRequest, dependencies);
      const existing = current.get(effectiveRequest.step) ?? null;
      const invalidation = planConfirmationInvalidation({
        existing,
        draft,
        confirmedSteps: [...current.keys()],
      });
      if (existing && !invalidation.changed) {
        const unchanged = { snapshot: existing, scopeRevision: currentRevision, invalidation, unchanged: true };
        await hooks.afterConfirmed?.(tx, { request: effectiveRequest, ...unchanged });
        return unchanged;
      }
      const version = Math.max(0, ...snapshots.filter(snapshot => snapshot.step === effectiveRequest.step).map(snapshot => snapshot.version)) + 1;
      const snapshot = materializeImmutableStageSnapshot({ draft, version, confirmedBy: effectiveRequest.actorId });
      const events: SnapshotStateEvent[] = [{
        ...scope,
        snapshotDigest: snapshot.snapshotDigest,
        state: "confirmed",
        reason: "snapshot_replaced",
        actorId: request.actorId,
        occurredAt: snapshot.confirmedAt,
      }];
      if (existing) events.push({
        ...scope,
        snapshotDigest: existing.snapshotDigest,
        state: "superseded",
        reason: "snapshot_replaced",
        actorId: request.actorId,
        occurredAt: snapshot.confirmedAt,
      });
      for (const step of invalidation.invalidateSteps) {
        const downstream = current.get(step);
        if (downstream && invalidation.reason) events.push({
          ...scope,
          snapshotDigest: downstream.snapshotDigest,
          state: "invalidated",
          reason: invalidation.reason,
          actorId: request.actorId,
          occurredAt: snapshot.confirmedAt,
        });
      }
      if (!await store.advanceScopeRevision(tx, { ...scope, expectedRevision: currentRevision })) {
        fail("CONFLICT", "图片建议会话确认并发冲突，请刷新后重试");
      }
      await store.appendSnapshot(tx, snapshot);
      await store.appendStateEvents(tx, events);
      const confirmed = { snapshot, scopeRevision: currentRevision + 1, invalidation, unchanged: false };
      await hooks.afterConfirmed?.(tx, { request: effectiveRequest, ...confirmed });
      return confirmed;
    });
  }

  return { confirmStage };
}

function nextServerContentRevision(request: StageConfirmationRequest, snapshots: readonly StoredStageSnapshot[]) {
  const stageHistory = snapshots.filter(snapshot => snapshot.step === request.step);
  const contentDigest = immutableDigest(request.content);
  const sameContent = [...stageHistory].reverse().find(snapshot => snapshot.contentDigest === contentDigest);
  if (sameContent) return sameContent.contentRevision;
  return Math.max(0, ...stageHistory.map(snapshot => snapshot.contentRevision)) + 1;
}

function confirmationProjection(step: ImageWorkflowStep, content: unknown, invalidation: ConfirmationInvalidationPlan) {
  const payload: Record<string, unknown> = {
    [`step${step}UserEdit`]: JSON.stringify(content),
    [`step${step}Confirmed`]: 1,
    currentStep: step === 6 ? 6 : step + 1,
    status: step === 6 ? "completed" : "in_progress",
  };
  if (step === 4) payload.step4AiResult = JSON.stringify(content);
  for (const downstreamStep of invalidation.invalidateSteps) payload[`step${downstreamStep}Confirmed`] = 0;
  return payload;
}

/**
 * Explicit human confirmation boundary used by Step 0–6 tRPC handlers. It never
 * accepts a client revision or client-provided asset policy: both are rebuilt on
 * the server inside the scope-lock/CAS confirmation transaction.
 */
export async function confirmHumanImageWorkflowStage(input: ImageWorkflowScopeActor & {
  step: ImageWorkflowStep;
  content: unknown;
}): Promise<{
  snapshot: ImmutableStageSnapshot;
  scopeRevision: number;
  invalidation: ConfirmationInvalidationPlan;
  unchanged: boolean;
}> {
  assertScope(input);
  assertPositiveInteger(input.actorId, "确认人ID");
  const store = createDrizzleImageWorkflowVersionStore();
  try {
    const expectedScopeRevision = await store.transaction(async tx => {
      await store.lockScope(tx, input);
      return store.getScopeRevision(tx, input);
    });
    const service = createImageWorkflowVersionPolicyService(store, {
      prepareRequest: async (request) => ({
        ...request,
        assetDependencies: await bindConfirmedStageAssets({
          ...input,
          step: request.step,
          content: request.content,
        }),
      }),
      resolveContentRevision: nextServerContentRevision,
      validateDependencies: async (_request, snapshots) => {
        await assertCurrentExportAssetPolicies(input, snapshots.filter(snapshot => snapshot.state === "confirmed"));
      },
      afterConfirmed: async (tx, result) => {
        const payload = confirmationProjection(result.request.step, result.snapshot.content, result.invalidation);
        const projected = await tx.update(imageWorkflowSessions).set(payload as any)
          .where(and(
            eq(imageWorkflowSessions.id, result.request.sessionId),
            eq(imageWorkflowSessions.projectId, result.request.projectId),
          ));
        if (affectedRows(projected) !== 1) {
          fail("INTEGRITY_ERROR", "旧会话确认投影未唯一写入，已回滚不可变版本确认");
        }
        if (!result.unchanged && (result.invalidation.invalidateSteps.some(step => step >= 4) || result.request.step < 4)) {
          await tx.update(imageWorkflowStep4ImageVersions).set({ isCurrent: 0, status: "unlocked" })
            .where(and(eq(imageWorkflowStep4ImageVersions.sessionId, result.request.sessionId), eq(imageWorkflowStep4ImageVersions.isCurrent, 1)));
        }
      },
    });
    return await service.confirmStage({
      ...input,
      expectedScopeRevision,
      contentRevision: 1,
      contentOrigin: "human_confirmed",
      sourceConfirmed: true,
    });
  } catch (error) {
    return repairRequired(error);
  }
}

async function loadCurrentSnapshots(scope: ImageWorkflowVersionScope): Promise<readonly StoredStageSnapshot[]> {
  const store = createDrizzleImageWorkflowVersionStore();
  try {
    return await store.transaction(async tx => {
      await store.lockScope(tx, scope);
      return store.listSnapshots(tx, scope);
    });
  } catch (error) {
    return repairRequired(error);
  }
}

/**
 * The old session fields are display projections, never export source. They are
 * nevertheless a fail-closed invalidation signal while legacy draft writers are
 * being retired: any cleared confirmation bit means a draft/unlock/reset has
 * occurred and the immutable chain must not be consumed until reconfirmed.
 */
async function assertLegacyProjectionCurrent(
  tx: DbExecutor,
  scope: ImageWorkflowVersionScope,
  requiredSteps: readonly ImageWorkflowStep[],
) {
  const rows = await tx.select().from(imageWorkflowSessions)
    .where(and(eq(imageWorkflowSessions.id, scope.sessionId), eq(imageWorkflowSessions.projectId, scope.projectId)))
    .limit(1)
    .for("update");
  const session = rows[0] as Record<string, unknown> | undefined;
  if (!session) fail("INTEGRITY_ERROR", "图片工作流会话在版本范围锁定后消失");
  for (const step of requiredSteps) {
    if (Number(session[`step${step}Confirmed`]) !== 1) {
      fail("PRECONDITION_FAILED", `Step ${step} 已进入草稿、解锁或重置状态；旧确认快照不得继续用于生成或导出，请重新人工确认`);
    }
  }
}

function assertCurrentUpstreamChain(scope: ImageWorkflowVersionScope, snapshots: readonly StoredStageSnapshot[], targetStep: ImageWorkflowStep) {
  if (!snapshots.length) fail("PRECONDITION_FAILED", IMAGE_WORKFLOW_VERSION_REPAIR_MESSAGE);
  const current = currentConfirmedByStep(snapshots, scope);
  for (const step of IMAGE_WORKFLOW_STEPS.filter(candidate => candidate < targetStep)) {
    const snapshot = current.get(step);
    if (!snapshot) fail("PRECONDITION_FAILED", `当前 Step ${targetStep} 分析不能使用旧草稿或失效确认：请先重新人工确认 Step ${step}`);
    assertSnapshotIntegrity(snapshot);
    const expected = IMAGE_WORKFLOW_STEPS.filter(candidate => candidate < step).map(candidate => {
      const upstream = current.get(candidate);
      if (!upstream) fail("PRECONDITION_FAILED", `Step ${step} 缺少当前人工确认的上游 Step ${candidate}`);
      return { step: candidate, version: upstream.version, snapshotDigest: upstream.snapshotDigest };
    });
    if (stableJson(snapshot.dependencies) !== stableJson(expected)) {
      fail("PRECONDITION_FAILED", `Step ${step} 仍绑定旧上游版本；请重新人工确认后再继续分析`);
    }
  }
}

/** Blocks all direct tRPC downstream analyses when only legacy/draft/invalidated data exists. */
export async function requireCurrentImageWorkflowUpstream(input: ImageWorkflowScopeActor & { targetStep: ImageWorkflowStep }) {
  const store = createDrizzleImageWorkflowVersionStore();
  try {
    return await store.transaction(async tx => {
      await store.lockScope(tx, input);
      const snapshots = await store.listSnapshots(tx, input);
      assertCurrentUpstreamChain(input, snapshots, input.targetStep);
      await assertLegacyProjectionCurrent(tx, input, IMAGE_WORKFLOW_STEPS.filter(step => step < input.targetStep));
      await assertCurrentExportAssetPolicies(input, snapshots.filter(snapshot => snapshot.step < input.targetStep));
      return snapshots;
    });
  } catch (error) {
    return repairRequired(error);
  }
}

function workerUpstreamDigest(scope: ImageWorkflowVersionScope, snapshots: readonly StoredStageSnapshot[], targetStep: ImageWorkflowStep) {
  if (targetStep === 0) return immutableDigest([]);
  return currentImageWorkflowUpstreamDigest({ scope, snapshots, targetStep });
}

/**
 * Captures the immutable scope revision and upstream chain before a job is
 * enqueued. Step 0 has no upstream stages but still requires the 0206 scope
 * ledger; this intentionally prevents a legacy job from being queued when the
 * additive migration is absent.
 */
export async function captureImageWorkflowWorkerFence(input: ImageWorkflowScopeActor & { targetStep: ImageWorkflowStep }): Promise<ImageWorkflowWorkerFence> {
  const store = createDrizzleImageWorkflowVersionStore();
  try {
    return await store.transaction(async tx => {
      await store.lockScope(tx, input);
      const scopeRevision = await store.getScopeRevision(tx, input);
      const snapshots = await store.listSnapshots(tx, input);
      const upstreamDigest = workerUpstreamDigest(input, snapshots, input.targetStep);
      if (input.targetStep > 0) {
        await assertLegacyProjectionCurrent(tx, input, IMAGE_WORKFLOW_STEPS.filter(step => step < input.targetStep));
        await assertCurrentExportAssetPolicies(input, snapshots.filter(snapshot => snapshot.step < input.targetStep));
      }
      return { scopeRevision, upstreamDigest };
    });
  } catch (error) {
    return repairRequired(error);
  }
}

/** Rechecks a queued job's immutable input immediately before model use/write-back. */
export async function verifyImageWorkflowWorkerFence(input: ImageWorkflowScopeActor & {
  targetStep: ImageWorkflowStep;
  fence: ImageWorkflowWorkerFence;
}): Promise<readonly StoredStageSnapshot[]> {
  assertPositiveInteger(input.fence.scopeRevision, "任务版本", true);
  assertSha256(input.fence.upstreamDigest, "任务上游哈希");
  const store = createDrizzleImageWorkflowVersionStore();
  try {
    return await store.transaction(async tx => {
      await store.lockScope(tx, input);
      const revision = await store.getScopeRevision(tx, input);
      if (revision !== input.fence.scopeRevision) {
        fail("PRECONDITION_FAILED", "图片工作流在任务执行期间已更新，旧任务结果不得写入；请基于当前人工确认版本重新生成");
      }
      const snapshots = await store.listSnapshots(tx, input);
      const upstreamDigest = workerUpstreamDigest(input, snapshots, input.targetStep);
      if (upstreamDigest !== input.fence.upstreamDigest) {
        fail("PRECONDITION_FAILED", "图片工作流上游确认版本已变化，旧任务结果不得写入；请基于当前版本重新生成");
      }
      if (input.targetStep > 0) {
        await assertLegacyProjectionCurrent(tx, input, IMAGE_WORKFLOW_STEPS.filter(step => step < input.targetStep));
        await assertCurrentExportAssetPolicies(input, snapshots.filter(snapshot => snapshot.step < input.targetStep));
      }
      return snapshots;
    });
  } catch (error) {
    return repairRequired(error);
  }
}

/**
 * A user draft, unlock or reset starts a new editing branch. It invalidates the
 * affected confirmed stage and all downstream stages in the same transaction as
 * its legacy display projection, so neither export nor a late worker can keep
 * treating the old chain as current.
 */
export async function invalidateImageWorkflowStages(input: ImageWorkflowScopeActor & {
  fromStep: ImageWorkflowStep;
  legacyPatch?: Record<string, unknown>;
  /**
   * A synchronous draft producer captures this before inference.  Rechecking it
   * while the scope lock is held binds the eventual draft projection and its
   * invalidation event to the same current upstream chain.
   */
  fence?: ImageWorkflowWorkerFence;
  targetStep?: ImageWorkflowStep;
  /** Prevent a cancellation of an old run from overwriting a newer Step 5 run. */
  expectedStep5RunId?: string | null;
}): Promise<{ scopeRevision: number; invalidatedSteps: readonly ImageWorkflowStep[] }> {
  const store = createDrizzleImageWorkflowVersionStore();
  try {
    return await store.transaction(async tx => {
      await store.lockScope(tx, input);
      const revision = await store.getScopeRevision(tx, input);
      const snapshots = await store.listSnapshots(tx, input);
      if (input.fence) {
        const targetStep = input.targetStep ?? input.fromStep;
        if (revision !== input.fence.scopeRevision) {
          fail("PRECONDITION_FAILED", "图片工作流在草稿生成期间已更新，旧草稿不得写入；请基于当前人工确认版本重新生成");
        }
        if (workerUpstreamDigest(input, snapshots, targetStep) !== input.fence.upstreamDigest) {
          fail("PRECONDITION_FAILED", "图片工作流上游确认版本已变化，旧草稿不得写入；请基于当前版本重新生成");
        }
        if (targetStep > 0) {
          await assertLegacyProjectionCurrent(tx, input, IMAGE_WORKFLOW_STEPS.filter(step => step < targetStep));
          await assertCurrentExportAssetPolicies(input, snapshots.filter(snapshot => snapshot.step < targetStep));
        }
      }
      const current = currentConfirmedByStep(snapshots, input);
      const invalidatedSteps = IMAGE_WORKFLOW_STEPS.filter(step => step >= input.fromStep && current.has(step));
      const now = new Date();
      const events: SnapshotStateEvent[] = invalidatedSteps.map(step => ({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        sessionId: input.sessionId,
        snapshotDigest: current.get(step)!.snapshotDigest,
        state: "invalidated",
        reason: "content_version_changed",
        actorId: input.actorId,
        occurredAt: now,
      }));
      if (!await store.advanceScopeRevision(tx, { ...input, expectedRevision: revision })) {
        fail("CONFLICT", "图片建议会话已被其他编辑更新，请刷新后重试");
      }
      if (events.length) await store.appendStateEvents(tx, events);
      const payload: Record<string, unknown> = {
        ...input.legacyPatch,
        currentStep: input.fromStep,
        status: "in_progress",
      };
      for (const step of IMAGE_WORKFLOW_STEPS.filter(step => step >= input.fromStep)) {
        payload[`step${step}Confirmed`] = 0;
      }
      const projectionConditions = [
        eq(imageWorkflowSessions.id, input.sessionId),
        eq(imageWorkflowSessions.projectId, input.projectId),
      ];
      if (input.expectedStep5RunId !== undefined) {
        projectionConditions.push(input.expectedStep5RunId === null
          ? isNull(imageWorkflowSessions.step5RunId)
          : eq(imageWorkflowSessions.step5RunId, input.expectedStep5RunId));
      }
      const projected = await tx.update(imageWorkflowSessions).set(payload as any)
        .where(and(...projectionConditions));
      if (affectedRows(projected) !== 1) {
        if (input.expectedStep5RunId !== undefined) {
          fail("CONFLICT", "图片建议任务已被新的运行替换；取消状态未写入当前会话，请刷新后重试");
        }
        fail("INTEGRITY_ERROR", "旧会话失效投影未唯一写入，已回滚版本失效");
      }
      if (input.fromStep <= 4) {
        await tx.update(imageWorkflowStep4ImageVersions).set({ isCurrent: 0, status: "unlocked" })
          .where(and(eq(imageWorkflowStep4ImageVersions.sessionId, input.sessionId), eq(imageWorkflowStep4ImageVersions.isCurrent, 1)));
      }
      return { scopeRevision: revision + 1, invalidatedSteps };
    });
  } catch (error) {
    return repairRequired(error);
  }
}

/** A worker records this before inference and requires the identical chain before write-back. */
export function currentImageWorkflowUpstreamDigest(input: {
  scope: ImageWorkflowVersionScope;
  snapshots: readonly StoredStageSnapshot[];
  targetStep: ImageWorkflowStep;
}): string {
  assertCurrentUpstreamChain(input.scope, input.snapshots, input.targetStep);
  const current = currentConfirmedByStep(input.snapshots, input.scope);
  return immutableDigest(IMAGE_WORKFLOW_STEPS.filter(step => step < input.targetStep).map((step) => {
    const snapshot = current.get(step);
    if (!snapshot) fail("PRECONDITION_FAILED", `Step ${input.targetStep} 缺少当前人工确认的上游 Step ${step}`);
    return { step, version: snapshot.version, snapshotDigest: snapshot.snapshotDigest };
  }));
}

/**
 * Adapts current immutable snapshot content for legacy-only generation helpers.
 * This is deliberately in-memory: the old session remains a compatibility
 * projection and is never promoted back into an authoritative confirmation.
 */
export function projectCurrentImageWorkflowSnapshotsToSession<T extends Record<string, unknown>>(input: {
  scope: ImageWorkflowVersionScope;
  snapshots: readonly StoredStageSnapshot[];
  session: T;
}): T {
  const current = currentConfirmedByStep(input.snapshots, input.scope);
  const projection: Record<string, unknown> = { ...input.session };
  for (const snapshot of current.values()) {
    assertSnapshotIntegrity(snapshot);
    const content = JSON.stringify(snapshot.content);
    projection[`step${snapshot.step}UserEdit`] = content;
    projection[`step${snapshot.step}AiResult`] = content;
    projection[`step${snapshot.step}Confirmed`] = 1;
  }
  return projection as T;
}

/**
 * Export contract: a legacy `step*Confirmed` flag is deliberately insufficient.
 * No fallback reads legacy session drafts and no data is rewritten when a snapshot
 * chain is missing.
 */
export async function getApprovedImageWorkflowExport(input: ImageWorkflowScopeActor): Promise<ExportableImageWorkflowSnapshot> {
  const store = createDrizzleImageWorkflowVersionStore();
  try {
    return await store.transaction(async tx => {
      await store.lockScope(tx, input);
      const snapshots = await store.listSnapshots(tx, input);
      if (!snapshots.length) fail("PRECONDITION_FAILED", IMAGE_WORKFLOW_VERSION_REPAIR_MESSAGE);
      await assertLegacyProjectionCurrent(tx, input, IMAGE_WORKFLOW_STEPS);
      const approved = buildExportableImageWorkflowSnapshot({ scope: input, snapshots });
      await assertCurrentExportAssetPolicies(input, snapshots);
      return approved;
    });
  } catch (error) {
    return repairRequired(error);
  }
}
