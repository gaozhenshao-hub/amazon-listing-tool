import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./domains/image/repository", () => ({
  getImageWorkflowSessionByProject: vi.fn(),
  updateImageWorkflowSession: vi.fn(),
  getCurrentStep4ImageVersions: vi.fn(),
  getProjectByIdAdmin: vi.fn(),
  devDb: {},
  kbDb: {},
}));

vi.mock("./domains/ai_os/services/businessArtifactRegistry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/ai_os/services/businessArtifactRegistry")>();
  return {
    ...actual,
    registerImageWorkflowStepArtifact: vi.fn(async () => ({ ref: "artifact-step4-current" })),
  };
});

vi.mock("./domains/image/imageWorkflowAgentBridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/image/imageWorkflowAgentBridge")>();
  return { ...actual, syncStepConfirmToAgent: vi.fn(async () => undefined) };
});

import { imageWorkflowRouter } from "./domains/image/router";
import * as imageRepository from "./domains/image/repository";

const repository = vi.mocked(imageRepository);

function createContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "step4-confirm-route-test",
      email: "step4-confirm@test.local",
      name: "Step4 Confirm Test",
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

describe("Step4整体确认当前目标过滤", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repository.getImageWorkflowSessionByProject.mockResolvedValue({
      id: 780001,
      projectId: 90001,
      userId: 1,
      agentRunId: "agent-step4",
      // 仅主图 + 辅图2-7是当前大纲目标；不再包含历史A+模块8。
      step2UserEdit: JSON.stringify({ mainImage: { purpose: "主图目标" }, secondaryImages: [] }),
    } as any);
    repository.updateImageWorkflowSession.mockResolvedValue(undefined as any);
    repository.getCurrentStep4ImageVersions.mockResolvedValue(Array.from({ length: 7 }, (_, imageIndex) => ({
      imageIndex,
      content: JSON.stringify({
        imageKey: imageIndex === 0 ? "main-1" : `secondary-${imageIndex + 1}`,
        imageType: imageIndex === 0 ? "主图" : `辅图${imageIndex + 1}`,
        purpose: `当前目标${imageIndex + 1}`,
        compositionReference: { layout: `当前构图${imageIndex + 1}` },
        effectReference: { atmosphere: `当前氛围${imageIndex + 1}` },
      }),
    })) as any);
  });

  it("会忽略当前Step2大纲之外的历史未确认参考图，并确认当前七张目标", async () => {
    const currentRefs = [
      { imageKey: "main-1", imageType: "主图" },
      ...Array.from({ length: 6 }, (_, index) => ({ imageKey: `secondary-${index + 2}`, imageType: `辅图${index + 2}` })),
    ];
    const caller = imageWorkflowRouter.createCaller(createContext());

    await expect(caller.confirmStep4({
      projectId: 90001,
      userEdit: JSON.stringify({
        imageReferences: [
          ...currentRefs,
          { imageKey: "aplus-8", imageType: "A+模块 8", purpose: "历史未确认版本" },
        ],
      }),
    })).resolves.toEqual({ success: true });

    const update = vi.mocked(repository.updateImageWorkflowSession).mock.calls[0]?.[1] as Record<string, any>;
    const confirmed = JSON.parse(String(update.step4UserEdit));
    expect(confirmed.imageReferences).toHaveLength(7);
    expect(confirmed.imageReferences.map((reference: any) => reference.imageKey)).toEqual(currentRefs.map((reference) => reference.imageKey));
    expect(confirmed.imageReferences.some((reference: any) => reference.imageKey === "aplus-8")).toBe(false);
    expect(update).toMatchObject({ step4Confirmed: 1, currentStep: 5 });
  });
});
