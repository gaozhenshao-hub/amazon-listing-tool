import { useState, useMemo, lazy, Suspense } from "react";
import { trpc } from "@/lib/trpc";
import { useMarketplace } from "@/contexts/MarketplaceContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from "recharts";
import {
  Target, Sparkles, RefreshCw, Loader2, Search, DollarSign,
  MousePointerClick, Eye, TrendingUp, TrendingDown, AlertTriangle,
  Zap, Filter, BarChart3, Clock, XCircle, Activity, Crosshair,
  Package, Settings2, Type, Gem, MessageSquare, Layers, Monitor,
} from "lucide-react";

// Sub-components
import AsinSelector from "./ads/AsinSelector";
import SearchTermClassification from "./ads/SearchTermClassification";
import AdPlacementAnalysis from "./ads/AdPlacementAnalysis";
import HourlyBidStrategy from "./ads/HourlyBidStrategy";
import NegativeKeywords from "./ads/NegativeKeywords";
import AdDiagnostics from "./ads/AdDiagnostics";
import TargetingAnalysis from "./ads/TargetingAnalysis";
import WordFrequencyAnalysis from "./ads/WordFrequencyAnalysis";
import EffectiveSearchTerms from "./ads/EffectiveSearchTerms";
import DspAnalysis from "./ads/DspAnalysis";
import AdChatBot from "./ads/AdChatBot";
import CrossChannelAnalysis from "./ads/CrossChannelAnalysis";

const PIE_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#9ca3af", "#8b5cf6", "#06b6d4", "#f97316"];

