import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2, AlertCircle, Download, Lock, Unlock, Edit2, Save, X,
  FileText, Search, ChevronLeft, ChevronRight, ArrowUpDown,
  Table2, Filter, Eye, EyeOff,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

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
  // 基础信息
  { key: "searchRank", label: "#", group: "基础信息", width: 50, type: "number" },
  { key: "asin", label: "ASIN", group: "基础信息", width: 120 },
  { key: "parentAsin", label: "父ASIN", group: "基础信息", width: 120, editable: true },
  { key: "sku", label: "SKU", group: "基础信息", width: 100, editable: true },
  { key: "brand", label: "品牌", group: "基础信息", width: 100, editable: true },
  { key: "imageUrl", label: "主图", group: "基础信息", width: 60, render: (v: string) => v ? <img src={v} className="w-8 h-8 object-cover rounded" alt="" /> : <span className="text-muted-foreground text-xs">-</span> },
  { key: "title", label: "商品标题", group: "基础信息", width: 250, editable: true },
  // 类目信息
  { key: "category", label: "大类目", group: "类目", width: 120, editable: true },
  { key: "subcategory", label: "小类目", group: "类目", width: 120, editable: true },
  { key: "categoryPath", label: "类目路径", group: "类目", width: 200, editable: true },
  { key: "bsrLarge", label: "大类BSR", group: "排名", width: 90, type: "number", editable: true },
  { key: "bsrSmall", label: "小类BSR", group: "排名", width: 90, type: "number", editable: true },
  { key: "bsr", label: "BSR", group: "排名", width: 80, type: "number", editable: true },
  { key: "bsrGrowthRate", label: "BSR增长率", group: "排名", width: 100, editable: true },
  // 价格与利润
  { key: "price", label: "价格($)", group: "价格利润", width: 80, editable: true },
  { key: "fbaFee", label: "FBA费用", group: "价格利润", width: 80, editable: true },
  { key: "grossMargin", label: "毛利率", group: "价格利润", width: 80, editable: true },
  // 销量
  { key: "monthlySales", label: "月销量", group: "销量", width: 80, type: "number", editable: true },
  { key: "monthlySalesGrowth", label: "月销量增长率", group: "销量", width: 110, editable: true },
  { key: "monthlyRevenue", label: "月销售额($)", group: "销量", width: 100, type: "number", editable: true },
  { key: "childSales", label: "子体销量", group: "销量", width: 80, type: "number", editable: true },
  { key: "childRevenue", label: "子体销售额", group: "销量", width: 100, type: "number", editable: true },
  { key: "variantCount", label: "变体数", group: "销量", width: 70, type: "number", editable: true },
  // 评论
  { key: "reviewCount", label: "评分数", group: "评论", width: 80, editable: true },
  { key: "monthlyNewReviews", label: "月新增评分", group: "评论", width: 100, type: "number", editable: true },
  { key: "rating", label: "评分", group: "评论", width: 60, editable: true },
  { key: "reviewRate", label: "留评率", group: "评论", width: 80, editable: true },
  // Listing质量
  { key: "lqs", label: "LQS", group: "Listing", width: 60, type: "number", editable: true },
  { key: "hasAPlus", label: "A+", group: "Listing", width: 50, type: "boolean" },
  { key: "hasVideo", label: "视频", group: "Listing", width: 50, type: "boolean" },
  { key: "hasBrandStory", label: "品牌故事", group: "Listing", width: 70, type: "boolean" },
  { key: "hasAmazonChoice", label: "AC", group: "Listing", width: 50, type: "boolean" },
  // 卖家信息
  { key: "sellerCount", label: "卖家数", group: "卖家", width: 70, type: "number", editable: true },
  { key: "fulfillment", label: "配送方式", group: "卖家", width: 80, editable: true },
  { key: "buyboxSeller", label: "Buybox卖家", group: "卖家", width: 120, editable: true },
  { key: "buyboxType", label: "BuyBox类型", group: "卖家", width: 90, editable: true },
  { key: "sellerLocation", label: "卖家所属地", group: "卖家", width: 100, editable: true },
  // 时间
  { key: "listingDate", label: "上架时间", group: "时间", width: 100, editable: true },
  { key: "listingDays", label: "上架天数", group: "时间", width: 80, type: "number", editable: true },
  // 物流
  { key: "productWeight", label: "商品重量", group: "物流", width: 90, editable: true },
  { key: "productSize", label: "商品尺寸", group: "物流", width: 120, editable: true },
  { key: "packageWeight", label: "包装重量", group: "物流", width: 90, editable: true },
  { key: "packageSize", label: "包装尺寸", group: "物流", width: 120, editable: true },
  { key: "packageSizeTier", label: "尺寸分段", group: "物流", width: 90, editable: true },
  // 五点描述
  { key: "bulletPoints", label: "产品卖点(五点)", group: "内容", width: 300, editable: true },
];

