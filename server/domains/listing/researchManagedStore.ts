import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  listingAggregationSchema,
  emptyListingAggregation,
  type ListingAggregation,
} from "../../../shared/listingAggregation";
import { requireDb, type DbExecutor } from "../../repositories/dbClient";
import type { PlanningScope } from "./imagePlanningStore";
import { assertResearchEditable } from "./researchLocks";
import type { ResearchPage } from "../../../shared/researchCategories";
export async function mutateResearchManaged<T>(
  scope: PlanningScope,
  page: ResearchPage,
  change: (data: ListingAggregation, tx: DbExecutor) => Promise<T>,
  options: { readOnly?: boolean; allowLockedSelling?: boolean } = {}
) {
  return (await requireDb("save research supplement")).transaction(async tx => {
    const [parents] = await tx.execute(
      sql`SELECT id FROM projects WHERE id=${scope.projectId} AND workspaceId=${scope.workspaceId} AND userId=${scope.userId} FOR UPDATE`
    );
    if (!(parents as unknown as any[]).length)
      throw new TRPCError({ code: "NOT_FOUND", message: "项目不可访问" });
    if (page !== "selling" || !options.allowLockedSelling)
      await assertResearchEditable(scope, page, tx);
    const [rows] = await tx.execute(
      sql`SELECT data,revision FROM listing_aggregations WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId} FOR UPDATE`
    );
    const row = (rows as unknown as any[])[0];
    const data = row
      ? listingAggregationSchema.parse(
          typeof row.data === "string" ? JSON.parse(row.data) : row.data
        )
      : emptyListingAggregation();
    const original = JSON.stringify(data);
    const result = await change(data, tx);
    if (options.readOnly)
      return { result, revision: Number(row?.revision || 0) };
    const encoded = JSON.stringify(listingAggregationSchema.parse(data));
    if (row && encoded === original)
      return { result, revision: Number(row.revision) };
    if (row)
      await tx.execute(
        sql`UPDATE listing_aggregations SET data=${encoded},revision=revision+1 WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId}`
      );
    else
      await tx.execute(
        sql`INSERT INTO listing_aggregations(project_id,workspace_id,data,revision) VALUES(${scope.projectId},${scope.workspaceId},${encoded},1)`
      );
    return { result, revision: Number(row?.revision || 0) + 1 };
  });
}
