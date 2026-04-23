import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
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
  AlertTriangle, AlertCircle, Database, Upload, FileSpreadsheet,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from "@/components/ui/tooltip";

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
function fmtCurrency(val: number) {
  if (Math.abs(val) >= 10000) return `$${(val / 1000).toFixed(1)}K`;
  return `$${val.toFixed(2)}`;
}
function fmtNum(val: number) {
  if (val >= 10000) return `${(val / 1000).toFixed(1)}K`;
  return val.toLocaleString();
}
function fmtPct(val: number, digits = 2) {
  return `${val.toFixed(digits)}%`;
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
  if (pct === null || pct === undefined) return null;
  if (Math.abs(pct) < 0.5) return <span className="text-[9px] text-gray-400 ml-0.5">-</span>;
  if (pct > 0) return <span className="text-[9px] text-emerald-600 ml-0.5 whitespace-nowrap">↑{Math.abs(pct).toFixed(0)}%</span>;
  return <span className="text-[9px] text-red-500 ml-0.5 whitespace-nowrap">↓{Math.abs(pct).toFixed(0)}%</span>;
}

function ProfitCell({ val }: { val: number }) {
  if (val < 0) return <span className="text-red-500 font-medium tabular-nums">({fmtCurrency(Math.abs(val))})</span>;
  return <span className="text-emerald-600 font-medium tabular-nums">{fmtCurrency(val)}</span>;
}

// ─── Alert Thresholds for Overview ───
type AlertLevel = "normal" | "warn" | "danger";

function getAlertLevel(key: string, value: number): AlertLevel {
  if (isNaN(value)) return "normal";
  if (key === "acos") {
    if (value > 30) return "danger";
    if (value > 25) return "warn";
  } else if (key === "profitMargin") {
    if (value < 10 && value !== 0) return "danger";
    if (value < 15 && value !== 0) return "warn";
  } else if (key === "returnRate") {
    if (value > 5) return "danger";
    if (value > 3) return "warn";
  }
  return "normal";
}

function alertCellBg(level: AlertLevel): string {
  if (level === "danger") return "bg-red-100 text-red-700 font-semibold";
  if (level === "warn") return "bg-amber-50 text-amber-700";
  return "";
}

