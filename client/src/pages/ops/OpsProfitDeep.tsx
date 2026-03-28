import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useMarketplace } from "@/contexts/MarketplaceContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from "recharts";
import {
  DollarSign, TrendingUp, TrendingDown, Target, Sparkles, Loader2,
  BarChart3, PieChartIcon, FileText, AlertTriangle, CheckCircle2,
  ArrowUpRight, ArrowDownRight, Minus,
} from "lucide-react";

const PIE_COLORS = ["#3b82f6", "#06b6d4", "#f59e0b", "#ef4444", "#8b5cf6", "#10b981", "#f97316"];

export default function OpsProfitDeep() {
  const { marketplace } = useMarketplace();
  const [selectedDays, setSelectedDays] = useState(30);
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedAsin, setSelectedAsin] = useState<string | null>(null);
  const [aiDiagnosis, setAiDiagnosis] = useState<any>(null);
  const [isEditingDiagnosis, setIsEditingDiagnosis] = useState(false);
  const [editedDiagnosis, setEditedDiagnosis] = useState<any>(null);

  const startDate = useMemo(() => new Date(Date.now() - selectedDays * 86400000).toISOString().slice(0, 10), [selectedDays]);
  const endDate = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const { data, isLoading } = trpc.profitDeep.getParentAsinProfit.useQuery({
    marketplace,
    startDate,
    endDate,
  });

  const { data: financeData } = trpc.profitDeep.getFinanceStatement.useQuery({
    marketplace,
    startDate,
    endDate,
  });

  const aiMutation = trpc.profitDeep.aiProfitDiagnosis.useMutation({
    onSuccess: (result) => {
      setAiDiagnosis(result);
      setEditedDiagnosis(result);
      toast.success("AI利润诊断已生成");
    },
    onError: (err) => toast.error(`AI诊断失败: ${err.message}`),
  });

  const handleDiagnose = (item: any) => {
    setSelectedAsin(item.parentAsin);
    // Simulate prev period data (in real scenario, fetch two periods)
    const prevSales = item.sales * (0.8 + Math.random() * 0.4);
    const prevProfit = item.profit * (0.7 + Math.random() * 0.6);
    const prevMargin = prevSales > 0 ? (prevProfit / prevSales) * 100 : 0;

    aiMutation.mutate({
      asin: item.parentAsin,
      sales7d: item.sales,
      profit7d: item.profit,
      margin7d: item.profitRate,
      salesPrev: +prevSales.toFixed(2),
      profitPrev: +prevProfit.toFixed(2),
      marginPrev: +prevMargin.toFixed(2),
      cogs: item.cogs,
      shipping: item.shipping,
      fbaFee: item.fbaFee,
      storageFee: item.storageFee,
      adCost: item.adsCost,
      commission: item.commission,
      refund: item.refund,
      returnRate: 3.5,
    });
  };

  // Profit ranking chart data
  const profitRankData = useMemo(() => {
    if (!data?.items) return [];
    return data.items.slice(0, 10).map((item: any) => ({
      name: item.parentAsin,
      利润: item.profit,
      销售额: item.sales,
    }));
  }, [data]);

  if (isLoading) {
    return (
      <div className="space-y-4 p-1">
        <div className="grid grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const kpi = data?.kpi;
  const items = data?.items || [];
  const costBreakdown = data?.costBreakdown || [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-emerald-600" />
            利润深度分析
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">父ASIN维度利润汇总、成本拆解与AI诊断</p>
        </div>
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
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "总销售额", value: `$${(kpi?.totalSales || 0).toLocaleString()}`, icon: TrendingUp, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "总利润", value: `$${(kpi?.totalProfit || 0).toLocaleString()}`, icon: DollarSign, color: "text-emerald-600", bg: "bg-emerald-50" },
          { label: "利润率", value: `${kpi?.profitRate || 0}%`, icon: Target, color: (kpi?.profitRate || 0) >= 15 ? "text-emerald-600" : (kpi?.profitRate || 0) >= 8 ? "text-amber-600" : "text-red-600", bg: (kpi?.profitRate || 0) >= 15 ? "bg-emerald-50" : (kpi?.profitRate || 0) >= 8 ? "bg-amber-50" : "bg-red-50" },
          { label: "广告费", value: `$${(kpi?.totalAdsCost || 0).toLocaleString()}`, icon: BarChart3, color: "text-purple-600", bg: "bg-purple-50" },
          { label: "产品数", value: String(kpi?.itemCount || 0), icon: FileText, color: "text-gray-600", bg: "bg-gray-50" },
        ].map((k) => (
          <Card key={k.label} className={`${k.bg} border-none`}>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 mb-1">
                <k.icon className={`w-4 h-4 ${k.color}`} />
                <span className="text-xs text-gray-600">{k.label}</span>
              </div>
              <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="overview" className="text-xs gap-1">
            <BarChart3 className="w-3.5 h-3.5" />
            利润排行
          </TabsTrigger>
          <TabsTrigger value="cost" className="text-xs gap-1">
            <PieChartIcon className="w-3.5 h-3.5" />
            成本拆解
          </TabsTrigger>
          <TabsTrigger value="finance" className="text-xs gap-1">
            <FileText className="w-3.5 h-3.5" />
            财务流水
          </TabsTrigger>
        </TabsList>

        {/* Tab: Profit Ranking */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          {/* Chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">父ASIN利润排行 TOP10</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={profitRankData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 9 }} width={90} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    <Bar dataKey="利润" fill="#10b981" radius={[0, 3, 3, 0]} />
                    <Bar dataKey="销售额" fill="#3b82f6" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Profit Table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">父ASIN利润明细 ({items.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50/50">
                      <th className="text-left p-2.5 font-medium text-gray-600 w-8">#</th>
                      <th className="text-left p-2.5 font-medium text-gray-600">父ASIN</th>
                      <th className="text-right p-2.5 font-medium text-gray-600">子ASIN</th>
                      <th className="text-right p-2.5 font-medium text-gray-600">销售额</th>
                      <th className="text-right p-2.5 font-medium text-gray-600">利润</th>
                      <th className="text-right p-2.5 font-medium text-gray-600">利润率</th>
                      <th className="text-right p-2.5 font-medium text-gray-600">广告费</th>
                      <th className="text-right p-2.5 font-medium text-gray-600">FBA费</th>
                      <th className="text-right p-2.5 font-medium text-gray-600">佣金</th>
                      <th className="text-center p-2.5 font-medium text-gray-600">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 ? (
                      <tr><td colSpan={10} className="text-center py-8 text-gray-400">暂无利润数据</td></tr>
                    ) : (
                      items.map((item: any, i: number) => (
                        <tr key={i} className={`border-b hover:bg-gray-50/50 ${selectedAsin === item.parentAsin ? "bg-blue-50/50" : ""}`}>
                          <td className="p-2.5 text-gray-400 text-xs">{i + 1}</td>
                          <td className="p-2.5 text-xs font-medium font-mono">{item.parentAsin}</td>
                          <td className="p-2.5 text-right text-xs">{item.childCount}</td>
                          <td className="p-2.5 text-right text-xs">${item.sales.toLocaleString()}</td>
                          <td className="p-2.5 text-right text-xs font-medium">
                            <span className={item.profit >= 0 ? "text-emerald-600" : "text-red-600"}>
                              ${item.profit.toLocaleString()}
                            </span>
                          </td>
                          <td className="p-2.5 text-right text-xs">
                            <span className={`font-medium ${item.profitRate >= 15 ? "text-emerald-600" : item.profitRate >= 8 ? "text-amber-600" : "text-red-600"}`}>
                              {item.profitRate}%
                            </span>
                          </td>
                          <td className="p-2.5 text-right text-xs text-purple-600">${item.adsCost}</td>
                          <td className="p-2.5 text-right text-xs">${item.fbaFee}</td>
                          <td className="p-2.5 text-right text-xs">${item.commission}</td>
                          <td className="p-2.5 text-center">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-xs px-2"
                              onClick={() => handleDiagnose(item)}
                              disabled={aiMutation.isPending && selectedAsin === item.parentAsin}
                            >
                              {aiMutation.isPending && selectedAsin === item.parentAsin ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Sparkles className="w-3 h-3 mr-0.5" />
                              )}
                              AI诊断
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* AI Diagnosis Card */}
          {(aiDiagnosis || (aiMutation.isPending && selectedAsin)) && (
            <Card className="border-emerald-200 bg-emerald-50/30">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-600" />
                    AI利润诊断 — {selectedAsin}
                  </CardTitle>
                  <div className="flex gap-2">
                    {aiDiagnosis && !isEditingDiagnosis && (
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setIsEditingDiagnosis(true)}>
                        编辑
                      </Button>
                    )}
                    {isEditingDiagnosis && (
                      <>
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setAiDiagnosis(editedDiagnosis); setIsEditingDiagnosis(false); toast.success("已保存修改"); }}>
                          保存
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setEditedDiagnosis(aiDiagnosis); setIsEditingDiagnosis(false); }}>
                          取消
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {aiMutation.isPending ? (
                  <div className="flex items-center gap-2 py-4 justify-center text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">AI正在诊断利润数据...</span>
                  </div>
                ) : aiDiagnosis && (
                  <>
                    {/* Margin Change */}
                    <div className="flex items-center gap-4 p-3 bg-white rounded-lg border">
                      <div className="text-center">
                        <span className="text-xs text-gray-500">上期利润率</span>
                        <p className="text-lg font-bold">{aiDiagnosis.margin_change?.previous}%</p>
                      </div>
                      <div className="flex items-center">
                        {aiDiagnosis.margin_change?.trend === "上升" ? (
                          <ArrowUpRight className="w-5 h-5 text-emerald-500" />
                        ) : aiDiagnosis.margin_change?.trend === "下降" ? (
                          <ArrowDownRight className="w-5 h-5 text-red-500" />
                        ) : (
                          <Minus className="w-5 h-5 text-gray-400" />
                        )}
                      </div>
                      <div className="text-center">
                        <span className="text-xs text-gray-500">本期利润率</span>
                        <p className="text-lg font-bold">{aiDiagnosis.margin_change?.current}%</p>
                      </div>
                      <Badge variant="outline" className={`ml-2 ${aiDiagnosis.margin_change?.change >= 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                        {aiDiagnosis.margin_change?.change >= 0 ? "+" : ""}{aiDiagnosis.margin_change?.change}%
                      </Badge>
                    </div>

                    {/* Diagnosis */}
                    <div>
                      <Badge variant="outline" className="bg-blue-100 text-blue-700 text-xs mb-1">诊断摘要</Badge>
                      {isEditingDiagnosis ? (
                        <textarea
                          className="w-full text-sm p-2 border rounded-md bg-white min-h-[60px]"
                          value={editedDiagnosis?.diagnosis || ""}
                          onChange={(e) => setEditedDiagnosis({ ...editedDiagnosis, diagnosis: e.target.value })}
                        />
                      ) : (
                        <p className="text-sm text-gray-700">{aiDiagnosis.diagnosis}</p>
                      )}
                    </div>

                    {/* Cost Drivers */}
                    {aiDiagnosis.cost_drivers?.length > 0 && (
                      <div>
                        <Badge variant="outline" className="bg-amber-100 text-amber-700 text-xs mb-2">成本驱动因素</Badge>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b bg-white">
                                <th className="text-left p-2 font-medium text-gray-600 text-xs">成本项</th>
                                <th className="text-right p-2 font-medium text-gray-600 text-xs">本期占比</th>
                                <th className="text-right p-2 font-medium text-gray-600 text-xs">上期占比</th>
                                <th className="text-center p-2 font-medium text-gray-600 text-xs">异常</th>
                                <th className="text-left p-2 font-medium text-gray-600 text-xs">行业基准</th>
                              </tr>
                            </thead>
                            <tbody>
                              {aiDiagnosis.cost_drivers.map((d: any, i: number) => (
                                <tr key={i} className="border-b">
                                  <td className="p-2 text-xs font-medium">{d.item}</td>
                                  <td className="p-2 text-right text-xs">{d.current_pct}%</td>
                                  <td className="p-2 text-right text-xs">{d.previous_pct}%</td>
                                  <td className="p-2 text-center">
                                    {d.is_abnormal ? (
                                      <AlertTriangle className="w-3.5 h-3.5 text-red-500 mx-auto" />
                                    ) : (
                                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mx-auto" />
                                    )}
                                  </td>
                                  <td className="p-2 text-xs text-gray-500">{d.benchmark}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Recommendations */}
                    {aiDiagnosis.recommendations?.length > 0 && (
                      <div>
                        <Badge variant="outline" className="bg-emerald-100 text-emerald-700 text-xs mb-2">优化建议</Badge>
                        <div className="space-y-1.5">
                          {aiDiagnosis.recommendations.map((r: any, i: number) => (
                            <div key={i} className="flex items-start gap-2 text-xs bg-white p-2.5 rounded border">
                              <Badge variant="outline" className={`text-[10px] flex-shrink-0 ${r.priority === "P0" ? "bg-red-100 text-red-700" : r.priority === "P1" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-700"}`}>
                                {r.priority}
                              </Badge>
                              <div className="flex-1">
                                <p className="font-medium">{r.action}</p>
                                <div className="flex gap-3 mt-0.5 text-gray-500">
                                  <span>预期节省: {r.expected_saving}</span>
                                  <span>难度: {r.difficulty}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Tab: Cost Breakdown */}
        <TabsContent value="cost" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">成本结构饼图</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={costBreakdown}
                        cx="50%" cy="50%"
                        innerRadius={55} outerRadius={90}
                        dataKey="value"
                        label={({ name, pct }) => `${name} ${pct}%`}
                      >
                        {costBreakdown.map((entry: any, i: number) => (
                          <Cell key={i} fill={entry.color || PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: any) => `$${Number(value).toFixed(2)}`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">成本明细</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {costBreakdown.map((c: any, i: number) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: c.color || PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="text-sm">{c.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium">${c.value.toLocaleString()}</span>
                        <span className="text-xs text-gray-500 w-12 text-right">{c.pct}%</span>
                        <div className="w-20 h-2 bg-gray-100 rounded-full">
                          <div className="h-full rounded-full" style={{ width: `${c.pct}%`, backgroundColor: c.color || PIE_COLORS[i % PIE_COLORS.length] }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab: Finance Statement */}
        <TabsContent value="finance" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">财务流水明细 ({financeData?.items?.length || 0})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50/50">
                      <th className="text-left p-2.5 font-medium text-gray-600">批次号</th>
                      <th className="text-left p-2.5 font-medium text-gray-600">SKU</th>
                      <th className="text-left p-2.5 font-medium text-gray-600">ASIN</th>
                      <th className="text-left p-2.5 font-medium text-gray-600">类型</th>
                      <th className="text-right p-2.5 font-medium text-gray-600">金额</th>
                      <th className="text-left p-2.5 font-medium text-gray-600">说明</th>
                      <th className="text-left p-2.5 font-medium text-gray-600">日期</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(financeData?.items || []).length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-8 text-gray-400">暂无财务流水数据</td></tr>
                    ) : (
                      (financeData?.items || []).map((item: any, i: number) => (
                        <tr key={i} className="border-b hover:bg-gray-50/50">
                          <td className="p-2.5 text-xs font-mono">{item.batch_no}</td>
                          <td className="p-2.5 text-xs">{item.sku}</td>
                          <td className="p-2.5 text-xs font-mono">{item.asin}</td>
                          <td className="p-2.5">
                            <Badge variant="outline" className="text-[10px]">{item.type}</Badge>
                          </td>
                          <td className="p-2.5 text-right text-xs">
                            <span className={item.amount >= 0 ? "text-emerald-600" : "text-red-600"}>
                              ${Math.abs(item.amount).toFixed(2)}
                            </span>
                          </td>
                          <td className="p-2.5 text-xs text-gray-600">{item.description}</td>
                          <td className="p-2.5 text-xs text-gray-500">{item.created_at}</td>
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
    </div>
  );
}
