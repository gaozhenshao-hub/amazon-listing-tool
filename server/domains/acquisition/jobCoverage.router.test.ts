import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getJob: vi.fn(), getSnapshot: vi.fn(), listAssets: vi.fn(), requireDb: vi.fn(),
}));
vi.mock("../../repositories/dbClient", () => ({ requireDb: mocks.requireDb }));
vi.mock("./repository", async importOriginal => ({
  ...await importOriginal<typeof import("./repository")>(),
  getAcquisitionJob: mocks.getJob,
  getSourceSnapshotByJob: mocks.getSnapshot,
  listAssetCandidates: mocks.listAssets,
}));

import { amazonAcquisitionRouter } from "./router";

const caller = (workspaceId: number) => amazonAcquisitionRouter.createCaller({
  user: { id: 7, role: "ops_specialist", defaultWorkspaceId: workspaceId } as never,
  workspaceId,
  requestId: "coverage-test",
  req: { headers: {}, header: () => undefined } as never,
  res: { locals: { requestId: "coverage-test" } } as never,
});

describe("acquisition job coverage read-only view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const db = {
      select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [{
        id: 88, workspaceId: 3, snapshotId: 23, marketplace: "US", asin: "B000000000",
        isCurrent: 1, fieldStatuses: { imageGallery: { status: "confirmed" }, aplus: { status: "not_returned" } },
        confirmedAssetIds: [1],
      }] }),
      }) }),
      }),
    };
    mocks.requireDb.mockResolvedValue(db);
    mocks.getJob.mockImplementation(async (_db, workspaceId) => workspaceId === 3 ? {
      id: 12, workspaceId: 3, status: "confirmed", asin: "B000000000", marketplace: "US",
      cacheHitSnapshotId: null, requestedCapabilities: ["image_gallery", "aplus"],
    } : null);
    mocks.getSnapshot.mockResolvedValue({ id: 23 });
    mocks.listAssets.mockResolvedValue([{ id: 1, role: "main", storageKey: "private-reference", fieldStatus: "pending_review" }]);
  });

  it("reports safely saved gallery count without claiming a missing A+ is absent", async () => {
    const result = await caller(3).jobCoverage({ jobId: 12 });
    expect(result).toEqual({
      status: "confirmed", isCurrent: true,
      coverage: [
        { capability: "image_gallery", state: "returned", storedCount: 1, failedCount: 0 },
        { capability: "aplus", state: "not_returned", storedCount: 0, failedCount: 0 },
        { capability: "brand_story", state: "not_requested", storedCount: 0, failedCount: 0 },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("private-reference");
    expect(mocks.listAssets).toHaveBeenCalledWith(expect.anything(), 3, 23);
  });

  it("shows capabilities omitted from this job as not_requested even when a snapshot has other field evidence", async () => {
    mocks.getJob.mockResolvedValueOnce({
      id: 12, workspaceId: 3, status: "confirmed", asin: "B000000000", marketplace: "US",
      cacheHitSnapshotId: null, requestedCapabilities: ["image_gallery"],
    });
    const result = await caller(3).jobCoverage({ jobId: 12 });
    expect(result.coverage).toEqual([
      { capability: "image_gallery", state: "returned", storedCount: 1, failedCount: 0 },
      { capability: "aplus", state: "not_requested", storedCount: 0, failedCount: 0 },
      { capability: "brand_story", state: "not_requested", storedCount: 0, failedCount: 0 },
    ]);
  });

  it("rejects another workspace's job before reading snapshots or assets", async () => {
    await expect(caller(4).jobCoverage({ jobId: 12 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.getSnapshot).not.toHaveBeenCalled();
    expect(mocks.listAssets).not.toHaveBeenCalled();
  });
});
