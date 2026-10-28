import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ record: null as any, invoke: vi.fn(), where: [] as any[] }));
vi.mock("../../repositories/dbClient", () => ({ getDb: async () => db }));
vi.mock("../ai_os/services/businessSkillGateway", () => ({ invokeBusinessSkill: state.invoke }));
const db: any = {
  transaction: async (fn: any) => fn(db),
  select: (fields?: any) => ({ from: () => ({ where: (where: any) => {
    state.where.push(where);
    if (fields) return Promise.resolve([{ name: "李宇航" }]);
    return { limit: () => ({ for: async () => state.record ? [{ ...state.record }] : [] }) };
  } }) }),
  update: () => ({ set: (patch: any) => ({ where: async () => Object.assign(state.record, patch) }) }),
  insert: () => ({ ignore: () => ({ values: async () => undefined }) }),
};
import { analyzeMeetingNotes, meetingSkillSlug } from "./meetingNotes";
const metadata = () => JSON.parse(state.record.extractedTasks);
const task = { title: "核对尺寸", description: "", assigneeName: "李宇航", dueDate: "2026-10-22", productHint: null, category: "其他", evidence: "李宇航明天核对尺寸" };
beforeEach(() => {
  state.invoke.mockReset(); state.where = [];
  state.record = { id: 1, transcript: "李宇航明天核对尺寸", createdAt: new Date(), updatedAt: new Date(), status: "done", extractedTasks: JSON.stringify({ version: 2, date: "2026-10-21", summary: "", tasks: [], tasksExtracted: false }) };
  state.invoke.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ summary: "尺寸待核对", tasks: [task] }) } }] });
});
describe("meeting analysis lifecycle", () => {
  it("generates a dated subject and passes attendees as preferred matches", async () => {
    const data=metadata(); data.titleSource="auto"; data.participants=[{id:5,name:"李宇航"}];
    state.record.extractedTasks=JSON.stringify(data);
    state.invoke.mockResolvedValue({choices:[{message:{content:JSON.stringify({title:"商品尺寸核对",summary:"尺寸待核对",tasks:[]})}}]});
    await analyzeMeetingNotes({userId:8,workspaceId:2},1,"summary");
    expect(state.record.title).toBe("10月21号商品尺寸核对");
    expect(JSON.parse(state.invoke.mock.calls[0][0].messages[0].content).participants).toEqual(data.participants);
    expect(metadata().participants).toEqual(data.participants);
  });
  it("never overwrites a manually supplied subject", async () => {
    state.record.title="10月21号手写主题";
    state.record.extractedTasks=JSON.stringify({...metadata(),titleSource:"manual"});
    state.invoke.mockResolvedValue({choices:[{message:{content:JSON.stringify({title:"模型主题",summary:"纪要",tasks:[]})}}]});
    await analyzeMeetingNotes({userId:8,workspaceId:2},1,"summary");
    expect(state.record.title).toBe("10月21号手写主题");
  });
  it("uses the dedicated skill with explicit workspace and meeting date", async () => {
    const result = await analyzeMeetingNotes({ userId: 8, workspaceId: 2 }, 1, "tasks");
    expect(result.tasks[0].operationId).toMatch(/^[\da-f-]{36}$/);
    expect(result.tasks[0].taskId).toBeUndefined();
    expect(state.invoke.mock.calls[0][0].emperorSkill).toEqual({ slug: meetingSkillSlug, userId: 8, workspaceId: 2 });
    expect(JSON.parse(state.invoke.mock.calls[0][0].messages[0].content).meetingDate).toBe("2026-10-21");
    expect(state.record.status).toBe("done");
  });
  it("preserves the original text and previous results if AI fails", async () => {
    state.invoke.mockRejectedValue(new Error("provider unavailable"));
    await expect(analyzeMeetingNotes({ userId: 8, workspaceId: 2 }, 1, "summary")).rejects.toThrow("原始会议内容已保存");
    expect(state.record.transcript).toBe("李宇航明天核对尺寸");
    expect(state.record.status).toBe("error");
    expect(metadata().tasks).toEqual([]);
  });
  it("refuses task evidence not present in the meeting", async () => {
    state.invoke.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ summary: "纪要", tasks: [{ ...task, evidence: "张三今天做广告" }] }) } }] });
    await expect(analyzeMeetingNotes({ userId: 8, workspaceId: 2 }, 1, "tasks")).rejects.toThrow();
    expect(metadata().tasks).toEqual([]);
  });
  it("reuses extracted suggestions without calling or charging AI again", async () => {
    await analyzeMeetingNotes({ userId: 8, workspaceId: 2 }, 1, "tasks");
    const prior = metadata().tasks;
    await analyzeMeetingNotes({ userId: 8, workspaceId: 2 }, 1, "tasks");
    expect(state.invoke).toHaveBeenCalledTimes(1);
    expect(metadata().tasks).toEqual(prior);
  });
  it("does not erase a task confirmed while the summary was running", async () => {
    state.invoke.mockImplementation(async () => {
      const current = metadata(); current.tasks = [{ ...task, operationId: "test", taskId: 42 }]; current.tasksExtracted = true;
      state.record.extractedTasks = JSON.stringify(current);
      return { choices: [{ message: { content: JSON.stringify({ summary: "新纪要", tasks: [] }) } }] };
    });
    const result = await analyzeMeetingNotes({ userId: 8, workspaceId: 2 }, 1, "summary");
    expect(result.tasks[0].taskId).toBe(42);
    expect(result.tasksExtracted).toBe(true);
  });
  it("does not call AI for an inaccessible meeting", async () => {
    state.record = null;
    await expect(analyzeMeetingNotes({ userId: 8, workspaceId: 2 }, 1, "summary")).rejects.toThrow("会议记录不存在");
    expect(state.invoke).not.toHaveBeenCalled();
  });
});
