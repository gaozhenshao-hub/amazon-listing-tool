import { useState, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import OpsProductPlan from "./OpsProductPlan";
import OpsProductConversion from "./OpsProductConversion";
import OpsProductReview from "./OpsProductReview";
import OpsProductTeam from "./OpsProductTeam";
import ProductWeeklyOpsTable from "./ProductWeeklyOpsTable";
import AdKeywordTracking from "./AdKeywordTracking";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowLeft, Plus, Trash2, CheckCircle2, Clock, AlertTriangle,
  TrendingUp, TrendingDown, Package, DollarSign, Target, Eye,
  Search, BarChart3, Edit2, MessageSquare, Flag, Milestone,
  AlertCircle, FileText, Loader2, Bell, BellOff, RefreshCw, Info, WifiOff,
  Database,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Legend,
  BarChart, Bar, ComposedChart, Area,
} from "recharts";

// ─── Helper: format number ───
function fmtNum(v: number | null | undefined, decimals = 0): string {
  if (v == null || isNaN(v)) return "-";
  return v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtPct(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "-";
  return `${v.toFixed(1)}%`;
}
function fmtWeekRange(start: string, end: string): string {
  const s = start.replace(/^\d{4}-/, "").replace(/-/g, "/");
  const e = end.replace(/^\d{4}-/, "").replace(/-/g, "/");
  return `${s}-${e}`;
}

// ─── WoW change badge ───
function WowBadge({ wow }: { wow: { value: number; pct: number | null } | null | undefined }) {
  if (!wow || wow.pct == null) return null;
  const isUp = wow.pct > 0;
  const color = isUp ? "text-emerald-600" : wow.pct < 0 ? "text-red-600" : "text-gray-500";
  return (
    <span className={`text-[10px] ${color} flex items-center gap-0.5`}>
      {isUp ? <TrendingUp className="h-3 w-3" /> : wow.pct < 0 ? <TrendingDown className="h-3 w-3" /> : null}
      {wow.pct > 0 ? "+" : ""}{wow.pct.toFixed(1)}%
    </span>
  );
}

export default function OpsProductDetail() {
  // ─── Route Matching: detect import mode vs system mode ───
  const [isImportRoute, importParams] = useRoute("/ops/products/import/:source/:parentAsin");
  const [isSystemRoute, systemParams] = useRoute("/ops/products/:id");
  const [, navigate] = useLocation();

  const isImportMode = !!isImportRoute;
  const sourceType = importParams?.source as "lingxing" | "saihu" | undefined;
  const importParentAsin = importParams?.parentAsin ? decodeURIComponent(importParams.parentAsin) : undefined;
  const productId = isSystemRoute ? Number(systemParams?.id) : 0;

  // ─── Import Mode Data Query ───
  const { data: importDetail, isLoading: loadingImport } = trpc.dataImport.getProductDetailFromImport.useQuery(
    { parentAsin: importParentAsin || "", sourceType: sourceType || "lingxing", marketplace: "ALL" },
    { enabled: isImportMode && !!importParentAsin && !!sourceType }
  );

  // ─── System Mode Data Queries ───
  const { data: product, isLoading: loadingProduct, refetch: refetchProduct } = trpc.productOps.getProduct.useQuery(
    { id: productId }, { enabled: !isImportMode && !!productId }
  );
  const { data: profitData, isLoading: loadingProfit, error: profitError, refetch: refetchProfit, isFetching: fetchingProfit } = trpc.productOps.getProductProfitSummary.useQuery(
    { productId }, { enabled: !isImportMode && !!productId, retry: 1 }
  );
  const { data: inventoryData, isLoading: loadingInventory, error: inventoryError, refetch: refetchInventory, isFetching: fetchingInventory } = trpc.productOps.getProductInventorySummary.useQuery(
    { productId }, { enabled: !isImportMode && !!productId, retry: 1 }
  );
  const { data: adsData, isLoading: loadingAds, error: adsError, refetch: refetchAds, isFetching: fetchingAds } = trpc.productOps.getProductAdsSummary.useQuery(
    { productId }, { enabled: !isImportMode && !!productId, retry: 1 }
  );
  const { data: todos, refetch: refetchTodos } = trpc.productOps.getTodos.useQuery(
    { productId }, { enabled: !isImportMode && !!productId }
  );
  const { data: logs, refetch: refetchLogs } = trpc.productOps.getLogs.useQuery(
    { productId }, { enabled: !isImportMode && !!productId }
  );
  const { data: competitors } = trpc.productOps.getProductCompetitors.useQuery(
    { productId }, { enabled: !isImportMode && !!productId }
  );
  const { data: keywordMonitorsData, refetch: refetchKeywords } = trpc.productOps.getKeywordMonitors.useQuery(
    { productId }, { enabled: !isImportMode && !!productId }
  );

  // ─── Mutations (system mode only) ───
  const createTodo = trpc.productOps.createTodo.useMutation({
    onSuccess: () => { refetchTodos(); setShowAddTodo(false); setTodoForm({ title: "", priority: "medium", dueDate: "", assignee: "", reminderDays: [1], reminderEnabled: true }); },
  });
  const updateTodo = trpc.productOps.updateTodo.useMutation({ onSuccess: () => refetchTodos() });
  const deleteTodo = trpc.productOps.deleteTodo.useMutation({ onSuccess: () => refetchTodos() });
  const createLog = trpc.productOps.createLog.useMutation({
    onSuccess: () => { refetchLogs(); setLogContent(""); },
  });
  const deleteLog = trpc.productOps.deleteLog.useMutation({ onSuccess: () => refetchLogs() });
  const addKeyword = trpc.productOps.addKeywordMonitor.useMutation({
    onSuccess: () => { refetchKeywords(); setShowAddKeyword(false); setKwForm({ keyword: "", keywordCn: "", targetAsin: "", matchType: "exact" }); },
  });
  const removeKeyword = trpc.productOps.removeKeywordMonitor.useMutation({ onSuccess: () => refetchKeywords() });
  const addVariant = trpc.productOps.addVariant.useMutation({
    onSuccess: () => { refetchProduct(); setShowAddVariant(false); setVariantForm({ childAsin: "", sku: "", title: "", price: "" }); },
  });

  // ─── Local State ───
  const [showAddTodo, setShowAddTodo] = useState(false);
  const [showAddKeyword, setShowAddKeyword] = useState(false);
  const [showAddVariant, setShowAddVariant] = useState(false);
  const [todoForm, setTodoForm] = useState({ title: "", priority: "medium", dueDate: "", assignee: "", reminderDays: [1] as number[], reminderEnabled: true });
  const [logContent, setLogContent] = useState("");
  const [logType, setLogType] = useState<string>("note");
  const [kwForm, setKwForm] = useState({ keyword: "", keywordCn: "", targetAsin: "", matchType: "exact" });
  const [variantForm, setVariantForm] = useState({ childAsin: "", sku: "", title: "", price: "" });

  // Stable date for memoization
  const [stableDate] = useState(() => new Date());
  const _stableDate = stableDate;
  void _stableDate;

  // ─── Chart data for import mode ───
  const importChartData = useMemo(() => {
    if (!importDetail?.weeks) return [];
    return [...importDetail.weeks].reverse().map(w => ({
      week: fmtWeekRange(w.weekStartDate, w.weekEndDate),
      salesQty: w.salesQty,
      salesAmount: w.salesAmount,
      orderProfit: w.orderProfit,
      sessionTotal: w.sessionTotal,
      adSpend: w.adSpend,
      acos: w.acos,
      totalCvr: w.totalCvr,
      rating: w.rating,
    }));
  }, [importDetail?.weeks]);

  // ─── Derive unified product info for both modes ───
  const derivedProduct = useMemo(() => {
    if (isImportMode && importDetail) {
      const p = importDetail.product;
      return {
        title: p.title || p.parentAsin,
        parentAsin: p.parentAsin,
        brand: p.brand,
        marketplace: p.marketplace,
        category: p.category,
        status: "active" as const,
        operator: p.operator,
        storeName: p.storeName,
        chineseName: p.chineseName,
        variants: p.variants || [],
      };
    }
    if (!isImportMode && product) {
      return {
        title: product.title,
        parentAsin: product.parentAsin,
        brand: product.brand,
        marketplace: product.marketplace,
        category: product.category,
        status: product.status,
        operator: null as string | null,
        storeName: null as string | null,
        chineseName: null as string | null,
        variants: product.variants,
      };
    }
    return null;
  }, [isImportMode, importDetail, product]);

  // ─── Loading states ───
  const isLoading = isImportMode ? loadingImport : loadingProduct;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!derivedProduct) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">{isImportMode ? "未找到该产品的导入数据" : "产品不存在"}</p>
        <Button variant="link" onClick={() => navigate("/ops/products")}>返回产品列表</Button>
      </div>
    );
  }

  const priorityColors: Record<string, string> = {
    high: "text-red-600 bg-red-50", medium: "text-yellow-600 bg-yellow-50", low: "text-blue-600 bg-blue-50",
  };
  const priorityLabels: Record<string, string> = { high: "高", medium: "中", low: "低" };
  const logTypeIcons: Record<string, typeof MessageSquare> = {
    operation: Edit2, note: MessageSquare, issue: AlertCircle, decision: Flag, milestone: Milestone,
  };
  const logTypeLabels: Record<string, string> = {
    operation: "操作", note: "笔记", issue: "问题", decision: "决策", milestone: "里程碑",
  };
  const logTypeColors: Record<string, string> = {
    operation: "bg-blue-100 text-blue-700", note: "bg-gray-100 text-gray-700",
    issue: "bg-red-100 text-red-700", decision: "bg-purple-100 text-purple-700",
    milestone: "bg-green-100 text-green-700",
  };

  // Import mode extra info
  const extra = isImportMode ? importDetail?.extraInfo : null;
  const importWeeks = isImportMode ? (importDetail?.weeks || []) : [];
  const latestImportWeek = importWeeks[0];

  return (
    <div className="space-y-6">
      {/* ═══ Header ═══ */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/ops/products")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold truncate">{derivedProduct.title}</h1>
            {isImportMode && (
              <Badge variant="outline" className={`text-xs ${sourceType === "lingxing" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-purple-50 text-purple-700 border-purple-200"}`}>
                <Database className="h-3 w-3 mr-1" />
                {sourceType === "lingxing" ? "领星数据" : "赛狐数据"}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
            <span className="font-mono">{derivedProduct.parentAsin}</span>
            {derivedProduct.brand && <span>· {derivedProduct.brand}</span>}
            {derivedProduct.marketplace && <span>· {derivedProduct.marketplace}</span>}
            {derivedProduct.category && <span>· {derivedProduct.category}</span>}
            {derivedProduct.operator && <span>· 运营: {derivedProduct.operator}</span>}
            {derivedProduct.storeName && <span>· 店铺: {derivedProduct.storeName}</span>}
          </div>
          {derivedProduct.chineseName && (
            <p className="text-xs text-muted-foreground mt-0.5">品名: {derivedProduct.chineseName}</p>
          )}
        </div>
        {!isImportMode && (
          <Badge variant="secondary" className={
            derivedProduct.status === "active" ? "bg-emerald-100 text-emerald-700" :
            derivedProduct.status === "inactive" ? "bg-gray-100 text-gray-600" : "bg-red-100 text-red-700"
          }>
            {derivedProduct.status === "active" ? "在售" : derivedProduct.status === "inactive" ? "暂停" : "停售"}
          </Badge>
        )}
      </div>

      {/* ═══ Import Mode: Extra Info Row (BSR/FBA/SKU/MSKU) ═══ */}
      {isImportMode && extra && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {extra.bsrMain && (
            <div className="text-center p-3 rounded-lg bg-muted/50 border">
              <p className="text-xs text-muted-foreground">BSR大类</p>
              <p className="text-sm font-semibold">{extra.bsrMain}</p>
            </div>
          )}
          {extra.bsrSub && (
            <div className="text-center p-3 rounded-lg bg-muted/50 border">
              <p className="text-xs text-muted-foreground">BSR小类</p>
              <p className="text-sm font-semibold">{extra.bsrSub}</p>
            </div>
          )}
          {extra.fbaAvailable != null && (
            <div className="text-center p-3 rounded-lg bg-muted/50 border">
              <p className="text-xs text-muted-foreground">FBA可售</p>
              <p className="text-sm font-semibold text-emerald-600">{extra.fbaAvailable}</p>
            </div>
          )}
          {extra.fbaDaysOfSupply != null && (
            <div className="text-center p-3 rounded-lg bg-muted/50 border">
              <p className="text-xs text-muted-foreground">可售天数</p>
              <p className={`text-sm font-semibold ${Number(extra.fbaDaysOfSupply) < 14 ? "text-red-600" : "text-emerald-600"}`}>{extra.fbaDaysOfSupply}</p>
            </div>
          )}
          {extra.sku && (
            <div className="text-center p-3 rounded-lg bg-muted/50 border">
              <p className="text-xs text-muted-foreground">SKU</p>
              <p className="text-sm font-semibold truncate" title={extra.sku}>{extra.sku}</p>
            </div>
          )}
          {extra.msku && (
            <div className="text-center p-3 rounded-lg bg-muted/50 border">
              <p className="text-xs text-muted-foreground">MSKU</p>
              <p className="text-sm font-semibold truncate" title={extra.msku}>{extra.msku}</p>
            </div>
          )}
        </div>
      )}

      {/* ═══ Import Mode: KPI Summary Cards (latest week) ═══ */}
      {isImportMode && latestImportWeek && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">周销量</p>
            <p className="text-lg font-bold">{fmtNum(latestImportWeek.salesQty)}</p>
            <WowBadge wow={latestImportWeek.wow?.salesQty} />
          </Card>
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">周销售额</p>
            <p className="text-lg font-bold">${fmtNum(latestImportWeek.salesAmount, 1)}</p>
            <WowBadge wow={latestImportWeek.wow?.salesAmount} />
          </Card>
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">周利润</p>
            <p className={`text-lg font-bold ${latestImportWeek.orderProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>${fmtNum(latestImportWeek.orderProfit, 1)}</p>
            <WowBadge wow={latestImportWeek.wow?.orderProfit} />
          </Card>
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">Sessions</p>
            <p className="text-lg font-bold">{fmtNum(latestImportWeek.sessionTotal)}</p>
            <WowBadge wow={latestImportWeek.wow?.sessionTotal} />
          </Card>
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">广告花费</p>
            <p className="text-lg font-bold text-red-600">${fmtNum(latestImportWeek.adSpend, 1)}</p>
            <WowBadge wow={latestImportWeek.wow?.adSpend} />
          </Card>
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">ACoS</p>
            <p className={`text-lg font-bold ${latestImportWeek.acos <= 25 ? "text-emerald-600" : latestImportWeek.acos <= 40 ? "text-amber-600" : "text-red-600"}`}>{fmtPct(latestImportWeek.acos)}</p>
            <WowBadge wow={latestImportWeek.wow?.acos} />
          </Card>
        </div>
      )}

      {/* ═══ Tab Navigation — SAME for both modes ═══ */}
      <Tabs defaultValue="dashboard" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="dashboard">数据看板</TabsTrigger>
          <TabsTrigger value="plan">运营计划</TabsTrigger>
          <TabsTrigger value="conversion">转化率对比</TabsTrigger>
          <TabsTrigger value="review">执行复盘</TabsTrigger>
          <TabsTrigger value="team">团队协作</TabsTrigger>
        </TabsList>

        {/* ═══ Tab: 数据看板 ═══ */}
        <TabsContent value="dashboard" className="mt-4">

      {/* ─── Import Mode Dashboard ─── */}
      {isImportMode ? (
        <div className="space-y-6">
          {/* Import Weekly Data Table */}
          <ImportWeeklyTable weeks={importWeeks} sourceType={sourceType || "lingxing"} />

          {/* Ad Keyword Tracking */}
          <AdKeywordTracking
            productId={0}
            parentAsin={derivedProduct.parentAsin}
          />

          {/* Import Trend Charts */}
          <ImportCharts data={importChartData} />

          {/* Import Variants */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">子ASIN变体 ({derivedProduct.variants.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {derivedProduct.variants.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">暂无变体数据</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 font-medium">子ASIN</th>
                        <th className="text-left py-2 font-medium">SKU</th>
                        <th className="text-left py-2 font-medium">标题</th>
                        <th className="text-right py-2 font-medium">价格</th>
                      </tr>
                    </thead>
                    <tbody>
                      {derivedProduct.variants.map((v: any, idx: number) => (
                        <tr key={idx} className="border-b last:border-0">
                          <td className="py-2 font-mono text-xs">{v.childAsin}</td>
                          <td className="py-2 text-xs">{v.sku || "-"}</td>
                          <td className="py-2 max-w-[300px] truncate text-xs">{v.title || "-"}</td>
                          <td className="py-2 text-right text-xs">{v.price ? `$${v.price}` : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        /* ─── System Mode Dashboard (original) ─── */
        <>
      {/* Weekly Ops Table (Excel-style) - Full Width */}
      <ProductWeeklyOpsTable productId={productId} parentAsin={derivedProduct.parentAsin} />

      {/* Main Layout: Left (data) + Right (todos & logs) */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mt-6">
        {/* ─── Left: Data Area (3 cols) ─── */}
        <div className="lg:col-span-3 space-y-6">

          {/* Variants */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">子ASIN变体</CardTitle>
                <Button size="sm" variant="outline" onClick={() => setShowAddVariant(true)}>
                  <Plus className="h-3 w-3 mr-1" /> 添加变体
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {derivedProduct.variants.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">暂无变体，点击上方按钮添加</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 font-medium">子ASIN</th>
                        <th className="text-left py-2 font-medium">SKU</th>
                        <th className="text-left py-2 font-medium">标题</th>
                        <th className="text-right py-2 font-medium">价格</th>
                        <th className="text-right py-2 font-medium">状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {derivedProduct.variants.map((v: any) => (
                        <tr key={v.id || v.childAsin} className="border-b last:border-0">
                          <td className="py-2 font-mono text-xs">{v.childAsin}</td>
                          <td className="py-2">{v.sku || "-"}</td>
                          <td className="py-2 max-w-[200px] truncate">{v.title || "-"}</td>
                          <td className="py-2 text-right">{v.price ? `$${v.price}` : "-"}</td>
                          <td className="py-2 text-right">
                            <Badge variant="secondary" className={v.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-gray-50 text-gray-500"}>
                              {v.status === "active" ? "在售" : "停售"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Profit Summary */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-emerald-600" />
                  <CardTitle className="text-base">利润总览（近30天）</CardTitle>
                  {profitData?.dataSource?.source === 'mock_fallback' && (
                    <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">模拟数据</Badge>
                  )}
                  {profitData?.dataSource?.source === 'mock_mode' && (
                    <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">演示模式</Badge>
                  )}
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetchProfit()} disabled={fetchingProfit}>
                  <RefreshCw className={`h-4 w-4 ${fetchingProfit ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {profitError ? (
                <div className="flex flex-col items-center gap-3 py-6">
                  <div className="rounded-full bg-red-50 p-3"><WifiOff className="h-6 w-6 text-red-500" /></div>
                  <p className="text-sm font-medium text-red-600">利润数据加载失败</p>
                  <p className="text-xs text-muted-foreground text-center max-w-[250px]">{profitError.message}</p>
                  <Button size="sm" variant="outline" onClick={() => refetchProfit()} disabled={fetchingProfit}>
                    <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${fetchingProfit ? 'animate-spin' : ''}`} />
                    重新加载
                  </Button>
                </div>
              ) : loadingProfit ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : profitData ? (
                <div className="overflow-x-auto">
                  {profitData.dataSource?.source === 'mock_fallback' && (
                    <div className="flex items-start gap-2 p-2.5 mb-3 rounded-md bg-amber-50 border border-amber-200">
                      <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                      <div className="text-xs">
                        <p className="font-medium text-amber-800">数据加载失败，当前显示为模拟数据</p>
                        {profitData.dataSource.reason && <p className="text-amber-600 mt-0.5">{profitData.dataSource.reason}</p>}
                      </div>
                    </div>
                  )}
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 font-medium text-muted-foreground"></th>
                        <th className="text-right py-2 font-medium text-blue-600">预计</th>
                        <th className="text-right py-2 font-medium text-emerald-600">实况预测</th>
                        <th className="text-right py-2 font-medium text-orange-600">现时</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: "产品收入", budget: profitData.budget.revenue, actual: profitData.actual.revenue, current: profitData.current.revenue },
                        { label: "Amazon开支", budget: null, actual: profitData.actual.amazonFees, current: profitData.current.amazonFees, indent: false },
                        { label: "Amazon佣金", budget: null, actual: profitData.actual.referralFee, current: profitData.current.referralFee, indent: true },
                        { label: "FBA Fees", budget: null, actual: profitData.actual.fbaFee, current: profitData.current.fbaFee, indent: true },
                        { label: "Ads Cost", budget: null, actual: profitData.actual.adSpend, current: profitData.current.adSpend, indent: true },
                        { label: "仓租", budget: null, actual: profitData.actual.storageFee, current: profitData.current.storageFee, indent: true },
                        { label: "实收", budget: null, actual: profitData.actual.netRevenue, current: profitData.current.netRevenue, bold: true },
                        { label: "总固定成本", budget: null, actual: profitData.actual.fixedCosts, current: profitData.current.fixedCosts },
                        { label: "采购成本", budget: null, actual: profitData.actual.productCost, current: profitData.current.productCost, indent: true },
                        { label: "Amazon运费", budget: null, actual: profitData.actual.shippingCost, current: profitData.current.shippingCost, indent: true },
                        { label: "关税", budget: null, actual: profitData.actual.tariff, current: profitData.current.tariff, indent: true },
                        { label: "利润", budget: profitData.budget.profit, actual: profitData.actual.profit, current: profitData.current.profit, bold: true, highlight: true },
                      ].map((row, idx) => (
                        <tr key={idx} className={`border-b last:border-0 ${row.highlight ? "bg-emerald-50/50" : ""}`}>
                          <td className={`py-1.5 ${row.indent ? "pl-6 text-muted-foreground" : ""} ${row.bold ? "font-semibold" : ""}`}>
                            {row.label}
                          </td>
                          <td className="py-1.5 text-right font-mono text-sm">
                            {row.budget != null ? row.budget.toLocaleString("en-US", { minimumFractionDigits: 1 }) : "-"}
                          </td>
                          <td className="py-1.5 text-right font-mono text-sm">
                            {row.actual != null ? row.actual.toLocaleString("en-US", { minimumFractionDigits: 1 }) : "-"}
                          </td>
                          <td className="py-1.5 text-right font-mono text-sm">
                            {row.current != null ? row.current.toLocaleString("en-US", { minimumFractionDigits: 1 }) : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center text-sm border-t pt-3">
                    <div>
                      <p className="text-muted-foreground">30天销量</p>
                      <p className="font-semibold text-lg">{profitData.actual.orders}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">日均销量</p>
                      <p className="font-semibold text-lg">{profitData.actual.orders > 0 ? Math.round(profitData.actual.orders / 30) : 0}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">7天销量</p>
                      <p className="font-semibold text-lg">{profitData.current.orders}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">利润率</p>
                      <p className="font-semibold text-lg">{profitData.actual.profitMargin}%</p>
                    </div>
                  </div>
                  {/* ASIN 360 小时数据图表 */}
                  {profitData.hourlyTrend && profitData.hourlyTrend.length > 0 && (
                    <div className="mt-4 border-t pt-3">
                      <p className="text-sm font-medium text-muted-foreground mb-2">ASIN 360 昨日小时数据</p>
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={profitData.hourlyTrend} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                          <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                          <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                          <RTooltip contentStyle={{ fontSize: 12 }} />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Line yAxisId="left" type="monotone" dataKey="volume" name="销量" stroke="#3b82f6" strokeWidth={2} dot={false} />
                          <Line yAxisId="left" type="monotone" dataKey="orderItems" name="订单" stroke="#10b981" strokeWidth={2} dot={false} />
                          <Line yAxisId="right" type="monotone" dataKey="salesRank" name="大类排名" stroke="#f59e0b" strokeWidth={1.5} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-6">
                  <p className="text-sm text-muted-foreground">暂无利润数据</p>
                  <Button size="sm" variant="outline" onClick={() => refetchProfit()} disabled={fetchingProfit}>
                    <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${fetchingProfit ? 'animate-spin' : ''}`} />
                    重新加载
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Inventory Summary */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package className="h-5 w-5 text-blue-600" />
                  <CardTitle className="text-base">库存概览</CardTitle>
                  {inventoryData?.dataSource?.source === 'mock_fallback' && (
                    <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">模拟数据</Badge>
                  )}
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetchInventory()} disabled={fetchingInventory}>
                  <RefreshCw className={`h-4 w-4 ${fetchingInventory ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {inventoryError ? (
                <div className="flex flex-col items-center gap-3 py-6">
                  <div className="rounded-full bg-red-50 p-3"><WifiOff className="h-6 w-6 text-red-500" /></div>
                  <p className="text-sm font-medium text-red-600">库存数据加载失败</p>
                  <p className="text-xs text-muted-foreground text-center max-w-[250px]">{inventoryError.message}</p>
                  <Button size="sm" variant="outline" onClick={() => refetchInventory()} disabled={fetchingInventory}>
                    <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${fetchingInventory ? 'animate-spin' : ''}`} />
                    重新加载
                  </Button>
                </div>
              ) : loadingInventory ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : inventoryData ? (
                <div>
                  {inventoryData.dataSource?.source === 'mock_fallback' && (
                    <div className="flex items-start gap-2 p-2.5 mb-3 rounded-md bg-amber-50 border border-amber-200">
                      <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                      <div className="text-xs">
                        <p className="font-medium text-amber-800">数据加载失败，当前显示为模拟数据</p>
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                    {[
                      { label: "FBA可售", value: (inventoryData as any).fba?.available ?? inventoryData.total.fulfillableQty, color: "text-emerald-600" },
                      { label: "FBA在途", value: (inventoryData as any).fba?.inbound ?? inventoryData.total.inboundQty, color: "text-blue-600" },
                      { label: "FBA预留", value: (inventoryData as any).fba?.reserved ?? inventoryData.total.reservedQty, color: "text-amber-600" },
                      { label: "可售天数", value: `${(inventoryData as any).fba?.daysOfSupply ?? inventoryData.total.daysOfSupply}天`, color: ((inventoryData as any).fba?.daysOfSupply ?? inventoryData.total.daysOfSupply) < 14 ? "text-red-600" : "text-emerald-600" },
                    ].map((item, idx) => (
                      <div key={idx} className="text-center p-3 rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground">{item.label}</p>
                        <p className={`text-lg font-bold ${item.color}`}>{item.value}</p>
                      </div>
                    ))}
                  </div>
                  {(inventoryData as any).alert && (
                    <div className={`flex items-center gap-2 p-2 rounded-md ${
                      (inventoryData as any).alert.level === "danger" ? "bg-red-50 border border-red-200" :
                      (inventoryData as any).alert.level === "warning" ? "bg-amber-50 border border-amber-200" :
                      "bg-blue-50 border border-blue-200"
                    }`}>
                      <AlertTriangle className={`h-4 w-4 ${
                        (inventoryData as any).alert.level === "danger" ? "text-red-600" :
                        (inventoryData as any).alert.level === "warning" ? "text-amber-600" : "text-blue-600"
                      }`} />
                      <p className="text-xs font-medium">{(inventoryData as any).alert.message}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-6">
                  <p className="text-sm text-muted-foreground">暂无库存数据</p>
                  <Button size="sm" variant="outline" onClick={() => refetchInventory()} disabled={fetchingInventory}>
                    <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${fetchingInventory ? 'animate-spin' : ''}`} />
                    重新加载
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Ads Summary */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-orange-600" />
                  <CardTitle className="text-base">广告概览（近30天）</CardTitle>
                  {adsData?.dataSource?.source === 'mock_fallback' && (
                    <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">模拟数据</Badge>
                  )}
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetchAds()} disabled={fetchingAds}>
                  <RefreshCw className={`h-4 w-4 ${fetchingAds ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {adsError ? (
                <div className="flex flex-col items-center gap-3 py-6">
                  <div className="rounded-full bg-red-50 p-3"><WifiOff className="h-6 w-6 text-red-500" /></div>
                  <p className="text-sm font-medium text-red-600">广告数据加载失败</p>
                  <p className="text-xs text-muted-foreground text-center max-w-[250px]">{adsError.message}</p>
                  <Button size="sm" variant="outline" onClick={() => refetchAds()} disabled={fetchingAds}>
                    <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${fetchingAds ? 'animate-spin' : ''}`} />
                    重新加载
                  </Button>
                </div>
              ) : loadingAds ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : adsData ? (
                <div>
                  {adsData.dataSource?.source === 'mock_fallback' && (
                    <div className="flex items-start gap-2 p-2.5 mb-3 rounded-md bg-amber-50 border border-amber-200">
                      <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                      <div className="text-xs">
                        <p className="font-medium text-amber-800">数据加载失败，当前显示为模拟数据</p>
                        {adsData.dataSource.reason && <p className="text-amber-600 mt-0.5">{adsData.dataSource.reason}</p>}
                      </div>
                    </div>
                  )}
                  {(adsData as any).matchInfo && (
                    <div className="flex items-start gap-2 p-2 mb-3 rounded-md bg-blue-50 border border-blue-200">
                      <Info className="h-3.5 w-3.5 text-blue-600 mt-0.5 shrink-0" />
                      <div className="text-[11px] text-blue-700">
                        <span>映射来源: {(adsData as any).matchInfo.mappingSource === 'cache' ? 'ASIN映射缓存' : (adsData as any).matchInfo.mappingSource === 'fresh' ? '实时ASIN查询' : '名称匹配'}</span>
                        <span className="mx-1.5">|</span>
                        <span>匹配ASIN: {(adsData as any).matchInfo.allAsins?.join(', ')}</span>
                        <span className="mx-1.5">|</span>
                        <span>关联活动: {(adsData as any).matchInfo.matchedCampaignCount}/{(adsData as any).matchInfo.totalCampaignCount}</span>
                        {(adsData as any).matchInfo.matchedCampaignCount === 0 && (adsData as any).matchInfo.mappingSource === 'name_match' && (
                          <span className="ml-2 text-amber-600 font-medium">提示: 未找到精确映射，已使用名称模糊匹配</span>
                        )}
                        {(adsData as any).matchInfo.matchedCampaignCount === 0 && (adsData as any).matchInfo.mappingSource !== 'name_match' && (
                          <span className="ml-2 text-amber-600 font-medium">提示: 该产品的ASIN未在广告活动中找到</span>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                    {[
                      { label: "广告花费", value: `$${adsData.summary.totalSpend}`, color: "text-red-600" },
                      { label: "广告销售额", value: `$${adsData.summary.totalSales}`, color: "text-emerald-600" },
                      { label: "ACoS", value: `${adsData.summary.acos}%`, color: adsData.summary.acos <= 25 ? "text-emerald-600" : adsData.summary.acos <= 40 ? "text-amber-600" : "text-red-600" },
                      { label: "ROAS", value: (isNaN(adsData.summary.roas) || !isFinite(adsData.summary.roas)) ? "0.00" : adsData.summary.roas.toFixed(2), color: "text-blue-600" },
                    ].map((item, idx) => (
                      <div key={idx} className="text-center p-3 rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground">{item.label}</p>
                        <p className={`text-lg font-bold ${item.color}`}>{item.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-4 gap-3 mb-4">
                    <div className="text-center p-2 rounded bg-gray-50">
                      <p className="text-[10px] text-muted-foreground">曝光</p>
                      <p className="text-sm font-semibold">{(adsData.summary.totalImpressions || 0).toLocaleString()}</p>
                    </div>
                    <div className="text-center p-2 rounded bg-gray-50">
                      <p className="text-[10px] text-muted-foreground">点击</p>
                      <p className="text-sm font-semibold">{(adsData.summary.totalClicks || 0).toLocaleString()}</p>
                    </div>
                    <div className="text-center p-2 rounded bg-gray-50">
                      <p className="text-[10px] text-muted-foreground">CTR</p>
                      <p className="text-sm font-semibold">{adsData.summary.ctr || 0}%</p>
                    </div>
                    <div className="text-center p-2 rounded bg-gray-50">
                      <p className="text-[10px] text-muted-foreground">CVR</p>
                      <p className="text-sm font-semibold">{adsData.summary.cvr || 0}%</p>
                    </div>
                  </div>
                  {adsData.campaigns.length > 0 && (
                    <div className="overflow-x-auto">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-medium text-muted-foreground">关联广告活动 ({adsData.campaigns.length}个)</p>
                      </div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-muted-foreground">
                            <th className="text-left py-2 font-medium">广告活动</th>
                            <th className="text-center py-2 font-medium">类型</th>
                            <th className="text-center py-2 font-medium">状态</th>
                            <th className="text-right py-2 font-medium">曝光</th>
                            <th className="text-right py-2 font-medium">点击</th>
                            <th className="text-right py-2 font-medium">花费</th>
                            <th className="text-right py-2 font-medium">销售额</th>
                            <th className="text-right py-2 font-medium">ACoS</th>
                            <th className="text-right py-2 font-medium">ROAS</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adsData.campaigns.slice(0, 12).map((c, idx) => {
                            const isPaused = ['paused', 'archived', 'suspended']
                              .includes((c.status || '').toLowerCase());
                            const cRoas = c.spend > 0 ? (c.sales / c.spend).toFixed(2) : "0.00";
                            return (
                            <tr key={idx} className={`border-b last:border-0 ${isPaused ? 'opacity-50' : ''}`}>
                              <td className="py-1.5 max-w-[200px] truncate text-xs">
                                <button
                                  className="text-left text-blue-600 hover:text-blue-800 hover:underline cursor-pointer font-medium truncate max-w-[200px] block"
                                  title={`点击查看「${c.name}」的搜索词分析`}
                                  onClick={() => {
                                    const cId = (c as any).campaignId;
                                    if (cId) {
                                      navigate(`/ops/ads?tab=search-terms&campaignId=${encodeURIComponent(cId)}&campaignName=${encodeURIComponent(c.name)}`);
                                    } else {
                                      navigate('/ops/ads?tab=search-terms');
                                      toast.info('已跳转到搜索词分析页面');
                                    }
                                  }}
                                >
                                  {c.name}
                                  <span className="ml-1 text-[10px] text-blue-400">↗</span>
                                </button>
                              </td>
                              <td className="py-1.5 text-center">
                                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                  (c as any).adType === 'SD' ? 'bg-purple-50 text-purple-700 border border-purple-200'
                                  : (c as any).adType === 'SB' ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                  : 'bg-blue-50 text-blue-700 border border-blue-200'
                                }`}>
                                  {(c as any).adType || 'SP'}
                                </span>
                              </td>
                              <td className="py-1.5 text-center">
                                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                  isPaused ? 'bg-gray-100 text-gray-500' : 'bg-emerald-50 text-emerald-700'
                                }`}>
                                  {isPaused ? '已暂停' : '投放中'}
                                </span>
                              </td>
                              <td className="py-1.5 text-right text-xs">{(c.impressions || 0).toLocaleString()}</td>
                              <td className="py-1.5 text-right text-xs">{(c.clicks || 0).toLocaleString()}</td>
                              <td className="py-1.5 text-right text-xs font-mono text-red-600">${c.spend}</td>
                              <td className="py-1.5 text-right text-xs font-mono text-emerald-600">${c.sales}</td>
                              <td className="py-1.5 text-right text-xs">
                                <span className={c.acos > 30 ? "text-red-600 font-medium" : c.acos > 0 ? "text-emerald-600 font-medium" : "text-muted-foreground"}>{c.acos}%</span>
                              </td>
                              <td className="py-1.5 text-right text-xs font-medium text-blue-600">{cRoas}x</td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {adsData.campaigns.length > 12 && (
                        <p className="text-xs text-center text-muted-foreground mt-2 py-1">
                          还有 {adsData.campaigns.length - 12} 个广告活动未显示，请前往广告优化模块查看全部
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-6">
                  <p className="text-sm text-muted-foreground">暂无广告数据</p>
                  <Button size="sm" variant="outline" onClick={() => refetchAds()} disabled={fetchingAds}>
                    <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${fetchingAds ? 'animate-spin' : ''}`} />
                    重新加载
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Bottom: Competitor + Keyword Monitoring */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Competitor Monitoring */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Eye className="h-5 w-5 text-purple-600" />
                  <CardTitle className="text-base">竞品监控</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {!competitors || competitors.length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-sm text-muted-foreground mb-2">暂无竞品监控数据</p>
                    <Button size="sm" variant="outline" onClick={() => navigate("/ops/competitor")}>
                      前往竞品监控
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {competitors.slice(0, 5).map((c) => (
                      <div key={c.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{c.competitorTitle || c.competitorAsin}</p>
                          <p className="text-xs text-muted-foreground font-mono">{c.competitorAsin}</p>
                        </div>
                        {c.recentSnapshots.length > 0 && (
                          <div className="text-right text-sm">
                            <p className="font-mono">${String(c.recentSnapshots[c.recentSnapshots.length - 1]?.price || "-")}</p>
                            <p className="text-xs text-muted-foreground">BSR #{c.recentSnapshots[c.recentSnapshots.length - 1]?.bsrRank || "-"}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Keyword Monitoring */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Search className="h-5 w-5 text-indigo-600" />
                    <CardTitle className="text-base">关键词监控</CardTitle>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setShowAddKeyword(true)}>
                    <Plus className="h-3 w-3 mr-1" /> 添加
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {!keywordMonitorsData || keywordMonitorsData.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">暂无关键词监控，点击上方添加</p>
                ) : (
                  <div className="space-y-3">
                    {keywordMonitorsData.map((kw) => {
                      const latest = kw.recentSnapshots[kw.recentSnapshots.length - 1];
                      const prev = kw.recentSnapshots.length > 1 ? kw.recentSnapshots[kw.recentSnapshots.length - 2] : null;
                      const rankChange = latest && prev && latest.organicRank && prev.organicRank
                        ? prev.organicRank - latest.organicRank : 0;
                      return (
                        <div key={kw.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50 group">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{kw.keyword}</p>
                            {kw.keywordCn && <p className="text-xs text-muted-foreground">{kw.keywordCn}</p>}
                          </div>
                          <div className="flex items-center gap-3 text-sm">
                            {latest?.organicRank ? (
                              <div className="text-right">
                                <p className="font-mono">#{latest.organicRank}</p>
                                {rankChange !== 0 && (
                                  <p className={`text-xs flex items-center ${rankChange > 0 ? "text-emerald-600" : "text-red-600"}`}>
                                    {rankChange > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                    {Math.abs(rankChange)}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                            <Button
                              variant="ghost" size="icon"
                              className="h-6 w-6 opacity-0 group-hover:opacity-100 text-red-500"
                              onClick={() => removeKeyword.mutate({ id: kw.id })}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ─── Right Sidebar: Todos & Logs ─── */}
        <div className="space-y-6">
          {/* Todos */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  待办任务
                </CardTitle>
                <Button size="sm" variant="outline" onClick={() => setShowAddTodo(true)}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!todos || todos.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">暂无待办任务</p>
              ) : (
                <div className="space-y-2">
                  {todos.map((todo) => (
                    <div key={todo.id} className="flex items-start gap-2 p-2 rounded-lg hover:bg-muted/50 group">
                      <Checkbox
                        checked={todo.status === "completed"}
                        onCheckedChange={(checked) => {
                          updateTodo.mutate({
                            id: todo.id,
                            status: checked ? "completed" : "pending",
                          });
                        }}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${todo.status === "completed" ? "line-through text-muted-foreground" : ""}`}>
                          {todo.title}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary" className={`text-xs ${priorityColors[todo.priority]}`}>
                            {priorityLabels[todo.priority]}
                          </Badge>
                          {todo.dueDate && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />{todo.dueDate}
                            </span>
                          )}
                          {todo.reminderEnabled === 1 && todo.reminderDays && (
                            <span className="text-xs text-blue-500 flex items-center gap-0.5" title={`提醒: 截止前 ${(() => { try { return JSON.parse(todo.reminderDays).map((d: number) => d === 0 ? "当天" : `${d}天`).join("、"); } catch { return todo.reminderDays; } })()}`}>
                              <Bell className="h-3 w-3" />
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost" size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 text-red-500"
                        onClick={() => deleteTodo.mutate({ id: todo.id })}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Logs */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-600" />
                跟进日志
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Add log form */}
              <div className="space-y-2 mb-4">
                <div className="flex gap-2">
                  <Select value={logType} onValueChange={setLogType}>
                    <SelectTrigger className="w-24 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="note">笔记</SelectItem>
                      <SelectItem value="operation">操作</SelectItem>
                      <SelectItem value="issue">问题</SelectItem>
                      <SelectItem value="decision">决策</SelectItem>
                      <SelectItem value="milestone">里程碑</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Textarea
                  placeholder="添加跟进日志..."
                  value={logContent}
                  onChange={e => setLogContent(e.target.value)}
                  rows={2}
                  className="text-sm"
                />
                <Button
                  size="sm"
                  className="w-full"
                  disabled={!logContent.trim() || createLog.isPending}
                  onClick={() => createLog.mutate({
                    productId,
                    content: logContent.trim(),
                    logType: logType as "operation" | "note" | "issue" | "decision" | "milestone",
                  })}
                >
                  添加日志
                </Button>
              </div>

              {/* Log list */}
              {!logs || logs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">暂无跟进日志</p>
              ) : (
                <div className="space-y-3 max-h-[500px] overflow-y-auto">
                  {logs.map((log) => {
                    const LogIcon = logTypeIcons[log.logType] || MessageSquare;
                    return (
                      <div key={log.id} className="relative pl-6 pb-3 border-l-2 border-muted group">
                        <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-background border-2 border-muted flex items-center justify-center">
                          <LogIcon className="h-2.5 w-2.5 text-muted-foreground" />
                        </div>
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="secondary" className={`text-xs ${logTypeColors[log.logType] || ""}`}>
                                {logTypeLabels[log.logType] || log.logType}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {new Date(log.createdAt).toLocaleString("zh-CN")}
                              </span>
                            </div>
                            <p className="text-sm whitespace-pre-wrap">{log.content}</p>
                            {log.createdBy && (
                              <p className="text-xs text-muted-foreground mt-1">— {log.createdBy}</p>
                            )}
                          </div>
                          <Button
                            variant="ghost" size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 text-red-500 shrink-0"
                            onClick={() => deleteLog.mutate({ id: log.id })}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
        </>
      )}

      </TabsContent>

        {/* ═══ Tab: 运营计划 ═══ */}
        <TabsContent value="plan" className="mt-4">
          <OpsProductPlan productId={productId} parentAsin={derivedProduct.parentAsin} productTitle={derivedProduct.title} />
        </TabsContent>

        {/* ═══ Tab: 转化率对比 ═══ */}
        <TabsContent value="conversion" className="mt-4">
          <OpsProductConversion productId={productId} parentAsin={derivedProduct.parentAsin} />
        </TabsContent>

        {/* ═══ Tab: 执行复盘 ═══ */}
        <TabsContent value="review" className="mt-4">
          <OpsProductReview productId={productId} parentAsin={derivedProduct.parentAsin} />
        </TabsContent>

        {/* ═══ Tab: 团队协作 ═══ */}
        <TabsContent value="team" className="mt-4">
          <OpsProductTeam productId={productId} parentAsin={derivedProduct.parentAsin} />
        </TabsContent>
      </Tabs>

      {/* ─── Dialogs (system mode only) ─── */}
      {!isImportMode && (
        <>
      {/* Add Todo Dialog */}
      <Dialog open={showAddTodo} onOpenChange={setShowAddTodo}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>添加待办任务</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>任务标题 *</Label>
              <Input value={todoForm.title} onChange={e => setTodoForm(f => ({ ...f, title: e.target.value }))} placeholder="输入任务标题" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>优先级</Label>
                <Select value={todoForm.priority} onValueChange={v => setTodoForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">高</SelectItem>
                    <SelectItem value="medium">中</SelectItem>
                    <SelectItem value="low">低</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>截止日期</Label>
                <Input type="date" value={todoForm.dueDate} onChange={e => setTodoForm(f => ({ ...f, dueDate: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>负责人</Label>
              <Input value={todoForm.assignee} onChange={e => setTodoForm(f => ({ ...f, assignee: e.target.value }))} placeholder="负责人" />
            </div>
            {/* Reminder Settings */}
            <div className="border rounded-lg p-3 bg-muted/30">
              <div className="flex items-center justify-between mb-2">
                <Label className="flex items-center gap-1.5 text-sm font-medium">
                  {todoForm.reminderEnabled ? <Bell className="h-3.5 w-3.5 text-blue-500" /> : <BellOff className="h-3.5 w-3.5 text-gray-400" />}
                  到期提醒
                </Label>
                <button
                  type="button"
                  onClick={() => setTodoForm(f => ({ ...f, reminderEnabled: !f.reminderEnabled }))}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    todoForm.reminderEnabled ? "bg-blue-500" : "bg-gray-300"
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    todoForm.reminderEnabled ? "translate-x-4.5" : "translate-x-0.5"
                  }`} />
                </button>
              </div>
              {todoForm.reminderEnabled && todoForm.dueDate && (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">选择提前提醒时间（可多选）</p>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: "当天", value: 0 },
                      { label: "1天前", value: 1 },
                      { label: "2天前", value: 2 },
                      { label: "3天前", value: 3 },
                      { label: "5天前", value: 5 },
                      { label: "1周前", value: 7 },
                      { label: "2周前", value: 14 },
                      { label: "1月前", value: 30 },
                    ].map(opt => {
                      const isSelected = todoForm.reminderDays.includes(opt.value);
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            setTodoForm(f => ({
                              ...f,
                              reminderDays: isSelected
                                ? f.reminderDays.filter(d => d !== opt.value)
                                : [...f.reminderDays, opt.value].sort((a, b) => a - b),
                            }));
                          }}
                          className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                            isSelected
                              ? "bg-blue-500 text-white border-blue-500"
                              : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  {todoForm.reminderDays.length > 0 && (
                    <p className="text-xs text-blue-600">
                      将在截止日期前 {todoForm.reminderDays.map(d => d === 0 ? "当天" : `${d}天`).join("、")} 发送提醒
                    </p>
                  )}
                </div>
              )}
              {todoForm.reminderEnabled && !todoForm.dueDate && (
                <p className="text-xs text-amber-600">请先设置截止日期才能启用提醒</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddTodo(false)}>取消</Button>
            <Button
              disabled={!todoForm.title || createTodo.isPending}
              onClick={() => createTodo.mutate({
                productId,
                title: todoForm.title,
                priority: todoForm.priority as "high" | "medium" | "low",
                dueDate: todoForm.dueDate || undefined,
                assignee: todoForm.assignee || undefined,
                reminderDays: todoForm.dueDate && todoForm.reminderEnabled ? JSON.stringify(todoForm.reminderDays) : undefined,
                reminderEnabled: todoForm.reminderEnabled ? 1 : 0,
              })}
            >
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Keyword Monitor Dialog */}
      <Dialog open={showAddKeyword} onOpenChange={setShowAddKeyword}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>添加关键词监控</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>关键词 *</Label>
              <Input value={kwForm.keyword} onChange={e => setKwForm(f => ({ ...f, keyword: e.target.value }))} placeholder="输入英文关键词" />
            </div>
            <div>
              <Label>中文翻译</Label>
              <Input value={kwForm.keywordCn} onChange={e => setKwForm(f => ({ ...f, keywordCn: e.target.value }))} placeholder="关键词中文翻译" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>目标ASIN</Label>
                <Input value={kwForm.targetAsin} onChange={e => setKwForm(f => ({ ...f, targetAsin: e.target.value }))} placeholder="B0XXXXXXXX" />
              </div>
              <div>
                <Label>匹配类型</Label>
                <Select value={kwForm.matchType} onValueChange={v => setKwForm(f => ({ ...f, matchType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="exact">精确</SelectItem>
                    <SelectItem value="phrase">词组</SelectItem>
                    <SelectItem value="broad">广泛</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddKeyword(false)}>取消</Button>
            <Button
              disabled={!kwForm.keyword || addKeyword.isPending}
              onClick={() => addKeyword.mutate({
                productId,
                keyword: kwForm.keyword,
                keywordCn: kwForm.keywordCn || undefined,
                targetAsin: kwForm.targetAsin || undefined,
                matchType: kwForm.matchType as "exact" | "phrase" | "broad",
              })}
            >
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Variant Dialog */}
      <Dialog open={showAddVariant} onOpenChange={setShowAddVariant}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>添加子ASIN变体</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>子ASIN *</Label>
              <Input value={variantForm.childAsin} onChange={e => setVariantForm(f => ({ ...f, childAsin: e.target.value }))} placeholder="B0XXXXXXXX" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>SKU</Label>
                <Input value={variantForm.sku} onChange={e => setVariantForm(f => ({ ...f, sku: e.target.value }))} placeholder="SKU编号" />
              </div>
              <div>
                <Label>价格</Label>
                <Input type="number" value={variantForm.price} onChange={e => setVariantForm(f => ({ ...f, price: e.target.value }))} placeholder="$" />
              </div>
            </div>
            <div>
              <Label>标题</Label>
              <Input value={variantForm.title} onChange={e => setVariantForm(f => ({ ...f, title: e.target.value }))} placeholder="变体标题" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddVariant(false)}>取消</Button>
            <Button
              disabled={!variantForm.childAsin || addVariant.isPending}
              onClick={() => addVariant.mutate({
                productId,
                childAsin: variantForm.childAsin,
                sku: variantForm.sku || undefined,
                title: variantForm.title || undefined,
                price: variantForm.price || undefined,
              })}
            >
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// Import Mode Sub-Components
// ═══════════════════════════════════════════════════

// ─── Weekly Data Table for Import Mode ───
function ImportWeeklyTable({ weeks, sourceType }: { weeks: any[]; sourceType: string }) {
  const [showAll, setShowAll] = useState(false);
  const displayWeeks = showAll ? weeks : weeks.slice(0, 12);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-blue-600" />
            周度运营数据 ({weeks.length}周)
          </CardTitle>
          {weeks.length > 12 && (
            <Button variant="outline" size="sm" onClick={() => setShowAll(!showAll)}>
              {showAll ? "收起" : `显示全部 ${weeks.length} 周`}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left py-2 px-2 font-medium sticky left-0 bg-muted/50 z-10">周期</th>
                <th className="text-right py-2 px-2 font-medium">销量</th>
                <th className="text-right py-2 px-2 font-medium">订单</th>
                <th className="text-right py-2 px-2 font-medium">销售额</th>
                <th className="text-right py-2 px-2 font-medium">利润</th>
                <th className="text-right py-2 px-2 font-medium">利润率</th>
                <th className="text-right py-2 px-2 font-medium">Sessions</th>
                <th className="text-right py-2 px-2 font-medium">CVR</th>
                <th className="text-right py-2 px-2 font-medium">广告花费</th>
                <th className="text-right py-2 px-2 font-medium">广告销售</th>
                <th className="text-right py-2 px-2 font-medium">ACoS</th>
                <th className="text-right py-2 px-2 font-medium">CPC</th>
                <th className="text-right py-2 px-2 font-medium">曝光</th>
                <th className="text-right py-2 px-2 font-medium">点击</th>
                <th className="text-right py-2 px-2 font-medium">CTR</th>
                <th className="text-right py-2 px-2 font-medium">评分</th>
                <th className="text-right py-2 px-2 font-medium">评论数</th>
                <th className="text-right py-2 px-2 font-medium">退货率</th>
              </tr>
            </thead>
            <tbody>
              {displayWeeks.map((w, idx) => (
                <tr key={idx} className={`border-b last:border-0 hover:bg-muted/30 ${idx === 0 ? "bg-blue-50/30" : ""}`}>
                  <td className="py-1.5 px-2 font-medium sticky left-0 bg-inherit z-10 whitespace-nowrap">
                    {fmtWeekRange(w.weekStartDate, w.weekEndDate)}
                    {idx === 0 && <Badge variant="secondary" className="ml-1 text-[9px] px-1 py-0">最新</Badge>}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono">
                    {fmtNum(w.salesQty)}
                    {w.wow?.salesQty && <WowBadge wow={w.wow.salesQty} />}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono">{fmtNum(w.orderQty)}</td>
                  <td className="py-1.5 px-2 text-right font-mono">${fmtNum(w.salesAmount, 1)}</td>
                  <td className={`py-1.5 px-2 text-right font-mono ${w.orderProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    ${fmtNum(w.orderProfit, 1)}
                  </td>
                  <td className="py-1.5 px-2 text-right">{fmtPct(w.profitMargin)}</td>
                  <td className="py-1.5 px-2 text-right font-mono">{fmtNum(w.sessionTotal)}</td>
                  <td className="py-1.5 px-2 text-right">{fmtPct(w.totalCvr)}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-red-600">${fmtNum(w.adSpend, 1)}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-emerald-600">${fmtNum(w.adSales, 1)}</td>
                  <td className={`py-1.5 px-2 text-right ${w.acos <= 25 ? "text-emerald-600" : w.acos <= 40 ? "text-amber-600" : "text-red-600"}`}>
                    {fmtPct(w.acos)}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono">${fmtNum(w.cpc, 2)}</td>
                  <td className="py-1.5 px-2 text-right font-mono">{fmtNum(w.adImpressions)}</td>
                  <td className="py-1.5 px-2 text-right font-mono">{fmtNum(w.adClicks)}</td>
                  <td className="py-1.5 px-2 text-right">{fmtPct(w.ctr)}</td>
                  <td className="py-1.5 px-2 text-right">{w.rating > 0 ? w.rating.toFixed(1) : "-"}</td>
                  <td className="py-1.5 px-2 text-right font-mono">{fmtNum(w.reviewCount)}</td>
                  <td className="py-1.5 px-2 text-right">{fmtPct(w.returnRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Trend Charts for Import Mode ───
function ImportCharts({ data }: { data: any[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">暂无趋势数据</p>;
  }

  return (
    <div className="space-y-6">
      {/* Sales & Revenue Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">销量 & 销售额趋势</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="week" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={50} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
              <RTooltip contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="salesQty" name="销量" fill="#3b82f6" opacity={0.7} />
              <Line yAxisId="right" type="monotone" dataKey="salesAmount" name="销售额($)" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Profit & Margin Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">利润趋势</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="week" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 11 }} />
              <RTooltip contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="orderProfit" name="利润($)" fill="#10b981" fillOpacity={0.2} stroke="#10b981" strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Traffic & CVR Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">流量 & 转化率趋势</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="week" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={50} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} domain={[0, 'auto']} />
              <RTooltip contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="sessionTotal" name="Sessions" fill="#8b5cf6" opacity={0.6} />
              <Line yAxisId="right" type="monotone" dataKey="totalCvr" name="CVR(%)" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Ads Performance Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">广告表现趋势</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="week" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={50} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} domain={[0, 'auto']} />
              <RTooltip contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="adSpend" name="广告花费($)" fill="#ef4444" opacity={0.6} />
              <Line yAxisId="right" type="monotone" dataKey="acos" name="ACoS(%)" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
