import { createHash } from "node:crypto";

import { listingCompleteSnapshotPayloadFieldNames } from "../../../../drizzle/schema/listingRevisions";
import { isTemplateOrEmptyFact } from "../../../../shared/listingFactSafety";

/**
 * Phase B formal Listing candidate application.
 *
 * This module intentionally has no database client, tRPC router, model, Provider,
 * or Artifact-registry dependency. Production integration must adapt
 * ListingCandidateSyncStore to a single database transaction; tests use the same
 * interface with an in-memory transactional store.
 */

type JsonObject = Record<string, unknown>;
type DateValue = Date | string;

/** Kept identical to the 0204 schema's exhaustive `listings` mirror contract. */
export const listingFullPayloadFieldNames =
  listingCompleteSnapshotPayloadFieldNames;

export type ListingFullPayloadField =
  (typeof listingFullPayloadFieldNames)[number];

/** Every `listings` table field, including immutable identity and timestamps. */
export type ListingFullPayload = Record<ListingFullPayloadField, unknown>;

export type LegacyListingRow = ListingFullPayload & {
  id: number;
  projectId: number;
  bulletPoints: string | null;
  version: number;
  isActive: number;
  createdAt: DateValue;
  updatedAt: DateValue;
};

export type ListingCandidateSyncProject = {
  id: number;
  workspaceId: number | null;
  userId: number;
};

export type ListingCandidateSyncCandidate = {
  id: number;
  candidateKey: string;
  candidateRevision: number;
  workspaceId: number;
  projectId: number;
  coreRevisionId: number;
  inputHash: string;
  subtitle: string | null;
  fullText: string | null;
  evidenceFactIdsJson: unknown;
  gateResultJson: unknown;
  status: string;
  contentHash: string;
  staleAt?: DateValue | null;
};

export type ListingCandidateSyncCore = {
  id: number;
  coreId: string;
  workspaceId: number;
  projectId: number;
  sellingPointIndex: number;
  buyerReason: string;
  factRevisionIdsJson: unknown;
  status: string;
  revision: number;
  inputHash: string;
  confirmedBy: number | null;
  confirmedAt: DateValue | null;
  staleAt?: DateValue | null;
};

export type ListingCandidateSyncFact = {
  id: number;
  workspaceId: number;
  projectId: number;
  attributeKey: string;
  value: unknown;
  sourceFileId: number | null;
  rawHash: string | null;
  status: string;
  revision: number;
  confirmedBy: number | null;
  confirmedAt: DateValue | null;
  staleAt?: DateValue | null;
};

export type ListingCandidateSyncRawFile = {
  id: number;
  workspaceId: number | null;
  projectId: number;
  fileType: string;
  rawContentHash: string | null;
  status: string;
  lifecycleState?: string | null;
};

export type ListingCandidateSyncReview = {
  id: number;
  candidateId: number;
  reviewRevision: number;
  decision: string;
  status: string;
  expectedRevision: number;
  actorId: number;
  createdAt: DateValue;
};

export type ListingCandidateSyncSnapshot = {
  id: number;
  workspaceId: number;
  projectId: number;
  listingId: number;
  contentVersion: number;
  fullPayloadJson: unknown;
  fullHash: string;
  humanApprovalRef: string | null;
  changeType: string;
  status: string;
  expectedListingVersion: number;
  listingVersion: number;
};

export type LegacyListingVersion = {
  versionNumber: number;
};

export type ListingCandidateSyncInput = {
  workspaceId: number;
  projectId: number;
  actorId: number;
  actorRole: string;
  candidateId: number;
  expectedCandidateRevision: number;
  listingId: number;
  /** The formal Listing uses zero-based seller-point indices 0 through 4. */
  sellingPointIndex: number;
  expectedListingVersion: number;
  /** SHA-256 of the complete currently locked `listings` payload. */
  expectedFullHash: string;
};

export type ListingCandidateSyncPreview = {
  listingId: number;
  projectId: number;
  sellingPointIndex: number;
  existingBulletCount: number;
  currentBullet: unknown;
  candidateBullet: unknown;
  /** Every legacy Listing field before the proposed targeted replacement. */
  currentFullPayload: ListingFullPayload;
  /**
   * Every legacy Listing field after the proposed replacement. `updatedAt` is
   * retained from the current row only for preview; the apply transaction assigns
   * its authoritative server timestamp immediately before CAS.
   */
  proposedFullPayload: ListingFullPayload;
  changedFields: readonly ["bulletPoints", "version", "updatedAt"];
  expectedListingVersion: number;
  expectedFullHash: string;
  currentFullHash: string;
  nextListingVersion: number;
  candidate: {
    id: number;
    candidateKey: string;
    candidateRevision: number;
    contentHash: string;
    coreRevisionId: number;
    evidenceFactIds: number[];
  };
  core: {
    id: number;
    coreId: string;
    revision: number;
    inputHash: string;
  };
  humanApprovalRef: string;
};

export type ListingCandidateSyncResult = {
  outcome: "applied" | "already_applied";
  listingId: number;
  projectId: number;
  candidateId: number;
  sellingPointIndex: number;
  contentVersion: number;
  expectedListingVersion: number;
  listingVersion: number;
  expectedFullHash: string;
  fullHash: string;
  humanApprovalRef: string;
  preview: ListingCandidateSyncPreview;
  artifactRegistration: {
    status: "registered";
    artifactId: string;
    artifactKey: string;
    version: number;
    ref: string;
    currentRef: string;
    contentHash: string;
  };
};

