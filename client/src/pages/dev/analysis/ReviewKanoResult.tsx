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

/* ─── 6. Review Kano Result ─── */
export function ReviewKanoResult({ result }: { result: any }) {
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
