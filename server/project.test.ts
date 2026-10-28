import { beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { competitorRevision } from "./repositories/project/competitorWritePolicy";

const io = vi.hoisted(() => {
  const now = new Date("2026-10-16T00:00:00Z");
  const project = {
    id: 1, workspaceId: null as number | null, userId: 1, name: "Test Project", brand: "TestBrand",
    productName: "Test Product", category: "Furniture", targetMarket: "US", productFeatures: "Feature 1\nFeature 2",
    productSpecs: "Size: 100x50cm", status: "draft" as const, createdAt: now, updatedAt: now,
  };
  const analysis = {
    id: 1, projectId: 1, asin: "B000000001", title: "Synthetic saved competitor", bulletPoints: '["Saved bullet"]',
    imageUrls: null, price: null, rating: null, reviewCount: null, reviewAnalysis: null, keywords: null,
    rawData: "{}", aiSummary: "Synthetic AI candidate", summary: "Synthetic saved summary", summaryStatus: "draft" as const,
    summaryVersion: 1, summaryConfirmedBy: null, summaryConfirmedAt: null, createdAt: now, updatedAt: now,
  };
  return { project, analysis, getProject: vi.fn(), getAnalysis: vi.fn(), deleteAnalysis: vi.fn(), unexpectedDb: vi.fn(),
    projectList: vi.fn(), createProject: vi.fn(), updateProject: vi.fn(), deleteProject: vi.fn() };
});

// Keep the actual router and review service. Replace only their real repository
// I/O seams (the new review service intentionally does not use the old barrel).
vi.mock("./repositories/project/projectRepository", async importOriginal => ({
  ...await importOriginal<typeof import("./repositories/project/projectRepository")>(),
  getProjectById: io.getProject,
}));
vi.mock("./repositories/project/projectAssetRepository", async importOriginal => ({
  ...await importOriginal<typeof import("./repositories/project/projectAssetRepository")>(),
  getCompetitorAnalysisById: io.getAnalysis, getPersistedCompetitorAnalysisById: io.getAnalysis,
  deleteCompetitorAnalysis: io.deleteAnalysis,
}));
vi.mock("./repositories/dbClient", async importOriginal => ({
  ...await importOriginal<typeof import("./repositories/dbClient")>(),
  getDb: io.unexpectedDb, requireDb: io.unexpectedDb, withDbTransaction: io.unexpectedDb,
}));
vi.mock("./repositories", async importOriginal => ({
  ...await importOriginal<typeof import("./repositories")>(),
  getProjectsByUser: io.projectList, getProjectById: io.getProject,
  createProject: io.createProject, updateProject: io.updateProject, deleteProject: io.deleteProject,
  getCompetitorAnalysesByProject: vi.fn().mockResolvedValue([]), getCompetitorAnalysisById: io.getAnalysis, getPersistedCompetitorAnalysisById: io.getAnalysis,
  deleteCompetitorAnalysis: io.deleteAnalysis, createCompetitorAnalysis: vi.fn().mockResolvedValue({ id: 1 }),
  getActiveListingByProject: vi.fn().mockResolvedValue(null), getListingsByProject: vi.fn().mockResolvedValue([]),
  getImageAnalysesByProject: vi.fn().mockResolvedValue([]), createListing: vi.fn().mockResolvedValue({ id: 1 }),
  updateListing: vi.fn().mockResolvedValue({ id: 1 }), upsertUser: vi.fn(), getUserByOpenId: vi.fn(),
}));
vi.mock("./repositories/listing", async importOriginal => ({
  ...await importOriginal<typeof import("./repositories/listing")>(),
  getActiveListingByProject: vi.fn().mockResolvedValue(null), getListingsByProject: vi.fn().mockResolvedValue([]),
  createListing: vi.fn().mockResolvedValue({ id: 1 }), updateListing: vi.fn().mockResolvedValue({ id: 1 }),
}));
vi.mock("./repositories/project", async importOriginal => ({
  ...await importOriginal<typeof import("./repositories/project")>(),
  getAllProjects: vi.fn().mockResolvedValue([]), getProjectsByUser: io.projectList,
  getProjectById: io.getProject, getProjectByIdAdmin: vi.fn().mockResolvedValue(null),
  createProject: io.createProject, updateProject: io.updateProject, deleteProject: io.deleteProject,
}));
vi.mock("./services/securityGovernance", async importOriginal => ({
  ...await importOriginal<typeof import("./services/securityGovernance")>(),
  actorFromContext: vi.fn((ctx: TrpcContext) => ctx.user),
  hasResourceAction: vi.fn().mockResolvedValue(true),
  assertResourceAction: vi.fn().mockResolvedValue(undefined),
  recordSecurityAuditLog: vi.fn().mockResolvedValue(undefined),
  workspaceIdFromContext: vi.fn((ctx: TrpcContext) => ctx.workspaceId !== undefined ? ctx.workspaceId : ctx.user?.defaultWorkspaceId),
}));

beforeEach(() => {
  vi.clearAllMocks(); io.project.workspaceId = null;
  io.getProject.mockImplementation(async (id: number, userId: number, workspaceId?: number | null) =>
    id === io.project.id && userId === io.project.userId
      && (workspaceId === undefined || io.project.workspaceId === null || workspaceId === io.project.workspaceId) ? { ...io.project } : null);
  io.getAnalysis.mockImplementation(async (id: number) => id === io.analysis.id ? { ...io.analysis } : null);
  io.deleteAnalysis.mockResolvedValue({ success: true });
  io.projectList.mockResolvedValue([{ ...io.project }]);
  io.createProject.mockImplementation(async data => ({ ...io.project, id: 2, ...data }));
  io.updateProject.mockImplementation(async (id: number, userId: number, data: unknown) => ({ ...io.project, id, userId, ...(data as object) }));
  io.deleteProject.mockResolvedValue({ success: true });
  io.unexpectedDb.mockRejectedValue(new Error("UNEXPECTED_TEST_DATABASE_IO"));
});

function createAuthContext(workspaceId: number | null = null, userId = 1): TrpcContext {
  const user: NonNullable<TrpcContext["user"]> = {
    id: userId, openId: "synthetic-test-user", organizationId: null, defaultWorkspaceId: workspaceId,
    email: "synthetic@example.test", name: "Synthetic Test User", phone: null, password: null,
    loginMethod: "manus", role: "ops_specialist", department: null, jobTitle: null, status: "active",
    mustChangePassword: 0, failedLoginAttempts: 0, lockedUntil: null, invitedBy: null, lastPasswordChangedAt: null,
    createdAt: new Date("2026-10-16T00:00:00Z"), updatedAt: new Date("2026-10-16T00:00:00Z"), lastSignedIn: new Date("2026-10-16T00:00:00Z"),
  };
  return { user, workspaceId, req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"] };
}

describe("project router", () => {
  it("lists projects for authenticated user", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.project.list();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Test Project");
    expect(result[0].brand).toBe("TestBrand");
  });

  it("gets project by id", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.project.getById({ id: 1 });

    expect(result.id).toBe(1);
    expect(result.name).toBe("Test Project");
    expect(result.targetMarket).toBe("US");
  });

  it("throws error for non-existent project", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.project.getById({ id: 999 })).rejects.toThrow("Project not found");
  });

  it("creates a new project", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.project.create({
      name: "New Project",
      brand: "NewBrand",
      productName: "New Product",
      category: "Electronics",
      targetMarket: "US",
    });

    expect(result.id).toBe(2);
    expect(result.name).toBe("New Project");
    expect(result.brand).toBe("NewBrand");
  });

  it("validates project name is required", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.project.create({ name: "" })
    ).rejects.toThrow();
  });

  it("deletes a project", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.project.delete({ id: 1 });

    expect(result.success).toBe(true);
  });
});

