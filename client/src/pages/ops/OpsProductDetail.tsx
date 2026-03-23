import { useState, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
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
  AlertCircle, FileText, Loader2,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

export default function OpsProductDetail() {
  const [, params] = useRoute("/ops/products/:id");
  const [, navigate] = useLocation();
  const productId = Number(params?.id);

  // ─── Data Queries ───
  const { data: product, isLoading: loadingProduct, refetch: refetchProduct } = trpc.productOps.getProduct.useQuery(
    { id: productId }, { enabled: !!productId }
  );
  const { data: profitData, isLoading: loadingProfit } = trpc.productOps.getProductProfitSummary.useQuery(
    { productId }, { enabled: !!productId }
  );
  const { data: inventoryData, isLoading: loadingInventory } = trpc.productOps.getProductInventorySummary.useQuery(
    { productId }, { enabled: !!productId }
  );
  const { data: adsData, isLoading: loadingAds } = trpc.productOps.getProductAdsSummary.useQuery(
    { productId }, { enabled: !!productId }
  );
  const { data: todos, refetch: refetchTodos } = trpc.productOps.getTodos.useQuery(
    { productId }, { enabled: !!productId }
  );
  const { data: logs, refetch: refetchLogs } = trpc.productOps.getLogs.useQuery(
    { productId }, { enabled: !!productId }
  );
  const { data: competitors } = trpc.productOps.getProductCompetitors.useQuery(
    { productId }, { enabled: !!productId }
  );
  const { data: keywordMonitorsData, refetch: refetchKeywords } = trpc.productOps.getKeywordMonitors.useQuery(
    { productId }, { enabled: !!productId }
  );

  // ─── Mutations ───
  const createTodo = trpc.productOps.createTodo.useMutation({
    onSuccess: () => { refetchTodos(); setShowAddTodo(false); setTodoForm({ title: "", priority: "medium", dueDate: "", assignee: "" }); },
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
  const [todoForm, setTodoForm] = useState({ title: "", priority: "medium", dueDate: "", assignee: "" });
  const [logContent, setLogContent] = useState("");
  const [logType, setLogType] = useState<string>("note");
  const [kwForm, setKwForm] = useState({ keyword: "", keywordCn: "", targetAsin: "", matchType: "exact" });
  const [variantForm, setVariantForm] = useState({ childAsin: "", sku: "", title: "", price: "" });

  // Stable date for memoization
  const [stableDate] = useState(() => new Date());
  const _stableDate = stableDate; // suppress unused warning
  void _stableDate;

  if (loadingProduct) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">产品不存在</p>
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/ops/products")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{product.title}</h1>
          <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
            <span className="font-mono">{product.parentAsin}</span>
            {product.brand && <span>· {product.brand}</span>}
            <span>· {product.marketplace}</span>
            {product.category && <span>· {product.category}</span>}
          </div>
        </div>
        <Badge variant="secondary" className={
          product.status === "active" ? "bg-emerald-100 text-emerald-700" :
          product.status === "inactive" ? "bg-gray-100 text-gray-600" : "bg-red-100 text-red-700"
        }>
          {product.status === "active" ? "在售" : product.status === "inactive" ? "暂停" : "停售"}
        </Badge>
      </div>

      {/* Main Layout: Left (data) + Right (todos & logs) */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
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
              {product.variants.length === 0 ? (
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
                      {product.variants.map((v: { id: number; childAsin: string; sku: string | null; title: string | null; price: string | null; status: string }) => (
                        <tr key={v.id} className="border-b last:border-0">
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
              <div className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-emerald-600" />
                <CardTitle className="text-base">利润总览（近30天）</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {loadingProfit ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : profitData ? (
                <div className="overflow-x-auto">
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
                        { label: "Amazon开支", budget: null, actual: profitData.actual.amazonFees, current: 0, indent: false },
                        { label: "Amazon佣金", budget: null, actual: profitData.actual.referralFee, current: 0, indent: true },
                        { label: "FBA Fees", budget: null, actual: profitData.actual.fbaFee, current: 0, indent: true },
                        { label: "Ads Cost", budget: null, actual: profitData.actual.adSpend, current: 0, indent: true },
                        { label: "仓租", budget: null, actual: profitData.actual.storageFee, current: 0, indent: true },
                        { label: "实收", budget: null, actual: profitData.actual.netRevenue, current: 0, bold: true },
                        { label: "总固定成本", budget: null, actual: profitData.actual.fixedCosts, current: 0 },
                        { label: "采购成本", budget: null, actual: profitData.actual.productCost, current: 0, indent: true },
                        { label: "Amazon运费", budget: null, actual: profitData.actual.shippingCost, current: 0, indent: true },
                        { label: "关税", budget: null, actual: profitData.actual.tariff, current: 0, indent: true },
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
                  <div className="mt-3 grid grid-cols-3 gap-4 text-center text-sm border-t pt-3">
                    <div>
                      <p className="text-muted-foreground">订单数</p>
                      <p className="font-semibold">{profitData.actual.orders}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">销量</p>
                      <p className="font-semibold">{profitData.actual.units}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">利润率</p>
                      <p className="font-semibold">{profitData.actual.profitMargin}%</p>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">暂无利润数据</p>
              )}
            </CardContent>
          </Card>

          {/* Inventory Summary */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-blue-600" />
                <CardTitle className="text-base">库存概览</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {loadingInventory ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : inventoryData ? (
                <div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                    {[
                      { label: "FBA可售", value: inventoryData.total.fulfillableQty, color: "text-emerald-600" },
                      { label: "在途", value: inventoryData.total.inboundQty, color: "text-blue-600" },
                      { label: "日均销量", value: inventoryData.total.avgDailySales, color: "text-orange-600" },
                      { label: "可售天数", value: inventoryData.total.daysOfSupply, color: inventoryData.total.daysOfSupply < 14 ? "text-red-600" : "text-emerald-600" },
                    ].map((item, idx) => (
                      <div key={idx} className="text-center p-3 rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground">{item.label}</p>
                        <p className={`text-xl font-bold ${item.color}`}>{item.value}</p>
                      </div>
                    ))}
                  </div>
                  <Badge variant="secondary" className={
                    inventoryData.total.replenishStatus === "urgent" ? "bg-red-100 text-red-700" :
                    inventoryData.total.replenishStatus === "warning" ? "bg-yellow-100 text-yellow-700" :
                    inventoryData.total.replenishStatus === "overstock" ? "bg-purple-100 text-purple-700" :
                    "bg-emerald-100 text-emerald-700"
                  }>
                    {inventoryData.total.replenishStatus === "urgent" ? "紧急补货" :
                     inventoryData.total.replenishStatus === "warning" ? "即将断货" :
                     inventoryData.total.replenishStatus === "overstock" ? "库存过剩" : "库存正常"}
                  </Badge>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">暂无库存数据</p>
              )}
            </CardContent>
          </Card>

          {/* Ads Summary */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Target className="h-5 w-5 text-orange-600" />
                <CardTitle className="text-base">广告概览</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {loadingAds ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : adsData ? (
                <div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                    {[
                      { label: "广告花费", value: `$${adsData.summary.totalSpend}` },
                      { label: "广告销售额", value: `$${adsData.summary.totalSales}` },
                      { label: "ACoS", value: `${adsData.summary.acos}%` },
                      { label: "ROAS", value: adsData.summary.roas.toFixed(2) },
                    ].map((item, idx) => (
                      <div key={idx} className="text-center p-3 rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground">{item.label}</p>
                        <p className="text-lg font-bold">{item.value}</p>
                      </div>
                    ))}
                  </div>
                  {adsData.campaigns.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-muted-foreground">
                            <th className="text-left py-2 font-medium">广告活动</th>
                            <th className="text-right py-2 font-medium">花费</th>
                            <th className="text-right py-2 font-medium">销售额</th>
                            <th className="text-right py-2 font-medium">ACoS</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adsData.campaigns.slice(0, 5).map((c, idx) => (
                            <tr key={idx} className="border-b last:border-0">
                              <td className="py-1.5 max-w-[200px] truncate">{c.name}</td>
                              <td className="py-1.5 text-right font-mono">${c.spend}</td>
                              <td className="py-1.5 text-right font-mono">${c.sales}</td>
                              <td className="py-1.5 text-right">
                                <span className={c.acos > 30 ? "text-red-600" : "text-emerald-600"}>{c.acos}%</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">暂无广告数据</p>
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

      {/* ─── Dialogs ─── */}

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
    </div>
  );
}
