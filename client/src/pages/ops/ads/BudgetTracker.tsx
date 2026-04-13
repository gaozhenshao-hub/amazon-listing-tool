import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  RadialBarChart, RadialBar,
} from "recharts";
import {
  History, Loader2, TrendingUp, TrendingDown, RefreshCw, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, AlertCircle, Clock, Award, BarChart3,
} from "lucide-react";

interface BudgetTrackerProps {
  marketplace?: string;
}

const DECISION_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  accepted: { label: "已采纳", color: "text-emerald-700 bg-emerald-50 border-emerald-200", icon: CheckCircle2 },
  modified: { label: "已修改", color: "text-blue-700 bg-blue-50 border-blue-200", icon: AlertCircle },
  rejected: { label: "已拒绝", color: "text-red-700 bg-red-50 border-red-200", icon: XCircle },
  partial: { label: "部分采纳", color: "text-amber-700 bg-amber-50 border-amber-200", icon: Clock },
};

function ScoreGauge({ score }: { score: number }) {
  const color = score >= 70 ? "#10b981" : score >= 40 ? "#f59e0b" : "#ef4444";
  const data = [{ name: "score", value: score, fill: color }];
  return (
    <div className="relative w-24 h-24">
      <RadialBarChart
        width={96} height={96} cx={48} cy={48}
        innerRadius={30} outerRadius={44} barSize={8}
        data={data} startAngle={90} endAngle={-270}
      >
        <RadialBar background dataKey="value" cornerRadius={4} />
      </RadialBarChart>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-bold" style={{ color }}>{score}</span>
      </div>
    </div>
  );
}

