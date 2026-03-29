import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from "recharts";
import {
  Sparkles, Loader2, Search, Filter, Download, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, Edit3, ThumbsUp, ThumbsDown, RotateCcw,
  AlertTriangle, TrendingUp, TrendingDown, Zap, Eye, Target,
  ArrowUpRight, ArrowDownRight, Minus as MinusIcon, Plus,
} from "lucide-react";

// 12-Category color and icon mapping
const CATEGORY_COLORS: Record<number, { color: string; bg: string; border: string; label: string; shortLabel: string }> = {
  1: { color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", label: "高曝光_高点击率_高转化", shortLabel: "核心大词" },
  2: { color: "text-orange-700", bg: "bg-orange-50", border: "border-orange-200", label: "高曝光_高点击率_低转化", shortLabel: "流量陷阱词" },
  3: { color: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200", label: "高曝光_低点击率_高转化", shortLabel: "潜力提升词" },
  4: { color: "text-red-700", bg: "bg-red-50", border: "border-red-200", label: "高曝光_低点击率_低转化", shortLabel: "低效大词" },
  5: { color: "text-teal-700", bg: "bg-teal-50", border: "border-teal-200", label: "中曝光_高点击率_高转化", shortLabel: "高效精准词" },
  6: { color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200", label: "中曝光_高点击率_低转化", shortLabel: "需优化转化词" },
  7: { color: "text-indigo-700", bg: "bg-indigo-50", border: "border-indigo-200", label: "中曝光_低点击率_高转化", shortLabel: "隐藏宝藏词" },
  8: { color: "text-gray-700", bg: "bg-gray-50", border: "border-gray-200", label: "中曝光_低点击率_低转化", shortLabel: "观察淘汰词" },
  9: { color: "text-green-700", bg: "bg-green-50", border: "border-green-200", label: "低曝光_高点击率_高转化", shortLabel: "精准长尾词" },
  10: { color: "text-purple-700", bg: "bg-purple-50", border: "border-purple-200", label: "低曝光_高点击率_低转化", shortLabel: "小众吸引词" },
  11: { color: "text-cyan-700", bg: "bg-cyan-50", border: "border-cyan-200", label: "低曝光_低点击率_高转化", shortLabel: "冷门精准词" },
  12: { color: "text-rose-700", bg: "bg-rose-50", border: "border-rose-200", label: "低曝光_低点击率_低转化", shortLabel: "无效词" },
};

const PIE_COLORS = [
  "#10b981", "#f97316", "#3b82f6", "#ef4444", "#14b8a6", "#f59e0b",
  "#6366f1", "#9ca3af", "#22c55e", "#a855f7", "#06b6d4", "#f43f5e",
];

interface SearchTermClassificationProps {
  campaignId: string | null;
  marketplace?: string;
  reportDate: string;
}

export default function SearchTermClassification({ campaignId, marketplace, reportDate }: SearchTermClassificationProps) {
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<string>("cost");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedCategory, setExpandedCategory] = useState<number | null>(null);
  const [showAiDialog, setShowAiDialog] = useState(false);
  const [aiCategoryId, setAiCategoryId] = useState<number>(1);
  const [userDecisions, setUserDecisions] = useState<Record<number, { decision: string; modifiedAction?: string; notes?: string }>>({});

  const { data, isLoading, refetch } = trpc.adAnalysis.getSearchTerms12Category.useQuery({
    campaignId: campaignId || undefined,
    marketplace,
    reportDate,
  });

  const { data: categoryDefs } = trpc.adAnalysis.getCategoryDefinitions.useQuery();

  const aiAdvice = trpc.adAnalysis.aiSearchTermAdvice.useMutation({
    onSuccess: () => toast.success("AI分析完成"),
    onError: (err) => toast.error("AI分析失败", { description: err.message }),
  });

  const searchTerms = data?.searchTerms || [];
  const categoryStats = data?.categoryStats || {};
  const categories = categoryDefs?.categories || [];

  // Filter and sort
  const filteredTerms = useMemo(() => {
    let result = [...searchTerms];
    if (categoryFilter !== null) {
      result = result.filter((t: any) => t.categoryId === categoryFilter);
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

  // Pie chart data
  const pieData = useMemo(() => {
    return Object.entries(categoryStats)
      .filter(([_, count]) => (count as number) > 0)
      .map(([id, count]) => {
        const catId = Number(id);
        const config = CATEGORY_COLORS[catId];
        return {
          name: config?.shortLabel || `分类${id}`,
          value: count as number,
          fill: PIE_COLORS[catId - 1] || "#999",
        };
      });
  }, [categoryStats]);

  // Category summary bar chart
  const barData = useMemo(() => {
    return Object.entries(categoryStats)
      .filter(([_, count]) => (count as number) > 0)
      .map(([id, count]) => ({
        id: Number(id),
        name: CATEGORY_COLORS[Number(id)]?.shortLabel || `分类${id}`,
        count: count as number,
        fill: PIE_COLORS[Number(id) - 1] || "#999",
      }))
      .sort((a, b) => b.count - a.count);
  }, [categoryStats]);

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir(sortDir === "desc" ? "asc" : "desc");
    else { setSortField(field); setSortDir("desc"); }
  };

  const handleAiAnalyze = (catId: number) => {
    const termsInCategory = searchTerms.filter((t: any) => t.categoryId === catId).slice(0, 30);
    if (termsInCategory.length === 0) {
      toast.info("该分类无搜索词");
      return;
    }
    setAiCategoryId(catId);
    setShowAiDialog(true);
    setUserDecisions({});
    aiAdvice.mutate({
      searchTerms: termsInCategory.map((t: any) => ({
        query: t.query, impressions: t.impressions, clicks: t.clicks,
        cost: t.cost, sales: t.sales, orders: t.orders,
        acos: t.acos, ctr: t.ctr, convRate: t.convRate,
      })),
      categoryId: catId,
      campaignId: campaignId || undefined,
    });
  };

  const handleExportCSV = () => {
    const headers = ["搜索词", "分类", "曝光", "点击", "花费", "销售额", "订单", "ACoS", "CTR", "CVR"];
    const rows = filteredTerms.map((t: any) => [
      t.query, CATEGORY_COLORS[t.categoryId]?.shortLabel || "",
      t.impressions, t.clicks, t.cost?.toFixed(2), t.sales?.toFixed(2),
      t.orders, `${t.acos}%`, `${t.ctr}%`, `${t.convRate}%`,
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `search_terms_12cat_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast.success("已导出CSV文件");
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <div className="grid grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Category Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {Object.entries(categoryStats)
          .filter(([_, count]) => (count as number) > 0)
          .sort(([, a], [, b]) => (b as number) - (a as number))
          .map(([id, count]) => {
            const catId = Number(id);
            const config = CATEGORY_COLORS[catId];
            const isSelected = categoryFilter === catId;
            return (
              <button
                key={id}
                onClick={() => setCategoryFilter(isSelected ? null : catId)}
                className={`p-3 rounded-lg border text-left transition-all ${
                  isSelected ? `${config.bg} ${config.border} ring-2 ring-offset-1` : "bg-white hover:bg-gray-50 border-gray-200"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-medium ${config.color}`}>{config.shortLabel}</span>
                  <span className="text-lg font-bold">{count as number}</span>
                </div>
                <p className="text-[10px] text-gray-500 truncate">{config.label}</p>
              </button>
            );
          })}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">分类分布</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%" cy="50%"
                    innerRadius={40} outerRadius={80}
                    paddingAngle={2}
                  >
                    {pieData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => [`${value}个`, "数量"]} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">分类数量排行</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="count" name="数量" radius={[0, 4, 4, 0]}>
                    {barData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Category Detail Cards with 4-part advice */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">分类详情与标准建议</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setExpandedCategory(expandedCategory ? null : 1)}>
              {expandedCategory ? "收起" : "展开全部"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {categories.filter((c: any) => (categoryStats[c.id] || 0) > 0).map((cat: any) => {
            const config = CATEGORY_COLORS[cat.id];
            const isExpanded = expandedCategory === cat.id;
            const count = categoryStats[cat.id] || 0;
            return (
              <div key={cat.id} className={`border rounded-lg overflow-hidden ${config.border}`}>
                <button
                  onClick={() => setExpandedCategory(isExpanded ? null : cat.id)}
                  className={`w-full flex items-center justify-between p-3 ${config.bg} hover:opacity-90 transition-opacity`}
                >
                  <div className="flex items-center gap-3">
                    <Badge className={`${config.bg} ${config.color} ${config.border} border`}>
                      {cat.id}
                    </Badge>
                    <span className={`font-medium text-sm ${config.color}`}>{config.shortLabel}</span>
                    <span className="text-xs text-gray-500">{config.label}</span>
                    <Badge variant="secondary" className="text-[10px]">{count}个词</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm" variant="outline" className="h-7 text-xs"
                      onClick={(e) => { e.stopPropagation(); handleAiAnalyze(cat.id); }}
                    >
                      <Sparkles className="w-3 h-3 mr-1" />
                      AI分析
                    </Button>
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </div>
                </button>
                {isExpanded && (
                  <div className="p-4 bg-white space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="p-3 rounded-lg bg-red-50/50 border border-red-100">
                        <h5 className="text-xs font-semibold text-red-700 mb-1.5 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> 问题分析
                        </h5>
                        <p className="text-xs text-gray-700 whitespace-pre-line">{cat.problemAnalysis}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-blue-50/50 border border-blue-100">
                        <h5 className="text-xs font-semibold text-blue-700 mb-1.5 flex items-center gap-1">
                          <Target className="w-3 h-3" /> 广告目的
                        </h5>
                        <p className="text-xs text-gray-700">{cat.adPurpose}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-emerald-50/50 border border-emerald-100">
                        <h5 className="text-xs font-semibold text-emerald-700 mb-1.5 flex items-center gap-1">
                          <Zap className="w-3 h-3" /> 广告策略
                        </h5>
                        <p className="text-xs text-gray-700 whitespace-pre-line">{cat.adStrategy}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-purple-50/50 border border-purple-100">
                        <h5 className="text-xs font-semibold text-purple-700 mb-1.5 flex items-center gap-1">
                          <TrendingUp className="w-3 h-3" /> 调整后预期结果
                        </h5>
                        <p className="text-xs text-gray-700">{cat.expectedResult}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Search Terms Table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm">搜索词明细</CardTitle>
              <CardDescription className="text-xs">
                共{filteredTerms.length}个搜索词
                {categoryFilter !== null && ` · 筛选: ${CATEGORY_COLORS[categoryFilter]?.shortLabel}`}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <Input
                  placeholder="搜索..."
                  className="pl-7 h-8 w-48 text-xs"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Button variant="outline" size="sm" className="h-8" onClick={handleExportCSV}>
                <Download className="w-3.5 h-3.5 mr-1" />
                导出CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/50">
                  <th className="text-left p-3 font-medium text-gray-600 w-10">#</th>
                  <th className="text-left p-3 font-medium text-gray-600">搜索词</th>
                  <th className="text-center p-3 font-medium text-gray-600 w-24">分类</th>
                  {["impressions", "clicks", "cost", "sales", "orders", "acos", "ctr", "convRate"].map(field => (
                    <th
                      key={field}
                      className="text-right p-3 font-medium text-gray-600 cursor-pointer hover:text-blue-600 select-none"
                      onClick={() => handleSort(field)}
                    >
                      <span className="flex items-center justify-end gap-1">
                        {{
                          impressions: "曝光", clicks: "点击", cost: "花费",
                          sales: "销售额", orders: "订单", acos: "ACoS",
                          ctr: "CTR", convRate: "CVR",
                        }[field]}
                        {sortField === field && (
                          sortDir === "desc" ? <ArrowDownRight className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredTerms.length === 0 ? (
                  <tr><td colSpan={11} className="text-center py-12 text-gray-400">暂无搜索词数据</td></tr>
                ) : (
                  filteredTerms.slice(0, 200).map((t: any, i: number) => {
                    const config = CATEGORY_COLORS[t.categoryId] || CATEGORY_COLORS[12];
                    return (
                      <tr key={i} className="border-b hover:bg-gray-50/50">
                        <td className="p-3 text-gray-400 text-xs">{i + 1}</td>
                        <td className="p-3 font-medium text-xs max-w-[200px]">
                          <span className="truncate block">{t.query}</span>
                          {t.match_type && (
                            <span className="text-[10px] text-gray-400">{t.match_type}</span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          <Badge className={`text-[10px] ${config.bg} ${config.color} ${config.border} border`}>
                            {config.shortLabel}
                          </Badge>
                        </td>
                        <td className="p-3 text-right text-xs">{(t.impressions || 0).toLocaleString()}</td>
                        <td className="p-3 text-right text-xs">{(t.clicks || 0).toLocaleString()}</td>
                        <td className="p-3 text-right text-xs">${(t.cost || 0).toFixed(2)}</td>
                        <td className="p-3 text-right text-xs font-medium">${(t.sales || 0).toFixed(2)}</td>
                        <td className="p-3 text-right text-xs">{t.orders || 0}</td>
                        <td className="p-3 text-right text-xs">
                          <span className={`font-medium ${
                            (t.acos || 0) <= 20 ? "text-emerald-600" : (t.acos || 0) <= 35 ? "text-amber-600" : "text-red-600"
                          }`}>{t.acos}%</span>
                        </td>
                        <td className="p-3 text-right text-xs">{t.ctr}%</td>
                        <td className="p-3 text-right text-xs">{t.convRate}%</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {filteredTerms.length > 200 && (
            <div className="p-3 text-center text-xs text-gray-500 border-t">
              显示前200条，共{filteredTerms.length}条。请使用筛选或导出查看全部数据。
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Advice Dialog */}
      <Dialog open={showAiDialog} onOpenChange={setShowAiDialog}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-blue-500" />
              AI个性化建议 - {CATEGORY_COLORS[aiCategoryId]?.shortLabel}
            </DialogTitle>
          </DialogHeader>
          {aiAdvice.isPending ? (
            <div className="flex flex-col items-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-3" />
              <p className="text-sm text-gray-500">AI正在分析该分类的搜索词数据...</p>
            </div>
          ) : aiAdvice.data ? (
            <div className="space-y-4">
              <div className="p-4 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-800 font-medium mb-2">分类总结</p>
                <p className="text-sm text-blue-700">{(aiAdvice.data as any).category_summary}</p>
              </div>
              {(aiAdvice.data as any).top_actions?.length > 0 && (
                <div className="p-3 bg-emerald-50 rounded-lg">
                  <p className="text-xs font-medium text-emerald-700 mb-2">优先操作:</p>
                  <ul className="space-y-1">
                    {(aiAdvice.data as any).top_actions.map((action: string, i: number) => (
                      <li key={i} className="text-sm text-emerald-800 flex items-start gap-2">
                        <CheckCircle2 className="w-3 h-3 mt-1 shrink-0" />{action}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Per-term advice with user interaction */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium">逐词建议（可接受/拒绝/修改）</h4>
                {(aiAdvice.data as any).advice?.map((a: any, i: number) => {
                  const decision = userDecisions[i];
                  return (
                    <div
                      key={i}
                      className={`p-3 border rounded-lg transition-all ${
                        decision?.decision === "accepted" ? "bg-emerald-50/50 border-emerald-200" :
                        decision?.decision === "rejected" ? "bg-red-50/30 border-red-200 opacity-60" :
                        "hover:bg-gray-50/50"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Search className="w-3 h-3 text-gray-400" />
                          <span className="font-medium text-sm">{a.search_term}</span>
                          <Badge variant="outline" className="text-[10px]">{a.priority}</Badge>
                          <Badge className="text-[10px] bg-blue-50 text-blue-700 border-blue-200 border">{a.suggested_action}</Badge>
                        </div>
                        <div className="flex items-center gap-1">
                          {!decision ? (
                            <>
                              <Button size="sm" variant="ghost" className="h-6 px-2 text-emerald-600" onClick={() => setUserDecisions(prev => ({ ...prev, [i]: { decision: "accepted" } }))}>
                                <ThumbsUp className="w-3 h-3" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-6 px-2 text-red-600" onClick={() => setUserDecisions(prev => ({ ...prev, [i]: { decision: "rejected" } }))}>
                                <ThumbsDown className="w-3 h-3" />
                              </Button>
                            </>
                          ) : (
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-gray-400" onClick={() => {
                              const newD = { ...userDecisions };
                              delete newD[i];
                              setUserDecisions(newD);
                            }}>
                              <RotateCcw className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 ml-5">
                        <div className="p-2 bg-red-50/50 rounded text-xs">
                          <span className="font-medium text-red-700">问题分析：</span>
                          <span className="text-gray-700">{a.problem_analysis}</span>
                        </div>
                        <div className="p-2 bg-blue-50/50 rounded text-xs">
                          <span className="font-medium text-blue-700">广告目的：</span>
                          <span className="text-gray-700">{a.ad_purpose}</span>
                        </div>
                        <div className="p-2 bg-emerald-50/50 rounded text-xs">
                          <span className="font-medium text-emerald-700">广告策略：</span>
                          <span className="text-gray-700">{a.ad_strategy}</span>
                        </div>
                        <div className="p-2 bg-purple-50/50 rounded text-xs">
                          <span className="font-medium text-purple-700">预期结果：</span>
                          <span className="text-gray-700">{a.expected_result}</span>
                        </div>
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
