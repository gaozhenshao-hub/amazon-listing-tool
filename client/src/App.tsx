import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import Home from "./pages/Home";
import AnalysisPage from "./pages/AnalysisPage";
import ImageAnalysisPage from "./pages/ImageAnalysisPage";
import GeneratePage from "./pages/GeneratePage";
import PreviewPage from "./pages/PreviewPage";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import ComparisonPage from "./pages/ComparisonPage";
import ReviewHistoryPage from "./pages/ReviewHistoryPage";
import DataFilesPage from "./pages/DataFilesPage";
import ScorePage from "./pages/ScorePage";
import KeywordPage from "./pages/KeywordPage";
import AdStructurePage from "./pages/AdStructurePage";
import ReviewAggregationPage from "./pages/ReviewAggregationPage";

function Router() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/analysis" component={AnalysisPage} />
        <Route path="/image-analysis" component={ImageAnalysisPage} />
        <Route path="/generate" component={GeneratePage} />
        <Route path="/preview" component={PreviewPage} />
        <Route path="/comparison" component={ComparisonPage} />
        <Route path="/review-history" component={ReviewHistoryPage} />
        <Route path="/data-files" component={DataFilesPage} />
        <Route path="/score" component={ScorePage} />
        <Route path="/keywords" component={KeywordPage} />
        <Route path="/ad-structure" component={AdStructurePage} />
        <Route path="/review-aggregation" component={ReviewAggregationPage} />
        <Route path="/project/:id" component={ProjectDetailPage} />
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
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
