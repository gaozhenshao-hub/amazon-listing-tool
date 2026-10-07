import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./domains/ai_os/services/jobRunner", () => ({
  listAiJobRunsForUser: vi.fn(),
  createAiJobRun: vi.fn(),
  scheduleAiJobRun: vi.fn(),
  registerAiJobHandler: vi.fn(),
}));

vi.mock("./domains/image/imageWorkflowAgentBridge", () => ({
  ensureImageWorkflowAgentRun: vi.fn(),
  imageWorkflowSkillNodeId: vi.fn(() => "step4_skill"),
  syncStepJobFailedToAgent: vi.fn(),
  syncStepJobQueuedToAgent: vi.fn(),
  syncStepJobRunningToAgent: vi.fn(),
  syncStepJobWaitingHumanToAgent: vi.fn(),
}));

const policyMocks = vi.hoisted(() => ({
  captureImageWorkflowWorkerFence: vi.fn(),
}));

vi.mock("./domains/image/services/imageWorkflowVersionPolicy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/image/services/imageWorkflowVersionPolicy")>();
  return { ...actual, captureImageWorkflowWorkerFence: policyMocks.captureImageWorkflowWorkerFence };
});

import {
  createAiJobRun,
  listAiJobRunsForUser,
  scheduleAiJobRun,
} from "./domains/ai_os/services/jobRunner";
import {
  ensureImageWorkflowAgentRun,
  syncStepJobQueuedToAgent,
  syncStepJobRunningToAgent,
} from "./domains/image/imageWorkflowAgentBridge";
import { startStep4ReferenceJob } from "./domains/image/services/step4ReferenceJob";

const mockedListJobs = vi.mocked(listAiJobRunsForUser);
const mockedCreateJob = vi.mocked(createAiJobRun);
const mockedSchedule = vi.mocked(scheduleAiJobRun);
const mockedEnsureAgent = vi.mocked(ensureImageWorkflowAgentRun);
const mockedSyncQueued = vi.mocked(syncStepJobQueuedToAgent);
const mockedSyncRunning = vi.mocked(syncStepJobRunningToAgent);

describe("Step4任务创建与去重", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    policyMocks.captureImageWorkflowWorkerFence.mockResolvedValue({ scopeRevision: 4, upstreamDigest: "a".repeat(64) });
    mockedEnsureAgent.mockResolvedValue("agent-step4" as any);
    mockedCreateJob.mockResolvedValue({
      runId: "step4-created",
      status: "queued",
      attempt: 1,
      maxAttempts: 3,
      progress: 5,
    } as any);
  });

  it("历史失败任务不会阻塞创建、同步并调度新的Step4任务", async () => {
    mockedListJobs.mockResolvedValue([{ runId: "step4-failed", kind: "image.step4.reference", status: "failed" }] as any);

    const job = await startStep4ReferenceJob({ projectId: 90001, sessionId: 780001, userId: 1, actorRole: "admin", workspaceId: 1 });

    expect(job.runId).toBe("step4-created");
    expect(mockedCreateJob).toHaveBeenCalledWith(expect.objectContaining({
      kind: "image.step4.reference",
      projectId: 90001,
      userId: 1,
      input: expect.objectContaining({
        sessionId: 780001,
        agentRunId: "agent-step4",
        actorRole: "admin",
        scopeRevision: 4,
        upstreamDigest: "a".repeat(64),
      }),
    }));
    expect(mockedSyncQueued).toHaveBeenCalledWith(expect.objectContaining({ aiJobRunId: "step4-created" }));
    expect(mockedSchedule).toHaveBeenCalledWith("step4-created");
  });

  it("存在queued任务时复用任务并且不重复创建或调度", async () => {
    const active = { runId: "step4-active", kind: "image.step4.reference", status: "queued", attempt: 1, maxAttempts: 3, progress: 42 };
    mockedListJobs.mockResolvedValue([active] as any);

    const job = await startStep4ReferenceJob({ projectId: 90001, sessionId: 780001, userId: 1, actorRole: "admin", workspaceId: 1, agentRunId: "agent-existing" });

    expect(job).toBe(active);
    expect(mockedCreateJob).not.toHaveBeenCalled();
    expect(mockedSchedule).not.toHaveBeenCalled();
    expect(mockedSyncQueued).toHaveBeenCalledWith(expect.objectContaining({ aiJobRunId: "step4-active", progress: 42 }));
    expect(mockedSyncRunning).not.toHaveBeenCalled();
  });

  it("0206账本不可用时在入队前失败，不创建或调度模型作业", async () => {
    policyMocks.captureImageWorkflowWorkerFence.mockRejectedValue(new Error("图片工作流版本快照尚未初始化"));

    await expect(startStep4ReferenceJob({
      projectId: 90001,
      sessionId: 780001,
      userId: 1,
      actorRole: "admin",
      workspaceId: 1,
    })).rejects.toThrow("版本快照尚未初始化");

    expect(mockedCreateJob).not.toHaveBeenCalled();
    expect(mockedSchedule).not.toHaveBeenCalled();
  });
});
