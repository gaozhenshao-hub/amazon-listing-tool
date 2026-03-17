import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Loader2, Save, Lock, Unlock, Plus, Trash2, Download, CheckCircle2, XCircle, Clock,
  ChevronDown, ChevronUp,
} from "lucide-react";

interface TestItem {
  category: string;
  nameEn: string;
  nameCn: string;
  descEn?: string;
  descCn?: string;
  requirement?: string;
  passStandard: string;
  testMethod?: string;
  testStatus: "pass" | "fail" | "pending";
  actualResult: string;
  notes: string;
}

const CATEGORIES = [
  { key: "installation", label: "安装测试" },
  { key: "usage", label: "使用测试" },
  { key: "drop", label: "跌落测试" },
  { key: "shipping", label: "运输测试" },
  { key: "function", label: "功能测试" },
  { key: "durability", label: "耐久性测试" },
  { key: "safety", label: "安全测试" },
  { key: "packaging", label: "包装测试" },
];

const statusConfig = {
  pass: { label: "通过", icon: CheckCircle2, color: "bg-emerald-100 text-emerald-700", dotColor: "bg-emerald-500" },
  fail: { label: "未通过", icon: XCircle, color: "bg-red-100 text-red-700", dotColor: "bg-red-500" },
  pending: { label: "待测", icon: Clock, color: "bg-gray-100 text-gray-600", dotColor: "bg-gray-400" },
};

