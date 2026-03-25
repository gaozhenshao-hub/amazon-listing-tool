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
  Store, User, Globe, Users, CheckSquare,
  DollarSign, TrendingUp, TrendingDown, BarChart3, Boxes, Megaphone, ArrowUpRight, ArrowDownRight, Minus,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

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

export default function OpsProducts() {
  const [, navigate] = useLocation();
  const [dashboardPeriod, setDashboardPeriod] = useState<"day" | "week" | "month">("month");
  const [marketplaceFilter, setMarketplaceFilter] = useState("ALL");

  const { data: products, isLoading, refetch } = trpc.productOps.listProducts.useQuery();
  const { data: dashboard, isLoading: dashLoading } = trpc.productOps.getProductDashboard.useQuery({
    marketplace: marketplaceFilter !== "ALL" ? marketplaceFilter : undefined,
    period: dashboardPeriod,
  });

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

  const [showCreate, setShowCreate] = useState(false);
  const [showBatchAssign, setShowBatchAssign] = useState(false);
  const [batchOperator, setBatchOperator] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [operatorFilter, setOperatorFilter] = useState("ALL");
  const [storeFilter, setStoreFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
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
    if (marketplaceFilter !== "ALL") list = list.filter(p => p.marketplace === marketplaceFilter);
    if (operatorFilter !== "ALL") list = list.filter(p => (p.operator || "") === operatorFilter);
    if (storeFilter !== "ALL") list = list.filter(p => (p.storeName || "") === storeFilter);
    if (statusFilter !== "ALL") list = list.filter(p => p.status === statusFilter);
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.parentAsin.toLowerCase().includes(q) ||
        (p.brand || "").toLowerCase().includes(q) ||
        (p.operator || "").toLowerCase().includes(q) ||
        (p.storeName || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [products, marketplaceFilter, operatorFilter, storeFilter, statusFilter, searchTerm]);

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
        {availableOperators.length > 0 && (
          <div className="flex items-center gap-1">
            <User className="h-4 w-4 text-muted-foreground" />
            <Select value={operatorFilter} onValueChange={setOperatorFilter}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="运营" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部运营</SelectItem>
                {availableOperators.map(o => (
                  <SelectItem key={o} value={o}>{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Product List */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Card key={i} className="animate-pulse">
              <CardContent className="pt-6 h-40" />
            </Card>
          ))}
        </div>
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
        <>
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
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
            <span className="text-sm text-muted-foreground">全选当前页 ({filtered.length})</span>
          </div>
          <span className="text-xs text-muted-foreground">
            在售 {activeCount} / 暂停 {inactiveCount} / 共 {filtered.length}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(product => (
            <Card
              key={product.id}
              className={`cursor-pointer hover:shadow-md transition-shadow group ${selectedIds.has(product.id) ? 'ring-2 ring-blue-400' : ''}`}
              onClick={() => navigate(`/ops/products/${product.id}`)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <Checkbox
                      checked={selectedIds.has(product.id)}
                      onCheckedChange={(checked) => {
                        const next = new Set(selectedIds);
                        if (checked) next.add(product.id); else next.delete(product.id);
                        setSelectedIds(next);
                      }}
                      onClick={(e: React.MouseEvent) => e.stopPropagation()}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base truncate">{product.title}</CardTitle>
                      <p className="text-sm text-muted-foreground mt-1 font-mono">{product.parentAsin}</p>
                    </div>
                  </div>
                  <Badge variant="secondary" className={statusColors[product.status] || ""}>
                    {statusLabels[product.status] || product.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5 text-sm">
                  {product.brand && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">品牌</span>
                      <span>{product.brand}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">站点</span>
                    <span>{product.marketplace}</span>
                  </div>
                  {product.storeName && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground flex items-center gap-1"><Store className="h-3 w-3" />店铺</span>
                      <span className="truncate max-w-[160px]">{product.storeName}</span>
                    </div>
                  )}
                  {product.operator && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground flex items-center gap-1"><User className="h-3 w-3" />运营</span>
                      <span>{product.operator}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">变体数</span>
                    <span>{product.variantCount}</span>
                  </div>
                  {product.pendingTodoCount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">待办任务</span>
                      <Badge variant="destructive" className="text-xs">{product.pendingTodoCount}</Badge>
                    </div>
                  )}
                </div>
                <div className="mt-3 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm("确定删除该产品及其所有关联数据？")) {
                        deleteMut.mutate({ id: product.id });
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        </>
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
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-500" />
              批量分配运营负责人
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">将 {selectedIds.size} 个产品分配给指定运营负责人</p>
            <div>
              <Label>运营负责人</Label>
              <div className="mt-1 space-y-2">
                {availableOperators.length > 0 && (
                  <Select value={batchOperator} onValueChange={setBatchOperator}>
                    <SelectTrigger>
                      <SelectValue placeholder="选择已有运营..." />
                    </SelectTrigger>
                    <SelectContent>
                      {availableOperators.map(o => (
                        <SelectItem key={o} value={o}>{o}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Input
                  placeholder="或输入新的运营名称..."
                  value={batchOperator}
                  onChange={e => setBatchOperator(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBatchAssign(false)}>取消</Button>
            <Button
              onClick={() => batchAssignMut.mutate({ productIds: Array.from(selectedIds), operator: batchOperator })}
              disabled={!batchOperator || batchAssignMut.isPending}
            >
              {batchAssignMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              确认分配
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
