import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireDb: vi.fn(), audit: vi.fn(), resourceAccess: vi.fn(),
}));
vi.mock("./domains/ops/legacy/repository", async importOriginal => ({
  ...await importOriginal<typeof import("./domains/ops/legacy/repository")>(),
  requireOpsDb: mocks.requireDb,
}));
vi.mock("./services/securityGovernance", async importOriginal => ({
  ...await importOriginal<typeof import("./services/securityGovernance")>(),
  workspaceIdFromContext: (ctx: { workspaceId?: number }) => ctx.workspaceId,
  actorFromContext: (ctx: { user: { id: number; role: string } }) => ctx.user,
  assertResourceAction: mocks.resourceAccess,
  recordSecurityAuditLog: mocks.audit,
}));

import { router } from "./_core/trpc";
import type { TrpcContext } from "./_core/context";
import { opsImportProcedures } from "./domains/ops/routers/imports";

const exportRouter = router(opsImportProcedures);
const caller = (role: "super_admin" | "user") => exportRouter.createCaller({
  user: { id: 10, role, name: "Reviewer", openId: "export-review" } as TrpcContext["user"],
  workspaceId: 7,
  req: { headers: {} } as TrpcContext["req"],
  res: {} as TrpcContext["res"],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.audit.mockResolvedValue(undefined);
  mocks.resourceAccess.mockResolvedValue(undefined);
  const rows = [
    { parentAsin: "B000000001", title: "Product A", operator: "Alice", country: "US", weekStartDate: "2026-01-01" },
    { parentAsin: "B000000002", title: "Product B", operator: "Bob", country: "US", weekStartDate: "2026-01-01" },
  ];
  mocks.requireDb.mockResolvedValue({ select: () => ({ from: () => ({ where: () => ({ orderBy: async () => rows }) }) }) });
});

describe("运营计划/复盘模板下载门禁", () => {
  it.each(["downloadPlanTemplate", "downloadReviewTemplate"] as const)("%s rejects ordinary users before any database read", async (endpoint) => {
    await expect(caller("user")[endpoint]({ marketplace: "ALL" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.requireDb).not.toHaveBeenCalled();
  });

  it.each(["downloadPlanTemplate", "downloadReviewTemplate"] as const)("%s includes products of different owners in the same workspace for super_admin", async (endpoint) => {
    const result = await caller("super_admin")[endpoint]({ marketplace: "ALL" });
    expect(result.productCount).toBe(2);
    expect(result.base64Data.length).toBeGreaterThan(20);
    expect(mocks.requireDb).toHaveBeenCalledOnce();
  });
});