export default function OpsAds() {
  const [selectedAsin, setSelectedAsin] = useState<string | null>(null);
  const [selectedDays, setSelectedDays] = useState(7);
  const [activeTab, setActiveTab] = useState("overview");
  const { marketplace } = useMarketplace();

  // Overview data - campaign summary
  const { data: campaignData, isLoading: campaignLoading, refetch: refetchCampaigns } = trpc.operations.getAdCampaigns.useQuery({
    marketplace,
    adState: "enabled",
  });

  const campaigns = campaignData?.campaigns || [];

  // Overview metrics
  const overviewMetrics = useMemo(() => {
    let impressions = 0, clicks = 0, cost = 0, sales = 0, orders = 0;
    campaigns.forEach((c: any) => {
      impressions += c.impressions || 0;
      clicks += c.clicks || 0;
      cost += c.cost || 0;
      sales += c.sales || 0;
      orders += c.orders || 0;
    });
    return {
      impressions, clicks, cost, sales, orders,
      acos: sales > 0 ? Math.round(cost / sales * 10000) / 100 : 0,
      ctr: impressions > 0 ? Math.round(clicks / impressions * 10000) / 100 : 0,
      cvr: clicks > 0 ? Math.round(orders / clicks * 10000) / 100 : 0,
      cpc: clicks > 0 ? Math.round(cost / clicks * 100) / 100 : 0,
      roas: cost > 0 ? Math.round(sales / cost * 100) / 100 : 0,
    };
  }, [campaigns]);

  // Campaign type distribution
  const campaignTypeData = useMemo(() => {
    const typeMap: Record<string, number> = {};
    campaigns.forEach((c: any) => {
      const type = c.targeting_type || c.campaign_type || "SP";
      typeMap[type] = (typeMap[type] || 0) + (c.cost || 0);
    });
    return Object.entries(typeMap).map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }));
  }, [campaigns]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Target className="w-5 h-5 text-blue-600" />
            广告智能分析
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">以ASIN为核心维度的全方位广告数据分析与AI优化建议</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Days Selector */}
          <Select value={String(selectedDays)} onValueChange={(v) => setSelectedDays(Number(v))}>
            <SelectTrigger className="w-28 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">近7天</SelectItem>
              <SelectItem value="14">近14天</SelectItem>
              <SelectItem value="30">近30天</SelectItem>
              <SelectItem value="60">近60天</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8" onClick={() => refetchCampaigns()}>
            <RefreshCw className="w-3.5 h-3.5 mr-1" />
            刷新
          </Button>
        </div>
      </div>

      {/* ASIN Selector */}
      <AsinSelector
        selectedAsin={selectedAsin}
        onSelect={setSelectedAsin}
        marketplace={marketplace}
      />

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="overview" className="text-xs gap-1">
            <BarChart3 className="w-3.5 h-3.5" />
            广告总览
          </TabsTrigger>
          <TabsTrigger value="search-terms" className="text-xs gap-1">
            <Search className="w-3.5 h-3.5" />
            搜索词12分类
          </TabsTrigger>
          <TabsTrigger value="targeting" className="text-xs gap-1">
            <Crosshair className="w-3.5 h-3.5" />
            投放对象分析
          </TabsTrigger>
          <TabsTrigger value="placement" className="text-xs gap-1">
            <Eye className="w-3.5 h-3.5" />
            广告位分析
          </TabsTrigger>
          <TabsTrigger value="hourly" className="text-xs gap-1">
            <Clock className="w-3.5 h-3.5" />
            分时竞价
          </TabsTrigger>
          <TabsTrigger value="negative" className="text-xs gap-1">
            <XCircle className="w-3.5 h-3.5" />
            否定词管理
          </TabsTrigger>
          <TabsTrigger value="word-freq" className="text-xs gap-1">
            <Type className="w-3.5 h-3.5" />
            词频属性
          </TabsTrigger>
          <TabsTrigger value="effective-terms" className="text-xs gap-1">
            <Gem className="w-3.5 h-3.5" />
            有效出单词
          </TabsTrigger>
          <TabsTrigger value="diagnostics" className="text-xs gap-1">
            <Activity className="w-3.5 h-3.5" />
            广告诊断
          </TabsTrigger>
          <TabsTrigger value="dsp" className="text-xs gap-1">
            <Monitor className="w-3.5 h-3.5" />
            DSP分析
          </TabsTrigger>
          <TabsTrigger value="cross-channel" className="text-xs gap-1">
            <Layers className="w-3.5 h-3.5" />
            跨渠道分析
          </TabsTrigger>
          <TabsTrigger value="ai-bot" className="text-xs gap-1">
            <MessageSquare className="w-3.5 h-3.5" />
            AI广告助手
          </TabsTrigger>
        </TabsList>

        {/* Tab: Overview */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          {campaignLoading ? (
            <div className="grid grid-cols-5 gap-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : (
            <>
              {/* KPI Cards */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { label: "总花费", value: `$${overviewMetrics.cost.toFixed(2)}`, icon: DollarSign, color: "text-red-600", bg: "bg-red-50" },
                  { label: "总销售额", value: `$${overviewMetrics.sales.toFixed(2)}`, icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-50" },
                  { label: "ACoS", value: `${overviewMetrics.acos}%`, icon: Target, color: overviewMetrics.acos <= 25 ? "text-emerald-600" : overviewMetrics.acos <= 40 ? "text-amber-600" : "text-red-600", bg: overviewMetrics.acos <= 25 ? "bg-emerald-50" : overviewMetrics.acos <= 40 ? "bg-amber-50" : "bg-red-50" },
                  { label: "ROAS", value: `${overviewMetrics.roas}x`, icon: Zap, color: "text-blue-600", bg: "bg-blue-50" },
                  { label: "总订单", value: overviewMetrics.orders.toLocaleString(), icon: Package, color: "text-purple-600", bg: "bg-purple-50" },
                ].map((kpi) => (
                  <Card key={kpi.label} className={`${kpi.bg} border-none`}>
                    <CardContent className="pt-4 pb-3 px-4">
                      <div className="flex items-center gap-2 mb-1">
                        <kpi.icon className={`w-4 h-4 ${kpi.color}`} />
                        <span className="text-xs text-gray-600">{kpi.label}</span>
                      </div>
                      <p className={`text-xl font-bold ${kpi.color}`}>{kpi.value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Secondary Metrics */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: "总曝光", value: overviewMetrics.impressions.toLocaleString() },
                  { label: "总点击", value: overviewMetrics.clicks.toLocaleString() },
                  { label: "CTR", value: `${overviewMetrics.ctr}%` },
                  { label: "CVR", value: `${overviewMetrics.cvr}%` },
                ].map((m) => (
                  <Card key={m.label}>
                    <CardContent className="pt-3 pb-2.5 px-4">
                      <span className="text-xs text-gray-500">{m.label}</span>
                      <p className="text-lg font-semibold mt-0.5">{m.value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Charts Row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Campaign Cost Bar Chart */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">广告活动花费TOP10</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={campaigns.slice(0, 10).map((c: any) => ({
                          name: (c.campaign_name || "").substring(0, 15),
                          花费: c.cost || 0,
                          销售额: c.sales || 0,
                        }))}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-20} textAnchor="end" height={50} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip />
                          <Legend wrapperStyle={{ fontSize: "11px" }} />
                          <Bar dataKey="花费" fill="#ef4444" radius={[2, 2, 0, 0]} />
                          <Bar dataKey="销售额" fill="#10b981" radius={[2, 2, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                {/* Campaign Type Pie */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">广告类型花费分布</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={campaignTypeData}
                            cx="50%" cy="50%"
                            innerRadius={50} outerRadius={80}
                            dataKey="value"
                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          >
                            {campaignTypeData.map((_, i) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(value: any) => `$${Number(value).toFixed(2)}`} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Campaign Table */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">广告活动明细 ({campaigns.length})</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-gray-50/50">
                          <th className="text-left p-2.5 font-medium text-gray-600 w-8">#</th>
                          <th className="text-left p-2.5 font-medium text-gray-600">广告活动</th>
                          <th className="text-right p-2.5 font-medium text-gray-600">曝光</th>
                          <th className="text-right p-2.5 font-medium text-gray-600">点击</th>
                          <th className="text-right p-2.5 font-medium text-gray-600">花费</th>
                          <th className="text-right p-2.5 font-medium text-gray-600">销售额</th>
                          <th className="text-right p-2.5 font-medium text-gray-600">订单</th>
                          <th className="text-right p-2.5 font-medium text-gray-600">ACoS</th>
                          <th className="text-right p-2.5 font-medium text-gray-600">CTR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {campaigns.length === 0 ? (
                          <tr><td colSpan={9} className="text-center py-8 text-gray-400">暂无广告活动数据</td></tr>
                        ) : (
                          campaigns.slice(0, 50).map((c: any, i: number) => {
                            const acos = c.sales > 0 ? Math.round(c.cost / c.sales * 10000) / 100 : (c.cost > 0 ? 999 : 0);
                            const ctr = c.impressions > 0 ? Math.round(c.clicks / c.impressions * 10000) / 100 : 0;
                            return (
                              <tr key={i} className="border-b hover:bg-gray-50/50">
                                <td className="p-2.5 text-gray-400 text-xs">{i + 1}</td>
                                <td className="p-2.5 text-xs font-medium max-w-[200px] truncate">{c.campaign_name}</td>
                                <td className="p-2.5 text-right text-xs">{(c.impressions || 0).toLocaleString()}</td>
                                <td className="p-2.5 text-right text-xs">{c.clicks || 0}</td>
                                <td className="p-2.5 text-right text-xs text-red-600">${(c.cost || 0).toFixed(2)}</td>
                                <td className="p-2.5 text-right text-xs font-medium text-emerald-600">${(c.sales || 0).toFixed(2)}</td>
                                <td className="p-2.5 text-right text-xs">{c.orders || 0}</td>
                                <td className="p-2.5 text-right text-xs">
                                  <span className={`font-medium ${acos <= 25 ? "text-emerald-600" : acos <= 40 ? "text-amber-600" : "text-red-600"}`}>
                                    {acos > 900 ? "∞" : `${acos}%`}
                                  </span>
                                </td>
                                <td className="p-2.5 text-right text-xs">{ctr}%</td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Tab: Search Term 12-Category */}
        <TabsContent value="search-terms" className="mt-4">
          <SearchTermClassification
            asin={selectedAsin}
            marketplace={marketplace}
            days={selectedDays}
          />
        </TabsContent>

        {/* Tab: Targeting Analysis */}
        <TabsContent value="targeting" className="mt-4">
          <TargetingAnalysis
            asin={selectedAsin}
            marketplace={marketplace}
            days={selectedDays}
          />
        </TabsContent>

        {/* Tab: Ad Placement */}
        <TabsContent value="placement" className="mt-4">
          <AdPlacementAnalysis
            asin={selectedAsin}
            marketplace={marketplace}
            days={selectedDays}
          />
        </TabsContent>

        {/* Tab: Hourly Bid Strategy */}
        <TabsContent value="hourly" className="mt-4">
          <HourlyBidStrategy
            asin={selectedAsin}
            marketplace={marketplace}
            days={selectedDays}
          />
        </TabsContent>

        {/* Tab: Negative Keywords */}
        <TabsContent value="negative" className="mt-4">
          <NegativeKeywords
            asin={selectedAsin}
            marketplace={marketplace}
            days={selectedDays}
          />
        </TabsContent>

        {/* Tab: Word Frequency Analysis */}
        <TabsContent value="word-freq" className="mt-4">
          <WordFrequencyAnalysis
            asin={selectedAsin}
            marketplace={marketplace}
            days={selectedDays}
          />
        </TabsContent>

        {/* Tab: Effective Search Terms */}
        <TabsContent value="effective-terms" className="mt-4">
          <EffectiveSearchTerms
            asin={selectedAsin}
            marketplace={marketplace}
            days={selectedDays}
          />
        </TabsContent>

        {/* Tab: Ad Diagnostics */}
        <TabsContent value="diagnostics" className="mt-4">
          <AdDiagnostics
            asin={selectedAsin}
            marketplace={marketplace}
            days={selectedDays}
          />
        </TabsContent>

        {/* Tab: DSP Analysis */}
        <TabsContent value="dsp" className="mt-4">
          <DspAnalysis
            marketplace={marketplace}
            days={selectedDays}
          />
        </TabsContent>

        {/* Tab: Cross Channel Analysis */}
        <TabsContent value="cross-channel" className="mt-4">
          <CrossChannelAnalysis
            marketplace={marketplace}
            days={selectedDays}
          />
        </TabsContent>

        {/* Tab: AI Ad ChatBot */}
        <TabsContent value="ai-bot" className="mt-4">
          <AdChatBot
            asin={selectedAsin}
            marketplace={marketplace}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
