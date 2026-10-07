import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  resolveProjectAccess: vi.fn(),
  resolveSessionAccess: vi.fn(),
  getExpressionGroupsByProject: vi.fn(),
}));
vi.mock("./domains/image/routerContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/image/routerContext")>();
  return {
    ...actual,
    resolveProjectAccess: mocks.resolveProjectAccess,
    resolveSessionAccess: mocks.resolveSessionAccess,
    db: { ...actual.db, getExpressionGroupsByProject: mocks.getExpressionGroupsByProject },
  };
});

import { router } from "./_core/trpc";
import { imageSessionProcedures } from "./domains/image/routers/sessions";
import { imageKnowledgeExportProcedures } from "./domains/image/routers/knowledgeExport";

const callerFactory = router({
  getExportBundle: imageSessionProcedures.getExportBundle,
  exportPdf: imageKnowledgeExportProcedures.exportPdf,
});

function ctx(role: "user" | "admin" | "super_admin", workspaceId = 7): TrpcContext {
  return {
    user: { id: 17, role, openId: "reviewer", email: "reviewer@test.local", name: "reviewer",
      loginMethod: "manus", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    workspaceId,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

const json = (data: unknown) => JSON.stringify(data);
function approvedSession() {
  return {
    id: 23, projectId: 51, userId: 17, step0Confirmed: 1, step0UserEdit: json({ overallSummary: "approved research" }),
    step1Confirmed: 1, step1UserEdit: json({ coreSellingPoints: [{ point: "fact" }] }),
    step2Confirmed: 1, step2UserEdit: json({ images: [{ imageLabel: "main" }] }),
    step3Confirmed: 1, step3UserEdit: json({ selectedStyles: [{ name: "neutral" }] }),
    step4Confirmed: 1, step4UserEdit: json({ imageReferences: [{ imageLabel: "main" }] }),
    step5Confirmed: 1, step5UserEdit: json({ mainImage: { title: "confirmed" }, secondaryImages: [] }),
    step5AiResult: json({ mainImage: { title: "unapproved AI" } }), step5DesignerUploads: "[]",
    step6Confirmed: 1, step6UserEdit: json({ prompts: [{ target: "main", englishPrompt: "reviewed" }] }),
  };
}

describe("图片成果下载的真实tRPC服务端边界", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveProjectAccess.mockResolvedValue({ id: 51, userId: 17, workspaceId: 7 });
    mocks.resolveSessionAccess.mockResolvedValue(approvedSession());
    mocks.getExpressionGroupsByProject.mockResolvedValue([]);
  });

  it.each(["getExportBundle", "exportPdf"] as const)("普通管理员无法直接调用%s", async (endpoint) => {
    const caller = callerFactory.createCaller(ctx("admin"));
    await expect(endpoint === "getExportBundle" ? caller.getExportBundle({ projectId: 51 }) : caller.exportPdf({ projectId: 51 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.resolveSessionAccess).not.toHaveBeenCalled();
  });

  it.each(["getExportBundle", "exportPdf"] as const)("跨工作空间的超管仍不能调用%s", async (endpoint) => {
    const caller = callerFactory.createCaller(ctx("super_admin", 8));
    await expect(endpoint === "getExportBundle" ? caller.getExportBundle({ projectId: 51 }) : caller.exportPdf({ projectId: 51 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.resolveSessionAccess).not.toHaveBeenCalled();
  });

  it("没有确认Step5时两条下载接口都失败关闭", async () => {
    mocks.resolveSessionAccess.mockResolvedValue({ ...approvedSession(), step5Confirmed: 0 });
    const caller = callerFactory.createCaller(ctx("super_admin"));
    await expect(caller.getExportBundle({ projectId: 51 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(caller.exportPdf({ projectId: 51 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("仅Step5已确认但Step6尚未确认时，旧PDF也不得绕过最终成果审批", async () => {
    mocks.resolveSessionAccess.mockResolvedValue({ ...approvedSession(), step6Confirmed: 0 });
    const caller = callerFactory.createCaller(ctx("super_admin"));
    await expect(caller.getExportBundle({ projectId: 51 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(caller.exportPdf({ projectId: 51 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("历史已确认Step4含未分类知识库图时，两种成果下载都拒绝", async () => {
    mocks.resolveSessionAccess.mockResolvedValue({ ...approvedSession(),
      step4UserEdit: json({ imageReferences: [{ imageNumber: "main", kbReferenceImages: [{ id: 77, imageUrl: "https://competitor.invalid/research.jpg" }] }] }),
    });
    const caller = callerFactory.createCaller(ctx("super_admin"));
    await expect(caller.getExportBundle({ projectId: 51 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(caller.exportPdf({ projectId: 51 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("完整导出只返回已确认版本，旧设计师URL不可被夹带", async () => {
    mocks.getExpressionGroupsByProject.mockResolvedValueOnce([
      { expressionName: "Product context", confirmed: 1, userEdit: json({ observation: "approved research" }),
        images: [{ imageUrl: "https://competitor.invalid/not-our-product.jpg" }] },
    ]);
    const caller = callerFactory.createCaller(ctx("super_admin"));
    const bundle = await caller.getExportBundle({ projectId: 51 });
    expect(bundle.session.step5UserEdit).toContain("confirmed");
    expect(bundle.session.step5AiResult).toBeUndefined();
    expect(bundle.asinReferenceSets).toHaveLength(0);
    expect(bundle.expressionGroups[0].images).toHaveLength(0);
    expect(JSON.stringify(bundle)).not.toContain("competitor.invalid");
    expect((await caller.exportPdf({ projectId: 51 })).en).toContain("confirmed");
    mocks.resolveSessionAccess.mockResolvedValue({ ...approvedSession(), step5DesignerUploads: json([{ imageUrl: "https://unverified.test/pic" }]) });
    await expect(caller.getExportBundle({ projectId: 51 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
