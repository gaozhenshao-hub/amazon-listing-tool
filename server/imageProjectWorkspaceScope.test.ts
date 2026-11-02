import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getProjectByIdAdmin: vi.fn(), getProjectById: vi.fn() }));
vi.mock("./domains/image/repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("./domains/image/repository")>();
  return { ...original, getProjectByIdAdmin: mocks.getProjectByIdAdmin, getProjectById: mocks.getProjectById };
});
import { resolveProjectAccess } from "./domains/image/routerContext";

const actor = { id: 17, role: "super_admin" };
describe("图片工作流项目所属空间校验", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.getProjectByIdAdmin.mockResolvedValue({ id: 51, userId: 23, workspaceId: 7 }); });
  it("管理员不能仅凭项目编号读取其他工作空间", async () => {
    await expect(resolveProjectAccess(51, actor, 8)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await resolveProjectAccess(51, actor, 7)).toMatchObject({ id: 51 });
  });
  it("没有当前工作空间时，绑定项目一律失败关闭", async () => {
    await expect(resolveProjectAccess(51, actor, null)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("历史未绑定项目只有原创建者可按现有兼容规则读取", async () => {
    mocks.getProjectByIdAdmin.mockResolvedValue({ id: 51, userId: 17, workspaceId: null });
    await expect(resolveProjectAccess(51, actor, null)).resolves.toMatchObject({ id: 51 });
    mocks.getProjectByIdAdmin.mockResolvedValue({ id: 51, userId: 23, workspaceId: null });
    await expect(resolveProjectAccess(51, actor, null)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
