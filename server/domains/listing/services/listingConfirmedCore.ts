import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { listingCoreRevisions, listingFactRevisions } from "../../../../drizzle/schema/listingRevisions";
import { projectFiles } from "../../../../drizzle/schema/project";
import { isTemplateOrEmptyFact } from "../../../../shared/listingFactSafety";
import { getDb } from "../repository";

export async function resolveConfirmedListingCore(input: {
  projectId: number; workspaceId: number; coreRevisionId: number; coreInputHash: string;
}) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  const [core] = await db.select().from(listingCoreRevisions).where(and(
    eq(listingCoreRevisions.id, input.coreRevisionId), eq(listingCoreRevisions.workspaceId, input.workspaceId),
    eq(listingCoreRevisions.projectId, input.projectId), eq(listingCoreRevisions.status, "confirmed"),
    eq(listingCoreRevisions.inputHash, input.coreInputHash),
  )).limit(1);
  if (!core || !core.confirmedBy || !core.confirmedAt)
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "未找到当前已人工确认的卖点核心版本" });
  const [latestCore] = await db.select({ id: listingCoreRevisions.id }).from(listingCoreRevisions).where(and(
    eq(listingCoreRevisions.workspaceId, input.workspaceId), eq(listingCoreRevisions.projectId, input.projectId),
    eq(listingCoreRevisions.coreId, core.coreId),
  )).orderBy(desc(listingCoreRevisions.revision)).limit(1);
  if (latestCore?.id !== core.id)
    throw new TRPCError({ code: "CONFLICT", message: "卖点核心已有新修订，旧版本不得用于生成" });
  const ids = core.factRevisionIdsJson;
  if (!Array.isArray(ids) || ids.length < 1 || ids.some((id) => !Number.isInteger(id)) || new Set(ids).size !== ids.length)
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "卖点核心缺少可追溯的确认事实" });
  const rows = await db.select().from(listingFactRevisions).where(and(
    eq(listingFactRevisions.workspaceId, input.workspaceId), eq(listingFactRevisions.projectId, input.projectId),
    inArray(listingFactRevisions.id, ids as number[]),
  ));
  const [latestFile] = await db.select({ id: projectFiles.id, hash: projectFiles.rawContentHash,
    workspaceId: projectFiles.workspaceId, status: projectFiles.status, lifecycleState: projectFiles.lifecycleState }).from(projectFiles)
    .where(and(eq(projectFiles.projectId, input.projectId), eq(projectFiles.fileType, "product_attributes")))
    .orderBy(desc(projectFiles.createdAt), desc(projectFiles.id)).limit(1);
  if (!latestFile || latestFile.workspaceId !== input.workspaceId || latestFile.status !== "completed" ||
      latestFile.lifecycleState === "deleted" || !latestFile.hash ||
      rows.length !== ids.length || rows.some((row) => row.status !== "confirmed" || !row.confirmedBy ||
      !row.confirmedAt || row.sourceFileId !== latestFile.id || row.rawHash !== latestFile.hash || isTemplateOrEmptyFact(row.value)))
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "原始属性表或已确认事实发生变化，请重新核对卖点核心" });
  const sourceFacts = ids.map((id) => {
    const row = rows.find((item) => item.id === id)!;
    return `${row.attributeKey}: ${row.value}`;
  });
  return { core, sourceFacts, factRevisions: ids.map((id) => rows.find((item) => item.id === id)!), sellingPoint: {
    index: core.sellingPointIndex, theme: core.buyerReason, description: sourceFacts.join("; "),
    fabeDirection: { feature: sourceFacts.join("; "), advantage: "", benefit: core.buyerReason, evidence: sourceFacts.join("; ") },
    targetKeywords: [] as string[],
  } };
}
