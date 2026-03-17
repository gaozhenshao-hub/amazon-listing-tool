import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Package, Loader2, Plus, Trash2, Save, Edit2, X, Lock, Unlock,
  CheckCircle2, Wrench, RefreshCw,
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
  moq: number;
  leadTime: number;
  notes: string;
  isNew?: boolean;
}

export default function BomEditor({ projectId }: BomEditorProps) {
  const utils = trpc.useUtils();
  const { data: bomItems, isLoading } = trpc.devBom.list.useQuery({ projectId }) as any;
  const { data: suppliers } = trpc.devBom.listSuppliers.useQuery({ projectId }) as any;
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [editRow, setEditRow] = useState<EditingRow | null>(null);
  const [isLocked, setIsLocked] = useState(false);

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

  const items: any[] = bomItems || [];

  // Cost summary
  const costSummary = useMemo(() => {
    let materialTotal = 0;
    let moldTotal = 0;
    items.forEach((item: any) => {
      const price = parseFloat(item.unitPrice || "0");
      const qty = item.quantity || 1;
      materialTotal += price * qty;
    });
    return { materialTotal, moldTotal, grandTotal: materialTotal + moldTotal };
  }, [items]);

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
      moq: 0,
      leadTime: 0,
      notes: "",
      isNew: true,
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
        moq: editRow.moq || undefined,
        leadTime: editRow.leadTime || undefined,
        notes: editRow.notes || undefined,
      });
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditRow(null);
  };

  const handleDelete = (id: number) => {
    if (isLocked) return;
    if (confirm("确定删除此部件？")) {
      deleteMutation.mutate({ id });
    }
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

  const renderSupplierSelect = () => {
    if (!editRow) return null;
    return (
      <select
        className="w-full px-2 py-1 text-xs border rounded bg-background"
        value={editRow.supplier}
        onChange={(e) => setEditRow({ ...editRow, supplier: e.target.value })}
      >
        <option value="">-- 选择供应商 --</option>
        {(suppliers || []).map((s: any) => (
          <option key={s.id} value={s.name}>{s.name}</option>
        ))}
      </select>
    );
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
                    <th className="text-left p-2 font-medium text-xs">类别</th>
                    <th className="text-left p-2 font-medium text-xs">材质</th>
                    <th className="text-left p-2 font-medium text-xs">规格</th>
                    <th className="text-left p-2 font-medium text-xs">工艺</th>
                    <th className="text-right p-2 font-medium text-xs">数量</th>
                    <th className="text-right p-2 font-medium text-xs">单价(¥)</th>
                    <th className="text-right p-2 font-medium text-xs">小计(¥)</th>
                    <th className="text-left p-2 font-medium text-xs">供应商</th>
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
                          <td className="p-2">{renderEditCell("partCategory", "text", "类别")}</td>
                          <td className="p-2">{renderEditCell("material", "text", "材质")}</td>
                          <td className="p-2">{renderEditCell("specification", "text", "规格")}</td>
                          <td className="p-2">{renderEditCell("partCategory", "text", "工艺")}</td>
                          <td className="p-2">{renderEditCell("quantity", "number")}</td>
                          <td className="p-2">{renderEditCell("unitCost", "text", "0.00")}</td>
                          <td className="p-2 text-right text-xs">
                            ¥{((parseFloat(editRow.unitCost || "0")) * (editRow.quantity || 1)).toFixed(2)}
                          </td>
                          <td className="p-2">{renderSupplierSelect()}</td>
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
                      <tr key={item.id} className="border-b last:border-0 hover:bg-muted/20 cursor-pointer"
                        onDoubleClick={() => !isLocked && handleStartEdit(item)}>
                        <td className="p-2 text-center text-xs text-muted-foreground">{idx + 1}</td>
                        <td className="p-2 font-medium text-xs">{item.partName}</td>
                        <td className="p-2 text-xs text-muted-foreground">{item.process || "-"}</td>
                        <td className="p-2 text-xs text-muted-foreground">{item.material || "-"}</td>
                        <td className="p-2 text-xs text-muted-foreground">{item.specification || "-"}</td>
                        <td className="p-2 text-xs text-muted-foreground">{item.process || "-"}</td>
                        <td className="p-2 text-right text-xs">{qty}</td>
                        <td className="p-2 text-right text-xs">{price > 0 ? `¥${price.toFixed(2)}` : "-"}</td>
                        <td className="p-2 text-right text-xs font-medium">{subtotal > 0 ? `¥${subtotal.toFixed(2)}` : "-"}</td>
                        <td className="p-2 text-xs text-muted-foreground">-</td>
                        <td className="p-2 text-xs text-muted-foreground">{item.remark || "-"}</td>
                        <td className="p-2">
                          {!isLocked && (
                            <div className="flex gap-1 justify-center">
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
                      <td className="p-2">{renderEditCell("partCategory", "text", "类别")}</td>
                      <td className="p-2">{renderEditCell("material", "text", "材质")}</td>
                      <td className="p-2">{renderEditCell("specification", "text", "规格")}</td>
                      <td className="p-2">{renderEditCell("partCategory", "text", "工艺")}</td>
                      <td className="p-2">{renderEditCell("quantity", "number")}</td>
                      <td className="p-2">{renderEditCell("unitCost", "text", "0.00")}</td>
                      <td className="p-2 text-right text-xs">
                        ¥{((parseFloat(editRow.unitCost || "0")) * (editRow.quantity || 1)).toFixed(2)}
                      </td>
                      <td className="p-2">{renderSupplierSelect()}</td>
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
                      <td colSpan={8} className="p-2 text-right text-xs">材料合计</td>
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
            <p className="text-sm">暂无BOM数据，点击"AI建议BOM"自动生成</p>
            <p className="text-xs mt-1">生成后可行内编辑每个部件的材质、价格、供应商等信息</p>
          </CardContent>
        </Card>
      )}

      {/* Tip */}
      {items.length > 0 && !isLocked && (
        <p className="text-xs text-muted-foreground text-center">
          提示：双击表格行可快速进入编辑模式 · 编辑完成后点击"确认锁定"锁定BOM
        </p>
      )}
    </div>
  );
}
