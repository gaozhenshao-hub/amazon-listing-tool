import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectById: vi.fn(),
  getProjectByIdAdmin: vi.fn(),
  getActiveListingByProject: vi.fn(),
  list: vi.fn(),
  preview: vi.fn(),
  restore: vi.fn(),
}));

vi.mock("./domains/listing/repository", async importOriginal => ({
  ...await importOriginal<typeof import("./domains/listing/repository")>(),
  getProjectById: mocks.getProjectById,
  getProjectByIdAdmin: mocks.getProjectByIdAdmin,
  getActiveListingByProject: mocks.getActiveListingByProject,
}));

vi.mock("./domains/listing/services/listingCompleteRestoreDrizzleStore", () => ({
  listingCompleteRestoreDrizzleStore: { withTransaction: vi.fn() },
}));

vi.mock("./domains/listing/services/listingCompleteRestoreService", async importOriginal => {
  const actual = await importOriginal<typeof import("./domains/listing/services/listingCompleteRestoreService")>();
  return {
    ...actual,
    listGovernedCompleteRestoreSnapshots: mocks.list,
    previewGovernedCompleteRestore: mocks.preview,
    restoreGovernedCompleteSnapshot: mocks.restore,
  };
});

vi.mock("./domains/listing/services/listingCandidateSyncService", async importOriginal => {
  const actual = await importOriginal<typeof import("./domains/listing/services/listingCandidateSyncService")>();
  return { ...actual, hashCompleteListing: vi.fn(() => "a".repeat(64)) };
});

import { listingRouter } from "./domains/listing/router";
import { ListingCompleteRestoreError } from "./domains/listing/services/listingCompleteRestoreService";

const workspaceId = 7;
const projectId = 17;
const actorId = 31;
const listingId = 401;
const sourceSnapshotId = 901;
const currentHash = "a".repeat(64);
const sourceHash = "b".repeat(64);

function caller(userId = actorId, currentWorkspaceId: number | null = workspaceId) {
  return listingRouter.createCaller({
    user: { id: userId, role: "user" },
    workspaceId: currentWorkspaceId,
    req: { headers: {}, header: () => undefined },
    res: { locals: {} },
  } as any);
}

function preview() {
  return {
    sourceSnapshot: {
      id: sourceSnapshotId,
      listingId,
      contentVersion: 3,
      fullHash: sourceHash,
      humanApprovalRef: "listing_review:701",
      changeType: "candidate_apply",
      status: "approved",
      expectedListingVersion: 2,
      listingVersion: 3,
      createdBy: actorId,
      approvedBy: actorId,
      approvedAt: new Date("2026-10-07T00:00:00.000Z"),
      createdAt: new Date("2026-10-07T00:00:00.000Z"),
    },
    sourceFullPayload: { id: listingId, projectId, title: "source complete" },
    currentFullPayload: { id: listingId, projectId, title: "current complete" },
    proposedFullPayload: { id: listingId, projectId, title: "source complete", version: 5 },
    restoredFieldNames: ["title", "qaContent", "lockedSteps", "agentRunId"],
    changedFields: ["title", "qaContent", "lockedSteps", "agentRunId", "version", "updatedAt"],
    serverAssignedFields: ["version", "updatedAt"] as const,
    listingId,
    projectId,
    expectedListingVersion: 4,
    expectedFullHash: currentHash,
    currentFullHash: currentHash,
    expectedSourceFullHash: sourceHash,
    nextListingVersion: 5,
    humanApprovalRef: `listing_restore:${sourceSnapshotId}:${sourceHash}`,
  };
}

