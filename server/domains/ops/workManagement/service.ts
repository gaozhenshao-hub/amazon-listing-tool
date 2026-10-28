import type { z } from "zod";
import { opsWorkRepository as repository } from "./repository";
import type {
  addKeywordMonitorInput,
  addKeywordSnapshotInput,
  createLogInput,
  createTodoInput,
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
