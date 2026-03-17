import { useState, useMemo, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Package, Loader2, Plus, Trash2, Save, Edit2, X,
  Wrench, RefreshCw, ArrowDown, Building2, Star,
  ChevronRight, ChevronDown, Clock, DollarSign,
  Layers, Factory, Hammer, CalendarDays, BarChart3,
  Sparkles, Search, AlertTriangle, TrendingUp,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface BomEditorProps {
  projectId: number;
  isLocked?: boolean;
}

interface EditingRow {
  id?: number;
  partName: string;
  partCategory: string;
  material: string;
  specification: string;
  quantity: number;
  unitCost: string;
  supplier: string;
  supplierGlobalId: number | null;
  supplierName: string;
  notes: string;
  parentId: number | null;
  level: number;
  isNew?: boolean;
}

const LEVEL_LABELS = ["主件", "子件", "原材料"];
const LEVEL_COLORS = [
  "bg-blue-50 border-blue-200 text-blue-700",
  "bg-amber-50 border-amber-200 text-amber-700",
  "bg-gray-50 border-gray-200 text-gray-600",
];
const PROCESS_OPTIONS = ["注塑", "冲压", "CNC", "SMT", "压铸", "挤出", "吹塑", "激光切割", "3D打印", "手工组装", "其他"];
const GANTT_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#8b5cf6", "#ef4444", "#06b6d4", "#ec4899"];

function emptyRow(parentId: number | null = null, level = 0): EditingRow {
  return { partName: "", partCategory: "", material: "", specification: "", quantity: 1, unitCost: "", supplier: "", supplierGlobalId: null, supplierName: "", notes: "", parentId, level, isNew: true };
}

export default function BomEditor({ projectId, isLocked = false }: BomEditorProps) {
  const utils = trpc.useUtils();
  const { data: bomItems, isLoading } = trpc.devBom.list.useQuery({ projectId }) as any;
  const { data: moldCostsRaw } = trpc.devBom.getBomCostSummary.useQuery({ projectId }) as any;
  const { data: globalSuppliers } = trpc.devGlobalSupplier.list.useQuery() as any;
  const [activeTab, setActiveTab] = useState("bom");
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [editRow, setEditRow] = useState<EditingRow | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [supplierSearch, setSupplierSearch] = useState("");
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
  const supplierRef = useRef<HTMLDivElement>(null);

  // Mutations
  const aiSuggestMut = trpc.devBom.aiSuggest.useMutation({
    onSuccess: () => { toast.success("AI建议生成完成，请查看各Tab"); utils.devBom.list.invalidate({ projectId }); utils.devBom.getBomCostSummary.invalidate({ projectId }); },
    onError: (e: any) => toast.error(`生成失败: ${e.message}`),
  });
  const addMut = trpc.devBom.add.useMutation({
    onSuccess: () => { toast.success("已添加"); setEditingId(null); setEditRow(null); utils.devBom.list.invalidate({ projectId }); utils.devBom.getBomCostSummary.invalidate({ projectId }); },
    onError: (e: any) => toast.error(e.message),
  });
  const updateMut = trpc.devBom.update.useMutation({
    onSuccess: () => { toast.success("已更新"); setEditingId(null); setEditRow(null); utils.devBom.list.invalidate({ projectId }); utils.devBom.getBomCostSummary.invalidate({ projectId }); },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteMut = trpc.devBom.delete.useMutation({
    onSuccess: () => { toast.success("已删除"); utils.devBom.list.invalidate({ projectId }); utils.devBom.getBomCostSummary.invalidate({ projectId }); },
    onError: (e: any) => toast.error(e.message),
  });

  // Build tree
  const tree = useMemo(() => {
    if (!bomItems) return [];
    const items = [...bomItems].sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const map = new Map<number, any>();
    const roots: any[] = [];
    for (const item of items) {
      map.set(item.id, { ...item, children: [] });
    }
    for (const item of items) {
      const node = map.get(item.id)!;
      if (item.parentId && map.has(item.parentId)) {
        map.get(item.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }, [bomItems]);

  // Close supplier dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (supplierRef.current && !supplierRef.current.contains(e.target as Node)) setShowSupplierDropdown(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggleExpand = (id: number) => {
    setExpandedIds(prev => {
      const arr = Array.from(prev);
      const idx = arr.indexOf(id);
      if (idx >= 0) arr.splice(idx, 1); else arr.push(id);
      return new Set(arr);
    });
  };

  const handleSave = () => {
    if (!editRow || !editRow.partName.trim()) { toast.error("请填写物料名称"); return; }
    if (editRow.isNew) {
      addMut.mutate({ projectId, partName: editRow.partName, partCategory: editRow.partCategory, material: editRow.material, specification: editRow.specification, quantity: editRow.quantity, unitCost: editRow.unitCost, notes: editRow.notes, supplierGlobalId: editRow.supplierGlobalId ?? undefined, supplierName: editRow.supplierName || undefined, parentId: editRow.parentId, level: editRow.level });
    } else if (editRow.id) {
      updateMut.mutate({ id: editRow.id, partName: editRow.partName, partCategory: editRow.partCategory, material: editRow.material, specification: editRow.specification, quantity: editRow.quantity, unitCost: editRow.unitCost, notes: editRow.notes, supplierGlobalId: editRow.supplierGlobalId ?? undefined, supplierName: editRow.supplierName || undefined, parentId: editRow.parentId, level: editRow.level });
    }
  };

  // Aliases for unified interaction pattern
  const handleSaveRow = handleSave;
  const handleStartNew = (parentId: number | null = null, level = 0) => { setEditingId("new"); setEditRow(emptyRow(parentId, level)); };
  const handleDelete = (id: number) => { if (confirm("确认删除此物料？子件也将被删除。")) deleteMut.mutate({ id }); };

  const filteredSuppliers = useMemo(() => {
    if (!globalSuppliers?.suppliers) return [];
    if (!supplierSearch) return globalSuppliers.suppliers.slice(0, 10);
    return globalSuppliers.suppliers.filter((s: any) => s.name.toLowerCase().includes(supplierSearch.toLowerCase())).slice(0, 10);
  }, [globalSuppliers, supplierSearch]);

  // Cost summary calculations
  const costSummary = useMemo(() => {
    if (!bomItems) return { materialTotal: 0, itemCount: 0 };
    let materialTotal = 0;
    for (const item of bomItems) {
      const price = parseFloat(item.unitPrice || "0");
      const qty = item.quantity || 1;
      materialTotal += price * qty;
    }
    return { materialTotal: Math.round(materialTotal * 100) / 100, itemCount: bomItems.length };
  }, [bomItems]);

  const moldTotal = moldCostsRaw?.totalMoldCost ?? 0;

  /* ─── Render BOM Tree Row ─── */
  function renderRow(node: any, depth = 0) {
    const isEditing = editingId === node.id;
    const hasChildren = node.children?.length > 0;
    const isExpanded = expandedIds.has(node.id);
    const level = node.level ?? 0;
    const subtotal = (parseFloat(node.unitPrice || "0") * (node.quantity || 1)).toFixed(2);

    return (
      <div key={node.id}>
        {isEditing && editRow ? (
          <div className="border rounded-lg p-3 bg-blue-50/50 mb-1">
            <div className="grid grid-cols-12 gap-2 text-xs">
              <div className="col-span-3">
                <label className="text-[10px] text-muted-foreground">物料名称</label>
                <input className="w-full border rounded px-2 py-1 text-xs" value={editRow.partName} onChange={e => setEditRow({ ...editRow, partName: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-muted-foreground">材质</label>
                <input className="w-full border rounded px-2 py-1 text-xs" value={editRow.material} onChange={e => setEditRow({ ...editRow, material: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-muted-foreground">工艺</label>
                <select className="w-full border rounded px-2 py-1 text-xs" value={editRow.partCategory} onChange={e => setEditRow({ ...editRow, partCategory: e.target.value })}>
                  <option value="">选择工艺</option>
                  {PROCESS_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-muted-foreground">规格尺寸</label>
                <input className="w-full border rounded px-2 py-1 text-xs" value={editRow.specification} onChange={e => setEditRow({ ...editRow, specification: e.target.value })} />
              </div>
              <div className="col-span-1">
                <label className="text-[10px] text-muted-foreground">用量</label>
                <input type="number" className="w-full border rounded px-2 py-1 text-xs" value={editRow.quantity} onChange={e => setEditRow({ ...editRow, quantity: parseInt(e.target.value) || 1 })} />
              </div>
              <div className="col-span-1">
                <label className="text-[10px] text-muted-foreground">单价(¥)</label>
                <input className="w-full border rounded px-2 py-1 text-xs" value={editRow.unitCost} onChange={e => setEditRow({ ...editRow, unitCost: e.target.value })} />
              </div>
              <div className="col-span-1 flex items-end gap-1">
                <Button size="sm" className="h-6 w-6 p-0" onClick={handleSave} disabled={addMut.isPending || updateMut.isPending}>
                  {(addMut.isPending || updateMut.isPending) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                </Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { setEditingId(null); setEditRow(null); }}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
            {/* Supplier selector row */}
            <div className="grid grid-cols-12 gap-2 text-xs mt-2">
              <div className="col-span-4 relative" ref={supplierRef}>
                <label className="text-[10px] text-muted-foreground">供应商(从供应商库选择)</label>
                <div className="flex gap-1">
                  <input className="flex-1 border rounded px-2 py-1 text-xs" placeholder="搜索供应商..." value={supplierSearch || editRow.supplierName} onChange={e => { setSupplierSearch(e.target.value); setShowSupplierDropdown(true); }} onFocus={() => setShowSupplierDropdown(true)} />
                  {editRow.supplierGlobalId && <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { setEditRow({ ...editRow, supplierGlobalId: null, supplierName: "" }); setSupplierSearch(""); }}><X className="h-3 w-3" /></Button>}
                </div>
                {showSupplierDropdown && filteredSuppliers.length > 0 && (
                  <div className="absolute z-50 top-full left-0 w-full bg-white border rounded-lg shadow-lg mt-1 max-h-40 overflow-y-auto">
                    {filteredSuppliers.map((s: any) => (
                      <div key={s.id} className="px-3 py-2 hover:bg-gray-50 cursor-pointer text-xs flex justify-between" onClick={() => { setEditRow({ ...editRow, supplierGlobalId: s.id, supplierName: s.name }); setSupplierSearch(""); setShowSupplierDropdown(false); }}>
                        <span className="font-medium">{s.name}</span>
                        {s.rating && <span className="text-amber-500">{s.rating}/10</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-muted-foreground">层级</label>
                <select className="w-full border rounded px-2 py-1 text-xs" value={editRow.level} onChange={e => setEditRow({ ...editRow, level: parseInt(e.target.value) })}>
                  {LEVEL_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
                </select>
              </div>
              <div className="col-span-6">
                <label className="text-[10px] text-muted-foreground">备注</label>
                <input className="w-full border rounded px-2 py-1 text-xs" value={editRow.notes} onChange={e => setEditRow({ ...editRow, notes: e.target.value })} />
              </div>
            </div>
          </div>
        ) : (
          <div className={`flex items-center gap-2 py-2 px-3 rounded hover:bg-gray-50 group text-xs border-b ${depth > 0 ? "border-l-2 border-l-gray-200 ml-" + (depth * 6) : ""}`} style={{ marginLeft: depth * 24 }}>
            {/* Expand toggle */}
            <div className="w-4 flex-shrink-0">
              {hasChildren ? (
                <button onClick={() => toggleExpand(node.id)} className="text-gray-400 hover:text-gray-600">
                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
              ) : <span className="w-3.5" />}
            </div>
            {/* Level badge */}
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${LEVEL_COLORS[level] || LEVEL_COLORS[0]}`}>
              {LEVEL_LABELS[level] || "L" + level}
            </Badge>
            {/* Part name */}
            <span className="font-medium w-32 truncate">{node.partName}</span>
            <span className="text-muted-foreground w-20 truncate">{node.material || "-"}</span>
            <span className="text-muted-foreground w-16 truncate">{node.process || "-"}</span>
            <span className="text-muted-foreground w-24 truncate">{node.specification || "-"}</span>
            <span className="w-10 text-center">{node.quantity || 1}</span>
            <span className="w-16 text-right">¥{node.unitPrice || "0"}</span>
            <span className="w-16 text-right font-medium text-blue-600">¥{subtotal}</span>
            {node.supplierName && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-green-50 text-green-700 border-green-200">
                <Building2 className="h-2.5 w-2.5 mr-0.5" />{node.supplierName}
              </Badge>
            )}
            {/* Actions */}
            {!isLocked && (
              <div className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { setEditingId(node.id); setEditRow({ id: node.id, partName: node.partName, partCategory: node.process || "", material: node.material || "", specification: node.specification || "", quantity: node.quantity || 1, unitCost: node.unitPrice || "", supplier: "", supplierGlobalId: node.supplierGlobalId, supplierName: node.supplierName || "", notes: node.remark || "", parentId: node.parentId, level: node.level ?? 0 }); }}>
                  <Edit2 className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-blue-500" onClick={() => { setEditingId("new"); setEditRow(emptyRow(node.id, (node.level ?? 0) + 1)); setExpandedIds(prev => { const arr = Array.from(prev); arr.push(node.id); return new Set(arr); }); }} title="添加子件">
                  <Plus className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-500" onClick={() => { if (confirm("确认删除此物料？子件也将被删除。")) deleteMut.mutate({ id: node.id }); }}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        )}
        {/* Children */}
        {hasChildren && isExpanded && node.children.map((child: any) => renderRow(child, depth + 1))}
      </div>
    );
  }

  /* ─── Mold Costs Tab ─── */
  function MoldTab() {
    const { data: moldCosts } = trpc.devBom.getBomCostSummary.useQuery({ projectId });
    // We show the mold costs from the summary
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Hammer className="h-4 w-4 text-orange-500" />
            模具费用管理
          </CardTitle>
        </CardHeader>
        <CardContent>
          {moldCosts?.moldCount === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <Hammer className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>暂无模具费用记录</p>
              <p className="text-xs mt-1">使用"AI智能推荐"可自动生成模具方案</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-7 gap-2 text-[10px] font-medium text-muted-foreground px-3 py-1 bg-gray-50 rounded">
                <span>零部件</span><span>模具类型</span><span>模具材质</span><span>穴数</span><span>预估费用</span><span>开模周期</span><span>备注</span>
              </div>
              <p className="text-xs text-muted-foreground text-center py-4">模具数据将通过AI推荐或手动录入</p>
              <div className="flex justify-between items-center pt-3 border-t">
                <span className="text-sm font-medium">模具总费用</span>
                <span className="text-lg font-bold text-orange-600">¥{moldTotal.toLocaleString()}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  /* ─── Timeline / Gantt Tab ─── */
  function TimelineTab() {
    const { data: timePlans } = trpc.devBom.getBomCostSummary.useQuery({ projectId });
    // Simple Gantt-like visualization
    const phases = [
      { name: "产品设计确认", days: 7, offset: 0, color: GANTT_COLORS[0] },
      { name: "打样", days: 15, offset: 7, color: GANTT_COLORS[1] },
      { name: "模具开发", days: 30, offset: 22, color: GANTT_COLORS[2] },
      { name: "试模调试", days: 10, offset: 52, color: GANTT_COLORS[3] },
      { name: "首批量产", days: 15, offset: 62, color: GANTT_COLORS[4] },
      { name: "质检验收", days: 5, offset: 77, color: GANTT_COLORS[5] },
    ];
    const totalDays = Math.max(...phases.map(p => p.offset + p.days));

    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-purple-500" />
            时间规划（甘特图）
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {/* Header */}
            <div className="flex items-center text-[10px] text-muted-foreground mb-2">
              <div className="w-28 flex-shrink-0">阶段</div>
              <div className="flex-1 flex justify-between">
                {Array.from({ length: Math.ceil(totalDays / 7) + 1 }, (_, i) => (
                  <span key={i}>W{i + 1}</span>
                ))}
              </div>
            </div>
            {/* Bars */}
            {phases.map((phase, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-28 flex-shrink-0 text-xs truncate">{phase.name}</div>
                <div className="flex-1 h-7 relative bg-gray-50 rounded">
                  <div
                    className="absolute h-full rounded flex items-center px-2 text-[10px] text-white font-medium"
                    style={{
                      left: `${(phase.offset / totalDays) * 100}%`,
                      width: `${(phase.days / totalDays) * 100}%`,
                      backgroundColor: phase.color,
                      minWidth: "30px",
                    }}
                  >
                    {phase.days}天
                  </div>
                </div>
              </div>
            ))}
            {/* Summary */}
            <div className="flex justify-between items-center pt-3 border-t mt-3">
              <span className="text-sm font-medium">总开发周期</span>
              <span className="text-lg font-bold text-purple-600">{totalDays} 天 (约{Math.ceil(totalDays / 7)}周)</span>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">* 时间规划为AI预估，实际周期请根据供应商反馈调整</p>
        </CardContent>
      </Card>
    );
  }

  /* ─── Cost Summary Tab ─── */
  function CostSummaryTab() {
    const packagingCost = (costSummary.materialTotal * 0.08); // estimate 8% for packaging
    const laborCost = (costSummary.materialTotal * 0.05); // estimate 5% for labor
    const totalUnit = costSummary.materialTotal + packagingCost + laborCost;

    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-green-500" />
            成本汇总
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="bg-blue-50 rounded-lg p-3 text-center">
              <p className="text-[10px] text-blue-600 mb-1">物料总成本</p>
              <p className="text-lg font-bold text-blue-700">¥{costSummary.materialTotal.toFixed(2)}</p>
              <p className="text-[10px] text-blue-500">{costSummary.itemCount}项物料</p>
            </div>
            <div className="bg-orange-50 rounded-lg p-3 text-center">
              <p className="text-[10px] text-orange-600 mb-1">模具总费用</p>
              <p className="text-lg font-bold text-orange-700">¥{moldTotal.toLocaleString()}</p>
              <p className="text-[10px] text-orange-500">{moldCostsRaw?.moldCount ?? 0}套模具</p>
            </div>
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <p className="text-[10px] text-green-600 mb-1">包装+人工</p>
              <p className="text-lg font-bold text-green-700">¥{(packagingCost + laborCost).toFixed(2)}</p>
              <p className="text-[10px] text-green-500">预估</p>
            </div>
            <div className="bg-purple-50 rounded-lg p-3 text-center">
              <p className="text-[10px] text-purple-600 mb-1">单件总成本</p>
              <p className="text-lg font-bold text-purple-700">¥{totalUnit.toFixed(2)}</p>
              <p className="text-[10px] text-purple-500">不含模具分摊</p>
            </div>
          </div>
          {/* Mold amortization table */}
          <div className="border rounded-lg p-3">
            <h4 className="text-xs font-medium mb-2 flex items-center gap-1">
              <BarChart3 className="h-3.5 w-3.5" />
              模具分摊成本（按不同订单量）
            </h4>
            <div className="grid grid-cols-5 gap-2 text-xs">
              {[500, 1000, 3000, 5000, 10000].map(qty => {
                const moldPerUnit = moldTotal > 0 ? moldTotal / qty : 0;
                const totalWithMold = totalUnit + moldPerUnit;
                return (
                  <div key={qty} className="text-center border rounded p-2">
                    <p className="text-[10px] text-muted-foreground">{qty.toLocaleString()}件</p>
                    <p className="font-medium">¥{moldPerUnit.toFixed(2)}</p>
                    <p className="text-[10px] text-muted-foreground">总: ¥{totalWithMold.toFixed(2)}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  /* ─── Supplier Recommendation Tab ─── */
  function SupplierRecommendTab() {
    const [recommendations, setRecommendations] = useState<any>(null);
    const aiSupplierMut = trpc.devBom.aiSupplierRecommend.useMutation({
      onSuccess: (data: any) => { setRecommendations(data); toast.success("供应商推荐生成完成"); },
      onError: (e: any) => toast.error(`推荐失败: ${e.message}`),
    });

    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Factory className="h-4 w-4 text-teal-500" />
              AI供应商推荐
            </CardTitle>
            <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => aiSupplierMut.mutate({ projectId })} disabled={aiSupplierMut.isPending || isLocked}>
              {aiSupplierMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {aiSupplierMut.isPending ? "分析中..." : "AI推荐供应商"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!recommendations ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <Factory className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>点击"AI推荐供应商"按钮</p>
              <p className="text-xs mt-1">AI将根据BOM中的材质和工艺，推荐匹配的供应商类型</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recommendations.recommendations?.map((rec: any, i: number) => (
                <div key={i} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium flex items-center gap-1">
                      <Building2 className="h-3.5 w-3.5 text-teal-500" />
                      {rec.supplierType}
                    </h4>
                    <div className="flex items-center gap-1">
                      <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
                      <span className="text-xs font-medium">{rec.overallScore}/10</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">匹配部件: {rec.matchedParts}</p>
                  <div className="grid grid-cols-5 gap-2 text-[10px]">
                    <div className="bg-gray-50 rounded p-1.5">
                      <p className="text-muted-foreground">工厂规模</p>
                      <p className="font-medium">{rec.factoryScale}</p>
                    </div>
                    <div className="bg-gray-50 rounded p-1.5">
                      <p className="text-muted-foreground">质量标准</p>
                      <p className="font-medium">{rec.qualityStandard}</p>
                    </div>
                    <div className="bg-gray-50 rounded p-1.5">
                      <p className="text-muted-foreground">研发能力</p>
                      <p className="font-medium">{rec.rdCapability}</p>
                    </div>
                    <div className="bg-gray-50 rounded p-1.5">
                      <p className="text-muted-foreground">交期表现</p>
                      <p className="font-medium">{rec.deliveryPerformance}</p>
                    </div>
                    <div className="bg-gray-50 rounded p-1.5">
                      <p className="text-muted-foreground">价格区间</p>
                      <p className="font-medium">{rec.priceRange}</p>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2">搜索关键词: {rec.searchKeywords}</p>
                </div>
              ))}
              {recommendations.summary && (
                <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 text-xs text-teal-700">
                  <p className="font-medium mb-1">综合建议</p>
                  <p>{recommendations.summary}</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  /* ─── Main Render ─── */
  if (isLoading) {
    return (
      <Card><CardContent className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with AI button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-blue-500" />
          <h3 className="text-base font-semibold">BOM物料清单</h3>
          <Badge variant="outline" className="text-[10px]">{costSummary.itemCount}项物料</Badge>
        </div>
        <div className="flex gap-2">
          {!isLocked && (
            <>
              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => { setEditingId("new"); setEditRow(emptyRow()); }}>
                <Plus className="h-3 w-3" /> 添加物料
              </Button>
              <Button size="sm" className="h-7 gap-1 text-xs bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600" onClick={() => aiSuggestMut.mutate({ projectId })} disabled={aiSuggestMut.isPending}>
                {aiSuggestMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {aiSuggestMut.isPending ? "AI分析中..." : "AI智能推荐BOM"}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Sub-tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-5 w-full">
          <TabsTrigger value="bom" className="text-xs gap-1">
            <Layers className="h-3 w-3" /> 物料清单
          </TabsTrigger>
          <TabsTrigger value="mold" className="text-xs gap-1">
            <Hammer className="h-3 w-3" /> 模具费用
          </TabsTrigger>
          <TabsTrigger value="timeline" className="text-xs gap-1">
            <CalendarDays className="h-3 w-3" /> 时间规划
          </TabsTrigger>
          <TabsTrigger value="cost" className="text-xs gap-1">
            <DollarSign className="h-3 w-3" /> 成本汇总
          </TabsTrigger>
          <TabsTrigger value="supplier" className="text-xs gap-1">
            <Factory className="h-3 w-3" /> 供应商推荐
          </TabsTrigger>
        </TabsList>

        <TabsContent value="bom" className="mt-3">
          <Card>
            <CardContent className="pt-4">
              {/* New item form */}
              {editingId === "new" && editRow && (
                <div className="border rounded-lg p-3 bg-blue-50/50 mb-3">
                  <div className="grid grid-cols-12 gap-2 text-xs">
                    <div className="col-span-3">
                      <label className="text-[10px] text-muted-foreground">物料名称 *</label>
                      <input className="w-full border rounded px-2 py-1 text-xs" value={editRow.partName} onChange={e => setEditRow({ ...editRow, partName: e.target.value })} />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] text-muted-foreground">材质</label>
                      <input className="w-full border rounded px-2 py-1 text-xs" value={editRow.material} onChange={e => setEditRow({ ...editRow, material: e.target.value })} />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] text-muted-foreground">工艺</label>
                      <select className="w-full border rounded px-2 py-1 text-xs" value={editRow.partCategory} onChange={e => setEditRow({ ...editRow, partCategory: e.target.value })}>
                        <option value="">选择工艺</option>
                        {PROCESS_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] text-muted-foreground">规格</label>
                      <input className="w-full border rounded px-2 py-1 text-xs" value={editRow.specification} onChange={e => setEditRow({ ...editRow, specification: e.target.value })} />
                    </div>
                    <div className="col-span-1">
                      <label className="text-[10px] text-muted-foreground">用量</label>
                      <input type="number" className="w-full border rounded px-2 py-1 text-xs" value={editRow.quantity} onChange={e => setEditRow({ ...editRow, quantity: parseInt(e.target.value) || 1 })} />
                    </div>
                    <div className="col-span-1">
                      <label className="text-[10px] text-muted-foreground">单价¥</label>
                      <input className="w-full border rounded px-2 py-1 text-xs" value={editRow.unitCost} onChange={e => setEditRow({ ...editRow, unitCost: e.target.value })} />
                    </div>
                    <div className="col-span-1 flex items-end gap-1">
                      <Button size="sm" className="h-6 w-6 p-0" onClick={handleSave} disabled={addMut.isPending}>
                        {addMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { setEditingId(null); setEditRow(null); }}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-12 gap-2 text-xs mt-2">
                    <div className="col-span-2">
                      <label className="text-[10px] text-muted-foreground">层级</label>
                      <select className="w-full border rounded px-2 py-1 text-xs" value={editRow.level} onChange={e => setEditRow({ ...editRow, level: parseInt(e.target.value) })}>
                        {LEVEL_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
                      </select>
                    </div>
                    <div className="col-span-4 relative" ref={supplierRef}>
                      <label className="text-[10px] text-muted-foreground">供应商</label>
                      <input className="w-full border rounded px-2 py-1 text-xs" placeholder="搜索供应商..." value={supplierSearch || editRow.supplierName} onChange={e => { setSupplierSearch(e.target.value); setShowSupplierDropdown(true); }} onFocus={() => setShowSupplierDropdown(true)} />
                      {showSupplierDropdown && filteredSuppliers.length > 0 && (
                        <div className="absolute z-50 top-full left-0 w-full bg-white border rounded-lg shadow-lg mt-1 max-h-40 overflow-y-auto">
                          {filteredSuppliers.map((s: any) => (
                            <div key={s.id} className="px-3 py-2 hover:bg-gray-50 cursor-pointer text-xs" onClick={() => { setEditRow({ ...editRow, supplierGlobalId: s.id, supplierName: s.name }); setSupplierSearch(""); setShowSupplierDropdown(false); }}>
                              {s.name}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="col-span-6">
                      <label className="text-[10px] text-muted-foreground">备注</label>
                      <input className="w-full border rounded px-2 py-1 text-xs" value={editRow.notes} onChange={e => setEditRow({ ...editRow, notes: e.target.value })} />
                    </div>
                  </div>
                </div>
              )}

              {/* Tree header */}
              <div className="flex items-center gap-2 py-2 px-3 text-[10px] font-medium text-muted-foreground bg-gray-50 rounded mb-1">
                <span className="w-4" />
                <span className="w-12">层级</span>
                <span className="w-32">物料名称</span>
                <span className="w-20">材质</span>
                <span className="w-16">工艺</span>
                <span className="w-24">规格</span>
                <span className="w-10 text-center">用量</span>
                <span className="w-16 text-right">单价</span>
                <span className="w-16 text-right">小计</span>
                <span className="ml-auto">供应商</span>
              </div>

              {/* Tree content */}
              {tree.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p>暂无BOM物料</p>
                  <p className="text-xs mt-1">点击"添加物料"或"AI智能推荐"开始</p>
                </div>
              ) : (
                <div className="space-y-0">
                  {tree.map(node => renderRow(node))}
                </div>
              )}

              {/* Bottom summary */}
              {tree.length > 0 && (
                <div className="flex justify-between items-center pt-3 mt-3 border-t">
                  <span className="text-sm text-muted-foreground">{costSummary.itemCount}项物料</span>
                  <span className="text-sm font-bold">物料总成本: <span className="text-blue-600">¥{costSummary.materialTotal.toFixed(2)}</span></span>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mold" className="mt-3"><MoldTab /></TabsContent>
        <TabsContent value="timeline" className="mt-3"><TimelineTab /></TabsContent>
        <TabsContent value="cost" className="mt-3"><CostSummaryTab /></TabsContent>
        <TabsContent value="supplier" className="mt-3"><SupplierRecommendTab /></TabsContent>
      </Tabs>
    </div>
  );
}
