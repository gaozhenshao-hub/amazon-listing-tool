import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runSkill: vi.fn(), validate: vi.fn(), resolveProject: vi.fn(), ensureWrite: vi.fn(), getFiles: vi.fn(),
}));

vi.mock("./domains/listing/routerContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/listing/routerContext")>();
  const { initTRPC, TRPCError } = await import("@trpc/server");
  const { z } = await import("zod");
  const t = initTRPC.context<{ user: { id: number; role: string }; workspaceId: number }>().create();
  return {
    ...actual,
    protectedProcedure: t.procedure, router: t.router, TRPCError, z,
    MAX_RETRIES: 2, db: { getCompetitorAnalysesByProject: vi.fn().mockResolvedValue([]), getProjectFilesByProject: mocks.getFiles },
    resolveProjectAccess: mocks.resolveProject, ensureWriteAccess: mocks.ensureWrite,
    loadEnrichedData: vi.fn().mockResolvedValue({ productAttributes: { shell: "Padded shell" } }),
    buildProductContext: () => "已确认产品属性：Padded shell",
    runEmperorSkill: mocks.runSkill, parseJsonOrThrow: JSON.parse,
  };
});
vi.mock("./domains/listing/routers/jobControl", () => ({ startListingJobForContext: vi.fn() }));
vi.mock("./domains/listing/services/generationJob", () => ({ validateSingleBulletQuality: mocks.validate }));

import { router } from "./domains/listing/routerContext";
import { listingEditingProcedures } from "./domains/listing/routers/editing";

const candidate = {
  subtitle: "Everyday Travel Protection:",
  fullText: "This padded shell lets you carry a small device apart from other items in your bag while moving between stops, with a clear view of where the device sits as you reach for it during a normal day of travel",
  evidenceUsed: ["Padded shell"], keywordsUsed: [], distinctFromPrevious: "Travel protection",
  qualityAudit: { factsGrounded: true },
};
const input = {
  projectId: 1,
  sellingPoint: { index: 0, theme: "Protection", description: "Padded shell" },
  currentBullet: { subtitle: "Travel Protection:", fullText: "Original copy about a padded shell" },
  previousBullets: [{ subtitle: "Easy Storage:", fullText: "Other supported benefit" }],
  optimizationNote: "Make this fluent American English without adding unsupported claims",
};
const caller = router({ optimizeSingleBullet: listingEditingProcedures.optimizeSingleBullet })
  .createCaller({ user: { id: 7, role: "admin" }, workspaceId: 12 });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveProject.mockResolvedValue({ id: 1, workspaceId: 12 });
  mocks.getFiles.mockResolvedValue([]);
  mocks.runSkill.mockResolvedValue({ parsed: candidate });
  mocks.validate.mockReturnValue({ valid: true, issues: [], characterCount: 220 });
});

describe("卖点优化v6实际路由（无模型/数据库外呼）", () => {
  it("只调用分步骤权威Skill、沿用同一质量门禁，返回人工候选", async () => {
    const result = await caller.optimizeSingleBullet(input);
    expect(mocks.runSkill).toHaveBeenCalledOnce();
    expect(mocks.runSkill.mock.calls[0][0]).toMatchObject({
      skillSlug: "listing.bullet.step.generate", userId: 7, workspaceId: 12,
      variables: { sellingPoint: input.sellingPoint, currentBullet: input.currentBullet, previousBullets: input.previousBullets },
    });
    expect(mocks.validate.mock.calls[0][1].previousBullets).toEqual(input.previousBullets);
    expect(result).toMatchObject({ subtitle: candidate.subtitle, characterCount: 220, inRange: true });
  });

  it("门禁首次失败后重写一次，再次校验；不调用旧refine Skill", async () => {
    mocks.validate.mockReturnValueOnce({ valid: false, issues: ["无依据数字"], characterCount: 220 });
    await caller.optimizeSingleBullet(input);
    expect(mocks.runSkill).toHaveBeenCalledTimes(2);
    expect(mocks.runSkill.mock.calls[1][0].context).toContain("无依据数字");
    expect(mocks.runSkill.mock.calls.every(([call]) => call.skillSlug === "listing.bullet.step.generate")).toBe(true);
  });

  it("候选与原文相同，即使模型自评通过也必须重写", async () => {
    mocks.runSkill.mockResolvedValueOnce({ parsed: { ...candidate, ...input.currentBullet } });
    await caller.optimizeSingleBullet(input);
    expect(mocks.runSkill).toHaveBeenCalledTimes(2);
    expect(mocks.runSkill.mock.calls[1][0].context).toContain("候选与当前待优化原文相同");
  });

  it("连续不合格时最多三次并失败关闭；没有获得项目权限不得调用模型", async () => {
    mocks.validate.mockReturnValue({ valid: false, issues: ["证据不足"], characterCount: 220 });
    await expect(caller.optimizeSingleBullet(input)).rejects.toThrow(/证据不足.*原文未改动/);
    expect(mocks.runSkill).toHaveBeenCalledTimes(3);
    mocks.resolveProject.mockResolvedValueOnce(null);
    await expect(caller.optimizeSingleBullet(input)).rejects.toThrow("项目不存在");
    expect(mocks.runSkill).toHaveBeenCalledTimes(3);
    mocks.resolveProject.mockResolvedValueOnce({ id: 1, workspaceId: 13 });
    await expect(caller.optimizeSingleBullet(input)).rejects.toThrow("Project not found");
    expect(mocks.runSkill).toHaveBeenCalledTimes(3);
  });

  it("核心只有示例值时不调用模型；有效核心的示例字段会在入模前移除", async () => {
    await expect(caller.optimizeSingleBullet({ ...input, sellingPoint: {
      ...input.sellingPoint, description: "功率：[如：1200W]",
    } })).rejects.toThrow(/缺少真实产品事实/);
    expect(mocks.runSkill).not.toHaveBeenCalled();
    await caller.optimizeSingleBullet({ ...input, sellingPoint: {
      ...input.sellingPoint, description: "功率：[如：1200W]",
      fabeDirection: { feature: "Padded shell", advantage: "", benefit: "", evidence: "[ ]" },
    } });
    expect(mocks.runSkill).toHaveBeenCalledOnce();
    const call = mocks.runSkill.mock.calls[0][0];
    expect(JSON.stringify(call.variables)).not.toContain("1200W");
    expect(call.context).not.toContain("1200W");
    expect(call.variables.sellingPoint.fabeDirection.feature).toBe("Padded shell");
  });

  it("旧草案含示例规格时需要人工先改正，而不是交给优化Skill再猜", async () => {
    await expect(caller.optimizeSingleBullet({ ...input, currentBullet: {
      subtitle: "Power:", fullText: "A synthetic note with [e.g. 1200W] as the wattage",
    } })).rejects.toThrow(/当前草案含示例/);
    expect(mocks.runSkill).not.toHaveBeenCalled();
  });

  it("原始表中的示例数值被AI分析误提成事实时，优化入口仍在调用前拒绝", async () => {
    mocks.getFiles.mockResolvedValueOnce([{
      fileType: "product_attributes", status: "completed", analysisResult: "{}", rawContent: "功率：[如：1200W]",
    }]);
    await expect(caller.optimizeSingleBullet({ ...input, sellingPoint: {
      ...input.sellingPoint, description: "1200W motor", fabeDirection: { feature: "Padded shell", advantage: "", benefit: "", evidence: "1200W" },
    } })).rejects.toThrow(/原始上传表中的示例值/);
    expect(mocks.runSkill).not.toHaveBeenCalled();
  });
});
