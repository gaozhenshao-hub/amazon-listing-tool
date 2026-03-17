import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DollarSign, BarChart3, Loader2, Save, Trash2, Plus,
  ArrowDownUp, TrendingUp, Target, History, X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface ProfitEditorProps {
  projectId: number;
}

interface SimRow {
  quantity: number;
  moldPerUnitCny: number;
  moldPerUnit: number;
  productCostUsd: number;
  totalUnitCost: number;
  profit: number;
  profitMargin: number;
  roi: number;
  totalProfit: number;
}

interface SavedPlan {
  id?: number;
  name: string;
  params: typeof defaultParams;
  simulations: SimRow[];
  savedAt: string;
}

const defaultParams = {
  sellingPrice: 29.99,
  productCostCny: 0,
  shippingCost: 3.5,
  fbaFee: 5.0,
  referralFeeRate: 15,
  advertisingCost: 3.0,
  otherCosts: 1.0,
  totalMoldCostCny: 0,
  exchangeRate: 0.137,
};

const paramLabels: Record<string, { label: string; unit: string; tooltip: string }> = {
  sellingPrice: { label: "售价", unit: "$", tooltip: "亚马逊前台售价" },
  productCostCny: { label: "产品成本", unit: "¥", tooltip: "BOM材料总成本（人民币）" },
  shippingCost: { label: "头程运费", unit: "$", tooltip: "每件产品的头程物流费用" },
  fbaFee: { label: "FBA费用", unit: "$", tooltip: "亚马逊FBA配送费" },
  referralFeeRate: { label: "佣金比例", unit: "%", tooltip: "亚马逊平台佣金比例，通常15%" },
  advertisingCost: { label: "广告费", unit: "$", tooltip: "每件产品的PPC广告分摊费" },
  otherCosts: { label: "其他费用", unit: "$", tooltip: "退货、仓储等其他费用" },
  totalMoldCostCny: { label: "模具总费", unit: "¥", tooltip: "模具开模总费用（人民币）" },
};