export type ListingCandidateSyncErrorCode =
  | "BAD_REQUEST"
  | "FORBIDDEN"
  | "CONFLICT"
  | "PRECONDITION_FAILED"
  | "INTERNAL_SERVER_ERROR";

export class ListingCandidateSyncError extends Error {
  readonly code: ListingCandidateSyncErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: ListingCandidateSyncErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>
  ) {
    super(message);
    this.name = "ListingCandidateSyncError";
    this.code = code;
    this.details = details;
  }
}

export type ListingCandidateSyncTx = {
  /** `SELECT projects ... FOR UPDATE`; scope validation remains in this service. */
  lockProjectForUpdate(input: {
    projectId: number;
  }): Promise<ListingCandidateSyncProject | null>;
  /** `SELECT listing_bullet_candidates ... FOR UPDATE`, scoped by workspace/project. */
  lockCandidateForUpdate(input: {
    candidateId: number;
    workspaceId: number;
    projectId: number;
  }): Promise<ListingCandidateSyncCandidate | null>;
  /** Locks the highest candidate revision in the immutable candidate lineage. */
  lockLatestCandidateForUpdate(input: {
    candidateKey: string;
    workspaceId: number;
    projectId: number;
  }): Promise<Pick<
    ListingCandidateSyncCandidate,
    "id" | "candidateRevision"
  > | null>;
  /** Locks the latest human-decision record for the candidate. */
  lockLatestCandidateReviewForUpdate(input: {
    candidateId: number;
    workspaceId: number;
    projectId: number;
  }): Promise<ListingCandidateSyncReview | null>;
  /** `SELECT listing_core_revisions ... FOR UPDATE`, scoped by workspace/project. */
  lockCoreForUpdate(input: {
    coreRevisionId: number;
    workspaceId: number;
    projectId: number;
  }): Promise<ListingCandidateSyncCore | null>;
  /** Locks the highest revision of the selected core lineage. */
  lockLatestCoreForUpdate(input: {
    coreId: string;
    workspaceId: number;
    projectId: number;
  }): Promise<Pick<ListingCandidateSyncCore, "id" | "revision"> | null>;
  /** Locks exactly the fact revisions cited by the core. */
  lockFactsForUpdate(input: {
    factRevisionIds: number[];
    workspaceId: number;
    projectId: number;
  }): Promise<ListingCandidateSyncFact[]>;
  /** Locks the newest revision for an attribute so a historical fact cannot apply. */
  lockLatestFactForUpdate(input: {
    attributeKey: string;
    workspaceId: number;
    projectId: number;
  }): Promise<Pick<ListingCandidateSyncFact, "id" | "revision"> | null>;
  /** Locks the newest product_attributes upload for this project. */
  lockLatestProductAttributesFileForUpdate(input: {
    workspaceId: number;
    projectId: number;
  }): Promise<ListingCandidateSyncRawFile | null>;
  /** Must perform `SELECT listings ... FOR UPDATE` for this exact project/listing. */
  lockListingForUpdate(input: {
    listingId: number;
    projectId: number;
  }): Promise<LegacyListingRow | null>;
  /** Locks the latest full Listing snapshot to allocate a unique contentVersion. */
  lockLatestCompleteSnapshotForUpdate(input: {
    workspaceId: number;
    projectId: number;
    listingId: number;
  }): Promise<ListingCandidateSyncSnapshot | null>;
  /** Locks the latest legacy version before assigning the next legacy version number. */
  lockLatestLegacyListingVersionForUpdate(input: {
    listingId: number;
    projectId: number;
  }): Promise<LegacyListingVersion | null>;
  /**
   * Must update with `WHERE id = ? AND projectId = ? AND version = ?`. The full
   * hash precondition is checked from the locked row by this service, because
   * legacy `listings` deliberately has no hash column.
   */
  compareAndSwapListing(input: {
    listingId: number;
    projectId: number;
    expectedListingVersion: number;
    changes: Pick<LegacyListingRow, "bulletPoints" | "version" | "updatedAt">;
  }): Promise<{ affectedRows: number; listing: LegacyListingRow | null }>;
  insertCompleteSnapshot(input: {
    workspaceId: number;
    projectId: number;
    listingId: number;
    contentVersion: number;
    fullPayloadJson: ListingFullPayload;
    fullHash: string;
    humanApprovalRef: string;
    changeType: "candidate_apply";
    status: "approved";
    expectedListingVersion: number;
    listingVersion: number;
    createdBy: number;
    approvedBy: number;
    approvedAt: DateValue;
  }): Promise<{ insertId: number }>;
  /**
   * Registers only an immutable, compact pointer to the just-written full
   * snapshot. The Drizzle adapter must invoke registerUnifiedArtifact with this
   * very transaction executor and failOnError=true; it must not upload the full
   * Listing payload or defer a failure outside this transaction.
   */
  registerCompleteSnapshotArtifact(input: {
    snapshotId: number;
    workspaceId: number;
    projectId: number;
    listingId: number;
    contentVersion: number;
    listingVersion: number;
    fullHash: string;
    humanApprovalRef: string;
    createdBy: number;
  }): Promise<{
    artifactId: string;
    artifactKey: string;
    version: number;
    ref: string;
    currentRef: string;
    contentHash: string;
  }>;
  /**
   * Reads the exact immutable pointer created by the successful application.
   * Replays must never re-register it: registration can select a current
   * Artifact and therefore must remain exclusive to the first application.
   */
  findCompleteSnapshotArtifact(input: {
    snapshotId: number;
    workspaceId: number;
    projectId: number;
    listingId: number;
    fullHash: string;
  }): Promise<{
    artifactId: string;
    artifactKey: string;
    version: number;
    ref: string;
    currentRef: string;
    contentHash: string;
  } | null>;
  /**
   * `listingVersions.changeType` has no candidate_apply enum. Persist a
   * same-transaction compatibility mirror as manual_edit; the complete snapshot
   * is the authoritative candidate_apply audit record.
   */
  insertLegacyListingVersion(input: {
    listingId: number;
    projectId: number;
    userId: number;
    versionNumber: number;
    changeType: "manual_edit";
    changeDescription: string;
    title: unknown;
    itemHighlights: unknown;
    bulletPoints: unknown;
    description: unknown;
    searchTerms: unknown;
    titleCn: unknown;
    itemHighlightsCn: unknown;
    bulletPointsCn: unknown;
    descriptionCn: unknown;
    searchTermsCn: unknown;
  }): Promise<{ insertId: number }>;
};

