import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Sparkles, Loader2, Download, Search, Star, Zap, Gem, CheckCircle2,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  asin: string | null;
  marketplace: string;
  days: number;
}

export default function EffectiveSearchTerms({ asin, marketplace, days }: Props) {
  const [selectedTerms, setSelectedTerms] = useState<Set<string>>(new Set());
  const [editedBids, setEditedBids] = useState<Record<string, number>>({});
  const [editedMatchTypes, setEditedMatchTypes] = useState<Record<string, string>>({});
  const [filterMinOrders, setFilterMinOrders] = useState<string>("");

  const { data, isLoading } = trpc.adAnalysis.getEffectiveSearchTerms.useQuery(
    { asin: asin || undefined, marketplace, days },
    { enabled: true }
  );

  const aiEvaluate = trpc.adAnalysis.aiEvaluateSearchTerms.useMutation({
    onSuccess: (result) => {
      toast.success("AI评估完成");
      // Apply AI recommendations to edited bids/match types
      for (const term of result.evaluated_terms || []) {
        if (term.recommended_bid) setEditedBids(prev => ({ ...prev, [term.term]: term.recommended_bid }));
        if (term.recommended_match_type) setEditedMatchTypes(prev => ({ ...prev, [term.term]: term.recommended_match_type }));
      }
    },
    onError: () => toast.error("AI评估失败，请重试"),
  });

  const effectiveTerms = data?.effectiveTerms || [];
  const organicOnlyTerms = data?.organicOnlyTerms || [];

  const filteredEffective = useMemo(() => {
    const minOrders = parseInt(filterMinOrders) || 0;
    return effectiveTerms.filter((t: any) => t.orders >= minOrders);
  }, [effectiveTerms, filterMinOrders]);

  const handleToggleSelect = (query: string) => {
    setSelectedTerms(prev => {
      const next = new Set(prev);
      if (next.has(query)) next.delete(query);
      else next.add(query);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedTerms.size === filteredEffective.length) {
      setSelectedTerms(new Set());
    } else {
      setSelectedTerms(new Set(filteredEffective.map((t: any) => t.query)));
    }
  };

  const handleAiEvaluate = () => {
    const termsToEvaluate = filteredEffective
      .filter((t: any) => selectedTerms.has(t.query))
      .map((t: any) => ({
        term: t.query,
        orders: t.orders,
        clicks: t.clicks,
        impressions: t.impressions,
        cvr: t.cvr,
      }));
    if (termsToEvaluate.length === 0) {
      toast.warning("请先选择要评估的搜索词");
      return;
    }
    aiEvaluate.mutate({ terms: termsToEvaluate, targetAcos: 25 });
  };

  const handleExportBulkSheet = () => {
    const termsToExport = filteredEffective.filter((t: any) => selectedTerms.has(t.query));
    if (termsToExport.length === 0) {
      toast.warning("请先选择要导出的搜索词");
      return;
    }
    const headers = [
      "Record Type", "Campaign Name", "Ad Group Name", "Keyword or Product Targeting",
      "Match Type", "Bid", "Status",
    ];
    const rows = termsToExport.map((t: any) => [
      "Keyword",
      "[Campaign Name]",
      "[Ad Group Name]",
      t.query,
      editedMatchTypes[t.query] || t.recommendedMatchType || "broad",
      editedBids[t.query] || t.recommendedBid || 0.5,
      "enabled",
    ]);
    const csv = [headers.join("\t"), ...rows.map(r => r.join("\t"))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/tab-separated-values;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bulk_sheet_new_keywords_${new Date().toISOString().slice(0, 10)}.tsv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Bulk Sheet导出成功");
  };

  // Chart data
  const chartData = useMemo(() => {
    return effectiveTerms.slice(0, 10).map((t: any) => ({
      term: t.query.length > 15 ? t.query.slice(0, 15) + "..." : t.query,
      订单: t.orders,
      点击: t.clicks,
      价值评分: t.valueScore,
    }));
  }, [effectiveTerms]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gem className="w-5 h-5 text-amber-600" />
          <h3 className="font-semibold">有效出单搜索词发现</h3>
          {data?.isMock && <Badge variant="secondary" className="text-xs">模拟数据</Badge>}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-blue-50">
          <CardContent className="pt-3 pb-2.5 px-3">
            <p className="text-xs text-blue-600 mb-1">广告搜索词总数</p>
            <p className="text-xl font-bold text-blue-700">{data?.totalAdTerms || 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-purple-50">
          <CardContent className="pt-3 pb-2.5 px-3">
            <p className="text-xs text-purple-600 mb-1">已投放关键词</p>
            <p className="text-xl font-bold text-purple-700">{data?.totalTargetedKeywords || 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-amber-50">
          <CardContent className="pt-3 pb-2.5 px-3">
            <p className="text-xs text-amber-600 mb-1">有效未投放词</p>
            <p className="text-xl font-bold text-amber-700">{effectiveTerms.length}</p>
            <p className="text-[10px] text-amber-500">有出单但未精准投放</p>
          </CardContent>
        </Card>
        <Card className="bg-emerald-50">
          <CardContent className="pt-3 pb-2.5 px-3">
            <p className="text-xs text-emerald-600 mb-1">纯自然出单词</p>
            <p className="text-xl font-bold text-emerald-700">{organicOnlyTerms.length}</p>
            <p className="text-[10px] text-emerald-500">零广告花费有出单</p>
          </CardContent>
        </Card>
      </div>

      {/* Top Effective Terms Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Top10有效未投放搜索词</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 9 }} />
                  <YAxis dataKey="term" type="category" tick={{ fontSize: 9 }} width={120} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: "10px" }} />
                  <Bar dataKey="订单" fill="#10b981" radius={[0, 2, 2, 0]} />
                  <Bar dataKey="点击" fill="#3b82f6" radius={[0, 2, 2, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Action Bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          placeholder="最少订单数..."
          value={filterMinOrders}
          onChange={(e) => setFilterMinOrders(e.target.value)}
          className="w-32 h-8 text-xs"
          type="number"
        />
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleSelectAll}>
          <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
          {selectedTerms.size === filteredEffective.length ? "取消全选" : "全选"}
        </Button>
        <Button
          variant="default" size="sm" className="h-8 text-xs bg-purple-600 hover:bg-purple-700"
          onClick={handleAiEvaluate}
          disabled={aiEvaluate.isPending || selectedTerms.size === 0}
        >
          {aiEvaluate.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
          AI评估投放价值 ({selectedTerms.size})
        </Button>
        <Button
          variant="outline" size="sm" className="h-8 text-xs"
          onClick={handleExportBulkSheet}
          disabled={selectedTerms.size === 0}
        >
          <Download className="w-3.5 h-3.5 mr-1" />
          导出Bulk Sheet ({selectedTerms.size})
        </Button>
        <span className="text-xs text-gray-400 ml-auto">
          已选 {selectedTerms.size} / {filteredEffective.length} 个搜索词
        </span>
      </div>

      {/* AI Evaluation Result */}
      {aiEvaluate.data && (
        <Card className="border-purple-200 bg-purple-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-600" />
              AI投放价值评估结果
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-gray-600 mb-3">{aiEvaluate.data.summary}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {(aiEvaluate.data.evaluated_terms || []).map((term: any, i: number) => (
                <div key={i} className="bg-white rounded-lg p-2.5 border text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium truncate max-w-[150px]">{term.term}</span>
                    <Badge variant={term.priority === "P0" ? "destructive" : term.priority === "P1" ? "default" : "secondary"} className="text-[10px]">
                      {term.priority}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-gray-500">
                    <Star className="w-3 h-3 text-amber-500" />
                    <span>价值: {term.value_score}/10</span>
                    <span>|</span>
                    <span>竞价: ${term.recommended_bid}</span>
                    <span>|</span>
                    <span>{term.recommended_match_type}</span>
                  </div>
                  <p className="text-gray-400 mt-1">{term.reason}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Effective Terms Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">有效未投放搜索词明细 ({filteredEffective.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/50">
                  <th className="p-2.5 w-8"><Checkbox checked={selectedTerms.size === filteredEffective.length && filteredEffective.length > 0} onCheckedChange={handleSelectAll} /></th>
                  <th className="text-left p-2.5 font-medium text-gray-600">搜索词</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">订单</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">曝光</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">点击</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">CVR</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">花费</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">ACoS</th>
                  <th className="text-center p-2.5 font-medium text-gray-600">价值评分</th>
                  <th className="text-center p-2.5 font-medium text-gray-600">建议匹配</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">建议竞价</th>
                </tr>
              </thead>
              <tbody>
                {filteredEffective.length === 0 ? (
                  <tr><td colSpan={11} className="text-center py-8 text-gray-400">暂无有效未投放搜索词</td></tr>
                ) : (
                  filteredEffective.slice(0, 100).map((term: any, i: number) => (
                    <tr key={i} className={`border-b hover:bg-gray-50/50 ${selectedTerms.has(term.query) ? "bg-purple-50/30" : ""}`}>
                      <td className="p-2.5">
                        <Checkbox checked={selectedTerms.has(term.query)} onCheckedChange={() => handleToggleSelect(term.query)} />
                      </td>
                      <td className="p-2.5 text-xs font-medium max-w-[200px] truncate">{term.query}</td>
                      <td className="p-2.5 text-right text-xs font-bold text-emerald-600">{term.orders}</td>
                      <td className="p-2.5 text-right text-xs">{term.impressions.toLocaleString()}</td>
                      <td className="p-2.5 text-right text-xs">{term.clicks}</td>
                      <td className="p-2.5 text-right text-xs">
                        <span className={`font-medium ${term.cvr >= 10 ? "text-emerald-600" : term.cvr >= 5 ? "text-blue-600" : "text-gray-500"}`}>
                          {term.cvr}%
                        </span>
                      </td>
                      <td className="p-2.5 text-right text-xs text-red-600">${term.cost.toFixed(2)}</td>
                      <td className="p-2.5 text-right text-xs">
                        <span className={`${term.acos <= 25 ? "text-emerald-600" : term.acos <= 40 ? "text-amber-600" : "text-red-600"}`}>
                          {term.acos}%
                        </span>
                      </td>
                      <td className="p-2.5 text-center">
                        <div className="flex items-center justify-center gap-0.5">
                          {Array.from({ length: 5 }).map((_, si) => (
                            <Star key={si} className={`w-3 h-3 ${si < Math.round(term.valueScore / 2) ? "text-amber-400 fill-amber-400" : "text-gray-200"}`} />
                          ))}
                        </div>
                      </td>
                      <td className="p-2.5 text-center">
                        <Select
                          value={editedMatchTypes[term.query] || term.recommendedMatchType}
                          onValueChange={(v) => setEditedMatchTypes(prev => ({ ...prev, [term.query]: v }))}
                        >
                          <SelectTrigger className="h-6 text-[10px] w-16 mx-auto">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="exact">精确</SelectItem>
                            <SelectItem value="phrase">词组</SelectItem>
                            <SelectItem value="broad">广泛</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-2.5 text-right">
                        <Input
                          type="number"
                          step="0.01"
                          className="h-6 w-16 text-[10px] text-right ml-auto"
                          value={editedBids[term.query] ?? term.recommendedBid}
                          onChange={(e) => setEditedBids(prev => ({ ...prev, [term.query]: parseFloat(e.target.value) || 0 }))}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Organic Only Terms */}
      {organicOnlyTerms.length > 0 && (
        <Card className="border-emerald-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-600" />
              纯自然出单搜索词（零广告花费）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-emerald-50/50">
                    <th className="text-left p-2.5 font-medium text-gray-600">#</th>
                    <th className="text-left p-2.5 font-medium text-gray-600">搜索词</th>
                    <th className="text-right p-2.5 font-medium text-gray-600">自然订单</th>
                    <th className="text-right p-2.5 font-medium text-gray-600">曝光</th>
                    <th className="text-right p-2.5 font-medium text-gray-600">点击</th>
                    <th className="text-right p-2.5 font-medium text-gray-600">CVR</th>
                    <th className="text-center p-2.5 font-medium text-gray-600">价值评分</th>
                  </tr>
                </thead>
                <tbody>
                  {organicOnlyTerms.slice(0, 30).map((term: any, i: number) => (
                    <tr key={i} className="border-b hover:bg-emerald-50/30">
                      <td className="p-2.5 text-xs text-gray-400">{i + 1}</td>
                      <td className="p-2.5 text-xs font-medium">{term.query}</td>
                      <td className="p-2.5 text-right text-xs font-bold text-emerald-600">{term.orders}</td>
                      <td className="p-2.5 text-right text-xs">{term.impressions.toLocaleString()}</td>
                      <td className="p-2.5 text-right text-xs">{term.clicks}</td>
                      <td className="p-2.5 text-right text-xs font-medium text-emerald-600">{term.cvr}%</td>
                      <td className="p-2.5 text-center">
                        <Badge className="text-[10px] bg-emerald-100 text-emerald-700">{term.valueScore}/10</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
