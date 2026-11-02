import { and, eq, sql } from "drizzle-orm";
import {
  devAnalysisStages,
  devPanoramaMarketInsights,
  devPanoramaStatus,
  devProjects,
  devProducts,
  devProductTags,
  devReviews,
} from "../../../../drizzle/schema/project";
import { withDbTransaction } from "../../../repositories/dbClient";
import { NotFoundError, resourceConflictError } from "@shared/_core/errors";

function affectedRows(result: unknown) {
  const value = result as any;
  return Number(value?.[0]?.affectedRows ?? value?.rowsAffected ?? 0);
}

export async function deletePanoramaProductRecord(input: {
  projectId: number;
  productId: number;
}) {
  return withDbTransaction("Delete panorama product", async (tx) => {
    await tx.execute(sql`
      SELECT ${devProducts.id}
      FROM ${devProducts}
      WHERE ${devProducts.projectId} = ${input.projectId}
        AND ${devProducts.id} = ${input.productId}
      FOR UPDATE
    `);
    const [product] = await tx.select().from(devProducts).where(and(
      eq(devProducts.projectId, input.projectId),
      eq(devProducts.id, input.productId),
    )).limit(1);
    if (!product) throw new Error("全景分析产品不存在或已被删除");

    const stageRuns = await tx.select({ runId: devAnalysisStages.runId })
      .from(devAnalysisStages)
      .where(eq(devAnalysisStages.projectId, input.projectId));
    const [marketInsight] = await tx.select({ runId: devPanoramaMarketInsights.runId })
      .from(devPanoramaMarketInsights)
      .where(eq(devPanoramaMarketInsights.projectId, input.projectId))
      .limit(1);

    let deletedTags = 0;
    let deletedReviews = 0;
    if (product.asin) {
      deletedTags = affectedRows(await tx.delete(devProductTags).where(and(
        eq(devProductTags.projectId, input.projectId),
        eq(devProductTags.asin, product.asin),
      )));
      deletedReviews = affectedRows(await tx.delete(devReviews).where(and(
        eq(devReviews.projectId, input.projectId),
        eq(devReviews.asin, product.asin),
      )));
    }

    await tx.delete(devProducts).where(and(
      eq(devProducts.projectId, input.projectId),
      eq(devProducts.id, input.productId),
    ));
    const [{ totalProducts = 0 } = {}] = await tx.select({
      totalProducts: sql<number>`COUNT(*)`,
    }).from(devProducts).where(eq(devProducts.projectId, input.projectId));

    await tx.update(devPanoramaStatus).set({
      confirmed: 0,
      confirmedAt: null,
      totalProducts: Number(totalProducts || 0),
    }).where(eq(devPanoramaStatus.projectId, input.projectId));

    await tx.update(devPanoramaMarketInsights).set({
      status: sql`CASE WHEN ${devPanoramaMarketInsights.rawResult} IS NULL AND ${devPanoramaMarketInsights.editedResult} IS NULL THEN 'pending' ELSE 'editing' END`,
      runId: null,
      runProgress: 0,
      runError: "全景产品已删除，请重新选择竞争对手并分析",
      runCompletedAt: new Date(),
      confirmedAt: null,
      confirmedBy: null,
    }).where(eq(devPanoramaMarketInsights.projectId, input.projectId));

    await tx.update(devAnalysisStages).set({
      status: sql`CASE WHEN ${devAnalysisStages.rawResult} IS NULL AND ${devAnalysisStages.editedResult} IS NULL THEN 'pending' ELSE 'generated' END`,
      runId: null,
      runProgress: 0,
      runError: "全景产品已删除，请基于最新数据重新分析",
      runCompletedAt: new Date(),
      confirmedAt: null,
      rowVersion: sql`${devAnalysisStages.rowVersion} + 1`,
      lastMutationKey: `panorama-delete:${input.productId}:${Date.now()}`.slice(0, 128),
    }).where(eq(devAnalysisStages.projectId, input.projectId));

    return {
      product,
      deletedTags,
      deletedReviews,
      totalProducts: Number(totalProducts || 0),
      obsoleteRunIds: [
        marketInsight?.runId,
        ...stageRuns.map((stage: { runId: string | null }) => stage.runId),
      ].filter((runId): runId is string => Boolean(runId)),
    };
  });
}

export type AddPanoramaProductInput = {
  projectId: number;
  asin: string;
  parentAsin?: string;
  title: string;
  brand?: string;
  price?: string;
  monthlySales?: number;
  monthlyRevenue?: number;
  rating?: string;
  reviewCount?: number;
  listingDate?: string;
  imageUrl?: string;
  productLink?: string;
  category?: string;
  subcategory?: string;
};

