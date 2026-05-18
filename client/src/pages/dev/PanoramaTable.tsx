import { useState, useMemo, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  CheckCircle2, AlertCircle, Download, Lock, Unlock, Save, X,
  FileText, Search, ChevronLeft, ChevronRight, ArrowUpDown,
  Table2, Eye, EyeOff, TrendingUp, BarChart3, Filter, XCircle,
  ChevronDown, ChevronUp, Tag, Layers, FolderOpen, FolderClosed,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell,
} from "recharts";

// ═══════════════════════════════════════════════════════════════════
// ─── Column Definitions ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

interface ColumnDef {
  key: string;
  label: string;
  group: string;
  width: number;
  editable?: boolean;
  type?: "text" | "number" | "boolean";
  render?: (value: any, product: any) => React.ReactNode;
}

const FIXED_COLUMNS: ColumnDef[] = [
  { key: "searchRank", label: "#", group: "基础信息", width: 50, type: "number" },
  { key: "asin", label: "ASIN", group: "基础信息", width: 120 },
  { key: "parentAsin", label: "父ASIN", group: "基础信息", width: 120, editable: true },
  { key: "sku", label: "SKU", group: "基础信息", width: 100, editable: true },
  { key: "brand", label: "品牌", group: "基础信息", width: 100, editable: true },
  { key: "imageUrl", label: "主图", group: "基础信息", width: 60, render: (v: string) => v ? <img src={v} className="w-8 h-8 object-cover rounded" alt="" /> : <span className="text-muted-foreground text-xs">-</span> },
  { key: "title", label: "商品标题", group: "基础信息", width: 250, editable: true },
  { key: "category", label: "大类目", group: "类目", width: 120, editable: true },
  { key: "subcategory", label: "小类目", group: "类目", width: 120, editable: true },
  { key: "categoryPath", label: "类目路径", group: "类目", width: 200, editable: true },
  { key: "bsrLarge", label: "大类BSR", group: "排名", width: 90, type: "number", editable: true },
  { key: "bsrSmall", label: "小类BSR", group: "排名", width: 90, type: "number", editable: true },
  { key: "bsr", label: "BSR", group: "排名", width: 80, type: "number", editable: true },
  { key: "bsrGrowthRate", label: "BSR增长率", group: "排名", width: 100, editable: true },
  { key: "price", label: "价格($)", group: "价格利润", width: 80, editable: true },
  { key: "fbaFee", label: "FBA费用", group: "价格利润", width: 80, editable: true },
  { key: "grossMargin", label: "毛利率", group: "价格利润", width: 80, editable: true },
  { key: "monthlySales", label: "月销量", group: "销量", width: 80, type: "number", editable: true },
  { key: "monthlySalesGrowth", label: "月销量增长率", group: "销量", width: 110, editable: true },
  { key: "monthlyRevenue", label: "月销售额($)", group: "销量", width: 100, type: "number", editable: true },
  { key: "childSales", label: "子体销量", group: "销量", width: 80, type: "number", editable: true },
  { key: "childRevenue", label: "子体销售额", group: "销量", width: 100, type: "number", editable: true },
  { key: "variantCount", label: "变体数", group: "销量", width: 70, type: "number", editable: true },
  { key: "reviewCount", label: "评分数", group: "评论", width: 80, editable: true },
  { key: "monthlyNewReviews", label: "月新增评分", group: "评论", width: 100, type: "number", editable: true },
  { key: "rating", label: "评分", group: "评论", width: 60, editable: true },
  { key: "reviewRate", label: "留评率", group: "评论", width: 80, editable: true },
  { key: "lqs", label: "LQS", group: "Listing", width: 60, type: "number", editable: true },
  { key: "hasAPlus", label: "A+", group: "Listing", width: 50, type: "boolean" },
  { key: "hasVideo", label: "视频", group: "Listing", width: 50, type: "boolean" },
  { key: "hasBrandStory", label: "品牌故事", group: "Listing", width: 70, type: "boolean" },
  { key: "hasAmazonChoice", label: "AC", group: "Listing", width: 50, type: "boolean" },
  { key: "sellerCount", label: "卖家数", group: "卖家", width: 70, type: "number", editable: true },
  { key: "fulfillment", label: "配送方式", group: "卖家", width: 80, editable: true },
  { key: "buyboxSeller", label: "Buybox卖家", group: "卖家", width: 120, editable: true },
  { key: "buyboxType", label: "BuyBox类型", group: "卖家", width: 90, editable: true },
  { key: "sellerLocation", label: "卖家所属地", group: "卖家", width: 100, editable: true },
  { key: "listingDate", label: "上架时间", group: "时间", width: 100, editable: true },
  { key: "listingDays", label: "上架天数", group: "时间", width: 80, type: "number", editable: true },
  { key: "productWeight", label: "商品重量", group: "物流", width: 90, editable: true },
  { key: "productSize", label: "商品尺寸", group: "物流", width: 120, editable: true },
  { key: "packageWeight", label: "包装重量", group: "物流", width: 90, editable: true },
  { key: "packageSize", label: "包装尺寸", group: "物流", width: 120, editable: true },
  { key: "packageSizeTier", label: "尺寸分段", group: "物流", width: 90, editable: true },
  { key: "bulletPoints", label: "产品卖点(五点)", group: "内容", width: 300, editable: true },
];

const ROW_HEIGHT = 40;
const PAGE_SIZE = 50;

// Color palette for multi-ASIN chart lines
const CHART_COLORS = [
  "#2563eb", "#dc2626", "#16a34a", "#ea580c", "#9333ea",
  "#0891b2", "#ca8a04", "#be185d", "#4f46e5", "#059669",
  "#d97706", "#7c3aed", "#0d9488", "#e11d48", "#6366f1",
];

// ═══════════════════════════════════════════════════════════════════
// ─── Tag Dropdown Editor ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

