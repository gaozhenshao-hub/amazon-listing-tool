import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getActiveListingByProject: vi.fn(),
  getProjectById: vi.fn(),
  getProjectByIdAdmin: vi.fn(),
  preview: vi.fn(),
  sync: vi.fn(),
}));

vi.mock("./domains/listing/repository", () => ({
  getDb: mocks.getDb,
  getActiveListingByProject: mocks.getActiveListingByProject,
  getProjectById: mocks.getProjectById,
  getProjectByIdAdmin: mocks.getProjectByIdAdmin,
}));

vi.mock("./domains/listing/services/listingCandidateSyncDrizzleStore", () => ({
  listingCandidateSyncDrizzleStore: { withTransaction: vi.fn() },
}));

vi.mock("./domains/listing/services/listingCandidateSyncService", async importOriginal => {
  const actual = await importOriginal<typeof import("./domains/listing/services/listingCandidateSyncService")>();
  return {
    ...actual,
    hashCompleteListing: vi.fn(() => "a".repeat(64)),
    previewListingCandidateSync: mocks.preview,
    syncConfirmedListingCandidate: mocks.sync,
  };
});

import { listingRouter } from "./domains/listing/router";
import { ListingCandidateSyncError } from "./domains/listing/services/listingCandidateSyncService";

const workspaceId = 7;
const projectId = 17;
const actorId = 31;
const candidateId = 301;
const listingId = 401;
const expectedFullHash = "a".repeat(64);

function caller(userId = actorId, currentWorkspaceId: number | null = workspaceId) {
  return listingRouter.createCaller({
    user: { id: userId, role: "user" },
    workspaceId: currentWorkspaceId,
    req: { headers: {}, header: () => undefined },
    res: { locals: {} },
  } as any);
}

function chainableCandidateCoreDb(sellingPointIndex = 2) {
  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: async () => [{ sellingPointIndex }] }),
        }),
      }),
    }),
  };
}

function preview() {
  return {
    listingId,
    projectId,
    sellingPointIndex: 2,
    existingBulletCount: 5,
    currentBullet: { subtitle: "before", fullText: "old" },
    candidateBullet: { subtitle: "after", fullText: "new" },
    currentFullPayload: { id: listingId },
    proposedFullPayload: { id: listingId, version: 4 },
    changedFields: ["bulletPoints", "version", "updatedAt"] as const,
    expectedListingVersion: 3,
    expectedFullHash,
    currentFullHash: expectedFullHash,
    nextListingVersion: 4,
    candidate: { id: candidateId, candidateKey: "candidate-lineage", candidateRevision: 2, contentHash: "b".repeat(64), coreRevisionId: 101, evidenceFactIds: [201] },
    core: { id: 101, coreId: "core-lineage", revision: 4, inputHash: "c".repeat(64) },
    humanApprovalRef: "listing_review:701",
  };
}

