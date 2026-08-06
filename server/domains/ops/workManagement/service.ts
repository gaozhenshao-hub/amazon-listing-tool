import type { z } from "zod";
import { opsWorkRepository as repository } from "./repository";
import type {
  addKeywordMonitorInput,
  addKeywordSnapshotInput,
  createLogInput,
  createTeamTaskInput,
  createTodoInput,
  moveTeamTaskInput,
  updateTeamTaskInput,
  updateTodoInput,
} from "./schema";

function definedValues(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

export const opsWorkService = {
  listTodos: repository.listTodos,
  async createTodo(userId: number, input: z.infer<typeof createTodoInput>) {
    return { id: await repository.createTodo({ ...input, userId }) };
  },
  async updateTodo(input: z.infer<typeof updateTodoInput>) {
    const { id, ...rest } = input;
    const values = definedValues(rest);
    if (input.status === "completed") values.completedAt = new Date();
    if (Object.keys(values).length > 0) await repository.updateTodo(id, values);
    return { updated: true };
  },
  async deleteTodo(id: number) {
    await repository.deleteTodo(id);
    return { deleted: true };
  },
  listLogs: repository.listLogs,
  async createLog(user: { id: number; name?: string | null }, input: z.infer<typeof createLogInput>) {
    return {
      id: await repository.createLog({
        ...input,
        userId: user.id,
        createdBy: user.name || "Unknown",
      }),
    };
  },
  async deleteLog(id: number) {
    await repository.deleteLog(id);
    return { deleted: true };
  },
  listTeamTasks: repository.listTeamTasks,
  async createTeamTask(userId: number, input: z.infer<typeof createTeamTaskInput>) {
    return { id: await repository.createTeamTask({ ...input, userId }) };
  },
  async updateTeamTask(input: z.infer<typeof updateTeamTaskInput>) {
    const { taskId, ...rest } = input;
    const values = definedValues(rest);
    if (input.status === "done") values.completedAt = new Date();
    if (Object.keys(values).length > 0) await repository.updateTeamTask(taskId, values);
    return { updated: true };
  },
  async deleteTeamTask(taskId: number) {
    await repository.deleteTeamTask(taskId);
    return { deleted: true };
  },
  async moveTeamTask(input: z.infer<typeof moveTeamTaskInput>) {
    const values: Record<string, unknown> = { status: input.newStatus };
    if (input.newStatus === "done") values.completedAt = new Date();
    await repository.updateTeamTask(input.taskId, values);
    return { moved: true };
  },
  async getTeamTaskStats(productProfileId: number) {
    const tasks = await repository.listTeamTasks(productProfileId);
    const byStatus: Record<string, number> = { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0 };
    const byAssignee: Record<string, { total: number; done: number; inProgress: number }> = {};
    const byCategory: Record<string, number> = {};
    for (const task of tasks) {
      byStatus[task.status] = (byStatus[task.status] || 0) + 1;
      const assignee = task.assigneeName || "未分配";
      byAssignee[assignee] ||= { total: 0, done: 0, inProgress: 0 };
      byAssignee[assignee].total += 1;
      if (task.status === "done") byAssignee[assignee].done += 1;
      if (task.status === "in_progress") byAssignee[assignee].inProgress += 1;
      if (task.category) byCategory[task.category] = (byCategory[task.category] || 0) + 1;
    }
    const overdue = tasks.filter((task) => (
      task.dueDate && task.status !== "done" && new Date(task.dueDate) < new Date()
    )).length;
    return { total: tasks.length, byStatus, byAssignee, byCategory, overdue };
  },
  listKeywordMonitors: repository.listKeywordMonitors,
  async addKeywordMonitor(userId: number, input: z.infer<typeof addKeywordMonitorInput>) {
    return { id: await repository.createKeywordMonitor({ ...input, userId }) };
  },
  async removeKeywordMonitor(id: number) {
    await repository.deleteKeywordMonitor(id);
    return { deleted: true };
  },
  async addKeywordSnapshot(input: z.infer<typeof addKeywordSnapshotInput>) {
    return { id: await repository.createKeywordSnapshot(input) };
  },
};
