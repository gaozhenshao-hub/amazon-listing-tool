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
  CheckCircle2,
  ChevronRight,
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
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ScatterChart, Scatter, ZAxis, LineChart, Line,
} from "recharts";

/* ─── Chart Colors ─── */
const CHART_COLORS = ["#6366f1", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#64748b"];

/* ─── Stage Definition ─── */
const STAGES = [
  { key: "market_overview", label: "市场大盘", icon: TrendingUp, desc: "市场容量、竞争格局、价格分布" },
  { key: "attribute_cross", label: "属性交叉", icon: Grid3X3, desc: "多维属性交叉分析与蓝海识别" },
  { key: "price_analysis", label: "价格段分析", icon: DollarSign, desc: "价格区间分布与利润空间" },
  { key: "brand_competition", label: "品牌竞争", icon: Building2, desc: "品牌市占率与竞争格局" },
  { key: "review_kano", label: "评论深度", icon: MessageSquare, desc: "评论卡洛模型与痛点挖掘" },
  { key: "decision_dashboard", label: "综合决策", icon: LayoutDashboard, desc: "综合看板与立项建议" },
] as const;

type StageKey = typeof STAGES[number]["key"];

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

  const isAnyMutating = marketMutation.isPending || crossMutation.isPending || tagCrossMutation.isPending || priceMutation.isPending || brandMutation.isPending || reviewMutation.isPending || dashboardMutation.isPending;

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
      case "decision_dashboard": dashboardMutation.mutate(input); break;
    }
  }, [projectId, marketMutation, crossMutation, tagCrossMutation, priceMutation, brandMutation, reviewMutation, dashboardMutation, projectTags, selectedDim1, selectedDim2]);

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
          <div className="flex items-center gap-1">
            {STAGES.map((stage, idx) => {
              const stageData = stageMap[stage.key];
              const status = stageData?.status || "pending";
              const isActive = activeStage === stage.key;
              const isConfirmed = status === "confirmed";
              const isCompleted = status === "completed" || status === "generated";
              const isRunning = status === "running" || status === "generating";
              const stageGating = gating?.[stage.key];
              const isGated = stageGating && !stageGating.canRun && status === "pending";
              const Icon = stage.icon;

              return (
                <div key={stage.key} className="flex items-center flex-1">
                  <button
                    onClick={() => setActiveStage(stage.key)}
                    title={isGated ? stageGating?.reason || "前置条件未满足" : stage.desc}
                    className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-all w-full
                      ${isActive ? "bg-primary text-primary-foreground shadow-sm" : ""}
                      ${!isActive && isConfirmed ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400" : ""}
                      ${!isActive && isCompleted ? "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400" : ""}
                      ${!isActive && isRunning ? "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400" : ""}
                      ${!isActive && isGated ? "text-muted-foreground/50 opacity-60" : ""}
                      ${!isActive && !isConfirmed && !isCompleted && !isRunning && !isGated ? "text-muted-foreground hover:bg-muted/50" : ""}
                    `}
                  >
                    {isConfirmed ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    ) : isRunning ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                    ) : isGated ? (
                      <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                    ) : (
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="truncate">{stage.label}</span>
                  </button>
                  {idx < STAGES.length - 1 && (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 mx-0.5" />
                  )}
                </div>
              );
            })}
          </div>
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

/* ─── Stage Result Display Component ─── */
function StageResultDisplay({ stageKey, stageData, productCount, gatingInfo }: { stageKey: StageKey; stageData: any; productCount: number; gatingInfo?: { canRun: boolean; reason?: string | null; missingPrereqs?: string[] | null } }) {
  if (!stageData || stageData.status === "pending") {
    const stage = STAGES.find(s => s.key === stageKey)!;
    const Icon = stage.icon;
    const isGated = gatingInfo && !gatingInfo.canRun;

    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          {isGated ? (
            <>
              <div className="h-16 w-16 rounded-full bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center mb-4">
                <Lock className="h-8 w-8 text-amber-500" />
              </div>
              <p className="text-sm font-semibold text-foreground">{stage.label} — 未解锁</p>
              <p className="text-xs mt-2 text-amber-600 dark:text-amber-400 max-w-md text-center">{gatingInfo.reason}</p>
              {gatingInfo.missingPrereqs && gatingInfo.missingPrereqs.length > 0 && (
                <div className="mt-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 max-w-md w-full">
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-2">需要先完成以下步骤：</p>
                  <div className="space-y-1.5">
                    {gatingInfo.missingPrereqs.map((prereq, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400/80">
                        <div className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                        <span>{prereq}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-xs mt-4 text-muted-foreground">完成前置条件后，此阶段将自动解锁</p>
            </>
          ) : (
            <>
              <Icon className="h-12 w-12 mb-4 opacity-20" />
              <p className="text-sm font-medium">{stage.label}</p>
              <p className="text-xs mt-1">{stage.desc}</p>
              <p className="text-xs mt-3">点击左侧“开始分析”按钮执行此阶段</p>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  if (stageData.status === "running" || stageData.status === "generating") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-20">
          <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
          <p className="text-sm font-medium">正在分析中...</p>
          <p className="text-xs text-muted-foreground mt-1">AI正在处理数据，请稍候</p>
        </CardContent>
      </Card>
    );
  }

  // Parse result
  const resultStr = stageData.editedResult || stageData.rawResult;
  let result: any = null;
  try { result = JSON.parse(resultStr); } catch { result = null; }

  if (!result) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Sparkles className="h-10 w-10 mb-4 opacity-20" />
          <p className="text-sm">暂无分析结果</p>
        </CardContent>
      </Card>
    );
  }

  // Render based on stage type
  switch (stageKey) {
    // attribute_tagging has been moved to a separate tab
    case "market_overview": return <MarketOverviewResult result={result} productCount={productCount} />;
    case "attribute_cross": return <AttributeCrossResult result={result} />;
    case "price_analysis": return <PriceAnalysisResult result={result} />;
    case "brand_competition": return <BrandCompetitionResult result={result} />;
    case "review_kano": return <ReviewKanoResult result={result} />;
    case "decision_dashboard": return <DecisionDashboardResult result={result} />;
    default: return <GenericResult result={result} />;
  }
}

/* ─── 1. Attribute Tagging Result (Removed - now in separate tab) ─── */

/* ─── 2. Market Overview Result ─── */
function MarketOverviewResult({ result, productCount }: { result: any; productCount: number }) {
  const stats = result.stats || {};
  const ai = result.ai || {};

  // Prepare chart data
  const priceChartData = Array.isArray(stats.priceDistribution)
    ? stats.priceDistribution.map((d: any) => ({ range: d.range, count: d.count }))
    : [];
  const monthlyTrendData = Array.isArray(stats.monthlyTrend) ? stats.monthlyTrend : [];
  const scatterData = Array.isArray(stats.priceSalesScatter) ? stats.priceSalesScatter : [];
  const newOld = stats.newVsOldComparison || null;

  // AI field mapping - match the actual AI output fields
  const maturityLevel = ai.maturityLevel;
  const maturityReason = ai.maturityReason;
  const growthTrend = ai.growthTrend;
  const growthRate = ai.growthRate;
  const seasonality = ai.seasonality;
  const marketCapacity = ai.marketCapacity;
  const entryTiming = ai.entryTiming;
  const summary = ai.summary;
  const risks = ai.risks;
  const opportunities = ai.opportunities;

  const maturityColors: Record<string, string> = {
    "新兴": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    "成长": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    "成熟": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    "衰退": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };
  const entryColors: Record<string, string> = {
    "建议进入": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    "谨慎进入": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    "不建议进入": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };

  return (
    <div className="space-y-4">
      {/* Key Metrics - 2 rows x 4 cols */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "竞品数量", value: productCount, suffix: "个" },
          { label: "平均价格", value: stats.avgPrice ? `$${stats.avgPrice.toFixed(2)}` : "--" },
          { label: "价格范围", value: stats.minPrice != null && stats.maxPrice ? `$${stats.minPrice.toFixed(0)}-$${stats.maxPrice.toFixed(0)}` : "--" },
          { label: "平均评分", value: stats.avgRating ? stats.avgRating.toFixed(1) : "--", suffix: " ★" },
          { label: "平均评论数", value: stats.avgReviewCount != null ? Math.round(stats.avgReviewCount).toLocaleString() : "--" },
          { label: "月均销量(中位数)", value: stats.medianMonthlySales != null ? stats.medianMonthlySales.toLocaleString() : "--" },
          { label: "月均销售额(中位数)", value: stats.medianMonthlyRevenue ? `$${Number(stats.medianMonthlyRevenue).toLocaleString()}` : "--" },
          { label: "品牌数量", value: stats.brandCount != null ? stats.brandCount : "--" },
        ].map((m, i) => (
          <Card key={i}>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <p className="text-lg font-bold mt-1">{m.value}{m.suffix && <span className="text-xs font-normal text-muted-foreground">{m.suffix}</span>}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Additional Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "总月销量", value: stats.totalSales != null ? stats.totalSales.toLocaleString() : "--" },
          { label: "总月销售额", value: stats.totalRevenue ? `$${Number(stats.totalRevenue).toLocaleString()}` : "--" },
          { label: "新品占比(12个月内)", value: stats.newProductRatio != null ? `${(stats.newProductRatio * 100).toFixed(1)}%` : "--" },
          { label: "TOP10销量集中度", value: stats.top10SalesShare != null ? `${(stats.top10SalesShare * 100).toFixed(1)}%` : "--" },
        ].map((m, i) => (
          <Card key={i}>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <p className="text-base font-semibold mt-1">{m.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts Row 1: Price Distribution + Monthly Trend */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {priceChartData.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">价格分布</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={priceChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="range" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => [`${v} 个产品`, "数量"]} />
                  <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {monthlyTrendData.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">月度趋势 (销量 & 销售额)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={monthlyTrendData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={50} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar yAxisId="left" dataKey="sales" fill="#06b6d4" name="销量" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="right" dataKey="revenue" fill="#f59e0b" name="销售额($)" radius={[4, 4, 0, 0]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Charts Row 2: Price-Sales Scatter + New vs Old */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {scatterData.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">价格-销量散点图</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <ScatterChart margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis type="number" dataKey="price" name="价格($)" tick={{ fontSize: 11 }} />
                  <YAxis type="number" dataKey="sales" name="月销量" tick={{ fontSize: 11 }} />
                  <ZAxis type="number" dataKey="reviews" range={[20, 400]} name="评论数" />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v: number, name: string) => [name === "价格($)" ? `$${v}` : v.toLocaleString(), name]} />
                  <Scatter data={scatterData} fill="#8b5cf6" fillOpacity={0.6} />
                </ScatterChart>
              </ResponsiveContainer>
              <p className="text-xs text-muted-foreground text-center mt-1">气泡大小 = 评论数量</p>
            </CardContent>
          </Card>
        )}

        {newOld && (newOld.newCount > 0 || newOld.oldCount > 0) && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">新品 vs 老品对比</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { label: "产品数量", newVal: newOld.newCount, oldVal: newOld.oldCount, fmt: (v: number) => `${v}` },
                  { label: "平均月销量", newVal: newOld.newAvgSales, oldVal: newOld.oldAvgSales, fmt: (v: number) => v.toLocaleString() },
                  { label: "平均价格", newVal: newOld.newAvgPrice, oldVal: newOld.oldAvgPrice, fmt: (v: number) => `$${v.toFixed(2)}` },
                  { label: "平均评分", newVal: newOld.newAvgRating, oldVal: newOld.oldAvgRating, fmt: (v: number) => v.toFixed(1) },
                ].map((row, i) => (
                  <div key={i} className="grid grid-cols-3 gap-2 items-center">
                    <div className="text-right">
                      <p className="text-sm font-semibold text-blue-600 dark:text-blue-400">{row.fmt(row.newVal)}</p>
                      {i === 0 && <p className="text-xs text-muted-foreground">新品(12月内)</p>}
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">{row.label}</p>
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-semibold text-gray-600 dark:text-gray-400">{row.fmt(row.oldVal)}</p>
                      {i === 0 && <p className="text-xs text-muted-foreground">老品</p>}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* AI Analysis Structured Cards */}
      {summary && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Brain className="h-4 w-4" />AI市场总结</CardTitle></CardHeader>
          <CardContent><Streamdown>{summary}</Streamdown></CardContent>
        </Card>
      )}

      {/* AI Structured Insights Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Maturity Level */}
        {maturityLevel && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">市场成熟度</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Badge className={`text-sm ${maturityColors[maturityLevel] || "bg-gray-100 text-gray-700"}`}>{maturityLevel}</Badge>
              {maturityReason && <p className="text-xs text-muted-foreground">{maturityReason}</p>}
            </CardContent>
          </Card>
        )}

        {/* Growth Trend */}
        {growthTrend && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">增长趋势</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm font-semibold">{growthTrend}</p>
              {growthRate && <p className="text-xs text-muted-foreground">预估年增长率: {growthRate}</p>}
            </CardContent>
          </Card>
        )}

        {/* Seasonality */}
        {seasonality && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">季节性特征</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Badge variant="secondary" className="text-xs">{seasonality.hasSeasonality ? "有季节性" : "无明显季节性"}</Badge>
              {seasonality.peakMonths?.length > 0 && <p className="text-xs"><span className="text-muted-foreground">旺季: </span><span className="font-medium text-emerald-600 dark:text-emerald-400">{seasonality.peakMonths.join(", ")}</span></p>}
              {seasonality.lowMonths?.length > 0 && <p className="text-xs"><span className="text-muted-foreground">淡季: </span><span className="font-medium text-red-600 dark:text-red-400">{seasonality.lowMonths.join(", ")}</span></p>}
              {seasonality.description && <p className="text-xs text-muted-foreground">{seasonality.description}</p>}
            </CardContent>
          </Card>
        )}

        {/* Market Capacity */}
        {marketCapacity && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">市场容量</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Badge variant="secondary" className="text-xs">规模: {marketCapacity.level}</Badge>
              {marketCapacity.monthlyRevenue && <p className="text-xs"><span className="text-muted-foreground">月均销售额: </span>{marketCapacity.monthlyRevenue}</p>}
              {marketCapacity.potential && <p className="text-xs"><span className="text-muted-foreground">增长潜力: </span>{marketCapacity.potential}</p>}
            </CardContent>
          </Card>
        )}

        {/* Entry Timing */}
        {entryTiming && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">进入时机</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Badge className={`text-sm ${entryColors[entryTiming.recommendation] || "bg-gray-100 text-gray-700"}`}>{entryTiming.recommendation}</Badge>
              {entryTiming.bestEntryTime && <p className="text-xs"><span className="text-muted-foreground">最佳时机: </span>{entryTiming.bestEntryTime}</p>}
              {entryTiming.reason && <p className="text-xs text-muted-foreground">{entryTiming.reason}</p>}
            </CardContent>
          </Card>
        )}

        {/* FBA Ratio */}
        {stats.fbaRatio != null && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">FBA占比</CardTitle></CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{(stats.fbaRatio * 100).toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground mt-1">使用亚马逊FBA配送</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Risks & Opportunities */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.isArray(risks) && risks.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-red-600 dark:text-red-400">风险提示</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-1.5">
                {risks.map((r: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span className="text-red-500 mt-0.5">●</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
        {Array.isArray(opportunities) && opportunities.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-emerald-600 dark:text-emerald-400">市场机会</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-1.5">
                {opportunities.map((o: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span className="text-emerald-500 mt-0.5">●</span>
                    <span>{o}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ─── 3. Attribute Cross Result ─── */
function AttributeCrossResult({ result }: { result: any }) {
  const singleDimStats = result.singleDimStats || {};
  const crossResult = result.crossResult || {};
  const dimensionNames = result.dimensionNames || [];
  const ai = result.ai || {};

  // Build heatmap data from cross matrix
  const heatmapEntries: Array<{ combo: string; count: number; avgSales: number; avgPrice: number }> = [];
  Object.entries(crossResult).forEach(([, matrix]: any) => {
    Object.entries(matrix).forEach(([combo, data]: any) => {
      heatmapEntries.push({ combo, count: data.count || 0, avgSales: data.avgMonthlySales || 0, avgPrice: data.avgPrice || 0 });
    });
  });
  const topCombos = heatmapEntries.sort((a, b) => b.avgSales - a.avgSales).slice(0, 15);

  return (
    <div className="space-y-4">
      {/* Single Dimension Stats with Bar Charts */}
      {dimensionNames.length > 0 && dimensionNames.map((dim: string) => {
        const dimData = singleDimStats[dim] || {};
        const entries = Object.entries(dimData).sort((a: any, b: any) => (b[1]?.count || 0) - (a[1]?.count || 0));
        if (entries.length === 0) return null;
        const chartData = entries.map(([val, data]: any) => ({ name: val, count: data.count, avgPrice: data.avgPrice, avgSales: data.avgMonthlySales || 0 }));
        return (
          <Card key={dim}>
            <CardHeader className="pb-2"><CardTitle className="text-sm">{dim} 分布</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={50} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#6366f1" name="产品数" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-1.5 font-medium">属性值</th>
                        <th className="text-right p-1.5 font-medium">产品数</th>
                        <th className="text-right p-1.5 font-medium">占比</th>
                        <th className="text-right p-1.5 font-medium">均价</th>
                        <th className="text-right p-1.5 font-medium">均评分</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map(([val, data]: any) => (
                        <tr key={val} className="border-b last:border-0">
                          <td className="p-1.5 font-medium">{val}</td>
                          <td className="p-1.5 text-right">{data.count}</td>
                          <td className="p-1.5 text-right">{data.pct}%</td>
                          <td className="p-1.5 text-right">${data.avgPrice?.toFixed(2) ?? "--"}</td>
                          <td className="p-1.5 text-right">{data.avgRating?.toFixed(1) ?? "--"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* Cross Matrix Heatmap-style */}
      {topCombos.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Grid3X3 className="h-4 w-4" />属性交叉热力图 (TOP15 按月销排序)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={topCombos} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="combo" tick={{ fontSize: 9 }} width={120} />
                <Tooltip />
                <Bar dataKey="avgSales" fill="#10b981" name="均月销" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Full Cross Matrix Table */}
      {Object.keys(crossResult).length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">属性交叉矩阵详表</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Object.entries(crossResult).map(([crossKey, matrix]: any) => {
                const cells = Object.entries(matrix).sort((a: any, b: any) => (b[1]?.count || 0) - (a[1]?.count || 0));
                if (cells.length === 0) return null;
                return (
                  <div key={crossKey}>
                    <p className="text-xs font-semibold mb-2">{crossKey.replace("×", " × ")}</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="text-left p-2 font-medium">组合</th>
                            <th className="text-right p-2 font-medium">产品数</th>
                            <th className="text-right p-2 font-medium">均价</th>
                            <th className="text-right p-2 font-medium">均评分</th>
                            <th className="text-right p-2 font-medium">均评论</th>
                            <th className="text-right p-2 font-medium">均月销</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cells.slice(0, 20).map(([combo, data]: any) => (
                            <tr key={combo} className="border-b last:border-0">
                              <td className="p-2 font-medium">{combo}</td>
                              <td className="p-2 text-right">{data.count}</td>
                              <td className="p-2 text-right">${data.avgPrice?.toFixed(2) ?? "--"}</td>
                              <td className="p-2 text-right">{data.avgRating?.toFixed(1) ?? "--"}</td>
                              <td className="p-2 text-right">{data.avgReviews ?? "--"}</td>
                              <td className="p-2 text-right">{data.avgMonthlySales ?? "--"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Insights - Matched to actual AI output fields */}
      {ai.summary && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Brain className="h-4 w-4" />AI属性分析总结</CardTitle></CardHeader>
          <CardContent><Streamdown>{ai.summary}</Streamdown></CardContent>
        </Card>
      )}

      {/* Mainstream Products */}
      {Array.isArray(ai.mainstreamProducts) && ai.mainstreamProducts.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">主流产品形态</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {ai.mainstreamProducts.map((p: any, i: number) => (
                <div key={i} className="flex items-start gap-3 p-2.5 bg-muted/30 rounded-lg">
                  <Badge variant="secondary" className="text-xs shrink-0 mt-0.5">#{i + 1}</Badge>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{p.combo}</p>
                    {p.salesShare && <p className="text-xs text-muted-foreground mt-0.5">销额占比: {p.salesShare}</p>}
                    {p.reason && <p className="text-xs text-muted-foreground">{p.reason}</p>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recommended Directions */}
      {Array.isArray(ai.recommendedDirections) && ai.recommendedDirections.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4" />推荐产品方向</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {ai.recommendedDirections.map((d: any, i: number) => (
                <div key={i} className="p-3 border rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">{d.direction}</p>
                    {d.priority && <Badge className="text-xs bg-primary/10 text-primary">优先级 {d.priority}</Badge>}
                  </div>
                  {d.attributes && (
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(d.attributes).map(([k, v]: any) => (
                        <Badge key={k} variant="outline" className="text-xs">{k}: {v}</Badge>
                      ))}
                    </div>
                  )}
                  {d.estimatedPriceRange && <p className="text-xs"><span className="text-muted-foreground">估计价格: </span>{d.estimatedPriceRange}</p>}
                  {d.targetAudience && <p className="text-xs"><span className="text-muted-foreground">目标用户: </span>{d.targetAudience}</p>}
                  {d.reason && <p className="text-xs text-muted-foreground">{d.reason}</p>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Differentiation Opportunities */}
      {Array.isArray(ai.differentiationOpportunities) && ai.differentiationOpportunities.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-emerald-600 dark:text-emerald-400">差异化机会</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {ai.differentiationOpportunities.map((o: any, i: number) => (
                <div key={i} className="flex items-start gap-3 p-2 bg-emerald-50 dark:bg-emerald-900/10 rounded-lg">
                  <span className="text-emerald-500 mt-0.5">●</span>
                  <div>
                    <p className="text-sm font-medium">{o.combo}</p>
                    <div className="flex gap-2 mt-1">
                      {o.competitionLevel && <Badge variant="outline" className="text-xs">竞争: {o.competitionLevel}</Badge>}
                      {o.potential && <Badge variant="outline" className="text-xs">潜力: {o.potential}</Badge>}
                    </div>
                    {o.reason && <p className="text-xs text-muted-foreground mt-1">{o.reason}</p>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Red Ocean Warnings */}
      {Array.isArray(ai.redOceanWarnings) && ai.redOceanWarnings.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-red-600 dark:text-red-400">红海警告</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {ai.redOceanWarnings.map((w: any, i: number) => (
                <div key={i} className="flex items-start gap-3 p-2 bg-red-50 dark:bg-red-900/10 rounded-lg">
                  <span className="text-red-500 mt-0.5">●</span>
                  <div>
                    <p className="text-sm font-medium">{w.combo}</p>
                    {w.reason && <p className="text-xs text-muted-foreground mt-1">{w.reason}</p>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─── 4. Price Analysis Result ─── */
function PriceAnalysisResult({ result }: { result: any }) {
  const segments = result.priceSegments || [];
  const ai = result.ai || {};

  const segChartData = segments.map((s: any) => ({
    range: s.range,
    count: s.count || 0,
    avgPrice: s.avgPrice || 0,
    avgMonthlySales: s.avgMonthlySales || 0,
    avgMonthlyRevenue: s.avgMonthlyRevenue || 0,
  }));

  return (
    <div className="space-y-4">
      {/* Charts */}
      {segChartData.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">价格段产品分布</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={segChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="range" tick={{ fontSize: 10 }} angle={-15} textAnchor="end" height={45} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#10b981" name="产品数" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">价格段月均销量</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={segChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="range" tick={{ fontSize: 10 }} angle={-15} textAnchor="end" height={45} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="avgMonthlySales" fill="#f59e0b" name="均月销" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><DollarSign className="h-4 w-4" />价格段详表</CardTitle></CardHeader>
        <CardContent>
          {segments.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 font-medium">价格段</th>
                    <th className="text-right p-2 font-medium">产品数</th>
                    <th className="text-right p-2 font-medium">占比</th>
                    <th className="text-right p-2 font-medium">均价</th>
                    <th className="text-right p-2 font-medium">均评分</th>
                    <th className="text-right p-2 font-medium">均评论</th>
                    <th className="text-right p-2 font-medium">均月销</th>
                    <th className="text-right p-2 font-medium">均月销售额</th>
                  </tr>
                </thead>
                <tbody>
                  {segments.map((seg: any, i: number) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="p-2 font-medium">{seg.range}</td>
                      <td className="p-2 text-right">{seg.count}</td>
                      <td className="p-2 text-right">{seg.pct}%</td>
                      <td className="p-2 text-right">${seg.avgPrice?.toFixed(2) ?? "--"}</td>
                      <td className="p-2 text-right">{seg.avgRating?.toFixed(1) ?? "--"}</td>
                      <td className="p-2 text-right">{seg.avgReviews ?? "--"}</td>
                      <td className="p-2 text-right">{seg.avgMonthlySales ?? "--"}</td>
                      <td className="p-2 text-right">{seg.avgMonthlyRevenue ? `$${Number(seg.avgMonthlyRevenue).toLocaleString()}` : "--"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">暂无价格段数据</p>
          )}
        </CardContent>
      </Card>

      {/* AI Summary */}
      {ai.summary && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Brain className="h-4 w-4" />AI价格分析总结</CardTitle></CardHeader>
          <CardContent><Streamdown>{ai.summary}</Streamdown></CardContent>
        </Card>
      )}

      {/* Best Price Range + Pricing Strategy */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {ai.bestPriceRange && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">最佳价格区间</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xl font-bold text-primary">${ai.bestPriceRange.min} - ${ai.bestPriceRange.max}</p>
              {ai.bestPriceRange.reason && <p className="text-xs text-muted-foreground">{ai.bestPriceRange.reason}</p>}
            </CardContent>
          </Card>
        )}
        {ai.pricingStrategy && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">定价策略建议</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Badge className="text-sm">{ai.pricingStrategy.type}</Badge>
              {ai.pricingStrategy.suggestedPrice && (
                <p className="text-sm font-semibold">建议售价: ${ai.pricingStrategy.suggestedPrice.min} - ${ai.pricingStrategy.suggestedPrice.max}</p>
              )}
              {ai.pricingStrategy.reason && <p className="text-xs text-muted-foreground">{ai.pricingStrategy.reason}</p>}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Price-Rating Correlation */}
      {ai.priceRatingCorrelation && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">价格与评分关系</CardTitle></CardHeader>
          <CardContent><p className="text-sm">{ai.priceRatingCorrelation}</p></CardContent>
        </Card>
      )}

      {/* Price Insights */}
      {Array.isArray(ai.priceInsights) && ai.priceInsights.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">价格洞察</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {ai.priceInsights.map((ins: any, i: number) => (
                <div key={i} className="flex items-start gap-3 p-2.5 bg-muted/30 rounded-lg">
                  <span className="text-xs font-mono text-muted-foreground mt-0.5">{i + 1}</span>
                  <div>
                    <p className="text-sm font-medium">{ins.insight}</p>
                    {ins.implication && <p className="text-xs text-muted-foreground mt-1">{ins.implication}</p>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─── 5. Brand Competition Result ─── */
function BrandCompetitionResult({ result }: { result: any }) {
  // Fix: data is stored as { brandStats: { brands, cr3, cr5, cr10, ... }, ai: {...} }
  const brandStats = result.brandStats || {};
  const brands = brandStats.brands || result.brands || [];
  const ai = result.ai || {};

  const top10 = brands.slice(0, 10);
  const pieData = top10.map((b: any) => ({ name: b.brand, value: b.revenueShare ? parseFloat((b.revenueShare * 100).toFixed(1)) : 0 }));
  const salesData = top10.map((b: any) => ({ brand: b.brand?.slice(0, 12), sales: b.totalSales || 0, revenue: b.totalRevenue || 0 }));

  return (
    <div className="space-y-4">
      {/* Concentration Metrics */}
      {(brandStats.cr3 || brandStats.cr5 || brandStats.cr10) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">CR3 集中度</p>
            <p className="text-2xl font-bold">{brandStats.cr3 ? `${(brandStats.cr3 * 100).toFixed(1)}%` : "--"}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">CR5 集中度</p>
            <p className="text-2xl font-bold">{brandStats.cr5 ? `${(brandStats.cr5 * 100).toFixed(1)}%` : "--"}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">CR10 集中度</p>
            <p className="text-2xl font-bold">{brandStats.cr10 ? `${(brandStats.cr10 * 100).toFixed(1)}%` : "--"}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">中国卖家份额</p>
            <p className="text-2xl font-bold">{brandStats.chinaSellerShare != null ? `${(brandStats.chinaSellerShare * 100).toFixed(1)}%` : "--"}</p>
          </CardContent></Card>
        </div>
      )}

      {/* Charts */}
      {top10.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">品牌市占率分布</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={85} paddingAngle={2} dataKey="value" label={({ name, percent }) => `${name?.slice(0, 8)} ${(percent * 100).toFixed(0)}%`}>
                    {pieData.map((_: any, idx: number) => <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => [`${v}%`, "市占率"]} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">品牌月销量对比</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={salesData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="brand" tick={{ fontSize: 10 }} angle={-25} textAnchor="end" height={55} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="sales" fill="#06b6d4" name="月销量" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Brand Monthly Trend */}
      {Array.isArray(brandStats.brandMonthlyTrend) && brandStats.brandMonthlyTrend.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">品牌月度趋势</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={brandStats.brandMonthlyTrend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                {top10.slice(0, 5).map((b: any, idx: number) => (
                  <Line key={b.brand} type="monotone" dataKey={`brands.${b.brand}`} name={b.brand?.slice(0, 10)} stroke={CHART_COLORS[idx % CHART_COLORS.length]} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Building2 className="h-4 w-4" />品牌竞争格局详表</CardTitle></CardHeader>
        <CardContent>
          {brands.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 font-medium">品牌</th>
                    <th className="text-right p-2 font-medium">ASIN数</th>
                    <th className="text-right p-2 font-medium">销量占比</th>
                    <th className="text-right p-2 font-medium">销额占比</th>
                    <th className="text-right p-2 font-medium">均价</th>
                    <th className="text-right p-2 font-medium">均评分</th>
                    <th className="text-right p-2 font-medium">总月销</th>
                    <th className="text-right p-2 font-medium">总月销售额</th>
                  </tr>
                </thead>
                <tbody>
                  {brands.map((b: any, i: number) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="p-2 font-medium">{b.brand}</td>
                      <td className="p-2 text-right">{b.asinCount}</td>
                      <td className="p-2 text-right">{b.salesShare ? `${(b.salesShare * 100).toFixed(1)}%` : "--"}</td>
                      <td className="p-2 text-right">{b.revenueShare ? `${(b.revenueShare * 100).toFixed(1)}%` : "--"}</td>
                      <td className="p-2 text-right">${b.avgPrice?.toFixed(2) ?? "--"}</td>
                      <td className="p-2 text-right">{b.avgRating?.toFixed(1) ?? "--"}</td>
                      <td className="p-2 text-right">{b.totalSales?.toLocaleString() ?? "--"}</td>
                      <td className="p-2 text-right">{b.totalRevenue ? `$${Number(b.totalRevenue).toLocaleString()}` : "--"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">暂无品牌数据</p>
          )}
        </CardContent>
      </Card>

      {/* AI Summary */}
      {ai.summary && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Brain className="h-4 w-4" />AI品牌竞争分析总结</CardTitle></CardHeader>
          <CardContent><Streamdown>{ai.summary}</Streamdown></CardContent>
        </Card>
      )}

      {/* Competition Pattern */}
      {ai.competitionPattern && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">竞争格局判断</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Badge className="text-sm">{ai.competitionPattern}</Badge>
            {ai.competitionPatternReason && <p className="text-sm text-muted-foreground">{ai.competitionPatternReason}</p>}
          </CardContent>
        </Card>
      )}

      {/* Top Brand Strategies */}
      {Array.isArray(ai.topBrandStrategies) && ai.topBrandStrategies.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">头部品牌策略分析</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {ai.topBrandStrategies.map((b: any, i: number) => (
                <div key={i} className="p-3 border rounded-lg space-y-2">
                  <p className="text-sm font-semibold">{b.brand}</p>
                  {b.strategy && <p className="text-xs">{b.strategy}</p>}
                  <div className="grid grid-cols-2 gap-2">
                    {Array.isArray(b.strengths) && b.strengths.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">优势</p>
                        {b.strengths.map((s: string, j: number) => <p key={j} className="text-xs text-muted-foreground">• {s}</p>)}
                      </div>
                    )}
                    {Array.isArray(b.weaknesses) && b.weaknesses.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-red-600 dark:text-red-400">劣势</p>
                        {b.weaknesses.map((w: string, j: number) => <p key={j} className="text-xs text-muted-foreground">• {w}</p>)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Entry Strategy */}
      {ai.entryStrategy && typeof ai.entryStrategy === "object" && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4" />新品牌进入策略</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {ai.entryStrategy.approach && <p className="text-sm font-semibold">{ai.entryStrategy.approach}</p>}
            {ai.entryStrategy.targetSegment && <p className="text-xs"><span className="text-muted-foreground">目标细分: </span>{ai.entryStrategy.targetSegment}</p>}
            {ai.entryStrategy.differentiationPoint && <p className="text-xs"><span className="text-muted-foreground">差异化切入点: </span>{ai.entryStrategy.differentiationPoint}</p>}
            {ai.entryStrategy.estimatedInvestment && <p className="text-xs"><span className="text-muted-foreground">预估投入: </span>{ai.entryStrategy.estimatedInvestment}</p>}
            {ai.entryStrategy.reason && <p className="text-xs text-muted-foreground mt-1">{ai.entryStrategy.reason}</p>}
          </CardContent>
        </Card>
      )}

      {/* China Seller Analysis */}
      {ai.chinaSellerAnalysis && typeof ai.chinaSellerAnalysis === "object" && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">中国卖家分析</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {ai.chinaSellerAnalysis.share && <p className="text-sm"><span className="text-muted-foreground">份额: </span>{ai.chinaSellerAnalysis.share}</p>}
            {ai.chinaSellerAnalysis.trend && <p className="text-sm"><span className="text-muted-foreground">趋势: </span>{ai.chinaSellerAnalysis.trend}</p>}
            {ai.chinaSellerAnalysis.implication && <p className="text-sm"><span className="text-muted-foreground">影响: </span>{ai.chinaSellerAnalysis.implication}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─── 6. Review Kano Result ─── */
function ReviewKanoResult({ result }: { result: any }) {
  const stats = result.stats || {};
  const ai = result.ai || {};
  // AI output: { kanoAnalysis: { painPoints, itchPoints, wowPoints }, overallSentiment, productImprovementPriority, summary }
  const kano = ai.kanoAnalysis || {};

  const categories = [
    { key: "painPoints", label: "痛点 (Must-be)", desc: "基本需求，缺失会导致强烈不满", color: "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400", icon: "⚠️" },
    { key: "itchPoints", label: "疒点 (One-dimensional)", desc: "期望需求，满足度与满意度线性相关", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400", icon: "💡" },
    { key: "wowPoints", label: "爽点 (Attractive)", desc: "兴奋需求，有则大幅提升满意度", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400", icon: "✨" },
  ];

  // Rating distribution chart data
  const ratingDist = stats.ratingDistribution || [];

  return (
    <div className="space-y-4">
      {/* Review Stats Overview */}
      {stats.totalReviews > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">总评论数</p>
            <p className="text-2xl font-bold">{stats.totalReviews?.toLocaleString()}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">平均评分</p>
            <p className="text-2xl font-bold">{stats.avgRating?.toFixed(1)} ⭐</p>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">VP评论占比</p>
            <p className="text-2xl font-bold">{stats.vpRatio ? `${(stats.vpRatio * 100).toFixed(0)}%` : "--"}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">带图/视频占比</p>
            <p className="text-2xl font-bold">{stats.withImageRatio ? `${((stats.withImageRatio + (stats.withVideoRatio || 0)) * 100).toFixed(0)}%` : "--"}</p>
          </CardContent></Card>
        </div>
      )}

      {/* Rating Distribution + Monthly Trend */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {ratingDist.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">评分分布</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={ratingDist} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="stars" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v}★`} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => [v, "评论数"]} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {ratingDist.map((_: any, idx: number) => {
                      const colors = ["#ef4444", "#f97316", "#eab308", "#84cc16", "#22c55e"];
                      return <Cell key={idx} fill={colors[idx] || "#6366f1"} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
        {Array.isArray(stats.monthlyReviewTrend) && stats.monthlyReviewTrend.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">评论月度趋势</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={stats.monthlyReviewTrend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" domain={[1, 5]} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="left" dataKey="count" fill="#6366f1" name="评论数" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="avgRating" stroke="#f59e0b" name="均评分" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {/* AI Summary */}
      {ai.summary && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Brain className="h-4 w-4" />AI评论分析总结</CardTitle></CardHeader>
          <CardContent><Streamdown>{ai.summary}</Streamdown></CardContent>
        </Card>
      )}

      {/* Overall Sentiment */}
      {ai.overallSentiment && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">情感分布</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center p-2 bg-emerald-50 dark:bg-emerald-900/10 rounded-lg">
                <p className="text-xs text-muted-foreground">正面</p>
                <p className="text-sm font-semibold text-emerald-600">{ai.overallSentiment.positive}</p>
              </div>
              <div className="text-center p-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                <p className="text-xs text-muted-foreground">中性</p>
                <p className="text-sm font-semibold">{ai.overallSentiment.neutral}</p>
              </div>
              <div className="text-center p-2 bg-red-50 dark:bg-red-900/10 rounded-lg">
                <p className="text-xs text-muted-foreground">负面</p>
                <p className="text-sm font-semibold text-red-600">{ai.overallSentiment.negative}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* KANO Categories - Matched to actual AI output */}
      {categories.map(cat => {
        const items = kano[cat.key] || [];
        if (items.length === 0) return null;
        return (
          <Card key={cat.key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Badge className={`text-xs ${cat.color}`}>{cat.label}</Badge>
                <span className="text-xs text-muted-foreground font-normal">{cat.desc}</span>
                <Badge variant="outline" className="text-xs ml-auto">{items.length} 项</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {items.map((item: any, i: number) => (
                  <div key={i} className="p-3 bg-muted/30 rounded-lg space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">{item.theme || item.feature || item.name}</p>
                      <div className="flex gap-1.5">
                        {item.frequency && <Badge variant="outline" className="text-xs">频率: {item.frequency}</Badge>}
                        {item.severity && <Badge variant="outline" className="text-xs">严重度: {item.severity}/5</Badge>}
                        {item.priority && <Badge variant="outline" className="text-xs">优先级: {item.priority}/5</Badge>}
                        {item.desireLevel && <Badge variant="outline" className="text-xs">渴望度: {item.desireLevel}/5</Badge>}
                        {item.impactLevel && <Badge variant="outline" className="text-xs">影响力: {item.impactLevel}/5</Badge>}
                      </div>
                    </div>
                    {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                    {item.improvementSuggestion && <p className="text-xs"><span className="font-medium">改进建议: </span>{item.improvementSuggestion}</p>}
                    {item.implementationSuggestion && <p className="text-xs"><span className="font-medium">实现建议: </span>{item.implementationSuggestion}</p>}
                    {Array.isArray(item.representativeReviews) && item.representativeReviews.length > 0 && (
                      <div className="mt-1">
                        <p className="text-xs font-medium text-muted-foreground">代表性评论:</p>
                        {item.representativeReviews.map((r: string, j: number) => (
                          <p key={j} className="text-xs text-muted-foreground italic ml-2">“{r}”</p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* Product Improvement Priority */}
      {Array.isArray(ai.productImprovementPriority) && ai.productImprovementPriority.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4" />产品改进优先级</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 font-medium">优先级</th>
                    <th className="text-left p-2 font-medium">改进领域</th>
                    <th className="text-left p-2 font-medium">预期效果</th>
                    <th className="text-center p-2 font-medium">难度</th>
                  </tr>
                </thead>
                <tbody>
                  {ai.productImprovementPriority.map((item: any, i: number) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="p-2"><Badge variant="outline" className="text-xs">P{item.priority}</Badge></td>
                      <td className="p-2 font-medium">{item.area}</td>
                      <td className="p-2 text-muted-foreground">{item.expectedImpact}</td>
                      <td className="p-2 text-center">
                        <Badge className={`text-xs ${item.difficulty === "高" ? "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400" : item.difficulty === "中" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"}`}>{item.difficulty}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─── 7. Decision Dashboard Result ─── */
function DecisionDashboardResult({ result }: { result: any }) {
  // AI output: { ai: { feasibilityScore, productPositioning, swotAnalysis, launchPlan, risks, summary } }
  const ai = result.ai || {};
  const feasibility = ai.feasibilityScore || {};
  const dims = Array.isArray(feasibility.dimensions) ? feasibility.dimensions : [];
  const radarData = dims.map((d: any) => ({ subject: d.name, score: d.score ?? 0, fullMark: 10 }));

  return (
    <div className="space-y-4">
      {/* Overall Score + Recommendation */}
      {feasibility.overall !== undefined && (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-sm text-muted-foreground">综合可行性评分</p>
            <p className="text-5xl font-bold mt-2 text-primary">{feasibility.overall}</p>
            <p className="text-xs text-muted-foreground mt-1">/ 10</p>
            {feasibility.recommendation && (
              <Badge className={`mt-3 text-sm ${
                feasibility.recommendation === "强烈推荐" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" :
                feasibility.recommendation === "推荐" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
                feasibility.recommendation === "谨慎推荐" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
              }`}>
                {feasibility.recommendation}
              </Badge>
            )}
          </CardContent>
        </Card>
      )}

      {/* Dimension Scores with Radar Chart */}
      {dims.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">维度评分雷达图</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <RadarChart data={radarData}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 10]} tick={{ fontSize: 10 }} />
                  <Radar name="评分" dataKey="score" stroke="#6366f1" fill="#6366f1" fillOpacity={0.3} />
                  <Tooltip />
                </RadarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">维度评分详情</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {dims.map((dim: any, i: number) => {
                  const score = dim.score ?? 0;
                  const pct = (score / 10) * 100;
                  const color = score >= 7 ? "bg-emerald-500" : score >= 5 ? "bg-amber-500" : "bg-red-500";
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">{dim.name}</span>
                        <span className="text-xs font-bold">{score}/10</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                      {dim.reason && <p className="text-xs text-muted-foreground mt-0.5">{dim.reason}</p>}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* AI Summary */}
      {ai.summary && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Brain className="h-4 w-4" />AI综合决策总结</CardTitle></CardHeader>
          <CardContent><Streamdown>{ai.summary}</Streamdown></CardContent>
        </Card>
      )}

      {/* Product Positioning */}
      {ai.productPositioning && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4" />推荐产品定位</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {ai.productPositioning.targetAttributes && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">目标属性组合</p>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(ai.productPositioning.targetAttributes).map(([k, v]: any) => (
                    <Badge key={k} variant="outline" className="text-xs">{k}: {v}</Badge>
                  ))}
                </div>
              </div>
            )}
            {ai.productPositioning.priceRange && (
              <p className="text-sm"><span className="text-muted-foreground">价格区间: </span><span className="font-semibold">${ai.productPositioning.priceRange.min} - ${ai.productPositioning.priceRange.max}</span></p>
            )}
            {ai.productPositioning.differentiationDirection && (
              <p className="text-sm"><span className="text-muted-foreground">差异化方向: </span>{ai.productPositioning.differentiationDirection}</p>
            )}
            {ai.productPositioning.targetAudience && (
              <p className="text-sm"><span className="text-muted-foreground">目标用户: </span>{ai.productPositioning.targetAudience}</p>
            )}
            {Array.isArray(ai.productPositioning.uniqueSellingPoints) && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">USP 售卖点</p>
                {ai.productPositioning.uniqueSellingPoints.map((usp: string, i: number) => (
                  <p key={i} className="text-sm">• {usp}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* SWOT Analysis */}
      {Array.isArray(ai.swotAnalysis) && ai.swotAnalysis.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">对标竞品 SWOT 分析</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-4">
              {ai.swotAnalysis.map((swot: any, i: number) => (
                <div key={i} className="border rounded-lg p-3">
                  <p className="text-sm font-semibold mb-2">{swot.competitor}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-emerald-50 dark:bg-emerald-900/10 p-2 rounded">
                      <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400 mb-1">Strengths 优势</p>
                      {Array.isArray(swot.strengths) && swot.strengths.map((s: string, j: number) => <p key={j} className="text-xs">• {s}</p>)}
                    </div>
                    <div className="bg-red-50 dark:bg-red-900/10 p-2 rounded">
                      <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-1">Weaknesses 劣势</p>
                      {Array.isArray(swot.weaknesses) && swot.weaknesses.map((w: string, j: number) => <p key={j} className="text-xs">• {w}</p>)}
                    </div>
                    <div className="bg-blue-50 dark:bg-blue-900/10 p-2 rounded">
                      <p className="text-xs font-medium text-blue-700 dark:text-blue-400 mb-1">Opportunities 机会</p>
                      {Array.isArray(swot.opportunities) && swot.opportunities.map((o: string, j: number) => <p key={j} className="text-xs">• {o}</p>)}
                    </div>
                    <div className="bg-amber-50 dark:bg-amber-900/10 p-2 rounded">
                      <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1">Threats 威胁</p>
                      {Array.isArray(swot.threats) && swot.threats.map((t: string, j: number) => <p key={j} className="text-xs">• {t}</p>)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Launch Plan */}
      {ai.launchPlan && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">产品上新计划</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {ai.launchPlan.targetPrice && (
                <div className="text-center p-2 bg-muted/30 rounded-lg">
                  <p className="text-xs text-muted-foreground">目标定价</p>
                  <p className="text-lg font-bold">${ai.launchPlan.targetPrice}</p>
                </div>
              )}
              {ai.launchPlan.bestLaunchMonth && (
                <div className="text-center p-2 bg-muted/30 rounded-lg">
                  <p className="text-xs text-muted-foreground">建议上架月</p>
                  <p className="text-lg font-bold">{ai.launchPlan.bestLaunchMonth}</p>
                </div>
              )}
              {ai.launchPlan.initialOrderQuantity && (
                <div className="text-center p-2 bg-muted/30 rounded-lg">
                  <p className="text-xs text-muted-foreground">首批订单量</p>
                  <p className="text-lg font-bold">{ai.launchPlan.initialOrderQuantity}</p>
                </div>
              )}
              {ai.launchPlan.targetMonthlySales && (
                <div className="text-center p-2 bg-muted/30 rounded-lg">
                  <p className="text-xs text-muted-foreground">目标月销</p>
                  <p className="text-lg font-bold">{ai.launchPlan.targetMonthlySales}</p>
                </div>
              )}
              {ai.launchPlan.estimatedBreakEvenMonths && (
                <div className="text-center p-2 bg-muted/30 rounded-lg">
                  <p className="text-xs text-muted-foreground">预估回本月</p>
                  <p className="text-lg font-bold">{ai.launchPlan.estimatedBreakEvenMonths}个月</p>
                </div>
              )}
            </div>
            {ai.launchPlan.specifications && (
              <p className="text-sm"><span className="text-muted-foreground">规格参数: </span>{ai.launchPlan.specifications}</p>
            )}
            {Array.isArray(ai.launchPlan.keyMilestones) && ai.launchPlan.keyMilestones.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">关键里程碑</p>
                <div className="space-y-1">
                  {ai.launchPlan.keyMilestones.map((m: any, i: number) => (
                    <div key={i} className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs shrink-0">第{m.month}月</Badge>
                      <p className="text-xs">{m.milestone}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Risks */}
      {Array.isArray(ai.risks) && ai.risks.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">风险与应对</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 font-medium">风险</th>
                    <th className="text-center p-2 font-medium">概率</th>
                    <th className="text-center p-2 font-medium">影响</th>
                    <th className="text-left p-2 font-medium">应对策略</th>
                  </tr>
                </thead>
                <tbody>
                  {ai.risks.map((r: any, i: number) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="p-2 font-medium">{r.risk}</td>
                      <td className="p-2 text-center">
                        <Badge className={`text-xs ${r.probability === "高" ? "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400" : r.probability === "中" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"}`}>{r.probability}</Badge>
                      </td>
                      <td className="p-2 text-center">
                        <Badge className={`text-xs ${r.impact === "高" ? "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400" : r.impact === "中" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"}`}>{r.impact}</Badge>
                      </td>
                      <td className="p-2 text-muted-foreground">{r.mitigation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─── Generic Fallback ─── */
function GenericResult({ result }: { result: any }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">分析结果</CardTitle></CardHeader>
      <CardContent>
        <pre className="text-xs bg-muted/50 p-4 rounded-lg overflow-auto max-h-[600px] whitespace-pre-wrap">
          {JSON.stringify(result, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
}

/* ─── Stage Form Editor ─── */
function FormField({ label, value, onChange, multiline, type = "text" }: { label: string; value: any; onChange: (v: any) => void; multiline?: boolean; type?: string }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {multiline ? (
        <Textarea value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="text-sm min-h-[80px]" />
      ) : type === "number" ? (
        <Input type="number" value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : "")} className="text-sm" />
      ) : (
        <Input value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="text-sm" />
      )}
    </div>
  );
}

function FormListEditor({ label, items, onChange, renderItem }: { label: string; items: any[]; onChange: (items: any[]) => void; renderItem?: (item: any, idx: number, update: (v: any) => void) => React.ReactNode }) {
  const addItem = () => onChange([...items, typeof items[0] === "string" ? "" : {}]);
  const removeItem = (idx: number) => onChange(items.filter((_, i) => i !== idx));
  const updateItem = (idx: number, val: any) => { const next = [...items]; next[idx] = val; onChange(next); };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        <Button size="sm" variant="outline" className="h-6 text-xs" onClick={addItem}>添加</Button>
      </div>
      {items.map((item, idx) => (
        <div key={idx} className="flex gap-2 items-start">
          <div className="flex-1">
            {renderItem ? renderItem(item, idx, (v) => updateItem(idx, v)) : (
              <Input value={typeof item === "string" ? item : JSON.stringify(item)} onChange={(e) => updateItem(idx, e.target.value)} className="text-sm" />
            )}
          </div>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-red-500" onClick={() => removeItem(idx)}>×</Button>
        </div>
      ))}
    </div>
  );
}

function StageFormEditor({ stageKey, data, onChange }: { stageKey: StageKey; data: any; onChange: (d: any) => void }) {
  const update = (path: string, value: any) => {
    const next = JSON.parse(JSON.stringify(data));
    const keys = path.split(".");
    let obj = next;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    onChange(next);
  };

  const ai = data.ai || {};

  switch (stageKey) {
    case "market_overview":
      return (
        <div className="space-y-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">市场总结</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <FormField label="市场总结" value={ai.summary} onChange={(v) => update("ai.summary", v)} multiline />
              <div className="grid grid-cols-2 gap-3">
                <FormField label="市场成熟度" value={ai.maturityLevel} onChange={(v) => update("ai.maturityLevel", v)} />
                <FormField label="增长趋势" value={ai.growthTrend} onChange={(v) => update("ai.growthTrend", v)} />
                <FormField label="季节性" value={ai.seasonality} onChange={(v) => update("ai.seasonality", v)} />
                <FormField label="市场容量判断" value={ai.marketCapacity} onChange={(v) => update("ai.marketCapacity", v)} />
                <FormField label="进入时机" value={ai.entryTiming} onChange={(v) => update("ai.entryTiming", v)} />
              </div>
            </CardContent>
          </Card>
          {Array.isArray(ai.opportunities) && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">市场机会</CardTitle></CardHeader>
              <CardContent>
                <FormListEditor label="机会列表" items={ai.opportunities} onChange={(v) => update("ai.opportunities", v)} />
              </CardContent>
            </Card>
          )}
          {Array.isArray(ai.threats) && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">市场风险</CardTitle></CardHeader>
              <CardContent>
                <FormListEditor label="风险列表" items={ai.threats} onChange={(v) => update("ai.threats", v)} />
              </CardContent>
            </Card>
          )}
        </div>
      );

    case "attribute_cross":
      return (
        <div className="space-y-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">属性交叉分析</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <FormField label="分析总结" value={ai.summary} onChange={(v) => update("ai.summary", v)} multiline />
            </CardContent>
          </Card>
          {Array.isArray(ai.mainstreamProducts) && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">主流产品组合</CardTitle></CardHeader>
              <CardContent>
                <FormListEditor label="主流组合" items={ai.mainstreamProducts} onChange={(v) => update("ai.mainstreamProducts", v)}
                  renderItem={(item, _idx, upd) => (
                    <div className="space-y-2 p-2 border rounded">
                      <FormField label="组合" value={item.combination} onChange={(v) => upd({ ...item, combination: v })} />
                      <FormField label="占比" value={item.share} onChange={(v) => upd({ ...item, share: v })} />
                      <FormField label="分析" value={item.analysis} onChange={(v) => upd({ ...item, analysis: v })} multiline />
                    </div>
                  )}
                />
              </CardContent>
            </Card>
          )}
          {Array.isArray(ai.differentiationOpportunities) && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">差异化机会</CardTitle></CardHeader>
              <CardContent>
                <FormListEditor label="机会" items={ai.differentiationOpportunities} onChange={(v) => update("ai.differentiationOpportunities", v)}
                  renderItem={(item, _idx, upd) => (
                    <div className="space-y-2 p-2 border rounded">
                      <FormField label="方向" value={item.direction} onChange={(v) => upd({ ...item, direction: v })} />
                      <FormField label="原因" value={item.reason} onChange={(v) => upd({ ...item, reason: v })} multiline />
                    </div>
                  )}
                />
              </CardContent>
            </Card>
          )}
          {Array.isArray(ai.redOceanWarnings) && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">红海警告</CardTitle></CardHeader>
              <CardContent>
                <FormListEditor label="警告" items={ai.redOceanWarnings} onChange={(v) => update("ai.redOceanWarnings", v)} />
              </CardContent>
            </Card>
          )}
        </div>
      );

    case "price_analysis":
      return (
        <div className="space-y-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">价格分析</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <FormField label="分析总结" value={ai.summary} onChange={(v) => update("ai.summary", v)} multiline />
              <div className="grid grid-cols-2 gap-3">
                <FormField label="最佳价格区间(低)" value={ai.bestPriceRange?.min} onChange={(v) => update("ai.bestPriceRange.min", Number(v))} type="number" />
                <FormField label="最佳价格区间(高)" value={ai.bestPriceRange?.max} onChange={(v) => update("ai.bestPriceRange.max", Number(v))} type="number" />
              </div>
              <FormField label="定价策略" value={ai.pricingStrategy} onChange={(v) => update("ai.pricingStrategy", v)} multiline />
            </CardContent>
          </Card>
          {Array.isArray(ai.priceInsights) && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">价格洞察</CardTitle></CardHeader>
              <CardContent>
                <FormListEditor label="洞察" items={ai.priceInsights} onChange={(v) => update("ai.priceInsights", v)} />
              </CardContent>
            </Card>
          )}
        </div>
      );

    case "brand_competition":
      return (
        <div className="space-y-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">品牌竞争分析</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <FormField label="分析总结" value={ai.summary} onChange={(v) => update("ai.summary", v)} multiline />
              <FormField label="竞争格局" value={ai.competitionPattern} onChange={(v) => update("ai.competitionPattern", v)} />
            </CardContent>
          </Card>
          {ai.entryStrategy && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">进入策略</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <FormField label="进入方式" value={ai.entryStrategy?.approach} onChange={(v) => update("ai.entryStrategy.approach", v)} />
                <FormField label="目标细分" value={ai.entryStrategy?.targetSegment} onChange={(v) => update("ai.entryStrategy.targetSegment", v)} />
                <FormField label="差异化切入点" value={ai.entryStrategy?.differentiationPoint} onChange={(v) => update("ai.entryStrategy.differentiationPoint", v)} multiline />
              </CardContent>
            </Card>
          )}
          {ai.chinaSellerAnalysis && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">中国卖家分析</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <FormField label="份额" value={ai.chinaSellerAnalysis?.share} onChange={(v) => update("ai.chinaSellerAnalysis.share", v)} />
                <FormField label="趋势" value={ai.chinaSellerAnalysis?.trend} onChange={(v) => update("ai.chinaSellerAnalysis.trend", v)} />
                <FormField label="影响" value={ai.chinaSellerAnalysis?.implication} onChange={(v) => update("ai.chinaSellerAnalysis.implication", v)} multiline />
              </CardContent>
            </Card>
          )}
        </div>
      );

    case "review_kano":
      return (
        <div className="space-y-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">评论分析</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <FormField label="分析总结" value={ai.summary} onChange={(v) => update("ai.summary", v)} multiline />
            </CardContent>
          </Card>
          {["painPoints", "itchPoints", "wowPoints"].map(catKey => {
            const catLabel = catKey === "painPoints" ? "痛点" : catKey === "itchPoints" ? "疒点" : "爽点";
            const items = ai.kanoAnalysis?.[catKey] || [];
            return items.length > 0 ? (
              <Card key={catKey}><CardHeader className="pb-2"><CardTitle className="text-sm">{catLabel}</CardTitle></CardHeader>
                <CardContent>
                  <FormListEditor label={catLabel} items={items} onChange={(v) => update(`ai.kanoAnalysis.${catKey}`, v)}
                    renderItem={(item, _idx, upd) => (
                      <div className="space-y-2 p-2 border rounded">
                        <FormField label="主题" value={item.theme || item.feature} onChange={(v) => upd({ ...item, theme: v })} />
                        <FormField label="描述" value={item.description} onChange={(v) => upd({ ...item, description: v })} multiline />
                        <FormField label="改进建议" value={item.improvementSuggestion || item.implementationSuggestion} onChange={(v) => upd({ ...item, improvementSuggestion: v })} multiline />
                      </div>
                    )}
                  />
                </CardContent>
              </Card>
            ) : null;
          })}
        </div>
      );

    case "decision_dashboard":
      return (
        <div className="space-y-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">综合决策</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <FormField label="分析总结" value={ai.summary} onChange={(v) => update("ai.summary", v)} multiline />
              <div className="grid grid-cols-2 gap-3">
                <FormField label="综合评分(1-10)" value={ai.feasibilityScore?.overall} onChange={(v) => update("ai.feasibilityScore.overall", Number(v))} type="number" />
                <FormField label="推荐等级" value={ai.feasibilityScore?.recommendation} onChange={(v) => update("ai.feasibilityScore.recommendation", v)} />
              </div>
            </CardContent>
          </Card>
          {ai.productPositioning && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">产品定位</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <FormField label="差异化方向" value={ai.productPositioning?.differentiationDirection} onChange={(v) => update("ai.productPositioning.differentiationDirection", v)} multiline />
                <FormField label="目标用户" value={ai.productPositioning?.targetAudience} onChange={(v) => update("ai.productPositioning.targetAudience", v)} />
              </CardContent>
            </Card>
          )}
          {ai.launchPlan && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">上新计划</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <FormField label="目标定价" value={ai.launchPlan?.targetPrice} onChange={(v) => update("ai.launchPlan.targetPrice", v)} />
                  <FormField label="建议上架月" value={ai.launchPlan?.bestLaunchMonth} onChange={(v) => update("ai.launchPlan.bestLaunchMonth", v)} />
                  <FormField label="首批订单量" value={ai.launchPlan?.initialOrderQuantity} onChange={(v) => update("ai.launchPlan.initialOrderQuantity", v)} />
                </div>
              </CardContent>
            </Card>
          )}
          {Array.isArray(ai.risks) && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">风险与应对</CardTitle></CardHeader>
              <CardContent>
                <FormListEditor label="风险" items={ai.risks} onChange={(v) => update("ai.risks", v)}
                  renderItem={(item, _idx, upd) => (
                    <div className="space-y-2 p-2 border rounded">
                      <FormField label="风险" value={item.risk} onChange={(v) => upd({ ...item, risk: v })} />
                      <div className="grid grid-cols-2 gap-2">
                        <FormField label="概率" value={item.probability} onChange={(v) => upd({ ...item, probability: v })} />
                        <FormField label="影响" value={item.impact} onChange={(v) => upd({ ...item, impact: v })} />
                      </div>
                      <FormField label="应对策略" value={item.mitigation} onChange={(v) => upd({ ...item, mitigation: v })} multiline />
                    </div>
                  )}
                />
              </CardContent>
            </Card>
          )}
        </div>
      );

    default:
      // Fallback: show JSON editor for stages without form editor (attribute_tagging, tag_cross)
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">该阶段使用JSON编辑器，请直接修改下方内容：</p>
          <Textarea
            value={JSON.stringify(data, null, 2)}
            onChange={(e) => { try { onChange(JSON.parse(e.target.value)); } catch { /* ignore parse errors while typing */ } }}
            className="min-h-[500px] font-mono text-xs"
          />
        </div>
      );
  }
}
