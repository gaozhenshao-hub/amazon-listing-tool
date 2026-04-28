import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { projectRouter } from "./routers/project";
import { analysisRouter } from "./routers/analysis";
import { listingRouter } from "./routers/listing";
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
import { kbBotRouter } from "./routers/kbBot";
import { kbIntelRouter } from "./routers/kbIntel";
import { kbFeedbackRouter } from "./routers/kbFeedback";
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
// Module 3: Operations AI Tools (Lingxing ERP)
import { operationsRouter } from "./routers/operations";
import { productOpsRouter } from "./routers/productOps";
import { crawlerRouter } from "./routers/crawler";
import { shippingBatchRouter } from "./routers/shippingBatch";
import { logisticsRouter } from "./routers/logistics";
import { adAnalysisRouter } from "./routers/adAnalysis";
import { adAnalysisP2Router } from "./routers/adAnalysisP2";
import { opsProductPlanRouter } from "./routers/opsProductPlan";
import { afterSalesRouter } from "./routers/afterSales";
import { dashboardUpgradeRouter } from "./routers/dashboardUpgrade";
import { customDashboardRouter } from "./routers/customDashboard";
import { customerProfileRouter } from "./routers/customerProfile";
// Module 6: Off-site Marketing
import { offInfluencerRouter } from "./routers/offInfluencer";
import { offCampaignRouter } from "./routers/offCampaign";
import { offOutreachRouter } from "./routers/offOutreach";
import { offContentRouter } from "./routers/offContent";
import { offSocialRouter } from "./routers/offSocial";
import { offAnalyticsRouter } from "./routers/offAnalytics";
// Module 2 Extension: Video Script Generation
import { videoScriptRouter } from "./routers/videoScript";
// Task Management
import { taskManagementRouter } from "./routers/taskManagement";
// Data Import Center
import { dataImportRouter } from "./routers/dataImport";
import { operatorMappingRouter } from "./routers/operatorMapping";
// Ad Keyword Tracking
import { adTrackingRouter } from "./routers/adTracking";
import { adReportUploadRouter } from "./routers/adReportUpload";

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
  kbBot: kbBotRouter,
  kbIntel: kbIntelRouter,
  kbFeedback: kbFeedbackRouter,
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
  // Module 3: Operations AI Tools (Lingxing ERP)
  operations: operationsRouter,
  productOps: productOpsRouter,
  crawler: crawlerRouter,
  shippingBatch: shippingBatchRouter,
  logistics: logisticsRouter,
  adAnalysis: adAnalysisRouter,
  adAnalysisP2: adAnalysisP2Router,
  opsProductPlan: opsProductPlanRouter,
  // Module 4: After-Sales Management
  afterSales: afterSalesRouter,
  // Phase 4: Dashboard Upgrade
  dashboardUpgrade: dashboardUpgradeRouter,
  customDashboard: customDashboardRouter,
  customerProfile: customerProfileRouter,
  // Module 6: Off-site Marketing
  offInfluencer: offInfluencerRouter,
  offCampaign: offCampaignRouter,
  offOutreach: offOutreachRouter,
  offContent: offContentRouter,
  offSocial: offSocialRouter,
  offAnalytics: offAnalyticsRouter,
  // Module 2 Extension: Video Script Generation
  videoScript: videoScriptRouter,
  // Data Import Center
  dataImport: dataImportRouter,
  operatorMapping: operatorMappingRouter,
  // Ad Keyword Tracking
  adTracking: adTrackingRouter,
  // Task Management
  taskManagement: taskManagementRouter,
  // Ad Report Upload (replaces Lingxing API)
  adReportUpload: adReportUploadRouter,
});

export type AppRouter = typeof appRouter;
