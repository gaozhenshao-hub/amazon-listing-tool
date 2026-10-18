import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { saihuReportRepository } from "../domains/ops/saihuReportRepository";
import { saihuReportSyncRouter } from "./saihuReportSync";

const context = {
  user: { id: 3, role: "super_admin", defaultWorkspaceId: 7 },
  workspaceId: 7,
} as TrpcContext;
const input = {
  expectedWorkspaceId: 7,
  operationId: "11111111-1111-4111-8111-111111111111",
  runOperationId: "22222222-2222-4222-8222-222222222222",
  expectedPreviewHash: "a".repeat(64),
  expectedHistoryHash: "b".repeat(64),
  fullScopeAcknowledged: true as const,
};

afterEach(() => vi.restoreAllMocks());

describe("Saihu report actual tRPC registration and caller", () => {
  it("imports the assembled app router without reserved procedure keys", () => {
    expect(
      Object.entries(appRouter._def.procedures).find(
        ([name]) => name === "opsSaihuReport.applyPreview"
      )?.[1]
    ).toBe(saihuReportSyncRouter._def.procedures.applyPreview);
    expect(
      Object.prototype.hasOwnProperty.call(
        saihuReportSyncRouter._def.procedures,
        "apply"
      )
    ).toBe(false);
    expect(saihuReportSyncRouter._def.procedures.applyPreview._def.type).toBe(
      "mutation"
    );
  });

  it("uses the real local createCaller and passes authenticated scope to the internal apply method", async () => {
    const apply = vi.spyOn(saihuReportRepository, "apply").mockResolvedValue({
      status: "committed",
    } as never);
    expect(
      await saihuReportSyncRouter.createCaller(context).applyPreview(input)
    ).toEqual({ status: "committed" });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ userId: 3, workspaceId: 7 }, input);
  });

  it("uses the assembled app createCaller for the same public applyPreview RPC", async () => {
    const apply = vi.spyOn(saihuReportRepository, "apply").mockResolvedValue({
      status: "committed",
    } as never);
    await appRouter.createCaller(context).opsSaihuReport.applyPreview(input);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ userId: 3, workspaceId: 7 }, input);
  });

  it("rejects anonymous, switched workspace and caller authority injection before the repository", async () => {
    const apply = vi.spyOn(saihuReportRepository, "apply");
    await expect(
      saihuReportSyncRouter
        .createCaller({ ...context, user: null })
        .applyPreview(input)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      saihuReportSyncRouter
        .createCaller({ ...context, workspaceId: 8 })
        .applyPreview(input)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      saihuReportSyncRouter
        .createCaller(context)
        .applyPreview({ ...input, userId: 4 } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(apply).not.toHaveBeenCalled();
  });
});
