import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from "recharts";
import {
  Package, AlertTriangle, ArrowUpDown, Sparkles, RefreshCw, Filter,
  TrendingDown, TrendingUp, AlertCircle, CheckCircle2, Loader2,
  Truck, Ship, Plane, ArrowRight, Clock, Brain, ShieldAlert,
  ChevronRight, ExternalLink, Boxes, Warehouse,
} from "lucide-react";

const ALERT_COLORS = {
  critical: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200", badge: "destructive" as const, label: "紧急", fill: "#ef4444" },
  low: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", badge: "outline" as const, label: "偏低", fill: "#f59e0b" },
  normal: { bg: "bg-green-50", text: "text-green-700", border: "border-green-200", badge: "outline" as const, label: "正常", fill: "#10b981" },
  overstock: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", badge: "outline" as const, label: "滞销", fill: "#3b82f6" },
};

const PREDICTION_COLORS = {
  urgent: { bg: "bg-red-50", text: "text-red-700", border: "border-l-red-500", label: "紧急补货", icon: "🔴" },
  warning: { bg: "bg-orange-50", text: "text-orange-700", border: "border-l-orange-500", label: "预警", icon: "🟠" },
  advance: { bg: "bg-yellow-50", text: "text-yellow-700", border: "border-l-yellow-500", label: "提前准备", icon: "🟡" },
  sufficient: { bg: "bg-green-50", text: "text-green-700", border: "border-l-green-500", label: "库存充足", icon: "🟢" },
};

type AlertFilter = "all" | "critical" | "low" | "normal" | "overstock";
type SortBy = "days_of_supply" | "fulfillable_qty" | "avg_daily_sales";

