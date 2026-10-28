import { asc, desc, eq } from "drizzle-orm";
import { databaseUnavailableError } from "../../../_core/domainError";
import { getDb } from "../../../repositories/dbClient";
import { opsWorkspaceCondition } from "../../../repositories/ops";
import { keywordMonitors, keywordSnapshots, productLogs, productTodos } from "../schema";
import { currentOpsWorkspaceId } from "../workspaceContext";

async function dbClient() {
  const db = await getDb();
  if (!db) throw databaseUnavailableError("ops");
  return db;
}

export const opsWorkRepository = {
  async listTodos(productId: number) {
    const db = await dbClient();
    return db.select().from(productTodos)
      .where(opsWorkspaceCondition(productTodos, currentOpsWorkspaceId(), eq(productTodos.productId, productId)))
      .orderBy(asc(productTodos.sortOrder), desc(productTodos.createdAt));
  },
  async createTodo(values: typeof productTodos.$inferInsert) {
    const db = await dbClient();
    const [result] = await db.insert(productTodos).values(values);
    return Number(result.insertId);
  },
  async updateTodo(id: number, values: Record<string, unknown>) {
    const db = await dbClient();
    await db.update(productTodos).set(values)
      .where(opsWorkspaceCondition(productTodos, currentOpsWorkspaceId(), eq(productTodos.id, id)));
  },
  async deleteTodo(id: number) {
    const db = await dbClient();
    await db.delete(productTodos)
      .where(opsWorkspaceCondition(productTodos, currentOpsWorkspaceId(), eq(productTodos.id, id)));
  },
  async listLogs(productId: number) {
    const db = await dbClient();
    return db.select().from(productLogs)
      .where(opsWorkspaceCondition(productLogs, currentOpsWorkspaceId(), eq(productLogs.productId, productId)))
      .orderBy(desc(productLogs.createdAt));
  },
  async createLog(values: typeof productLogs.$inferInsert) {
    const db = await dbClient();
    const [result] = await db.insert(productLogs).values(values);
    return Number(result.insertId);
  },
  async deleteLog(id: number) {
    const db = await dbClient();
    await db.delete(productLogs)
      .where(opsWorkspaceCondition(productLogs, currentOpsWorkspaceId(), eq(productLogs.id, id)));
  },
  async listKeywordMonitors(productId: number) {
    const db = await dbClient();
    const monitors = await db.select().from(keywordMonitors)
      .where(opsWorkspaceCondition(keywordMonitors, currentOpsWorkspaceId(), eq(keywordMonitors.productId, productId)))
      .orderBy(desc(keywordMonitors.createdAt));
    return Promise.all(monitors.map(async (monitor) => {
      const snapshots = await db.select().from(keywordSnapshots)
        .where(opsWorkspaceCondition(keywordSnapshots, currentOpsWorkspaceId(), eq(keywordSnapshots.keywordMonitorId, monitor.id)))
        .orderBy(desc(keywordSnapshots.snapshotDate))
        .limit(7);
      return { ...monitor, recentSnapshots: snapshots.reverse() };
    }));
  },
  async createKeywordMonitor(values: typeof keywordMonitors.$inferInsert) {
    const db = await dbClient();
    const [result] = await db.insert(keywordMonitors).values(values);
    return Number(result.insertId);
  },
  async deleteKeywordMonitor(id: number) {
    const db = await dbClient();
    await db.delete(keywordSnapshots)
      .where(opsWorkspaceCondition(keywordSnapshots, currentOpsWorkspaceId(), eq(keywordSnapshots.keywordMonitorId, id)));
    await db.delete(keywordMonitors)
      .where(opsWorkspaceCondition(keywordMonitors, currentOpsWorkspaceId(), eq(keywordMonitors.id, id)));
  },
  async createKeywordSnapshot(values: typeof keywordSnapshots.$inferInsert) {
    const db = await dbClient();
    const [result] = await db.insert(keywordSnapshots).values(values);
    return Number(result.insertId);
  },
};