function restored(outcome: "restored" | "already_restored" = "restored") {
  return {
    outcome,
    sourceSnapshotId,
    listingId,
    projectId,
    contentVersion: 4,
    expectedListingVersion: 4,
    listingVersion: 5,
    expectedFullHash: currentHash,
    expectedSourceFullHash: sourceHash,
    fullHash: "c".repeat(64),
    humanApprovalRef: `listing_restore:${sourceSnapshotId}:${sourceHash}`,
    preview: preview(),
    artifactRegistration: {
      status: "registered" as const,
      artifactId: "art_listing_2",
      artifactKey: "listing.complete_snapshot",
      version: 2,
      ref: "ai-artifact://art_listing_2@2",
      currentRef: "ai-artifact-scope://listing.complete_snapshot@current",
      contentHash: "c".repeat(64),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = "local-restore-test-secret";
  mocks.getProjectById.mockResolvedValue({ id: projectId, workspaceId, userId: actorId });
  mocks.getProjectByIdAdmin.mockResolvedValue({ id: projectId, workspaceId, userId: actorId });
  mocks.getActiveListingByProject.mockResolvedValue({ id: listingId, projectId, version: 4 });
  mocks.list.mockResolvedValue([{ ...preview().sourceSnapshot }]);
  mocks.preview.mockResolvedValue(preview());
  mocks.restore.mockResolvedValue(restored());
});

describe("governed complete Listing restore tRPC boundary", () => {
  it("keeps legacy version rollback closed; no governed service is called from a partial version ID", async () => {
    await expect(caller().rollbackToVersion({ projectId, versionId: 9 }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.restore).not.toHaveBeenCalled();
  });

  it("rejects a cross-workspace direct snapshot selection before store access", async () => {
    mocks.getProjectById.mockResolvedValue({ id: projectId, workspaceId: 99, userId: actorId });

    await expect(caller().listGovernedCompleteRestoreSnapshots({ projectId }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("rejects an unauthorized actor before preview reads an active Listing or invokes the restore service", async () => {
    mocks.getProjectById.mockResolvedValue(null);

    await expect(caller(99).previewGovernedCompleteRestore({ projectId, sourceSnapshotId }))
      .rejects.toThrow("Project not found");

    expect(mocks.getActiveListingByProject).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("returns the complete governed preview and mints a short-lived token only after the service validates the selected snapshot", async () => {
    const response = await caller().previewGovernedCompleteRestore({ projectId, sourceSnapshotId });

    expect(response.preview.sourceFullPayload).toMatchObject({ title: "source complete" });
    expect(response.preview.restoredFieldNames).toContain("agentRunId");
    expect(response.restoreToken).toContain(".");
    expect(mocks.preview).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      workspaceId,
      projectId,
      sourceSnapshotId,
      listingId,
      expectedFullHash: currentHash,
    }));
  });

  it("rejects malformed or missing confirmation tokens before any restore invocation", async () => {
    await expect(caller().restoreGovernedCompleteSnapshot({ restoreToken: "not-a-token" }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    expect(mocks.restore).not.toHaveBeenCalled();
  });

  it("rejects an actor attempting to replay another operator's valid token", async () => {
    const { restoreToken } = await caller().previewGovernedCompleteRestore({ projectId, sourceSnapshotId });

    await expect(caller(99).restoreGovernedCompleteSnapshot({ restoreToken }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(mocks.restore).not.toHaveBeenCalled();
  });

  it("surfaces source snapshots with missing full fields as a failed preview and never mints a destructive token", async () => {
    mocks.preview.mockRejectedValueOnce(new ListingCompleteRestoreError(
      "PRECONDITION_FAILED",
      "完整 Listing 快照字段不完整或与 0204 合同不匹配，不能恢复",
    ));

    await expect(caller().previewGovernedCompleteRestore({ projectId, sourceSnapshotId }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.restore).not.toHaveBeenCalled();
  });

  it("maps a concurrent CAS conflict without retrying or overwriting the Listing", async () => {
    const { restoreToken } = await caller().previewGovernedCompleteRestore({ projectId, sourceSnapshotId });
    mocks.restore.mockRejectedValueOnce(new ListingCompleteRestoreError(
      "CONFLICT",
      "正式 Listing 全文已变化，未覆盖当前内容",
    ));

    await expect(caller().restoreGovernedCompleteSnapshot({ restoreToken }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.restore).toHaveBeenCalledTimes(1);
  });

  it("surfaces governed Artifact failure rather than reporting a restored Listing", async () => {
    const { restoreToken } = await caller().previewGovernedCompleteRestore({ projectId, sourceSnapshotId });
    mocks.restore.mockRejectedValueOnce(new ListingCompleteRestoreError(
      "INTERNAL_SERVER_ERROR",
      "恢复后的完整 Listing Artifact 注册返回无效，事务已回滚",
    ));

    await expect(caller().restoreGovernedCompleteSnapshot({ restoreToken }))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(mocks.restore).toHaveBeenCalledTimes(1);
  });

  it("allows duplicate confirmation only when the service confirms the existing immutable rollback snapshot", async () => {
    const { restoreToken } = await caller().previewGovernedCompleteRestore({ projectId, sourceSnapshotId });
    mocks.restore.mockResolvedValueOnce(restored("restored")).mockResolvedValueOnce(restored("already_restored"));

    await expect(caller().restoreGovernedCompleteSnapshot({ restoreToken }))
      .resolves.toMatchObject({ outcome: "restored" });
    await expect(caller().restoreGovernedCompleteSnapshot({ restoreToken }))
      .resolves.toMatchObject({ outcome: "already_restored", contentVersion: 4 });
    expect(mocks.restore).toHaveBeenCalledTimes(2);
  });
});
