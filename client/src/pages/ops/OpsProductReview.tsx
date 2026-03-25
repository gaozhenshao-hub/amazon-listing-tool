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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, Trash2, Loader2, Brain, TrendingUp, TrendingDown, Minus,
  Target, BarChart3, FileText, Calendar, Award, ChevronDown, ChevronUp,
  Edit2, Save, X,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, LineChart, Line,
} from "recharts";

interface Props {
  productId: number;
  parentAsin: string;
}

export default function OpsProductReview({ productId, parentAsin }: Props) {
  const { data: reviews, refetch, isLoading } = trpc.productOps.listExecutionReviews.useQuery(
    { productProfileId: productId }
  );

  const createReview = trpc.productOps.createExecutionReview.useMutation({
    onSuccess: () => { refetch(); setShowCreate(false); toast.success("复盘记录已创建"); },
  });
  const updateReview = trpc.productOps.updateExecutionReview.useMutation({
    onSuccess: () => { refetch(); toast.success("复盘已更新"); },
  });
  const deleteReview = trpc.productOps.deleteExecutionReview.useMutation({
    onSuccess: () => { refetch(); setSelectedReviewId(null); toast.success("复盘已删除"); },
  });
  const aiAnalysis = trpc.productOps.aiReviewAnalysis.useMutation({
    onSuccess: () => { refetch(); toast.success("AI复盘分析完成"); },
  });
  const syncReview = trpc.productOps.syncReviewFromLingxing.useMutation({
    onSuccess: (data) => {
      refetch();
      toast.success(`复盘数据已从领星同步 (基线: ${data.dateRanges.baseline.start}~${data.dateRanges.baseline.end}, 实际: ${data.dateRanges.actual.start}~${data.dateRanges.actual.end})`);
    },
    onError: (err) => { toast.error(`同步失败: ${err.message}`); },
  });

  const [showCreate, setShowCreate] = useState(false);
  const [selectedReviewId, setSelectedReviewId] = useState<number | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showCompare, setShowCompare] = useState(false);

  const selectedReview = reviews?.find((r: any) => r.id === selectedReviewId) || reviews?.[0];

  const [createForm, setCreateForm] = useState({
    period: "", periodType: "monthly" as string,
    baselineSales: 0, baselineProfit: 0, baselineOrderConvRate: 0,
    baselineSearchConvRate: 0, baselineAdConvRate: 0,
    targetSales: 0, targetProfit: 0,
    actualSales: 0, actualProfit: 0, actualOrderConvRate: 0,
    actualSearchConvRate: 0, actualAdConvRate: 0,
  });

  // ─── Computed ───
  const achievementRates = useMemo(() => {
    if (!selectedReview) return null;
    const salesRate = selectedReview.targetSales ? (Number(selectedReview.actualSales || 0) / Number(selectedReview.targetSales) * 100) : 0;
    const profitRate = selectedReview.targetProfit ? (Number(selectedReview.actualProfit || 0) / Number(selectedReview.targetProfit) * 100) : 0;
    const orderConvDelta = Number(selectedReview.actualOrderConvRate || 0) - Number(selectedReview.baselineOrderConvRate || 0);
    const searchConvDelta = Number(selectedReview.actualSearchConvRate || 0) - Number(selectedReview.baselineSearchConvRate || 0);
    const adConvDelta = Number(selectedReview.actualAdConvRate || 0) - Number(selectedReview.baselineAdConvRate || 0);
    return { salesRate, profitRate, orderConvDelta, searchConvDelta, adConvDelta };
  }, [selectedReview]);

  const radarData = useMemo(() => {
    if (!selectedReview) return [];
    return [
      { metric: "销售额达成", baseline: 100, actual: achievementRates?.salesRate || 0 },
      { metric: "利润达成", baseline: 100, actual: achievementRates?.profitRate || 0 },
      { metric: "订单转化率", baseline: (selectedReview.baselineOrderConvRate || 0), actual: (selectedReview.actualOrderConvRate || 0) },
      { metric: "搜索转化率", baseline: (selectedReview.baselineSearchConvRate || 0), actual: (selectedReview.actualSearchConvRate || 0) },
      { metric: "广告转化率", baseline: (selectedReview.baselineAdConvRate || 0), actual: (selectedReview.actualAdConvRate || 0) },
    ];
  }, [selectedReview, achievementRates]);

  const multiPeriodData = useMemo(() => {
    if (!reviews || reviews.length < 2) return [];
    return reviews.slice().reverse().map((r: any) => ({
      period: r.period,
      sales: r.actualSales || 0,
      profit: r.actualProfit || 0,
      orderConv: r.actualOrderConvRate || 0,
      searchConv: r.actualSearchConvRate || 0,
      adConv: r.actualAdConvRate || 0,
    }));
  }, [reviews]);

  const getAchievementBadge = (rate: number) => {
    if (rate >= 100) return <Badge className="bg-emerald-100 text-emerald-700">达标 {rate.toFixed(1)}%</Badge>;
    if (rate >= 80) return <Badge className="bg-amber-100 text-amber-700">接近 {rate.toFixed(1)}%</Badge>;
    return <Badge className="bg-red-100 text-red-700">未达标 {rate.toFixed(1)}%</Badge>;
  };

  const getDeltaIcon = (delta: number) => {
    if (delta > 0) return <TrendingUp className="h-4 w-4 text-emerald-600" />;
    if (delta < 0) return <TrendingDown className="h-4 w-4 text-red-600" />;
    return <Minus className="h-4 w-4 text-gray-400" />;
  };

  const startEdit = (field: string, value: string) => {
    setEditingField(field);
    setEditValue(value);
  };

  const saveEdit = () => {
    if (!selectedReview || !editingField) return;
    updateReview.mutate({
      reviewId: selectedReview.id,
      [editingField]: editValue,
    });
    setEditingField(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Target className="h-5 w-5 text-orange-600" />
            执行复盘
          </h3>
          {reviews && reviews.length > 1 && (
            <Select value={String(selectedReview?.id || "")} onValueChange={v => setSelectedReviewId(Number(v))}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="选择复盘期" />
              </SelectTrigger>
              <SelectContent>
                {reviews.map((r: any) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.period} ({r.periodType === "monthly" ? "月度" : r.periodType === "quarterly" ? "季度" : "年度"})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedReview && (
            <Button size="sm" variant="outline" className="gap-1"
              disabled={syncReview.isPending}
              onClick={() => syncReview.mutate({
                reviewId: selectedReview.id,
                productId,
                periodType: (selectedReview.periodType || 'monthly') as any,
                syncTarget: 'both',
              })}>
              {syncReview.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <TrendingUp className="h-3 w-3" />}
              同步领星数据
            </Button>
          )}
          {reviews && reviews.length >= 2 && (
            <Button size="sm" variant="outline" onClick={() => setShowCompare(!showCompare)}>
              <BarChart3 className="h-3 w-3 mr-1" />
              {showCompare ? "隐藏多期对比" : "多期对比"}
            </Button>
          )}
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-3 w-3 mr-1" /> 新建复盘
          </Button>
        </div>
      </div>

      {/* Multi-period comparison */}
      {showCompare && multiPeriodData.length >= 2 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">多期数据对比</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium mb-2">销售额 & 利润趋势</p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={multiPeriodData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="sales" name="销售额" fill="#3b82f6" />
                    <Bar dataKey="profit" name="利润" fill="#10b981" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div>
                <p className="text-sm font-medium mb-2">转化率趋势</p>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={multiPeriodData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="orderConv" name="订单转化率" stroke="#8b5cf6" strokeWidth={2} />
                    <Line type="monotone" dataKey="searchConv" name="搜索转化率" stroke="#f59e0b" strokeWidth={2} />
                    <Line type="monotone" dataKey="adConv" name="广告转化率" stroke="#ef4444" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!selectedReview ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Target className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">创建复盘记录，对比基线与实际数据，AI自动分析达成情况</p>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-2" /> 创建首次复盘
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Achievement Overview */}
          <div className="grid grid-cols-5 gap-3">
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">销售额达成</p>
                <div className="text-2xl font-bold text-blue-600">{achievementRates?.salesRate.toFixed(1)}%</div>
                <div className="mt-1">{getAchievementBadge(achievementRates?.salesRate || 0)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">利润达成</p>
                <div className="text-2xl font-bold text-emerald-600">{achievementRates?.profitRate.toFixed(1)}%</div>
                <div className="mt-1">{getAchievementBadge(achievementRates?.profitRate || 0)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">订单转化率变化</p>
                <div className="flex items-center justify-center gap-1">
                  {getDeltaIcon(achievementRates?.orderConvDelta || 0)}
                  <span className="text-lg font-bold">{(achievementRates?.orderConvDelta || 0) > 0 ? "+" : ""}{achievementRates?.orderConvDelta.toFixed(2)}%</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">搜索转化率变化</p>
                <div className="flex items-center justify-center gap-1">
                  {getDeltaIcon(achievementRates?.searchConvDelta || 0)}
                  <span className="text-lg font-bold">{(achievementRates?.searchConvDelta || 0) > 0 ? "+" : ""}{achievementRates?.searchConvDelta.toFixed(2)}%</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">广告转化率变化</p>
                <div className="flex items-center justify-center gap-1">
                  {getDeltaIcon(achievementRates?.adConvDelta || 0)}
                  <span className="text-lg font-bold">{(achievementRates?.adConvDelta || 0) > 0 ? "+" : ""}{achievementRates?.adConvDelta.toFixed(2)}%</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Data Comparison Table + Radar */}
          <div className="grid grid-cols-3 gap-4">
            <Card className="col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">基线 vs 实际 数据对比</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>指标</TableHead>
                      <TableHead className="text-right">基线(基期)</TableHead>
                      <TableHead className="text-right">目标</TableHead>
                      <TableHead className="text-right">实际</TableHead>
                      <TableHead className="text-right">达成率</TableHead>
                      <TableHead className="text-right">变化</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-medium">销售额</TableCell>
                      <TableCell className="text-right">${(selectedReview.baselineSales || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right text-blue-600">${(selectedReview.targetSales || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right font-medium">${(selectedReview.actualSales || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right">{getAchievementBadge(achievementRates?.salesRate || 0)}</TableCell>
                      <TableCell className="text-right">{getDeltaIcon(Number(selectedReview.actualSales || 0) - Number(selectedReview.baselineSales || 0))}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">利润</TableCell>
                      <TableCell className="text-right">${(selectedReview.baselineProfit || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right text-blue-600">${(selectedReview.targetProfit || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right font-medium">${(selectedReview.actualProfit || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right">{getAchievementBadge(achievementRates?.profitRate || 0)}</TableCell>
                      <TableCell className="text-right">{getDeltaIcon(Number(selectedReview.actualProfit || 0) - Number(selectedReview.baselineProfit || 0))}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">订单转化率</TableCell>
                      <TableCell className="text-right">{selectedReview.baselineOrderConvRate || 0}%</TableCell>
                      <TableCell className="text-right text-muted-foreground">—</TableCell>
                      <TableCell className="text-right font-medium">{selectedReview.actualOrderConvRate || 0}%</TableCell>
                      <TableCell className="text-right">—</TableCell>
                      <TableCell className="text-right">
                        <span className={`${(achievementRates?.orderConvDelta || 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          {(achievementRates?.orderConvDelta || 0) > 0 ? "+" : ""}{achievementRates?.orderConvDelta.toFixed(2)}%
                        </span>
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">搜索转化率</TableCell>
                      <TableCell className="text-right">{selectedReview.baselineSearchConvRate || 0}%</TableCell>
                      <TableCell className="text-right text-muted-foreground">—</TableCell>
                      <TableCell className="text-right font-medium">{selectedReview.actualSearchConvRate || 0}%</TableCell>
                      <TableCell className="text-right">—</TableCell>
                      <TableCell className="text-right">
                        <span className={`${(achievementRates?.searchConvDelta || 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          {(achievementRates?.searchConvDelta || 0) > 0 ? "+" : ""}{achievementRates?.searchConvDelta.toFixed(2)}%
                        </span>
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">广告转化率</TableCell>
                      <TableCell className="text-right">{selectedReview.baselineAdConvRate || 0}%</TableCell>
                      <TableCell className="text-right text-muted-foreground">—</TableCell>
                      <TableCell className="text-right font-medium">{selectedReview.actualAdConvRate || 0}%</TableCell>
                      <TableCell className="text-right">—</TableCell>
                      <TableCell className="text-right">
                        <span className={`${(achievementRates?.adConvDelta || 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          {(achievementRates?.adConvDelta || 0) > 0 ? "+" : ""}{achievementRates?.adConvDelta.toFixed(2)}%
                        </span>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">达成雷达图</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <RadarChart data={radarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
                    <PolarRadiusAxis tick={{ fontSize: 10 }} />
                    <Radar name="基线" dataKey="baseline" stroke="#94a3b8" fill="#94a3b8" fillOpacity={0.2} />
                    <Radar name="实际" dataKey="actual" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
                    <Legend />
                    <Tooltip />
                  </RadarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Summary & Key Actions */}
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Award className="h-4 w-4 text-amber-600" />
                    成就总结
                  </CardTitle>
                  {editingField !== "achievementSummary" && (
                    <Button size="sm" variant="ghost" onClick={() => startEdit("achievementSummary", selectedReview.achievementSummary || "")}>
                      <Edit2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {editingField === "achievementSummary" ? (
                  <div className="space-y-2">
                    <Textarea value={editValue} onChange={e => setEditValue(e.target.value)} rows={4} />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveEdit}><Save className="h-3 w-3 mr-1" /> 保存</Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingField(null)}><X className="h-3 w-3" /></Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {selectedReview.achievementSummary || "点击编辑按钮添加成就总结..."}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="h-4 w-4 text-blue-600" />
                    关键动作
                  </CardTitle>
                  {editingField !== "keyActions" && (
                    <Button size="sm" variant="ghost" onClick={() => startEdit("keyActions", selectedReview.keyActions || "")}>
                      <Edit2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {editingField === "keyActions" ? (
                  <div className="space-y-2">
                    <Textarea value={editValue} onChange={e => setEditValue(e.target.value)} rows={4} />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveEdit}><Save className="h-3 w-3 mr-1" /> 保存</Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingField(null)}><X className="h-3 w-3" /></Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {selectedReview.keyActions || "点击编辑按钮添加关键动作..."}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* AI Analysis */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Brain className="h-4 w-4 text-purple-600" />
                  游戏策划师 AI复盘分析
                </CardTitle>
                <Button size="sm" variant="outline" onClick={() => aiAnalysis.mutate({ reviewId: selectedReview.id })} disabled={aiAnalysis.isPending}>
                  {aiAnalysis.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Brain className="h-3 w-3 mr-1" />}
                  {selectedReview.aiAnalysis ? "重新分析" : "AI分析"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {selectedReview.aiAnalysis ? (
                <div className="prose prose-sm max-w-none">
                  <div className="bg-purple-50/50 border border-purple-100 rounded-lg p-4 text-sm whitespace-pre-wrap">
                    {selectedReview.aiAnalysis}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  点击"AI分析"按钮，游戏策划师将基于复盘数据生成深度分析报告
                </p>
              )}
            </CardContent>
          </Card>

          {/* Delete */}
          <div className="flex justify-end">
            <Button size="sm" variant="destructive" onClick={() => {
              if (confirm("确定删除此复盘记录？")) deleteReview.mutate({ reviewId: selectedReview.id });
            }}>
              <Trash2 className="h-3 w-3 mr-1" /> 删除此复盘
            </Button>
          </div>
        </>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>新建执行复盘</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>复盘期间 *</Label>
                <Input value={createForm.period} onChange={e => setCreateForm(f => ({ ...f, period: e.target.value }))} placeholder="如：2026年Q1" />
              </div>
              <div>
                <Label>周期类型</Label>
                <Select value={createForm.periodType} onValueChange={v => setCreateForm(f => ({ ...f, periodType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">月度</SelectItem>
                    <SelectItem value="quarterly">季度</SelectItem>
                    <SelectItem value="yearly">年度</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="border rounded-lg p-3">
              <p className="text-sm font-medium mb-2">基线数据（基期）</p>
              <div className="grid grid-cols-5 gap-2">
                <div>
                  <Label className="text-xs">销售额($)</Label>
                  <Input type="number" value={createForm.baselineSales} onChange={e => setCreateForm(f => ({ ...f, baselineSales: Number(e.target.value) }))} />
                </div>
                <div>
                  <Label className="text-xs">利润($)</Label>
                  <Input type="number" value={createForm.baselineProfit} onChange={e => setCreateForm(f => ({ ...f, baselineProfit: Number(e.target.value) }))} />
                </div>
                <div>
                  <Label className="text-xs">订单转化率(%)</Label>
                  <Input type="number" step="0.01" value={createForm.baselineOrderConvRate} onChange={e => setCreateForm(f => ({ ...f, baselineOrderConvRate: Number(e.target.value) }))} />
                </div>
                <div>
                  <Label className="text-xs">搜索转化率(%)</Label>
                  <Input type="number" step="0.01" value={createForm.baselineSearchConvRate} onChange={e => setCreateForm(f => ({ ...f, baselineSearchConvRate: Number(e.target.value) }))} />
                </div>
                <div>
                  <Label className="text-xs">广告转化率(%)</Label>
                  <Input type="number" step="0.01" value={createForm.baselineAdConvRate} onChange={e => setCreateForm(f => ({ ...f, baselineAdConvRate: Number(e.target.value) }))} />
                </div>
              </div>
            </div>

            <div className="border rounded-lg p-3">
              <p className="text-sm font-medium mb-2">目标数据</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">目标销售额($)</Label>
                  <Input type="number" value={createForm.targetSales} onChange={e => setCreateForm(f => ({ ...f, targetSales: Number(e.target.value) }))} />
                </div>
                <div>
                  <Label className="text-xs">目标利润($)</Label>
                  <Input type="number" value={createForm.targetProfit} onChange={e => setCreateForm(f => ({ ...f, targetProfit: Number(e.target.value) }))} />
                </div>
              </div>
            </div>

            <div className="border rounded-lg p-3">
              <p className="text-sm font-medium mb-2">实际数据（当期）</p>
              <div className="grid grid-cols-5 gap-2">
                <div>
                  <Label className="text-xs">实际销售额($)</Label>
                  <Input type="number" value={createForm.actualSales} onChange={e => setCreateForm(f => ({ ...f, actualSales: Number(e.target.value) }))} />
                </div>
                <div>
                  <Label className="text-xs">实际利润($)</Label>
                  <Input type="number" value={createForm.actualProfit} onChange={e => setCreateForm(f => ({ ...f, actualProfit: Number(e.target.value) }))} />
                </div>
                <div>
                  <Label className="text-xs">订单转化率(%)</Label>
                  <Input type="number" step="0.01" value={createForm.actualOrderConvRate} onChange={e => setCreateForm(f => ({ ...f, actualOrderConvRate: Number(e.target.value) }))} />
                </div>
                <div>
                  <Label className="text-xs">搜索转化率(%)</Label>
                  <Input type="number" step="0.01" value={createForm.actualSearchConvRate} onChange={e => setCreateForm(f => ({ ...f, actualSearchConvRate: Number(e.target.value) }))} />
                </div>
                <div>
                  <Label className="text-xs">广告转化率(%)</Label>
                  <Input type="number" step="0.01" value={createForm.actualAdConvRate} onChange={e => setCreateForm(f => ({ ...f, actualAdConvRate: Number(e.target.value) }))} />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>取消</Button>
            <Button disabled={!createForm.period || createReview.isPending} onClick={() => {
              createReview.mutate({
                productProfileId: productId,
                period: createForm.period,
                periodType: createForm.periodType as "monthly" | "quarterly" | "weekly",
                baselineSales: String(createForm.baselineSales),
                baselineProfit: String(createForm.baselineProfit),
                baselineOrderConvRate: String(createForm.baselineOrderConvRate),
                baselineSearchConvRate: String(createForm.baselineSearchConvRate),
                baselineAdConvRate: String(createForm.baselineAdConvRate),
                targetSales: String(createForm.targetSales),
                targetProfit: String(createForm.targetProfit),
              }, {
                onSuccess: (data) => {
                  // After create, update with actual data
                  updateReview.mutate({
                    reviewId: data.id,
                    actualSales: String(createForm.actualSales),
                    actualProfit: String(createForm.actualProfit),
                    actualOrderConvRate: String(createForm.actualOrderConvRate),
                    actualSearchConvRate: String(createForm.actualSearchConvRate),
                    actualAdConvRate: String(createForm.actualAdConvRate),
                  });
                },
              });
            }}>
              {createReview.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              创建复盘
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
