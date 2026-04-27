import { useState, useMemo, useEffect, useCallback } from "react";
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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, Trash2, Loader2, Brain, TrendingUp, TrendingDown, Minus,
  Target, BarChart3, FileText, Calendar, Award, ChevronDown, ChevronUp,
  Edit2, Save, X, Download, AlertTriangle, CheckCircle2, Lightbulb, Focus,
  ArrowRight,
} from "lucide-react";
import {
  ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, Tooltip, Legend,
} from "recharts";

// ─── Types ───
interface Props {
  productId: number;
  parentAsin: string;
}

interface AiAnalysis {
  achievementSummary: string;
  keyFindings: { metric: string; status: string; detail: string; changeRate?: string }[];
  problems: { issue: string; possibleCause: string; severity: string }[];
  recommendations: { action: string; priority: string; expectedImpact: string }[];
  nextPeriodFocus: string[];
}

// ─── 8 metrics definition ───
const METRICS = [
  { key: "Sales", label: "销售额", prefix: "$", suffix: "", type: "money" },
  { key: "SubcategoryRank", label: "小类排名", prefix: "#", suffix: "", type: "rank" },
  { key: "ProfitRate", label: "利润率", prefix: "", suffix: "%", type: "percent" },
  { key: "ConvRate", label: "转化率", prefix: "", suffix: "%", type: "percent" },
  { key: "OrganicOrders", label: "自然单", prefix: "", suffix: "", type: "number" },
  { key: "AdOrders", label: "广告单", prefix: "", suffix: "", type: "number" },
  { key: "RatingScore", label: "评分", prefix: "", suffix: "", type: "decimal" },
  { key: "RatingCount", label: "Rating数量", prefix: "", suffix: "", type: "number" },
] as const;

