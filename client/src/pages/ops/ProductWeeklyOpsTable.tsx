import { useState, useMemo, useEffect, useRef } from "react";
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
  AlertTriangle, AlertCircle, CheckCircle2,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, ComposedChart, Area, ReferenceLine,
} from "recharts";

interface Props {
  productId: number;
  parentAsin: string;
}

/* ─── Alert Thresholds ─── */
const ALERT_THRESHOLDS = {
  acos: { warn: 25, danger: 30, label: "ACOS", unit: "%" },
  profitMargin: { warn: 15, danger: 10, label: "利润率", unit: "%" },
  returnRate: { warn: 3, danger: 5, label: "退货率", unit: "%" },
  ctr: { warn: 0.3, danger: 0.2, label: "CTR", unit: "%", reverse: true },
  totalCvr: { warn: 8, danger: 5, label: "总CVR", unit: "%", reverse: true },
};

type AlertLevel = "normal" | "warn" | "danger";

function getAlertLevel(key: string, value: number | null | undefined): AlertLevel {
  if (value == null || isNaN(value)) return "normal";
  const threshold = ALERT_THRESHOLDS[key as keyof typeof ALERT_THRESHOLDS];
  if (!threshold) return "normal";

  if ((threshold as any).reverse) {
    // Lower is worse (CTR, CVR)
    if (value < threshold.danger) return "danger";
    if (value < threshold.warn) return "warn";
  } else {
    // Higher is worse (ACOS, returnRate) or lower is worse (profitMargin)
    if (key === "profitMargin") {
      if (value < threshold.danger) return "danger";
      if (value < threshold.warn) return "warn";
    } else {
      if (value > threshold.danger) return "danger";
      if (value > threshold.warn) return "warn";
    }
  }
  return "normal";
}

function alertCellClass(level: AlertLevel): string {
  if (level === "danger") return "bg-red-100 text-red-700 font-semibold";
  if (level === "warn") return "bg-amber-50 text-amber-700";
  return "";
}

function alertBadge(level: AlertLevel, label: string) {
  if (level === "danger") return (
    <span className="inline-flex items-center gap-0.5 text-[9px] text-red-600 bg-red-100 px-1 py-0.5 rounded">
      <AlertCircle className="h-2.5 w-2.5" />{label}
    </span>
  );
  if (level === "warn") return (
    <span className="inline-flex items-center gap-0.5 text-[9px] text-amber-600 bg-amber-100 px-1 py-0.5 rounded">
      <AlertTriangle className="h-2.5 w-2.5" />{label}
    </span>
  );
  return null;
}

