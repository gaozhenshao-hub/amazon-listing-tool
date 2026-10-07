import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ adminGet: vi.fn(), ownerGet: vi.fn() }));
vi.mock("./domains/listing/repository", async (importOriginal) => ({
  ...await importOriginal<typeof import("./domains/listing/repository")>(),
  getProjectByIdAdmin: mocks.adminGet, getProjectById: mocks.ownerGet,
}));
import { resolveProjectAccess } from "./domains/listing/routerContext";

beforeEach(() => { vi.clearAllMocks(); mocks.adminGet.mockResolvedValue(null); mocks.ownerGet.mockResolvedValue(null); });
describe("Listing项目访问的工作空间范围", () => {
  it("管理员访问时用当前工作空间读项目，而不降级为全局项目ID", async () => {
    await expect(resolveProjectAccess(5, { id: 7, role: "admin" }, 12)).rejects.toThrow("Project not found");
    expect(mocks.adminGet).toHaveBeenCalledWith(5, 12);
    expect(mocks.ownerGet).not.toHaveBeenCalled();
  });
  it("普通用户同时限定所有权与工作空间", async () => {
    await expect(resolveProjectAccess(5, { id: 7, role: "user" }, 12)).rejects.toThrow("Project not found");
    expect(mocks.ownerGet).toHaveBeenCalledWith(5, 7, 12);
  });
});
