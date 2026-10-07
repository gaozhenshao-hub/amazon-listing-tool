import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({
  getProjectById: vi.fn(),
  getProjectByIdAdmin: vi.fn(),
  getListingById: vi.fn(),
  getActiveListingByProject: vi.fn(),
  updateListing: vi.fn(),
  createListing: vi.fn(),
  getListingVersionById: vi.fn(),
  getLatestListingVersionNumber: vi.fn(),
  createListingVersion: vi.fn(),
}));

vi.mock("./domains/listing/repository", async (importOriginal) => ({
  ...await importOriginal<typeof import("./domains/listing/repository")>(),
  ...mocks,
}));
vi.mock("./domains/listing/listingAgentBridge", () => ({
  LISTING_STEP_NODE_MAP: { 1: "G1", 2: "G2", 3: "G3", 4: "G4", 5: "G5" },
  syncGenerationToAgent: vi.fn(),
  syncListingNodeDraft: vi.fn(),
  syncListingPreviewConfirmed: vi.fn(),
  syncListingPreviewWaitingHuman: vi.fn(),
  syncStepLockToAgent: vi.fn(),
  syncStepUnlockToAgent: vi.fn(),
}));
vi.mock("./domains/listing/routers/jobControl", () => ({ startListingJobForContext: vi.fn() }));
vi.mock("./domains/listing/services/listingConfirmedCore", () => ({ resolveConfirmedListingCore: vi.fn() }));

import { router } from "./domains/listing/routerContext";
import { listingEditingProcedures } from "./domains/listing/routers/editing";
import { listingAbTestingProcedures } from "./domains/listing/routers/abTesting";
import { listingVersionProcedures } from "./domains/listing/routers/versions";

const legacyWriteRouter = router({
  updateByProject: listingEditingProcedures.updateByProject,
  update: listingEditingProcedures.update,
  applyABVariant: listingAbTestingProcedures.applyABVariant,
  rollbackToVersion: listingVersionProcedures.rollbackToVersion,
});

const listing = {
  id: 70,
  projectId: 22,
  title: "Original title",
  bulletPoints: "[]",
  description: "Original description",
  searchTerms: "original terms",
};

function caller(user: { id: number; role: string } | null) {
  return legacyWriteRouter.createCaller({
    user,
    workspaceId: 101,
    req: { headers: {}, header: () => undefined },
    res: { locals: {} },
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectById.mockResolvedValue({ id: listing.projectId, userId: 7, workspaceId: 101 });
  mocks.getListingById.mockResolvedValue(listing);
  mocks.getActiveListingByProject.mockResolvedValue(listing);
});

describe("legacy formal bullet writes fail closed before db.updateListing", () => {
  it("rejects an authorized project editor using updateByProject for English or Chinese bullets before listing access", async () => {
    await expect(caller({ id: 7, role: "user" }).updateByProject({
      projectId: listing.projectId,
      field: "bulletPoints",
      value: '[{"subtitle":"Unreviewed","fullText":"draft"}]',
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    await expect(caller({ id: 7, role: "user" }).updateByProject({
      projectId: listing.projectId,
      field: "bulletPointsCn",
      value: '["未经审核的卖点"]',
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    expect(mocks.getActiveListingByProject).not.toHaveBeenCalled();
    expect(mocks.createListing).not.toHaveBeenCalled();
    expect(mocks.updateListing).not.toHaveBeenCalled();
  });

  it("rejects a composite manual payload that smuggles bullets alongside otherwise valid fields before update", async () => {
    await expect(caller({ id: 7, role: "user" }).update({
      id: listing.id,
      title: "Otherwise valid title",
      description: "Otherwise valid description",
      searchTerms: "otherwise valid terms",
      bulletPoints: '[{"subtitle":"Unreviewed","fullText":"draft"}]',
      bulletPointsCn: '["未经审核的卖点"]',
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    expect(mocks.updateListing).not.toHaveBeenCalled();
    expect(mocks.createListingVersion).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller before project or listing writes", async () => {
    await expect(caller(null).updateByProject({
      projectId: listing.projectId,
      field: "bulletPoints",
      value: "[]",
    })).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    expect(mocks.getProjectById).not.toHaveBeenCalled();
    expect(mocks.getActiveListingByProject).not.toHaveBeenCalled();
    expect(mocks.updateListing).not.toHaveBeenCalled();
  });

  it("rejects client-supplied A/B bullets before reading or updating the active listing", async () => {
    await expect(caller({ id: 7, role: "user" }).applyABVariant({
      projectId: listing.projectId,
      title: "A/B title cannot authorize a bullet write",
      bulletPoints: '[{"subtitle":"Unreviewed","fullText":"A/B draft"}]',
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    expect(mocks.getActiveListingByProject).not.toHaveBeenCalled();
    expect(mocks.updateListing).not.toHaveBeenCalled();
    expect(mocks.createListingVersion).not.toHaveBeenCalled();
  });

  it("fails closed for legacy rollback before reading, snapshotting, or writing partial rows", async () => {
    await expect(caller({ id: 7, role: "user" }).rollbackToVersion({
      projectId: listing.projectId,
      versionId: 9,
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    expect(mocks.getListingVersionById).not.toHaveBeenCalled();
    expect(mocks.getActiveListingByProject).not.toHaveBeenCalled();
    expect(mocks.createListingVersion).not.toHaveBeenCalled();
    expect(mocks.updateListing).not.toHaveBeenCalled();
  });
});

describe("static legacy bullet-write audit", () => {
  it("retains no direct legacy bullet update or partial rollback write in the scoped routers", () => {
    const editing = readFileSync(resolve(import.meta.dirname, "domains/listing/routers/editing.ts"), "utf8");
    const abTesting = readFileSync(resolve(import.meta.dirname, "domains/listing/routers/abTesting.ts"), "utf8");
    const versions = readFileSync(resolve(import.meta.dirname, "domains/listing/routers/versions.ts"), "utf8");

    expect(editing).toMatch(/input\.field === "bulletPoints" \|\| input\.field === "bulletPointsCn"/);
    expect(editing).toMatch(/data\.bulletPoints !== undefined \|\| data\.bulletPointsCn !== undefined/);
    expect(abTesting).toMatch(/input\.bulletPoints !== undefined/);
    expect(versions).toContain("已审核的完整 Listing 快照回滚流程");
    expect(versions).not.toMatch(/db\.updateListing\s*\(/);
  });
});
