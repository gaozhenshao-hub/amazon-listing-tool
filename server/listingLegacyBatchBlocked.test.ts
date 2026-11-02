import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectById: vi.fn(),
  getActiveListingByProject: vi.fn(),
  createListing: vi.fn(),
  updateListing: vi.fn(),
  createAiJobRun: vi.fn(),
}));
vi.mock("./domains/listing/repository", async importOriginal => ({
  ...await importOriginal<typeof import("./domains/listing/repository")>(),
  getProjectById: mocks.getProjectById,
  getActiveListingByProject: mocks.getActiveListingByProject,
  createListing: mocks.createListing,
  updateListing: mocks.updateListing,
}));
vi.mock("./domains/ai_os/services/aiJobService", async importOriginal => ({
  ...await importOriginal<typeof import("./domains/ai_os/services/aiJobService")>(),
  createAiJobRun: mocks.createAiJobRun,
}));

import { router } from "./domains/listing/routerContext";
import { listingEditingProcedures } from "./domains/listing/routers/editing";
import { listingGenerationProcedures } from "./domains/listing/routers/generation";
import { listingJobControlProcedures } from "./domains/listing/routers/jobControl";
import { runListingGenerationJob } from "./domains/listing/services/generationJob";

const routes = router({
  generateFull: listingGenerationProcedures.generateFull,
  generateBulletPoints: listingGenerationProcedures.generateBulletPoints,
  confirmPreview: listingEditingProcedures.confirmPreview,
  startGenerationJob: listingJobControlProcedures.startGenerationJob,
});
const caller = () => routes.createCaller({
  user: { id: 7, role: "user" }, workspaceId: 17,
  req: { headers: {} }, res: {},
} as any);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProjectById.mockResolvedValue({ id: 51, userId: 7, workspaceId: 17 });
});

describe("Listing旧整套卖点生成入队门禁", () => {
  it.each([
    ["generateFull", () => caller().generateFull({ projectId: 51 })],
    ["generateBulletPoints", () => caller().generateBulletPoints({ projectId: 51 })],
    ["startGenerationJob/batch", () => caller().startGenerationJob({ projectId: 51, operation: "batch", nodeId: "G1" })],
    ["startGenerationJob/bullets", () => caller().startGenerationJob({ projectId: 51, operation: "bullets", nodeId: "G1" })],
  ])("%s 被拒绝且不创建空正式行或付费任务", async (_label, invoke) => {
    await expect(invoke()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.getActiveListingByProject).not.toHaveBeenCalled();
    expect(mocks.createListing).not.toHaveBeenCalled();
    expect(mocks.updateListing).not.toHaveBeenCalled();
    expect(mocks.createAiJobRun).not.toHaveBeenCalled();
  });

  it("旧五步锁定确认不能把历史草稿伪装为新版正式人审成果", async () => {
    await expect(caller().confirmPreview({ projectId: 51 }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.getActiveListingByProject).not.toHaveBeenCalled();
    expect(mocks.updateListing).not.toHaveBeenCalled();
    expect(mocks.createAiJobRun).not.toHaveBeenCalled();
  });

  it.each(["batch", "bullets"])("历史已排队%s作业在Worker业务查询或模型前被拒绝", async operation => {
    await expect(runListingGenerationJob({ input: { projectId: 51, operation, nodeId: "G1" } } as any, {} as any))
      .rejects.toThrow("Worker拒绝执行模型调用");
    expect(mocks.getProjectById).not.toHaveBeenCalled();
    expect(mocks.updateListing).not.toHaveBeenCalled();
    expect(mocks.createAiJobRun).not.toHaveBeenCalled();
  });
});
