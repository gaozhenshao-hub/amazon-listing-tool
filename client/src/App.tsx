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
import VideoScriptPage from "./pages/VideoScriptPage";

// ─── Module 1: Product Development ─────────────────────────────
import DevDashboard from "./pages/dev/DevDashboard";
import DevNewProject from "./pages/dev/DevNewProject";
import DevProjects from "./pages/dev/DevProjects";
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
import KBBot from "./pages/knowledge/KBBot";
import KBIntel from "./pages/knowledge/KBIntel";

// ─── Module 3: Operations AI Tools ─────────────────────────────
import OpsDashboard from "./pages/ops/OpsDashboard";
import OpsInventory from "./pages/ops/OpsInventory";
import OpsProfit from "./pages/ops/OpsProfit";
import OpsAds from "./pages/ops/OpsAds";
import OpsCompetitor from "./pages/ops/OpsCompetitor";
import OpsProducts from "./pages/ops/OpsProducts";
import OpsProductDetail from "./pages/ops/OpsProductDetail";
import OpsCrawlerManager from "./pages/ops/OpsCrawlerManager";
import OpsShippingBatchDetail from "./pages/ops/OpsShippingBatchDetail";
import OpsLogistics from "./pages/ops/OpsLogistics";
import OpsProfitDeep from "./pages/ops/OpsProfitDeep";
import OpsDashboardUpgrade from "./pages/ops/OpsDashboardUpgrade";
import OpsCustomDashboard from "./pages/ops/OpsCustomDashboard";
import OpsCompetitorMonitor from "./pages/ops/OpsCompetitorMonitor";
import OpsTaskManagement from "./pages/ops/OpsTaskManagement";
import OpsDataImport from "./pages/ops/OpsDataImport";

// ─── Module 4: After-sales Management ──────────────────────────
import ComingSoonPage from "./pages/ComingSoonPage";
import ServiceDashboard from "./pages/service/ServiceDashboard";
import ServiceReviews from "./pages/service/ServiceReviews";
import ServiceReturns from "./pages/service/ServiceReturns";
import ServiceEmails from "./pages/service/ServiceEmails";
import ServiceProfiles from "./pages/service/ServiceProfiles";

// ─── Module 6: Off-site Marketing ──────────────────────────────
import OffsiteOverview from "./pages/offsite/OffsiteOverview";
import OffsiteInfluencers from "./pages/offsite/OffsiteInfluencers";
import OffsiteCampaigns from "./pages/offsite/OffsiteCampaigns";
import OffsiteOutreach from "./pages/offsite/OffsiteOutreach";
import OffsiteContentReview from "./pages/offsite/OffsiteContentReview";
import OffsiteSocialAccounts from "./pages/offsite/OffsiteSocialAccounts";
import OffsiteContentCalendar from "./pages/offsite/OffsiteContentCalendar";
import OffsiteTikTokMatrix from "./pages/offsite/OffsiteTikTokMatrix";
import OffsiteAttribution from "./pages/offsite/OffsiteAttribution";
import OffsiteAnalytics from "./pages/offsite/OffsiteAnalytics";

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
import { PermissionGuard } from "./components/PermissionGuard";

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
        <Route path="/listing/project/:id">{() => <PermissionGuard><ProjectDetailPage /></PermissionGuard>}</Route>

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

        {/* ─── Module 3: Operations AI Tools ─── */}
        <Route path="/ops">{() => <PermissionGuard><OpsDashboard /></PermissionGuard>}</Route>
        <Route path="/ops/products">{() => <PermissionGuard><OpsProducts /></PermissionGuard>}</Route>
        <Route path="/ops/products/:id">{() => <PermissionGuard><OpsProductDetail /></PermissionGuard>}</Route>
        <Route path="/ops/profit">{() => <PermissionGuard><OpsProfit /></PermissionGuard>}</Route>
        <Route path="/ops/inventory">{() => <PermissionGuard><OpsInventory /></PermissionGuard>}</Route>
        <Route path="/ops/ads">{() => <PermissionGuard><OpsAds /></PermissionGuard>}</Route>
        <Route path="/ops/competitor">{() => <PermissionGuard><OpsCompetitor /></PermissionGuard>}</Route>
        <Route path="/ops/crawler">{() => <PermissionGuard><OpsCrawlerManager /></PermissionGuard>}</Route>
        <Route path="/ops/shipping/:id">{() => <PermissionGuard><OpsShippingBatchDetail /></PermissionGuard>}</Route>
        <Route path="/ops/logistics">{() => <PermissionGuard><OpsLogistics /></PermissionGuard>}</Route>
        <Route path="/ops/profit-deep">{() => <PermissionGuard><OpsProfitDeep /></PermissionGuard>}</Route>
        <Route path="/ops/dashboard-upgrade">{() => <PermissionGuard><OpsDashboardUpgrade /></PermissionGuard>}</Route>
        <Route path="/ops/custom-dashboard">{() => <PermissionGuard><OpsCustomDashboard /></PermissionGuard>}</Route>
        <Route path="/ops/competitor-monitor">{() => <PermissionGuard><OpsCompetitorMonitor /></PermissionGuard>}</Route>
        <Route path="/ops/data-import">{() => <PermissionGuard><OpsDataImport /></PermissionGuard>}</Route>
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
