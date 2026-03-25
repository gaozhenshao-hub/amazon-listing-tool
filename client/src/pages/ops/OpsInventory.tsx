import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useMarketplace } from "@/contexts/MarketplaceContext";
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
  ChevronRight, ExternalLink, Boxes, Warehouse, Tag, Plus, X, Pencil, Trash2, Eye, EyeOff,
  Search, FileText, MessageSquare, Send, History,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";

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
  const [showTagManager, setShowTagManager] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#6366f1");
  const [newTagHide, setNewTagHide] = useState(true);
  const [editingTag, setEditingTag] = useState<any>(null);
  const [tagFilterMode, setTagFilterMode] = useState<"hide" | "show_all">("hide");
  const [operatorFilter, setOperatorFilter] = useState("all");
  const [storeFilter, setStoreFilter] = useState("all");
  const { marketplace } = useMarketplace();

  // Tag system
  const { data: tagDefs, refetch: refetchTags } = trpc.operations.listTagDefinitions.useQuery();
  const { data: tagAssignments, refetch: refetchAssignments } = trpc.operations.listTagAssignments.useQuery();
  const createTag = trpc.operations.createTagDefinition.useMutation({
    onSuccess: () => { refetchTags(); setNewTagName(""); toast.success("标签创建成功"); },
  });
  const updateTag = trpc.operations.updateTagDefinition.useMutation({
    onSuccess: () => { refetchTags(); setEditingTag(null); toast.success("标签已更新"); },
  });
  const deleteTag = trpc.operations.deleteTagDefinition.useMutation({
    onSuccess: () => { refetchTags(); refetchAssignments(); toast.success("标签已删除"); },
  });
  const assignTag = trpc.operations.assignTag.useMutation({
    onSuccess: () => { refetchAssignments(); toast.success("标签已添加"); },
  });
  const removeTagMut = trpc.operations.removeTag.useMutation({
    onSuccess: () => { refetchAssignments(); toast.success("标签已移除"); },
  });

  // Build tag lookup: asin -> [{tagId, tagName, tagColor, hideFromInventory}]
  const asinTagMap = useMemo(() => {
    const map = new Map<string, Array<{tagId: number; name: string; color: string; hide: boolean}>>();
    if (!tagDefs || !tagAssignments) return map;
    const defMap = new Map(tagDefs.map((d: any) => [d.id, d]));
    for (const a of tagAssignments) {
      const def = defMap.get(a.tagId) as any;
      if (!def) continue;
      const arr = map.get(a.asin) || [];
      arr.push({ tagId: def.id, name: def.name, color: def.color, hide: !!def.hideFromInventory });
      map.set(a.asin, arr);
    }
    return map;
  }, [tagDefs, tagAssignments]);

  // Hidden ASINs = those with any tag that has hideFromInventory=1
  const hiddenAsins = useMemo(() => {
    const set = new Set<string>();
    asinTagMap.forEach((tags, asin) => {
      if (tags.some(t => t.hide)) set.add(asin);
    });
    return set;
  }, [asinTagMap]);

  const { data, isLoading, refetch } = trpc.operations.getInventoryList.useQuery({
    alertFilter,
    sortBy,
    sortOrder,
    marketplace,
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

  const allItems = data?.items || [];
  const items = useMemo(() => {
    let list = tagFilterMode === "hide"
      ? allItems.filter((item: any) => !hiddenAsins.has(item.asin))
      : allItems;
    if (operatorFilter !== "all") {
      list = list.filter((item: any) => (item.operator || "") === operatorFilter);
    }
    if (storeFilter !== "all") {
      list = list.filter((item: any) => (item.store_name || "") === storeFilter);
    }
    return list;
  }, [allItems, tagFilterMode, hiddenAsins, operatorFilter, storeFilter]);
  const stats = data?.stats;

  // Available operators and stores for filters
  const availableOperators = useMemo((): string[] => {
    const arr: string[] = allItems.map((i: any) => String(i.operator || "")).filter(Boolean);
    return Array.from(new Set(arr)).sort();
  }, [allItems]);
  const availableStores = useMemo((): string[] => {
    const arr: string[] = allItems.map((i: any) => String(i.store_name || "")).filter(Boolean);
    return Array.from(new Set(arr)).sort();
  }, [allItems]);
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
            {availableStores.length > 0 && (
              <div className="flex items-center gap-2">
                <Warehouse className="w-4 h-4 text-gray-400" />
                <Select value={storeFilter} onValueChange={setStoreFilter}>
                  <SelectTrigger className="w-36 h-8 text-sm"><SelectValue placeholder="店铺" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部店铺</SelectItem>
                    {availableStores.map((s: string) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {availableOperators.length > 0 && (
              <div className="flex items-center gap-2">
                <Select value={operatorFilter} onValueChange={setOperatorFilter}>
                  <SelectTrigger className="w-32 h-8 text-sm"><SelectValue placeholder="运营" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部运营</SelectItem>
                    {availableOperators.map((o: string) => (
                      <SelectItem key={o} value={o}>{o}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button
                variant={tagFilterMode === "hide" ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs gap-1"
                onClick={() => setTagFilterMode(prev => prev === "hide" ? "show_all" : "hide")}
              >
                {tagFilterMode === "hide" ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                {tagFilterMode === "hide" ? `已隐藏${hiddenAsins.size}个` : "显示全部"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1"
                onClick={() => setShowTagManager(true)}
              >
                <Tag className="w-3 h-3" /> 标签管理
              </Button>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-sm text-gray-500">共 {items.length}{hiddenAsins.size > 0 && tagFilterMode === "hide" ? `/${allItems.length}` : ''} 个SKU</span>
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
                      <th className="text-left p-3 font-medium text-gray-600">店铺</th>
                      <th className="text-left p-3 font-medium text-gray-600">运营</th>
                      <th className="text-right p-3 font-medium text-gray-600">可售数量</th>
                      <th className="text-right p-3 font-medium text-gray-600">在途数量</th>
                      <th className="text-right p-3 font-medium text-gray-600">日均销量</th>
                      <th className="text-right p-3 font-medium text-gray-600">可供天数</th>
                      <th className="text-center p-3 font-medium text-gray-600">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 ? (
                      <tr><td colSpan={10} className="text-center py-12 text-gray-400">暂无库存数据</td></tr>
                    ) : (
                      items.map((item: any, idx: number) => {
                        const alertStyle = ALERT_COLORS[item.alertLevel as keyof typeof ALERT_COLORS] || ALERT_COLORS.normal;
                        const isHidden = hiddenAsins.has(item.asin);
                        const itemTags = asinTagMap.get(item.asin) || [];
                        return (
                          <tr key={idx} className={`border-b hover:bg-gray-50/50 ${isHidden ? 'opacity-50 bg-gray-50' : alertStyle.bg}`}>
                            <td className="p-3 font-mono text-xs">{item.seller_sku}</td>
                            <td className="p-3 font-mono text-xs text-gray-500">
                              {item.asin || "-"}
                            </td>
                            <td className="p-3 max-w-[180px] truncate">{item.product_name || "-"}</td>
                            <td className="p-3 text-xs text-gray-500 max-w-[100px] truncate">{item.store_name || "-"}</td>
                            <td className="p-3 text-xs text-gray-500">{item.operator || "-"}</td>
                            <td className="p-3 text-right font-medium">{(item.fulfillable_qty || 0).toLocaleString()}</td>
                            <td className="p-3 text-right text-blue-600">{(item.inbound_quantity || 0).toLocaleString()}</td>
                            <td className="p-3 text-right">{Number(item.avg_daily_sales || 0).toFixed(1)}</td>
                            <td className="p-3 text-right font-bold">{item.days_of_supply || 0}</td>
                            <td className="p-3">
                              <div className="flex items-center gap-1 justify-center flex-wrap">
                                <Badge variant={alertStyle.badge} className={`text-[10px] ${alertStyle.text}`}>{alertStyle.label}</Badge>
                                {itemTags.map(t => (
                                  <span key={t.tagId} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full text-white font-medium" style={{ backgroundColor: t.color }}>
                                    {t.name}
                                    <button onClick={(e) => { e.stopPropagation(); removeTagMut.mutate({ tagId: t.tagId, asin: item.asin }); }} className="ml-0.5 hover:opacity-70"><X className="w-2.5 h-2.5" /></button>
                                  </span>
                                ))}
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-500">
                                      <Plus className="w-2.5 h-2.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-40 p-2" align="end">
                                    <div className="space-y-1">
                                      {(tagDefs || []).filter((d: any) => !itemTags.some(t => t.tagId === d.id)).map((d: any) => (
                                        <button
                                          key={d.id}
                                          className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-gray-100 flex items-center gap-2"
                                          onClick={() => assignTag.mutate({ tagId: d.id, asin: item.asin, msku: item.seller_sku })}
                                        >
                                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                                          {d.name}
                                          {d.hideFromInventory ? <EyeOff className="w-3 h-3 text-gray-400 ml-auto" /> : null}
                                        </button>
                                      ))}
                                      {(tagDefs || []).length === 0 && <p className="text-xs text-gray-400 text-center py-2">暂无标签，请先创建</p>}
                                    </div>
                                  </PopoverContent>
                                </Popover>
                              </div>
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

      {/* Tag Manager Dialog */}
      <Dialog open={showTagManager} onOpenChange={setShowTagManager}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Tag className="w-5 h-5" /> 标签管理</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Create new tag */}
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label className="text-xs">标签名称</Label>
                <Input
                  placeholder="如：停售、清仓、新品..."
                  value={newTagName}
                  onChange={e => setNewTagName(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">颜色</Label>
                <input
                  type="color"
                  value={newTagColor}
                  onChange={e => setNewTagColor(e.target.value)}
                  className="w-8 h-8 rounded border cursor-pointer"
                />
              </div>
              <div className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={newTagHide}
                  onChange={e => setNewTagHide(e.target.checked)}
                  id="newTagHide"
                  className="rounded"
                />
                <Label htmlFor="newTagHide" className="text-xs whitespace-nowrap">隐藏</Label>
              </div>
              <Button
                size="sm"
                className="h-8"
                disabled={!newTagName.trim() || createTag.isPending}
                onClick={() => createTag.mutate({ name: newTagName.trim(), color: newTagColor, hideFromInventory: newTagHide ? 1 : 0 })}
              >
                <Plus className="w-3 h-3 mr-1" /> 创建
              </Button>
            </div>

            {/* Existing tags */}
            <div className="space-y-2">
              {(tagDefs || []).length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">暂无标签，请创建第一个标签</p>
              )}
              {(tagDefs || []).map((tag: any) => (
                <div key={tag.id} className="flex items-center gap-2 p-2 rounded border bg-gray-50/50">
                  {editingTag?.id === tag.id ? (
                    <>
                      <Input
                        value={editingTag.name}
                        onChange={e => setEditingTag({ ...editingTag, name: e.target.value })}
                        className="h-7 text-sm flex-1"
                      />
                      <input
                        type="color"
                        value={editingTag.color}
                        onChange={e => setEditingTag({ ...editingTag, color: e.target.value })}
                        className="w-7 h-7 rounded border cursor-pointer"
                      />
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={!!editingTag.hideFromInventory}
                          onChange={e => setEditingTag({ ...editingTag, hideFromInventory: e.target.checked ? 1 : 0 })}
                          className="rounded"
                        />
                        <span className="text-xs">隐藏</span>
                      </label>
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => updateTag.mutate(editingTag)}>
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditingTag(null)}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                      <span className="text-sm font-medium flex-1">{tag.name}</span>
                      {tag.hideFromInventory ? (
                        <Badge variant="outline" className="text-[10px] gap-0.5"><EyeOff className="w-2.5 h-2.5" /> 隐藏</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] gap-0.5 text-gray-400"><Eye className="w-2.5 h-2.5" /> 显示</Badge>
                      )}
                      <span className="text-xs text-gray-400">
                        {(tagAssignments || []).filter((a: any) => a.tagId === tag.id).length}个ASIN
                      </span>
                      <Button size="sm" variant="ghost" className="h-7 px-1.5" onClick={() => setEditingTag({ ...tag })}>
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-1.5 text-red-500 hover:text-red-700"
                        onClick={() => { if (confirm(`确定删除标签"${tag.name}"？关联的ASIN标记也会被移除。`)) deleteTag.mutate({ id: tag.id }); }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>

            <p className="text-xs text-gray-400">提示：勾选"隐藏"的标签，打上该标签的ASIN将从库存列表中默认隐藏。适用于停售、清仓等不需要日常关注的产品。</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════ Inventory Pipeline View ═══════

function InventoryPipelineView({ pipeline, onNavigate }: { pipeline: any; onNavigate: (path: string) => void }) {
  const [asinSearch, setAsinSearch] = useState("");
  const [selectedAsin, setSelectedAsin] = useState<string | null>(null);
  const [logContent, setLogContent] = useState("");

  // Query ASIN batches when selected
  const asinBatchesQuery = trpc.shippingBatch.getAsinBatches.useQuery(
    { asin: selectedAsin || "" },
    { enabled: !!selectedAsin }
  );

  // Query ASIN logs
  const asinLogsQuery = trpc.shippingBatch.getAsinLogs.useQuery(
    { asin: selectedAsin || "" },
    { enabled: !!selectedAsin }
  );

  // Add log mutation
  const addLogMut = trpc.shippingBatch.addAsinLog.useMutation({
    onSuccess: () => {
      asinLogsQuery.refetch();
      setLogContent("");
      toast.success("日志已添加");
    },
  });

  // Get inventory data for ASIN info
  const inventoryQuery = trpc.operations.getInventoryList.useQuery(
    { marketplace: "US" },
    { enabled: !!selectedAsin }
  );

  const asinInfo = selectedAsin && inventoryQuery.data
    ? inventoryQuery.data.items?.find((item: any) => item.asin === selectedAsin)
    : null;

  const asinBatches = asinBatchesQuery.data || [];
  const asinLogs = asinLogsQuery.data || [];

  // Collect all unique ASINs from inventory for search suggestions
  const allAsins = inventoryQuery.data?.items?.map((item: any) => item.asin).filter(Boolean) || [];
  const filteredAsins = asinSearch.length > 0
    ? allAsins.filter((a: string) => a.toUpperCase().includes(asinSearch.toUpperCase())).slice(0, 10)
    : [];

  const steps = pipeline ? [
    { name: "准备中", icon: Clock, qty: pipeline.planned, color: "bg-gray-100 text-gray-600", count: pipeline.stepDistribution?.[1] || 0 },
    { name: "采购中", icon: Package, qty: pipeline.purchasing, color: "bg-blue-100 text-blue-600", count: pipeline.stepDistribution?.[2] || 0 },
    { name: "国内运输", icon: Truck, qty: pipeline.domesticTransit, color: "bg-indigo-100 text-indigo-600", count: (pipeline.stepDistribution?.[3] || 0) + (pipeline.stepDistribution?.[4] || 0) + (pipeline.stepDistribution?.[5] || 0) },
    { name: "已到仓", icon: Warehouse, qty: pipeline.warehouse, color: "bg-purple-100 text-purple-600", count: pipeline.stepDistribution?.[6] || 0 },
    { name: "国际运输", icon: Ship, qty: pipeline.internationalTransit, color: "bg-orange-100 text-orange-600", count: pipeline.stepDistribution?.[7] || 0 },
    { name: "接收中", icon: Plane, qty: pipeline.receiving, color: "bg-amber-100 text-amber-600", count: pipeline.stepDistribution?.[8] || 0 },
    { name: "亚马逊仓", icon: Boxes, qty: pipeline.amazonStocked, color: "bg-green-100 text-green-600", count: pipeline.stepDistribution?.[9] || 0 },
  ] : [];

  const STATUS_MAP: Record<number, { label: string; color: string }> = {
    1: { label: "准备中", color: "bg-gray-100 text-gray-700" },
    2: { label: "采购中", color: "bg-blue-100 text-blue-700" },
    3: { label: "国内运输", color: "bg-indigo-100 text-indigo-700" },
    4: { label: "国内运输", color: "bg-indigo-100 text-indigo-700" },
    5: { label: "国内运输", color: "bg-indigo-100 text-indigo-700" },
    6: { label: "已到仓", color: "bg-purple-100 text-purple-700" },
    7: { label: "国际运输", color: "bg-orange-100 text-orange-700" },
    8: { label: "接收中", color: "bg-amber-100 text-amber-700" },
    9: { label: "亚马逊仓", color: "bg-green-100 text-green-700" },
    10: { label: "已完成", color: "bg-emerald-100 text-emerald-700" },
  };

  return (
    <div className="space-y-6">
      {/* Pipeline Flow (keep original) */}
      {pipeline && (
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
      )}

      {/* Summary Stats */}
      {pipeline && (
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
      )}

      {/* ASIN Dimension Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="w-4 h-4" />
            ASIN物流追踪
          </CardTitle>
          <CardDescription>输入ASIN查看该产品的物流批次信息和操作日志</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* ASIN Search */}
          <div className="relative">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="输入ASIN搜索..."
                  value={asinSearch}
                  onChange={(e) => setAsinSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && asinSearch.trim()) {
                      setSelectedAsin(asinSearch.trim().toUpperCase());
                    }
                  }}
                  className="pl-9"
                />
              </div>
              <Button
                onClick={() => {
                  if (asinSearch.trim()) {
                    setSelectedAsin(asinSearch.trim().toUpperCase());
                  }
                }}
                disabled={!asinSearch.trim()}
              >
                查询
              </Button>
              {selectedAsin && (
                <Button variant="outline" onClick={() => { setSelectedAsin(null); setAsinSearch(""); }}>
                  清除
                </Button>
              )}
            </div>
            {/* Search suggestions dropdown */}
            {filteredAsins.length > 0 && !selectedAsin && (
              <div className="absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-48 overflow-y-auto">
                {filteredAsins.map((asin: string) => (
                  <button
                    key={asin}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                    onClick={() => { setSelectedAsin(asin); setAsinSearch(asin); }}
                  >
                    <Package className="w-3 h-3 text-gray-400" />
                    {asin}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Selected ASIN Content */}
          {selectedAsin && (
            <div className="space-y-4">
              {/* ASIN Basic Info */}
              <Card className="bg-gray-50 border-gray-200">
                <CardContent className="py-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-lg">{selectedAsin}</h3>
                      {asinInfo ? (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-2 mt-3 text-sm">
                          <div><span className="text-gray-500">SKU:</span> <span className="font-medium">{asinInfo.msku || "-"}</span></div>
                          <div><span className="text-gray-500">标题:</span> <span className="font-medium truncate max-w-[200px] inline-block align-bottom">{asinInfo.title || "-"}</span></div>
                          <div><span className="text-gray-500">店铺:</span> <span className="font-medium">{asinInfo.storeName || "-"}</span></div>
                          <div><span className="text-gray-500">运营:</span> <span className="font-medium">{asinInfo.operator || "-"}</span></div>
                          <div><span className="text-gray-500">可售库存:</span> <span className="font-medium">{asinInfo.fulfillableQty?.toLocaleString() || "0"}</span></div>
                          <div><span className="text-gray-500">日均销量:</span> <span className="font-medium">{asinInfo.avgDailySales?.toFixed(1) || "0"}</span></div>
                          <div><span className="text-gray-500">可售天数:</span> <span className="font-medium">{asinInfo.daysOfSupply || "0"}</span></div>
                          <div><span className="text-gray-500">FBA在途:</span> <span className="font-medium">{asinInfo.inboundQty?.toLocaleString() || "0"}</span></div>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500 mt-1">未找到该ASIN的库存信息</p>
                      )}
                    </div>
                    <Badge variant="outline" className="shrink-0">
                      {asinBatches.length} 个关联批次
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              {/* Batch Info + Logs side by side */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Left: Batch List */}
                <div className="lg:col-span-2">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Truck className="w-4 h-4" />
                        关联物流批次
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {asinBatchesQuery.isLoading ? (
                        <div className="space-y-2">
                          <Skeleton className="h-12 w-full" />
                          <Skeleton className="h-12 w-full" />
                        </div>
                      ) : asinBatches.length === 0 ? (
                        <div className="py-8 text-center text-gray-400">
                          <Boxes className="w-8 h-8 mx-auto mb-2 opacity-30" />
                          <p className="text-sm">该ASIN暂无关联物流批次</p>
                          <Button variant="outline" size="sm" className="mt-2" onClick={() => onNavigate("/ops/shipping")}>
                            前往创建批次
                          </Button>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b text-gray-500">
                                <th className="text-left py-2 px-2 font-medium">批次名称</th>
                                <th className="text-left py-2 px-2 font-medium">状态</th>
                                <th className="text-right py-2 px-2 font-medium">数量</th>
                                <th className="text-left py-2 px-2 font-medium">物流方式</th>
                                <th className="text-left py-2 px-2 font-medium">创建时间</th>
                                <th className="text-left py-2 px-2 font-medium">操作</th>
                              </tr>
                            </thead>
                            <tbody>
                              {asinBatches.map((batch: any) => {
                                const st = STATUS_MAP[batch.currentStep] || { label: `步骤${batch.currentStep}`, color: "bg-gray-100 text-gray-700" };
                                return (
                                  <tr key={batch.id} className="border-b last:border-0 hover:bg-gray-50">
                                    <td className="py-2 px-2 font-medium">{batch.batchName}</td>
                                    <td className="py-2 px-2">
                                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${st.color}`}>
                                        {st.label}
                                      </span>
                                    </td>
                                    <td className="py-2 px-2 text-right">{batch.quantity?.toLocaleString() || "-"}</td>
                                    <td className="py-2 px-2">{batch.shippingMethod || "-"}</td>
                                    <td className="py-2 px-2 text-gray-500">
                                      {batch.createdAt ? new Date(batch.createdAt).toLocaleDateString() : "-"}
                                    </td>
                                    <td className="py-2 px-2">
                                      <Button variant="ghost" size="sm" onClick={() => onNavigate(`/ops/shipping/${batch.id}`)}>
                                        <ExternalLink className="w-3 h-3 mr-1" />
                                        详情
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
                </div>

                {/* Right: Logs Panel */}
                <div className="lg:col-span-1">
                  <Card className="h-full flex flex-col">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <History className="w-4 h-4" />
                        操作日志
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex-1 flex flex-col">
                      {/* Add log */}
                      <div className="flex gap-2 mb-3">
                        <Input
                          placeholder="添加备注日志..."
                          value={logContent}
                          onChange={(e) => setLogContent(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && logContent.trim() && selectedAsin) {
                              addLogMut.mutate({ asin: selectedAsin, content: logContent.trim() });
                            }
                          }}
                          className="text-sm"
                        />
                        <Button
                          size="sm"
                          onClick={() => {
                            if (logContent.trim() && selectedAsin) {
                              addLogMut.mutate({ asin: selectedAsin, content: logContent.trim() });
                            }
                          }}
                          disabled={!logContent.trim() || addLogMut.isPending}
                        >
                          <Send className="w-3 h-3" />
                        </Button>
                      </div>

                      {/* Log list */}
                      <ScrollArea className="flex-1 max-h-[320px]">
                        {asinLogsQuery.isLoading ? (
                          <div className="space-y-2">
                            <Skeleton className="h-8 w-full" />
                            <Skeleton className="h-8 w-full" />
                          </div>
                        ) : asinLogs.length === 0 ? (
                          <div className="py-6 text-center text-gray-400">
                            <MessageSquare className="w-6 h-6 mx-auto mb-2 opacity-30" />
                            <p className="text-xs">暂无日志记录</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {asinLogs.map((log: any) => (
                              <div key={log.id} className="border-l-2 border-gray-200 pl-3 py-1">
                                <p className="text-sm">{log.content}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-[10px] text-gray-400">
                                    {new Date(log.createdAt).toLocaleString()}
                                  </span>
                                  {log.batchName && (
                                    <Badge variant="outline" className="text-[10px] py-0 px-1">
                                      {log.batchName}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          )}

          {!selectedAsin && (
            <div className="py-8 text-center text-gray-400">
              <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">输入ASIN查看物流批次详情和操作日志</p>
            </div>
          )}
        </CardContent>
      </Card>

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