export async function addPanoramaProductRecord(input: AddPanoramaProductInput) {
  return withDbTransaction("Add missing panorama product", async (tx) => {
    await tx.execute(sql`
      SELECT ${devProjects.id}
      FROM ${devProjects}
      WHERE ${devProjects.id} = ${input.projectId}
      FOR UPDATE
    `);
    const [project] = await tx.select({ workspaceId: devProjects.workspaceId })
      .from(devProjects)
      .where(eq(devProjects.id, input.projectId))
      .limit(1);
    if (!project) throw NotFoundError("产品开发项目不存在", { projectId: input.projectId });

    const asin = input.asin.trim().toUpperCase();
    const [existing] = await tx.select({ id: devProducts.id })
      .from(devProducts)
      .where(and(eq(devProducts.projectId, input.projectId), eq(devProducts.asin, asin)))
      .limit(1);
    if (existing) {
      throw resourceConflictError("该 ASIN 已存在于当前项目，请直接编辑原产品行", {
        projectId: input.projectId,
        asin,
        productId: existing.id,
      });
    }

    const stageRuns = await tx.select({ runId: devAnalysisStages.runId })
      .from(devAnalysisStages)
      .where(eq(devAnalysisStages.projectId, input.projectId));
    const [marketInsight] = await tx.select({ runId: devPanoramaMarketInsights.runId })
      .from(devPanoramaMarketInsights)
      .where(eq(devPanoramaMarketInsights.projectId, input.projectId))
      .limit(1);
    const [{ maxSearchRank = 0 } = {}] = await tx.select({
      maxSearchRank: sql<number>`COALESCE(MAX(${devProducts.searchRank}), 0)`,
    }).from(devProducts).where(eq(devProducts.projectId, input.projectId));

    const insertResult = await tx.insert(devProducts).values({
      workspaceId: project.workspaceId,
      projectId: input.projectId,
      asin,
      parentAsin: input.parentAsin?.trim().toUpperCase() || null,
      title: input.title.trim(),
      brand: input.brand?.trim() || null,
      price: input.price?.trim() || null,
      monthlySales: input.monthlySales ?? null,
      monthlyRevenue: input.monthlyRevenue === undefined ? null : String(input.monthlyRevenue),
      rating: input.rating?.trim() || null,
      reviewCount: input.reviewCount === undefined ? null : String(input.reviewCount),
      listingDate: input.listingDate?.trim() || null,
      imageUrl: input.imageUrl?.trim() || null,
      productLink: input.productLink?.trim() || null,
      category: input.category?.trim() || null,
      subcategory: input.subcategory?.trim() || null,
      searchRank: Number(maxSearchRank || 0) + 1,
    });
    const productId = Number((insertResult as any)?.[0]?.insertId ?? (insertResult as any)?.insertId ?? 0);
    const [{ totalProducts = 0 } = {}] = await tx.select({
      totalProducts: sql<number>`COUNT(*)`,
    }).from(devProducts).where(eq(devProducts.projectId, input.projectId));

    await tx.update(devPanoramaStatus).set({
      confirmed: 0,
      confirmedAt: null,
      totalProducts: Number(totalProducts || 0),
    }).where(eq(devPanoramaStatus.projectId, input.projectId));
    await tx.update(devPanoramaMarketInsights).set({
      status: sql`CASE WHEN ${devPanoramaMarketInsights.rawResult} IS NULL AND ${devPanoramaMarketInsights.editedResult} IS NULL THEN 'pending' ELSE 'editing' END`,
      runId: null,
      runProgress: 0,
      runError: "全景产品已新增，请重新选择竞争对手并分析",
      runCompletedAt: new Date(),
      confirmedAt: null,
      confirmedBy: null,
    }).where(eq(devPanoramaMarketInsights.projectId, input.projectId));
    await tx.update(devAnalysisStages).set({
      status: sql`CASE WHEN ${devAnalysisStages.rawResult} IS NULL AND ${devAnalysisStages.editedResult} IS NULL THEN 'pending' ELSE 'generated' END`,
      runId: null,
      runProgress: 0,
      runError: "全景产品已新增，请基于最新数据重新分析",
      runCompletedAt: new Date(),
      confirmedAt: null,
      rowVersion: sql`${devAnalysisStages.rowVersion} + 1`,
      lastMutationKey: `panorama-add:${asin}:${Date.now()}`.slice(0, 128),
    }).where(eq(devAnalysisStages.projectId, input.projectId));

    return {
      productId,
      asin,
      title: input.title.trim(),
      totalProducts: Number(totalProducts || 0),
      obsoleteRunIds: [
        marketInsight?.runId,
        ...stageRuns.map((stage: { runId: string | null }) => stage.runId),
      ].filter((runId): runId is string => Boolean(runId)),
    };
  });
}
