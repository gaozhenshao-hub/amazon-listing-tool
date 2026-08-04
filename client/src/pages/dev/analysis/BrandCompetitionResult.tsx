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

/* ─── 5. Brand Competition Result ─── */
export function BrandCompetitionResult({ result }: { result: any }) {
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
