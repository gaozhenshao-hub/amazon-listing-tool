import { knowledgeAssetsRouter } from "./routers/knowledgeAssets";
import { listingInputsRouter } from "./routers/listingInputs";
import { taskManagementRouter } from "./routers/taskManagement";
import { designStudioRouter } from "./domains/design/router";
import { designPromptRouter } from "./domains/design/prompts";
import { designMaterialsRouter } from "./domains/design/materials";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { projectRouter } from "./routers/project";
import { analysisRouter } from "./routers/analysis";
import { listingRouter } from "./routers/listing";
import { listingSkillRouter } from "./routers/listingSkill";
import { projectFileRouter } from "./routers/projectFile";
import { reportRouter } from "./routers/report";
import { scoringRouter } from "./routers/scoring";
import { buyerQuestionsRouter } from "./routers/buyerQuestions";
import { keywordRouter, keywordAiRouter } from "./routers/keyword";
import { adStructureRouter } from "./routers/adStructure";
import { reviewAggregationRouter } from "./routers/reviewAggregation";
// Module 1: Product Development
// Image Workflow
// Module 5: Knowledge Base
import { kbImagesRouter } from "./routers/kbImages";
import { kbVideosRouter } from "./routers/kbVideos";
import { kbTagsRouter } from "./routers/kbTags";
// System Settings
import { systemSettingsRouter } from "./routers/systemSettings";
import { apiConnectionsRouter } from "./routers/apiConnections";
// KB Review & Access Control
import { kbReviewRouter } from "./routers/kbReview";
// User Management
import { userAuthRouter, userManagementRouter } from "./routers/userManagement";
// Deployment & Sync
// Role Management
import { roleManagementRouter } from "./routers/roleManagement";
// Notifications
import { notificationRouter } from "./routers/notification";
// Module 3: Operations AI Tools (Lingxing ERP)
import { operationsRouter } from "./routers/operations";
import { productOpsRouter } from "./routers/productOps";
import { shippingBatchRouter } from "./routers/shippingBatch";
import { logisticsRouter } from "./routers/logistics";
// Module 6: Off-site Marketing
// Module 2 Extension: Video Script Generation
// Task Management
// Data Import Center
import { dataImportRouter } from "./routers/dataImport";
import { productCostsReadOnlyRouter } from "./routers/productCostsReadOnly";
import { productCostsWriteRouter } from "./routers/productCostsWrite";
import { monthlyFinancialReadRouter } from "./routers/monthlyFinancialRead";
import { monthlyFinancialWriteRouter } from "./routers/monthlyFinancialWrite";
import { saihuReportSyncRouter } from "./routers/saihuReportSync";
import { saihuReportScheduleRouter } from "./routers/saihuReportSchedule";
import { saihuLegacySyncRouter } from "./routers/saihuLegacySync";
import { inventorySnapshotReadRouter } from "./routers/inventorySnapshotRead";
import { inventorySnapshotRefreshRouter } from "./routers/inventorySnapshotRefresh";
import { profitBoardReadRouter } from "./routers/profitBoardRead";
import { profitAnalysisRouter } from "./routers/profitAnalysis";
import { productBoardReadRouter } from "./routers/productBoardRead";
import { northAmericaBoardRouter } from "./routers/northAmericaBoard";
import { operationsBoardRouter } from "./routers/operationsBoard";
import { productTaskReadRouter } from "./routers/productTaskRead";
import { operationsJournalRouter } from "./routers/operationsJournal";
import { productTaskWriteRouter } from "./routers/productTaskWrite";
import { operatorMappingRouter } from "./routers/operatorMapping";
import { inventoryOwnerAssignmentsRouter } from "./routers/inventoryOwnerAssignments";
// Ad Keyword Tracking
// Emperor 皇帝 · AI能力中台
import { emperorRouter } from "./routers/emperor";
import { aiJobsRouter } from "./routers/aiJobs";
import { amazonAcquisitionRouter } from "./domains/acquisition/router";
import { performanceRouter } from "./routers/performance";

