import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  resolveProjectAccess: vi.fn(),
  resolveSessionAccess: vi.fn(),
  resolveSessionForExecution: vi.fn(),
  ensureWriteAccess: vi.fn(),
  invalidate: vi.fn(),
  latestStep4Job: vi.fn(),
  cancelAiJob: vi.fn(),
  getAiJobRun: vi.fn(),
  getApprovedExport: vi.fn(),
}));

vi.mock("./domains/image/routerContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/image/routerContext")>();
  return {
    ...actual,
    resolveProjectAccess: mocks.resolveProjectAccess,
    resolveSessionAccess: mocks.resolveSessionAccess,
    resolveSessionForExecution: mocks.resolveSessionForExecution,
    ensureWriteAccess: mocks.ensureWriteAccess,
    invalidateImageWorkflowStages: mocks.invalidate,
  };
});

vi.mock("./domains/image/services/step4ReferenceJob", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/image/services/step4ReferenceJob")>();
  return { ...actual, getLatestStep4ReferenceJob: mocks.latestStep4Job };
});

vi.mock("./domains/ai_os/services/jobRunner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/ai_os/services/jobRunner")>();
  return {
    ...actual,
    cancelAiJob: mocks.cancelAiJob,
    getAiJobRun: mocks.getAiJobRun,
  };
});

vi.mock("./domains/image/services/imageWorkflowVersionPolicy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/image/services/imageWorkflowVersionPolicy")>();
  return { ...actual, getApprovedImageWorkflowExport: mocks.getApprovedExport };
});

import { router } from "./_core/trpc";
import { imageReferenceProcedures } from "./domains/image/routers/references";
import { imageSessionProcedures } from "./domains/image/routers/sessions";
import { imageStep5Procedures } from "./domains/image/routers/step5";

const callerFactory = router({
  unlockStep4ForEditing: imageReferenceProcedures.unlockStep4ForEditing,
  cancelStep5Generation: imageStep5Procedures.cancelStep5Generation,
  getExportBundle: imageSessionProcedures.getExportBundle,
});

function context(): TrpcContext {
  return {
    user: {
      id: 17,
      openId: "step45-transaction-route-test",
      email: "step45@test.local",
      name: "Step 4/5 Transaction Test",
      loginMethod: "manus",
      role: "super_admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    workspaceId: 7,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 23,
    projectId: 51,
    workspaceId: 7,
    userId: 17,
    step4UserEdit: JSON.stringify({ imageReferences: [{ imageKey: "main-1", purpose: "旧确认参考图" }] }),
    step4AiResult: JSON.stringify({ imageReferences: [{ imageKey: "main-1", purpose: "最新参考图" }] }),
    step5RunId: "step5-active-run",
    step5RunStatus: "running",
    step5RunProgress: 55,
    ...overrides,
  };
}

const migrationMissing = () => new TRPCError({
  code: "PRECONDITION_FAILED",
  message: "图片工作流版本快照尚未初始化；请管理员仅在开发库审核并执行 0206 增量迁移",
});

describe("Step 4/5 草稿和取消的真实 tRPC 事务边界", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveProjectAccess.mockResolvedValue({ id: 51, workspaceId: 7, userId: 17 });
    mocks.resolveSessionAccess.mockResolvedValue(session());
    mocks.resolveSessionForExecution.mockResolvedValue(session());
    mocks.latestStep4Job.mockResolvedValue(null);
    mocks.getAiJobRun.mockResolvedValue({ runId: "step5-active-run", attempt: 1, maxAttempts: 3 });
    mocks.cancelAiJob.mockResolvedValue(undefined);
    mocks.invalidate.mockResolvedValue({ scopeRevision: 8, invalidatedSteps: [4, 5, 6] });
    mocks.getApprovedExport.mockResolvedValue({ sections: [] });
  });

  it("Step 4 解锁将草稿投影和 Step 4–6 失效事件交给同一个版本事务", async () => {
    const caller = callerFactory.createCaller(context());

    await expect(caller.unlockStep4ForEditing({ projectId: 51 })).resolves.toMatchObject({ success: true });

    expect(mocks.invalidate).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 7,
      projectId: 51,
      sessionId: 23,
      actorId: 17,
      actorRole: "super_admin",
      fromStep: 4,
      legacyPatch: expect.objectContaining({ step4UserEdit: expect.stringContaining("最新参考图") }),
    }));
  });

  it("0206 缺失时 Step 4 草稿解锁失败关闭，且不会退化为独立会话写入", async () => {
    mocks.invalidate.mockRejectedValue(migrationMissing());
    const caller = callerFactory.createCaller(context());

    await expect(caller.unlockStep4ForEditing({ projectId: 51 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("0206"),
    });
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
  });

  it("Step 5 取消以当前 run ID CAS 隔离晚到结果，再尽力取消队列任务", async () => {
    const caller = callerFactory.createCaller(context());

    await expect(caller.cancelStep5Generation({ projectId: 51 })).resolves.toMatchObject({
      runId: null,
      status: "canceled",
      progress: 100,
    });
    expect(mocks.invalidate).toHaveBeenCalledWith(expect.objectContaining({
      fromStep: 5,
      expectedStep5RunId: "step5-active-run",
      legacyPatch: expect.objectContaining({ step5RunId: null, step5RunStatus: "canceled" }),
    }));
    expect(mocks.cancelAiJob).toHaveBeenCalledWith("step5-active-run", expect.stringContaining("取消"));
  });

  it("0206 缺失时 Step 5 取消不调用队列取消，避免半提交和旧 run 状态错写", async () => {
    mocks.invalidate.mockRejectedValue(migrationMissing());
    const caller = callerFactory.createCaller(context());

    await expect(caller.cancelStep5Generation({ projectId: 51 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("0206"),
    });
    expect(mocks.cancelAiJob).not.toHaveBeenCalled();
  });

  it("草稿事务完成后，旧确认成果在真实 tRPC 导出路由被版本账本拒绝", async () => {
    let draftChanged = false;
    mocks.invalidate.mockImplementation(async () => {
      draftChanged = true;
      return { scopeRevision: 8, invalidatedSteps: [4, 5, 6] };
    });
    mocks.getApprovedExport.mockImplementation(async () => {
      if (draftChanged) throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Step 4 已进入草稿、解锁或重置状态；旧确认快照不得继续用于生成或导出",
      });
      return { sections: [] };
    });
    const caller = callerFactory.createCaller(context());

    await caller.unlockStep4ForEditing({ projectId: 51 });
    await expect(caller.getExportBundle({ projectId: 51 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("旧确认快照"),
    });
  });
});