export type ListingCandidateSyncStore = {
  /** The adapter MUST rollback every prior write if this callback throws. */
  withTransaction<T>(
    operation: (tx: ListingCandidateSyncTx) => Promise<T>
  ): Promise<T>;
};

export type ListingCandidateSyncDependencies = {
  now: () => Date;
};

const defaultDependencies: ListingCandidateSyncDependencies = {
  now: () => new Date(),
};

function fail(
  code: ListingCandidateSyncErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>
): never {
  throw new ListingCandidateSyncError(code, message, details);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function assertPositiveInteger(
  value: unknown,
  name: string
): asserts value is number {
  if (!isPositiveInteger(value)) fail("BAD_REQUEST", `${name} 必须为正整数`);
}

function assertSha256(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    fail("BAD_REQUEST", `${name} 必须是 64 位小写 SHA-256 哈希`);
  }
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime()))
      fail("INTERNAL_SERVER_ERROR", "Listing 时间字段无效");
    return value.toISOString();
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonObject)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

/** Stable serialization is used for both browser preview CAS and immutable audit hashes. */
export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function hash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function isDateValue(value: unknown): value is DateValue {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value !== "string") return false;
  return value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

function asJsonObject(value: unknown, message: string): JsonObject {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      fail("PRECONDITION_FAILED", message);
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("PRECONDITION_FAILED", message);
  }
  return parsed as JsonObject;
}

function jsonIdArray(value: unknown, message: string): number[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      fail("PRECONDITION_FAILED", message);
    }
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length < 1 ||
    parsed.some(item => !isPositiveInteger(item)) ||
    new Set(parsed).size !== parsed.length
  ) {
    fail("PRECONDITION_FAILED", message);
  }
  return [...(parsed as number[])].sort((left, right) => left - right);
}

function normaliseCandidate(candidate: ListingCandidateSyncCandidate) {
  const fullText = candidate.fullText?.trim() || "";
  const subtitle = candidate.subtitle?.trim() || null;
  if (
    !fullText ||
    fullText.length > 5_000 ||
    (subtitle && subtitle.length > 500)
  ) {
    fail("PRECONDITION_FAILED", "候选文案已损坏或超出受控长度");
  }
  const evidenceFactIds = jsonIdArray(
    candidate.evidenceFactIdsJson,
    "候选证据引用损坏"
  );
  const gateResult = asJsonObject(candidate.gateResultJson, "候选门禁记录损坏");
  const contentHash = hash({
    coreRevisionId: candidate.coreRevisionId,
    inputHash: candidate.inputHash,
    subtitle,
    fullText,
    evidenceFactIds,
    gateResult,
  });
  if (candidate.contentHash !== contentHash) {
    fail("PRECONDITION_FAILED", "候选内容或其受治理输入已发生变化，请重新确认");
  }
  return { subtitle, fullText, evidenceFactIds };
}

function candidateBullet(
  existingBullet: unknown,
  candidate: { subtitle: string | null; fullText: string }
): unknown {
  if (typeof existingBullet === "string") {
    return candidate.subtitle
      ? `${candidate.subtitle}: ${candidate.fullText}`
      : candidate.fullText;
  }
  if (
    !existingBullet ||
    typeof existingBullet !== "object" ||
    Array.isArray(existingBullet)
  ) {
    fail("PRECONDITION_FAILED", "旧 Listing 的目标卖点格式无效，不能安全替换");
  }
  return {
    ...(existingBullet as JsonObject),
    subtitle: candidate.subtitle ?? "",
    fullText: candidate.fullText,
  };
}

