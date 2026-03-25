import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell,
  ScatterChart, Scatter, ZAxis, PieChart, Pie,
} from "recharts";
import {
  Target, Sparkles, RefreshCw, Loader2, Search, DollarSign,
  MousePointerClick, Eye, CheckCircle2, XCircle, ArrowRight, Plus, Minus,
  TrendingUp, TrendingDown, AlertTriangle, Zap, Filter, Download,
  ThumbsUp, ThumbsDown, Edit3, RotateCcw,
} from "lucide-react";

// Category labels and colors
const CATEGORY_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: any; description: string }> = {
  high_performer: { label: "高效词", color: "text-emerald-700", bgColor: "bg-emerald-50 border-emerald-200", icon: TrendingUp, description: "ACoS≤25%且有转化" },
  potential: { label: "潜力词", color: "text-blue-700", bgColor: "bg-blue-50 border-blue-200", icon: Zap, description: "有转化但ACoS偏高" },
  low_performer: { label: "低效词", color: "text-amber-700", bgColor: "bg-amber-50 border-amber-200", icon: TrendingDown, description: "ACoS>50%" },
  waste: { label: "无效词", color: "text-red-700", bgColor: "bg-red-50 border-red-200", icon: AlertTriangle, description: "花费>$5无转化" },
  new_term: { label: "新词", color: "text-gray-600", bgColor: "bg-gray-50 border-gray-200", icon: Search, description: "数据不足待观察" },
};

const ACTION_LABELS: Record<string, { label: string; color: string; icon: any }> = {
  add_exact: { label: "添加精确", color: "text-emerald-600 bg-emerald-50", icon: Plus },
  add_phrase: { label: "添加词组", color: "text-green-600 bg-green-50", icon: Plus },
  negate_exact: { label: "否定精确", color: "text-red-600 bg-red-50", icon: XCircle },
  negate_phrase: { label: "否定词组", color: "text-red-500 bg-red-50", icon: XCircle },
  increase_bid: { label: "提高出价", color: "text-blue-600 bg-blue-50", icon: ArrowRight },
  decrease_bid: { label: "降低出价", color: "text-amber-600 bg-amber-50", icon: Minus },
  keep: { label: "保持不变", color: "text-gray-600 bg-gray-50", icon: CheckCircle2 },
  monitor: { label: "继续观察", color: "text-purple-600 bg-purple-50", icon: Eye },
};

const PIE_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#9ca3af"];

