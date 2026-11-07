import { beforeEach, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
const f = vi.hoisted(() => ({
  get: vi.fn(),
  attempts: vi.fn(),
  update: vi.fn(),
  log: vi.fn(),
}));
vi.mock("../repositories", () => ({
  getUserByEmailOrPhone: f.get,
  updateLoginAttempts: f.attempts,
  updateUserById: f.update,
  insertLoginLog: f.log,
}));
import {
  authenticatePasswordCredentials,
  hashPasswordFast,
  verifyPasswordFast,
} from "./passwordAuthentication";
beforeEach(() => {
  vi.clearAllMocks();
  f.update.mockResolvedValue(undefined);
});
it("校验现有scrypt和历史bcrypt，畸形哈希失败而不暴露错误", () => {
  expect(
    verifyPasswordFast("example-only", hashPasswordFast("example-only"))
  ).toBe(true);
  expect(verifyPasswordFast("wrong", hashPasswordFast("example-only"))).toBe(
    false
  );
  expect(
    verifyPasswordFast("example-only", bcrypt.hashSync("example-only", 4))
  ).toBe(true);
  expect(verifyPasswordFast("x", "scrypt:broken")).toBe(false);
});
it("停用或锁定账号不能通过插件绕过现有登录限制", async () => {
  f.get.mockResolvedValue({ id: 7, status: "disabled" });
  await expect(
    authenticatePasswordCredentials(
      { identifier: "operator", password: "x" },
      {}
    )
  ).rejects.toThrow();
  f.get.mockResolvedValue({
    id: 7,
    status: "active",
    lockedUntil: new Date(Date.now() + 60000),
  });
  await expect(
    authenticatePasswordCredentials(
      { identifier: "operator", password: "x" },
      {}
    )
  ).rejects.toThrow();
  expect(f.attempts).not.toHaveBeenCalled();
});
it("错误密码累计失败次数，成功后重置，日志不包含密码", async () => {
  f.get.mockResolvedValue({
    id: 7,
    status: "active",
    password: hashPasswordFast("example-only"),
    failedLoginAttempts: 1,
  });
  await expect(
    authenticatePasswordCredentials(
      { identifier: "operator", password: "wrong" },
      {}
    )
  ).rejects.toThrow();
  expect(f.attempts).toHaveBeenCalledWith(7, 2, null);
  await authenticatePasswordCredentials(
    { identifier: "operator", password: "example-only" },
    { ip: "127.0.0.1" }
  );
  expect(f.attempts).toHaveBeenLastCalledWith(7, 0, null);
  expect(JSON.stringify(f.log.mock.calls)).not.toContain("example-only");
});
