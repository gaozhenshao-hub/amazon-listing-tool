import { ProductCostSummary } from "./ProductCostSummary";
import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import ProductMonthlyFinancialDialog, { type ProductMonthlyFinancialTarget } from "./ProductMonthlyFinancialDialog";
import { MANAGER_ROLES } from "@shared/const";
import { buildUnifiedProductOverview } from "@shared/unifiedProductOverview";
import { hasVerifiedSourceScope, shouldWaitForProductOverviewFallback } from "./productOverviewScope";
import { buildProductFinancialTrend, type ProductFinancialTrendPoint } from "./productFinancialTrend";
import { subscribeMonthlyFinancialChanges } from "./monthlyFinancialWriteEvents";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Search, Package, Loader2, Download,
  Store, User, Globe, Users, CheckSquare, UserPlus, UserCheck,
  BarChart3, ChevronDown, ChevronRight, ExternalLink,
  TrendingUp, TrendingDown, Minus, Trash2, RefreshCw,
  ArrowUpDown, ArrowUp, ArrowDown, Calendar,
  AlertTriangle, AlertCircle, Upload,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from "@/components/ui/tooltip";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend,
} from "recharts";
import { asFiniteMetric, formatMetricFixed } from "./productOverviewMetricSafety";

const PRODUCTS_PER_PAGE = 12;

const MARKETPLACE_OPTIONS = [
  { value: "ALL", label: "全部站点" },
  { value: "US", label: "US" },
  { value: "CA", label: "CA" },
  { value: "MX", label: "MX" },
  { value: "UK", label: "UK" },
  { value: "DE", label: "DE" },
  { value: "FR", label: "FR" },
  { value: "IT", label: "IT" },
  { value: "ES", label: "ES" },
  { value: "JP", label: "JP" },
  { value: "AU", label: "AU" },
];

// ─── Utility functions ───
function fmtCurrency(val: number | null | undefined) {
  const numeric = asFiniteMetric(val);
  if (numeric == null) return "—";
  if (Math.abs(numeric) >= 10000) return `$${(numeric / 1000).toFixed(1)}K`;
  return `$${numeric.toFixed(2)}`;
}
function fmtNum(val: number | null | undefined) {
  const numeric = asFiniteMetric(val);
  if (numeric == null) return "—";
  if (numeric >= 10000) return `${(numeric / 1000).toFixed(1)}K`;
  return numeric.toLocaleString();
}
function fmtPct(val: number | null | undefined, digits = 2) {
  const numeric = asFiniteMetric(val);
  return numeric == null ? "—" : `${numeric.toFixed(digits)}%`;
}
function MetricValue({ value, formatter }: { value: number | null | undefined; formatter: (value: number | null | undefined) => string }) {
  const numeric = asFiniteMetric(value);
  if (numeric == null) return <span className="text-muted-foreground" title="数据未提供">—</span>;
  return <>{formatter(numeric)}</>;
}
function fmtWeekDate(startDate: string, endDate?: string) {
  // "2026-04-07", "2026-04-13" -> "4/07-4/13"
  const s = new Date(startDate + "T00:00:00");
  const sm = String(s.getMonth() + 1);
  const sd = String(s.getDate()).padStart(2, "0");
  if (!endDate) return `${sm}/${sd}起`;
  const e = new Date(endDate + "T00:00:00");
  const em = String(e.getMonth() + 1);
  const ed = String(e.getDate()).padStart(2, "0");
  return `${sm}/${sd}-${em}/${ed}`;
}

function TrendBadge({ trend }: { trend: string | null }) {
  if (trend === "up") return <Badge variant="secondary" className="text-[10px] px-1 py-0 bg-emerald-50 text-emerald-700 border-emerald-200">上升</Badge>;
  if (trend === "down") return <Badge variant="secondary" className="text-[10px] px-1 py-0 bg-red-50 text-red-700 border-red-200">下降</Badge>;
  return <Badge variant="secondary" className="text-[10px] px-1 py-0 bg-gray-50 text-gray-600 border-gray-200">平稳</Badge>;
}

function WowArrow({ pct }: { pct: number | null | undefined }) {
  const numeric = asFiniteMetric(pct);
  if (numeric == null) return null;
  if (Math.abs(numeric) < 0.5) return <span className="text-[9px] text-gray-400 ml-0.5">-</span>;
  if (numeric > 0) return <span className="text-[9px] text-emerald-600 ml-0.5 whitespace-nowrap">↑{Math.abs(numeric).toFixed(0)}%</span>;
  return <span className="text-[9px] text-red-500 ml-0.5 whitespace-nowrap">↓{Math.abs(numeric).toFixed(0)}%</span>;
}

function ProfitCell({ val }: { val: number }) {
  if (val < 0) return <span className="text-red-500 font-medium tabular-nums">({fmtCurrency(Math.abs(val))})</span>;
  return <span className="text-emerald-600 font-medium tabular-nums">{fmtCurrency(val)}</span>;
}

// ─── Alert Thresholds for Overview ───
type AlertLevel = "normal" | "warn" | "danger";

function getAlertLevel(key: string, value: number | null | undefined): AlertLevel {
  const numeric = asFiniteMetric(value);
  if (numeric == null) return "normal";
  if (key === "acos") {
    if (numeric > 30) return "danger";
    if (numeric > 25) return "warn";
  } else if (key === "profitMargin") {
    if (numeric < 10 && numeric !== 0) return "danger";
    if (numeric < 15 && numeric !== 0) return "warn";
  } else if (key === "returnRate") {
    if (numeric > 5) return "danger";
    if (numeric > 3) return "warn";
  }
  return "normal";
}

function alertCellBg(level: AlertLevel): string {
  if (level === "danger") return "bg-red-100 text-red-700 font-semibold";
  if (level === "warn") return "bg-amber-50 text-amber-700";
  return "";
}

function getProductAlerts(product: { weeks: Array<{ acos: number | null; profitMargin: number | null; returnRate: number | null }> }): { level: AlertLevel; count: number; labels: string[] } {
  if (!product.weeks.length) return { level: "normal", count: 0, labels: [] };
  const latest = [...product.weeks].sort((a: any, b: any) => (b.weekStartDate || "").localeCompare(a.weekStartDate || ""))[0];
  const labels: string[] = [];
  let maxLevel: AlertLevel = "normal";
  const acosL = getAlertLevel("acos", latest.acos);
  if (acosL !== "normal") { labels.push(`ACOS ${formatMetricFixed(latest.acos, 0)}%`); maxLevel = acosL === "danger" ? "danger" : ["danger","warn"].includes(maxLevel) ? maxLevel : "warn"; }
  const profitL = getAlertLevel("profitMargin", latest.profitMargin);
  if (profitL !== "normal") { labels.push(`利润率 ${formatMetricFixed(latest.profitMargin, 0)}%`); maxLevel = profitL === "danger" ? "danger" : ["danger","warn"].includes(maxLevel) ? maxLevel : "warn"; }
  const returnL = getAlertLevel("returnRate", latest.returnRate);
  if (returnL !== "normal") { labels.push(`退货率 ${formatMetricFixed(latest.returnRate, 1)}%`); maxLevel = returnL === "danger" ? "danger" : ["danger","warn"].includes(maxLevel) ? maxLevel : "warn"; }
  return { level: maxLevel, count: labels.length, labels };
}

