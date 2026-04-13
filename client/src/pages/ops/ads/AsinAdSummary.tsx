import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  Search, DollarSign, TrendingUp, Target, Package, Eye,
  ArrowUpDown, Download, RefreshCw, Layers,
} from "lucide-react";

interface AsinAdSummaryProps {
  marketplace?: string;
  reportDate: string;
  startDate?: string;
  endDate?: string;
}

const ACOS_COLORS = {
  good: "#10b981",   // <= 20%
  ok: "#f59e0b",     // 20-35%
  bad: "#ef4444",    // > 35%
};

function getAcosColor(acos: number) {
  if (acos <= 20) return ACOS_COLORS.good;
  if (acos <= 35) return ACOS_COLORS.ok;
  return ACOS_COLORS.bad;
}

export default function AsinAdSummary({ marketplace, reportDate, startDate, endDate }: AsinAdSummaryProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<string>("cost");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data, isLoading, refetch, isFetching } = trpc.adAnalysis.getAsinAdSummary.useQuery(
    { marketplace, reportDate, startDate, endDate },
    { staleTime: 5 * 60 * 1000 }
  );

  const asins = data?.asins || [];
  const totals = data?.totals;

  // Filter and sort
  const filteredAsins = useMemo(() => {
    let result = [...asins];
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(a => a.asin.toLowerCase().includes(q) || a.sku.toLowerCase().includes(q));
    }
    result.sort((a: any, b: any) => {
      const av = a[sortField] ?? 0;
      const bv = b[sortField] ?? 0;
      return sortDir === "desc" ? bv - av : av - bv;
    });
    return result;
  }, [asins, searchQuery, sortField, sortDir]);

  // Chart data: top 10 by cost
  const chartData = useMemo(() => {
    return asins.slice(0, 10).map(a => ({
      name: a.asin.length > 10 ? a.asin.slice(0, 5) + "..." + a.asin.slice(-5) : a.asin,
      fullAsin: a.asin,
      花费: Math.round(a.cost * 100) / 100,
      销售额: Math.round(a.sales * 100) / 100,
      ACoS: a.acos,
    }));
  }, [asins]);

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const exportCsv = () => {
    const headers = ["ASIN", "SKU", "广告类型", "活动数", "曝光", "点击", "花费($)", "销售额($)", "订单", "ACoS(%)", "ROAS", "CTR(%)", "CVR(%)", "CPC($)"];
    const rows = filteredAsins.map(a => [
      a.asin, a.sku, a.adTypes.join("+"), a.campaignCount,
      a.impressions, a.clicks, a.cost.toFixed(2), a.sales.toFixed(2), a.orders,
      a.acos.toFixed(2), a.roas.toFixed(2), a.ctr.toFixed(2), a.cvr.toFixed(2), a.cpc.toFixed(2),
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ASIN广告汇总_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV导出成功");
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* KPI Summary Cards */}
      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "总花费", value: `$${totals.cost.toFixed(2)}`, icon: DollarSign, color: "text-red-600", bg: "bg-red-50" },
            { label: "总销售额", value: `$${totals.sales.toFixed(2)}`, icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-50" },
            { label: "整体ACoS", value: `${totals.acos.toFixed(2)}%`, icon: Target, color: totals.acos <= 25 ? "text-emerald-600" : totals.acos <= 40 ? "text-amber-600" : "text-red-600", bg: totals.acos <= 25 ? "bg-emerald-50" : totals.acos <= 40 ? "bg-amber-50" : "bg-red-50" },
            { label: "整体ROAS", value: `${totals.roas.toFixed(2)}x`, icon: Layers, color: "text-blue-600", bg: "bg-blue-50" },
            { label: "ASIN数", value: asins.length.toString(), icon: Package, color: "text-purple-600", bg: "bg-purple-50" },
          ].map((kpi) => (
            <Card key={kpi.label} className={`${kpi.bg} border-none`}>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center gap-2 mb-1">
                  <kpi.icon className={`w-4 h-4 ${kpi.color}`} />
                  <span className="text-xs text-gray-600">{kpi.label}</span>
                </div>
                <p className={`text-xl font-bold ${kpi.color}`}>{kpi.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Top 10 ASIN Bar Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">ASIN花费 & 销售额 TOP10</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-15} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0]?.payload;
                      return (
                        <div className="bg-white border rounded-lg shadow-lg p-3 text-xs">
                          <p className="font-medium mb-1">{d?.fullAsin}</p>
                          <p className="text-red-600">花费: ${d?.花费}</p>
                          <p className="text-emerald-600">销售额: ${d?.销售额}</p>
                          <p style={{ color: getAcosColor(d?.ACoS || 0) }}>ACoS: {d?.ACoS}%</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="花费" fill="#ef4444" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="销售额" fill="#10b981" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ASIN Table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Package className="w-4 h-4" />
              ASIN广告投入产出明细
              <Badge variant="secondary" className="text-[10px]">{filteredAsins.length}个ASIN</Badge>
              {data?.isMock && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">模拟数据</Badge>}
            </CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <Input
                  placeholder="搜索ASIN/SKU..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 pl-8 text-xs w-48"
                />
              </div>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={exportCsv}>
                <Download className="w-3.5 h-3.5" />导出
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/50">
                  <th className="text-left p-2.5 font-medium text-gray-600">ASIN</th>
                  <th className="text-left p-2.5 font-medium text-gray-600">SKU</th>
                  <th className="text-center p-2.5 font-medium text-gray-600">类型</th>
                  <th className="text-right p-2.5 font-medium text-gray-600 cursor-pointer hover:text-blue-600" onClick={() => toggleSort("campaignCount")}>
                    <span className="inline-flex items-center gap-0.5">活动数<ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="text-right p-2.5 font-medium text-gray-600 cursor-pointer hover:text-blue-600" onClick={() => toggleSort("impressions")}>
                    <span className="inline-flex items-center gap-0.5">曝光<ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="text-right p-2.5 font-medium text-gray-600 cursor-pointer hover:text-blue-600" onClick={() => toggleSort("clicks")}>
                    <span className="inline-flex items-center gap-0.5">点击<ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="text-right p-2.5 font-medium text-gray-600 cursor-pointer hover:text-blue-600" onClick={() => toggleSort("cost")}>
                    <span className="inline-flex items-center gap-0.5">花费<ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="text-right p-2.5 font-medium text-gray-600 cursor-pointer hover:text-blue-600" onClick={() => toggleSort("sales")}>
                    <span className="inline-flex items-center gap-0.5">销售额<ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="text-right p-2.5 font-medium text-gray-600 cursor-pointer hover:text-blue-600" onClick={() => toggleSort("orders")}>
                    <span className="inline-flex items-center gap-0.5">订单<ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="text-right p-2.5 font-medium text-gray-600 cursor-pointer hover:text-blue-600" onClick={() => toggleSort("acos")}>
                    <span className="inline-flex items-center gap-0.5">ACoS<ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="text-right p-2.5 font-medium text-gray-600 cursor-pointer hover:text-blue-600" onClick={() => toggleSort("roas")}>
                    <span className="inline-flex items-center gap-0.5">ROAS<ArrowUpDown className="w-3 h-3" /></span>
                  </th>
                  <th className="text-right p-2.5 font-medium text-gray-600">CTR</th>
                  <th className="text-right p-2.5 font-medium text-gray-600">CPC</th>
                </tr>
              </thead>
              <tbody>
                {filteredAsins.length === 0 ? (
                  <tr><td colSpan={13} className="text-center py-8 text-gray-400">暂无ASIN广告数据</td></tr>
                ) : (
                  filteredAsins.map((a) => {
                    const acosColor = a.acos <= 20 ? "text-emerald-600" : a.acos <= 35 ? "text-amber-600" : "text-red-600";
                    return (
                      <tr key={a.asin} className="border-b hover:bg-gray-50/50">
                        <td className="p-2.5 font-mono text-xs font-medium">{a.asin}</td>
                        <td className="p-2.5 text-xs text-gray-500 max-w-[120px] truncate">{a.sku || "-"}</td>
                        <td className="p-2.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {a.adTypes.map(t => (
                              <Badge key={t} variant="outline" className={`text-[10px] px-1 ${
                                t === 'SP' ? 'border-blue-200 text-blue-700 bg-blue-50' :
                                t === 'SD' ? 'border-purple-200 text-purple-700 bg-purple-50' :
                                'border-gray-200 text-gray-700'
                              }`}>{t}</Badge>
                            ))}
                          </div>
                        </td>
                        <td className="p-2.5 text-right text-xs">{a.campaignCount}</td>
                        <td className="p-2.5 text-right text-xs">{a.impressions.toLocaleString()}</td>
                        <td className="p-2.5 text-right text-xs">{a.clicks.toLocaleString()}</td>
                        <td className="p-2.5 text-right text-xs text-red-600 font-medium">${a.cost.toFixed(2)}</td>
                        <td className="p-2.5 text-right text-xs text-emerald-600 font-medium">${a.sales.toFixed(2)}</td>
                        <td className="p-2.5 text-right text-xs">{a.orders}</td>
                        <td className="p-2.5 text-right text-xs">
                          <span className={`font-medium ${acosColor}`}>{a.acos > 900 ? "∞" : `${a.acos.toFixed(1)}%`}</span>
                        </td>
                        <td className="p-2.5 text-right text-xs font-medium text-blue-600">{a.roas.toFixed(2)}x</td>
                        <td className="p-2.5 text-right text-xs">{a.ctr.toFixed(2)}%</td>
                        <td className="p-2.5 text-right text-xs">${a.cpc.toFixed(2)}</td>
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
