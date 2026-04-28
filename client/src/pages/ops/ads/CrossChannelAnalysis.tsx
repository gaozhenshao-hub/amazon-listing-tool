import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  PieChart, Pie, Cell,
  LineChart, Line, Area, AreaChart,
} from "recharts";
import {
  Sparkles, Loader2, Layers, DollarSign, TrendingUp, Target,
  BarChart3, AlertTriangle, Info, ShieldAlert, CheckCircle2, CalendarDays,
} from "lucide-react";

interface Props {
  marketplace: string;
  reportDate: string;
  startDate?: string;
  endDate?: string;
  weekStartDate?: string;
  weekEndDate?: string;
}

const CHANNEL_COLORS: Record<string, string> = {
  SP: "#3b82f6",
  SB: "#10b981",
  SD: "#f59e0b",
  DSP: "#8b5cf6",
};

const CHANNEL_LABELS: Record<string, string> = {
  SP: "Sponsored Products",
  SB: "Sponsored Brands",
  SD: "Sponsored Display",
  DSP: "Demand-Side Platform",
};

function EmptyChannelHint({ channel }: { channel: string }) {
  const hints: Record<string, { title: string; desc: string; action: string }> = {
    SB: {
      title: "Sponsored Brands 暂无数据",
      desc: "SB广告需要品牌注册(Brand Registry)才能使用。部分店铺可能未开通SB广告权限，或当前时间段内没有SB广告活动。",
      action: "请确认该店铺已完成品牌注册，并在亚马逊广告后台创建SB广告活动。",
    },
    SD: {
      title: "Sponsored Display 暂无数据",
      desc: "SD广告需要专业卖家账户且部分站点可能不支持。当前店铺可能未开通SD广告权限，或没有活跃的SD广告活动。",
      action: "请确认该店铺具有SD广告权限，并在亚马逊广告后台创建SD广告活动。",
    },
    DSP: {
      title: "DSP广告 暂无数据",
      desc: "DSP广告需要单独开通权限，通常需要较高的月度预算门槛（一般$35,000+/月）。大部分中小卖家不使用DSP。",
      action: "如需使用DSP，请联系亚马逊广告团队或代理商开通DSP账户。",
    },
  };

  const hint = hints[channel];
  if (!hint) return null;

  return (
    <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
      <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
      <div className="text-xs space-y-1">
        <p className="font-medium text-amber-800">{hint.title}</p>
        <p className="text-amber-700">{hint.desc}</p>
        <p className="text-amber-600 flex items-center gap-1">
          <Info className="w-3 h-3" />
          {hint.action}
        </p>
      </div>
    </div>
  );
}

