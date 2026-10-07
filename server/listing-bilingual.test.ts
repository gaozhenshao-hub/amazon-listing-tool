import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

// Mock invokeLLM
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

// Mock db functions
vi.mock("./repositories", () => ({
  getProjectById: vi.fn(),
  getCompetitorAnalysesByProject: vi.fn(),
  getListingsByProject: vi.fn(),
  getActiveListingByProject: vi.fn(),
  createListing: vi.fn(),
  updateListing: vi.fn(),
  updateProject: vi.fn(),
  getListingById: vi.fn(),
  getLatestListingVersionNumber: vi.fn().mockResolvedValue(0),
  createListingVersion: vi.fn().mockResolvedValue({ id: 1 }),
}));

import { invokeLLM } from "./_core/llm";
import * as db from "./repositories";

const mockedInvokeLLM = vi.mocked(invokeLLM);
const mockedDb = vi.mocked(db);

function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-123",
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
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("listing.translateToChinese", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects the legacy direct-translation route before any model call or formal Listing write", async () => {
    const caller = appRouter.createCaller(createAuthContext());
    mockedDb.getProjectById.mockResolvedValue({ id: 1, userId: 1, workspaceId: null } as any);
    await expect(caller.listing.translateToChinese({ projectId: 1 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mockedInvokeLLM).not.toHaveBeenCalled();
    expect(mockedDb.updateListing).not.toHaveBeenCalled();
    expect(mockedDb.getActiveListingByProject).not.toHaveBeenCalled();
  });

  it("should throw error when no active listing exists", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    mockedDb.getProjectById.mockResolvedValue({
      id: 1,
      name: "Test Product",
      userId: 1,
    } as any);

    mockedDb.getActiveListingByProject.mockResolvedValue(null);

    await expect(
      caller.listing.translateToChinese({ projectId: 1 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mockedDb.getActiveListingByProject).not.toHaveBeenCalled();
  });

  it("should throw error when project not found", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    mockedDb.getProjectById.mockResolvedValue(null);

    await expect(
      caller.listing.translateToChinese({ projectId: 999 })
    ).rejects.toThrow("Project not found");
  });
});

describe("listing.update with Chinese fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should accept Chinese fields in update mutation", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    mockedDb.updateListing.mockResolvedValue({
      id: 10,
      titleCn: "更新后的中文标题",
      descriptionCn: "更新后的中文描述",
    } as any);

    const result = await caller.listing.update({
      id: 10,
      titleCn: "更新后的中文标题",
      descriptionCn: "更新后的中文描述",
    });

    expect(mockedDb.updateListing).toHaveBeenCalledWith(10, expect.objectContaining({
      titleCn: "更新后的中文标题",
      descriptionCn: "更新后的中文描述",
    }));
  });
});
