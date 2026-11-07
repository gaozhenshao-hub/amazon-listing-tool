import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  execute: vi.fn(),
  project: vi.fn(),
  permission: vi.fn(),
}));
vi.mock("./repository", () => ({
  execute: (...args: any[]) => f.execute(...args),
}));
vi.mock("../../repositories", () => ({
  getProjectById: (...args: any[]) => f.project(...args),
}));
vi.mock("../../repositories/auth/authRepository", () => ({
  getRolePermission: async () => null,
}));
vi.mock("../../services/securityGovernance", () => ({
  assertResourceAction: (...args: any[]) => f.permission(...args),
}));
import {
  authorizeListingDesign,
  authorizeDesignConversation,
  authorizeDesignGeneration,
} from "./access";
const user = {
  id: 2,
  status: "active",
  role: "ops_specialist",
  defaultWorkspaceId: 1,
};
beforeEach(() => {
  vi.clearAllMocks();
  f.project.mockResolvedValue({ id: 15 });
  f.permission.mockResolvedValue(undefined);
  f.execute.mockImplementation(async (sql: string) =>
    sql.includes("SELECT kind")
      ? [{ kind: "listing" }]
      : sql.includes("SELECT project_id")
        ? [{ project_id: 15 }]
        : sql.includes("SELECT conversationId")
          ? [{ conversationId: "owned-conversation" }]
          : []
  );
});
it("运营使用项目权限进入生图，不需要独立美工权限", async () => {
  expect(await authorizeListingDesign(user, 15, "edit")).toEqual({
    workspaceId: 1,
    userId: 2,
  });
  expect(f.permission).toHaveBeenCalledWith(
    expect.objectContaining({
      resource: "project",
      projectId: 15,
      action: "update",
    })
  );
});
it("无法借制作对话进入不可访问的项目", async () => {
  f.project.mockResolvedValue(null);
  await expect(
    authorizeDesignConversation(user, "edit", "owned-conversation")
  ).rejects.toThrow("项目不可访问");
});
it("普通美工对话仍受原板块权限约束", async () => {
  f.execute.mockResolvedValue([{ kind: "studio" }]);
  await expect(
    authorizeDesignConversation(user, "read", "other-conversation")
  ).rejects.toThrow("没有美工");
});
it("生成进度检查追溯到所属项目，保留用户与空间限定", async () => {
  expect(await authorizeDesignGeneration(user, "edit", "generation")).toEqual({
    workspaceId: 1,
    userId: 2,
  });
  expect(f.execute).toHaveBeenCalledWith(
    expect.stringContaining("SELECT conversationId"),
    ["generation", 1, 2]
  );
});
