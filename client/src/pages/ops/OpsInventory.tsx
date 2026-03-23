import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from "recharts";
import {
  Package, AlertTriangle, ArrowUpDown, Sparkles, RefreshCw, Filter,
  TrendingDown, TrendingUp, AlertCircle, CheckCircle2, Loader2,
} from "lucide-react";

const ALERT_COLORS = {
  critical: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200", badge: "destructive" as const, label: "紧急", fill: "#ef4444" },
  low: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", badge: "outline" as const, label: "偏低", fill: "#f59e0b" },
  normal: { bg: "bg-green-50", text: "text-green-700", border: "border-green-200", badge: "outline" as const, label: "正常", fill: "#10b981" },
  overstock: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", badge: "outline" as const, label: "滞销", fill: "#3b82f6" },
};

type AlertFilter = "all" | "critical" | "low" | "normal" | "overstock";
type SortBy = "days_of_supply" | "fulfillable_qty" | "avg_daily_sales";

export default function OpsInventory() {
  
  const [alertFilter, setAlertFilter] = useState<AlertFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("days_of_supply");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [showAiDialog, setShowAiDialog] = useState(false);

  const { data, isLoading, refetch } = trpc.operations.getInventoryList.useQuery({
    alertFilter,
    sortBy,
    sortOrder,
  });

  const aiReplenish = trpc.operations.aiReplenishmentPlan.useMutation({
    onSuccess: () => {
      toast.success("AI补货建议已生成", { description: "请查看下方建议单" });
    },
    onError: (err) => {
      toast.error("生成失败", { description: err.message });
    },
  });

  const items = data?.items || [];
  const stats = data?.stats;

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
          <h1 className="text-2xl font-bold text-gray-900">库存预警</h1>
          <p className="text-sm text-gray-500 mt-1">FBA库存监控与智能补货建议</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" />
            刷新
          </Button>
          <Button size="sm" onClick={handleAiReplenish} disabled={aiReplenish.isPending}>
            {aiReplenish.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
            AI补货建议
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="总SKU" value={stats?.total || 0} icon={Package} color="gray" />
        <StatCard label="紧急补货" value={stats?.critical || 0} icon={AlertTriangle} color="red" onClick={() => setAlertFilter("critical")} />
        <StatCard label="库存偏低" value={stats?.low || 0} icon={TrendingDown} color="amber" onClick={() => setAlertFilter("low")} />
        <StatCard label="滞销积压" value={stats?.overstock || 0} icon={TrendingUp} color="blue" onClick={() => setAlertFilter("overstock")} />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Low Stock Bar Chart */}
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

        {/* Distribution Pie */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">库存健康分布</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {pieData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.fill} />
                    ))}
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
            <SelectTrigger className="w-32 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
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
            <SelectTrigger className="w-36 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="days_of_supply">可供天数</SelectItem>
              <SelectItem value="fulfillable_qty">可售数量</SelectItem>
              <SelectItem value="avg_daily_sales">日均销量</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={() => setSortOrder(prev => prev === "asc" ? "desc" : "asc")}
          >
            {sortOrder === "asc" ? "↑升序" : "↓降序"}
          </Button>
        </div>
        <div className="ml-auto text-sm text-gray-500">
          共 {items.length} 个SKU
        </div>
      </div>

      {/* Inventory Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/50">
                  <th className="text-left p-3 font-medium text-gray-600">SKU</th>
                  <th className="text-left p-3 font-medium text-gray-600">产品名称</th>
                  <th className="text-right p-3 font-medium text-gray-600">可售数量</th>
                  <th className="text-right p-3 font-medium text-gray-600">日均销量</th>
                  <th className="text-right p-3 font-medium text-gray-600">可供天数</th>
                  <th className="text-center p-3 font-medium text-gray-600">状态</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-gray-400">暂无库存数据</td>
                  </tr>
                ) : (
                  items.map((item: any, idx: number) => {
                    const alertStyle = ALERT_COLORS[item.alertLevel as keyof typeof ALERT_COLORS] || ALERT_COLORS.normal;
                    return (
                      <tr key={idx} className={`border-b hover:bg-gray-50/50 ${alertStyle.bg}`}>
                        <td className="p-3 font-mono text-xs">{item.seller_sku}</td>
                        <td className="p-3 max-w-[200px] truncate">{item.product_name || "-"}</td>
                        <td className="p-3 text-right font-medium">{(item.fulfillable_qty || 0).toLocaleString()}</td>
                        <td className="p-3 text-right">{(item.avg_daily_sales || 0).toFixed(1)}</td>
                        <td className="p-3 text-right font-bold">{item.days_of_supply || 0}</td>
                        <td className="p-3 text-center">
                          <Badge variant={alertStyle.badge} className={`text-[10px] ${alertStyle.text}`}>
                            {alertStyle.label}
                          </Badge>
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

      {/* AI Replenishment Dialog */}
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
                    <div className="mt-2 text-xs text-gray-400">
                      预计断货: {s.estimated_stockout_date}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color, onClick }: {
  label: string; value: number; icon: any; color: string; onClick?: () => void;
}) {
  const colorMap: Record<string, { bg: string; text: string; iconBg: string }> = {
    gray: { bg: "bg-gray-50", text: "text-gray-700", iconBg: "bg-gray-100" },
    red: { bg: "bg-red-50", text: "text-red-700", iconBg: "bg-red-100" },
    amber: { bg: "bg-amber-50", text: "text-amber-700", iconBg: "bg-amber-100" },
    blue: { bg: "bg-blue-50", text: "text-blue-700", iconBg: "bg-blue-100" },
  };
  const c = colorMap[color] || colorMap.gray;

  return (
    <Card
      className={`cursor-pointer hover:shadow-md transition-shadow ${c.bg} border-transparent`}
      onClick={onClick}
    >
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
