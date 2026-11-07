import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { requireDb, type DbExecutor } from "../../repositories/dbClient";
import {
  PAGE_KEYS,
  type ResearchPage,
} from "../../../shared/researchCategories";
type Scope = { projectId: number; workspaceId: number; userId: number };
export async function researchLocks(scope: Scope, executor?: DbExecutor) {
  const tx = executor || (await requireDb("read research locks"));
  const [rows] = await tx.execute(
    sql`SELECT a.data FROM projects p LEFT JOIN listing_aggregations a ON a.project_id=p.id AND a.workspace_id=p.workspaceId WHERE p.id=${scope.projectId} AND p.workspaceId=${scope.workspaceId} AND p.userId=${scope.userId}`
  );
  const row = (rows as unknown as any[])[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "项目不可访问" });
  const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
  return data?.pageLocks || ({} as Partial<Record<ResearchPage, boolean>>);
}
export async function assertResearchEditable(
  scope: Scope,
  pages: ResearchPage | ResearchPage[],
  executor?: DbExecutor
) {
  const locks = await researchLocks(scope, executor);
  if ((Array.isArray(pages) ? pages : [pages]).some(page => locks[page]))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "此页面已锁定，请先点击编辑解锁",
    });
}
export async function setResearchLock(
  scope: Scope,
  page: ResearchPage,
  locked: boolean,
  executor?: DbExecutor
) {
  const write = async (tx: DbExecutor) => {
    const [parents] = await tx.execute(
      sql`SELECT id FROM projects WHERE id=${scope.projectId} AND workspaceId=${scope.workspaceId} AND userId=${scope.userId} FOR UPDATE`
    );
    if (!(parents as unknown as any[]).length)
      throw new TRPCError({ code: "NOT_FOUND", message: "项目不可访问" });
    const [rows] = await tx.execute(
      sql`SELECT data,revision FROM listing_aggregations WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId} FOR UPDATE`
    );
    const row = (rows as unknown as any[])[0];
    const data = row
      ? typeof row.data === "string"
        ? JSON.parse(row.data)
        : row.data
      : { selling: [], reviews: [], questions: [], marks: [] };
    data.pageLocks = { ...data.pageLocks, [page]: locked };
    if (row)
      await tx.execute(
        sql`UPDATE listing_aggregations SET data=${JSON.stringify(data)},revision=revision+1 WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId}`
      );
    else
      await tx.execute(
        sql`INSERT INTO listing_aggregations(project_id,workspace_id,data,revision) VALUES(${scope.projectId},${scope.workspaceId},${JSON.stringify(data)},1)`
      );
    return {
      page,
      locked,
      revision: Number(row?.revision || 0) + 1,
      pageLocks: data.pageLocks as Partial<
        Record<(typeof PAGE_KEYS)[number], boolean>
      >,
    };
  };
  return executor
    ? write(executor)
    : (await requireDb("lock research page")).transaction(write);
}
