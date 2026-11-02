import { useState, useMemo, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Building2, PlusCircle, Search, Upload, Download, Edit2, Trash2,
  Star, Phone, Mail, Globe, MapPin, User, FileSpreadsheet, Loader2,
  AlertCircle, CheckCircle2, X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ─── Column mapping for CSV/Excel import ─────────────────────
const COLUMN_MAP: Record<string, string> = {
  "供应商名称": "name", "名称": "name", "name": "name", "公司名称": "name", "公司": "name",
  "联系人": "contactPerson", "contact": "contactPerson", "contact person": "contactPerson",
  "电话": "phone", "phone": "phone", "手机": "phone", "联系电话": "phone",
  "邮箱": "email", "email": "email", "邮件": "email",
  "地址": "address", "address": "address", "工厂地址": "address",
  "分类": "categories", "category": "categories", "类别": "categories", "产品类别": "categories",
  "网站": "website", "website": "website", "网址": "website",
  "资质": "qualityCerts", "认证": "qualityCerts", "质量认证": "qualityCerts", "certs": "qualityCerts",
  "评分": "overallScore", "score": "overallScore", "rating": "overallScore", "综合评分": "overallScore",
  "备注": "notes", "notes": "notes", "说明": "notes",
};

function mapColumns(row: Record<string, any>): any {
  const mapped: any = {};
  for (const [key, value] of Object.entries(row)) {
    const normalized = key.trim().toLowerCase();
    for (const [pattern, field] of Object.entries(COLUMN_MAP)) {
      if (normalized === pattern.toLowerCase()) {
        if (field === "categories") {
          mapped[field] = String(value).split(/[,，;；]/).map(s => s.trim()).filter(Boolean);
        } else if (field === "overallScore") {
          const num = parseInt(String(value));
          if (!isNaN(num) && num >= 1 && num <= 10) mapped[field] = num;
        } else {
          mapped[field] = String(value).trim();
        }
        break;
      }
    }
  }
  return mapped;
}

// ─── Star Rating Component ────────────────────────────────────
function StarRating({ value, onChange, readonly }: { value: number; onChange?: (v: number) => void; readonly?: boolean }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => (
        <Star
          key={i}
          className={`h-4 w-4 ${i <= value ? "fill-amber-400 text-amber-400" : "text-gray-300"} ${!readonly ? "cursor-pointer hover:text-amber-400" : ""}`}
          onClick={() => !readonly && onChange?.(i)}
        />
      ))}
    </div>
  );
}

// ─── Empty form state ─────────────────────────────────────────
const emptyForm = {
  name: "", contactPerson: "", phone: "", email: "",
  address: "", categories: [] as string[], website: "",
  qualityCerts: "", overallScore: 5, notes: "",
};

