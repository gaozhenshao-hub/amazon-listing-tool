import { useMemo, useState } from "react";
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

/* ─── 4. Price Analysis Result ─── */
export function PriceAnalysisResult({ result }: { result: any }) {
  const segments = result.priceSegments || [];
  const ai = result.ai || {};

  const segChartData = segments.map((s: any) => ({
    range: s.range,
    asinCount: s.asinCount || s.count || 0,
    avgPrice: s.avgPrice || 0,
    avgMonthlySales: s.avgMonthlySales || 0,
    avgMonthlyRevenue: s.avgMonthlyRevenue || 0,
    competitorCount: s.competitorCount || 0,
    recentNewCount: s.recentNewCount || 0,
    recentNewPct: s.recentNewPct || 0,
    salesShare: s.salesShare || 0,
  }));

  // Collect all tag dimensions across segments
  const allDimensions = useMemo(() => {
    const dims = new Set<string>();
    for (const seg of segments) {
      if (seg.tagDistribution) {
        for (const dim of Object.keys(seg.tagDistribution)) dims.add(dim);
      }
    }
    return Array.from(dims);
  }, [segments]);

  const [selectedTagDim, setSelectedTagDim] = useState<string>(allDimensions[0] || "");

  // Build tag distribution chart data for selected dimension
  const tagDistChartData = useMemo(() => {
    if (!selectedTagDim) return [];
    return segments.map((seg: any) => {
      const dist = seg.tagDistribution?.[selectedTagDim] || {};
      return { range: seg.range, ...dist };
    });
  }, [segments, selectedTagDim]);

  // Get all tag values for the selected dimension
  const tagValues = useMemo(() => {
    if (!selectedTagDim) return [];
    const vals = new Set<string>();
    for (const seg of segments) {
      const dist = seg.tagDistribution?.[selectedTagDim] || {};
      for (const v of Object.keys(dist)) vals.add(v);
    }
    return Array.from(vals);
  }, [segments, selectedTagDim]);

  return (
    <div className="space-y-4">
      {/* Row 1: Core metrics charts */}
      {segChartData.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">价格段产品分布 & 竞对数量</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={segChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="range" tick={{ fontSize: 10 }} angle={-15} textAnchor="end" height={45} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="asinCount" fill="#10b981" name="产品数" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="competitorCount" fill="#6366f1" name="竞对数量(品牌)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">近半年上新 & 月均销量</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={segChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="range" tick={{ fontSize: 10 }} angle={-15} textAnchor="end" height={45} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey="recentNewCount" fill="#ef4444" name="近半年上新" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="right" dataKey="avgMonthlySales" fill="#f59e0b" name="均月销" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Table - Enhanced with new columns */}
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
                    <th className="text-right p-2 font-medium">竞对数量</th>
                    <th className="text-right p-2 font-medium">近半年上新</th>
                    <th className="text-right p-2 font-medium">上新占比</th>
                    <th className="text-right p-2 font-medium">均价</th>
                    <th className="text-right p-2 font-medium">均评分</th>
                    <th className="text-right p-2 font-medium">均评论</th>
                    <th className="text-right p-2 font-medium">均月销</th>
                    <th className="text-right p-2 font-medium">销量占比</th>
                    <th className="text-right p-2 font-medium">均月销售额</th>
                  </tr>
                </thead>
                <tbody>
                  {segments.map((seg: any, i: number) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="p-2 font-medium">{seg.range}</td>
                      <td className="p-2 text-right">{seg.asinCount ?? seg.count ?? 0}</td>
                      <td className="p-2 text-right">
                        <span className="inline-flex items-center gap-1">
                          <Building2 className="h-3 w-3 text-indigo-500" />
                          {seg.competitorCount ?? "--"}
                        </span>
                      </td>
                      <td className="p-2 text-right">
                        <span className={`font-medium ${(seg.recentNewCount || 0) > 3 ? "text-red-500" : "text-green-600"}`}>
                          {seg.recentNewCount ?? 0}
                        </span>
                      </td>
                      <td className="p-2 text-right">
                        {seg.recentNewPct != null ? `${(seg.recentNewPct * 100).toFixed(0)}%` : "--"}
                      </td>
                      <td className="p-2 text-right">${seg.avgPrice?.toFixed(2) ?? "--"}</td>
                      <td className="p-2 text-right">{seg.avgRating?.toFixed(1) ?? "--"}</td>
                      <td className="p-2 text-right">{seg.avgReviewCount ?? seg.avgReviews ?? "--"}</td>
                      <td className="p-2 text-right">{seg.avgMonthlySales ?? "--"}</td>
                      <td className="p-2 text-right">
                        {seg.salesShare != null ? `${(seg.salesShare * 100).toFixed(1)}%` : "--"}
                      </td>
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

      {/* Tag Distribution Chart */}
      {allDimensions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />各价格段标签分布
              </CardTitle>
              <div className="flex gap-1 flex-wrap">
                {allDimensions.map(dim => (
                  <Badge
                    key={dim}
                    variant={selectedTagDim === dim ? "default" : "outline"}
                    className="cursor-pointer text-xs"
                    onClick={() => setSelectedTagDim(dim)}
                  >
                    {dim}
                  </Badge>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {tagDistChartData.length > 0 && tagValues.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={tagDistChartData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="range" tick={{ fontSize: 10 }} angle={-15} textAnchor="end" height={45} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
                  <Tooltip formatter={(value: number) => `${(value * 100).toFixed(1)}%`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {tagValues.slice(0, 8).map((val, idx) => (
                    <Bar key={val} dataKey={val} stackId="a" fill={CHART_COLORS[idx % CHART_COLORS.length]} name={val} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">无标签分布数据</p>
            )}
          </CardContent>
        </Card>
      )}

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

      {/* AI Tag Recommendations */}
      {Array.isArray(ai.tagRecommendations) && ai.tagRecommendations.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />AI推荐标签配置
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {ai.tagRecommendations.map((rec: any, i: number) => (
                <div key={i} className="border rounded-lg p-3 bg-muted/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className="text-xs font-semibold">{rec.priceRange}</Badge>
                    <span className="text-xs text-muted-foreground">推荐标签组合</span>
                  </div>
                  <div className="space-y-1.5">
                    {(rec.recommendedTags || []).map((tag: any, j: number) => (
                      <div key={j} className="flex items-start gap-2">
                        <Badge variant="secondary" className="text-xs shrink-0">{tag.dimension}</Badge>
                        <span className="text-xs font-medium text-primary">{tag.value}</span>
                        {tag.reason && <span className="text-xs text-muted-foreground ml-auto">{tag.reason}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
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
