import { createHash } from "node:crypto";

import {
  listingCompleteSnapshotPayloadFieldNames,
} from "../../../../drizzle/schema/listingRevisions";
import {
  stableJson,
  type LegacyListingRow,
  type ListingFullPayload,
} from "./listingCandidateSyncService";

type DateValue = Date | string;
type JsonObject = Record<string, unknown>;

/**
 * Governed complete-Listing restore.
 *
 * This module deliberately has no router, repository, database-client, model, or
 * Provider dependency. Its Store contract requires one real transaction, which
 * keeps the formal Listing CAS, immutable rollback snapshot, Artifact pointer,
 * and compatibility legacy-version audit inseparable.
 *
 * Legacy `listingVersions` rows are intentionally absent from this contract. They
 * remain view-only because they do not contain the full Listing payload needed for
 * safe restoration.
 */

export type ListingCompleteRestoreProject = {
  id: number;
  workspaceId: number | null;
  userId: number;
};

export type ListingCompleteRestoreSnapshot = {
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
  createdBy: number;
  approvedBy: number | null;
  approvedAt: DateValue | null;
  createdAt: DateValue;
};

export type ListingCompleteRestoreSnapshotSummary = Pick<
  ListingCompleteRestoreSnapshot,
  | "id"
  | "listingId"
  | "contentVersion"
  | "fullHash"
  | "humanApprovalRef"
  | "changeType"
  | "status"
  | "expectedListingVersion"
  | "listingVersion"
  | "createdBy"
  | "approvedBy"
  | "approvedAt"
  | "createdAt"
>;

export type LegacyListingVersion = { versionNumber: number };

export type ListingCompleteRestoreInput = {
  workspaceId: number;
  projectId: number;
  actorId: number;
  actorRole: string;
  sourceSnapshotId: number;
  listingId: number;
  expectedListingVersion: number;
  /** SHA-256 of the complete formal `listings` row observed in the preview. */
  expectedFullHash: string;
  /**
   * Bound into the HMAC confirmation token and rechecked for the final write.
   * It is deliberately absent for the first server-side preview: the server
   * derives the selected immutable source hash under lock instead of accepting a
   * client-provided source hash merely to display that source.
   */
  expectedSourceFullHash?: string;
};

export type ListingCompleteRestoreListInput = Pick<
  ListingCompleteRestoreInput,
  "workspaceId" | "projectId" | "actorId" | "actorRole"
> & {
  limit: number;
};

export type ListingCompleteRestorePreview = {
  sourceSnapshot: ListingCompleteRestoreSnapshotSummary;
  sourceFullPayload: ListingFullPayload;
  currentFullPayload: ListingFullPayload;
  /**
   * Full source payload with only operational server-assigned values substituted:
   * the current row version advances and updatedAt is assigned in the final CAS.
   */
  proposedFullPayload: ListingFullPayload;
  restoredFieldNames: readonly string[];
  changedFields: readonly string[];
  serverAssignedFields: readonly ["version", "updatedAt"];
  listingId: number;
  projectId: number;
  expectedListingVersion: number;
  expectedFullHash: string;
  currentFullHash: string;
  expectedSourceFullHash: string;
  nextListingVersion: number;
  humanApprovalRef: string;
};

export type ListingCompleteRestoreResult = {
  outcome: "restored" | "already_restored";
  sourceSnapshotId: number;
  listingId: number;
  projectId: number;
  contentVersion: number;
  expectedListingVersion: number;
  listingVersion: number;
  expectedFullHash: string;
  expectedSourceFullHash: string;
  fullHash: string;
  humanApprovalRef: string;
  preview: ListingCompleteRestorePreview;
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

export type ListingCompleteRestoreErrorCode =
  | "BAD_REQUEST"
  | "FORBIDDEN"
  | "CONFLICT"
  | "PRECONDITION_FAILED"
  | "INTERNAL_SERVER_ERROR";

export class ListingCompleteRestoreError extends Error {
  readonly code: ListingCompleteRestoreErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: ListingCompleteRestoreErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>
  ) {
    super(message);
    this.name = "ListingCompleteRestoreError";
    this.code = code;
    this.details = details;
  }
}

