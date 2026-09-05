import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { MANAGER_ROLES } from "@shared/const";
import { buildUnifiedProductOverview } from "@shared/unifiedProductOverview";
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
function ProductBlock({ product, onNavigate, onDelete, onSync, isSyncing, operatorList, onAssign, sortKey, sortDir, onSort, productionConfig, planningRows, financialProfits = [], onSaveCostParameters, onSaveFinancialProfits }: {
  product: ProductOverview;
  onNavigate: (product: ProductOverview) => void;
  onDelete: (id: number) => void;
  onSync: (productId: number) => void;
  isSyncing: boolean;
  operatorList: string[];
  onAssign: (productId: number, operator: string) => void;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  productionConfig?: { productionTimeDays: number; shippingTimeDays: number; notes: string | null };
  planningRows?: any[];
  financialProfits?: any[];
  onSaveCostParameters?: (row: any, values: Record<string, string>) => void;
  onSaveFinancialProfits?: (parentAsin: string, entries: Array<{ yearMonth: string; financialProfit: number }>) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [assignOpen, setAssignOpen] = useState(false);
  const [newOp, setNewOp] = useState("");
  const [editingProduction, setEditingProduction] = useState(false);
  const [prodDays, setProdDays] = useState(productionConfig?.productionTimeDays ?? 15);
  const [shipDays, setShipDays] = useState(productionConfig?.shippingTimeDays ?? 30);
  const [costPanelOpen, setCostPanelOpen] = useState(false);
  const [costDrafts, setCostDrafts] = useState<Record<string, Record<string, string>>>({});
  const [financialProfitOpen, setFinancialProfitOpen] = useState(false);
  const [financialProfitDrafts, setFinancialProfitDrafts] = useState<Record<string, string>>({});
  const hasManagedProfile = product.id > 0;
  const bi = product.basicInfo;
  const profitTrend = useMemo(() => Array.from({ length: 6 }, (_, index) => {
    const date = new Date(); date.setMonth(date.getMonth() - 5 + index);
    const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const saved = financialProfits.find((item: any) => item.yearMonth === yearMonth);
    const value = financialProfitDrafts[yearMonth] ?? (saved?.financialProfit == null ? "" : String(saved.financialProfit));
    return { yearMonth, month: yearMonth.slice(2), financialProfit: value === "" ? null : Number(value) };
  }), [financialProfits, financialProfitDrafts]);
  const productPlanningRows = useMemo(() => (planningRows || []).filter((row: any) => row.parentAsin === product.parentAsin), [planningRows, product.parentAsin]);

  const getCostValue = (row: any, field: string) => costDrafts[row.asin]?.[field] ?? (row[field] == null ? "" : String(row[field]));
  const updateCostDraft = (asin: string, field: string, value: string) => {
    setCostDrafts(current => ({ ...current, [asin]: { ...(current[asin] || {}), [field]: value } }));
  };

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
              {product.weeklySource === "mcp_parent_weekly" ? "MCP 周报" : "ERP 历史"}
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

          {hasManagedProfile && <div className="h-14 w-[260px] shrink-0" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between"><p className="mb-0.5 text-[10px] text-muted-foreground">近6个月财务利润</p><button className="text-[10px] text-primary hover:underline" onClick={() => setFinancialProfitOpen(open => !open)}>填写</button></div>
            <ResponsiveContainer width="100%" height="100%"><LineChart data={profitTrend} margin={{ top: 0, right: 2, left: 2, bottom: 0 }}><XAxis dataKey="month" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} /><YAxis hide /><RechartsTooltip formatter={(value) => [value == null ? "待填写" : `$${Number(value).toFixed(2)}`, "财务利润"]} /><Line connectNulls type="monotone" dataKey="financialProfit" name="财务利润" stroke="#7c3aed" strokeWidth={2} dot={{ r: 2 }} /></LineChart></ResponsiveContainer>
          </div>
          }

          {/* Product Name (品名) */}
          {product.chineseName && (
            <div className="text-xs px-2 py-1 rounded bg-violet-50 border border-violet-200 text-violet-700 max-w-[160px] truncate" title={product.chineseName}>
              <span className="text-[10px] text-violet-400 mr-1">品名</span>{product.chineseName}
            </div>
          )}

          {/* Operator (运营负责人) */}
          {/* Operator display & assign popover */}
          {hasManagedProfile ? (() => {
            const assignedNames = (product.operator || "").split(/[\/、,，]+/).map((s: string) => s.trim()).filter(Boolean);
            return (
              <Popover open={assignOpen} onOpenChange={setAssignOpen}>
                <PopoverTrigger asChild>
                  <button className={`text-xs rounded px-2 py-1 transition-colors border ${
                    assignedNames.length > 0
                      ? "text-foreground bg-blue-50 border-blue-200 hover:bg-blue-100"
                      : "text-muted-foreground/60 bg-orange-50 border-orange-200 hover:bg-orange-100 italic"
                  }`}>
                    <User className="h-3 w-3 inline mr-1" />
                    {assignedNames.length > 0 ? assignedNames.join("/") : "分配运营"}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-52 p-2" align="end">
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">分配运营（可多选）</p>
                    <div className="max-h-40 overflow-y-auto space-y-0.5">
                      {operatorList.map((name: string) => {
                        const isAssigned = assignedNames.includes(name);
                        return (
                          <button key={name}
                            className={`w-full text-left text-xs px-2 py-1.5 rounded flex items-center gap-1.5 ${
                              isAssigned ? "bg-blue-100 text-blue-700 font-medium" : "hover:bg-muted"
                            }`}
                            onClick={() => {
                              onAssign(product.id, name);
                              // don't close — allow multi-select
                            }}
                          >
                            {isAssigned ? <UserCheck className="h-3 w-3" /> : <User className="h-3 w-3 text-muted-foreground" />}
                            {name}
                            {isAssigned && <span className="ml-auto text-[10px] text-blue-400">点击移除</span>}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex gap-1 pt-1 border-t">
                      <Input placeholder="新名称..." value={newOp} onChange={e => setNewOp(e.target.value)}
                        className="h-7 text-xs"
                        onKeyDown={e => { if (e.key === "Enter" && newOp.trim()) { onAssign(product.id, newOp.trim()); setNewOp(""); } }}
                      />
                      <Button size="sm" className="h-7 px-2" disabled={!newOp.trim()}
                        onClick={() => { onAssign(product.id, newOp.trim()); setNewOp(""); }}>
                        <UserPlus className="h-3 w-3" />
                      </Button>
                    </div>
                    <Button size="sm" variant="outline" className="w-full h-7 text-xs" onClick={() => setAssignOpen(false)}>完成</Button>
                  </div>
                </PopoverContent>
              </Popover>
            );
          })() : (
            <TooltipProvider><Tooltip><TooltipTrigger asChild><span className="text-xs rounded px-2 py-1 border text-muted-foreground bg-muted/40">未绑定档案</span></TooltipTrigger><TooltipContent>该周报来源行尚未绑定手工产品档案，不能执行负责人分配。</TooltipContent></Tooltip></TooltipProvider>
          )}

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
          {hasManagedProfile && financialProfitOpen && <section className="border-b bg-violet-50/50 px-3 py-2.5"><div className="flex items-center justify-between gap-3"><div><span className="text-xs font-semibold text-violet-800">最近6个月财务利润（USD）</span><span className="ml-2 text-[11px] text-muted-foreground">按月手动填写；仅用于本卡片财务利润趋势。</span></div><Button size="sm" className="h-7 text-[11px]" onClick={() => onSaveFinancialProfits?.(product.parentAsin, profitTrend.filter(item => item.financialProfit !== null).map(item => ({ yearMonth: item.yearMonth, financialProfit: item.financialProfit! })))}>保存财务利润</Button></div><div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">{profitTrend.map(item => <label key={item.yearMonth} className="text-[11px] text-muted-foreground">{item.yearMonth}<Input type="number" step="0.01" className="mt-1 h-7 text-xs" value={financialProfitDrafts[item.yearMonth] ?? (item.financialProfit == null ? "" : String(item.financialProfit))} placeholder="0.00" onChange={event => setFinancialProfitDrafts(current => ({ ...current, [item.yearMonth]: event.target.value }))} /></label>)}</div></section>}
          {hasManagedProfile && productPlanningRows.length > 0 && (
            <section className="border-b bg-slate-50/70 px-3 py-2.5">
              <button className="flex w-full items-center justify-between text-left" onClick={() => setCostPanelOpen(open => !open)}>
                <span>
                  <span className="text-xs font-semibold text-slate-700">产品基本信息（USD）</span>
                  <span className="ml-2 text-[11px] text-muted-foreground">按子 ASIN 维护；成本会同步用于库存规划和月度采购资金。</span>
                </span>
                {costPanelOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              </button>
              {costPanelOpen && (
                <div className="mt-2 overflow-x-auto rounded-md border bg-background">
                  <table className="w-full min-w-[1510px] text-[11px]">
                    <thead className="border-b bg-muted/40 text-muted-foreground">
                      <tr><th className="px-2 py-1.5 text-left">子 ASIN / SKU</th><th className="px-2 py-1.5 text-right">产品成本</th><th className="px-2 py-1.5 text-right">预估头程</th><th className="px-2 py-1.5 text-right">实际头程</th><th className="px-2 py-1.5 text-right">预估 FBA</th><th className="px-2 py-1.5 text-right">实际 FBA</th><th className="px-2 py-1.5 text-right">售价</th><th className="px-2 py-1.5 text-left">预估尺寸 (in/cm)</th><th className="px-2 py-1.5 text-left">实际尺寸 (in/cm)</th><th className="px-2 py-1.5 text-right">预估重量 (lb/kg)</th><th className="px-2 py-1.5 text-right">实际重量 (lb/kg)</th><th className="px-2 py-1.5 text-right">预估平手价</th><th className="px-2 py-1.5 text-right">实际平手价</th><th className="px-2 py-1.5 text-center">操作</th></tr>
                    </thead>
                    <tbody>
                      {productPlanningRows.map((row: any) => {
                        const toNumber = (field: string) => Number(getCostValue(row, field) || 0);
                        const sellingPrice = toNumber("sellingPrice");
                        const estimatedBreakEven = sellingPrice * 0.85 - toNumber("productCost") - toNumber("estimatedFirstLegCost") - toNumber("estimatedFbaFee");
                        const actualBreakEven = sellingPrice * 0.85 - toNumber("productCost") - toNumber("actualFirstLegCost") - toNumber("actualFbaFee");
                        const fields = [
                          ["productCost", "产品成本"], ["estimatedFirstLegCost", "预估头程"], ["actualFirstLegCost", "实际头程"], ["estimatedFbaFee", "预估 FBA"], ["actualFbaFee", "实际 FBA"], ["sellingPrice", "售价"],
                        ] as const;
                        return <tr key={`${row.asin}-${row.storeName}-${row.country}`} className="border-b last:border-0">
                          <td className="px-2 py-1.5"><div className="font-medium">{row.asin}</div><div className="text-muted-foreground">{row.sku || "—"}</div></td>
                          {fields.map(([field, label]) => <td key={field} className="px-1 py-1 text-right"><Input aria-label={`${row.asin}${label}`} type="number" min="0" step="0.01" className="h-7 w-[88px] text-right text-[11px]" value={getCostValue(row, field)} placeholder="0.00" onChange={event => updateCostDraft(row.asin, field, event.target.value)} /></td>)}
                          <td className="px-1 py-1"><Input aria-label={`${row.asin}预估尺寸`} className="h-7 w-[120px] text-[11px]" value={getCostValue(row, "estimatedDimensions")} placeholder="长×宽×高" onChange={event => updateCostDraft(row.asin, "estimatedDimensions", event.target.value)} /></td>
                          <td className="px-1 py-1"><Input aria-label={`${row.asin}实际尺寸`} className="h-7 w-[120px] text-[11px]" value={getCostValue(row, "actualDimensions")} placeholder="长×宽×高" onChange={event => updateCostDraft(row.asin, "actualDimensions", event.target.value)} /></td>
                          <td className="px-1 py-1 text-right"><Input aria-label={`${row.asin}预估重量`} type="number" min="0" step="0.001" className="h-7 w-[92px] text-right text-[11px]" value={getCostValue(row, "estimatedWeight")} placeholder="0.000" onChange={event => updateCostDraft(row.asin, "estimatedWeight", event.target.value)} /></td>
                          <td className="px-1 py-1 text-right"><Input aria-label={`${row.asin}实际重量`} type="number" min="0" step="0.001" className="h-7 w-[92px] text-right text-[11px]" value={getCostValue(row, "actualWeight")} placeholder="0.000" onChange={event => updateCostDraft(row.asin, "actualWeight", event.target.value)} /></td>
                          <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${estimatedBreakEven < 0 ? "text-red-600" : "text-emerald-700"}`}>${estimatedBreakEven.toFixed(2)}</td>
                          <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${actualBreakEven < 0 ? "text-red-600" : "text-emerald-700"}`}>${actualBreakEven.toFixed(2)}</td>
                          <td className="px-2 py-1 text-center"><Button size="sm" className="h-7 text-[11px]" onClick={() => onSaveCostParameters?.(row, costDrafts[row.asin] || {})}>保存</Button></td>
                        </tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
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
  const isManagerOrAbove = user?.role && (MANAGER_ROLES as readonly string[]).includes(user.role);
  const [marketplaceFilter, setMarketplaceFilter] = useState("ALL");
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
  const batchSyncWeeklyMut = trpc.productOps.batchSyncWeeklyOps.useMutation({
    onSuccess: (data) => {
      utils.productOps.getProductOverviewWithWeeks.invalidate();
      toast.success(`批量同步完成：${data.total}个产品，${data.synced}周数据已同步${data.errors > 0 ? `，${data.errors}个失败` : ""}`);
    },
    onError: (e: any) => toast.error("批量同步失败", { description: e.message }),
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
  const singleAssignMut = trpc.productOps.batchAssignOperator.useMutation({
    onSuccess: (data) => {
      utils.productOps.getProductOverviewWithWeeks.invalidate();
      toast.success(`已分配给 ${data.operator}`);
    },
    onError: (e: any) => toast.error(e.message),
  });
  const [syncingProductId, setSyncingProductId] = useState<number | null>(null);
  const syncSingleProductMut = trpc.productOps.syncWeeklyOpsFromLingxing.useMutation({
    onSuccess: (data) => {
      utils.productOps.getProductOverviewWithWeeks.invalidate();
      setSyncingProductId(null);
      toast.success(`同步完成：${data.syncedWeeks}周数据已更新`);
    },
    onError: (e: any) => {
      setSyncingProductId(null);
      toast.error("同步失败", { description: e.message });
    },
  });
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

  // The MCP parent-ASIN weeks are the primary facts; ERP is historical fallback.
  const { data: systemProducts, isLoading: systemLoading } = trpc.productOps.getProductOverviewWithWeeks.useQuery({
    marketplace: marketplaceFilter !== "ALL" ? marketplaceFilter : "all",
    statusFilter: "all",
    weeks: 4,
  });

  // Import data query (lingxing or saihu)
  const { data: importProducts, isLoading: importLoading } = trpc.dataImport.getProductOverviewFromImport.useQuery({
    sourceType: "erp",
    weeks: 4,
    marketplace: marketplaceFilter !== "ALL" ? marketplaceFilter : "ALL",
  });

  const { data: inventoryPlanning } = trpc.dataImport.getInventoryPlanningFromImport.useQuery({
    marketplace: marketplaceFilter,
  });
  const { data: monthlyFinancialProfits } = trpc.dataImport.getMonthlyFinancialProfits.useQuery();

  // Production config for inventory status
  const { data: productionConfigs } = trpc.dataImport.getProductionConfigs.useQuery({
    marketplace: marketplaceFilter !== "ALL" ? marketplaceFilter : "US",
  });

  const savePlanningParametersMut = trpc.dataImport.saveInventoryPlanningParameters.useMutation({
    onSuccess: () => {
      void utils.dataImport.getInventoryPlanningFromImport.invalidate();
      toast.success("产品基本信息已保存，平手价和采购成本已同步更新");
    },
    onError: (error) => toast.error("产品基本信息保存失败", { description: error.message }),
  });
  const saveMonthlyFinancialProfitsMut = trpc.dataImport.saveMonthlyFinancialProfits.useMutation({
    onSuccess: () => { void utils.dataImport.getMonthlyFinancialProfits.invalidate(); toast.success("财务利润已保存，趋势图已更新"); },
    onError: (error) => toast.error("财务利润保存失败", { description: error.message }),
  });

  // Same parent ASIN/store/site belongs to one card. MCP facts win for overlapping
  // natural weeks and ERP remains only as explicitly labelled historical fallback.
  const products = useMemo(() => {
    const primary = (systemProducts || []) as ProductOverview[];
    const fallback = (importProducts || []) as ProductOverview[];
    return buildUnifiedProductOverview(primary, fallback);
  }, [systemProducts, importProducts]);
  const isLoading = systemLoading || importLoading;

  const [form, setForm] = useState({
    parentAsin: "", title: "", brand: "", category: "", marketplace: "US",
    budgetRevenue: "", budgetProfit: "", budgetAcos: "", notes: "",
    operator: "", storeName: "",
  });
  function resetForm() {
    setForm({ parentAsin: "", title: "", brand: "", category: "", marketplace: "US", budgetRevenue: "", budgetProfit: "", budgetAcos: "", notes: "", operator: "", storeName: "" });
  }

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
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2 text-xs text-blue-800">
        <Badge variant="outline" className="border-blue-200 bg-white text-blue-700">统一产品视图</Badge>
        <span>同一父ASIN、店铺和站点仅显示一张卡片；MCP父ASIN自然周报优先，ERP仅补充未覆盖的历史周。</span>
        <Button variant="link" size="sm" className="h-auto px-0 text-xs text-blue-700" onClick={() => navigate("/ops/inventory")}>进入库存规划</Button>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">产品运营总览</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            权威周度来源：领星MCP父ASIN自然周报；ERP仅作为未覆盖历史的来源化参考。ASIN日数据用于单ASIN详情与库存规划，不参与本页周度累计。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1" onClick={() => navigate("/ops/data-import")}>
            <Upload className="h-3.5 w-3.5" /> 导入数据
          </Button>
          <Popover open={showSyncPopover} onOpenChange={setShowSyncPopover}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                disabled={batchSyncWeeklyMut.isPending}
                className="gap-2"
              >
                {batchSyncWeeklyMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {batchSyncWeeklyMut.isPending ? "同步中..." : "批量同步周度数据"}
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-4" align="end">
              <div className="space-y-3">
                <div>
                  <h4 className="font-medium text-sm">同步周数设置</h4>
                  <p className="text-xs text-muted-foreground mt-1">选择需要同步的历史数据周数，周数越多耗时越长</p>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={String(syncWeeks)} onValueChange={(v) => setSyncWeeks(Number(v))}>
                    <SelectTrigger className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">最近 1 周</SelectItem>
                      <SelectItem value="2">最近 2 周</SelectItem>
                      <SelectItem value="4">最近 4 周（1个月）</SelectItem>
                      <SelectItem value="8">最近 8 周（2个月）</SelectItem>
                      <SelectItem value="13">最近 13 周（1季度）</SelectItem>
                      <SelectItem value="26">最近 26 周（半年）</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {syncWeeks > 4 && (
                  <div className="flex items-start gap-1.5 text-xs text-amber-600 bg-amber-50 rounded-md px-2.5 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>同步 {syncWeeks} 周数据预计需要 {Math.ceil(syncWeeks * 0.5)} 分钟，请耐心等待</span>
                  </div>
                )}
                <Button
                  className="w-full gap-2"
                  onClick={() => {
                    setShowSyncPopover(false);
                    batchSyncWeeklyMut.mutate({ weeks: syncWeeks });
                  }}
                  disabled={batchSyncWeeklyMut.isPending}
                >
                  <RefreshCw className="h-4 w-4" />
                  开始同步 {syncWeeks} 周数据
                </Button>
              </div>
            </PopoverContent>
          </Popover>
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
          <Select value={marketplaceFilter} onValueChange={setMarketplaceFilter}>
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="站点" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">全部站点</SelectItem>
              {availableMarketplaces.map(m => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
      {isLoading ? (
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
          {filtered.map(product => (
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
              onSync={(id) => { setSyncingProductId(id); syncSingleProductMut.mutate({ productId: id }); }}
              isSyncing={syncingProductId === product.id && syncSingleProductMut.isPending}
              operatorList={[...(operatorList || [])]}
              onAssign={(pid, op) => {
                // Find current product to determine if operator is already assigned
                const prod = products?.find((p: any) => p.id === pid);
                const currentOps = (prod?.operator || "").split(/[\/、,，]+/).map((s: string) => s.trim()).filter(Boolean);
                const mode = currentOps.includes(op) ? "remove" : "add";
                singleAssignMut.mutate({ productIds: [pid], operator: op, mode });
              }}
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
              planningRows={inventoryPlanning?.rows || []}
              financialProfits={(monthlyFinancialProfits || []).filter((item: any) => item.parentAsin === product.parentAsin)}
              onSaveFinancialProfits={(parentAsin, entries) => saveMonthlyFinancialProfitsMut.mutate({ parentAsin, entries })}
              onSaveCostParameters={(row, values) => savePlanningParametersMut.mutate({
                scopeType: "asin",
                asin: row.asin,
                parentAsin: row.parentAsin,
                storeName: row.storeName,
                country: row.country,
                productionDays: Number(row.productionDays ?? 30),
                shippingDays: Number(row.shippingDays ?? 30),
                bufferDays: Number(row.bufferDays ?? 10),
                targetCoverDays: Number(row.targetCoverDays ?? 30),
                moq: Number(row.moq ?? 0),
                packSize: Number(row.packSize ?? 1),
                productCost: Number(values.productCost ?? row.productCost ?? 0),
                estimatedFirstLegCost: Number(values.estimatedFirstLegCost ?? row.estimatedFirstLegCost ?? 0),
                actualFirstLegCost: Number(values.actualFirstLegCost ?? row.actualFirstLegCost ?? 0),
                estimatedFbaFee: Number(values.estimatedFbaFee ?? row.estimatedFbaFee ?? 0),
                actualFbaFee: Number(values.actualFbaFee ?? row.actualFbaFee ?? 0),
                sellingPrice: Number(values.sellingPrice ?? row.sellingPrice ?? 0),
                estimatedDimensions: String(values.estimatedDimensions ?? row.estimatedDimensions ?? "") || undefined,
                actualDimensions: String(values.actualDimensions ?? row.actualDimensions ?? "") || undefined,
                estimatedWeight: values.estimatedWeight === "" ? undefined : Number(values.estimatedWeight ?? row.estimatedWeight ?? 0),
                actualWeight: values.actualWeight === "" ? undefined : Number(values.actualWeight ?? row.actualWeight ?? 0),
                dimensionUnit: "in",
                weightUnit: "lb",
                currency: "USD",
              })}
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
