import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell,
  ComposedChart, Line,
} from "recharts";
import {
  DollarSign, TrendingUp, TrendingDown, Sparkles, RefreshCw, Loader2,
  ArrowUpRight, ArrowDownRight, Percent, AlertTriangle, CheckCircle2,
} from "lucide-react";

type AnalysisType = "cost_optimization" | "anomaly_detection" | "trend_forecast";

export default function OpsProfit() {
  const [, setLocation] = useLocation();
  
  const [dateRange, setDateRange] = useState("30");
  const [showAiDialog, setShowAiDialog] = useState(false);
  const [analysisType, setAnalysisType] = useState<AnalysisType>("cost_optimization");

  const startDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(dateRange));
    return d.toISOString().split("T")[0];
  }, [dateRange]);
  const endDate = useMemo(() => new Date().toISOString().split("T")[0], []);

  const { data, isLoading, refetch } = trpc.operations.getProfitOverview.useQuery({
    startDate,
    endDate,
  });

  const { data: productData, isLoading: productLoading } = trpc.operations.getProfitByProduct.useQuery({
    startDate,
    endDate,
  });

  const aiAnalysis = trpc.operations.aiProfitAnalysis.useMutation({
    onSuccess: () => toast.success("AI分析完成"),
    onError: (err) => toast.error("分析失败", { description: err.message }),
  });

  const handleAiAnalysis = (type: AnalysisType) => {
    setAnalysisType(type);
    setShowAiDialog(true);
    aiAnalysis.mutate({
      profitData: (data?.trend || []).map((d: any) => ({ ...d })),
      analysisType: type,
    });
  };

  const waterfall = data?.waterfall || [];
  const trend = data?.trend || [];
  const totals = data?.totals;
  const products = productData?.items || [];

  // Waterfall chart data with cumulative values
  const waterfallData = useMemo(() => {
    let cumulative = 0;
    return waterfall.map((item: any) => {
      if (item.type === "positive") {
        const start = cumulative;
        cumulative += item.value;
        return { ...item, start, end: cumulative, displayValue: item.value };
      } else if (item.type === "negative") {
        const start = cumulative;
        cumulative += item.value; // value is negative
        return { ...item, start: cumulative, end: start, displayValue: Math.abs(item.value) };
      } else {
        // total
        return { ...item, start: 0, end: item.value, displayValue: item.value };
      }
    });
  }, [waterfall]);

  if (isLoading) {
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
          <h1 className="text-2xl font-bold text-gray-900">利润分析</h1>
          <p className="text-sm text-gray-500 mt-1">SKU级别利润分解与成本优化</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-28 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">近7天</SelectItem>
              <SelectItem value="14">近14天</SelectItem>
              <SelectItem value="30">近30天</SelectItem>
              <SelectItem value="60">近60天</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" />
            刷新
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          title="总收入"
          value={`$${(totals?.revenue || 0).toLocaleString()}`}
          icon={DollarSign}
          color="emerald"
        />
        <SummaryCard
          title="净利润"
          value={`$${(totals?.profit || 0).toLocaleString()}`}
          icon={TrendingUp}
          color="blue"
        />
        <SummaryCard
          title="利润率"
          value={`${totals?.margin || 0}%`}
          icon={Percent}
          color={((totals?.margin || 0) >= 20) ? "emerald" : "amber"}
        />
        <SummaryCard
          title="总订单"
          value={(totals?.orders || 0).toLocaleString()}
          icon={DollarSign}
          color="purple"
        />
      </div>

      <Tabs defaultValue="trend" className="space-y-4">
        <TabsList>
          <TabsTrigger value="trend">趋势分析</TabsTrigger>
          <TabsTrigger value="waterfall">成本瀑布图</TabsTrigger>
          <TabsTrigger value="products">SKU利润排行</TabsTrigger>
        </TabsList>

        {/* Trend Tab */}
        <TabsContent value="trend">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">收入/利润/利润率趋势</CardTitle>
                  <CardDescription>近{dateRange}天每日数据</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => handleAiAnalysis("trend_forecast")}>
                    <Sparkles className="w-3 h-3 mr-1" />
                    趋势预测
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleAiAnalysis("anomaly_detection")}>
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    异常检测
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={trend}>
                    <defs>
                      <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v?.slice(5)} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      formatter={(value: number, name: string) => {
                        if (name === "margin") return [`${value}%`, "利润率"];
                        return [`$${value.toLocaleString()}`, name === "revenue" ? "收入" : name === "profit" ? "利润" : "广告支出"];
                      }}
                    />
                    <Legend formatter={(v) => v === "revenue" ? "收入" : v === "profit" ? "利润" : v === "margin" ? "利润率" : "广告支出"} />
                    <Area yAxisId="left" type="monotone" dataKey="revenue" stroke="#3b82f6" fill="url(#gradRevenue)" strokeWidth={2} />
                    <Bar yAxisId="left" dataKey="profit" fill="#10b981" radius={[2, 2, 0, 0]} barSize={12} />
                    <Line yAxisId="right" type="monotone" dataKey="margin" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Waterfall Tab */}
        <TabsContent value="waterfall">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">成本结构瀑布图</CardTitle>
                  <CardDescription>从收入到净利润的费用分解</CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={() => handleAiAnalysis("cost_optimization")}>
                  <Sparkles className="w-3 h-3 mr-1" />
                  成本优化建议
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={waterfallData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                    <Tooltip
                      formatter={(value: number, name: string) => {
                        if (name === "start") return null;
                        return [`$${Math.abs(value).toLocaleString()}`, "金额"];
                      }}
                    />
                    {/* Invisible base bar */}
                    <Bar dataKey="start" stackId="stack" fill="transparent" />
                    {/* Visible bar */}
                    <Bar dataKey="displayValue" stackId="stack" radius={[4, 4, 0, 0]}>
                      {waterfallData.map((entry: any, idx: number) => (
                        <Cell
                          key={idx}
                          fill={entry.type === "positive" ? "#10b981" : entry.type === "total" ? "#3b82f6" : "#ef4444"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {/* Cost breakdown table */}
              <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
                {waterfall.map((item: any, i: number) => (
                  <div key={i} className={`p-3 rounded-lg ${
                    item.type === "positive" ? "bg-emerald-50" : item.type === "total" ? "bg-blue-50" : "bg-red-50"
                  }`}>
                    <p className="text-xs text-gray-500">{item.name}</p>
                    <p className={`text-lg font-bold ${
                      item.type === "positive" ? "text-emerald-700" : item.type === "total" ? "text-blue-700" : "text-red-700"
                    }`}>
                      {item.value >= 0 ? "+" : ""}${Math.abs(item.value).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Products Tab */}
        <TabsContent value="products">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">SKU利润排行</CardTitle>
              <CardDescription>按利润额排序的产品列表</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50/50">
                      <th className="text-left p-3 font-medium text-gray-600">#</th>
                      <th className="text-left p-3 font-medium text-gray-600">SKU</th>
                      <th className="text-left p-3 font-medium text-gray-600">产品名称</th>
                      <th className="text-right p-3 font-medium text-gray-600">收入</th>
                      <th className="text-right p-3 font-medium text-gray-600">利润</th>
                      <th className="text-right p-3 font-medium text-gray-600">利润率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-12 text-gray-400">暂无产品利润数据</td></tr>
                    ) : (
                      products.map((p: any, i: number) => (
                        <tr key={i} className="border-b hover:bg-gray-50/50 cursor-pointer transition-colors" onClick={() => {
                          // Try to find matching product profile by ASIN/SKU and navigate
                          if (p.asin) setLocation(`/ops/products?highlight=${p.asin}`);
                          else toast.info("请先在产品总览中创建该产品的档案");
                        }} title="点击查看产品详情">
                          <td className="p-3 text-gray-400">{i + 1}</td>
                          <td className="p-3 font-mono text-xs text-blue-600 hover:underline">{p.seller_sku}</td>
                          <td className="p-3 max-w-[200px] truncate">{p.product_name || "-"}</td>
                          <td className="p-3 text-right">${(p.revenue || 0).toLocaleString()}</td>
                          <td className={`p-3 text-right font-medium ${(p.profit || 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                            ${(p.profit || 0).toLocaleString()}
                          </td>
                          <td className="p-3 text-right">
                            <Badge variant="outline" className={`text-[10px] ${
                              (p.profit_margin || 0) >= 20 ? "text-emerald-600" : (p.profit_margin || 0) >= 10 ? "text-amber-600" : "text-red-600"
                            }`}>
                              {p.profit_margin || 0}%
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
      </Tabs>

      {/* AI Analysis Dialog */}
      <Dialog open={showAiDialog} onOpenChange={setShowAiDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-blue-500" />
              AI利润分析 - {analysisType === "cost_optimization" ? "成本优化" : analysisType === "anomaly_detection" ? "异常检测" : "趋势预测"}
            </DialogTitle>
          </DialogHeader>
          {aiAnalysis.isPending ? (
            <div className="flex flex-col items-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-3" />
              <p className="text-sm text-gray-500">AI正在分析利润数据...</p>
            </div>
          ) : aiAnalysis.data ? (
            <div className="space-y-4">
              <div className="p-4 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-800">{(aiAnalysis.data as any).summary}</p>
              </div>
              {(aiAnalysis.data as any).findings?.map((f: any, i: number) => (
                <Card key={i} className={`border-l-4 ${
                  f.severity === "high" ? "border-l-red-500" : f.severity === "medium" ? "border-l-amber-500" : "border-l-blue-500"
                }`}>
                  <CardContent className="pt-4 pb-3 px-4">
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="font-medium text-sm">{f.title}</h4>
                      <Badge variant="outline" className="text-[10px]">{f.severity}</Badge>
                    </div>
                    <p className="text-sm text-gray-600">{f.detail}</p>
                    <div className="mt-2 p-2 bg-gray-50 rounded text-xs">
                      <span className="font-medium">建议: </span>{f.suggestion}
                    </div>
                    <p className="text-xs text-gray-400 mt-1">预估影响: {f.estimated_impact}</p>
                  </CardContent>
                </Card>
              ))}
              {(aiAnalysis.data as any).actionItems?.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">行动项</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {(aiAnalysis.data as any).actionItems.map((a: any, i: number) => (
                        <div key={i} className="flex items-center gap-3 p-2 bg-gray-50 rounded text-sm">
                          <Badge variant={a.priority === "high" ? "destructive" : "outline"} className="text-[10px] shrink-0">
                            {a.priority}
                          </Badge>
                          <span className="flex-1">{a.action}</span>
                          <span className="text-xs text-gray-400 shrink-0">{a.expectedSaving}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({ title, value, icon: Icon, color }: {
  title: string; value: string; icon: any; color: string;
}) {
  const colorMap: Record<string, { bg: string; text: string; iconBg: string }> = {
    emerald: { bg: "bg-emerald-50", text: "text-emerald-700", iconBg: "bg-emerald-100" },
    blue: { bg: "bg-blue-50", text: "text-blue-700", iconBg: "bg-blue-100" },
    amber: { bg: "bg-amber-50", text: "text-amber-700", iconBg: "bg-amber-100" },
    purple: { bg: "bg-purple-50", text: "text-purple-700", iconBg: "bg-purple-100" },
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