export default function CrossChannelAnalysis({ marketplace, reportDate, startDate, endDate, weekStartDate, weekEndDate }: Props) {
  const [aiAdvice, setAiAdvice] = useState<any>(null);
  const [isEditingAdvice, setIsEditingAdvice] = useState(false);
  const [editedAdvice, setEditedAdvice] = useState<string>("");
  const [trendMetric, setTrendMetric] = useState<"cost" | "sales" | "orders">("cost");

  const effectiveStartDate = startDate || reportDate;
  const effectiveEndDate = endDate || reportDate;
  const isMultiDay = effectiveStartDate !== effectiveEndDate;

  const { data, isLoading } = trpc.adLocalAnalysis.getCrossChannelDataLocal.useQuery({
    weekStartDate,
    weekEndDate,
  });

  const aiMutation = trpc.adLocalAnalysis.aiChannelStrategyLocal.useMutation({
    onSuccess: (result) => {
      const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      setAiAdvice(text);
      setEditedAdvice(text);
      toast.success("AI跨渠道策略已生成（本地数据）");
    },
    onError: (err) => toast.error(`AI分析失败: ${err.message}`),
  });

  const handleAiAnalysis = () => {
    aiMutation.mutate({
      weekStartDate,
      weekEndDate,
    });
  };

  // Chart data
  const costShareData = useMemo(() => {
    if (!data?.channels) return [];
    return data.channels.filter(c => c.cost > 0).map(c => ({
      name: c.channel,
      value: c.cost,
    }));
  }, [data]);

  const comparisonData = useMemo(() => {
    if (!data?.channels) return [];
    return data.channels.map(c => ({
      channel: c.channel,
      花费: c.cost,
      销售额: c.sales,
    }));
  }, [data]);

  const radarData = useMemo(() => {
    if (!data?.channels) return [];
    const active = data.channels.filter(c => c.cost > 0);
    if (active.length === 0) return [];
    const maxRoas = Math.max(...active.map(c => c.roas), 1);
    const maxCtr = Math.max(...active.map(c => c.ctr), 0.01);
    const maxCvr = Math.max(...active.map(c => c.cvr), 1);
    const maxOrders = Math.max(...active.map(c => c.orders), 1);

    return [
      { metric: "ROAS", ...Object.fromEntries(active.map(c => [c.channel, Math.round((c.roas / maxRoas) * 100)])) },
      { metric: "CTR", ...Object.fromEntries(active.map(c => [c.channel, Math.round((c.ctr / maxCtr) * 100)])) },
      { metric: "CVR", ...Object.fromEntries(active.map(c => [c.channel, Math.round((c.cvr / maxCvr) * 100)])) },
      { metric: "订单量", ...Object.fromEntries(active.map(c => [c.channel, Math.round((c.orders / maxOrders) * 100)])) },
      { metric: "花费效率", ...Object.fromEntries(active.map(c => [c.channel, Math.round(Math.min(c.roas * 20, 100))])) },
    ];
  }, [data]);

  // Daily trend data for line chart
  const dailyTrendData = useMemo(() => {
    if (!data?.dailyBreakdown || data.dailyBreakdown.length <= 1) return [];
    return data.dailyBreakdown.map((day: any) => ({
      date: day.date.slice(5), // MM-DD format
      fullDate: day.date,
      SP_cost: +(day.SP?.cost || 0).toFixed(2),
      SB_cost: +(day.SB?.cost || 0).toFixed(2),
      SD_cost: +(day.SD?.cost || 0).toFixed(2),
      DSP_cost: +(day.DSP?.cost || 0).toFixed(2),
      total_cost: +(day.total?.cost || 0).toFixed(2),
      SP_sales: +(day.SP?.sales || 0).toFixed(2),
      SB_sales: +(day.SB?.sales || 0).toFixed(2),
      SD_sales: +(day.SD?.sales || 0).toFixed(2),
      DSP_sales: +(day.DSP?.sales || 0).toFixed(2),
      total_sales: +(day.total?.sales || 0).toFixed(2),
      SP_orders: day.SP?.orders || 0,
      SB_orders: day.SB?.orders || 0,
      SD_orders: day.SD?.orders || 0,
      DSP_orders: day.DSP?.orders || 0,
      total_orders: day.total?.orders || 0,
    }));
  }, [data]);

  // Identify empty/active channels
  const emptyChannels = useMemo(() => {
    if (!data?.channels) return [];
    return data.channels.filter(c => c.cost === 0 && c.sales === 0 && c.orders === 0);
  }, [data]);

  const activeChannels = useMemo(() => {
    if (!data?.channels) return [];
    return data.channels.filter(c => c.cost > 0 || c.sales > 0 || c.orders > 0);
  }, [data]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const channels = data?.channels || [];
  const total = data?.total;

  const metricLabels: Record<string, string> = { cost: "花费", sales: "销售额", orders: "订单量" };
  const metricColors: Record<string, string> = { cost: "#ef4444", sales: "#10b981", orders: "#3b82f6" };
  const metricPrefix: Record<string, string> = { cost: "$", sales: "$", orders: "" };

  return (
    <div className="space-y-4">
      {/* Date Range Banner */}
      {isMultiDay && (
        <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
          <CalendarDays className="w-3.5 h-3.5" />
          <span>跨渠道数据范围: <strong>{effectiveStartDate}</strong> 至 <strong>{effectiveEndDate}</strong></span>
          <Badge variant="secondary" className="text-[10px] h-4 bg-blue-100 text-blue-700">
            {data?.dailyBreakdown?.length || 0}天汇总
          </Badge>
        </div>
      )}

      {/* Channel Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {channels.map((ch) => {
          const isEmpty = ch.cost === 0 && ch.sales === 0 && ch.orders === 0;
          return (
            <Card key={ch.channel} className={`relative overflow-hidden ${isEmpty ? "opacity-60" : ""}`}>
              <div className="absolute top-0 left-0 w-1 h-full" style={{ backgroundColor: CHANNEL_COLORS[ch.channel] || "#6b7280" }} />
              <CardContent className="pt-3 pb-3 px-4 pl-5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-xs font-bold" style={{ color: CHANNEL_COLORS[ch.channel], borderColor: CHANNEL_COLORS[ch.channel] }}>
                      {ch.channel}
                    </Badge>
                    {isEmpty ? (
                      <Badge variant="secondary" className="text-[9px] h-4 bg-gray-100 text-gray-500">无数据</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[9px] h-4 bg-green-50 text-green-600">
                        <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />活跃
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-gray-400">{ch.costShare}%花费</span>
                </div>
                <p className="text-[10px] text-gray-400 mb-1.5 truncate">{CHANNEL_LABELS[ch.channel]}</p>
                {isEmpty ? (
                  <div className="text-center py-2">
                    <ShieldAlert className="w-5 h-5 text-gray-300 mx-auto mb-1" />
                    <p className="text-[10px] text-gray-400">暂无广告数据</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">花费</span>
                      <span className="font-medium text-red-600">${ch.cost.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">销售额</span>
                      <span className="font-medium text-emerald-600">${ch.sales.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">ROAS</span>
                      <span className={`font-medium ${ch.roas >= 2 ? "text-emerald-600" : ch.roas >= 1 ? "text-amber-600" : "text-red-600"}`}>
                        {ch.roas}x
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">ACoS</span>
                      <span className={`font-medium ${ch.acos <= 25 ? "text-emerald-600" : ch.acos <= 40 ? "text-amber-600" : "text-red-600"}`}>
                        {ch.acos}%
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">订单</span>
                      <span className="font-medium">{ch.orders}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">CPC</span>
                      <span className="font-medium">${ch.cpc}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Empty Channel Hints */}
      {emptyChannels.length > 0 && (
        <div className="space-y-2">
          {emptyChannels.map(ch => (
            <EmptyChannelHint key={ch.channel} channel={ch.channel} />
          ))}
        </div>
      )}

      {/* Daily Trend Chart - only show when multi-day */}
      {isMultiDay && dailyTrendData.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-600" />
                每日渠道趋势
                <Badge variant="secondary" className="text-[10px]">
                  {dailyTrendData.length}天
                </Badge>
              </CardTitle>
              <div className="flex items-center gap-1">
                {(["cost", "sales", "orders"] as const).map(m => (
                  <Button
                    key={m}
                    variant={trendMetric === m ? "default" : "outline"}
                    size="sm"
                    className="h-6 text-[10px] px-2"
                    onClick={() => setTrendMetric(m)}
                  >
                    {metricLabels[m]}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyTrendData}>
                  <defs>
                    {Object.entries(CHANNEL_COLORS).map(([ch, color]) => (
                      <linearGradient key={ch} id={`grad_${ch}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={color} stopOpacity={0.2} />
                        <stop offset="95%" stopColor={color} stopOpacity={0.02} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10 }}
                    interval={dailyTrendData.length > 14 ? Math.floor(dailyTrendData.length / 7) : 0}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v) => trendMetric === "orders" ? v : `$${v >= 1000 ? `${(v/1000).toFixed(1)}k` : v}`}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: "11px" }}
                    formatter={(value: any, name: string) => {
                      const ch = name.replace(`_${trendMetric}`, "");
                      const prefix = metricPrefix[trendMetric];
                      return [`${prefix}${Number(value).toLocaleString()}`, ch];
                    }}
                    labelFormatter={(label: string) => {
                      const item = dailyTrendData.find((d: any) => d.date === label);
                      return item?.fullDate || label;
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "11px" }} formatter={(value: string) => value.replace(`_${trendMetric}`, "")} />
                  {activeChannels.map(ch => (
                    <Area
                      key={ch.channel}
                      type="monotone"
                      dataKey={`${ch.channel}_${trendMetric}`}
                      name={`${ch.channel}_${trendMetric}`}
                      stroke={CHANNEL_COLORS[ch.channel]}
                      fill={`url(#grad_${ch.channel})`}
                      strokeWidth={2}
                      dot={{ r: dailyTrendData.length <= 14 ? 3 : 0 }}
                      activeDot={{ r: 5 }}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {/* Daily summary stats below chart */}
            <div className="mt-3 grid grid-cols-4 gap-2">
              {activeChannels.map(ch => {
                const values = dailyTrendData.map((d: any) => d[`${ch.channel}_${trendMetric}`] || 0);
                const avg = values.length > 0 ? values.reduce((a: number, b: number) => a + b, 0) / values.length : 0;
                const max = Math.max(...values, 0);
                const min = Math.min(...values.filter((v: number) => v > 0), max);
                const prefix = metricPrefix[trendMetric];
                return (
                  <div key={ch.channel} className="text-center p-2 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-center gap-1 mb-1">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CHANNEL_COLORS[ch.channel] }} />
                      <span className="text-[10px] font-medium">{ch.channel}</span>
                    </div>
                    <div className="text-[10px] text-gray-500 space-y-0.5">
                      <div>日均: <span className="font-medium text-gray-700">{prefix}{avg.toFixed(trendMetric === "orders" ? 0 : 2)}</span></div>
                      <div>最高: <span className="font-medium text-gray-700">{prefix}{max.toFixed(trendMetric === "orders" ? 0 : 2)}</span></div>
                      <div>最低: <span className="font-medium text-gray-700">{prefix}{min.toFixed(trendMetric === "orders" ? 0 : 2)}</span></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Single day notice */}
      {!isMultiDay && (
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-500">
          <Info className="w-3.5 h-3.5" />
          <span>当前为单日模式（{reportDate}），切换到日期范围模式可查看每日趋势折线图</span>
        </div>
      )}

      {/* Total Summary */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "总花费", value: `$${total?.cost.toFixed(2) || 0}`, icon: DollarSign, color: "text-red-600" },
          { label: "总销售额", value: `$${total?.sales.toFixed(2) || 0}`, icon: TrendingUp, color: "text-emerald-600" },
          { label: "综合ACoS", value: `${total?.acos || 0}%`, icon: Target, color: "text-blue-600" },
          { label: "综合ROAS", value: `${total?.roas || 0}x`, icon: BarChart3, color: "text-purple-600" },
        ].map((m) => (
          <Card key={m.label}>
            <CardContent className="pt-3 pb-2.5 px-4">
              <div className="flex items-center gap-1.5 mb-0.5">
                <m.icon className={`w-3.5 h-3.5 ${m.color}`} />
                <span className="text-xs text-gray-500">{m.label}</span>
              </div>
              <p className={`text-lg font-bold ${m.color}`}>{m.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Cost vs Sales Bar Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">渠道花费 vs 销售额</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparisonData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="channel" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(value: any) => `$${Number(value).toFixed(2)}`} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Bar dataKey="花费" fill="#ef4444" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="销售额" fill="#10b981" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Cost Share Pie */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">花费占比分布</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              {costShareData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={costShareData}
                      cx="50%" cy="50%"
                      innerRadius={45} outerRadius={75}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    >
                      {costShareData.map((entry, i) => (
                        <Cell key={i} fill={CHANNEL_COLORS[entry.name] || "#6b7280"} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: any) => `$${Number(value).toFixed(2)}`} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-gray-400">
                  暂无花费数据
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Radar Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">渠道效率雷达图</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              {radarData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10 }} />
                    <PolarRadiusAxis tick={{ fontSize: 8 }} domain={[0, 100]} />
                    {activeChannels.map((ch) => (
                      <Radar
                        key={ch.channel}
                        name={ch.channel}
                        dataKey={ch.channel}
                        stroke={CHANNEL_COLORS[ch.channel]}
                        fill={CHANNEL_COLORS[ch.channel]}
                        fillOpacity={0.15}
                      />
                    ))}
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    <Tooltip />
                  </RadarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-gray-400">
                  需要至少一个活跃渠道才能生成雷达图
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Comparison Table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600" />
              渠道详细对比
              <Badge variant="secondary" className="text-[10px]">
                {activeChannels.length}/{channels.length} 个渠道有数据
              </Badge>
            </CardTitle>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleAiAnalysis} disabled={aiMutation.isPending}>
              {aiMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />} AI跨渠道策略分析
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left py-2 px-3 font-medium text-gray-600">渠道</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600">花费</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600">花费占比</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600">销售额</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600">销售占比</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600">曝光</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600">点击</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600">订单</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600">ACoS</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600">ROAS</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600">CTR</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600">CVR</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600">CPC</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((ch) => {
                  const isEmpty = ch.cost === 0 && ch.sales === 0 && ch.orders === 0;
                  return (
                    <tr key={ch.channel} className={`border-b hover:bg-gray-50 ${isEmpty ? "opacity-50" : ""}`}>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CHANNEL_COLORS[ch.channel] }} />
                          <span className="font-medium">{ch.channel}</span>
                          {isEmpty && <Badge variant="secondary" className="text-[8px] h-3.5">无数据</Badge>}
                        </div>
                      </td>
                      <td className="text-right py-2 px-3 font-medium text-red-600">${ch.cost.toFixed(2)}</td>
                      <td className="text-right py-2 px-3">
                        <div className="flex items-center justify-end gap-1">
                          <div className="w-12 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${ch.costShare}%`, backgroundColor: CHANNEL_COLORS[ch.channel] }} />
                          </div>
                          <span>{ch.costShare}%</span>
                        </div>
                      </td>
                      <td className="text-right py-2 px-3 font-medium text-emerald-600">${ch.sales.toFixed(2)}</td>
                      <td className="text-right py-2 px-3">
                        <div className="flex items-center justify-end gap-1">
                          <div className="w-12 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${ch.salesShare}%` }} />
                          </div>
                          <span>{ch.salesShare}%</span>
                        </div>
                      </td>
                      <td className="text-right py-2 px-3">{ch.impressions.toLocaleString()}</td>
                      <td className="text-right py-2 px-3">{ch.clicks.toLocaleString()}</td>
                      <td className="text-right py-2 px-3 font-medium">{ch.orders.toLocaleString()}</td>
                      <td className={`text-right py-2 px-3 font-medium ${ch.acos <= 25 ? "text-emerald-600" : ch.acos <= 40 ? "text-amber-600" : "text-red-600"}`}>
                        {isEmpty ? "--" : `${ch.acos}%`}
                      </td>
                      <td className={`text-right py-2 px-3 font-medium ${ch.roas >= 2 ? "text-emerald-600" : ch.roas >= 1 ? "text-amber-600" : "text-red-600"}`}>
                        {isEmpty ? "--" : `${ch.roas}x`}
                      </td>
                      <td className="text-right py-2 px-3">{isEmpty ? "--" : `${ch.ctr}%`}</td>
                      <td className="text-right py-2 px-3">{isEmpty ? "--" : `${ch.cvr}%`}</td>
                      <td className="text-right py-2 px-3">{isEmpty ? "--" : `$${ch.cpc}`}</td>
                    </tr>
                  );
                })}
                {/* Total Row */}
                <tr className="border-t-2 bg-gray-50 font-medium">
                  <td className="py-2 px-3">合计</td>
                  <td className="text-right py-2 px-3 text-red-600">${total?.cost.toFixed(2)}</td>
                  <td className="text-right py-2 px-3">100%</td>
                  <td className="text-right py-2 px-3 text-emerald-600">${total?.sales.toFixed(2)}</td>
                  <td className="text-right py-2 px-3">100%</td>
                  <td className="text-right py-2 px-3">{channels.reduce((s, c) => s + c.impressions, 0).toLocaleString()}</td>
                  <td className="text-right py-2 px-3">{channels.reduce((s, c) => s + c.clicks, 0).toLocaleString()}</td>
                  <td className="text-right py-2 px-3">{channels.reduce((s, c) => s + c.orders, 0).toLocaleString()}</td>
                  <td className="text-right py-2 px-3 text-blue-600">{total?.acos}%</td>
                  <td className="text-right py-2 px-3 text-purple-600">{total?.roas}x</td>
                  <td className="text-right py-2 px-3">--</td>
                  <td className="text-right py-2 px-3">--</td>
                  <td className="text-right py-2 px-3">--</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* AI Advice Card */}
      {aiAdvice && (
        <Card className="bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-600" />
                AI 跨渠道投放策略建议
              </CardTitle>
              <div className="flex items-center gap-2">
                {isEditingAdvice ? (
                  <>
                    <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setIsEditingAdvice(false)}>取消</Button>
                    <Button size="sm" className="h-6 text-[10px]" onClick={() => { setAiAdvice(editedAdvice); setIsEditingAdvice(false); toast.success("已保存编辑"); }}>保存</Button>
                  </>
                ) : (
                  <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => { setEditedAdvice(aiAdvice); setIsEditingAdvice(true); }}>编辑</Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isEditingAdvice ? (
              <textarea
                className="w-full p-3 border rounded-md text-xs bg-white font-mono"
                rows={12}
                value={editedAdvice}
                onChange={(e) => setEditedAdvice(e.target.value)}
              />
            ) : (
              <div className="text-xs whitespace-pre-wrap bg-white/60 rounded-md p-3 leading-relaxed">
                {aiAdvice}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
