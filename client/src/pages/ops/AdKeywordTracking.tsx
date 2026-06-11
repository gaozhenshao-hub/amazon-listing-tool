/**
 * Ad Keyword Tracking Component
 * Displays in product detail page between weekly ops data and sales trend chart
 * Features: collapsible keyword rows, weekly data sub-table, inline search volume editing
 */
import { useState, useMemo, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronRight, ChevronDown, Search, TrendingUp, TrendingDown,
  Minus, Edit3, Check, X, Megaphone, Info,
} from "lucide-react";
import {
  Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from "@/components/ui/tooltip";

// ─── Types ───
interface WeekData {
  weekStartDate: string;
  weekEndDate: string;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  spend: number | null;
  sales: number | null;
  acos: number | null;
  roas: number | null;
  orders: number;
  cvr: number | null;
  adSalesQty: number;
  directSales: number | null;
  indirectSales: number | null;
  directOrders: number;
  indirectOrders: number;
  bid: number | null;
  status: string | null;
  impressionShare: string | null;
  brandNewOrders: number;
  brandNewSales: number | null;
  brandSearchCount: number;
}

interface KeywordGroup {
  keyword: string;
  matchType: string;
  adType: string;
  campaignName: string;
  adGroupName: string;
  portfolioName: string;
  targetingType: string;
  weeks: WeekData[];
  meta: { monthlySearchVolume: number | null; notes: string | null; isTracked: number } | null;
  latestImpressions: number;
  latestSpend: number;
}

// ─── Helpers ───
function fmtNum(v: number | null | undefined, decimals = 0): string {
  if (v == null || isNaN(v)) return "-";
  return v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "-";
  return `${v.toFixed(1)}%`;
}

function fmtWeekRange(start: string, end: string): string {
  const s = start.replace(/-/g, "/").slice(5);
  const e = end.replace(/-/g, "/").slice(5);
  return `${s}-${e}`;
}

function WowIndicator({ current, previous }: { current: number | null; previous: number | null }) {
  if (current == null || previous == null || previous === 0) return null;
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.5) return null;
  const isUp = change > 0;
  return (
    <span className={`inline-flex items-center text-[10px] ml-1 ${isUp ? "text-emerald-600" : "text-red-600"}`}>
      {isUp ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
      {Math.abs(change).toFixed(0)}%
    </span>
  );
}

// ─── Match Type Badge ───
function MatchTypeBadge({ type }: { type: string }) {
  const config: Record<string, { label: string; className: string }> = {
    exact: { label: "精准", className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
    phrase: { label: "词组", className: "bg-amber-100 text-amber-700 border-amber-200" },
    broad: { label: "广泛", className: "bg-orange-100 text-orange-700 border-orange-200" },
    auto: { label: "自动", className: "bg-gray-100 text-gray-600 border-gray-200" },
  };
  const c = config[type] || config.auto;
  return <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${c.className}`}>{c.label}</Badge>;
}

// ─── Ad Type Badge ───
function AdTypeBadge({ type }: { type: string }) {
  const config: Record<string, { className: string }> = {
    SP: { className: "bg-green-100 text-green-700 border-green-200" },
    SB: { className: "bg-purple-100 text-purple-700 border-purple-200" },
    SD: { className: "bg-blue-100 text-blue-700 border-blue-200" },
  };
  const c = config[type] || { className: "bg-gray-100 text-gray-600 border-gray-200" };
  return <Badge variant="outline" className={`text-[10px] px-1.5 py-0 font-bold ${c.className}`}>{type}</Badge>;
}

// ─── Inline Search Volume Editor ───
function SearchVolumeEditor({
  keyword, productId, parentAsin, currentValue, onUpdate,
}: {
  keyword: string;
  productId: number;
  parentAsin: string;
  currentValue: number | null;
  onUpdate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentValue?.toString() || "");
  const updateMeta = trpc.adTracking.updateKeywordMeta.useMutation({
    onSuccess: () => {
      toast.success("月搜索量已更新");
      setEditing(false);
      onUpdate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (!editing) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); setEditing(true); setValue(currentValue?.toString() || ""); }}
        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 transition-colors"
      >
        <Search className="h-2.5 w-2.5" />
        {currentValue != null ? fmtNum(currentValue) : "--"}
        <Edit3 className="h-2 w-2 opacity-50" />
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <Input
        type="number"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-5 w-20 text-[10px] px-1"
        placeholder="月搜量"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            updateMeta.mutate({
              productId,
              parentAsin,
              keyword,
              monthlySearchVolume: value ? parseInt(value) : null,
            });
          } else if (e.key === "Escape") {
            setEditing(false);
          }
        }}
      />
      <button
        onClick={() => updateMeta.mutate({
          productId,
          parentAsin,
          keyword,
          monthlySearchVolume: value ? parseInt(value) : null,
        })}
        className="text-emerald-600 hover:text-emerald-700"
      >
        <Check className="h-3 w-3" />
      </button>
      <button onClick={() => setEditing(false)} className="text-red-500 hover:text-red-600">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

// ─── Keyword Row (Collapsed + Expanded) ───
function KeywordRow({
  kw, productId, parentAsin, onRefresh,
}: {
  kw: KeywordGroup;
  productId: number;
  parentAsin: string;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const latestWeek = kw.weeks[0];
  const prevWeek = kw.weeks[1];

  return (
    <>
      {/* Collapsed Row */}
      <tr
        className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="py-2 px-2 sticky left-0 bg-inherit z-10">
          <div className="flex items-center gap-1.5">
            {expanded
              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            }
            <span className="font-medium text-xs truncate max-w-[200px]" title={kw.keyword}>
              {kw.keyword}
            </span>
          </div>
        </td>
        <td className="py-2 px-1.5">
          <SearchVolumeEditor
            keyword={kw.keyword}
            productId={productId}
            parentAsin={parentAsin}
            currentValue={kw.meta?.monthlySearchVolume ?? null}
            onUpdate={onRefresh}
          />
        </td>
        <td className="py-2 px-1.5">
          <AdTypeBadge type={kw.adType} />
        </td>
        <td className="py-2 px-1.5">
          <MatchTypeBadge type={kw.matchType} />
        </td>
        <td className="py-2 px-1.5 text-right font-mono text-xs">
          {fmtNum(latestWeek?.impressions)}
        </td>
        <td className="py-2 px-1.5 text-right font-mono text-xs">
          {fmtNum(latestWeek?.clicks)}
        </td>
        <td className="py-2 px-1.5 text-right text-xs">
          {fmtPct(latestWeek?.ctr)}
        </td>
        <td className="py-2 px-1.5 text-right font-mono text-xs text-red-600">
          {latestWeek?.spend != null ? `$${fmtNum(latestWeek.spend, 1)}` : "-"}
        </td>
        <td className={`py-2 px-1.5 text-right text-xs font-medium ${
          latestWeek?.acos != null
            ? latestWeek.acos <= 25 ? "text-emerald-600" : latestWeek.acos <= 40 ? "text-amber-600" : "text-red-600"
            : ""
        }`}>
          {fmtPct(latestWeek?.acos)}
        </td>
      </tr>

      {/* Expanded: Weekly Data Sub-Table */}
      {expanded && (
        <tr>
          <td colSpan={9} className="p-0">
            <div className="bg-muted/20 border-b">
              <div className="px-4 py-2">
                <div className="flex items-center gap-2 mb-2 text-[10px] text-muted-foreground">
                  <Megaphone className="h-3 w-3" />
                  <span>广告活动: {kw.campaignName || "-"}</span>
                  <span className="mx-1">|</span>
                  <span>广告组: {kw.adGroupName || "-"}</span>
                  <span className="mx-1">|</span>
                  <span>组合: {kw.portfolioName || "-"}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="text-left py-1.5 px-2 font-medium">周期</th>
                        <th className="text-right py-1.5 px-2 font-medium">曝光</th>
                        <th className="text-right py-1.5 px-2 font-medium">点击</th>
                        <th className="text-right py-1.5 px-2 font-medium">CTR</th>
                        <th className="text-right py-1.5 px-2 font-medium">转化</th>
                        <th className="text-right py-1.5 px-2 font-medium">CVR</th>
                        <th className="text-right py-1.5 px-2 font-medium">销售额</th>
                        <th className="text-right py-1.5 px-2 font-medium">花费</th>
                        <th className="text-right py-1.5 px-2 font-medium">CPC</th>
                        <th className="text-right py-1.5 px-2 font-medium">ACoS</th>
                        <th className="text-right py-1.5 px-2 font-medium">ROAS</th>
                        <th className="text-right py-1.5 px-2 font-medium">竞价</th>
                        <th className="text-right py-1.5 px-2 font-medium">广告销量</th>
                        {/* Reserved for competitor data */}
                        <th className="text-right py-1.5 px-2 font-medium text-muted-foreground/50">竞品广告位</th>
                        <th className="text-right py-1.5 px-2 font-medium text-muted-foreground/50">竞品自然位</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kw.weeks.map((w, idx) => {
                        const prev = kw.weeks[idx + 1];
                        return (
                          <tr key={idx} className={`border-b last:border-0 hover:bg-muted/20 ${idx === 0 ? "bg-blue-50/20" : ""}`}>
                            <td className="py-1 px-2 font-medium whitespace-nowrap">
                              {fmtWeekRange(w.weekStartDate, w.weekEndDate)}
                              {idx === 0 && <Badge variant="secondary" className="ml-1 text-[8px] px-1 py-0">最新</Badge>}
                            </td>
                            <td className="py-1 px-2 text-right font-mono">
                              {fmtNum(w.impressions)}
                              <WowIndicator current={w.impressions} previous={prev?.impressions ?? null} />
                            </td>
                            <td className="py-1 px-2 text-right font-mono">
                              {fmtNum(w.clicks)}
                              <WowIndicator current={w.clicks} previous={prev?.clicks ?? null} />
                            </td>
                            <td className="py-1 px-2 text-right">{fmtPct(w.ctr)}</td>
                            <td className="py-1 px-2 text-right font-mono">{fmtNum(w.orders)}</td>
                            <td className="py-1 px-2 text-right">{fmtPct(w.cvr)}</td>
                            <td className="py-1 px-2 text-right font-mono text-emerald-600">
                              {w.sales != null ? `$${fmtNum(w.sales, 1)}` : "-"}
                              <WowIndicator current={w.sales} previous={prev?.sales ?? null} />
                            </td>
                            <td className="py-1 px-2 text-right font-mono text-red-600">
                              {w.spend != null ? `$${fmtNum(w.spend, 1)}` : "-"}
                              <WowIndicator current={w.spend} previous={prev?.spend ?? null} />
                            </td>
                            <td className="py-1 px-2 text-right font-mono">
                              {w.cpc != null ? `$${w.cpc.toFixed(2)}` : "-"}
                            </td>
                            <td className={`py-1 px-2 text-right font-medium ${
                              w.acos != null
                                ? w.acos <= 25 ? "text-emerald-600" : w.acos <= 40 ? "text-amber-600" : "text-red-600"
                                : ""
                            }`}>
                              {fmtPct(w.acos)}
                            </td>
                            <td className="py-1 px-2 text-right font-mono">
                              {w.roas != null ? w.roas.toFixed(1) : "-"}
                            </td>
                            <td className="py-1 px-2 text-right font-mono">
                              {w.bid != null ? `$${w.bid.toFixed(2)}` : "-"}
                            </td>
                            <td className="py-1 px-2 text-right font-mono">{fmtNum(w.adSalesQty)}</td>
                            {/* Reserved for competitor data */}
                            <td className="py-1 px-2 text-right text-muted-foreground/40">-</td>
                            <td className="py-1 px-2 text-right text-muted-foreground/40">-</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main Component ───
export default function AdKeywordTracking({
  productId,
  parentAsin,
}: {
  productId: number;
  parentAsin: string;
}) {
  const [filterType, setFilterType] = useState<"keyword" | "product" | "all">("keyword");
  const [searchTerm, setSearchTerm] = useState("");

  const { data, isLoading, refetch } = trpc.adTracking.getProductKeywords.useQuery(
    { productId, parentAsin, targetingType: filterType },
    { enabled: !!productId || !!parentAsin }
  );

  const filteredKeywords = useMemo(() => {
    if (!data?.keywords) return [];
    if (!searchTerm) return data.keywords;
    const lower = searchTerm.toLowerCase();
    return data.keywords.filter((kw: KeywordGroup) =>
      kw.keyword.toLowerCase().includes(lower) ||
      kw.campaignName.toLowerCase().includes(lower) ||
      kw.adGroupName.toLowerCase().includes(lower)
    );
  }, [data?.keywords, searchTerm]);

  const stats = useMemo(() => {
    if (!data?.keywords) return { total: 0, sp: 0, sb: 0, sd: 0, weeks: 0 };
    const keywords = data.keywords as KeywordGroup[];
    return {
      total: keywords.length,
      sp: keywords.filter((k: KeywordGroup) => k.adType === "SP").length,
      sb: keywords.filter((k: KeywordGroup) => k.adType === "SB").length,
      sd: keywords.filter((k: KeywordGroup) => k.adType === "SD").length,
      weeks: data.weeks?.length || 0,
    };
  }, [data]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <div className="animate-pulse text-sm text-muted-foreground">加载广告关键词数据...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-purple-600" />
            广告关键词跟踪
            {stats.total > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                ({stats.total}个关键词, {stats.weeks}周数据)
              </span>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            {/* Filter by targeting type */}
            <div className="flex items-center gap-1 bg-muted/50 rounded-md p-0.5">
              {[
                { value: "keyword" as const, label: "关键词" },
                { value: "product" as const, label: "商品定投" },
                { value: "all" as const, label: "全部" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setFilterType(opt.value)}
                  className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                    filterType === opt.value
                      ? "bg-background shadow-sm font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                placeholder="搜索关键词..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-7 w-40 pl-7 text-xs"
              />
            </div>
          </div>
        </div>
        {/* Ad type stats */}
        {stats.total > 0 && (
          <div className="flex items-center gap-3 mt-2">
            {stats.sp > 0 && (
              <span className="text-[10px] text-muted-foreground">
                <Badge variant="outline" className="text-[9px] px-1 py-0 bg-green-50 text-green-700 border-green-200 mr-1">SP</Badge>
                {stats.sp}
              </span>
            )}
            {stats.sb > 0 && (
              <span className="text-[10px] text-muted-foreground">
                <Badge variant="outline" className="text-[9px] px-1 py-0 bg-purple-50 text-purple-700 border-purple-200 mr-1">SB</Badge>
                {stats.sb}
              </span>
            )}
            {stats.sd > 0 && (
              <span className="text-[10px] text-muted-foreground">
                <Badge variant="outline" className="text-[9px] px-1 py-0 bg-blue-50 text-blue-700 border-blue-200 mr-1">SD</Badge>
                {stats.sd}
              </span>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {filteredKeywords.length === 0 ? (
          <div className="text-center py-8">
            <Megaphone className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              {stats.total === 0
                ? "暂无广告关键词数据，请先在数据导入中心导入广告报表"
                : "没有匹配的关键词"
              }
            </p>
            {stats.total === 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                需要先设置ASIN-广告组合映射，然后导入广告报表数据
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left py-2 px-2 font-medium sticky left-0 bg-muted/50 z-10 min-w-[200px]">关键词</th>
                  <th className="text-left py-2 px-1.5 font-medium min-w-[80px]">月搜量</th>
                  <th className="text-left py-2 px-1.5 font-medium">类型</th>
                  <th className="text-left py-2 px-1.5 font-medium">匹配</th>
                  <th className="text-right py-2 px-1.5 font-medium">曝光</th>
                  <th className="text-right py-2 px-1.5 font-medium">点击</th>
                  <th className="text-right py-2 px-1.5 font-medium">CTR</th>
                  <th className="text-right py-2 px-1.5 font-medium">花费</th>
                  <th className="text-right py-2 px-1.5 font-medium">ACoS</th>
                </tr>
              </thead>
              <tbody>
                {filteredKeywords.map((kw: KeywordGroup, idx: number) => (
                  <KeywordRow
                    key={`${kw.keyword}-${kw.matchType}-${kw.adType}-${idx}`}
                    kw={kw}
                    productId={productId}
                    parentAsin={parentAsin}
                    onRefresh={refetch}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
