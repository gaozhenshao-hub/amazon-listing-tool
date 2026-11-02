import { useState, useMemo, useEffect } from "react";
import React from "react";
import AdEmptyState from "./AdEmptyState";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Cell,
} from "recharts";
import { Monitor, Smartphone, LayoutGrid, TrendingUp, Search, ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, ChevronRight } from "lucide-react";

interface AdPlacementAnalysisProps {
  campaignId: string | null;
  campaignIds?: string[];
  campaignNamesList?: string[];
  marketplace?: string;
  reportDate: string;
  startDate?: string;
  endDate?: string;
  defaultAdType?: "SP" | "SB" | "SD";
}

// Map real API placement_type values to display config
const PLACEMENT_CONFIG: Record<string, { label: string; shortLabel: string; icon: any; color: string; fill: string }> = {
  "TOP OF SEARCH ON-AMAZON": { label: "搜索结果顶部 (TOS)", shortLabel: "TOS", icon: TrendingUp, color: "text-emerald-700", fill: "#10b981" },
  "Top of Search on-Amazon": { label: "搜索结果顶部 (TOS)", shortLabel: "TOS", icon: TrendingUp, color: "text-emerald-700", fill: "#10b981" },
  "Top of Search": { label: "搜索结果顶部 (TOS)", shortLabel: "TOS", icon: TrendingUp, color: "text-emerald-700", fill: "#10b981" },
  "REST OF SEARCH": { label: "搜索结果其余位置 (ROS)", shortLabel: "ROS", icon: LayoutGrid, color: "text-blue-700", fill: "#3b82f6" },
  "Rest of Search": { label: "搜索结果其余位置 (ROS)", shortLabel: "ROS", icon: LayoutGrid, color: "text-blue-700", fill: "#3b82f6" },
  "PRODUCT PAGES": { label: "商品页面 (PP)", shortLabel: "PP", icon: Smartphone, color: "text-purple-700", fill: "#8b5cf6" },
  "Product Pages": { label: "商品页面 (PP)", shortLabel: "PP", icon: Smartphone, color: "text-purple-700", fill: "#8b5cf6" },
  "Detail Page on-Amazon": { label: "商品页面 (PP)", shortLabel: "PP", icon: Smartphone, color: "text-purple-700", fill: "#8b5cf6" },
  "Other on-Amazon": { label: "其他位置", shortLabel: "Other", icon: Monitor, color: "text-gray-700", fill: "#9ca3af" },
  "Other": { label: "其他位置", shortLabel: "Other", icon: Monitor, color: "text-gray-700", fill: "#9ca3af" },
};

const getPlacementConfig = (name: string) => PLACEMENT_CONFIG[name] || { label: name, shortLabel: name.slice(0, 10), icon: Monitor, color: "text-gray-700", fill: "#9ca3af" };

type SortKey = "impressions" | "clicks" | "cost" | "sales" | "acos" | "ctr" | "cvr" | "orders";

