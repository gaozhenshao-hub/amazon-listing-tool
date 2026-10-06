import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserById: vi.fn(),
  updateUserById: vi.fn(),
  upsertUser: vi.fn(),
}));
vi.mock("./repositories", () => mocks);

import { userManagementRouter } from "./routers/userManagement";

const caller = (id: number, role: "admin" | "super_admin") =>
  userManagementRouter.createCaller({ user: { id, role } } as any);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserById.mockResolvedValue({ id: 20, role: "ops_specialist", status: "active" });
  mocks.updateUserById.mockResolvedValue(undefined);
});

describe("用户管理服务端权限边界", () => {
  it("公司管理员不可通过直接更新将其他用户提升为超级管理员", async () => {
    await expect(caller(10, "admin").update({ userId: 20, role: "super_admin" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it("公司管理员不可通过批量导入创建超级管理员", async () => {
    await expect(caller(10, "admin").bulkImport({ users: [{ name: "隔离测试", role: "super_admin" }] }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.upsertUser).not.toHaveBeenCalled();
  });

  it("管理员不能直接更改自己的角色或状态", async () => {
    mocks.getUserById.mockResolvedValue({ id: 10, role: "admin", status: "active" });
    await expect(caller(10, "admin").update({ userId: 10, role: "ops_manager" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(10, "admin").update({ userId: 10, status: "disabled" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it("超级管理员可经授权提升其他用户，普通管理员可维护普通用户", async () => {
    await caller(10, "super_admin").update({ userId: 20, role: "super_admin" });
    expect(mocks.updateUserById).toHaveBeenCalledWith(20, { role: "super_admin" });
    await caller(11, "admin").update({ userId: 20, name: "隔离测试" });
    expect(mocks.updateUserById).toHaveBeenCalledWith(20, { name: "隔离测试" });
  });
});
