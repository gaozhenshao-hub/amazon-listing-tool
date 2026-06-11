import React, { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Plus, Search, Truck, Package, ArrowRight, Clock, AlertTriangle,
  CheckCircle2, PauseCircle, XCircle, Filter, ChevronRight, Layers,
  Ship, Plane, TrainFront, Zap, MoreHorizontal, Trash2, Play, Pause,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const SHIPPING_STEPS = [
  { number: 1, name: "准备中", key: "preparing" },
  { number: 2, name: "采购中", key: "purchasing" },
  { number: 3, name: "准备寄出", key: "readyToShip" },
  { number: 4, name: "已寄出", key: "shipped" },
  { number: 5, name: "国内运输中", key: "domesticTransit" },
  { number: 6, name: "已到仓", key: "arrivedWarehouse" },
  { number: 7, name: "国际物流运输中", key: "internationalTransit" },
  { number: 8, name: "接收中", key: "receiving" },
  { number: 9, name: "已到亚马逊仓", key: "arrivedAmazon" },
  { number: 10, name: "上架可售", key: "availableForSale" },
];

const SHIPPING_METHODS = [
  { value: "海运", icon: Ship, color: "text-blue-500" },
  { value: "空运", icon: Plane, color: "text-sky-500" },
  { value: "快递", icon: Zap, color: "text-amber-500" },
  { value: "铁路", icon: TrainFront, color: "text-green-500" },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  active: { label: "进行中", color: "bg-blue-500/10 text-blue-600 border-blue-200", icon: Play },
  completed: { label: "已完成", color: "bg-green-500/10 text-green-600 border-green-200", icon: CheckCircle2 },
  paused: { label: "已暂停", color: "bg-amber-500/10 text-amber-600 border-amber-200", icon: PauseCircle },
  cancelled: { label: "已取消", color: "bg-red-500/10 text-red-600 border-red-200", icon: XCircle },
};

// ─── 10步进度条组件 ───
function ShippingStepProgress({ currentStep, status }: { currentStep: number; status: string }) {
  return (
    <div className="flex items-center gap-0.5 w-full">
      {SHIPPING_STEPS.map((step, idx) => {
        const isCompleted = step.number < currentStep;
        const isCurrent = step.number === currentStep;
        const isPending = step.number > currentStep;
        const isDisabled = status === "cancelled" || status === "paused";

        let bgColor = "bg-muted";
        if (isDisabled) bgColor = "bg-muted/50";
        else if (isCompleted) bgColor = "bg-green-500";
        else if (isCurrent) bgColor = "bg-blue-500";

        return (
          <div key={step.number} className="flex-1 group relative">
            <div
              className={`h-2 rounded-full transition-all ${bgColor} ${isCurrent ? "ring-2 ring-blue-300 ring-offset-1" : ""}`}
              title={`${step.name}${isCurrent ? " (当前)" : isCompleted ? " (已完成)" : ""}`}
            />
            {isCurrent && (
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                {step.name}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── 创建批次对话框 ───
function CreateBatchDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    batchName: "",
    storeName: "",
    sourceWarehouse: "",
    transitWarehouse: "",
    destinationWarehouse: "",
    shippingMethod: "海运",
    batchOwner: "",
    logisticsOwner: "",
    currency: "USD",
  });
  const [products, setProducts] = useState<{ sku: string; productName: string; quantity: number; unitCost: number }[]>([]);
  const [newProduct, setNewProduct] = useState({ sku: "", productName: "", quantity: 0, unitCost: 0 });

  const createMutation = trpc.shippingBatch.create.useMutation({
    onSuccess: () => {
      toast.success("批次创建成功");
      setOpen(false);
      setForm({ batchName: "", storeName: "", sourceWarehouse: "", transitWarehouse: "", destinationWarehouse: "", shippingMethod: "海运", batchOwner: "", logisticsOwner: "", currency: "USD" });
      setProducts([]);
      onSuccess();
    },
    onError: (err) => toast.error(err.message),
  });

  const addProduct = () => {
    if (!newProduct.sku) { toast.error("请输入SKU"); return; }
    setProducts(prev => [...prev, { ...newProduct }]);
    setNewProduct({ sku: "", productName: "", quantity: 0, unitCost: 0 });
  };

  const handleSubmit = () => {
    if (!form.batchName) { toast.error("请输入批次名称"); return; }
    createMutation.mutate({
      ...form,
      products: products.length > 0 ? products : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4 mr-2" />创建批次</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>创建物流批次</DialogTitle>
          <DialogDescription>填写批次基本信息和产品明细</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-muted-foreground">批次名称 *</label>
              <Input value={form.batchName} onChange={e => setForm(f => ({ ...f, batchName: e.target.value }))} placeholder="如: Ace US #718 义乌仓-海运 2026.02 W5" />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">对应店铺</label>
              <Input value={form.storeName} onChange={e => setForm(f => ({ ...f, storeName: e.target.value }))} placeholder="如: Ace Select US" />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">发货仓库</label>
              <Input value={form.sourceWarehouse} onChange={e => setForm(f => ({ ...f, sourceWarehouse: e.target.value }))} placeholder="如: 义乌仓" />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">中转仓库</label>
              <Input value={form.transitWarehouse} onChange={e => setForm(f => ({ ...f, transitWarehouse: e.target.value }))} placeholder="如: 深圳中转仓" />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">目的仓库</label>
              <Input value={form.destinationWarehouse} onChange={e => setForm(f => ({ ...f, destinationWarehouse: e.target.value }))} placeholder="如: Amazon FBA PHX7" />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">运输方式</label>
              <Select value={form.shippingMethod} onValueChange={v => setForm(f => ({ ...f, shippingMethod: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SHIPPING_METHODS.map(m => (
                    <SelectItem key={m.value} value={m.value}>
                      <span className="flex items-center gap-2">
                        <m.icon className={`h-4 w-4 ${m.color}`} />
                        {m.value}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Batch负责人</label>
              <Input value={form.batchOwner} onChange={e => setForm(f => ({ ...f, batchOwner: e.target.value }))} placeholder="负责人姓名" />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">物流负责人</label>
              <Input value={form.logisticsOwner} onChange={e => setForm(f => ({ ...f, logisticsOwner: e.target.value }))} placeholder="物流负责人姓名" />
            </div>
          </div>

          {/* Products */}
          <div>
            <h4 className="text-sm font-medium mb-2">产品明细</h4>
            <div className="flex gap-2 mb-2">
              <Input placeholder="SKU" value={newProduct.sku} onChange={e => setNewProduct(p => ({ ...p, sku: e.target.value }))} className="flex-1" />
              <Input placeholder="产品名称" value={newProduct.productName} onChange={e => setNewProduct(p => ({ ...p, productName: e.target.value }))} className="flex-1" />
              <Input placeholder="数量" type="number" value={newProduct.quantity || ""} onChange={e => setNewProduct(p => ({ ...p, quantity: Number(e.target.value) }))} className="w-24" />
              <Input placeholder="单价" type="number" value={newProduct.unitCost || ""} onChange={e => setNewProduct(p => ({ ...p, unitCost: Number(e.target.value) }))} className="w-24" />
              <Button variant="outline" size="sm" onClick={addProduct}>添加</Button>
            </div>
            {products.length > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-2">SKU</th>
                      <th className="text-left p-2">产品名称</th>
                      <th className="text-right p-2">数量</th>
                      <th className="text-right p-2">单价</th>
                      <th className="text-right p-2">小计</th>
                      <th className="p-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2 font-mono text-xs">{p.sku}</td>
                        <td className="p-2">{p.productName}</td>
                        <td className="p-2 text-right">{p.quantity}</td>
                        <td className="p-2 text-right">${p.unitCost}</td>
                        <td className="p-2 text-right font-medium">${(p.quantity * p.unitCost).toFixed(2)}</td>
                        <td className="p-2">
                          <Button variant="ghost" size="sm" onClick={() => setProducts(prev => prev.filter((_, j) => j !== i))}>
                            <Trash2 className="h-3 w-3 text-red-500" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/30">
                    <tr>
                      <td colSpan={2} className="p-2 font-medium">合计</td>
                      <td className="p-2 text-right font-medium">{products.reduce((s, p) => s + p.quantity, 0)}</td>
                      <td className="p-2"></td>
                      <td className="p-2 text-right font-bold">${products.reduce((s, p) => s + p.quantity * p.unitCost, 0).toFixed(2)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending}>
            {createMutation.isPending ? "创建中..." : "创建批次"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── 主页面 ───
export default function OpsShippingBatch() {
  const [, setLocation] = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [methodFilter, setMethodFilter] = useState<string>("all");
  const [searchText, setSearchText] = useState("");
  const [page, setPage] = useState(1);

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.shippingBatch.list.useQuery({
    status: statusFilter as any,
    shippingMethod: methodFilter === "all" ? undefined : methodFilter,
    search: searchText || undefined,
    page,
    pageSize: 20,
  });

  const { data: pipelineData } = trpc.shippingBatch.getInventoryPipeline.useQuery();

  const updateStatusMutation = trpc.shippingBatch.updateStatus.useMutation({
    onSuccess: () => { utils.shippingBatch.list.invalidate(); toast.success("状态更新成功"); },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.shippingBatch.delete.useMutation({
    onSuccess: () => { utils.shippingBatch.list.invalidate(); toast.success("批次已删除"); },
    onError: (err) => toast.error(err.message),
  });

  const getMethodIcon = (method: string | null) => {
    const m = SHIPPING_METHODS.find(sm => sm.value === method);
    if (!m) return <Truck className="h-4 w-4 text-muted-foreground" />;
    return <m.icon className={`h-4 w-4 ${m.color}`} />;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">物流批次管理</h1>
          <p className="text-muted-foreground text-sm mt-1">管理FBA发货批次的全链路物流流程，实时追踪各环节库存</p>
        </div>
        <CreateBatchDialog onSuccess={() => utils.shippingBatch.list.invalidate()} />
      </div>

      {/* Pipeline Overview */}
      {pipelineData && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              全链路库存流水线
              <Badge variant="secondary" className="ml-2">{pipelineData.totalActiveBatches} 个活跃批次</Badge>
              <Badge variant="outline" className="ml-1">在途库存: {pipelineData.totalInTransit} 件</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-stretch gap-1">
              {pipelineData.pipeline.map((step, idx) => (
                <React.Fragment key={step.step}>
                  <div className={`flex-1 rounded-lg p-3 text-center transition-all ${
                    step.batchCount > 0 ? "bg-primary/5 border border-primary/20" : "bg-muted/30 border border-transparent"
                  }`}>
                    <div className="text-[10px] text-muted-foreground mb-1">步骤{step.step}</div>
                    <div className="text-xs font-medium mb-1 truncate" title={step.name}>{step.name}</div>
                    <div className={`text-lg font-bold ${step.batchCount > 0 ? "text-primary" : "text-muted-foreground"}`}>
                      {step.batchCount}
                    </div>
                    <div className="text-[10px] text-muted-foreground">{step.totalQuantity} 件</div>
                  </div>
                  {idx < pipelineData.pipeline.length - 1 && (
                    <div className="flex items-center">
                      <ArrowRight className="h-3 w-3 text-muted-foreground/50" />
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status Summary */}
      {data && (
        <div className="grid grid-cols-4 gap-4">
          {(["active", "completed", "paused", "cancelled"] as const).map(status => {
            const config = STATUS_CONFIG[status];
            const count = data.statusCounts[status];
            return (
              <Card
                key={status}
                className={`cursor-pointer transition-all hover:shadow-md ${statusFilter === status ? "ring-2 ring-primary" : ""}`}
                onClick={() => setStatusFilter(statusFilter === status ? "all" : status)}
              >
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${config.color}`}>
                    <config.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{count}</div>
                    <div className="text-xs text-muted-foreground">{config.label}</div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索批次名称、物流单号..."
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={methodFilter} onValueChange={setMethodFilter}>
          <SelectTrigger className="w-36">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="运输方式" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部方式</SelectItem>
            {SHIPPING_METHODS.map(m => (
              <SelectItem key={m.value} value={m.value}>{m.value}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Batch List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-5 h-28" />
            </Card>
          ))}
        </div>
      ) : data && data.items.length > 0 ? (
        <div className="space-y-3">
          {data.items.map((batch: any) => {
            const statusCfg = STATUS_CONFIG[batch.status] || STATUS_CONFIG.active;
            return (
              <Card
                key={batch.id}
                className="hover:shadow-md transition-all cursor-pointer group"
                onClick={() => setLocation(`/ops/shipping/${batch.id}`)}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      {getMethodIcon(batch.shippingMethod)}
                      <div>
                        <div className="font-semibold flex items-center gap-2">
                          <span className="text-muted-foreground text-sm">#{batch.batchNumber}</span>
                          {batch.batchName}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3">
                          {batch.storeName && <span>{batch.storeName}</span>}
                          {batch.sourceWarehouse && <span>{batch.sourceWarehouse} → {batch.destinationWarehouse || "FBA"}</span>}
                          <span>{new Date(batch.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={statusCfg.color}>
                        <statusCfg.icon className="h-3 w-3 mr-1" />
                        {statusCfg.label}
                      </Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                          <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
                          {batch.status === "active" && (
                            <DropdownMenuItem onClick={() => updateStatusMutation.mutate({ batchId: batch.id, status: "paused" })}>
                              <Pause className="h-4 w-4 mr-2" /> 暂停
                            </DropdownMenuItem>
                          )}
                          {batch.status === "paused" && (
                            <DropdownMenuItem onClick={() => updateStatusMutation.mutate({ batchId: batch.id, status: "active" })}>
                              <Play className="h-4 w-4 mr-2" /> 恢复
                            </DropdownMenuItem>
                          )}
                          {batch.status !== "cancelled" && (
                            <DropdownMenuItem onClick={() => updateStatusMutation.mutate({ batchId: batch.id, status: "cancelled" })} className="text-red-600">
                              <XCircle className="h-4 w-4 mr-2" /> 取消
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => { if (confirm("确定删除此批次？")) deleteMutation.mutate({ id: batch.id }); }} className="text-red-600">
                            <Trash2 className="h-4 w-4 mr-2" /> 删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mt-2 mb-3">
                    <ShippingStepProgress currentStep={batch.currentStep} status={batch.status} />
                  </div>

                  {/* Quantity Flow */}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Package className="h-3 w-3" />
                      计划: {batch.plannedQuantity}
                    </span>
                    {batch.shippedQuantity > 0 && <span>发货: {batch.shippedQuantity}</span>}
                    {batch.warehouseReceivedQuantity > 0 && <span>到仓: {batch.warehouseReceivedQuantity}</span>}
                    {batch.amazonReceivedQuantity > 0 && <span>亚马逊接收: {batch.amazonReceivedQuantity}</span>}
                    {batch.amazonStockedQuantity > 0 && <span className="text-green-600 font-medium">上架: {batch.amazonStockedQuantity}</span>}
                    {batch.trackingNumber && (
                      <span className="ml-auto font-mono">
                        物流: {batch.trackingNumber}
                      </span>
                    )}
                    <ChevronRight className="h-4 w-4 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {/* Pagination */}
          {data.total > 20 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</Button>
              <span className="text-sm text-muted-foreground">第 {page} 页 / 共 {Math.ceil(data.total / 20)} 页</span>
              <Button variant="outline" size="sm" disabled={page >= Math.ceil(data.total / 20)} onClick={() => setPage(p => p + 1)}>下一页</Button>
            </div>
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="p-12 text-center">
            <Truck className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium mb-2">暂无物流批次</h3>
            <p className="text-sm text-muted-foreground mb-4">创建您的第一个物流批次，开始追踪FBA发货全流程</p>
            <CreateBatchDialog onSuccess={() => utils.shippingBatch.list.invalidate()} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