export default function AdPlacementAnalysis({ campaignId, campaignIds, campaignNamesList, marketplace, reportDate, startDate, endDate, defaultAdType }: AdPlacementAnalysisProps) {
  const [adType, setAdType] = useState<"SP" | "SB" | "SD">(defaultAdType === "SB" ? "SB" : defaultAdType === "SD" ? "SD" : "SP");
  const [viewMode, setViewMode] = useState<"overview" | "keyword">("overview");
  const [searchKw, setSearchKw] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("impressions");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedKw, setExpandedKw] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (defaultAdType) {
      setAdType(defaultAdType === "SB" ? "SB" : defaultAdType === "SD" ? "SD" : "SP");
    }
  }, [defaultAdType]);

  // Overview data (from local uploaded data)
  const { data: overviewData, isLoading: overviewLoading } = trpc.adLocalAnalysis.getAdPlacementDataLocal.useQuery({
    campaignNames: campaignNamesList && campaignNamesList.length > 0 ? campaignNamesList : undefined,
    weekStartDate: startDate,
    weekEndDate: endDate,
    adType,
  });

  // Keyword dimension data (from local uploaded data)
  const { data: kwData, isLoading: kwLoading } = trpc.adLocalAnalysis.getAdPlacementByKeywordLocal.useQuery({
    campaignNames: campaignNamesList && campaignNamesList.length > 0 ? campaignNamesList : undefined,
    weekStartDate: startDate,
    weekEndDate: endDate,
    adType,
    searchKeyword: searchKw || undefined,
    sortBy,
    sortDir,
  }, {
    enabled: viewMode === "keyword",
  });

  const placements = overviewData?.placements || [];
  const keywords = kwData?.keywords || [];
  const placementNames = kwData?.placementNames || [];

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
        const label = getPlacementConfig(p.placement).label;
        const val = m.key === "acos_inv" ? Math.max(0, 100 - (p.acos || 0)) : p[m.key] || 0;
        row[label] = val;
      });
      return row;
    });
  }, [placements]);

  // Bar chart comparison
  const barData = useMemo(() => {
    return placements.map((p: any) => ({
      name: getPlacementConfig(p.placement).label,
      花费: p.cost,
      销售额: p.sales,
      fill: getPlacementConfig(p.placement).fill,
    }));
  }, [placements]);

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
  };

  const toggleExpand = (kwText: string) => {
    setExpandedKw(prev => {
      const next = new Set(prev);
      if (next.has(kwText)) next.delete(kwText);
      else next.add(kwText);
      return next;
    });
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortBy !== col) return <ArrowUpDown className="w-3 h-3 text-gray-300" />;
    return sortDir === "desc" ? <ArrowDown className="w-3 h-3 text-blue-600" /> : <ArrowUp className="w-3 h-3 text-blue-600" />;
  };

  const isLoading = viewMode === "overview" ? overviewLoading : kwLoading;

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-32" /><Skeleton className="h-64" /></div>;
  }

  if (viewMode === "overview" && placements.length === 0) {
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
      {/* Ad Type Switcher + View Mode */}
      <div className="flex items-center justify-between flex-wrap gap-2">
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

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">视图:</span>
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            <button
              onClick={() => setViewMode("overview")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                viewMode === "overview"
                  ? "bg-white text-blue-700 shadow-sm border border-blue-200"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              广告位总览
            </button>
            <button
              onClick={() => setViewMode("keyword")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                viewMode === "keyword"
                  ? "bg-white text-blue-700 shadow-sm border border-blue-200"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              关键词维度
            </button>
          </div>
        </div>
      </div>

      {/* ===== OVERVIEW MODE ===== */}
      {viewMode === "overview" && (
        <>
          {/* Placement KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {placements.map((p: any) => {
              const config = getPlacementConfig(p.placement);
              const Icon = config.icon;
              return (
                <Card key={p.placement} className="border-l-4" style={{ borderLeftColor: config.fill }}>
                  <CardContent className="pt-4 pb-3 px-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Icon className={`w-4 h-4 ${config.color}`} />
                      <span className={`text-sm font-medium ${config.color}`}>{config.label}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><p className="text-[10px] text-gray-500">曝光</p><p className="text-sm font-bold">{(p.impressions || 0).toLocaleString()}</p></div>
                      <div><p className="text-[10px] text-gray-500">点击</p><p className="text-sm font-bold">{(p.clicks || 0).toLocaleString()}</p></div>
                      <div><p className="text-[10px] text-gray-500">花费</p><p className="text-sm font-bold">${(p.cost || 0).toFixed(2)}</p></div>
                      <div><p className="text-[10px] text-gray-500">销售额</p><p className="text-sm font-bold text-emerald-600">${(p.sales || 0).toFixed(2)}</p></div>
                      <div><p className="text-[10px] text-gray-500">ACoS</p><p className={`text-sm font-bold ${(p.acos || 0) <= 25 ? "text-emerald-600" : (p.acos || 0) <= 40 ? "text-amber-600" : "text-red-600"}`}>{(p.acos || 0).toFixed(2)}%</p></div>
                      <div><p className="text-[10px] text-gray-500">CTR</p><p className="text-sm font-bold">{(p.ctr || 0).toFixed(2)}%</p></div>
                      <div><p className="text-[10px] text-gray-500">CVR</p><p className="text-sm font-bold">{(p.cvr || 0).toFixed(2)}%</p></div>
                      <div><p className="text-[10px] text-gray-500">ROAS</p><p className="text-sm font-bold text-blue-600">{(p.roas || 0).toFixed(2)}x</p></div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">广告位综合对比</CardTitle></CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData}>
                      <PolarGrid />
                      <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
                      <PolarRadiusAxis tick={{ fontSize: 9 }} />
                      {placements.map((p: any) => {
                        const label = getPlacementConfig(p.placement).label;
                        return (
                          <Radar key={p.placement} name={label} dataKey={label}
                            stroke={getPlacementConfig(p.placement).fill}
                            fill={getPlacementConfig(p.placement).fill}
                            fillOpacity={0.15} />
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
              <CardHeader className="pb-2"><CardTitle className="text-sm">花费 vs 销售额</CardTitle></CardHeader>
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
        </>
      )}

      {/* ===== KEYWORD DIMENSION MODE ===== */}
      {viewMode === "keyword" && (
        <>
          {/* Search bar */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="搜索关键词..."
                value={searchKw}
                onChange={(e) => setSearchKw(e.target.value)}
                className="pl-9 h-8 text-sm"
              />
            </div>
            <Badge variant="outline" className="text-[10px]">
              共 {keywords.length} 个关键词 | {placementNames.length} 个广告位
            </Badge>
          </div>

          {/* Keyword Table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="text-left px-3 py-2 font-medium text-gray-600 whitespace-nowrap" style={{ minWidth: '180px' }}>关键词</th>
                      {(["impressions", "clicks", "cost", "sales", "orders", "acos"] as SortKey[]).map(col => (
                        <th key={col}
                          className="text-right px-2 py-2 font-medium text-gray-600 cursor-pointer hover:bg-gray-100 whitespace-nowrap"
                          onClick={() => toggleSort(col)}
                        >
                          <span className="inline-flex items-center gap-1">
                            {col === "impressions" ? "曝光" : col === "clicks" ? "点击" : col === "cost" ? "花费" :
                              col === "sales" ? "销售额" : col === "orders" ? "订单" : "ACoS"}
                            <SortIcon col={col} />
                          </span>
                        </th>
                      ))}
                      <th className="text-right px-2 py-2 font-medium text-gray-600 cursor-pointer hover:bg-gray-100 whitespace-nowrap" onClick={() => toggleSort("ctr")}>
                        <span className="inline-flex items-center gap-1">CTR <SortIcon col={"ctr"} /></span>
                      </th>
                      <th className="text-right px-2 py-2 font-medium text-gray-600">CPC</th>
                      <th className="text-right px-2 py-2 font-medium text-gray-600 cursor-pointer hover:bg-gray-100 whitespace-nowrap" onClick={() => toggleSort("cvr")}>
                        <span className="inline-flex items-center gap-1">CVR <SortIcon col={"cvr"} /></span>
                      </th>
                      <th className="text-right px-2 py-2 font-medium text-gray-600">ROAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keywords.length === 0 && (
                      <tr><td colSpan={11} className="text-center py-8 text-gray-400">暂无关键词数据</td></tr>
                    )}
                    {keywords.map((kw: any, idx: number) => {
                      const kwText = kw.keyword_text || kw.keyword || "";
                      const isExpanded = expandedKw.has(kwText);
                      const kwPlacements = kw.placements || [];
                      return (
                        <React.Fragment key={kwText || `kw-${idx}`}>
                          {/* Main keyword row */}
                          <tr className={`border-b hover:bg-blue-50/30 cursor-pointer ${idx % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}
                            onClick={() => toggleExpand(kwText)}
                          >
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1.5">
                                {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />}
                                <span className="font-medium text-gray-800 truncate max-w-[180px]" title={kwText}>{kwText}</span>
                              </div>
                            </td>
                            <td className="text-right px-2 py-2 font-mono whitespace-nowrap">{(kw.totalImpressions || kw.impressions || 0).toLocaleString()}</td>
                            <td className="text-right px-2 py-2 font-mono whitespace-nowrap">{(kw.totalClicks || kw.clicks || 0).toLocaleString()}</td>
                            <td className="text-right px-2 py-2 font-mono whitespace-nowrap">${(kw.totalCost || kw.cost || 0).toFixed(2)}</td>
                            <td className="text-right px-2 py-2 font-mono text-emerald-600 whitespace-nowrap">${(kw.totalSales || kw.sales || 0).toFixed(2)}</td>
                            <td className="text-right px-2 py-2 font-mono whitespace-nowrap">{kw.totalOrders || kw.orders || 0}</td>
                            <td className={`text-right px-2 py-2 font-mono font-semibold whitespace-nowrap ${
                              (kw.totalAcos || kw.acos || 0) <= 25 ? "text-emerald-600" : (kw.totalAcos || kw.acos || 0) <= 40 ? "text-amber-600" : "text-red-600"
                            }`}>{(kw.totalAcos || kw.acos || 0).toFixed(1)}%</td>
                            <td className="text-right px-2 py-2 font-mono whitespace-nowrap">{(kw.totalClicks && kw.totalImpressions ? (kw.totalClicks / kw.totalImpressions * 100) : (kw.ctr || 0)).toFixed(2)}%</td>
                            <td className="text-right px-2 py-2 font-mono whitespace-nowrap">${(kw.totalClicks ? (kw.totalCost / kw.totalClicks) : (kw.cpc || 0)).toFixed(2)}</td>
                            <td className="text-right px-2 py-2 font-mono whitespace-nowrap">{(kw.totalOrders && kw.totalClicks ? (kw.totalOrders / kw.totalClicks * 100) : (kw.cvr || 0)).toFixed(1)}%</td>
                            <td className="text-right px-2 py-2 font-mono text-blue-600 whitespace-nowrap">{(kw.totalRoas || kw.roas || 0).toFixed(2)}x</td>
                          </tr>

                          {/* Expanded: mini cost distribution bar + placement breakdown */}
                          {isExpanded && kwPlacements.length > 0 && (() => {
                            const totalCost = kwPlacements.reduce((sum: number, p: any) => sum + (p.cost || 0), 0);
                            return (
                              <tr className="bg-blue-50/30 border-b">
                                <td colSpan={11} className="px-3 py-2">
                                  <div className="flex items-center gap-2 pl-5">
                                    <span className="text-[11px] text-gray-500 whitespace-nowrap">花费分布:</span>
                                    <div className="flex-1 flex h-5 rounded overflow-hidden border border-gray-200">
                                      {kwPlacements.map((p: any) => {
                                        const pct = totalCost > 0 ? (p.cost || 0) / totalCost * 100 : 0;
                                        if (pct < 0.5) return null;
                                        const pConfig = getPlacementConfig(p.placement);
                                        return (
                                          <div
                                            key={p.placement}
                                            className="relative flex items-center justify-center group"
                                            style={{ width: `${pct}%`, backgroundColor: pConfig.fill, minWidth: pct > 5 ? undefined : '2px' }}
                                            title={`${pConfig.label}: $${(p.cost || 0).toFixed(2)} (${pct.toFixed(1)}%)`}
                                          >
                                            {pct >= 12 && (
                                              <span className="text-[10px] text-white font-medium truncate px-1">
                                                {pConfig.shortLabel} {pct.toFixed(0)}%
                                              </span>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                      {kwPlacements.filter((p: any) => totalCost > 0 && (p.cost || 0) / totalCost >= 0.005).map((p: any) => {
                                        const pConfig = getPlacementConfig(p.placement);
                                        return (
                                          <span key={p.placement} className="flex items-center gap-0.5 text-[10px] text-gray-500">
                                            <span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: pConfig.fill }} />
                                            {pConfig.shortLabel}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            );
                          })()}
                          {isExpanded && kwPlacements.map((p: any) => {
                            const pConfig = getPlacementConfig(p.placement);
                            return (
                              <tr key={`${kwText}-${p.placement}`} className="bg-blue-50/20 border-b border-dashed">
                                <td className="px-3 py-1.5">
                                  <div className="flex items-center gap-1.5 pl-5">
                                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: pConfig.fill }} />
                                    <span className="text-gray-600 text-[11px]">{pConfig.label}</span>
                                  </div>
                                </td>
                                <td className="text-right px-2 py-1.5 font-mono text-gray-600 whitespace-nowrap">{(p.impressions || 0).toLocaleString()}</td>
                                <td className="text-right px-2 py-1.5 font-mono text-gray-600 whitespace-nowrap">{(p.clicks || 0).toLocaleString()}</td>
                                <td className="text-right px-2 py-1.5 font-mono text-gray-600 whitespace-nowrap">${(p.cost || 0).toFixed(2)}</td>
                                <td className="text-right px-2 py-1.5 font-mono text-gray-600 whitespace-nowrap">${(p.sales || 0).toFixed(2)}</td>
                                <td className="text-right px-2 py-1.5 font-mono text-gray-600 whitespace-nowrap">{p.orders || 0}</td>
                                <td className={`text-right px-2 py-1.5 font-mono whitespace-nowrap ${
                                  (p.acos || 0) <= 25 ? "text-emerald-600" : (p.acos || 0) <= 40 ? "text-amber-600" : "text-red-600"
                                }`}>{(p.acos || 0).toFixed(1)}%</td>
                                <td className="text-right px-2 py-1.5 font-mono text-gray-600 whitespace-nowrap">{(p.ctr || 0).toFixed(2)}%</td>
                                <td className="text-right px-2 py-1.5 font-mono text-gray-600 whitespace-nowrap">${(p.cpc || 0).toFixed(2)}</td>
                                <td className="text-right px-2 py-1.5 font-mono text-gray-600 whitespace-nowrap">{(p.cvr || 0).toFixed(1)}%</td>
                                <td className="text-right px-2 py-1.5 font-mono text-gray-600 whitespace-nowrap">{(p.roas || 0).toFixed(2)}x</td>
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Keyword Placement Comparison Chart - Top 10 keywords */}
          {keywords.length > 0 && placementNames.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Top 10 关键词广告位花费分布</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={keywords.slice(0, 10).map((kw: any) => {
                        const kwText = kw.keyword_text || kw.keyword || "";
                        const row: any = { name: kwText.length > 20 ? kwText.slice(0, 20) + "..." : kwText };
                        (kw.placements || []).forEach((p: any) => {
                          const pConfig = getPlacementConfig(p.placement);
                          row[pConfig.shortLabel] = p.cost || 0;
                        });
                        return row;
                      })}
                      layout="vertical"
                      margin={{ left: 10, right: 20 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={140} />
                      <Tooltip formatter={(val: number) => `$${val.toFixed(2)}`} />
                      <Legend wrapperStyle={{ fontSize: "11px" }} />
                      {placementNames.map((pName: string) => {
                        const pConfig = getPlacementConfig(pName);
                        return (
                          <Bar key={pName} dataKey={pConfig.shortLabel} stackId="a" fill={pConfig.fill} />
                        );
                      })}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Keyword Placement ACoS Comparison */}
          {keywords.length > 0 && placementNames.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Top 10 关键词各广告位 ACoS 对比</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={keywords.slice(0, 10).map((kw: any) => {
                        const kwText = kw.keyword_text || kw.keyword || "";
                        const row: any = { name: kwText.length > 20 ? kwText.slice(0, 20) + "..." : kwText };
                        (kw.placements || []).forEach((p: any) => {
                          const pConfig = getPlacementConfig(p.placement);
                          row[pConfig.shortLabel] = p.acos || 0;
                        });
                        return row;
                      })}
                      layout="vertical"
                      margin={{ left: 10, right: 20 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis type="number" tick={{ fontSize: 10 }} domain={[0, 'auto']} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={140} />
                      <Tooltip formatter={(val: number) => `${val.toFixed(1)}%`} />
                      <Legend wrapperStyle={{ fontSize: "11px" }} />
                      {placementNames.map((pName: string) => {
                        const pConfig = getPlacementConfig(pName);
                        return (
                          <Bar key={pName} dataKey={pConfig.shortLabel} fill={pConfig.fill} radius={[0, 4, 4, 0]} />
                        );
                      })}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
