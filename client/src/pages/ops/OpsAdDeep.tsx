import { useState, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Activity, Upload, BarChart3, Target, Search, Layers,
  Stethoscope, ClipboardList, Calendar, Filter, Database,
  TrendingUp, Eye, DollarSign, ShoppingBag, Zap,
} from "lucide-react";
import AdDeepDataUpload from "./ad-deep/AdDeepDataUpload";
import AdDeepProductStage from "./ad-deep/AdDeepProductStage";
import AdDeepKeywordTier from "./ad-deep/AdDeepKeywordTier";
import AdDeepCrossDiagnosis from "./ad-deep/AdDeepCrossDiagnosis";
import AdDeepReportAnalysis from "./ad-deep/AdDeepReportAnalysis";
import AdDeepSopBoard from "./ad-deep/AdDeepSopBoard";
import AdDeepClinic from "./ad-deep/AdDeepClinic";

export default function OpsAdDeep() {
  const [activeTab, setActiveTab] = useState("data-upload");

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6 text-blue-600" />
            广告深度优化（每日）
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            基于五大每日报告的AI深度分析引擎，提供产品周期诊断、关键词分级、串联诊断、独立报表分析、SOP看板和AI诊所
          </p>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-7 h-auto">
          <TabsTrigger value="data-upload" className="text-xs gap-1 py-2">
            <Database className="w-3.5 h-3.5" />数据基座
          </TabsTrigger>
          <TabsTrigger value="product-stage" className="text-xs gap-1 py-2">
            <TrendingUp className="w-3.5 h-3.5" />产品周期
          </TabsTrigger>
          <TabsTrigger value="keyword-tier" className="text-xs gap-1 py-2">
            <Layers className="w-3.5 h-3.5" />关键词分级
          </TabsTrigger>
          <TabsTrigger value="cross-diagnosis" className="text-xs gap-1 py-2">
            <Zap className="w-3.5 h-3.5" />串联诊断
          </TabsTrigger>
          <TabsTrigger value="report-analysis" className="text-xs gap-1 py-2">
            <BarChart3 className="w-3.5 h-3.5" />报表分析
          </TabsTrigger>
          <TabsTrigger value="sop-board" className="text-xs gap-1 py-2">
            <ClipboardList className="w-3.5 h-3.5" />SOP看板
          </TabsTrigger>
          <TabsTrigger value="clinic" className="text-xs gap-1 py-2">
            <Stethoscope className="w-3.5 h-3.5" />AI诊所
          </TabsTrigger>
        </TabsList>

        <TabsContent value="data-upload" className="mt-4">
          <AdDeepDataUpload />
        </TabsContent>
        <TabsContent value="product-stage" className="mt-4">
          <AdDeepProductStage />
        </TabsContent>
        <TabsContent value="keyword-tier" className="mt-4">
          <AdDeepKeywordTier />
        </TabsContent>
        <TabsContent value="cross-diagnosis" className="mt-4">
          <AdDeepCrossDiagnosis />
        </TabsContent>
        <TabsContent value="report-analysis" className="mt-4">
          <AdDeepReportAnalysis />
        </TabsContent>
        <TabsContent value="sop-board" className="mt-4">
          <AdDeepSopBoard />
        </TabsContent>
        <TabsContent value="clinic" className="mt-4">
          <AdDeepClinic />
        </TabsContent>
      </Tabs>
    </div>
  );
}