function parseLegacyBullets(value: unknown): unknown[] {
  if (typeof value !== "string") {
    fail(
      "PRECONDITION_FAILED",
      "旧 Listing 缺少可解析的卖点数组，不能安全同步"
    );
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      fail("PRECONDITION_FAILED", "旧 Listing 卖点不是数组，不能安全同步");
    }
    return parsed;
  } catch (error) {
    if (error instanceof ListingCandidateSyncError) throw error;
    fail("PRECONDITION_FAILED", "旧 Listing 卖点 JSON 已损坏，不能安全同步");
  }
}

function assertCompleteListingRow(listing: LegacyListingRow): void {
  for (const field of listingFullPayloadFieldNames) {
    if (
      !Object.prototype.hasOwnProperty.call(listing, field) ||
      listing[field] === undefined
    ) {
      fail("INTERNAL_SERVER_ERROR", `Listing 行缺少完整镜像字段 ${field}`);
    }
  }
  if (!isPositiveInteger(listing.id) || !isPositiveInteger(listing.projectId)) {
    fail("INTERNAL_SERVER_ERROR", "Listing 行标识无效");
  }
  if (!isPositiveInteger(listing.version)) {
    fail("INTERNAL_SERVER_ERROR", "Listing 行版本无效");
  }
  if (!isDateValue(listing.createdAt) || !isDateValue(listing.updatedAt)) {
    fail("INTERNAL_SERVER_ERROR", "Listing 行时间字段无效");
  }
}

/** A full mirror with no implicit/defaulted fields omitted. */
export function toCompleteListingPayload(
  listing: LegacyListingRow
): ListingFullPayload {
  assertCompleteListingRow(listing);
  return Object.fromEntries(
    listingFullPayloadFieldNames.map(field => [field, listing[field]])
  ) as ListingFullPayload;
}

export function hashCompleteListing(listing: LegacyListingRow): string {
  return hash(toCompleteListingPayload(listing));
}

function assertCurrentProject(
  project: ListingCandidateSyncProject | null,
  input: ListingCandidateSyncInput
): asserts project is ListingCandidateSyncProject {
  if (
    !project ||
    project.id !== input.projectId ||
    project.workspaceId !== input.workspaceId ||
    (project.userId !== input.actorId &&
      !["admin", "super_admin"].includes(input.actorRole))
  ) {
    fail("FORBIDDEN", "项目不属于当前已授权工作空间");
  }
}

function assertCandidateScope(
  candidate: ListingCandidateSyncCandidate | null,
  input: ListingCandidateSyncInput
): asserts candidate is ListingCandidateSyncCandidate {
  if (
    !candidate ||
    candidate.workspaceId !== input.workspaceId ||
    candidate.projectId !== input.projectId
  ) {
    fail("FORBIDDEN", "候选不存在或不属于当前工作空间项目");
  }
  if (candidate.candidateRevision !== input.expectedCandidateRevision) {
    fail("CONFLICT", "候选版本已变化，请刷新后再同步");
  }
  if (candidate.status !== "confirmed" || candidate.staleAt) {
    fail(
      "PRECONDITION_FAILED",
      "候选尚未人工确认或已失效，不能同步正式 Listing"
    );
  }
}

function assertCurrentCore(
  core: ListingCandidateSyncCore | null,
  latestCore: Pick<ListingCandidateSyncCore, "id" | "revision"> | null,
  candidate: ListingCandidateSyncCandidate,
  input: ListingCandidateSyncInput
): asserts core is ListingCandidateSyncCore {
  if (
    !core ||
    core.workspaceId !== input.workspaceId ||
    core.projectId !== input.projectId ||
    core.status !== "confirmed" ||
    !isPositiveInteger(core.confirmedBy) ||
    !core.confirmedAt ||
    core.staleAt ||
    core.inputHash !== candidate.inputHash ||
    latestCore?.id !== core.id
  ) {
    fail("PRECONDITION_FAILED", "卖点核心不是当前有效的已人工确认版本");
  }
  if (core.sellingPointIndex !== input.sellingPointIndex) {
    fail("CONFLICT", "请求卖点序号与候选所属的卖点核心不一致");
  }
  if (core.sellingPointIndex < 0 || core.sellingPointIndex > 4) {
    fail(
      "PRECONDITION_FAILED",
      "正式 Listing 仅允许同步五点中的第 1 至第 5 条"
    );
  }
}

