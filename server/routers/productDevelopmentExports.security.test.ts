import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDevProjectByWorkspace: vi.fn(),
  actorFromContext: vi.fn(),
  assertResourceAction: vi.fn(),
  recordSecurityAuditLog: vi.fn(),
  workspaceIdFromContext: vi.fn(),
}));

vi.mock("../devDb", () => ({ getDevProjectByWorkspace: mocks.getDevProjectByWorkspace }));
vi.mock("../services/securityGovernance", () => ({
  actorFromContext: mocks.actorFromContext,
  assertResourceAction: mocks.assertResourceAction,
  recordSecurityAuditLog: mocks.recordSecurityAuditLog,
  workspaceIdFromContext: mocks.workspaceIdFromContext,
}));

import { resolveDevProjectExportAccess } from "../domains/product_development/security/productDevelopmentAccess";

const ctx = { user: { id: 900, role: "product_dev" }, workspaceId: 17 } as any;
const root = path.resolve(import.meta.dirname, "../..");
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("product development export authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actorFromContext.mockImplementation((value: any) => ({ id: value.user.id, role: value.user.role }));
    mocks.workspaceIdFromContext.mockReturnValue(17);
  });

  it("rejects ordinary users before project lookup or export data access", async () => {
    await expect(resolveDevProjectExportAccess(88, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.getDevProjectByWorkspace).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND for a cross-workspace project", async () => {
    mocks.getDevProjectByWorkspace.mockResolvedValue(null);
    const superAdminCtx = { user: { id: 900, role: "super_admin" }, workspaceId: 17 } as any;

    await expect(resolveDevProjectExportAccess(99, superAdminCtx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.assertResourceAction).not.toHaveBeenCalled();
    expect(mocks.recordSecurityAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "product_development.export",
      projectId: 99,
      status: "denied",
    }));
  });

  it("allows super_admin to export any project in the active workspace, regardless of owner", async () => {
    mocks.getDevProjectByWorkspace.mockResolvedValue({ id: 88, workspaceId: 17, userId: 1234 });
    const superAdminCtx = { user: { id: 900, role: "super_admin" }, workspaceId: 17 } as any;

    await expect(resolveDevProjectExportAccess(88, superAdminCtx)).resolves.toMatchObject({ id: 88 });
    expect(mocks.getDevProjectByWorkspace).toHaveBeenCalledWith(88, 17, 900);
    expect(mocks.assertResourceAction).toHaveBeenCalledWith(expect.objectContaining({
      action: "export",
      workspaceId: 17,
      ownerUserId: 1234,
    }));
  });

  it.each([
    ["server/routers/devManual.ts", "exportPdf", "storagePut"],
    ["server/routers/devPanorama.ts", "exportCsv", "getDb"],
    ["server/routers/devProjectTags.ts", "exportTagsCsv", "ensureDb"],
  ])("guards %s before sensitive access", (file, procedure, sensitiveCall) => {
    const text = source(file);
    const procedureStart = text.indexOf(`${procedure}:`);
    const guard = text.indexOf("resolveDevProjectExportAccess(input.projectId, ctx);", procedureStart);
    const sensitive = text.indexOf(`${sensitiveCall}(`, procedureStart);
    expect(procedureStart).toBeGreaterThanOrEqual(0);
    expect(guard).toBeGreaterThan(procedureStart);
    expect(sensitive).toBeGreaterThan(guard);
  });
});
