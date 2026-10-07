import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  resolveProjectAccess: vi.fn(),
  resolveSessionAccess: vi.fn(),
  getApprovedImageWorkflowExport: vi.fn(),
}));

vi.mock("./domains/image/routerContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/image/routerContext")>();
  return {
    ...actual,
    resolveProjectAccess: mocks.resolveProjectAccess,
    resolveSessionAccess: mocks.resolveSessionAccess,
  };
});

vi.mock("./domains/image/services/imageWorkflowVersionPolicy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/image/services/imageWorkflowVersionPolicy")>();
  return {
    ...actual,
    getApprovedImageWorkflowExport: mocks.getApprovedImageWorkflowExport,
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
    user: {
      id: 17,
      role,
      openId: "reviewer",
      email: "reviewer@test.local",
      name: "reviewer",
      loginMethod: "manus",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    workspaceId,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function session() {
  return { id: 23, projectId: 51, userId: 17 };
}

function approvedManifest() {
  return {
    schema: "image-workflow-approved-snapshot/1.0" as const,
    workspaceId: 7,
    projectId: 51,
    sessionId: 23,
    manifestDigest: "a".repeat(64),
    sections: Array.from({ length: 7 }, (_, step) => ({
      step: step as 0 | 1 | 2 | 3 | 4 | 5 | 6,
      title: step === 0 ? "Step 0 竞品研究" : `Step ${step} 图片制作`,
      version: 1,
      snapshotDigest: String(step).repeat(64),
      content: { approved: true, step },
      assetDependencies: [],
    })),
  };
}

const missingLedger = () => new TRPCError({ code: "PRECONDITION_FAILED", message: "图片工作流版本快照尚未初始化" });

describe("图片成果下载的真实tRPC服务端边界", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveProjectAccess.mockResolvedValue({ id: 51, userId: 17, workspaceId: 7 });
    mocks.resolveSessionAccess.mockResolvedValue(session());
    mocks.getApprovedImageWorkflowExport.mockRejectedValue(missingLedger());
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

  it.each(["getExportBundle", "exportPdf"] as const)("0206未迁移时两条真实下载路由都失败关闭", async (endpoint) => {
    const caller = callerFactory.createCaller(ctx("super_admin"));
    await expect(endpoint === "getExportBundle" ? caller.getExportBundle({ projectId: 51 }) : caller.exportPdf({ projectId: 51 }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.getApprovedImageWorkflowExport).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 7,
      projectId: 51,
      sessionId: 23,
      actorId: 17,
      actorRole: "super_admin",
    }));
  });

  it("未确认或草稿链由版本账本拒绝时，旧会话字段不能成为导出回退", async () => {
    mocks.resolveSessionAccess.mockResolvedValue({
      ...session(),
      step0Confirmed: 1,
      step1Confirmed: 1,
      step2Confirmed: 1,
      step3Confirmed: 1,
      step4Confirmed: 1,
      step5Confirmed: 1,
      step6Confirmed: 1,
      step5UserEdit: JSON.stringify({ untrustedDraft: true }),
    });
    mocks.getApprovedImageWorkflowExport.mockRejectedValue(new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Step 5 已进入草稿、解锁或重置状态",
    }));
    const caller = callerFactory.createCaller(ctx("super_admin"));
    await expect(caller.getExportBundle({ projectId: 51 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(caller.exportPdf({ projectId: 51 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("仅返回七段不可变清单，PDF兼容字段也来自清单而非旧会话", async () => {
    const manifest = approvedManifest();
    mocks.resolveSessionAccess.mockResolvedValue({
      ...session(),
      step5UserEdit: JSON.stringify({ untrustedDraft: true }),
      step5AiResult: JSON.stringify({ oldModelOutput: true }),
    });
    mocks.getApprovedImageWorkflowExport.mockResolvedValue(manifest);
    const caller = callerFactory.createCaller(ctx("super_admin"));
    const bundle = await caller.getExportBundle({ projectId: 51 });
    expect(bundle).toEqual({ approved: manifest, expressionGroups: [], asinReferenceSets: [] });
    expect(JSON.stringify(bundle)).not.toContain("untrustedDraft");
    expect(JSON.stringify(bundle)).not.toContain("oldModelOutput");

    const pdf = await caller.exportPdf({ projectId: 51 });
    expect(pdf.approved).toEqual(manifest);
    expect(pdf.en).toEqual({ approved: true, step: 5 });
    expect(pdf.sellingPoints).toEqual({ approved: true, step: 1 });
    expect(pdf.references).toEqual({ approved: true, step: 4 });
  });
});
