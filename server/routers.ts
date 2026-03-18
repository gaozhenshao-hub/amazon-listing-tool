import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { projectRouter } from "./routers/project";
import { analysisRouter } from "./routers/analysis";
import { listingRouter } from "./routers/listing";
import { imageAnalysisRouter } from "./routers/imageAnalysis";
import { projectFileRouter } from "./routers/projectFile";
import { reportRouter } from "./routers/report";
import { scoringRouter } from "./routers/scoring";
import { keywordRouter, keywordAiRouter } from "./routers/keyword";
import { adStructureRouter } from "./routers/adStructure";
import { reviewAggregationRouter } from "./routers/reviewAggregation";
// Module 1: Product Development
import { devProjectRouter } from "./routers/devProject";
import { devTaggingRouter } from "./routers/devTagging";
import { devAnalysisRouter } from "./routers/devAnalysis";
import { devScoringRouter } from "./routers/devScoring";
import { devProfileRouter } from "./routers/devProfile";
import { devBomRouter } from "./routers/devBom";
import { devManualRouter } from "./routers/devManual";
import { devLinkageRouter } from "./routers/devLinkage";
import { devGlobalSupplierRouter } from "./routers/devGlobalSupplier";
import { offsiteAnalysisRouter } from "./routers/offsiteAnalysis";
import { devProjectTagsRouter } from "./routers/devProjectTags";
import { devPanoramaRouter } from "./routers/devPanorama";
import { devModuleLockRouter } from "./routers/devModuleLock";
// Image Workflow
import { imageWorkflowRouter } from "./routers/imageWorkflow";
// Module 5: Knowledge Base
import { kbProductsRouter } from "./routers/kbProducts";
import { kbListingsRouter } from "./routers/kbListings";
import { kbImagesRouter } from "./routers/kbImages";
import { kbSkillsRouter } from "./routers/kbSkills";
import { kbVideosRouter } from "./routers/kbVideos";
import { kbSearchRouter } from "./routers/kbSearch";
// System Settings
import { systemSettingsRouter } from "./routers/systemSettings";
// KB Review & Access Control
import { kbReviewRouter } from "./routers/kbReview";
import { sopAccessRouter } from "./routers/sopAccess";
import { projectAssignmentRouter } from "./routers/projectAssignment";
// User Management
import { userAuthRouter, userManagementRouter } from "./routers/userManagement";
// Deployment & Sync
import { deploymentConfigRouter } from "./routers/deploymentConfig";
// Role Management
import { roleManagementRouter } from "./routers/roleManagement";
// Notifications
import { notificationRouter } from "./routers/notification";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  project: projectRouter,
  analysis: analysisRouter,
  listing: listingRouter,
  imageAnalysis: imageAnalysisRouter,
  projectFile: projectFileRouter,
  report: reportRouter,
  scoring: scoringRouter,
  keyword: keywordRouter,
  keywordAi: keywordAiRouter,
  adStructure: adStructureRouter,
  reviewAggregation: reviewAggregationRouter,
  // Module 1: Product Development
  devProject: devProjectRouter,
  devTagging: devTaggingRouter,
  devAnalysis: devAnalysisRouter,
  devScoring: devScoringRouter,
  devProfile: devProfileRouter,
  devBom: devBomRouter,
  devManual: devManualRouter,
  devLinkage: devLinkageRouter,
  devGlobalSupplier: devGlobalSupplierRouter,
  offsiteAnalysis: offsiteAnalysisRouter,
  devProjectTags: devProjectTagsRouter,
  devPanorama: devPanoramaRouter,
  devModuleLock: devModuleLockRouter,
  // Image Workflow
  imageWorkflow: imageWorkflowRouter,
  // Module 5: Knowledge Base
  kbProducts: kbProductsRouter,
  kbListings: kbListingsRouter,
  kbImages: kbImagesRouter,
  kbSkills: kbSkillsRouter,
  kbVideos: kbVideosRouter,
  kbSearch: kbSearchRouter,
  // System Settings
  systemSettings: systemSettingsRouter,
  // KB Review & Access Control
  kbReview: kbReviewRouter,
  sopAccess: sopAccessRouter,
  projectAssignment: projectAssignmentRouter,
  // User Management
  userAuth: userAuthRouter,
  userManagement: userManagementRouter,
  // Deployment & Sync
  deploymentConfig: deploymentConfigRouter,
  // Role Management
  roleManagement: roleManagementRouter,
  notification: notificationRouter,
});

export type AppRouter = typeof appRouter;
