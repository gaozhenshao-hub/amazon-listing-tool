import { useState, useMemo, useEffect } from "react";
import AdEmptyState from "./AdEmptyState";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from "recharts";
import { Monitor, Smartphone, LayoutGrid, TrendingUp, TrendingDown, DollarSign, Eye, MousePointerClick } from "lucide-react";

interface AdPlacementAnalysisProps {
  campaignId: string | null;
  marketplace?: string;
  reportDate: string;
  startDate?: string;
  endDate?: string;
  defaultAdType?: "SP" | "SB" | "SD";
}

// Map real API placement_type values to display config
const PLACEMENT_CONFIG: Record<string, { label: string; icon: any; color: string; fill: string }> = {
  "TOP OF SEARCH ON-AMAZON": { label: "搜索结果顶部 (TOS)", icon: TrendingUp, color: "text-emerald-700", fill: "#10b981" },
  "Top of Search on-Amazon": { label: "搜索结果顶部 (TOS)", icon: TrendingUp, color: "text-emerald-700", fill: "#10b981" },
  "Top of Search": { label: "搜索结果顶部 (TOS)", icon: TrendingUp, color: "text-emerald-700", fill: "#10b981" },
  "REST OF SEARCH": { label: "搜索结果其余位置 (ROS)", icon: LayoutGrid, color: "text-blue-700", fill: "#3b82f6" },
  "Rest of Search": { label: "搜索结果其余位置 (ROS)", icon: LayoutGrid, color: "text-blue-700", fill: "#3b82f6" },
  "PRODUCT PAGES": { label: "商品页面 (PP)", icon: Smartphone, color: "text-purple-700", fill: "#8b5cf6" },
  "Product Pages": { label: "商品页面 (PP)", icon: Smartphone, color: "text-purple-700", fill: "#8b5cf6" },
  "Detail Page on-Amazon": { label: "商品页面 (PP)", icon: Smartphone, color: "text-purple-700", fill: "#8b5cf6" },
  "Other on-Amazon": { label: "其他位置", icon: Monitor, color: "text-gray-700", fill: "#9ca3af" },
  "Other": { label: "其他位置", icon: Monitor, color: "text-gray-700", fill: "#9ca3af" },
};

export default function AdPlacementAnalysis({ campaignId, marketplace, reportDate, startDate, endDate, defaultAdType }: AdPlacementAnalysisProps) {
  const [adType, setAdType] = useState<"SP" | "SB" | "SD">(defaultAdType === "SB" ? "SB" : defaultAdType === "SD" ? "SD" : "SP");

  useEffect(() => {
    if (defaultAdType) {
      const mapped = defaultAdType === "SB" ? "SB" : defaultAdType === "SD" ? "SD" : "SP";
      setAdType(mapped as any);
    }
  }, [defaultAdType]);

  const { data, isLoading } = trpc.adAnalysis.getAdPlacementData.useQuery({
    campaignId: campaignId || undefined,
    marketplace,
    reportDate,
    startDate,
    endDate,
    adType,
  });

  const placements = data?.placements || [];

  // Radar chart data
  const radarData = useMemo(() => {
    if (placements.length === 0) return [];
    const metrics = [
      { metric: "曝光量", key: "impressions" },
      { metric: "点击率", key: "ctr" },
      { metric: "转化率", key: "cvr" },
      { metric: "ROAS", key: "roas" },
      { metric: "ACoS(反)", key: "acos_inv" },
    ];
    return metrics.map(m => {
      const row: any = { metric: m.metric };
      placements.forEach((p: any) => {
        const label = PLACEMENT_CONFIG[p.placement]?.label || p.placement;
        const val = m.key === "acos_inv" ? Math.max(0, 100 - (p.acos || 0)) : p[m.key] || 0;
        row[label] = val;
      });
      return row;
    });
  }, [placements]);

  // Bar chart comparison
  const barData = useMemo(() => {
    return placements.map((p: any) => ({
      name: PLACEMENT_CONFIG[p.placement]?.label || p.placement,
      花费: p.cost,
      销售额: p.sales,
      fill: PLACEMENT_CONFIG[p.placement]?.fill || "#999",
    }));
  }, [placements]);

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-32" /><Skeleton className="h-64" /></div>;
  }

  if (placements.length === 0) {
    if (adType === "SB" || adType === "SD") {
      return <AdEmptyState adType={adType} featureName="广告位分析" />;
    }
    return (
      <Card>
        <CardContent className="py-12 text-center text-gray-400">
          暂无广告位数据，请尝试更换日期范围或选择其他广告活动
        </CardContent>
      </Card>
    );
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
        {adType !== "SP" && (
          <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">
            {adType === "SB" ? "SB广告位含品牌新客指标" : "SD广告位含展示量数据"}
          </Badge>
        )}
      </div>

      {/* Placement KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {placements.map((p: any) => {
          const config = PLACEMENT_CONFIG[p.placement] || { label: p.placement, icon: Monitor, color: "text-gray-700", fill: "#999" };
          const Icon = config.icon;
          return (
            <Card key={p.placement} className="border-l-4" style={{ borderLeftColor: config.fill }}>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2 mb-3">
                  <Icon className={`w-4 h-4 ${config.color}`} />
                  <span className={`text-sm font-medium ${config.color}`}>{config.label}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-gray-500">曝光</p>
                    <p className="text-sm font-bold">{(p.impressions || 0).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500">点击</p>
                    <p className="text-sm font-bold">{(p.clicks || 0).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500">花费</p>
                    <p className="text-sm font-bold">${(p.cost || 0).toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500">销售额</p>
                    <p className="text-sm font-bold text-emerald-600">${(p.sales || 0).toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500">ACoS</p>
                    <p className={`text-sm font-bold ${(p.acos || 0) <= 25 ? "text-emerald-600" : (p.acos || 0) <= 40 ? "text-amber-600" : "text-red-600"}`}>
                      {(p.acos || 0).toFixed(2)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500">CTR</p>
                    <p className="text-sm font-bold">{(p.ctr || 0).toFixed(2)}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500">CVR</p>
                    <p className="text-sm font-bold">{(p.cvr || 0).toFixed(2)}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500">ROAS</p>
                    <p className="text-sm font-bold text-blue-600">{(p.roas || 0).toFixed(2)}x</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">广告位综合对比</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
                  <PolarRadiusAxis tick={{ fontSize: 9 }} />
                  {placements.map((p: any) => {
                    const label = PLACEMENT_CONFIG[p.placement]?.label || p.placement;
                    return (
                      <Radar
                        key={p.placement}
                        name={label}
                        dataKey={label}
                        stroke={PLACEMENT_CONFIG[p.placement]?.fill || "#999"}
                        fill={PLACEMENT_CONFIG[p.placement]?.fill || "#999"}
                        fillOpacity={0.15}
                      />
                    );
                  })}
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Tooltip />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">花费 vs 销售额</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Bar dataKey="花费" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="销售额" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
