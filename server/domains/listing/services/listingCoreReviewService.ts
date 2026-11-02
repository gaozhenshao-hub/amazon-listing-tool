import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { listingBulletCandidates, listingCoreRevisions, listingFactRevisions } from "../../../../drizzle/schema/listingRevisions";
import { projectFiles, projects } from "../../../../drizzle/schema/project";
import { isTemplateOrEmptyFact } from "../../../../shared/listingFactSafety";
import { getDb } from "../repository";

export type CoreReviewInput = {
  projectId: number; workspaceId: number; actorId: number; actorRole: string;
  coreId?: string; sellingPointIndex: number; buyerReason: string;
  factRevisionIds: number[]; expectedRevision: number; decision: "draft" | "confirm" | "reject";
};

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function reviewListingCore(input: CoreReviewInput) {
  const buyerReason = input.buyerReason.trim();
  if (!buyerReason || buyerReason.length > 500 || isTemplateOrEmptyFact(buyerReason))
    throw new TRPCError({ code: "BAD_REQUEST", message: "卖点核心必须是一个明确且可核实的买家购买理由" });
  if (input.factRevisionIds.length < 1 || input.factRevisionIds.length > 30 || new Set(input.factRevisionIds).size !== input.factRevisionIds.length)
    throw new TRPCError({ code: "BAD_REQUEST", message: "请为该核心选择至少一条不重复的已确认本品事实" });
  if (input.expectedRevision === 0 && input.coreId) throw new TRPCError({ code: "BAD_REQUEST", message: "新核心不能伪造既有修订身份" });
  if (input.expectedRevision > 0 && !input.coreId) throw new TRPCError({ code: "BAD_REQUEST", message: "修改核心时必须提供核心身份和当前版本" });
  const db = await getDb();
  if (!db || typeof db.transaction !== "function") throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "核心审阅事务暂不可用" });
  return db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, input.projectId)).limit(1).for("update");
    if (!project || project.workspaceId !== input.workspaceId ||
        (project.userId !== input.actorId && !["admin", "super_admin"].includes(input.actorRole)))
      throw new TRPCError({ code: "FORBIDDEN", message: "不能确认其他工作空间的卖点核心" });
    const [latestFile] = await tx.select({ id: projectFiles.id, hash: projectFiles.rawContentHash,
      workspaceId: projectFiles.workspaceId, status: projectFiles.status, lifecycleState: projectFiles.lifecycleState })
      .from(projectFiles).where(and(eq(projectFiles.projectId, input.projectId), eq(projectFiles.fileType, "product_attributes")))
      .orderBy(desc(projectFiles.createdAt), desc(projectFiles.id)).limit(1);
    const rows = await tx.select().from(listingFactRevisions).where(and(
      eq(listingFactRevisions.workspaceId, input.workspaceId), eq(listingFactRevisions.projectId, input.projectId),
      inArray(listingFactRevisions.id, input.factRevisionIds),
    ));
    if (!latestFile || latestFile.workspaceId !== input.workspaceId || latestFile.status !== "completed" ||
        latestFile.lifecycleState === "deleted" || !latestFile.hash ||
        rows.length !== input.factRevisionIds.length || rows.some((row) => row.status !== "confirmed" || !row.confirmedBy || !row.confirmedAt ||
        row.sourceFileId !== latestFile.id || row.rawHash !== latestFile.hash))
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "卖点引用了未确认、跨项目或来源已过期的事实，请重新审核原始表" });
    const coreId = input.coreId || randomUUID();
    const occupied = await tx.select({ coreId: listingCoreRevisions.coreId }).from(listingCoreRevisions).where(and(
      eq(listingCoreRevisions.workspaceId, input.workspaceId), eq(listingCoreRevisions.projectId, input.projectId),
      eq(listingCoreRevisions.sellingPointIndex, input.sellingPointIndex),
      inArray(listingCoreRevisions.status, ["draft", "confirmed"]),
    )).limit(2);
    if (occupied.some((row) => row.coreId !== coreId))
      throw new TRPCError({ code: "CONFLICT", message: "该序号已有可编辑核心，请选择已有版本修改，不能创建重复卖点核心" });
    const [latest] = await tx.select().from(listingCoreRevisions).where(and(
      eq(listingCoreRevisions.workspaceId, input.workspaceId), eq(listingCoreRevisions.projectId, input.projectId),
      eq(listingCoreRevisions.coreId, coreId),
    )).orderBy(desc(listingCoreRevisions.revision)).limit(1);
    if ((latest?.revision || 0) !== input.expectedRevision)
      throw new TRPCError({ code: "CONFLICT", message: "核心版本已经变化，请刷新后再确认" });
    const revision = input.expectedRevision + 1;
    const factIds = [...input.factRevisionIds].sort((a, b) => a - b);
    const inputHash = digest({ projectId: input.projectId, workspaceId: input.workspaceId, coreId, factIds,
      facts: rows.map((row) => ({ id: row.id, hash: row.contentHash })).sort((a, b) => a.id - b.id),
      sourceFileId: latestFile?.id, sourceHash: latestFile?.hash });
    const contentHash = digest({ inputHash, revision, buyerReason, sellingPointIndex: input.sellingPointIndex, decision: input.decision });
    const [written] = await tx.insert(listingCoreRevisions).values({
      coreId, workspaceId: input.workspaceId, projectId: input.projectId, sellingPointIndex: input.sellingPointIndex,
      buyerReason, factRevisionIdsJson: factIds, keywordIdsJson: [], inputHash, contentHash, revision,
      status: input.decision === "confirm" ? "confirmed" : input.decision === "reject" ? "rejected" : "draft",
      createdBy: input.actorId, confirmedBy: input.decision === "confirm" ? input.actorId : null,
      confirmedAt: input.decision === "confirm" ? new Date() : null,
    });
    if (latest) {
      await tx.update(listingCoreRevisions).set({ status: "superseded", staleAt: new Date() }).where(eq(listingCoreRevisions.id, latest.id));
      await tx.update(listingBulletCandidates).set({ status: "stale", staleAt: new Date() }).where(and(
        eq(listingBulletCandidates.workspaceId, input.workspaceId), eq(listingBulletCandidates.projectId, input.projectId),
        eq(listingBulletCandidates.coreRevisionId, latest.id),
        inArray(listingBulletCandidates.status, ["draft", "generated", "review_required", "confirmed"]),
      ));
    }
    return { id: written.insertId, coreId, revision, inputHash, status: input.decision === "confirm" ? "confirmed" as const : input.decision === "reject" ? "rejected" as const : "draft" as const };
  });
}
