import React, { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, Cell,
} from "recharts";
import {
  TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, Minus,
  Search, Download, Calendar, Loader2, BarChart3, Activity,
} from "lucide-react";

interface SearchTermTrendProps {
  marketplace?: string;
  campaignId?: string;
  campaignIds?: string[];
}

const PERIOD_PRESETS = [
  { label: "本周 vs 上周", periods: () => {
    const now = new Date();
    const dow = now.getDay() || 7;
    const thisMonday = new Date(now); thisMonday.setDate(now.getDate() - dow + 1);
    const lastMonday = new Date(thisMonday); lastMonday.setDate(thisMonday.getDate() - 7);
    const lastSunday = new Date(thisMonday); lastSunday.setDate(thisMonday.getDate() - 1);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    return [
      { label: "上周", startDate: fmt(lastMonday), endDate: fmt(lastSunday) },
      { label: "本周", startDate: fmt(thisMonday), endDate: fmt(now) },
    ];
  }},
  { label: "近7天 vs 前7天", periods: () => {
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const now = new Date();
    const d7 = new Date(now); d7.setDate(now.getDate() - 7);
    const d14 = new Date(now); d14.setDate(now.getDate() - 14);
    const d8 = new Date(now); d8.setDate(now.getDate() - 8);
    return [
      { label: "前7天", startDate: fmt(d14), endDate: fmt(d8) },
      { label: "近7天", startDate: fmt(d7), endDate: fmt(now) },
    ];
  }},
  { label: "近3天 vs 前3天 vs 更前3天", periods: () => {
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const now = new Date();
    const d3 = new Date(now); d3.setDate(now.getDate() - 3);
    const d6 = new Date(now); d6.setDate(now.getDate() - 6);
    const d4 = new Date(now); d4.setDate(now.getDate() - 4);
    const d9 = new Date(now); d9.setDate(now.getDate() - 9);
    const d7 = new Date(now); d7.setDate(now.getDate() - 7);
    return [
      { label: "更前3天", startDate: fmt(d9), endDate: fmt(d7) },
      { label: "前3天", startDate: fmt(d6), endDate: fmt(d4) },
      { label: "近3天", startDate: fmt(d3), endDate: fmt(now) },
    ];
  }},
];

const METRIC_OPTIONS = [
  { key: "cost", label: "花费", color: "#ef4444" },
  { key: "sales", label: "销售额", color: "#10b981" },
  { key: "impressions", label: "曝光", color: "#3b82f6" },
  { key: "clicks", label: "点击", color: "#f59e0b" },
  { key: "acos", label: "ACoS%", color: "#8b5cf6" },
  { key: "ctr", label: "CTR%", color: "#06b6d4" },
  { key: "cvr", label: "CVR%", color: "#ec4899" },
];

const PERIOD_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#8b5cf6"];

