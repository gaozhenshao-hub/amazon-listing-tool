/**
 * ASIN-广告组合映射管理页面
 * - Template download: generates Excel with all portfolios, user fills in parent ASIN
 * - Batch upload: parses the filled Excel and creates/updates mappings
 * - Manual add/edit/delete single mappings
 */
import { useState, useMemo, useRef } from "react";
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
  Loader2, Info, FileSpreadsheet, Download, Upload, CheckCircle2,
  ArrowRight, FileUp,
} from "lucide-react";
import {
  Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from "@/components/ui/tooltip";

export default function OpsAdMapping() {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [showBatchUpload, setShowBatchUpload] = useState(false);
  const [batchPreview, setBatchPreview] = useState<{
    fileName: string;
    fileData: string;
    toCreate: number;
    toUpdate: number;
    skipped: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const generateTemplate = trpc.adTracking.generateMappingTemplate.useMutation({
    onSuccess: (data) => {
      // Download the Excel file
      const byteCharacters = atob(data.base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(
        `模板已下载：共 ${data.totalPortfolios} 个广告组合，${data.mappedCount} 个已映射，${data.unmappedCount} 个待映射`,
        { duration: 5000 }
      );
    },
    onError: (err) => toast.error(err.message),
  });

  const batchImport = trpc.adTracking.batchImportMappings.useMutation({
    onSuccess: (data) => {
      toast.success(
        `批量导入完成：新建 ${data.created} 个，更新 ${data.updated} 个，跳过 ${data.skipped} 个（未填写ASIN）`,
        { duration: 6000 }
      );
      refetch();
      setShowBatchUpload(false);
      setBatchPreview(null);
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

  // Handle batch file upload
  const handleBatchFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
      toast.error("请上传 .xlsx 或 .xls 格式的Excel文件");
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = (ev.target?.result as string).split(",")[1];
      setBatchPreview({
        fileName: file.name,
        fileData: base64,
        toCreate: 0,
        toUpdate: 0,
        skipped: 0,
      });
      setShowBatchUpload(true);
    };
    reader.readAsDataURL(file);

    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleBatchImport = () => {
    if (!batchPreview?.fileData) return;
    batchImport.mutate({ fileData: batchPreview.fileData });
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
          <div className="flex items-center gap-2">
            {/* Download Template */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  onClick={() => generateTemplate.mutate()}
                  disabled={generateTemplate.isPending}
                  className="gap-1.5"
                >
                  {generateTemplate.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  下载模板
                </Button>
              </TooltipTrigger>
              <TooltipContent>下载包含所有广告组合的Excel模板，填写父ASIN后上传</TooltipContent>
            </Tooltip>

            {/* Batch Upload */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="gap-1.5"
                >
                  <Upload className="h-4 w-4" />
                  批量上传
                </Button>
              </TooltipTrigger>
              <TooltipContent>上传填写好的映射模板Excel</TooltipContent>
            </Tooltip>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleBatchFileSelect}
            />

            {/* Manual Add */}
            <Button onClick={() => { resetForm(); setShowAdd(true); }} className="gap-1">
              <Plus className="h-4 w-4" />
              添加映射
            </Button>
          </div>
        </div>

        {/* Workflow Guide */}
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 mb-2">
              <Info className="h-4 w-4 text-blue-600 flex-shrink-0" />
              <p className="text-sm font-medium text-blue-800">批量映射操作流程</p>
            </div>
            <div className="flex items-center gap-3 text-xs text-blue-700 ml-6">
              <div className="flex items-center gap-1.5 bg-white/60 rounded-md px-3 py-1.5 border border-blue-200">
                <span className="font-semibold text-blue-800">①</span>
                先在"数据导入中心"导入广告报表
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
              <div className="flex items-center gap-1.5 bg-white/60 rounded-md px-3 py-1.5 border border-blue-200">
                <span className="font-semibold text-blue-800">②</span>
                点击"下载模板"获取所有广告组合
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
              <div className="flex items-center gap-1.5 bg-white/60 rounded-md px-3 py-1.5 border border-blue-200">
                <span className="font-semibold text-blue-800">③</span>
                在Excel中填写对应的父ASIN
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
              <div className="flex items-center gap-1.5 bg-white/60 rounded-md px-3 py-1.5 border border-blue-200">
                <span className="font-semibold text-blue-800">④</span>
                点击"批量上传"导入映射关系
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Search & Stats */}
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
              <p className="text-xs text-muted-foreground mt-1">
                请先导入广告报表，然后下载模板填写ASIN后批量上传
              </p>
              <div className="flex items-center justify-center gap-3 mt-4">
                <Button
                  variant="outline"
                  onClick={() => generateTemplate.mutate()}
                  disabled={generateTemplate.isPending}
                >
                  {generateTemplate.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-1" />
                  )}
                  下载模板
                </Button>
                <Button variant="outline" onClick={() => { resetForm(); setShowAdd(true); }}>
                  <Plus className="h-4 w-4 mr-1" />
                  手动添加
                </Button>
              </div>
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

        {/* Batch Upload Dialog */}
        <Dialog open={showBatchUpload} onOpenChange={(open) => {
          if (!open) {
            setShowBatchUpload(false);
            setBatchPreview(null);
          }
        }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileUp className="h-5 w-5 text-purple-600" />
                批量导入映射
              </DialogTitle>
            </DialogHeader>
            {batchPreview && (
              <div className="space-y-4 py-2">
                <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="h-5 w-5 text-green-600" />
                    <span className="text-sm font-medium">{batchPreview.fileName}</span>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>系统将解析Excel中的广告组合名称和父ASIN列：</p>
                    <ul className="list-disc list-inside space-y-0.5 ml-2">
                      <li>已填写父ASIN的行 → 创建或更新映射</li>
                      <li>未填写父ASIN的行 → 自动跳过</li>
                      <li>已存在且ASIN相同的映射 → 保持不变</li>
                      <li>已存在但ASIN不同的映射 → 更新为新ASIN</li>
                    </ul>
                  </div>
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-amber-700">
                    请确保Excel中的"广告组合名称"列与广告报表中的组合名称完全一致，"父ASIN（必填）"列填写了正确的父ASIN。
                  </p>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setShowBatchUpload(false);
                setBatchPreview(null);
              }}>
                取消
              </Button>
              <Button
                onClick={handleBatchImport}
                disabled={batchImport.isPending || !batchPreview?.fileData}
              >
                {batchImport.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                )}
                确认导入
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
