import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { claimLazyRecovery } from "@/lib/lazyRecovery";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import { lazy, Suspense, type ComponentType } from "react";

function lazyWithRecovery<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
  recoveryKey: string,
) {
  return lazy(async () => {
    try {
      const module = await loader();
      window.sessionStorage.removeItem(recoveryKey);
      return module;
    } catch (error) {
      // 发布会替换带哈希的模块文件；旧入口加载失败时自动刷新一次以取得最新入口。
      if (claimLazyRecovery(window.sessionStorage, recoveryKey)) {
        window.location.reload();
        return new Promise<{ default: T }>(() => undefined);
      }
      throw error;
    }
  });
}

// ─── Module 2: Listing (existing pages) ────────────────────────
const Home = lazy(() => import("./pages/Home"));
const AnalysisPage = lazy(() => import("./pages/AnalysisPage"));
const GeneratePage = lazy(() => import("./pages/GeneratePage"));
const PreviewPage = lazy(() => import("./pages/PreviewPage"));
const ProjectDetailPage = lazy(() => import("./pages/ProjectDetailPage"));
const ComparisonPage = lazy(() => import("./pages/ComparisonPage"));
const ReviewHistoryPage = lazy(() => import("./pages/ReviewHistoryPage"));
const DataFilesPage = lazy(() => import("./pages/DataFilesPage"));
const ScorePage = lazy(() => import("./pages/ScorePage"));
const ImageSuggestionsPage = lazy(() => import("./pages/ImageSuggestionsPage"));
const ImageWorkflowPage = lazyWithRecovery(
  () => import("./pages/ImageWorkflowPage"),
  "lazy-recovery:image-workflow",
);
const KeywordPage = lazy(() => import("./pages/KeywordPage"));
const AdStructurePage = lazy(() => import("./pages/AdStructurePage"));
const ReviewAggregationPage = lazy(() => import("./pages/ReviewAggregationPage"));
const VideoScriptPage = lazy(() => import("./pages/VideoScriptPage"));
const BuyerQuestionsPage = lazy(() => import("./pages/BuyerQuestionsPage"));
const WorkflowCanvasPage = lazy(() => import("./pages/WorkflowCanvasPage"));

// ─── Module 1: Product Development ─────────────────────────────
const DevDashboard = lazy(() => import("./pages/dev/DevDashboard"));
const DevNewProject = lazy(() => import("./pages/dev/DevNewProject"));
const DevProjects = lazy(() => import("./pages/dev/DevProjects"));
const DevProjectDetail = lazy(() => import("./pages/dev/DevProjectDetail"));
const DevCompare = lazy(() => import("./pages/dev/DevCompare"));
const DevSupplierLibrary = lazy(() => import("./pages/dev/DevSupplierLibrary"));
const DevAnalysisFlow = lazy(() => import("./pages/dev/DevAnalysisFlow"));
const DevOffsiteAnalysis = lazy(() => import("./pages/dev/DevOffsiteAnalysis"));

// ─── Module 5: Knowledge Base ───────────────────────────────────
const KBOverview = lazyWithRecovery(
  () => import("./pages/knowledge/KBOverview"),
  "lazy-recovery:kb-overview",
);
const KBProducts = lazy(() => import("./pages/knowledge/KBProducts"));
const KBListings = lazy(() => import("./pages/knowledge/KBListings"));
const KBImages = lazy(() => import("./pages/knowledge/KBImages"));
const KBSkills = lazy(() => import("./pages/knowledge/KBSkills"));
const KBVideos = lazy(() => import("./pages/knowledge/KBVideos"));
const KBBot = lazy(() => import("./pages/knowledge/KBBot"));
const KBIntel = lazy(() => import("./pages/knowledge/KBIntel"));
const KBTransfer = lazy(() => import("./pages/knowledge/KBTransfer"));

