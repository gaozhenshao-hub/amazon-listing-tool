import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ArrowLeft, ArrowRight, CheckCircle2, Clock, AlertTriangle, Package,
  Truck, Ship, Plane, TrainFront, Zap, Edit2, Save, Plus, Trash2,
  FileText, BarChart3, ChevronRight, AlertCircle, Timer, MapPin,
} from "lucide-react";

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

const QUANTITY_FIELDS = [
  { step: 1, field: "plannedQuantity", label: "计划数量" },
  { step: 2, field: "orderedQuantity", label: "下单数量" },
  { step: 3, field: "shippedQuantity", label: "发货数量" },
  { step: 6, field: "warehouseReceivedQuantity", label: "到仓数量" },
  { step: 7, field: "internationalShippedQuantity", label: "国际发出数量" },
  { step: 8, field: "amazonReceivedQuantity", label: "亚马逊接收数量" },
  { step: 9, field: "amazonStockedQuantity", label: "上架数量" },
  { step: 10, field: "availableForSaleQuantity", label: "上架可售数量" },
];

// ─── 10步进度条（详情版） ───
function DetailStepProgress({ steps, currentStep, status }: { steps: any[]; currentStep: number; status: string }) {
  return (
    <div className="relative">
      {/* Connection line */}
      <div className="absolute top-5 left-0 right-0 h-0.5 bg-muted z-0" />
      <div className="flex justify-between relative z-10">
        {SHIPPING_STEPS.map((stepDef) => {
          const stepConfig = steps.find((s: any) => s.stepNumber === stepDef.number);
          const isCompleted = stepDef.number < currentStep;
          const isCurrent = stepDef.number === currentStep;
          const isOverdue = stepConfig?.isOverdue;

          let circleClass = "bg-muted text-muted-foreground";
          if (isCompleted) circleClass = "bg-green-500 text-white";
          else if (isCurrent && isOverdue) circleClass = "bg-red-500 text-white ring-4 ring-red-200";
          else if (isCurrent) circleClass = "bg-blue-500 text-white ring-4 ring-blue-200";

          return (
            <div key={stepDef.number} className="flex flex-col items-center w-[10%]">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${circleClass}`}>
                {isCompleted ? <CheckCircle2 className="h-5 w-5" /> : stepDef.number}
              </div>
              <div className={`text-[10px] mt-1 text-center leading-tight ${isCurrent ? "font-bold text-primary" : "text-muted-foreground"}`}>
                {stepDef.name}
              </div>
              {stepConfig && (
                <div className="text-[9px] text-muted-foreground mt-0.5">
                  {stepConfig.status === "completed" && stepConfig.actualDays !== null
                    ? `${stepConfig.actualDays}天`
                    : stepConfig.status === "active"
                    ? `预计${stepConfig.expectedDays}天`
                    : `${stepConfig.expectedDays}天`}
                </div>
              )}
              {isOverdue && (
                <Badge variant="destructive" className="text-[8px] px-1 py-0 mt-0.5">
                  超时{stepConfig.overdueBy}天
                </Badge>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 推进步骤对话框 ───
function AdvanceStepDialog({ batch, currentStep, onSuccess }: { batch: any; currentStep: number; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    trackingNumber: "",
    vehiclePlate: "",
    carrierName: "",
    internationalTrackingNumber: "",
    internationalCarrier: "",
    quantityUpdate: 0,
    notes: "",
  });

  const advanceMutation = trpc.shippingBatch.advanceStep.useMutation({
    onSuccess: () => {
      toast.success(`已推进到「${SHIPPING_STEPS[currentStep]?.name || "下一步"}」`);
      setOpen(false);
      onSuccess();
    },
    onError: (err) => toast.error(err.message),
  });

  const needsTracking = currentStep === 3; // advancing to 已寄出
  const needsInternationalTracking = currentStep === 6; // advancing to 国际物流运输中

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={currentStep >= 9 || batch.status !== "active"}>
        <ArrowRight className="h-4 w-4 mr-2" />
        推进到「{SHIPPING_STEPS[currentStep]?.name || "完成"}」
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>推进步骤</DialogTitle>
            <DialogDescription>
              从「{SHIPPING_STEPS[currentStep - 1]?.name}」推进到「{SHIPPING_STEPS[currentStep]?.name}」
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {needsTracking && (
              <>
                <div>
                  <label className="text-sm font-medium">物流单号 / 车牌号 *</label>
                  <Input value={form.trackingNumber} onChange={e => setForm(f => ({ ...f, trackingNumber: e.target.value }))} placeholder="物流单号" />
                </div>
                <div>
                  <label className="text-sm font-medium">车牌号（可选）</label>
                  <Input value={form.vehiclePlate} onChange={e => setForm(f => ({ ...f, vehiclePlate: e.target.value }))} placeholder="如: 粤B12345" />
                </div>
                <div>
                  <label className="text-sm font-medium">承运商</label>
                  <Input value={form.carrierName} onChange={e => setForm(f => ({ ...f, carrierName: e.target.value }))} placeholder="承运商名称" />
                </div>
              </>
            )}
            {needsInternationalTracking && (
              <>
                <div>
                  <label className="text-sm font-medium">国际物流单号 *</label>
                  <Input value={form.internationalTrackingNumber} onChange={e => setForm(f => ({ ...f, internationalTrackingNumber: e.target.value }))} placeholder="国际物流追踪号" />
                </div>
                <div>
                  <label className="text-sm font-medium">国际承运商</label>
                  <Input value={form.internationalCarrier} onChange={e => setForm(f => ({ ...f, internationalCarrier: e.target.value }))} placeholder="如: DHL, UPS, 递四方" />
                </div>
              </>
            )}
            <div>
              <label className="text-sm font-medium">本环节实际数量</label>
              <Input type="number" value={form.quantityUpdate || ""} onChange={e => setForm(f => ({ ...f, quantityUpdate: Number(e.target.value) }))} placeholder="实际处理数量" />
            </div>
            <div>
              <label className="text-sm font-medium">备注</label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="操作备注..." rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={() => advanceMutation.mutate({
              batchId: batch.id,
              ...(form.trackingNumber ? { trackingNumber: form.trackingNumber } : {}),
              ...(form.vehiclePlate ? { vehiclePlate: form.vehiclePlate } : {}),
              ...(form.carrierName ? { carrierName: form.carrierName } : {}),
              ...(form.internationalTrackingNumber ? { internationalTrackingNumber: form.internationalTrackingNumber } : {}),
              ...(form.internationalCarrier ? { internationalCarrier: form.internationalCarrier } : {}),
              ...(form.quantityUpdate ? { quantityUpdate: form.quantityUpdate } : {}),
              ...(form.notes ? { notes: form.notes } : {}),
            })} disabled={advanceMutation.isPending}>
              {advanceMutation.isPending ? "推进中..." : "确认推进"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── 主页面 ───
export default function OpsShippingBatchDetail() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const batchId = Number(params.id);

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.shippingBatch.getById.useQuery({ id: batchId }, { enabled: !!batchId });

  const [editingInfo, setEditingInfo] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [addLogText, setAddLogText] = useState("");

  const updateMutation = trpc.shippingBatch.update.useMutation({
    onSuccess: () => { utils.shippingBatch.getById.invalidate({ id: batchId }); toast.success("信息已更新"); setEditingInfo(false); },
    onError: (err) => toast.error(err.message),
  });

  const updateQtyMutation = trpc.shippingBatch.updateQuantity.useMutation({
    onSuccess: () => { utils.shippingBatch.getById.invalidate({ id: batchId }); toast.success("数量已更新"); },
    onError: (err) => toast.error(err.message),
  });

  const completeMutation = trpc.shippingBatch.completeBatch.useMutation({
    onSuccess: () => { utils.shippingBatch.getById.invalidate({ id: batchId }); toast.success("批次已完成"); },
    onError: (err) => toast.error(err.message),
  });

  const addLogMutation = trpc.shippingBatch.addLog.useMutation({
    onSuccess: () => { utils.shippingBatch.getById.invalidate({ id: batchId }); setAddLogText(""); toast.success("日志已添加"); },
    onError: (err) => toast.error(err.message),
  });

  const updateStepMutation = trpc.shippingBatch.updateStepConfig.useMutation({
    onSuccess: () => { utils.shippingBatch.getById.invalidate({ id: batchId }); toast.success("步骤配置已更新"); },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-20 bg-muted animate-pulse rounded-lg" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <div key={i} className="h-64 bg-muted animate-pulse rounded-lg" />)}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-20">
        <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium">批次不存在</h3>
        <Button variant="outline" className="mt-4" onClick={() => setLocation("/ops/shipping")}>返回列表</Button>
      </div>
    );
  }

  const { batch, steps, products, logs, lossRates, totalExpectedDays, totalActualDays } = data;

  const getMethodIcon = (method: string | null) => {
    if (method === "海运") return <Ship className="h-5 w-5 text-blue-500" />;
    if (method === "空运") return <Plane className="h-5 w-5 text-sky-500" />;
    if (method === "快递") return <Zap className="h-5 w-5 text-amber-500" />;
    if (method === "铁路") return <TrainFront className="h-5 w-5 text-green-500" />;
    return <Truck className="h-5 w-5 text-muted-foreground" />;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/ops/shipping")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> 返回
          </Button>
          <div className="flex items-center gap-2">
            {getMethodIcon(batch.shippingMethod)}
            <h1 className="text-xl font-bold">
              #{batch.batchNumber} {batch.batchName}
            </h1>
          </div>
          <Badge variant={batch.status === "active" ? "default" : "secondary"}>{batch.status === "active" ? "进行中" : batch.status === "completed" ? "已完成" : batch.status}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <AdvanceStepDialog batch={batch} currentStep={batch.currentStep} onSuccess={() => utils.shippingBatch.getById.invalidate({ id: batchId })} />
          {batch.currentStep === 9 && batch.status === "active" && (
            <Button variant="outline" onClick={() => completeMutation.mutate({ batchId: batch.id })}>
              <CheckCircle2 className="h-4 w-4 mr-2" /> 完成批次
            </Button>
          )}
        </div>
      </div>

      {/* 9-Step Progress */}
      <Card>
        <CardContent className="p-6">
          <DetailStepProgress steps={steps} currentStep={batch.currentStep} status={batch.status} />
          <div className="flex justify-between mt-4 text-xs text-muted-foreground">
            <span>预计全程: {totalExpectedDays} 天</span>
            <span>已用: {totalActualDays} 天</span>
            <span>损耗率: 国内 {lossRates.domesticLoss}% / 国际 {lossRates.internationalLoss}% / 总计 {lossRates.totalLoss}%</span>
          </div>
        </CardContent>
      </Card>

      {/* Three Column Layout */}
      <Tabs defaultValue="info" className="w-full">
        <TabsList>
          <TabsTrigger value="info">基本信息</TabsTrigger>
          <TabsTrigger value="inventory">库存追踪</TabsTrigger>
          <TabsTrigger value="steps">步骤配置</TabsTrigger>
          <TabsTrigger value="products">产品明细 ({products.length})</TabsTrigger>
          <TabsTrigger value="logs">操作日志 ({logs.length})</TabsTrigger>
        </TabsList>

        {/* Basic Info Tab */}
        <TabsContent value="info">
          <div className="grid grid-cols-3 gap-4">
            {/* Left: Financial Summary */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" /> 财务总览
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">产品成本</span><span className="font-medium">{batch.currency} {batch.totalProductCost || "0"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">运费</span><span className="font-medium">{batch.currency} {batch.totalShippingCost || "0"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">其他费用</span><span className="font-medium">{batch.currency} {batch.totalOtherCost || "0"}</span></div>
                <div className="border-t pt-2 flex justify-between font-bold">
                  <span>总成本</span>
                  <span>{batch.currency} {(Number(batch.totalProductCost || 0) + Number(batch.totalShippingCost || 0) + Number(batch.totalOtherCost || 0)).toFixed(2)}</span>
                </div>
                {batch.amazonCommissionRate && (
                  <div className="flex justify-between text-muted-foreground"><span>Amazon佣金比率</span><span>{batch.amazonCommissionRate}%</span></div>
                )}
              </CardContent>
            </Card>

            {/* Middle: Basic Info */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="flex items-center gap-2"><FileText className="h-4 w-4" /> 基本信息</span>
                  <Button variant="ghost" size="sm" onClick={() => { setEditingInfo(!editingInfo); setEditForm({ ...batch }); }}>
                    <Edit2 className="h-3 w-3" />
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {editingInfo ? (
                  <div className="space-y-2">
                    <div><label className="text-xs text-muted-foreground">对应店铺</label>
                      <Input size={1} value={editForm.storeName || ""} onChange={e => setEditForm((f: any) => ({ ...f, storeName: e.target.value }))} /></div>
                    <div><label className="text-xs text-muted-foreground">Batch负责人</label>
                      <Input size={1} value={editForm.batchOwner || ""} onChange={e => setEditForm((f: any) => ({ ...f, batchOwner: e.target.value }))} /></div>
                    <div><label className="text-xs text-muted-foreground">物流负责人</label>
                      <Input size={1} value={editForm.logisticsOwner || ""} onChange={e => setEditForm((f: any) => ({ ...f, logisticsOwner: e.target.value }))} /></div>
                    <div><label className="text-xs text-muted-foreground">物流单号</label>
                      <Input size={1} value={editForm.trackingNumber || ""} onChange={e => setEditForm((f: any) => ({ ...f, trackingNumber: e.target.value }))} /></div>
                    <div><label className="text-xs text-muted-foreground">国际物流单号</label>
                      <Input size={1} value={editForm.internationalTrackingNumber || ""} onChange={e => setEditForm((f: any) => ({ ...f, internationalTrackingNumber: e.target.value }))} /></div>
                    <Button size="sm" onClick={() => updateMutation.mutate({ id: batch.id, ...editForm })} disabled={updateMutation.isPending}>
                      <Save className="h-3 w-3 mr-1" /> 保存
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between"><span className="text-muted-foreground">对应店铺</span><span>{batch.storeName || "-"}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">批次号</span><span>#{batch.batchNumber}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">运输方式</span><span>{batch.shippingMethod || "-"}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">发货仓</span><span>{batch.sourceWarehouse || "-"}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">中转仓</span><span>{batch.transitWarehouse || "-"}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">目的仓</span><span>{batch.destinationWarehouse || "-"}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Batch负责人</span><span>{batch.batchOwner || "-"}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">物流负责人</span><span>{batch.logisticsOwner || "-"}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">物流单号</span><span className="font-mono text-xs">{batch.trackingNumber || "-"}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">国际物流单号</span><span className="font-mono text-xs">{batch.internationalTrackingNumber || "-"}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">创建日期</span><span>{new Date(batch.createdAt).toLocaleDateString()}</span></div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Right: Amazon Inventory (Step 9) */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Package className="h-4 w-4" /> 亚马逊库存
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">总库存</span><span className="font-bold text-lg">{batch.amazonTotalInventory}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">可售库存</span><span className="text-green-600 font-medium">{batch.amazonAvailableInventory}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">预留库存</span><span>{batch.amazonReservedInventory}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">入库中</span><span>{batch.amazonInboundInventory}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">不可售</span><span className="text-red-500">{batch.amazonUnfulfillableInventory}</span></div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Inventory Tracking Tab */}
        <TabsContent value="inventory">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">库存数量追踪</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-3">
                {QUANTITY_FIELDS.map(qf => {
                  const value = (batch as any)[qf.field] || 0;
                  const isActive = batch.currentStep >= qf.step;
                  return (
                    <div key={qf.field} className={`p-3 rounded-lg text-center ${isActive ? "bg-primary/5 border border-primary/20" : "bg-muted/30"}`}>
                      <div className="text-[10px] text-muted-foreground mb-1">步骤{qf.step}</div>
                      <div className="text-xs font-medium mb-2">{qf.label}</div>
                      <div className={`text-xl font-bold ${isActive ? "text-primary" : "text-muted-foreground"}`}>{value}</div>
                      {isActive && batch.status === "active" && (
                        <div className="mt-2">
                          <Input
                            type="number"
                            className="h-7 text-xs text-center"
                            placeholder="更新"
                            onKeyDown={e => {
                              if (e.key === "Enter") {
                                const val = Number((e.target as HTMLInputElement).value);
                                if (val > 0) {
                                  updateQtyMutation.mutate({ batchId: batch.id, field: qf.field as any, value: val });
                                  (e.target as HTMLInputElement).value = "";
                                }
                              }
                            }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Loss Rate Visualization */}
              <div className="mt-6 grid grid-cols-3 gap-4">
                <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                  <div className="text-xs text-amber-600 mb-1">国内损耗率</div>
                  <div className="text-2xl font-bold text-amber-700">{lossRates.domesticLoss}%</div>
                  <div className="text-[10px] text-muted-foreground">发货 → 到仓</div>
                </div>
                <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
                  <div className="text-xs text-blue-600 mb-1">国际损耗率</div>
                  <div className="text-2xl font-bold text-blue-700">{lossRates.internationalLoss}%</div>
                  <div className="text-[10px] text-muted-foreground">国际发出 → 亚马逊接收</div>
                </div>
                <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
                  <div className="text-xs text-red-600 mb-1">总损耗率</div>
                  <div className="text-2xl font-bold text-red-700">{lossRates.totalLoss}%</div>
                  <div className="text-[10px] text-muted-foreground">计划 → 上架</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Step Config Tab */}
        <TabsContent value="steps">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">步骤时间配置</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {steps.map((step: any) => (
                  <div key={step.stepNumber} className={`flex items-center gap-4 p-3 rounded-lg border ${
                    step.status === "completed" ? "bg-green-50 dark:bg-green-950/10 border-green-200" :
                    step.status === "active" ? "bg-blue-50 dark:bg-blue-950/10 border-blue-200" :
                    "bg-muted/20 border-transparent"
                  }`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      step.status === "completed" ? "bg-green-500 text-white" :
                      step.status === "active" ? "bg-blue-500 text-white" :
                      "bg-muted text-muted-foreground"
                    }`}>
                      {step.status === "completed" ? <CheckCircle2 className="h-4 w-4" /> : step.stepNumber}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-sm">{step.stepName}</div>
                      {step.status === "completed" && step.actualStartAt && step.actualEndAt && (
                        <div className="text-xs text-muted-foreground">
                          {new Date(step.actualStartAt).toLocaleDateString()} → {new Date(step.actualEndAt).toLocaleDateString()}
                        </div>
                      )}
                      {step.status === "active" && step.actualStartAt && (
                        <div className="text-xs text-blue-600">
                          开始于 {new Date(step.actualStartAt).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">预计天数</div>
                        <Input
                          type="number"
                          className="h-7 w-16 text-center text-sm"
                          defaultValue={step.expectedDays}
                          onBlur={e => {
                            const val = Number(e.target.value);
                            if (val > 0 && val !== step.expectedDays) {
                              updateStepMutation.mutate({ batchId: batch.id, stepNumber: step.stepNumber, expectedDays: val });
                            }
                          }}
                        />
                      </div>
                      {step.status === "completed" && (
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">实际天数</div>
                          <div className={`text-sm font-bold ${
                            (step.actualDays || 0) > step.expectedDays ? "text-red-500" : "text-green-500"
                          }`}>
                            {step.actualDays || 0} 天
                          </div>
                        </div>
                      )}
                      {step.isOverdue && (
                        <Badge variant="destructive" className="text-xs">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          超时{step.overdueBy}天
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Products Tab */}
        <TabsContent value="products">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">产品明细</CardTitle>
            </CardHeader>
            <CardContent>
              {products.length > 0 ? (
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-2">SKU</th>
                      <th className="text-left p-2">ASIN</th>
                      <th className="text-left p-2">产品名称</th>
                      <th className="text-right p-2">数量</th>
                      <th className="text-right p-2">单价</th>
                      <th className="text-right p-2">总价</th>
                      <th className="text-right p-2">重量(kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p: any) => (
                      <tr key={p.id} className="border-t">
                        <td className="p-2 font-mono text-xs">{p.sku}</td>
                        <td className="p-2 font-mono text-xs">{p.asin || "-"}</td>
                        <td className="p-2">{p.productName || "-"}</td>
                        <td className="p-2 text-right">{p.quantity}</td>
                        <td className="p-2 text-right">${p.unitCost}</td>
                        <td className="p-2 text-right font-medium">${p.totalCost}</td>
                        <td className="p-2 text-right">{p.weight || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/30 font-bold">
                    <tr>
                      <td colSpan={3} className="p-2">合计</td>
                      <td className="p-2 text-right">{products.reduce((s: number, p: any) => s + p.quantity, 0)}</td>
                      <td className="p-2"></td>
                      <td className="p-2 text-right">${products.reduce((s: number, p: any) => s + Number(p.totalCost || 0), 0).toFixed(2)}</td>
                      <td className="p-2 text-right">{products.reduce((s: number, p: any) => s + Number(p.weight || 0), 0).toFixed(1)}</td>
                    </tr>
                  </tfoot>
                </table>
              ) : (
                <div className="text-center py-8 text-muted-foreground">暂无产品明细</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span>操作日志</span>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="添加日志..."
                    value={addLogText}
                    onChange={e => setAddLogText(e.target.value)}
                    className="w-64 h-8 text-sm"
                    onKeyDown={e => {
                      if (e.key === "Enter" && addLogText.trim()) {
                        addLogMutation.mutate({ batchId: batch.id, action: "手动日志", details: addLogText.trim() });
                      }
                    }}
                  />
                  <Button size="sm" variant="outline" onClick={() => {
                    if (addLogText.trim()) addLogMutation.mutate({ batchId: batch.id, action: "手动日志", details: addLogText.trim() });
                  }}>
                    <Plus className="h-3 w-3 mr-1" /> 添加
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {logs.map((log: any) => (
                  <div key={log.id} className="flex items-start gap-3 p-2 rounded hover:bg-muted/30">
                    <div className="w-2 h-2 rounded-full bg-primary mt-2 shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{log.action}</span>
                        {log.fromStep && log.toStep && (
                          <Badge variant="outline" className="text-xs">
                            步骤{log.fromStep} → {log.toStep}
                          </Badge>
                        )}
                      </div>
                      {log.details && <div className="text-xs text-muted-foreground mt-0.5">{log.details}</div>}
                      <div className="text-[10px] text-muted-foreground mt-1">
                        {log.userName} · {new Date(log.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
