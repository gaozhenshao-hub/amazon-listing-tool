import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
const database = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../repositories/dbClient", () => database);
vi.mock("../domains/ops/workspaceProcedure", async () => ({
  protectedProcedure: (await import("../_core/trpc")).protectedProcedure,
}));
vi.mock("../domains/ai_os/services/businessSkillGateway", () => ({ invokeBusinessSkill: vi.fn() }));
vi.mock("../_core/voiceTranscription", () => ({ transcribeAudio: vi.fn() }));
import { taskManagementRouter } from "./taskManagement";
beforeEach(() => vi.clearAllMocks());
describe("consolidated task auxiliary boundary", () => {
  it("no longer exposes a second task CRUD or directory through the legacy router", () => {
    const procedures = Object.keys(taskManagementRouter._def.procedures);
    for (const name of ["listAllTasks", "createGlobalTask", "batchCreateTasks", "getTaskStats", "getAssignees", "searchProducts"]) expect(procedures).not.toContain(name);
    expect(procedures).toContain("extractTasksFromText");
    expect(procedures).toContain("listMeetingRecords");
    expect(procedures).toContain("updateReminderSettings");
  });
  it.each(["designer", "finance", "viewer"])("does not expose admin meeting records to %s", async role => {
    const caller = taskManagementRouter.createCaller({ user: { id: 7, role, defaultWorkspaceId: 11 } } as TrpcContext);
    await expect(caller.listMeetingRecords({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.extractTasksFromText({ text: "这是测试用的会议文本内容" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(database.getDb).not.toHaveBeenCalled();
  });
  it("requires authentication before auxiliary reads", async () => {
    await expect(taskManagementRouter.createCaller({ user: null } as TrpcContext).listMeetingRecords({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(database.getDb).not.toHaveBeenCalled();
  });
});