export default function OpsInventory() {
  const [, navigate] = useLocation();
  const [alertFilter, setAlertFilter] = useState<AlertFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("days_of_supply");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [showAiDialog, setShowAiDialog] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [showPredictionDetail, setShowPredictionDetail] = useState<any>(null);

  const { data, isLoading, refetch } = trpc.operations.getInventoryList.useQuery({
    alertFilter,
    sortBy,
    sortOrder,
  });

  const pipelineQuery = trpc.shippingBatch.getInventoryPipelineSummary.useQuery(undefined, {
    retry: 1,
  });

  const predictionsQuery = trpc.shippingBatch.getPredictions.useQuery(undefined, {
    retry: 1,
  });

  const runPredictions = trpc.shippingBatch.runPredictions.useMutation({
    onSuccess: () => {
      toast.success("AI补货预测已完成");
      predictionsQuery.refetch();
    },
    onError: (err: any) => toast.error("预测失败", { description: err.message }),
  });

  const confirmPrediction = trpc.shippingBatch.confirmPrediction.useMutation({
    onSuccess: () => {
      toast.success("已确认补货建议");
      predictionsQuery.refetch();
    },
  });

  const aiReplenish = trpc.operations.aiReplenishmentPlan.useMutation({
    onSuccess: () => toast.success("AI补货建议已生成"),
    onError: (err: any) => toast.error("生成失败", { description: err.message }),
  });

  const items = data?.items || [];
  const stats = data?.stats;
  const pipeline = pipelineQuery.data;
  const predictions = predictionsQuery.data || [];

  const pieData = useMemo(() => {
    if (!stats) return [];
    return [
      { name: "紧急", value: stats.critical, fill: ALERT_COLORS.critical.fill },
      { name: "偏低", value: stats.low, fill: ALERT_COLORS.low.fill },
      { name: "正常", value: stats.normal, fill: ALERT_COLORS.normal.fill },
      { name: "滞销", value: stats.overstock, fill: ALERT_COLORS.overstock.fill },
    ].filter(d => d.value > 0);
  }, [stats]);

  const topLowStock = useMemo(() => {
    return items
      .filter((i: any) => i.alertLevel === "critical" || i.alertLevel === "low")
      .slice(0, 8)
      .map((i: any) => ({
        name: i.seller_sku?.length > 12 ? i.seller_sku.slice(0, 12) + "..." : i.seller_sku,
        days: i.days_of_supply || 0,
        fill: i.alertLevel === "critical" ? ALERT_COLORS.critical.fill : ALERT_COLORS.low.fill,
      }));
  }, [items]);

  const handleAiReplenish = () => {
    const criticalItems = items
      .filter((i: any) => i.alertLevel === "critical" || i.alertLevel === "low")
      .slice(0, 20)
      .map((i: any) => ({
        seller_sku: i.seller_sku,
        product_name: i.product_name,
        fulfillable_qty: i.fulfillable_qty || 0,
        avg_daily_sales: i.avg_daily_sales || 0,
        days_of_supply: i.days_of_supply || 0,
      }));
    if (criticalItems.length === 0) {
      toast.success("无需补货", { description: "当前没有低库存SKU" });
      return;
    }
    setShowAiDialog(true);
    aiReplenish.mutate({ skuData: criticalItems });
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">库存预警中心</h1>
          <p className="text-sm text-gray-500 mt-1">FBA库存监控 · 全链路物流追踪 · AI智能补货预测</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/ops/shipping")}>
            <Truck className="w-4 h-4 mr-1" />
            物流批次管理
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" />
            刷新
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">库存总览</TabsTrigger>
          <TabsTrigger value="pipeline">物流流水线</TabsTrigger>
          <TabsTrigger value="predictions">AI补货预测</TabsTrigger>
        </TabsList>

        {/* ═══════ Tab 1: 库存总览 ═══════ */}
        <TabsContent value="overview" className="space-y-6 mt-4">
          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <StatCard label="总SKU" value={stats?.total || 0} icon={Package} color="gray" />
            <StatCard label="紧急补货" value={stats?.critical || 0} icon={AlertTriangle} color="red" onClick={() => setAlertFilter("critical")} />
            <StatCard label="库存偏低" value={stats?.low || 0} icon={TrendingDown} color="amber" onClick={() => setAlertFilter("low")} />
            <StatCard label="滞销积压" value={stats?.overstock || 0} icon={TrendingUp} color="blue" onClick={() => setAlertFilter("overstock")} />
            <StatCard label="在途批次" value={pipeline?.batchCount || 0} icon={Truck} color="purple" onClick={() => navigate("/ops/shipping")} />
          </div>

          {/* In-Transit Summary Banner */}
          {pipeline && pipeline.totalInTransit > 0 && (
            <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                      <Ship className="w-4 h-4 text-blue-600" />
                      <span className="text-sm text-blue-700">在途库存总计: <strong>{pipeline.totalInTransit.toLocaleString()}</strong></span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-blue-600">
                      <span>国内运输: {pipeline.domesticTransit.toLocaleString()}</span>
                      <span>国际运输: {pipeline.internationalTransit.toLocaleString()}</span>
                      <span>接收中: {pipeline.receiving.toLocaleString()}</span>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="text-blue-600 h-7" onClick={() => setActiveTab("pipeline")}>
                    查看流水线 <ChevronRight className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">低库存SKU排行</CardTitle>
                <CardDescription>可供天数最少的SKU</CardDescription>
              </CardHeader>
              <CardContent>
                {topLowStock.length === 0 ? (
                  <div className="h-48 flex items-center justify-center text-gray-400">
                    <CheckCircle2 className="w-6 h-6 mr-2" />
                    所有SKU库存充足
                  </div>
                ) : (
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topLowStock} layout="vertical" margin={{ left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" tick={{ fontSize: 11 }} label={{ value: "可供天数", position: "insideBottom", offset: -5, fontSize: 11 }} />
                        <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} />
                        <Tooltip formatter={(v: number) => [`${v}天`, "可供天数"]} />
                        <Bar dataKey="days" radius={[0, 4, 4, 0]}>
                          {topLowStock.map((entry: any, idx: number) => (
                            <Cell key={idx} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">库存健康分布</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value"
                        label={({ name, value }) => `${name}: ${value}`}>
                        {pieData.map((entry, idx) => <Cell key={idx} fill={entry.fill} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Filter & Sort Bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-400" />
              <Select value={alertFilter} onValueChange={(v) => setAlertFilter(v as AlertFilter)}>
                <SelectTrigger className="w-32 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="critical">紧急</SelectItem>
                  <SelectItem value="low">偏低</SelectItem>
                  <SelectItem value="normal">正常</SelectItem>
                  <SelectItem value="overstock">滞销</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <ArrowUpDown className="w-4 h-4 text-gray-400" />
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
                <SelectTrigger className="w-36 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="days_of_supply">可供天数</SelectItem>
                  <SelectItem value="fulfillable_qty">可售数量</SelectItem>
                  <SelectItem value="avg_daily_sales">日均销量</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setSortOrder(prev => prev === "asc" ? "desc" : "asc")}>
                {sortOrder === "asc" ? "↑升序" : "↓降序"}
              </Button>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-sm text-gray-500">共 {items.length} 个SKU</span>
              <Button size="sm" onClick={handleAiReplenish} disabled={aiReplenish.isPending}>
                {aiReplenish.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
                AI补货建议
              </Button>
            </div>
          </div>

          {/* Inventory Table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50/50">
                      <th className="text-left p-3 font-medium text-gray-600">MSKU</th>
                      <th className="text-left p-3 font-medium text-gray-600">ASIN</th>
                      <th className="text-left p-3 font-medium text-gray-600">产品名称</th>
                      <th className="text-right p-3 font-medium text-gray-600">可售数量</th>
                      <th className="text-right p-3 font-medium text-gray-600">在途数量</th>
                      <th className="text-right p-3 font-medium text-gray-600">日均销量</th>
                      <th className="text-right p-3 font-medium text-gray-600">可供天数</th>
                      <th className="text-center p-3 font-medium text-gray-600">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 ? (
                      <tr><td colSpan={8} className="text-center py-12 text-gray-400">暂无库存数据</td></tr>
                    ) : (
                      items.map((item: any, idx: number) => {
                        const alertStyle = ALERT_COLORS[item.alertLevel as keyof typeof ALERT_COLORS] || ALERT_COLORS.normal;
                        return (
                          <tr key={idx} className={`border-b hover:bg-gray-50/50 ${alertStyle.bg}`}>
                            <td className="p-3 font-mono text-xs">{item.seller_sku}</td>
                            <td className="p-3 font-mono text-xs text-gray-500">{item.asin || "-"}</td>
                            <td className="p-3 max-w-[180px] truncate">{item.product_name || "-"}</td>
                            <td className="p-3 text-right font-medium">{(item.fulfillable_qty || 0).toLocaleString()}</td>
                            <td className="p-3 text-right text-blue-600">{(item.inbound_quantity || 0).toLocaleString()}</td>
                            <td className="p-3 text-right">{Number(item.avg_daily_sales || 0).toFixed(1)}</td>
                            <td className="p-3 text-right font-bold">{item.days_of_supply || 0}</td>
                            <td className="p-3 text-center">
                              <Badge variant={alertStyle.badge} className={`text-[10px] ${alertStyle.text}`}>{alertStyle.label}</Badge>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══════ Tab 2: 物流流水线 ═══════ */}
        <TabsContent value="pipeline" className="space-y-6 mt-4">
          <InventoryPipelineView pipeline={pipeline} onNavigate={navigate} />
        </TabsContent>

        {/* ═══════ Tab 3: AI补货预测 ═══════ */}
        <TabsContent value="predictions" className="space-y-6 mt-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">AI补货预测引擎</h2>
              <p className="text-sm text-gray-500">基于历史物流数据和销量趋势的智能补货时间预测</p>
            </div>
            <Button onClick={() => runPredictions.mutate()} disabled={runPredictions.isPending}>
              {runPredictions.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Brain className="w-4 h-4 mr-1" />}
              运行AI预测
            </Button>
          </div>

          {/* Prediction Alert Summary */}
          {predictions.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {(["urgent", "warning", "advance", "sufficient"] as const).map(level => {
                const count = predictions.filter((p: any) => p.alertLevel === level).length;
                const style = PREDICTION_COLORS[level];
                return (
                  <Card key={level} className={`${style.bg} border-transparent`}>
                    <CardContent className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{style.icon}</span>
                        <div>
                          <p className="text-2xl font-bold">{count}</p>
                          <p className="text-xs text-gray-500">{style.label}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Prediction List */}
          {predictions.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-gray-400">
                <Brain className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p>尚未运行AI预测</p>
                <p className="text-xs mt-1">点击"运行AI预测"按钮开始分析</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {predictions.map((pred: any, idx: number) => {
                const style = PREDICTION_COLORS[pred.alertLevel as keyof typeof PREDICTION_COLORS] || PREDICTION_COLORS.sufficient;
                return (
                  <Card key={idx} className={`border-l-4 ${style.border} hover:shadow-md transition-shadow cursor-pointer`}
                    onClick={() => setShowPredictionDetail(pred)}>
                    <CardContent className="py-3 px-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <span className="text-lg">{style.icon}</span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm font-bold">{pred.sku}</span>
                              <Badge variant={pred.alertLevel === "urgent" ? "destructive" : "outline"} className="text-[10px]">{style.label}</Badge>
                              {pred.userConfirmed === 1 && <Badge variant="outline" className="text-[10px] text-green-600 border-green-300">已确认</Badge>}
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {pred.storeName} · 可售 {pred.currentAvailableInventory} · 日均 {pred.dailySalesAvg} · 剩余 {pred.daysOfStockRemaining}天
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-6 text-right">
                          <div>
                            <p className="text-lg font-bold text-blue-600">{pred.recommendedQuantity?.toLocaleString()}</p>
                            <p className="text-[10px] text-gray-400">建议补货量</p>
                          </div>
                          <div>
                            <p className="text-sm font-medium">{pred.recommendedShippingMethod}</p>
                            <p className="text-[10px] text-gray-400">运输方式</p>
                          </div>
                          <div>
                            <p className="text-sm font-medium">{pred.fullCycleDays}天</p>
                            <p className="text-[10px] text-gray-400">全链路周期</p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-gray-300" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* AI Replenishment Dialog (legacy) */}
      <Dialog open={showAiDialog} onOpenChange={setShowAiDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-blue-500" />
              AI智能补货建议
            </DialogTitle>
          </DialogHeader>
          {aiReplenish.isPending ? (
            <div className="flex flex-col items-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-3" />
              <p className="text-sm text-gray-500">AI正在分析库存数据，生成补货建议...</p>
            </div>
          ) : aiReplenish.data ? (
            <div className="space-y-4">
              {(aiReplenish.data as any).suggestions?.map((s: any, i: number) => (
                <Card key={i} className={`border-l-4 ${
                  s.urgency === "urgent" ? "border-l-red-500" :
                  s.urgency === "soon" ? "border-l-amber-500" :
                  s.urgency === "plan" ? "border-l-blue-500" : "border-l-green-500"
                }`}>
                  <CardContent className="pt-4 pb-3 px-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-sm font-bold">{s.seller_sku}</span>
                          <Badge variant={s.urgency === "urgent" ? "destructive" : "outline"} className="text-[10px]">
                            {s.urgency === "urgent" ? "紧急" : s.urgency === "soon" ? "即将" : s.urgency === "plan" ? "计划" : "充足"}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-600">{s.reason}</p>
                        {s.notes && <p className="text-xs text-gray-400 mt-1">{s.notes}</p>}
                      </div>
                      <div className="text-right shrink-0 ml-4">
                        <p className="text-lg font-bold text-blue-600">{s.suggested_qty}</p>
                        <p className="text-[10px] text-gray-400">建议补货量</p>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-gray-400">预计断货: {s.estimated_stockout_date}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Prediction Detail Dialog */}
      <Dialog open={!!showPredictionDetail} onOpenChange={() => setShowPredictionDetail(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          {showPredictionDetail && (
            <PredictionDetailView
              prediction={showPredictionDetail}
              onConfirm={(sku: string) => confirmPrediction.mutate({ sku, confirmed: true })}
              onNavigate={navigate}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════ Inventory Pipeline View ═══════

function InventoryPipelineView({ pipeline, onNavigate }: { pipeline: any; onNavigate: (path: string) => void }) {
  if (!pipeline) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-gray-400">
          <Boxes className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>暂无活跃物流批次</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => onNavigate("/ops/shipping")}>
            前往创建批次
          </Button>
        </CardContent>
      </Card>
    );
  }

  const steps = [
    { name: "准备中", icon: Clock, qty: pipeline.planned, color: "bg-gray-100 text-gray-600", count: pipeline.stepDistribution?.[1] || 0 },
    { name: "采购中", icon: Package, qty: pipeline.purchasing, color: "bg-blue-100 text-blue-600", count: pipeline.stepDistribution?.[2] || 0 },
    { name: "国内运输", icon: Truck, qty: pipeline.domesticTransit, color: "bg-indigo-100 text-indigo-600", count: (pipeline.stepDistribution?.[3] || 0) + (pipeline.stepDistribution?.[4] || 0) + (pipeline.stepDistribution?.[5] || 0) },
    { name: "已到仓", icon: Warehouse, qty: pipeline.warehouse, color: "bg-purple-100 text-purple-600", count: pipeline.stepDistribution?.[6] || 0 },
    { name: "国际运输", icon: Ship, qty: pipeline.internationalTransit, color: "bg-orange-100 text-orange-600", count: pipeline.stepDistribution?.[7] || 0 },
    { name: "接收中", icon: Plane, qty: pipeline.receiving, color: "bg-amber-100 text-amber-600", count: pipeline.stepDistribution?.[8] || 0 },
    { name: "亚马逊仓", icon: Boxes, qty: pipeline.amazonStocked, color: "bg-green-100 text-green-600", count: pipeline.stepDistribution?.[9] || 0 },
  ];

  return (
    <div className="space-y-6">
      {/* Pipeline Flow */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Ship className="w-4 h-4" />
            全链路库存流水线
          </CardTitle>
          <CardDescription>
            活跃批次: {pipeline.batchCount} · 在途总量: {pipeline.totalInTransit.toLocaleString()} · 全链路总量: {pipeline.totalAll.toLocaleString()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-1 overflow-x-auto py-4">
            {steps.map((step, idx) => (
              <div key={idx} className="flex items-center">
                <div className={`flex flex-col items-center min-w-[100px] p-3 rounded-lg ${step.color} transition-all hover:scale-105`}>
                  <step.icon className="w-5 h-5 mb-1" />
                  <span className="text-xs font-medium">{step.name}</span>
                  <span className="text-lg font-bold mt-1">{step.qty.toLocaleString()}</span>
                  <span className="text-[10px] opacity-70">{step.count}个批次</span>
                </div>
                {idx < steps.length - 1 && (
                  <ArrowRight className="w-4 h-4 text-gray-300 mx-1 shrink-0" />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-blue-50 border-transparent">
          <CardContent className="py-3 px-4">
            <p className="text-xs text-blue-600">国内在途</p>
            <p className="text-2xl font-bold text-blue-700">{pipeline.domesticTransit.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="bg-orange-50 border-transparent">
          <CardContent className="py-3 px-4">
            <p className="text-xs text-orange-600">国际在途</p>
            <p className="text-2xl font-bold text-orange-700">{pipeline.internationalTransit.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 border-transparent">
          <CardContent className="py-3 px-4">
            <p className="text-xs text-amber-600">接收中</p>
            <p className="text-2xl font-bold text-amber-700">{pipeline.receiving.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="bg-green-50 border-transparent">
          <CardContent className="py-3 px-4">
            <p className="text-xs text-green-600">已到亚马逊仓</p>
            <p className="text-2xl font-bold text-green-700">{pipeline.amazonStocked.toLocaleString()}</p>
          </CardContent>
        </Card>
      </div>

      <div className="text-center">
        <Button variant="outline" onClick={() => onNavigate("/ops/shipping")}>
          <ExternalLink className="w-4 h-4 mr-1" />
          查看所有物流批次详情
        </Button>
      </div>
    </div>
  );
}

// ═══════ Prediction Detail View ═══════

function PredictionDetailView({ prediction, onConfirm, onNavigate }: {
  prediction: any;
  onConfirm: (sku: string) => void;
  onNavigate: (path: string) => void;
}) {
  const style = PREDICTION_COLORS[prediction.alertLevel as keyof typeof PREDICTION_COLORS] || PREDICTION_COLORS.sufficient;
  const riskFactors = Array.isArray(prediction.riskFactors) ? prediction.riskFactors : [];
  const alternativePlans = Array.isArray(prediction.alternativePlans) ? prediction.alternativePlans : [];
  const aiSuggestion = prediction.aiSuggestion;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-blue-500" />
          AI补货预测详情 - {prediction.sku}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        {/* Alert Banner */}
        <div className={`p-3 rounded-lg ${style.bg} flex items-center justify-between`}>
          <div className="flex items-center gap-2">
            <span className="text-xl">{style.icon}</span>
            <span className={`font-medium ${style.text}`}>{style.label}</span>
            <span className="text-sm text-gray-500">· {prediction.storeName}</span>
          </div>
          <Badge variant={prediction.alertLevel === "urgent" ? "destructive" : "outline"}>
            置信度: {((prediction.confidence || 0.75) * 100).toFixed(0)}%
          </Badge>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500">当前可售</p>
            <p className="text-xl font-bold">{prediction.currentAvailableInventory?.toLocaleString()}</p>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500">日均销量</p>
            <p className="text-xl font-bold">{prediction.dailySalesAvg}</p>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500">剩余天数</p>
            <p className="text-xl font-bold">{prediction.daysOfStockRemaining}</p>
          </div>
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500">全链路周期</p>
            <p className="text-xl font-bold">{prediction.fullCycleDays}天</p>
          </div>
        </div>

        {/* Recommendation */}
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="py-3 px-4">
            <h4 className="font-medium text-blue-700 mb-2">AI建议</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-gray-500">建议补货量:</span>
                <span className="ml-2 font-bold text-blue-700">{prediction.recommendedQuantity?.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-gray-500">运输方式:</span>
                <span className="ml-2 font-medium">{prediction.recommendedShippingMethod}</span>
              </div>
              <div>
                <span className="text-gray-500">建议下单日:</span>
                <span className="ml-2 font-medium">{prediction.recommendedOrderDate ? new Date(prediction.recommendedOrderDate).toLocaleDateString() : "-"}</span>
              </div>
              <div>
                <span className="text-gray-500">预计到货日:</span>
                <span className="ml-2 font-medium">{prediction.estimatedArrivalDate ? new Date(prediction.estimatedArrivalDate).toLocaleDateString() : "-"}</span>
              </div>
            </div>
            {aiSuggestion?.reasoning && (
              <p className="text-xs text-gray-500 mt-2 border-t pt-2">{aiSuggestion.reasoning}</p>
            )}
          </CardContent>
        </Card>

        {/* Risk Factors */}
        {riskFactors.length > 0 && (
          <Card>
            <CardContent className="py-3 px-4">
              <h4 className="font-medium text-gray-700 mb-2 flex items-center gap-1">
                <ShieldAlert className="w-4 h-4 text-amber-500" />
                风险因素
              </h4>
              <ul className="space-y-1">
                {riskFactors.map((risk: string, i: number) => (
                  <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                    <AlertCircle className="w-3 h-3 text-amber-400 mt-1 shrink-0" />
                    {risk}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Alternative Plans */}
        {alternativePlans.length > 0 && (
          <Card>
            <CardContent className="py-3 px-4">
              <h4 className="font-medium text-gray-700 mb-2">备选方案</h4>
              <div className="space-y-2">
                {alternativePlans.map((plan: any, i: number) => (
                  <div key={i} className="p-2 bg-gray-50 rounded text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{plan.method}</span>
                      <span className="text-blue-600 font-bold">{plan.quantity?.toLocaleString()}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      到货: {plan.arrival_date} · {plan.cost_comparison}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2">
          <Button onClick={() => onConfirm(prediction.sku)} disabled={prediction.userConfirmed === 1}>
            {prediction.userConfirmed === 1 ? <CheckCircle2 className="w-4 h-4 mr-1" /> : <Sparkles className="w-4 h-4 mr-1" />}
            {prediction.userConfirmed === 1 ? "已确认" : "确认补货建议"}
          </Button>
          <Button variant="outline" onClick={() => onNavigate("/ops/shipping")}>
            <Truck className="w-4 h-4 mr-1" />
            创建物流批次
          </Button>
        </div>
      </div>
    </>
  );
}

// ═══════ Stat Card ═══════

function StatCard({ label, value, icon: Icon, color, onClick }: {
  label: string; value: number; icon: any; color: string; onClick?: () => void;
}) {
  const colorMap: Record<string, { bg: string; text: string; iconBg: string }> = {
    gray: { bg: "bg-gray-50", text: "text-gray-700", iconBg: "bg-gray-100" },
    red: { bg: "bg-red-50", text: "text-red-700", iconBg: "bg-red-100" },
    amber: { bg: "bg-amber-50", text: "text-amber-700", iconBg: "bg-amber-100" },
    blue: { bg: "bg-blue-50", text: "text-blue-700", iconBg: "bg-blue-100" },
    purple: { bg: "bg-purple-50", text: "text-purple-700", iconBg: "bg-purple-100" },
  };
  const c = colorMap[color] || colorMap.gray;

  return (
    <Card className={`cursor-pointer hover:shadow-md transition-shadow ${c.bg} border-transparent`} onClick={onClick}>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${c.iconBg}`}>
            <Icon className={`w-4 h-4 ${c.text}`} />
          </div>
          <div>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-xs text-gray-500">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