// ─── Module 3: Operations AI Tools ─────────────────────────────
const OpsDashboard = lazy(() => import("./pages/ops/OpsDashboard"));
const OpsInventory = lazy(() => import("./pages/ops/OpsInventory"));
const OpsAds = lazy(() => import("./pages/ops/OpsAds"));
const OpsProducts = lazy(() => import("./pages/ops/OpsProducts"));
const OpsProductDetail = lazy(() => import("./pages/ops/OpsProductDetail"));
const OpsCrawlerManager = lazy(() => import("./pages/ops/OpsCrawlerManager"));
const OpsShippingBatchDetail = lazy(() => import("./pages/ops/OpsShippingBatchDetail"));
const OpsLogistics = lazy(() => import("./pages/ops/OpsLogistics"));
const OpsDashboardUpgrade = lazy(() => import("./pages/ops/OpsDashboardUpgrade"));
const OpsCustomDashboard = lazy(() => import("./pages/ops/OpsCustomDashboard"));
const OpsTaskManagement = lazy(() => import("./pages/ops/OpsTaskManagement"));
const OpsDataImport = lazy(() => import("./pages/ops/OpsDataImport"));
const OpsAdMapping = lazy(() => import("./pages/ops/OpsAdMapping"));
const OpsAdDeep = lazy(() => import("./pages/ops/OpsAdDeep"));
const OpsLingxingSync = lazy(() => import("./pages/ops/OpsLingxingSync"));

// ─── Module 4: After-sales Management ──────────────────────────
const ComingSoonPage = lazy(() => import("./pages/ComingSoonPage"));
const ServiceDashboard = lazy(() => import("./pages/service/ServiceDashboard"));
const ServiceReviews = lazy(() => import("./pages/service/ServiceReviews"));
const ServiceReturns = lazy(() => import("./pages/service/ServiceReturns"));
const ServiceEmails = lazy(() => import("./pages/service/ServiceEmails"));
const ServiceProfiles = lazy(() => import("./pages/service/ServiceProfiles"));

// ─── Module 6: Off-site Marketing ──────────────────────────────
const OffsiteOverview = lazy(() => import("./pages/offsite/OffsiteOverview"));
const OffsiteInfluencers = lazy(() => import("./pages/offsite/OffsiteInfluencers"));
const OffsiteCampaigns = lazy(() => import("./pages/offsite/OffsiteCampaigns"));
const OffsiteOutreach = lazy(() => import("./pages/offsite/OffsiteOutreach"));
const OffsiteContentReview = lazy(() => import("./pages/offsite/OffsiteContentReview"));
const OffsiteSocialAccounts = lazy(() => import("./pages/offsite/OffsiteSocialAccounts"));
const OffsiteContentCalendar = lazy(() => import("./pages/offsite/OffsiteContentCalendar"));
const OffsiteTikTokMatrix = lazy(() => import("./pages/offsite/OffsiteTikTokMatrix"));
const OffsiteAttribution = lazy(() => import("./pages/offsite/OffsiteAttribution"));
const OffsiteAnalytics = lazy(() => import("./pages/offsite/OffsiteAnalytics"));

// ─── Platform Home ──────────────────────────────────────────────
const PlatformHome = lazyWithRecovery(
  () => import("./pages/PlatformHome"),
  "lazy-recovery:platform-home",
);

// ─── System Settings ────────────────────────────────────────────
const SystemSettings = lazy(() => import("./pages/SystemSettings"));

