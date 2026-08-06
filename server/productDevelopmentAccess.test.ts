import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDevProjectByWorkspace: vi.fn(),
  actorFromContext: vi.fn(() => ({ id: 41, role: "product_dev" })),
  assertResourceAction: vi.fn(),
  recordSecurityAuditLog: vi.fn(),
  workspaceIdFromContext: vi.fn(() => 17),
}));

vi.mock("./devDb", () => ({
  getDevProjectByWorkspace: mocks.getDevProjectByWorkspace,
}));

vi.mock("./services/securityGovernance", () => ({
  actorFromContext: mocks.actorFromContext,
  assertResourceAction: mocks.assertResourceAction,
  recordSecurityAuditLog: mocks.recordSecurityAuditLog,
  workspaceIdFromContext: mocks.workspaceIdFromContext,
}));

import {
  recordProductDevelopmentAudit,
  resolveDevProjectAccess,
} from "./domains/product_development/security/productDevelopmentAccess";
import { productDevelopmentActionFromProcedure } from "./domains/product_development/security/productDevelopmentProcedure";

const ctx = { user: { id: 41, role: "product_dev" }, workspaceId: 17 } as any;

describe("product development access decisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actorFromContext.mockReturnValue({ id: 41, role: "product_dev" });
    mocks.workspaceIdFromContext.mockReturnValue(17);
  });

  it("authorizes a project through its current workspace and owner", async () => {
    mocks.getDevProjectByWorkspace.mockResolvedValue({ id: 88, workspaceId: 17, userId: 41 });

    await expect(resolveDevProjectAccess(88, ctx, "update")).resolves.toMatchObject({ id: 88 });

    expect(mocks.getDevProjectByWorkspace).toHaveBeenCalledWith(88, 17, 41);
    expect(mocks.assertResourceAction).toHaveBeenCalledWith(expect.objectContaining({
      resource: "product_development",
      action: "update",
      workspaceId: 17,
      projectId: 88,
      ownerUserId: 41,
    }));
  });

  it("hides cross-workspace projects and records the denied access", async () => {
    mocks.getDevProjectByWorkspace.mockResolvedValue(null);

    await expect(resolveDevProjectAccess(99, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(mocks.assertResourceAction).not.toHaveBeenCalled();
    expect(mocks.recordSecurityAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 17,
      action: "product_development.read",
      resourceId: 99,
      projectId: 99,
      status: "denied",
      riskLevel: "high",
    }));
  });

  it("records critical state changes in the active workspace", async () => {
    await recordProductDevelopmentAudit({
      ctx,
      action: "product_development.project.approve",
      projectId: 88,
      riskLevel: "high",
      afterSnapshot: { status: "completed" },
    });

    expect(mocks.recordSecurityAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 17,
      action: "product_development.project.approve",
      resourceType: "dev_project",
      resourceId: 88,
      projectId: 88,
      riskLevel: "high",
    }));
  });

  it("maps product-development endpoints to explicit permission actions", () => {
    expect(productDevelopmentActionFromProcedure("devProject.list", "query")).toBe("read");
    expect(productDevelopmentActionFromProcedure("devProject.create", "mutation")).toBe("create");
    expect(productDevelopmentActionFromProcedure("devProject.uploadFile", "mutation")).toBe("upload");
    expect(productDevelopmentActionFromProcedure("devProject.delete", "mutation")).toBe("delete");
    expect(productDevelopmentActionFromProcedure("devAnalysis.runStage", "mutation")).toBe("run");
    expect(productDevelopmentActionFromProcedure("devAnalysis.confirmStage", "mutation")).toBe("confirm");
    expect(productDevelopmentActionFromProcedure("devProject.update", "mutation")).toBe("update");
  });
});
