import type * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ArrowRight, BarChart3, Brain, Check, Edit3, Loader2, Lock, Unlock, Play, RefreshCw, TrendingUp, DollarSign, Building2, MessageSquare, LayoutDashboard, Grid3X3, Sparkles } from "lucide-react";
import { Streamdown } from "streamdown";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ScatterChart, Scatter, ZAxis, LineChart, Line } from "recharts";
import { CHART_COLORS, DEV_ANALYSIS_STAGES as STAGES, type DevAnalysisStageKey as StageKey } from "./stageDefinitions";

/* ─── 7. Decision Dashboard Result ─── */
export function DecisionDashboardResult({ result }: { result: any }) {
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
