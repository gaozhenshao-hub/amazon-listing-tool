import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./domains/image/repository", () => ({
  getImageWorkflowSessionByProject: vi.fn(),
  updateImageWorkflowSession: vi.fn(),
  getProjectByIdAdmin: vi.fn(),
  getCurrentStep4ImageVersions: vi.fn(),
  devDb: {},
  kbDb: {},
}));

vi.mock("./domains/ai_os/services/businessArtifactRegistry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./domains/ai_os/services/businessArtifactRegistry")>();
  return {
    ...actual,
    hydrateImageWorkflowSessionFromArtifacts: vi.fn(async (session: any) => session),
    hydrateLockedImageWorkflowAplusSubmodules: vi.fn(async ({ outline }: any) => ({ outline, consumedRefs: [] })),
  };
});

import { imageWorkflowRouter } from "./domains/image/router";
import * as imageRepository from "./domains/image/repository";
import { resolveSessionForDisplay } from "./domains/image/routerContext";

const mockedRepository = vi.mocked(imageRepository);

function createContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "step2-route-test",
      email: "step2-route@test.local",
      name: "Step2 Route Test",
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

function buildDraft() {
  return {
    aPlusModules: [{
      moduleNumber: 5,
      subModuleRemark: "4种场景：车库、庭院、露营、工地",
      subModuleCount: 4,
      subModules: ["车库", "庭院", "露营", "工地"].map((title, index) => ({
        subModuleNumber: index + 1,
        title,
        purpose: `围绕“${title}”展开`,
        contentBrief: `展示产品在“${title}”中的核心价值、使用方式或结果。`,
        isLocked: index === 1,
        lockedArtifactRef: index === 1 ? "artifact-step2-5-2" : null,
      })),
    }],
  };
}

describe("Step2草稿保存与会话水合路由", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRepository.getProjectByIdAdmin.mockResolvedValue({ id: 90001, userId: 1 } as any);
    mockedRepository.getCurrentStep4ImageVersions.mockResolvedValue([] as any);
  });

  it("实际调用saveStep2Draft会写入规范化草稿并保持currentStep=2", async () => {
    const session = { id: 780001, projectId: 90001, userId: 1, step2Confirmed: 0 };
    mockedRepository.getImageWorkflowSessionByProject.mockResolvedValue(session as any);
    mockedRepository.updateImageWorkflowSession.mockResolvedValue(undefined as any);
    const caller = imageWorkflowRouter.createCaller(createContext());

    const result = await caller.saveStep2Draft({ projectId: 90001, userEdit: JSON.stringify(buildDraft()) });

    expect(result.outline.aPlusModules[0]).toMatchObject({
      subModuleRemark: "4种场景：车库、庭院、露营、工地",
      subModuleCount: 4,
    });
    expect(mockedRepository.updateImageWorkflowSession).toHaveBeenCalledWith(780001, expect.objectContaining({
      currentStep: 2,
      step2UserEdit: expect.stringContaining("车库"),
    }));
  });

  it("锁定后的saveStep2Draft实际拒绝覆盖草稿", async () => {
    mockedRepository.getImageWorkflowSessionByProject.mockResolvedValue({ id: 780001, projectId: 90001, userId: 1, step2Confirmed: 1 } as any);
    const caller = imageWorkflowRouter.createCaller(createContext());

    await expect(caller.saveStep2Draft({ projectId: 90001, userEdit: JSON.stringify(buildDraft()) }))
      .rejects.toThrow("图片大纲已锁定");
    expect(mockedRepository.updateImageWorkflowSession).not.toHaveBeenCalled();
  });

  it("会话展示水合会返回保存的备注、完整标题和锁定子图资产", async () => {
    const draft = buildDraft();
    mockedRepository.getImageWorkflowSessionByProject.mockResolvedValue({
      id: 780001,
      projectId: 90001,
      userId: 1,
      step2Confirmed: 0,
      step2UserEdit: JSON.stringify(draft),
      step2AiResult: null,
    } as any);

    const hydrated = await resolveSessionForDisplay(90001, { id: 1, role: "super_admin" });
    const outline = JSON.parse(hydrated!.step2UserEdit);

    expect(outline.aPlusModules[0]).toMatchObject({
      subModuleRemark: "4种场景：车库、庭院、露营、工地",
      subModuleCount: 4,
    });
    expect(outline.aPlusModules[0].subModules[1]).toMatchObject({
      title: "庭院",
      isLocked: true,
      lockedArtifactRef: "artifact-step2-5-2",
    });
  });

  it("getSession路由实际返回水合后的备注、完整标题和锁定子图资产", async () => {
    mockedRepository.getImageWorkflowSessionByProject.mockResolvedValue({
      id: 780001,
      projectId: 90001,
      userId: 1,
      step2Confirmed: 0,
      step2UserEdit: JSON.stringify(buildDraft()),
      step2AiResult: null,
      step4Confirmed: 0,
      step4UserEdit: null,
      step4AiResult: null,
    } as any);
    const caller = imageWorkflowRouter.createCaller(createContext());

    const session = await caller.getSession({ projectId: 90001 });
    const outline = JSON.parse(session!.step2UserEdit);

    expect(outline.aPlusModules[0]).toMatchObject({
      subModuleRemark: "4种场景：车库、庭院、露营、工地",
      subModuleCount: 4,
    });
    expect(outline.aPlusModules[0].subModules[1]).toMatchObject({
      title: "庭院",
      isLocked: true,
      lockedArtifactRef: "artifact-step2-5-2",
    });
  });
});