// ─── Helpers ───
function fmtVal(val: any, type: string, prefix: string, suffix: string): string {
  if (val == null || val === "" || val === undefined) return "-";
  const n = Number(val);
  if (isNaN(n)) return "-";
  if (type === "money") return `${prefix}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (type === "rank") return n > 0 ? `${prefix}${n.toLocaleString()}` : "-";
  if (type === "percent") return `${n.toFixed(2)}${suffix}`;
  if (type === "decimal") return `${n.toFixed(1)}${suffix}`;
  return `${prefix}${n.toLocaleString()}${suffix}`;
}

function calcAchievementRate(baseline: any, actual: any, target: any, type: string): number | null {
  const b = Number(baseline || 0);
  const a = Number(actual || 0);
  const t = Number(target || 0);
  if (t === 0 && b === 0) return null;
  // For rank, lower is better
  if (type === "rank") {
    if (t === 0) return null;
    // achievement = target / actual * 100 (lower actual = better)
    return a > 0 ? (t / a) * 100 : 0;
  }
  if (t === 0) return null;
  return (a / t) * 100;
}

function calcChange(baseline: any, actual: any, type: string): { value: number; direction: "up" | "down" | "flat" } {
  const b = Number(baseline || 0);
  const a = Number(actual || 0);
  const diff = a - b;
  if (Math.abs(diff) < 0.001) return { value: 0, direction: "flat" };
  // For rank, decrease is good
  if (type === "rank") {
    return { value: diff, direction: diff < 0 ? "up" : "down" };
  }
  return { value: diff, direction: diff > 0 ? "up" : "down" };
}

export default function OpsProductReview({ productId, parentAsin }: Props) {
  // ─── Queries ───
  const { data: reviews, refetch, isLoading } = trpc.productOps.listExecutionReviews.useQuery(
    { productProfileId: productId, parentAsin },
    { enabled: !!parentAsin }
  );
  const { data: plans } = trpc.productOps.listPlans.useQuery(
    { productProfileId: productId },
    { enabled: !!productId }
  );
  const { data: availableWeeks } = trpc.productOps.getAvailableWeeks.useQuery(
    { parentAsin },
    { enabled: !!parentAsin }
  );

  // ─── Mutations ───
  const createReview = trpc.productOps.createExecutionReview.useMutation({
    onSuccess: () => { refetch(); setShowCreate(false); toast.success("复盘记录已创建"); },
    onError: (err) => toast.error(`创建失败: ${err.message}`),
  });
  const updateReview = trpc.productOps.updateExecutionReview.useMutation({
    onSuccess: () => { refetch(); toast.success("复盘已更新"); },
    onError: (err) => toast.error(`更新失败: ${err.message}`),
  });
  const deleteReview = trpc.productOps.deleteExecutionReview.useMutation({
    onSuccess: () => { refetch(); setSelectedReviewId(null); toast.success("复盘已删除"); },
    onError: (err) => toast.error(`删除失败: ${err.message}`),
  });
  const syncReviewData = trpc.productOps.syncReviewFromImportedData.useMutation({
    onSuccess: () => { refetch(); toast.success("实际数据已从导入数据加载"); },
    onError: (err) => toast.error(`加载失败: ${err.message}`),
  });
  const aiAnalysisMut = trpc.productOps.generateReviewAiAnalysis.useMutation({
    onSuccess: () => { refetch(); toast.success("AI复盘分析完成"); },
    onError: (err) => toast.error(`AI分析失败: ${err.message}`),
  });

  // ─── State ───
  const [showCreate, setShowCreate] = useState(false);
  const [selectedReviewId, setSelectedReviewId] = useState<number | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [weekCount, setWeekCount] = useState(1);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    comparison: true, textFields: true, aiAnalysis: true,
  });
  const [selectedPlanId, setSelectedPlanId] = useState<string>("none");

  const selectedReview = reviews?.find((r: any) => r.id === selectedReviewId) || reviews?.[0];

  // ─── Create form ───
  const [createForm, setCreateForm] = useState({
    period: "",
    periodType: "weekly" as string,
    baselineWeekStart: "",
    baselineWeekEnd: "",
    targetSales: "", targetSubcategoryRank: "", targetConvRate: "",
    targetOrganicOrders: "", targetAdOrders: "", targetRatingScore: "", targetRatingCount: "",
  });
  const [baselinePreview, setBaselinePreview] = useState<Record<string, any> | null>(null);
  const [loadingBaseline, setLoadingBaseline] = useState(false);

  // ─── Auto-select first review ───
  useEffect(() => {
    if (reviews && reviews.length > 0 && !selectedReviewId) {
      setSelectedReviewId(reviews[0].id);
    }
  }, [reviews, selectedReviewId]);

  // ─── Load from plan (target data only) ───
  const handleLoadFromPlan = useCallback((planId: string) => {
    setSelectedPlanId(planId);
    if (planId === "none" || !plans) return;
    const plan = plans.find((p: any) => p.id === Number(planId));
    if (!plan) return;
    setCreateForm(prev => ({
      ...prev,
      targetSales: plan.targetSales || "",
      targetSubcategoryRank: plan.targetSubcategoryRank?.toString() || "",
      targetConvRate: plan.targetConvRate || "",
      targetOrganicOrders: plan.targetOrganicOrders?.toString() || "",
      targetAdOrders: plan.targetAdOrders?.toString() || "",
      targetRatingScore: plan.targetRatingScore || "",
      targetRatingCount: plan.targetRatingCount?.toString() || "",
    }));
    toast.success("已从运营计划加载目标数据");
  }, [plans]);

  // ─── Handle baseline week selection ───
  const handleBaselineWeekSelect = useCallback(async (weekValue: string) => {
    if (!weekValue || weekValue === "none") {
      setCreateForm(prev => ({ ...prev, baselineWeekStart: "", baselineWeekEnd: "" }));
      setBaselinePreview(null);
      return;
    }
    const [weekStart, weekEnd] = weekValue.split("_");
    setCreateForm(prev => ({ ...prev, baselineWeekStart: weekStart, baselineWeekEnd: weekEnd }));
    setLoadingBaseline(true);

    // Find the matching weekly data from availableWeeks to show preview
    // We'll use syncReviewFromImportedData logic but just for preview
    // For now, show the selected week label as preview
    const week = availableWeeks?.find((w: any) => w.weekStart === weekStart && w.weekEnd === weekEnd);
    if (week) {
      setBaselinePreview({ weekLabel: week.label, weekStart, weekEnd, status: "selected" });
    }
    setLoadingBaseline(false);
  }, [availableWeeks]);

  // ─── Computed: achievement rates ───
  const comparisonData = useMemo(() => {
    if (!selectedReview) return [];
    return METRICS.map(m => {
      const baseline = (selectedReview as any)[`baseline${m.key}`];
      const actual = (selectedReview as any)[`actual${m.key}`];
      const target = (selectedReview as any)[`target${m.key}`];
      const achievement = calcAchievementRate(baseline, actual, target, m.type);
      const change = calcChange(baseline, actual, m.type);
      return { ...m, baseline, actual, target, achievement, change };
    });
  }, [selectedReview]);

  // ─── Radar chart data ───
  const radarData = useMemo(() => {
    if (!selectedReview) return [];
    // Normalize metrics to 0-100 scale for radar
    return METRICS.filter(m => m.key !== "RatingCount").map(m => {
      const baseline = Number((selectedReview as any)[`baseline${m.key}`] || 0);
      const actual = Number((selectedReview as any)[`actual${m.key}`] || 0);
      const target = Number((selectedReview as any)[`target${m.key}`] || 0);
      // For rank, invert (lower is better)
      if (m.type === "rank") {
        const maxRank = Math.max(baseline, actual, target, 1);
        return {
          metric: m.label,
          基线: maxRank > 0 ? ((maxRank - baseline + 1) / maxRank) * 100 : 0,
          实际: maxRank > 0 ? ((maxRank - actual + 1) / maxRank) * 100 : 0,
          目标: maxRank > 0 ? ((maxRank - target + 1) / maxRank) * 100 : 0,
        };
      }
      const maxVal = Math.max(baseline, actual, target, 1);
      return {
        metric: m.label,
        基线: (baseline / maxVal) * 100,
        实际: (actual / maxVal) * 100,
        目标: (target / maxVal) * 100,
      };
    });
  }, [selectedReview]);

  // ─── Parse AI analysis ───
  const parsedAiAnalysis: AiAnalysis | null = useMemo(() => {
    if (!selectedReview?.aiAnalysis) return null;
    try {
      const parsed = typeof selectedReview.aiAnalysis === "string"
        ? JSON.parse(selectedReview.aiAnalysis)
        : selectedReview.aiAnalysis;
      return parsed;
    } catch {
      return null;
    }
  }, [selectedReview]);

  // ─── Inline edit ───
  const startEdit = (field: string, value: string) => {
    setEditingField(field);
    setEditValue(value || "");
  };
  const saveEdit = () => {
    if (!selectedReview || !editingField) return;
    updateReview.mutate({ reviewId: selectedReview.id, [editingField]: editValue });
    setEditingField(null);
  };
  const cancelEdit = () => { setEditingField(null); setEditValue(""); };

  // ─── Handlers ───
  const handleCreate = () => {
    createReview.mutate({
      productProfileId: productId,
      parentAsin,
      period: createForm.period,
      periodType: createForm.periodType as any,
      // 基线数据：通过选择周度自动拓取
      baselineWeekStart: createForm.baselineWeekStart || undefined,
      baselineWeekEnd: createForm.baselineWeekEnd || undefined,
      // 目标数据
      targetSales: createForm.targetSales || undefined,
      targetSubcategoryRank: createForm.targetSubcategoryRank ? Number(createForm.targetSubcategoryRank) : undefined,
      targetConvRate: createForm.targetConvRate || undefined,
      targetOrganicOrders: createForm.targetOrganicOrders ? Number(createForm.targetOrganicOrders) : undefined,
      targetAdOrders: createForm.targetAdOrders ? Number(createForm.targetAdOrders) : undefined,
      targetRatingScore: createForm.targetRatingScore || undefined,
      targetRatingCount: createForm.targetRatingCount ? Number(createForm.targetRatingCount) : undefined,
    });
  };

  const handleSyncActual = () => {
    if (!selectedReview) return;
    syncReviewData.mutate({
      reviewId: selectedReview.id,
      parentAsin,
      weekCount,
      syncTarget: "actual",
    });
  };

  const handleSyncFromPlan = () => {
    if (!selectedReview || !selectedPlanId || selectedPlanId === "none") {
      toast.error("请先选择一个运营计划");
      return;
    }
    syncReviewData.mutate({
      reviewId: selectedReview.id,
      parentAsin,
      weekCount: 1,
      syncTarget: "both",
      planId: Number(selectedPlanId),
    });
  };

  const handleAiAnalysis = () => {
    if (!selectedReview) return;
    aiAnalysisMut.mutate({ reviewId: selectedReview.id });
  };

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const getAchievementBadge = (rate: number | null) => {
    if (rate === null) return <Badge variant="outline" className="text-muted-foreground">-</Badge>;
    if (rate >= 100) return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">{rate.toFixed(1)}% 达标</Badge>;
    if (rate >= 80) return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">{rate.toFixed(1)}% 接近</Badge>;
    return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">{rate.toFixed(1)}% 未达标</Badge>;
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case "high": return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">高</Badge>;
      case "medium": return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">中</Badge>;
      case "low": return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">低</Badge>;
      default: return <Badge variant="outline">{severity}</Badge>;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case "high": return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">高优</Badge>;
      case "medium": return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">中优</Badge>;
      case "low": return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">低优</Badge>;
      default: return <Badge variant="outline">{priority}</Badge>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "达标": case "超额": return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">{status}</Badge>;
      case "未达标": return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">{status}</Badge>;
      case "接近": return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">{status}</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  // ─── Render ───
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">加载复盘数据...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ═══ Header: Review selector + actions ═══ */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" /> 执行复盘
          </h3>
          {reviews && reviews.length > 0 && (
            <Select
              value={selectedReviewId?.toString() || ""}
              onValueChange={(v) => setSelectedReviewId(Number(v))}
            >
              <SelectTrigger className="w-[200px] h-8 text-xs">
                <SelectValue placeholder="选择复盘记录" />
              </SelectTrigger>
              <SelectContent>
                {reviews.map((r: any) => (
                  <SelectItem key={r.id} value={r.id.toString()}>
                    {r.period} ({r.status === "draft" ? "草稿" : r.status === "submitted" ? "已提交" : "已审核"})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> 新建复盘
          </Button>
          {selectedReview && (
            <Button
              size="sm" variant="outline"
              className="text-red-400 hover:text-red-300"
              onClick={() => {
                if (confirm("确定删除此复盘记录？")) deleteReview.mutate({ reviewId: selectedReview.id });
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* ═══ No reviews ═══ */}
      {(!reviews || reviews.length === 0) && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground mb-2">暂无复盘记录</p>
            <p className="text-xs text-muted-foreground mb-4">创建复盘记录后，可从导入数据自动加载实际数据，并使用AI进行分析</p>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> 创建第一条复盘
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ═══ Selected review detail ═══ */}
      {selectedReview && (
        <div className="space-y-4">
          {/* ─── Action bar: sync actual data ─── */}
          <Card>
            <CardContent className="py-3 px-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">加载实际数据:</span>
                  <Select value={weekCount.toString()} onValueChange={(v) => setWeekCount(Number(v))}>
                    <SelectTrigger className="w-[120px] h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">最近 1 周</SelectItem>
                      {(availableWeeks?.length || 0) >= 2 && <SelectItem value="2">最近 2 周</SelectItem>}
                      {(availableWeeks?.length || 0) >= 4 && <SelectItem value="4">最近 4 周</SelectItem>}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm" variant="outline" className="h-7 text-xs"
                    onClick={handleSyncActual}
                    disabled={syncReviewData.isPending}
                  >
                    {syncReviewData.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Download className="h-3 w-3 mr-1" />}
                    从导入数据加载
                  </Button>
                </div>
                <div className="flex items-center gap-3">
                  {plans && plans.length > 0 && (
                    <>
                      <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
                        <SelectTrigger className="w-[160px] h-7 text-xs">
                          <SelectValue placeholder="选择运营计划" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">不关联计划</SelectItem>
                          {plans.map((p: any) => (
                            <SelectItem key={p.id} value={p.id.toString()}>
                              {p.planName || p.planPeriod || `计划#${p.id}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm" variant="outline" className="h-7 text-xs"
                        onClick={handleSyncFromPlan}
                        disabled={syncReviewData.isPending || selectedPlanId === "none"}
                      >
                        从计划同步基线/目标
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm" className="h-7 text-xs"
                    onClick={handleAiAnalysis}
                    disabled={aiAnalysisMut.isPending}
                  >
                    {aiAnalysisMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Brain className="h-3 w-3 mr-1" />}
                    AI智能分析
                  </Button>
                </div>
              </div>
              {selectedReview.actualWeekLabel && (
                <div className="mt-2 text-xs text-muted-foreground">
                  实际数据周期: <span className="text-foreground font-medium">{selectedReview.actualWeekLabel}</span>
                  {selectedReview.baselineWeekLabel && (
                    <span className="ml-3">基线周期: <span className="text-foreground font-medium">{selectedReview.baselineWeekLabel}</span></span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ─── Data comparison table ─── */}
          <Card>
            <CardHeader className="py-3 px-4 cursor-pointer" onClick={() => toggleSection("comparison")}>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-blue-400" /> 数据对比 (基线 / 目标 / 实际)
                </CardTitle>
                {expandedSections.comparison ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </CardHeader>
            {expandedSections.comparison && (
              <CardContent className="px-4 pb-4 pt-0">
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="text-xs w-[100px]">指标</TableHead>
                        <TableHead className="text-xs text-center">基线</TableHead>
                        <TableHead className="text-xs text-center">目标</TableHead>
                        <TableHead className="text-xs text-center">实际</TableHead>
                        <TableHead className="text-xs text-center">变化</TableHead>
                        <TableHead className="text-xs text-center">达成率</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {comparisonData.map((row) => (
                        <TableRow key={row.key} className="hover:bg-muted/20">
                          <TableCell className="text-xs font-medium">{row.label}</TableCell>
                          <TableCell className="text-xs text-center text-muted-foreground">
                            {fmtVal(row.baseline, row.type, row.prefix, row.suffix)}
                          </TableCell>
                          <TableCell className="text-xs text-center text-blue-400">
                            {fmtVal(row.target, row.type, row.prefix, row.suffix)}
                          </TableCell>
                          <TableCell className="text-xs text-center font-medium">
                            {fmtVal(row.actual, row.type, row.prefix, row.suffix)}
                          </TableCell>
                          <TableCell className="text-xs text-center">
                            <span className={`inline-flex items-center gap-1 ${
                              row.change.direction === "up" ? "text-emerald-400" :
                              row.change.direction === "down" ? "text-red-400" : "text-muted-foreground"
                            }`}>
                              {row.change.direction === "up" && <TrendingUp className="h-3 w-3" />}
                              {row.change.direction === "down" && <TrendingDown className="h-3 w-3" />}
                              {row.change.direction === "flat" && <Minus className="h-3 w-3" />}
                              {row.type === "rank" ? (
                                row.change.value !== 0 ? Math.abs(row.change.value) : "-"
                              ) : row.type === "percent" || row.type === "decimal" ? (
                                row.change.value !== 0 ? `${row.change.value > 0 ? "+" : ""}${row.change.value.toFixed(2)}` : "-"
                              ) : (
                                row.change.value !== 0 ? `${row.change.value > 0 ? "+" : ""}${row.change.value.toLocaleString()}` : "-"
                              )}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-center">
                            {getAchievementBadge(row.achievement)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            )}
          </Card>

          {/* ─── Radar chart ─── */}
          {radarData.length > 0 && (
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="h-4 w-4 text-purple-400" /> 指标雷达图
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="rgba(0,0,0,0.08)" />
                    <PolarAngleAxis dataKey="metric" tick={{ fill: "#64748b", fontSize: 11 }} />
                    <PolarRadiusAxis tick={false} axisLine={false} domain={[0, 100]} />
                    <Radar name="基线" dataKey="基线" stroke="#64748b" fill="#64748b" fillOpacity={0.1} />
                    <Radar name="目标" dataKey="目标" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} strokeDasharray="5 5" />
                    <Radar name="实际" dataKey="实际" stroke="#10b981" fill="#10b981" fillOpacity={0.2} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 11, color: "#334155" }} />
                  </RadarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* ─── Text fields: 运营总结/关键动作/经验教训/下期计划 ─── */}
          <Card>
            <CardHeader className="py-3 px-4 cursor-pointer" onClick={() => toggleSection("textFields")}>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Edit2 className="h-4 w-4 text-amber-400" /> 运营复盘记录
                </CardTitle>
                {expandedSections.textFields ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </CardHeader>
            {expandedSections.textFields && (
              <CardContent className="px-4 pb-4 pt-0 space-y-3">
                {[
                  { field: "achievementSummary", label: "成果总结", icon: <Award className="h-3.5 w-3.5 text-amber-400" /> },
                  { field: "keyActions", label: "关键动作", icon: <Target className="h-3.5 w-3.5 text-blue-400" /> },
                  { field: "lessonsLearned", label: "经验教训", icon: <Lightbulb className="h-3.5 w-3.5 text-yellow-400" /> },
                  { field: "nextPeriodPlan", label: "下期计划", icon: <ArrowRight className="h-3.5 w-3.5 text-green-400" /> },
                ].map(({ field, label, icon }) => (
                  <div key={field} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs flex items-center gap-1.5">{icon} {label}</Label>
                      {editingField === field ? (
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={saveEdit}>
                            <Save className="h-3 w-3 text-emerald-400" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={cancelEdit}>
                            <X className="h-3 w-3 text-red-400" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm" variant="ghost" className="h-6 w-6 p-0"
                          onClick={() => startEdit(field, (selectedReview as any)[field] || "")}
                        >
                          <Edit2 className="h-3 w-3 text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                    {editingField === field ? (
                      <Textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="text-xs min-h-[60px]"
                        placeholder={`输入${label}...`}
                      />
                    ) : (
                      <div className="text-xs text-muted-foreground bg-muted/20 rounded-md p-2 min-h-[40px] whitespace-pre-wrap">
                        {(selectedReview as any)[field] || <span className="italic">未填写</span>}
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            )}
          </Card>

          {/* ─── AI Analysis Panel ─── */}
          <Card>
            <CardHeader className="py-3 px-4 cursor-pointer" onClick={() => toggleSection("aiAnalysis")}>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Brain className="h-4 w-4 text-violet-400" /> AI智能分析
                  {parsedAiAnalysis && <Badge variant="outline" className="text-[10px] ml-1">已生成</Badge>}
                </CardTitle>
                {expandedSections.aiAnalysis ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </CardHeader>
            {expandedSections.aiAnalysis && (
              <CardContent className="px-4 pb-4 pt-0">
                {!parsedAiAnalysis ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <Brain className="h-8 w-8 text-muted-foreground mb-2" />
                    <p className="text-xs text-muted-foreground mb-3">点击"AI智能分析"按钮，基于数据对比生成结构化分析报告</p>
                    <Button size="sm" onClick={handleAiAnalysis} disabled={aiAnalysisMut.isPending}>
                      {aiAnalysisMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Brain className="h-3 w-3 mr-1" />}
                      生成AI分析
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Achievement Summary */}
                    <div className="bg-gradient-to-r from-violet-500/10 to-blue-500/10 rounded-lg p-3 border border-violet-500/20">
                      <p className="text-xs font-medium text-violet-300 mb-1">整体达成评估</p>
                      <p className="text-sm">{parsedAiAnalysis.achievementSummary}</p>
                    </div>

                    {/* Key Findings */}
                    {parsedAiAnalysis.keyFindings && parsedAiAnalysis.keyFindings.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-blue-400 mb-2 flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5" /> 关键发现
                        </p>
                        <div className="grid gap-2">
                          {parsedAiAnalysis.keyFindings.map((f, i) => (
                            <div key={i} className="flex items-start gap-2 bg-muted/20 rounded-md p-2">
                              <div className="flex-shrink-0 mt-0.5">
                                {getStatusBadge(f.status)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-medium">{f.metric}</span>
                                  {f.changeRate && <span className="text-[10px] text-muted-foreground">({f.changeRate})</span>}
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5">{f.detail}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Problems */}
                    {parsedAiAnalysis.problems && parsedAiAnalysis.problems.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-red-400 mb-2 flex items-center gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5" /> 问题诊断
                        </p>
                        <div className="grid gap-2">
                          {parsedAiAnalysis.problems.map((p, i) => (
                            <div key={i} className="bg-red-500/5 border border-red-500/10 rounded-md p-2">
                              <div className="flex items-center gap-2 mb-1">
                                {getSeverityBadge(p.severity)}
                                <span className="text-xs font-medium">{p.issue}</span>
                              </div>
                              <p className="text-xs text-muted-foreground">可能原因: {p.possibleCause}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Recommendations */}
                    {parsedAiAnalysis.recommendations && parsedAiAnalysis.recommendations.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-emerald-400 mb-2 flex items-center gap-1.5">
                          <Lightbulb className="h-3.5 w-3.5" /> 优化建议
                        </p>
                        <div className="grid gap-2">
                          {parsedAiAnalysis.recommendations.map((r, i) => (
                            <div key={i} className="bg-emerald-500/5 border border-emerald-500/10 rounded-md p-2">
                              <div className="flex items-center gap-2 mb-1">
                                {getPriorityBadge(r.priority)}
                                <span className="text-xs font-medium">{r.action}</span>
                              </div>
                              <p className="text-xs text-muted-foreground">预期效果: {r.expectedImpact}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Next Period Focus */}
                    {parsedAiAnalysis.nextPeriodFocus && parsedAiAnalysis.nextPeriodFocus.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-amber-400 mb-2 flex items-center gap-1.5">
                          <Focus className="h-3.5 w-3.5" /> 下期重点
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {parsedAiAnalysis.nextPeriodFocus.map((f, i) => (
                            <Badge key={i} variant="outline" className="text-xs bg-amber-500/10 border-amber-500/20 text-amber-300">
                              {f}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Regenerate button */}
                    <div className="flex justify-end pt-2">
                      <Button size="sm" variant="outline" className="text-xs" onClick={handleAiAnalysis} disabled={aiAnalysisMut.isPending}>
                        {aiAnalysisMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Brain className="h-3 w-3 mr-1" />}
                        重新生成分析
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            )}
          </Card>

          {/* ─── Strategist feedback ─── */}
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Award className="h-4 w-4 text-yellow-400" /> 策划师评价
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <div className="flex items-center gap-3 mb-2">
                <Label className="text-xs">评级:</Label>
                <div className="flex gap-1">
                  {["S", "A", "B", "C", "D"].map((grade) => (
                    <Button
                      key={grade}
                      size="sm"
                      variant={selectedReview.strategistRating === grade ? "default" : "outline"}
                      className={`h-7 w-7 p-0 text-xs ${
                        selectedReview.strategistRating === grade
                          ? grade === "S" ? "bg-yellow-500 text-black" :
                            grade === "A" ? "bg-emerald-500" :
                            grade === "B" ? "bg-blue-500" :
                            grade === "C" ? "bg-amber-500" : "bg-red-500"
                          : ""
                      }`}
                      onClick={() => updateReview.mutate({ reviewId: selectedReview.id, strategistRating: grade as any })}
                    >
                      {grade}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">评语</Label>
                  {editingField === "strategistFeedback" ? (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={saveEdit}>
                        <Save className="h-3 w-3 text-emerald-400" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={cancelEdit}>
                        <X className="h-3 w-3 text-red-400" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm" variant="ghost" className="h-6 w-6 p-0"
                      onClick={() => startEdit("strategistFeedback", selectedReview.strategistFeedback || "")}
                    >
                      <Edit2 className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  )}
                </div>
                {editingField === "strategistFeedback" ? (
                  <Textarea
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="text-xs min-h-[60px]"
                    placeholder="输入策划师评语..."
                  />
                ) : (
                  <div className="text-xs text-muted-foreground bg-muted/20 rounded-md p-2 min-h-[40px] whitespace-pre-wrap">
                    {selectedReview.strategistFeedback || <span className="italic">未填写</span>}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ═══ Create Review Dialog ═══ */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">新建执行复盘</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Period */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">复盘周期 *</Label>
                <Input
                  value={createForm.period}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, period: e.target.value }))}
                  placeholder="例: 2026-W16 或 04/14-04/20"
                  className="text-xs h-8"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">周期类型</Label>
                <Select value={createForm.periodType} onValueChange={(v) => setCreateForm(prev => ({ ...prev, periodType: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">周度</SelectItem>
                    <SelectItem value="monthly">月度</SelectItem>
                    <SelectItem value="quarterly">季度</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Load from plan (target only) */}
            {plans && plans.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">从运营计划加载目标数据</Label>
                <Select value={selectedPlanId} onValueChange={handleLoadFromPlan}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="选择运营计划..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">手动填写</SelectItem>
                    {plans.map((p: any) => (
                      <SelectItem key={p.id} value={p.id.toString()}>
                        {p.planName || p.planPeriod || `计划#${p.id}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Baseline data: auto-fetch by selecting week */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">基线数据（选择周度自动拓取）</p>
              <Select
                value={createForm.baselineWeekStart ? `${createForm.baselineWeekStart}_${createForm.baselineWeekEnd}` : "none"}
                onValueChange={handleBaselineWeekSelect}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="选择基线周度..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不设置基线</SelectItem>
                  {availableWeeks?.map((w: any, idx: number) => (
                    <SelectItem key={idx} value={`${w.weekStart}_${w.weekEnd}`}>
                      {w.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {loadingBaseline && (
                <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> 加载基线数据中...
                </div>
              )}
              {baselinePreview && (
                <div className="mt-2 p-2 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/50 dark:border-blue-800/50">
                  <p className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    已选择基线周度：{baselinePreview.weekLabel}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    创建复盘时将自动从导入的周度数据中拓取销售额、排名、利润率、转化率等基线指标
                  </p>
                </div>
              )}
            </div>

            {/* Target data */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">目标数据</p>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { key: "targetSales", label: "销售额($)" },
                  { key: "targetSubcategoryRank", label: "小类排名" },
                  { key: "targetConvRate", label: "转化率(%)" },
                  { key: "targetOrganicOrders", label: "自然单" },
                  { key: "targetAdOrders", label: "广告单" },
                  { key: "targetRatingScore", label: "评分" },
                  { key: "targetRatingCount", label: "Rating数量" },
                ].map(({ key, label }) => (
                  <div key={key} className="space-y-0.5">
                    <Label className="text-[10px] text-muted-foreground">{label}</Label>
                    <Input
                      value={(createForm as any)[key]}
                      onChange={(e) => setCreateForm(prev => ({ ...prev, [key]: e.target.value }))}
                      className="text-xs h-7"
                      type="text"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>取消</Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!createForm.period || createReview.isPending}
            >
              {createReview.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              创建复盘
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
