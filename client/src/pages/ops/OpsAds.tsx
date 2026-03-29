import { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useMarketplace } from "@/contexts/MarketplaceContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Target, RefreshCw, Search, DollarSign,
  Eye, TrendingUp, Zap, BarChart3, Clock, XCircle, Activity, Crosshair,
  Package, Type, Gem, MessageSquare, Layers, Monitor,
  ChevronDown, ChevronRight, FolderOpen, Folder,
} from "lucide-react";

// Sub-components
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

// Safe division helpers to prevent NaN/Infinity
const safeDiv = (a: number, b: number, decimals = 2): number => {
  if (!b || !isFinite(a) || !isFinite(b)) return 0;
  const result = a / b;
  return isFinite(result) ? Math.round(result * Math.pow(10, decimals)) / Math.pow(10, decimals) : 0;
};
const safePct = (a: number, b: number): number => safeDiv(a, b, 4) * 100;
const fmtPct = (v: number): string => {
  if (!isFinite(v) || isNaN(v)) return '0';
  return Math.round(v * 100) / 100 + '';
};

export default function OpsAds() {
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [selectedCampaignName, setSelectedCampaignName] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 2); // default to day before yesterday (hourly data has ~1 day delay)
    return d.toISOString().slice(0, 10);
  });
  const [activeTab, setActiveTab] = useState("overview");
  const [expandedPortfolios, setExpandedPortfolios] = useState<Set<string>>(new Set());
  const { marketplace } = useMarketplace();

  // Overview data - campaign summary with portfolio structure
  const { data: campaignData, isLoading: campaignLoading, refetch: refetchCampaigns } = trpc.operations.getAdCampaigns.useQuery({
    marketplace,
    adState: "enabled",
    reportDate: selectedDate,
  });

  const campaigns = campaignData?.campaigns || [];
  const portfolios = (campaignData as any)?.portfolios || [];

  // Auto-select a random campaign when data loads and no campaign is selected
  useEffect(() => {
    if (campaigns.length > 0 && !selectedCampaignId) {
      const randomIndex = Math.floor(Math.random() * Math.min(campaigns.length, 10));
      const randomCampaign = campaigns[randomIndex] as any;
      if (randomCampaign) {
        setSelectedCampaignId(String(randomCampaign.campaign_id));
        setSelectedCampaignName(randomCampaign.name || randomCampaign.campaign_name || `Campaign ${randomCampaign.campaign_id}`);
      }
    }
  }, [campaigns]);

  // Toggle portfolio expansion
  const togglePortfolio = (pid: string) => {
    setExpandedPortfolios(prev => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  // Select a campaign for sub-tab analysis
  const selectCampaign = (campaignId: string, campaignName: string) => {
    if (selectedCampaignId === campaignId) {
      setSelectedCampaignId(null);
      setSelectedCampaignName("");
    } else {
      setSelectedCampaignId(campaignId);
      setSelectedCampaignName(campaignName);
    }
  };

  // Overview metrics
  const overviewMetrics = useMemo(() => {
    let impressions = 0, clicks = 0, cost = 0, sales = 0, orders = 0;
    campaigns.forEach((c: any) => {
      impressions += c.impressions || 0;
      clicks += c.clicks || 0;
      cost += c.spend || c.cost || 0;
      sales += c.sales || 0;
      orders += c.orders || 0;
    });
    return {
      impressions, clicks, cost, sales, orders,
      acos: safePct(cost, sales),
      ctr: safePct(clicks, impressions),
      cvr: safePct(orders, clicks),
      cpc: safeDiv(cost, clicks),
      roas: safeDiv(sales, cost),
    };
  }, [campaigns]);

  // Campaign type distribution
  const campaignTypeData = useMemo(() => {
    const typeMap: Record<string, number> = {};
    campaigns.forEach((c: any) => {
      const type = c.campaign_type || "SP";
      typeMap[type] = (typeMap[type] || 0) + (c.spend || c.cost || 0);
    });
    return Object.entries(typeMap).map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }));
  }, [campaigns]);

  // Portfolio spend chart data
  const portfolioChartData = useMemo(() => {
    return portfolios.slice(0, 10).map((p: any) => ({
      name: (p.name || "未分组").substring(0, 12),
      花费: Math.round((p.spend || 0) * 100) / 100,
      销售额: Math.round((p.sales || 0) * 100) / 100,
    }));
  }, [portfolios]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Target className="w-5 h-5 text-blue-600" />
            广告智能分析
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">以广告组合(Portfolio)+广告活动(Campaign)为核心维度的全方位广告数据分析</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="h-8 px-2 text-xs border rounded-md bg-white"
            max={new Date().toISOString().slice(0, 10)}
          />
          <Button variant="outline" size="sm" className="h-8" onClick={() => refetchCampaigns()}>
            <RefreshCw className="w-3.5 h-3.5 mr-1" />
            刷新
          </Button>
        </div>
      </div>

      {/* Campaign Selector - shows selected campaign */}
      {selectedCampaignId && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="py-2.5 px-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-blue-600" />
              <span className="text-sm text-gray-600">当前分析广告活动:</span>
              <Badge variant="outline" className="text-xs font-mono bg-white">{selectedCampaignName}</Badge>
              <Badge variant="secondary" className="text-xs">ID: {selectedCampaignId}</Badge>
            </div>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setSelectedCampaignId(null); setSelectedCampaignName(""); }}>
              清除选择（查看全部）
            </Button>
          </CardContent>
        </Card>
      )}

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

        {/* Tab: Overview - Portfolio + Campaign Two-Level */}
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
                {/* Portfolio Spend Bar Chart */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">广告组合花费TOP10</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={portfolioChartData}>
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

              {/* Portfolio + Campaign Two-Level Table */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FolderOpen className="w-4 h-4" />
                    广告组合 → 广告活动 ({portfolios.length}个组合, {campaigns.length}个活动)
                  </CardTitle>
                  <p className="text-xs text-gray-500 mt-1">点击广告组合展开查看其下的广告活动，点击广告活动名称可选中用于子Tab分析</p>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-gray-50/50">
                          <th className="text-left p-2.5 font-medium text-gray-600 w-8"></th>
                          <th className="text-left p-2.5 font-medium text-gray-600">名称</th>
                          <th className="text-right p-2.5 font-medium text-gray-600">活动数</th>
                          <th className="text-right p-2.5 font-medium text-gray-600">曝光</th>
                          <th className="text-right p-2.5 font-medium text-gray-600">点击</th>
                          <th className="text-right p-2.5 font-medium text-gray-600">花费</th>
                          <th className="text-right p-2.5 font-medium text-gray-600">销售额</th>
                          <th className="text-right p-2.5 font-medium text-gray-600">订单</th>
                          <th className="text-right p-2.5 font-medium text-gray-600">ACoS</th>
                          <th className="text-right p-2.5 font-medium text-gray-600">ROAS</th>
                          <th className="text-right p-2.5 font-medium text-gray-600">CTR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {portfolios.length === 0 ? (
                          <tr><td colSpan={11} className="text-center py-8 text-gray-400">暂无广告组合数据</td></tr>
                        ) : (
                          portfolios.map((p: any) => {
                            const isExpanded = expandedPortfolios.has(p.id);
                            return (
                              <PortfolioRow
                                key={p.id}
                                portfolio={p}
                                isExpanded={isExpanded}
                                onToggle={() => togglePortfolio(p.id)}
                                selectedCampaignId={selectedCampaignId}
                                onSelectCampaign={selectCampaign}
                              />
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
            campaignId={selectedCampaignId}
            marketplace={marketplace}
            reportDate={selectedDate}
          />
        </TabsContent>

        {/* Tab: Targeting Analysis */}
        <TabsContent value="targeting" className="mt-4">
          <TargetingAnalysis
            campaignId={selectedCampaignId}
            marketplace={marketplace}
            reportDate={selectedDate}
          />
        </TabsContent>

        {/* Tab: Ad Placement */}
        <TabsContent value="placement" className="mt-4">
          <AdPlacementAnalysis
            campaignId={selectedCampaignId}
            marketplace={marketplace}
            reportDate={selectedDate}
          />
        </TabsContent>

        {/* Tab: Hourly Bid Strategy */}
        <TabsContent value="hourly" className="mt-4">
          <HourlyBidStrategy
            campaignId={selectedCampaignId}
            marketplace={marketplace}
            reportDate={selectedDate}
          />
        </TabsContent>

        {/* Tab: Negative Keywords */}
        <TabsContent value="negative" className="mt-4">
          <NegativeKeywords
            campaignId={selectedCampaignId}
            marketplace={marketplace}
            reportDate={selectedDate}
          />
        </TabsContent>

        {/* Tab: Word Frequency Analysis */}
        <TabsContent value="word-freq" className="mt-4">
          <WordFrequencyAnalysis
            campaignId={selectedCampaignId}
            marketplace={marketplace}
            reportDate={selectedDate}
          />
        </TabsContent>

        {/* Tab: Effective Search Terms */}
        <TabsContent value="effective-terms" className="mt-4">
          <EffectiveSearchTerms
            campaignId={selectedCampaignId}
            marketplace={marketplace}
            reportDate={selectedDate}
          />
        </TabsContent>

        {/* Tab: Ad Diagnostics */}
        <TabsContent value="diagnostics" className="mt-4">
          <AdDiagnostics
            campaignId={selectedCampaignId}
            marketplace={marketplace}
            reportDate={selectedDate}
          />
        </TabsContent>

        {/* Tab: DSP Analysis */}
        <TabsContent value="dsp" className="mt-4">
          <DspAnalysis
            marketplace={marketplace}
            reportDate={selectedDate}
          />
        </TabsContent>

        {/* Tab: Cross Channel Analysis */}
        <TabsContent value="cross-channel" className="mt-4">
          <CrossChannelAnalysis
            marketplace={marketplace}
            reportDate={selectedDate}
          />
        </TabsContent>

        {/* Tab: AI Ad ChatBot */}
        <TabsContent value="ai-bot" className="mt-4">
          <AdChatBot
            campaignId={selectedCampaignId}
            marketplace={marketplace}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Portfolio Row Component ─────────────────────────────────────
function PortfolioRow({ portfolio, isExpanded, onToggle, selectedCampaignId, onSelectCampaign }: {
  portfolio: any;
  isExpanded: boolean;
  onToggle: () => void;
  selectedCampaignId: string | null;
  onSelectCampaign: (id: string, name: string) => void;
}) {
  const p = portfolio;
  const pAcos = isFinite(p.acos) ? p.acos : 0;
  const pRoas = isFinite(p.roas) ? p.roas : 0;
  const pCtr = isFinite(p.ctr) ? p.ctr : 0;
  const acosColor = pAcos <= 25 ? "text-emerald-600" : pAcos <= 40 ? "text-amber-600" : "text-red-600";

  return (
    <>
      {/* Portfolio Row */}
      <tr
        className="border-b bg-gray-50/30 hover:bg-gray-100/50 cursor-pointer font-medium"
        onClick={onToggle}
      >
        <td className="p-2.5">
          {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
        </td>
        <td className="p-2.5">
          <div className="flex items-center gap-2">
            {isExpanded ? <FolderOpen className="w-4 h-4 text-amber-500" /> : <Folder className="w-4 h-4 text-amber-500" />}
            <span className="text-sm font-semibold">{p.name}</span>
            <Badge variant="secondary" className="text-[10px] px-1.5">{p.campaignCount}个活动</Badge>
          </div>
        </td>
        <td className="p-2.5 text-right text-xs">{p.campaignCount}</td>
        <td className="p-2.5 text-right text-xs">{(p.impressions || 0).toLocaleString()}</td>
        <td className="p-2.5 text-right text-xs">{(p.clicks || 0).toLocaleString()}</td>
        <td className="p-2.5 text-right text-xs text-red-600 font-medium">${(p.spend || 0).toFixed(2)}</td>
        <td className="p-2.5 text-right text-xs text-emerald-600 font-medium">${(p.sales || 0).toFixed(2)}</td>
        <td className="p-2.5 text-right text-xs">{p.orders || 0}</td>
        <td className="p-2.5 text-right text-xs">
          <span className={`font-medium ${acosColor}`}>{pAcos > 900 ? "∞" : `${fmtPct(pAcos)}%`}</span>
        </td>
        <td className="p-2.5 text-right text-xs font-medium text-blue-600">{pRoas}x</td>
        <td className="p-2.5 text-right text-xs">{fmtPct(pCtr)}%</td>
      </tr>

      {/* Campaign Rows (expanded) */}
      {isExpanded && p.campaigns?.map((c: any, idx: number) => {
        const isSelected = selectedCampaignId === c.campaign_id;
        const cAcos = safePct(c.spend || 0, c.sales || 0);
        const cRoas = safeDiv(c.sales || 0, c.spend || 0);
        const cCtr = safePct(c.clicks || 0, c.impressions || 0);
        const cAcosColor = cAcos <= 25 ? "text-emerald-600" : cAcos <= 40 ? "text-amber-600" : "text-red-600";

        return (
          <tr
            key={c.campaign_id}
            className={`border-b hover:bg-blue-50/50 cursor-pointer transition-colors ${isSelected ? "bg-blue-50 ring-1 ring-inset ring-blue-200" : ""}`}
            onClick={() => onSelectCampaign(c.campaign_id, c.campaign_name)}
          >
            <td className="p-2.5"></td>
            <td className="p-2.5 pl-10">
              <div className="flex items-center gap-2">
                <span className="text-gray-300 text-xs">├</span>
                <span className={`text-xs ${isSelected ? "font-semibold text-blue-700" : ""}`}>{c.campaign_name}</span>
                <Badge variant="outline" className="text-[10px] px-1">{c.campaign_type || "SP"}</Badge>
                {c.targeting_type && <Badge variant="secondary" className="text-[10px] px-1">{c.targeting_type}</Badge>}
                {isSelected && <Badge className="text-[10px] px-1 bg-blue-600">已选中</Badge>}
              </div>
            </td>
            <td className="p-2.5 text-right text-xs text-gray-400">-</td>
            <td className="p-2.5 text-right text-xs">{(c.impressions || 0).toLocaleString()}</td>
            <td className="p-2.5 text-right text-xs">{(c.clicks || 0).toLocaleString()}</td>
            <td className="p-2.5 text-right text-xs text-red-600">${(c.spend || 0).toFixed(2)}</td>
            <td className="p-2.5 text-right text-xs text-emerald-600">${(c.sales || 0).toFixed(2)}</td>
            <td className="p-2.5 text-right text-xs">{c.orders || 0}</td>
            <td className="p-2.5 text-right text-xs">
              <span className={`font-medium ${cAcosColor}`}>{cAcos > 900 ? "∞" : `${fmtPct(cAcos)}%`}</span>
            </td>
            <td className="p-2.5 text-right text-xs font-medium text-blue-600">{cRoas}x</td>
            <td className="p-2.5 text-right text-xs">{fmtPct(cCtr)}%</td>
          </tr>
        );
      })}
    </>
  );
}
