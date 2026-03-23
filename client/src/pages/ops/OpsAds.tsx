import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell,
  ScatterChart, Scatter, ZAxis,
} from "recharts";
import {
  Target, Sparkles, RefreshCw, Loader2, Search, DollarSign,
  MousePointerClick, Eye, CheckCircle2, XCircle, ArrowRight, Plus, Minus,
} from "lucide-react";

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

export default function OpsAds() {
  
  const [showAiDialog, setShowAiDialog] = useState(false);

  const { data: campaignData, isLoading: campaignLoading, refetch } = trpc.operations.getAdCampaigns.useQuery({});
  const { data: searchTermData, isLoading: stLoading } = trpc.operations.getSearchTerms.useQuery({});

  const aiAnalysis = trpc.operations.aiSearchTermAnalysis.useMutation({
    onSuccess: () => toast.success("搜索词分析完成"),
    onError: (err) => toast.error("分析失败", { description: err.message }),
  });

  const saveActions = trpc.operations.saveSearchTermActions.useMutation({
    onSuccess: (data) => toast.success(`已保存${data.saved}条操作建议`),
    onError: (err) => toast.error("保存失败", { description: err.message }),
  });

  const campaigns = campaignData?.campaigns || [];
  const searchTerms = searchTermData?.searchTerms || [];

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

  // Scatter chart data for campaigns
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
      toast.success("无搜索词数据", { description: "请确保有搜索词数据后再分析" });
      return;
    }
    setShowAiDialog(true);
    aiAnalysis.mutate({ searchTerms: searchTerms.slice(0, 100) });
  };

  const handleSaveActions = () => {
    const analysis = (aiAnalysis.data as any)?.analysis;
    if (!analysis?.length) return;

    saveActions.mutate({
      actions: analysis.map((a: any) => ({
        searchTerm: a.search_term,
        suggestedAction: a.suggested_action,
        aiReason: a.reason,
        userDecision: "pending" as const,
      })),
    });
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
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" />
            刷新
          </Button>
          <Button size="sm" onClick={handleAiAnalyze} disabled={aiAnalysis.isPending}>
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
          <TabsTrigger value="searchterms">搜索词</TabsTrigger>
        </TabsList>

        {/* Campaigns Tab */}
        <TabsContent value="campaigns" className="space-y-4">
          {/* Campaign Performance Chart */}
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
                      formatter={(value: number, name: string) => {
                        if (name === "花费" || name === "销售额") return [`$${value}`, name];
                        return [value, name];
                      }}
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

          {/* Campaign Table */}
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
                          <td className="p-3 font-medium">{c.campaign_name}</td>
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

        {/* Search Terms Tab */}
        <TabsContent value="searchterms" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">搜索词报告</CardTitle>
                  <CardDescription>客户搜索词及其广告表现</CardDescription>
                </div>
                <Button size="sm" onClick={handleAiAnalyze} disabled={aiAnalysis.isPending}>
                  {aiAnalysis.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
                  AI智能分析
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50/50">
                      <th className="text-left p-3 font-medium text-gray-600">搜索词</th>
                      <th className="text-right p-3 font-medium text-gray-600">曝光</th>
                      <th className="text-right p-3 font-medium text-gray-600">点击</th>
                      <th className="text-right p-3 font-medium text-gray-600">花费</th>
                      <th className="text-right p-3 font-medium text-gray-600">销售额</th>
                      <th className="text-right p-3 font-medium text-gray-600">订单</th>
                      <th className="text-right p-3 font-medium text-gray-600">ACoS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchTerms.length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-12 text-gray-400">暂无搜索词数据</td></tr>
                    ) : (
                      searchTerms.map((st: any, i: number) => (
                        <tr key={i} className="border-b hover:bg-gray-50/50">
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <Search className="w-3 h-3 text-gray-400 shrink-0" />
                              <span className="font-medium">{st.search_term}</span>
                            </div>
                          </td>
                          <td className="p-3 text-right">{(st.impressions || 0).toLocaleString()}</td>
                          <td className="p-3 text-right">{(st.clicks || 0).toLocaleString()}</td>
                          <td className="p-3 text-right">${(st.spend || 0).toFixed(2)}</td>
                          <td className="p-3 text-right">${(st.sales || 0).toFixed(2)}</td>
                          <td className="p-3 text-right">{st.orders || 0}</td>
                          <td className="p-3 text-right">
                            <span className={`font-medium ${
                              st.sales > 0 && st.acos <= 20 ? "text-emerald-600" :
                              st.sales > 0 && st.acos <= 35 ? "text-amber-600" :
                              st.sales > 0 ? "text-red-600" : "text-gray-400"
                            }`}>
                              {st.sales > 0 ? `${st.acos}%` : "-"}
                            </span>
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
      </Tabs>

      {/* AI Search Term Analysis Dialog */}
      <Dialog open={showAiDialog} onOpenChange={setShowAiDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
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

              {/* Analysis Results */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">搜索词操作建议</h4>
                  <Button size="sm" variant="outline" onClick={handleSaveActions} disabled={saveActions.isPending}>
                    {saveActions.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                    保存全部建议
                  </Button>
                </div>
                {(aiAnalysis.data as any).analysis?.map((a: any, i: number) => {
                  const actionInfo = ACTION_LABELS[a.suggested_action] || ACTION_LABELS.keep;
                  const ActionIcon = actionInfo.icon;
                  return (
                    <div key={i} className="p-3 border rounded-lg hover:bg-gray-50/50">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <Search className="w-3 h-3 text-gray-400" />
                          <span className="font-medium text-sm">{a.search_term}</span>
                        </div>
                        <Badge className={`text-[10px] ${actionInfo.color}`}>
                          <ActionIcon className="w-3 h-3 mr-1" />
                          {actionInfo.label}
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-500 ml-5">{a.reason}</p>
                      <div className="flex items-center gap-4 mt-1 ml-5 text-[10px] text-gray-400">
                        <span>置信度: {a.confidence}</span>
                        <span>预估影响: {a.estimated_impact}</span>
                      </div>
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
