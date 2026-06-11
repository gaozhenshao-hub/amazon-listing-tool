import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock the database module
vi.mock("./db", () => ({
  getProjectsByUser: vi.fn().mockResolvedValue([
    {
      id: 1,
      userId: 1,
      name: "Test Project",
      brand: "TestBrand",
      productName: "Test Product",
      category: "Furniture",
      targetMarket: "US",
      productFeatures: "Feature 1\nFeature 2",
      productSpecs: "Size: 100x50cm",
      status: "draft",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]),
  getProjectById: vi.fn().mockImplementation(async (id: number, userId: number) => {
    if (id === 1 && userId === 1) {
      return {
        id: 1,
        userId: 1,
        name: "Test Project",
        brand: "TestBrand",
        productName: "Test Product",
        category: "Furniture",
        targetMarket: "US",
        productFeatures: "Feature 1\nFeature 2",
        productSpecs: "Size: 100x50cm",
        status: "draft",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
    return null;
  }),
  createProject: vi.fn().mockImplementation(async (data: any) => ({
    id: 2,
    ...data,
    status: "draft",
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  updateProject: vi.fn().mockImplementation(async (id: number, userId: number, data: any) => ({
    id,
    userId,
    name: "Updated Project",
    ...data,
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  deleteProject: vi.fn().mockResolvedValue({ success: true }),
  getCompetitorAnalysesByProject: vi.fn().mockResolvedValue([]),
  getActiveListingByProject: vi.fn().mockResolvedValue(null),
  getListingsByProject: vi.fn().mockResolvedValue([]),
  getImageAnalysesByProject: vi.fn().mockResolvedValue([]),
  createCompetitorAnalysis: vi.fn().mockResolvedValue({ id: 1 }),
  deleteCompetitorAnalysis: vi.fn().mockResolvedValue({ success: true }),
  createListing: vi.fn().mockResolvedValue({ id: 1 }),
  updateListing: vi.fn().mockResolvedValue({ id: 1 }),
  upsertUser: vi.fn(),
  getUserByOpenId: vi.fn(),
}));

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
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
      caller.analysis.analyzeAsin({
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

