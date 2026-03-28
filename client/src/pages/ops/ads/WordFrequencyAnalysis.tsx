import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell, ScatterChart, Scatter, ZAxis,
} from "recharts";
import {
  Type, Sparkles, Loader2, Filter, TrendingUp, TrendingDown, AlertTriangle,
  Eye, Target, XCircle, HelpCircle, Download,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  asin: string | null;
  marketplace: string;
  days: number;
}

const CATEGORY_CONFIG: Record<number, { name: string; color: string; bgColor: string; icon: any; description: string; action: string }> = {
  1: { name: "高转化率", color: "#10b981", bgColor: "bg-emerald-50", icon: TrendingUp, description: "核心属性词", action: "在Listing中突出该属性，作为拓词核心" },
  2: { name: "中转化率", color: "#3b82f6", bgColor: "bg-blue-50", icon: Target, description: "基本属性词", action: "作为拓词依据，优化Listing突出该属性" },
  3: { name: "低转化率", color: "#f59e0b", bgColor: "bg-amber-50", icon: TrendingDown, description: "弱属性词", action: "评估是否与产品匹配，考虑弱化" },
  4: { name: "0转化_30+点击", color: "#ef4444", bgColor: "bg-red-50", icon: XCircle, description: "无效属性", action: "考虑否定含该属性的搜索词" },
  5: { name: "0转化_7-30点击", color: "#8b5cf6", bgColor: "bg-purple-50", icon: HelpCircle, description: "待观察属性", action: "数据量不足，继续观察" },
  6: { name: "0转化_<7点击", color: "#9ca3af", bgColor: "bg-gray-50", icon: Eye, description: "低量属性", action: "忽略或继续观察" },
};

const PIE_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#9ca3af"];

