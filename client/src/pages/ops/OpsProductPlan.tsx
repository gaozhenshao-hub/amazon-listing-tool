import { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus, Trash2, Edit2, Save, Target, TrendingUp, Users, Calendar,
  CheckCircle2, Clock, AlertTriangle, Loader2, FileText, Award,
  ChevronDown, ChevronUp, Zap,
} from "lucide-react";
import CompetitorAdBenchmark from "./plan/CompetitorAdBenchmark";
import PromotionGantt from "./plan/PromotionGantt";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface Props {
  productId: number;
  parentAsin: string;
  productTitle: string;
}

export default function OpsProductPlan({ productId, parentAsin, productTitle }: Props) {
  // ─── Queries ───
  const { data: plans, refetch: refetchPlans, isLoading } = trpc.productOps.listPlans.useQuery(
    { productProfileId: productId, parentAsin }
  );

  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const activePlan = plans?.find(p => p.id === selectedPlanId) || plans?.[0];
  const activePlanId = activePlan?.id;

  const { data: planActions, refetch: refetchActions } = trpc.productOps.listPlanActions.useQuery(
    { planId: activePlanId! }, { enabled: !!activePlanId }
  );
  const { data: planSummaries, refetch: refetchSummaries } = trpc.productOps.listPlanSummaries.useQuery(
    { planId: activePlanId! }, { enabled: !!activePlanId }
  );

  // ─── Mutations ───
  const createPlan = trpc.productOps.createPlan.useMutation({
    onSuccess: (data) => {
      refetchPlans();
      setSelectedPlanId(data.id);
      setShowCreatePlan(false);
      toast.success("运营计划已创建");
    },
  });
  const updatePlan = trpc.productOps.updatePlan.useMutation({
    onSuccess: () => { refetchPlans(); toast.success("计划已更新"); },
  });
  const deletePlan = trpc.productOps.deletePlan.useMutation({
    onSuccess: () => { refetchPlans(); setSelectedPlanId(null); toast.success("计划已删除"); },
  });
  const createAction = trpc.productOps.createPlanAction.useMutation({
    onSuccess: () => { refetchActions(); setShowAddAction(false); toast.success("提升动作已添加"); },
  });
  const updateAction = trpc.productOps.updatePlanAction.useMutation({
    onSuccess: () => { refetchActions(); toast.success("动作已更新"); },
  });
  const deleteAction = trpc.productOps.deletePlanAction.useMutation({
    onSuccess: () => { refetchActions(); toast.success("动作已删除"); },
  });
  const createSummary = trpc.productOps.createPlanSummary.useMutation({
    onSuccess: () => { refetchSummaries(); setShowAddSummary(false); toast.success("执行总结已添加"); },
  });
  const updateSummary = trpc.productOps.updatePlanSummary.useMutation({
    onSuccess: () => { refetchSummaries(); toast.success("总结已更新"); },
  });

  // ─── Local State ───
  const [showCreatePlan, setShowCreatePlan] = useState(false);
  const [showAddAction, setShowAddAction] = useState(false);
  const [showAddSummary, setShowAddSummary] = useState(false);
  const [showEditBaseline, setShowEditBaseline] = useState(false);
  const [showEditTargets, setShowEditTargets] = useState(false);

  // Baseline: multi-select week indices
  const [selectedBaselineWeeks, setSelectedBaselineWeeks] = useState<number[]>([]);
  const [showBaselineWeekPicker, setShowBaselineWeekPicker] = useState(false);
  const syncBaselineData = trpc.productOps.syncPlanBaselineData.useMutation({
    onSuccess: (data) => {
      refetchPlans();
      toast.success(`基期数据已加载 (${data.weekLabel})`);
      setShowBaselineWeekPicker(false);
    },
    onError: (err) => {
      toast.error(`加载失败: ${err.message}`);
    },
  });

  // Week count selector for current data (from imported data)
  const [selectedWeekCount, setSelectedWeekCount] = useState(1);
  const { data: availableWeeks } = trpc.productOps.getAvailableWeeks.useQuery(
    { parentAsin }, { enabled: !!parentAsin }
  );
  const syncCurrentData = trpc.productOps.syncPlanCurrentData.useMutation({
    onSuccess: (data) => {
      refetchPlans();
      toast.success(`当期数据已加载 (${data.weekLabel})`);
    },
    onError: (err) => {
      toast.error(`加载失败: ${err.message}`);
    },
  });
  // Auto-load current data when week count changes
  useEffect(() => {
    if (activePlanId && parentAsin && availableWeeks && availableWeeks.length > 0) {
      syncCurrentData.mutate({ planId: activePlanId, parentAsin, weekCount: selectedWeekCount });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWeekCount, activePlanId]);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    baseline: true, current: true, targets: true, actions: true, summaries: false,
  });

  const [planForm, setPlanForm] = useState({
    planName: "", planPeriod: "", projectManager: "", projectMembers: "", gamePlanner: "",
  });
  const [actionForm, setActionForm] = useState({
    dimension: "", currentStatus: "", targetAction: "", priority: "medium", plannedDate: "", assignee: "", autoCreateTodo: true,
  });
  const [summaryForm, setSummaryForm] = useState({
    period: "", achievementSummary: "", plannerFeedback: "", rating: "good",
    actualSales: "", actualProfitRate: "", actualConvRate: "", actualOrganicOrders: "",
    actualAdOrders: "", actualRatingScore: "", actualRatingCount: "", actualSubcategoryRank: "",
  });
  const [baselineForm, setBaselineForm] = useState({
    baselineWeekLabel: "", baselineSales: "", baselineSubcategoryRank: "",
    baselineProfitRate: "", baselineConvRate: "",
    baselineOrganicOrders: "", baselineAdOrders: "",
    baselineRatingScore: "", baselineRatingCount: "",
  });
  const [currentForm, setCurrentForm] = useState({
    currentWeekLabel: "", currentSales: "", currentSubcategoryRank: "",
    currentProfitRate: "", currentConvRate: "",
    currentOrganicOrders: "", currentAdOrders: "",
    currentRatingScore: "", currentRatingCount: "",
  });
  const [targetForm, setTargetForm] = useState({
    targetSales: "", targetSubcategoryRank: "",
    targetProfitRate: "", targetConvRate: "",
    targetOrganicOrders: "", targetAdOrders: "",
    targetRatingScore: "", targetRatingCount: "",
  });

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Calculate action completion stats
  const actionStats = useMemo(() => {
    if (!planActions) return { total: 0, completed: 0, inProgress: 0, delayed: 0, rate: 0 };
    const total = planActions.length;
    const completed = planActions.filter(a => a.status === "completed").length;
    const inProgress = planActions.filter(a => a.status === "in_progress").length;
    const delayed = planActions.filter(a => a.status === "delayed").length;
    return { total, completed, inProgress, delayed, rate: total > 0 ? Math.round(completed / total * 100) : 0 };
  }, [planActions]);

  const priorityColors: Record<string, string> = {
    high: "text-red-600 bg-red-50", medium: "text-yellow-600 bg-yellow-50", low: "text-blue-600 bg-blue-50",
  };
  const statusLabels: Record<string, string> = {
    not_started: "未开始", in_progress: "进行中", completed: "已完成", delayed: "已延期",
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Plan Selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Target className="h-5 w-5 text-indigo-600" />
          <h2 className="text-lg font-semibold">运营计划</h2>
          {plans && plans.length > 0 && (
            <Select
              value={String(activePlanId || "")}
              onValueChange={v => setSelectedPlanId(Number(v))}
            >
              <SelectTrigger className="w-[240px]">
                <SelectValue placeholder="选择计划" />
              </SelectTrigger>
              <SelectContent>
                {plans.map(p => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.planName} {p.planPeriod ? `(${p.planPeriod})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setShowCreatePlan(true)}>
            <Plus className="h-3 w-3 mr-1" /> 新建计划
          </Button>
          {activePlan && (
            <Button size="sm" variant="destructive" onClick={() => {
              if (confirm("确定删除此计划？")) deletePlan.mutate({ planId: activePlan.id });
            }}>
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {!activePlan ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Target className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">暂无运营计划，创建一个开始管理运营提升项目</p>
            <Button onClick={() => setShowCreatePlan(true)}>
              <Plus className="h-4 w-4 mr-2" /> 创建运营计划
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Plan Info Header */}
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">计划名称</span>
                  <p className="font-medium">{activePlan.planName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">计划周期</span>
                  <p className="font-medium">{activePlan.planPeriod || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">项目经理</span>
                  <p className="font-medium">{activePlan.projectManager || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">项目成员</span>
                  <p className="font-medium">{activePlan.projectMembers || "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">游戏策划师</span>
                  <p className="font-medium">{activePlan.gamePlanner || "—"}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 mt-3 pt-3 border-t">
                <div className="flex items-center gap-2">
                  <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${actionStats.rate}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground">{actionStats.rate}%</span>
                </div>
                <span className="text-xs text-muted-foreground">{actionStats.completed}/{actionStats.total} 已完成</span>
              </div>
            </CardContent>
          </Card>

          {/* Baseline & Current Data - Side by Side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Baseline Data */}
            <Card>
              <CardHeader className="pb-2 cursor-pointer" onClick={() => toggleSection("baseline")}>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-gray-600" />
                    基期数据
                    {(activePlan as any).baselineWeekLabel && (
                      <Badge variant="outline" className="text-xs font-normal">{(activePlan as any).baselineWeekLabel}</Badge>
                    )}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {availableWeeks && availableWeeks.length > 0 ? (
                      <div className="relative" onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowBaselineWeekPicker(!showBaselineWeekPicker)}>
                          {syncBaselineData.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Calendar className="h-3 w-3" />}
                          {selectedBaselineWeeks.length > 0 ? `已选${selectedBaselineWeeks.length}周` : '选择周度'}
                        </Button>
                        {showBaselineWeekPicker && (
                          <div className="absolute right-0 top-8 z-50 bg-popover border rounded-lg shadow-lg p-3 min-w-[220px]">
                            <div className="text-xs font-medium mb-2 text-muted-foreground">选择基期周度（可多选）</div>
                            <div className="max-h-[200px] overflow-y-auto space-y-1">
                              {availableWeeks.map((w: any) => (
                                <label key={w.index} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer text-xs">
                                  <Checkbox
                                    checked={selectedBaselineWeeks.includes(w.index)}
                                    onCheckedChange={(checked) => {
                                      setSelectedBaselineWeeks(prev =>
                                        checked ? [...prev, w.index] : prev.filter(i => i !== w.index)
                                      );
                                    }}
                                  />
                                  {w.label}
                                </label>
                              ))}
                            </div>
                            <div className="flex gap-2 mt-2 pt-2 border-t">
                              <Button size="sm" variant="outline" className="h-6 text-xs flex-1" onClick={() => { setSelectedBaselineWeeks([]); }}>清空</Button>
                              <Button size="sm" className="h-6 text-xs flex-1" disabled={selectedBaselineWeeks.length === 0 || syncBaselineData.isPending}
                                onClick={() => {
                                  if (activePlanId) {
                                    syncBaselineData.mutate({ planId: activePlanId, parentAsin, weekIndices: selectedBaselineWeeks });
                                  }
                                }}>
                                {syncBaselineData.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                                加载数据
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <Badge variant="outline" className="text-xs text-muted-foreground">暂无导入数据</Badge>
                    )}
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setShowEditBaseline(true); loadBaselineForm(); }}>
                      <Edit2 className="h-3 w-3" />
                    </Button>
                    {expandedSections.baseline ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </div>
              </CardHeader>
              {expandedSections.baseline && (
                <CardContent>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <DataCell label="销售额" value={(activePlan as any).baselineSales} prefix="$" />
                    <DataCell label="小类排名" value={(activePlan as any).baselineSubcategoryRank ? String((activePlan as any).baselineSubcategoryRank) : null} prefix="#" />
                    <DataCell label="利润率" value={(activePlan as any).baselineProfitRate} suffix="%" />
                    <DataCell label="转化率" value={(activePlan as any).baselineConvRate} suffix="%" />
                    <DataCell label="自然单" value={(activePlan as any).baselineOrganicOrders != null ? String((activePlan as any).baselineOrganicOrders) : null} />
                    <DataCell label="广告单" value={(activePlan as any).baselineAdOrders != null ? String((activePlan as any).baselineAdOrders) : null} />
                    <DataCell label="评分" value={(activePlan as any).baselineRatingScore} />
                    <DataCell label="Rating数量" value={(activePlan as any).baselineRatingCount ? String((activePlan as any).baselineRatingCount) : null} />
                  </div>
                </CardContent>
              )}
            </Card>

            {/* Current Data */}
            <Card>
              <CardHeader className="pb-2 cursor-pointer" onClick={() => toggleSection("current")}>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-emerald-600" />
                    当期数据
                    {(activePlan as any).currentWeekLabel && (
                      <Badge variant="outline" className="text-xs font-normal">{(activePlan as any).currentWeekLabel}</Badge>
                    )}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {availableWeeks && availableWeeks.length > 0 ? (
                      <Select
                        value={String(selectedWeekCount)}
                        onValueChange={(v) => { setSelectedWeekCount(Number(v)); }}
                      >
                        <SelectTrigger className="h-7 w-[140px] text-xs" onClick={(e) => e.stopPropagation()}>
                          {syncCurrentData.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                          <SelectValue placeholder="选择周期" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">最近 1 周</SelectItem>
                          {availableWeeks.length >= 2 && <SelectItem value="2">最近 2 周</SelectItem>}
                          {availableWeeks.length >= 3 && <SelectItem value="3">最近 3 周</SelectItem>}
                          {availableWeeks.length >= 4 && <SelectItem value="4">最近 4 周</SelectItem>}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="outline" className="text-xs text-muted-foreground">暂无导入数据</Badge>
                    )}
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setShowEditBaseline(true); loadBaselineForm(); }}>
                      <Edit2 className="h-3 w-3" />
                    </Button>
                    {expandedSections.current ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </div>
              </CardHeader>
              {expandedSections.current && (
                <CardContent>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <DataCell label="销售额" value={(activePlan as any).currentSales} prefix="$" compare={(activePlan as any).baselineSales} />
                    <DataCell label="小类排名" value={(activePlan as any).currentSubcategoryRank ? String((activePlan as any).currentSubcategoryRank) : null} prefix="#" compare={(activePlan as any).baselineSubcategoryRank ? String((activePlan as any).baselineSubcategoryRank) : null} invertColor />
                    <DataCell label="利润率" value={(activePlan as any).currentProfitRate} suffix="%" compare={(activePlan as any).baselineProfitRate} />
                    <DataCell label="转化率" value={(activePlan as any).currentConvRate} suffix="%" compare={(activePlan as any).baselineConvRate} />
                    <DataCell label="自然单" value={(activePlan as any).currentOrganicOrders != null ? String((activePlan as any).currentOrganicOrders) : null} compare={(activePlan as any).baselineOrganicOrders != null ? String((activePlan as any).baselineOrganicOrders) : null} />
                    <DataCell label="广告单" value={(activePlan as any).currentAdOrders != null ? String((activePlan as any).currentAdOrders) : null} compare={(activePlan as any).baselineAdOrders != null ? String((activePlan as any).baselineAdOrders) : null} />
                    <DataCell label="评分" value={(activePlan as any).currentRatingScore} compare={(activePlan as any).baselineRatingScore} />
                    <DataCell label="Rating数量" value={(activePlan as any).currentRatingCount ? String((activePlan as any).currentRatingCount) : null} compare={(activePlan as any).baselineRatingCount ? String((activePlan as any).baselineRatingCount) : null} />
                  </div>
                  {(activePlan as any).currentWeekLabel && (
                    <p className="text-xs text-muted-foreground mt-2">
                      ℹ️ 周度数据: {(activePlan as any).currentWeekLabel} | 与基期数据对比，绿色表示提升，红色表示下降
                    </p>
                  )}
                </CardContent>
              )}
            </Card>
          </div>

          {/* Targets */}
          <Card>
            <CardHeader className="pb-2 cursor-pointer" onClick={() => toggleSection("targets")}>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="h-4 w-4 text-indigo-600" />
                  目标设定
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setShowEditTargets(true); loadTargetForm(); }}>
                    <Edit2 className="h-3 w-3" />
                  </Button>
                  {expandedSections.targets ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
              </div>
            </CardHeader>
            {expandedSections.targets && (
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <TargetCard label="销售额" target={(activePlan as any).targetSales} current={(activePlan as any).currentSales} prefix="$" />
                  <TargetCard label="小类排名" target={(activePlan as any).targetSubcategoryRank ? String((activePlan as any).targetSubcategoryRank) : null} current={(activePlan as any).currentSubcategoryRank ? String((activePlan as any).currentSubcategoryRank) : null} prefix="#" invertProgress />
                  <TargetCard label="利润率" target={(activePlan as any).targetProfitRate} current={(activePlan as any).currentProfitRate} suffix="%" />
                  <TargetCard label="转化率" target={(activePlan as any).targetConvRate} current={(activePlan as any).currentConvRate} suffix="%" />
                  <TargetCard label="自然单" target={(activePlan as any).targetOrganicOrders ? String((activePlan as any).targetOrganicOrders) : null} current={(activePlan as any).currentOrganicOrders != null ? String((activePlan as any).currentOrganicOrders) : null} />
                  <TargetCard label="广告单" target={(activePlan as any).targetAdOrders ? String((activePlan as any).targetAdOrders) : null} current={(activePlan as any).currentAdOrders != null ? String((activePlan as any).currentAdOrders) : null} />
                  <TargetCard label="评分" target={(activePlan as any).targetRatingScore} current={(activePlan as any).currentRatingScore} />
                  <TargetCard label="Rating数量" target={(activePlan as any).targetRatingCount ? String((activePlan as any).targetRatingCount) : null} current={(activePlan as any).currentRatingCount ? String((activePlan as any).currentRatingCount) : null} />
                </div>
              </CardContent>
            )}
          </Card>

          {/* Actions Table */}
          <Card>
            <CardHeader className="pb-2 cursor-pointer" onClick={() => toggleSection("actions")}>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4 text-orange-600" />
                  转化率提升计划表
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={(e) => { e.stopPropagation(); setShowAddAction(true); }}>
                    <Plus className="h-3 w-3 mr-1" /> 添加动作
                  </Button>
                  {expandedSections.actions ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
              </div>
            </CardHeader>
            {expandedSections.actions && (
              <CardContent>
                {!planActions || planActions.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">暂无提升动作，点击"添加动作"开始规划</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[120px]">提升维度</TableHead>
                          <TableHead className="w-[160px]">父体现状</TableHead>
                          <TableHead className="w-[200px]">提升目标/动作</TableHead>
                          <TableHead className="w-[80px]">优先级</TableHead>
                          <TableHead className="w-[100px]">计划时间</TableHead>
                          <TableHead className="w-[80px]">负责人</TableHead>
                          <TableHead className="w-[90px]">状态</TableHead>
                          <TableHead className="w-[60px]">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {planActions.map((action) => (
                          <TableRow key={action.id}>
                            <TableCell className="font-medium text-sm">{action.dimension}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{action.currentStatus || "—"}</TableCell>
                            <TableCell className="text-sm">{action.targetAction || "—"}</TableCell>
                            <TableCell>
                              <Badge variant="secondary" className={`text-xs ${priorityColors[action.priority || "medium"]}`}>
                                {action.priority === "high" ? "高" : action.priority === "low" ? "低" : "中"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">{action.plannedDate || "—"}</TableCell>
                            <TableCell className="text-sm">{action.assignee || "—"}</TableCell>
                            <TableCell>
                              <Select
                                value={action.status || "not_started"}
                                onValueChange={(v) => updateAction.mutate({ actionId: action.id, status: v as any })}
                              >
                                <SelectTrigger className="h-7 text-xs w-[90px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="not_started">未开始</SelectItem>
                                  <SelectItem value="in_progress">进行中</SelectItem>
                                  <SelectItem value="completed">已完成</SelectItem>
                                  <SelectItem value="delayed">已延期</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500"
                                onClick={() => { if (confirm("确定删除？")) deleteAction.mutate({ actionId: action.id }); }}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            )}
          </Card>

          {/* Summaries */}
          <Card>
            <CardHeader className="pb-2 cursor-pointer" onClick={() => toggleSection("summaries")}>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Award className="h-4 w-4 text-amber-600" />
                  执行总结
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={(e) => { e.stopPropagation(); setShowAddSummary(true); }}>
                    <Plus className="h-3 w-3 mr-1" /> 添加总结
                  </Button>
                  {expandedSections.summaries ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
              </div>
            </CardHeader>
            {expandedSections.summaries && (
              <CardContent>
                {!planSummaries || planSummaries.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">暂无执行总结</p>
                ) : (
                  <div className="space-y-4">
                    {planSummaries.map((summary) => (
                      <div key={summary.id} className="border rounded-lg p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{summary.period || "未标注周期"}</Badge>
                            <Badge className={summary.rating === "excellent" ? "bg-emerald-100 text-emerald-700" : summary.rating === "good" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}>
                              {summary.rating === "excellent" ? "优秀" : summary.rating === "good" ? "合格" : "有待改进"}
                            </Badge>
                          </div>
                        </div>
                        {/* Actual metrics */}
                        <div className="grid grid-cols-3 md:grid-cols-4 gap-2 text-sm bg-muted/50 rounded-lg p-3">
                          {summary.actualSales && <div><span className="text-muted-foreground text-xs">销售额</span><p className="font-medium">${summary.actualSales}</p></div>}
                          {(summary as any).actualSubcategoryRank && <div><span className="text-muted-foreground text-xs">小类排名</span><p className="font-medium">#{(summary as any).actualSubcategoryRank}</p></div>}
                          {(summary as any).actualProfitRate && <div><span className="text-muted-foreground text-xs">利润率</span><p className="font-medium">{(summary as any).actualProfitRate}%</p></div>}
                          {(summary as any).actualConvRate && <div><span className="text-muted-foreground text-xs">转化率</span><p className="font-medium">{(summary as any).actualConvRate}%</p></div>}
                          {(summary as any).actualOrganicOrders && <div><span className="text-muted-foreground text-xs">自然单</span><p className="font-medium">{(summary as any).actualOrganicOrders}</p></div>}
                          {(summary as any).actualAdOrders && <div><span className="text-muted-foreground text-xs">广告单</span><p className="font-medium">{(summary as any).actualAdOrders}</p></div>}
                          {summary.actualRating && <div><span className="text-muted-foreground text-xs">评分</span><p className="font-medium">{summary.actualRating}</p></div>}
                        </div>
                        {summary.achievementSummary && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">达成情况总结（项目经理）</p>
                            <p className="text-sm whitespace-pre-wrap bg-muted/30 rounded p-2">{summary.achievementSummary}</p>
                          </div>
                        )}
                        {summary.plannerFeedback && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">游戏策划师反馈</p>
                            <p className="text-sm whitespace-pre-wrap bg-indigo-50 rounded p-2 text-indigo-900">{summary.plannerFeedback}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            )}
          </Card>
          {/* Competitor Ad Benchmark - 竞品广告对标雷达图 */}
          <CompetitorAdBenchmark planId={activePlanId!} asin={parentAsin} />

          {/* Promotion Gantt - 推广周期甘特图 */}
          <PromotionGantt planId={activePlanId!} asin={parentAsin} />
        </>
      )}

      {/* ─── Dialogs ─── */}

      {/* Create Plan Dialog */}
      <Dialog open={showCreatePlan} onOpenChange={setShowCreatePlan}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>新建运营计划</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>父ASIN *</Label>
              <Input value={parentAsin} disabled className="bg-muted font-mono" />
            </div>
            <div>
              <Label>计划名称 *</Label>
              <Input value={planForm.planName} onChange={e => setPlanForm(f => ({ ...f, planName: e.target.value }))} placeholder="如：Q1运营提升计划" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>计划周期</Label>
                <Input value={planForm.planPeriod} onChange={e => setPlanForm(f => ({ ...f, planPeriod: e.target.value }))} placeholder="如：2026 Q1" />
              </div>
              <div>
                <Label>项目经理</Label>
                <Input value={planForm.projectManager} onChange={e => setPlanForm(f => ({ ...f, projectManager: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>项目成员</Label>
                <Input value={planForm.projectMembers} onChange={e => setPlanForm(f => ({ ...f, projectMembers: e.target.value }))} placeholder="多人用逗号分隔" />
              </div>
              <div>
                <Label>游戏策划师</Label>
                <Input value={planForm.gamePlanner} onChange={e => setPlanForm(f => ({ ...f, gamePlanner: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreatePlan(false)}>取消</Button>
            <Button disabled={!planForm.planName || createPlan.isPending} onClick={() => createPlan.mutate({
              productProfileId: productId, parentAsin, ...planForm,
            })}>
              {createPlan.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Action Dialog */}
      <Dialog open={showAddAction} onOpenChange={setShowAddAction}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>添加提升动作</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>提升维度 *</Label>
              <Select value={actionForm.dimension} onValueChange={v => setActionForm(f => ({ ...f, dimension: v }))}>
                <SelectTrigger><SelectValue placeholder="选择维度" /></SelectTrigger>
                <SelectContent>
                  {["标题优化", "五点优化", "长描述优化", "搜索词优化", "价格策略", "变体优化", "主图升级", "A+改版", "品牌故事", "视频制作", "Q&A优化", "Review管理", "广告策略", "流量闭环", "Post运营", "其他"].map(d => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>父体现状</Label>
              <Textarea value={actionForm.currentStatus} onChange={e => setActionForm(f => ({ ...f, currentStatus: e.target.value }))} placeholder="描述当前该维度的状态" rows={2} />
            </div>
            <div>
              <Label>提升目标/动作</Label>
              <Textarea value={actionForm.targetAction} onChange={e => setActionForm(f => ({ ...f, targetAction: e.target.value }))} placeholder="具体要做什么" rows={2} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>优先级</Label>
                <Select value={actionForm.priority} onValueChange={v => setActionForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">高</SelectItem>
                    <SelectItem value="medium">中</SelectItem>
                    <SelectItem value="low">低</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>计划完成时间</Label>
                <Input type="date" value={actionForm.plannedDate} onChange={e => setActionForm(f => ({ ...f, plannedDate: e.target.value }))} />
              </div>
              <div>
                <Label>负责人</Label>
                <Input value={actionForm.assignee} onChange={e => setActionForm(f => ({ ...f, assignee: e.target.value }))} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox checked={actionForm.autoCreateTodo} onCheckedChange={(c) => setActionForm(f => ({ ...f, autoCreateTodo: !!c }))} />
              <Label className="text-sm">自动创建关联待办任务（联动页面一）</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddAction(false)}>取消</Button>
            <Button disabled={!actionForm.dimension || createAction.isPending} onClick={() => createAction.mutate({
              planId: activePlanId!, productProfileId: productId, ...actionForm, priority: actionForm.priority as "high" | "medium" | "low",
            })}>
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Summary Dialog */}
      <Dialog open={showAddSummary} onOpenChange={setShowAddSummary}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>添加执行总结</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>总结周期</Label>
                <Input value={summaryForm.period} onChange={e => setSummaryForm(f => ({ ...f, period: e.target.value }))} placeholder="如：04/13-04/19" />
              </div>
              <div>
                <Label>评价</Label>
                <Select value={summaryForm.rating} onValueChange={v => setSummaryForm(f => ({ ...f, rating: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="excellent">优秀</SelectItem>
                    <SelectItem value="good">合格</SelectItem>
                    <SelectItem value="needs_improvement">有待改进</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div><Label className="text-xs">销售额$</Label><Input value={summaryForm.actualSales} onChange={e => setSummaryForm(f => ({ ...f, actualSales: e.target.value }))} /></div>
              <div><Label className="text-xs">小类排名#</Label><Input value={summaryForm.actualSubcategoryRank} onChange={e => setSummaryForm(f => ({ ...f, actualSubcategoryRank: e.target.value }))} /></div>
              <div><Label className="text-xs">利润率%</Label><Input value={summaryForm.actualProfitRate} onChange={e => setSummaryForm(f => ({ ...f, actualProfitRate: e.target.value }))} /></div>
              <div><Label className="text-xs">转化率%</Label><Input value={summaryForm.actualConvRate} onChange={e => setSummaryForm(f => ({ ...f, actualConvRate: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs">自然单</Label><Input value={summaryForm.actualOrganicOrders} onChange={e => setSummaryForm(f => ({ ...f, actualOrganicOrders: e.target.value }))} /></div>
              <div><Label className="text-xs">广告单</Label><Input value={summaryForm.actualAdOrders} onChange={e => setSummaryForm(f => ({ ...f, actualAdOrders: e.target.value }))} /></div>
              <div><Label className="text-xs">评分</Label><Input value={summaryForm.actualRatingScore} onChange={e => setSummaryForm(f => ({ ...f, actualRatingScore: e.target.value }))} /></div>
            </div>
            <div>
              <Label>达成情况总结（项目经理）</Label>
              <Textarea value={summaryForm.achievementSummary} onChange={e => setSummaryForm(f => ({ ...f, achievementSummary: e.target.value }))} rows={3} />
            </div>
            <div>
              <Label>游戏策划师反馈</Label>
              <Textarea value={summaryForm.plannerFeedback} onChange={e => setSummaryForm(f => ({ ...f, plannerFeedback: e.target.value }))} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddSummary(false)}>取消</Button>
            <Button disabled={createSummary.isPending} onClick={() => createSummary.mutate({
              planId: activePlanId!, ...summaryForm,
              rating: summaryForm.rating as "excellent" | "good" | "needs_improvement",
              actualRanking: summaryForm.actualSubcategoryRank ? Number(summaryForm.actualSubcategoryRank) : undefined,
            })}>
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Baseline & Current Dialog */}
      <Dialog open={showEditBaseline} onOpenChange={setShowEditBaseline}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>编辑基期/当期数据</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                <Calendar className="h-3 w-3" /> 基期数据
              </h4>
              <div className="grid grid-cols-4 gap-3">
                <div><Label className="text-xs">周期标签</Label><Input value={baselineForm.baselineWeekLabel} onChange={e => setBaselineForm(f => ({ ...f, baselineWeekLabel: e.target.value }))} placeholder="如：03/30-04/05" /></div>
                <div><Label className="text-xs">销售额$</Label><Input value={baselineForm.baselineSales} onChange={e => setBaselineForm(f => ({ ...f, baselineSales: e.target.value }))} /></div>
                <div><Label className="text-xs">小类排名</Label><Input value={baselineForm.baselineSubcategoryRank} onChange={e => setBaselineForm(f => ({ ...f, baselineSubcategoryRank: e.target.value }))} /></div>
                <div><Label className="text-xs">利润率%</Label><Input value={baselineForm.baselineProfitRate} onChange={e => setBaselineForm(f => ({ ...f, baselineProfitRate: e.target.value }))} /></div>
                <div><Label className="text-xs">转化率%</Label><Input value={baselineForm.baselineConvRate} onChange={e => setBaselineForm(f => ({ ...f, baselineConvRate: e.target.value }))} /></div>
                <div><Label className="text-xs">自然单</Label><Input value={baselineForm.baselineOrganicOrders} onChange={e => setBaselineForm(f => ({ ...f, baselineOrganicOrders: e.target.value }))} /></div>
                <div><Label className="text-xs">广告单</Label><Input value={baselineForm.baselineAdOrders} onChange={e => setBaselineForm(f => ({ ...f, baselineAdOrders: e.target.value }))} /></div>
                <div><Label className="text-xs">评分</Label><Input value={baselineForm.baselineRatingScore} onChange={e => setBaselineForm(f => ({ ...f, baselineRatingScore: e.target.value }))} /></div>
                <div><Label className="text-xs">Rating数量</Label><Input value={baselineForm.baselineRatingCount} onChange={e => setBaselineForm(f => ({ ...f, baselineRatingCount: e.target.value }))} /></div>
              </div>
            </div>
            <div>
              <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                <TrendingUp className="h-3 w-3" /> 当期数据
              </h4>
              <div className="grid grid-cols-4 gap-3">
                <div><Label className="text-xs">周期标签</Label><Input value={currentForm.currentWeekLabel} onChange={e => setCurrentForm(f => ({ ...f, currentWeekLabel: e.target.value }))} placeholder="如：04/13-04/19" /></div>
                <div><Label className="text-xs">销售额$</Label><Input value={currentForm.currentSales} onChange={e => setCurrentForm(f => ({ ...f, currentSales: e.target.value }))} /></div>
                <div><Label className="text-xs">小类排名</Label><Input value={currentForm.currentSubcategoryRank} onChange={e => setCurrentForm(f => ({ ...f, currentSubcategoryRank: e.target.value }))} /></div>
                <div><Label className="text-xs">利润率%</Label><Input value={currentForm.currentProfitRate} onChange={e => setCurrentForm(f => ({ ...f, currentProfitRate: e.target.value }))} /></div>
                <div><Label className="text-xs">转化率%</Label><Input value={currentForm.currentConvRate} onChange={e => setCurrentForm(f => ({ ...f, currentConvRate: e.target.value }))} /></div>
                <div><Label className="text-xs">自然单</Label><Input value={currentForm.currentOrganicOrders} onChange={e => setCurrentForm(f => ({ ...f, currentOrganicOrders: e.target.value }))} /></div>
                <div><Label className="text-xs">广告单</Label><Input value={currentForm.currentAdOrders} onChange={e => setCurrentForm(f => ({ ...f, currentAdOrders: e.target.value }))} /></div>
                <div><Label className="text-xs">评分</Label><Input value={currentForm.currentRatingScore} onChange={e => setCurrentForm(f => ({ ...f, currentRatingScore: e.target.value }))} /></div>
                <div><Label className="text-xs">Rating数量</Label><Input value={currentForm.currentRatingCount} onChange={e => setCurrentForm(f => ({ ...f, currentRatingCount: e.target.value }))} /></div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditBaseline(false)}>取消</Button>
            <Button onClick={() => {
              updatePlan.mutate({
                planId: activePlanId!,
                baselineWeekLabel: baselineForm.baselineWeekLabel || undefined,
                baselineSales: baselineForm.baselineSales || undefined,
                baselineSubcategoryRank: baselineForm.baselineSubcategoryRank ? Number(baselineForm.baselineSubcategoryRank) : undefined,
                baselineProfitRate: baselineForm.baselineProfitRate || undefined,
                baselineConvRate: baselineForm.baselineConvRate || undefined,
                baselineOrganicOrders: baselineForm.baselineOrganicOrders ? Number(baselineForm.baselineOrganicOrders) : undefined,
                baselineAdOrders: baselineForm.baselineAdOrders ? Number(baselineForm.baselineAdOrders) : undefined,
                baselineRatingScore: baselineForm.baselineRatingScore || undefined,
                baselineRatingCount: baselineForm.baselineRatingCount ? Number(baselineForm.baselineRatingCount) : undefined,
                currentWeekLabel: currentForm.currentWeekLabel || undefined,
                currentSales: currentForm.currentSales || undefined,
                currentSubcategoryRank: currentForm.currentSubcategoryRank ? Number(currentForm.currentSubcategoryRank) : undefined,
                currentProfitRate: currentForm.currentProfitRate || undefined,
                currentConvRate: currentForm.currentConvRate || undefined,
                currentOrganicOrders: currentForm.currentOrganicOrders ? Number(currentForm.currentOrganicOrders) : undefined,
                currentAdOrders: currentForm.currentAdOrders ? Number(currentForm.currentAdOrders) : undefined,
                currentRatingScore: currentForm.currentRatingScore || undefined,
                currentRatingCount: currentForm.currentRatingCount ? Number(currentForm.currentRatingCount) : undefined,
              });
              setShowEditBaseline(false);
            }}>
              <Save className="h-3 w-3 mr-1" /> 保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Targets Dialog */}
      <Dialog open={showEditTargets} onOpenChange={setShowEditTargets}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>编辑目标设定</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>目标销售额 $</Label><Input value={targetForm.targetSales} onChange={e => setTargetForm(f => ({ ...f, targetSales: e.target.value }))} /></div>
              <div><Label>目标小类排名 #</Label><Input value={targetForm.targetSubcategoryRank} onChange={e => setTargetForm(f => ({ ...f, targetSubcategoryRank: e.target.value }))} /></div>
              <div><Label>目标利润率 %</Label><Input value={targetForm.targetProfitRate} onChange={e => setTargetForm(f => ({ ...f, targetProfitRate: e.target.value }))} /></div>
              <div><Label>目标转化率 %</Label><Input value={targetForm.targetConvRate} onChange={e => setTargetForm(f => ({ ...f, targetConvRate: e.target.value }))} /></div>
              <div><Label>目标自然单</Label><Input value={targetForm.targetOrganicOrders} onChange={e => setTargetForm(f => ({ ...f, targetOrganicOrders: e.target.value }))} /></div>
              <div><Label>目标广告单</Label><Input value={targetForm.targetAdOrders} onChange={e => setTargetForm(f => ({ ...f, targetAdOrders: e.target.value }))} /></div>
              <div><Label>目标评分</Label><Input value={targetForm.targetRatingScore} onChange={e => setTargetForm(f => ({ ...f, targetRatingScore: e.target.value }))} /></div>
              <div><Label>目标Rating数量</Label><Input value={targetForm.targetRatingCount} onChange={e => setTargetForm(f => ({ ...f, targetRatingCount: e.target.value }))} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditTargets(false)}>取消</Button>
            <Button onClick={() => {
              updatePlan.mutate({
                planId: activePlanId!,
                targetSales: targetForm.targetSales || undefined,
                targetSubcategoryRank: targetForm.targetSubcategoryRank ? Number(targetForm.targetSubcategoryRank) : undefined,
                targetProfitRate: targetForm.targetProfitRate || undefined,
                targetConvRate: targetForm.targetConvRate || undefined,
                targetOrganicOrders: targetForm.targetOrganicOrders ? Number(targetForm.targetOrganicOrders) : undefined,
                targetAdOrders: targetForm.targetAdOrders ? Number(targetForm.targetAdOrders) : undefined,
                targetRatingScore: targetForm.targetRatingScore || undefined,
                targetRatingCount: targetForm.targetRatingCount ? Number(targetForm.targetRatingCount) : undefined,
              });
              setShowEditTargets(false);
            }}>
              <Save className="h-3 w-3 mr-1" /> 保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  function loadBaselineForm() {
    if (!activePlan) return;
    const p = activePlan as any;
    setBaselineForm({
      baselineWeekLabel: p.baselineWeekLabel || "",
      baselineSales: p.baselineSales || "",
      baselineSubcategoryRank: p.baselineSubcategoryRank ? String(p.baselineSubcategoryRank) : "",
      baselineProfitRate: p.baselineProfitRate || "",
      baselineConvRate: p.baselineConvRate || "",
      baselineOrganicOrders: p.baselineOrganicOrders != null ? String(p.baselineOrganicOrders) : "",
      baselineAdOrders: p.baselineAdOrders != null ? String(p.baselineAdOrders) : "",
      baselineRatingScore: p.baselineRatingScore || "",
      baselineRatingCount: p.baselineRatingCount ? String(p.baselineRatingCount) : "",
    });
    setCurrentForm({
      currentWeekLabel: p.currentWeekLabel || "",
      currentSales: p.currentSales || "",
      currentSubcategoryRank: p.currentSubcategoryRank ? String(p.currentSubcategoryRank) : "",
      currentProfitRate: p.currentProfitRate || "",
      currentConvRate: p.currentConvRate || "",
      currentOrganicOrders: p.currentOrganicOrders != null ? String(p.currentOrganicOrders) : "",
      currentAdOrders: p.currentAdOrders != null ? String(p.currentAdOrders) : "",
      currentRatingScore: p.currentRatingScore || "",
      currentRatingCount: p.currentRatingCount ? String(p.currentRatingCount) : "",
    });
  }

  function loadTargetForm() {
    if (!activePlan) return;
    const p = activePlan as any;
    setTargetForm({
      targetSales: p.targetSales || "",
      targetSubcategoryRank: p.targetSubcategoryRank ? String(p.targetSubcategoryRank) : "",
      targetProfitRate: p.targetProfitRate || "",
      targetConvRate: p.targetConvRate || "",
      targetOrganicOrders: p.targetOrganicOrders ? String(p.targetOrganicOrders) : "",
      targetAdOrders: p.targetAdOrders ? String(p.targetAdOrders) : "",
      targetRatingScore: p.targetRatingScore || "",
      targetRatingCount: p.targetRatingCount ? String(p.targetRatingCount) : "",
    });
  }
}

// ─── Helper Components ───

function DataCell({ label, value, prefix, suffix, compare, invertColor }: {
  label: string; value: string | null | undefined; prefix?: string; suffix?: string; compare?: string | null; invertColor?: boolean;
}) {
  const numVal = value ? parseFloat(value) : null;
  const numComp = compare ? parseFloat(compare) : null;
  const diff = numVal !== null && numComp !== null ? numVal - numComp : null;

  // For ranking, lower is better (invertColor)
  const isPositive = invertColor ? (diff !== null && diff < 0) : (diff !== null && diff > 0);
  const isNegative = invertColor ? (diff !== null && diff > 0) : (diff !== null && diff < 0);

  return (
    <div className="p-2 rounded bg-muted/30">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <p className="font-medium">
          {value ? `${prefix || ""}${value}${suffix || ""}` : "—"}
        </p>
        {diff !== null && diff !== 0 && (
          <span className={`text-xs ${isPositive ? "text-emerald-600" : isNegative ? "text-red-600" : ""}`}>
            {diff > 0 ? "↑" : "↓"}{Math.abs(diff).toFixed(1)}
          </span>
        )}
      </div>
    </div>
  );
}

function TargetCard({ label, target, current, prefix, suffix, invertProgress }: {
  label: string; target: string | null | undefined; current: string | null | undefined; prefix?: string; suffix?: string; invertProgress?: boolean;
}) {
  const targetNum = target ? parseFloat(target) : null;
  const currentNum = current ? parseFloat(current) : null;
  let progress = 0;
  if (targetNum && currentNum) {
    if (invertProgress) {
      // For ranking: lower is better, so progress = target/current * 100
      progress = Math.min(100, Math.round(targetNum / currentNum * 100));
    } else {
      progress = Math.min(100, Math.round(currentNum / targetNum * 100));
    }
  }

  return (
    <div className="p-3 rounded-lg border bg-muted/20">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-lg font-bold">{target ? `${prefix || ""}${target}${suffix || ""}` : "未设定"}</p>
      {targetNum && (
        <div className="mt-2">
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">当前 {current ? `${prefix || ""}${current}${suffix || ""}` : "—"} ({progress}%)</p>
        </div>
      )}
    </div>
  );
}
