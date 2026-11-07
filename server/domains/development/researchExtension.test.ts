import { beforeEach, it, expect, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
const f = vi.hoisted(() => ({
  session: {
    id: "session",
    user_id: 7,
    workspace_id: 3,
    extension_origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  } as any,
  user: {
    id: 7,
    role: "product_dev",
    status: "active",
    defaultWorkspaceId: 3,
  } as any,
  checks: vi.fn(),
  auth: vi.fn(),
  queries: [] as any[],
}));
const dialect = new MySqlDialect();
vi.mock("../../services/passwordAuthentication", () => ({
  authenticatePasswordCredentials: f.auth,
}));
vi.mock("../../services/securityGovernance", () => ({
  assertResourceAction: f.checks,
  recordSecurityAuditLog: vi.fn(),
}));
vi.mock("../../repositories/dbClient", () => ({
  requireDb: async () => ({
    execute: async (q: any) => {
      const query = dialect.sqlToQuery(q);
      f.queries.push(query);
      if (query.sql.startsWith("SELECT id,user_id,workspace_id"))
        return [[f.session].filter(Boolean)];
      if (query.sql.startsWith("SELECT id,role,status"))
        return [[f.user].filter(Boolean)];
      if (
        query.sql.startsWith("UPDATE research_extension_sessions SET last_used")
      )
        return [{ affectedRows: 1 }];
      if (query.sql.startsWith("INSERT INTO research_extension_sessions"))
        return [{ affectedRows: 1 }];
      throw new Error(query.sql);
    },
  }),
}));
import {
  researchExtensionScope,
  extensionRequestOrigin,
  loginResearchExtension,
} from "./researchExtension";
beforeEach(() => {
  f.session = {
    id: "session",
    user_id: 7,
    workspace_id: 3,
    extension_origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
  f.user = {
    id: 7,
    role: "product_dev",
    status: "active",
    defaultWorkspaceId: 3,
  };
  f.checks.mockReset();
  f.auth.mockReset();
  f.auth.mockResolvedValue({ ...f.user, mustChangePassword: 0, name: "运营" });
  f.queries = [];
});
it("GET无Origin时使用稳定插件身份，冲突或伪造来源仍拒绝", async () => {
  const origin = extensionRequestOrigin("", "a".repeat(32));
  expect(
    await researchExtensionScope("a".repeat(64), origin, "read")
  ).toMatchObject({ userId: 7 });
  expect(() => extensionRequestOrigin(origin, "b".repeat(32))).toThrow(
    "不一致"
  );
  expect(() =>
    extensionRequestOrigin("https://evil.example", "a".repeat(32))
  ).toThrow();
});
it("插件密码登录复用账号校验，只保存令牌哈希并签发30天限定收藏会话", async () => {
  const before = Date.now();
  const req = {
    ip: "127.0.0.1",
    body: { identifier: "operator", password: "test-only" },
    get: (key: string) =>
      key === "x-research-extension-id" ? "a".repeat(32) : "",
  };
  const result = await loginResearchExtension(req as any);
  expect(result.token).toMatch(/^[a-f0-9]{64}$/);
  expect(Date.parse(result.expiresAt) - before).toBeGreaterThanOrEqual(
    30 * 86400000
  );
  expect(f.auth).toHaveBeenCalledWith(
    req.body,
    expect.objectContaining({ ip: "127.0.0.1" })
  );
  const insert = f.queries.find(q => q.sql.startsWith("INSERT"));
  expect(insert.sql).toContain("INTERVAL 30 DAY");
  expect(insert.params).not.toContain(result.token);
  expect(insert.params).not.toContain("test-only");
  expect(insert.params).toContain(7);
  expect(insert.params).toContain(3);
  f.auth.mockResolvedValue({ ...f.user, mustChangePassword: 1 });
  await expect(loginResearchExtension(req as any)).rejects.toThrow(
    "首次密码修改"
  );
});
it("a collection token authorizes only its actual user and workspace through current resource permissions", async () => {
  const result = await researchExtensionScope(
    "a".repeat(64),
    f.session.extension_origin,
    "create"
  );
  expect(result).toEqual({ userId: 7, workspaceId: 3, role: "product_dev" });
  expect(f.checks).toHaveBeenCalledWith({
    actor: { id: 7, role: "product_dev", defaultWorkspaceId: 3 },
    workspaceId: 3,
    resource: "product_development",
    action: "create",
  });
  const query = f.queries[0];
  expect(query.sql).toContain("status='approved'");
  expect(query.sql).toContain("expires_at>NOW()");
  expect(query.params[0]).not.toBe("a".repeat(64));
});
it("rejects missing, expired/revoked or wrong-extension sessions", async () => {
  await expect(researchExtensionScope("", "", "read")).rejects.toThrow("登录");
  await expect(
    researchExtensionScope(
      "a".repeat(64),
      "chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "read"
    )
  ).rejects.toThrow("失效");
  f.session = null;
  await expect(
    researchExtensionScope("a".repeat(64), "", "read")
  ).rejects.toThrow("失效");
  expect(f.checks).not.toHaveBeenCalled();
});
it("rejects disabled accounts, workspace switches and withdrawn permissions", async () => {
  f.user.status = "disabled";
  await expect(
    researchExtensionScope("a".repeat(64), f.session.extension_origin, "create")
  ).rejects.toThrow("失效");
  f.user.status = "active";
  f.user.defaultWorkspaceId = 9;
  await expect(
    researchExtensionScope("a".repeat(64), f.session.extension_origin, "create")
  ).rejects.toThrow("失效");
  f.user.defaultWorkspaceId = 3;
  f.checks.mockRejectedValue(new Error("权限已收回"));
  await expect(
    researchExtensionScope("a".repeat(64), f.session.extension_origin, "create")
  ).rejects.toThrow("权限已收回");
});