export default function SearchTermTrend({ marketplace, campaignId, campaignIds }: SearchTermTrendProps) {
  const [selectedPreset, setSelectedPreset] = useState(0);
  const [selectedMetric, setSelectedMetric] = useState("cost");
  const [topN, setTopN] = useState(20);
  const [searchFilter, setSearchFilter] = useState("");

  const periods = useMemo(() => PERIOD_PRESETS[selectedPreset].periods(), [selectedPreset]);

  const { data, isLoading, refetch } = trpc.adAnalysis.getSearchTermTrend.useQuery(
    {
      marketplace,
      campaignId,
      campaignIds,
      periods,
      topN,
    },
    { enabled: false }
  );

  const handleQuery = () => {
    refetch();
  };

  // Build chart data for the selected metric
  const chartData = useMemo(() => {
    if (!data?.trendData) return [];
    const filtered = searchFilter
      ? data.trendData.filter(t => t.query.toLowerCase().includes(searchFilter.toLowerCase()))
      : data.trendData;
    return filtered.slice(0, 10).map(t => {
      const row: any = { query: t.query.length > 15 ? t.query.slice(0, 15) + "..." : t.query };
      t.periods.forEach((p: any) => {
        row[p.label] = p[selectedMetric as keyof typeof p] ?? 0;
      });
      return row;
    });
  }, [data, selectedMetric, searchFilter]);

  // Period totals comparison chart
  const periodTotalChart = useMemo(() => {
    if (!data?.periodTotals) return [];
    return data.periodTotals.map((pt: any) => ({
      label: pt.label,
      花费: pt.cost,
      销售额: pt.sales,
      搜索词数: pt.termCount,
    }));
  }, [data]);

  const handleExportCSV = () => {
    if (!data?.trendData) return;
    const periodLabels = data.periodTotals.map((p: any) => p.label);
    const metrics = ["impressions", "clicks", "cost", "sales", "orders", "acos", "ctr", "cvr"];
    const headers = ["搜索词", ...periodLabels.flatMap((l: string) => metrics.map(m => `${l}_${m}`)), "花费变化%", "销售变化%", "曝光变化%"];
    const rows = data.trendData.map((t: any) => {
      const values = [t.query];
      t.periods.forEach((p: any) => {
        metrics.forEach(m => values.push(p[m]));
      });
      values.push(t.trends.costChange, t.trends.salesChange, t.trends.impressionChange);
      return values;
    });
    const csv = [headers, ...rows].map(r => r.map((v: any) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `search_term_trend_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("趋势数据已导出");
  };

  const TrendArrow = ({ value }: { value: number }) => {
    if (value > 5) return <span className="text-emerald-600 text-[10px] flex items-center gap-0.5"><ArrowUpRight className="w-2.5 h-2.5" />+{value}%</span>;
    if (value < -5) return <span className="text-red-600 text-[10px] flex items-center gap-0.5"><ArrowDownRight className="w-2.5 h-2.5" />{value}%</span>;
    return <span className="text-gray-500 text-[10px] flex items-center gap-0.5"><Minus className="w-2.5 h-2.5" />{value}%</span>;
  };

  return (
    <div className="space-y-4">
      {/* Control Panel */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-600" />
              <CardTitle className="text-base">搜索词趋势对比</CardTitle>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={String(selectedPreset)} onValueChange={(v) => setSelectedPreset(Number(v))}>
                <SelectTrigger className="w-[180px] h-8 text-xs">
                  <Calendar className="w-3 h-3 mr-1" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIOD_PRESETS.map((p, i) => (
                    <SelectItem key={i} value={String(i)} className="text-xs">{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">TOP</span>
                <Input type="number" value={topN} onChange={(e) => setTopN(Math.min(50, Math.max(5, Number(e.target.value) || 20)))} className="w-14 h-8 text-xs" min={5} max={50} />
              </div>
              <Button onClick={handleQuery} disabled={isLoading} className="h-8 gap-1.5 bg-blue-600 hover:bg-blue-700 text-white">
                {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                {isLoading ? "查询中..." : "查询对比"}
              </Button>
            </div>
          </div>
          <CardDescription className="text-xs mt-1">
            选择时间段预设后点击查询，对比同一搜索词在不同时段的表现变化，发现季节性趋势和异常波动。
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
          </div>
          <Skeleton className="h-64" />
          <Skeleton className="h-96" />
        </div>
      )}

      {/* Results */}
      {data && !isLoading && (
        <>
          {/* Period Totals KPI */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {data.periodTotals.map((pt: any, i: number) => (
              <Card key={i} className="bg-gradient-to-br from-white to-gray-50">
                <CardContent className="p-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: PERIOD_COLORS[i] }} />
                    <span className="text-xs font-medium">{pt.label}</span>
                    <span className="text-[10px] text-muted-foreground">({pt.startDate} ~ {pt.endDate})</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    <div><span className="text-[10px] text-muted-foreground">花费</span><p className="text-sm font-bold text-red-600">${pt.cost}</p></div>
                    <div><span className="text-[10px] text-muted-foreground">销售</span><p className="text-sm font-bold text-emerald-600">${pt.sales}</p></div>
                    <div><span className="text-[10px] text-muted-foreground">ACoS</span><p className="text-sm font-bold">{pt.acos}%</p></div>
                    <div><span className="text-[10px] text-muted-foreground">搜索词数</span><p className="text-sm font-bold">{pt.termCount}</p></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Period Totals Bar Chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">各时段总体对比</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={periodTotalChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="花费" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="销售额" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Metric Selector + Search Term Trend Chart */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-sm">搜索词指标趋势 (TOP {Math.min(10, data.trendData.length)})</CardTitle>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                    <Input
                      placeholder="搜索词过滤..."
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      className="h-7 text-xs pl-7 w-40"
                    />
                  </div>
                  <Select value={selectedMetric} onValueChange={setSelectedMetric}>
                    <SelectTrigger className="w-[100px] h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {METRIC_OPTIONS.map(m => (
                        <SelectItem key={m.key} value={m.key} className="text-xs">{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={chartData} layout="vertical" margin={{ left: 100, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis dataKey="query" type="category" tick={{ fontSize: 10 }} width={100} />
                    <Tooltip contentStyle={{ fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {periods.map((p, i) => (
                      <Bar key={p.label} dataKey={p.label} fill={PERIOD_COLORS[i]} radius={[0, 2, 2, 0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-center text-xs text-muted-foreground py-8">无匹配数据</p>
              )}
            </CardContent>
          </Card>

          {/* Detail Table */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">搜索词趋势明细 ({data.trendData.length}个)</CardTitle>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleExportCSV}>
                  <Download className="w-3 h-3" />
                  导出CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50/50">
                      <th className="text-left p-3 font-medium text-gray-600 sticky left-0 bg-gray-50/50 z-10">#</th>
                      <th className="text-left p-3 font-medium text-gray-600 sticky left-8 bg-gray-50/50 z-10 min-w-[140px]">搜索词</th>
                      {data.periodTotals.map((pt: any) => (
                        <th key={pt.label} colSpan={4} className="text-center p-2 font-medium text-gray-600 border-l">
                          <div className="text-xs">{pt.label}</div>
                          <div className="text-[9px] text-gray-400">{pt.startDate}~{pt.endDate}</div>
                        </th>
                      ))}
                      <th colSpan={3} className="text-center p-2 font-medium text-gray-600 border-l">趋势变化</th>
                    </tr>
                    <tr className="border-b bg-gray-50/30">
                      <th className="sticky left-0 bg-gray-50/30 z-10" />
                      <th className="sticky left-8 bg-gray-50/30 z-10" />
                      {data.periodTotals.map((pt: any) => (
                        <React.Fragment key={pt.label + "_sub"}>
                          <th className="text-right p-1.5 text-[10px] text-gray-500 border-l">花费</th>
                          <th className="text-right p-1.5 text-[10px] text-gray-500">销售</th>
                          <th className="text-right p-1.5 text-[10px] text-gray-500">ACoS</th>
                          <th className="text-right p-1.5 text-[10px] text-gray-500">订单</th>
                        </React.Fragment>
                      ))}
                      <th className="text-center p-1.5 text-[10px] text-gray-500 border-l">花费</th>
                      <th className="text-center p-1.5 text-[10px] text-gray-500">销售</th>
                      <th className="text-center p-1.5 text-[10px] text-gray-500">曝光</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.trendData
                      .filter((t: any) => !searchFilter || t.query.toLowerCase().includes(searchFilter.toLowerCase()))
                      .map((t: any, idx: number) => (
                      <tr key={t.query} className="border-b last:border-0 hover:bg-gray-50/50">
                        <td className="p-2 text-xs text-gray-400 sticky left-0 bg-white z-10">{idx + 1}</td>
                        <td className="p-2 sticky left-8 bg-white z-10">
                          <span className="text-xs font-medium truncate block max-w-[140px]" title={t.query}>{t.query}</span>
                        </td>
                        {t.periods.map((p: any) => (
                          <React.Fragment key={p.label}>
                            <td className="text-right p-1.5 text-xs font-mono border-l">${p.cost}</td>
                            <td className="text-right p-1.5 text-xs font-mono">${p.sales}</td>
                            <td className={`text-right p-1.5 text-xs font-mono ${p.acos > 30 ? "text-red-600" : p.acos > 0 ? "text-emerald-600" : ""}`}>{p.acos}%</td>
                            <td className="text-right p-1.5 text-xs font-mono">{p.orders}</td>
                          </React.Fragment>
                        ))}
                        <td className="text-center p-1.5 border-l"><TrendArrow value={t.trends.costChange} /></td>
                        <td className="text-center p-1.5"><TrendArrow value={t.trends.salesChange} /></td>
                        <td className="text-center p-1.5"><TrendArrow value={t.trends.impressionChange} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Empty State */}
      {!data && !isLoading && (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <Activity className="w-12 h-12 mx-auto text-gray-300 mb-4" />
            <p className="text-sm font-medium text-gray-500 mb-2">选择时间段后点击"查询对比"</p>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              对比同一搜索词在不同时段的曝光、点击、花费、ACoS等指标变化，
              帮助发现季节性趋势、竞争变化和异常波动。
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

