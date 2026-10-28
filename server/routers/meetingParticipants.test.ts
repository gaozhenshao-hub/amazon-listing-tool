import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
const state = vi.hoisted(() => ({
  saved: null as any,
  members: [
    { id: 7, name: "运营甲" },
    { id: 8, name: "运营乙" },
  ],
  permission: vi.fn(),
}));
vi.mock("../services/securityGovernance", () => ({
  actorFromContext: (ctx: any) => ctx.user,
  workspaceIdFromContext: (ctx: any) => ctx.user?.defaultWorkspaceId,
  assertResourceAction: state.permission,
  recordSecurityAuditLog: vi.fn(),
}));
vi.mock("../repositories/dbClient", () => ({
  getDb: async () => ({
    select: () => ({
      from: () => ({ where: () => ({ orderBy: async () => state.members }) }),
    }),
    insert: () => ({
      values: async (value: any) => {
        state.saved = value;
        return [{ insertId: 3 }];
      },
    }),
  }),
}));
vi.mock("../domains/ai_os/services/businessSkillGateway", () => ({
  invokeBusinessSkill: vi.fn(),
}));
vi.mock("../_core/voiceTranscription", () => ({ transcribeAudio: vi.fn() }));
import { taskManagementRouter } from "./taskManagement";
const caller = (role: string) =>
  taskManagementRouter.createCaller({
    user: { id: 7, role, defaultWorkspaceId: 11 },
  } as TrpcContext);
const input = {
  date: "2026-10-22",
  text: "本次会议讨论库存核对，请核对库存并提交结果。",
  participantIds: [7, 8],
  title: "库存核对",
};
beforeEach(() => {
  state.saved = null;
  state.permission.mockReset();
});
describe("operator meeting authoring", () => {
  it.each(["ops_specialist", "ops_manager", "admin"])(
    "lets %s create a dated meeting with attendees without ERP write permissions",
    async role => {
      expect(await caller(role).saveMeetingNotes(input)).toEqual({ id: 3 });
      expect(state.saved).toMatchObject({
        workspaceId: 11,
        userId: 7,
        title: "10月22号库存核对",
      });
      expect(JSON.parse(state.saved.extractedTasks)).toMatchObject({
        titleSource: "manual",
        participants: state.members,
      });
      expect(
        state.permission.mock.calls.map(([value]) => [
          value.resource,
          value.action,
        ])
      ).toEqual([
        ["ops_data", "read"],
        ["ops_task", "create"],
      ]);
    }
  );
  it("marks an omitted subject for automatic naming", async () => {
    await caller("ops_specialist").saveMeetingNotes({ ...input, title: "" });
    expect(JSON.parse(state.saved.extractedTasks).titleSource).toBe("auto");
  });
  it("rejects missing or foreign/inactive attendees without writing", async () => {
    await expect(
      caller("ops_specialist").saveMeetingNotes({
        ...input,
        participantIds: [],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller("ops_specialist").saveMeetingNotes({
        ...input,
        participantIds: [999],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.saved).toBeNull();
  });
  it("does not open meeting authoring to non-operating roles", async () => {
    await expect(
      caller("designer").saveMeetingNotes(input)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.saved).toBeNull();
  });
});