export type ListingCompleteRestoreTx = {
  /** SELECT projects ... FOR UPDATE; service performs scope and actor validation. */
  lockProjectForUpdate(input: { projectId: number }): Promise<ListingCompleteRestoreProject | null>;
  /** SELECT the exact governed source snapshot ... FOR UPDATE, workspace/project scoped. */
  lockCompleteSnapshotForUpdate(input: {
    snapshotId: number;
    workspaceId: number;
    projectId: number;
  }): Promise<ListingCompleteRestoreSnapshot | null>;
  /** Locks the active operational Listing row, never a legacy listingVersions projection. */
  lockListingForUpdate(input: {
    listingId: number;
    projectId: number;
  }): Promise<LegacyListingRow | null>;
  /** Allocates the immutable contentVersion while holding the Listing transaction. */
  lockLatestCompleteSnapshotForUpdate(input: {
    workspaceId: number;
    projectId: number;
    listingId: number;
  }): Promise<ListingCompleteRestoreSnapshot | null>;
  lockLatestLegacyListingVersionForUpdate(input: {
    listingId: number;
    projectId: number;
  }): Promise<LegacyListingVersion | null>;
  /**
   * Writes every mutable formal Listing field from a validated full payload using
   * `WHERE id = ? AND projectId = ? AND version = ?`; no partial legacy write is
   * available through this interface.
   */
  compareAndSwapCompleteListing(input: {
    listingId: number;
    projectId: number;
    expectedListingVersion: number;
    restoredListing: LegacyListingRow;
  }): Promise<{ affectedRows: number; listing: LegacyListingRow | null }>;
  insertCompleteSnapshot(input: {
    workspaceId: number;
    projectId: number;
    listingId: number;
    contentVersion: number;
    fullPayloadJson: ListingFullPayload;
    fullHash: string;
    humanApprovalRef: string;
    changeType: "rollback";
    status: "approved";
    expectedListingVersion: number;
    listingVersion: number;
    createdBy: number;
    approvedBy: number;
    approvedAt: DateValue;
  }): Promise<{ insertId: number }>;
  /** Must use the supplied DB transaction and failOnError=true. */
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
  }): Promise<ArtifactRegistration>;
  /** Used both to prove the chosen source is governed and for idempotent replay. */
  findCompleteSnapshotArtifact(input: {
    snapshotId: number;
    workspaceId: number;
    projectId: number;
    listingId: number;
    fullHash: string;
  }): Promise<ArtifactRegistration | null>;
  /** Compatibility projection only; never a restore source. */
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
  /** Selection is deliberately limited to approved complete snapshots, not legacy rows. */
  listApprovedCompleteSnapshots(input: {
    workspaceId: number;
    projectId: number;
    limit: number;
  }): Promise<ListingCompleteRestoreSnapshotSummary[]>;
};

export type ListingCompleteRestoreStore = {
  /** The adapter must rollback every prior write if the callback throws. */
  withTransaction<T>(operation: (tx: ListingCompleteRestoreTx) => Promise<T>): Promise<T>;
};

export type ListingCompleteRestoreDependencies = { now: () => Date };

export type ArtifactRegistration = {
  artifactId: string;
  artifactKey: string;
  version: number;
  ref: string;
  currentRef: string;
  contentHash: string;
};

const defaultDependencies: ListingCompleteRestoreDependencies = {
  now: () => new Date(),
};

const restoredFieldNames = listingCompleteSnapshotPayloadFieldNames.filter(
  field => !["id", "projectId", "createdAt", "version", "updatedAt"].includes(field)
);

function fail(
  code: ListingCompleteRestoreErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>
): never {
  throw new ListingCompleteRestoreError(code, message, details);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function assertPositiveInteger(value: unknown, name: string): asserts value is number {
  if (!isPositiveInteger(value)) fail("BAD_REQUEST", `${name} 必须为正整数`);
}

function assertSha256(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    fail("BAD_REQUEST", `${name} 必须是 64 位小写 SHA-256 哈希`);
  }
}

