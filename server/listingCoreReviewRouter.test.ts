import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({ project: vi.fn(), review: vi.fn(), db: vi.fn() }));
vi.mock("./domains/listing/routerContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/listing/routerContext")>();
  return { ...actual, resolveProjectAccess: mocks.project };
});
vi.mock("./domains/listing/services/listingCoreReviewService", () => ({ reviewListingCore: mocks.review }));
vi.mock("./domains/listing/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/listing/repository")>();
  return { ...actual, getDb: mocks.db };
});
import { router } from "./_core/trpc";
import { listingCoreReviewProcedures } from "./domains/listing/routers/cores";

const callerFactory = router(listingCoreReviewProcedures);
function ctx(role: "user" | "designer" | "super_admin", workspaceId = 7): TrpcContext {
  return { user: { id: 17, role, openId: "core-reviewer", email: "reviewer@test.local", name: "reviewer", loginMethod: "manus",
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, workspaceId,
    req: { headers: {}, protocol: "https" } as TrpcContext["req"], res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"] };
}
const review = { projectId: 51, sellingPointIndex: 0, buyerReason: "Easy setup with supplied hardware", factRevisionIds: [4, 7], expectedRevision: 0, decision: "confirm" as const };

describe("listing core review real tRPC scope", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.project.mockResolvedValue({ id: 51, workspaceId: 7, userId: 17 });
    mocks.review.mockResolvedValue({ coreId: "c5bb4bfc-014d-429d-b9bc-d7c3291fe003", revision: 1, status: "confirmed" }); });
  it("rejects another workspace before invoking core transaction", async () => {
    mocks.project.mockResolvedValueOnce({ id: 51, workspaceId: 8, userId: 17 });
    await expect(callerFactory.createCaller(ctx("super_admin")).reviewCore(review)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.review).not.toHaveBeenCalled();
  });
  it("does not let designer review somebody else's project", async () => {
    mocks.project.mockResolvedValueOnce({ id: 51, workspaceId: 7, userId: 99 });
    await expect(callerFactory.createCaller(ctx("designer")).reviewCore(review)).rejects.toThrow("Designer");
    expect(mocks.review).not.toHaveBeenCalled();
  });
  it("takes actor and workspace from authenticated request, not editable input", async () => {
    await callerFactory.createCaller(ctx("user")).reviewCore(review);
    expect(mocks.review).toHaveBeenCalledWith(expect.objectContaining({ actorId: 17, workspaceId: 7, factRevisionIds: [4, 7] }));
  });
  it("refuses empty evidence before service call", async () => {
    await expect(callerFactory.createCaller(ctx("user")).reviewCore({ ...review, factRevisionIds: [] })).rejects.toThrow();
    expect(mocks.review).not.toHaveBeenCalled();
  });
});
