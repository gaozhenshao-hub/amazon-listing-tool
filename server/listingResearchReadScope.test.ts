import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(), getAdminProject: vi.fn(), getAnalyses: vi.fn(), forbidden: vi.fn(),
}));
vi.mock("./repositories", () => ({
  getProjectById: mocks.getProject, getProjectByIdAdmin: mocks.getAdminProject,
  getCompetitorAnalysesByProject: mocks.getAnalyses,
}));
vi.mock("./repositories/dbClient", () => ({ getDb: mocks.forbidden, requireDb: mocks.forbidden }));

// Other procedures share this router file. Isolate their import-time execution
// dependencies, not the read resolver or its auth/workspace implementation.
// These procedures/schemas are deliberately outside this test's claim.
vi.mock("./services/analysisImportExecution", () => ({
  executeReviewImport: mocks.forbidden, executeSellerSpriteImport: mocks.forbidden, runAnalysisSkill: mocks.forbidden,
}));
vi.mock("./services/analysisImportJob", async () => {
  const { z } = await import("zod");
  return { analysisImportJobInputSchema: z.object({}), startAnalysisImportJob: mocks.forbidden,
    getAnalysisImportJob: mocks.forbidden, listAnalysisImportJobs: mocks.forbidden };
});
vi.mock("./domains/acquisition/acquisitionJobs", () => ({ startAmazonAcquisitionJob: mocks.forbidden }));
vi.mock("./domains/acquisition/repository", () => ({ findFreshConfirmedSnapshot: mocks.forbidden }));
vi.mock("./domains/acquisition/legacyConsumerProjection", () => ({ loadConfirmedSnapshotForConsumer: mocks.forbidden }));
vi.mock("./domains/ai_os/services/businessArtifactRegistry", () => ({
  registerCompetitorAnalysisArtifact: mocks.forbidden, registerCompetitorComparisonArtifact: mocks.forbidden,
}));
vi.mock("./reviewParser", () => ({ parseReviewFile: mocks.forbidden }));
vi.mock("./storage", () => ({ resolveStoredObjectUrl: mocks.forbidden }));

import { analysisRouter } from "./routers/analysis";

let project: { id: number; userId: number; workspaceId: number | null };
const analyses = [{ id: 11, projectId: 3, asin: "B000000011", title: "Selected research",
  imageUrls: null, price: "0", reviewCount: "0", summaryStatus: "draft", summary: null,
  rawData: '{"count":0,"enabled":false}' }];

function caller(options: { id?: number; role?: string; workspaceId?: number | null; authenticated?: boolean } = {}) {
  const workspaceId = options.workspaceId === undefined ? 9 : options.workspaceId;
  return analysisRouter.createCaller({
    user: options.authenticated === false ? null : {
      id: options.id ?? 7, role: options.role ?? "ops_specialist", defaultWorkspaceId: workspaceId,
    },
    workspaceId, requestId: "synthetic-research-read", req: {}, res: {},
  } as unknown as TrpcContext);
}
function expectNoRead() {
  expect(mocks.getProject).not.toHaveBeenCalled();
  expect(mocks.getAdminProject).not.toHaveBeenCalled();
  expect(mocks.getAnalyses).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  project = { id: 3, userId: 7, workspaceId: 9 };
  // Models getProjectById's existing owner predicate and legacy NULL scope
  // policy; it grants no extra role-based/admin access.
  mocks.getProject.mockImplementation(async (id, userId, workspaceId) => {
    if (id !== project.id || userId !== project.userId) return null;
    if (workspaceId === null ? project.workspaceId !== null
      : workspaceId !== undefined && project.workspaceId !== null && project.workspaceId !== workspaceId) return null;
    return { ...project };
  });
  mocks.getAnalyses.mockResolvedValue(analyses);
  mocks.forbidden.mockImplementation(() => { throw new Error("Unexpected DB/model/network/storage/import execution"); });
  mocks.getAdminProject.mockImplementation(() => { throw new Error("Unexpected admin owner bypass"); });
});
afterEach(() => {
  expect(mocks.forbidden).not.toHaveBeenCalled();
  expect(mocks.getAdminProject).not.toHaveBeenCalled();
});

describe("actual analysis.listByProject research selector scope", () => {
  it.each([10, null])("rejects expected workspace %s against authenticated 9 before any repository read", async expectedWorkspaceId => {
    await expect(caller().listByProject({ projectId: 3, expectedWorkspaceId }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expectNoRead();
  });

  it("rejects expected positive workspace against authenticated NULL before any read", async () => {
    await expect(caller({ workspaceId: null }).listByProject({ projectId: 3, expectedWorkspaceId: 9 }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expectNoRead();
  });

  it("passes the authenticated positive workspace and actor to the owner repository", async () => {
    const result = await caller().listByProject({ projectId: 3, expectedWorkspaceId: 9 });
    expect(mocks.getProject).toHaveBeenCalledTimes(1);
    expect(mocks.getProject).toHaveBeenCalledWith(3, 7, 9);
    expect(mocks.getAnalyses).toHaveBeenCalledTimes(1);
    expect(mocks.getAnalyses).toHaveBeenCalledWith(3);
    expect(result).toEqual(analyses);
  });

  it("defensively rejects an explicitly foreign parent even if a repository returns it", async () => {
    mocks.getProject.mockResolvedValue({ ...project, workspaceId: 10 });
    await expect(caller().listByProject({ projectId: 3, expectedWorkspaceId: 9 })).rejects.toThrow();
    expect(mocks.getProject).toHaveBeenCalledWith(3, 7, 9);
    expect(mocks.getAnalyses).not.toHaveBeenCalled();
  });

  it("rejects a missing parent before reading analysis rows", async () => {
    await expect(caller().listByProject({ projectId: 4, expectedWorkspaceId: 9 })).rejects.toThrow();
    expect(mocks.getAnalyses).not.toHaveBeenCalled();
  });

  it.each([9, null])("retains legacy NULL-parent owner access in authenticated workspace %s", async workspaceId => {
    project.workspaceId = null;
    expect(await caller({ workspaceId }).listByProject({ projectId: 3, expectedWorkspaceId: workspaceId })).toEqual(analyses);
    expect(mocks.getProject).toHaveBeenCalledWith(3, 7, workspaceId);
  });

  it.each([9, null])("old callers omitting expected workspace still pass actual scope %s", async workspaceId => {
    project.workspaceId = workspaceId;
    expect(await caller({ workspaceId }).listByProject({ projectId: 3 })).toEqual(analyses);
    expect(mocks.getProject).toHaveBeenCalledWith(3, 7, workspaceId);
  });

  it.each(["ops_specialist", "admin", "super_admin", "designer"])("does not give a non-owner %s a new read bypass", async role => {
    project.workspaceId = null;
    await expect(caller({ id: 8, role }).listByProject({ projectId: 3, expectedWorkspaceId: 9 })).rejects.toThrow();
    expect(mocks.getProject).toHaveBeenCalledWith(3, 8, 9);
    expect(mocks.getAnalyses).not.toHaveBeenCalled();
  });

  it.each(["admin", "super_admin"])("retains existing access for a %s who owns the project", async role => {
    expect(await caller({ role }).listByProject({ projectId: 3, expectedWorkspaceId: 9 })).toEqual(analyses);
    expect(mocks.getProject).toHaveBeenCalledWith(3, 7, 9);
  });

  it("the real protected procedure refuses an unauthenticated caller before reads", async () => {
    await expect(caller({ authenticated: false }).listByProject({ projectId: 3, expectedWorkspaceId: 9 }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expectNoRead();
  });
});