function assertCurrentFacts(
  facts: ListingCandidateSyncFact[],
  latestFacts: Array<Pick<ListingCandidateSyncFact, "id" | "revision"> | null>,
  latestFile: ListingCandidateSyncRawFile | null,
  coreFactIds: number[],
  candidateEvidenceIds: number[],
  input: ListingCandidateSyncInput
): void {
  if (
    !latestFile ||
    latestFile.workspaceId !== input.workspaceId ||
    latestFile.projectId !== input.projectId ||
    latestFile.fileType !== "product_attributes" ||
    latestFile.status !== "completed" ||
    latestFile.lifecycleState === "deleted" ||
    !latestFile.rawContentHash ||
    !/^[a-f0-9]{64}$/u.test(latestFile.rawContentHash)
  ) {
    fail("PRECONDITION_FAILED", "当前工作空间没有有效的最新原始属性文件");
  }
  if (
    facts.length !== coreFactIds.length ||
    new Set(facts.map(fact => fact.id)).size !== coreFactIds.length ||
    facts.some(fact => !coreFactIds.includes(fact.id)) ||
    candidateEvidenceIds.some(id => !coreFactIds.includes(id))
  ) {
    fail("PRECONDITION_FAILED", "候选或卖点核心缺少完整、可追溯的事实引用");
  }
  for (const [index, fact] of facts.entries()) {
    if (
      fact.workspaceId !== input.workspaceId ||
      fact.projectId !== input.projectId ||
      fact.status !== "confirmed" ||
      !isPositiveInteger(fact.confirmedBy) ||
      !fact.confirmedAt ||
      fact.staleAt ||
      fact.sourceFileId !== latestFile.id ||
      fact.rawHash !== latestFile.rawContentHash ||
      isTemplateOrEmptyFact(fact.value) ||
      latestFacts[index]?.id !== fact.id
    ) {
      fail(
        "PRECONDITION_FAILED",
        "已确认事实或原始属性文件已变化，请重新核对卖点核心"
      );
    }
  }
}

function assertHumanApproval(
  review: ListingCandidateSyncReview | null,
  candidate: ListingCandidateSyncCandidate
): asserts review is ListingCandidateSyncReview {
  if (
    !review ||
    review.candidateId !== candidate.id ||
    review.decision !== "accepted" ||
    review.status !== "recorded" ||
    review.expectedRevision !== candidate.candidateRevision ||
    !isPositiveInteger(review.actorId) ||
    !isDateValue(review.createdAt)
  ) {
    fail("PRECONDITION_FAILED", "候选缺少当前有效的人工确认审计记录");
  }
}

function assertCurrentListing(
  listing: LegacyListingRow | null,
  input: ListingCandidateSyncInput
): asserts listing is LegacyListingRow {
  if (
    !listing ||
    listing.id !== input.listingId ||
    listing.projectId !== input.projectId
  ) {
    fail("FORBIDDEN", "Listing 不存在或不属于当前项目");
  }
  assertCompleteListingRow(listing);
  if (listing.isActive !== 1) {
    fail("PRECONDITION_FAILED", "只能同步当前活动的正式 Listing");
  }
}

function assertUnchangedFields(
  before: LegacyListingRow,
  after: LegacyListingRow,
  expectedBulletPoints: string,
  expectedVersion: number
): void {
  assertCompleteListingRow(after);
  if (
    after.id !== before.id ||
    after.projectId !== before.projectId ||
    after.version !== expectedVersion ||
    after.bulletPoints !== expectedBulletPoints
  ) {
    fail("INTERNAL_SERVER_ERROR", "Listing CAS 返回的内容与受控变更不一致");
  }
  for (const field of listingFullPayloadFieldNames) {
    if (["bulletPoints", "version", "updatedAt"].includes(field)) continue;
    if (stableJson(before[field]) !== stableJson(after[field])) {
      fail("INTERNAL_SERVER_ERROR", `Listing CAS 意外修改了字段 ${field}`);
    }
  }
}

function toLegacyVersionInput(
  listing: LegacyListingRow,
  input: {
    userId: number;
    versionNumber: number;
    candidateId: number;
    sellingPointIndex: number;
  }
): Parameters<ListingCandidateSyncTx["insertLegacyListingVersion"]>[0] {
  return {
    listingId: listing.id,
    projectId: listing.projectId,
    userId: input.userId,
    versionNumber: input.versionNumber,
    changeType: "manual_edit",
    changeDescription: `受控候选应用：候选 #${input.candidateId}，卖点 ${input.sellingPointIndex + 1}`,
    title: listing.title,
    itemHighlights: listing.itemHighlights,
    bulletPoints: listing.bulletPoints,
    description: listing.description,
    searchTerms: listing.searchTerms,
    titleCn: listing.titleCn,
    itemHighlightsCn: listing.itemHighlightsCn,
    bulletPointsCn: listing.bulletPointsCn,
    descriptionCn: listing.descriptionCn,
    searchTermsCn: listing.searchTermsCn,
  };
}

function assertInput(input: ListingCandidateSyncInput): void {
  assertPositiveInteger(input.workspaceId, "workspaceId");
  assertPositiveInteger(input.projectId, "projectId");
  assertPositiveInteger(input.actorId, "actorId");
  assertPositiveInteger(input.candidateId, "candidateId");
  assertPositiveInteger(
    input.expectedCandidateRevision,
    "expectedCandidateRevision"
  );
  assertPositiveInteger(input.listingId, "listingId");
  assertPositiveInteger(input.expectedListingVersion, "expectedListingVersion");
  if (
    !Number.isInteger(input.sellingPointIndex) ||
    input.sellingPointIndex < 0 ||
    input.sellingPointIndex > 4
  ) {
    fail("BAD_REQUEST", "sellingPointIndex 必须是 0 到 4 的整数");
  }
  if (!input.actorRole.trim()) fail("BAD_REQUEST", "actorRole 不能为空");
  assertSha256(input.expectedFullHash, "expectedFullHash");
}

