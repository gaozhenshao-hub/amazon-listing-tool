import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./_core/context";
import { SECURITY_PERMISSION_MATRIX } from "../shared/const";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), catalog: vi.fn(), run: vi.fn(), publish: vi.fn() }));
vi.mock("./services/securityGovernance", async original => ({
  ...await original<typeof import("./services/securityGovernance")>(), assertResourceAction: mocks.authorize,
}));
vi.mock("./domains/ai_os/services/skillWorkbench", () => ({ skillWorkbench: mocks }));
import { skillWorkbenchRouter } from "./domains/ai_os/routers/skillWorkbench";

function context(role: string | null = "admin", workspaceId = 7): TrpcContext {
  return { user: role === null ? null : { id: 19, role, defaultWorkspaceId: 7 } as TrpcContext["user"], workspaceId, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}
const scope = { expectedWorkspaceId: 7 };
const target = { ...scope, id: "00000000-0000-4000-8000-000000000001", revision: 1 };
beforeEach(() => { for (const fn of Object.values(mocks)) fn.mockReset(); mocks.authorize.mockResolvedValue(undefined); });
describe("Skill workbench authorization", () => {
  it("requires login before reading private drafts or catalog", async () => {
    await expect(skillWorkbenchRouter.createCaller(context(null)).catalog(scope)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.catalog).not.toHaveBeenCalled();
  });
  it("rejects a stale workspace before model work", async () => {
    await expect(skillWorkbenchRouter.createCaller(context("admin", 9)).run(target)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("respects per-resource denial even for an administrator", async () => {
    mocks.authorize.mockRejectedValue(new TRPCError({ code: "FORBIDDEN" }));
    await expect(skillWorkbenchRouter.createCaller(context()).run(target)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("uses the authenticated user and workspace for runs", async () => {
    await skillWorkbenchRouter.createCaller(context()).run(target);
    expect(mocks.authorize).toHaveBeenCalledWith(expect.objectContaining({ resource: "emperor_skill", action: "run", workspaceId: 7 }), expect.anything());
    expect(mocks.run).toHaveBeenCalledWith({ workspaceId: 7, userId: 19, admin: true, superAdmin: false }, target.id, 1, false, undefined);
  });
  it("does not grant a non-administrator publishing rights", async () => {
    await expect(skillWorkbenchRouter.createCaller(context("ops_manager")).publish(target)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("allows admin workbench actions by default without expanding operator permissions", () => {
    expect(SECURITY_PERMISSION_MATRIX.admin.emperor_skill).toEqual(expect.arrayContaining(["read", "run", "update"]));
    expect(SECURITY_PERMISSION_MATRIX.ops_specialist.emperor_skill).toBeUndefined();
  });
});
