import { useState, useMemo, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Package, Loader2, Plus, Trash2, Save, Edit2, X, Lock, Unlock,
  CheckCircle2, Wrench, RefreshCw, ArrowDown, Building2, Star,
  Link2, AlertTriangle, Download, ChevronDown, ChevronUp,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface BomEditorProps {
  projectId: number;
}

interface EditingRow {
  id?: number;
  partName: string;
  partCategory: string;
  material: string;
  specification: string;
  quantity: number;
  unitCost: string;
  moldCost: string;
  supplier: string;
  supplierGlobalId: number | null;
  supplierName: string;
  moq: number;
  leadTime: number;
  notes: string;
  isNew?: boolean;
}

export default function BomEditor({ projectId }: BomEditorProps) {
  const utils = trpc.useUtils();
  const { data: bomItems, isLoading } = trpc.devBom.list.useQuery({ projectId }) as any;
  const { data: projectSuppliers } = trpc.devBom.listSuppliers.useQuery({ projectId }) as any;
  const { data: globalSuppliers } = trpc.devGlobalSupplier.list.useQuery() as any;
  const { data: profileCostData } = trpc.devLinkage.getProfileCostData.useQuery({ projectId });
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [editRow, setEditRow] = useState<EditingRow | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [showProfileCost, setShowProfileCost] = useState(false);
  const [supplierSearchOpen, setSupplierSearchOpen] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState("");
  const supplierDropdownRef = useRef<HTMLDivElement>(null);

  const aiSuggestMutation = trpc.devBom.aiSuggest.useMutation({
    onSuccess: () => {
      toast.success("BOM建议生成完成");
      utils.devBom.list.invalidate({ projectId });
    },
    onError: (err: any) => toast.error(`生成失败: ${err.message}`),
  });

  const addMutation = trpc.devBom.add.useMutation({
    onSuccess: () => {
      toast.success("已添加部件");
      setEditingId(null);
      setEditRow(null);
      utils.devBom.list.invalidate({ projectId });
    },
    onError: (err: any) => toast.error(`添加失败: ${err.message}`),
  });

  const updateMutation = trpc.devBom.update.useMutation({
    onSuccess: () => {
      toast.success("已更新部件");
      setEditingId(null);
      setEditRow(null);
      utils.devBom.list.invalidate({ projectId });
    },
    onError: (err: any) => toast.error(`更新失败: ${err.message}`),
  });

  const deleteMutation = trpc.devBom.delete.useMutation({
    onSuccess: () => {
      toast.success("已删除部件");
      utils.devBom.list.invalidate({ projectId });
    },
    onError: (err: any) => toast.error(`删除失败: ${err.message}`),
  });

  const importProfileMutation = trpc.devLinkage.importProfileCostToBom.useMutation({
    onSuccess: (data) => {
      toast.success(`已从产品画像导入 ${data.imported} 项成本到BOM`);
      utils.devBom.list.invalidate({ projectId });
    },
    onError: (err: any) => toast.error(`导入失败: ${err.message}`),
  });

  const items: any[] = bomItems || [];

  // Cost summary
  const costSummary = useMemo(() => {
    let materialTotal = 0;
    items.forEach((item: any) => {
      const price = parseFloat(item.unitPrice || "0");
      const qty = item.quantity || 1;
      materialTotal += price * qty;
    });
    return { materialTotal, grandTotal: materialTotal };
  }, [items]);

  // Filtered global suppliers for dropdown
  const filteredSuppliers = useMemo(() => {
    if (!globalSuppliers) return [];
    if (!supplierSearch.trim()) return globalSuppliers;
    const q = supplierSearch.toLowerCase();
    return globalSuppliers.filter((s: any) =>
      s.name.toLowerCase().includes(q) ||
      (s.contactPerson && s.contactPerson.toLowerCase().includes(q))
    );
  }, [globalSuppliers, supplierSearch]);

  // Close supplier dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (supplierDropdownRef.current && !supplierDropdownRef.current.contains(e.target as Node)) {
        setSupplierSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleStartEdit = (item: any) => {
    if (isLocked) return;
    setEditingId(item.id);
    setEditRow({
      id: item.id,
      partName: item.partName || "",
      partCategory: item.process || "",
      material: item.material || "",
      specification: item.specification || "",
      quantity: item.quantity || 1,
      unitCost: item.unitPrice || "",
      moldCost: "",
      supplier: "",
      supplierGlobalId: item.supplierGlobalId || null,
      supplierName: item.supplierName || "",
      moq: 0,
      leadTime: 0,
      notes: item.remark || "",
    });
  };

  const handleStartNew = () => {
    if (isLocked) return;
    setEditingId("new");
    setEditRow({
      partName: "",
      partCategory: "",
      material: "",
      specification: "",
      quantity: 1,
      unitCost: "",
      moldCost: "",
      supplier: "",
      supplierGlobalId: null,
      supplierName: "",
      moq: 0,
      leadTime: 0,
      notes: "",
      isNew: true,
    });
  };

  const handleSelectGlobalSupplier = (supplier: any) => {
    if (!editRow) return;
    setEditRow({
      ...editRow,
      supplierGlobalId: supplier.id,
      supplierName: supplier.name,
      supplier: supplier.name,
    });
    setSupplierSearchOpen(false);
    setSupplierSearch("");
    toast.success(`已关联供应商: ${supplier.name}`);
  };

  const handleClearSupplier = () => {
    if (!editRow) return;
    setEditRow({
      ...editRow,
      supplierGlobalId: null,
      supplierName: "",
      supplier: "",
    });
  };

  const handleSaveRow = () => {
    if (!editRow) return;
    if (!editRow.partName.trim()) {
      toast.error("部件名称不能为空");
      return;
    }
    if (editRow.isNew) {
      addMutation.mutate({
        projectId,
        partName: editRow.partName,
        partCategory: editRow.partCategory || undefined,
        material: editRow.material || undefined,
        specification: editRow.specification || undefined,
        quantity: editRow.quantity,
        unitCost: editRow.unitCost || undefined,
        supplier: editRow.supplier || undefined,
        supplierGlobalId: editRow.supplierGlobalId || undefined,
        supplierName: editRow.supplierName || undefined,
        moq: editRow.moq || undefined,
        leadTime: editRow.leadTime || undefined,
        notes: editRow.notes || undefined,
      });
    } else if (editRow.id) {
      updateMutation.mutate({
        id: editRow.id,
        partName: editRow.partName,
        partCategory: editRow.partCategory || undefined,
        material: editRow.material || undefined,
        specification: editRow.specification || undefined,
        quantity: editRow.quantity,
        unitCost: editRow.unitCost || undefined,
        supplier: editRow.supplier || undefined,
        supplierGlobalId: editRow.supplierGlobalId || undefined,
        supplierName: editRow.supplierName || undefined,
        moq: editRow.moq || undefined,
        leadTime: editRow.leadTime || undefined,
        notes: editRow.notes || undefined,
      });
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditRow(null);
    setSupplierSearchOpen(false);
  };

  const handleDelete = (id: number) => {
    if (isLocked) return;
    if (confirm("确定删除此部件？")) {
      deleteMutation.mutate({ id });
    }
  };

  const handleImportProfileCost = () => {
    if (!profileCostData?.available || !profileCostData.breakdown.length) {
      toast.error("产品画像中没有可导入的成本数据");
      return;
    }
    const importItems = profileCostData.breakdown
      .filter((b: any) => b.item && b.item.trim())
      .map((b: any) => ({
        partName: b.item,
        unitCost: b.estimatedCost || undefined,
        quantity: 1,
        notes: b.note || undefined,
      }));
    if (importItems.length === 0) {
      toast.error("没有有效的成本项可导入");
      return;
    }
    importProfileMutation.mutate({ projectId, items: importItems });
  };

  const renderEditCell = (field: keyof EditingRow, type: "text" | "number" = "text", placeholder = "") => {
    if (!editRow) return null;
    return (
      <input
        type={type}
        className="w-full px-2 py-1 text-xs border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary/30"
        value={editRow[field] as any}
        placeholder={placeholder}
        onChange={(e) => setEditRow({
          ...editRow,
          [field]: type === "number" ? (parseFloat(e.target.value) || 0) : e.target.value,
        })}
      />
    );
  };

  // Global supplier selector with search
  const renderSupplierSelector = () => {
    if (!editRow) return null;
    return (
      <div className="relative" ref={supplierDropdownRef}>
        {editRow.supplierGlobalId ? (
          <div className="flex items-center gap-1">
            <div className="flex items-center gap-1 px-2 py-1 text-xs border rounded bg-blue-50 text-blue-700 flex-1 min-w-0">
              <Building2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{editRow.supplierName}</span>
              {(() => {
                const s = globalSuppliers?.find((gs: any) => gs.id === editRow.supplierGlobalId);
                return s?.overallScore ? (
                  <span className="flex items-center gap-0.5 shrink-0">
                    <Star className="h-2.5 w-2.5 text-amber-500 fill-amber-500" />
                    <span className="text-[10px]">{s.overallScore}</span>
                  </span>
                ) : null;
              })()}
            </div>
            <button onClick={handleClearSupplier} className="p-0.5 hover:bg-red-50 rounded">
              <X className="h-3 w-3 text-red-400" />
            </button>
          </div>
        ) : (
          <div>
            <input
              type="text"
              className="w-full px-2 py-1 text-xs border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary/30"
              placeholder="搜索供应商库..."
              value={supplierSearch}
              onChange={(e) => {
                setSupplierSearch(e.target.value);
                setSupplierSearchOpen(true);
              }}
              onFocus={() => setSupplierSearchOpen(true)}
            />
            {supplierSearchOpen && (
              <div className="absolute z-50 mt-1 w-64 max-h-48 overflow-auto bg-background border rounded-lg shadow-lg">
                {filteredSuppliers.length === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground text-center">
                    {globalSuppliers?.length === 0 ? "供应商库为空，请先添加供应商" : "未找到匹配的供应商"}
                  </div>
                ) : (
                  filteredSuppliers.map((s: any) => {
                    let cats: string[] = [];
                    try { cats = JSON.parse(s.categories || "[]"); } catch {}
                    return (
                      <button
                        key={s.id}
                        className="w-full text-left px-3 py-2 hover:bg-muted/50 border-b last:border-0 transition-colors"
                        onClick={() => handleSelectGlobalSupplier(s)}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium">{s.name}</span>
                          {s.overallScore && (
                            <span className="flex items-center gap-0.5">
                              <Star className="h-2.5 w-2.5 text-amber-500 fill-amber-500" />
                              <span className="text-[10px] text-muted-foreground">{s.overallScore}/10</span>
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {s.contactPerson && <span className="text-[10px] text-muted-foreground">{s.contactPerson}</span>}
                          {s.phone && <span className="text-[10px] text-muted-foreground">{s.phone}</span>}
                          {cats.length > 0 && (
                            <span className="text-[10px] text-blue-500">{cats.slice(0, 2).join(", ")}</span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // Get supplier info for display in read-only rows
  const getSupplierDisplay = (item: any) => {
    if (item.supplierGlobalId && item.supplierName) {
      const gs = globalSuppliers?.find((s: any) => s.id === item.supplierGlobalId);
      return (
        <div className="flex items-center gap-1">
          <Building2 className="h-3 w-3 text-blue-500 shrink-0" />
          <span className="text-xs text-blue-700 truncate">{item.supplierName}</span>
          {gs?.overallScore && (
            <span className="flex items-center gap-0.5 shrink-0">
              <Star className="h-2.5 w-2.5 text-amber-500 fill-amber-500" />
              <span className="text-[10px]">{gs.overallScore}</span>
            </span>
          )}
        </div>
      );
    }
    return <span className="text-xs text-muted-foreground">-</span>;
  };

  // Supplier tooltip/popover for read-only view
  const getSupplierTooltip = (item: any) => {
    if (!item.supplierGlobalId) return null;
    const gs = globalSuppliers?.find((s: any) => s.id === item.supplierGlobalId);
    if (!gs) return null;
    return gs;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Package className="h-4 w-4" />BOM物料清单
          {isLocked && <Badge className="bg-emerald-100 text-emerald-700 text-xs ml-2">已确认锁定</Badge>}
          {items.length > 0 && !isLocked && <Badge variant="outline" className="text-xs ml-2">{items.length} 项</Badge>}
        </h3>
        <div className="flex gap-2">
          {!isLocked && (
            <Button size="sm" onClick={() => aiSuggestMutation.mutate({ projectId })} disabled={aiSuggestMutation.isPending} className="gap-2">
              {aiSuggestMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
              AI建议BOM
            </Button>
          )}
          {items.length > 0 && (
            <Button
              size="sm"
              variant={isLocked ? "outline" : "default"}
              className={isLocked ? "gap-1 text-amber-600 border-amber-200 hover:bg-amber-50" : "gap-1 bg-emerald-600 hover:bg-emerald-700"}
              onClick={() => {
                setIsLocked(!isLocked);
                toast.success(isLocked ? "BOM已解锁，可继续编辑" : "BOM已确认锁定");
              }}
            >
              {isLocked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
              {isLocked ? "解锁编辑" : "确认锁定"}
            </Button>
          )}
        </div>
      </div>

      {/* ─── Profile Cost Reference Panel ─── */}
      {profileCostData?.available && (
        <Card className={`border-dashed ${profileCostData.confirmed ? "border-emerald-300 bg-emerald-50/30" : "border-amber-300 bg-amber-50/30"}`}>
          <CardHeader className="pb-2 pt-3 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs flex items-center gap-2">
                <Link2 className="h-3.5 w-3.5 text-blue-500" />
                <span>产品画像 · 成本参考数据</span>
                {profileCostData.confirmed ? (
                  <Badge className="bg-emerald-100 text-emerald-700 text-[10px] px-1.5 py-0">已确认</Badge>
                ) : (
                  <Badge className="bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0">未确认</Badge>
                )}
                <span className="text-[10px] text-muted-foreground font-normal">
                  合计 ¥{profileCostData.totalCost.toFixed(2)}
                </span>
              </CardTitle>
              <div className="flex items-center gap-2">
                {!isLocked && profileCostData.breakdown.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 gap-1 text-[10px] border-blue-200 text-blue-600 hover:bg-blue-50"
                    onClick={handleImportProfileCost}
                    disabled={importProfileMutation.isPending}
                  >
                    {importProfileMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                    导入到BOM
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  onClick={() => setShowProfileCost(!showProfileCost)}
                >
                  {showProfileCost ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          </CardHeader>
          {showProfileCost && (
            <CardContent className="px-4 pb-3 pt-0">
              <div className="overflow-x-auto border rounded bg-background">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left p-1.5 font-medium">成本项</th>
                      <th className="text-right p-1.5 font-medium w-24">预估金额(¥)</th>
                      <th className="text-right p-1.5 font-medium w-16">占比</th>
                      <th className="text-left p-1.5 font-medium">说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profileCostData.breakdown.map((b: any, i: number) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="p-1.5">{b.item || "-"}</td>
                        <td className="p-1.5 text-right font-mono">{b.estimatedCost || "-"}</td>
                        <td className="p-1.5 text-right text-muted-foreground">{b.percentage || "-"}</td>
                        <td className="p-1.5 text-muted-foreground">{b.note || "-"}</td>
                      </tr>
                    ))}
                    <tr className="bg-muted/20 font-medium">
                      <td className="p-1.5">合计</td>
                      <td className="p-1.5 text-right font-mono">¥{profileCostData.totalCost.toFixed(2)}</td>
                      <td className="p-1.5 text-right">100%</td>
                      <td className="p-1.5"></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {profileCostData.targetRetailPrice && (
                <div className="flex gap-4 mt-2 text-[10px] text-muted-foreground">
                  <span>建议零售价: {profileCostData.targetRetailPrice}</span>
                  {profileCostData.targetMargin && <span>目标利润率: {profileCostData.targetMargin}</span>}
                </div>
              )}
              {!profileCostData.confirmed && (
                <div className="flex items-center gap-1 mt-2 text-[10px] text-amber-600">
                  <AlertTriangle className="h-3 w-3" />
                  <span>产品画像成本数据尚未确认锁定，导入后建议在画像中确认</span>
                </div>
              )}
            </CardContent>
          )}
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : items.length > 0 || editingId === "new" ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-center p-2 font-medium text-xs w-10">#</th>
                    <th className="text-left p-2 font-medium text-xs">部件名称</th>
                    <th className="text-left p-2 font-medium text-xs">材质</th>
                    <th className="text-left p-2 font-medium text-xs">规格</th>
                    <th className="text-left p-2 font-medium text-xs">工艺</th>
                    <th className="text-right p-2 font-medium text-xs">数量</th>
                    <th className="text-right p-2 font-medium text-xs">单价(¥)</th>
                    <th className="text-right p-2 font-medium text-xs">小计(¥)</th>
                    <th className="text-left p-2 font-medium text-xs w-40">供应商</th>
                    <th className="text-left p-2 font-medium text-xs">备注</th>
                    <th className="text-center p-2 font-medium text-xs w-24">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item: any, idx: number) => {
                    const isEditingThis = editingId === item.id;
                    const price = parseFloat(item.unitPrice || "0");
                    const qty = item.quantity || 1;
                    const subtotal = price * qty;

                    if (isEditingThis && editRow) {
                      return (
                        <tr key={item.id} className="border-b bg-blue-50/30">
                          <td className="p-2 text-center text-xs text-muted-foreground">{idx + 1}</td>
                          <td className="p-2">{renderEditCell("partName", "text", "部件名称")}</td>
                          <td className="p-2">{renderEditCell("material", "text", "材质")}</td>
                          <td className="p-2">{renderEditCell("specification", "text", "规格")}</td>
                          <td className="p-2">{renderEditCell("partCategory", "text", "工艺")}</td>
                          <td className="p-2">{renderEditCell("quantity", "number")}</td>
                          <td className="p-2">{renderEditCell("unitCost", "text", "0.00")}</td>
                          <td className="p-2 text-right text-xs">
                            ¥{((parseFloat(editRow.unitCost || "0")) * (editRow.quantity || 1)).toFixed(2)}
                          </td>
                          <td className="p-2">{renderSupplierSelector()}</td>
                          <td className="p-2">{renderEditCell("notes", "text", "备注")}</td>
                          <td className="p-2">
                            <div className="flex gap-1 justify-center">
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={handleSaveRow}
                                disabled={addMutation.isPending || updateMutation.isPending}>
                                <Save className="h-3.5 w-3.5 text-emerald-600" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={handleCancel}>
                                <X className="h-3.5 w-3.5 text-gray-500" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={item.id} className="border-b last:border-0 hover:bg-muted/20 cursor-pointer group"
                        onDoubleClick={() => !isLocked && handleStartEdit(item)}>
                        <td className="p-2 text-center text-xs text-muted-foreground">{idx + 1}</td>
                        <td className="p-2 font-medium text-xs">
                          {item.partName}
                          {item.remark?.startsWith("[画像导入]") && (
                            <Badge variant="outline" className="ml-1 text-[9px] px-1 py-0 border-blue-200 text-blue-500">画像</Badge>
                          )}
                        </td>
                        <td className="p-2 text-xs text-muted-foreground">{item.material || "-"}</td>
                        <td className="p-2 text-xs text-muted-foreground">{item.specification || "-"}</td>
                        <td className="p-2 text-xs text-muted-foreground">{item.process || "-"}</td>
                        <td className="p-2 text-right text-xs">{qty}</td>
                        <td className="p-2 text-right text-xs">{price > 0 ? `¥${price.toFixed(2)}` : "-"}</td>
                        <td className="p-2 text-right text-xs font-medium">{subtotal > 0 ? `¥${subtotal.toFixed(2)}` : "-"}</td>
                        <td className="p-2">{getSupplierDisplay(item)}</td>
                        <td className="p-2 text-xs text-muted-foreground max-w-[120px] truncate">{item.remark || "-"}</td>
                        <td className="p-2">
                          {!isLocked && (
                            <div className="flex gap-1 justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleStartEdit(item)}>
                                <Edit2 className="h-3 w-3 text-blue-600" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleDelete(item.id)}>
                                <Trash2 className="h-3 w-3 text-red-500" />
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  {/* New row being added */}
                  {editingId === "new" && editRow && (
                    <tr className="border-b bg-emerald-50/30">
                      <td className="p-2 text-center text-xs text-emerald-600">+</td>
                      <td className="p-2">{renderEditCell("partName", "text", "部件名称")}</td>
                      <td className="p-2">{renderEditCell("material", "text", "材质")}</td>
                      <td className="p-2">{renderEditCell("specification", "text", "规格")}</td>
                      <td className="p-2">{renderEditCell("partCategory", "text", "工艺")}</td>
                      <td className="p-2">{renderEditCell("quantity", "number")}</td>
                      <td className="p-2">{renderEditCell("unitCost", "text", "0.00")}</td>
                      <td className="p-2 text-right text-xs">
                        ¥{((parseFloat(editRow.unitCost || "0")) * (editRow.quantity || 1)).toFixed(2)}
                      </td>
                      <td className="p-2">{renderSupplierSelector()}</td>
                      <td className="p-2">{renderEditCell("notes", "text", "备注")}</td>
                      <td className="p-2">
                        <div className="flex gap-1 justify-center">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={handleSaveRow}
                            disabled={addMutation.isPending}>
                            <Save className="h-3.5 w-3.5 text-emerald-600" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={handleCancel}>
                            <X className="h-3.5 w-3.5 text-gray-500" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}

                  {/* Cost Summary Row */}
                  {items.length > 0 && (
                    <tr className="bg-muted/30 font-semibold">
                      <td colSpan={7} className="p-2 text-right text-xs">材料合计</td>
                      <td className="p-2 text-right text-xs text-primary">¥{costSummary.materialTotal.toFixed(2)}</td>
                      <td colSpan={3}></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>

          {/* Add Row Button */}
          {!isLocked && editingId !== "new" && (
            <div className="p-3 border-t">
              <Button size="sm" variant="outline" className="gap-1 text-xs w-full" onClick={handleStartNew}>
                <Plus className="h-3.5 w-3.5" />新增部件
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Package className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">暂无BOM数据</p>
            <p className="text-xs mt-1">
              {profileCostData?.available
                ? "可从产品画像导入成本数据，或点击\"AI建议BOM\"自动生成"
                : "点击\"AI建议BOM\"自动生成，生成后可行内编辑每个部件"}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Tip */}
      {items.length > 0 && !isLocked && (
        <p className="text-xs text-muted-foreground text-center">
          提示：双击表格行可快速进入编辑模式 · 编辑时可从全局供应商库选择供应商 · 编辑完成后点击"确认锁定"锁定BOM
        </p>
      )}
    </div>
  );
}