// ─── Types ───
type ProductOverview = {
  id: number;
  parentAsin: string;
  title: string;
  chineseName: string | null;
  brand: string | null;
  category: string | null;
  marketplace: string | null;
  imageUrl: string | null;
  status: string;
  operator: string | null;
  operatorSource?: "manual_assignment" | "product_profile" | "weekly_source" | null;
  storeName: string | null;
  variantCount: number;
  skus: string[];
  basicInfo: {
    sellingPrice: string | null;
    breakEvenPrice: string | null;
    grossProfit: string | null;
    grossMargin: string | null;
    returnRate: string | null;
    rating: string | null;
    reviewCount: number | null;
    listingDate: string | null;
    currentStock: number | null;
    inTransitStock: number | null;
  } | null;
  inventory?: {
    fbaAvailable: number;
    fbaInbound: number;
    fbaInTransit: number;
    fbaTotal: number;
    availableStock: number;
    fbaDaysOfSupply: number;
    stockoutDate: string | null;
    avgDailySales7d: number;
    daysOfStock: number;
  } | null;
  weeks: Array<{
    id: number;
    weekStartDate: string;
    weekEndDate: string;
    salesTrend: string | null;
    salesQty: number;
    orderQty: number;
    salesAmount: number;
    orderProfit: number;
    profitMargin: number | null;
    sessionTotal: number;
    totalCvr: number | null;
    adCvr: number | null;
    organicCvr: number | null;
    adOrders: number;
    organicOrders: number;
    adClicks: number;
    ctr: number | null;
    adImpressions: number;
    cpc: number | null;
    adSpend: number;
    acos: number | null;
    rating: number | null;
    reviewCount: number | null;
    returnRate: number | null;
    wow: {
      salesQty: { value: number; pct: number | null };
      salesAmount: { value: number; pct: number | null };
      orderProfit: { value: number; pct: number | null };
      sessionTotal: { value: number; pct: number | null };
      adSpend: { value: number; pct: number | null };
      acos: { value: number; pct: number | null };
    } | null;
  }>;
  monthlySummaries: Array<{
    yearMonth: string;
    financialProfit: string | null;
    orderProfitTotal: string | null;
    totalSalesQty: number | null;
    totalOrderQty: number | null;
    totalSalesAmount: string | null;
    totalAdSpend: string | null;
    avgAcos: string | null;
  }>;
  erpSource?: "lingxing" | "saihu";
  weeklySource?: "mcp_parent_weekly" | "erp_history";
  hasErpHistory?: boolean;
};

// ─── Sortable column keys (based on latest week data) ───
type SortKey = "salesQty" | "orderQty" | "salesAmount" | "orderProfit" | "profitMargin" | "sessionTotal" | "totalCvr" | "adCvr" | "organicCvr" | "adOrders" | "organicOrders" | "adClicks" | "ctr" | "adImpressions" | "cpc" | "adSpend" | "acos" | "rating" | "reviewCount" | "returnRate" | null;
type SortDir = "asc" | "desc";

// ─── Column header definitions for the weekly data table ───
const WEEKLY_COLS: Array<{ key: string; label: string; w: string; align: "left" | "center" | "right"; sortable: boolean }> = [
  { key: "date", label: "时间", w: "w-[70px]", align: "left", sortable: false },
  { key: "trend", label: "趋势", w: "w-[50px]", align: "center", sortable: false },
  { key: "salesQty", label: "销量", w: "w-[55px]", align: "right", sortable: true },
  { key: "orderQty", label: "订单", w: "w-[50px]", align: "right", sortable: true },
  { key: "salesAmount", label: "销售额", w: "w-[80px]", align: "right", sortable: true },
  { key: "orderProfit", label: "订单利润", w: "w-[80px]", align: "right", sortable: true },
  { key: "profitMargin", label: "利润率", w: "w-[55px]", align: "right", sortable: true },
  { key: "sessionTotal", label: "Session", w: "w-[65px]", align: "right", sortable: true },
  { key: "totalCvr", label: "总CVR", w: "w-[55px]", align: "right", sortable: true },
  { key: "adCvr", label: "广告CVR", w: "w-[60px]", align: "right", sortable: true },
  { key: "organicCvr", label: "自然CVR", w: "w-[60px]", align: "right", sortable: true },
  { key: "adOrders", label: "广告订单", w: "w-[60px]", align: "right", sortable: true },
  { key: "organicOrders", label: "自然订单", w: "w-[60px]", align: "right", sortable: true },
  { key: "adClicks", label: "广告点击", w: "w-[65px]", align: "right", sortable: true },
  { key: "ctr", label: "CTR", w: "w-[50px]", align: "right", sortable: true },
  { key: "adImpressions", label: "曝光", w: "w-[65px]", align: "right", sortable: true },
  { key: "cpc", label: "CPC", w: "w-[55px]", align: "right", sortable: true },
  { key: "adSpend", label: "广告花费", w: "w-[75px]", align: "right", sortable: true },
  { key: "acos", label: "ACOS", w: "w-[55px]", align: "right", sortable: true },
  { key: "rating", label: "评分", w: "w-[45px]", align: "right", sortable: true },
  { key: "reviewCount", label: "评论", w: "w-[50px]", align: "right", sortable: true },
  { key: "returnRate", label: "退货率", w: "w-[55px]", align: "right", sortable: true },
];

// Helper: get the latest week value for a product by sort key
function getLatestWeekValue(product: ProductOverview, key: SortKey): number {
  if (!key || product.weeks.length === 0) return 0;
  // Sort weeks by date descending, take the latest
  const sorted = [...product.weeks].sort((a, b) => b.weekStartDate.localeCompare(a.weekStartDate));
  const latest = sorted[0];
  return (latest as any)[key] ?? 0;
}

