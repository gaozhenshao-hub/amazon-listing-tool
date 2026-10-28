import { defaultDesignParams } from "../../../shared/designStudio";
import { sql } from "drizzle-orm";
import {
  requireDb,
  withDbTransaction,
  type DbExecutor,
} from "../../repositories/dbClient";

export type Scope = { workspaceId: number; userId: number };
export async function execute(
  query: string,
  values: unknown[] = [],
  tx?: DbExecutor
): Promise<any> {
  const pieces = query.split("?");
  if (pieces.length !== values.length + 1)
    throw new Error("Design SQL parameter mismatch");
  const statement = sql.empty();
  pieces.forEach((piece, index) => {
    statement.append(sql.raw(piece));
    if (index < values.length) statement.append(sql`${values[index]}`);
  });
  const result = await (tx || (await requireDb("Design studio"))).execute(
    statement
  );
  return result[0];
}
export const transaction = <T>(callback: (tx: DbExecutor) => Promise<T>) =>
  withDbTransaction("Design studio", callback, { required: true });
export const jsonValue = <T>(value: any, fallback: T): T =>
  value == null
    ? fallback
    : typeof value === "string"
      ? JSON.parse(value)
      : value;
export async function ownConversation(
  id: string,
  scope: Scope,
  tx?: DbExecutor,
  lock = false
) {
  return (
    await execute(
      `SELECT * FROM design_conversations WHERE id=? AND workspaceId=? AND userId=? AND deletedAt IS NULL${lock ? " FOR UPDATE" : ""}`,
      [id, scope.workspaceId, scope.userId],
      tx
    )
  )[0];
}
export async function ownAsset(id: string, scope: Scope) {
  return (
    await execute(
      "SELECT * FROM design_assets WHERE id=? AND workspaceId=? AND userId=?",
      [id, scope.workspaceId, scope.userId]
    )
  )[0];
}
export function presentGeneration(row: any) {
  const stored = jsonValue<any>(row.params, {});
  const batch = stored.batch;
  return {
    id: String(row.id),
    prompt: String(row.prompt),
    status: String(row.status),
    params: { ...defaultDesignParams, ...stored, batch: undefined },
    batch:
      batch &&
      typeof batch.id === "string" &&
      [2, 4, 8].includes(batch.total) &&
      Number.isInteger(batch.index) &&
      batch.index >= 1 &&
      batch.index <= batch.total
        ? {
            id: String(batch.id),
            index: Number(batch.index),
            total: Number(batch.total),
          }
        : null,
    referenceIds: jsonValue<string[]>(row.referenceIds, []),
    assetIds: jsonValue<string[]>(row.assetIds, []),
    progress: Number(row.progress),
    error: row.errorText as string | null,
    canCheck: !!row.providerTaskId,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}
