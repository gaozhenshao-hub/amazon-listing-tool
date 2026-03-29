import { useState, useMemo } from "react";
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
  days: number;
}

const PLACEMENT_CONFIG: Record<string, { label: string; icon: any; color: string; fill: string }> = {
  "Top of Search": { label: "搜索结果顶部 (TOS)", icon: TrendingUp, color: "text-emerald-700", fill: "#10b981" },
  "Rest of Search": { label: "搜索结果其余位置 (ROS)", icon: LayoutGrid, color: "text-blue-700", fill: "#3b82f6" },
  "Product Pages": { label: "商品页面 (PP)", icon: Smartphone, color: "text-purple-700", fill: "#8b5cf6" },
};

export default function AdPlacementAnalysis({ campaignId, marketplace, days }: AdPlacementAnalysisProps) {
  const { data, isLoading } = trpc.adAnalysis.getAdPlacementData.useQuery({
    marketplace,
    days,
  });

  const placements = data?.placements || [];

  // Radar chart data
  const radarData = useMemo(() => {
    if (placements.length === 0) return [];
    const metrics = [
      { metric: "曝光量", key: "impressions" },
      { metric: "点击率", key: "ctr" },
      { metric: "转化率", key: "convRate" },
      { metric: "ROAS", key: "roas" },
      { metric: "ACoS", key: "acos_inv" },
    ];
    return metrics.map(m => {
      const row: any = { metric: m.metric };
      placements.forEach((p: any) => {
        const val = m.key === "acos_inv" ? Math.max(0, 100 - (p.acos || 0)) : p[m.key] || 0;
        row[p.placement] = val;
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

  return (
    <div className="space-y-4">
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
                      {p.acos}%
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500">CTR</p>
                    <p className="text-sm font-bold">{p.ctr}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500">CVR</p>
                    <p className="text-sm font-bold">{p.convRate}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500">ROAS</p>
                    <p className="text-sm font-bold text-blue-600">{p.roas}x</p>
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
                  {placements.map((p: any) => (
                    <Radar
                      key={p.placement}
                      name={PLACEMENT_CONFIG[p.placement]?.label || p.placement}
                      dataKey={p.placement}
                      stroke={PLACEMENT_CONFIG[p.placement]?.fill || "#999"}
                      fill={PLACEMENT_CONFIG[p.placement]?.fill || "#999"}
                      fillOpacity={0.15}
                    />
                  ))}
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
