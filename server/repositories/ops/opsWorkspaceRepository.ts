import { and, eq, type SQL } from "drizzle-orm";
import { requireDb } from "../dbClient";

type WorkspaceTable = { workspaceId: unknown };

export function requireWorkspaceId(workspaceId?: number | null): number {
  if (!workspaceId) throw new Error("Operations repository requires a workspaceId");
  return workspaceId;
}

export function opsWorkspaceCondition(table: WorkspaceTable, workspaceId?: number | null, condition?: SQL) {
  const scope = eq(table.workspaceId as never, requireWorkspaceId(workspaceId));
  return condition ? and(scope, condition) : scope;
}

export function withOpsWorkspace<T extends Record<string, unknown>>(workspaceId: number | null | undefined, values: T) {
  return { ...values, workspaceId: requireWorkspaceId(workspaceId) };
}

export async function requireOpsDb() {
  return requireDb("Operations repository");
}