export default function BudgetTracker({ marketplace }: BudgetTrackerProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: historyData, isLoading, refetch } = trpc.adAnalysis.getBudgetTrackingHistory.useQuery(
    { marketplace, limit: 20 },
    { staleTime: 30000 }
  );

  const evaluateMutation = trpc.adAnalysis.evaluateBudgetEffect.useMutation({
    onSuccess: () => {
      toast.success("效果评估完成");
      refetch();
    },
    onError: (err) => toast.error(`评估失败: ${err.message}`),
  });

  const records = historyData?.records || [];

  // Summary stats
  const stats = useMemo(() => {
    if (records.length === 0) return null;
    const evaluated = records.filter((r: any) => r.followupEvaluatedAt);
    const avgScore = evaluated.length > 0
      ? Math.round(evaluated.reduce((s: number, r: any) => s + (r.effectScore || 0), 0) / evaluated.length)
      : 0;
    const totalSaved = records.reduce((s: number, r: any) => s + (r.totalBudgetBefore - r.totalBudgetAfter), 0);
    const acosImproved = evaluated.filter((r: any) => r.followupAcos < r.baselineAcos).length;
    return {
      totalRecords: records.length,
      evaluated: evaluated.length,
      avgScore,
      totalSaved: Math.round(totalSaved * 100) / 100,
      acosImproved,
      acosImprovedRate: evaluated.length > 0 ? Math.round(acosImproved / evaluated.length * 100) : 0,
    };
  }, [records]);

  // Trend chart data
  const trendData = useMemo(() => {
    return records
      .filter((r: any) => r.followupEvaluatedAt)
      .slice(0, 10)
      .reverse()
      .map((r: any) => ({
        date: new Date(r.createdAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric" }),
        基线ACoS: r.baselineAcos,
        执行后ACoS: r.followupAcos,
        评分: r.effectScore || 0,
      }));
  }, [records]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24" />
        <div className="grid grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-indigo-600" />
              <CardTitle className="text-base">预算执行效果追踪</CardTitle>
              <Badge variant="outline" className="text-[10px] bg-indigo-50 text-indigo-700 border-indigo-200">
                {records.length} 条记录
              </Badge>
            </div>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => refetch()}>
              <RefreshCw className="w-3 h-3" />
              刷新
            </Button>
          </div>
          <CardDescription className="text-xs mt-1">
            记录每次AI预算建议和用户确认结果，对比执行前后的ACoS/ROAS变化，验证AI建议的准确性。
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Stats Summary */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card className="bg-gradient-to-br from-indigo-50 to-indigo-100/50">
            <CardContent className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground">总建议次数</p>
              <p className="text-lg font-bold text-indigo-700">{stats.totalRecords}</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100/50">
            <CardContent className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground">已评估</p>
              <p className="text-lg font-bold text-emerald-700">{stats.evaluated}</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-amber-50 to-amber-100/50">
            <CardContent className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground">平均评分</p>
              <p className="text-lg font-bold text-amber-700">{stats.avgScore || "—"}</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100/50">
            <CardContent className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground">ACoS改善率</p>
              <p className="text-lg font-bold text-blue-700">{stats.acosImprovedRate}%</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-purple-50 to-purple-100/50">
            <CardContent className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground">累计预算调整</p>
              <p className={`text-lg font-bold ${stats.totalSaved >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                {stats.totalSaved >= 0 ? "-" : "+"}${Math.abs(stats.totalSaved).toFixed(0)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ACoS Trend Chart */}
      {trendData.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-indigo-600" />
              <CardTitle className="text-sm">ACoS变化趋势</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={trendData} margin={{ left: 10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} unit="%" />
                <Tooltip
                  contentStyle={{ fontSize: 11 }}
                  formatter={(v: number, name: string) => [`${v}%`, name]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="基线ACoS" fill="#94a3b8" radius={[2, 2, 0, 0]} />
                <Bar dataKey="执行后ACoS" fill="#6366f1" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* History Records */}
      {records.length > 0 ? (
        <div className="space-y-3">
          {records.map((record: any) => {
            const isExpanded = expandedId === record.id;
            const decision = DECISION_CONFIG[record.userDecision] || DECISION_CONFIG.accepted;
            const DecisionIcon = decision.icon;
            const hasFollowup = !!record.followupEvaluatedAt;
            const acosChange = hasFollowup && record.baselineAcos > 0
              ? Math.round((record.followupAcos - record.baselineAcos) / record.baselineAcos * 100)
              : null;
            const campaigns = record.campaignDecisions || [];

            return (
              <Card key={record.id} className={`transition-all ${isExpanded ? "ring-1 ring-indigo-200" : ""}`}>
                <CardContent className="p-0">
                  {/* Summary Row */}
                  <div
                    className="flex items-center gap-4 p-4 cursor-pointer hover:bg-gray-50/50"
                    onClick={() => setExpandedId(isExpanded ? null : record.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-gray-800">
                          {new Date(record.createdAt).toLocaleDateString("zh-CN")}
                          {" "}
                          {new Date(record.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <Badge variant="outline" className={`text-[10px] ${decision.color}`}>
                          <DecisionIcon className="w-2.5 h-2.5 mr-0.5" />
                          {decision.label}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {record.campaignCount}个活动
                        </Badge>
                        {record.marketplace && (
                          <Badge variant="outline" className="text-[10px] bg-gray-50">{record.marketplace}</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                        <span>预算: ${record.totalBudgetBefore.toFixed(0)} → ${record.totalBudgetAfter.toFixed(0)}</span>
                        <span>|</span>
                        <span>基线ACoS: {record.baselineAcos}%</span>
                        {hasFollowup && (
                          <>
                            <span>→</span>
                            <span className={acosChange !== null && acosChange < 0 ? "text-emerald-600 font-medium" : acosChange !== null && acosChange > 0 ? "text-red-600 font-medium" : ""}>
                              执行后: {record.followupAcos}%
                              {acosChange !== null && (
                                <span className="ml-1">({acosChange > 0 ? "+" : ""}{acosChange}%)</span>
                              )}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Score or Evaluate Button */}
                    <div className="flex items-center gap-3 shrink-0">
                      {hasFollowup ? (
                        <ScoreGauge score={record.effectScore || 0} />
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs gap-1 border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                          disabled={evaluateMutation.isPending}
                          onClick={(e) => {
                            e.stopPropagation();
                            evaluateMutation.mutate({ trackingId: record.id, marketplace: record.marketplace || undefined });
                          }}
                        >
                          {evaluateMutation.isPending ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3 h-3" />
                          )}
                          评估效果
                        </Button>
                      )}
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                    </div>
                  </div>

                  {/* Expanded Detail */}
                  {isExpanded && (
                    <div className="border-t px-4 pb-4 pt-3 space-y-3 bg-gray-50/30">
                      {/* Baseline vs Followup Comparison */}
                      {hasFollowup && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          {[
                            { label: "花费", baseline: record.baselineSpend, followup: record.followupSpend, prefix: "$", lower: true },
                            { label: "销售额", baseline: record.baselineSales, followup: record.followupSales, prefix: "$", lower: false },
                            { label: "ACoS", baseline: record.baselineAcos, followup: record.followupAcos, suffix: "%", lower: true },
                            { label: "ROAS", baseline: record.baselineRoas, followup: record.followupRoas, suffix: "x", lower: false },
                          ].map(({ label, baseline, followup, prefix, suffix, lower }) => {
                            const change = baseline > 0 ? Math.round((followup - baseline) / baseline * 100) : 0;
                            const improved = lower ? change < 0 : change > 0;
                            return (
                              <Card key={label} className="bg-white">
                                <CardContent className="p-3">
                                  <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
                                  <div className="flex items-baseline gap-2">
                                    <span className="text-xs text-gray-400 line-through">
                                      {prefix}{baseline.toFixed(baseline < 10 ? 2 : 0)}{suffix}
                                    </span>
                                    <span className="text-xs">→</span>
                                    <span className={`text-sm font-bold ${improved ? "text-emerald-600" : "text-red-600"}`}>
                                      {prefix}{followup.toFixed(followup < 10 ? 2 : 0)}{suffix}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1 mt-1">
                                    {improved ? (
                                      <TrendingUp className="w-3 h-3 text-emerald-500" />
                                    ) : (
                                      <TrendingDown className="w-3 h-3 text-red-500" />
                                    )}
                                    <span className={`text-[10px] font-medium ${improved ? "text-emerald-600" : "text-red-600"}`}>
                                      {change > 0 ? "+" : ""}{change}%
                                    </span>
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
                      )}

                      {/* Effect Summary */}
                      {record.effectSummary && (
                        <Card className="bg-white border-indigo-100">
                          <CardContent className="p-3">
                            <div className="flex items-start gap-2">
                              <Award className="w-4 h-4 text-indigo-600 mt-0.5 shrink-0" />
                              <div>
                                <p className="text-xs font-medium text-indigo-800 mb-1">AI效果评估</p>
                                <p className="text-xs text-gray-600 whitespace-pre-line">{record.effectSummary}</p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {/* Campaign Decisions Table */}
                      {campaigns.length > 0 && (
                        <div className="overflow-x-auto rounded-lg border bg-white">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b bg-gray-50/80">
                                <th className="text-left p-2 font-medium text-gray-600">广告活动</th>
                                <th className="text-center p-2 font-medium text-gray-600 w-16">操作</th>
                                <th className="text-right p-2 font-medium text-gray-600 w-20">原预算</th>
                                <th className="text-right p-2 font-medium text-gray-600 w-20">AI建议</th>
                                <th className="text-right p-2 font-medium text-gray-600 w-20">确认预算</th>
                                <th className="text-center p-2 font-medium text-gray-600 w-16">优先级</th>
                                <th className="text-left p-2 font-medium text-gray-600">理由</th>
                              </tr>
                            </thead>
                            <tbody>
                              {campaigns.map((c: any, i: number) => (
                                <tr key={i} className="border-b last:border-0">
                                  <td className="p-2 truncate max-w-[180px]">{c.campaignName}</td>
                                  <td className="p-2 text-center">
                                    <Badge variant="outline" className="text-[9px]">{c.action}</Badge>
                                  </td>
                                  <td className="p-2 text-right font-mono">${c.currentBudget}</td>
                                  <td className="p-2 text-right font-mono">${c.suggestedBudget}</td>
                                  <td className="p-2 text-right font-mono font-medium">${c.confirmedBudget}</td>
                                  <td className="p-2 text-center">
                                    <Badge variant="outline" className="text-[9px]">{c.priority}</Badge>
                                  </td>
                                  <td className="p-2 text-gray-500 truncate max-w-[200px]">{c.reason}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* User Notes */}
                      {record.userNotes && (
                        <p className="text-xs text-gray-500 italic">备注: {record.userNotes}</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <History className="w-12 h-12 mx-auto text-gray-300 mb-4" />
            <p className="text-sm font-medium text-gray-500 mb-2">暂无预算调整记录</p>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              在"预算分配"页签中使用AI分析并确认预算方案后，记录将自动保存在此处。
              您可以随时评估执行效果，验证AI建议的准确性。
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
