import { createHash, randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { requireDb, type DbExecutor } from "../../repositories/dbClient";
import {
  researchBookmarkSchema,
  researchIdentity,
  researchThumbnail,
} from "../../../shared/researchLibrary";
import type { z } from "zod";
export type ResearchScope = {
  workspaceId: number;
  userId: number;
  role: string;
};
export const researchAdmin = (scope: ResearchScope) =>
  ["admin", "super_admin"].includes(scope.role);
export const researchHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const researchRows = async (tx: DbExecutor, query: SQL) =>
  (await tx.execute(query))[0] as Record<string, any>[];
export async function collectResearch(
  scope: ResearchScope,
  input: z.infer<typeof researchBookmarkSchema>
) {
  const data = researchBookmarkSchema.parse(input);
  let identity: ReturnType<typeof researchIdentity>;
  try {
    identity = researchIdentity(data.kind, data.url);
  } catch (e) {
    throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
  }
  const db = await requireDb("collect research product"),
    key = researchHash(identity.key);
  return db.transaction(async tx => {
    await tx.execute(
      sql`INSERT INTO research_bookmarks(id,workspace_id,user_id,kind,identity_hash,site,asin,title,url,thumbnail,price,brand) VALUES(${randomUUID()},${scope.workspaceId},${scope.userId},${data.kind},${key},${identity.site},${identity.asin},${data.title},${identity.url},${researchThumbnail(data.thumbnail)},${data.price},${data.brand}) ON DUPLICATE KEY UPDATE deleted_at=NULL`
    );
    const [row] = await researchRows(
      tx,
      sql`SELECT id,title FROM research_bookmarks WHERE workspace_id=${scope.workspaceId} AND user_id=${scope.userId} AND kind=${data.kind} AND identity_hash=${key}`
    );
    return {
      id: String(row.id),
      title: String(row.title),
      message: data.kind === "product" ? "已加入产品库" : "已收藏店铺",
    };
  });
}
export async function listResearch(
  scope: ResearchScope,
  input: {
    kind: "product" | "store";
    query: string;
    ownerId?: number;
    site?: string;
    state?: string;
    page: number;
  }
) {
  if (input.ownerId && input.ownerId !== scope.userId && !researchAdmin(scope))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "只能查看自己收集的资料",
    });
  const owner =
      input.ownerId || (!researchAdmin(scope) ? scope.userId : undefined),
    db = await requireDb("list research products"),
    filter = sql`workspace_id=${scope.workspaceId} AND deleted_at IS NULL AND kind=${input.kind}`;
  if (owner) filter.append(sql` AND user_id=${owner}`);
  if (input.site) filter.append(sql` AND site=${input.site}`);
  if (input.state) filter.append(sql` AND state=${input.state}`);
  if (input.query) {
    const pattern = `%${input.query}%`;
    filter.append(
      sql` AND (title LIKE ${pattern} OR asin LIKE ${pattern} OR brand LIKE ${pattern} OR note LIKE ${pattern})`
    );
  }
  const [{ n }] = await researchRows(
    db,
    sql`SELECT COUNT(*) n FROM research_bookmarks WHERE ${filter}`
  );
  const rows = await researchRows(
    db,
    sql`SELECT b.*,u.name AS collector FROM research_bookmarks b LEFT JOIN users u ON u.id=b.user_id WHERE b.id IN (SELECT id FROM research_bookmarks WHERE ${filter}) ORDER BY b.created_at DESC,b.id DESC LIMIT 24 OFFSET ${(input.page - 1) * 24}`
  );
  return {
    items: rows.map(r => ({
      id: String(r.id),
      kind: r.kind as "product" | "store",
      title: String(r.title),
      url: String(r.url),
      thumbnail: String(r.thumbnail || ""),
      site: String(r.site),
      asin: r.asin as string | null,
      price: String(r.price || ""),
      brand: String(r.brand || ""),
      note: String(r.note || ""),
      state: r.state as "pending" | "researching" | "valuable" | "archived",
      collector: String(r.collector || "未命名用户"),
      userId: Number(r.user_id),
      revision: Number(r.revision),
      createdAt: new Date(r.created_at).toISOString(),
    })),
    total: Number(n),
    page: input.page,
    canSeeAll: researchAdmin(scope),
  };
}
export async function researchCollectors(scope: ResearchScope) {
  const db = await requireDb("research collectors");
  return researchRows(
    db,
    sql`SELECT DISTINCT u.id,u.name FROM research_bookmarks b JOIN users u ON u.id=b.user_id WHERE b.workspace_id=${scope.workspaceId} AND b.deleted_at IS NULL ${researchAdmin(scope) ? sql`` : sql`AND b.user_id=${scope.userId}`} ORDER BY u.name,u.id`
  );
}
export async function updateResearch(
  scope: ResearchScope,
  input: { id: string; note: string; state: string; revision: number }
) {
  const db = await requireDb("update research bookmark");
  const [row] = await researchRows(
    db,
    sql`SELECT id,user_id FROM research_bookmarks WHERE id=${input.id} AND workspace_id=${scope.workspaceId} AND deleted_at IS NULL`
  );
  if (!row || (!researchAdmin(scope) && Number(row.user_id) !== scope.userId))
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "收藏资料不存在或无权编辑",
    });
  const result = await db.execute(
    sql`UPDATE research_bookmarks SET note=${input.note},state=${input.state},revision=revision+1 WHERE id=${input.id} AND workspace_id=${scope.workspaceId} AND user_id=${row.user_id} AND revision=${input.revision}`
  );
  if (!(result[0] as any).affectedRows)
    throw new TRPCError({
      code: "CONFLICT",
      message: "调研记录已更新，请重新打开，避免覆盖他人的修改",
    });
  return { ok: true };
}
