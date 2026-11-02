import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), existing: [] as unknown[][], inserts: vi.fn(), updates: vi.fn() }));
vi.mock("./domains/listing/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/listing/repository")>();
  return { ...actual, getDb: mocks.getDb };
});
import { reviewListingCore } from "./domains/listing/services/listingCoreReviewService";
const hash = "a".repeat(64);
const input = { projectId: 9, workspaceId: 5, actorId: 7, actorRole: "user", sellingPointIndex: 0,
  buyerReason: "Easy everyday setup", factRevisionIds: [23], expectedRevision: 0, decision: "confirm" as const };
const mkBuilder = (rows: unknown[]) => {
  const builder: any = { from: () => builder, where: () => builder, orderBy: () => builder,
    for: () => builder, limit: () => builder, then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
  return builder;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.existing = [[{ id: 9, workspaceId: 5, userId: 7 }], [{ id: 3, hash, workspaceId: 5, status: "completed", lifecycleState: "hot" }],
    [{ id: 23, status: "confirmed", confirmedBy: 7, confirmedAt: new Date(), sourceFileId: 3, rawHash: hash,
      attributeKey: "Shell", value: "Padded shell" }], [], []];
  const tx = { select: () => mkBuilder(mocks.existing.shift() || []),
    insert: () => ({ values: async (payload: unknown) => { mocks.inserts(payload); return [{ insertId: 31 }]; } }),
    update: () => ({ set: (payload: unknown) => ({ where: async () => { mocks.updates(payload); } }) }) };
  mocks.getDb.mockResolvedValue({ transaction: async (fn: (tx: typeof tx) => unknown) => fn(tx) });
});

describe("listing core review transaction", () => {
  it("confirms an exact current human-reviewed fact and returns immutable core binding", async () => {
    const result = await reviewListingCore(input);
    expect(result).toMatchObject({ id: 31, revision: 1, status: "confirmed" });
    expect(mocks.inserts).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 5, projectId: 9, factRevisionIdsJson: [23], confirmedBy: 7 }));
  });
  it("rejects two concurrent active cores at one position even when coreIds differ", async () => {
    mocks.existing[3] = [{ coreId: "other-core-id" }];
    await expect(reviewListingCore(input)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.inserts).not.toHaveBeenCalled();
  });
  it("rejects raw upload wrongly linked to another workspace before a core write", async () => {
    mocks.existing[1] = [{ id: 3, hash, workspaceId: 15, status: "completed", lifecycleState: "hot" }];
    await expect(reviewListingCore(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.inserts).not.toHaveBeenCalled();
  });
  it("rejects stale fact even if browser supplied its prior revision ID", async () => {
    mocks.existing[2] = [{ id: 23, status: "stale", confirmedBy: 7, confirmedAt: new Date(), sourceFileId: 3, rawHash: hash }];
    await expect(reviewListingCore(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.inserts).not.toHaveBeenCalled();
  });
  it.each([
    { workspaceId: null, status: "completed", lifecycleState: "hot" },
    { workspaceId: 5, status: "analyzing", lifecycleState: "hot" },
    { workspaceId: 5, status: "failed", lifecycleState: "hot" },
    { workspaceId: 5, status: "completed", lifecycleState: "deleted" },
  ])("rejects invalid current source before creating a core: %j", async (fileStatus) => {
    mocks.existing[1] = [{ id: 3, hash, ...fileStatus }];
    await expect(reviewListingCore(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.inserts).not.toHaveBeenCalled();
  });
});