function snapshotMatchesAppliedRequest(
  snapshot: ListingCandidateSyncSnapshot | null,
  listing: LegacyListingRow,
  input: ListingCandidateSyncInput,
  humanApprovalRef: string
): boolean {
  if (!snapshot) return false;
  return (
    snapshot.workspaceId === input.workspaceId &&
    snapshot.projectId === input.projectId &&
    snapshot.listingId === input.listingId &&
    snapshot.changeType === "candidate_apply" &&
    snapshot.status === "approved" &&
    snapshot.humanApprovalRef === humanApprovalRef &&
    snapshot.expectedListingVersion === input.expectedListingVersion &&
    snapshot.listingVersion === listing.version &&
    snapshot.fullHash === hashCompleteListing(listing)
  );
}

function assertArtifactRegistration(
  registration: {
    artifactId: string;
    artifactKey: string;
    version: number;
    ref: string;
    currentRef: string;
    contentHash: string;
  } | null,
  expectedFullHash: string,
  missingMessage: string
): asserts registration is {
  artifactId: string;
  artifactKey: string;
  version: number;
  ref: string;
  currentRef: string;
  contentHash: string;
} {
  if (
    !registration ||
    !registration.artifactId ||
    registration.artifactKey !== "listing.complete_snapshot" ||
    !isPositiveInteger(registration.version) ||
    !registration.ref ||
    !registration.currentRef ||
    registration.contentHash !== expectedFullHash
  ) {
    fail("INTERNAL_SERVER_ERROR", missingMessage);
  }
}

function buildPreview(input: {
  listing: LegacyListingRow;
  candidate: ListingCandidateSyncCandidate;
  core: ListingCandidateSyncCore;
  evidenceFactIds: number[];
  humanApprovalRef: string;
  currentBullets: unknown[];
  replacementBullet: unknown;
  expectedListingVersion: number;
  expectedFullHash: string;
}): ListingCandidateSyncPreview {
  const nextBullets = [...input.currentBullets];
  nextBullets[input.core.sellingPointIndex] = input.replacementBullet;
  const proposedListing: LegacyListingRow = {
    ...input.listing,
    bulletPoints: JSON.stringify(nextBullets),
    version: input.listing.version + 1,
    // This is deliberately a non-authoritative preview marker. The actual CAS
    // obtains an authoritative server timestamp in the same write transaction.
    updatedAt: input.listing.updatedAt,
  };
  return {
    listingId: input.listing.id,
    projectId: input.listing.projectId,
    sellingPointIndex: input.core.sellingPointIndex,
    existingBulletCount: input.currentBullets.length,
    currentBullet: input.currentBullets[input.core.sellingPointIndex],
    candidateBullet: input.replacementBullet,
    currentFullPayload: toCompleteListingPayload(input.listing),
    proposedFullPayload: toCompleteListingPayload(proposedListing),
    changedFields: ["bulletPoints", "version", "updatedAt"],
    expectedListingVersion: input.expectedListingVersion,
    expectedFullHash: input.expectedFullHash,
    currentFullHash: hashCompleteListing(input.listing),
    nextListingVersion: input.listing.version + 1,
    candidate: {
      id: input.candidate.id,
      candidateKey: input.candidate.candidateKey,
      candidateRevision: input.candidate.candidateRevision,
      contentHash: input.candidate.contentHash,
      coreRevisionId: input.candidate.coreRevisionId,
      evidenceFactIds: input.evidenceFactIds,
    },
    core: {
      id: input.core.id,
      coreId: input.core.coreId,
      revision: input.core.revision,
      inputHash: input.core.inputHash,
    },
    humanApprovalRef: input.humanApprovalRef,
  };
}

async function loadAndValidateGovernedInputs(
  tx: ListingCandidateSyncTx,
  input: ListingCandidateSyncInput
) {
  const project = await tx.lockProjectForUpdate({ projectId: input.projectId });
  assertCurrentProject(project, input);

  const candidate = await tx.lockCandidateForUpdate({
    candidateId: input.candidateId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
  });
  assertCandidateScope(candidate, input);

  const latestCandidate = await tx.lockLatestCandidateForUpdate({
    candidateKey: candidate.candidateKey,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
  });
  if (
    latestCandidate?.id !== candidate.id ||
    latestCandidate.candidateRevision !== candidate.candidateRevision
  ) {
    fail("CONFLICT", "候选已有新修订，旧候选不得同步正式 Listing");
  }

  const review = await tx.lockLatestCandidateReviewForUpdate({
    candidateId: candidate.id,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
  });
  assertHumanApproval(review, candidate);

  const core = await tx.lockCoreForUpdate({
    coreRevisionId: candidate.coreRevisionId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
  });
  const latestCore = core
    ? await tx.lockLatestCoreForUpdate({
        coreId: core.coreId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
      })
    : null;
  assertCurrentCore(core, latestCore, candidate, input);

  const candidateContent = normaliseCandidate(candidate);
  const coreFactIds = jsonIdArray(
    core.factRevisionIdsJson,
    "卖点核心缺少可追溯的确认事实"
  );
  const facts = await tx.lockFactsForUpdate({
    factRevisionIds: coreFactIds,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
  });
  const latestFacts = await Promise.all(
    facts.map(fact =>
      tx.lockLatestFactForUpdate({
        attributeKey: fact.attributeKey,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
      })
    )
  );
  const latestFile = await tx.lockLatestProductAttributesFileForUpdate({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
  });
  assertCurrentFacts(
    facts,
    latestFacts,
    latestFile,
    coreFactIds,
    candidateContent.evidenceFactIds,
    input
  );

  return { candidate, core, candidateContent, review };
}

