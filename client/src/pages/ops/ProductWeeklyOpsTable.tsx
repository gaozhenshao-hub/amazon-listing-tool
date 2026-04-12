import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  TrendingUp, TrendingDown, Minus, RefreshCw, Plus, Download,
  Loader2, Edit2, Save, X, ChevronDown, ChevronUp, BarChart3,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, ComposedChart, Area,
} from "recharts";

interface Props {
  productId: number;
  parentAsin: string;
}

// Format number with $ prefix and handle negatives with red parentheses
function formatMoney(val: string | number | null | undefined, prefix = "$"): { text: string; isNeg: boolean } {
  if (val == null || val === "") return { text: "-", isNeg: false };
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return { text: "-", isNeg: false };
  const isNeg = num < 0;
  const abs = Math.abs(num).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return {
    text: isNeg ? `(${prefix}${abs})` : `${prefix}${abs}`,
    isNeg,
  };
}

function formatPct(val: string | number | null | undefined): string {
  if (val == null || val === "") return "-";
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return "-";
  return `${num.toFixed(2)}%`;
}

function formatInt(val: number | null | undefined): string {
  if (val == null) return "-";
  return val.toLocaleString();
}

const trendIcon = (trend: string | null) => {
  if (trend === "up") return <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />;
  if (trend === "down") return <TrendingDown className="h-3.5 w-3.5 text-red-500" />;
  return <Minus className="h-3.5 w-3.5 text-gray-400" />;
};

const trendLabel = (trend: string | null) => {
  if (trend === "up") return "上升";
  if (trend === "down") return "下降";
  return "平稳";
};