export default function DevSupplierLibrary() {
  const [search, setSearch] = useState("");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [categoryInput, setCategoryInput] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Upload state
  const [uploadData, setUploadData] = useState<any[]>([]);
  const [uploadFileName, setUploadFileName] = useState("");
  const [uploadParsing, setUploadParsing] = useState(false);

  const utils = trpc.useUtils();
  const { data: suppliers, isLoading } = trpc.devGlobalSupplier.list.useQuery({ search: search || undefined });

  const addMutation = trpc.devGlobalSupplier.add.useMutation({
    onSuccess: () => {
      toast.success("供应商添加成功");
      utils.devGlobalSupplier.list.invalidate();
      setShowAddDialog(false);
      setForm({ ...emptyForm });
    },
    onError: (err) => toast.error(`添加失败: ${err.message}`),
  });

  const updateMutation = trpc.devGlobalSupplier.update.useMutation({
    onSuccess: () => {
      toast.success("供应商更新成功");
      utils.devGlobalSupplier.list.invalidate();
      setShowAddDialog(false);
      setEditingId(null);
      setForm({ ...emptyForm });
    },
    onError: (err) => toast.error(`更新失败: ${err.message}`),
  });

  const deleteMutation = trpc.devGlobalSupplier.delete.useMutation({
    onSuccess: () => {
      toast.success("供应商已删除");
      utils.devGlobalSupplier.list.invalidate();
      setDeleteConfirmId(null);
    },
    onError: (err) => toast.error(`删除失败: ${err.message}`),
  });

  const batchImportMutation = trpc.devGlobalSupplier.batchImport.useMutation({
    onSuccess: (result) => {
      toast.success(`成功导入 ${result.imported} 个供应商${result.failed > 0 ? `，${result.failed} 个失败` : ""}`);
      utils.devGlobalSupplier.list.invalidate();
      setShowUploadDialog(false);
      setUploadData([]);
      setUploadFileName("");
    },
    onError: (err) => toast.error(`导入失败: ${err.message}`),
  });

  // ─── Handlers ───────────────────────────────────────────────
  const handleOpenAdd = useCallback(() => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setCategoryInput("");
    setShowAddDialog(true);
  }, []);

  const handleOpenEdit = useCallback((supplier: any) => {
    setEditingId(supplier.id);
    const cats = supplier.categories ? (typeof supplier.categories === "string" ? safeParseJson(supplier.categories) : supplier.categories) : [];
    setForm({
      name: supplier.name || "",
      contactPerson: supplier.contactPerson || "",
      phone: supplier.phone || "",
      email: supplier.email || "",
      address: supplier.address || "",
      categories: Array.isArray(cats) ? cats : [],
      website: supplier.website || "",
      qualityCerts: supplier.qualityCerts || "",
      overallScore: supplier.overallScore || 5,
      notes: supplier.notes || "",
    });
    setCategoryInput("");
    setShowAddDialog(true);
  }, []);

  const handleSave = useCallback(() => {
    if (!form.name.trim()) {
      toast.error("供应商名称不能为空");
      return;
    }
    if (editingId) {
      updateMutation.mutate({ id: editingId, ...form });
    } else {
      addMutation.mutate(form);
    }
  }, [form, editingId, addMutation, updateMutation]);

  const handleAddCategory = useCallback(() => {
    const cat = categoryInput.trim();
    if (cat && !form.categories.includes(cat)) {
      setForm(prev => ({ ...prev, categories: [...prev.categories, cat] }));
      setCategoryInput("");
    }
  }, [categoryInput, form.categories]);

  const handleRemoveCategory = useCallback((cat: string) => {
    setForm(prev => ({ ...prev, categories: prev.categories.filter(c => c !== cat) }));
  }, []);

  // ─── File Upload Handler ────────────────────────────────────
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext || "")) {
      toast.error("请上传 .xlsx、.xls 或 .csv 格式的文件");
      return;
    }

    setUploadParsing(true);
    setUploadFileName(file.name);

    try {
      const XLSX = await import("xlsx");
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });

      if (rows.length === 0) {
        toast.error("文件为空或格式不正确");
        setUploadParsing(false);
        return;
      }

      // Map columns
      const mapped = rows.map(mapColumns).filter((r: any) => r.name && r.name.trim());

      if (mapped.length === 0) {
        toast.error("未找到有效的供应商数据，请确保表格包含'供应商名称'或'name'列");
        setUploadParsing(false);
        return;
      }

      setUploadData(mapped);
      setShowUploadDialog(true);
    } catch (err: any) {
      toast.error(`文件解析失败: ${err.message}`);
    } finally {
      setUploadParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  const handleConfirmImport = useCallback(() => {
    if (uploadData.length === 0) return;
    batchImportMutation.mutate({ suppliers: uploadData });
  }, [uploadData, batchImportMutation]);

  // ─── Download Template ──────────────────────────────────────
  const handleDownloadTemplate = useCallback(async () => {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([
      ["供应商名称", "联系人", "电话", "邮箱", "地址", "分类", "网站", "资质", "评分", "备注"],
      ["示例供应商A", "张三", "13800138000", "zhangsan@example.com", "广东省深圳市", "电子配件,塑料件", "www.example.com", "ISO9001", "8", "优质供应商"],
      ["示例供应商B", "李四", "13900139000", "lisi@example.com", "浙江省义乌市", "包装材料", "", "", "6", ""],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "供应商模板");
    XLSX.writeFile(wb, "供应商导入模板.xlsx");
    toast.success("模板已下载");
  }, []);

  const isSaving = addMutation.isPending || updateMutation.isPending;

  // ─── Render ─────────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">供应商库</h1>
          <p className="text-muted-foreground text-sm mt-1">
            管理全局供应商资源，支持评分和对比 · 共 {suppliers?.length || 0} 个供应商
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={handleDownloadTemplate}>
            <Download className="h-4 w-4" />下载模板
          </Button>
          <div className="relative">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => fileInputRef.current?.click()} disabled={uploadParsing}>
              {uploadParsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              导入表格
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>
          <Button size="sm" className="gap-2" onClick={handleOpenAdd}>
            <PlusCircle className="h-4 w-4" />添加供应商
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索供应商名称、联系人、邮箱..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Supplier Table */}
      {isLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : !suppliers || suppliers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Building2 className="h-12 w-12 mb-3 opacity-30" />
            <p className="text-sm">暂无供应商数据</p>
            <p className="text-xs mt-1">点击"添加供应商"手动添加，或"导入表格"批量导入</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">供应商名称</TableHead>
                  <TableHead>联系人</TableHead>
                  <TableHead>电话</TableHead>
                  <TableHead>邮箱</TableHead>
                  <TableHead>分类</TableHead>
                  <TableHead className="text-center">评分</TableHead>
                  <TableHead className="text-right w-[120px]">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.map((s: any) => {
                  const cats = s.categories ? (typeof s.categories === "string" ? safeParseJson(s.categories) : s.categories) : [];
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="truncate max-w-[150px]">{s.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {s.contactPerson && (
                          <div className="flex items-center gap-1 text-sm">
                            <User className="h-3 w-3 text-muted-foreground" />
                            {s.contactPerson}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {s.phone && (
                          <div className="flex items-center gap-1 text-sm">
                            <Phone className="h-3 w-3 text-muted-foreground" />
                            {s.phone}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {s.email && (
                          <div className="flex items-center gap-1 text-sm">
                            <Mail className="h-3 w-3 text-muted-foreground" />
                            <span className="truncate max-w-[150px]">{s.email}</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {Array.isArray(cats) && cats.map((c: string, i: number) => (
                            <Badge key={i} variant="secondary" className="text-xs">{c}</Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {s.overallScore ? (
                          <div className="flex items-center justify-center gap-1">
                            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                            <span className="text-sm font-medium">{s.overallScore}/10</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">未评分</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleOpenEdit(s)}>
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => setDeleteConfirmId(s.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ─── Add/Edit Dialog ──────────────────────────────────── */}
      <Dialog open={showAddDialog} onOpenChange={(open) => { if (!open) { setShowAddDialog(false); setEditingId(null); } }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "编辑供应商" : "添加供应商"}</DialogTitle>
            <DialogDescription>
              {editingId ? "修改供应商信息" : "填写供应商基本信息，带 * 为必填项"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Name */}
            <div className="space-y-1.5">
              <Label>供应商名称 *</Label>
              <Input
                placeholder="输入供应商名称"
                value={form.name}
                onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>

            {/* Contact Info - 2 columns */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>联系人</Label>
                <Input
                  placeholder="联系人姓名"
                  value={form.contactPerson}
                  onChange={(e) => setForm(prev => ({ ...prev, contactPerson: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>电话</Label>
                <Input
                  placeholder="联系电话"
                  value={form.phone}
                  onChange={(e) => setForm(prev => ({ ...prev, phone: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>邮箱</Label>
                <Input
                  placeholder="电子邮箱"
                  value={form.email}
                  onChange={(e) => setForm(prev => ({ ...prev, email: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>网站</Label>
                <Input
                  placeholder="公司网站"
                  value={form.website}
                  onChange={(e) => setForm(prev => ({ ...prev, website: e.target.value }))}
                />
              </div>
            </div>

            {/* Address */}
            <div className="space-y-1.5">
              <Label>地址</Label>
              <Input
                placeholder="工厂/公司地址"
                value={form.address}
                onChange={(e) => setForm(prev => ({ ...prev, address: e.target.value }))}
              />
            </div>

            {/* Categories */}
            <div className="space-y-1.5">
              <Label>产品分类</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="输入分类后回车添加"
                  value={categoryInput}
                  onChange={(e) => setCategoryInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddCategory(); } }}
                />
                <Button variant="outline" size="sm" onClick={handleAddCategory} type="button">添加</Button>
              </div>
              {form.categories.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {form.categories.map((cat, i) => (
                    <Badge key={i} variant="secondary" className="gap-1">
                      {cat}
                      <X className="h-3 w-3 cursor-pointer" onClick={() => handleRemoveCategory(cat)} />
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Quality Certs */}
            <div className="space-y-1.5">
              <Label>质量认证</Label>
              <Input
                placeholder="如 ISO9001, CE, FCC 等"
                value={form.qualityCerts}
                onChange={(e) => setForm(prev => ({ ...prev, qualityCerts: e.target.value }))}
              />
            </div>

            {/* Score */}
            <div className="space-y-1.5">
              <Label>综合评分 ({form.overallScore}/10)</Label>
              <StarRating value={form.overallScore} onChange={(v) => setForm(prev => ({ ...prev, overallScore: v }))} />
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label>备注</Label>
              <Textarea
                placeholder="其他备注信息..."
                value={form.notes}
                onChange={(e) => setForm(prev => ({ ...prev, notes: e.target.value }))}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>取消</Button>
            <Button onClick={handleSave} disabled={isSaving} className="gap-2">
              {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingId ? "保存修改" : "添加供应商"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Upload Preview Dialog ────────────────────────────── */}
      <Dialog open={showUploadDialog} onOpenChange={(open) => { if (!open) { setShowUploadDialog(false); setUploadData([]); } }}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              导入预览
            </DialogTitle>
            <DialogDescription>
              文件: {uploadFileName} · 解析到 {uploadData.length} 条供应商数据，请确认后导入
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-auto border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">#</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>联系人</TableHead>
                  <TableHead>电话</TableHead>
                  <TableHead>邮箱</TableHead>
                  <TableHead>分类</TableHead>
                  <TableHead>评分</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {uploadData.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{row.contactPerson || "-"}</TableCell>
                    <TableCell>{row.phone || "-"}</TableCell>
                    <TableCell>{row.email || "-"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(row.categories || []).map((c: string, j: number) => (
                          <Badge key={j} variant="secondary" className="text-xs">{c}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>{row.overallScore || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <DialogFooter className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 inline mr-1 text-green-500" />
              {uploadData.length} 条数据准备导入
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setShowUploadDialog(false); setUploadData([]); }}>取消</Button>
              <Button onClick={handleConfirmImport} disabled={batchImportMutation.isPending} className="gap-2">
                {batchImportMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                确认导入 ({uploadData.length})
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete Confirm Dialog ────────────────────────────── */}
      <Dialog open={deleteConfirmId !== null} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              确认删除
            </DialogTitle>
            <DialogDescription>
              删除后无法恢复，确定要删除此供应商吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>取消</Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && deleteMutation.mutate({ id: deleteConfirmId })}
              disabled={deleteMutation.isPending}
              className="gap-2"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function safeParseJson(raw: any): any {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}
