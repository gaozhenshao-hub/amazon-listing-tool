import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { SECURITY_PERMISSION_MATRIX } from "../shared/const";

const checks = vi.hoisted(() => ({ authorize: vi.fn(), audit: vi.fn() }));
vi.mock("./services/securityGovernance", () => ({
  actorFromContext: (ctx: any) => ctx.user,
  workspaceIdFromContext: (ctx: any) => ctx.workspaceId,
  assertResourceAction: checks.authorize,
  recordSecurityAuditLog: checks.audit,
}));
import { router } from "./_core/trpc";
import { workspaceScopedProcedure } from "./domains/ai_os/workspaceScopedProcedure";

const resolver = vi.fn(() => "preview");
const api = router({
  generate: workspaceScopedProcedure("project", "update").mutation(resolver),
  confirm: workspaceScopedProcedure("project", "update").mutation(resolver),
  get: workspaceScopedProcedure("project", "update").query(resolver),
});
const context = (role = "ops_specialist", workspaceId: number | null = 1) =>
  ({ user: { id: 2, role }, workspaceId }) as any;

describe("图片大纲沿用项目编辑权限", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checks.authorize.mockImplementation(async (request: any) => {
      const allowed = SECURITY_PERMISSION_MATRIX[request.actor.role]?.[request.resource as "project"];
      if (!allowed?.includes(request.action)) throw new TRPCError({ code: "FORBIDDEN" });
    });
  });

  it("运营编辑可以生成与确认草稿，审计仍记录项目更新", async () => {
    const caller = api.createCaller(context());
    await expect(caller.generate()).resolves.toBe("preview");
    await expect(caller.confirm()).resolves.toBe("preview");
    expect(checks.authorize).toHaveBeenCalledWith(expect.objectContaining({ resource: "project", action: "update", workspaceId: 1 }), expect.anything());
    expect(checks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "project.update", status: "success" }));
  });

  it("只读角色可以读取，但生成和确认均在进入业务处理前拒绝", async () => {
    const caller = api.createCaller(context("designer"));
    await expect(caller.get()).resolves.toBe("preview");
    resolver.mockClear();
    await expect(caller.generate()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.confirm()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(resolver).not.toHaveBeenCalled();
  });

  it("未绑定工作区时仍然拒绝请求", async () => {
    await expect(api.createCaller(context("admin", null)).generate()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(checks.authorize).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });
});