/**
 * Builds a readonly, fully CAS-tokened preview. A router should expose this as a
 * query after separately resolving project read access; it must never mutate a
 * candidate, Listing, snapshot, legacy version or Artifact.
 */
export async function previewListingCandidateSync(
  store: ListingCandidateSyncStore,
  input: ListingCandidateSyncInput
): Promise<ListingCandidateSyncPreview> {
  assertInput(input);
  return store.withTransaction(async tx => {
    const { candidate, core, candidateContent, review } =
      await loadAndValidateGovernedInputs(tx, input);
    const listing = await tx.lockListingForUpdate({
      listingId: input.listingId,
      projectId: input.projectId,
    });
    assertCurrentListing(listing, input);
    const currentFullHash = hashCompleteListing(listing);
    if (currentFullHash !== input.expectedFullHash) {
      fail("CONFLICT", "正式 Listing 全文已变化，请刷新预览后再同步", {
        expectedFullHash: input.expectedFullHash,
        currentFullHash,
      });
    }
    if (listing.version !== input.expectedListingVersion) {
      fail("CONFLICT", "正式 Listing 版本已变化，请刷新预览后再同步", {
        expectedListingVersion: input.expectedListingVersion,
        currentListingVersion: listing.version,
      });
    }

    const currentBullets = parseLegacyBullets(listing.bulletPoints);
    if (currentBullets.length < 5) {
      fail(
        "PRECONDITION_FAILED",
        "正式 Listing 卖点不足五条，需先补齐后才能定点替换",
        {
          existingBulletCount: currentBullets.length,
          requiredBulletCount: 5,
          needsBackfill: true,
        }
      );
    }
    const replacementBullet = candidateBullet(
      currentBullets[input.sellingPointIndex],
      candidateContent
    );
    return buildPreview({
      listing,
      candidate,
      core,
      evidenceFactIds: candidateContent.evidenceFactIds,
      humanApprovalRef: `listing_review:${review.id}`,
      currentBullets,
      replacementBullet,
      expectedListingVersion: input.expectedListingVersion,
      expectedFullHash: input.expectedFullHash,
    });
  });
}

/**
 * Atomically applies one already-human-confirmed candidate to its declared
 * zero-based selling-point index. It writes the legacy Listing CAS, complete
 * candidate_apply snapshot, and compatibility listingVersion in one transaction.
 */