export default function WordFrequencyAnalysis({ asin, marketplace, days }: Props) {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const { data, isLoading } = trpc.adAnalysis.getWordFrequencyAnalysis.useQuery(
    { asin: asin || undefined, marketplace, days },
    { enabled: true }
  );

  const attributes = data?.attributes || [];
  const categoryStats = data?.categoryStats || {};

  const filteredAttributes = useMemo(() => {
    if (selectedCategory === "all") return attributes;
    return attributes.filter((a: any) => String(a.category) === selectedCategory);
  }, [attributes, selectedCategory]);

  // Pie chart data
  const pieData = useMemo(() => {
    return Object.entries(categoryStats).map(([cat, stats]: [string, any]) => ({
      name: CATEGORY_CONFIG[Number(cat)]?.name || `分类${cat}`,
      value: stats.count,
      impressions: stats.impressions,
    }));
  }, [categoryStats]);

  // Top attributes bar chart
  const topAttributes = useMemo(() => {
    return attributes.slice(0, 15).map((a: any) => ({
      word: a.word,
      曝光: a.impressions,
      点击: a.clicks,
      订单: a.orders,
    }));
  }, [attributes]);

  // Scatter data for word cloud simulation
  const scatterData = useMemo(() => {
    return attributes.slice(0, 50).map((a: any) => ({
      x: a.impressions,
      y: a.cvr,
      z: a.clicks,
      word: a.word,
      category: a.category,
    }));
  }, [attributes]);

  const handleExportCSV = () => {
    if (!filteredAttributes.length) return;
    const headers = ["属性词", "分类", "曝光", "点击", "订单", "花费", "CVR%", "ACoS%", "关联搜索词数"];
    const rows = filteredAttributes.map((a: any) => [
      a.word, CATEGORY_CONFIG[a.category]?.name || a.category,
      a.impressions, a.clicks, a.orders, a.cost.toFixed(2), a.cvr, a.acos, a.termCount,
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `word_frequency_analysis_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV导出成功");
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Type className="w-5 h-5 text-purple-600" />
          <h3 className="font-semibold">词频属性6分类分析</h3>
          <Badge variant="outline" className="text-xs">{data?.totalWords || 0} 个属性词</Badge>
          {data?.isMock && <Badge variant="secondary" className="text-xs">模拟数据</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue placeholder="全部分类" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部分类</SelectItem>
              {Object.entries(CATEGORY_CONFIG).map(([key, config]) => (
                <SelectItem key={key} value={key}>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: config.color }} />
                    {config.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleExportCSV}>
            <Download className="w-3.5 h-3.5 mr-1" />
            导出CSV
          </Button>
        </div>
      </div>

      {/* Category Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {Object.entries(CATEGORY_CONFIG).map(([cat, config]) => {
          const stats = categoryStats[Number(cat)] || { count: 0, impressions: 0, clicks: 0, orders: 0, cost: 0 };
          const Icon = config.icon;
          return (
            <Card
              key={cat}
              className={`cursor-pointer transition-all ${selectedCategory === cat ? 'ring-2 ring-offset-1' : 'hover:shadow-md'} ${config.bgColor}`}
              style={selectedCategory === cat ? { borderColor: config.color } : {}}
              onClick={() => setSelectedCategory(selectedCategory === cat ? "all" : cat)}
            >
              <CardContent className="pt-3 pb-2.5 px-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className="w-3.5 h-3.5" style={{ color: config.color }} />
                  <span className="text-xs font-medium" style={{ color: config.color }}>{config.name}</span>
                </div>
                <p className="text-lg font-bold">{stats.count}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{config.description}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Pie Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">属性词分类分布</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%" cy="50%"
                    innerRadius={45} outerRadius={75}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: any, name: string) => [value, name === "value" ? "词数" : name]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Top Attributes Bar Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Top15属性词表现</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topAttributes} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 9 }} />
                  <YAxis dataKey="word" type="category" tick={{ fontSize: 9 }} width={80} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: "10px" }} />
                  <Bar dataKey="曝光" fill="#3b82f6" radius={[0, 2, 2, 0]} />
                  <Bar dataKey="订单" fill="#10b981" radius={[0, 2, 2, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Scatter Plot - Word Bubble */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">属性词气泡图（X=曝光量, Y=转化率, 大小=点击量）</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="x" name="曝光" tick={{ fontSize: 9 }} />
                <YAxis dataKey="y" name="CVR%" tick={{ fontSize: 9 }} />
                <ZAxis dataKey="z" range={[30, 300]} name="点击" />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  content={({ payload }) => {
                    if (!payload?.[0]) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-white border rounded-lg p-2 shadow-lg text-xs">
                        <p className="font-semibold">{d.word}</p>
                        <p>曝光: {d.x?.toLocaleString()}</p>
                        <p>CVR: {d.y}%</p>
                        <p>点击: {d.z}</p>
                        <p>分类: {CATEGORY_CONFIG[d.category]?.name}</p>
                      </div>
                    );
                  }}
                />
                <Scatter data={scatterData} fill="#8b5cf6" fillOpacity={0.6} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Attributes Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span>属性词明细 ({filteredAttributes.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/50">
                  <th className="text-left p-2.5 font-medium text-gray-600 w-8">#</th>
                  <th className="text-left p-2.5 font-medium text-gray-600">属性词</th>
                  <th className="text-center p-2.5 font-medium text-gray-600">分类</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">曝光</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">点击</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">订单</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">花费</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">CVR</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">ACoS</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">关联词数</th>
                  <th className="text-left p-2.5 font-medium text-gray-600">建议操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredAttributes.length === 0 ? (
                  <tr><td colSpan={11} className="text-center py-8 text-gray-400">暂无属性词数据</td></tr>
                ) : (
                  filteredAttributes.slice(0, 100).map((attr: any, i: number) => {
                    const config = CATEGORY_CONFIG[attr.category] || CATEGORY_CONFIG[6];
                    return (
                      <tr key={i} className="border-b hover:bg-gray-50/50">
                        <td className="p-2.5 text-gray-400 text-xs">{i + 1}</td>
                        <td className="p-2.5 text-xs font-medium">{attr.word}</td>
                        <td className="p-2.5 text-center">
                          <Badge variant="outline" className="text-[10px]" style={{ borderColor: config.color, color: config.color }}>
                            {config.name}
                          </Badge>
                        </td>
                        <td className="p-2.5 text-right text-xs">{attr.impressions.toLocaleString()}</td>
                        <td className="p-2.5 text-right text-xs">{attr.clicks.toLocaleString()}</td>
                        <td className="p-2.5 text-right text-xs font-medium text-emerald-600">{attr.orders}</td>
                        <td className="p-2.5 text-right text-xs text-red-600">${attr.cost.toFixed(2)}</td>
                        <td className="p-2.5 text-right text-xs">
                          <span className={`font-medium ${attr.cvr >= 10 ? "text-emerald-600" : attr.cvr >= 3 ? "text-blue-600" : "text-gray-500"}`}>
                            {attr.cvr}%
                          </span>
                        </td>
                        <td className="p-2.5 text-right text-xs">
                          <span className={`${attr.acos <= 25 ? "text-emerald-600" : attr.acos <= 40 ? "text-amber-600" : "text-red-600"}`}>
                            {attr.acos > 900 ? "∞" : `${attr.acos}%`}
                          </span>
                        </td>
                        <td className="p-2.5 text-right text-xs text-gray-500">{attr.termCount}</td>
                        <td className="p-2.5 text-xs text-gray-600 max-w-[180px]">{config.action}</td>
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
