import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import { lazy, Suspense } from "react";

// ─── Module 2: Listing (existing pages) ────────────────────────
import Home from "./pages/Home";
import AnalysisPage from "./pages/AnalysisPage";
import GeneratePage from "./pages/GeneratePage";
import PreviewPage from "./pages/PreviewPage";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import ComparisonPage from "./pages/ComparisonPage";
import ReviewHistoryPage from "./pages/ReviewHistoryPage";
import DataFilesPage from "./pages/DataFilesPage";
import ScorePage from "./pages/ScorePage";
import ImageSuggestionsPage from "./pages/ImageSuggestionsPage";
import ImageWorkflowPage from "./pages/ImageWorkflowPage";
import KeywordPage from "./pages/KeywordPage";
import AdStructurePage from "./pages/AdStructurePage";
import ReviewAggregationPage from "./pages/ReviewAggregationPage";

// ─── Module 1: Product Development ─────────────────────────────
import DevDashboard from "./pages/dev/DevDashboard";
import DevNewProject from "./pages/dev/DevNewProject";
import DevProjectList from "./pages/dev/DevProjectList";
import DevProjectDetail from "./pages/dev/DevProjectDetail";
import DevCompare from "./pages/dev/DevCompare";
import DevSupplierLibrary from "./pages/dev/DevSupplierLibrary";
import DevAnalysisFlow from "./pages/dev/DevAnalysisFlow";
import DevOffsiteAnalysis from "./pages/dev/DevOffsiteAnalysis";

// ─── Module 5: Knowledge Base ───────────────────────────────────
import KBOverview from "./pages/knowledge/KBOverview";
import KBProducts from "./pages/knowledge/KBProducts";
import KBListings from "./pages/knowledge/KBListings";
import KBImages from "./pages/knowledge/KBImages";
import KBSkills from "./pages/knowledge/KBSkills";
import KBVideos from "./pages/knowledge/KBVideos";

// ─── Module 3/4: Placeholder ────────────────────────────────────
import ComingSoonPage from "./pages/ComingSoonPage";

// ─── Platform Home ──────────────────────────────────────────────
import PlatformHome from "./pages/PlatformHome";

// ─── System Settings ────────────────────────────────────────────
import SystemSettings from "./pages/SystemSettings";

// ─── User Management ────────────────────────────────────────────
import LoginPage from "./pages/LoginPage";
import UserManagement from "./pages/UserManagement";
import ProfilePage from "./pages/ProfilePage";
import ReviewCenter from "./pages/ReviewCenter";
import SopAccessPage from "./pages/SopAccessPage";
import ProjectAssignmentPage from "./pages/ProjectAssignmentPage";
import SyncManagement from "./pages/SyncManagement";
import RoleManagement from "./pages/RoleManagement";

function Router() {
  return (
    <DashboardLayout>
      <Switch>
        {/* Platform root → redirect to listing (default module) */}
        <Route path="/" component={PlatformHome} />

        {/* ─── Module 2: Listing (with /listing prefix) ─── */}
        <Route path="/listing" component={Home} />
        <Route path="/listing/analysis" component={AnalysisPage} />
        <Route path="/listing/generate" component={GeneratePage} />
        <Route path="/listing/preview" component={PreviewPage} />
        <Route path="/listing/comparison" component={ComparisonPage} />
        <Route path="/listing/review-history" component={ReviewHistoryPage} />
        <Route path="/listing/data-files" component={DataFilesPage} />
        <Route path="/listing/score" component={ScorePage} />
        <Route path="/listing/image-suggestions" component={ImageSuggestionsPage} />
        <Route path="/listing/image-workflow" component={ImageWorkflowPage} />
        <Route path="/listing/keywords" component={KeywordPage} />
        <Route path="/listing/ad-structure" component={AdStructurePage} />
        <Route path="/listing/review-aggregation" component={ReviewAggregationPage} />
        <Route path="/listing/project/:id" component={ProjectDetailPage} />

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
        <Route path="/dev" component={DevDashboard} />
        <Route path="/dev/new-project" component={DevNewProject} />
        <Route path="/dev/projects" component={DevProjectList} />
        <Route path="/dev/project/:id" component={DevProjectDetail} />
        <Route path="/dev/compare" component={DevCompare} />
        <Route path="/dev/supplier-library" component={DevSupplierLibrary} />
        <Route path="/dev/project/:id/analysis" component={DevAnalysisFlow} />
        <Route path="/dev/project/:id/offsite" component={DevOffsiteAnalysis} />

        {/* ─── Module 5: Knowledge Base ─── */}
        <Route path="/knowledge" component={KBOverview} />
        <Route path="/knowledge/products" component={KBProducts} />
        <Route path="/knowledge/listings" component={KBListings} />
        <Route path="/knowledge/images" component={KBImages} />
        <Route path="/knowledge/skills" component={KBSkills} />
        <Route path="/knowledge/videos" component={KBVideos} />

        {/* ─── Module 3: Operations (placeholder) ─── */}
        <Route path="/ops">{() => <ComingSoonPage moduleName="智能运营提效" />}</Route>
        <Route path="/ops/:rest*">{() => <ComingSoonPage moduleName="智能运营提效" />}</Route>

        {/* ─── Module 4: After-sales (placeholder) ─── */}
        <Route path="/service">{() => <ComingSoonPage moduleName="智能售后管理" />}</Route>
        <Route path="/service/:rest*">{() => <ComingSoonPage moduleName="智能售后管理" />}</Route>

        {/* ─── System Settings ─── */}
        <Route path="/settings" component={SystemSettings} />

        {/* ─── User Management & Admin ─── */}
        <Route path="/admin">{() => <Redirect to="/admin/users" />}</Route>
        <Route path="/admin/users" component={UserManagement} />
        <Route path="/admin/review" component={ReviewCenter} />
        <Route path="/admin/sop-access" component={SopAccessPage} />
        <Route path="/admin/assignments" component={ProjectAssignmentPage} />
        <Route path="/admin/sync" component={SyncManagement} />
        <Route path="/admin/roles" component={RoleManagement} />
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
          <Switch>
            <Route path="/login" component={LoginPage} />
            <Route>{() => <Router />}</Route>
          </Switch>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