export async function syncConfirmedListingCandidate(
  store: ListingCandidateSyncStore,
  input: ListingCandidateSyncInput,
  dependencies: Partial<ListingCandidateSyncDependencies> = {}
): Promise<ListingCandidateSyncResult> {
  assertInput(input);
  const deps = { ...defaultDependencies, ...dependencies };
  const approvedAt = deps.now();
  if (Number.isNaN(approvedAt.getTime())) {
    fail("INTERNAL_SERVER_ERROR", "同步时钟返回了无效时间");
  }

  return store.withTransaction(async tx => {
    const { candidate, core, candidateContent, review } =
      await loadAndValidateGovernedInputs(tx, input);
    const humanApprovalRef = `listing_review:${review.id}`;
    const listing = await tx.lockListingForUpdate({
      listingId: input.listingId,
      projectId: input.projectId,
    });
    assertCurrentListing(listing, input);

    const actualFullHash = hashCompleteListing(listing);
    if (actualFullHash !== input.expectedFullHash) {
      /* Idempotent retry is only possible after re-reading the locked final row. */
      const latestSnapshot = await tx.lockLatestCompleteSnapshotForUpdate({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        listingId: input.listingId,
      });
      if (
        snapshotMatchesAppliedRequest(
          latestSnapshot,
          listing,
          input,
          humanApprovalRef
        )
      ) {
        // snapshotMatchesAppliedRequest returns false for null; TypeScript cannot
        // infer that fact through a separate predicate function.
        const appliedSnapshot = latestSnapshot!;
        const currentBullets = parseLegacyBullets(listing.bulletPoints);
        const replacementBullet = currentBullets[input.sellingPointIndex];
        const preview = buildPreview({
          listing,
          candidate,
          core,
          evidenceFactIds: candidateContent.evidenceFactIds,
          humanApprovalRef,
          currentBullets,
          replacementBullet,
          expectedListingVersion: input.expectedListingVersion,
          expectedFullHash: input.expectedFullHash,
        });
        const artifactRegistration = await tx.findCompleteSnapshotArtifact({
          snapshotId: appliedSnapshot.id,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          listingId: listing.id,
          fullHash: appliedSnapshot.fullHash,
        });
        assertArtifactRegistration(
          artifactRegistration,
          appliedSnapshot.fullHash,
          "完整 Listing 快照缺少已注册的不可变 Artifact，事务已回滚"
        );
        return {
          outcome: "already_applied",
          listingId: listing.id,
          projectId: listing.projectId,
          candidateId: candidate.id,
          sellingPointIndex: input.sellingPointIndex,
          contentVersion: appliedSnapshot.contentVersion,
          expectedListingVersion: input.expectedListingVersion,
          listingVersion: listing.version,
          expectedFullHash: input.expectedFullHash,
          fullHash: appliedSnapshot.fullHash,
          humanApprovalRef,
          preview,
          artifactRegistration: {
            status: "registered",
            ...artifactRegistration,
          },
        };
      }
      fail("CONFLICT", "正式 Listing 全文已变化，未覆盖旧内容", {
        expectedFullHash: input.expectedFullHash,
        currentFullHash: actualFullHash,
      });
    }
    if (listing.version !== input.expectedListingVersion) {
      fail("CONFLICT", "正式 Listing 版本已变化，未覆盖旧内容", {
        expectedListingVersion: input.expectedListingVersion,
        currentListingVersion: listing.version,
      });
    }

    const currentBullets = parseLegacyBullets(listing.bulletPoints);
    if (currentBullets.length < 5) {
      fail(
        "PRECONDITION_FAILED",
        "正式 Listing 卖点不足五条，需先补齐后才能定点替换",
        {
          existingBulletCount: currentBullets.length,
          requiredBulletCount: 5,
          needsBackfill: true,
        }
      );
    }
    const replacementBullet = candidateBullet(
      currentBullets[input.sellingPointIndex],
      candidateContent
    );
    const nextBullets = [...currentBullets];
    nextBullets[input.sellingPointIndex] = replacementBullet;
    const nextBulletPoints = JSON.stringify(nextBullets);
    const nextVersion = listing.version + 1;
    const preview = buildPreview({
      listing,
      candidate,
      core,
      evidenceFactIds: candidateContent.evidenceFactIds,
      humanApprovalRef,
      currentBullets,
      replacementBullet,
      expectedListingVersion: input.expectedListingVersion,
      expectedFullHash: input.expectedFullHash,
    });

    const updated = await tx.compareAndSwapListing({
      listingId: listing.id,
      projectId: input.projectId,
      expectedListingVersion: input.expectedListingVersion,
      changes: {
        bulletPoints: nextBulletPoints,
        version: nextVersion,
        updatedAt: approvedAt,
      },
    });
    if (updated.affectedRows !== 1 || !updated.listing) {
      fail("CONFLICT", "正式 Listing CAS 失败，事务已回滚且未覆盖旧内容");
    }
    assertUnchangedFields(
      listing,
      updated.listing,
      nextBulletPoints,
      nextVersion
    );

    const fullPayloadJson = toCompleteListingPayload(updated.listing);
    const fullHash = hash(fullPayloadJson);
    const previousSnapshot = await tx.lockLatestCompleteSnapshotForUpdate({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      listingId: listing.id,
    });
    const contentVersion = (previousSnapshot?.contentVersion ?? 0) + 1;
    const snapshot = await tx.insertCompleteSnapshot({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      listingId: listing.id,
      contentVersion,
      fullPayloadJson,
      fullHash,
      humanApprovalRef,
      changeType: "candidate_apply",
      status: "approved",
      expectedListingVersion: input.expectedListingVersion,
      listingVersion: nextVersion,
      createdBy: input.actorId,
      approvedBy: input.actorId,
      approvedAt,
    });
    if (!isPositiveInteger(snapshot.insertId)) {
      fail(
        "INTERNAL_SERVER_ERROR",
        "完整 Listing 快照未返回有效标识，事务已回滚"
      );
    }

    const artifactRegistration = await tx.registerCompleteSnapshotArtifact({
      snapshotId: snapshot.insertId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      listingId: updated.listing.id,
      contentVersion,
      listingVersion: nextVersion,
      fullHash,
      humanApprovalRef,
      createdBy: input.actorId,
    });
    assertArtifactRegistration(
      artifactRegistration,
      fullHash,
      "完整 Listing Artifact 注册返回无效，事务已回滚"
    );

    const previousLegacyVersion =
      await tx.lockLatestLegacyListingVersionForUpdate({
        listingId: listing.id,
        projectId: input.projectId,
      });
    await tx.insertLegacyListingVersion(
      toLegacyVersionInput(updated.listing, {
        userId: input.actorId,
        versionNumber: (previousLegacyVersion?.versionNumber ?? 0) + 1,
        candidateId: candidate.id,
        sellingPointIndex: input.sellingPointIndex,
      })
    );

    return {
      outcome: "applied",
      listingId: updated.listing.id,
      projectId: updated.listing.projectId,
      candidateId: candidate.id,
      sellingPointIndex: input.sellingPointIndex,
      contentVersion,
      expectedListingVersion: input.expectedListingVersion,
      listingVersion: nextVersion,
      expectedFullHash: input.expectedFullHash,
      fullHash,
      humanApprovalRef,
      preview,
      artifactRegistration: { status: "registered", ...artifactRegistration },
    };
  });
}

/** Factory form is convenient for router composition without importing a DB client here. */
export function createListingCandidateSyncService(
  store: ListingCandidateSyncStore,
  dependencies: Partial<ListingCandidateSyncDependencies> = {}
) {
  return {
    preview: (input: ListingCandidateSyncInput) =>
      previewListingCandidateSync(store, input),
    sync: (input: ListingCandidateSyncInput) =>
      syncConfirmedListingCandidate(store, input, dependencies),
  };
}