// ─── User Management ────────────────────────────────────────────
const LoginPage = lazy(() => import("./pages/LoginPage"));
const UserManagement = lazy(() => import("./pages/UserManagement"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const ReviewCenter = lazy(() => import("./pages/ReviewCenter"));
const SopAccessPage = lazy(() => import("./pages/SopAccessPage"));
const ProjectAssignmentPage = lazy(() => import("./pages/ProjectAssignmentPage"));
const SyncManagement = lazy(() => import("./pages/SyncManagement"));
const RoleManagement = lazy(() => import("./pages/RoleManagement"));
import { PermissionGuard } from "./components/PermissionGuard";

// ─── Module 7: Emperor AI 能力中台 ────────────────────────────────────────────────────────
const EmperorSkillLibrary = lazy(() => import("./pages/emperor/EmperorSkillLibrary"));
const EmperorConversations = lazy(() => import("./pages/emperor/EmperorConversations"));
const EmperorTrace = lazy(() => import("./pages/emperor/EmperorTrace"));
const EmperorQualityGates = lazy(() => import("./pages/emperor/EmperorQualityGates"));
const EmperorHarnessGovernance = lazy(() => import("./pages/emperor/EmperorHarnessGovernance"));
const EmperorModels = lazy(() => import("./pages/emperor/EmperorModels"));
const EmperorMCP = lazy(() => import("./pages/emperor/EmperorMCP"));
const EmperorAgents = lazy(() => import("./pages/emperor/EmperorAgents"));
const EmperorUsage = lazy(() => import("./pages/emperor/EmperorUsage"));
const EmperorDiagnostics = lazy(() => import("./pages/emperor/EmperorDiagnostics"));
const EmperorSettings = lazy(() => import("./pages/emperor/EmperorSettings"));
const EmperorScheduled = lazy(() => import("./pages/emperor/EmperorScheduled"));
const AgentCanvas = lazy(() => import("./pages/emperor/AgentCanvas"));
const EmperorKnowledge = lazy(() => import("./pages/emperor/EmperorKnowledge"));
const EmperorObservability = lazy(() => import("./pages/emperor/EmperorObservability"));
const EmperorSkillDistillation = lazy(() => import("./pages/emperor/EmperorSkillDistillation"));
const CoreWorkflowQaPage = import.meta.env.MODE === "e2e"
  ? lazy(() => import("./pages/qa/CoreWorkflowQaPage"))
  : null;

export function RouteLoadingFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="页面加载中">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  );
}