export default function ProfitEditor({ projectId }: ProfitEditorProps) {
  const [params, setParams] = useState({ ...defaultParams });
  const [quantities, setQuantities] = useState<number[]>([100, 500, 1000, 5000]);
  const [newQty, setNewQty] = useState("");
  const [simulations, setSimulations] = useState<SimRow[]>([]);
  const [savedPlans, setSavedPlans] = useState<SavedPlan[]>([]);
  const [planName, setPlanName] = useState("");
  const [showPlans, setShowPlans] = useState(false);
  const [showSensitivity, setShowSensitivity] = useState(false);
  const [comparePlanIdx, setComparePlanIdx] = useState<number | null>(null);

  // Fetch BOM cost and exchange rate
  const { data: bomCostSummary } = trpc.devBom.getBomCostSummary.useQuery({ projectId });
  const { data: rateData } = trpc.devBom.getExchangeRate.useQuery();
  const batchMutation = trpc.devBom.batchSimulate.useMutation();

  // Auto-fill from BOM
  useMemo(() => {
    if (bomCostSummary) {
      setParams(prev => ({
        ...prev,
        productCostCny: bomCostSummary.totalMaterialCost || prev.productCostCny,
        totalMoldCostCny: bomCostSummary.totalMoldCost || prev.totalMoldCostCny,
      }));
    }
  }, [bomCostSummary]);

  // Auto-fill exchange rate
  useMemo(() => {
    if (rateData?.rate) {
      setParams(prev => ({ ...prev, exchangeRate: rateData.rate }));
    }
  }, [rateData]);

  const productCostUsd = params.productCostCny * params.exchangeRate;
  const moldCostUsd = params.totalMoldCostCny * params.exchangeRate;

  // Calculate breakeven
  const breakeven = useMemo(() => {
    const referralFee = params.sellingPrice * (params.referralFeeRate / 100);
    const variableCost = productCostUsd + params.shippingCost + params.fbaFee + referralFee + params.advertisingCost + params.otherCosts;
    const marginPerUnit = params.sellingPrice - variableCost;
    if (marginPerUnit <= 0) return { units: Infinity, revenue: 0 };
    const units = Math.ceil(moldCostUsd / marginPerUnit);
    return { units, revenue: units * params.sellingPrice };
  }, [params, productCostUsd, moldCostUsd]);

  // Run simulation
  const handleSimulate = useCallback(() => {
    batchMutation.mutate({
      projectId,
      sellingPrice: params.sellingPrice,
      productCostCny: params.productCostCny,
      exchangeRate: params.exchangeRate,
      shippingCost: params.shippingCost,
      fbaFee: params.fbaFee,
      referralFeeRate: params.referralFeeRate,
      advertisingCost: params.advertisingCost,
      otherCosts: params.otherCosts,
      totalMoldCostCny: params.totalMoldCostCny,
      quantities,
    }, {
      onSuccess: (data) => {
        setSimulations(data.simulations);
      },
    });
  }, [params, quantities, projectId, batchMutation]);

  // Add custom quantity
  const addQuantity = () => {
    const qty = parseInt(newQty);
    if (qty > 0 && !quantities.includes(qty)) {
      setQuantities(prev => [...prev, qty].sort((a, b) => a - b));
      setNewQty("");
    }
  };

  // Remove quantity
  const removeQuantity = (qty: number) => {
    if (quantities.length <= 1) return;
    setQuantities(prev => prev.filter(q => q !== qty));
  };

  // Save plan
  const savePlan = () => {
    if (!planName.trim()) {
      toast.error("请输入方案名称");
      return;
    }
    if (simulations.length === 0) {
      toast.error("请先运行模拟");
      return;
    }
    const plan: SavedPlan = {
      name: planName.trim(),
      params: { ...params },
      simulations: [...simulations],
      savedAt: new Date().toISOString(),
    };
    setSavedPlans(prev => [...prev, plan]);
    setPlanName("");
    toast.success(`方案"${plan.name}"已保存`);
  };

  // Load plan
  const loadPlan = (plan: SavedPlan) => {
    setParams({ ...plan.params });
    setSimulations([...plan.simulations]);
    setQuantities(plan.simulations.map(s => s.quantity));
    toast.info(`已加载方案"${plan.name}"`);
  };

  // Delete plan
  const deletePlan = (idx: number) => {
    setSavedPlans(prev => prev.filter((_, i) => i !== idx));
    if (comparePlanIdx === idx) setComparePlanIdx(null);
  };

  // Sensitivity analysis matrix
  const sensitivityMatrix = useMemo(() => {
    if (!showSensitivity) return null;
    const basePrice = params.sellingPrice;
    const baseCost = params.productCostCny;
    const priceSteps = [-3, -1.5, 0, 1.5, 3].map(d => Math.round((basePrice + d) * 100) / 100);
    const costSteps = [-5, -2.5, 0, 2.5, 5].map(d => Math.round((baseCost + d) * 100) / 100).filter(c => c > 0);

    const matrix: { price: number; cost: number; margin: number }[][] = [];
    for (const price of priceSteps) {
      const row: { price: number; cost: number; margin: number }[] = [];
      for (const cost of costSteps) {
        const costUsd = cost * params.exchangeRate;
        const referralFee = price * (params.referralFeeRate / 100);
        const totalCost = costUsd + params.shippingCost + params.fbaFee + referralFee + params.advertisingCost + params.otherCosts;
        const profit = price - totalCost;
        const margin = price > 0 ? (profit / price) * 100 : 0;
        row.push({ price, cost, margin: Math.round(margin * 10) / 10 });
      }
      matrix.push(row);
    }
    return { priceSteps, costSteps, matrix };
  }, [showSensitivity, params]);

  const getMarginColor = (margin: number) => {
    if (margin >= 30) return "bg-emerald-100 text-emerald-800";
    if (margin >= 20) return "bg-amber-100 text-amber-800";
    return "bg-red-100 text-red-800";
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold flex items-center gap-2">
          <DollarSign className="h-4 w-4" />利润计算器
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          {bomCostSummary && (
            <Badge variant="outline" className="text-xs">
              BOM自动填入: ¥{bomCostSummary.totalMaterialCost} ({bomCostSummary.bomItemCount}项)
            </Badge>
          )}
          <Badge variant="secondary" className="text-xs gap-1">
            <ArrowDownUp className="h-3 w-3" />
            1 CNY = {params.exchangeRate.toFixed(4)} USD
            {rateData?.source === "fallback" && <span className="text-amber-600">(离线)</span>}
          </Badge>
        </div>
      </div>

      {/* Exchange Rate Card */}
      <Card className="bg-gradient-to-r from-blue-50/50 to-indigo-50/50 border-blue-100">
        <CardContent className="p-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4 flex-wrap">
              <div>
                <p className="text-xs text-muted-foreground">汇率 (CNY → USD)</p>
                <input type="number" step="0.0001" className="w-28 mt-0.5 px-2 py-1 text-sm border rounded-md bg-background font-mono"
                  value={params.exchangeRate} onChange={(e) => setParams(prev => ({ ...prev, exchangeRate: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">产品成本换算</p>
                <p className="text-sm font-medium">¥{params.productCostCny.toFixed(2)} → ${productCostUsd.toFixed(2)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">模具费换算</p>
                <p className="text-sm font-medium">¥{params.totalMoldCostCny.toFixed(2)} → ${moldCostUsd.toFixed(2)}</p>
              </div>
            </div>
            {rateData && (
              <p className="text-xs text-muted-foreground">
                数据源: {rateData.source} · {new Date(rateData.updatedAt).toLocaleString()}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Parameters Table */}
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left p-3 font-medium w-40">参数</th>
                <th className="text-left p-3 font-medium w-24">单位</th>
                <th className="text-left p-3 font-medium">值</th>
                <th className="text-left p-3 font-medium">换算</th>
                <th className="text-left p-3 font-medium">说明</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(paramLabels).map(([key, meta]) => (
                <tr key={key} className="border-b hover:bg-muted/10">
                  <td className="p-3 font-medium">{meta.label}</td>
                  <td className="p-3 text-muted-foreground">{meta.unit}</td>
                  <td className="p-3">
                    <input
                      type="number"
                      step={key === "referralFeeRate" ? "0.1" : "0.01"}
                      className="w-32 px-2 py-1.5 text-sm border rounded-md bg-background"
                      value={(params as any)[key]}
                      onChange={(e) => setParams(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                    />
                  </td>
                  <td className="p-3 text-xs text-blue-600">
                    {key === "productCostCny" && `= $${productCostUsd.toFixed(2)}`}
                    {key === "totalMoldCostCny" && `= $${moldCostUsd.toFixed(2)}`}
                    {key === "referralFeeRate" && `= $${(params.sellingPrice * params.referralFeeRate / 100).toFixed(2)}/件`}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">{meta.tooltip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Breakeven Card */}
      <Card className="bg-gradient-to-r from-emerald-50/50 to-teal-50/50 border-emerald-100">
        <CardContent className="p-3">
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-emerald-600" />
              <span className="text-sm font-medium">盈亏平衡点</span>
            </div>
            {breakeven.units === Infinity ? (
              <span className="text-sm text-red-600 font-medium">单件利润为负，无法回本</span>
            ) : (
              <>
                <div>
                  <span className="text-xs text-muted-foreground">最低订单量: </span>
                  <span className="text-sm font-bold text-emerald-700">{breakeven.units.toLocaleString()} 件</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">对应营收: </span>
                  <span className="text-sm font-medium">${breakeven.revenue.toLocaleString()}</span>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Custom Quantities */}
      <Card>
        <CardContent className="p-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium">模拟档位:</span>
            {quantities.map(qty => (
              <Badge key={qty} variant="outline" className="text-xs gap-1 cursor-default">
                {qty.toLocaleString()}件
                {quantities.length > 1 && (
                  <button onClick={() => removeQuantity(qty)} className="ml-1 hover:text-red-500">
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </Badge>
            ))}
            <div className="flex items-center gap-1">
              <Input
                type="number"
                placeholder="自定义"
                className="w-24 h-7 text-xs"
                value={newQty}
                onChange={(e) => setNewQty(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addQuantity()}
              />
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={addQuantity}>
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex gap-2 flex-wrap">
        <Button className="gap-2" onClick={handleSimulate} disabled={batchMutation.isPending}>
          {batchMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
          运行模拟
        </Button>
        <Button variant="outline" className="gap-2" onClick={() => setShowSensitivity(!showSensitivity)}>
          <TrendingUp className="h-4 w-4" />
          {showSensitivity ? "隐藏" : ""}敏感性分析
        </Button>
        <Button variant="outline" className="gap-2" onClick={() => setShowPlans(!showPlans)}>
          <History className="h-4 w-4" />
          历史方案 ({savedPlans.length})
        </Button>
      </div>

      {/* Simulation Results Table */}
      {simulations.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>模拟结果</span>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="方案名称"
                  className="w-40 h-7 text-xs"
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                />
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={savePlan}>
                  <Save className="h-3 w-3" />保存方案
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-right p-3 font-medium">订单量</th>
                    <th className="text-right p-3 font-medium">产品成本($)</th>
                    <th className="text-right p-3 font-medium">模具分摊($)</th>
                    <th className="text-right p-3 font-medium">头程运费($)</th>
                    <th className="text-right p-3 font-medium">FBA费($)</th>
                    <th className="text-right p-3 font-medium">佣金($)</th>
                    <th className="text-right p-3 font-medium">广告费($)</th>
                    <th className="text-right p-3 font-medium">其他($)</th>
                    <th className="text-right p-3 font-medium">总成本($)</th>
                    <th className="text-right p-3 font-medium">单件利润($)</th>
                    <th className="text-right p-3 font-medium">利润率</th>
                    <th className="text-right p-3 font-medium">ROI</th>
                    <th className="text-right p-3 font-medium">总利润($)</th>
                  </tr>
                </thead>
                <tbody>
                  {simulations.map((sim) => {
                    const referralFee = Math.round(params.sellingPrice * params.referralFeeRate) / 100;
                    return (
                      <tr key={sim.quantity} className="border-b last:border-0 hover:bg-muted/10">
                        <td className="p-3 text-right font-medium">{sim.quantity.toLocaleString()}</td>
                        <td className="p-3 text-right">${sim.productCostUsd}</td>
                        <td className="p-3 text-right">${sim.moldPerUnit}</td>
                        <td className="p-3 text-right">${params.shippingCost.toFixed(2)}</td>
                        <td className="p-3 text-right">${params.fbaFee.toFixed(2)}</td>
                        <td className="p-3 text-right">${referralFee.toFixed(2)}</td>
                        <td className="p-3 text-right">${params.advertisingCost.toFixed(2)}</td>
                        <td className="p-3 text-right">${params.otherCosts.toFixed(2)}</td>
                        <td className="p-3 text-right font-medium">${sim.totalUnitCost}</td>
                        <td className={`p-3 text-right font-bold ${sim.profit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          ${sim.profit}
                        </td>
                        <td className={`p-3 text-right ${sim.profitMargin >= 30 ? "text-emerald-600" : sim.profitMargin >= 20 ? "text-amber-600" : "text-red-600"}`}>
                          {sim.profitMargin}%
                        </td>
                        <td className="p-3 text-right">{sim.roi}%</td>
                        <td className={`p-3 text-right font-bold ${sim.totalProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          ${sim.totalProfit.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Compare with saved plan */}
      {comparePlanIdx !== null && savedPlans[comparePlanIdx] && simulations.length > 0 && (
        <Card className="border-blue-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>对比: 当前 vs "{savedPlans[comparePlanIdx].name}"</span>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setComparePlanIdx(null)}>
                <X className="h-3 w-3" />关闭对比
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium">参数</th>
                    <th className="text-right p-3 font-medium">当前方案</th>
                    <th className="text-right p-3 font-medium">{savedPlans[comparePlanIdx].name}</th>
                    <th className="text-right p-3 font-medium">差异</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(paramLabels).map(([key, meta]) => {
                    const current = (params as any)[key] as number;
                    const saved = (savedPlans[comparePlanIdx].params as any)[key] as number;
                    const diff = current - saved;
                    return (
                      <tr key={key} className="border-b">
                        <td className="p-3">{meta.label} ({meta.unit})</td>
                        <td className="p-3 text-right">{current}</td>
                        <td className="p-3 text-right text-muted-foreground">{saved}</td>
                        <td className={`p-3 text-right font-medium ${diff > 0 ? "text-emerald-600" : diff < 0 ? "text-red-600" : ""}`}>
                          {diff !== 0 ? (diff > 0 ? "+" : "") + diff.toFixed(2) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sensitivity Analysis Matrix */}
      {showSensitivity && sensitivityMatrix && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              敏感性分析矩阵（售价 × 产品成本 → 利润率）
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-3 font-medium text-left">售价($) \ 成本(¥)</th>
                    {sensitivityMatrix.costSteps.map(cost => (
                      <th key={cost} className="p-3 font-medium text-center">
                        ¥{cost}
                        {cost === params.productCostCny && <span className="text-xs text-blue-500 block">当前</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sensitivityMatrix.matrix.map((row, i) => (
                    <tr key={i} className="border-b">
                      <td className="p-3 font-medium">
                        ${sensitivityMatrix.priceSteps[i]}
                        {sensitivityMatrix.priceSteps[i] === params.sellingPrice && (
                          <span className="text-xs text-blue-500 ml-1">当前</span>
                        )}
                      </td>
                      {row.map((cell, j) => (
                        <td key={j} className={`p-3 text-center font-mono text-xs ${getMarginColor(cell.margin)} ${
                          cell.price === params.sellingPrice && cell.cost === params.productCostCny ? "ring-2 ring-blue-400 ring-inset" : ""
                        }`}>
                          {cell.margin.toFixed(1)}%
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-3 flex gap-4 text-xs text-muted-foreground border-t">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-200" /> ≥30% 优秀</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-100 border border-amber-200" /> 20-30% 可接受</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 border border-red-200" /> &lt;20% 风险</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Saved Plans */}
      {showPlans && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="h-4 w-4" />
              历史方案 ({savedPlans.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {savedPlans.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">暂无保存的方案，运行模拟后可保存</p>
            ) : (
              <div className="space-y-2">
                {savedPlans.map((plan, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/20">
                    <div>
                      <p className="text-sm font-medium">{plan.name}</p>
                      <p className="text-xs text-muted-foreground">
                        售价 ${plan.params.sellingPrice} · 成本 ¥{plan.params.productCostCny} · {plan.simulations.length}档模拟
                        · {new Date(plan.savedAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => loadPlan(plan)}>
                        加载
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-blue-600" onClick={() => setComparePlanIdx(idx)}>
                        对比
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500" onClick={() => deletePlan(idx)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
