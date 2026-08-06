import { and, asc, eq } from "drizzle-orm";
import {
  devProjectTagCategories,
  devProjectTagItems,
  type InsertDevAnalysisReport,
  type InsertDevExternalData,
} from "../../../drizzle/schema";
import * as analysisRepository from "./repositories/analysisRepository";
import * as marketResearchRepository from "./repositories/marketResearchRepository";
import { getDb } from "../../repositories/dbClient";
import { databaseUnavailableError } from "../../_core/domainError";

export const productDevelopmentRepository = {
  getStages: analysisRepository.getDevAnalysisStages,
  getStage: analysisRepository.getDevAnalysisStage,
  getProducts: marketResearchRepository.getDevProductsByProject,
  getReviewStats: marketResearchRepository.getDevReviewStats,
  getReviews: marketResearchRepository.getDevReviewsByProject,
  getReports: marketResearchRepository.getDevReports,
  getReport: marketResearchRepository.getDevReport,
  getExternalData: marketResearchRepository.getDevExternalData,
  upsertReport: (data: InsertDevAnalysisReport) => marketResearchRepository.upsertDevReport(data),
  createExternalData: (data: InsertDevExternalData) => marketResearchRepository.createDevExternalData(data),

  async getConfirmedProjectTags(projectId: number) {
    const db = await getDb();
    if (!db) throw databaseUnavailableError("product_development");

    const [categories, items, allCategories] = await Promise.all([
      db.select().from(devProjectTagCategories)
        .where(and(
          eq(devProjectTagCategories.projectId, projectId),
          eq(devProjectTagCategories.confirmed, 1),
        ))
        .orderBy(asc(devProjectTagCategories.sortOrder)),
      db.select().from(devProjectTagItems)
        .where(eq(devProjectTagItems.projectId, projectId))
        .orderBy(asc(devProjectTagItems.sortOrder)),
      db.select().from(devProjectTagCategories)
        .where(eq(devProjectTagCategories.projectId, projectId)),
    ]);

    const confirmedCount = allCategories.filter((category) => category.confirmed === 1).length;
    return {
      categories: categories.map((category) => ({
        categoryId: category.id,
        categoryKey: category.categoryKey,
        categoryName: category.categoryName,
        confirmed: true,
        tags: items
          .filter((item) => item.categoryId === category.id)
          .map((item) => ({
            id: item.id,
            tagName: item.tagName,
            tagValue: item.tagValue || "",
            source: item.source,
          })),
      })),
      status: {
        total: allCategories.length,
        confirmed: confirmedCount,
        allConfirmed: allCategories.length > 0 && confirmedCount === allCategories.length,
        initialized: allCategories.length > 0,
      },
    };
  },
};

export type ProductDevelopmentRepository = typeof productDevelopmentRepository;