export default function ProductWeeklyOpsTable({ productId, parentAsin }: Props) {
  const [showAddRow, setShowAddRow] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editData, setEditData] = useState<Record<string, string>>({});
  const [showChart, setShowChart] = useState(false);
  const [chartMetric, setChartMetric] = useState<"sales" | "profit" | "acos" | "ads">("sales");

  // Queries
  const { data: weeklyData, isLoading: loadingWeekly, refetch: refetchWeekly } = trpc.productOps.getWeeklyOpsData.useQuery(
    { productId, limit: 100 }, { enabled: !!productId }
  );
  const { data: monthlyData, isLoading: loadingMonthly, refetch: refetchMonthly } = trpc.productOps.getMonthlySummaries.useQuery(
    { productId, limit: 24 }, { enabled: !!productId }
  );
  const { data: basicInfo, refetch: refetchBasicInfo } = trpc.productOps.getProductBasicInfo.useQuery(
    { productId }, { enabled: !!productId }
  );

  // Mutations
  const syncFromLingxing = trpc.productOps.syncWeeklyOpsFromLingxing.useMutation({
    onSuccess: (data) => {
      toast.success(`同步完成：${data.syncedWeeks} 周 + ${data.syncedMonths} 月数据`);
      refetchWeekly();
      refetchMonthly();
    },
    onError: (err) => toast.error(`同步失败: ${err.message}`),
  });

  const upsertWeekly = trpc.productOps.upsertWeeklyOps.useMutation({
    onSuccess: () => {
      toast.success("已保存");
      refetchWeekly();
      setEditingId(null);
      setShowAddRow(false);
    },
    onError: (err) => toast.error(`保存失败: ${err.message}`),
  });

  const deleteWeekly = trpc.productOps.deleteWeeklyOps.useMutation({
    onSuccess: () => { toast.success("已删除"); refetchWeekly(); },
    onError: (err) => toast.error(`删除失败: ${err.message}`),
  });

  const upsertBasicInfo = trpc.productOps.upsertProductBasicInfo.useMutation({
    onSuccess: () => { toast.success("产品信息已保存"); refetchBasicInfo(); },
    onError: (err) => toast.error(`保存失败: ${err.message}`),
  });

  // Group weekly data by month and insert monthly summary rows
  const tableRows = useMemo(() => {
    if (!weeklyData || weeklyData.length === 0) return [];
    // Sort by date ascending for display
    const sorted = [...weeklyData].sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate));
    const monthlyMap = new Map((monthlyData || []).map(m => [m.yearMonth, m]));

    const rows: Array<{ type: "week" | "month"; data: any; yearMonth?: string }> = [];
    let currentMonth = "";

    for (const week of sorted) {
      const ym = week.weekStartDate.substring(0, 7);
      if (ym !== currentMonth && currentMonth !== "") {
        // Insert monthly summary for previous month
        const ms = monthlyMap.get(currentMonth);
        if (ms) {
          rows.push({ type: "month", data: ms, yearMonth: currentMonth });
        }
      }
      currentMonth = ym;
      rows.push({ type: "week", data: week });
    }
    // Last month summary
    if (currentMonth) {
      const ms = monthlyMap.get(currentMonth);
      if (ms) {
        rows.push({ type: "month", data: ms, yearMonth: currentMonth });
      }
    }
    return rows;
  }, [weeklyData, monthlyData]);

  // Chart data
  const chartData = useMemo(() => {
    if (!weeklyData) return [];
    return [...weeklyData]
      .sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate))
      .map(w => ({
        date: w.weekStartDate.substring(5), // MM-DD
        salesQty: w.salesQty || 0,
        orderQty: w.orderQty || 0,
        salesAmount: parseFloat(String(w.salesAmount || "0")),
        orderProfit: parseFloat(String(w.orderProfit || "0")),
        profitMargin: parseFloat(String(w.orderProfitMargin || "0")),
        adSpend: parseFloat(String(w.adSpend || "0")),
        acos: parseFloat(String(w.acos || "0")),
        cpc: parseFloat(String(w.cpc || "0")),
        sessionTotal: w.sessionTotal || 0,
        totalCvr: parseFloat(String(w.totalCvr || "0")),
      }));
  }, [weeklyData]);

  // Edit handlers
  const startEdit = (row: any) => {
    setEditingId(row.id);
    setEditData({
      weekStartDate: row.weekStartDate,
      weekEndDate: row.weekEndDate,
      salesTrend: row.salesTrend || "stable",
      salesQty: String(row.salesQty || 0),
      orderQty: String(row.orderQty || 0),
      salesAmount: String(row.salesAmount || "0"),
      orderProfit: String(row.orderProfit || "0"),
      orderProfitMargin: String(row.orderProfitMargin || "0"),
      sessionTotal: String(row.sessionTotal || 0),
      totalCvr: String(row.totalCvr || "0"),
      adCvr: String(row.adCvr || "0"),
      organicCvr: String(row.organicCvr || "0"),
      adOrders: String(row.adOrders || 0),
      organicOrders: String(row.organicOrders || 0),
      adClicks: String(row.adClicks || 0),
      organicClicks: String(row.organicClicks || 0),
      ctr: String(row.ctr || "0"),
      adImpressions: String(row.adImpressions || 0),
      cpc: String(row.cpc || "0"),
      adSpend: String(row.adSpend || "0"),
      acos: String(row.acos || "0"),
      rating: String(row.rating || "0"),
      reviewCount: String(row.reviewCount || 0),
      returnRate: String(row.returnRate || "0"),
    });
  };

  const saveEdit = () => {
    upsertWeekly.mutate({
      productId,
      weekStartDate: editData.weekStartDate,
      weekEndDate: editData.weekEndDate,
      salesTrend: editData.salesTrend as "up" | "down" | "stable",
      salesQty: parseInt(editData.salesQty) || 0,
      orderQty: parseInt(editData.orderQty) || 0,
      salesAmount: editData.salesAmount,
      orderProfit: editData.orderProfit,
      orderProfitMargin: editData.orderProfitMargin,
      sessionTotal: parseInt(editData.sessionTotal) || 0,
      totalCvr: editData.totalCvr,
      adCvr: editData.adCvr,
      organicCvr: editData.organicCvr,
      adOrders: parseInt(editData.adOrders) || 0,
      organicOrders: parseInt(editData.organicOrders) || 0,
      adClicks: parseInt(editData.adClicks) || 0,
      organicClicks: parseInt(editData.organicClicks) || 0,
      ctr: editData.ctr,
      adImpressions: parseInt(editData.adImpressions) || 0,
      cpc: editData.cpc,
      adSpend: editData.adSpend,
      acos: editData.acos,
      rating: editData.rating,
      reviewCount: parseInt(editData.reviewCount) || 0,
      returnRate: editData.returnRate,
    });
  };

  // New row form
  const [newRow, setNewRow] = useState({
    weekStartDate: "", weekEndDate: "", salesTrend: "stable",
    salesQty: "0", orderQty: "0", salesAmount: "0", orderProfit: "0", orderProfitMargin: "0",
    sessionTotal: "0", totalCvr: "0", adCvr: "0", organicCvr: "0",
    adOrders: "0", organicOrders: "0", adClicks: "0", organicClicks: "0",
    ctr: "0", adImpressions: "0", cpc: "0", adSpend: "0", acos: "0",
    rating: "0", reviewCount: "0", returnRate: "0",
  });

  // Basic info edit state
  const [editingBasicInfo, setEditingBasicInfo] = useState(false);
  const [basicInfoForm, setBasicInfoForm] = useState<Record<string, string>>({});

  const startEditBasicInfo = () => {
    setEditingBasicInfo(true);
    setBasicInfoForm({
      sellingPrice: String(basicInfo?.sellingPrice || ""),
      breakEvenPrice: String(basicInfo?.breakEvenPrice || ""),
      grossProfit: String(basicInfo?.grossProfit || ""),
      grossMargin: String(basicInfo?.grossMargin || ""),
      returnRate: String(basicInfo?.returnRate || "0"),
      rating: String(basicInfo?.rating || ""),
      reviewCount: String(basicInfo?.reviewCount || 0),
      productCost: String(basicInfo?.productCost || ""),
      shippingCost: String(basicInfo?.shippingCost || ""),
      fbaFee: String(basicInfo?.fbaFee || ""),
      referralFee: String(basicInfo?.referralFee || ""),
      currentStock: String(basicInfo?.currentStock || 0),
      inTransitStock: String(basicInfo?.inTransitStock || 0),
      listingDate: String(basicInfo?.listingDate || ""),
      asin: String(basicInfo?.asin || ""),
      notes: String(basicInfo?.notes || ""),
    });
  };

  const saveBasicInfo = () => {
    upsertBasicInfo.mutate({
      productId,
      sellingPrice: basicInfoForm.sellingPrice || undefined,
      breakEvenPrice: basicInfoForm.breakEvenPrice || undefined,
      grossProfit: basicInfoForm.grossProfit || undefined,
      grossMargin: basicInfoForm.grossMargin || undefined,
      returnRate: basicInfoForm.returnRate || undefined,
      rating: basicInfoForm.rating || undefined,
      reviewCount: basicInfoForm.reviewCount ? parseInt(basicInfoForm.reviewCount) : undefined,
      productCost: basicInfoForm.productCost || undefined,
      shippingCost: basicInfoForm.shippingCost || undefined,
      fbaFee: basicInfoForm.fbaFee || undefined,
      referralFee: basicInfoForm.referralFee || undefined,
      currentStock: basicInfoForm.currentStock ? parseInt(basicInfoForm.currentStock) : undefined,
      inTransitStock: basicInfoForm.inTransitStock ? parseInt(basicInfoForm.inTransitStock) : undefined,
      listingDate: basicInfoForm.listingDate || undefined,
      asin: basicInfoForm.asin || undefined,
      notes: basicInfoForm.notes || undefined,
    });
    setEditingBasicInfo(false);
  };

  // Column headers matching the Excel template
  const columns = [
    { key: "date", label: "时间", width: "w-20" },
    { key: "trend", label: "趋势", width: "w-14" },
    { key: "salesQty", label: "销量", width: "w-12" },
    { key: "orderQty", label: "订单", width: "w-12" },
    { key: "salesAmount", label: "销售额", width: "w-20" },
    { key: "orderProfit", label: "订单利润", width: "w-20" },
    { key: "profitMargin", label: "毛利率", width: "w-14" },
    { key: "session", label: "Session", width: "w-16" },
    { key: "totalCvr", label: "总CVR", width: "w-14" },
    { key: "adCvr", label: "广告CVR", width: "w-14" },
    { key: "organicCvr", label: "自然CVR", width: "w-14" },
    { key: "adOrders", label: "广告单", width: "w-14" },
    { key: "organicOrders", label: "自然单", width: "w-14" },
    { key: "adClicks", label: "广告击", width: "w-14" },
    { key: "organicClicks", label: "自然击", width: "w-14" },
    { key: "ctr", label: "CTR", width: "w-14" },
    { key: "adImpressions", label: "曝光", width: "w-16" },
    { key: "cpc", label: "CPC", width: "w-14" },
    { key: "adSpend", label: "广告费", width: "w-18" },
    { key: "acos", label: "ACOS", width: "w-14" },
    { key: "rating", label: "评分", width: "w-12" },
    { key: "reviewCount", label: "评论", width: "w-12" },
    { key: "returnRate", label: "退货%", width: "w-14" },
  ];

  return (
    <div className="space-y-4">
      {/* ─── Product Basic Info Card ─── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">产品利润情况</CardTitle>
            <div className="flex items-center gap-2">
              {editingBasicInfo ? (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setEditingBasicInfo(false)}>
                    <X className="h-3.5 w-3.5 mr-1" /> 取消
                  </Button>
                  <Button size="sm" onClick={saveBasicInfo} disabled={upsertBasicInfo.isPending}>
                    <Save className="h-3.5 w-3.5 mr-1" /> 保存
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={startEditBasicInfo}>
                  <Edit2 className="h-3.5 w-3.5 mr-1" /> 编辑
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {editingBasicInfo ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {[
                { key: "sellingPrice", label: "售价", prefix: "$" },
                { key: "breakEvenPrice", label: "平手价", prefix: "$" },
                { key: "grossProfit", label: "毛利润", prefix: "$" },
                { key: "grossMargin", label: "毛利率", suffix: "%" },
                { key: "returnRate", label: "退货率", suffix: "%" },
                { key: "rating", label: "评分" },
                { key: "reviewCount", label: "评论数" },
                { key: "productCost", label: "采购成本", prefix: "$" },
                { key: "shippingCost", label: "运费", prefix: "$" },
                { key: "fbaFee", label: "FBA费", prefix: "$" },
                { key: "referralFee", label: "佣金", prefix: "$" },
                { key: "currentStock", label: "当前库存" },
                { key: "inTransitStock", label: "在途库存" },
                { key: "listingDate", label: "上架日期" },
                { key: "asin", label: "ASIN" },
              ].map(f => (
                <div key={f.key}>
                  <Label className="text-xs text-muted-foreground">{f.label}</Label>
                  <Input
                    className="h-8 text-sm"
                    value={basicInfoForm[f.key] || ""}
                    onChange={e => setBasicInfoForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.label}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-4">
              {[
                { label: "售价", value: basicInfo?.sellingPrice ? `$${basicInfo.sellingPrice}` : "-", color: "" },
                { label: "平手价", value: basicInfo?.breakEvenPrice ? `$${basicInfo.breakEvenPrice}` : "-", color: "" },
                { label: "毛利润", value: basicInfo?.grossProfit ? `$${basicInfo.grossProfit}` : "-", color: "text-emerald-600 font-bold" },
                { label: "毛利率", value: basicInfo?.grossMargin ? `${basicInfo.grossMargin}%` : "-", color: "font-semibold" },
                { label: "退货率", value: basicInfo?.returnRate ? `${basicInfo.returnRate}%` : "0%", color: "" },
                { label: "评分", value: basicInfo?.rating ? `${basicInfo.rating}/${basicInfo?.reviewCount || 0}` : "-", color: "" },
              ].map((item, idx) => (
                <div key={idx} className="text-center">
                  <p className="text-xs text-muted-foreground mb-0.5">{item.label}</p>
                  <p className={`text-sm font-mono ${item.color}`}>{item.value}</p>
                </div>
              ))}
            </div>
          )}
          {/* Additional info row */}
          {!editingBasicInfo && basicInfo && (
            <div className="mt-3 pt-3 border-t grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs text-muted-foreground">
              {basicInfo.productCost && <span>采购: ${String(basicInfo.productCost)}</span>}
              {basicInfo.shippingCost && <span>运费: ${String(basicInfo.shippingCost)}</span>}
              {basicInfo.fbaFee && <span>FBA: ${String(basicInfo.fbaFee)}</span>}
              {basicInfo.referralFee && <span>佣金: ${String(basicInfo.referralFee)}</span>}
              {basicInfo.currentStock != null && <span>库存: {basicInfo.currentStock} (在途: {basicInfo.inTransitStock || 0})</span>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Weekly Ops Data Table ─── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-blue-600" />
              <CardTitle className="text-base">周度运营数据</CardTitle>
              <Badge variant="secondary" className="text-xs">{weeklyData?.length || 0} 周</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm" variant="outline"
                onClick={() => setShowChart(!showChart)}
              >
                <BarChart3 className="h-3.5 w-3.5 mr-1" />
                {showChart ? "隐藏图表" : "显示图表"}
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={() => syncFromLingxing.mutate({ productId, months: 6 })}
                disabled={syncFromLingxing.isPending}
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${syncFromLingxing.isPending ? "animate-spin" : ""}`} />
                从领星同步
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowAddRow(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> 手动添加
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Chart Section */}
          {showChart && chartData.length > 0 && (
            <div className="mb-4 border rounded-lg p-3 bg-muted/20">
              <div className="flex items-center gap-2 mb-3">
                {(["sales", "profit", "acos", "ads"] as const).map(m => (
                  <Button
                    key={m}
                    size="sm"
                    variant={chartMetric === m ? "default" : "outline"}
                    className="h-7 text-xs"
                    onClick={() => setChartMetric(m)}
                  >
                    {m === "sales" ? "销量趋势" : m === "profit" ? "利润趋势" : m === "acos" ? "ACOS趋势" : "广告数据"}
                  </Button>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={220}>
                {chartMetric === "sales" ? (
                  <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="left" dataKey="salesQty" name="销量" fill="#3b82f6" opacity={0.7} />
                    <Line yAxisId="right" type="monotone" dataKey="totalCvr" name="CVR%" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  </ComposedChart>
                ) : chartMetric === "profit" ? (
                  <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="left" dataKey="salesAmount" name="销售额" fill="#6366f1" opacity={0.5} />
                    <Line yAxisId="left" type="monotone" dataKey="orderProfit" name="利润" stroke="#10b981" strokeWidth={2} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="profitMargin" name="利润率%" stroke="#f97316" strokeWidth={1.5} dot={false} />
                  </ComposedChart>
                ) : chartMetric === "acos" ? (
                  <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="acos" name="ACOS%" stroke="#ef4444" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="totalCvr" name="CVR%" stroke="#3b82f6" strokeWidth={2} dot={false} />
                  </LineChart>
                ) : (
                  <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="left" dataKey="adSpend" name="广告费" fill="#ef4444" opacity={0.6} />
                    <Line yAxisId="right" type="monotone" dataKey="cpc" name="CPC" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                  </ComposedChart>
                )}
              </ResponsiveContainer>
            </div>
          )}

          {/* Data Table */}
          {loadingWeekly ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : !weeklyData || weeklyData.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground mb-3">暂无周度运营数据</p>
              <div className="flex items-center justify-center gap-2">
                <Button size="sm" onClick={() => syncFromLingxing.mutate({ productId, months: 6 })} disabled={syncFromLingxing.isPending}>
                  <RefreshCw className={`h-3.5 w-3.5 mr-1 ${syncFromLingxing.isPending ? "animate-spin" : ""}`} />
                  从领星ERP同步数据
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowAddRow(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> 手动录入
                </Button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-6 px-6">
              <table className="w-full text-xs border-collapse min-w-[1400px]">
                <thead>
                  <tr className="bg-muted/50">
                    {/* Group headers */}
                    <th colSpan={2} className="border border-border px-1.5 py-1.5 text-center font-semibold text-muted-foreground bg-muted/70">总体情况</th>
                    <th colSpan={5} className="border border-border px-1.5 py-1.5 text-center font-semibold text-muted-foreground bg-blue-50">销售数据</th>
                    <th colSpan={4} className="border border-border px-1.5 py-1.5 text-center font-semibold text-muted-foreground bg-emerald-50">转化数据</th>
                    <th colSpan={8} className="border border-border px-1.5 py-1.5 text-center font-semibold text-muted-foreground bg-orange-50">广告情况</th>
                    <th colSpan={3} className="border border-border px-1.5 py-1.5 text-center font-semibold text-muted-foreground bg-purple-50">产品质量概况</th>
                    <th className="border border-border px-1.5 py-1 w-16"></th>
                  </tr>
                  <tr className="bg-muted/30">
                    {columns.map(col => (
                      <th key={col.key} className="border border-border px-1.5 py-1.5 text-center font-medium text-muted-foreground whitespace-nowrap text-[11px]">
                        {col.label}
                      </th>
                    ))}
                    <th className="border border-border px-1 py-1 text-center font-medium text-muted-foreground text-[11px]">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, idx) => {
                    if (row.type === "month") {
                      // Monthly summary row (green background)
                      const m = row.data;
                      const monthNum = row.yearMonth!.split("-")[1];
                      const profitVal = formatMoney(m.financialProfit);
                      const orderProfitVal = formatMoney(m.orderProfitTotal);
                      return (
                        <tr key={`month-${row.yearMonth}`} className="bg-emerald-100/70 font-semibold">
                          <td colSpan={5} className="border border-border px-2 py-1.5 text-[11px]">
                            <span className="text-emerald-800">{parseInt(monthNum)}月度汇总</span>
                            <span className="ml-2 text-muted-foreground">财务实际利润</span>
                            <span className={`ml-1 font-mono ${profitVal.isNeg ? "text-red-600" : "text-emerald-700"}`}>{profitVal.text}</span>
                          </td>
                          <td colSpan={2} className="border border-border px-2 py-1.5 text-[11px]">
                            <span className="text-muted-foreground">订单利润总</span>
                            <span className={`ml-1 font-mono ${orderProfitVal.isNeg ? "text-red-600" : "text-emerald-700"}`}>{orderProfitVal.text}</span>
                          </td>
                          <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{formatInt(m.totalSalesQty)}</td>
                          <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{formatInt(m.totalOrderQty)}</td>
                          <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{formatMoney(m.totalSalesAmount).text}</td>
                          <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{formatMoney(m.totalAdSpend).text}</td>
                          <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{formatPct(m.avgAcos)}</td>
                          <td colSpan={12} className="border border-border"></td>
                        </tr>
                      );
                    }

                    // Weekly data row
                    const w = row.data;
                    const isEditing = editingId === w.id;
                    const profitVal = formatMoney(w.orderProfit);

                    if (isEditing) {
                      return (
                        <tr key={w.id} className="bg-blue-50/50">
                          <td className="border border-border px-1 py-0.5">
                            <Input className="h-6 text-[11px] w-20" value={editData.weekStartDate} onChange={e => setEditData(d => ({ ...d, weekStartDate: e.target.value }))} />
                          </td>
                          <td className="border border-border px-1 py-0.5">
                            <Select value={editData.salesTrend} onValueChange={v => setEditData(d => ({ ...d, salesTrend: v }))}>
                              <SelectTrigger className="h-6 text-[11px] w-14"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="up">上升</SelectItem>
                                <SelectItem value="down">下降</SelectItem>
                                <SelectItem value="stable">平稳</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          {["salesQty","orderQty","salesAmount","orderProfit","orderProfitMargin","sessionTotal","totalCvr","adCvr","organicCvr","adOrders","organicOrders","adClicks","organicClicks","ctr","adImpressions","cpc","adSpend","acos","rating","reviewCount","returnRate"].map(key => (
                            <td key={key} className="border border-border px-0.5 py-0.5">
                              <Input
                                className="h-6 text-[11px] w-14 px-1"
                                value={editData[key] || ""}
                                onChange={e => setEditData(d => ({ ...d, [key]: e.target.value }))}
                              />
                            </td>
                          ))}
                          <td className="border border-border px-1 py-0.5">
                            <div className="flex gap-0.5">
                              <Button size="icon" variant="ghost" className="h-5 w-5" onClick={saveEdit} disabled={upsertWeekly.isPending}>
                                <Save className="h-3 w-3 text-emerald-600" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => setEditingId(null)}>
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={w.id} className="hover:bg-muted/30 transition-colors">
                        <td className="border border-border px-1.5 py-1 text-center font-mono text-[11px] whitespace-nowrap">{w.weekStartDate.substring(5)}</td>
                        <td className="border border-border px-1 py-1 text-center">
                          <div className="flex items-center justify-center gap-0.5">
                            {trendIcon(w.salesTrend)}
                            <span className="text-[10px]">{trendLabel(w.salesTrend)}</span>
                          </div>
                        </td>
                        <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{formatInt(w.salesQty)}</td>
                        <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{formatInt(w.orderQty)}</td>
                        <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{formatMoney(w.salesAmount).text}</td>
                        <td className={`border border-border px-1 py-1 text-center font-mono text-[11px] ${profitVal.isNeg ? "text-red-600" : ""}`}>{profitVal.text}</td>
                        <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{formatPct(w.orderProfitMargin)}</td>
                        <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{formatInt(w.sessionTotal)}</td>
                        <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{formatPct(w.totalCvr)}</td>
                        <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{formatPct(w.adCvr)}</td>
                        <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{formatPct(w.organicCvr)}</td>
                        <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{formatInt(w.adOrders)}</td>
                        <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{formatInt(w.organicOrders)}</td>
                        <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{formatInt(w.adClicks)}</td>
                        <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{formatInt(w.organicClicks)}</td>
                        <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{formatPct(w.ctr)}</td>
                        <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{formatInt(w.adImpressions)}</td>
                        <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{formatMoney(w.cpc).text}</td>
                        <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{formatMoney(w.adSpend).text}</td>
                        <td className={`border border-border px-1 py-1 text-center font-mono text-[11px] ${parseFloat(String(w.acos || 0)) > 30 ? "text-red-600" : ""}`}>{formatPct(w.acos)}</td>
                        <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{w.rating ? String(w.rating) : "-"}</td>
                        <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{formatInt(w.reviewCount)}</td>
                        <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{formatPct(w.returnRate)}</td>
                        <td className="border border-border px-1 py-0.5 text-center">
                          <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => startEdit(w)}>
                            <Edit2 className="h-3 w-3 text-muted-foreground" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Add Row Dialog ─── */}
      <Dialog open={showAddRow} onOpenChange={setShowAddRow}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>手动添加周度数据</DialogTitle></DialogHeader>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">周起始日期 *</Label>
              <Input type="date" className="h-8 text-sm" value={newRow.weekStartDate} onChange={e => setNewRow(r => ({ ...r, weekStartDate: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">周结束日期 *</Label>
              <Input type="date" className="h-8 text-sm" value={newRow.weekEndDate} onChange={e => setNewRow(r => ({ ...r, weekEndDate: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">销量趋势</Label>
              <Select value={newRow.salesTrend} onValueChange={v => setNewRow(r => ({ ...r, salesTrend: v }))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="up">上升</SelectItem>
                  <SelectItem value="down">下降</SelectItem>
                  <SelectItem value="stable">平稳</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {[
              { key: "salesQty", label: "销量" },
              { key: "orderQty", label: "订单量" },
              { key: "salesAmount", label: "销售额($)" },
              { key: "orderProfit", label: "订单利润($)" },
              { key: "orderProfitMargin", label: "毛利率(%)" },
              { key: "sessionTotal", label: "Session" },
              { key: "totalCvr", label: "总CVR(%)" },
              { key: "adCvr", label: "广告CVR(%)" },
              { key: "organicCvr", label: "自然CVR(%)" },
              { key: "adOrders", label: "广告订单" },
              { key: "organicOrders", label: "自然订单" },
              { key: "adClicks", label: "广告点击" },
              { key: "organicClicks", label: "自然点击" },
              { key: "ctr", label: "CTR(%)" },
              { key: "adImpressions", label: "广告曝光" },
              { key: "cpc", label: "CPC($)" },
              { key: "adSpend", label: "广告花费($)" },
              { key: "acos", label: "ACOS(%)" },
              { key: "rating", label: "评分" },
              { key: "reviewCount", label: "评论数" },
              { key: "returnRate", label: "退货率(%)" },
            ].map(f => (
              <div key={f.key}>
                <Label className="text-xs">{f.label}</Label>
                <Input
                  className="h-8 text-sm"
                  value={(newRow as any)[f.key]}
                  onChange={e => setNewRow(r => ({ ...r, [f.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddRow(false)}>取消</Button>
            <Button
              disabled={!newRow.weekStartDate || !newRow.weekEndDate || upsertWeekly.isPending}
              onClick={() => {
                upsertWeekly.mutate({
                  productId,
                  weekStartDate: newRow.weekStartDate,
                  weekEndDate: newRow.weekEndDate,
                  salesTrend: newRow.salesTrend as "up" | "down" | "stable",
                  salesQty: parseInt(newRow.salesQty) || 0,
                  orderQty: parseInt(newRow.orderQty) || 0,
                  salesAmount: newRow.salesAmount,
                  orderProfit: newRow.orderProfit,
                  orderProfitMargin: newRow.orderProfitMargin,
                  sessionTotal: parseInt(newRow.sessionTotal) || 0,
                  totalCvr: newRow.totalCvr,
                  adCvr: newRow.adCvr,
                  organicCvr: newRow.organicCvr,
                  adOrders: parseInt(newRow.adOrders) || 0,
                  organicOrders: parseInt(newRow.organicOrders) || 0,
                  adClicks: parseInt(newRow.adClicks) || 0,
                  organicClicks: parseInt(newRow.organicClicks) || 0,
                  ctr: newRow.ctr,
                  adImpressions: parseInt(newRow.adImpressions) || 0,
                  cpc: newRow.cpc,
                  adSpend: newRow.adSpend,
                  acos: newRow.acos,
                  rating: newRow.rating,
                  reviewCount: parseInt(newRow.reviewCount) || 0,
                  returnRate: newRow.returnRate,
                });
              }}
            >
              {upsertWeekly.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