function TagDropdownEditor({
  value,
  options,
  onSave,
  onCancel,
}: {
  value: string;
  options: string[];
  onSave: (v: string) => void;
  onCancel: () => void;
}) {
  const [inputValue, setInputValue] = useState(value);
  const [showDropdown, setShowDropdown] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredOptions = useMemo(() => {
    if (!inputValue) return options;
    const lower = inputValue.toLowerCase();
    return options.filter(o => o.toLowerCase().includes(lower));
  }, [options, inputValue]);

  return (
    <div className="relative">
      <div className="flex items-center gap-0.5">
        <Input
          ref={inputRef}
          value={inputValue}
          onChange={e => { setInputValue(e.target.value); setShowDropdown(true); }}
          className="h-6 text-xs px-1"
          autoFocus
          placeholder="输入或选择标签值..."
          onKeyDown={e => {
            if (e.key === "Enter") { onSave(inputValue); setShowDropdown(false); }
            if (e.key === "Escape") onCancel();
          }}
          onFocus={() => setShowDropdown(true)}
        />
        <button onClick={() => { onSave(inputValue); setShowDropdown(false); }}
          className="text-emerald-600 hover:text-emerald-700 p-0.5 flex-shrink-0">
          <Save className="h-3 w-3" />
        </button>
        <button onClick={onCancel}
          className="text-muted-foreground hover:text-foreground p-0.5 flex-shrink-0">
          <X className="h-3 w-3" />
        </button>
      </div>
      {showDropdown && filteredOptions.length > 0 && (
        <div className="absolute top-7 left-0 z-50 bg-popover border rounded-md shadow-lg max-h-40 overflow-y-auto w-full min-w-[150px]">
          {filteredOptions.map((opt, i) => (
            <button
              key={i}
              className={`w-full text-left px-2 py-1 text-xs hover:bg-accent transition-colors ${opt === inputValue ? "bg-accent/50 font-medium" : ""}`}
              onMouseDown={e => {
                e.preventDefault();
                setInputValue(opt);
                onSave(opt);
                setShowDropdown(false);
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ─── Sales Trend Chart Dialog ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

function SalesTrendDialog({
  open,
  onClose,
  selectedAsins,
  products,
  historyCols,
  onToggleAsin,
  allAsins,
}: {
  open: boolean;
  onClose: () => void;
  selectedAsins: string[];
  products: any[];
  historyCols: string[];
  onToggleAsin: (asin: string) => void;
  allAsins: string[];
}) {
  // Build chart data: each point = { month, ASIN1: value, ASIN2: value, ... }
  const chartData = useMemo(() => {
    return historyCols.map(month => {
      const point: Record<string, any> = { month };
      for (const asin of selectedAsins) {
        const product = products.find((p: any) => p.asin === asin);
        if (product?.monthlySalesHistory) {
          try {
            const history = JSON.parse(product.monthlySalesHistory);
            point[asin] = history[month] ?? null;
          } catch {
            point[asin] = null;
          }
        }
      }
      return point;
    });
  }, [historyCols, selectedAsins, products]);

  // Get brand+title for display
  const getProductLabel = (asin: string) => {
    const p = products.find((pr: any) => pr.asin === asin);
    if (!p) return asin;
    const brand = p.brand || "";
    const title = (p.title || "").slice(0, 30);
    return `${asin} (${brand} ${title}${(p.title || "").length > 30 ? "..." : ""})`;
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            历史月销量趋势对比
          </DialogTitle>
        </DialogHeader>

        {/* ASIN selector */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">点击选择/取消ASIN进行对比（最多15个）：</p>
          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-2 border rounded-md bg-muted/30">
            {allAsins.map((asin, i) => {
              const isSelected = selectedAsins.includes(asin);
              const product = products.find((p: any) => p.asin === asin);
              const brand = product?.brand || "";
              return (
                <button
                  key={asin}
                  onClick={() => onToggleAsin(asin)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border transition-all ${
                    isSelected
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : "border-border bg-background text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  {isSelected && (
                    <span className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: CHART_COLORS[selectedAsins.indexOf(asin) % CHART_COLORS.length] }} />
                  )}
                  <span>{asin}</span>
                  {brand && <span className="opacity-60">({brand})</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Chart */}
        {selectedAsins.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <BarChart3 className="h-12 w-12 mb-3 opacity-30" />
            <p className="text-sm">请选择至少一个ASIN查看销量趋势</p>
          </div>
        ) : (
          <div className="w-full" style={{ height: Math.max(350, 350) }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 10 }}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                  stroke="hsl(var(--muted-foreground))"
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  stroke="hsl(var(--muted-foreground))"
                  tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "11px",
                  }}
                  formatter={(value: number, name: string) => {
                    const label = getProductLabel(name);
                    return [value != null ? `$${value.toLocaleString()}` : "-", label];
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: "10px", paddingTop: "8px" }}
                  formatter={(value: string) => {
                    const p = products.find((pr: any) => pr.asin === value);
                    return `${value}${p?.brand ? ` (${p.brand})` : ""}`;
                  }}
                />
                {selectedAsins.map((asin, idx) => (
                  <Line
                    key={asin}
                    type="monotone"
                    dataKey={asin}
                    stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    activeDot={{ r: 4 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Summary table */}
        {selectedAsins.length > 0 && (
          <div className="border rounded-md overflow-auto max-h-48">
            <table className="text-xs w-full">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium border-b">ASIN</th>
                  <th className="px-2 py-1.5 text-left font-medium border-b">品牌</th>
                  <th className="px-2 py-1.5 text-right font-medium border-b">最高月销</th>
                  <th className="px-2 py-1.5 text-right font-medium border-b">最低月销</th>
                  <th className="px-2 py-1.5 text-right font-medium border-b">平均月销</th>
                  <th className="px-2 py-1.5 text-right font-medium border-b">数据月数</th>
                </tr>
              </thead>
              <tbody>
                {selectedAsins.map((asin, idx) => {
                  const product = products.find((p: any) => p.asin === asin);
                  let values: number[] = [];
                  if (product?.monthlySalesHistory) {
                    try {
                      const h = JSON.parse(product.monthlySalesHistory);
                      values = Object.values(h).filter((v): v is number => typeof v === "number" && v > 0);
                    } catch {}
                  }
                  const max = values.length > 0 ? Math.max(...values) : 0;
                  const min = values.length > 0 ? Math.min(...values) : 0;
                  const avg = values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
                  return (
                    <tr key={asin} className="hover:bg-accent/30">
                      <td className="px-2 py-1 border-b">
                        <div className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }} />
                          {asin}
                        </div>
                      </td>
                      <td className="px-2 py-1 border-b">{product?.brand || "-"}</td>
                      <td className="px-2 py-1 border-b text-right font-mono">${max.toLocaleString()}</td>
                      <td className="px-2 py-1 border-b text-right font-mono">${min.toLocaleString()}</td>
                      <td className="px-2 py-1 border-b text-right font-mono">${avg.toLocaleString()}</td>
                      <td className="px-2 py-1 border-b text-right">{values.length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ─── PanoramaTable Component ─────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

export default function PanoramaTable({ projectId }: { projectId: number }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [editingCell, setEditingCell] = useState<{ productId: number; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set());
  const [trendOpen, setTrendOpen] = useState(false);
  const [selectedTrendAsins, setSelectedTrendAsins] = useState<string[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  // tagFilters: { [categoryName]: Set<selectedValue> }
  const [tagFilters, setTagFilters] = useState<Record<string, Set<string>>>({});
  // Group by tag
  const [groupByTag, setGroupByTag] = useState<string | null>(null);
  const [showGroupCharts, setShowGroupCharts] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [groupSortField, setGroupSortField] = useState<string>("count");
  const [groupSortDir, setGroupSortDir] = useState<"asc" | "desc">("desc");
  const [highlightedGroup, setHighlightedGroup] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const groupRowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.devPanorama.getData.useQuery({ projectId });
  const { data: statusData } = trpc.devPanorama.getStatus.useQuery({ projectId });
  const updateFieldMutation = trpc.devPanorama.updateProductField.useMutation({
    onSuccess: () => { utils.devPanorama.getData.invalidate({ projectId }); toast.success("已更新"); },
    onError: (e: any) => toast.error("更新失败: " + e.message),
  });
  const updateTagMutation = trpc.devPanorama.updateProductTag.useMutation({
    onSuccess: () => { utils.devPanorama.getData.invalidate({ projectId }); toast.success("标签已更新"); },
    onError: (e: any) => toast.error("标签更新失败: " + e.message),
  });
  const confirmMutation = trpc.devPanorama.confirm.useMutation({
    onSuccess: () => {
      utils.devPanorama.getStatus.invalidate({ projectId });
      utils.devPanorama.getData.invalidate({ projectId });
      toast.success("全景分析表已确认锁定");
    },
    onError: (e: any) => toast.error("确认失败: " + e.message),
  });
  const unlockMutation = trpc.devPanorama.unlock.useMutation({
    onSuccess: () => {
      utils.devPanorama.getStatus.invalidate({ projectId });
      utils.devPanorama.getData.invalidate({ projectId });
      toast.success("全景分析表已解锁");
    },
    onError: (e: any) => toast.error("解锁失败: " + e.message),
  });
  const exportMutation = trpc.devPanorama.exportCsv.useMutation({
    onSuccess: (result: any) => {
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("导出成功");
    },
    onError: (e: any) => toast.error("导出失败: " + e.message),
  });

  const isConfirmed = statusData?.confirmed ?? false;

  // Build tag value options per category (for dropdown)
  const tagValueOptions = useMemo(() => {
    if (!data?.tagItems) return {};
    const map: Record<string, Set<string>> = {};
    for (const item of data.tagItems) {
      const catName = item.tagName;
      if (!map[catName]) map[catName] = new Set();
      if (item.tagValue) map[catName].add(item.tagValue);
    }
    // Also collect existing product tag values
    if (data.tagMap) {
      for (const asinTags of Object.values(data.tagMap)) {
        for (const [dimName, dimValue] of Object.entries(asinTags as Record<string, string>)) {
          if (!map[dimName]) map[dimName] = new Set();
          if (dimValue) map[dimName].add(dimValue);
        }
      }
    }
    const result: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(map)) {
      result[k] = Array.from(v).sort();
    }
    return result;
  }, [data?.tagItems, data?.tagMap]);

  // Count products per tag value for filter display
  const tagValueCounts = useMemo(() => {
    if (!data?.products || !data?.tagMap) return {} as Record<string, Record<string, number>>;
    const counts: Record<string, Record<string, number>> = {};
    for (const p of data.products) {
      if (!p.asin) continue;
      const asinTags = data.tagMap[p.asin as string] || {};
      for (const [catName, catValue] of Object.entries(asinTags as Record<string, string>)) {
        if (!catValue) continue;
        if (!counts[catName]) counts[catName] = {};
        counts[catName][catValue] = (counts[catName][catValue] || 0) + 1;
      }
    }
    return counts;
  }, [data?.products, data?.tagMap]);

  // Build columns: fixed + history + tags
  const columns = useMemo(() => {
    if (!data) return FIXED_COLUMNS;
    const historyCols: ColumnDef[] = (data.historyCols || []).map((col: string) => ({
      key: `history_${col}`,
      label: col,
      group: "历史月销量",
      width: 80,
      type: "number" as const,
      editable: true,
    }));
    const tagCols: ColumnDef[] = (data.tagCategories || []).map((tc: { key: string; name: string }) => ({
      key: `tag_${tc.key}`,
      label: tc.name,
      group: "属性标签",
      width: 120,
      editable: true,
    }));
    return [...FIXED_COLUMNS, ...historyCols, ...tagCols];
  }, [data]);

  const visibleColumns = useMemo(() =>
    columns.filter(c => !hiddenGroups.has(c.group)),
    [columns, hiddenGroups]
  );

  const columnGroups = useMemo(() => {
    const groups: string[] = [];
    for (const c of columns) {
      if (!groups.includes(c.group)) groups.push(c.group);
    }
    return groups;
  }, [columns]);

  const getCellValue = useCallback((product: any, col: ColumnDef) => {
    if (col.key.startsWith("history_")) {
      const monthKey = col.key.replace("history_", "");
      try {
        const history = JSON.parse(product.monthlySalesHistory || "{}");
        return history[monthKey] ?? "";
      } catch { return ""; }
    }
    if (col.key.startsWith("tag_")) {
      const tagKey = col.key.replace("tag_", "");
      const tagCategory = data?.tagCategories?.find((tc: any) => tc.key === tagKey);
      if (tagCategory && data?.tagMap?.[product.asin]) {
        return data.tagMap[product.asin][tagCategory.name] || "";
      }
      return "";
    }
    return product[col.key] ?? "";
  }, [data]);

  const filteredProducts = useMemo(() => {
    if (!data?.products) return [];
    let products = [...data.products];
    // Text search
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      products = products.filter((p: any) =>
        (p.asin || "").toLowerCase().includes(term) ||
        (p.title || "").toLowerCase().includes(term) ||
        (p.brand || "").toLowerCase().includes(term)
      );
    }
    // Tag filters (AND across categories, OR within category)
    const filterEntries = Object.entries(tagFilters);
    if (filterEntries.length > 0 && data?.tagMap) {
      products = products.filter((p: any) => {
        const asinTags = data.tagMap[p.asin as string] || {};
        // AND: every category must match at least one selected value
        return filterEntries.every(([catName, selectedValues]) => {
          if (selectedValues.size === 0) return true;
          const productTagValue = asinTags[catName] || "";
          // Check if product's tag value matches any of the selected values
          return selectedValues.has(productTagValue);
        });
      });
    }
    // Sort
    if (sortField) {
      products.sort((a: any, b: any) => {
        const va = getCellValue(a, columns.find(c => c.key === sortField)!);
        const vb = getCellValue(b, columns.find(c => c.key === sortField)!);
        const na = Number(va), nb = Number(vb);
        if (!isNaN(na) && !isNaN(nb)) return sortDir === "asc" ? na - nb : nb - na;
        return sortDir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
      });
    }
    return products;
  }, [data?.products, searchTerm, sortField, sortDir, getCellValue, columns, tagFilters, data?.tagMap]);

  const totalPages = Math.ceil(filteredProducts.length / PAGE_SIZE);
  const pagedProducts = filteredProducts.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // ── Group by tag logic ──
  interface GroupSummary {
    tagValue: string;
    products: any[];
    count: number;
    monthlySalesSum: number;
    monthlyRevenueSum: number;
    priceAvg: number;
    ratingAvg: number;
    reviewCountSum: number;
    bsrAvg: number;
  }
  const groupedData = useMemo<GroupSummary[]>(() => {
    if (!groupByTag || !data?.tagMap) return [];
    const groups: Record<string, any[]> = {};
    for (const p of filteredProducts) {
      const asinTags = data.tagMap[p.asin as string] || {};
      const tagVal = asinTags[groupByTag!] || "(未标注)";
      if (!groups[tagVal]) groups[tagVal] = [];
      groups[tagVal].push(p);
    }
    const summaries: GroupSummary[] = Object.entries(groups).map(([tagValue, products]) => {
      const count = products.length;
      const monthlySalesSum = products.reduce((s: number, p: any) => s + (Number(p.monthlySales) || 0), 0);
      const monthlyRevenueSum = products.reduce((s: number, p: any) => s + (Number(p.monthlyRevenue) || 0), 0);
      const pricesValid = products.filter((p: any) => Number(p.price) > 0);
      const priceAvg = pricesValid.length > 0 ? pricesValid.reduce((s: number, p: any) => s + Number(p.price), 0) / pricesValid.length : 0;
      const ratingsValid = products.filter((p: any) => Number(p.rating) > 0);
      const ratingAvg = ratingsValid.length > 0 ? ratingsValid.reduce((s: number, p: any) => s + Number(p.rating), 0) / ratingsValid.length : 0;
      const reviewCountSum = products.reduce((s: number, p: any) => s + (Number(p.reviewCount) || 0), 0);
      const bsrValid = products.filter((p: any) => Number(p.bsr) > 0);
      const bsrAvg = bsrValid.length > 0 ? bsrValid.reduce((s: number, p: any) => s + Number(p.bsr), 0) / bsrValid.length : 0;
      return { tagValue, products, count, monthlySalesSum, monthlyRevenueSum, priceAvg, ratingAvg, reviewCountSum, bsrAvg };
    });
    // Sort groups
    summaries.sort((a, b) => {
      let va: number, vb: number;
      switch (groupSortField) {
        case "sales": va = a.monthlySalesSum; vb = b.monthlySalesSum; break;
        case "revenue": va = a.monthlyRevenueSum; vb = b.monthlyRevenueSum; break;
        case "price": va = a.priceAvg; vb = b.priceAvg; break;
        case "rating": va = a.ratingAvg; vb = b.ratingAvg; break;
        case "reviews": va = a.reviewCountSum; vb = b.reviewCountSum; break;
        case "bsr": va = a.bsrAvg; vb = b.bsrAvg; break;
        default: va = a.count; vb = b.count;
      }
      return groupSortDir === "desc" ? vb - va : va - vb;
    });
    return summaries;
  }, [filteredProducts, groupByTag, data?.tagMap, groupSortField, groupSortDir]);

  const toggleGroupCollapse = (tagValue: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(tagValue)) next.delete(tagValue);
      else next.add(tagValue);
      return next;
    });
  };
  const collapseAllGroups = () => {
    setCollapsedGroups(new Set(groupedData.map(g => g.tagValue)));
  };
  const expandAllGroups = () => {
    setCollapsedGroups(new Set());
  };

  // Chart click handler: expand clicked group, collapse others, highlight and scroll
  const handleChartGroupClick = (tagValue: string) => {
    if (!tagValue) return;
    // Expand only the clicked group, collapse all others
    setCollapsedGroups(new Set(groupedData.filter(g => g.tagValue !== tagValue).map(g => g.tagValue)));
    // Highlight the clicked group
    setHighlightedGroup(tagValue);
    // Auto-clear highlight after 3 seconds
    setTimeout(() => setHighlightedGroup(null), 3000);
    // Scroll to the group row after a short delay for DOM update
    setTimeout(() => {
      const rowEl = groupRowRefs.current[tagValue];
      if (rowEl && tableRef.current) {
        const tableTop = tableRef.current.getBoundingClientRect().top;
        const rowTop = rowEl.getBoundingClientRect().top;
        const offset = rowTop - tableTop - 80; // account for sticky header
        tableRef.current.scrollTo({ top: tableRef.current.scrollTop + offset, behavior: 'smooth' });
      }
    }, 100);
  };

  // Shared cell renderer for both grouped and ungrouped modes
  const renderProductCells = (product: any) => {
    return visibleColumns.map(col => {
      const value = getCellValue(product, col);
      const isEditing = editingCell?.productId === product.id && editingCell?.field === col.key;
      const canEdit = col.editable && !isConfirmed;
      const isTagCol = col.key.startsWith("tag_");
      if (col.render && !isEditing) {
        return (
          <td key={col.key} className="px-2 py-1 border-r border-b"
            style={{ width: col.width, minWidth: col.width }}>
            {col.render(value, product)}
          </td>
        );
      }
      if (col.type === "boolean" && !isEditing) {
        return (
          <td key={col.key} className="px-2 py-1 border-r border-b text-center"
            style={{ width: col.width, minWidth: col.width }}>
            {value ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mx-auto" /> : <span className="text-muted-foreground/40">-</span>}
          </td>
        );
      }
      return (
        <td key={col.key}
          className={`px-2 py-1 border-r border-b truncate ${canEdit ? "cursor-pointer hover:bg-primary/5" : ""}`}
          style={{ width: col.width, minWidth: col.width, maxWidth: col.width }}
          onClick={() => canEdit && startEdit(product.id, col.key, value)}
          title={String(value || "")}>
          {value !== null && value !== undefined && value !== "" ? (
            <span className="truncate block">{String(value)}</span>
          ) : (
            <span className="text-muted-foreground/40">-</span>
          )}
        </td>
      );
    });
  };

  const startEdit = (productId: number, field: string, currentValue: any) => {
    if (isConfirmed) { toast.info("表格已锁定，请先解锁后编辑"); return; }
    setEditingCell({ productId, field });
    setEditValue(String(currentValue ?? ""));
  };

  const saveEdit = (overrideValue?: string) => {
    if (!editingCell) return;
    const col = columns.find(c => c.key === editingCell.field);
    if (!col) return;
    const finalValue = overrideValue !== undefined ? overrideValue : editValue;

    if (col.key.startsWith("tag_")) {
      const tagKey = col.key.replace("tag_", "");
      const tagCategory = data?.tagCategories?.find((tc: any) => tc.key === tagKey);
      if (tagCategory) {
        const product = data?.products?.find((p: any) => p.id === editingCell.productId);
        if (product) {
          updateTagMutation.mutate({
            projectId,
            asin: product.asin || "",
            dimensionName: tagCategory.name,
            dimensionValue: finalValue,
          });
        }
      }
    } else if (col.key.startsWith("history_")) {
      const monthKey = col.key.replace("history_", "");
      const product = data?.products?.find((p: any) => p.id === editingCell.productId);
      if (product) {
        try {
          const history = JSON.parse(product.monthlySalesHistory || "{}");
          history[monthKey] = finalValue ? Number(finalValue) : null;
          updateFieldMutation.mutate({
            productId: editingCell.productId,
            field: "monthlySalesHistory",
            value: JSON.stringify(history),
          });
        } catch {
          toast.error("历史数据格式错误");
        }
      }
    } else {
      const value = col.type === "number" ? (finalValue ? Number(finalValue) : null) : finalValue;
      updateFieldMutation.mutate({
        productId: editingCell.productId,
        field: editingCell.field,
        value,
      });
    }
    setEditingCell(null);
  };

  const cancelEdit = () => setEditingCell(null);

  // ── Tag filter helpers ──
  const activeFilterCount = useMemo(() => {
    let count = 0;
    for (const vals of Object.values(tagFilters)) {
      count += vals.size;
    }
    return count;
  }, [tagFilters]);

  const toggleTagFilter = (categoryName: string, value: string) => {
    setTagFilters(prev => {
      const next = { ...prev };
      const set = new Set(prev[categoryName] || []);
      if (set.has(value)) set.delete(value);
      else set.add(value);
      if (set.size === 0) delete next[categoryName];
      else next[categoryName] = set;
      return next;
    });
    setPage(0);
  };

  const clearAllFilters = () => {
    setTagFilters({});
    setPage(0);
  };

  const clearCategoryFilter = (categoryName: string) => {
    setTagFilters(prev => {
      const next = { ...prev };
      delete next[categoryName];
      return next;
    });
    setPage(0);
  };

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const toggleGroup = (group: string) => {
    setHiddenGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  // Trend chart helpers
  const openTrendForAsin = (asin: string) => {
    setSelectedTrendAsins([asin]);
    setTrendOpen(true);
  };

  const toggleTrendAsin = (asin: string) => {
    setSelectedTrendAsins(prev => {
      if (prev.includes(asin)) return prev.filter(a => a !== asin);
      if (prev.length >= 15) { toast.info("最多选择15个ASIN进行对比"); return prev; }
      return [...prev, asin];
    });
  };

  const allAsins = useMemo(() =>
    (data?.products || []).map((p: any) => p.asin).filter(Boolean),
    [data?.products]
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-[500px] w-full" />
      </div>
    );
  }

  const totalProducts = data?.products?.length || 0;
  const hasData = totalProducts > 0;

  // Get tag category name from column key
  const getTagCategoryName = (colKey: string) => {
    const tagKey = colKey.replace("tag_", "");
    const tc = data?.tagCategories?.find((t: any) => t.key === tagKey);
    return tc?.name || "";
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Table2 className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">竞品全景分析表</CardTitle>
              <Badge variant="outline" className="text-xs">{totalProducts} 个产品</Badge>
              {isConfirmed ? (
                <Badge className="bg-emerald-500/10 text-emerald-600 text-xs gap-1">
                  <Lock className="h-3 w-3" />已确认
                </Badge>
              ) : (
                <Badge className="bg-amber-500/10 text-amber-600 text-xs gap-1">
                  <AlertCircle className="h-3 w-3" />待确认
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {hasData && (
                <Button size="sm" variant="outline" className="gap-1.5 text-xs"
                  onClick={() => { setSelectedTrendAsins(allAsins.slice(0, 5)); setTrendOpen(true); }}>
                  <TrendingUp className="h-3.5 w-3.5" />销量趋势
                </Button>
              )}
              {isConfirmed ? (
                <Button size="sm" variant="outline" className="gap-1.5 text-xs"
                  onClick={() => unlockMutation.mutate({ projectId })}
                  disabled={unlockMutation.isPending}>
                  <Unlock className="h-3.5 w-3.5" />解锁编辑
                </Button>
              ) : (
                <Button size="sm" className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => confirmMutation.mutate({ projectId })}
                  disabled={confirmMutation.isPending || !hasData}>
                  <CheckCircle2 className="h-3.5 w-3.5" />确认锁定
                </Button>
              )}
              <Button size="sm" variant="outline" className="gap-1.5 text-xs"
                onClick={() => exportMutation.mutate({ projectId })}
                disabled={exportMutation.isPending || !hasData}>
                <Download className="h-3.5 w-3.5" />下载CSV
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            三表合并（搜索结果/销量数据 + 标题五点 + 历史月销量）以ASIN为主键，末尾追加属性标签列。确认后方可进行市场大盘、属性交叉、价格段、品牌竞争分析。
          </p>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          {/* Search + Column Toggle + Tag Filter Toggle */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="搜索 ASIN / 标题 / 品牌..." value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setPage(0); }}
                className="pl-8 h-8 text-xs" />
            </div>
            {/* Tag filter toggle button */}
            {Object.keys(tagValueOptions).length > 0 && (
              <Button size="sm" variant={filterOpen ? "default" : "outline"}
                className={`h-8 text-xs gap-1.5 ${activeFilterCount > 0 ? "border-primary" : ""}`}
                onClick={() => setFilterOpen(o => !o)}>
                <Filter className="h-3.5 w-3.5" />
                标签筛选
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="h-4 px-1 text-[10px] ml-0.5 bg-primary text-primary-foreground">
                    {activeFilterCount}
                  </Badge>
                )}
                {filterOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </Button>
            )}
            {activeFilterCount > 0 && (
              <Button size="sm" variant="ghost" className="h-8 text-xs gap-1 text-muted-foreground hover:text-destructive"
                onClick={clearAllFilters}>
                <XCircle className="h-3.5 w-3.5" />清除全部筛选
              </Button>
            )}
            {/* Group by tag selector */}
            {Object.keys(tagValueOptions).length > 0 && (
              <div className="flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                <Select
                  value={groupByTag || "__none__"}
                  onValueChange={(v) => {
                    setGroupByTag(v === "__none__" ? null : v);
                    setCollapsedGroups(new Set());
                    setPage(0);
                  }}
                >
                  <SelectTrigger className="h-8 w-[140px] text-xs">
                    <SelectValue placeholder="按标签分组" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">不分组</SelectItem>
                    {(data?.tagCategories || []).map((tc: { key: string; name: string }) => (
                      <SelectItem key={tc.key} value={tc.name}>{tc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {groupByTag && (
                  <>
                    <Select value={groupSortField} onValueChange={setGroupSortField}>
                      <SelectTrigger className="h-8 w-[110px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="count">按数量</SelectItem>
                        <SelectItem value="sales">按销量</SelectItem>
                        <SelectItem value="revenue">按销售额</SelectItem>
                        <SelectItem value="price">按均价</SelectItem>
                        <SelectItem value="rating">按评分</SelectItem>
                        <SelectItem value="reviews">按评论数</SelectItem>
                        <SelectItem value="bsr">按BSR</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0"
                      onClick={() => setGroupSortDir(d => d === "desc" ? "asc" : "desc")}>
                      <ArrowUpDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 text-xs px-2"
                      onClick={expandAllGroups}>
                      <FolderOpen className="h-3 w-3 mr-1" />展开
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 text-xs px-2"
                      onClick={collapseAllGroups}>
                      <FolderClosed className="h-3 w-3 mr-1" />折叠
                    </Button>
                  </>
                )}
              </div>
            )}
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-xs text-muted-foreground mr-1">列组:</span>
              {columnGroups.map(g => (
                <Button key={g} size="sm" variant={hiddenGroups.has(g) ? "ghost" : "outline"}
                  className={`h-6 text-[10px] px-2 ${hiddenGroups.has(g) ? "opacity-50" : ""}`}
                  onClick={() => toggleGroup(g)}>
                  {hiddenGroups.has(g) ? <EyeOff className="h-2.5 w-2.5 mr-0.5" /> : <Eye className="h-2.5 w-2.5 mr-0.5" />}
                  {g}
                </Button>
              ))}
            </div>
          </div>

          {/* Tag Filter Panel */}
          {filterOpen && Object.keys(tagValueOptions).length > 0 && (
            <div className="border rounded-lg bg-muted/20 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Tag className="h-4 w-4 text-primary" />
                  <span className="text-xs font-semibold">按属性标签筛选产品</span>
                  <span className="text-[10px] text-muted-foreground">(类别间 AND 逻辑，类别内 OR 逻辑)</span>
                </div>
                {activeFilterCount > 0 && (
                  <span className="text-[10px] text-primary font-medium">
                    匹配 {filteredProducts.length} / {totalProducts} 个产品
                  </span>
                )}
              </div>
              <div className="grid gap-2">
                {Object.entries(tagValueOptions).map(([catName, values]) => {
                  const selectedInCat = tagFilters[catName] || new Set<string>();
                  const hasFilter = selectedInCat.size > 0;
                  return (
                    <div key={catName} className={`flex items-start gap-2 p-2 rounded-md transition-colors ${
                      hasFilter ? "bg-primary/5 border border-primary/20" : "bg-background/50"
                    }`}>
                      <div className="flex items-center gap-1.5 min-w-[100px] pt-0.5 flex-shrink-0">
                        <span className={`text-xs font-medium ${hasFilter ? "text-primary" : "text-muted-foreground"}`}>
                          {catName}
                        </span>
                        {hasFilter && (
                          <button onClick={() => clearCategoryFilter(catName)}
                            className="text-muted-foreground hover:text-destructive transition-colors">
                            <XCircle className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {values.map(val => {
                          const isSelected = selectedInCat.has(val);
                          const count = tagValueCounts[catName]?.[val] || 0;
                          return (
                            <button
                              key={val}
                              onClick={() => toggleTagFilter(catName, val)}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border transition-all ${
                                isSelected
                                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                                  : "bg-background text-foreground border-border hover:border-primary/50 hover:bg-primary/5"
                              }`}
                            >
                              {val}
                              <span className={`text-[9px] font-medium ${
                                isSelected ? "text-primary-foreground/80" : "text-muted-foreground"
                              }`}>({count})</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Active filter summary bar */}
          {activeFilterCount > 0 && !filterOpen && (
            <div className="flex items-center gap-2 flex-wrap px-2 py-1.5 bg-primary/5 rounded-md border border-primary/10">
              <Filter className="h-3 w-3 text-primary flex-shrink-0" />
              <span className="text-[10px] text-primary font-medium">当前筛选:</span>
              {Object.entries(tagFilters).map(([catName, values]) =>
                Array.from(values).map(val => (
                  <Badge key={`${catName}-${val}`} variant="secondary"
                    className="text-[10px] gap-0.5 h-5 cursor-pointer hover:bg-destructive/10"
                    onClick={() => toggleTagFilter(catName, val)}>
                    {catName}: {val}
                    <X className="h-2.5 w-2.5" />
                  </Badge>
                ))
              )}
              <span className="text-[10px] text-muted-foreground">
                → {filteredProducts.length} / {totalProducts} 个产品
              </span>
            </div>
          )}

          {!hasData ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <p className="text-sm font-medium text-muted-foreground">暂无产品数据</p>
              <p className="text-xs text-muted-foreground mt-1">请先在「数据管理」中上传搜索结果/销量数据、标题五点数据和历史月销量数据</p>
            </div>
          ) : (
            <>
              {/* Group Charts - only show in grouped mode */}
              {groupByTag && groupedData.length > 0 && (
                <div className="space-y-3 mb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">分组可视化分析</span>
                      <Badge variant="secondary" className="text-[10px]">按「{groupByTag}」分组</Badge>
                    </div>
                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1"
                      onClick={() => setShowGroupCharts(!showGroupCharts)}>
                      {showGroupCharts ? <><EyeOff className="h-3 w-3" />收起图表</> : <><Eye className="h-3 w-3" />展开图表</>}
                    </Button>
                  </div>
                  {showGroupCharts && (
                    <>
                    <p className="text-[10px] text-muted-foreground mb-2 flex items-center gap-1">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                      点击图表中的柱状/扇形区域可展开对应分组并高亮显示
                    </p>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                      {/* Bar Chart - Sales Comparison */}
                      <Card className="border-blue-100">
                        <CardHeader className="pb-2 pt-3 px-4">
                          <CardTitle className="text-xs font-medium text-blue-700">各分组销量对比</CardTitle>
                        </CardHeader>
                        <CardContent className="px-2 pb-3">
                          <ResponsiveContainer width="100%" height={200}>
                            <BarChart data={groupedData.map(g => ({ name: g.tagValue.length > 6 ? g.tagValue.slice(0, 6) + '...' : g.tagValue, fullName: g.tagValue, 月销量: g.monthlySalesSum, 产品数: g.count }))} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                              <YAxis tick={{ fontSize: 10 }} />
                              <Tooltip
                                contentStyle={{ fontSize: 11, borderRadius: 8 }}
                                formatter={(value: number, name: string) => [value.toLocaleString(), name]}
                                labelFormatter={(label: string, payload: any[]) => payload?.[0]?.payload?.fullName || label}
                              />
                              <Bar dataKey="月销量" fill="#3b82f6" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(data: any) => handleChartGroupClick(data?.fullName || data?.name)} />
                            </BarChart>
                          </ResponsiveContainer>
                        </CardContent>
                      </Card>

                      {/* Pie Chart - Sales Share */}
                      <Card className="border-green-100">
                        <CardHeader className="pb-2 pt-3 px-4">
                          <CardTitle className="text-xs font-medium text-green-700">销量占比分布</CardTitle>
                        </CardHeader>
                        <CardContent className="px-2 pb-3">
                          <ResponsiveContainer width="100%" height={200}>
                            <PieChart>
                              <Pie
                                data={groupedData.map((g, i) => ({ name: g.tagValue, value: g.monthlySalesSum, count: g.count }))}
                                cx="50%" cy="50%" innerRadius={40} outerRadius={75}
                                paddingAngle={2} dataKey="value"
                                label={({ name, percent }) => `${name.length > 4 ? name.slice(0, 4) + '..' : name} ${(percent * 100).toFixed(0)}%`}
                                labelLine={{ strokeWidth: 1 }}
                                cursor="pointer"
                                onClick={(data: any) => handleChartGroupClick(data?.name)}
                              >
                                {groupedData.map((_, i) => (
                                  <Cell key={i} fill={['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1'][i % 10]} />
                                ))}
                              </Pie>
                              <Tooltip
                                contentStyle={{ fontSize: 11, borderRadius: 8 }}
                                formatter={(value: number, name: string, props: any) => [`销量: ${value.toLocaleString()} (产品数: ${props.payload.count})`, name]}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        </CardContent>
                      </Card>

                      {/* Bar Chart - Price Distribution */}
                      <Card className="border-amber-100">
                        <CardHeader className="pb-2 pt-3 px-4">
                          <CardTitle className="text-xs font-medium text-amber-700">价格分布对比</CardTitle>
                        </CardHeader>
                        <CardContent className="px-2 pb-3">
                          <ResponsiveContainer width="100%" height={200}>
                            <BarChart data={groupedData.map(g => ({ name: g.tagValue.length > 6 ? g.tagValue.slice(0, 6) + '...' : g.tagValue, fullName: g.tagValue, 均价: Number(g.priceAvg.toFixed(1)), 平均评分: Number(g.ratingAvg.toFixed(2)) }))} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                              <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} domain={[0, 5]} />
                              <Tooltip
                                contentStyle={{ fontSize: 11, borderRadius: 8 }}
                                labelFormatter={(label: string, payload: any[]) => payload?.[0]?.payload?.fullName || label}
                              />
                              <Legend wrapperStyle={{ fontSize: 10 }} />
                              <Bar yAxisId="left" dataKey="均价" fill="#f59e0b" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(data: any) => handleChartGroupClick(data?.fullName || data?.name)} />
                              <Bar yAxisId="right" dataKey="平均评分" fill="#10b981" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(data: any) => handleChartGroupClick(data?.fullName || data?.name)} />
                            </BarChart>
                          </ResponsiveContainer>
                        </CardContent>
                      </Card>
                    </div>
                    </>
                  )}
                </div>
              )}

              {/* Table */}
              <div ref={tableRef} className="border rounded-lg overflow-auto max-h-[calc(100vh-320px)]"
                style={{ position: "relative" }}>
                <table className="text-xs border-collapse" style={{ minWidth: visibleColumns.reduce((s, c) => s + c.width, 0) }}>
                  {/* Group Header */}
                  <thead className="sticky top-0 z-20 bg-muted/95 backdrop-blur">
                    <tr>
                      {(() => {
                        const groups: { name: string; span: number }[] = [];
                        for (const col of visibleColumns) {
                          if (groups.length > 0 && groups[groups.length - 1].name === col.group) {
                            groups[groups.length - 1].span++;
                          } else {
                            groups.push({ name: col.group, span: 1 });
                          }
                        }
                        return groups.map((g, i) => (
                          <th key={i} colSpan={g.span}
                            className="px-2 py-1 text-[10px] font-semibold text-muted-foreground border-b border-r bg-muted/80 text-center">
                            {g.name}
                          </th>
                        ));
                      })()}
                    </tr>
                    <tr>
                      {visibleColumns.map(col => (
                        <th key={col.key}
                          className="px-2 py-1.5 text-left font-medium border-b border-r whitespace-nowrap cursor-pointer hover:bg-accent/50 select-none"
                          style={{ width: col.width, minWidth: col.width }}
                          onClick={() => toggleSort(col.key)}>
                          <div className="flex items-center gap-0.5">
                            <span className="truncate">{col.label}</span>
                            {sortField === col.key && (
                              <ArrowUpDown className="h-2.5 w-2.5 flex-shrink-0 text-primary" />
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Grouped mode */}
                    {groupByTag && groupedData.length > 0 && groupedData.map((group, gIdx) => {
                      const isCollapsed = collapsedGroups.has(group.tagValue);
                      return (
                        <>
                          {/* Group summary row */}
                          <tr key={`group-${gIdx}`}
                            ref={(el) => { groupRowRefs.current[group.tagValue] = el; }}
                            className={`cursor-pointer border-b-2 transition-all duration-500 ${
                              highlightedGroup === group.tagValue
                                ? 'bg-primary/20 border-primary/40 ring-2 ring-primary/30 ring-inset'
                                : 'bg-primary/5 hover:bg-primary/10 border-primary/20'
                            }`}
                            onClick={() => toggleGroupCollapse(group.tagValue)}>
                            <td colSpan={visibleColumns.length}
                              className="px-3 py-2">
                              <div className="flex items-center gap-3 flex-wrap">
                                <div className="flex items-center gap-1.5">
                                  {isCollapsed ? <FolderClosed className="h-4 w-4 text-primary" /> : <FolderOpen className="h-4 w-4 text-primary" />}
                                  <Badge className="bg-primary/10 text-primary border-primary/20 text-xs font-semibold">
                                    {group.tagValue}
                                  </Badge>
                                </div>
                                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                  <span className="font-medium text-foreground">
                                    <Tag className="h-3 w-3 inline mr-0.5" />{group.count} 个产品
                                  </span>
                                  <span>月销量合计: <strong className="text-foreground">{group.monthlySalesSum.toLocaleString()}</strong></span>
                                  <span>月销售额: <strong className="text-foreground">${group.monthlyRevenueSum.toLocaleString()}</strong></span>
                                  <span>均价: <strong className="text-foreground">${group.priceAvg.toFixed(2)}</strong></span>
                                  <span>平均评分: <strong className="text-foreground">{group.ratingAvg.toFixed(1)}</strong></span>
                                  <span>评论合计: <strong className="text-foreground">{group.reviewCountSum.toLocaleString()}</strong></span>
                                  {group.bsrAvg > 0 && <span>平均BSR: <strong className="text-foreground">{Math.round(group.bsrAvg).toLocaleString()}</strong></span>}
                                </div>
                              </div>
                            </td>
                          </tr>
                          {/* Group products */}
                          {!isCollapsed && group.products.map((product: any, rowIdx: number) => (
                            <tr key={product.id} className={`${
                              highlightedGroup === group.tagValue
                                ? 'bg-primary/5 hover:bg-primary/10'
                                : rowIdx % 2 === 0 ? 'bg-background' : 'bg-muted/20'
                            } hover:bg-accent/30 transition-colors`}>
                              {renderProductCells(product)}
                            </tr>
                          ))}
                        </>
                      );
                    })}
                    {/* Ungrouped mode (original) */}
                    {!groupByTag && pagedProducts.map((product: any, rowIdx: number) => (
                      <tr key={product.id} className={`${rowIdx % 2 === 0 ? "bg-background" : "bg-muted/20"} hover:bg-accent/30 transition-colors`}>
                        {visibleColumns.map(col => {
                          const value = getCellValue(product, col);
                          const isEditing = editingCell?.productId === product.id && editingCell?.field === col.key;
                          const canEdit = col.editable && !isConfirmed;
                          const isTagCol = col.key.startsWith("tag_");

                          // Custom render (e.g. image)
                          if (col.render && !isEditing) {
                            return (
                              <td key={col.key} className="px-2 py-1 border-r border-b"
                                style={{ width: col.width, minWidth: col.width }}>
                                {col.render(value, product)}
                              </td>
                            );
                          }

                          // Boolean display
                          if (col.type === "boolean" && !isEditing) {
                            return (
                              <td key={col.key} className="px-2 py-1 border-r border-b text-center"
                                style={{ width: col.width, minWidth: col.width }}>
                                {value ? (
                                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 inline" />
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </td>
                            );
                          }

                          // ASIN column: add trend icon
                          if (col.key === "asin" && !isEditing) {
                            return (
                              <td key={col.key} className="px-2 py-1 border-r border-b"
                                style={{ width: col.width, minWidth: col.width }}>
                                <div className="flex items-center gap-1">
                                  <span className="truncate">{String(value || "")}</span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); openTrendForAsin(String(value)); }}
                                    className="text-muted-foreground hover:text-primary transition-colors flex-shrink-0"
                                    title="查看销量趋势"
                                  >
                                    <TrendingUp className="h-3 w-3" />
                                  </button>
                                </div>
                              </td>
                            );
                          }

                          // Tag column editing: dropdown + free input
                          if (isEditing && isTagCol) {
                            const catName = getTagCategoryName(col.key);
                            const options = tagValueOptions[catName] || [];
                            return (
                              <td key={col.key} className="px-1 py-0.5 border-r border-b"
                                style={{ width: col.width, minWidth: col.width, overflow: "visible" }}>
                                <TagDropdownEditor
                                  value={editValue}
                                  options={options}
                                  onSave={(v) => saveEdit(v)}
                                  onCancel={cancelEdit}
                                />
                              </td>
                            );
                          }

                          // Regular editing
                          if (isEditing) {
                            return (
                              <td key={col.key} className="px-1 py-0.5 border-r border-b"
                                style={{ width: col.width, minWidth: col.width }}>
                                <div className="flex items-center gap-0.5">
                                  <Input value={editValue} onChange={e => setEditValue(e.target.value)}
                                    className="h-6 text-xs px-1" autoFocus
                                    onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }} />
                                  <button onClick={() => saveEdit()} className="text-emerald-600 hover:text-emerald-700 p-0.5">
                                    <Save className="h-3 w-3" />
                                  </button>
                                  <button onClick={cancelEdit} className="text-muted-foreground hover:text-foreground p-0.5">
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                              </td>
                            );
                          }

                          // Tag column display: show as badge
                          if (isTagCol && value) {
                            return (
                              <td key={col.key}
                                className={`px-2 py-1 border-r border-b ${canEdit ? "cursor-pointer hover:bg-primary/5" : ""}`}
                                style={{ width: col.width, minWidth: col.width, maxWidth: col.width }}
                                onClick={() => canEdit && startEdit(product.id, col.key, value)}>
                                <Badge variant="secondary" className="text-[10px] font-normal truncate max-w-full">
                                  {String(value)}
                                </Badge>
                              </td>
                            );
                          }

                          // Default cell
                          return (
                            <td key={col.key}
                              className={`px-2 py-1 border-r border-b truncate ${canEdit ? "cursor-pointer hover:bg-primary/5" : ""}`}
                              style={{ width: col.width, minWidth: col.width, maxWidth: col.width }}
                              onClick={() => canEdit && startEdit(product.id, col.key, value)}
                              title={String(value || "")}>
                              {value !== null && value !== undefined && value !== "" ? (
                                <span className="truncate block">{String(value)}</span>
                              ) : (
                                <span className="text-muted-foreground/40">-</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {groupByTag ? (
                    <>共 {filteredProducts.length} 个产品，分为 {groupedData.length} 个分组{(searchTerm || activeFilterCount > 0) && ` (筛选自 ${totalProducts} 个)`}</>
                  ) : (
                    <>显示 {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, filteredProducts.length)} / 共 {filteredProducts.length} 个产品
                    {(searchTerm || activeFilterCount > 0) && ` (筛选自 ${totalProducts} 个)`}</>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  {!groupByTag && <><Button size="sm" variant="outline" className="h-6 text-xs px-2"
                    disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                    <ChevronLeft className="h-3 w-3" />上一页
                  </Button>
                  <span>{page + 1} / {totalPages || 1}</span>
                  <Button size="sm" variant="outline" className="h-6 text-xs px-2"
                    disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                    下一页<ChevronRight className="h-3 w-3" />
                  </Button>
                  </>}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Gate Info */}
      {!isConfirmed && hasData && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="py-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="text-xs">
                <p className="font-medium text-amber-800">全景分析表尚未确认</p>
                <p className="text-amber-700 mt-0.5">
                  请检查并编辑数据后点击「确认锁定」。确认后方可进入市场大盘分析、属性交叉分析、价格段分析和品牌竞争分析。
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sales Trend Dialog */}
      <SalesTrendDialog
        open={trendOpen}
        onClose={() => setTrendOpen(false)}
        selectedAsins={selectedTrendAsins}
        products={data?.products || []}
        historyCols={data?.historyCols || []}
        onToggleAsin={toggleTrendAsin}
        allAsins={allAsins}
      />
    </div>
  );
}
