import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolveProject: vi.fn(), start: vi.fn(), list: vi.fn(), latest: vi.fn(), cancel: vi.fn() }));
vi.mock("./domains/listing/routerContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/listing/routerContext")>();
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.context<{ user: { id: number; role: string }; workspaceId: number }>().create();
  return { ...actual, protectedProcedure: t.procedure, router: t.router,
    db: { getActiveListingByProject: vi.fn() }, resolveProjectAccess: mocks.resolveProject,
    ensureWriteAccess: vi.fn() };
});
vi.mock("./domains/listing/services/generationJob", async () => {
  const { z } = await import("zod");
  return {
  listingGenerationJobInput: z.object({
    projectId: z.number().int().positive(),
    operation: z.enum(["sellingPoints", "singleBullet", "bullets", "batch"]),
    nodeId: z.enum(["G1", "G2", "G3", "G4", "G5"]),
    scopeKey: z.string().default("main"),
    agentRunId: z.string().optional(),
  }),
  getLatestListingNodeJob: mocks.latest, listListingGenerationJobs: mocks.list,
  startListingGenerationJob: mocks.start, cancelListingGenerationJob: mocks.cancel,
  syncListingPreparationNodes: vi.fn(),
  };
});
vi.mock("./domains/listing/listingAgentBridge", async (importOriginal) => ({
  ...await importOriginal<typeof import("./domains/listing/listingAgentBridge")>(), ensureListingAgentRun: vi.fn(),
}));

import { router } from "./domains/listing/routerContext";
import { listingJobControlProcedures } from "./domains/listing/routers/jobControl";
const caller = router(listingJobControlProcedures).createCaller({ user: { id: 7, role: "admin" }, workspaceId: 12 });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveProject.mockImplementation(async (_id: number, _user: unknown, workspaceId?: number | null) => {
    if (workspaceId !== 12) throw new Error("Project not found");
    throw new Error("Project not found"); // A different workspace-bound project must be invisible.
  });
});

describe("Listing Job API工作空间范围", () => {
  it("start/get/list/cancel各自把工作空间传入解析器并在副作用之前拒绝跨空间项目", async () => {
    await expect(caller.startGenerationJob({ projectId: 5, operation: "sellingPoints", nodeId: "G1" })).rejects.toThrow("Project not found");
    await expect(caller.getGenerationRun({ projectId: 5, nodeId: "G1" })).rejects.toThrow("Project not found");
    await expect(caller.listGenerationRuns({ projectId: 5 })).rejects.toThrow("Project not found");
    await expect(caller.cancelGenerationJob({ projectId: 5, nodeId: "G1" })).rejects.toThrow("Project not found");
    expect(mocks.resolveProject).toHaveBeenCalledTimes(4);
    for (const call of mocks.resolveProject.mock.calls) expect(call).toEqual([5, { id: 7, role: "admin" }, 12]);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.latest).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
});
