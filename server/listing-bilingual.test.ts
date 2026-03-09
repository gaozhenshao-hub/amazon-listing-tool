import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

// Mock invokeLLM
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

// Mock db functions
vi.mock("./db", () => ({
  getProjectById: vi.fn(),
  getCompetitorAnalysesByProject: vi.fn(),
  getListingsByProject: vi.fn(),
  getActiveListingByProject: vi.fn(),
  createListing: vi.fn(),
  updateListing: vi.fn(),
  updateProject: vi.fn(),
}));

import { invokeLLM } from "./_core/llm";
import * as db from "./db";

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

  it("should translate an existing listing to Chinese", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Mock project
    mockedDb.getProjectById.mockResolvedValue({
      id: 1,
      name: "Test Product",
      productName: "Test Widget",
      brand: "TestBrand",
      category: "Electronics",
      userId: 1,
      targetMarket: "US",
      status: "completed",
      createdAt: new Date(),
      updatedAt: new Date(),
      productFeatures: null,
      targetAudience: null,
      priceRange: null,
      competitorAsins: null,
    } as any);

    // Mock active listing
    mockedDb.getActiveListingByProject.mockResolvedValue({
      id: 10,
      projectId: 1,
      title: "Test Widget - Premium Quality Electronic Device for Home Use",
      bulletPoints: JSON.stringify([
        { subtitle: "PREMIUM QUALITY", fullText: "Made with the finest materials for lasting durability" },
        { subtitle: "EASY TO USE", fullText: "Simple setup in minutes with no tools required" },
      ]),
      description: "<p>This is a great product description.</p>",
      searchTerms: "widget electronic device home premium quality",
      imageAdvice: "{}",
      titleCn: null,
      bulletPointsCn: null,
      descriptionCn: null,
      searchTermsCn: null,
      version: 1,
      isActive: 1,
      createdAt: new Date(),
    } as any);

    // Mock LLM response for Chinese translation
    mockedInvokeLLM.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            titleCn: "测试小部件 - 家用优质电子设备",
            bulletPointsCn: [
              { subtitle: "优质品质", fullText: "采用最优质的材料制造，经久耐用" },
              { subtitle: "易于使用", fullText: "无需工具，几分钟即可轻松安装" },
            ],
            descriptionCn: "<p>这是一个很好的产品描述。</p>",
            searchTermsCn: "小部件 电子设备 家用 优质",
          }),
          role: "assistant",
        },
        index: 0,
        finish_reason: "stop",
      }],
    } as any);

    // Mock updateListing
    mockedDb.updateListing.mockResolvedValue({
      id: 10,
      projectId: 1,
      title: "Test Widget - Premium Quality Electronic Device for Home Use",
      titleCn: "测试小部件 - 家用优质电子设备",
      bulletPointsCn: JSON.stringify([
        { subtitle: "优质品质", fullText: "采用最优质的材料制造，经久耐用" },
        { subtitle: "易于使用", fullText: "无需工具，几分钟即可轻松安装" },
      ]),
      descriptionCn: "<p>这是一个很好的产品描述。</p>",
      searchTermsCn: "小部件 电子设备 家用 优质",
    } as any);

    const result = await caller.listing.translateToChinese({ projectId: 1 });

    expect(result.titleCn).toBe("测试小部件 - 家用优质电子设备");
    expect(result.bulletPointsCn).toHaveLength(2);
    expect(result.bulletPointsCn[0].subtitle).toBe("优质品质");
    expect(result.descriptionCn).toContain("产品描述");
    expect(result.searchTermsCn).toContain("小部件");

    // Verify LLM was called with Chinese translation prompt (text + image advice = 2 calls)
    expect(mockedInvokeLLM).toHaveBeenCalledTimes(2);
    const llmCall = mockedInvokeLLM.mock.calls[0][0];
    expect(llmCall.messages[0].content).toContain("Translate");

    // Verify updateListing was called with Chinese fields
    expect(mockedDb.updateListing).toHaveBeenCalledWith(10, expect.objectContaining({
      titleCn: "测试小部件 - 家用优质电子设备",
      descriptionCn: expect.any(String),
      searchTermsCn: expect.any(String),
    }));
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
    ).rejects.toThrow("No active listing found");
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