export default function OpsAds() {
  const [showAiDialog, setShowAiDialog] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<string>("cost");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedDays, setSelectedDays] = useState(7);
  
  // AI analysis user interaction state
  const [userDecisions, setUserDecisions] = useState<Record<number, {
    decision: "accepted" | "rejected" | "modified";
    modifiedAction?: string;
    notes?: string;
  }>>({});
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const { data: campaignData, isLoading: campaignLoading, refetch: refetchCampaigns } = trpc.operations.getAdCampaigns.useQuery({});
  const { data: searchTermData, isLoading: stLoading, refetch: refetchTerms } = trpc.operations.getSearchTerms.useQuery({ days: selectedDays });

  const aiAnalysis = trpc.operations.aiSearchTermAnalysis.useMutation({
    onSuccess: () => {
      toast.success("搜索词分析完成");
      setUserDecisions({}); // Reset decisions on new analysis
    },
    onError: (err) => toast.error("分析失败", { description: err.message }),
  });

  const saveActions = trpc.operations.saveSearchTermActions.useMutation({
    onSuccess: (data) => toast.success(`已保存${data.saved}条操作建议`),
    onError: (err) => toast.error("保存失败", { description: err.message }),
  });

  const campaigns = campaignData?.campaigns || [];
  const searchTerms = searchTermData?.searchTerms || [];
  const categoryStats = searchTermData?.categoryStats || { high_performer: 0, potential: 0, low_performer: 0, waste: 0, new_term: 0, total: 0 };

  const campaignStats = useMemo(() => {
    const totalSpend = campaigns.reduce((s: number, c: any) => s + (c.spend || 0), 0);
    const totalSales = campaigns.reduce((s: number, c: any) => s + (c.sales || 0), 0);
    const totalClicks = campaigns.reduce((s: number, c: any) => s + (c.clicks || 0), 0);
    const totalImpressions = campaigns.reduce((s: number, c: any) => s + (c.impressions || 0), 0);
    return {
      totalSpend: Math.round(totalSpend * 100) / 100,
      totalSales: Math.round(totalSales * 100) / 100,
      avgAcos: totalSales > 0 ? Math.round(totalSpend / totalSales * 1000) / 10 : 0,
      totalClicks,
      totalImpressions,
      ctr: totalImpressions > 0 ? Math.round(totalClicks / totalImpressions * 10000) / 100 : 0,
      roas: totalSpend > 0 ? Math.round(totalSales / totalSpend * 100) / 100 : 0,
    };
  }, [campaigns]);

  // Filtered and sorted search terms
  const filteredTerms = useMemo(() => {
    let result = [...searchTerms];
    if (categoryFilter !== "all") {
      result = result.filter((t: any) => t.category === categoryFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((t: any) => (t.query || "").toLowerCase().includes(q));
    }
    result.sort((a: any, b: any) => {
      const aVal = a[sortField] || 0;
      const bVal = b[sortField] || 0;
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });
    return result;
  }, [searchTerms, categoryFilter, searchQuery, sortField, sortDir]);

  // Pie chart data for categories
  const pieData = useMemo(() => [
    { name: "高效词", value: categoryStats.high_performer, color: PIE_COLORS[0] },
    { name: "潜力词", value: categoryStats.potential, color: PIE_COLORS[1] },
    { name: "低效词", value: categoryStats.low_performer, color: PIE_COLORS[2] },
    { name: "无效词", value: categoryStats.waste, color: PIE_COLORS[3] },
    { name: "新词", value: categoryStats.new_term, color: PIE_COLORS[4] },
  ].filter(d => d.value > 0), [categoryStats]);

  // Top 10 search terms bar chart
  const topTermsChart = useMemo(() => {
    return searchTerms.slice(0, 10).map((t: any) => ({
      name: (t.query || "").length > 20 ? (t.query || "").slice(0, 20) + "..." : (t.query || ""),
      cost: Math.round((t.cost || 0) * 100) / 100,
      sales: Math.round((t.sales || 0) * 100) / 100,
    }));
  }, [searchTerms]);

  const scatterData = useMemo(() => {
    return campaigns.map((c: any) => ({
      name: c.campaign_name,
      spend: c.spend || 0,
      sales: c.sales || 0,
      acos: c.acos || 0,
      clicks: c.clicks || 0,
    }));
  }, [campaigns]);

  const handleAiAnalyze = () => {
    if (searchTerms.length === 0) {
      toast.info("无搜索词数据", { description: "请确保有搜索词数据后再分析" });
      return;
    }
    setShowAiDialog(true);
    setUserDecisions({});
    // Send top 100 terms with key metrics for AI analysis
    const termsForAi = searchTerms.slice(0, 100).map((t: any) => ({
      query: t.query,
      impressions: t.impressions,
      clicks: t.clicks,
      cost: t.cost,
      sales: t.sales,
      orders: t.orders,
      acos: t.acos,
      ctr: t.ctr,
      convRate: t.convRate,
      category: t.category,
      match_type: t.match_type,
    }));
    aiAnalysis.mutate({ searchTerms: termsForAi });
  };

  const handleAccept = (index: number) => {
    setUserDecisions(prev => ({ ...prev, [index]: { decision: "accepted" } }));
  };

  const handleReject = (index: number) => {
    setUserDecisions(prev => ({ ...prev, [index]: { decision: "rejected" } }));
  };

  const handleModify = (index: number, newAction: string, notes: string) => {
    setUserDecisions(prev => ({
      ...prev,
      [index]: { decision: "modified", modifiedAction: newAction, notes },
    }));
    setEditingIndex(null);
  };

  const handleResetDecision = (index: number) => {
    setUserDecisions(prev => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  };

  const handleSaveActions = () => {
    const analysis = (aiAnalysis.data as any)?.analysis;
    if (!analysis?.length) return;

    const actionsToSave = analysis.map((a: any, i: number) => {
      const decision = userDecisions[i];
      return {
        searchTerm: a.search_term,
        suggestedAction: decision?.modifiedAction || a.suggested_action,
        aiReason: a.reason,
        userDecision: decision?.decision || ("pending" as const),
        userNotes: decision?.notes,
      };
    }).filter((_: any, i: number) => {
      const d = userDecisions[i];
      return !d || d.decision !== "rejected";
    });

    saveActions.mutate({ actions: actionsToSave });
  };

  const acceptedCount = Object.values(userDecisions).filter(d => d.decision === "accepted").length;
  const rejectedCount = Object.values(userDecisions).filter(d => d.decision === "rejected").length;
  const modifiedCount = Object.values(userDecisions).filter(d => d.decision === "modified").length;
  const pendingCount = ((aiAnalysis.data as any)?.analysis?.length || 0) - acceptedCount - rejectedCount - modifiedCount;

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  if (campaignLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">广告优化</h1>
          <p className="text-sm text-gray-500 mt-1">PPC广告效果分析与搜索词智能优化</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { refetchCampaigns(); refetchTerms(); }}>
            <RefreshCw className="w-4 h-4 mr-1" />
            刷新
          </Button>
          <Button size="sm" onClick={handleAiAnalyze} disabled={aiAnalysis.isPending || stLoading}>
            {aiAnalysis.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
            AI搜索词分析
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard title="广告花费" value={`$${campaignStats.totalSpend.toLocaleString()}`} icon={DollarSign} color="red" />
        <KpiCard title="广告销售额" value={`$${campaignStats.totalSales.toLocaleString()}`} icon={DollarSign} color="emerald" />
        <KpiCard title="ACoS" value={`${campaignStats.avgAcos}%`} icon={Target} color={campaignStats.avgAcos <= 25 ? "emerald" : "amber"} />
        <KpiCard title="ROAS" value={`${campaignStats.roas}x`} icon={Target} color={campaignStats.roas >= 3 ? "emerald" : "amber"} />
      </div>

      <Tabs defaultValue="campaigns" className="space-y-4">
        <TabsList>
          <TabsTrigger value="campaigns">广告活动</TabsTrigger>
          <TabsTrigger value="searchterms">
            搜索词分析
            {categoryStats.total > 0 && (
              <Badge variant="secondary" className="ml-2 text-[10px]">{categoryStats.total}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Campaigns Tab */}
        <TabsContent value="campaigns" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">广告活动效果对比</CardTitle>
              <CardDescription>花费 vs 销售额（气泡大小=点击量）</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="spend" name="花费" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} label={{ value: "花费($)", position: "insideBottom", offset: -5, fontSize: 11 }} />
                    <YAxis dataKey="sales" name="销售额" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} label={{ value: "销售额($)", angle: -90, position: "insideLeft", fontSize: 11 }} />
                    <ZAxis dataKey="clicks" range={[50, 400]} name="点击量" />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload;
                        return (
                          <div className="bg-white p-3 rounded-lg shadow-lg border text-sm">
                            <p className="font-medium mb-1">{d.name}</p>
                            <p>花费: ${d.spend}</p>
                            <p>销售额: ${d.sales}</p>
                            <p>ACoS: {d.acos}%</p>
                            <p>点击: {d.clicks}</p>
                          </div>
                        );
                      }}
                    />
                    <Scatter data={scatterData} fill="#3b82f6" fillOpacity={0.6} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50/50">
                      <th className="text-left p-3 font-medium text-gray-600">广告活动</th>
                      <th className="text-right p-3 font-medium text-gray-600">曝光</th>
                      <th className="text-right p-3 font-medium text-gray-600">点击</th>
                      <th className="text-right p-3 font-medium text-gray-600">花费</th>
                      <th className="text-right p-3 font-medium text-gray-600">销售额</th>
                      <th className="text-right p-3 font-medium text-gray-600">ACoS</th>
                      <th className="text-center p-3 font-medium text-gray-600">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-12 text-gray-400">暂无广告数据</td></tr>
                    ) : (
                      campaigns.map((c: any, i: number) => (
                        <tr key={i} className="border-b hover:bg-gray-50/50">
                          <td className="p-3 font-medium max-w-[200px] truncate">{c.campaign_name}</td>
                          <td className="p-3 text-right">{(c.impressions || 0).toLocaleString()}</td>
                          <td className="p-3 text-right">{(c.clicks || 0).toLocaleString()}</td>
                          <td className="p-3 text-right">${(c.spend || 0).toFixed(2)}</td>
                          <td className="p-3 text-right font-medium">${(c.sales || 0).toFixed(2)}</td>
                          <td className="p-3 text-right">
                            <span className={`font-medium ${
                              (c.acos || 0) <= 20 ? "text-emerald-600" : (c.acos || 0) <= 35 ? "text-amber-600" : "text-red-600"
                            }`}>
                              {c.acos || 0}%
                            </span>
                          </td>
                          <td className="p-3 text-center">
                            <Badge variant="outline" className={`text-[10px] ${
                              (c.acos || 0) <= 25 ? "text-emerald-600" : (c.acos || 0) <= 40 ? "text-amber-600" : "text-red-600"
                            }`}>
                              {(c.acos || 0) <= 25 ? "良好" : (c.acos || 0) <= 40 ? "一般" : "需优化"}
                            </Badge>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Search Terms Tab - Enhanced */}
        <TabsContent value="searchterms" className="space-y-4">
          {/* Category Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {Object.entries(CATEGORY_CONFIG).map(([key, config]) => {
              const count = (categoryStats as any)[key] || 0;
              const CatIcon = config.icon;
              const isActive = categoryFilter === key;
              return (
                <Card
                  key={key}
                  className={`cursor-pointer transition-all hover:shadow-md ${isActive ? "ring-2 ring-blue-500" : ""} ${config.bgColor}`}
                  onClick={() => setCategoryFilter(categoryFilter === key ? "all" : key)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className={`text-xs ${config.color} font-medium`}>{config.label}</p>
                        <p className="text-2xl font-bold mt-1">{count}</p>
                      </div>
                      <CatIcon className={`w-5 h-5 ${config.color} opacity-60`} />
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">{config.description}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Category Pie Chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">搜索词分类分布</CardTitle>
                <CardDescription>{selectedDays}天数据聚合</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-52">
                  {pieData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={2}
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        >
                          {pieData.map((entry, index) => (
                            <Cell key={index} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                      {stLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : "暂无数据"}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Top Terms Bar Chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">花费TOP10搜索词</CardTitle>
                <CardDescription>花费 vs 销售额对比</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-52">
                  {topTermsChart.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topTermsChart} layout="vertical" margin={{ left: 0, right: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
                        <Tooltip formatter={(v: number) => `$${v}`} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="cost" name="花费" fill="#ef4444" barSize={8} />
                        <Bar dataKey="sales" name="销售额" fill="#10b981" barSize={8} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                      {stLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : "暂无数据"}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Search Terms Table */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <CardTitle className="text-base">搜索词报告</CardTitle>
                  <CardDescription>
                    {selectedDays}天聚合数据 · 共{filteredTerms.length}个搜索词
                    {categoryFilter !== "all" && ` · 筛选: ${CATEGORY_CONFIG[categoryFilter]?.label}`}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <Input
                      placeholder="搜索关键词..."
                      className="pl-8 h-8 w-48 text-sm"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                  <Select value={String(selectedDays)} onValueChange={(v) => setSelectedDays(Number(v))}>
                    <SelectTrigger className="h-8 w-24 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3">3天</SelectItem>
                      <SelectItem value="7">7天</SelectItem>
                      <SelectItem value="14">14天</SelectItem>
                      <SelectItem value="30">30天</SelectItem>
                    </SelectContent>
                  </Select>
                  {categoryFilter !== "all" && (
                    <Button variant="ghost" size="sm" onClick={() => setCategoryFilter("all")}>
                      <XCircle className="w-3.5 h-3.5 mr-1" />
                      清除筛选
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={handleAiAnalyze} disabled={aiAnalysis.isPending || stLoading}>
                    {aiAnalysis.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
                    AI智能分析
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {stLoading ? (
                <div className="flex flex-col items-center py-16">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-3" />
                  <p className="text-sm text-gray-500">正在加载{selectedDays}天搜索词数据...</p>
                  <p className="text-xs text-gray-400 mt-1">首次加载可能需要较长时间</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50/50">
                        <th className="text-left p-3 font-medium text-gray-600">搜索词</th>
                        <th className="text-left p-3 font-medium text-gray-600">目标ASIN/关键词</th>
                        <th className="text-left p-3 font-medium text-gray-600">匹配类型</th>
                        <th className="text-center p-3 font-medium text-gray-600">分类</th>
                        <th className="text-right p-3 font-medium text-gray-600 cursor-pointer hover:text-blue-600" onClick={() => handleSort("impressions")}>
                          曝光 {sortField === "impressions" && (sortDir === "desc" ? "↓" : "↑")}
                        </th>
                        <th className="text-right p-3 font-medium text-gray-600 cursor-pointer hover:text-blue-600" onClick={() => handleSort("clicks")}>
                          点击 {sortField === "clicks" && (sortDir === "desc" ? "↓" : "↑")}
                        </th>
                        <th className="text-right p-3 font-medium text-gray-600 cursor-pointer hover:text-blue-600" onClick={() => handleSort("cost")}>
                          花费 {sortField === "cost" && (sortDir === "desc" ? "↓" : "↑")}
                        </th>
                        <th className="text-right p-3 font-medium text-gray-600 cursor-pointer hover:text-blue-600" onClick={() => handleSort("sales")}>
                          销售额 {sortField === "sales" && (sortDir === "desc" ? "↓" : "↑")}
                        </th>
                        <th className="text-right p-3 font-medium text-gray-600">订单</th>
                        <th className="text-right p-3 font-medium text-gray-600 cursor-pointer hover:text-blue-600" onClick={() => handleSort("acos")}>
                          ACoS {sortField === "acos" && (sortDir === "desc" ? "↓" : "↑")}
                        </th>
                        <th className="text-right p-3 font-medium text-gray-600">转化率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTerms.length === 0 ? (
                        <tr><td colSpan={11} className="text-center py-12 text-gray-400">暂无搜索词数据</td></tr>
                      ) : (
                        filteredTerms.slice(0, 200).map((st: any, i: number) => {
                          const catConfig = CATEGORY_CONFIG[st.category] || CATEGORY_CONFIG.new_term;
                          return (
                            <tr key={i} className="border-b hover:bg-gray-50/50">
                              <td className="p-3">
                                <div className="flex items-center gap-2">
                                  <Search className="w-3 h-3 text-gray-400 shrink-0" />
                                  <span className="font-medium">{st.query}</span>
                                </div>
                              </td>
                              <td className="p-3 font-mono text-xs text-gray-500 max-w-[120px] truncate" title={st.target_text}>{st.target_text || "-"}</td>
                              <td className="p-3 text-xs text-gray-500">{st.match_type || "-"}</td>
                              <td className="p-3 text-center">
                                <Badge variant="outline" className={`text-[10px] ${catConfig.color} ${catConfig.bgColor}`}>
                                  {catConfig.label}
                                </Badge>
                              </td>
                              <td className="p-3 text-right">{(st.impressions || 0).toLocaleString()}</td>
                              <td className="p-3 text-right">{(st.clicks || 0).toLocaleString()}</td>
                              <td className="p-3 text-right">${(st.cost || 0).toFixed(2)}</td>
                              <td className="p-3 text-right font-medium">${(st.sales || 0).toFixed(2)}</td>
                              <td className="p-3 text-right">{st.orders || 0}</td>
                              <td className="p-3 text-right">
                                <span className={`font-medium ${
                                  st.acos <= 20 ? "text-emerald-600" :
                                  st.acos <= 35 ? "text-amber-600" :
                                  st.acos > 50 ? "text-red-600" : "text-gray-500"
                                }`}>
                                  {st.sales > 0 ? `${st.acos}%` : st.cost > 0 ? "N/A" : "-"}
                                </span>
                              </td>
                              <td className="p-3 text-right text-gray-500">{st.convRate > 0 ? `${st.convRate}%` : "-"}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                  {filteredTerms.length > 200 && (
                    <div className="text-center py-3 text-xs text-gray-400 border-t">
                      显示前200条，共{filteredTerms.length}条搜索词
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* AI Search Term Analysis Dialog - Enhanced with User Interaction */}
      <Dialog open={showAiDialog} onOpenChange={setShowAiDialog}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-blue-500" />
              AI搜索词智能分析
            </DialogTitle>
          </DialogHeader>
          {aiAnalysis.isPending ? (
            <div className="flex flex-col items-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-3" />
              <p className="text-sm text-gray-500">AI正在分析搜索词数据，生成操作建议...</p>
              <p className="text-xs text-gray-400 mt-1">分析{Math.min(searchTerms.length, 100)}个搜索词</p>
            </div>
          ) : aiAnalysis.data ? (
            <div className="space-y-4">
              {/* Summary */}
              <div className="p-4 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-800">{(aiAnalysis.data as any).summary}</p>
              </div>

              {/* Top Opportunities */}
              {(aiAnalysis.data as any).topOpportunities?.length > 0 && (
                <div className="p-3 bg-emerald-50 rounded-lg">
                  <p className="text-xs font-medium text-emerald-700 mb-2">核心机会:</p>
                  <ul className="space-y-1">
                    {(aiAnalysis.data as any).topOpportunities.map((opp: string, i: number) => (
                      <li key={i} className="text-sm text-emerald-800 flex items-start gap-2">
                        <CheckCircle2 className="w-3 h-3 mt-1 shrink-0" />
                        {opp}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Decision Stats Bar */}
              <div className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg text-xs">
                <span className="font-medium text-gray-700">审核进度:</span>
                <span className="text-emerald-600">已接受 {acceptedCount}</span>
                <span className="text-red-600">已拒绝 {rejectedCount}</span>
                <span className="text-blue-600">已修改 {modifiedCount}</span>
                <span className="text-gray-500">待审核 {pendingCount}</span>
              </div>

              {/* Analysis Results with User Interaction */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">搜索词操作建议（点击接受/拒绝/修改）</h4>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => {
                      const analysis = (aiAnalysis.data as any)?.analysis || [];
                      const newDecisions: Record<number, any> = {};
                      analysis.forEach((_: any, i: number) => {
                        newDecisions[i] = { decision: "accepted" };
                      });
                      setUserDecisions(newDecisions);
                    }}>
                      <ThumbsUp className="w-3 h-3 mr-1" />
                      全部接受
                    </Button>
                    <Button size="sm" onClick={handleSaveActions} disabled={saveActions.isPending}>
                      {saveActions.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                      保存已审核建议
                    </Button>
                  </div>
                </div>
                {(aiAnalysis.data as any).analysis?.map((a: any, i: number) => {
                  const actionInfo = ACTION_LABELS[a.suggested_action] || ACTION_LABELS.keep;
                  const ActionIcon = actionInfo.icon;
                  const decision = userDecisions[i];
                  const isEditing = editingIndex === i;

                  return (
                    <div
                      key={i}
                      className={`p-3 border rounded-lg transition-all ${
                        decision?.decision === "accepted" ? "bg-emerald-50/50 border-emerald-200" :
                        decision?.decision === "rejected" ? "bg-red-50/30 border-red-200 opacity-60" :
                        decision?.decision === "modified" ? "bg-blue-50/50 border-blue-200" :
                        "hover:bg-gray-50/50"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <Search className="w-3 h-3 text-gray-400" />
                          <span className="font-medium text-sm">{a.search_term}</span>
                          {decision?.decision === "accepted" && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                          {decision?.decision === "rejected" && <XCircle className="w-3.5 h-3.5 text-red-500" />}
                          {decision?.decision === "modified" && <Edit3 className="w-3.5 h-3.5 text-blue-500" />}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {decision?.decision === "modified" && decision.modifiedAction ? (
                            <Badge className={`text-[10px] ${(ACTION_LABELS[decision.modifiedAction] || actionInfo).color}`}>
                              {(ACTION_LABELS[decision.modifiedAction] || actionInfo).label} (已修改)
                            </Badge>
                          ) : (
                            <Badge className={`text-[10px] ${actionInfo.color}`}>
                              <ActionIcon className="w-3 h-3 mr-1" />
                              {actionInfo.label}
                            </Badge>
                          )}
                          {/* Action Buttons */}
                          {!decision ? (
                            <>
                              <Button size="sm" variant="ghost" className="h-6 px-2 text-emerald-600 hover:bg-emerald-50" onClick={() => handleAccept(i)}>
                                <ThumbsUp className="w-3 h-3" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-6 px-2 text-red-600 hover:bg-red-50" onClick={() => handleReject(i)}>
                                <ThumbsDown className="w-3 h-3" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-6 px-2 text-blue-600 hover:bg-blue-50" onClick={() => setEditingIndex(i)}>
                                <Edit3 className="w-3 h-3" />
                              </Button>
                            </>
                          ) : (
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-gray-400 hover:bg-gray-50" onClick={() => handleResetDecision(i)}>
                              <RotateCcw className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 ml-5">{a.reason}</p>
                      <div className="flex items-center gap-4 mt-1 ml-5 text-[10px] text-gray-400">
                        <span>置信度: {a.confidence}</span>
                        <span>预估影响: {a.estimated_impact}</span>
                      </div>

                      {/* Edit Mode */}
                      {isEditing && (
                        <EditActionPanel
                          currentAction={a.suggested_action}
                          onSave={(action, notes) => handleModify(i, action, notes)}
                          onCancel={() => setEditingIndex(null)}
                        />
                      )}

                      {/* Show user notes if modified */}
                      {decision?.notes && (
                        <div className="mt-2 ml-5 p-2 bg-blue-50 rounded text-xs text-blue-700">
                          备注: {decision.notes}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Edit Action Panel Component
function EditActionPanel({ currentAction, onSave, onCancel }: {
  currentAction: string;
  onSave: (action: string, notes: string) => void;
  onCancel: () => void;
}) {
  const [action, setAction] = useState(currentAction);
  const [notes, setNotes] = useState("");

  return (
    <div className="mt-2 ml-5 p-3 bg-blue-50/50 rounded-lg border border-blue-100 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-600 w-16">修改为:</span>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="h-7 text-xs flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ACTION_LABELS).map(([key, info]) => (
              <SelectItem key={key} value={key}>
                {info.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-start gap-2">
        <span className="text-xs font-medium text-gray-600 w-16 mt-1.5">备注:</span>
        <Textarea
          className="text-xs h-16 flex-1"
          placeholder="可选：添加修改原因..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel}>取消</Button>
        <Button size="sm" className="h-7 text-xs" onClick={() => onSave(action, notes)}>确认修改</Button>
      </div>
    </div>
  );
}

function KpiCard({ title, value, icon: Icon, color }: {
  title: string; value: string; icon: any; color: string;
}) {
  const colorMap: Record<string, { bg: string; text: string; iconBg: string }> = {
    emerald: { bg: "bg-emerald-50", text: "text-emerald-700", iconBg: "bg-emerald-100" },
    red: { bg: "bg-red-50", text: "text-red-700", iconBg: "bg-red-100" },
    amber: { bg: "bg-amber-50", text: "text-amber-700", iconBg: "bg-amber-100" },
    blue: { bg: "bg-blue-50", text: "text-blue-700", iconBg: "bg-blue-100" },
  };
  const c = colorMap[color] || colorMap.blue;

  return (
    <Card className={`${c.bg} border-transparent`}>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${c.iconBg}`}>
            <Icon className={`w-4 h-4 ${c.text}`} />
          </div>
          <div>
            <p className="text-xs text-gray-500">{title}</p>
            <p className="text-xl font-bold">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
