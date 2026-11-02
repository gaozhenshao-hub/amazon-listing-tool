import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({ project: vi.fn(), source: vi.fn(), review: vi.fn() }));
vi.mock("./domains/listing/routerContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/listing/routerContext")>();
  return { ...actual, resolveProjectAccess: mocks.project };
});
vi.mock("./domains/listing/services/listingFactSource", () => ({ getCurrentRawFactSuggestions: mocks.source }));
vi.mock("./domains/listing/services/listingFactReviewService", () => ({ reviewListingRawFact: mocks.review }));
import { router } from "./_core/trpc";
import { listingFactReviewProcedures } from "./domains/listing/routers/facts";

const callerFactory = router(listingFactReviewProcedures);
function ctx(role: "user" | "designer" | "super_admin", workspaceId = 7): TrpcContext {
  return { user: { id: 17, role, openId: "reviewer", email: "reviewer@test.local", name: "reviewer", loginMethod: "manus",
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, workspaceId,
    req: { headers: {}, protocol: "https" } as TrpcContext["req"], res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"] };
}
const review = { projectId: 51, fileId: 4, rawHash: "a".repeat(64), sourceLine: 1, sourceLineHash: "b".repeat(64),
  expectedRevision: 0, decision: "confirm" as const };

describe("listing fact review real tRPC scope", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.project.mockResolvedValue({ id: 51, workspaceId: 7, userId: 17 });
    mocks.source.mockResolvedValue({ status: "reviewable", file: { id: 4 }, suggestions: [review], total: 1 });
    mocks.review.mockResolvedValue({ id: 1, revision: 1, status: "confirmed" }); });
  it("rejects a project bound to a different workspace before reading facts or writing review", async () => {
    mocks.project.mockResolvedValueOnce({ id: 51, workspaceId: 8, userId: 17 });
    const caller = callerFactory.createCaller(ctx("super_admin"));
    await expect(caller.reviewRawFact(review)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.review).not.toHaveBeenCalled();
  });
  it("does not let a designer write another user's project", async () => {
    mocks.project.mockResolvedValueOnce({ id: 51, workspaceId: 7, userId: 99 });
    await expect(callerFactory.createCaller(ctx("designer")).reviewRawFact(review)).rejects.toThrow("Designer");
    expect(mocks.review).not.toHaveBeenCalled();
  });
  it("binds the actor and workspace from authenticated context, not the browser payload", async () => {
    const caller = callerFactory.createCaller(ctx("user"));
    await caller.reviewRawFact(review);
    expect(mocks.review).toHaveBeenCalledWith(expect.objectContaining({ actorId: 17, actorRole: "user", workspaceId: 7 }));
  });
});
