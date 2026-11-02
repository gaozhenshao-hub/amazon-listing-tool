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

/* ─── 2. Market Overview Result ─── */
export function MarketOverviewResult({ result, productCount }: { result: any; productCount: number }) {
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
