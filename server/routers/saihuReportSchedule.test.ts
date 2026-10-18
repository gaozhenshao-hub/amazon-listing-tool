import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { saihuReportScheduleRouter } from "./saihuReportSchedule";
import { saihuReportScheduleRepository } from "../domains/ops/saihuReportScheduleRepository";
const ctx = {
    user: { id: 3, role: "super_admin", defaultWorkspaceId: 7 },
    workspaceId: 7,
  } as TrpcContext,
  scope = {
    expectedWorkspaceId: 7,
    planId: "11111111-1111-4111-8111-111111111111",
  },
  op = {
    ...scope,
    operationId: "22222222-2222-4222-8222-222222222222",
    action: "save" as const,
  };
afterEach(() => vi.restoreAllMocks());
describe("actual assembled Saihu schedule tRPC surface", () => {
  it("imports appRouter and exposes only nine explicit governed plan operations", () => {
    expect(Object.keys(saihuReportScheduleRouter._def.procedures)).toEqual([
      "list",
      "sourceOptions",
      "read",
      "activationPreview",
      "save",
      "pause",
      "activate",
      "check",
      "cancel",
    ]);
    expect(
      Object.entries(appRouter._def.procedures).some(
        ([name]) => name === "opsSaihuSchedule.activate"
      )
    ).toBe(true);
  });
  it("actual app caller passes identity and original recovery UUID, with no implicit activation", async () => {
    const check = vi
        .spyOn(saihuReportScheduleRepository, "check")
        .mockResolvedValue(null),
      activate = vi.spyOn(saihuReportScheduleRepository, "activate");
    expect(
      await appRouter.createCaller(ctx).opsSaihuSchedule.check(op)
    ).toBeNull();
    expect(check).toHaveBeenCalledWith({ userId: 3, workspaceId: 7 }, op);
    expect(activate).not.toHaveBeenCalled();
  });
  it("rejects anonymous, workspace switch and caller authority before repository", async () => {
    const read = vi.spyOn(saihuReportScheduleRepository, "read");
    await expect(
      saihuReportScheduleRouter.createCaller({ ...ctx, user: null }).read(scope)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      saihuReportScheduleRouter
        .createCaller({ ...ctx, workspaceId: 8 })
        .read(scope)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      saihuReportScheduleRouter
        .createCaller(ctx)
        .read({ ...scope, ownerId: 4 } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(read).not.toHaveBeenCalled();
  });
  it("cannot use a missing or false human scope gate to activate", async () => {
    const activate = vi.spyOn(saihuReportScheduleRepository, "activate");
    await expect(
      saihuReportScheduleRouter
        .createCaller(ctx)
        .activate({
          ...scope,
          operationId: op.operationId,
          expectedVersionHash: "a".repeat(64),
          expectedActivationHash: "b".repeat(64),
          confirmFullScope: false,
          confirmNextOccurrence: true,
        } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(activate).not.toHaveBeenCalled();
  });
});
