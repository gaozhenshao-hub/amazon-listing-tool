import { useState, useMemo } from "react";
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
    { productProfileId: productId }
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
  const [currentPeriod, setCurrentPeriod] = useState<"week" | "biweek" | "month">("month");

  // Sync current data from Lingxing
  const syncCurrentData = trpc.productOps.syncPlanCurrentData.useMutation({
    onSuccess: (data) => {
      refetchPlans();
      toast.success(`当期数据已同步 (近${data.period === 'week' ? '7' : data.period === 'biweek' ? '14' : '30'}天)`);
    },
    onError: (err) => {
      toast.error(`同步失败: ${err.message}`);
    },
  });
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
    actualIndustryConvRate: "", actualSearchConvRate: "", actualOrderConvRate: "", actualAdConvRate: "",
    actualSales: "", actualProfit: "", actualProfitRate: "", actualRanking: "", actualRating: "",
  });
  const [baselineForm, setBaselineForm] = useState({
    baselineDailySales: "", baselineDailyOrders: "", baselineAdConvRate: "",
    baselineIndustrySearchConvRate: "", baselineSearchConvRate: "", baselineCategorySearchConvRate: "",
    baselineAvgPrice: "", baselineRatingCount: "", baselineRatingScore: "",
  });
  const [currentForm, setCurrentForm] = useState({
    currentDailySales: "", currentDailyOrders: "", currentAdConvRate: "",
    currentIndustrySearchConvRate: "", currentSearchConvRate: "", currentCategorySearchConvRate: "",
    currentAvgPrice: "", currentRatingCount: "", currentRatingScore: "",
  });
  const [targetForm, setTargetForm] = useState({
    targetSearchConvRate: "", targetOrderConvRate: "", targetAdConvRate: "", targetKeywordAdvantage: "",
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
  const statusColors: Record<string, string> = {
    not_started: "bg-gray-100 text-gray-700", in_progress: "bg-blue-100 text-blue-700",
    completed: "bg-green-100 text-green-700", delayed: "bg-red-100 text-red-700",
  };
  const statusLabels: Record<string, string> = {
    not_started: "未开始", in_progress: "进行中", completed: "已完成", delayed: "已延期",
  };
  const ratingLabels: Record<string, string> = {
    excellent: "优秀", good: "合格", needs_improvement: "有待改进",
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
            <p className="text-muted-foreground mb-4">暂无运营计划，创建一个开始管理转化率提升项目</p>
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
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${actionStats.rate}%` }} />
                  </div>
                  <span className="text-sm font-medium">{actionStats.rate}%</span>
                </div>
                <Badge variant="secondary">{actionStats.completed}/{actionStats.total} 已完成</Badge>
                {actionStats.inProgress > 0 && <Badge variant="secondary" className="bg-blue-50 text-blue-700">{actionStats.inProgress} 进行中</Badge>}
                {actionStats.delayed > 0 && <Badge variant="secondary" className="bg-red-50 text-red-700">{actionStats.delayed} 已延期</Badge>}
              </div>
            </CardContent>
          </Card>

          {/* Baseline vs Current Data */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Baseline Data */}
            <Card>
              <CardHeader className="pb-2 cursor-pointer" onClick={() => toggleSection("baseline")}>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-gray-600" />
                    基期数据
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setShowEditBaseline(true); loadBaselineForm(); }}>
                      <Edit2 className="h-3 w-3" />
                    </Button>
                    {expandedSections.baseline ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </div>
              </CardHeader>
              {expandedSections.baseline && (
                <CardContent>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <DataCell label="日均销售额" value={activePlan.baselineDailySales} prefix="$" />
                    <DataCell label="日均订单数" value={activePlan.baselineDailyOrders} />
                    <DataCell label="广告转化率" value={activePlan.baselineAdConvRate} suffix="%" />
                    <DataCell label="行业搜索转化率" value={activePlan.baselineIndustrySearchConvRate} suffix="%" />
                    <DataCell label="搜索转化率" value={activePlan.baselineSearchConvRate} suffix="%" />
                    <DataCell label="品类搜索转化率" value={activePlan.baselineCategorySearchConvRate} suffix="%" />
                    <DataCell label="平均售价" value={activePlan.baselineAvgPrice} prefix="$" />
                    <DataCell label="Rating数量" value={String(activePlan.baselineRatingCount || "")} />
                    <DataCell label="Rating评分" value={activePlan.baselineRatingScore} />
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
                    <Select
                      value={currentPeriod}
                      onValueChange={(v) => { setCurrentPeriod(v as any); }}
                    >
                      <SelectTrigger className="w-[100px] h-7 text-xs" onClick={(e) => e.stopPropagation()}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="week">近7天</SelectItem>
                        <SelectItem value="biweek">近14天</SelectItem>
                        <SelectItem value="month">近30天</SelectItem>
                      </SelectContent>
                    </Select>
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                      disabled={syncCurrentData.isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (activePlanId) {
                          syncCurrentData.mutate({ planId: activePlanId, productId, period: currentPeriod });
                        }
                      }}>
                      {syncCurrentData.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <TrendingUp className="h-3 w-3" />}
                      同步领星数据
                    </Button>
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setShowEditBaseline(true); loadCurrentForm(); }}>
                      <Edit2 className="h-3 w-3" />
                    </Button>
                    {expandedSections.current ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </div>
              </CardHeader>
              {expandedSections.current && (
                <CardContent>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <DataCell label="日均销售额" value={activePlan.currentDailySales} prefix="$" compare={activePlan.baselineDailySales} />
                    <DataCell label="日均订单数" value={activePlan.currentDailyOrders} compare={activePlan.baselineDailyOrders} />
                    <DataCell label="广告转化率" value={activePlan.currentAdConvRate} suffix="%" compare={activePlan.baselineAdConvRate} />
                    <DataCell label="行业搜索转化率" value={activePlan.currentIndustrySearchConvRate} suffix="%" compare={activePlan.baselineIndustrySearchConvRate} />
                    <DataCell label="搜索转化率" value={activePlan.currentSearchConvRate} suffix="%" compare={activePlan.baselineSearchConvRate} />
                    <DataCell label="品类搜索转化率" value={activePlan.currentCategorySearchConvRate} suffix="%" compare={activePlan.baselineCategorySearchConvRate} />
                    <DataCell label="平均售价" value={activePlan.currentAvgPrice} prefix="$" compare={activePlan.baselineAvgPrice} />
                    <DataCell label="Rating数量" value={String(activePlan.currentRatingCount || "")} compare={String(activePlan.baselineRatingCount || "")} />
                    <DataCell label="Rating评分" value={activePlan.currentRatingScore} compare={activePlan.baselineRatingScore} />
                  </div>
                  {activePlan.currentDailySales && Number(activePlan.currentDailySales) > 0 && (
                    <p className="text-xs text-muted-foreground mt-2">
                      ℹ️ 数据周期: 近{currentPeriod === 'week' ? '7' : currentPeriod === 'biweek' ? '14' : '30'}天 | 与基期数据对比，绿色表示提升，红色表示下降
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
                  季度目标
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
                  <TargetCard label="搜索转化率" target={activePlan.targetSearchConvRate} current={activePlan.currentSearchConvRate} suffix="%" />
                  <TargetCard label="订单转化率" target={activePlan.targetOrderConvRate} current={activePlan.currentDailyOrders} suffix="%" />
                  <TargetCard label="广告转化率" target={activePlan.targetAdConvRate} current={activePlan.currentAdConvRate} suffix="%" />
                  <TargetCard label="核心词相对优势" target={activePlan.targetKeywordAdvantage} current={null} suffix="%" />
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
                          <div className="flex items-center gap-3">
                            <Badge variant="secondary">{summary.period || "未指定周期"}</Badge>
                            {summary.rating && (
                              <Badge variant="secondary" className={
                                summary.rating === "excellent" ? "bg-green-100 text-green-700" :
                                summary.rating === "good" ? "bg-blue-100 text-blue-700" :
                                "bg-yellow-100 text-yellow-700"
                              }>
                                {ratingLabels[summary.rating] || summary.rating}
                              </Badge>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {new Date(summary.createdAt).toLocaleDateString("zh-CN")}
                          </span>
                        </div>
                        {/* Actual metrics */}
                        <div className="grid grid-cols-3 md:grid-cols-5 gap-2 text-sm bg-muted/50 rounded-lg p-3">
                          {summary.actualIndustryConvRate && <div><span className="text-muted-foreground text-xs">行业转化率</span><p className="font-medium">{summary.actualIndustryConvRate}%</p></div>}
                          {summary.actualSearchConvRate && <div><span className="text-muted-foreground text-xs">搜索转化率</span><p className="font-medium">{summary.actualSearchConvRate}%</p></div>}
                          {summary.actualOrderConvRate && <div><span className="text-muted-foreground text-xs">订单转化率</span><p className="font-medium">{summary.actualOrderConvRate}%</p></div>}
                          {summary.actualAdConvRate && <div><span className="text-muted-foreground text-xs">广告转化率</span><p className="font-medium">{summary.actualAdConvRate}%</p></div>}
                          {summary.actualSales && <div><span className="text-muted-foreground text-xs">销售额</span><p className="font-medium">${summary.actualSales}</p></div>}
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
              <Label>计划名称 *</Label>
              <Input value={planForm.planName} onChange={e => setPlanForm(f => ({ ...f, planName: e.target.value }))} placeholder="如：Q1转化率提升计划" />
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
              productProfileId: productId, ...planForm,
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
                <Input value={summaryForm.period} onChange={e => setSummaryForm(f => ({ ...f, period: e.target.value }))} placeholder="如：2026年1月" />
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
              <div><Label className="text-xs">行业转化率%</Label><Input value={summaryForm.actualIndustryConvRate} onChange={e => setSummaryForm(f => ({ ...f, actualIndustryConvRate: e.target.value }))} /></div>
              <div><Label className="text-xs">搜索转化率%</Label><Input value={summaryForm.actualSearchConvRate} onChange={e => setSummaryForm(f => ({ ...f, actualSearchConvRate: e.target.value }))} /></div>
              <div><Label className="text-xs">订单转化率%</Label><Input value={summaryForm.actualOrderConvRate} onChange={e => setSummaryForm(f => ({ ...f, actualOrderConvRate: e.target.value }))} /></div>
              <div><Label className="text-xs">广告转化率%</Label><Input value={summaryForm.actualAdConvRate} onChange={e => setSummaryForm(f => ({ ...f, actualAdConvRate: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs">销售额$</Label><Input value={summaryForm.actualSales} onChange={e => setSummaryForm(f => ({ ...f, actualSales: e.target.value }))} /></div>
              <div><Label className="text-xs">利润额$</Label><Input value={summaryForm.actualProfit} onChange={e => setSummaryForm(f => ({ ...f, actualProfit: e.target.value }))} /></div>
              <div><Label className="text-xs">利润率%</Label><Input value={summaryForm.actualProfitRate} onChange={e => setSummaryForm(f => ({ ...f, actualProfitRate: e.target.value }))} /></div>
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
              planId: activePlanId!, ...summaryForm, rating: summaryForm.rating as "excellent" | "good" | "needs_improvement", actualRanking: summaryForm.actualRanking ? Number(summaryForm.actualRanking) : undefined,
            })}>
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Baseline Dialog */}
      <Dialog open={showEditBaseline} onOpenChange={setShowEditBaseline}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>编辑基期/当期数据</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <h4 className="font-medium text-sm">基期数据</h4>
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs">日均销售额$</Label><Input value={baselineForm.baselineDailySales} onChange={e => setBaselineForm(f => ({ ...f, baselineDailySales: e.target.value }))} /></div>
              <div><Label className="text-xs">日均订单数</Label><Input value={baselineForm.baselineDailyOrders} onChange={e => setBaselineForm(f => ({ ...f, baselineDailyOrders: e.target.value }))} /></div>
              <div><Label className="text-xs">广告转化率%</Label><Input value={baselineForm.baselineAdConvRate} onChange={e => setBaselineForm(f => ({ ...f, baselineAdConvRate: e.target.value }))} /></div>
              <div><Label className="text-xs">行业搜索转化率%</Label><Input value={baselineForm.baselineIndustrySearchConvRate} onChange={e => setBaselineForm(f => ({ ...f, baselineIndustrySearchConvRate: e.target.value }))} /></div>
              <div><Label className="text-xs">搜索转化率%</Label><Input value={baselineForm.baselineSearchConvRate} onChange={e => setBaselineForm(f => ({ ...f, baselineSearchConvRate: e.target.value }))} /></div>
              <div><Label className="text-xs">品类搜索转化率%</Label><Input value={baselineForm.baselineCategorySearchConvRate} onChange={e => setBaselineForm(f => ({ ...f, baselineCategorySearchConvRate: e.target.value }))} /></div>
              <div><Label className="text-xs">平均售价$</Label><Input value={baselineForm.baselineAvgPrice} onChange={e => setBaselineForm(f => ({ ...f, baselineAvgPrice: e.target.value }))} /></div>
              <div><Label className="text-xs">Rating数量</Label><Input value={baselineForm.baselineRatingCount} onChange={e => setBaselineForm(f => ({ ...f, baselineRatingCount: e.target.value }))} /></div>
              <div><Label className="text-xs">Rating评分</Label><Input value={baselineForm.baselineRatingScore} onChange={e => setBaselineForm(f => ({ ...f, baselineRatingScore: e.target.value }))} /></div>
            </div>
            <h4 className="font-medium text-sm pt-2">当期数据</h4>
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs">日均销售额$</Label><Input value={currentForm.currentDailySales} onChange={e => setCurrentForm(f => ({ ...f, currentDailySales: e.target.value }))} /></div>
              <div><Label className="text-xs">日均订单数</Label><Input value={currentForm.currentDailyOrders} onChange={e => setCurrentForm(f => ({ ...f, currentDailyOrders: e.target.value }))} /></div>
              <div><Label className="text-xs">广告转化率%</Label><Input value={currentForm.currentAdConvRate} onChange={e => setCurrentForm(f => ({ ...f, currentAdConvRate: e.target.value }))} /></div>
              <div><Label className="text-xs">行业搜索转化率%</Label><Input value={currentForm.currentIndustrySearchConvRate} onChange={e => setCurrentForm(f => ({ ...f, currentIndustrySearchConvRate: e.target.value }))} /></div>
              <div><Label className="text-xs">搜索转化率%</Label><Input value={currentForm.currentSearchConvRate} onChange={e => setCurrentForm(f => ({ ...f, currentSearchConvRate: e.target.value }))} /></div>
              <div><Label className="text-xs">品类搜索转化率%</Label><Input value={currentForm.currentCategorySearchConvRate} onChange={e => setCurrentForm(f => ({ ...f, currentCategorySearchConvRate: e.target.value }))} /></div>
              <div><Label className="text-xs">平均售价$</Label><Input value={currentForm.currentAvgPrice} onChange={e => setCurrentForm(f => ({ ...f, currentAvgPrice: e.target.value }))} /></div>
              <div><Label className="text-xs">Rating数量</Label><Input value={currentForm.currentRatingCount} onChange={e => setCurrentForm(f => ({ ...f, currentRatingCount: e.target.value }))} /></div>
              <div><Label className="text-xs">Rating评分</Label><Input value={currentForm.currentRatingScore} onChange={e => setCurrentForm(f => ({ ...f, currentRatingScore: e.target.value }))} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditBaseline(false)}>取消</Button>
            <Button onClick={() => {
              updatePlan.mutate({
                planId: activePlanId!,
                ...baselineForm,
                baselineRatingCount: baselineForm.baselineRatingCount ? Number(baselineForm.baselineRatingCount) : undefined,
                ...currentForm,
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
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>编辑季度目标</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>搜索转化率目标 %</Label><Input value={targetForm.targetSearchConvRate} onChange={e => setTargetForm(f => ({ ...f, targetSearchConvRate: e.target.value }))} /></div>
            <div><Label>订单转化率目标 %</Label><Input value={targetForm.targetOrderConvRate} onChange={e => setTargetForm(f => ({ ...f, targetOrderConvRate: e.target.value }))} /></div>
            <div><Label>广告转化率目标 %</Label><Input value={targetForm.targetAdConvRate} onChange={e => setTargetForm(f => ({ ...f, targetAdConvRate: e.target.value }))} /></div>
            <div><Label>核心词相对优势目标 %</Label><Input value={targetForm.targetKeywordAdvantage} onChange={e => setTargetForm(f => ({ ...f, targetKeywordAdvantage: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditTargets(false)}>取消</Button>
            <Button onClick={() => {
              updatePlan.mutate({ planId: activePlanId!, ...targetForm });
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
    setBaselineForm({
      baselineDailySales: activePlan.baselineDailySales || "",
      baselineDailyOrders: activePlan.baselineDailyOrders || "",
      baselineAdConvRate: activePlan.baselineAdConvRate || "",
      baselineIndustrySearchConvRate: activePlan.baselineIndustrySearchConvRate || "",
      baselineSearchConvRate: activePlan.baselineSearchConvRate || "",
      baselineCategorySearchConvRate: activePlan.baselineCategorySearchConvRate || "",
      baselineAvgPrice: activePlan.baselineAvgPrice || "",
      baselineRatingCount: String(activePlan.baselineRatingCount || ""),
      baselineRatingScore: activePlan.baselineRatingScore || "",
    });
    setCurrentForm({
      currentDailySales: activePlan.currentDailySales || "",
      currentDailyOrders: activePlan.currentDailyOrders || "",
      currentAdConvRate: activePlan.currentAdConvRate || "",
      currentIndustrySearchConvRate: activePlan.currentIndustrySearchConvRate || "",
      currentSearchConvRate: activePlan.currentSearchConvRate || "",
      currentCategorySearchConvRate: activePlan.currentCategorySearchConvRate || "",
      currentAvgPrice: activePlan.currentAvgPrice || "",
      currentRatingCount: String(activePlan.currentRatingCount || ""),
      currentRatingScore: activePlan.currentRatingScore || "",
    });
  }

  function loadCurrentForm() {
    loadBaselineForm(); // Same dialog
  }

  function loadTargetForm() {
    if (!activePlan) return;
    setTargetForm({
      targetSearchConvRate: activePlan.targetSearchConvRate || "",
      targetOrderConvRate: activePlan.targetOrderConvRate || "",
      targetAdConvRate: activePlan.targetAdConvRate || "",
      targetKeywordAdvantage: activePlan.targetKeywordAdvantage || "",
    });
  }
}

// ─── Helper Components ───

function DataCell({ label, value, prefix, suffix, compare }: {
  label: string; value: string | null | undefined; prefix?: string; suffix?: string; compare?: string | null;
}) {
  const numVal = value ? parseFloat(value) : null;
  const numComp = compare ? parseFloat(compare) : null;
  const diff = numVal !== null && numComp !== null ? numVal - numComp : null;

  return (
    <div className="p-2 rounded bg-muted/30">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <p className="font-medium">
          {value ? `${prefix || ""}${value}${suffix || ""}` : "—"}
        </p>
        {diff !== null && diff !== 0 && (
          <span className={`text-xs ${diff > 0 ? "text-emerald-600" : "text-red-600"}`}>
            {diff > 0 ? "↑" : "↓"}{Math.abs(diff).toFixed(1)}
          </span>
        )}
      </div>
    </div>
  );
}

function TargetCard({ label, target, current, suffix }: {
  label: string; target: string | null | undefined; current: string | null | undefined; suffix?: string;
}) {
  const targetNum = target ? parseFloat(target) : null;
  const currentNum = current ? parseFloat(current) : null;
  const progress = targetNum && currentNum ? Math.min(100, Math.round(currentNum / targetNum * 100)) : 0;

  return (
    <div className="p-3 rounded-lg border bg-muted/20">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-lg font-bold">{target ? `${target}${suffix || ""}` : "未设定"}</p>
      {targetNum && (
        <div className="mt-2">
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">当前 {current || "—"}{suffix || ""} ({progress}%)</p>
        </div>
      )}
    </div>
  );
}