// ─── Product Row Component ───
function ProductBlock({ product, onNavigate, onDelete, onSync, isSyncing, isManagerOrAbove = false, sortKey, sortDir, onSort, productionConfig, profitTrend, financialLoading = false, financialError = false, onViewFinancialReport }: {
  product: ProductOverview;
  onNavigate: (product: ProductOverview) => void;
  onDelete: (id: number) => void;
  onSync: (productId: number) => void;
  isSyncing: boolean;
  isManagerOrAbove?: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  productionConfig?: { productionTimeDays: number; shippingTimeDays: number; notes: string | null };
  profitTrend: ProductFinancialTrendPoint[];
  financialLoading?: boolean;
  financialError?: boolean;
  onViewFinancialReport?: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [newOp, setNewOp] = useState("");
  const [editingProduction, setEditingProduction] = useState(false);
  const [prodDays, setProdDays] = useState(productionConfig?.productionTimeDays ?? 15);
  const [shipDays, setShipDays] = useState(productionConfig?.shippingTimeDays ?? 30);
  const hasManagedProfile = product.id > 0;
  const hasScopedSourceIdentity = hasVerifiedSourceScope(product);
  // A manually assigned source product is not promoted to a product profile.
  // Its exact parent/store/site scope is sufficient for source-derived costs and
  // scoped operational editing, without changing source facts.
  const canMaintainScopedOperations = hasManagedProfile || hasScopedSourceIdentity;
  const bi = product.basicInfo;


  // Compute inventory status
  const inventoryStatus = useMemo(() => {
    const inv = product.inventory;
    if (!inv || (inv.fbaAvailable === 0 && inv.avgDailySales7d === 0)) return null;
    const totalLeadTime = (productionConfig?.productionTimeDays ?? 15) + (productionConfig?.shippingTimeDays ?? 30);
    const inboundCoverDays = inv.avgDailySales7d > 0 ? Math.round(inv.fbaInbound / inv.avgDailySales7d) : 0;
    const effectiveDays = inv.daysOfStock + inboundCoverDays;
    let status: string, label: string, color: string;
    if (inv.avgDailySales7d === 0 && inv.fbaAvailable === 0) {
      status = "stockout_risk"; label = "断货"; color = "red";
    } else if (effectiveDays <= 7) {
      status = "stockout_risk"; label = "断货风险"; color = "red";
    } else if (effectiveDays <= totalLeadTime) {
      status = "urgent"; label = "紧急备货"; color = "orange";
    } else if (effectiveDays <= totalLeadTime + 14) {
      status = "warning"; label = "需备货"; color = "amber";
    } else {
      status = "sufficient"; label = "充足"; color = "green";
    }
    return { status, label, color, effectiveDays, totalLeadTime };
  }, [product.inventory, productionConfig]);

  const statusColors: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-700",
    inactive: "bg-gray-100 text-gray-600",
    discontinued: "bg-red-100 text-red-700",
  };
  const statusLabels: Record<string, string> = {
    active: "在售", inactive: "暂停", discontinued: "停售",
  };

  return (
    <div className="border rounded-lg mb-3 overflow-hidden bg-card">
      {/* ═══ Product Info Header ═══ */}
      <div className="flex items-center gap-3 px-3 py-2.5 bg-muted/30 border-b cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}>
        <button className="shrink-0">
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </button>

        {/* Image */}
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" className="h-10 w-10 rounded object-cover shrink-0 border" />
        ) : (
          <div className="h-10 w-10 rounded bg-muted flex items-center justify-center shrink-0 border">
            <Package className="h-5 w-5 text-muted-foreground/50" />
          </div>
        )}

        {/* Title & ASIN */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{product.chineseName || product.title}</span>
            <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 shrink-0 ${statusColors[product.status] || ""}`}>
              {statusLabels[product.status] || product.status}
            </Badge>
            {(() => {
              const alerts = getProductAlerts(product);
              if (alerts.level === "danger") return (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 shrink-0 gap-0.5">
                  <AlertCircle className="h-2.5 w-2.5" />{alerts.count}项预警
                </Badge>
              );
              if (alerts.level === "warn") return (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 gap-0.5 border-amber-300 text-amber-600 bg-amber-50">
                  <AlertTriangle className="h-2.5 w-2.5" />{alerts.count}项关注
                </Badge>
              );
              return null;
            })()}
            <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 shrink-0">
              {product.marketplace || "US"}
            </Badge>
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 ${product.weeklySource === "mcp_parent_weekly" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
              {product.weeklySource === "mcp_parent_weekly" ? "ASIN周数据·系统父级汇总" : "ERP 历史"}
            </Badge>
            {product.weeklySource === "mcp_parent_weekly" && product.hasErpHistory && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-slate-200 text-slate-500">含ERP历史</Badge>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
            <span className="font-mono">{product.parentAsin}</span>
            {product.skus.length > 0 && <span>SKU: {product.skus.slice(0, 2).join(", ")}{product.skus.length > 2 ? ` +${product.skus.length - 2}` : ""}</span>}
            {product.storeName && <span className="flex items-center gap-0.5"><Store className="h-3 w-3" />{product.storeName}</span>}
            {bi?.listingDate && <span>上架: {bi.listingDate}</span>}
          </div>
        </div>

        {hasScopedSourceIdentity && <ProductCostSummary parentAsin={product.parentAsin} storeName={product.storeName!} country="US" name={product.chineseName || product.title} />}

        {/* Basic Info Pills */}
        <div className="flex items-center gap-4 shrink-0 text-xs" onClick={e => e.stopPropagation()}>
          {bi && (
            <>
              <div className="text-center">
                <div className="text-[10px] text-muted-foreground">售价</div>
                <div className="font-semibold">${parseFloat(bi.sellingPrice || "0").toFixed(2)}</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-muted-foreground">平手价</div>
                <div className="font-semibold">${parseFloat(bi.breakEvenPrice || "0").toFixed(2)}</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-muted-foreground">毛利润</div>
                <div className={`font-semibold ${parseFloat(bi.grossProfit || "0") >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  ${parseFloat(bi.grossProfit || "0").toFixed(2)}
                </div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-muted-foreground">毛利率</div>
                <div className={`font-semibold ${parseFloat(bi.grossMargin || "0") >= 20 ? "text-emerald-600" : parseFloat(bi.grossMargin || "0") >= 10 ? "text-amber-600" : "text-red-500"}`}>
                  {parseFloat(bi.grossMargin || "0").toFixed(1)}%
                </div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-muted-foreground">退货率</div>
                <div className="font-semibold">{parseFloat(bi.returnRate || "0").toFixed(1)}%</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-muted-foreground">评分</div>
                <div className="font-semibold">{parseFloat(bi.rating || "0").toFixed(1)}/{bi.reviewCount || 0}</div>
              </div>
            </>
          )}

          {canMaintainScopedOperations && <div className="min-h-16 w-[260px] shrink-0" onClick={e => e.stopPropagation()}>
            <p className="mb-0.5 text-[10px] text-muted-foreground">近6个月财务利润 · USD</p>
            {financialLoading ? <p className="text-xs text-muted-foreground">正在读取月报…</p> : financialError ? <p className="text-xs text-red-600">月报读取失败，请刷新重试</p> : <>
              <ResponsiveContainer width="100%" height={45}><LineChart data={profitTrend} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}><XAxis dataKey="month" interval={0} padding={{ left: 15, right: 15 }} tick={{ fontSize: 9 }} axisLine={false} tickLine={false} /><YAxis hide /><RechartsTooltip formatter={(value) => [value == null ? "未同步月报" : `$${Number(value).toFixed(2)}`, "财务利润"]} /><Line connectNulls={false} type="monotone" dataKey="financialProfit" name="财务利润" stroke="#7c3aed" strokeWidth={2} dot={{ r: 2 }} /></LineChart></ResponsiveContainer>
              {profitTrend.every(point => point.financialProfit === null) && <p className="text-[10px] text-muted-foreground">近6个月暂无可用月报</p>}
            </>}
          </div>
          }

          {hasScopedSourceIdentity && product.marketplace !== "ALL" && onViewFinancialReport && <Button variant="outline" size="sm" className="shrink-0 text-xs" aria-label={`查看 ${product.parentAsin} 已确认月报与分析`} onClick={onViewFinancialReport}>月报与利润分析</Button>}

          {/* Product Name (品名) */}
          {product.chineseName && (
            <div className="text-xs px-2 py-1 rounded bg-violet-50 border border-violet-200 text-violet-700 max-w-[160px] truncate" title={product.chineseName}>
              <span className="text-[10px] text-violet-400 mr-1">品名</span>{product.chineseName}
            </div>
          )}

          <span className="shrink-0 rounded border bg-blue-50 px-2 py-1 text-xs" title="按赛狐产品负责人及已确认的人员映射显示">
            <User className="mr-1 inline h-3 w-3" />{product.operator || "赛狐未提供负责人"}
          </span>

          {/* Actions */}
          <div className="flex items-center gap-1">
            {hasManagedProfile && <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" className={`h-7 w-7 p-0 ${isSyncing ? 'text-blue-500' : 'text-muted-foreground hover:text-blue-600'}`}
                    onClick={(e) => { e.stopPropagation(); onSync(product.id); }}
                    disabled={isSyncing || !hasManagedProfile}>
                    {isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{!hasManagedProfile ? '来源行尚未绑定产品档案' : isSyncing ? '同步中...' : '同步本产品数据'}</TooltipContent>
              </Tooltip>
            </TooltipProvider>}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
                    onClick={(e) => { e.stopPropagation(); onNavigate(product); }}>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>查看统一详情</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {hasManagedProfile && <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                    onClick={(e) => { e.stopPropagation(); if (confirm("确定删除该产品及其所有关联数据？")) onDelete(product.id); }} disabled={!hasManagedProfile}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{hasManagedProfile ? '删除产品' : '来源行尚未绑定产品档案'}</TooltipContent>
              </Tooltip>
            </TooltipProvider>}
          </div>
        </div>
      </div>

      {/* ═══ Weekly Data Table ═══ */}
      {expanded && (
        <div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-muted/20 border-b">
                {WEEKLY_COLS.map(col => (
                  <th key={col.key}
                    className={`px-1.5 py-1.5 ${col.w} text-${col.align} font-medium text-muted-foreground whitespace-nowrap ${col.sortable ? "cursor-pointer hover:text-foreground hover:bg-muted/40 select-none transition-colors" : ""}`}
                    onClick={col.sortable ? () => onSort(col.key as SortKey) : undefined}
                  >
                    <span className="inline-flex items-center gap-0.5">
                      {col.label}
                      {col.sortable && sortKey === col.key && (
                        sortDir === "desc"
                          ? <ArrowDown className="h-3 w-3 text-blue-600" />
                          : <ArrowUp className="h-3 w-3 text-blue-600" />
                      )}
                      {col.sortable && sortKey !== col.key && (
                        <ArrowUpDown className="h-2.5 w-2.5 text-muted-foreground/30" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Monthly summary rows (if available) */}
              {product.monthlySummaries.length > 0 && product.weeks.length > 0 && (() => {
                // Group weeks by month
                const monthGroups = new Map<string, typeof product.weeks>();
                product.weeks.forEach(w => {
                  const ym = w.weekStartDate.substring(0, 7); // "2026-04"
                  if (!monthGroups.has(ym)) monthGroups.set(ym, []);
                  monthGroups.get(ym)!.push(w);
                });

                const rows: React.ReactNode[] = [];
                const sortedMonths = Array.from(monthGroups.keys()).sort();

                sortedMonths.forEach(ym => {
                  const monthWeeks = monthGroups.get(ym)!;
                  const summary = product.monthlySummaries.find(m => m.yearMonth === ym);

                  // Month header row
                  const ymLabel = (() => {
                    const [y, m] = ym.split("-");
                    return `${parseInt(m)}月度汇总`;
                  })();
                  const fp = parseFloat(summary?.financialProfit || "0");
                  const op = parseFloat(summary?.orderProfitTotal || "0");

                  rows.push(
                    <tr key={`month-${ym}`} className="bg-emerald-50/60 border-b font-medium">
                      <td colSpan={5} className="px-1.5 py-1.5 text-left whitespace-nowrap">
                        <span className="text-emerald-800 font-semibold">{ymLabel}</span>
                        <span className="text-[10px] text-muted-foreground ml-2">务实际利润</span>
                        <span className={`ml-1 font-semibold ${fp >= 0 ? "text-emerald-700" : "text-red-600"}`}>{fmtCurrency(fp)}</span>
                      </td>
                      <td colSpan={3} className="px-1.5 py-1.5 text-left whitespace-nowrap">
                        <span className="text-[10px] text-muted-foreground">订单利润额</span>
                        <span className={`ml-1 font-semibold ${op >= 0 ? "text-emerald-700" : "text-red-600"}`}>{fmtCurrency(op)}</span>
                      </td>
                      <td colSpan={14} />
                    </tr>
                  );

                  // Weekly data rows for this month
                  monthWeeks.sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate)).forEach(w => {
                    rows.push(
                      <tr key={`week-${w.id}`} className="border-b hover:bg-muted/20 transition-colors">
                        <td className="px-1.5 py-1 text-left whitespace-nowrap">{fmtWeekDate(w.weekStartDate, w.weekEndDate)}</td>
                        <td className="px-1.5 py-1 text-center"><TrendBadge trend={w.salesTrend} /></td>
                        <td className="px-1.5 py-1 text-right tabular-nums">
                          {w.salesQty}
                          <WowArrow pct={w.wow?.salesQty.pct} />
                        </td>
                        <td className="px-1.5 py-1 text-right tabular-nums">{w.orderQty}</td>
                        <td className="px-1.5 py-1 text-right tabular-nums">
                          {fmtCurrency(w.salesAmount)}
                          <WowArrow pct={w.wow?.salesAmount.pct} />
                        </td>
                        <td className="px-1.5 py-1 text-right"><ProfitCell val={w.orderProfit} /></td>
                        <td className={`px-1.5 py-1 text-right tabular-nums ${alertCellBg(getAlertLevel("profitMargin", w.profitMargin ?? 0))}`}>
                          {fmtPct(w.profitMargin, 1)}
                        </td>
                        <td className="px-1.5 py-1 text-right tabular-nums">{w.sessionTotal}</td>
                        <td className="px-1.5 py-1 text-right tabular-nums"><MetricValue value={w.totalCvr} formatter={(value) => fmtPct(value, 1)} /></td>
                        <td className="px-1.5 py-1 text-right tabular-nums"><MetricValue value={w.adCvr} formatter={(value) => fmtPct(value, 1)} /></td>
                        <td className="px-1.5 py-1 text-right tabular-nums"><MetricValue value={w.organicCvr} formatter={(value) => fmtPct(value, 1)} /></td>
                        <td className="px-1.5 py-1 text-right tabular-nums">{w.adOrders}</td>
                        <td className="px-1.5 py-1 text-right tabular-nums">{w.organicOrders}</td>
                        <td className="px-1.5 py-1 text-right tabular-nums">{fmtNum(w.adClicks)}</td>
                        <td className="px-1.5 py-1 text-right tabular-nums"><MetricValue value={w.ctr} formatter={(value) => fmtPct(value, 2)} /></td>
                        <td className="px-1.5 py-1 text-right tabular-nums">{fmtNum(w.adImpressions)}</td>
                        <td className="px-1.5 py-1 text-right tabular-nums"><MetricValue value={w.cpc} formatter={fmtCurrency} /></td>
                        <td className="px-1.5 py-1 text-right tabular-nums">
                          {fmtCurrency(w.adSpend)}
                          <WowArrow pct={w.wow?.adSpend.pct} />
                        </td>
                        <td className={`px-1.5 py-1 text-right tabular-nums ${alertCellBg(getAlertLevel("acos", w.acos ?? 0))}`}>
                          <MetricValue value={w.acos} formatter={(value) => fmtPct(value, 1)} />
                        </td>
                        <td className="px-1.5 py-1 text-right tabular-nums"><MetricValue value={w.rating} formatter={(value) => value == null ? "—" : value.toFixed(1)} /></td>
                        <td className="px-1.5 py-1 text-right tabular-nums"><MetricValue value={w.reviewCount} formatter={fmtNum} /></td>
                        <td className={`px-1.5 py-1 text-right tabular-nums ${alertCellBg(getAlertLevel("returnRate", w.returnRate ?? 0))}`}>
                          <MetricValue value={w.returnRate} formatter={(value) => fmtPct(value, 1)} />
                        </td>
                      </tr>
                    );
                  });
                });

                return rows;
              })()}

              {/* If no monthly grouping, just show weeks directly */}
              {product.monthlySummaries.length === 0 && product.weeks.map(w => (
                <tr key={`week-${w.id}`} className="border-b hover:bg-muted/20 transition-colors">
                  <td className="px-1.5 py-1 text-left whitespace-nowrap">{fmtWeekDate(w.weekStartDate, w.weekEndDate)}</td>
                  <td className="px-1.5 py-1 text-center"><TrendBadge trend={w.salesTrend} /></td>
                  <td className="px-1.5 py-1 text-right tabular-nums">
                    {w.salesQty}
                    <WowArrow pct={w.wow?.salesQty.pct} />
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{w.orderQty}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">
                    {fmtCurrency(w.salesAmount)}
                    <WowArrow pct={w.wow?.salesAmount.pct} />
                  </td>
                  <td className="px-1.5 py-1 text-right"><ProfitCell val={w.orderProfit} /></td>
                  <td className={`px-1.5 py-1 text-right tabular-nums ${alertCellBg(getAlertLevel("profitMargin", w.profitMargin ?? 0))}`}>
                    {fmtPct(w.profitMargin, 1)}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{w.sessionTotal}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums"><MetricValue value={w.totalCvr} formatter={(value) => fmtPct(value, 1)} /></td>
                  <td className="px-1.5 py-1 text-right tabular-nums"><MetricValue value={w.adCvr} formatter={(value) => fmtPct(value, 1)} /></td>
                  <td className="px-1.5 py-1 text-right tabular-nums"><MetricValue value={w.organicCvr} formatter={(value) => fmtPct(value, 1)} /></td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{w.adOrders}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{w.organicOrders}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{fmtNum(w.adClicks)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums"><MetricValue value={w.ctr} formatter={(value) => fmtPct(value, 2)} /></td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{fmtNum(w.adImpressions)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums"><MetricValue value={w.cpc} formatter={fmtCurrency} /></td>
                  <td className="px-1.5 py-1 text-right tabular-nums">
                    {fmtCurrency(w.adSpend)}
                    <WowArrow pct={w.wow?.adSpend.pct} />
                  </td>
                  <td className={`px-1.5 py-1 text-right tabular-nums ${alertCellBg(getAlertLevel("acos", w.acos ?? 0))}`}>
                    <MetricValue value={w.acos} formatter={(value) => fmtPct(value, 1)} />
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums"><MetricValue value={w.rating} formatter={(value) => value == null ? "—" : value.toFixed(1)} /></td>
                  <td className="px-1.5 py-1 text-right tabular-nums"><MetricValue value={w.reviewCount} formatter={fmtNum} /></td>
                  <td className={`px-1.5 py-1 text-right tabular-nums ${alertCellBg(getAlertLevel("returnRate", w.returnRate ?? 0))}`}>
                    <MetricValue value={w.returnRate} formatter={(value) => fmtPct(value, 1)} />
                  </td>
                </tr>
              ))}

              {/* Empty state */}
              {product.weeks.length === 0 && (
                <tr>
                  <td colSpan={WEEKLY_COLS.length} className="px-4 py-6 text-center text-muted-foreground text-xs">
                    暂无周度数据，请先同步数据
                  </td>
                </tr>
              )}
            </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───
export default function OpsProducts() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [financialTarget, setFinancialTarget] = useState<ProductMonthlyFinancialTarget | null>(null);
  const isManagerOrAbove = user?.role && (MANAGER_ROLES as readonly string[]).includes(user.role);
  const marketplaceFilter = "ALL";
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState("active");

  // Mutations
  const utils = trpc.useUtils();
  const createMut = trpc.productOps.createProduct.useMutation({
    onSuccess: () => { utils.productOps.getProductOverviewWithWeeks.invalidate(); setShowCreate(false); resetForm(); toast.success("产品创建成功"); },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteMut = trpc.productOps.deleteProduct.useMutation({
    onSuccess: () => { utils.productOps.getProductOverviewWithWeeks.invalidate(); toast.success("产品已删除"); },
    onError: (e: any) => toast.error(e.message),
  });
  const batchAssignMut = trpc.productOps.batchAssignOperator.useMutation({
    onSuccess: (data) => {
      utils.productOps.getProductOverviewWithWeeks.invalidate();
      setSelectedIds(new Set());
      setShowBatchAssign(false);
      setBatchOperator("");
      toast.success(`已将${data.updated}个产品分配给 ${data.operator}`);
    },
    onError: (e: any) => toast.error(e.message),
  });
  const [syncingProductId, setSyncingProductId] = useState<number | null>(null);
  const { data: operatorList } = trpc.productOps.listOperators.useQuery();

  // State
  const [showCreate, setShowCreate] = useState(false);
  const [showBatchAssign, setShowBatchAssign] = useState(false);
  const [batchOperator, setBatchOperator] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [operatorFilter, setOperatorFilter] = useState("ALL");
  // Auto-lock operator filter for non-admin users to their own name
  useEffect(() => {
    if (user && !isManagerOrAbove && user.name) {
      setOperatorFilter(user.name);
    }
  }, [user, isManagerOrAbove]);
  const [storeFilter, setStoreFilter] = useState("ALL");
  const [sortKey, setSortKey] = useState<SortKey>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [weekFilter, setWeekFilter] = useState(4); // 1-4 weeks
  const [syncWeeks, setSyncWeeks] = useState(1); // weeks to sync: 1-26
  const [showSyncPopover, setShowSyncPopover] = useState(false);

  // Read the Sellfox projection for the current US/USD parent identities.
  const systemOverviewQuery = trpc.productOps.getProductOverviewWithWeeks.useQuery({
    marketplace: marketplaceFilter !== "ALL" ? marketplaceFilter : "all",
    statusFilter: "all",
    weeks: 4,
  }, { enabled: false });
  const {
    data: systemProducts,
    isLoading: systemLoading,
    isError: systemOverviewError,
    error: systemOverviewErrorDetail,
    refetch: refetchSystemOverview,
  } = systemOverviewQuery;

  // Import data query (lingxing or saihu)
  const { data: importProducts, isLoading: importLoading, error: importSourceError, refetch: refetchImportOverview } = trpc.dataImport.getProductOverviewFromImport.useQuery({
    sourceType: "saihu",
    consolidateNorthAmerica: true,
    weeks: 4,
    marketplace: marketplaceFilter !== "ALL" ? marketplaceFilter : "ALL",
  }, { staleTime: 120_000, retry: false, trpc: { context: { skipBatch: true } } });

  const monthlyFinancialQuery = trpc.northAmericaBoard.trends.useQuery(
    { expectedWorkspaceId: user?.defaultWorkspaceId ?? 0 },
    { enabled: !!user?.defaultWorkspaceId, staleTime: 300_000, retry: false, trpc: { context: { skipBatch: true } } },
  );
  const financialPayload = !monthlyFinancialQuery.isError && monthlyFinancialQuery.data?.identity.userId === user?.id
    && monthlyFinancialQuery.data?.identity.workspaceId === user?.defaultWorkspaceId ? monthlyFinancialQuery.data?.payload : null;
  useEffect(() => subscribeMonthlyFinancialChanges(notice => {
    if (notice.workspaceId === user?.defaultWorkspaceId) void utils.northAmericaBoard.trends.invalidate();
  }), [user?.defaultWorkspaceId, utils]);

  // Production config for inventory status
  const { data: productionConfigs } = trpc.dataImport.getProductionConfigs.useQuery({
    marketplace: marketplaceFilter !== "ALL" ? marketplaceFilter : "US",
  });

  // One Sellfox parent card includes US, CA and MX data converted to USD.
  const products = useMemo(() => {
    const primary: ProductOverview[] = [];
    const fallback = (importProducts || []) as ProductOverview[];
    return buildUnifiedProductOverview(primary, fallback);
  }, [importProducts]);
  const isLoading = importLoading;

  const [form, setForm] = useState({
    parentAsin: "", title: "", brand: "", category: "", marketplace: "US",
    budgetRevenue: "", budgetProfit: "", budgetAcos: "", notes: "",
    operator: "", storeName: "",
  });
  function resetForm() {
    setForm({ parentAsin: "", title: "", brand: "", category: "", marketplace: "US", budgetRevenue: "", budgetProfit: "", budgetAcos: "", notes: "", operator: "", storeName: "" });
  }

  useEffect(() => { setPage(0); }, [searchTerm, operatorFilter, storeFilter, statusFilter]);

  // Filtering + sorting
  const filtered = useMemo(() => {
    let list = (products || []) as ProductOverview[];
    if (operatorFilter === "__UNASSIGNED__") {
      list = list.filter(p => !p.operator);
    } else if (operatorFilter !== "ALL") {
      // Split multi-person operator field and check if the selected name is included
      list = list.filter(p => {
        const names = (p.operator || "").split(/[\/、,，]+/).map((s: string) => s.trim()).filter(Boolean);
        return names.includes(operatorFilter);
      });
    }
    if (statusFilter !== "ALL") list = list.filter(p => p.status === statusFilter);
    if (storeFilter !== "ALL") list = list.filter(p => (p.storeName || "") === storeFilter);
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.parentAsin.toLowerCase().includes(q) ||
        (p.brand || "").toLowerCase().includes(q) ||
        (p.operator || "").toLowerCase().includes(q) ||
        (p.storeName || "").toLowerCase().includes(q) ||
        (p.chineseName || "").toLowerCase().includes(q) ||
        p.skus.some(s => s.toLowerCase().includes(q))
      );
    }
    // Apply week filter: trim each product's weeks to the latest N
    list = list.map(p => {
      if (p.weeks.length <= weekFilter) return p;
      const sorted = [...p.weeks].sort((a, b) => b.weekStartDate.localeCompare(a.weekStartDate));
      return { ...p, weeks: sorted.slice(0, weekFilter).reverse() };
    });
    // Apply sorting by latest week value
    if (sortKey) {
      list = [...list].sort((a, b) => {
        const va = getLatestWeekValue(a, sortKey);
        const vb = getLatestWeekValue(b, sortKey);
        return sortDir === "asc" ? va - vb : vb - va;
      });
    }
    return list;
  }, [products, operatorFilter, statusFilter, storeFilter, searchTerm, weekFilter, sortKey, sortDir]);

  const availableOperators = useMemo(() => {
    const set = new Set<string>();
    (products || []).forEach(p => {
      if (!p.operator) return;
      // Split multi-person operator strings like "裴艺翔,康凡静" into individual names
      p.operator.split(/[\/、,，]+/).map((s: string) => s.trim()).filter(Boolean).forEach((name: string) => set.add(name));
    });
    return Array.from(set).sort();
  }, [products]);

  const availableStores = useMemo(() => {
    const set = new Set((products || []).map(p => p.storeName || "").filter(Boolean));
    return Array.from(set).sort();
  }, [products]);

  // Dynamic marketplace list from actual product data
  const availableMarketplaces = useMemo(() => {
    const set = new Set((products || []).map(p => p.marketplace || "").filter(Boolean));
    return Array.from(set).sort();
  }, [products]);

  // Summary stats
  const totalProducts = filtered.length;
  const activeProducts = filtered.filter(p => p.status === "active").length;

  return (
    <div className="space-y-4">
      {importSourceError && <section role="alert" className="space-y-2 rounded border border-amber-400 p-3 text-sm"><p>ERP 历史来源暂不可合并展示，不代表销量为零或没有产品。赛狐受控日数据与旧整周相交时，旧周总额不能拆分；请到受控同步页查看覆盖日、排除周及缺口。</p><Button variant="outline" onClick={() => navigate("/ops/data-import")}>查看赛狐日／月报受控来源</Button></section>}

      <ProductMonthlyFinancialDialog target={financialTarget} onClose={() => setFinancialTarget(null)} />
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2 text-xs text-blue-800">
        <Badge variant="outline" className="border-blue-200 bg-white text-blue-700">统一产品视图</Badge>
        <span>同一父ASIN仅显示一张美国站卡片；加拿大、墨西哥已按 USD 合并。赛狐按天数据汇总为周六至周五，同日重复导入只计一次。</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">产品运营总览</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            赛狐产品数据 · 美国站 USD（合并加拿大、墨西哥），同日重复导入只计一次。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1" onClick={() => navigate("/ops/data-import")}>
            <Upload className="h-3.5 w-3.5" /> 导入数据
          </Button>
          <Button variant="outline" onClick={() => navigate("/ops/saihu-sync")}><RefreshCw className="mr-2 h-4 w-4" />赛狐数据同步</Button>
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="h-4 w-4" /> 添加产品
          </Button>
        </div>
      </div>

      {/* Summary Bar */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1.5 bg-muted/50 rounded-lg px-3 py-1.5">
          <Package className="h-4 w-4 text-blue-600" />
          <span className="text-muted-foreground">总计</span>
          <span className="font-semibold">{totalProducts}</span>
          <span className="text-muted-foreground">个产品</span>
          <span className="text-muted-foreground mx-1">|</span>
          <span className="text-emerald-600 font-medium">{activeProducts} 在售</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索ASIN、标题、SKU、品牌、运营或店铺..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex items-center gap-1">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">美国站 · USD（含加拿大、墨西哥）</span>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[110px]">
            <SelectValue placeholder="状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部状态</SelectItem>
            <SelectItem value="active">在售</SelectItem>
            <SelectItem value="inactive">暂停</SelectItem>
            <SelectItem value="discontinued">停售</SelectItem>
          </SelectContent>
        </Select>
        {availableStores.length > 0 && (
          <div className="flex items-center gap-1">
            <Store className="h-4 w-4 text-muted-foreground" />
            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="店铺" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部店铺</SelectItem>
                {availableStores.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex items-center gap-1">
          <User className="h-4 w-4 text-muted-foreground" />
          <Select value={operatorFilter} onValueChange={setOperatorFilter} disabled={!isManagerOrAbove}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="运营" />
            </SelectTrigger>
            <SelectContent>
              {isManagerOrAbove && <SelectItem value="ALL">全部运营</SelectItem>}
              {isManagerOrAbove && <SelectItem value="__UNASSIGNED__">未分配</SelectItem>}
              {Array.from(new Set([...availableOperators, ...(operatorList || [])])).sort().map(o => (
                <SelectItem key={o} value={o}>{o}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* Week Filter */}
        <div className="flex items-center gap-1">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <Select value={String(weekFilter)} onValueChange={v => setWeekFilter(Number(v))}>
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="显示周数" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">最近1周</SelectItem>
              <SelectItem value="2">最近2周</SelectItem>
              <SelectItem value="3">最近3周</SelectItem>
              <SelectItem value="4">最近4周</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {/* Sort Indicator */}
        {sortKey && (
          <div className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1">
            <ArrowUpDown className="h-3.5 w-3.5 text-blue-600" />
            <span className="text-xs text-blue-700">
              按{WEEKLY_COLS.find(c => c.key === sortKey)?.label || sortKey}
              {sortDir === "desc" ? "↓" : "↑"}排序
            </span>
            <button className="text-blue-400 hover:text-blue-600 ml-1" onClick={() => setSortKey(null)}>×</button>
          </div>
        )}
      </div>

      {/* Batch Action Bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
          <CheckSquare className="h-4 w-4 text-blue-600" />
          <span className="text-sm text-blue-700 font-medium">已选择 {selectedIds.size} 个产品</span>
          {isManagerOrAbove && <Button variant="outline" size="sm" onClick={() => setShowBatchAssign(true)} className="gap-1">
            <Users className="h-3 w-3" />
            批量分配运营
          </Button>}
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
            取消选择
          </Button>
        </div>
      )}

      {/* ═══ Product Blocks ═══ */}
      {importSourceError ? (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertCircle className="h-10 w-10 text-amber-600" />
            <div className="space-y-1">
              <p className="font-medium text-amber-950">父ASIN周度数据暂时无法加载</p>
              <p className="max-w-xl text-sm text-amber-800">
                当前不会将请求失败显示为“0个产品”。请重试；若问题持续，请保留页面时间并联系管理员核对服务日志。
              </p>
              {importSourceError?.message && (
                <p className="text-xs text-amber-700">错误摘要：{importSourceError.message}</p>
              )}
            </div>
            <Button variant="outline" className="gap-2 border-amber-300 bg-white" onClick={() => void refetchImportOverview()}>
              <RefreshCw className="h-4 w-4" /> 重试加载
            </Button>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <Card key={i}>
              <CardContent className="p-4 space-y-3 animate-pulse">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-8 w-16" />
                </div>
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Package className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">
              {searchTerm || marketplaceFilter !== "ALL" || statusFilter !== "ALL"
                ? "没有找到匹配的产品"
                : "暂无产品数据，请在数据导入中心上传Excel，或添加人工产品档案"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-end gap-3 text-sm"><Button variant="outline" disabled={page === 0} onClick={() => setPage(value => value - 1)}>上一页</Button><span className="text-muted-foreground">每页 {PRODUCTS_PER_PAGE} 个产品</span><span>第 {Math.min(page, Math.max(0, Math.ceil(filtered.length / PRODUCTS_PER_PAGE) - 1)) + 1} / {Math.max(1, Math.ceil(filtered.length / PRODUCTS_PER_PAGE))} 页</span><Button variant="outline" disabled={(page + 1) * PRODUCTS_PER_PAGE >= filtered.length} onClick={() => setPage(value => value + 1)}>下一页</Button></div>
          {filtered.slice(Math.min(page, Math.max(0, Math.ceil(filtered.length / PRODUCTS_PER_PAGE) - 1)) * PRODUCTS_PER_PAGE, (Math.min(page, Math.max(0, Math.ceil(filtered.length / PRODUCTS_PER_PAGE) - 1)) + 1) * PRODUCTS_PER_PAGE).map(product => (
            <ProductBlock
              key={`${product.parentAsin}-${product.storeName || ""}-${product.marketplace || ""}`}
              product={product}
              onNavigate={(item) => {
                const query = new URLSearchParams();
                if (item.storeName) query.set("store", item.storeName);
                if (item.marketplace) query.set("country", item.marketplace);
                if (item.id > 0) query.set("productId", String(item.id));
                navigate(`/ops/products/view/${encodeURIComponent(item.parentAsin)}${query.size ? `?${query.toString()}` : ""}`);
              }}
              onDelete={(id) => deleteMut.mutate({ id })}
              onSync={() => navigate("/ops/saihu-sync")}
              isSyncing={false}
              isManagerOrAbove={Boolean(isManagerOrAbove)}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={(key) => {
                if (sortKey === key) {
                  setSortDir(d => d === "desc" ? "asc" : "desc");
                } else {
                  setSortKey(key);
                  setSortDir("desc");
                }
              }}
              productionConfig={productionConfigs?.[product.parentAsin]}
              profitTrend={buildProductFinancialTrend(financialPayload, product)}
              financialLoading={monthlyFinancialQuery.isLoading}
              financialError={monthlyFinancialQuery.isError}
              onViewFinancialReport={user?.defaultWorkspaceId && product.parentAsin && product.storeName && product.marketplace ? () => setFinancialTarget({ identity: { userId: user.id, workspaceId: user.defaultWorkspaceId! }, parentAsin: product.parentAsin, storeName: product.storeName!, country: product.marketplace! }) : undefined}
            />
          ))}
        </div>
      )}

      {/* Create Product Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>添加新产品</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>父ASIN *</Label>
                <Input placeholder="B0XXXXXXXX" value={form.parentAsin} onChange={e => setForm(f => ({ ...f, parentAsin: e.target.value }))} />
              </div>
              <div>
                <Label>站点</Label>
                <Select value={form.marketplace} onValueChange={v => setForm(f => ({ ...f, marketplace: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["US","UK","DE","JP","CA","FR","IT","ES","AU","MX"].map(m => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>产品标题 *</Label>
              <Input placeholder="输入产品标题" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>品牌</Label>
                <Input placeholder="品牌名称" value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} />
              </div>
              <div>
                <Label>类目</Label>
                <Input placeholder="产品类目" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>店铺名称</Label>
                <Input placeholder="所属店铺" value={form.storeName} onChange={e => setForm(f => ({ ...f, storeName: e.target.value }))} />
              </div>
              <div>
                <Label>运营负责人</Label>
                <Input placeholder="负责人姓名" value={form.operator} onChange={e => setForm(f => ({ ...f, operator: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>预算收入</Label>
                <Input type="number" placeholder="$" value={form.budgetRevenue} onChange={e => setForm(f => ({ ...f, budgetRevenue: e.target.value }))} />
              </div>
              <div>
                <Label>预算利润</Label>
                <Input type="number" placeholder="$" value={form.budgetProfit} onChange={e => setForm(f => ({ ...f, budgetProfit: e.target.value }))} />
              </div>
              <div>
                <Label>目标ACoS%</Label>
                <Input type="number" placeholder="%" value={form.budgetAcos} onChange={e => setForm(f => ({ ...f, budgetAcos: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>备注</Label>
              <Textarea placeholder="产品备注..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>取消</Button>
            <Button onClick={() => createMut.mutate(form)} disabled={!form.parentAsin || !form.title || createMut.isPending}>
              {createMut.isPending ? "创建中..." : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 批量分配运营 Dialog */}
      <Dialog open={showBatchAssign} onOpenChange={setShowBatchAssign}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-500" />
              批量分配运营负责人
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <p className="text-sm text-blue-700">已选择 <span className="font-bold">{selectedIds.size}</span> 个产品</p>
            </div>
            <div>
              <Label className="text-sm font-medium">选择团队成员</Label>
              <div className="mt-2 max-h-48 overflow-y-auto space-y-1 border rounded-lg p-2">
                {(operatorList || []).length > 0 ? (
                  (operatorList || []).map(name => (
                    <button key={name}
                      className={`w-full text-left text-sm px-3 py-2 rounded-md transition-colors flex items-center gap-2 ${
                        batchOperator === name ? "bg-blue-100 text-blue-700 font-medium ring-1 ring-blue-300" : "hover:bg-muted"
                      }`}
                      onClick={() => setBatchOperator(name)}
                    >
                      {batchOperator === name ? <UserCheck className="h-4 w-4" /> : <User className="h-4 w-4 text-muted-foreground" />}
                      {name}
                    </button>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-4">暂无团队成员</p>
                )}
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium">或输入新运营名称</Label>
              <Input className="mt-1" placeholder="输入新的运营名称..." value={batchOperator} onChange={e => setBatchOperator(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowBatchAssign(false); setBatchOperator(""); }}>取消</Button>
            <Button
              onClick={() => batchAssignMut.mutate({ productIds: Array.from(selectedIds), operator: batchOperator })}
              disabled={!batchOperator || batchAssignMut.isPending}
              className="gap-1"
            >
              {batchAssignMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              确认分配
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
