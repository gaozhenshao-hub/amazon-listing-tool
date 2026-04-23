/**
 * ASIN-广告组合映射管理页面
 * Allows users to map ad portfolios to parent ASINs
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Link2, Plus, Trash2, Edit2, Search, Package, AlertCircle,
  Loader2, Info, FileSpreadsheet,
} from "lucide-react";
import {
  Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from "@/components/ui/tooltip";

export default function OpsAdMapping() {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [form, setForm] = useState({
    productId: 0,
    parentAsin: "",
    portfolioName: "",
    storeName: "",
    notes: "",
  });

  // ─── Queries ───
  const { data: mappings, isLoading, refetch } = trpc.adTracking.listMappings.useQuery();
  const { data: products } = trpc.adTracking.listProductsForMapping.useQuery();
  const { data: imports } = trpc.adTracking.listAdImports.useQuery();

  // ─── Mutations ───
  const createMapping = trpc.adTracking.createMapping.useMutation({
    onSuccess: () => {
      toast.success("映射创建成功");
      refetch();
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMapping = trpc.adTracking.updateMapping.useMutation({
    onSuccess: () => {
      toast.success("映射更新成功");
      refetch();
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMapping = trpc.adTracking.deleteMapping.useMutation({
    onSuccess: () => {
      toast.success("映射已删除");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const resetForm = () => {
    setShowAdd(false);
    setEditingId(null);
    setForm({ productId: 0, parentAsin: "", portfolioName: "", storeName: "", notes: "" });
  };

  const handleSubmit = () => {
    if (!form.portfolioName.trim()) {
      toast.error("请输入广告组合名称");
      return;
    }
    if (!form.parentAsin.trim()) {
      toast.error("请选择或输入父ASIN");
      return;
    }

    if (editingId) {
      updateMapping.mutate({ id: editingId, ...form });
    } else {
      createMapping.mutate(form);
    }
  };

  const handleEdit = (mapping: any) => {
    setEditingId(mapping.id);
    setForm({
      productId: mapping.productId || 0,
      parentAsin: mapping.parentAsin,
      portfolioName: mapping.portfolioName,
      storeName: mapping.storeName || "",
      notes: mapping.notes || "",
    });
    setShowAdd(true);
  };

  const handleProductSelect = (productId: string) => {
    const pid = Number(productId);
    const product = products?.find((p: any) => p.id === pid);
    setForm(prev => ({
      ...prev,
      productId: pid,
      parentAsin: product?.parentAsin || prev.parentAsin,
      storeName: product?.storeName || prev.storeName,
    }));
  };

  // ─── Filter mappings ───
  const filteredMappings = useMemo(() => {
    if (!mappings) return [];
    if (!searchTerm) return mappings;
    const lower = searchTerm.toLowerCase();
    return mappings.filter((m: any) =>
      m.parentAsin.toLowerCase().includes(lower) ||
      m.portfolioName.toLowerCase().includes(lower) ||
      (m.storeName || "").toLowerCase().includes(lower)
    );
  }, [mappings, searchTerm]);

  // ─── Group by parent ASIN ───
  const groupedMappings = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const m of filteredMappings) {
      const key = m.parentAsin;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredMappings]);

  // ─── Get unique portfolios from imports for suggestions ───
  const importedPortfolios = useMemo(() => {
    if (!imports) return [];
    const all = new Set<string>();
    for (const imp of imports) {
      try {
        const unmapped = JSON.parse(imp.unmappedPortfolios || "[]");
        unmapped.forEach((p: string) => all.add(p));
      } catch {}
    }
    return [...all].sort();
  }, [imports]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Link2 className="h-5 w-5 text-purple-600" />
              ASIN-广告组合映射
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              将广告组合（Portfolio）绑定到对应的父ASIN，导入广告数据时自动归类到对应产品
            </p>
          </div>
          <Button onClick={() => { resetForm(); setShowAdd(true); }} className="gap-1">
            <Plus className="h-4 w-4" />
            添加映射
          </Button>
        </div>

        {/* Info Banner */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
          <Info className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-800">
            <p className="font-medium">使用说明</p>
            <p className="text-xs mt-1">
              1. 在此页面将广告组合名称映射到对应的父ASIN<br />
              2. 一个父ASIN可以关联多个广告组合<br />
              3. 在"数据导入中心"导入广告报表时，系统会自动通过映射关系将数据分配到对应产品<br />
              4. 未映射的广告组合数据将保留但不会显示在产品详情页
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索ASIN或广告组合名称..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <Badge variant="outline" className="text-xs">
            {mappings?.length || 0} 个映射
          </Badge>
        </div>

        {/* Unmapped Portfolios Warning */}
        {importedPortfolios.length > 0 && (
          <Card className="border-amber-200 bg-amber-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-amber-700">
                <AlertCircle className="h-4 w-4" />
                未映射的广告组合 ({importedPortfolios.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {importedPortfolios.slice(0, 20).map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setForm(prev => ({ ...prev, portfolioName: p }));
                      setShowAdd(true);
                    }}
                    className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-800 hover:bg-amber-200 transition-colors border border-amber-300"
                  >
                    {p}
                  </button>
                ))}
                {importedPortfolios.length > 20 && (
                  <span className="text-xs text-amber-600 py-1">
                    还有 {importedPortfolios.length - 20} 个...
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Mapping List */}
        {groupedMappings.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Link2 className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground">暂无映射关系</p>
              <p className="text-xs text-muted-foreground mt-1">点击"添加映射"开始配置ASIN与广告组合的对应关系</p>
              <Button variant="outline" className="mt-4" onClick={() => { resetForm(); setShowAdd(true); }}>
                <Plus className="h-4 w-4 mr-1" />
                添加第一个映射
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {groupedMappings.map(([parentAsin, items]) => (
              <Card key={parentAsin}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Package className="h-4 w-4 text-blue-600" />
                    {parentAsin}
                    <Badge variant="secondary" className="text-[10px]">
                      {items.length} 个广告组合
                    </Badge>
                    {items[0]?.storeName && (
                      <span className="text-xs text-muted-foreground font-normal">
                        · {items[0].storeName}
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {items.map((m: any) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">{m.portfolioName}</p>
                            {m.notes && (
                              <p className="text-xs text-muted-foreground">{m.notes}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleEdit(m)}>
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>编辑</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                                onClick={() => {
                                  if (confirm("确定删除此映射？")) {
                                    deleteMapping.mutate({ id: m.id });
                                  }
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>删除</TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Add/Edit Dialog */}
        <Dialog open={showAdd} onOpenChange={(open) => { if (!open) resetForm(); }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingId ? "编辑映射" : "添加ASIN-广告组合映射"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Product Selection */}
              {products && products.length > 0 && (
                <div className="space-y-2">
                  <Label>选择产品（可选）</Label>
                  <Select
                    value={form.productId > 0 ? String(form.productId) : ""}
                    onValueChange={handleProductSelect}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择已有产品自动填充ASIN..." />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((p: any) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.parentAsin} - {p.chineseName || p.title?.slice(0, 40) || "未命名"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Parent ASIN */}
              <div className="space-y-2">
                <Label>父ASIN <span className="text-red-500">*</span></Label>
                <Input
                  value={form.parentAsin}
                  onChange={(e) => setForm(prev => ({ ...prev, parentAsin: e.target.value }))}
                  placeholder="例如: B0XXXXXXXXX"
                />
              </div>

              {/* Portfolio Name */}
              <div className="space-y-2">
                <Label>广告组合名称 <span className="text-red-500">*</span></Label>
                <Input
                  value={form.portfolioName}
                  onChange={(e) => setForm(prev => ({ ...prev, portfolioName: e.target.value }))}
                  placeholder="广告报表中的组合名称"
                />
                <p className="text-xs text-muted-foreground">
                  需要与广告报表Excel中的"广告组合"列完全匹配
                </p>
              </div>

              {/* Store Name */}
              <div className="space-y-2">
                <Label>店铺名称</Label>
                <Input
                  value={form.storeName}
                  onChange={(e) => setForm(prev => ({ ...prev, storeName: e.target.value }))}
                  placeholder="可选，用于区分不同店铺"
                />
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label>备注</Label>
                <Input
                  value={form.notes}
                  onChange={(e) => setForm(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="可选备注信息"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetForm}>取消</Button>
              <Button
                onClick={handleSubmit}
                disabled={createMapping.isPending || updateMapping.isPending}
              >
                {(createMapping.isPending || updateMapping.isPending) && (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                )}
                {editingId ? "保存" : "创建"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
