import { router } from "../../_core/trpc";
import { protectedProcedure } from "./security/productDevelopmentProcedure";
import {
  aiExternalInput,
  attributeCrossInput,
  competitorSiteInput,
  generateReportInput,
  keywordInput,
  projectIdInput,
  reportInput,
  stageConfirmInput,
  stageEditInput,
  stageInput,
  tagCrossInput,
  updateReportInput,
} from "./schema";
import { productDevelopmentService as service } from "./service";
import type { ProductDevelopmentContext } from "./types";

const domainContext = (ctx: unknown) => ctx as ProductDevelopmentContext;

// Attribute tagging remains owned by the devTagging router; analysis begins after confirmation.
export const productDevelopmentAnalysisRouter = router({
  getStages: protectedProcedure.input(projectIdInput).query(({ input }) => service.getStages(input.projectId)),
  getStageGating: protectedProcedure.input(projectIdInput).query(({ input }) => service.getStageGating(input.projectId)),
  getStage: protectedProcedure.input(stageInput).query(({ input }) => service.getStage(input.projectId, input.stageType)),

  runMarketOverview: protectedProcedure.input(projectIdInput).mutation(({ ctx, input }) => (
    service.runMarketOverview(domainContext(ctx), input.projectId)
  )),
  runAttributeCross: protectedProcedure.input(attributeCrossInput).mutation(({ ctx, input }) => (
    service.runAttributeCross(domainContext(ctx), input.projectId, input)
  )),
  runPriceAnalysis: protectedProcedure.input(projectIdInput).mutation(({ ctx, input }) => (
    service.runPriceAnalysis(domainContext(ctx), input.projectId)
  )),
  runBrandCompetition: protectedProcedure.input(projectIdInput).mutation(({ ctx, input }) => (
    service.runBrandCompetition(domainContext(ctx), input.projectId)
  )),
  runReviewKano: protectedProcedure.input(projectIdInput).mutation(({ ctx, input }) => (
    service.runReviewKano(domainContext(ctx), input.projectId)
  )),
  runInformationSummary: protectedProcedure.input(projectIdInput).mutation(({ ctx, input }) => (
    service.runInformationSummary(domainContext(ctx), input.projectId)
  )),
  runDecisionDashboard: protectedProcedure.input(projectIdInput).mutation(({ ctx, input }) => (
    service.runDecisionDashboard(domainContext(ctx), input.projectId)
  )),
  cancelStage: protectedProcedure.input(stageInput).mutation(({ ctx, input }) => (
    service.cancelStage(domainContext(ctx), input.projectId, input.stageType)
  )),
  confirmStage: protectedProcedure.input(stageConfirmInput).mutation(({ ctx, input }) => (
    service.confirmStage(domainContext(ctx), input.projectId, input.stageType, input.editedResult)
  )),
  editStage: protectedProcedure.input(stageEditInput).mutation(({ ctx, input }) => (
    service.editStage(domainContext(ctx), input.projectId, input.stageType, input.editedResult)
  )),
  unlockStage: protectedProcedure.input(stageInput).mutation(({ ctx, input }) => (
    service.unlockStage(domainContext(ctx), input.projectId, input.stageType)
  )),

  generateReport: protectedProcedure.input(generateReportInput).mutation(({ ctx, input }) => (
    service.generateReport(domainContext(ctx), input.projectId, input.reportType)
  )),
  getReports: protectedProcedure.input(projectIdInput).query(({ input }) => service.getReports(input.projectId)),
  getReport: protectedProcedure.input(reportInput).query(({ input }) => service.getReport(input.projectId, input.reportType)),
  updateReport: protectedProcedure.input(updateReportInput).mutation(({ ctx, input }) => (
    service.updateReport(domainContext(ctx), input.projectId, input.reportType, input.content)
  )),
  reviewStats: protectedProcedure.input(projectIdInput).query(({ input }) => service.reviewStats(input.projectId)),
  contentStats: protectedProcedure.input(projectIdInput).mutation(({ input }) => service.contentStats(input.projectId)),
  wordCloud: protectedProcedure.input(projectIdInput).mutation(({ input }) => service.wordCloud(input.projectId)),

  fetchYouTube: protectedProcedure.input(keywordInput).mutation(({ ctx, input }) => (
    service.fetchExternal(domainContext(ctx), input.projectId, "youtube", input.keyword)
  )),
  fetchTikTok: protectedProcedure.input(keywordInput).mutation(({ ctx, input }) => (
    service.fetchExternal(domainContext(ctx), input.projectId, "tiktok", input.keyword)
  )),
  fetchCompetitorSite: protectedProcedure.input(competitorSiteInput).mutation(({ ctx, input }) => (
    service.fetchExternal(domainContext(ctx), input.projectId, "competitor_site", input.domain)
  )),
  fetchAIAnalysis: protectedProcedure.input(aiExternalInput).mutation(({ ctx, input }) => (
    service.fetchAIAnalysis(domainContext(ctx), input.projectId, input.keyword, input.dataType)
  )),
  getExternalData: protectedProcedure.input(projectIdInput).query(({ input }) => service.getExternalData(input.projectId)),
  getConfirmedProjectTags: protectedProcedure.input(projectIdInput).query(({ input }) => (
    service.getConfirmedProjectTags(input.projectId)
  )),
  runTagCrossAnalysis: protectedProcedure.input(tagCrossInput).mutation(({ ctx, input }) => (
    service.runTagCrossAnalysis(domainContext(ctx), input.projectId, input)
  )),
});