function isDateValue(value: unknown): value is DateValue {
  return (
    (value instanceof Date && !Number.isNaN(value.getTime())) ||
    (typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value)))
  );
}

function hashFullPayload(payload: ListingFullPayload): string {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function fullPayloadFromRow(listing: LegacyListingRow): ListingFullPayload {
  const payload = {} as ListingFullPayload;
  for (const field of listingCompleteSnapshotPayloadFieldNames) {
    if (!Object.prototype.hasOwnProperty.call(listing, field) || listing[field] === undefined) {
      fail("INTERNAL_SERVER_ERROR", `Listing 行缺少完整镜像字段 ${field}`);
    }
    payload[field] = listing[field];
  }
  assertPayloadIdentity(payload, "当前正式 Listing");
  return payload;
}

function objectFromJson(value: unknown, message: string): JsonObject {
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

function fullPayloadFromSnapshot(value: unknown): ListingFullPayload {
  const object = objectFromJson(value, "完整 Listing 快照载荷损坏，不能恢复");
  const expected = new Set<string>(listingCompleteSnapshotPayloadFieldNames);
  const keys = Object.keys(object);
  if (
    keys.length !== expected.size ||
    keys.some(key => !expected.has(key)) ||
    listingCompleteSnapshotPayloadFieldNames.some(
      field => !Object.prototype.hasOwnProperty.call(object, field) || object[field] === undefined
    )
  ) {
    fail("PRECONDITION_FAILED", "完整 Listing 快照字段不完整或与 0204 合同不匹配，不能恢复");
  }
  const payload = Object.fromEntries(
    listingCompleteSnapshotPayloadFieldNames.map(field => [field, object[field]])
  ) as ListingFullPayload;
  assertPayloadIdentity(payload, "源完整快照");
  return payload;
}

function assertPayloadIdentity(payload: ListingFullPayload, label: string): void {
  if (!isPositiveInteger(payload.id) || !isPositiveInteger(payload.projectId)) {
    fail("PRECONDITION_FAILED", `${label} 标识无效`);
  }
  if (!isPositiveInteger(payload.version)) {
    fail("PRECONDITION_FAILED", `${label} 版本无效`);
  }
  if (payload.isActive !== 1) {
    fail("PRECONDITION_FAILED", `${label} 不是活动正式 Listing，不能用于恢复`);
  }
  if (!isDateValue(payload.createdAt) || !isDateValue(payload.updatedAt)) {
    fail("PRECONDITION_FAILED", `${label} 时间字段无效`);
  }
}

function asListingRow(payload: ListingFullPayload): LegacyListingRow {
  return payload as LegacyListingRow;
}

function assertInput(input: ListingCompleteRestoreInput): void {
  assertPositiveInteger(input.workspaceId, "workspaceId");
  assertPositiveInteger(input.projectId, "projectId");
  assertPositiveInteger(input.actorId, "actorId");
  assertPositiveInteger(input.sourceSnapshotId, "sourceSnapshotId");
  assertPositiveInteger(input.listingId, "listingId");
  assertPositiveInteger(input.expectedListingVersion, "expectedListingVersion");
  if (!input.actorRole.trim()) fail("BAD_REQUEST", "actorRole 不能为空");
  assertSha256(input.expectedFullHash, "expectedFullHash");
  if (input.expectedSourceFullHash !== undefined) {
    assertSha256(input.expectedSourceFullHash, "expectedSourceFullHash");
  }
}

function assertListInput(input: ListingCompleteRestoreListInput): void {
  assertPositiveInteger(input.workspaceId, "workspaceId");
  assertPositiveInteger(input.projectId, "projectId");
  assertPositiveInteger(input.actorId, "actorId");
  if (!input.actorRole.trim()) fail("BAD_REQUEST", "actorRole 不能为空");
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500) {
    fail("BAD_REQUEST", "limit 必须是 1 到 500 的整数");
  }
}

function assertCurrentProject(
  project: ListingCompleteRestoreProject | null,
  input: Pick<ListingCompleteRestoreInput, "workspaceId" | "projectId" | "actorId" | "actorRole">
): asserts project is ListingCompleteRestoreProject {
  if (
    !project ||
    project.id !== input.projectId ||
    project.workspaceId !== input.workspaceId ||
    (project.userId !== input.actorId && !["admin", "super_admin"].includes(input.actorRole))
  ) {
    fail("FORBIDDEN", "项目不属于当前已授权工作空间");
  }
}

function assertSourceSnapshot(
  snapshot: ListingCompleteRestoreSnapshot | null,
  input: ListingCompleteRestoreInput
): asserts snapshot is ListingCompleteRestoreSnapshot {
  if (
    !snapshot ||
    snapshot.id !== input.sourceSnapshotId ||
    snapshot.workspaceId !== input.workspaceId ||
    snapshot.projectId !== input.projectId
  ) {
    fail("FORBIDDEN", "完整快照不存在或不属于当前工作空间项目");
  }
  if (
    snapshot.status !== "approved" ||
    !snapshot.humanApprovalRef?.trim() ||
    !isPositiveInteger(snapshot.approvedBy) ||
    !isDateValue(snapshot.approvedAt) ||
    !isPositiveInteger(snapshot.createdBy) ||
    !isPositiveInteger(snapshot.contentVersion) ||
    !isPositiveInteger(snapshot.listingVersion) ||
    !isPositiveInteger(snapshot.expectedListingVersion)
  ) {
    fail("PRECONDITION_FAILED", "源完整快照缺少有效人工审核记录，不能恢复");
  }
  assertSha256(snapshot.fullHash, "sourceSnapshot.fullHash");
  if (
    input.expectedSourceFullHash !== undefined &&
    snapshot.fullHash !== input.expectedSourceFullHash
  ) {
    fail("CONFLICT", "源完整快照哈希已变化，请重新选择并预览");
  }
}

function assertCurrentListing(
  listing: LegacyListingRow | null,
  input: ListingCompleteRestoreInput
): asserts listing is LegacyListingRow {
  if (!listing || listing.id !== input.listingId || listing.projectId !== input.projectId) {
    fail("FORBIDDEN", "活动正式 Listing 不存在或不属于当前项目");
  }
  const payload = fullPayloadFromRow(listing);
  if (payload.isActive !== 1) {
    fail("PRECONDITION_FAILED", "只能恢复到当前活动的正式 Listing");
  }
}

function sourceApprovalRef(snapshot: ListingCompleteRestoreSnapshot): string {
  return `listing_restore:${snapshot.id}:${snapshot.fullHash}`;
}

function assertSourcePayload(
  snapshot: ListingCompleteRestoreSnapshot,
  current: LegacyListingRow,
  input: ListingCompleteRestoreInput
): ListingFullPayload {
  const payload = fullPayloadFromSnapshot(snapshot.fullPayloadJson);
  const sourceHash = hashFullPayload(payload);
  if (sourceHash !== snapshot.fullHash) {
    fail("PRECONDITION_FAILED", "源完整快照全文哈希校验失败，不能恢复", {
      expectedSourceFullHash: snapshot.fullHash,
      actualSourceFullHash: sourceHash,
    });
  }
  if (
    payload.id !== snapshot.listingId ||
    payload.projectId !== snapshot.projectId ||
    payload.id !== current.id ||
    payload.projectId !== current.projectId ||
    payload.version !== snapshot.listingVersion
  ) {
    fail("PRECONDITION_FAILED", "源完整快照与当前正式 Listing 身份或版本合同不一致，不能恢复");
  }
  // createdAt is immutable identity in the full-payload contract. A different
  // value indicates a snapshot for a replaced row, never a safe restore source.
  if (stableJson(payload.createdAt) !== stableJson(current.createdAt)) {
    fail("PRECONDITION_FAILED", "源完整快照的创建时间与当前 Listing 不一致，不能恢复");
  }
  return payload;
}

function assertArtifactRegistration(
  artifact: ArtifactRegistration | null,
  expectedHash: string,
  missingMessage: string
): asserts artifact is ArtifactRegistration {
  if (
    !artifact ||
    !artifact.artifactId ||
    artifact.artifactKey !== "listing.complete_snapshot" ||
    !isPositiveInteger(artifact.version) ||
    !artifact.ref ||
    !artifact.currentRef ||
    artifact.contentHash !== expectedHash
  ) {
    fail("PRECONDITION_FAILED", missingMessage);
  }
}

function restoredListing(
  sourcePayload: ListingFullPayload,
  current: LegacyListingRow,
  updatedAt: Date
): LegacyListingRow {
  const next = {
    ...sourcePayload,
    // The selected snapshot is restored as a new state. It never rewinds the
    // operational CAS sequence or pretends the old update timestamp is new.
    version: current.version + 1,
    updatedAt,
  } as LegacyListingRow;
  if (!isPositiveInteger(next.version) || Number.isNaN(updatedAt.getTime())) {
    fail("INTERNAL_SERVER_ERROR", "恢复后的 Listing 版本或时间无效");
  }
  return next;
}

function assertRestoredRow(
  source: ListingFullPayload,
  current: LegacyListingRow,
  restored: LegacyListingRow,
  expectedUpdatedAt: Date
): void {
  const actual = fullPayloadFromRow(restored);
  if (
    actual.id !== source.id ||
    actual.projectId !== source.projectId ||
    actual.version !== current.version + 1 ||
    stableJson(actual.updatedAt) !== stableJson(expectedUpdatedAt)
  ) {
    fail("INTERNAL_SERVER_ERROR", "Listing CAS 返回的恢复标识、版本或时间不一致");
  }
  for (const field of listingCompleteSnapshotPayloadFieldNames) {
    if (["version", "updatedAt"].includes(field)) continue;
    if (stableJson(actual[field]) !== stableJson(source[field])) {
      fail("INTERNAL_SERVER_ERROR", `Listing CAS 未完整恢复字段 ${field}`);
    }
  }
}

function changedFields(
  current: ListingFullPayload,
  proposed: ListingFullPayload
): readonly string[] {
  return listingCompleteSnapshotPayloadFieldNames.filter(
    field => stableJson(current[field]) !== stableJson(proposed[field])
  );
}

function buildPreview(input: {
  sourceSnapshot: ListingCompleteRestoreSnapshot;
  sourcePayload: ListingFullPayload;
  current: LegacyListingRow;
  request: ListingCompleteRestoreInput;
}): ListingCompleteRestorePreview {
  const currentFullPayload = fullPayloadFromRow(input.current);
  const proposedFullPayload = {
    ...input.sourcePayload,
    version: input.current.version + 1,
    // A preview cannot predict the DB transaction timestamp. Retain the observed
    // current value and label updatedAt as server-assigned in the response.
    updatedAt: input.current.updatedAt,
  } as ListingFullPayload;
  return {
    sourceSnapshot: {
      id: input.sourceSnapshot.id,
      listingId: input.sourceSnapshot.listingId,
      contentVersion: input.sourceSnapshot.contentVersion,
      fullHash: input.sourceSnapshot.fullHash,
      humanApprovalRef: input.sourceSnapshot.humanApprovalRef,
      changeType: input.sourceSnapshot.changeType,
      status: input.sourceSnapshot.status,
      expectedListingVersion: input.sourceSnapshot.expectedListingVersion,
      listingVersion: input.sourceSnapshot.listingVersion,
      createdBy: input.sourceSnapshot.createdBy,
      approvedBy: input.sourceSnapshot.approvedBy,
      approvedAt: input.sourceSnapshot.approvedAt,
      createdAt: input.sourceSnapshot.createdAt,
    },
    sourceFullPayload: input.sourcePayload,
    currentFullPayload,
    proposedFullPayload,
    restoredFieldNames,
    changedFields: changedFields(currentFullPayload, proposedFullPayload),
    serverAssignedFields: ["version", "updatedAt"],
    listingId: input.current.id,
    projectId: input.current.projectId,
    expectedListingVersion: input.request.expectedListingVersion,
    expectedFullHash: input.request.expectedFullHash,
    currentFullHash: hashFullPayload(currentFullPayload),
    // Preview source identity is always read from the locked immutable row, not
    // copied from an optional browser input.
    expectedSourceFullHash: input.sourceSnapshot.fullHash,
    nextListingVersion: input.current.version + 1,
    humanApprovalRef: sourceApprovalRef(input.sourceSnapshot),
  };
}

async function loadGovernedRestoreInputs(
  tx: ListingCompleteRestoreTx,
  input: ListingCompleteRestoreInput
): Promise<{
  sourceSnapshot: ListingCompleteRestoreSnapshot;
  sourcePayload: ListingFullPayload;
  current: LegacyListingRow;
}> {
  const project = await tx.lockProjectForUpdate({ projectId: input.projectId });
  assertCurrentProject(project, input);

  const sourceSnapshot = await tx.lockCompleteSnapshotForUpdate({
    snapshotId: input.sourceSnapshotId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
  });
  assertSourceSnapshot(sourceSnapshot, input);

  const current = await tx.lockListingForUpdate({
    listingId: input.listingId,
    projectId: input.projectId,
  });
  assertCurrentListing(current, input);

  const sourcePayload = assertSourcePayload(sourceSnapshot, current, input);
  const sourceArtifact = await tx.findCompleteSnapshotArtifact({
    snapshotId: sourceSnapshot.id,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    listingId: current.id,
    fullHash: sourceSnapshot.fullHash,
  });
  assertArtifactRegistration(
    sourceArtifact,
    sourceSnapshot.fullHash,
    "源完整快照缺少不可变受治理 Artifact，不能恢复"
  );

  return { sourceSnapshot, sourcePayload, current };
}

function snapshotMatchesRestoreRequest(
  snapshot: ListingCompleteRestoreSnapshot | null,
  current: LegacyListingRow,
  input: ListingCompleteRestoreInput,
  humanApprovalRef: string
): boolean {
  if (!snapshot) return false;
  const currentHash = hashFullPayload(fullPayloadFromRow(current));
  return (
    snapshot.workspaceId === input.workspaceId &&
    snapshot.projectId === input.projectId &&
    snapshot.listingId === input.listingId &&
    snapshot.changeType === "rollback" &&
    snapshot.status === "approved" &&
    snapshot.humanApprovalRef === humanApprovalRef &&
    snapshot.expectedListingVersion === input.expectedListingVersion &&
    snapshot.listingVersion === current.version &&
    snapshot.fullHash === currentHash
  );
}

function toLegacyVersionInput(
  listing: LegacyListingRow,
  input: { userId: number; versionNumber: number; sourceSnapshotId: number }
): Parameters<ListingCompleteRestoreTx["insertLegacyListingVersion"]>[0] {
  return {
    listingId: listing.id,
    projectId: listing.projectId,
    userId: input.userId,
    versionNumber: input.versionNumber,
    changeType: "manual_edit",
    changeDescription: `受治理完整快照恢复：完整快照 #${input.sourceSnapshotId}`,
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

/** Lists only available governed complete snapshots; legacy listingVersions remain view-only. */
export async function listGovernedCompleteRestoreSnapshots(
  store: ListingCompleteRestoreStore,
  input: ListingCompleteRestoreListInput
): Promise<ListingCompleteRestoreSnapshotSummary[]> {
  assertListInput(input);
  return store.withTransaction(async tx => {
    const project = await tx.lockProjectForUpdate({ projectId: input.projectId });
    assertCurrentProject(project, input);
    return tx.listApprovedCompleteSnapshots({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      limit: input.limit,
    });
  });
}

/**
 * Validates the selected immutable source and returns all current/source/proposed
 * fields. It performs no formal Listing write and is the only safe token-minting
 * precursor for the tRPC confirmation mutation.
 */
export async function previewGovernedCompleteRestore(
  store: ListingCompleteRestoreStore,
  input: ListingCompleteRestoreInput
): Promise<ListingCompleteRestorePreview> {
  assertInput(input);
  return store.withTransaction(async tx => {
    const { sourceSnapshot, sourcePayload, current } =
      await loadGovernedRestoreInputs(tx, input);
    const currentHash = hashFullPayload(fullPayloadFromRow(current));
    if (currentHash !== input.expectedFullHash) {
      fail("CONFLICT", "正式 Listing 全文已变化，请刷新后重新预览恢复", {
        expectedFullHash: input.expectedFullHash,
        currentFullHash: currentHash,
      });
    }
    if (current.version !== input.expectedListingVersion) {
      fail("CONFLICT", "正式 Listing 版本已变化，请刷新后重新预览恢复", {
        expectedListingVersion: input.expectedListingVersion,
        currentListingVersion: current.version,
      });
    }
    return buildPreview({ sourceSnapshot, sourcePayload, current, request: input });
  });
}

/**
 * Atomically restores a human-reviewed, hash-verified full snapshot into the
 * formal Listing row. A successful restore always creates a *new* immutable
 * rollback snapshot and a compact governed Artifact pointer; it never mutates or
 * uses a partial legacy listingVersions row as source.
 */
export async function restoreGovernedCompleteSnapshot(
  store: ListingCompleteRestoreStore,
  input: ListingCompleteRestoreInput,
  dependencies: Partial<ListingCompleteRestoreDependencies> = {}
): Promise<ListingCompleteRestoreResult> {
  assertInput(input);
  assertSha256(input.expectedSourceFullHash, "expectedSourceFullHash");
  const deps = { ...defaultDependencies, ...dependencies };
  const approvedAt = deps.now();
  if (Number.isNaN(approvedAt.getTime())) {
    fail("INTERNAL_SERVER_ERROR", "恢复时钟返回无效时间");
  }

  return store.withTransaction(async tx => {
    const { sourceSnapshot, sourcePayload, current } =
      await loadGovernedRestoreInputs(tx, input);
    const humanApprovalRef = sourceApprovalRef(sourceSnapshot);
    const currentFullPayload = fullPayloadFromRow(current);
    const currentHash = hashFullPayload(currentFullPayload);

    if (currentHash !== input.expectedFullHash) {
      const latestSnapshot = await tx.lockLatestCompleteSnapshotForUpdate({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        listingId: current.id,
      });
      if (snapshotMatchesRestoreRequest(latestSnapshot, current, input, humanApprovalRef)) {
        const replaySnapshot = latestSnapshot!;
        const artifact = await tx.findCompleteSnapshotArtifact({
          snapshotId: replaySnapshot.id,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          listingId: current.id,
          fullHash: replaySnapshot.fullHash,
        });
        assertArtifactRegistration(
          artifact,
          replaySnapshot.fullHash,
          "已恢复的完整快照缺少不可变 Artifact，不能确认幂等结果"
        );
        const preview = buildPreview({ sourceSnapshot, sourcePayload, current, request: input });
        return {
          outcome: "already_restored",
          sourceSnapshotId: sourceSnapshot.id,
          listingId: current.id,
          projectId: current.projectId,
          contentVersion: replaySnapshot.contentVersion,
          expectedListingVersion: input.expectedListingVersion,
          listingVersion: current.version,
          expectedFullHash: input.expectedFullHash,
          expectedSourceFullHash: sourceSnapshot.fullHash,
          fullHash: replaySnapshot.fullHash,
          humanApprovalRef,
          preview,
          artifactRegistration: { status: "registered", ...artifact },
        };
      }
      fail("CONFLICT", "正式 Listing 全文已变化，未覆盖当前内容", {
        expectedFullHash: input.expectedFullHash,
        currentFullHash: currentHash,
      });
    }
    if (current.version !== input.expectedListingVersion) {
      fail("CONFLICT", "正式 Listing 版本已变化，未覆盖当前内容", {
        expectedListingVersion: input.expectedListingVersion,
        currentListingVersion: current.version,
      });
    }

    const preview = buildPreview({ sourceSnapshot, sourcePayload, current, request: input });
    const intended = restoredListing(sourcePayload, current, approvedAt);
    const cas = await tx.compareAndSwapCompleteListing({
      listingId: current.id,
      projectId: input.projectId,
      expectedListingVersion: input.expectedListingVersion,
      restoredListing: intended,
    });
    if (cas.affectedRows !== 1 || !cas.listing) {
      fail("CONFLICT", "正式 Listing CAS 失败，事务已回滚且未覆盖当前内容");
    }
    assertRestoredRow(sourcePayload, current, cas.listing, approvedAt);

    const finalPayload = fullPayloadFromRow(cas.listing);
    const finalHash = hashFullPayload(finalPayload);
    const previousSnapshot = await tx.lockLatestCompleteSnapshotForUpdate({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      listingId: cas.listing.id,
    });
    const contentVersion = (previousSnapshot?.contentVersion ?? 0) + 1;
    const inserted = await tx.insertCompleteSnapshot({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      listingId: cas.listing.id,
      contentVersion,
      fullPayloadJson: finalPayload,
      fullHash: finalHash,
      humanApprovalRef,
      changeType: "rollback",
      status: "approved",
      expectedListingVersion: input.expectedListingVersion,
      listingVersion: cas.listing.version,
      createdBy: input.actorId,
      approvedBy: input.actorId,
      approvedAt,
    });
    if (!isPositiveInteger(inserted.insertId)) {
      fail("INTERNAL_SERVER_ERROR", "恢复后的完整 Listing 快照未返回有效标识，事务已回滚");
    }

    const artifact = await tx.registerCompleteSnapshotArtifact({
      snapshotId: inserted.insertId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      listingId: cas.listing.id,
      contentVersion,
      listingVersion: cas.listing.version,
      fullHash: finalHash,
      humanApprovalRef,
      createdBy: input.actorId,
    });
    assertArtifactRegistration(
      artifact,
      finalHash,
      "恢复后的完整 Listing Artifact 注册返回无效，事务已回滚"
    );

    const previousLegacyVersion = await tx.lockLatestLegacyListingVersionForUpdate({
      listingId: cas.listing.id,
      projectId: input.projectId,
    });
    await tx.insertLegacyListingVersion(
      toLegacyVersionInput(cas.listing, {
        userId: input.actorId,
        versionNumber: (previousLegacyVersion?.versionNumber ?? 0) + 1,
        sourceSnapshotId: sourceSnapshot.id,
      })
    );

    return {
      outcome: "restored",
      sourceSnapshotId: sourceSnapshot.id,
      listingId: cas.listing.id,
      projectId: cas.listing.projectId,
      contentVersion,
      expectedListingVersion: input.expectedListingVersion,
      listingVersion: cas.listing.version,
      expectedFullHash: input.expectedFullHash,
      expectedSourceFullHash: sourceSnapshot.fullHash,
      fullHash: finalHash,
      humanApprovalRef,
      preview,
      artifactRegistration: { status: "registered", ...artifact },
    };
  });
}

/** Factory form for router composition and isolated transactional tests. */
export function createListingCompleteRestoreService(
  store: ListingCompleteRestoreStore,
  dependencies: Partial<ListingCompleteRestoreDependencies> = {}
) {
  return {
    list: (input: ListingCompleteRestoreListInput) =>
      listGovernedCompleteRestoreSnapshots(store, input),
    preview: (input: ListingCompleteRestoreInput) =>
      previewGovernedCompleteRestore(store, input),
    restore: (input: ListingCompleteRestoreInput) =>
      restoreGovernedCompleteSnapshot(store, input, dependencies),
  };
}
