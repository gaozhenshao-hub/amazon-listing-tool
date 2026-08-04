import type * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ArrowRight, BarChart3, Brain, Check, Edit3, Loader2, Lock, Unlock, Play, RefreshCw, TrendingUp, DollarSign, Building2, MessageSquare, LayoutDashboard, Grid3X3, Sparkles } from "lucide-react";
import { Streamdown } from "streamdown";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ScatterChart, Scatter, ZAxis, LineChart, Line } from "recharts";
import { CHART_COLORS, DEV_ANALYSIS_STAGES as STAGES, type DevAnalysisStageKey as StageKey } from "./stageDefinitions";

import { MarketOverviewResult } from "./MarketOverviewResult";
import { AttributeCrossResult } from "./AttributeCrossResult";
import { PriceAnalysisResult } from "./PriceAnalysisResult";
import { BrandCompetitionResult } from "./BrandCompetitionResult";
import { ReviewKanoResult } from "./ReviewKanoResult";
import { DecisionDashboardResult } from "./DecisionDashboardResult";
import { InformationSummaryResult } from "./InformationSummaryResult";
import { GenericResult } from "./GenericResult";

/* ─── Stage Result Display Component ─── */
export function StageResultDisplay({ stageKey, stageData, productCount, gatingInfo }: { stageKey: StageKey; stageData: any; productCount: number; gatingInfo?: { canRun: boolean; reason?: string | null; missingPrereqs?: string[] | null } }) {
  if (!stageData || stageData.status === "pending") {
    const stage = STAGES.find(s => s.key === stageKey)!;
    const Icon = stage.icon;
    const isGated = gatingInfo && !gatingInfo.canRun;

    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          {isGated ? (
            <>
              <div className="h-16 w-16 rounded-full bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center mb-4">
                <Lock className="h-8 w-8 text-amber-500" />
              </div>
              <p className="text-sm font-semibold text-foreground">{stage.label} — 未解锁</p>
              <p className="text-xs mt-2 text-amber-600 dark:text-amber-400 max-w-md text-center">{gatingInfo.reason}</p>
              {gatingInfo.missingPrereqs && gatingInfo.missingPrereqs.length > 0 && (
                <div className="mt-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 max-w-md w-full">
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-2">需要先完成以下步骤：</p>
                  <div className="space-y-1.5">
                    {gatingInfo.missingPrereqs.map((prereq, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400/80">
                        <div className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                        <span>{prereq}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-xs mt-4 text-muted-foreground">完成前置条件后，此阶段将自动解锁</p>
            </>
          ) : (
            <>
              <Icon className="h-12 w-12 mb-4 opacity-20" />
              <p className="text-sm font-medium">{stage.label}</p>
              <p className="text-xs mt-1">{stage.desc}</p>
              <p className="text-xs mt-3">点击左侧“开始分析”按钮执行此阶段</p>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  if (stageData.status === "running" || stageData.status === "generating") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-20">
          <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
          <p className="text-sm font-medium">正在分析中...</p>
          <p className="text-xs text-muted-foreground mt-1">AI正在处理数据，请稍候</p>
        </CardContent>
      </Card>
    );
  }

  // Parse result
  const resultStr = stageData.editedResult || stageData.rawResult;
  let result: any = null;
  try { result = JSON.parse(resultStr); } catch { result = null; }

  if (!result) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Sparkles className="h-10 w-10 mb-4 opacity-20" />
          <p className="text-sm">暂无分析结果</p>
        </CardContent>
      </Card>
    );
  }

  // Render based on stage type
  switch (stageKey) {
    // attribute_tagging has been moved to a separate tab
    case "market_overview": return <MarketOverviewResult result={result} productCount={productCount} />;
    case "attribute_cross": return <AttributeCrossResult result={result} />;
    case "price_analysis": return <PriceAnalysisResult result={result} />;
    case "brand_competition": return <BrandCompetitionResult result={result} />;
    case "review_kano": return <ReviewKanoResult result={result} />;
    case "information_summary": return <InformationSummaryResult result={result} />;
    case "decision_dashboard": return <DecisionDashboardResult result={result} />;
    default: return <GenericResult result={result} />;
  }
}

/* ─── 1. Attribute Tagging Result (Removed - now in separate tab) ─── */