function applied(outcome: "applied" | "already_applied" = "applied") {
  return {
    outcome,
    listingId,
    projectId,
    candidateId,
    sellingPointIndex: 2,
    contentVersion: 1,
    expectedListingVersion: 3,
    listingVersion: 4,
    expectedFullHash,
    fullHash: "d".repeat(64),
    humanApprovalRef: "listing_review:701",
    preview: preview(),
    artifactRegistration: {
      status: "registered" as const,
      artifactId: "art_listing_1",
      artifactKey: "listing.complete_snapshot",
      version: 1,
      ref: "ai-artifact://art_listing_1@1",
      currentRef: "ai-artifact-scope://listing@current",
      contentHash: "d".repeat(64),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = "local-test-secret";
  mocks.getProjectById.mockResolvedValue({ id: projectId, workspaceId, userId: actorId });
  mocks.getProjectByIdAdmin.mockResolvedValue({ id: projectId, workspaceId, userId: actorId });
  mocks.getActiveListingByProject.mockResolvedValue({ id: listingId, projectId, version: 3 });
  mocks.getDb.mockResolvedValue(chainableCandidateCoreDb());
  mocks.preview.mockResolvedValue(preview());
  mocks.sync.mockResolvedValue(applied());
});
afterEach(() => { vi.restoreAllMocks(); });

describe("listing candidate CAS tRPC boundary", () => {
  it("rejects a regular user attempting another project before preview or Listing access", async () => {
    mocks.getProjectById.mockResolvedValue(null);

    await expect(caller(99).previewConfirmedListingSync({
      projectId, candidateId, expectedCandidateRevision: 2,
    })).rejects.toThrow("Project not found");

    expect(mocks.getActiveListingByProject).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("rejects a cross-workspace direct tRPC request before candidate or Listing sync", async () => {
    mocks.getProjectById.mockResolvedValue({ id: projectId, workspaceId: 99, userId: actorId });

    await expect(caller().previewConfirmedListingSync({
      projectId, candidateId, expectedCandidateRevision: 2,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(mocks.getActiveListingByProject).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it("rejects an unconfirmed candidate through the direct preview API and mints no final token", async () => {
    mocks.preview.mockRejectedValue(new ListingCandidateSyncError(
      "PRECONDITION_FAILED",
      "候选尚未人工确认或已失效，不能同步正式 Listing",
    ));

    await expect(caller().previewConfirmedListingSync({
      projectId, candidateId, expectedCandidateRevision: 2,
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("requires a complete preview token before any final Listing write", async () => {
    await expect(caller().syncConfirmedToListing({ previewToken: "missing.preview.token" }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("rejects a payload byte change after preview even when its signature part is retained", async () => {
    const { previewToken } = await caller().previewConfirmedListingSync({ projectId, candidateId, expectedCandidateRevision: 2 });
    const [payload, signature] = previewToken.split(".");
    const changedPayload = `${payload[0] === "A" ? "B" : "A"}${payload.slice(1)}`;
    await expect(caller().syncConfirmedToListing({ previewToken: `${changedPayload}.${signature}` }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("rejects the same signed preview after expiry without touching the CAS service", async () => {
    const timestamp = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(timestamp);
    const { previewToken } = await caller().previewConfirmedListingSync({ projectId, candidateId, expectedCandidateRevision: 2 });
    clock.mockReturnValue(timestamp + 10 * 60 * 1000 + 1);
    await expect(caller().syncConfirmedToListing({ previewToken }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("binds preview to the precise user and workspace even inside the expiry window", async () => {
    const { previewToken } = await caller().previewConfirmedListingSync({ projectId, candidateId, expectedCandidateRevision: 2 });
    await expect(caller(999).syncConfirmedToListing({ previewToken }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(actorId, workspaceId + 1).syncConfirmedToListing({ previewToken }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("maps a post-preview CAS conflict without retrying or overwriting the Listing", async () => {
    const first = await caller().previewConfirmedListingSync({ projectId, candidateId, expectedCandidateRevision: 2 });
    mocks.sync.mockRejectedValueOnce(new ListingCandidateSyncError("CONFLICT", "正式 Listing 全文已变化，未覆盖旧内容"));

    await expect(caller().syncConfirmedToListing({ previewToken: first.previewToken }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.sync).toHaveBeenCalledTimes(1);
  });

  it("surfaces transactional Artifact registration failure; service failure prevents a success response", async () => {
    const first = await caller().previewConfirmedListingSync({ projectId, candidateId, expectedCandidateRevision: 2 });
    mocks.sync.mockRejectedValueOnce(new ListingCandidateSyncError(
      "INTERNAL_SERVER_ERROR",
      "完整 Listing Artifact 注册失败，事务已回滚",
    ));

    await expect(caller().syncConfirmedToListing({ previewToken: first.previewToken }))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(mocks.sync).toHaveBeenCalledTimes(1);
  });

  it("allows a duplicate final confirmation only when the service reports the existing immutable application", async () => {
    const first = await caller().previewConfirmedListingSync({ projectId, candidateId, expectedCandidateRevision: 2 });
    mocks.sync.mockResolvedValueOnce(applied("applied")).mockResolvedValueOnce(applied("already_applied"));

    await expect(caller().syncConfirmedToListing({ previewToken: first.previewToken }))
      .resolves.toMatchObject({ outcome: "applied" });
    await expect(caller().syncConfirmedToListing({ previewToken: first.previewToken }))
      .resolves.toMatchObject({ outcome: "already_applied", contentVersion: 1 });
    expect(mocks.sync).toHaveBeenCalledTimes(2);
  });
});