const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 72;
const PAGE_SIZE = 50;

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
  const tableRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.devPanorama.getData.useQuery({ projectId });
  const { data: statusData } = trpc.devPanorama.getStatus.useQuery({ projectId });
  const updateFieldMutation = trpc.devPanorama.updateProductField.useMutation({
    onSuccess: () => { utils.devPanorama.getData.invalidate({ projectId }); toast.success("已更新"); },
    onError: (e) => toast.error("更新失败: " + e.message),
  });
  const updateTagMutation = trpc.devPanorama.updateProductTag.useMutation({
    onSuccess: () => { utils.devPanorama.getData.invalidate({ projectId }); toast.success("标签已更新"); },
    onError: (e) => toast.error("标签更新失败: " + e.message),
  });
  const confirmMutation = trpc.devPanorama.confirm.useMutation({
    onSuccess: () => {
      utils.devPanorama.getStatus.invalidate({ projectId });
      utils.devPanorama.getData.invalidate({ projectId });
      toast.success("全景分析表已确认锁定");
    },
    onError: (e) => toast.error("确认失败: " + e.message),
  });
  const unlockMutation = trpc.devPanorama.unlock.useMutation({
    onSuccess: () => {
      utils.devPanorama.getStatus.invalidate({ projectId });
      utils.devPanorama.getData.invalidate({ projectId });
      toast.success("全景分析表已解锁");
    },
    onError: (e) => toast.error("解锁失败: " + e.message),
  });
  const exportMutation = trpc.devPanorama.exportCsv.useMutation({
    onSuccess: (result) => {
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("导出成功");
    },
    onError: (e) => toast.error("导出失败: " + e.message),
  });

  const isConfirmed = statusData?.confirmed ?? false;

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

  // Visible columns (filter by hidden groups)
  const visibleColumns = useMemo(() =>
    columns.filter(c => !hiddenGroups.has(c.group)),
    [columns, hiddenGroups]
  );

  // Column groups for toggle
  const columnGroups = useMemo(() => {
    const groups: string[] = [];
    for (const c of columns) {
      if (!groups.includes(c.group)) groups.push(c.group);
    }
    return groups;
  }, [columns]);

  // Get cell value
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

  // Filter products
  const filteredProducts = useMemo(() => {
    if (!data?.products) return [];
    let products = [...data.products];
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      products = products.filter((p: any) =>
        (p.asin || "").toLowerCase().includes(term) ||
        (p.title || "").toLowerCase().includes(term) ||
        (p.brand || "").toLowerCase().includes(term)
      );
    }
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
  }, [data?.products, searchTerm, sortField, sortDir, getCellValue, columns]);

  const totalPages = Math.ceil(filteredProducts.length / PAGE_SIZE);
  const pagedProducts = filteredProducts.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Handle cell edit
  const startEdit = (productId: number, field: string, currentValue: any) => {
    if (isConfirmed) { toast.info("表格已锁定，请先解锁后编辑"); return; }
    setEditingCell({ productId, field });
    setEditValue(String(currentValue ?? ""));
  };

  const saveEdit = () => {
    if (!editingCell) return;
    const col = columns.find(c => c.key === editingCell.field);
    if (!col) return;

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
            dimensionValue: editValue,
          });
        }
      }
    } else if (col.key.startsWith("history_")) {
      // Update history field
      const monthKey = col.key.replace("history_", "");
      const product = data?.products?.find((p: any) => p.id === editingCell.productId);
      if (product) {
        try {
          const history = JSON.parse(product.monthlySalesHistory || "{}");
          history[monthKey] = editValue ? Number(editValue) : null;
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
      const value = col.type === "number" ? (editValue ? Number(editValue) : null) : editValue;
      updateFieldMutation.mutate({
        productId: editingCell.productId,
        field: editingCell.field,
        value,
      });
    }
    setEditingCell(null);
  };

  const cancelEdit = () => setEditingCell(null);

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
          {/* Search + Column Toggle */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="搜索 ASIN / 标题 / 品牌..." value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setPage(0); }}
                className="pl-8 h-8 text-xs" />
            </div>
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

          {!hasData ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <p className="text-sm font-medium text-muted-foreground">暂无产品数据</p>
              <p className="text-xs text-muted-foreground mt-1">请先在「数据管理」中上传搜索结果/销量数据、标题五点数据和历史月销量数据</p>
            </div>
          ) : (
            <>
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
                    {pagedProducts.map((product: any, rowIdx: number) => (
                      <tr key={product.id} className={`${rowIdx % 2 === 0 ? "bg-background" : "bg-muted/20"} hover:bg-accent/30 transition-colors`}>
                        {visibleColumns.map(col => {
                          const value = getCellValue(product, col);
                          const isEditing = editingCell?.productId === product.id && editingCell?.field === col.key;
                          const canEdit = col.editable && !isConfirmed;

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
                                {value ? (
                                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 inline" />
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </td>
                            );
                          }

                          if (isEditing) {
                            return (
                              <td key={col.key} className="px-1 py-0.5 border-r border-b"
                                style={{ width: col.width, minWidth: col.width }}>
                                <div className="flex items-center gap-0.5">
                                  <Input value={editValue} onChange={e => setEditValue(e.target.value)}
                                    className="h-6 text-xs px-1" autoFocus
                                    onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }} />
                                  <button onClick={saveEdit} className="text-emerald-600 hover:text-emerald-700 p-0.5">
                                    <Save className="h-3 w-3" />
                                  </button>
                                  <button onClick={cancelEdit} className="text-muted-foreground hover:text-foreground p-0.5">
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
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
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  显示 {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, filteredProducts.length)} / 共 {filteredProducts.length} 个产品
                  {searchTerm && ` (筛选自 ${totalProducts} 个)`}
                </span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" className="h-6 text-xs px-2"
                    disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                    <ChevronLeft className="h-3 w-3" />上一页
                  </Button>
                  <span>{page + 1} / {totalPages || 1}</span>
                  <Button size="sm" variant="outline" className="h-6 text-xs px-2"
                    disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                    下一页<ChevronRight className="h-3 w-3" />
                  </Button>
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
    </div>
  );
}
