import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolveProject: vi.fn(), updateListing: vi.fn(), createListing: vi.fn() }));
vi.mock("./domains/listing/routerContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/listing/routerContext")>();
  const { initTRPC, TRPCError } = await import("@trpc/server");
  const { z } = await import("zod");
  const t = initTRPC.context<{ user: { id: number; role: string }; workspaceId: number }>().create();
  return { ...actual, protectedProcedure: t.procedure, router: t.router, TRPCError, z,
    resolveProjectAccess: mocks.resolveProject, ensureWriteAccess: vi.fn(),
    db: { updateListing: mocks.updateListing, createListing: mocks.createListing } };
});
vi.mock("./domains/listing/routers/jobControl", () => ({ startListingJobForContext: vi.fn() }));
import { router } from "./domains/listing/routerContext";
import { listingEditingProcedures } from "./domains/listing/routers/editing";

const caller = router({ syncBulletsFromSellingPoints: listingEditingProcedures.syncBulletsFromSellingPoints })
  .createCaller({ user: { id: 7, role: "admin" }, workspaceId: 12 });

describe("旧自由文本卖点同步必须失败关闭", () => {
  it("即使有项目编辑权也不允许伪造浏览器确认态并覆盖旧Listing", async () => {
    mocks.resolveProject.mockResolvedValue({ id: 3, workspaceId: 12, userId: 7 });
    await expect(caller.syncBulletsFromSellingPoints({ projectId: 3,
      bullets: [{ subtitle: "Unreviewed Draft:", fullText: "Arbitrary text" }] }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.updateListing).not.toHaveBeenCalled();
    expect(mocks.createListing).not.toHaveBeenCalled();
  });
});