/* ─── Helpers ─── */
function formatMoney(val: string | number | null | undefined, prefix = "$"): { text: string; isNeg: boolean } {
  if (val == null || val === "") return { text: "-", isNeg: false };
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return { text: "-", isNeg: false };
  const isNeg = num < 0;
  const abs = Math.abs(num).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return { text: isNeg ? `(${prefix}${abs})` : `${prefix}${abs}`, isNeg };
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

/* ─── Chart Metric Definitions ─── */
type ChartTab = "sales" | "profit" | "acos" | "ads" | "session" | "orders";

const CHART_TABS: { key: ChartTab; label: string }[] = [
  { key: "sales", label: "销量趋势" },
  { key: "profit", label: "利润趋势" },
  { key: "acos", label: "ACOS趋势" },
  { key: "ads", label: "广告数据" },
  { key: "session", label: "Session/CVR" },
  { key: "orders", label: "订单结构" },
];

/* ─── Row Alert Summary ─── */
function getRowAlerts(w: any): { level: AlertLevel; alerts: string[] } {
  const alerts: string[] = [];
  let maxLevel: AlertLevel = "normal";

  const acosVal = parseFloat(String(w.acos || 0));
  const acosLevel = getAlertLevel("acos", acosVal);
  if (acosLevel !== "normal") { alerts.push(`ACOS ${acosVal.toFixed(1)}%`); maxLevel = acosLevel === "danger" ? "danger" : maxLevel === "danger" ? "danger" : "warn"; }

  const profitVal = parseFloat(String(w.orderProfitMargin || 0));
  const profitLevel = getAlertLevel("profitMargin", profitVal);
  if (profitLevel !== "normal") { alerts.push(`利润率 ${profitVal.toFixed(1)}%`); maxLevel = profitLevel === "danger" ? "danger" : maxLevel === "danger" ? "danger" : "warn"; }

  const returnVal = parseFloat(String(w.returnRate || 0));
  const returnLevel = getAlertLevel("returnRate", returnVal);
  if (returnLevel !== "normal") { alerts.push(`退货率 ${returnVal.toFixed(1)}%`); maxLevel = returnLevel === "danger" ? "danger" : maxLevel === "danger" ? "danger" : "warn"; }

  return { level: maxLevel, alerts };
}

/* ─── Main Component ─── */
export default function ProductWeeklyOpsTable({ productId, parentAsin }: Props) {
  const [showAddRow, setShowAddRow] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editData, setEditData] = useState<Record<string, string>>({});
  const [showChart, setShowChart] = useState(true);
  const [chartTab, setChartTab] = useState<ChartTab>("sales");
  const [showAlertOnly, setShowAlertOnly] = useState(false);

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

  const autoFillBasicInfo = trpc.productOps.autoFillBasicInfo.useMutation({
    onSuccess: (data) => {
      if (data.filled) {
        toast.success("已从领星自动填充产品利润信息");
        refetchBasicInfo();
      }
    },
    onError: () => { /* silent fail for auto-fill */ },
  });

  // Auto-fill basic info on first visit if empty
  const autoFillTriggered = useRef(false);
  useEffect(() => {
    if (basicInfo === null && !autoFillTriggered.current && productId) {
      autoFillTriggered.current = true;
      autoFillBasicInfo.mutate({ productId });
    }
  }, [basicInfo, productId]);

  // Group weekly data by month and insert monthly summary rows
  const tableRows = useMemo(() => {
    if (!weeklyData || weeklyData.length === 0) return [];
    const sorted = [...weeklyData].sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate));
    const monthlyMap = new Map((monthlyData || []).map(m => [m.yearMonth, m]));

    const rows: Array<{ type: "week" | "month"; data: any; yearMonth?: string }> = [];
    let currentMonth = "";

    for (const week of sorted) {
      const ym = week.weekStartDate.substring(0, 7);
      if (ym !== currentMonth && currentMonth !== "") {
        const ms = monthlyMap.get(currentMonth);
        if (ms) rows.push({ type: "month", data: ms, yearMonth: currentMonth });
      }
      currentMonth = ym;
      rows.push({ type: "week", data: week });
    }
    if (currentMonth) {
      const ms = monthlyMap.get(currentMonth);
      if (ms) rows.push({ type: "month", data: ms, yearMonth: currentMonth });
    }
    return rows;
  }, [weeklyData, monthlyData]);

  // Alert summary for the entire product (based on latest week)
  const productAlertSummary = useMemo(() => {
    if (!weeklyData || weeklyData.length === 0) return { level: "normal" as AlertLevel, alerts: [], badges: [] as JSX.Element[] };
    const latest = [...weeklyData].sort((a, b) => b.weekStartDate.localeCompare(a.weekStartDate))[0];
    const { level, alerts } = getRowAlerts(latest);
    const badges: JSX.Element[] = [];

    const acosVal = parseFloat(String(latest.acos || 0));
    const acosLevel = getAlertLevel("acos", acosVal);
    const b1 = alertBadge(acosLevel, `ACOS ${acosVal.toFixed(0)}%`);
    if (b1) badges.push(b1);

    const profitVal = parseFloat(String(latest.orderProfitMargin || 0));
    const profitLevel = getAlertLevel("profitMargin", profitVal);
    const b2 = alertBadge(profitLevel, `利润率 ${profitVal.toFixed(0)}%`);
    if (b2) badges.push(b2);

    const returnVal = parseFloat(String(latest.returnRate || 0));
    const returnLevel = getAlertLevel("returnRate", returnVal);
    const b3 = alertBadge(returnLevel, `退货率 ${returnVal.toFixed(1)}%`);
    if (b3) badges.push(b3);

    return { level, alerts, badges };
  }, [weeklyData]);

  // Chart data
  const chartData = useMemo(() => {
    if (!weeklyData) return [];
    return [...weeklyData]
      .sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate))
      .map(w => ({
        date: w.weekStartDate.substring(5),
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
        adCvr: parseFloat(String(w.adCvr || "0")),
        organicCvr: parseFloat(String(w.organicCvr || "0")),
        adOrders: w.adOrders || 0,
        organicOrders: w.organicOrders || 0,
        adClicks: w.adClicks || 0,
        adImpressions: w.adImpressions || 0,
        ctr: parseFloat(String(w.ctr || "0")),
        returnRate: parseFloat(String(w.returnRate || "0")),
        rating: parseFloat(String(w.rating || "0")),
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

  // New row state
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

  // Column headers
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

  /* ─── Render Chart ─── */
  const renderChart = () => {
    if (chartData.length === 0) return null;

    const commonProps = { margin: { top: 10, right: 15, left: 0, bottom: 5 } };
    const tooltipStyle = { fontSize: 11, borderRadius: 8 };
    const legendStyle = { fontSize: 11 };

    switch (chartTab) {
      case "sales":
        return (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData} {...commonProps}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} label={{ value: "销量", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} label={{ value: "CVR%", angle: 90, position: "insideRight", style: { fontSize: 10 } }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={legendStyle} />
              <Bar yAxisId="left" dataKey="salesQty" name="销量" fill="#3b82f6" opacity={0.7} radius={[2, 2, 0, 0]} />
              <Line yAxisId="left" type="monotone" dataKey="orderQty" name="订单量" stroke="#8b5cf6" strokeWidth={1.5} dot={{ r: 2 }} />
              <Line yAxisId="right" type="monotone" dataKey="totalCvr" name="总CVR%" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
              <ReferenceLine yAxisId="right" y={5} stroke="#ef4444" strokeDasharray="5 5" label={{ value: "CVR预警线 5%", position: "right", style: { fontSize: 9, fill: "#ef4444" } }} />
            </ComposedChart>
          </ResponsiveContainer>
        );

      case "profit":
        return (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData} {...commonProps}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} label={{ value: "$", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} domain={[0, 'auto']} label={{ value: "%", angle: 90, position: "insideRight", style: { fontSize: 10 } }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={legendStyle} />
              <Area yAxisId="left" type="monotone" dataKey="salesAmount" name="销售额" fill="#6366f1" fillOpacity={0.15} stroke="#6366f1" strokeWidth={1} />
              <Bar yAxisId="left" dataKey="orderProfit" name="订单利润" fill="#10b981" opacity={0.7} radius={[2, 2, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="profitMargin" name="利润率%" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
              <ReferenceLine yAxisId="right" y={10} stroke="#ef4444" strokeDasharray="5 5" label={{ value: "利润率预警线 10%", position: "right", style: { fontSize: 9, fill: "#ef4444" } }} />
              <ReferenceLine yAxisId="right" y={15} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: "关注线 15%", position: "right", style: { fontSize: 9, fill: "#f59e0b" } }} />
            </ComposedChart>
          </ResponsiveContainer>
        );

      case "acos":
        return (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData} {...commonProps}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} domain={[0, 'auto']} label={{ value: "%", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={legendStyle} />
              <Area type="monotone" dataKey="acos" name="ACOS%" fill="#ef4444" fillOpacity={0.1} stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="totalCvr" name="总CVR%" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="returnRate" name="退货率%" stroke="#a855f7" strokeWidth={1.5} dot={{ r: 2 }} />
              <ReferenceLine y={30} stroke="#ef4444" strokeDasharray="5 5" label={{ value: "ACOS危险线 30%", position: "right", style: { fontSize: 9, fill: "#ef4444" } }} />
              <ReferenceLine y={25} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: "ACOS关注线 25%", position: "right", style: { fontSize: 9, fill: "#f59e0b" } }} />
              <ReferenceLine y={5} stroke="#a855f7" strokeDasharray="3 3" label={{ value: "退货率预警 5%", position: "left", style: { fontSize: 9, fill: "#a855f7" } }} />
            </ComposedChart>
          </ResponsiveContainer>
        );

      case "ads":
        return (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData} {...commonProps}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} label={{ value: "$", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={legendStyle} />
              <Bar yAxisId="left" dataKey="adSpend" name="广告费" fill="#ef4444" opacity={0.6} radius={[2, 2, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="cpc" name="CPC $" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
              <Line yAxisId="right" type="monotone" dataKey="ctr" name="CTR%" stroke="#06b6d4" strokeWidth={1.5} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        );

      case "session":
        return (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData} {...commonProps}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} label={{ value: "Session", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} label={{ value: "%", angle: 90, position: "insideRight", style: { fontSize: 10 } }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={legendStyle} />
              <Bar yAxisId="left" dataKey="sessionTotal" name="Session" fill="#0ea5e9" opacity={0.7} radius={[2, 2, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="totalCvr" name="总CVR%" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
              <Line yAxisId="right" type="monotone" dataKey="adCvr" name="广告CVR%" stroke="#f59e0b" strokeWidth={1.5} dot={{ r: 2 }} />
              <Line yAxisId="right" type="monotone" dataKey="organicCvr" name="自然CVR%" stroke="#8b5cf6" strokeWidth={1.5} dot={{ r: 2 }} />
              <ReferenceLine yAxisId="right" y={5} stroke="#ef4444" strokeDasharray="5 5" label={{ value: "CVR预警线 5%", position: "right", style: { fontSize: 9, fill: "#ef4444" } }} />
            </ComposedChart>
          </ResponsiveContainer>
        );

      case "orders":
        return (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData} {...commonProps}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={legendStyle} />
              <Bar dataKey="adOrders" name="广告订单" stackId="orders" fill="#f59e0b" opacity={0.8} radius={[0, 0, 0, 0]} />
              <Bar dataKey="organicOrders" name="自然订单" stackId="orders" fill="#10b981" opacity={0.8} radius={[2, 2, 0, 0]} />
              <Line type="monotone" dataKey="adClicks" name="广告点击" stroke="#ef4444" strokeWidth={1.5} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* ─── Product Basic Info Card ─── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">产品利润情况</CardTitle>
              {productAlertSummary.badges.length > 0 && (
                <div className="flex items-center gap-1">{productAlertSummary.badges.map((b, i) => <span key={i}>{b}</span>)}</div>
              )}
            </div>
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

      {/* ─── Trend Chart Card ─── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-blue-600" />
              <CardTitle className="text-base">数据趋势分析</CardTitle>
            </div>
            <Button size="sm" variant="outline" onClick={() => setShowChart(!showChart)}>
              {showChart ? <ChevronUp className="h-3.5 w-3.5 mr-1" /> : <ChevronDown className="h-3.5 w-3.5 mr-1" />}
              {showChart ? "收起图表" : "展开图表"}
            </Button>
          </div>
        </CardHeader>
        {showChart && (
          <CardContent>
            <div className="flex items-center gap-1.5 mb-3 flex-wrap">
              {CHART_TABS.map(tab => (
                <Button
                  key={tab.key}
                  size="sm"
                  variant={chartTab === tab.key ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setChartTab(tab.key)}
                >
                  {tab.label}
                </Button>
              ))}
            </div>
            {chartData.length > 0 ? (
              <div className="border rounded-lg p-3 bg-muted/10">
                {renderChart()}
              </div>
            ) : (
              <div className="text-center py-8 text-sm text-muted-foreground">暂无数据，请先同步周度运营数据</div>
            )}
            {/* Alert Legend */}
            <div className="mt-3 flex items-center gap-4 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-red-500 inline-block" style={{ borderTop: "2px dashed #ef4444" }} /> 危险预警线</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-500 inline-block" style={{ borderTop: "2px dashed #f59e0b" }} /> 关注线</span>
              <span className="text-muted-foreground/60">| ACOS &gt; 30% 危险, &gt; 25% 关注 | 利润率 &lt; 10% 危险, &lt; 15% 关注 | 退货率 &gt; 5% 危险</span>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ─── Weekly Ops Data Table ─── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-blue-600" />
              <CardTitle className="text-base">周度运营数据</CardTitle>
              <Badge variant="secondary" className="text-xs">{weeklyData?.length || 0} 周</Badge>
              {productAlertSummary.level !== "normal" && (
                <Badge variant={productAlertSummary.level === "danger" ? "destructive" : "outline"} className="text-xs">
                  {productAlertSummary.level === "danger" ? <AlertCircle className="h-3 w-3 mr-0.5" /> : <AlertTriangle className="h-3 w-3 mr-0.5" />}
                  {productAlertSummary.alerts.length} 项预警
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm" variant={showAlertOnly ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => setShowAlertOnly(!showAlertOnly)}
              >
                <AlertTriangle className="h-3 w-3 mr-1" />
                {showAlertOnly ? "显示全部" : "仅预警周"}
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
                    <th className="border border-border px-1 py-1 w-6 text-center text-[10px] text-muted-foreground">!</th>
                    <th colSpan={2} className="border border-border px-1.5 py-1.5 text-center font-semibold text-muted-foreground bg-muted/70">总体情况</th>
                    <th colSpan={5} className="border border-border px-1.5 py-1.5 text-center font-semibold text-muted-foreground bg-blue-50">销售数据</th>
                    <th colSpan={4} className="border border-border px-1.5 py-1.5 text-center font-semibold text-muted-foreground bg-emerald-50">转化数据</th>
                    <th colSpan={8} className="border border-border px-1.5 py-1.5 text-center font-semibold text-muted-foreground bg-orange-50">广告情况</th>
                    <th colSpan={3} className="border border-border px-1.5 py-1.5 text-center font-semibold text-muted-foreground bg-purple-50">产品质量概况</th>
                    <th className="border border-border px-1.5 py-1 w-16"></th>
                  </tr>
                  <tr className="bg-muted/30">
                    <th className="border border-border px-1 py-1 text-center text-[10px]">
                      <AlertTriangle className="h-3 w-3 mx-auto text-muted-foreground" />
                    </th>
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
                      if (showAlertOnly) return null;
                      const m = row.data;
                      const monthNum = row.yearMonth!.split("-")[1];
                      const profitVal = formatMoney(m.financialProfit);
                      const orderProfitVal = formatMoney(m.orderProfitTotal);
                      return (
                        <tr key={`month-${row.yearMonth}`} className="bg-emerald-100/70 font-semibold">
                          <td className="border border-border px-1 py-1"></td>
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
                    const rowAlert = getRowAlerts(w);

                    // Filter: show only alert rows
                    if (showAlertOnly && rowAlert.level === "normal") return null;

                    // Alert cell levels
                    const acosLevel = getAlertLevel("acos", parseFloat(String(w.acos || 0)));
                    const profitMarginLevel = getAlertLevel("profitMargin", parseFloat(String(w.orderProfitMargin || 0)));
                    const returnRateLevel = getAlertLevel("returnRate", parseFloat(String(w.returnRate || 0)));

                    if (isEditing) {
                      return (
                        <tr key={w.id} className="bg-blue-50/50">
                          <td className="border border-border px-1 py-0.5"></td>
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

                    // Row border highlight for alerts
                    const rowBorderClass = rowAlert.level === "danger" ? "border-l-2 border-l-red-500" : rowAlert.level === "warn" ? "border-l-2 border-l-amber-400" : "";

                    return (
                      <tr key={w.id} className={`hover:bg-muted/30 transition-colors ${rowBorderClass}`}>
                        {/* Alert indicator column */}
                        <td className="border border-border px-0.5 py-0.5 text-center">
                          {rowAlert.level === "danger" && (
                            <div className="relative group">
                              <AlertCircle className="h-3.5 w-3.5 text-red-500 mx-auto" />
                              <div className="absolute z-50 left-6 top-0 hidden group-hover:block bg-white border border-red-200 rounded-lg shadow-lg p-2 min-w-[140px]">
                                <p className="text-[10px] font-semibold text-red-600 mb-1">异常预警</p>
                                {rowAlert.alerts.map((a, i) => <p key={i} className="text-[10px] text-red-500">{a}</p>)}
                              </div>
                            </div>
                          )}
                          {rowAlert.level === "warn" && (
                            <div className="relative group">
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mx-auto" />
                              <div className="absolute z-50 left-6 top-0 hidden group-hover:block bg-white border border-amber-200 rounded-lg shadow-lg p-2 min-w-[140px]">
                                <p className="text-[10px] font-semibold text-amber-600 mb-1">关注提醒</p>
                                {rowAlert.alerts.map((a, i) => <p key={i} className="text-[10px] text-amber-500">{a}</p>)}
                              </div>
                            </div>
                          )}
                          {rowAlert.level === "normal" && <CheckCircle2 className="h-3 w-3 text-emerald-400 mx-auto opacity-30" />}
                        </td>
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
                        <td className={`border border-border px-1 py-1 text-center font-mono text-[11px] ${alertCellClass(profitMarginLevel)}`}>
                          {formatPct(w.orderProfitMargin)}
                        </td>
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
                        <td className={`border border-border px-1 py-1 text-center font-mono text-[11px] ${alertCellClass(acosLevel)}`}>
                          {formatPct(w.acos)}
                        </td>
                        <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{w.rating ? String(w.rating) : "-"}</td>
                        <td className="border border-border px-1 py-1 text-center font-mono text-[11px]">{formatInt(w.reviewCount)}</td>
                        <td className={`border border-border px-1 py-1 text-center font-mono text-[11px] ${alertCellClass(returnRateLevel)}`}>
                          {formatPct(w.returnRate)}
                        </td>
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

          {/* Alert Threshold Legend */}
          {weeklyData && weeklyData.length > 0 && (
            <div className="mt-3 pt-3 border-t flex items-center gap-4 flex-wrap text-[10px]">
              <span className="font-medium text-muted-foreground">预警阈值:</span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500" /> ACOS &gt; 30%
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-500" /> ACOS &gt; 25%
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500" /> 利润率 &lt; 10%
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-500" /> 利润率 &lt; 15%
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500" /> 退货率 &gt; 5%
              </span>
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