function Router() {
  return (
    <DashboardLayout>
      <Switch>
        {/* Platform root → redirect to listing (default module) */}
        <Route path="/" component={PlatformHome} />

        {/* ─── Module 2: Listing (with /listing prefix) ─── */}
        <Route path="/listing">{() => <PermissionGuard><Home /></PermissionGuard>}</Route>
        <Route path="/listing/analysis">{() => <PermissionGuard><AnalysisPage /></PermissionGuard>}</Route>
        <Route path="/listing/generate">{() => <PermissionGuard><GeneratePage /></PermissionGuard>}</Route>
        <Route path="/listing/preview">{() => <PermissionGuard><PreviewPage /></PermissionGuard>}</Route>
        <Route path="/listing/comparison">{() => <PermissionGuard><ComparisonPage /></PermissionGuard>}</Route>
        <Route path="/listing/review-history">{() => <PermissionGuard><ReviewHistoryPage /></PermissionGuard>}</Route>
        <Route path="/listing/data-files">{() => <PermissionGuard><DataFilesPage /></PermissionGuard>}</Route>
        <Route path="/listing/score">{() => <PermissionGuard><ScorePage /></PermissionGuard>}</Route>
        <Route path="/listing/image-suggestions">{() => <PermissionGuard><ImageSuggestionsPage /></PermissionGuard>}</Route>
        <Route path="/listing/image-workflow">{() => <PermissionGuard><ImageWorkflowPage /></PermissionGuard>}</Route>
        <Route path="/listing/keywords">{() => <PermissionGuard><KeywordPage /></PermissionGuard>}</Route>
        <Route path="/listing/ad-structure">{() => <PermissionGuard><AdStructurePage /></PermissionGuard>}</Route>
        <Route path="/listing/review-aggregation">{() => <PermissionGuard><ReviewAggregationPage /></PermissionGuard>}</Route>
        <Route path="/listing/video-script">{() => <PermissionGuard><VideoScriptPage /></PermissionGuard>}</Route>
        <Route path="/listing/video-script/:id">{() => <PermissionGuard><VideoScriptPage /></PermissionGuard>}</Route>
        <Route path="/listing/buyer-questions">{() => <PermissionGuard><BuyerQuestionsPage /></PermissionGuard>}</Route>
        <Route path="/listing/project/:id">{() => <PermissionGuard><ProjectDetailPage /></PermissionGuard>}</Route>
        <Route path="/listing/canvas">{() => <PermissionGuard><WorkflowCanvasPage /></PermissionGuard>}</Route>

        {/* Legacy routes → redirect to /listing/* */}
        <Route path="/analysis">{() => <Redirect to="/listing/analysis" />}</Route>
        <Route path="/comparison">{() => <Redirect to="/listing/comparison" />}</Route>
        <Route path="/review-history">{() => <Redirect to="/listing/review-history" />}</Route>
        <Route path="/review-aggregation">{() => <Redirect to="/listing/review-aggregation" />}</Route>
        <Route path="/keywords">{() => <Redirect to="/listing/keywords" />}</Route>
        <Route path="/ad-structure">{() => <Redirect to="/listing/ad-structure" />}</Route>
        <Route path="/data-files">{() => <Redirect to="/listing/data-files" />}</Route>
        <Route path="/generate">{() => <Redirect to="/listing/generate" />}</Route>
        <Route path="/preview">{() => <Redirect to="/listing/preview" />}</Route>
        <Route path="/score">{() => <Redirect to="/listing/score" />}</Route>
        <Route path="/project/:id">{(params) => <Redirect to={`/listing/project/${params.id}`} />}</Route>

        {/* ─── Module 1: Product Development ─── */}
        <Route path="/dev">{() => <PermissionGuard><DevDashboard /></PermissionGuard>}</Route>
        <Route path="/dev/new-project">{() => <PermissionGuard><DevNewProject /></PermissionGuard>}</Route>
        <Route path="/dev/projects">{() => <PermissionGuard><DevProjects /></PermissionGuard>}</Route>
        <Route path="/dev/project/:id">{() => <PermissionGuard><DevProjectDetail /></PermissionGuard>}</Route>
        <Route path="/dev/compare">{() => <PermissionGuard><DevCompare /></PermissionGuard>}</Route>
        <Route path="/dev/supplier-library">{() => <PermissionGuard><DevSupplierLibrary /></PermissionGuard>}</Route>
        <Route path="/dev/project/:id/analysis">{() => <PermissionGuard><DevAnalysisFlow /></PermissionGuard>}</Route>
        <Route path="/dev/project/:id/offsite">{() => <PermissionGuard><DevOffsiteAnalysis /></PermissionGuard>}</Route>

        {/* ─── Module 5: Knowledge Base ─── */}
        <Route path="/knowledge">{() => <PermissionGuard><KBOverview /></PermissionGuard>}</Route>
        <Route path="/knowledge/bot">{() => <PermissionGuard><KBBot /></PermissionGuard>}</Route>
        <Route path="/knowledge/products">{() => <PermissionGuard><KBProducts /></PermissionGuard>}</Route>
        <Route path="/knowledge/listings">{() => <PermissionGuard><KBListings /></PermissionGuard>}</Route>
        <Route path="/knowledge/images">{() => <PermissionGuard><KBImages /></PermissionGuard>}</Route>
        <Route path="/knowledge/skills">{() => <PermissionGuard><KBSkills /></PermissionGuard>}</Route>
        <Route path="/knowledge/videos">{() => <PermissionGuard><KBVideos /></PermissionGuard>}</Route>
        <Route path="/knowledge/intel">{() => <PermissionGuard><KBIntel /></PermissionGuard>}</Route>
        <Route path="/knowledge/transfer">{() => <PermissionGuard><KBTransfer /></PermissionGuard>}</Route>

        {/* ─── Module 3: Operations AI Tools ─── */}
        <Route path="/ops">{() => <PermissionGuard><OpsDashboard /></PermissionGuard>}</Route>
        <Route path="/ops/products">{() => <PermissionGuard><OpsProducts /></PermissionGuard>}</Route>
        <Route path="/ops/products/erp/:source/:parentAsin">{() => <PermissionGuard><OpsProductDetail /></PermissionGuard>}</Route>
        <Route path="/ops/products/import/:source/:parentAsin">{() => <PermissionGuard><OpsProductDetail /></PermissionGuard>}</Route>
        <Route path="/ops/products/:id">{() => <PermissionGuard><OpsProductDetail /></PermissionGuard>}</Route>
        <Route path="/ops/inventory">{() => <PermissionGuard><OpsInventory /></PermissionGuard>}</Route>
        <Route path="/ops/ads">{() => <PermissionGuard><OpsAds /></PermissionGuard>}</Route>
        <Route path="/ops/crawler">{() => <PermissionGuard><OpsCrawlerManager /></PermissionGuard>}</Route>
        <Route path="/ops/shipping/:id">{() => <PermissionGuard><OpsShippingBatchDetail /></PermissionGuard>}</Route>
        <Route path="/ops/logistics">{() => <PermissionGuard><OpsLogistics /></PermissionGuard>}</Route>
        <Route path="/ops/dashboard-upgrade">{() => <PermissionGuard><OpsDashboardUpgrade /></PermissionGuard>}</Route>
        <Route path="/ops/custom-dashboard">{() => <PermissionGuard><OpsCustomDashboard /></PermissionGuard>}</Route>
        <Route path="/ops/data-import">{() => <PermissionGuard><OpsDataImport /></PermissionGuard>}</Route>
        <Route path="/ops/lingxing-sync">{() => <PermissionGuard><OpsLingxingSync /></PermissionGuard>}</Route>
        <Route path="/ops/ad-mapping">{() => <PermissionGuard><OpsAdMapping /></PermissionGuard>}</Route>
        <Route path="/ops/ad-deep">{() => <PermissionGuard><OpsAdDeep /></PermissionGuard>}</Route>
        <Route path="/ops/tasks">{() => <PermissionGuard><OpsTaskManagement /></PermissionGuard>}</Route>

        {/* ─── Module 4: After-sales Management ─── */}
        <Route path="/service">{() => <PermissionGuard><ServiceDashboard /></PermissionGuard>}</Route>
        <Route path="/service/reviews">{() => <PermissionGuard><ServiceReviews /></PermissionGuard>}</Route>
        <Route path="/service/returns">{() => <PermissionGuard><ServiceReturns /></PermissionGuard>}</Route>
        <Route path="/service/emails">{() => <PermissionGuard><ServiceEmails /></PermissionGuard>}</Route>
        <Route path="/service/profiles">{() => <PermissionGuard><ServiceProfiles /></PermissionGuard>}</Route>

        {/* ─── Module 6: Off-site Marketing ─── */}
        <Route path="/offsite">{() => <PermissionGuard><OffsiteOverview /></PermissionGuard>}</Route>
        <Route path="/offsite/influencers">{() => <PermissionGuard><OffsiteInfluencers /></PermissionGuard>}</Route>
        <Route path="/offsite/campaigns">{() => <PermissionGuard><OffsiteCampaigns /></PermissionGuard>}</Route>
        <Route path="/offsite/outreach">{() => <PermissionGuard><OffsiteOutreach /></PermissionGuard>}</Route>
        <Route path="/offsite/content-review">{() => <PermissionGuard><OffsiteContentReview /></PermissionGuard>}</Route>
        <Route path="/offsite/social-accounts">{() => <PermissionGuard><OffsiteSocialAccounts /></PermissionGuard>}</Route>
        <Route path="/offsite/content-calendar">{() => <PermissionGuard><OffsiteContentCalendar /></PermissionGuard>}</Route>
        <Route path="/offsite/tiktok-matrix">{() => <PermissionGuard><OffsiteTikTokMatrix /></PermissionGuard>}</Route>
        <Route path="/offsite/attribution">{() => <PermissionGuard><OffsiteAttribution /></PermissionGuard>}</Route>
        <Route path="/offsite/analytics">{() => <PermissionGuard><OffsiteAnalytics /></PermissionGuard>}</Route>

        {/* ─── Module 7: Emperor AI 能力中台 ─── */}
        <Route path="/emperor">{() => <PermissionGuard><EmperorSkillLibrary /></PermissionGuard>}</Route>
        <Route path="/emperor/skills">{() => <PermissionGuard><EmperorSkillLibrary /></PermissionGuard>}</Route>
        <Route path="/emperor/conversations">{() => <PermissionGuard><EmperorConversations /></PermissionGuard>}</Route>
        <Route path="/emperor/trace">{() => <PermissionGuard><EmperorTrace /></PermissionGuard>}</Route>
        <Route path="/emperor/quality">{() => <PermissionGuard><EmperorQualityGates /></PermissionGuard>}</Route>
        <Route path="/emperor/governance">{() => <PermissionGuard><EmperorHarnessGovernance /></PermissionGuard>}</Route>
        <Route path="/emperor/models">{() => <PermissionGuard><EmperorModels /></PermissionGuard>}</Route>
        <Route path="/emperor/mcp">{() => <PermissionGuard><EmperorMCP /></PermissionGuard>}</Route>
        <Route path="/emperor/agents">{() => <PermissionGuard><EmperorAgents /></PermissionGuard>}</Route>
        <Route path="/emperor/usage">{() => <PermissionGuard><EmperorUsage /></PermissionGuard>}</Route>
        <Route path="/emperor/diagnostics">{() => <PermissionGuard><EmperorDiagnostics /></PermissionGuard>}</Route>
        <Route path="/emperor/settings">{() => <PermissionGuard><EmperorSettings /></PermissionGuard>}</Route>
        <Route path="/emperor/scheduled">{() => <PermissionGuard><EmperorScheduled /></PermissionGuard>}</Route>
        <Route path="/emperor/knowledge">{() => <PermissionGuard><EmperorKnowledge /></PermissionGuard>}</Route>
        <Route path="/emperor/skill-distillation">{() => <PermissionGuard><EmperorSkillDistillation /></PermissionGuard>}</Route>
        <Route path="/emperor/observability">{() => <PermissionGuard><EmperorObservability /></PermissionGuard>}</Route>

        {/* ─── System Settings ─── */}
        <Route path="/settings" component={SystemSettings} />

        {/* ─── User Management & Admin ─── */}
        <Route path="/admin">{() => <Redirect to="/admin/users" />}</Route>
        <Route path="/admin/users">{() => <PermissionGuard><UserManagement /></PermissionGuard>}</Route>
        <Route path="/admin/review">{() => <PermissionGuard><ReviewCenter /></PermissionGuard>}</Route>
        <Route path="/admin/sop-access">{() => <PermissionGuard><SopAccessPage /></PermissionGuard>}</Route>
        <Route path="/admin/assignments">{() => <PermissionGuard><ProjectAssignmentPage /></PermissionGuard>}</Route>
        <Route path="/admin/sync">{() => <PermissionGuard><SyncManagement /></PermissionGuard>}</Route>
        <Route path="/admin/roles">{() => <PermissionGuard><RoleManagement /></PermissionGuard>}</Route>
        <Route path="/profile" component={ProfilePage} />

        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Suspense fallback={<RouteLoadingFallback />}>
            <Switch>
              {CoreWorkflowQaPage ? (
                <Route path="/__qa__/workflows/:domain">{() => <CoreWorkflowQaPage />}</Route>
              ) : null}
              <Route path="/login" component={LoginPage} />
              {/* AgentCanvas is full-screen, outside DashboardLayout */}
              <Route path="/emperor/agents/:slug/canvas">{() => <AgentCanvas />}</Route>
              <Route>{() => <Router />}</Route>
            </Switch>
          </Suspense>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
