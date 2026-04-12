import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Plus, Search, Package, ShoppingBag, AlertCircle, CheckCircle2, Trash2, Loader2, Download,
  Store, User, Globe, Users, CheckSquare, UserPlus, UserCheck,
  DollarSign, TrendingUp, TrendingDown, BarChart3, Boxes, Megaphone, ArrowUpRight, ArrowDownRight, Minus,
  ChevronUp, ChevronDown, ExternalLink,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";

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

const PERIOD_OPTIONS = [
  { value: "day", label: "近1天" },
  { value: "week", label: "近7天" },
  { value: "month", label: "近30天" },
];

function ChangeIndicator({ value, suffix = "%" }: { value: number; suffix?: string }) {
  if (Math.abs(value) < 0.01) return <span className="text-xs text-muted-foreground flex items-center gap-0.5"><Minus className="h-3 w-3" /> 持平</span>;
  const isUp = value > 0;
  return (
    <span className={`text-xs flex items-center gap-0.5 ${isUp ? "text-emerald-600" : "text-red-500"}`}>
      {isUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {isUp ? "+" : ""}{value.toFixed(1)}{suffix}
    </span>
  );
}

function formatCurrency(val: number) {
  if (val >= 10000) return `$${(val / 1000).toFixed(1)}K`;
  return `$${val.toFixed(2)}`;
}

function formatNumber(val: number) {
  if (val >= 10000) return `${(val / 1000).toFixed(1)}K`;
  return val.toLocaleString();
}

type SortField = "marketplace" | "storeName" | "title" | "salesQty" | "salesRevenue" | "salesProfit" | "profitRate" | "status" | "operator" | "chineseName" | "weeklySalesQty" | "weeklyProfit" | "weeklyAcos" | "weeklyAdSpend";
type SortDir = "asc" | "desc";

export default function OpsProducts() {
  const [, navigate] = useLocation();
  const [dashboardPeriod, setDashboardPeriod] = useState<"day" | "week" | "month">("month");
  const [marketplaceFilter, setMarketplaceFilter] = useState("US");

  const createMut = trpc.productOps.createProduct.useMutation({
    onSuccess: () => { refetch(); setShowCreate(false); resetForm(); toast.success("产品创建成功"); },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteMut = trpc.productOps.deleteProduct.useMutation({
    onSuccess: () => { refetch(); toast.success("产品已删除"); },
    onError: (e: any) => toast.error(e.message),
  });
  const syncMut = trpc.productOps.syncFromLingxing.useMutation({
    onSuccess: (data) => {
      refetch();
      toast.success(`同步完成：新增${data.synced}个，更新${data.updated}个，共${data.total}个产品`);
    },
    onError: (e: any) => toast.error("同步失败", { description: e.message }),
  });
  const batchAssignMut = trpc.productOps.batchAssignOperator.useMutation({
    onSuccess: (data) => {
      refetch();
      setSelectedIds(new Set());
      setShowBatchAssign(false);
      setBatchOperator("");
      toast.success(`已将${data.updated}个产品分配给 ${data.operator}`);
    },
    onError: (e: any) => toast.error(e.message),
  });
  const singleAssignMut = trpc.productOps.batchAssignOperator.useMutation({
    onSuccess: (data) => {
      refetch();
      toast.success(`已分配给 ${data.operator}`);
    },
    onError: (e: any) => toast.error(e.message),
  });
  const batchSyncWeeklyMut = trpc.productOps.batchSyncWeeklyOps.useMutation({
    onSuccess: (data) => {
      refetch();
      toast.success(`批量同步完成：${data.total}个产品，${data.synced}周数据已同步${data.errors > 0 ? `，${data.errors}个失败` : ''}`);
    },
    onError: (e: any) => toast.error("批量同步失败", { description: e.message }),
  });
  const { data: operatorList } = trpc.productOps.listOperators.useQuery();

  const [showCreate, setShowCreate] = useState(false);
  const [showBatchAssign, setShowBatchAssign] = useState(false);
  const [batchOperator, setBatchOperator] = useState("");
  const [newOperatorName, setNewOperatorName] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [inlineAssignId, setInlineAssignId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [operatorFilter, setOperatorFilter] = useState("ALL");
  const [storeFilter, setStoreFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("active");

  // Queries - placed after all state declarations
  const { data: products, isLoading, refetch } = trpc.productOps.listProducts.useQuery({
    period: dashboardPeriod,
    marketplace: marketplaceFilter !== "ALL" ? marketplaceFilter : "all",
    statusFilter: statusFilter !== "ALL" ? statusFilter as any : "all",
  });
  const { data: dashboard, isLoading: dashLoading } = trpc.productOps.getProductDashboard.useQuery({
    marketplace: marketplaceFilter !== "ALL" ? marketplaceFilter : undefined,
    period: dashboardPeriod,
  });

  // Fetch weekly ops summary for all products
  const productIds = useMemo(() => (products || []).map(p => p.id), [products]);
  const { data: weeklySummary } = trpc.productOps.getProductsWeeklySummary.useQuery(
    { productIds },
    { enabled: productIds.length > 0 }
  );
  const weeklyMap = useMemo(() => {
    const m = new Map<number, { weekStartDate: string | null; salesQty: number; orderProfit: string; acos: string; salesAmount: string; adSpend: string; salesTrend: string }>();
    (weeklySummary || []).forEach(w => m.set(w.productId, w));
    return m;
  }, [weeklySummary]);

  const [sortField, setSortField] = useState<SortField>("salesRevenue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [form, setForm] = useState({
    parentAsin: "", title: "", brand: "", category: "", marketplace: "US",
    budgetRevenue: "", budgetProfit: "", budgetAcos: "", notes: "",
    operator: "", storeName: "",
  });

  function resetForm() {
    setForm({ parentAsin: "", title: "", brand: "", category: "", marketplace: "US", budgetRevenue: "", budgetProfit: "", budgetAcos: "", notes: "", operator: "", storeName: "" });
  }

  const filtered = useMemo(() => {
    let list = products || [];
    // Note: marketplace and status filtering now done server-side, but keep client-side for additional filtering
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
        ((p as any).chineseName || "").toLowerCase().includes(q)
      );
    }
    // Sort
    const sorted = [...list].sort((a, b) => {
      let va: any, vb: any;
      switch (sortField) {
        case "marketplace": va = a.marketplace || ""; vb = b.marketplace || ""; break;
        case "storeName": va = a.storeName || ""; vb = b.storeName || ""; break;
        case "title": va = a.title || ""; vb = b.title || ""; break;
        case "chineseName": va = (a as any).chineseName || ""; vb = (b as any).chineseName || ""; break;
        case "operator": va = a.operator || ""; vb = b.operator || ""; break;
        case "salesQty": va = a.salesQty || 0; vb = b.salesQty || 0; break;
        case "salesRevenue": va = a.salesRevenue || 0; vb = b.salesRevenue || 0; break;
        case "salesProfit": va = a.salesProfit || 0; vb = b.salesProfit || 0; break;
        case "profitRate": va = (a as any).profitRate || 0; vb = (b as any).profitRate || 0; break;
        case "weeklySalesQty": va = Number(weeklyMap.get(a.id)?.salesQty || 0); vb = Number(weeklyMap.get(b.id)?.salesQty || 0); break;
        case "weeklyProfit": va = parseFloat(weeklyMap.get(a.id)?.orderProfit || "0"); vb = parseFloat(weeklyMap.get(b.id)?.orderProfit || "0"); break;
        case "weeklyAcos": va = parseFloat(weeklyMap.get(a.id)?.acos || "0"); vb = parseFloat(weeklyMap.get(b.id)?.acos || "0"); break;
        case "weeklyAdSpend": va = parseFloat(weeklyMap.get(a.id)?.adSpend || "0"); vb = parseFloat(weeklyMap.get(b.id)?.adSpend || "0"); break;
        case "status": va = a.status; vb = b.status; break;
        default: va = 0; vb = 0;
      }
      if (typeof va === "string") {
        return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return sortDir === "asc" ? va - vb : vb - va;
    });
    return sorted;
  }, [products, operatorFilter, storeFilter, searchTerm, sortField, sortDir]);

  const availableMarketplaces = useMemo(() => {
    const set = new Set((products || []).map(p => p.marketplace || "US"));
    return Array.from(set).sort();
  }, [products]);

  const availableOperators = useMemo(() => {
    const set = new Set((products || []).map(p => p.operator || "").filter(Boolean));
    return Array.from(set).sort();
  }, [products]);

  const availableStores = useMemo(() => {
    const set = new Set((products || []).map(p => p.storeName || "").filter(Boolean));
    return Array.from(set).sort();
  }, [products]);

  const statusColors: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-700",
    inactive: "bg-gray-100 text-gray-600",
    discontinued: "bg-red-100 text-red-700",
  };
  const statusLabels: Record<string, string> = {
    active: "在售", inactive: "暂停", discontinued: "停售",
  };

  const activeCount = filtered.filter(p => p.status === "active").length;
  const inactiveCount = filtered.filter(p => p.status === "inactive").length;

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronDown className="h-3 w-3 text-muted-foreground/40" />;
    return sortDir === "asc" ? <ChevronUp className="h-3 w-3 text-blue-600" /> : <ChevronDown className="h-3 w-3 text-blue-600" />;
  }

  // Totals for footer
  const totalSalesQty = filtered.reduce((s, p) => s + (p.salesQty || 0), 0);
  const totalRevenue = filtered.reduce((s, p) => s + (p.salesRevenue || 0), 0);
  const totalProfit = filtered.reduce((s, p) => s + (p.salesProfit || 0), 0);
  const avgProfitRate = totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 10000) / 100 : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">产品运营总览</h1>
          <p className="text-muted-foreground mt-1">以父ASIN为维度管理产品，查看库存、利润、广告和竞品数据</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => batchSyncWeeklyMut.mutate({ weeks: 1 })}
            disabled={batchSyncWeeklyMut.isPending}
            className="gap-2"
          >
            {batchSyncWeeklyMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
            {batchSyncWeeklyMut.isPending ? "同步中..." : "批量同步周度数据"}
          </Button>
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
        </div>
      </div>

      {/* ═══ 数据看板 ═══ */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-blue-600" />
            运营数据看板
          </h2>
          <div className="flex items-center gap-2">
            <Select value={dashboardPeriod} onValueChange={(v: any) => setDashboardPeriod(v)}>
              <SelectTrigger className="w-[120px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Product Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="border-l-4 border-l-blue-500">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2">
                <ShoppingBag className="h-4 w-4 text-blue-600" />
                <span className="text-xs text-muted-foreground">总产品数</span>
              </div>
              <p className="text-xl font-bold mt-1">{dashboard?.products?.total ?? filtered.length}</p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-emerald-500">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span className="text-xs text-muted-foreground">在售产品</span>
              </div>
              <p className="text-xl font-bold mt-1">{dashboard?.products?.active ?? activeCount}</p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-gray-400">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-gray-500" />
                <span className="text-xs text-muted-foreground">暂停/停售</span>
              </div>
              <p className="text-xl font-bold mt-1">{dashboard?.products?.inactive ?? inactiveCount}</p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-orange-500">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-orange-600" />
                <span className="text-xs text-muted-foreground">待办任务</span>
              </div>
              <p className="text-xl font-bold mt-1">{filtered.reduce((s, p) => s + p.pendingTodoCount, 0)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Financial & Inventory & Ad Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* 利润数据 */}
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium flex items-center gap-1.5">
                  <DollarSign className="h-4 w-4 text-green-600" /> 利润数据
                </span>
                {dashboard?.profit?.changes && (
                  <ChangeIndicator value={dashboard.profit.changes.revenue} />
                )}
              </div>
              {dashLoading ? (
                <div className="space-y-2 animate-pulse">
                  <div className="h-4 bg-muted rounded w-3/4" />
                  <div className="h-4 bg-muted rounded w-1/2" />
                </div>
              ) : (
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">销售额</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{formatCurrency(dashboard?.profit?.current?.revenue || 0)}</span>
                      {dashboard?.profit?.changes && <ChangeIndicator value={dashboard.profit.changes.revenue} />}
                    </div>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">利润</span>
                    <div className="flex items-center gap-2">
                      <span className={`font-medium ${(dashboard?.profit?.current?.profit || 0) >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                        {formatCurrency(dashboard?.profit?.current?.profit || 0)}
                      </span>
                      {dashboard?.profit?.changes && <ChangeIndicator value={dashboard.profit.changes.profit} />}
                    </div>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">利润率</span>
                    <span className="font-medium">{(dashboard?.profit?.current?.profitMargin || 0).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">订单数</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{formatNumber(dashboard?.profit?.current?.orderCount || 0)}</span>
                      {dashboard?.profit?.changes && <ChangeIndicator value={dashboard.profit.changes.orderCount} />}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 库存数据 */}
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium flex items-center gap-1.5">
                  <Boxes className="h-4 w-4 text-blue-600" /> 库存数据
                </span>
              </div>
              {dashLoading ? (
                <div className="space-y-2 animate-pulse">
                  <div className="h-4 bg-muted rounded w-3/4" />
                  <div className="h-4 bg-muted rounded w-1/2" />
                </div>
              ) : (
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">FBA可售库存</span>
                    <span className="font-medium">{formatNumber(dashboard?.inventory?.totalStock || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">在途数量</span>
                    <span className="font-medium">{formatNumber(dashboard?.inventory?.inboundQty || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">预留数量</span>
                    <span className="font-medium">{formatNumber(dashboard?.inventory?.reservedQty || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">库存货值</span>
                    <span className="font-medium">{formatCurrency(dashboard?.inventory?.totalValue || 0)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 广告数据 */}
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium flex items-center gap-1.5">
                  <Megaphone className="h-4 w-4 text-purple-600" /> 广告数据
                </span>
              </div>
              {dashLoading ? (
                <div className="space-y-2 animate-pulse">
                  <div className="h-4 bg-muted rounded w-3/4" />
                  <div className="h-4 bg-muted rounded w-1/2" />
                </div>
              ) : (
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">广告花费</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{formatCurrency(dashboard?.advertising?.totalSpend || 0)}</span>
                      {dashboard?.profit?.changes && <ChangeIndicator value={dashboard.profit.changes.adSpend} />}
                    </div>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">广告销售额</span>
                    <span className="font-medium">{formatCurrency(dashboard?.advertising?.totalSales || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ACoS</span>
                    <span className={`font-medium ${(dashboard?.advertising?.acos || 0) > 30 ? "text-red-500" : "text-emerald-600"}`}>
                      {(dashboard?.advertising?.acos || 0).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ROAS</span>
                    <span className="font-medium">{(dashboard?.advertising?.roas || 0).toFixed(2)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
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

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索ASIN、标题、品牌、运营或店铺..."
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
              {MARKETPLACE_OPTIONS.filter(o => o.value === "ALL" || availableMarketplaces.includes(o.value)).map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
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
                const allOps = new Set<string>();
                availableOperators.forEach(o => allOps.add(o));
                (operatorList || []).forEach((o: string) => allOps.add(o));
                return Array.from(allOps).sort().map(o => (
                  <SelectItem key={o} value={o}>{o}</SelectItem>
                ));
              })()}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ═══ Product Table ═══ */}
      {isLoading ? (
        <Card>
          <CardContent className="p-0">
            <div className="space-y-0">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="flex items-center gap-4 px-4 py-3 border-b last:border-b-0 animate-pulse">
                  <Skeleton className="h-4 w-4 rounded" />
                  <Skeleton className="h-4 w-10" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Package className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">
              {searchTerm || marketplaceFilter !== "ALL" || statusFilter !== "ALL" ? "没有找到匹配的产品" : "还没有添加产品，点击\"从领星同步\"或\"添加产品\"开始"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-2 py-3 text-left w-10">
                    <Checkbox
                      checked={selectedIds.size === filtered.length && filtered.length > 0}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedIds(new Set(filtered.map(p => p.id)));
                        } else {
                          setSelectedIds(new Set());
                        }
                      }}
                    />
                  </th>
                  <th className="px-2 py-3 text-left w-14">
                    <button className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => handleSort("status")}>
                      状态 <SortIcon field="status" />
                    </button>
                  </th>
                  <th className="px-2 py-3 text-left w-14">
                    <button className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => handleSort("marketplace")}>
                      站点 <SortIcon field="marketplace" />
                    </button>
                  </th>
                  <th className="px-2 py-3 text-left">
                    <button className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => handleSort("storeName")}>
                      店铺 <SortIcon field="storeName" />
                    </button>
                  </th>
                  <th className="px-2 py-3 text-left min-w-[120px]">
                    <span className="text-xs font-medium text-muted-foreground">ASIN</span>
                  </th>
                  <th className="px-2 py-3 text-left min-w-[200px]">
                    <button className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => handleSort("title")}>
                      产品名称 <SortIcon field="title" />
                    </button>
                  </th>
                  <th className="px-2 py-3 text-left min-w-[100px]">
                    <button className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => handleSort("chineseName")}>
                      中文名称 <SortIcon field="chineseName" />
                    </button>
                  </th>
                  <th className="px-2 py-3 text-left min-w-[80px]">
                    <button className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => handleSort("operator")}>
                      运营 <SortIcon field="operator" />
                    </button>
                  </th>
                  <th className="px-2 py-3 text-left min-w-[100px]">
                    <span className="text-xs font-medium text-muted-foreground">备注</span>
                  </th>
                  <th className="px-2 py-3 text-right w-16">
                    <button className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground ml-auto" onClick={() => handleSort("salesQty")}>
                      销量 <SortIcon field="salesQty" />
                    </button>
                  </th>
                  <th className="px-2 py-3 text-right w-20">
                    <button className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground ml-auto" onClick={() => handleSort("salesRevenue")}>
                      销售额 <SortIcon field="salesRevenue" />
                    </button>
                  </th>
                  <th className="px-2 py-3 text-right w-20">
                    <button className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground ml-auto" onClick={() => handleSort("salesProfit")}>
                      利润 <SortIcon field="salesProfit" />
                    </button>
                  </th>
                  <th className="px-2 py-3 text-right w-16">
                    <button className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground ml-auto" onClick={() => handleSort("profitRate")}>
                      利润率 <SortIcon field="profitRate" />
                    </button>
                  </th>
                  <th className="px-2 py-3 text-right w-16">
                    <button className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground ml-auto" onClick={() => handleSort("weeklySalesQty")}>
                      周销量 <SortIcon field="weeklySalesQty" />
                    </button>
                  </th>
                  <th className="px-2 py-3 text-right w-20">
                    <button className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground ml-auto" onClick={() => handleSort("weeklyProfit")}>
                      周利润 <SortIcon field="weeklyProfit" />
                    </button>
                  </th>
                  <th className="px-2 py-3 text-right w-16">
                    <button className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground ml-auto" onClick={() => handleSort("weeklyAcos")}>
                      ACOS <SortIcon field="weeklyAcos" />
                    </button>
                  </th>
                  <th className="px-2 py-3 text-right w-20">
                    <button className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground ml-auto" onClick={() => handleSort("weeklyAdSpend")}>
                      广告费 <SortIcon field="weeklyAdSpend" />
                    </button>
                  </th>
                  <th className="px-2 py-3 text-center w-14">
                    <span className="text-xs font-medium text-muted-foreground">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((product) => {
                  const p = product as any;
                  const profitRate = (p.salesRevenue || 0) > 0 ? ((p.salesProfit || 0) / (p.salesRevenue || 1)) * 100 : 0;
                  return (
                  <tr
                    key={product.id}
                    className={`border-b last:border-b-0 hover:bg-muted/30 cursor-pointer transition-colors ${selectedIds.has(product.id) ? 'bg-blue-50/50' : ''}`}
                    onClick={() => navigate(`/ops/products/${product.id}`)}
                  >
                    <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(product.id)}
                        onCheckedChange={(checked) => {
                          const next = new Set(selectedIds);
                          if (checked) next.add(product.id); else next.delete(product.id);
                          setSelectedIds(next);
                        }}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${statusColors[product.status] || ""}`}>
                        {statusLabels[product.status] || product.status}
                      </Badge>
                    </td>
                    <td className="px-2 py-2">
                      <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
                        {product.marketplace || "US"}
                      </Badge>
                    </td>
                    <td className="px-2 py-2">
                      <span className="text-xs text-muted-foreground truncate max-w-[100px] block">
                        {product.storeName || "-"}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[11px] font-mono text-foreground">{product.parentAsin}</span>
                        {p.childAsin && p.childAsin !== product.parentAsin && (
                          <span className="text-[10px] text-muted-foreground font-mono">父: {p.childAsin}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <span className="font-medium text-xs truncate max-w-[220px] block">{product.title}</span>
                    </td>
                    <td className="px-2 py-2">
                      <span className="text-xs text-muted-foreground truncate max-w-[120px] block">
                        {p.chineseName || "-"}
                      </span>
                    </td>
                    <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
                      <Popover open={inlineAssignId === product.id} onOpenChange={(open) => {
                        if (open) { setInlineAssignId(product.id); setNewOperatorName(""); }
                        else setInlineAssignId(null);
                      }}>
                        <PopoverTrigger asChild>
                          <button className={`text-xs truncate max-w-[100px] block rounded px-1.5 py-0.5 transition-colors ${
                            product.operator
                              ? "text-foreground hover:bg-blue-50 hover:text-blue-700 cursor-pointer"
                              : "text-muted-foreground/50 hover:bg-orange-50 hover:text-orange-600 cursor-pointer italic"
                          }`}>
                            {product.operator || "+ 分配"}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56 p-2" align="start">
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">分配运营负责人</p>
                            {(operatorList || []).length > 0 && (
                              <div className="max-h-32 overflow-y-auto space-y-0.5">
                                {(operatorList || []).map(name => (
                                  <button
                                    key={name}
                                    className={`w-full text-left text-xs px-2 py-1.5 rounded transition-colors flex items-center gap-1.5 ${
                                      product.operator === name
                                        ? "bg-blue-100 text-blue-700 font-medium"
                                        : "hover:bg-muted"
                                    }`}
                                    onClick={() => {
                                      singleAssignMut.mutate({ productIds: [product.id], operator: name });
                                      setInlineAssignId(null);
                                    }}
                                  >
                                    {product.operator === name ? <UserCheck className="h-3 w-3" /> : <User className="h-3 w-3 text-muted-foreground" />}
                                    {name}
                                  </button>
                                ))}
                              </div>
                            )}
                            <div className="flex gap-1 pt-1 border-t">
                              <Input
                                placeholder="新运营名称..."
                                value={newOperatorName}
                                onChange={e => setNewOperatorName(e.target.value)}
                                className="h-7 text-xs"
                                onKeyDown={e => {
                                  if (e.key === "Enter" && newOperatorName.trim()) {
                                    singleAssignMut.mutate({ productIds: [product.id], operator: newOperatorName.trim() });
                                    setInlineAssignId(null);
                                    setNewOperatorName("");
                                  }
                                }}
                              />
                              <Button
                                size="sm"
                                className="h-7 px-2 text-xs"
                                disabled={!newOperatorName.trim()}
                                onClick={() => {
                                  singleAssignMut.mutate({ productIds: [product.id], operator: newOperatorName.trim() });
                                  setInlineAssignId(null);
                                  setNewOperatorName("");
                                }}
                              >
                                <UserPlus className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </td>
                    <td className="px-2 py-2">
                      <span className="text-xs text-muted-foreground truncate max-w-[100px] block">
                        {product.notes || "-"}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <span className="font-medium tabular-nums text-xs">{formatNumber(product.salesQty || 0)}</span>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <span className="font-medium tabular-nums text-xs">{formatCurrency(product.salesRevenue || 0)}</span>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <span className={`font-medium tabular-nums text-xs ${(product.salesProfit || 0) >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                        {formatCurrency(product.salesProfit || 0)}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <span className={`font-medium tabular-nums text-xs ${profitRate >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                        {profitRate.toFixed(1)}%
                      </span>
                    </td>
                    {/* Weekly ops columns */}
                    {(() => {
                      const w = weeklyMap.get(product.id);
                      const wp = parseFloat(w?.orderProfit || "0");
                      const wa = parseFloat(w?.acos || "0");
                      const wad = parseFloat(w?.adSpend || "0");
                      const wsq = Number(w?.salesQty || 0);
                      const trend = w?.salesTrend || "stable";
                      return (
                        <>
                          <td className="px-2 py-2 text-right">
                            {w?.weekStartDate ? (
                              <div className="flex items-center justify-end gap-1">
                                {trend === "up" ? <TrendingUp className="h-3 w-3 text-emerald-500" /> : trend === "down" ? <TrendingDown className="h-3 w-3 text-red-500" /> : <Minus className="h-3 w-3 text-gray-400" />}
                                <span className="font-medium tabular-nums text-xs">{wsq}</span>
                              </div>
                            ) : <span className="text-xs text-muted-foreground">-</span>}
                          </td>
                          <td className="px-2 py-2 text-right">
                            {w?.weekStartDate ? (
                              <div className="flex items-center justify-end gap-1">
                                <span className={`font-medium tabular-nums text-xs ${wp >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                                  {formatCurrency(wp)}
                                </span>
                              </div>
                            ) : <span className="text-xs text-muted-foreground">-</span>}
                          </td>
                          <td className="px-2 py-2 text-right">
                            {w?.weekStartDate ? (
                              <span className={`font-medium tabular-nums text-xs ${wa > 30 ? "text-red-500" : wa > 20 ? "text-amber-600" : "text-emerald-600"}`}>
                                {wa.toFixed(1)}%
                              </span>
                            ) : <span className="text-xs text-muted-foreground">-</span>}
                          </td>
                          <td className="px-2 py-2 text-right">
                            {w?.weekStartDate ? (
                              <span className="font-medium tabular-nums text-xs text-muted-foreground">
                                {formatCurrency(wad)}
                              </span>
                            ) : <span className="text-xs text-muted-foreground">-</span>}
                          </td>
                        </>
                      );
                    })()}
                    <td className="px-2 py-2 text-center" onClick={e => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                        onClick={() => {
                          if (confirm("确定删除该产品及其所有关联数据？")) {
                            deleteMut.mutate({ id: product.id });
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
              {/* Footer with totals */}
              <tfoot>
                <tr className="border-t-2 bg-muted/30 font-medium">
                  <td colSpan={9} className="px-2 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                    合计 {filtered.length} 个产品 &nbsp;|&nbsp; 在售 {activeCount} &nbsp;/&nbsp; 暂停 {inactiveCount}
                  </td>
                  <td className="px-2 py-2.5 text-right text-xs tabular-nums font-semibold">{formatNumber(totalSalesQty)}</td>
                  <td className="px-2 py-2.5 text-right text-xs tabular-nums font-semibold">{formatCurrency(totalRevenue)}</td>
                  <td className="px-2 py-2.5 text-right text-xs tabular-nums font-semibold">
                    <span className={totalProfit >= 0 ? "text-emerald-600" : "text-red-500"}>
                      {formatCurrency(totalProfit)}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-right text-xs tabular-nums font-semibold">
                    <span className={avgProfitRate >= 0 ? "text-emerald-600" : "text-red-500"}>
                      {avgProfitRate.toFixed(1)}%
                    </span>
                  </td>
                  {/* Weekly totals */}
                  {(() => {
                    let twp = 0, twad = 0, twSales = 0, twSalesQty = 0;
                    filtered.forEach(p => {
                      const w = weeklyMap.get(p.id);
                      if (w?.weekStartDate) {
                        twp += parseFloat(w.orderProfit || "0");
                        twad += parseFloat(w.adSpend || "0");
                        twSales += parseFloat(w.salesAmount || "0");
                        twSalesQty += Number(w.salesQty || 0);
                      }
                    });
                    const twAcos = twSales > 0 ? (twad / twSales * 100) : 0;
                    return (
                      <>
                        <td className="px-2 py-2.5 text-right text-xs tabular-nums font-semibold">{twSalesQty}</td>
                        <td className="px-2 py-2.5 text-right text-xs tabular-nums font-semibold">
                          <span className={twp >= 0 ? "text-emerald-600" : "text-red-500"}>{formatCurrency(twp)}</span>
                        </td>
                        <td className="px-2 py-2.5 text-right text-xs tabular-nums font-semibold">
                          <span className={twAcos > 30 ? "text-red-500" : twAcos > 20 ? "text-amber-600" : "text-emerald-600"}>{twAcos.toFixed(1)}%</span>
                        </td>
                        <td className="px-2 py-2.5 text-right text-xs tabular-nums font-semibold text-muted-foreground">{formatCurrency(twad)}</td>
                      </>
                    );
                  })()}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
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
                <Input
                  placeholder="B0XXXXXXXX"
                  value={form.parentAsin}
                  onChange={e => setForm(f => ({ ...f, parentAsin: e.target.value }))}
                />
              </div>
              <div>
                <Label>站点</Label>
                <Select value={form.marketplace} onValueChange={v => setForm(f => ({ ...f, marketplace: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="US">US</SelectItem>
                    <SelectItem value="UK">UK</SelectItem>
                    <SelectItem value="DE">DE</SelectItem>
                    <SelectItem value="JP">JP</SelectItem>
                    <SelectItem value="CA">CA</SelectItem>
                    <SelectItem value="FR">FR</SelectItem>
                    <SelectItem value="IT">IT</SelectItem>
                    <SelectItem value="ES">ES</SelectItem>
                    <SelectItem value="AU">AU</SelectItem>
                    <SelectItem value="MX">MX</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>产品标题 *</Label>
              <Input
                placeholder="输入产品标题"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>品牌</Label>
                <Input
                  placeholder="品牌名称"
                  value={form.brand}
                  onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}
                />
              </div>
              <div>
                <Label>类目</Label>
                <Input
                  placeholder="产品类目"
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>店铺名称</Label>
                <Input
                  placeholder="所属店铺"
                  value={form.storeName}
                  onChange={e => setForm(f => ({ ...f, storeName: e.target.value }))}
                />
              </div>
              <div>
                <Label>运营负责人</Label>
                <Input
                  placeholder="负责人姓名"
                  value={form.operator}
                  onChange={e => setForm(f => ({ ...f, operator: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>预算收入</Label>
                <Input
                  type="number"
                  placeholder="$"
                  value={form.budgetRevenue}
                  onChange={e => setForm(f => ({ ...f, budgetRevenue: e.target.value }))}
                />
              </div>
              <div>
                <Label>预算利润</Label>
                <Input
                  type="number"
                  placeholder="$"
                  value={form.budgetProfit}
                  onChange={e => setForm(f => ({ ...f, budgetProfit: e.target.value }))}
                />
              </div>
              <div>
                <Label>目标ACoS%</Label>
                <Input
                  type="number"
                  placeholder="%"
                  value={form.budgetAcos}
                  onChange={e => setForm(f => ({ ...f, budgetAcos: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label>备注</Label>
              <Textarea
                placeholder="产品备注..."
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>取消</Button>
            <Button
              onClick={() => createMut.mutate(form)}
              disabled={!form.parentAsin || !form.title || createMut.isPending}
            >
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
              <p className="text-sm text-blue-700">已选择 <span className="font-bold">{selectedIds.size}</span> 个产品，将统一分配给指定运营负责人</p>
            </div>
            <div>
              <Label className="text-sm font-medium">选择团队成员</Label>
              <div className="mt-2 max-h-48 overflow-y-auto space-y-1 border rounded-lg p-2">
                {(operatorList || []).length > 0 ? (
                  (operatorList || []).map(name => (
                    <button
                      key={name}
                      className={`w-full text-left text-sm px-3 py-2 rounded-md transition-colors flex items-center gap-2 ${
                        batchOperator === name
                          ? "bg-blue-100 text-blue-700 font-medium ring-1 ring-blue-300"
                          : "hover:bg-muted"
                      }`}
                      onClick={() => setBatchOperator(name)}
                    >
                      {batchOperator === name ? <UserCheck className="h-4 w-4" /> : <User className="h-4 w-4 text-muted-foreground" />}
                      {name}
                    </button>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-4">暂无团队成员，请在下方输入新名称</p>
                )}
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium">或输入新运营名称</Label>
              <Input
                className="mt-1"
                placeholder="输入新的运营名称..."
                value={batchOperator}
                onChange={e => setBatchOperator(e.target.value)}
              />
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
