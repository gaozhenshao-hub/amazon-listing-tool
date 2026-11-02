import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({
  project: vi.fn(), active: vi.fn(), create: vi.fn(), update: vi.fn(), invoke: vi.fn(),
}));
vi.mock("./domains/listing/repository", async importOriginal => ({
  ...await importOriginal<typeof import("./domains/listing/repository")>(),
  getProjectById: mocks.project,
  getActiveListingByProject: mocks.active,
  createListing: mocks.create,
  updateListing: mocks.update,
}));
vi.mock("./_core/llm", async importOriginal => ({
  ...await importOriginal<typeof import("./_core/llm")>(),
  invokeLLM: mocks.invoke,
}));
vi.mock("./domains/listing/routers/jobControl", () => ({ startListingJobForContext: vi.fn() }));
vi.mock("./domains/listing/listingAgentBridge", async importOriginal => ({
  ...await importOriginal<typeof import("./domains/listing/listingAgentBridge")>(),
  syncGenerationToAgent: vi.fn(),
}));

import { router } from "./domains/listing/routerContext";
import { listingGenerationProcedures } from "./domains/listing/routers/generation";

const directPublishRouter = router({ translateToChinese: listingGenerationProcedures.translateToChinese });
const caller = (id: number) => directPublishRouter.createCaller({
  user: { id, role: "user" }, workspaceId: 17,
  req: { headers: {} }, res: {},
} as any);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.project.mockResolvedValue({ id: 51, userId: 7, workspaceId: 17 });
});

describe("Listing旧AI直接发布入口", () => {
  it("拒绝授权用户的旧一键翻译，不调用模型或覆盖正式行", async () => {
    await expect(caller(7).translateToChinese({ projectId: 51 }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.active).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("跨项目用户在授权边界被拦截，绝不进入Listing查询", async () => {
    await expect(caller(8).translateToChinese({ projectId: 51 })).rejects.toThrow();
    expect(mocks.active).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("旧全量同步实现不再含正式Listing创建或模型直发处理器", () => {
    const source = readFileSync(resolve(import.meta.dirname, "domains/listing/routers/generation.ts"), "utf8");
    expect(source).toContain("旧全量AI入口会绕过事实、候选人审和完整快照");
    expect(source).not.toMatch(/db\.createListing\(\{[\s\S]*?bulletPoints:\s*JSON\.stringify\(bulletData/u);
  });
});
