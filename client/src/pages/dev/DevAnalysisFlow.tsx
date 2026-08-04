import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useLocation, useParams } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Brain,
  Check,
  Edit3,
  Loader2,
  Lock,
  Unlock,
  Play,
  RefreshCw,
  TrendingUp,
  DollarSign,
  Building2,
  MessageSquare,
  LayoutDashboard,
  Grid3X3,
  Sparkles,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import { WorkflowStepProgress } from "@/components/workflow/WorkflowStepProgress";
import { EmbeddedAgentRunPanel } from "@/components/workflow/EmbeddedAgentRunPanel";
import { DEV_ANALYSIS_WORKFLOW_STEPS } from "@/components/workflow/workflowDefinitions";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ScatterChart, Scatter, ZAxis, LineChart, Line,
} from "recharts";
import { StageFormEditor, StageResultDisplay } from "./analysis";
import { DEV_ANALYSIS_STAGES as STAGES, type DevAnalysisStageKey as StageKey } from "./analysis/stageDefinitions";

/* ─── Status Helpers ─── */
const statusConfig: Record<string, { text: string; color: string }> = {
  pending: { text: "待执行", color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
  running: { text: "分析中", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  generating: { text: "生成中", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  completed: { text: "已生成", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  generated: { text: "已生成", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  editing: { text: "编辑中", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  confirmed: { text: "已确认", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
};

export default function DevAnalysisFlow() {
  const [, setLocation] = useLocation();
  const params = useParams<{ id: string }>();
  const projectId = Number(params.id);
  const [activeStage, setActiveStage] = useState<StageKey>("market_overview");
  const [editingStage, setEditingStage] = useState<StageKey | null>(null);
  const [editText, setEditText] = useState("");
  const [editFormData, setEditFormData] = useState<any>(null);
  const utils = trpc.useUtils();

  // ─── Queries ───
  const { data: project, isLoading: projLoading } = trpc.devProject.getById.useQuery({ id: projectId });
  const { data: stages, isLoading: stagesLoading } = trpc.devAnalysis.getStages.useQuery({ projectId });
  const { data: products } = trpc.devProject.getProducts.useQuery({ projectId });

  // ─── Stage Gating Query ───
  const { data: gating } = trpc.devAnalysis.getStageGating.useQuery({ projectId });

  // ─── Project Tags Query (for cross analysis integration) ───
  const { data: projectTags } = trpc.devAnalysis.getConfirmedProjectTags.useQuery({ projectId });
  const [selectedDim1, setSelectedDim1] = useState<number | undefined>(undefined);
  const [selectedDim2, setSelectedDim2] = useState<number | undefined>(undefined);

  // ─── Stage status map ───
  const stageMap = useMemo(() => {
    const m: Record<string, any> = {};
    if (stages) stages.forEach((s: any) => { m[s.stageType] = s; });
    return m;
  }, [stages]);

  // ─── Mutations ───
  const invalidateAll = () => {
    utils.devAnalysis.getStages.invalidate({ projectId });
    utils.devAnalysis.getStageGating.invalidate({ projectId });
  };
  const marketMutation = trpc.devAnalysis.runMarketOverview.useMutation({
    onSuccess: () => { toast.success("市场大盘分析完成"); invalidateAll(); },
    onError: (e: any) => toast.error(`市场分析失败: ${e.message}`),
  });
  const crossMutation = trpc.devAnalysis.runAttributeCross.useMutation({
    onSuccess: () => { toast.success("属性交叉分析完成"); invalidateAll(); },
    onError: (e: any) => toast.error(`属性交叉分析失败: ${e.message}`),
  });
  const tagCrossMutation = trpc.devAnalysis.runTagCrossAnalysis.useMutation({
    onSuccess: () => { toast.success("标签交叉分析完成"); invalidateAll(); utils.devAnalysis.getConfirmedProjectTags.invalidate({ projectId }); },
    onError: (e: any) => toast.error(`标签交叉分析失败: ${e.message}`),
  });
  const priceMutation = trpc.devAnalysis.runPriceAnalysis.useMutation({
    onSuccess: () => { toast.success("价格段分析完成"); invalidateAll(); },
    onError: (e: any) => toast.error(`价格分析失败: ${e.message}`),
  });
  const brandMutation = trpc.devAnalysis.runBrandCompetition.useMutation({
    onSuccess: () => { toast.success("品牌竞争分析完成"); invalidateAll(); },
    onError: (e: any) => toast.error(`品牌分析失败: ${e.message}`),
  });
  const reviewMutation = trpc.devAnalysis.runReviewKano.useMutation({
    onSuccess: () => { toast.success("评论深度分析完成"); invalidateAll(); },
    onError: (e: any) => toast.error(`评论分析失败: ${e.message}`),
  });
  const informationSummaryMutation = trpc.devAnalysis.runInformationSummary.useMutation({
    onSuccess: () => { toast.success("信息汇总生成完成，请补充并确认关键字段"); invalidateAll(); },
    onError: (e: any) => toast.error(`信息汇总失败: ${e.message}`),
  });
  const dashboardMutation = trpc.devAnalysis.runDecisionDashboard.useMutation({
    onSuccess: () => { toast.success("综合决策看板生成完成"); invalidateAll(); },
    onError: (e: any) => toast.error(`决策看板生成失败: ${e.message}`),
  });
  const confirmMutation = trpc.devAnalysis.confirmStage.useMutation({
    onSuccess: () => { toast.success("阶段已确认锁定"); invalidateAll(); setEditingStage(null); },
    onError: (e: any) => toast.error(`确认失败: ${e.message}`),
  });
  const editMutation = trpc.devAnalysis.editStage.useMutation({
    onSuccess: () => { toast.success("编辑已保存"); utils.devAnalysis.getStages.invalidate({ projectId }); setEditingStage(null); },
    onError: (e: any) => toast.error(`保存失败: ${e.message}`),
  });
  const unlockMutation = trpc.devAnalysis.unlockStage.useMutation({
    onSuccess: () => { toast.success("阶段已解锁，可重新分析或编辑"); invalidateAll(); },
    onError: (e: any) => toast.error(`解锁失败: ${e.message}`),
  });

  const isAnyMutating = marketMutation.isPending || crossMutation.isPending || tagCrossMutation.isPending || priceMutation.isPending || brandMutation.isPending || reviewMutation.isPending || informationSummaryMutation.isPending || dashboardMutation.isPending;

  // ─── Run stage ───
  const runStage = useCallback((key: StageKey) => {
    const input = { projectId };
    switch (key) {
      case "market_overview": marketMutation.mutate(input); break;
      case "attribute_cross": {
        // If project tags are confirmed, use tag cross analysis; otherwise use old cross analysis
        if (projectTags?.status?.allConfirmed && projectTags.categories.length >= 2) {
          tagCrossMutation.mutate({ projectId, dim1CategoryId: selectedDim1, dim2CategoryId: selectedDim2 });
        } else {
          crossMutation.mutate(input);
        }
        break;
      }
      case "price_analysis": priceMutation.mutate(input); break;
      case "brand_competition": brandMutation.mutate(input); break;
      case "review_kano": reviewMutation.mutate(input); break;
      case "information_summary": informationSummaryMutation.mutate(input); break;
      case "decision_dashboard": dashboardMutation.mutate(input); break;
    }
  }, [projectId, marketMutation, crossMutation, tagCrossMutation, priceMutation, brandMutation, reviewMutation, informationSummaryMutation, dashboardMutation, projectTags, selectedDim1, selectedDim2]);

  // ─── Start editing ───
  const startEditing = useCallback((key: StageKey) => {
    const stage = stageMap[key];
    if (!stage) return;
    const result = stage.editedResult || stage.rawResult;
    try {
      const parsed = JSON.parse(result);
      setEditFormData(parsed);
      setEditText(JSON.stringify(parsed, null, 2));
    } catch {
      setEditFormData(null);
      setEditText(result || "");
    }
    setEditingStage(key);
  }, [stageMap]);

  // ─── Navigate stages ───
  const currentIdx = STAGES.findIndex(s => s.key === activeStage);
  const canGoNext = currentIdx < STAGES.length - 1;
  const canGoPrev = currentIdx > 0;
  const analysisCompletedStepIds = useMemo(() => {
    return STAGES
      .filter((stage) => ["completed", "generated", "editing", "confirmed"].includes(stageMap[stage.key]?.status))
      .map((stage) => stage.key);
  }, [stageMap]);
  const analysisLockedStepIds = useMemo(() => {
    return STAGES.filter((stage) => stageMap[stage.key]?.status === "confirmed").map((stage) => stage.key);
  }, [stageMap]);
  const analysisBlockedStepIds = useMemo(() => {
    return STAGES
      .filter((stage) => {
        const status = stageMap[stage.key]?.status || "pending";
        const hasResult = status === "completed" || status === "generated" || status === "editing" || status === "confirmed";
        const stageGating = gating?.[stage.key];
        const isGated = stageGating && !stageGating.canRun && !hasResult;
        return Boolean(isGated);
      })
      .map((stage) => stage.key);
  }, [gating, stageMap]);
  const analysisStepTitleById = useMemo(() => {
    return Object.fromEntries(
      STAGES.map((stage) => {
        const stageGating = gating?.[stage.key];
        const reason = stageGating && !stageGating.canRun ? stageGating.reason || "前置条件未满足" : stage.desc;
        return [stage.key, reason];
      }),
    );
  }, [gating]);

  if (projLoading || stagesLoading) {
    return (
      <div className="max-w-7xl mx-auto space-y-5 p-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
        <Skeleton className="h-[500px]" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="max-w-7xl mx-auto text-center py-20">
        <p className="text-muted-foreground">项目不存在或无权访问</p>
        <Button variant="outline" className="mt-4" onClick={() => setLocation("/dev/projects")}>返回项目列表</Button>
      </div>
    );
  }

  const productCount = products?.length ?? 0;

  return (
    <div className="max-w-7xl mx-auto space-y-5 p-4">
      <EmbeddedAgentRunPanel title="产品分析 Agent Run / Checkpoint" projectId={projectId} />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation(`/dev/project/${projectId}`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              市场分析工作台
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {project.name} · {productCount} 个竞品 · 7阶段数据驱动分析
            </p>
          </div>
        </div>
      </div>

      {/* Stage Progress Bar */}
      <Card>
        <CardContent className="p-3">
          <WorkflowStepProgress
            steps={DEV_ANALYSIS_WORKFLOW_STEPS}
            activeStepId={activeStage}
            completedStepIds={analysisCompletedStepIds}
            lockedStepIds={analysisLockedStepIds}
            blockedStepIds={analysisBlockedStepIds}
            stepTitleById={analysisStepTitleById}
            onStepClick={(stepId) => setActiveStage(stepId as StageKey)}
            compact
          />
        </CardContent>
      </Card>

      {/* Stage Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* Left: Stage Info */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                {(() => { const Icon = STAGES[currentIdx].icon; return <Icon className="h-4 w-4" />; })()}
                {STAGES[currentIdx].label}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">{STAGES[currentIdx].desc}</p>
              <Separator />
              {/* Status */}
              {(() => {
                const stageData = stageMap[activeStage];
                const status = stageData?.status || "pending";
                const sc = statusConfig[status] || statusConfig.pending;
                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">状态</span>
                      <Badge variant="secondary" className={`text-xs ${sc.color}`}>{sc.text}</Badge>
                    </div>
                    {stageData?.confirmedAt && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">确认时间</span>
                        <span className="text-xs">{new Date(stageData.confirmedAt).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                );
              })()}
              <Separator />
              {/* Data Quality & Stage Progress */}
              {(() => {
                const confirmedCount = STAGES.filter(s => stageMap[s.key]?.status === "confirmed").length;
                const completedCount = STAGES.filter(s => ["completed", "generated", "editing", "confirmed"].includes(stageMap[s.key]?.status)).length;
                const productData = products || [];
                const missingFields: string[] = [];
                if (productData.length > 0) {
                  const sample = productData[0] as any;
                  if (!sample.brand) missingFields.push("品牌");
                  if (!sample.monthlySales && !sample.monthSales) missingFields.push("月销量");
                  if (!sample.price) missingFields.push("价格");
                  if (!sample.rating) missingFields.push("评分");
                }
                return (
                  <div className="space-y-2">
                    <p className="text-xs font-medium">分析进度</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${(confirmedCount / STAGES.length) * 100}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground">{confirmedCount}/{STAGES.length}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      已完成 {completedCount} 阶段 · 已确认 {confirmedCount} 阶段
                    </div>
                    {missingFields.length > 0 && (
                      <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-2 rounded-md">
                        ⚠ 数据质量提示: 部分产品缺少{missingFields.join("、")}字段，可能影响分析准确性
                      </div>
                    )}
                  </div>
                );
              })()}
              <Separator />
              {/* Tag Status for Cross Analysis */}
              {activeStage === "attribute_cross" && projectTags && (
                <div className="space-y-2">
                  <p className="text-xs font-medium">项目标签状态</p>
                  {projectTags.status.initialized ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">已确认分类</span>
                        <Badge variant="secondary" className={`text-xs ${projectTags.status.allConfirmed ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"}`}>
                          {projectTags.status.confirmed}/{projectTags.status.total}
                        </Badge>
                      </div>
                      {projectTags.status.allConfirmed && projectTags.categories.length >= 2 ? (
                        <div className="space-y-2">
                          <div className="text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 p-2 rounded-md flex items-center gap-1">
                            <Check className="h-3 w-3" />
                            标签已全部确认，将使用标签体系进行交叉分析
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs text-muted-foreground">维度1</label>
                            <select
                              className="w-full text-xs border rounded-md p-1.5 bg-background"
                              value={selectedDim1 || ""}
                              onChange={(e) => setSelectedDim1(e.target.value ? Number(e.target.value) : undefined)}
                            >
                              <option value="">自动选择</option>
                              {projectTags.categories.map((cat: any) => (
                                <option key={cat.categoryId} value={cat.categoryId}>{cat.categoryName} ({cat.tags.length}个标签)</option>
                              ))}
                            </select>
                            <label className="text-xs text-muted-foreground">维度2</label>
                            <select
                              className="w-full text-xs border rounded-md p-1.5 bg-background"
                              value={selectedDim2 || ""}
                              onChange={(e) => setSelectedDim2(e.target.value ? Number(e.target.value) : undefined)}
                            >
                              <option value="">自动选择</option>
                              {projectTags.categories.map((cat: any) => (
                                <option key={cat.categoryId} value={cat.categoryId}>{cat.categoryName} ({cat.tags.length}个标签)</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-2 rounded-md">
                          {!projectTags.status.allConfirmed
                            ? `还有 ${projectTags.status.total - projectTags.status.confirmed} 个分类未确认，将使用产品级标签进行分析`
                            : "至少需要2个已确认分类才能使用标签交叉分析"
                          }
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded-md">
                      未初始化标签，请先在“标签管理”Tab中初始化并确认标签
                    </div>
                  )}
                  <Separator />
                </div>
              )}
              {/* Actions */}
              <div className="space-y-2">
                {(() => {
                  const stageData = stageMap[activeStage];
                  const status = stageData?.status || "pending";
                  const isRunning = status === "running" || status === "generating";
                  const hasResult = status === "completed" || status === "generated" || status === "editing" || status === "confirmed";
                  const isConfirmed = status === "confirmed";
                  const currentGating = gating?.[activeStage];
                  const isCurrentGated = currentGating && !currentGating.canRun;

                  return (
                    <>
                      {/* Gating Warning */}
                      {isCurrentGated && !hasResult && (
                        <div className="text-xs bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md p-2.5 space-y-1.5">
                          <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400 font-medium">
                            <Lock className="h-3.5 w-3.5" />
                            前置条件未满足
                          </div>
                          <p className="text-amber-600 dark:text-amber-400/80">{currentGating.reason}</p>
                          {currentGating.missingPrereqs && currentGating.missingPrereqs.length > 0 && (
                            <div className="space-y-1 mt-1">
                              <p className="text-amber-600/80 dark:text-amber-400/60">需要先完成：</p>
                              {currentGating.missingPrereqs.map((prereq: string, i: number) => (
                                <div key={i} className="flex items-center gap-1 text-amber-600/80 dark:text-amber-400/60">
                                  <span>•</span>
                                  <span>{prereq}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Run / Re-run */}
                      <Button
                        size="sm"
                        className="w-full gap-2"
                        onClick={() => runStage(activeStage)}
                        disabled={isAnyMutating || isConfirmed || (isCurrentGated && !hasResult)}
                      >
                        {isRunning ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (isCurrentGated && !hasResult) ? (
                          <Lock className="h-3.5 w-3.5" />
                        ) : hasResult ? (
                          <RefreshCw className="h-3.5 w-3.5" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                        {isRunning ? "分析中..." : (isCurrentGated && !hasResult) ? "未解锁" : hasResult ? "重新分析" : "开始分析"}
                      </Button>

                      {/* Edit */}
                      {hasResult && !isConfirmed && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full gap-2"
                          onClick={() => startEditing(activeStage)}
                          disabled={isAnyMutating}
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          编辑结果
                        </Button>
                      )}

                      {/* Confirm */}
                      {hasResult && !isConfirmed && (
                        <Button
                          size="sm"
                          variant="default"
                          className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700"
                          onClick={() => confirmMutation.mutate({ projectId, stageType: activeStage })}
                          disabled={isAnyMutating || confirmMutation.isPending}
                        >
                          {confirmMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          确认锁定
                        </Button>
                      )}

                      {isConfirmed && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 p-2 rounded-md">
                            <Lock className="h-3.5 w-3.5" />
                            <div className="flex-1">
                              <span>此阶段已确认锁定</span>
                              {stageData?.confirmedAt && (
                                <span className="block text-xs text-muted-foreground mt-0.5">
                                  {new Date(stageData.confirmedAt).toLocaleString()}
                                </span>
                              )}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full gap-2 text-amber-600 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-700 dark:hover:bg-amber-900/20"
                            onClick={() => {
                              if (window.confirm("解锁后可重新分析或编辑此阶段结果。\n\n已确认的结果不会丢失，但需要重新确认才能用于综合决策。\n\n确定解锁吗？")) {
                                unlockMutation.mutate({ projectId, stageType: activeStage });
                              }
                            }}
                            disabled={unlockMutation.isPending}
                          >
                            {unlockMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlock className="h-3.5 w-3.5" />}
                            解锁重新分析
                          </Button>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
              <Separator />
              {/* Navigation */}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1 gap-1" disabled={!canGoPrev} onClick={() => setActiveStage(STAGES[currentIdx - 1].key)}>
                  <ArrowLeft className="h-3 w-3" /> 上一步
                </Button>
                <Button size="sm" variant="outline" className="flex-1 gap-1" disabled={!canGoNext} onClick={() => setActiveStage(STAGES[currentIdx + 1].key)}>
                  下一步 <ArrowRight className="h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Result Display */}
        <div className="lg:col-span-3">
          {editingStage === activeStage ? (
            /* ─── Edit Mode ─── */
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Edit3 className="h-4 w-4" />
                    编辑分析结果 — {STAGES[currentIdx].label}
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditingStage(null)}>取消</Button>
                    <Button
                      size="sm"
                      className="gap-1"
                      onClick={() => {
                        const saveText = editFormData ? JSON.stringify(editFormData) : editText;
                        editMutation.mutate({ projectId, stageType: activeStage, editedResult: saveText });
                      }}
                      disabled={editMutation.isPending}
                    >
                      {editMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      保存编辑
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {editFormData ? (
                  <StageFormEditor
                    stageKey={activeStage}
                    data={editFormData}
                    onChange={setEditFormData}
                  />
                ) : (
                  <Textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="min-h-[500px] font-mono text-xs"
                    placeholder="编辑JSON格式的分析结果..."
                  />
                )}
              </CardContent>
            </Card>
          ) : (
            /* ─── Display Mode ─── */
            <StageResultDisplay
              stageKey={activeStage}
              stageData={stageMap[activeStage]}
              productCount={productCount}
              gatingInfo={gating?.[activeStage]}
            />
          )}
        </div>
      </div>
    </div>
  );
}
