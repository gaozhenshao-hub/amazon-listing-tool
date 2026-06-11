import { useState, useMemo, useEffect } from "react";
import AdEmptyState from "./AdEmptyState";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  LineChart, Line, Area, AreaChart,
} from "recharts";
import { Clock, Sparkles, Loader2, TrendingUp, DollarSign, ShoppingCart, Download } from "lucide-react";
import { toast } from "sonner";

interface HourlyBidStrategyProps {
  campaignId: string | null;
  campaignIds?: string[];
  campaignNamesList?: string[];
  marketplace?: string;
  reportDate?: string;
  startDate?: string;
  endDate?: string;
  defaultAdType?: "SP" | "SB" | "SD";
}

const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => `${i}:00`);
const DAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

// Color scale for heatmap
function getHeatColor(value: number, max: number): string {
  if (max === 0) return "#f3f4f6";
  const ratio = value / max;
  if (ratio > 0.8) return "#059669";
  if (ratio > 0.6) return "#10b981";
  if (ratio > 0.4) return "#34d399";
  if (ratio > 0.2) return "#6ee7b7";
  if (ratio > 0.05) return "#a7f3d0";
  return "#f3f4f6";
}

export default function HourlyBidStrategy({ campaignId, campaignIds, campaignNamesList, marketplace, reportDate, startDate, endDate, defaultAdType }: HourlyBidStrategyProps) {
  const [heatmapMetric, setHeatmapMetric] = useState<"orders" | "sales" | "clicks" | "impressions">("orders");
  const [adType, setAdType] = useState<"SP" | "SB" | "SD">(defaultAdType === "SB" ? "SB" : defaultAdType === "SD" ? "SD" : "SP");

  useEffect(() => {
    if (defaultAdType) {
      const mapped = defaultAdType === "SB" ? "SB" : defaultAdType === "SD" ? "SD" : "SP";
      setAdType(mapped as any);
    }
  }, [defaultAdType]);

  const { data, isLoading } = trpc.adLocalAnalysis.getAdHourlyDataLocal.useQuery({
    campaignNames: campaignNamesList && campaignNamesList.length > 0 ? campaignNamesList : undefined,
    adType,
  });

  const { data: heatmapRawData } = trpc.adLocalAnalysis.getOrderHourlyHeatmapLocal.useQuery({});

  const aiBidStrategy = trpc.adAnalysis.aiDaypartingStrategy.useMutation({
    onSuccess: () => toast.success("AI分时竞价策略生成完成"),
    onError: (err) => toast.error("生成失败", { description: err.message }),
  });

  const hourlyData = data?.hourlyData || [];
  const heatmapData = heatmapRawData?.heatmapData || [];

  // Hourly aggregated chart data
  const hourlyChartData = useMemo(() => {
    return hourlyData.map((h: any) => ({
      hour: `${h.hour}:00`,
      订单: h.orders,
      销售额: h.sales,
      花费: h.cost,
      ACoS: h.acos,
      CTR: h.ctr,
    }));
  }, [hourlyData]);

  // Heatmap max value
  const heatmapMax = useMemo(() => {
    let max = 0;
    heatmapData.forEach((row: any) => {
      (row.hours || []).forEach((h: any) => {
        if (h[heatmapMetric] > max) max = h[heatmapMetric];
      });
    });
    return max;
  }, [heatmapData, heatmapMetric]);

  const handleGenerateStrategy = () => {
    aiBidStrategy.mutate({
      hourlyData: hourlyData.map((h: any) => ({
        hour: String(h.hour), impressions: String(h.impressions), clicks: String(h.clicks),
        cost: String(h.cost), sales: String(h.sales), orders: String(h.orders),
        acos: String(h.acos), ctr: String(h.ctr),
      })),
    });
  };

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-32" /><Skeleton className="h-64" /></div>;
  }

  const hasData = data?.hourlyData && data.hourlyData.length > 0;
  if (!hasData && (adType === "SB" || adType === "SD")) {
    return <AdEmptyState adType={adType} featureName="分时竞价分析" />;
  }

  return (
    <div className="space-y-4">
      {/* Ad Type Switcher */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground font-medium">广告类型:</span>
        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
          {(["SP", "SB", "SD"] as const).map((type) => (
            <button
              key={type}
              onClick={() => setAdType(type)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                adType === type
                  ? "bg-white text-blue-700 shadow-sm border border-blue-200"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {type === "SP" ? "SP 商品推广" : type === "SB" ? "SB 品牌推广" : "SD 展示型"}
            </button>
          ))}
        </div>
      </div>

      {/* Hourly Performance Chart */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-500" />
                24小时广告表现
              </CardTitle>
              <CardDescription className="text-xs">按小时聚合的广告数据</CardDescription>
            </div>
            <Button size="sm" onClick={handleGenerateStrategy} disabled={aiBidStrategy.isPending}>
              {aiBidStrategy.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
              AI生成分时策略
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="hour" tick={{ fontSize: 9 }} interval={1} />
                <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                <Bar yAxisId="left" dataKey="订单" fill="#10b981" radius={[2, 2, 0, 0]} />
                <Bar yAxisId="left" dataKey="花费" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="ACoS" stroke="#ef4444" strokeWidth={2} dot={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Heatmap */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">出单时段热力图</CardTitle>
            <div className="flex items-center gap-2">
              {(["orders", "sales", "clicks", "impressions"] as const).map(m => (
                <Button
                  key={m}
                  size="sm" variant={heatmapMetric === m ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setHeatmapMetric(m)}
                >
                  {{ orders: "订单", sales: "销售额", clicks: "点击", impressions: "曝光" }[m]}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-xs text-gray-500 p-1 w-12"></th>
                  {HOUR_LABELS.map(h => (
                    <th key={h} className="text-[9px] text-gray-400 p-1 text-center">{h.split(":")[0]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmapData.length > 0 ? heatmapData.map((row: any, dayIdx: number) => (
                  <tr key={dayIdx}>
                    <td className="text-xs text-gray-600 font-medium p-1">{DAY_LABELS[dayIdx] || `Day ${dayIdx}`}</td>
                    {(row.hours || []).map((h: any, hourIdx: number) => (
                      <td key={hourIdx} className="p-0.5">
                        <div
                          className="w-full h-7 rounded-sm flex items-center justify-center text-[9px] font-medium transition-colors"
                          style={{
                            backgroundColor: getHeatColor(h[heatmapMetric] || 0, heatmapMax),
                            color: (h[heatmapMetric] || 0) / heatmapMax > 0.5 ? "white" : "#374151",
                          }}
                          title={`${DAY_LABELS[dayIdx]} ${hourIdx}:00 - ${heatmapMetric}: ${h[heatmapMetric]}`}
                        >
                          {h[heatmapMetric] > 0 ? h[heatmapMetric] : ""}
                        </div>
                      </td>
                    ))}
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={25} className="text-center py-8 text-gray-400 text-sm">暂无热力图数据</td>
                  </tr>
                )}
              </tbody>
            </table>
            {/* Color legend */}
            <div className="flex items-center gap-2 mt-3 justify-end">
              <span className="text-[10px] text-gray-500">低</span>
              {[
                "#f3f4f6",
                "#a7f3d0",
                "#6ee7b7",
                "#34d399",
                "#10b981",
                "#059669",
              ].map((c, i) => (
                <div key={i} className="w-6 h-3 rounded-sm" style={{ backgroundColor: c }} />
              ))}
              <span className="text-[10px] text-gray-500">高</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI Bid Strategy Result */}
      {aiBidStrategy.data && (
        <Card className="border-blue-200 bg-blue-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-500" />
              AI分时竞价策略建议
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="p-3 bg-white rounded-lg border">
              <p className="text-sm text-gray-700">{(aiBidStrategy.data as any).summary}</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {(aiBidStrategy.data as any).hourly_strategy?.filter((_: any, i: number) => i % 3 === 0).map((slot: any, i: number) => {
                const tier = slot.tier;
                return (
                  <div key={i} className={`p-3 rounded-lg border ${
                    tier === "peak" ? "bg-emerald-50 border-emerald-200" :
                    tier === "normal" ? "bg-amber-50 border-amber-200" :
                    "bg-gray-50 border-gray-200"
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium">{slot.hour}:00 - {slot.hour + 2}:59</span>
                      <Badge className={`text-[10px] ${
                        tier === "peak" ? "bg-emerald-100 text-emerald-700" :
                        tier === "normal" ? "bg-amber-100 text-amber-700" :
                        "bg-gray-100 text-gray-700"
                      }`}>
                        {tier === "peak" ? "高峰" : tier === "normal" ? "正常" : tier === "low" ? "低谷" : "关闭"}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-gray-600">出价倍数: {slot.bid_multiplier}x</p>
                    <p className="text-[10px] text-gray-500 mt-1">{slot.strategy}</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
