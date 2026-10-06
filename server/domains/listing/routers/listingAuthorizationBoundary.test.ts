import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getListingById: vi.fn(),
  getActiveListingByProject: vi.fn(),
  updateListing: vi.fn(),
  getListingVersionsByProject: vi.fn(),
  getProjectById: vi.fn(),
  getProjectByIdAdmin: vi.fn(),
  getLatestListingVersionNumber: vi.fn(),
  createListingVersion: vi.fn(),
  syncListingNodeDraft: vi.fn(),
  syncGenerationToAgent: vi.fn(),
  syncListingPreviewConfirmed: vi.fn(),
  syncListingPreviewWaitingHuman: vi.fn(),
  syncStepLockToAgent: vi.fn(),
  syncStepUnlockToAgent: vi.fn(),
}));

vi.mock("../repository", () => mocks);
vi.mock("../listingAgentBridge", () => ({
  LISTING_STEP_NODE_MAP: { 1: "G1", 2: "G2", 3: "G3", 4: "G4", 5: "G5" },
  ensureListingAgentRun: vi.fn(),
  syncListingNodeDraft: mocks.syncListingNodeDraft,
  syncGenerationToAgent: mocks.syncGenerationToAgent,
  syncListingPreviewConfirmed: mocks.syncListingPreviewConfirmed,
  syncListingPreviewWaitingHuman: mocks.syncListingPreviewWaitingHuman,
  syncStepLockToAgent: mocks.syncStepLockToAgent,
  syncStepUnlockToAgent: mocks.syncStepUnlockToAgent,
}));

import { listingRouter } from "../router";

const listing = {
  id: 700,
  projectId: 22,
  agentRunId: "listing-agent-22",
  title: "Original title",
  bulletPoints: "[]",
  description: "",
  searchTerms: "",
};

function caller(userId: number, workspaceId: number | null = 101) {
  return listingRouter.createCaller({
    user: { id: userId, role: "user" },
    workspaceId,
    req: { headers: {}, header: () => undefined },
    res: { locals: {} },
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getListingById.mockResolvedValue(listing);
  mocks.getLatestListingVersionNumber.mockResolvedValue(0);
  mocks.createListingVersion.mockResolvedValue({ id: 1 });
});

describe("listing server-side project isolation", () => {
  it("分步编辑拒绝项目归属及系统字段的动态覆盖", async () => {
    mocks.getProjectById.mockResolvedValue({ id: listing.projectId, userId: 11, workspaceId: 101 });
    await expect(caller(11).updateByProject({ projectId: listing.projectId, field: "projectId", value: "999" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.getActiveListingByProject).not.toHaveBeenCalled();
    expect(mocks.updateListing).not.toHaveBeenCalled();
  });

  it("分步编辑在跨工作空间时禁止写入", async () => {
    mocks.getProjectById.mockResolvedValue({ id: listing.projectId, userId: 11, workspaceId: 202 });
    await expect(caller(11, 101).updateByProject({ projectId: listing.projectId, field: "title", value: "Denied" }))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(mocks.getActiveListingByProject).not.toHaveBeenCalled();
    expect(mocks.updateListing).not.toHaveBeenCalled();
  });

  it("分步编辑授权写入使用 projectId 复合约束", async () => {
    mocks.getProjectById.mockResolvedValue({ id: listing.projectId, userId: 11, workspaceId: 101 });
    mocks.getActiveListingByProject.mockResolvedValue(listing);
    mocks.updateListing.mockResolvedValue({ ...listing, title: "Allowed" });
    await caller(11).updateByProject({ projectId: listing.projectId, field: "title", value: "Allowed" });
    expect(mocks.updateListing).toHaveBeenCalledWith(listing.id, { title: "Allowed" }, listing.projectId);
  });

  it("rejects a regular user updating another project before any listing, version, or Agent write", async () => {
    mocks.getProjectById.mockResolvedValue(null);

    await expect(caller(11).update({ id: listing.id, title: "Cross-project attempt" }))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });

    expect(mocks.updateListing).not.toHaveBeenCalled();
    expect(mocks.createListingVersion).not.toHaveBeenCalled();
    expect(mocks.syncListingNodeDraft).not.toHaveBeenCalled();
  });

  it("rejects a workspace-mismatched listing before any listing, version, or Agent write", async () => {
    mocks.getProjectById.mockResolvedValue({ id: listing.projectId, userId: 11, workspaceId: 202 });

    await expect(caller(11, 101).update({ id: listing.id, title: "Cross-workspace attempt" }))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });

    expect(mocks.updateListing).not.toHaveBeenCalled();
    expect(mocks.createListingVersion).not.toHaveBeenCalled();
    expect(mocks.syncListingNodeDraft).not.toHaveBeenCalled();
  });

  it("allows an authorized user to update and scopes the repository write to the listing project", async () => {
    mocks.getProjectById.mockResolvedValue({ id: listing.projectId, userId: 11, workspaceId: 101 });
    mocks.updateListing.mockResolvedValue({ ...listing, title: "Authorized title" });

    await expect(caller(11).update({ id: listing.id, title: "Authorized title" }))
      .resolves.toMatchObject({ id: listing.id, projectId: listing.projectId, title: "Authorized title" });

    expect(mocks.updateListing).toHaveBeenCalledWith(
      listing.id,
      { title: "Authorized title" },
      listing.projectId,
    );
    expect(mocks.createListingVersion).toHaveBeenCalledWith(expect.objectContaining({
      listingId: listing.id,
      projectId: listing.projectId,
      userId: 11,
    }));
    expect(mocks.syncListingNodeDraft).toHaveBeenCalledWith(expect.objectContaining({
      projectId: listing.projectId,
      userId: 11,
      nodeId: "G2",
    }));
  });

  it("rejects cross-project version-history reads without querying snapshots", async () => {
    mocks.getProjectById.mockResolvedValue(null);

    await expect(caller(11).getVersionHistory({ projectId: listing.projectId }))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });

    expect(mocks.getListingVersionsByProject).not.toHaveBeenCalled();
  });

  it("allows authorized version-history reads and rejects workspace-mismatched reads", async () => {
    mocks.getProjectById.mockResolvedValueOnce({ id: listing.projectId, userId: 11, workspaceId: 101 });
    mocks.getListingVersionsByProject.mockResolvedValue([{ id: 1, projectId: listing.projectId }]);

    await expect(caller(11).getVersionHistory({ projectId: listing.projectId }))
      .resolves.toEqual([{ id: 1, projectId: listing.projectId }]);
    expect(mocks.getListingVersionsByProject).toHaveBeenCalledWith(listing.projectId);

    mocks.getProjectById.mockResolvedValueOnce({ id: listing.projectId, userId: 11, workspaceId: 202 });
    await expect(caller(11, 101).getVersionHistory({ projectId: listing.projectId }))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(mocks.getListingVersionsByProject).toHaveBeenCalledTimes(1);
  });
});
