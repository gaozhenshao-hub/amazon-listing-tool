import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
  Play,
  RefreshCw,
  Tag,
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
  ScatterChart, Scatter, ZAxis,
} from "recharts";

/* ─── Chart Colors ─── */
const CHART_COLORS = ["#6366f1", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#64748b"];

/* ─── Stage Definition ─── */
const STAGES = [
  { key: "attribute_tagging", label: "属性标注", icon: Tag, desc: "AI自动识别产品属性维度并标注" },
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
  const [activeStage, setActiveStage] = useState<StageKey>("attribute_tagging");
  const [editingStage, setEditingStage] = useState<StageKey | null>(null);
  const [editText, setEditText] = useState("");
  const utils = trpc.useUtils();

  // ─── Queries ───
  const { data: project, isLoading: projLoading } = trpc.devProject.getById.useQuery({ id: projectId });
  const { data: stages, isLoading: stagesLoading } = trpc.devAnalysis.getStages.useQuery({ projectId });
  const { data: products } = trpc.devProject.getProducts.useQuery({ projectId });

  // ─── Stage status map ───
  const stageMap = useMemo(() => {
    const m: Record<string, any> = {};
    if (stages) stages.forEach((s: any) => { m[s.stageType] = s; });
    return m;
  }, [stages]);

  // ─── Mutations ───
  const tagMutation = trpc.devAnalysis.runAttributeTagging.useMutation({
    onSuccess: () => { toast.success("属性标注完成"); utils.devAnalysis.getStages.invalidate({ projectId }); },
    onError: (e: any) => toast.error(`属性标注失败: ${e.message}`),
  });
  const marketMutation = trpc.devAnalysis.runMarketOverview.useMutation({
    onSuccess: () => { toast.success("市场大盘分析完成"); utils.devAnalysis.getStages.invalidate({ projectId }); },
    onError: (e: any) => toast.error(`市场分析失败: ${e.message}`),
  });
  const crossMutation = trpc.devAnalysis.runAttributeCross.useMutation({
    onSuccess: () => { toast.success("属性交叉分析完成"); utils.devAnalysis.getStages.invalidate({ projectId }); },
    onError: (e: any) => toast.error(`属性交叉分析失败: ${e.message}`),
  });
  const priceMutation = trpc.devAnalysis.runPriceAnalysis.useMutation({
    onSuccess: () => { toast.success("价格段分析完成"); utils.devAnalysis.getStages.invalidate({ projectId }); },
    onError: (e: any) => toast.error(`价格分析失败: ${e.message}`),
  });
  const brandMutation = trpc.devAnalysis.runBrandCompetition.useMutation({
    onSuccess: () => { toast.success("品牌竞争分析完成"); utils.devAnalysis.getStages.invalidate({ projectId }); },
    onError: (e: any) => toast.error(`品牌分析失败: ${e.message}`),
  });
  const reviewMutation = trpc.devAnalysis.runReviewKano.useMutation({
    onSuccess: () => { toast.success("评论深度分析完成"); utils.devAnalysis.getStages.invalidate({ projectId }); },
    onError: (e: any) => toast.error(`评论分析失败: ${e.message}`),
  });
  const dashboardMutation = trpc.devAnalysis.runDecisionDashboard.useMutation({
    onSuccess: () => { toast.success("综合决策看板生成完成"); utils.devAnalysis.getStages.invalidate({ projectId }); },
    onError: (e: any) => toast.error(`决策看板生成失败: ${e.message}`),
  });
  const confirmMutation = trpc.devAnalysis.confirmStage.useMutation({
    onSuccess: () => { toast.success("阶段已确认锁定"); utils.devAnalysis.getStages.invalidate({ projectId }); setEditingStage(null); },
    onError: (e: any) => toast.error(`确认失败: ${e.message}`),
  });
  const editMutation = trpc.devAnalysis.editStage.useMutation({
    onSuccess: () => { toast.success("编辑已保存"); utils.devAnalysis.getStages.invalidate({ projectId }); setEditingStage(null); },
    onError: (e: any) => toast.error(`保存失败: ${e.message}`),
  });

  const isAnyMutating = tagMutation.isPending || marketMutation.isPending || crossMutation.isPending || priceMutation.isPending || brandMutation.isPending || reviewMutation.isPending || dashboardMutation.isPending;

  // ─── Run stage ───
  const runStage = useCallback((key: StageKey) => {
    const input = { projectId };
    switch (key) {
      case "attribute_tagging": tagMutation.mutate(input); break;
      case "market_overview": marketMutation.mutate(input); break;
      case "attribute_cross": crossMutation.mutate(input); break;
      case "price_analysis": priceMutation.mutate(input); break;
      case "brand_competition": brandMutation.mutate(input); break;
      case "review_kano": reviewMutation.mutate(input); break;
      case "decision_dashboard": dashboardMutation.mutate(input); break;
    }
  }, [projectId, tagMutation, marketMutation, crossMutation, priceMutation, brandMutation, reviewMutation, dashboardMutation]);

  // ─── Start editing ───
  const startEditing = useCallback((key: StageKey) => {
    const stage = stageMap[key];
    if (!stage) return;
    const result = stage.editedResult || stage.rawResult;
    try {
      setEditText(JSON.stringify(JSON.parse(result), null, 2));
    } catch {
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
              const Icon = stage.icon;

              return (
                <div key={stage.key} className="flex items-center flex-1">
                  <button
                    onClick={() => setActiveStage(stage.key)}
                    className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-all w-full
                      ${isActive ? "bg-primary text-primary-foreground shadow-sm" : ""}
                      ${!isActive && isConfirmed ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400" : ""}
                      ${!isActive && isCompleted ? "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400" : ""}
                      ${!isActive && isRunning ? "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400" : ""}
                      ${!isActive && !isConfirmed && !isCompleted && !isRunning ? "text-muted-foreground hover:bg-muted/50" : ""}
                    `}
                  >
                    {isConfirmed ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    ) : isRunning ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
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
              {/* Actions */}
              <div className="space-y-2">
                {(() => {
                  const stageData = stageMap[activeStage];
                  const status = stageData?.status || "pending";
                  const isRunning = status === "running" || status === "generating";
                  const hasResult = status === "completed" || status === "generated" || status === "editing" || status === "confirmed";
                  const isConfirmed = status === "confirmed";

                  return (
                    <>
                      {/* Run / Re-run */}
                      <Button
                        size="sm"
                        className="w-full gap-2"
                        onClick={() => runStage(activeStage)}
                        disabled={isAnyMutating || isConfirmed}
                      >
                        {isRunning ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : hasResult ? (
                          <RefreshCw className="h-3.5 w-3.5" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                        {isRunning ? "分析中..." : hasResult ? "重新分析" : "开始分析"}
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
                        <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 p-2 rounded-md">
                          <Lock className="h-3.5 w-3.5" />
                          此阶段已确认锁定
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
                      onClick={() => editMutation.mutate({ projectId, stageType: activeStage, editedResult: editText })}
                      disabled={editMutation.isPending}
                    >
                      {editMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      保存编辑
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="min-h-[500px] font-mono text-xs"
                  placeholder="编辑JSON格式的分析结果..."
                />
              </CardContent>
            </Card>
          ) : (
            /* ─── Display Mode ─── */
            <StageResultDisplay
              stageKey={activeStage}
              stageData={stageMap[activeStage]}
              productCount={productCount}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Stage Result Display Component ─── */
function StageResultDisplay({ stageKey, stageData, productCount }: { stageKey: StageKey; stageData: any; productCount: number }) {
  if (!stageData || stageData.status === "pending") {
    const stage = STAGES.find(s => s.key === stageKey)!;
    const Icon = stage.icon;
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Icon className="h-12 w-12 mb-4 opacity-20" />
          <p className="text-sm font-medium">{stage.label}</p>
          <p className="text-xs mt-1">{stage.desc}</p>
          <p className="text-xs mt-3">点击左侧"开始分析"按钮执行此阶段</p>
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
    case "attribute_tagging": return <AttributeTaggingResult result={result} />;
    case "market_overview": return <MarketOverviewResult result={result} productCount={productCount} />;
    case "attribute_cross": return <AttributeCrossResult result={result} />;
    case "price_analysis": return <PriceAnalysisResult result={result} />;
    case "brand_competition": return <BrandCompetitionResult result={result} />;
    case "review_kano": return <ReviewKanoResult result={result} />;
    case "decision_dashboard": return <DecisionDashboardResult result={result} />;
    default: return <GenericResult result={result} />;
  }
}

/* ─── 1. Attribute Tagging Result ─── */
function AttributeTaggingResult({ result }: { result: any }) {
  const dimensions = result.dimensions || [];
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Tag className="h-4 w-4" />
            AI属性标注结果 — {dimensions.length} 个维度
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {dimensions.map((dim: any, i: number) => (
              <Card key={i} className="border-dashed">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold flex items-center justify-between">
                    <span>{dim.dimensionName || dim.name || `维度${i + 1}`}</span>
                    <Badge variant="secondary" className="text-xs">{(dim.values || dim.possibleValues || []).length} 个值</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1.5">
                    {(dim.values || dim.possibleValues || []).map((v: string, j: number) => (
                      <Badge key={j} variant="outline" className="text-xs">{v}</Badge>
                    ))}
                  </div>
                  {dim.description && (
                    <p className="text-xs text-muted-foreground mt-2">{dim.description}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
      {result.summary && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">AI分析总结</CardTitle></CardHeader>
          <CardContent><Streamdown>{result.summary}</Streamdown></CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─── 2. Market Overview Result ─── */
function MarketOverviewResult({ result, productCount }: { result: any; productCount: number }) {
  const stats = result.stats || {};
  const ai = result.ai || {};

  // Prepare chart data
  const priceChartData = stats.priceDistribution
    ? Object.entries(stats.priceDistribution as Record<string, number>).map(([range, count]) => ({ range, count }))
    : [];
  const ratingChartData = stats.ratingDistribution
    ? Object.entries(stats.ratingDistribution as Record<string, number>).map(([rating, count]) => ({ name: `${rating}★`, value: count }))
    : [];

  return (
    <div className="space-y-4">
      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "竞品数量", value: productCount, suffix: "个" },
          { label: "平均价格", value: stats.avgPrice ? `$${stats.avgPrice.toFixed(2)}` : "--" },
          { label: "价格范围", value: stats.minPrice && stats.maxPrice ? `$${stats.minPrice.toFixed(0)}-$${stats.maxPrice.toFixed(0)}` : "--" },
          { label: "平均评分", value: stats.avgRating ? stats.avgRating.toFixed(1) : "--", suffix: "★" },
          { label: "平均评论数", value: stats.avgReviewCount ? Math.round(stats.avgReviewCount) : "--" },
          { label: "月均销量(中位数)", value: stats.medianMonthlySales ?? "--" },
          { label: "月均销售额(中位数)", value: stats.medianMonthlyRevenue ? `$${Number(stats.medianMonthlyRevenue).toLocaleString()}` : "--" },
          { label: "品牌数量", value: stats.brandCount ?? "--" },
        ].map((m, i) => (
          <Card key={i}>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <p className="text-lg font-bold mt-1">{m.value}{m.suffix && <span className="text-xs font-normal text-muted-foreground ml-0.5">{m.suffix}</span>}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Price Distribution Bar Chart */}
        {priceChartData.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">价格分布柱状图</CardTitle></CardHeader>
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

        {/* Rating Distribution Pie Chart */}
        {ratingChartData.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">评分分布饼图</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={ratingChartData} cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={3} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {ratingChartData.map((_, idx) => <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {/* AI Interpretation */}
      {ai.marketSummary && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Brain className="h-4 w-4" />AI市场解读</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Streamdown>{ai.marketSummary}</Streamdown>
          </CardContent>
        </Card>
      )}
      {ai.competitionLevel && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">竞争格局评估</CardTitle></CardHeader>
          <CardContent>
            <Badge className="text-sm" variant="secondary">{ai.competitionLevel}</Badge>
            {ai.competitionReasoning && <p className="text-sm text-muted-foreground mt-2">{ai.competitionReasoning}</p>}
          </CardContent>
        </Card>
      )}
      {ai.opportunities && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">市场机会</CardTitle></CardHeader>
          <CardContent><Streamdown>{typeof ai.opportunities === "string" ? ai.opportunities : JSON.stringify(ai.opportunities, null, 2)}</Streamdown></CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─── 3. Attribute Cross Result ─── */
function AttributeCrossResult({ result }: { result: any }) {
  const singleDimStats = result.singleDimStats || {};
  const crossResult = result.crossResult || {};
  const dimensionNames = result.dimensionNames || [];
  const ai = result.ai || {};

  return (
    <div className="space-y-4">
      {/* Single Dimension Stats */}
      {dimensionNames.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">单维度属性分布</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-4">
              {dimensionNames.map((dim: string) => {
                const dimData = singleDimStats[dim] || {};
                const entries = Object.entries(dimData).sort((a: any, b: any) => (b[1]?.count || 0) - (a[1]?.count || 0));
                if (entries.length === 0) return null;
                return (
                  <div key={dim}>
                    <p className="text-xs font-semibold mb-2">{dim}</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="text-left p-2 font-medium">属性值</th>
                            <th className="text-right p-2 font-medium">产品数</th>
                            <th className="text-right p-2 font-medium">占比</th>
                            <th className="text-right p-2 font-medium">均价</th>
                            <th className="text-right p-2 font-medium">均评分</th>
                            <th className="text-right p-2 font-medium">均评论数</th>
                          </tr>
                        </thead>
                        <tbody>
                          {entries.map(([val, data]: any) => (
                            <tr key={val} className="border-b last:border-0">
                              <td className="p-2 font-medium">{val}</td>
                              <td className="p-2 text-right">{data.count}</td>
                              <td className="p-2 text-right">{data.pct}%</td>
                              <td className="p-2 text-right">${data.avgPrice?.toFixed(2) ?? "--"}</td>
                              <td className="p-2 text-right">{data.avgRating?.toFixed(1) ?? "--"}</td>
                              <td className="p-2 text-right">{data.avgReviews ?? "--"}</td>
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

      {/* Cross Matrix */}
      {Object.keys(crossResult).length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Grid3X3 className="h-4 w-4" />属性交叉矩阵</CardTitle></CardHeader>
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

      {/* AI Insights */}
      {ai.blueOcean && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4" />蓝海机会识别</CardTitle></CardHeader>
          <CardContent><Streamdown>{typeof ai.blueOcean === "string" ? ai.blueOcean : JSON.stringify(ai.blueOcean, null, 2)}</Streamdown></CardContent>
        </Card>
      )}
      {ai.crossInsights && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">交叉分析洞察</CardTitle></CardHeader>
          <CardContent><Streamdown>{typeof ai.crossInsights === "string" ? ai.crossInsights : JSON.stringify(ai.crossInsights, null, 2)}</Streamdown></CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─── 4. Price Analysis Result ─── */
function PriceAnalysisResult({ result }: { result: any }) {
  const segments = result.priceSegments || [];
  const ai = result.ai || {};

  // Chart data
  const segChartData = segments.map((s: any) => ({
    range: s.range,
    count: s.count || 0,
    avgPrice: s.avgPrice || 0,
    avgMonthlySales: s.avgMonthlySales || 0,
  }));

  return (
    <div className="space-y-4">
      {/* Price Segment Charts */}
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

      {ai.priceStrategy && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Brain className="h-4 w-4" />AI定价策略建议</CardTitle></CardHeader>
          <CardContent><Streamdown>{typeof ai.priceStrategy === "string" ? ai.priceStrategy : JSON.stringify(ai.priceStrategy, null, 2)}</Streamdown></CardContent>
        </Card>
      )}
      {ai.profitAnalysis && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">利润空间分析</CardTitle></CardHeader>
          <CardContent><Streamdown>{typeof ai.profitAnalysis === "string" ? ai.profitAnalysis : JSON.stringify(ai.profitAnalysis, null, 2)}</Streamdown></CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─── 5. Brand Competition Result ─── */
function BrandCompetitionResult({ result }: { result: any }) {
  const brands = result.brands || [];
  const ai = result.ai || {};

  // Chart data
  const top10 = brands.slice(0, 10);
  const pieData = top10.map((b: any) => ({ name: b.brand, value: parseFloat(b.marketShare) || 0 }));
  const salesData = top10.map((b: any) => ({ brand: b.brand?.slice(0, 12), sales: b.totalMonthlySales || 0, revenue: b.totalMonthlyRevenue || 0 }));

  return (
    <div className="space-y-4">
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
                    <th className="text-right p-2 font-medium">产品数</th>
                    <th className="text-right p-2 font-medium">市占率</th>
                    <th className="text-right p-2 font-medium">均价</th>
                    <th className="text-right p-2 font-medium">均评分</th>
                    <th className="text-right p-2 font-medium">均评论</th>
                    <th className="text-right p-2 font-medium">总月销</th>
                    <th className="text-right p-2 font-medium">总月销售额</th>
                  </tr>
                </thead>
                <tbody>
                  {brands.map((b: any, i: number) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="p-2 font-medium">{b.brand}</td>
                      <td className="p-2 text-right">{b.count}</td>
                      <td className="p-2 text-right">{b.marketShare}%</td>
                      <td className="p-2 text-right">${b.avgPrice?.toFixed(2) ?? "--"}</td>
                      <td className="p-2 text-right">{b.avgRating?.toFixed(1) ?? "--"}</td>
                      <td className="p-2 text-right">{b.avgReviews ?? "--"}</td>
                      <td className="p-2 text-right">{b.totalMonthlySales ?? "--"}</td>
                      <td className="p-2 text-right">{b.totalMonthlyRevenue ? `$${Number(b.totalMonthlyRevenue).toLocaleString()}` : "--"}</td>
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

      {ai.brandLandscape && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Brain className="h-4 w-4" />AI品牌格局分析</CardTitle></CardHeader>
          <CardContent><Streamdown>{typeof ai.brandLandscape === "string" ? ai.brandLandscape : JSON.stringify(ai.brandLandscape, null, 2)}</Streamdown></CardContent>
        </Card>
      )}
      {ai.entryStrategy && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">入场策略建议</CardTitle></CardHeader>
          <CardContent><Streamdown>{typeof ai.entryStrategy === "string" ? ai.entryStrategy : JSON.stringify(ai.entryStrategy, null, 2)}</Streamdown></CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─── 6. Review Kano Result ─── */
function ReviewKanoResult({ result }: { result: any }) {
  const kano = result.kano || {};
  const ai = result.ai || {};
  const categories = [
    { key: "must_be", label: "必备属性 (M)", desc: "缺失会引起强烈不满", color: "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400" },
    { key: "one_dimensional", label: "期望属性 (O)", desc: "越好越满意", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400" },
    { key: "attractive", label: "魅力属性 (A)", desc: "有则惊喜，无则无感", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400" },
    { key: "indifferent", label: "无差异属性 (I)", desc: "有无均可", color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
    { key: "reverse", label: "反向属性 (R)", desc: "有反而不满", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400" },
  ];

  return (
    <div className="space-y-4">
      {categories.map(cat => {
        const items = kano[cat.key] || [];
        if (items.length === 0) return null;
        return (
          <Card key={cat.key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Badge className={`text-xs ${cat.color}`}>{cat.label}</Badge>
                <span className="text-xs text-muted-foreground font-normal">{cat.desc}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {items.map((item: any, i: number) => (
                  <div key={i} className="flex items-start gap-3 p-2 bg-muted/30 rounded-lg">
                    <span className="text-xs font-mono text-muted-foreground mt-0.5">{i + 1}</span>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{typeof item === "string" ? item : item.feature || item.name}</p>
                      {item.evidence && <p className="text-xs text-muted-foreground mt-1">{item.evidence}</p>}
                      {item.frequency && <Badge variant="outline" className="text-xs mt-1">提及频率: {item.frequency}</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {ai.painPoints && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Brain className="h-4 w-4" />核心痛点分析</CardTitle></CardHeader>
          <CardContent><Streamdown>{typeof ai.painPoints === "string" ? ai.painPoints : JSON.stringify(ai.painPoints, null, 2)}</Streamdown></CardContent>
        </Card>
      )}
      {ai.improvementSuggestions && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">产品改进建议</CardTitle></CardHeader>
          <CardContent><Streamdown>{typeof ai.improvementSuggestions === "string" ? ai.improvementSuggestions : JSON.stringify(ai.improvementSuggestions, null, 2)}</Streamdown></CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─── 7. Decision Dashboard Result ─── */
function DecisionDashboardResult({ result }: { result: any }) {
  const dashboard = result.dashboard || result;

  return (
    <div className="space-y-4">
      {/* Overall Score */}
      {dashboard.overallScore !== undefined && (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-sm text-muted-foreground">综合立项评分</p>
            <p className="text-5xl font-bold mt-2 text-primary">{dashboard.overallScore}</p>
            <p className="text-xs text-muted-foreground mt-1">/ 100</p>
            {dashboard.recommendation && (
              <Badge className="mt-3 text-sm" variant={dashboard.recommendation === "强烈推荐" ? "default" : "secondary"}>
                {dashboard.recommendation}
              </Badge>
            )}
          </CardContent>
        </Card>
      )}

      {/* Dimension Scores with Radar Chart */}
      {dashboard.dimensions && (() => {
        const dims = Array.isArray(dashboard.dimensions)
          ? dashboard.dimensions
          : Object.entries(dashboard.dimensions).map(([k, v]: any) => ({ name: k, ...v }));
        const radarData = dims.map((d: any) => ({ subject: d.name || d.label, score: d.score ?? d.value ?? 0, fullMark: 100 }));
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">维度评分雷达图</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart data={radarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10 }} />
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
                    const score = dim.score ?? dim.value ?? 0;
                    const color = score >= 80 ? "bg-emerald-500" : score >= 60 ? "bg-amber-500" : "bg-red-500";
                    return (
                      <div key={i}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium">{dim.name || dim.label}</span>
                          <span className="text-xs font-bold">{score}</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${score}%` }} />
                        </div>
                        {dim.comment && <p className="text-xs text-muted-foreground mt-0.5">{dim.comment}</p>}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        );
      })()}

      {/* Key Findings */}
      {dashboard.keyFindings && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4" />核心发现</CardTitle></CardHeader>
          <CardContent><Streamdown>{typeof dashboard.keyFindings === "string" ? dashboard.keyFindings : JSON.stringify(dashboard.keyFindings, null, 2)}</Streamdown></CardContent>
        </Card>
      )}

      {/* Risks */}
      {dashboard.risks && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">风险提示</CardTitle></CardHeader>
          <CardContent><Streamdown>{typeof dashboard.risks === "string" ? dashboard.risks : JSON.stringify(dashboard.risks, null, 2)}</Streamdown></CardContent>
        </Card>
      )}

      {/* Action Plan */}
      {dashboard.actionPlan && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">行动计划</CardTitle></CardHeader>
          <CardContent><Streamdown>{typeof dashboard.actionPlan === "string" ? dashboard.actionPlan : JSON.stringify(dashboard.actionPlan, null, 2)}</Streamdown></CardContent>
        </Card>
      )}

      {/* Full AI Summary */}
      {dashboard.fullSummary && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Brain className="h-4 w-4" />AI综合分析报告</CardTitle></CardHeader>
          <CardContent><Streamdown>{dashboard.fullSummary}</Streamdown></CardContent>
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
