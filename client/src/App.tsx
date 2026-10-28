import ListingWorkspace from "./pages/listing/ListingWorkspace";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { claimLazyRecovery } from "@/lib/lazyRecovery";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { NetworkStatusBanner } from "./components/NetworkStatusBanner";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import { lazy, Suspense, useCallback, type ComponentType } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePerformanceVitals, type PerformanceVital } from "@/lib/performanceVitals";

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

import { PermissionGuard } from "./components/PermissionGuard";
const Home = lazyWithRecovery(() => import("./pages/Home"), "lazy-recovery:Home");
const AnalysisPage = lazyWithRecovery(() => import("./pages/AnalysisPage"), "lazy-recovery:AnalysisPage");
const ComparisonPage = lazyWithRecovery(() => import("./pages/ComparisonPage"), "lazy-recovery:ComparisonPage");
const GeneratePage = lazyWithRecovery(() => import("./pages/GeneratePage"), "lazy-recovery:GeneratePage");
const PreviewPage = lazyWithRecovery(() => import("./pages/PreviewPage"), "lazy-recovery:PreviewPage");
const ProjectDetailPage = lazyWithRecovery(() => import("./pages/ProjectDetailPage"), "lazy-recovery:ProjectDetailPage");
const ReviewHistoryPage = lazyWithRecovery(() => import("./pages/ReviewHistoryPage"), "lazy-recovery:ReviewHistoryPage");
const DataFilesPage = lazyWithRecovery(() => import("./pages/DataFilesPage"), "lazy-recovery:DataFilesPage");
const ScorePage = lazyWithRecovery(() => import("./pages/ScorePage"), "lazy-recovery:ScorePage");
const KeywordPage = lazyWithRecovery(() => import("./pages/KeywordPage"), "lazy-recovery:KeywordPage");
const AdStructurePage = lazyWithRecovery(() => import("./pages/AdStructurePage"), "lazy-recovery:AdStructurePage");
const ReviewAggregationPage = lazyWithRecovery(() => import("./pages/ReviewAggregationPage"), "lazy-recovery:ReviewAggregationPage");
const BuyerQuestionsPage = lazyWithRecovery(() => import("./pages/BuyerQuestionsPage"), "lazy-recovery:BuyerQuestionsPage");
const KnowledgeRecycleBin = lazyWithRecovery(() => import("./pages/knowledge/KnowledgeRecycleBin"), "lazy-recovery:KnowledgeRecycleBin");
const KBImageSetPage = lazyWithRecovery(() => import("./pages/knowledge/KBImageSetPage"), "lazy-recovery:KBImageSetPage");
const KBImages = lazyWithRecovery(() => import("./pages/knowledge/KBImages"), "lazy-recovery:KBImages");
const AcquisitionJobDetailsPage = lazyWithRecovery(() => import("./pages/acquisition/AcquisitionJobDetailsPage"), "lazy-recovery:AcquisitionJobDetailsPage");
const AcquisitionJobsPage = lazyWithRecovery(() => import("./pages/acquisition/AcquisitionJobsPage"), "lazy-recovery:AcquisitionJobsPage");
const AcquisitionReviewPage = lazyWithRecovery(() => import("./pages/acquisition/AcquisitionReviewPage"), "lazy-recovery:AcquisitionReviewPage");
const DesignStudio = lazyWithRecovery(() => import("./pages/design/DesignStudio"), "lazy-recovery:DesignStudio");
const DesignPromptLibrary = lazyWithRecovery(() => import("./pages/design/DesignPromptLibrary"), "lazy-recovery:DesignPromptLibrary");
const DesignMaterials = lazyWithRecovery(() => import("./pages/design/DesignMaterials"), "lazy-recovery:DesignMaterials");
const InventorySnapshotReadOnly = lazyWithRecovery(() => import("./pages/ops/InventorySnapshotReadOnly"), "lazy-recovery:InventorySnapshotReadOnly");
const SaihuSyncSchedules = lazyWithRecovery(() => import("./pages/ops/SaihuSyncSchedules"), "lazy-recovery:SaihuSyncSchedules");
const OpsProducts = lazyWithRecovery(() => import("./pages/ops/OpsProducts"), "lazy-recovery:OpsProducts");
const OpsProductDetail = lazyWithRecovery(() => import("./pages/ops/OpsProductDetail"), "lazy-recovery:OpsProductDetail");
const OperationsCenter = lazyWithRecovery(() => import("./pages/ops/OperationsCenter"), "lazy-recovery:OperationsCenter");
const TaskMeetingTools = lazyWithRecovery(() => import("./pages/ops/TaskMeetingTools"), "lazy-recovery:TaskMeetingTools");
const OpsLogistics = lazyWithRecovery(() => import("./pages/ops/OpsLogistics"), "lazy-recovery:OpsLogistics");
const OpsShippingBatchDetail = lazyWithRecovery(() => import("./pages/ops/OpsShippingBatchDetail"), "lazy-recovery:OpsShippingBatchDetail");
const PlatformHome = lazyWithRecovery(() => import("./pages/PlatformHome"), "lazy-recovery:PlatformHome");
const ComingSoonPage = lazyWithRecovery(() => import("./pages/ComingSoonPage"), "lazy-recovery:ComingSoonPage");
const LoginPage = lazyWithRecovery(() => import("./pages/LoginPage"), "lazy-recovery:LoginPage");
const UserManagement = lazyWithRecovery(() => import("./pages/UserManagement"), "lazy-recovery:UserManagement");
const RoleManagement = lazyWithRecovery(() => import("./pages/RoleManagement"), "lazy-recovery:RoleManagement");
const ProfilePage = lazyWithRecovery(() => import("./pages/ProfilePage"), "lazy-recovery:ProfilePage");
const EmperorSkillLibrary = lazyWithRecovery(() => import("./pages/emperor/EmperorSkillLibrary"), "lazy-recovery:EmperorSkillLibrary");
const EmperorAgentLibrary = lazyWithRecovery(() => import("./pages/emperor/EmperorAgentLibrary"), "lazy-recovery:EmperorAgentLibrary");
const EmperorModels = lazyWithRecovery(() => import("./pages/emperor/EmperorModels"), "lazy-recovery:EmperorModels");
const EmperorSettings = lazyWithRecovery(() => import("./pages/emperor/EmperorSettings"), "lazy-recovery:EmperorSettings");