export const appRouter = router({
  listingInputs: listingInputsRouter,
  taskManagement: taskManagementRouter,
  designStudio: designStudioRouter,
  designPrompts: designPromptRouter,
  designMaterials: designMaterialsRouter,
  system: systemRouter,
  performance: performanceRouter,
  auth: router({
    me: publicProcedure.query(opts => {
      if (!opts.ctx.user) return null;
      const { password, ...safeUser } = opts.ctx.user;
      return safeUser;
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  project: projectRouter,
  analysis: analysisRouter,
  listing: listingRouter,
  listingSkill: listingSkillRouter,
  projectFile: projectFileRouter,
  report: reportRouter,
  scoring: scoringRouter,
  buyerQuestions: buyerQuestionsRouter,
  keyword: keywordRouter,
  keywordAi: keywordAiRouter,
  adStructure: adStructureRouter,
  reviewAggregation: reviewAggregationRouter,
  // Module 1: Product Development
  // Image Workflow
  // Module 5: Knowledge Base
  knowledgeAssets: knowledgeAssetsRouter,
  kbImages: kbImagesRouter,
  kbVideos: kbVideosRouter,
  kbTags: kbTagsRouter,
  // System Settings
  systemSettings: systemSettingsRouter,
  apiConnections: apiConnectionsRouter,
  // KB Review & Access Control
  kbReview: kbReviewRouter,
  // User Management
  userAuth: userAuthRouter,
  userManagement: userManagementRouter,
  // Deployment & Sync
  // Role Management
  roleManagement: roleManagementRouter,
  notification: notificationRouter,
  // Module 3: Operations AI Tools (Lingxing ERP)
  operations: operationsRouter,
  productOps: productOpsRouter,
  shippingBatch: shippingBatchRouter,
  logistics: logisticsRouter,
  // Module 4: After-Sales Management
  // Phase 4: Dashboard Upgrade
  // Module 6: Off-site Marketing
  // Module 2 Extension: Video Script Generation
  // Data Import Center
  dataImport: dataImportRouter,
  productCostsReadOnly: productCostsReadOnlyRouter,
  productCostsWrite: productCostsWriteRouter,
  monthlyFinancialRead: monthlyFinancialReadRouter,
  monthlyFinancialWrite: monthlyFinancialWriteRouter,
  opsSaihuReport: saihuReportSyncRouter,
  opsSaihuSchedule: saihuReportScheduleRouter,
  saihuLegacySync: saihuLegacySyncRouter,
  inventorySnapshotRead: inventorySnapshotReadRouter,
  inventorySnapshotRefresh: inventorySnapshotRefreshRouter,
  profitBoardRead: profitBoardReadRouter,
  profitAnalysis: profitAnalysisRouter,
  productBoardRead: productBoardReadRouter,
  northAmericaBoard: northAmericaBoardRouter,
  operationsBoard: operationsBoardRouter,
  productTaskRead: productTaskReadRouter,
  operationsJournal: operationsJournalRouter,
  productTaskWrite: productTaskWriteRouter,
  operatorMapping: operatorMappingRouter,
  inventoryOwnerAssignments: inventoryOwnerAssignmentsRouter,
  // Ad Keyword Tracking
  // Task Management
  // Ad Report Upload (replaces Lingxing API)
  // Ad Local Analysis (reads from local uploaded data)
  // Ad Daily Report Upload (5 daily report types for deep optimization)
  // Ad Deep Analysis (6 sub-modules AI engines)
  // Emperor 皇帝 · AI能力中台
  emperor: emperorRouter,
  // Long-running AI Job infrastructure
  aiJobs: aiJobsRouter,
  acquisition: amazonAcquisitionRouter,
});

export type AppRouter = typeof appRouter;
