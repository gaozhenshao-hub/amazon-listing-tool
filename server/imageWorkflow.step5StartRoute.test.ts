import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./domains/image/repository", () => ({
  getProjectByIdAdmin: vi.fn(),
  getImageWorkflowSessionByProject: vi.fn(),
  getImageWorkflowSessionById: vi.fn(),
  updateImageWorkflowSession: vi.fn(),
  devDb: {},
  kbDb: {},
}));

vi.mock("./domains/ai_os/services/businessArtifactRegistry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/ai_os/services/businessArtifactRegistry")>();
  return { ...actual, hydrateImageWorkflowSessionFromArtifacts: vi.fn(async (session: any) => session) };
});

vi.mock("./domains/ai_os/services/jobRunner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/ai_os/services/jobRunner")>();
  return {
    ...actual,
    cancelAiJob: vi.fn(),
    createAiJobRun: vi.fn(),
    getAiJobRun: vi.fn(),
    scheduleAiJobRun: vi.fn(),
  };
});

vi.mock("./domains/image/imageWorkflowAgentBridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/image/imageWorkflowAgentBridge")>();
  return {
    ...actual,
    ensureImageWorkflowAgentRun: vi.fn(),
    syncStepJobFailedToAgent: vi.fn(),
    syncStepJobQueuedToAgent: vi.fn(),
    syncStepJobRunningToAgent: vi.fn(),
  };
});

import { imageWorkflowRouter } from "./domains/image/router";
import * as imageRepository from "./domains/image/repository";
import { cancelAiJob, createAiJobRun, getAiJobRun, scheduleAiJobRun } from "./domains/ai_os/services/jobRunner";
import {
  syncStepJobFailedToAgent,
  syncStepJobQueuedToAgent,
  syncStepJobRunningToAgent,
} from "./domains/image/imageWorkflowAgentBridge";
import { STEP5_STALE_RUN_GRACE_MS } from "./domains/image/step5StaleRecovery";

const repository = vi.mocked(imageRepository);
const mockedCancel = vi.mocked(cancelAiJob);
const mockedCreate = vi.mocked(createAiJobRun);
const mockedGet = vi.mocked(getAiJobRun);
const mockedSchedule = vi.mocked(scheduleAiJobRun);
const mockedSyncFailed = vi.mocked(syncStepJobFailedToAgent);
const mockedSyncQueued = vi.mocked(syncStepJobQueuedToAgent);
const mockedSyncRunning = vi.mocked(syncStepJobRunningToAgent);

function createContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "step5-start-route-test",
      email: "step5-start@test.local",
      name: "Step5 Start Test",
      loginMethod: "manus",
      role: "super_admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function buildSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 780001,
    projectId: 90001,
    userId: 1,
    workspaceId: 1,
    step4Confirmed: 1,
    agentRunId: "agent-existing",
    step5RunId: null,
    step5RunStatus: "idle",
    step5RunStartedAt: null,
    step5RunProgress: 0,
    ...overrides,
  };
}

describe("Step5重新生成启动路由", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repository.getProjectByIdAdmin.mockResolvedValue({ id: 90001, userId: 1, workspaceId: 1 } as any);
    repository.updateImageWorkflowSession.mockImplementation(async (_id, update) => update as any);
    mockedCancel.mockResolvedValue(undefined as any);
    mockedSchedule.mockResolvedValue(undefined as any);
    mockedSyncFailed.mockResolvedValue(undefined as any);
    mockedSyncQueued.mockResolvedValue(undefined as any);
    mockedSyncRunning.mockResolvedValue(undefined as any);
    mockedCreate.mockResolvedValue({
      runId: "step5-new-run",
      status: "queued",
      progress: 5,
      attempt: 1,
      maxAttempts: 3,
      nextRunAt: null,
    } as any);
  });

  it("会回收超时running任务、持久化stale_recovery并创建新的Step5任务", async () => {
    const stale = buildSession({
      step5RunId: "step5-stale-run",
      step5RunStatus: "running",
      step5RunStartedAt: new Date(Date.now() - STEP5_STALE_RUN_GRACE_MS - 1),
    });
    repository.getImageWorkflowSessionByProject.mockResolvedValue(stale as any);
    const caller = imageWorkflowRouter.createCaller(createContext());

    const result = await caller.startStep5Generation({ projectId: 90001 });

    expect(mockedCancel).toHaveBeenCalledWith("step5-stale-run", expect.stringContaining("自动回收"));
    expect(repository.updateImageWorkflowSession).toHaveBeenCalledWith(780001, expect.objectContaining({
      step5RunStatus: "failed",
      step5RunFailedGroup: "stale_recovery",
    }));
    expect(mockedCreate).toHaveBeenCalledWith(expect.objectContaining({
      runId: expect.any(String),
      projectId: 90001,
      input: expect.objectContaining({ sessionId: 780001, agentRunId: "agent-existing" }),
    }));
    expect(mockedSchedule).toHaveBeenCalledWith("step5-new-run");
    expect(result).toMatchObject({ status: "queued" });
    expect(result.runId).toMatch(/^image_step5_/);
  });

  it("会复用未过期活动任务且不创建新任务", async () => {
    const active = buildSession({
      step5RunId: "step5-active-run",
      step5RunStatus: "running",
      step5RunStartedAt: new Date(),
    });
    repository.getImageWorkflowSessionByProject.mockResolvedValue(active as any);
    mockedGet.mockResolvedValue({
      runId: "step5-active-run",
      status: "running",
      progress: 66,
      attempt: 1,
      maxAttempts: 3,
      nextRunAt: null,
    } as any);
    const caller = imageWorkflowRouter.createCaller(createContext());

    const result = await caller.startStep5Generation({ projectId: 90001 });

    expect(mockedCancel).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockedSchedule).not.toHaveBeenCalled();
    expect(result).toMatchObject({ runId: "step5-active-run", status: "running", progress: 0, attempt: 1 });
  });
});
