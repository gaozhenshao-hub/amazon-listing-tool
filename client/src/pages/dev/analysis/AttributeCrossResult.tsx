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

/* ─── 3. Attribute Cross Result ─── */
export function AttributeCrossResult({ result }: { result: any }) {
  // Backend returns: singleDimStats as array of { dimensionName, values: [...] }
  // crossResult as { dim1Name, dim2Name, dim1Values, dim2Values, matrix: [...], hotCombinations, blueOcean }
  const singleDimStatsRaw = result.singleDimStats || [];
  const crossResult = result.crossResult;
  const ai = result.ai || {};
  const selectedDims = result.selectedDims || {};

  // Normalize singleDimStats: could be array (new format) or object (old format)
  const singleDimStats: Array<{ dimensionName: string; values: any[] }> = Array.isArray(singleDimStatsRaw)
    ? singleDimStatsRaw
    : Object.entries(singleDimStatsRaw).map(([dim, data]: any) => ({
        dimensionName: dim,
        values: typeof data === "object" && !Array.isArray(data)
          ? Object.entries(data).map(([val, stats]: any) => ({ value: val, asinCount: stats.count || 0, avgPrice: stats.avgPrice || 0, avgRating: stats.avgRating || 0, salesShare: stats.pct ? stats.pct / 100 : 0, totalSales: stats.avgMonthlySales || 0, totalRevenue: 0 }))
          : data?.values || [],
      }));

  // Build heatmap data from cross matrix
  const heatmapEntries: Array<{ combo: string; count: number; totalSales: number; avgPrice: number; totalRevenue: number }> = [];
  if (crossResult?.matrix && Array.isArray(crossResult.matrix)) {
    // New format: matrix is an array of CrossAnalysisCell
    for (const cell of crossResult.matrix) {
      if (cell.asinCount > 0) {
        heatmapEntries.push({
          combo: `${cell.dim1Value} × ${cell.dim2Value}`,
          count: cell.asinCount,
          totalSales: cell.totalSales || 0,
          avgPrice: cell.avgPrice || 0,
          totalRevenue: cell.totalRevenue || 0,
        });
      }
    }
  } else if (crossResult && typeof crossResult === "object") {
    // Old format: nested object
    Object.entries(crossResult).forEach(([, matrix]: any) => {
      if (typeof matrix === "object" && !Array.isArray(matrix)) {
        Object.entries(matrix).forEach(([combo, data]: any) => {
          if (typeof data === "object") {
            heatmapEntries.push({ combo, count: data.count || 0, totalSales: data.avgMonthlySales || 0, avgPrice: data.avgPrice || 0, totalRevenue: 0 });
          }
        });
      }
    });
  }
  const topCombos = heatmapEntries.sort((a, b) => b.totalSales - a.totalSales).slice(0, 15);

  // Hot combinations from crossResult
  const hotCombinations = crossResult?.hotCombinations || [];
  const blueOcean = crossResult?.blueOcean || [];

  return (
    <div className="space-y-4">
      {/* Single Dimension Stats with Bar Charts */}
      {singleDimStats.length > 0 && singleDimStats.map((dimStat: any) => {
        const dim = dimStat.dimensionName;
        const values = dimStat.values || [];
        if (values.length === 0) return null;
        const sortedValues = [...values].sort((a: any, b: any) => (b.asinCount || 0) - (a.asinCount || 0));
        const chartData = sortedValues.map((v: any) => ({ name: v.value, count: v.asinCount, avgPrice: v.avgPrice, avgSales: v.totalSales || 0 }));
        const totalCount = sortedValues.reduce((s: number, v: any) => s + (v.asinCount || 0), 0);
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
                      {sortedValues.map((v: any) => (
                        <tr key={v.value} className="border-b last:border-0">
                          <td className="p-1.5 font-medium">{v.value}</td>
                          <td className="p-1.5 text-right">{v.asinCount}</td>
                          <td className="p-1.5 text-right">{totalCount > 0 ? ((v.asinCount / totalCount) * 100).toFixed(1) : 0}%</td>
                          <td className="p-1.5 text-right">${v.avgPrice?.toFixed(2) ?? "--"}</td>
                          <td className="p-1.5 text-right">{v.avgRating?.toFixed(1) ?? "--"}</td>
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
            <ResponsiveContainer width="100%" height={Math.max(320, topCombos.length * 28)}>
              <BarChart data={topCombos} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="combo" tick={{ fontSize: 9 }} width={140} />
                <Tooltip formatter={(value: any, name: string) => [typeof value === 'number' ? value.toLocaleString() : value, name]} />
                <Bar dataKey="totalSales" fill="#10b981" name="总月销" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Hot Combinations */}
      {hotCombinations.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4 text-orange-500" />热门属性组合 TOP10</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 font-medium">排名</th>
                    <th className="text-left p-2 font-medium">属性组合</th>
                    <th className="text-right p-2 font-medium">产品数</th>
                    <th className="text-right p-2 font-medium">总月销</th>
                    <th className="text-right p-2 font-medium">总月销额</th>
                  </tr>
                </thead>
                <tbody>
                  {hotCombinations.map((h: any, i: number) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="p-2"><Badge variant="secondary" className="text-xs">#{i + 1}</Badge></td>
                      <td className="p-2 font-medium">{h.combo}</td>
                      <td className="p-2 text-right">{h.asinCount}</td>
                      <td className="p-2 text-right">{h.sales?.toLocaleString() ?? "--"}</td>
                      <td className="p-2 text-right">${h.revenue?.toLocaleString() ?? "--"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Blue Ocean Opportunities */}
      {blueOcean.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4 text-blue-500" />蓝海机会（低竞争高潜力）</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {blueOcean.map((b: any, i: number) => (
                <div key={i} className="flex items-center gap-3 p-2.5 bg-blue-50 dark:bg-blue-900/10 rounded-lg">
                  <span className="text-blue-500 font-bold">#{i + 1}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{b.combo}</p>
                    <div className="flex gap-2 mt-1">
                      <Badge variant="outline" className="text-xs">产品数: {b.asinCount}</Badge>
                      <Badge variant="outline" className="text-xs">均月销: {b.avgSales?.toLocaleString()}</Badge>
                      <Badge className={`text-xs ${b.opportunity === '高机会' ? 'bg-emerald-100 text-emerald-700' : b.opportunity === '中机会' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-700'}`}>{b.opportunity}</Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Full Cross Matrix Table */}
      {crossResult?.matrix && crossResult.matrix.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">属性交叉矩阵详表 ({selectedDims?.dim1 || crossResult.dim1Name} × {selectedDims?.dim2 || crossResult.dim2Name})</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 font-medium">{selectedDims?.dim1 || crossResult.dim1Name || "维度1"}</th>
                    <th className="text-left p-2 font-medium">{selectedDims?.dim2 || crossResult.dim2Name || "维度2"}</th>
                    <th className="text-right p-2 font-medium">产品数</th>
                    <th className="text-right p-2 font-medium">均价</th>
                    <th className="text-right p-2 font-medium">总月销</th>
                    <th className="text-right p-2 font-medium">总月销额</th>
                  </tr>
                </thead>
                <tbody>
                  {[...crossResult.matrix]
                    .filter((c: any) => c.asinCount > 0)
                    .sort((a: any, b: any) => (b.totalRevenue || 0) - (a.totalRevenue || 0))
                    .slice(0, 30)
                    .map((cell: any, i: number) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="p-2 font-medium">{cell.dim1Value}</td>
                      <td className="p-2">{cell.dim2Value}</td>
                      <td className="p-2 text-right">{cell.asinCount}</td>
                      <td className="p-2 text-right">${cell.avgPrice?.toFixed(2) ?? "--"}</td>
                      <td className="p-2 text-right">{cell.totalSales?.toLocaleString() ?? "--"}</td>
                      <td className="p-2 text-right">${cell.totalRevenue?.toLocaleString() ?? "--"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
