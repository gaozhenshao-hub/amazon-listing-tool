import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  ScatterChart, Scatter, ZAxis,
} from "recharts";
import { Target, Search, Download, Sparkles, Loader2, Filter } from "lucide-react";
import { toast } from "sonner";

interface TargetingAnalysisProps {
  campaignId: string | null;
  marketplace?: string;
  reportDate: string;
}

const TARGET_CATEGORY_CONFIG: Record<number, { label: string; color: string; bg: string }> = {
  1: { label: "高点击_高转化", color: "#10b981", bg: "bg-emerald-50" },
  2: { label: "高点击_中转化", color: "#3b82f6", bg: "bg-blue-50" },
  3: { label: "高点击_低转化", color: "#f59e0b", bg: "bg-amber-50" },
  4: { label: "中点击_高转化", color: "#14b8a6", bg: "bg-teal-50" },
  5: { label: "中点击_中转化", color: "#8b5cf6", bg: "bg-purple-50" },
  6: { label: "中点击_低转化", color: "#f97316", bg: "bg-orange-50" },
  7: { label: "低点击_高转化", color: "#06b6d4", bg: "bg-cyan-50" },
  8: { label: "低点击_中转化", color: "#9ca3af", bg: "bg-gray-50" },
  9: { label: "低点击_低转化", color: "#ef4444", bg: "bg-red-50" },
};

export default function TargetingAnalysis({ campaignId, marketplace, reportDate }: TargetingAnalysisProps) {
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading } = trpc.adAnalysis.getTargetingAnalysis.useQuery({
    campaignId: campaignId || undefined,
    marketplace,
    reportDate,
  });

  const targets = (data?.targets || []).map((t: any, idx: number) => {
    // Map backend category strings to numeric IDs for the 9-category system
    const catMap: Record<string, number> = {
      star: 1, stable: 2, waste: 3, potential: 4, test: 5, decline: 6,
      new: 7, observe: 8, negate: 9,
    };
    return { ...t, target: t.targeting_expression || t.target_id, categoryId: catMap[t.category] || 8 };
  });
  const categoryStats = useMemo(() => {
    const stats: Record<number, number> = {};
    for (let i = 1; i <= 9; i++) stats[i] = 0;
    targets.forEach((t: any) => { if (stats[t.categoryId] !== undefined) stats[t.categoryId]++; });
    return stats;
  }, [targets]);

  const filteredTargets = useMemo(() => {
    let result = [...targets];
    if (categoryFilter !== null) result = result.filter((t: any) => t.categoryId === categoryFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((t: any) => (t.target || "").toLowerCase().includes(q));
    }
    return result.sort((a: any, b: any) => (b.cost || 0) - (a.cost || 0));
  }, [targets, categoryFilter, searchQuery]);

  // Scatter chart data (clicks vs conversion rate, size = cost)
  const scatterData = useMemo(() => {
    return targets.slice(0, 100).map((t: any) => ({
      x: t.clicks || 0,
      y: t.cvr || 0,
      z: Math.max(t.cost || 1, 5),
      name: t.target,
      category: t.categoryId,
      fill: TARGET_CATEGORY_CONFIG[t.categoryId]?.color || "#999",
    }));
  }, [targets]);

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-32" /><Skeleton className="h-64" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Category Filter Cards */}
      <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2">
        {Object.entries(TARGET_CATEGORY_CONFIG).map(([id, config]) => {
          const catId = Number(id);
          const count = categoryStats[catId] || 0;
          const isSelected = categoryFilter === catId;
          return (
            <button
              key={id}
              onClick={() => setCategoryFilter(isSelected ? null : catId)}
              className={`p-2 rounded-lg border text-center transition-all ${
                isSelected ? `${config.bg} ring-2 ring-offset-1` : "bg-white hover:bg-gray-50"
              }`}
            >
              <span className="text-lg font-bold block">{count}</span>
              <span className="text-[9px] text-gray-600 block">{config.label}</span>
            </button>
          );
        })}
      </div>

      {/* Scatter Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">投放对象分布（点击量 vs 转化率，气泡大小=花费）</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" dataKey="x" name="点击" tick={{ fontSize: 10 }} />
                <YAxis type="number" dataKey="y" name="转化率%" tick={{ fontSize: 10 }} />
                <ZAxis type="number" dataKey="z" range={[20, 400]} />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ payload }) => {
                  if (!payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-white p-2 border rounded shadow-sm text-xs">
                      <p className="font-medium">{d.name}</p>
                      <p>点击: {d.x} | 转化率: {d.y}%</p>
                      <p>花费: ${d.z?.toFixed(2)}</p>
                    </div>
                  );
                }} />
                <Scatter data={scatterData}>
                  {scatterData.map((entry: any, idx: number) => (
                    <Cell key={idx} fill={entry.fill} fillOpacity={0.7} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Target Table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">投放对象明细 ({filteredTargets.length})</CardTitle>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <Input placeholder="搜索..." className="pl-7 h-8 w-40 text-xs" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/50">
                  <th className="text-left p-2.5 font-medium text-gray-600 w-8">#</th>
                  <th className="text-left p-2.5 font-medium text-gray-600">投放对象</th>
                  <th className="text-center p-2.5 font-medium text-gray-600">分类</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">曝光</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">点击</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">花费</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">销售额</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">订单</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">ACoS</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">CVR</th>
                </tr>
              </thead>
              <tbody>
                {filteredTargets.length === 0 ? (
                  <tr><td colSpan={10} className="text-center py-8 text-gray-400">暂无投放对象数据</td></tr>
                ) : (
                  filteredTargets.slice(0, 100).map((t: any, i: number) => {
                    const config = TARGET_CATEGORY_CONFIG[t.categoryId] || TARGET_CATEGORY_CONFIG[9];
                    return (
                      <tr key={i} className="border-b hover:bg-gray-50/50">
                        <td className="p-2.5 text-gray-400 text-xs">{i + 1}</td>
                        <td className="p-2.5 font-medium text-xs max-w-[200px] truncate">{t.target}</td>
                        <td className="p-2.5 text-center">
                          <Badge className="text-[9px]" style={{ backgroundColor: config.color + "20", color: config.color }}>
                            {config.label}
                          </Badge>
                        </td>
                        <td className="p-2.5 text-right text-xs">{(t.impressions || 0).toLocaleString()}</td>
                        <td className="p-2.5 text-right text-xs">{t.clicks || 0}</td>
                        <td className="p-2.5 text-right text-xs">S{(t.cost || 0).toFixed(2)}</td>
                        <td className="p-2.5 text-right text-xs font-medium">S{(t.sales || 0).toFixed(2)}</td>
                        <td className="p-2.5 text-right text-xs">{t.orders || 0}</td>
                        <td className="p-2.5 text-right text-xs">
                          <span className={`font-medium ${(t.acos || 0) <= 25 ? "text-emerald-600" : (t.acos || 0) <= 40 ? "text-amber-600" : "text-red-600"}`}>
                            {t.acos}%
                          </span>
                        </td>
                        <td className="p-2.5 text-right text-xs">{(t.cvr || 0).toFixed(2)}%</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
