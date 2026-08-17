import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./domains/image/repository", () => ({
  getProjectByIdAdmin: vi.fn(),
  getImageWorkflowSessionByProject: vi.fn(),
  updateImageWorkflowSession: vi.fn(),
  devDb: {},
  kbDb: {},
}));

vi.mock("./domains/ai_os/services/businessArtifactRegistry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/ai_os/services/businessArtifactRegistry")>();
  return {
    ...actual,
    hydrateImageWorkflowSessionFromArtifacts: vi.fn(async (session: any) => session),
  };
});

vi.mock("./domains/image/imageWorkflowAgentBridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/image/imageWorkflowAgentBridge")>();
  return { ...actual, ensureImageWorkflowAgentRun: vi.fn() };
});

vi.mock("./domains/image/services/step4ReferenceJob", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/image/services/step4ReferenceJob")>();
  return { ...actual, startStep4ReferenceJob: vi.fn() };
});

import { imageWorkflowRouter } from "./domains/image/router";
import * as imageRepository from "./domains/image/repository";
import { ensureImageWorkflowAgentRun } from "./domains/image/imageWorkflowAgentBridge";
import { startStep4ReferenceJob } from "./domains/image/services/step4ReferenceJob";

const mockedRepository = vi.mocked(imageRepository);
const mockedEnsureAgent = vi.mocked(ensureImageWorkflowAgentRun);
const mockedStartJob = vi.mocked(startStep4ReferenceJob);

function createContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "step4-start-route-test",
      email: "step4-start@test.local",
      name: "Step4 Start Test",
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

describe("Step4重新推荐路由", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRepository.getProjectByIdAdmin.mockResolvedValue({ id: 90001, userId: 1, workspaceId: 1 } as any);
    mockedRepository.getImageWorkflowSessionByProject.mockResolvedValue({
      id: 780001,
      projectId: 90001,
      userId: 1,
      step3Confirmed: 1,
      agentRunId: "agent-existing",
    } as any);
    mockedStartJob.mockResolvedValue({ runId: "step4-new-run", status: "queued" } as any);
  });

  it("实际调用startStep4Generation会复用会话Agent并创建任务", async () => {
    const caller = imageWorkflowRouter.createCaller(createContext());
    const result = await caller.startStep4Generation({ projectId: 90001 });

    expect(result).toMatchObject({ runId: "step4-new-run", status: "queued" });
    expect(mockedEnsureAgent).not.toHaveBeenCalled();
    expect(mockedStartJob).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 90001,
      sessionId: 780001,
      userId: 1,
      agentRunId: "agent-existing",
    }));
  });

  it("会话缺少Agent时会补写Agent后再启动新的Step4任务", async () => {
    mockedRepository.getImageWorkflowSessionByProject.mockResolvedValue({
      id: 780001,
      projectId: 90001,
      userId: 1,
      step3Confirmed: 1,
      agentRunId: null,
    } as any);
    mockedEnsureAgent.mockResolvedValue("agent-created" as any);
    const caller = imageWorkflowRouter.createCaller(createContext());

    await caller.startStep4Generation({ projectId: 90001 });

    expect(mockedRepository.updateImageWorkflowSession).toHaveBeenCalledWith(780001, { agentRunId: "agent-created" });
    expect(mockedStartJob).toHaveBeenCalledWith(expect.objectContaining({ agentRunId: "agent-created" }));
  });
});
