import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { listingBulletCandidates, listingCoreRevisions, listingFactRevisions } from "../../../../drizzle/schema/listingRevisions";
import { projectFiles, projects } from "../../../../drizzle/schema/project";
import { getDb } from "../repository";
import { getCurrentRawFactSuggestions } from "./listingFactSource";
import { validateProposedFactDecision } from "./listingFactReviewPolicy";

export type FactReviewInput = {
  projectId: number;
  workspaceId: number;
  actorId: number;
  actorRole: string;
  fileId: number;
  rawHash: string;
  sourceLine: number;
  sourceLineHash: string;
  expectedRevision: number;
  decision: "confirm" | "reject";
  correctedValue?: string;
  reviewNote?: string;
  proofFileId?: number;
};

/** Review an exact original-upload row. A browser-supplied product claim is never trusted. */
export async function reviewListingRawFact(input: FactReviewInput) {
  const source = await getCurrentRawFactSuggestions(input.projectId, input.workspaceId);
  if (source.status !== "reviewable" || source.file?.id !== input.fileId || source.file.rawHash !== input.rawHash)
    throw new TRPCError({ code: "CONFLICT", message: "原始属性表已更新，请重新查看事实候选" });
  const suggested = source.suggestions.find((item) => item.sourceLine === input.sourceLine && item.sourceLineHash === input.sourceLineHash);
  if (!suggested) throw new TRPCError({ code: "CONFLICT", message: "候选行不存在或已变化，请从最新原文重新选择" });
  if (input.decision === "confirm" && input.proofFileId) {
    // Proof attachment ingestion is introduced later. Never accept an ordinary
    // attribute upload as a certification, warranty or performance certificate.
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "正式证明材料尚未接入受控审核，请勿将属性表当作认证/保修证明" });
  }
  const value = input.decision === "confirm"
    ? validateProposedFactDecision({ source: suggested, correctedValue: input.correctedValue,
        reviewNote: input.reviewNote, proofFileId: input.proofFileId })
    : suggested.value;
  const db = await getDb();
  if (!db || typeof db.transaction !== "function") throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "事实审阅事务暂不可用" });
  return db.transaction(async (tx) => {
    // Serialize all fact/core revisions per project; database, not the page,
    // is authoritative for ownership and revision selection.
    const [project] = await tx.select().from(projects).where(eq(projects.id, input.projectId)).limit(1).for("update");
    if (!project || project.workspaceId !== input.workspaceId ||
        (project.userId !== input.actorId && !["admin", "super_admin"].includes(input.actorRole))) {
      throw new TRPCError({ code: "FORBIDDEN", message: "项目不属于当前已授权工作空间" });
    }
    const [newest] = await tx.select({ id: projectFiles.id, rawHash: projectFiles.rawContentHash,
      workspaceId: projectFiles.workspaceId, status: projectFiles.status, lifecycleState: projectFiles.lifecycleState })
      .from(projectFiles).where(and(eq(projectFiles.projectId, input.projectId), eq(projectFiles.fileType, "product_attributes")))
      .orderBy(desc(projectFiles.createdAt), desc(projectFiles.id)).limit(1);
    if (!newest || newest.id !== input.fileId || newest.rawHash !== input.rawHash ||
        newest.workspaceId !== input.workspaceId || newest.status !== "completed" || newest.lifecycleState === "deleted") {
      throw new TRPCError({ code: "CONFLICT", message: "属性源文件已变化，请重新核对" });
    }
    const [latest] = await tx.select().from(listingFactRevisions).where(and(
      eq(listingFactRevisions.workspaceId, input.workspaceId), eq(listingFactRevisions.projectId, input.projectId),
      eq(listingFactRevisions.attributeKey, suggested.attributeKey),
    )).orderBy(desc(listingFactRevisions.revision)).limit(1);
    if ((latest?.revision || 0) !== input.expectedRevision) {
      throw new TRPCError({ code: "CONFLICT", message: "该事实已被其他人更新，请刷新并复核最新版本" });
    }
    const revision = input.expectedRevision + 1;
    const contentHash = createHash("sha256").update(JSON.stringify({ sourceFileId: input.fileId, sourceLine: suggested.sourceLine,
      sourceLineHash: suggested.sourceLineHash, attributeKey: suggested.attributeKey, value, decision: input.decision, revision })).digest("hex");
    const [written] = await tx.insert(listingFactRevisions).values({
      workspaceId: input.workspaceId, projectId: input.projectId, attributeKey: suggested.attributeKey, value,
      sourceFileId: input.fileId, rawHash: input.rawHash, sourceLine: suggested.sourceLine, sourceLineHash: suggested.sourceLineHash,
      sourceLocator: `原始属性表第${suggested.sourceLine}行`, provenance: value === suggested.value ? "upload" : "manual",
      status: input.decision === "confirm" ? "confirmed" : "rejected", revision, contentHash,
      createdBy: input.actorId, confirmedBy: input.decision === "confirm" ? input.actorId : null,
      confirmedAt: input.decision === "confirm" ? new Date() : null, reviewNote: input.reviewNote?.trim() || null,
    });
    if (latest) {
      await tx.update(listingFactRevisions).set({ status: "stale", staleAt: new Date() }).where(eq(listingFactRevisions.id, latest.id));
      // Conservative invalidation: no core/candidate can silently inherit a
      // changed fact revision, even when the old core only referenced that fact indirectly.
      await tx.update(listingCoreRevisions).set({ status: "stale", staleAt: new Date() }).where(and(
        eq(listingCoreRevisions.workspaceId, input.workspaceId), eq(listingCoreRevisions.projectId, input.projectId),
        inArray(listingCoreRevisions.status, ["draft", "confirmed"]),
      ));
      await tx.update(listingBulletCandidates).set({ status: "stale", staleAt: new Date() }).where(and(
        eq(listingBulletCandidates.workspaceId, input.workspaceId), eq(listingBulletCandidates.projectId, input.projectId),
        inArray(listingBulletCandidates.status, ["draft", "generated", "review_required", "confirmed"]),
      ));
    }
    return { id: written.insertId, attributeKey: suggested.attributeKey, value, status: input.decision === "confirm" ? "confirmed" as const : "rejected" as const, revision };
  });
}