export default function TestReportEditor({ testReport, projectId }: { testReport: any; projectId: number }) {
  const utils = trpc.useUtils();

  // Parse test items from report
  const initialItems = useMemo(() => {
    if (!testReport?.testItems) return [];
    try {
      return JSON.parse(testReport.testItems) as TestItem[];
    } catch {
      return [];
    }
  }, [testReport?.testItems]);

  const [items, setItems] = useState<TestItem[]>(initialItems);
  const [isLocked, setIsLocked] = useState(testReport?.status === "confirmed");
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set(CATEGORIES.map(c => c.key)));
  const [editingCell, setEditingCell] = useState<{ idx: number; field: string } | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const saveMutation = trpc.devManual.saveTestReport.useMutation({
    onSuccess: () => {
      toast.success("测试报告已保存");
      setHasChanges(false);
      utils.devManual.getTestReport.invalidate({ projectId });
    },
    onError: (err: any) => toast.error(`保存失败: ${err.message}`),
  });

  const updateField = (globalIdx: number, field: keyof TestItem, value: string) => {
    if (isLocked) return;
    setItems(prev => {
      const next = [...prev];
      next[globalIdx] = { ...next[globalIdx], [field]: value };
      return next;
    });
    setHasChanges(true);
  };

  const addTestItem = (category: string) => {
    if (isLocked) return;
    const newItem: TestItem = {
      category,
      nameEn: "",
      nameCn: "",
      passStandard: "",
      testMethod: "",
      testStatus: "pending",
      actualResult: "",
      notes: "",
    };
    setItems(prev => [...prev, newItem]);
    setHasChanges(true);
    toast.success("已添加新测试项");
  };

  const deleteTestItem = (globalIdx: number) => {
    if (isLocked) return;
    setItems(prev => prev.filter((_, i) => i !== globalIdx));
    setHasChanges(true);
    toast.success("已删除测试项");
  };

  const handleSave = (status?: "draft" | "editing" | "confirmed") => {
    saveMutation.mutate({
      projectId,
      testItems: JSON.stringify(items),
      status: status || (isLocked ? "confirmed" : "editing"),
    });
    if (status === "confirmed") setIsLocked(true);
    if (status === "editing" || status === "draft") setIsLocked(false);
  };

  const handleConfirmLock = () => {
    handleSave("confirmed");
    toast.success("测试报告已确认锁定");
  };

  const handleUnlock = () => {
    handleSave("editing");
    toast.success("测试报告已解锁");
  };

  const toggleCategory = (cat: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  // Stats
  const stats = useMemo(() => ({
    total: items.length,
    pass: items.filter(i => i.testStatus === "pass").length,
    fail: items.filter(i => i.testStatus === "fail").length,
    pending: items.filter(i => i.testStatus === "pending").length,
  }), [items]);

  // Export CSV
  const handleExportCsv = () => {
    const headers = ["类别", "测试项(EN)", "测试项(CN)", "通过标准", "测试方法", "状态", "实际结果", "备注"];
    const statusLabels: Record<string, string> = { pass: "通过", fail: "未通过", pending: "待测" };
    const rows = items.map(item => [
      CATEGORIES.find(c => c.key === item.category)?.label || item.category,
      item.nameEn, item.nameCn, item.passStandard, item.testMethod || "",
      statusLabels[item.testStatus] || item.testStatus,
      item.actualResult, item.notes,
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.map(c => `"${(c || "").replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `test-report-${projectId}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success("测试报告已导出CSV");
  };

  // Editable cell component
  const EditableCell = ({ value, globalIdx, field, placeholder, className = "" }: {
    value: string; globalIdx: number; field: keyof TestItem; placeholder?: string; className?: string;
  }) => {
    const isEditing = editingCell?.idx === globalIdx && editingCell?.field === field;
    if (isLocked) {
      return <span className={`text-xs ${className}`}>{value || "—"}</span>;
    }
    if (isEditing) {
      return (
        <input
          autoFocus
          className={`text-xs w-full px-1.5 py-1 border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary/30 ${className}`}
          value={value}
          onChange={(e) => updateField(globalIdx, field, e.target.value)}
          onBlur={() => setEditingCell(null)}
          onKeyDown={(e) => { if (e.key === "Enter") setEditingCell(null); }}
          placeholder={placeholder}
        />
      );
    }
    return (
      <span
        className={`text-xs cursor-pointer hover:bg-muted/50 px-1.5 py-1 rounded inline-block min-w-[60px] ${!value ? "text-muted-foreground italic" : ""} ${className}`}
        onClick={() => setEditingCell({ idx: globalIdx, field })}
      >
        {value || placeholder || "点击编辑"}
      </span>
    );
  };

  if (items.length === 0 && !testReport) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Clock className="h-8 w-8 mb-2 opacity-30" />
        <p className="text-sm">请先生成测试报告</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header: Stats + Actions */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-sm">测试报告</h3>
          {isLocked && <Badge className="bg-emerald-100 text-emerald-700 text-xs gap-1"><Lock className="h-3 w-3" />已确认锁定</Badge>}
          {hasChanges && !isLocked && <Badge className="bg-amber-100 text-amber-700 text-xs">有未保存的修改</Badge>}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleExportCsv} className="gap-1 text-xs">
            <Download className="h-3 w-3" />导出CSV
          </Button>
          {!isLocked && (
            <>
              <Button size="sm" variant="outline" onClick={() => handleSave()} disabled={saveMutation.isPending || !hasChanges} className="gap-1 text-xs">
                {saveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                保存
              </Button>
              <Button size="sm" className="gap-1 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={handleConfirmLock} disabled={saveMutation.isPending}>
                <Lock className="h-3 w-3" />确认锁定
              </Button>
            </>
          )}
          {isLocked && (
            <Button size="sm" variant="outline" onClick={handleUnlock} disabled={saveMutation.isPending} className="gap-1 text-xs">
              <Unlock className="h-3 w-3" />解锁编辑
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-3">
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">总测试项</p><p className="text-xl font-bold">{stats.total}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-emerald-600">通过</p><p className="text-xl font-bold text-emerald-600">{stats.pass}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-red-600">未通过</p><p className="text-xl font-bold text-red-600">{stats.fail}</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-xs text-gray-500">待测</p><p className="text-xl font-bold text-gray-500">{stats.pending}</p></CardContent></Card>
      </div>

      {/* Test Items by Category */}
      {CATEGORIES.map(cat => {
        const catItems = items.map((item, idx) => ({ item, globalIdx: idx })).filter(({ item }) => item.category === cat.key);
        if (catItems.length === 0 && isLocked) return null;
        const isExpanded = expandedCats.has(cat.key);
        const catStats = {
          pass: catItems.filter(({ item }) => item.testStatus === "pass").length,
          fail: catItems.filter(({ item }) => item.testStatus === "fail").length,
          pending: catItems.filter(({ item }) => item.testStatus === "pending").length,
        };

        return (
          <Card key={cat.key}>
            <CardHeader className="pb-2 cursor-pointer" onClick={() => toggleCategory(cat.key)}>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  {cat.label}
                  <Badge variant="outline" className="text-xs">{catItems.length}项</Badge>
                  {catStats.pass > 0 && <span className="flex items-center gap-0.5 text-xs text-emerald-600"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />{catStats.pass}</span>}
                  {catStats.fail > 0 && <span className="flex items-center gap-0.5 text-xs text-red-600"><span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />{catStats.fail}</span>}
                  {catStats.pending > 0 && <span className="flex items-center gap-0.5 text-xs text-gray-500"><span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block" />{catStats.pending}</span>}
                </CardTitle>
                {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </div>
            </CardHeader>
            {isExpanded && (
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left p-2 pl-4 text-xs font-medium w-[180px]">测试项(EN)</th>
                        <th className="text-left p-2 text-xs font-medium w-[140px]">测试项(CN)</th>
                        <th className="text-left p-2 text-xs font-medium w-[160px]">通过标准</th>
                        <th className="text-left p-2 text-xs font-medium w-[140px]">测试方法</th>
                        <th className="text-center p-2 text-xs font-medium w-[80px]">状态</th>
                        <th className="text-left p-2 text-xs font-medium w-[160px]">实际结果</th>
                        <th className="text-left p-2 text-xs font-medium w-[140px]">备注</th>
                        {!isLocked && <th className="text-center p-2 text-xs font-medium w-[50px]">操作</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {catItems.map(({ item, globalIdx }) => (
                        <tr key={globalIdx} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="p-2 pl-4">
                            <EditableCell value={item.nameEn} globalIdx={globalIdx} field="nameEn" placeholder="Test name" />
                          </td>
                          <td className="p-2">
                            <EditableCell value={item.nameCn} globalIdx={globalIdx} field="nameCn" placeholder="测试名称" />
                          </td>
                          <td className="p-2">
                            <EditableCell value={item.passStandard} globalIdx={globalIdx} field="passStandard" placeholder="通过标准" />
                          </td>
                          <td className="p-2">
                            <EditableCell value={item.testMethod || ""} globalIdx={globalIdx} field="testMethod" placeholder="测试方法" />
                          </td>
                          <td className="p-2 text-center">
                            {isLocked ? (
                              <span className={`text-xs px-2 py-1 rounded-full ${statusConfig[item.testStatus]?.color || statusConfig.pending.color}`}>
                                {statusConfig[item.testStatus]?.label || "待测"}
                              </span>
                            ) : (
                              <select
                                className={`text-xs px-2 py-1 rounded-full border-0 cursor-pointer ${statusConfig[item.testStatus]?.color || statusConfig.pending.color}`}
                                value={item.testStatus || "pending"}
                                onChange={(e) => updateField(globalIdx, "testStatus", e.target.value)}
                              >
                                <option value="pending">待测</option>
                                <option value="pass">通过</option>
                                <option value="fail">未通过</option>
                              </select>
                            )}
                          </td>
                          <td className="p-2">
                            <EditableCell value={item.actualResult} globalIdx={globalIdx} field="actualResult" placeholder="填写实际结果" />
                          </td>
                          <td className="p-2">
                            <EditableCell value={item.notes} globalIdx={globalIdx} field="notes" placeholder="备注" />
                          </td>
                          {!isLocked && (
                            <td className="p-2 text-center">
                              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-500 hover:text-red-700" onClick={() => deleteTestItem(globalIdx)}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </td>
                          )}
                        </tr>
                      ))}
                      {/* Summary Row */}
                      <tr className="bg-muted/20 font-medium">
                        <td className="p-2 pl-4 text-xs" colSpan={4}>
                          <span className="font-semibold">{cat.label}小计</span>：{catItems.length}项
                        </td>
                        <td className="p-2 text-center text-xs">
                          {catStats.pass > 0 && <span className="text-emerald-600">{catStats.pass}通过</span>}
                          {catStats.fail > 0 && <span className="text-red-600 ml-1">{catStats.fail}未通过</span>}
                          {catStats.pending > 0 && <span className="text-gray-500 ml-1">{catStats.pending}待测</span>}
                        </td>
                        <td colSpan={isLocked ? 2 : 3}></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {/* Add new test item button */}
                {!isLocked && (
                  <div className="p-2 border-t">
                    <Button size="sm" variant="ghost" className="gap-1 text-xs text-primary w-full justify-center" onClick={() => addTestItem(cat.key)}>
                      <Plus className="h-3 w-3" />新增{cat.label}项
                    </Button>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