function getProductAlerts(product: { weeks: Array<{ acos: number; profitMargin: number; returnRate: number }> }): { level: AlertLevel; count: number; labels: string[] } {
  if (!product.weeks.length) return { level: "normal", count: 0, labels: [] };
  const latest = [...product.weeks].sort((a: any, b: any) => (b.weekStartDate || "").localeCompare(a.weekStartDate || ""))[0];
  const labels: string[] = [];
  let maxLevel: AlertLevel = "normal";
  const acosL = getAlertLevel("acos", latest.acos);
  if (acosL !== "normal") { labels.push(`ACOS ${latest.acos.toFixed(0)}%`); maxLevel = acosL === "danger" ? "danger" : ["danger","warn"].includes(maxLevel) ? maxLevel : "warn"; }
  const profitL = getAlertLevel("profitMargin", latest.profitMargin);
  if (profitL !== "normal") { labels.push(`利润率 ${latest.profitMargin.toFixed(0)}%`); maxLevel = profitL === "danger" ? "danger" : ["danger","warn"].includes(maxLevel) ? maxLevel : "warn"; }
  const returnL = getAlertLevel("returnRate", latest.returnRate);
  if (returnL !== "normal") { labels.push(`退货率 ${latest.returnRate.toFixed(1)}%`); maxLevel = returnL === "danger" ? "danger" : ["danger","warn"].includes(maxLevel) ? maxLevel : "warn"; }
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
  weeks: Array<{
    id: number;
    weekStartDate: string;
    weekEndDate: string;
    salesTrend: string | null;
    salesQty: number;
    orderQty: number;
    salesAmount: number;
    orderProfit: number;
    profitMargin: number;
    sessionTotal: number;
    totalCvr: number;
    adCvr: number;
    organicCvr: number;
    adOrders: number;
    organicOrders: number;
    adClicks: number;
    ctr: number;
    adImpressions: number;
    cpc: number;
    adSpend: number;
    acos: number;
    rating: number;
    reviewCount: number;
    returnRate: number;
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
function ProductBlock({ product, onNavigate, onNavigateImport, onDelete, onSync, isSyncing, operatorList, onAssign, sortKey, sortDir, onSort, isImportMode }: {
  product: ProductOverview;
  onNavigate: (id: number) => void;
  onNavigateImport?: (parentAsin: string) => void;
  onDelete: (id: number) => void;
  onSync: (productId: number) => void;
  isSyncing: boolean;
  operatorList: string[];
  onAssign: (productId: number, operator: string) => void;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  isImportMode?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [assignOpen, setAssignOpen] = useState(false);
  const [newOp, setNewOp] = useState("");
  const bi = product.basicInfo;

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

          {/* Product Name (品名) */}
          {product.chineseName && (
            <div className="text-xs px-2 py-1 rounded bg-violet-50 border border-violet-200 text-violet-700 max-w-[160px] truncate" title={product.chineseName}>
              <span className="text-[10px] text-violet-400 mr-1">品名</span>{product.chineseName}
            </div>
          )}

          {/* Operator (运营负责人) */}
          <Popover open={assignOpen} onOpenChange={setAssignOpen}>
            <PopoverTrigger asChild>
              <button className={`text-xs rounded px-2 py-1 transition-colors border ${
                product.operator
                  ? "text-foreground bg-blue-50 border-blue-200 hover:bg-blue-100"
                  : "text-muted-foreground/60 bg-orange-50 border-orange-200 hover:bg-orange-100 italic"
              }`}>
                <User className="h-3 w-3 inline mr-1" />
                {product.operator || "分配运营"}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-2" align="end">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">分配运营</p>
                <div className="max-h-32 overflow-y-auto space-y-0.5">
                  {operatorList.map(name => (
                    <button key={name}
                      className={`w-full text-left text-xs px-2 py-1.5 rounded flex items-center gap-1.5 ${
                        product.operator === name ? "bg-blue-100 text-blue-700 font-medium" : "hover:bg-muted"
                      }`}
                      onClick={() => { onAssign(product.id, name); setAssignOpen(false); }}
                    >
                      {product.operator === name ? <UserCheck className="h-3 w-3" /> : <User className="h-3 w-3 text-muted-foreground" />}
                      {name}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1 pt-1 border-t">
                  <Input placeholder="新名称..." value={newOp} onChange={e => setNewOp(e.target.value)}
                    className="h-7 text-xs"
                    onKeyDown={e => { if (e.key === "Enter" && newOp.trim()) { onAssign(product.id, newOp.trim()); setAssignOpen(false); setNewOp(""); } }}
                  />
                  <Button size="sm" className="h-7 px-2" disabled={!newOp.trim()}
                    onClick={() => { onAssign(product.id, newOp.trim()); setAssignOpen(false); setNewOp(""); }}>
                    <UserPlus className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Actions */}
          <div className="flex items-center gap-1">
            {!isImportMode && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" className={`h-7 w-7 p-0 ${isSyncing ? 'text-blue-500' : 'text-muted-foreground hover:text-blue-600'}`}
                    onClick={(e) => { e.stopPropagation(); onSync(product.id); }}
                    disabled={isSyncing}>
                    {isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{isSyncing ? '同步中...' : '同步本产品数据'}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            )}
            {!isImportMode && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
                    onClick={(e) => { e.stopPropagation(); onNavigate(product.id); }}>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>查看详情</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            )}
            {isImportMode && onNavigateImport && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-500 hover:text-blue-700"
                    onClick={(e) => { e.stopPropagation(); onNavigateImport(product.parentAsin); }}>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>查看详情（导入数据）</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            )}
            {!isImportMode && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                    onClick={(e) => { e.stopPropagation(); if (confirm("确定删除该产品及其所有关联数据？")) onDelete(product.id); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>删除产品</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Weekly Data Table ═══ */}
      {expanded && (
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
                        <td className={`px-1.5 py-1 text-right tabular-nums ${alertCellBg(getAlertLevel("profitMargin", w.profitMargin))}`}>
                          {fmtPct(w.profitMargin, 1)}
                        </td>
                        <td className="px-1.5 py-1 text-right tabular-nums">{w.sessionTotal}</td>
                        <td className="px-1.5 py-1 text-right tabular-nums">{fmtPct(w.totalCvr, 1)}</td>
                        <td className="px-1.5 py-1 text-right tabular-nums">{fmtPct(w.adCvr, 1)}</td>
                        <td className="px-1.5 py-1 text-right tabular-nums">{fmtPct(w.organicCvr, 1)}</td>
                        <td className="px-1.5 py-1 text-right tabular-nums">{w.adOrders}</td>
                        <td className="px-1.5 py-1 text-right tabular-nums">{w.organicOrders}</td>
                        <td className="px-1.5 py-1 text-right tabular-nums">{fmtNum(w.adClicks)}</td>
                        <td className="px-1.5 py-1 text-right tabular-nums">{fmtPct(w.ctr, 2)}</td>
                        <td className="px-1.5 py-1 text-right tabular-nums">{fmtNum(w.adImpressions)}</td>
                        <td className="px-1.5 py-1 text-right tabular-nums">{fmtCurrency(w.cpc)}</td>
                        <td className="px-1.5 py-1 text-right tabular-nums">
                          {fmtCurrency(w.adSpend)}
                          <WowArrow pct={w.wow?.adSpend.pct} />
                        </td>
                        <td className={`px-1.5 py-1 text-right tabular-nums ${alertCellBg(getAlertLevel("acos", w.acos))}`}>
                          {fmtPct(w.acos, 1)}
                        </td>
                        <td className="px-1.5 py-1 text-right tabular-nums">{w.rating.toFixed(1)}</td>
                        <td className="px-1.5 py-1 text-right tabular-nums">{w.reviewCount}</td>
                        <td className={`px-1.5 py-1 text-right tabular-nums ${alertCellBg(getAlertLevel("returnRate", w.returnRate))}`}>
                          {fmtPct(w.returnRate, 1)}
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
                  <td className={`px-1.5 py-1 text-right tabular-nums ${alertCellBg(getAlertLevel("profitMargin", w.profitMargin))}`}>
                    {fmtPct(w.profitMargin, 1)}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{w.sessionTotal}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{fmtPct(w.totalCvr, 1)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{fmtPct(w.adCvr, 1)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{fmtPct(w.organicCvr, 1)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{w.adOrders}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{w.organicOrders}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{fmtNum(w.adClicks)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{fmtPct(w.ctr, 2)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{fmtNum(w.adImpressions)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{fmtCurrency(w.cpc)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">
                    {fmtCurrency(w.adSpend)}
                    <WowArrow pct={w.wow?.adSpend.pct} />
                  </td>
                  <td className={`px-1.5 py-1 text-right tabular-nums ${alertCellBg(getAlertLevel("acos", w.acos))}`}>
                    {fmtPct(w.acos, 1)}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{w.rating.toFixed(1)}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums">{w.reviewCount}</td>
                  <td className={`px-1.5 py-1 text-right tabular-nums ${alertCellBg(getAlertLevel("returnRate", w.returnRate))}`}>
                    {fmtPct(w.returnRate, 1)}
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
      )}
    </div>
  );
}

type DataSource = "system" | "lingxing" | "saihu";

// ─── Main Component ───
export default function OpsProducts() {
  const [, navigate] = useLocation();
  const [marketplaceFilter, setMarketplaceFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("active");
  const [dataSource, setDataSource] = useState<DataSource>("lingxing");

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
  const syncMut = trpc.productOps.syncFromLingxing.useMutation({
    onSuccess: (data) => {
      utils.productOps.getProductOverviewWithWeeks.invalidate();
      toast.success(`同步完成：新增${data.synced}个，更新${data.updated}个，共${data.total}个产品`);
    },
    onError: (e: any) => toast.error("同步失败", { description: e.message }),
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

  // Operator name mappings - used to show mapping status in filter dropdown
  const { data: mappingsList } = trpc.operatorMapping.listMappings.useQuery(undefined, {
    enabled: dataSource !== "system",
  });

  // State
  const [showCreate, setShowCreate] = useState(false);
  const [showBatchAssign, setShowBatchAssign] = useState(false);
  const [batchOperator, setBatchOperator] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [operatorFilter, setOperatorFilter] = useState("ALL");
  const [storeFilter, setStoreFilter] = useState("ALL");
  const [newOperatorName, setNewOperatorName] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [weekFilter, setWeekFilter] = useState(4); // 1-4 weeks
  const [syncWeeks, setSyncWeeks] = useState(1); // weeks to sync: 1-26
  const [showSyncPopover, setShowSyncPopover] = useState(false);

  // Main query - system data (original)
  const { data: systemProducts, isLoading: systemLoading } = trpc.productOps.getProductOverviewWithWeeks.useQuery({
    marketplace: marketplaceFilter !== "ALL" ? marketplaceFilter : "all",
    statusFilter: statusFilter !== "ALL" ? statusFilter as any : "all",
    weeks: 4,
  }, { enabled: dataSource === "system" });

  // Import data query (lingxing or saihu)
  const { data: importProducts, isLoading: importLoading } = trpc.dataImport.getProductOverviewFromImport.useQuery({
    sourceType: dataSource === "saihu" ? "saihu" : "lingxing",
    weeks: 4,
    marketplace: marketplaceFilter !== "ALL" ? marketplaceFilter : "ALL",
  }, { enabled: dataSource !== "system" });

  // Import stats for showing data availability
  const { data: importStats } = trpc.dataImport.getImportStats.useQuery();

  // Unified products & loading state
  const products = dataSource === "system" ? systemProducts : importProducts;
  const isLoading = dataSource === "system" ? systemLoading : importLoading;

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
      list = list.filter(p => (p.operator || "") === operatorFilter);
    }
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
  }, [products, operatorFilter, storeFilter, searchTerm, weekFilter, sortKey, sortDir]);

  const availableOperators = useMemo(() => {
    const set = new Set((products || []).map(p => p.operator || "").filter(Boolean));
    return Array.from(set).sort();
  }, [products]);

  // Build a set of mapped system user names for the current data source
  const mappedSystemNames = useMemo(() => {
    if (!mappingsList || dataSource === "system") return new Set<string>();
    return new Set(
      mappingsList
        .filter(m => m.sourceType === (dataSource === "saihu" ? "saihu" : "lingxing") || m.sourceType === "all")
        .map(m => m.systemUserName)
        .filter(Boolean)
    );
  }, [mappingsList, dataSource]);

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
      {/* Data Source Tabs */}
      <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg w-fit">
        <button
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            dataSource === "system" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setDataSource("system")}
        >
          <Database className="h-3.5 w-3.5" />
          系统数据
        </button>
        <button
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            dataSource === "lingxing" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setDataSource("lingxing")}
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />
          领星数据
          {importStats?.lingxing && importStats.lingxing.weekCount > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-0.5">
              {importStats.lingxing.weekCount}周 / {importStats.lingxing.productCount}品
            </Badge>
          )}
        </button>
        <button
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            dataSource === "saihu" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setDataSource("saihu")}
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />
          赛狐数据
          {importStats?.saihu && importStats.saihu.weekCount > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-0.5">
              {importStats.saihu.weekCount}周 / {importStats.saihu.productCount}品
            </Badge>
          )}
        </button>
      </div>

      {/* No Import Data Hint */}
      {dataSource !== "system" && !isLoading && (!products || (products as any[]).length === 0) && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <Upload className="h-5 w-5 text-amber-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800">
              {dataSource === "lingxing" ? "暂无领星导入数据" : "暂无赛狐导入数据"}
            </p>
            <p className="text-xs text-amber-600 mt-0.5">
              请先在"数据导入中心"上传{dataSource === "lingxing" ? "领星产品表现" : "赛狐产品分析"}的Excel文件
            </p>
          </div>
          <Button variant="outline" size="sm" className="shrink-0 gap-1" onClick={() => navigate("/ops/data-import")}>
            <Upload className="h-3.5 w-3.5" /> 去导入
          </Button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">产品运营总览</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {dataSource === "system" ? "按父ASIN维度管理，展示最近4周周度数据及同比变化" :
             dataSource === "lingxing" ? "基于领星导入数据，按父ASIN维度展示最近4周周度数据" :
             "基于赛狐导入数据，按父ASIN聚合展示最近4周周度数据"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dataSource !== "system" && (
            <Button variant="outline" size="sm" className="gap-1" onClick={() => navigate("/ops/data-import")}>
              <Upload className="h-3.5 w-3.5" /> 导入数据
            </Button>
          )}
          {dataSource === "system" && (<Popover open={showSyncPopover} onOpenChange={setShowSyncPopover}>
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
          </Popover>)}
          {dataSource === "system" && (
            <>
              <Button
                variant="outline"
                onClick={() => syncMut.mutate()}
                disabled={syncMut.isPending}
                className="gap-2"
              >
                {syncMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {syncMut.isPending ? "同步中..." : "从领星同步"}
              </Button>
              <Button onClick={() => setShowCreate(true)} className="gap-2">
                <Plus className="h-4 w-4" /> 添加产品
              </Button>
            </>
          )}
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
          <Select value={operatorFilter} onValueChange={setOperatorFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="运营" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">全部运营</SelectItem>
              <SelectItem value="__UNASSIGNED__">未分配</SelectItem>
              {(() => {
                if (dataSource === "system") {
                  // System mode: show operators from data + system user list
                  const allOps = new Set<string>();
                  availableOperators.forEach(o => allOps.add(o));
                  (operatorList || []).forEach((o: string) => allOps.add(o));
                  return Array.from(allOps).sort().map(o => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ));
                } else {
                  // Import mode: only show system users (mapped names), not raw imported names
                  const systemUsers = new Set<string>();
                  (operatorList || []).forEach((o: string) => systemUsers.add(o));
                  // Also add mapped names that appear in the data
                  availableOperators.forEach(o => {
                    if (mappedSystemNames.has(o)) systemUsers.add(o);
                  });
                  return Array.from(systemUsers).sort().map(o => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ));
                }
              })()}
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
          <Button variant="outline" size="sm" onClick={() => setShowBatchAssign(true)} className="gap-1">
            <Users className="h-3 w-3" />
            批量分配运营
          </Button>
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
                : dataSource === "system" ? "还没有添加产品，点击\"从领星同步\"或\"添加产品\"开始"
                : `暂无${dataSource === "lingxing" ? "领星" : "赛狐"}导入数据，请先在数据导入中心上传Excel文件`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(product => (
            <ProductBlock
              key={product.id}
              product={product}
              onNavigate={(id) => navigate(`/ops/products/${id}`)}
              onNavigateImport={(parentAsin) => navigate(`/ops/products/import/${dataSource}/${encodeURIComponent(parentAsin)}`)}
              onDelete={(id) => deleteMut.mutate({ id })}
              onSync={(id) => { setSyncingProductId(id); syncSingleProductMut.mutate({ productId: id }); }}
              isSyncing={syncingProductId === product.id && syncSingleProductMut.isPending}
              operatorList={[...(operatorList || [])]}
              onAssign={(pid, op) => singleAssignMut.mutate({ productIds: [pid], operator: op })}
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
              isImportMode={dataSource !== "system"}
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