export function RouteLoadingFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="页面加载中">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  );
}

function PerformanceVitalsReporter() {
  const { isAuthenticated } = useAuth();
  const recordVitals = trpc.performance.recordVitals.useMutation();
  const report = useCallback((events: PerformanceVital[]) => {
    recordVitals.mutate({ events });
  }, [recordVitals]);
  usePerformanceVitals(isAuthenticated, report);
  return null;
}

function Router() {
  return (
    <DashboardLayout>
      <PerformanceVitalsReporter />
      <Switch>
        <Route path="/">{() => <PlatformHome />}</Route>
        <Route path="/listing">{() => <PermissionGuard><ListingWorkspace><Home /></ListingWorkspace></PermissionGuard>}</Route>
        <Route path="/listing/acquisition/review/:snapshotId">{() => <PermissionGuard moduleId="listing"><AcquisitionReviewPage /></PermissionGuard>}</Route>
        <Route path="/listing/analysis">{() => <PermissionGuard><ListingWorkspace><AnalysisPage /></ListingWorkspace></PermissionGuard>}</Route>
        <Route path="/listing/comparison">{() => <PermissionGuard><ListingWorkspace><ComparisonPage /></ListingWorkspace></PermissionGuard>}</Route>
        <Route path="/listing/generate">{() => <PermissionGuard><ListingWorkspace><GeneratePage /></ListingWorkspace></PermissionGuard>}</Route>
        <Route path="/listing/preview">{() => <PermissionGuard><ListingWorkspace><PreviewPage /></ListingWorkspace></PermissionGuard>}</Route>
        <Route path="/listing/review-history">{() => <PermissionGuard><ListingWorkspace><ReviewHistoryPage /></ListingWorkspace></PermissionGuard>}</Route>
        <Route path="/listing/data-files">{() => <PermissionGuard><ListingWorkspace><DataFilesPage /></ListingWorkspace></PermissionGuard>}</Route>
        <Route path="/listing/score">{() => <PermissionGuard><ListingWorkspace><ScorePage /></ListingWorkspace></PermissionGuard>}</Route>
        <Route path="/listing/keywords">{() => <PermissionGuard><ListingWorkspace><KeywordPage /></ListingWorkspace></PermissionGuard>}</Route>
        <Route path="/listing/ad-structure">{() => <PermissionGuard><ListingWorkspace><AdStructurePage /></ListingWorkspace></PermissionGuard>}</Route>
        <Route path="/listing/review-aggregation">{() => <PermissionGuard><ListingWorkspace><ReviewAggregationPage /></ListingWorkspace></PermissionGuard>}</Route>
        <Route path="/listing/buyer-questions">{() => <PermissionGuard><ListingWorkspace><BuyerQuestionsPage /></ListingWorkspace></PermissionGuard>}</Route>
        <Route path="/listing/project/:id">{() => <PermissionGuard><ListingWorkspace><ProjectDetailPage /></ListingWorkspace></PermissionGuard>}</Route>
        <Route path="/analysis">{() => <Redirect to={`/listing/analysis${window.location.search}`} />}</Route>
        <Route path="/comparison">{() => <Redirect to={`/listing/comparison${window.location.search}`} />}</Route>
        <Route path="/generate">{() => <Redirect to={`/listing/generate${window.location.search}`} />}</Route>
        <Route path="/preview">{() => <Redirect to={`/listing/preview${window.location.search}`} />}</Route>
        <Route path="/review-history">{() => <Redirect to={`/listing/review-history${window.location.search}`} />}</Route>
        <Route path="/review-aggregation">{() => <Redirect to={`/listing/review-aggregation${window.location.search}`} />}</Route>
        <Route path="/keywords">{() => <Redirect to={`/listing/keywords${window.location.search}`} />}</Route>
        <Route path="/ad-structure">{() => <Redirect to={`/listing/ad-structure${window.location.search}`} />}</Route>
        <Route path="/data-files">{() => <Redirect to={`/listing/data-files${window.location.search}`} />}</Route>
        <Route path="/score">{() => <Redirect to={`/listing/score${window.location.search}`} />}</Route>
        <Route path="/project/:id">{params => <Redirect to={`/listing/project/${params.id}`} />}</Route>
        <Route path="/dev">{() => <PermissionGuard><ComingSoonPage moduleName="产品开发" /></PermissionGuard>}</Route>
        <Route path="/procurement">{() => <PermissionGuard moduleId="procurement" subModuleId="procurement_logistics"><OpsLogistics /></PermissionGuard>}</Route>
        <Route path="/procurement/shipping/:id">{() => <PermissionGuard moduleId="procurement" subModuleId="procurement_logistics"><OpsShippingBatchDetail /></PermissionGuard>}</Route>
        <Route path="/finance">{() => <PermissionGuard><ComingSoonPage moduleName="财务" /></PermissionGuard>}</Route>
        <Route path="/knowledge">{() => <Redirect to="/knowledge/images" />}</Route>
        <Route path="/knowledge/recycle"><PermissionGuard><KnowledgeRecycleBin /></PermissionGuard></Route>
        <Route path="/knowledge/images/:id">{() => <PermissionGuard><KBImageSetPage /></PermissionGuard>}</Route>
        <Route path="/knowledge/images">{() => <PermissionGuard><KBImages /></PermissionGuard>}</Route>
        <Route path="/knowledge/acquisition/review/:snapshotId">{() => <PermissionGuard><AcquisitionReviewPage /></PermissionGuard>}</Route>
        <Route path="/knowledge/acquisition/job/:jobId">{() => <PermissionGuard><AcquisitionJobDetailsPage /></PermissionGuard>}</Route>
        <Route path="/knowledge/acquisition">{() => <PermissionGuard><AcquisitionJobsPage /></PermissionGuard>}</Route>
        <Route path="/design/images">{() => <PermissionGuard moduleId="design" subModuleId="design_images"><DesignStudio /></PermissionGuard>}</Route>
        <Route path="/design/prompts">{() => <PermissionGuard moduleId="design" subModuleId="design_prompts"><DesignPromptLibrary /></PermissionGuard>}</Route>
        <Route path="/design/materials">{() => <PermissionGuard moduleId="design" subModuleId="design_materials"><DesignMaterials /></PermissionGuard>}</Route>
        <Route path="/ops">{() => <Redirect to="/ops/products" />}</Route>
        <Route path="/ops/products">{() => <PermissionGuard><OpsProducts /></PermissionGuard>}</Route>
        <Route path="/ops/products/view/:parentAsin">{() => <PermissionGuard><OpsProductDetail /></PermissionGuard>}</Route>
        <Route path="/ops/products/erp/:source/:parentAsin">{() => <PermissionGuard><OpsProductDetail /></PermissionGuard>}</Route>
        <Route path="/ops/products/import/:source/:parentAsin">{() => <PermissionGuard><OpsProductDetail /></PermissionGuard>}</Route>
        <Route path="/ops/products/:id">{() => <PermissionGuard><OpsProductDetail /></PermissionGuard>}</Route>
        <Route path="/ops/inventory">{() => <Redirect to="/ops/inventory-details" />}</Route>
        <Route path="/ops/inventory-details">{() => <PermissionGuard moduleId="ops" subModuleId="ops_data_import"><InventorySnapshotReadOnly withRefresh currentProducts /></PermissionGuard>}</Route>
        <Route path="/ops/saihu-sync">{() => <PermissionGuard moduleId="ops" subModuleId="ops_data_import"><SaihuSyncSchedules /></PermissionGuard>}</Route>
        <Route path="/ops/product-tasks">{() => <PermissionGuard moduleId="ops" subModuleId="ops_tasks"><OperationsCenter initialPanel="tasks" /></PermissionGuard>}</Route>
        <Route path="/ops/profit-board">{() => <PermissionGuard moduleId="ops" subModuleId="ops_data_import"><OperationsCenter initialPanel="profit" /></PermissionGuard>}</Route>
        <Route path="/ops/product-board">{() => <PermissionGuard moduleId="ops" subModuleId="ops_data_import"><OperationsCenter initialPanel="products" /></PermissionGuard>}</Route>
        <Route path="/ops/ads">{() => <PermissionGuard><ComingSoonPage moduleName="广告看板" /></PermissionGuard>}</Route>
        <Route path="/ops/task-tools">{() => <PermissionGuard moduleId="ops" subModuleId="ops_tasks"><TaskMeetingTools /></PermissionGuard>}</Route>
        <Route path="/ops/tasks">{() => <Redirect to={`/ops/product-tasks${window.location.search}`} />}</Route>
        <Route path="/ops/logistics">{() => <Redirect to="/procurement" />}</Route>
        <Route path="/emperor">{() => <Redirect to="/emperor/skills" />}</Route>
        <Route path="/emperor/skills">{() => <PermissionGuard><EmperorSkillLibrary /></PermissionGuard>}</Route>
        <Route path="/emperor/agent-library">{() => <PermissionGuard moduleId="emperor" subModuleId="emperor_agents"><EmperorAgentLibrary /></PermissionGuard>}</Route>
        <Route path="/emperor/models">{() => <PermissionGuard><EmperorModels /></PermissionGuard>}</Route>
        <Route path="/emperor/settings">{() => <PermissionGuard><EmperorSettings /></PermissionGuard>}</Route>
        <Route path="/admin">{() => <Redirect to="/admin/users" />}</Route>
        <Route path="/admin/users">{() => <PermissionGuard><UserManagement /></PermissionGuard>}</Route>
        <Route path="/admin/roles">{() => <PermissionGuard><RoleManagement /></PermissionGuard>}</Route>
        <Route path="/profile">{() => <ProfilePage />}</Route>
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
          <NetworkStatusBanner />
          <Toaster />
          <Suspense fallback={<RouteLoadingFallback />}>
            <Switch>
              <Route path="/login" component={LoginPage} />
              <Route>{() => <Router />}</Route>
            </Switch>
          </Suspense>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
