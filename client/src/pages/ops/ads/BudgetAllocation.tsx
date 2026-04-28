import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell,
  PieChart, Pie,
} from "recharts";
import {
  Sparkles, Loader2, DollarSign, TrendingUp, TrendingDown, Target,
  ArrowUpRight, ArrowDownRight, Minus, Download, Edit3, Check, X,
  AlertTriangle, Lightbulb, Pause, Play, Save, CheckCircle2,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

interface BudgetAllocationProps {
  marketplace?: string;
  reportDate?: string;
  startDate?: string;
  endDate?: string;
  weekStartDate?: string;
  weekEndDate?: string;
}

const ACTION_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  increase: { label: "增加", color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", icon: ArrowUpRight },
  decrease: { label: "减少", color: "text-red-700", bg: "bg-red-50 border-red-200", icon: ArrowDownRight },
  maintain: { label: "维持", color: "text-blue-700", bg: "bg-blue-50 border-blue-200", icon: Minus },
  pause: { label: "暂停", color: "text-gray-700", bg: "bg-gray-50 border-gray-200", icon: Pause },
};

const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-red-100 text-red-700 border-red-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-gray-100 text-gray-600 border-gray-200",
};

export default function BudgetAllocation({ marketplace, reportDate, startDate, endDate, weekStartDate, weekEndDate }: BudgetAllocationProps) {
  const [targetAcos, setTargetAcos] = useState(25);
  const [editingBudgets, setEditingBudgets] = useState<Record<string, number>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [userNotes, setUserNotes] = useState("");
  const [saved, setSaved] = useState(false);

  const budgetMutation = trpc.adLocalAnalysis.aiBudgetAllocationLocal.useMutation({
    onSuccess: () => { toast.success("AI预算分析完成（本地数据）"); setSaved(false); },
    onError: (err) => toast.error(`分析失败: ${err.message}`),
  });

  const saveMutation = trpc.adAnalysis.saveBudgetDecision.useMutation({
    onSuccess: (res) => {
      toast.success(`预算方案已保存 (${res.batchId})`);
      setSaved(true);
    },
    onError: (err) => toast.error(`保存失败: ${err.message}`),
  });

  const data = budgetMutation.data;
  const allocation = data?.allocation;

  const handleAnalyze = () => {
    budgetMutation.mutate({ weekStartDate, weekEndDate, targetAcos });
  };

  const handleEditBudget = (campaignId: string, value: number) => {
    setEditingBudgets(prev => ({ ...prev, [campaignId]: value }));
  };

  const handleSaveDecision = (decision: 'accepted' | 'modified' | 'rejected' | 'partial') => {
    if (!allocation?.campaigns || !data) return;
    const hasEdits = Object.keys(editingBudgets).length > 0;
    const actualDecision = hasEdits ? (decision === 'accepted' ? 'modified' : decision) : decision;
    saveMutation.mutate({
      marketplace,
      totalBudgetBefore: data.totals.totalCurrentBudget,
      totalBudgetAfter: allocation.total_suggested_budget || 0,
      campaignCount: allocation.campaigns.length,
      baselineSpend: data.totals.totalCost,
      baselineSales: data.totals.totalSales,
      baselineAcos: data.totals.overallAcos,
      baselineRoas: data.totals.totalSales > 0 && data.totals.totalCost > 0 ? Math.round(data.totals.totalSales / data.totals.totalCost * 100) / 100 : 0,
      baselineOrders: data.campaignData.reduce((s: number, c: any) => s + (c.orders || 0), 0),
      userDecision: actualDecision,
      userNotes: userNotes || undefined,
      campaignDecisions: allocation.campaigns.map((c: any) => ({
        campaignId: c.campaignId,
        campaignName: c.name,
        action: c.action,
        currentBudget: c.currentBudget,
        suggestedBudget: c.suggestedBudget,
        confirmedBudget: editingBudgets[c.campaignId] ?? c.suggestedBudget,
        reason: c.reason,
        priority: c.priority,
      })),
    });
  };

  const handleExportCSV = () => {
    if (!allocation?.campaigns) return;
    const headers = ["广告活动", "操作建议", "当前预算($)", "建议预算($)", "用户调整预算($)", "变化%", "优先级", "预期ACoS%", "理由"];
    const rows = allocation.campaigns.map((c: any) => [
      c.name, ACTION_CONFIG[c.action]?.label || c.action,
      c.currentBudget, c.suggestedBudget,
      editingBudgets[c.campaignId] ?? c.suggestedBudget,
      c.changePercent, c.priority, c.expectedAcos, c.reason,
    ]);
    const csv = [headers, ...rows].map(r => r.map((v: any) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `budget_allocation_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("预算方案已导出");
  };

  // Chart data
  const budgetCompareData = useMemo(() => {
    if (!allocation?.campaigns) return [];
    return allocation.campaigns.slice(0, 10).map((c: any) => ({
      name: c.name.length > 12 ? c.name.slice(0, 12) + "..." : c.name,
      当前预算: c.currentBudget,
      建议预算: editingBudgets[c.campaignId] ?? c.suggestedBudget,
    }));
  }, [allocation, editingBudgets]);

  const actionDistribution = useMemo(() => {
    if (!allocation?.campaigns) return [];
    const counts: Record<string, number> = {};
    for (const c of allocation.campaigns) {
      counts[c.action] = (counts[c.action] || 0) + 1;
    }
    return Object.entries(counts).map(([action, count]) => ({
      name: ACTION_CONFIG[action]?.label || action,
      value: count,
      color: action === "increase" ? "#10b981" : action === "decrease" ? "#ef4444" : action === "pause" ? "#9ca3af" : "#3b82f6",
    }));
  }, [allocation]);

  return (
    <div className="space-y-4">
      {/* Control Panel */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-orange-600" />
              <CardTitle className="text-base">AI预算智能分配</CardTitle>
              <Badge variant="outline" className="text-[10px] bg-purple-50 text-purple-700 border-purple-200">AI驱动</Badge>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">目标ACoS:</span>
                <Input
                  type="number"
                  value={targetAcos}
                  onChange={(e) => setTargetAcos(Number(e.target.value) || 25)}
                  className="w-16 h-7 text-xs"
                  min={5}
                  max={100}
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
              <Button
                onClick={handleAnalyze}
                disabled={budgetMutation.isPending}
                className="h-8 gap-1.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white"
              >
                {budgetMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {budgetMutation.isPending ? "分析中..." : "AI分析预算"}
              </Button>
            </div>
          </div>
          <CardDescription className="text-xs mt-1">
            基于各广告活动的ACoS、ROAS、花费和销售额数据，AI自动生成预算调整方案。支持编辑后导出CSV。
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Loading State */}
      {budgetMutation.isPending && (
        <div className="space-y-3">
          <Skeleton className="h-32" />
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
          </div>
          <Skeleton className="h-64" />
        </div>
      )}

      {/* Results */}
      {data && !budgetMutation.isPending && (
        <>
          {/* KPI Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="bg-gradient-to-br from-red-50 to-red-100/50">
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground">当前总日预算</p>
                <p className="text-xl font-bold text-red-700">${data.totals.totalCurrentBudget.toFixed(0)}</p>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100/50">
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground">建议总日预算</p>
                <p className="text-xl font-bold text-emerald-700">
                  ${allocation?.total_suggested_budget?.toFixed(0) || "—"}
                </p>
                {allocation && (
                  <p className={`text-[10px] mt-0.5 ${allocation.total_suggested_budget > data.totals.totalCurrentBudget ? "text-emerald-600" : "text-red-600"}`}>
                    {allocation.total_suggested_budget > data.totals.totalCurrentBudget ? "↑" : "↓"}
                    {Math.abs(Math.round((allocation.total_suggested_budget - data.totals.totalCurrentBudget) / data.totals.totalCurrentBudget * 100))}%
                  </p>
                )}
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-blue-50 to-blue-100/50">
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground">整体ACoS</p>
                <p className={`text-xl font-bold ${data.totals.overallAcos <= targetAcos ? "text-emerald-700" : "text-red-700"}`}>
                  {data.totals.overallAcos}%
                </p>
                <p className="text-[10px] text-muted-foreground">目标: {targetAcos}%</p>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-purple-50 to-purple-100/50">
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground">分析活动数</p>
                <p className="text-xl font-bold text-purple-700">{data.campaignData.length}</p>
                <p className="text-[10px] text-muted-foreground">{data.dateRange.days}天数据</p>
              </CardContent>
            </Card>
          </div>

          {/* AI Analysis */}
          {allocation && (
            <Card className="border-amber-200 bg-amber-50/30">
              <CardContent className="p-4">
                <div className="flex items-start gap-2 mb-3">
                  <Lightbulb className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-800">AI整体分析</p>
                    <p className="text-xs text-amber-700 mt-1">{allocation.overall_analysis}</p>
                  </div>
                </div>
                {allocation.key_insights?.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {allocation.key_insights.map((insight: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-[10px] bg-white/60 text-amber-800 border-amber-300">
                        {insight}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Charts Row */}
          {allocation && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">预算对比 (TOP 10)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={budgetCompareData} layout="vertical" margin={{ left: 80, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={80} />
                      <Tooltip formatter={(v: number) => `$${v}`} contentStyle={{ fontSize: 11 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="当前预算" fill="#94a3b8" radius={[0, 2, 2, 0]} />
                      <Bar dataKey="建议预算" fill="#f59e0b" radius={[0, 2, 2, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">操作分布</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie data={actionDistribution} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                        {actionDistribution.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Campaign Detail Table */}
          {allocation?.campaigns && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">各活动预算调整建议</CardTitle>
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleExportCSV}>
                    <Download className="w-3 h-3" />
                    导出CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50/50">
                        <th className="text-left p-3 font-medium text-gray-600 w-10">#</th>
                        <th className="text-left p-3 font-medium text-gray-600">广告活动</th>
                        <th className="text-center p-3 font-medium text-gray-600 w-20">操作</th>
                        <th className="text-center p-3 font-medium text-gray-600 w-20">优先级</th>
                        <th className="text-right p-3 font-medium text-gray-600 w-24">当前预算</th>
                        <th className="text-right p-3 font-medium text-gray-600 w-28">建议预算</th>
                        <th className="text-right p-3 font-medium text-gray-600 w-20">变化</th>
                        <th className="text-right p-3 font-medium text-gray-600 w-20">预期ACoS</th>
                        <th className="text-left p-3 font-medium text-gray-600">理由</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allocation.campaigns.map((c: any, idx: number) => {
                        const config = ACTION_CONFIG[c.action] || ACTION_CONFIG.maintain;
                        const Icon = config.icon;
                        const userBudget = editingBudgets[c.campaignId];
                        const displayBudget = userBudget ?? c.suggestedBudget;
                        return (
                          <tr key={c.campaignId} className="border-b last:border-0 hover:bg-gray-50/50">
                            <td className="p-3 text-xs text-gray-400">{idx + 1}</td>
                            <td className="p-3">
                              <p className="text-xs font-medium truncate max-w-[200px]">{c.name}</p>
                            </td>
                            <td className="p-3 text-center">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${config.bg} ${config.color}`}>
                                <Icon className="w-2.5 h-2.5" />
                                {config.label}
                              </span>
                            </td>
                            <td className="p-3 text-center">
                              <Badge variant="outline" className={`text-[10px] ${PRIORITY_COLORS[c.priority] || PRIORITY_COLORS.low}`}>
                                {c.priority === "high" ? "高" : c.priority === "medium" ? "中" : "低"}
                              </Badge>
                            </td>
                            <td className="p-3 text-right text-xs font-mono">${c.currentBudget}</td>
                            <td className="p-3 text-right">
                              {editingId === c.campaignId ? (
                                <div className="flex items-center gap-1 justify-end">
                                  <span className="text-xs">$</span>
                                  <Input
                                    type="number"
                                    value={displayBudget}
                                    onChange={(e) => handleEditBudget(c.campaignId, Number(e.target.value))}
                                    className="w-16 h-6 text-xs"
                                    autoFocus
                                  />
                                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setEditingId(null)}>
                                    <Check className="w-3 h-3 text-emerald-600" />
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 justify-end">
                                  <span className={`text-xs font-mono font-medium ${c.action === "increase" ? "text-emerald-600" : c.action === "decrease" ? "text-red-600" : ""}`}>
                                    ${displayBudget}
                                  </span>
                                  <Button variant="ghost" size="icon" className="h-5 w-5 opacity-40 hover:opacity-100" onClick={() => setEditingId(c.campaignId)}>
                                    <Edit3 className="w-2.5 h-2.5" />
                                  </Button>
                                </div>
                              )}
                            </td>
                            <td className="p-3 text-right">
                              <span className={`text-xs font-medium ${c.changePercent > 0 ? "text-emerald-600" : c.changePercent < 0 ? "text-red-600" : "text-gray-500"}`}>
                                {c.changePercent > 0 ? "+" : ""}{c.changePercent}%
                              </span>
                            </td>
                            <td className="p-3 text-right text-xs">{c.expectedAcos}%</td>
                            <td className="p-3 text-xs text-gray-600 max-w-[200px] truncate">{c.reason}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Save Decision Panel */}
          {allocation?.campaigns && !saved && (
            <Card className="border-indigo-200 bg-indigo-50/30">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <Save className="w-4 h-4 text-indigo-600" />
                  <p className="text-sm font-medium text-indigo-800">保存预算决策并追踪效果</p>
                </div>
                <Textarea
                  placeholder="添加备注（可选）..."
                  value={userNotes}
                  onChange={(e) => setUserNotes(e.target.value)}
                  className="h-16 text-xs resize-none bg-white"
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                    disabled={saveMutation.isPending}
                    onClick={() => handleSaveDecision('accepted')}
                  >
                    {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                    采纳并保存
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1"
                    disabled={saveMutation.isPending}
                    onClick={() => handleSaveDecision('partial')}
                  >
                    部分采纳
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1 text-red-600 border-red-200 hover:bg-red-50"
                    disabled={saveMutation.isPending}
                    onClick={() => handleSaveDecision('rejected')}
                  >
                    拒绝
                  </Button>
                  <span className="text-[10px] text-muted-foreground ml-2">保存后可在"效果追踪"Tab中查看并评估执行效果</span>
                </div>
              </CardContent>
            </Card>
          )}
          {saved && (
            <Card className="border-emerald-200 bg-emerald-50/30">
              <CardContent className="p-4 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <p className="text-sm text-emerald-700">预算方案已保存，您可以在"效果追踪"Tab中查看历史记录并评估执行效果。</p>
              </CardContent>
            </Card>
          )}

          {/* Error fallback */}
          {data.error && !allocation && (
            <Card className="border-red-200 bg-red-50/30">
              <CardContent className="p-4 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <p className="text-sm text-red-700">{data.error}</p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Empty State */}
      {!data && !budgetMutation.isPending && (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <DollarSign className="w-12 h-12 mx-auto text-gray-300 mb-4" />
            <p className="text-sm font-medium text-gray-500 mb-2">点击"AI分析预算"开始</p>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              AI将分析各广告活动的ACoS、ROAS、花费和销售额表现，自动生成预算增减建议。
              您可以编辑建议金额后导出CSV，直接应用到广告后台。
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
