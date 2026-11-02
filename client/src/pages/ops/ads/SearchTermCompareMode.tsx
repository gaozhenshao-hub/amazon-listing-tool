import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell,
} from "recharts";
import {
  Search, Download, ArrowUpRight, ArrowDownRight,
  GitCompareArrows, TrendingUp, DollarSign, Eye, MousePointerClick,
  ShoppingCart, BarChart3, ChevronDown, ChevronUp, Info,
} from "lucide-react";

// Colors for up to 10 campaigns
const CAMPAIGN_COLORS = [
  "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

interface CampaignSource {
  campaignId: string;
  campaignName: string;
  impressions: number;
  clicks: number;
  cost: number;
  sales: number;
  orders: number;
}

interface SearchTermData {
  query: string;
  target_text?: string;
  match_type?: string;
  impressions: number;
  clicks: number;
  cost: number;
  sales: number;
  orders: number;
  acos: number;
  ctr: number;
  convRate: number;
  categoryId: number;
  sourceCampaigns: CampaignSource[];
  campaignCount: number;
}

interface CampaignSummary {
  campaignId: string;
  campaignName: string;
  termCount: number;
  totalCost: number;
  totalSales: number;
  totalOrders: number;
}

interface OverlapStats {
  overlapCount: number;
  uniqueCount: number;
  overlapCost: number;
  overlapSales: number;
}

interface SearchTermCompareModeProps {
  searchTerms: SearchTermData[];
  campaignNames: Record<string, string>;
  campaignSummaries: CampaignSummary[];
  overlapStats: OverlapStats;
  campaignIds: string[];
}

const CATEGORY_SHORT_LABELS: Record<number, string> = {
  1: "核心大词", 2: "流量陷阱词", 3: "潜力提升词", 4: "低效大词",
  5: "高效精准词", 6: "需优化转化词", 7: "隐藏宝藏词", 8: "观察淘汰词",
  9: "精准长尾词", 10: "小众吸引词", 11: "冷门精准词", 12: "无效词",
};

export default function SearchTermCompareMode({
  searchTerms, campaignNames, campaignSummaries, overlapStats, campaignIds,
}: SearchTermCompareModeProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<string>("cost");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedTermForRadar, setSelectedTermForRadar] = useState<string | null>(null);
  const [overlapFilter, setOverlapFilter] = useState<"all" | "overlap" | "unique">("all");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Only show terms that appear in multiple campaigns for comparison
  const comparableTerms = useMemo(() => {
    let result = searchTerms.filter(t => t.sourceCampaigns && t.sourceCampaigns.length > 0);
    
    if (overlapFilter === "overlap") {
      result = result.filter(t => t.campaignCount > 1);
    } else if (overlapFilter === "unique") {
      result = result.filter(t => t.campaignCount === 1);
    }
    
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(t => (t.query || "").toLowerCase().includes(q));
    }

    result.sort((a, b) => {
      const aVal = (a as any)[sortField] || 0;
      const bVal = (b as any)[sortField] || 0;
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });

    return result;
  }, [searchTerms, searchQuery, sortField, sortDir, overlapFilter]);

  // Build campaign color map
  const campaignColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    campaignIds.forEach((id, i) => {
      map[id] = CAMPAIGN_COLORS[i % CAMPAIGN_COLORS.length];
    });
    return map;
  }, [campaignIds]);

  // Radar chart data for selected term
  const radarData = useMemo(() => {
    if (!selectedTermForRadar) return [];
    const term = searchTerms.find(t => t.query === selectedTermForRadar);
    if (!term || !term.sourceCampaigns) return [];

    // Normalize metrics to 0-100 scale for radar
    const maxValues = {
      impressions: Math.max(...term.sourceCampaigns.map(s => s.impressions), 1),
      clicks: Math.max(...term.sourceCampaigns.map(s => s.clicks), 1),
      cost: Math.max(...term.sourceCampaigns.map(s => s.cost), 0.01),
      sales: Math.max(...term.sourceCampaigns.map(s => s.sales), 0.01),
      orders: Math.max(...term.sourceCampaigns.map(s => s.orders), 1),
    };

    const metrics = ["曝光", "点击", "花费", "销售额", "订单"];
    const keys = ["impressions", "clicks", "cost", "sales", "orders"] as const;

    return metrics.map((metric, i) => {
      const row: any = { metric };
      term.sourceCampaigns.forEach(src => {
        const name = campaignNames[src.campaignId]?.slice(0, 20) || src.campaignId;
        row[name] = Math.round((src[keys[i]] / maxValues[keys[i]]) * 100);
      });
      return row;
    });
  }, [selectedTermForRadar, searchTerms, campaignNames]);

  // Campaign performance comparison bar chart data
  const campaignBarData = useMemo(() => {
    return campaignSummaries.map(cs => ({
      name: (campaignNames[cs.campaignId] || cs.campaignName).slice(0, 25),
      fullName: campaignNames[cs.campaignId] || cs.campaignName,
      campaignId: cs.campaignId,
      搜索词数: cs.termCount,
      花费: Math.round(cs.totalCost * 100) / 100,
      销售额: Math.round(cs.totalSales * 100) / 100,
      订单: cs.totalOrders,
      ACoS: cs.totalSales > 0 ? Math.round(cs.totalCost / cs.totalSales * 10000) / 100 : 0,
      ROAS: cs.totalCost > 0 ? Math.round(cs.totalSales / cs.totalCost * 100) / 100 : 0,
    }));
  }, [campaignSummaries, campaignNames]);

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir(sortDir === "desc" ? "asc" : "desc");
    else { setSortField(field); setSortDir("desc"); }
  };

  const toggleRowExpand = (query: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(query)) next.delete(query);
      else next.add(query);
      return next;
    });
  };

  const handleExportCompareCSV = () => {
    const campaignList = campaignIds.map(id => campaignNames[id] || id);
    const headers = ["搜索词", "分类", "重叠活动数", "总曝光", "总点击", "总花费", "总销售额", "总订单", "总ACoS"];
    // Add per-campaign columns
    campaignList.forEach(name => {
      headers.push(`${name}-曝光`, `${name}-点击`, `${name}-花费`, `${name}-销售额`, `${name}-订单`, `${name}-ACoS`);
    });

    const rows = comparableTerms.map(t => {
      const base = [
        `"${(t.query || '').replace(/"/g, '""')}"`,
        CATEGORY_SHORT_LABELS[t.categoryId] || "",
        String(t.campaignCount),
        String(t.impressions), String(t.clicks),
        t.cost.toFixed(2), t.sales.toFixed(2),
        String(t.orders), `${t.acos}%`,
      ];
      // Per-campaign data
      campaignIds.forEach(cid => {
        const src = t.sourceCampaigns?.find(s => s.campaignId === cid);
        if (src) {
          const srcAcos = src.sales > 0 ? Math.round(src.cost / src.sales * 10000) / 100 : 0;
          base.push(
            String(src.impressions), String(src.clicks),
            src.cost.toFixed(2), src.sales.toFixed(2),
            String(src.orders), `${srcAcos}%`,
          );
        } else {
          base.push("0", "0", "0.00", "0.00", "0", "0%");
        }
      });
      return base;
    });

    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `search_terms_compare_${campaignIds.length}campaigns_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`已导出${comparableTerms.length}条对比数据`);
  };

  const radarCampaignNames = useMemo(() => {
    if (!selectedTermForRadar) return [];
    const term = searchTerms.find(t => t.query === selectedTermForRadar);
    if (!term) return [];
    return term.sourceCampaigns.map(s => ({
      name: campaignNames[s.campaignId]?.slice(0, 20) || s.campaignId,
      color: campaignColorMap[s.campaignId] || "#999",
    }));
  }, [selectedTermForRadar, searchTerms, campaignNames, campaignColorMap]);

  return (
    <div className="space-y-4">
      {/* Overlap Statistics Banner */}
      <Card className="border-purple-200 bg-gradient-to-r from-purple-50/80 to-blue-50/80">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <GitCompareArrows className="w-5 h-5 text-purple-600" />
              <span className="font-semibold text-purple-800">跨活动搜索词对比分析</span>
              <Badge variant="outline" className="text-[10px] bg-purple-100 text-purple-700 border-purple-300">
                {campaignIds.length} 个活动
              </Badge>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white/80 rounded-lg p-3 border border-purple-100">
              <div className="text-xs text-gray-500 mb-1">重叠搜索词</div>
              <div className="text-xl font-bold text-purple-700">{overlapStats.overlapCount}</div>
              <div className="text-[10px] text-gray-400">出现在2+个活动中</div>
            </div>
            <div className="bg-white/80 rounded-lg p-3 border border-blue-100">
              <div className="text-xs text-gray-500 mb-1">独有搜索词</div>
              <div className="text-xl font-bold text-blue-700">{overlapStats.uniqueCount}</div>
              <div className="text-[10px] text-gray-400">仅出现在1个活动中</div>
            </div>
            <div className="bg-white/80 rounded-lg p-3 border border-amber-100">
              <div className="text-xs text-gray-500 mb-1">重叠词花费</div>
              <div className="text-xl font-bold text-amber-700">${overlapStats.overlapCost.toFixed(2)}</div>
              <div className="text-[10px] text-gray-400">可能存在内部竞争</div>
            </div>
            <div className="bg-white/80 rounded-lg p-3 border border-emerald-100">
              <div className="text-xs text-gray-500 mb-1">重叠词销售</div>
              <div className="text-xl font-bold text-emerald-700">${overlapStats.overlapSales.toFixed(2)}</div>
              <div className="text-[10px] text-gray-400">跨活动贡献</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Campaign Performance Comparison */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-500" />
            各活动投放效果对比
          </CardTitle>
          <CardDescription className="text-xs">
            比较各广告活动的搜索词投放表现
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Cost vs Sales bar chart */}
            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">花费 vs 销售额</p>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={campaignBarData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 9 }} />
                    <Tooltip
                      formatter={(value: number, name: string) => [`$${value.toFixed(2)}`, name]}
                      labelFormatter={(label) => {
                        const item = campaignBarData.find(d => d.name === label);
                        return item?.fullName || label;
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    <Bar dataKey="花费" fill="#f59e0b" radius={[0, 2, 2, 0]} barSize={12} />
                    <Bar dataKey="销售额" fill="#10b981" radius={[0, 2, 2, 0]} barSize={12} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            {/* ACoS comparison */}
            <div>
              <p className="text-xs font-medium text-gray-600 mb-2">ACoS 对比</p>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={campaignBarData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 9 }} />
                    <Tooltip formatter={(value: number) => [`${value}%`, "ACoS"]} />
                    <Bar dataKey="ACoS" radius={[0, 4, 4, 0]} barSize={16}>
                      {campaignBarData.map((entry, idx) => (
                        <Cell
                          key={idx}
                          fill={entry.ACoS <= 20 ? "#10b981" : entry.ACoS <= 35 ? "#f59e0b" : "#ef4444"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Campaign summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 mt-4">
            {campaignSummaries.map((cs, i) => {
              const acos = cs.totalSales > 0 ? Math.round(cs.totalCost / cs.totalSales * 10000) / 100 : 0;
              return (
                <div
                  key={cs.campaignId}
                  className="p-2.5 rounded-lg border bg-white hover:shadow-sm transition-shadow"
                  style={{ borderLeftColor: campaignColorMap[cs.campaignId], borderLeftWidth: 3 }}
                >
                  <p className="text-[10px] font-medium text-gray-700 truncate mb-1.5" title={cs.campaignName}>
                    {campaignNames[cs.campaignId]?.slice(0, 25) || cs.campaignName}
                  </p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                    <div><span className="text-gray-400">词数:</span> <span className="font-medium">{cs.termCount}</span></div>
                    <div><span className="text-gray-400">订单:</span> <span className="font-medium">{cs.totalOrders}</span></div>
                    <div><span className="text-gray-400">花费:</span> <span className="font-medium">${cs.totalCost.toFixed(0)}</span></div>
                    <div><span className="text-gray-400">销售:</span> <span className="font-medium text-emerald-600">${cs.totalSales.toFixed(0)}</span></div>
                    <div className="col-span-2">
                      <span className="text-gray-400">ACoS:</span>{" "}
                      <span className={`font-bold ${acos <= 20 ? "text-emerald-600" : acos <= 35 ? "text-amber-600" : "text-red-600"}`}>
                        {acos}%
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Radar Chart for Selected Term */}
      {selectedTermForRadar && radarData.length > 0 && (
        <Card className="border-indigo-200">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Eye className="w-4 h-4 text-indigo-500" />
                搜索词多维对比: <span className="text-indigo-600">"{selectedTermForRadar}"</span>
              </CardTitle>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelectedTermForRadar(null)}>
                关闭
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData}>
                  <PolarGrid stroke="#e5e7eb" />
                  <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
                  <PolarRadiusAxis tick={{ fontSize: 9 }} domain={[0, 100]} />
                  {radarCampaignNames.map((cn, i) => (
                    <Radar
                      key={cn.name}
                      name={cn.name}
                      dataKey={cn.name}
                      stroke={cn.color}
                      fill={cn.color}
                      fillOpacity={0.15}
                      strokeWidth={2}
                    />
                  ))}
                  <Tooltip formatter={(value: number) => [`${value}%`, "相对值"]} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            {/* Absolute values table below radar */}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-gray-50/50">
                    <th className="text-left p-2 font-medium text-gray-600">活动</th>
                    <th className="text-right p-2 font-medium text-gray-600">曝光</th>
                    <th className="text-right p-2 font-medium text-gray-600">点击</th>
                    <th className="text-right p-2 font-medium text-gray-600">花费</th>
                    <th className="text-right p-2 font-medium text-gray-600">销售额</th>
                    <th className="text-right p-2 font-medium text-gray-600">订单</th>
                    <th className="text-right p-2 font-medium text-gray-600">ACoS</th>
                    <th className="text-right p-2 font-medium text-gray-600">CTR</th>
                    <th className="text-right p-2 font-medium text-gray-600">CVR</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const term = searchTerms.find(t => t.query === selectedTermForRadar);
                    if (!term) return null;
                    return term.sourceCampaigns.map(src => {
                      const acos = src.sales > 0 ? Math.round(src.cost / src.sales * 10000) / 100 : 0;
                      const ctr = src.impressions > 0 ? Math.round(src.clicks / src.impressions * 10000) / 100 : 0;
                      const cvr = src.clicks > 0 ? Math.round(src.orders / src.clicks * 10000) / 100 : 0;
                      return (
                        <tr key={src.campaignId} className="border-b hover:bg-gray-50/50">
                          <td className="p-2">
                            <div className="flex items-center gap-1.5">
                              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: campaignColorMap[src.campaignId] }} />
                              <span className="truncate max-w-[200px]">{campaignNames[src.campaignId]?.slice(0, 30) || src.campaignId}</span>
                            </div>
                          </td>
                          <td className="p-2 text-right">{src.impressions.toLocaleString()}</td>
                          <td className="p-2 text-right">{src.clicks.toLocaleString()}</td>
                          <td className="p-2 text-right">${src.cost.toFixed(2)}</td>
                          <td className="p-2 text-right font-medium">${src.sales.toFixed(2)}</td>
                          <td className="p-2 text-right">{src.orders}</td>
                          <td className="p-2 text-right">
                            <span className={`font-medium ${acos <= 20 ? "text-emerald-600" : acos <= 35 ? "text-amber-600" : "text-red-600"}`}>
                              {acos}%
                            </span>
                          </td>
                          <td className="p-2 text-right">{ctr}%</td>
                          <td className="p-2 text-right">{cvr}%</td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Side-by-Side Comparison Table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm">搜索词并排对比</CardTitle>
              <CardDescription className="text-xs">
                共{comparableTerms.length}个搜索词 · 点击搜索词查看雷达图对比
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {/* Overlap filter */}
              <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                {([
                  { key: "all", label: "全部" },
                  { key: "overlap", label: `重叠(${overlapStats.overlapCount})` },
                  { key: "unique", label: `独有(${overlapStats.uniqueCount})` },
                ] as const).map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => setOverlapFilter(opt.key)}
                    className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-all ${
                      overlapFilter === opt.key
                        ? "bg-white text-purple-700 shadow-sm border border-purple-200"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <Input
                  placeholder="搜索..."
                  className="pl-7 h-8 w-40 text-xs"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Button variant="outline" size="sm" className="h-8" onClick={handleExportCompareCSV}>
                <Download className="w-3.5 h-3.5 mr-1" />
                导出对比CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-gray-50/50">
                  <th className="text-left p-2.5 font-medium text-gray-600 w-8 sticky left-0 bg-gray-50/50">#</th>
                  <th className="text-left p-2.5 font-medium text-gray-600 min-w-[160px] sticky left-8 bg-gray-50/50">搜索词</th>
                  <th className="text-center p-2.5 font-medium text-gray-600 w-16">分类</th>
                  <th className="text-center p-2.5 font-medium text-gray-600 w-10">
                    <TooltipProvider>
                      <UITooltip>
                        <TooltipTrigger><Info className="w-3 h-3 text-gray-400 mx-auto" /></TooltipTrigger>
                        <TooltipContent><p className="text-xs">出现在几个活动中</p></TooltipContent>
                      </UITooltip>
                    </TooltipProvider>
                  </th>
                  {/* Per-campaign column groups */}
                  {campaignIds.map((cid, i) => (
                    <th
                      key={cid}
                      colSpan={5}
                      className="text-center p-2 font-medium border-l-2"
                      style={{ borderLeftColor: campaignColorMap[cid], backgroundColor: `${campaignColorMap[cid]}08` }}
                    >
                      <div className="flex items-center justify-center gap-1">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: campaignColorMap[cid] }} />
                        <span className="truncate max-w-[120px] text-[10px]" title={campaignNames[cid] || cid}>
                          {(campaignNames[cid] || cid).slice(0, 18)}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
                <tr className="border-b bg-gray-50/30">
                  <th className="sticky left-0 bg-gray-50/30" />
                  <th className="sticky left-8 bg-gray-50/30" />
                  <th />
                  <th />
                  {campaignIds.map(cid => (
                    <React.Fragment key={`sub-${cid}`}>
                      {["曝光", "点击", "花费", "销售", "ACoS"].map(label => (
                        <th
                          key={`${cid}-${label}`}
                          className="text-right p-1.5 font-normal text-gray-500 text-[10px] cursor-pointer hover:text-blue-600"
                          onClick={() => handleSort(label === "曝光" ? "impressions" : label === "点击" ? "clicks" : label === "花费" ? "cost" : label === "销售" ? "sales" : "acos")}
                        >
                          {label}
                        </th>
                      ))}
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparableTerms.length === 0 ? (
                  <tr>
                    <td colSpan={4 + campaignIds.length * 5} className="text-center py-12 text-gray-400">
                      暂无匹配的搜索词数据
                    </td>
                  </tr>
                ) : (
                  comparableTerms.slice(0, 150).map((t, i) => {
                    const isExpanded = expandedRows.has(t.query);
                    return (
                      <tr
                        key={i}
                        className={`border-b transition-colors ${
                          selectedTermForRadar === t.query ? "bg-indigo-50/50" : "hover:bg-gray-50/30"
                        } ${t.campaignCount > 1 ? "" : "opacity-70"}`}
                      >
                        <td className="p-2 text-gray-400 sticky left-0 bg-white">{i + 1}</td>
                        <td className="p-2 sticky left-8 bg-white">
                          <button
                            className="text-left font-medium hover:text-indigo-600 transition-colors flex items-center gap-1 group"
                            onClick={() => setSelectedTermForRadar(selectedTermForRadar === t.query ? null : t.query)}
                            title="点击查看雷达图对比"
                          >
                            <span className="truncate max-w-[140px]">{t.query}</span>
                            {t.campaignCount > 1 && (
                              <GitCompareArrows className="w-3 h-3 text-purple-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                            )}
                          </button>
                        </td>
                        <td className="p-2 text-center">
                          <span className="text-[9px] text-gray-500">{CATEGORY_SHORT_LABELS[t.categoryId]?.slice(0, 4)}</span>
                        </td>
                        <td className="p-2 text-center">
                          <Badge
                            variant={t.campaignCount > 1 ? "default" : "outline"}
                            className={`text-[9px] ${t.campaignCount > 1 ? "bg-purple-100 text-purple-700 border-purple-200 border" : ""}`}
                          >
                            {t.campaignCount}
                          </Badge>
                        </td>
                        {/* Per-campaign data columns */}
                        {campaignIds.map(cid => {
                          const src = t.sourceCampaigns?.find(s => s.campaignId === cid);
                          if (!src) {
                            return (
                              <React.Fragment key={`${i}-${cid}`}>
                                {[0, 1, 2, 3, 4].map(j => (
                                  <td key={j} className="p-1.5 text-right text-gray-300 border-l" style={{ borderLeftColor: j === 0 ? campaignColorMap[cid] : undefined, borderLeftWidth: j === 0 ? 2 : undefined }}>
                                    —
                                  </td>
                                ))}
                              </React.Fragment>
                            );
                          }
                          const srcAcos = src.sales > 0 ? Math.round(src.cost / src.sales * 10000) / 100 : (src.cost > 0 ? 999 : 0);
                          return (
                            <React.Fragment key={`${i}-${cid}`}>
                              <td className="p-1.5 text-right border-l-2" style={{ borderLeftColor: campaignColorMap[cid] }}>
                                {src.impressions.toLocaleString()}
                              </td>
                              <td className="p-1.5 text-right">{src.clicks.toLocaleString()}</td>
                              <td className="p-1.5 text-right">${src.cost.toFixed(2)}</td>
                              <td className="p-1.5 text-right font-medium">${src.sales.toFixed(2)}</td>
                              <td className="p-1.5 text-right">
                                <span className={`font-medium ${
                                  srcAcos <= 20 ? "text-emerald-600" : srcAcos <= 35 ? "text-amber-600" : "text-red-600"
                                }`}>
                                  {srcAcos > 900 ? "∞" : `${srcAcos}%`}
                                </span>
                              </td>
                            </React.Fragment>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {comparableTerms.length > 150 && (
            <div className="p-3 text-center text-xs text-gray-500 border-t">
              显示前150条，共{comparableTerms.length}条。请使用筛选或导出查看全部数据。
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