describe("analysis router", () => {
  it("lists analyses for a project", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.analysis.listByProject({ projectId: 1 });

    expect(result).toEqual([]);
  });

  it("throws error for non-existent project", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.analysis.listByProject({ projectId: 999 })
    ).rejects.toThrow("Project not found");
  });

  it("validates ASIN format", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.analysis.collectAsin({
        projectId: 1,
        asin: "SHORT",
      })
    ).rejects.toThrow();
  });

  it("deletes an analysis", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.analysis.delete({ id: 1 });

    expect(result.success).toBe(true);
  });

  it.each([null, 9])("analysis delete carries the exact authenticated %s workspace and persisted-row revision into the repository guard", async workspaceId => {
    io.project.workspaceId = workspaceId;
    const caller = appRouter.createCaller(createAuthContext(workspaceId));
    expect(await caller.analysis.delete({ id: 1 })).toEqual({ success: true });
    expect(io.getProject).toHaveBeenCalledWith(1, 1, workspaceId);
    expect(io.getAnalysis).toHaveBeenCalledTimes(1);
    expect(io.deleteAnalysis).toHaveBeenCalledOnce();
    expect(io.deleteAnalysis).toHaveBeenCalledWith(1, { projectId: 1, userId: 1, workspaceId, expectedRevision: competitorRevision(io.analysis) });
    expect(io.unexpectedDb).not.toHaveBeenCalled();
  });

  it("a nonowner cannot delete an existing competitor through the real route/service", async () => {
    const caller = appRouter.createCaller(createAuthContext(null, 2));
    await expect(caller.analysis.delete({ id: 1 })).rejects.toThrow("Project not found");
    expect(io.getProject).toHaveBeenCalledWith(1, 2, null); expect(io.deleteAnalysis).not.toHaveBeenCalled();
    expect(io.unexpectedDb).not.toHaveBeenCalled();
  });

  it("the owner cannot delete a competitor under a different explicit workspace", async () => {
    io.project.workspaceId = 9;
    const caller = appRouter.createCaller(createAuthContext(11));
    await expect(caller.analysis.delete({ id: 1 })).rejects.toThrow("Project not found");
    expect(io.getProject).toHaveBeenCalledWith(1, 1, 11); expect(io.deleteAnalysis).not.toHaveBeenCalled();
    expect(io.unexpectedDb).not.toHaveBeenCalled();
  });

  it("missing authenticated workspace is not silently converted to the legacy NULL delete scope", async () => {
    const ctx = createAuthContext(); ctx.workspaceId = undefined; ctx.user!.defaultWorkspaceId = undefined as unknown as null;
    const caller = appRouter.createCaller(ctx);
    await expect(caller.analysis.delete({ id: 1 })).rejects.toThrow("工作区信息不完整");
    expect(io.getAnalysis).not.toHaveBeenCalled(); expect(io.getProject).not.toHaveBeenCalled(); expect(io.deleteAnalysis).not.toHaveBeenCalled();
    expect(io.unexpectedDb).not.toHaveBeenCalled();
  });
});

describe("listing router", () => {
  it("gets active listing for a project", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.listing.getActive({ projectId: 1 });

    expect(result).toBeNull();
  });

  it("lists listings for a project", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.listing.listByProject({ projectId: 1 });

    expect(result).toEqual([]);
  });

  it("throws error for non-existent project listing", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.listing.getActive({ projectId: 999 })
    ).rejects.toThrow("Project not found");
  });
});
