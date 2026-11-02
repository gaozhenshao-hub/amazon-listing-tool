import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getProjectByIdAdmin: vi.fn(),
  getExpressionGroupByProject: vi.fn(),
  getExpressionGroupImageByProject: vi.fn(),
  updateExpressionGroup: vi.fn(),
  deleteExpressionGroup: vi.fn(),
  insertExpressionGroupImage: vi.fn(),
  deleteExpressionGroupImage: vi.fn(),
  countExpressionGroupImages: vi.fn(),
}));

vi.mock("./domains/image/repository", () => ({
  getProjectByIdAdmin: mocks.getProjectByIdAdmin,
  getExpressionGroupByProject: mocks.getExpressionGroupByProject,
  getExpressionGroupImageByProject: mocks.getExpressionGroupImageByProject,
  updateExpressionGroup: mocks.updateExpressionGroup,
  deleteExpressionGroup: mocks.deleteExpressionGroup,
  insertExpressionGroupImage: mocks.insertExpressionGroupImage,
  deleteExpressionGroupImage: mocks.deleteExpressionGroupImage,
  countExpressionGroupImages: mocks.countExpressionGroupImages,
  devDb: {},
  kbDb: {},
}));

import { router } from "./_core/trpc";
import { imageExpressionGroupProcedures } from "./domains/image/routers/expressionGroups";

const expressionGroupRouter = router(imageExpressionGroupProcedures);

function createContext(workspaceId = 7): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "expression-group-project-scope-test",
      email: "expression-group-scope@test.local",
      name: "Expression Group Scope Test",
      loginMethod: "manus",
      role: "super_admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
    workspaceId,
  };
}

describe("expression-group project scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Project 101 is the caller's project. Group/image ID 202 belongs to a
    // distinct project in the same workspace, so a project-ID-only check is
    // insufficient to authorize either mutation.
    mocks.getProjectByIdAdmin.mockResolvedValue({ id: 101, userId: 1, workspaceId: 7 });
    mocks.getExpressionGroupByProject.mockImplementation(async (groupId: number, projectId: number) => (
      groupId === 202 && projectId === 202 ? { id: 202, projectId: 202 } : null
    ));
    mocks.getExpressionGroupImageByProject.mockImplementation(async (imageId: number, projectId: number) => (
      imageId === 302 && projectId === 202 ? { id: 302, projectId: 202, groupId: 202 } : null
    ));
  });

  it("rejects every cross-project group/image mutation without modifying the other project", async () => {
    const caller = expressionGroupRouter.createCaller(createContext());

    await expect(caller.updateExpressionGroup({ projectId: 101, groupId: 202, expressionName: "changed" }))
      .rejects.toThrow("Group not found");
    await expect(caller.deleteExpressionGroup({ projectId: 101, groupId: 202 }))
      .rejects.toThrow("Group not found");
    await expect(caller.addImageToGroup({
      projectId: 101,
      groupId: 202,
      competitorName: "Other project",
      imageUrl: "https://example.test/other-project.png",
    })).rejects.toThrow("Group not found");
    await expect(caller.removeImageFromGroup({ projectId: 101, imageId: 302 }))
      .rejects.toThrow("Image not found");

    expect(mocks.getExpressionGroupByProject).toHaveBeenCalledWith(202, 101);
    expect(mocks.getExpressionGroupImageByProject).toHaveBeenCalledWith(302, 101);
    expect(mocks.updateExpressionGroup).not.toHaveBeenCalled();
    expect(mocks.deleteExpressionGroup).not.toHaveBeenCalled();
    expect(mocks.countExpressionGroupImages).not.toHaveBeenCalled();
    expect(mocks.insertExpressionGroupImage).not.toHaveBeenCalled();
    expect(mocks.deleteExpressionGroupImage).not.toHaveBeenCalled();
  });

  it("rejects a resolved project outside the caller's current workspace before any mutation", async () => {
    mocks.getProjectByIdAdmin.mockResolvedValueOnce({ id: 101, userId: 1, workspaceId: 8 });
    const caller = expressionGroupRouter.createCaller(createContext(7));

    await expect(caller.deleteExpressionGroup({ projectId: 101, groupId: 101 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.getExpressionGroupByProject).not.toHaveBeenCalled();
    expect(mocks.deleteExpressionGroup).not.toHaveBeenCalled();
  });

  it("preserves the valid scoped update flow", async () => {
    mocks.getExpressionGroupByProject.mockResolvedValueOnce({ id: 101, projectId: 101 });
    const caller = expressionGroupRouter.createCaller(createContext());

    await expect(caller.updateExpressionGroup({ projectId: 101, groupId: 101, userEdit: "approved" }))
      .resolves.toEqual({ success: true });
    expect(mocks.updateExpressionGroup).toHaveBeenCalledWith(101, { userEdit: "approved" }, 101);
  });
});
