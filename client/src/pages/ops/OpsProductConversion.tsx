import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, Trash2, Lock, Unlock, Loader2, Brain, ChevronDown, ChevronUp,
  Star, ArrowRight, Search, BarChart3, Sparkles, Download, CheckCircle, Filter,
  Eye, EyeOff, Pencil, RotateCcw, Settings2,
} from "lucide-react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip, Legend,
} from "recharts";

interface Props {
  productId: number;
  parentAsin: string;
}

const CATEGORY_COLORS: Record<number, string> = {
  1: "bg-blue-50 border-blue-200", 2: "bg-indigo-50 border-indigo-200",
  3: "bg-violet-50 border-violet-200", 4: "bg-purple-50 border-purple-200",
  5: "bg-pink-50 border-pink-200", 6: "bg-rose-50 border-rose-200",
  7: "bg-orange-50 border-orange-200", 8: "bg-amber-50 border-amber-200",
  9: "bg-yellow-50 border-yellow-200", 10: "bg-lime-50 border-lime-200",
  11: "bg-emerald-50 border-emerald-200", 12: "bg-teal-50 border-teal-200",
  13: "bg-cyan-50 border-cyan-200", 14: "bg-sky-50 border-sky-200",
  15: "bg-blue-50 border-blue-300", 16: "bg-indigo-50 border-indigo-300",
  17: "bg-violet-50 border-violet-300", 18: "bg-rose-50 border-rose-300",
  19: "bg-amber-50 border-amber-300", 20: "bg-emerald-50 border-emerald-300",
};

export default function OpsProductConversion({ productId, parentAsin }: Props) {
  // ─── Management State (must be before queries that depend on them) ───
  const [manageMode, setManageMode] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [editItemDialog, setEditItemDialog] = useState<{ id: number; subDimension: string; standard: string; isCustom: boolean; hasOverride: boolean } | null>(null);

  // ─── Queries ───
  const { data: comparisons, refetch: refetchComparisons, isLoading } = trpc.productOps.listComparisons.useQuery(
    { productProfileId: productId }
  );

  const [selectedCompId, setSelectedCompId] = useState<number | null>(null);
  const activeComp = comparisons?.find((c: any) => c.id === selectedCompId) || comparisons?.[0];
  const activeCompId = activeComp?.id;

  const { data: checkItems, refetch: refetchItems } = trpc.productOps.getCheckItems.useQuery(
    { includeHidden: showHidden || manageMode }
  );
  const { data: scores, refetch: refetchScores } = trpc.productOps.getScores.useQuery(
    { comparisonId: activeCompId! }, { enabled: !!activeCompId }
  );
  const { data: suggestions, refetch: refetchSuggestions } = trpc.productOps.getSuggestions.useQuery(
    { comparisonId: activeCompId! }, { enabled: !!activeCompId }
  );

  // ─── Mutations ───
  const createComparison = trpc.productOps.createComparison.useMutation({
    onSuccess: (data) => {
      refetchComparisons();
      setSelectedCompId(data.id);
      setShowCreate(false);
      toast.success("转化率对比已创建");
    },
  });
  const deleteComparison = trpc.productOps.deleteComparison.useMutation({
    onSuccess: () => { refetchComparisons(); setSelectedCompId(null); toast.success("对比已删除"); },
  });
  const addCheckItem = trpc.productOps.addCustomCheckItem.useMutation({
    onSuccess: () => { refetchItems(); setShowAddItem(false); toast.success("检查项已添加"); },
  });
  const editCheckItemMut = trpc.productOps.editCheckItem.useMutation({
    onSuccess: () => { refetchItems(); setEditItemDialog(null); toast.success("检查项已更新"); },
  });
  const toggleHiddenMut = trpc.productOps.toggleCheckItemHidden.useMutation({
    onSuccess: (data) => { refetchItems(); toast.success(data.isHidden ? "检查项已隐藏" : "检查项已显示"); },
  });
  const resetOverrideMut = trpc.productOps.resetCheckItemOverride.useMutation({
    onSuccess: () => { refetchItems(); toast.success("已恢复默认设置"); },
  });
  const removeCheckItem = trpc.productOps.removeCustomCheckItem.useMutation({
    onSuccess: () => { refetchItems(); toast.success("自定义检查项已删除"); },
  });
  const updateScore = trpc.productOps.updateScore.useMutation({
    onSuccess: () => refetchScores(),
  });
  const aiScore = trpc.productOps.triggerAiScoring.useMutation({
    onSuccess: () => { refetchScores(); toast.success("AI评分完成"); },
  });
  const aiSuggest = trpc.productOps.generateSuggestions.useMutation({
    onSuccess: () => { refetchSuggestions(); toast.success("AI优化建议已生成"); },
  });
  const updateSuggestion = trpc.productOps.updateSuggestion.useMutation({
    onSuccess: () => refetchSuggestions(),
  });
  const syncToPlan = trpc.productOps.syncSuggestionsToPlan.useMutation({
    onSuccess: () => toast.success("优化建议已同步到运营计划"),
  });

  // ─── Local State ───
  const [showCreate, setShowCreate] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Record<number, boolean>>({});
  const [createForm, setCreateForm] = useState({
    comparisonName: "", ownAsin: parentAsin, competitorAsins: "",
  });
  const [addItemForm, setAddItemForm] = useState({
    categoryIndex: 1, categoryName: "", subDimension: "", standard: "",
  });
  const [editingScore, setEditingScore] = useState<Record<string, { score: number; note: string }>>({});
  const [editingSuggestion, setEditingSuggestion] = useState<Record<number, string>>({});
  const [aiScoringCategory, setAiScoringCategory] = useState<number | null>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());
  const [showSyncDialog, setShowSyncDialog] = useState(false);
  const [syncMode, setSyncMode] = useState<"locked_low_score" | "selected" | "all_locked">("locked_low_score");
  const [scoreThreshold, setScoreThreshold] = useState(3);

  // ─── Computed ───
  const groupedItems = useMemo(() => {
    if (!checkItems) return {};
    const groups: Record<number, { categoryName: string; items: typeof checkItems }> = {};
    for (const item of checkItems) {
      if (!groups[item.categoryIndex]) {
        groups[item.categoryIndex] = { categoryName: item.categoryName, items: [] };
      }
      groups[item.categoryIndex].items.push(item);
    }
    return groups;
  }, [checkItems]);

  const competitorList = useMemo(() => {
    if (!activeComp?.competitorAsins) return [];
    return activeComp.competitorAsins.split(",").map((a: string) => a.trim()).filter(Boolean);
  }, [activeComp]);

  const allAsins = useMemo(() => {
    if (!activeComp) return [];
    return [activeComp.ownAsin, ...competitorList];
  }, [activeComp, competitorList]);

  const scoreMap = useMemo(() => {
    if (!scores) return {};
    const map: Record<string, typeof scores[0]> = {};
    for (const s of scores) {
      map[`${s.checkItemId}_${s.asin}`] = s;
    }
    return map;
  }, [scores]);

  // Category average scores for radar chart
  const radarData = useMemo(() => {
    if (!checkItems || !scores) return [];
    const catScores: Record<number, Record<string, { total: number; count: number }>> = {};
    for (const item of checkItems) {
      if (!catScores[item.categoryIndex]) catScores[item.categoryIndex] = {};
      for (const asin of allAsins) {
        if (!catScores[item.categoryIndex][asin]) catScores[item.categoryIndex][asin] = { total: 0, count: 0 };
        const s = scoreMap[`${item.id}_${asin}`];
        if (s?.score) {
          catScores[item.categoryIndex][asin].total += s.score;
          catScores[item.categoryIndex][asin].count += 1;
        }
      }
    }
    return Object.entries(catScores).map(([catIdx, asinScores]) => {
      const catName = groupedItems[Number(catIdx)]?.categoryName || `维度${catIdx}`;
      const row: Record<string, string | number> = { category: catName };
      for (const asin of allAsins) {
        const d = asinScores[asin];
        row[asin] = d && d.count > 0 ? Math.round(d.total / d.count * 10) / 10 : 0;
      }
      return row;
    });
  }, [checkItems, scores, allAsins, scoreMap, groupedItems]);

  const toggleCategory = (catIdx: number) => {
    setExpandedCategories(prev => ({ ...prev, [catIdx]: !prev[catIdx] }));
  };

  const getScoreColor = (score: number) => {
    if (score >= 4) return "text-emerald-600 bg-emerald-50";
    if (score >= 3) return "text-yellow-600 bg-yellow-50";
    if (score >= 2) return "text-orange-600 bg-orange-50";
    return "text-red-600 bg-red-50";
  };

  const handleScoreChange = (checkItemId: number, asin: string, score: number, note?: string) => {
    const key = `${checkItemId}_${asin}`;
    const existing = scoreMap[key];
    setEditingScore(prev => ({
      ...prev,
      [key]: { score,note: note ?? prev[key]?.note ?? (existing?.reason || '') ?? ""},
    }));
  };

  const saveScore = (checkItemId: number, asin: string) => {
    const key = `${checkItemId}_${asin}`;
    const edit = editingScore[key];
    if (!edit) return;
    const existing = scoreMap[key];
    if (!existing) return;
    updateScore.mutate({
      scoreId: existing.id,
      score: edit.score,
      reason: edit.note || undefined,
    });
    setEditingScore(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const toggleScoreLock = (checkItemId: number, asin: string) => {
    const key = `${checkItemId}_${asin}`;
    const existing = scoreMap[key];
    if (existing) {
      updateScore.mutate({
        scoreId: existing.id,
        isLocked: !existing.isLocked,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-5 w-5 text-purple-600" />
          <h2 className="text-lg font-semibold">转化率对比</h2>
          {comparisons && comparisons.length > 0 && (
            <Select
              value={String(activeCompId || "")}
              onValueChange={v => setSelectedCompId(Number(v))}
            >
              <SelectTrigger className="w-[240px]">
                <SelectValue placeholder="选择对比" />
              </SelectTrigger>
              <SelectContent>
                {comparisons.map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.comparisonName || `对比 #${c.id}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => { setCreateForm(f => ({ ...f, ownAsin: parentAsin })); setShowCreate(true); }}>
            <Plus className="h-3 w-3 mr-1" /> 新建对比
          </Button>
          {activeComp && (
            <Button size="sm" variant="destructive" onClick={() => {
              if (confirm("确定删除此对比？")) deleteComparison.mutate({ comparisonId: activeComp.id });
            }}>
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {!activeComp ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">输入己品和竞品ASIN，开始132项转化率维度对比</p>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-2" /> 创建转化率对比
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ASIN Info */}
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-6 text-sm">
                <div>
                  <span className="text-muted-foreground">己品ASIN</span>
                  <p className="font-mono font-medium text-emerald-700">{activeComp.ownAsin}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">竞品ASIN</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    {competitorList.map((a: string, i: number) => (
                      <Badge key={i} variant="secondary" className="font-mono">{a}</Badge>
                    ))}
                  </div>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => {
                    if (!activeCompId) return;
                    aiScore.mutate({ comparisonId: activeCompId });
                  }} disabled={aiScore.isPending}>
                    {aiScore.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Brain className="h-3 w-3 mr-1" />}
                    AI全量评分
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => {
                    if (!activeCompId) return;
                    aiSuggest.mutate({ comparisonId: activeCompId });
                  }} disabled={aiSuggest.isPending}>
                    {aiSuggest.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
                    AI优化建议
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowSyncDialog(true)}
                    disabled={syncToPlan.isPending}>
                    <ArrowRight className="h-3 w-3 mr-1" />
                    同步到运营计划
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Radar Chart */}
          {radarData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">维度对比雷达图</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[350px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData}>
                      <PolarGrid />
                      <PolarAngleAxis dataKey="category" tick={{ fontSize: 11 }} />
                      <PolarRadiusAxis angle={30} domain={[0, 5]} tick={{ fontSize: 10 }} />
                      {allAsins.map((asin, i) => (
                        <Radar
                          key={asin}
                          name={i === 0 ? `己品 ${asin}` : `竞品 ${asin}`}
                          dataKey={asin}
                          stroke={i === 0 ? "#10b981" : i === 1 ? "#6366f1" : i === 2 ? "#f59e0b" : "#ef4444"}
                          fill={i === 0 ? "#10b981" : i === 1 ? "#6366f1" : i === 2 ? "#f59e0b" : "#ef4444"}
                          fillOpacity={0.15}
                        />
                      ))}
                      <Legend />
                      <Tooltip />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Check Items by Category */}
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <h3 className="font-semibold">检查项目（{checkItems?.filter((i: any) => !i.isHidden).length || 0}项）</h3>
                {checkItems?.some((i: any) => i.isHidden) && (
                  <Badge variant="secondary" className="text-xs">
                    {checkItems.filter((i: any) => i.isHidden).length}项已隐藏
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {manageMode && (
                  <Button size="sm" variant="outline" onClick={() => setShowHidden(!showHidden)} className={showHidden ? "border-amber-300 bg-amber-50 text-amber-700" : ""}>
                    {showHidden ? <Eye className="h-3 w-3 mr-1" /> : <EyeOff className="h-3 w-3 mr-1" />}
                    {showHidden ? "显示已隐藏项" : "显示已隐藏项"}
                  </Button>
                )}
                <Button size="sm" variant={manageMode ? "default" : "outline"} onClick={() => { setManageMode(!manageMode); if (!manageMode) setShowHidden(false); }}>
                  <Settings2 className="h-3 w-3 mr-1" /> {manageMode ? "退出管理" : "管理检查项"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowAddItem(true)}>
                  <Plus className="h-3 w-3 mr-1" /> 添加自定义维度
                </Button>
              </div>
            </div>

            {Object.entries(groupedItems).sort(([a], [b]) => Number(a) - Number(b)).map(([catIdx, group]) => {
              const catNum = Number(catIdx);
              const isExpanded = expandedCategories[catNum] !== false; // default expanded
              const catColor = CATEGORY_COLORS[catNum] || "bg-gray-50 border-gray-200";

              return (
                <Card key={catIdx} className={`border ${catColor}`}>
                  <CardHeader
                    className="pb-2 cursor-pointer"
                    onClick={() => toggleCategory(catNum)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Badge variant="secondary" className="text-xs">{catIdx}</Badge>
                        <CardTitle className="text-sm">{group.categoryName}</CardTitle>
                        <span className="text-xs text-muted-foreground">{group.items.length}项</span>
                      </div>
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                  </CardHeader>
                  {isExpanded && (
                    <CardContent className="pt-0">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              {manageMode && <TableHead className="w-[90px]">操作</TableHead>}
                              <TableHead className="w-[160px]">检查项</TableHead>
                              <TableHead className="w-[200px]">评分标准</TableHead>
                              {allAsins.map((asin, i) => (
                                <TableHead key={asin} className="w-[130px] text-center">
                                  {i === 0 ? (
                                    <span className="text-emerald-700">己品</span>
                                  ) : (
                                    <span className="text-indigo-700">竞品{i}</span>
                                  )}
                                  <br />
                                  <span className="text-xs font-mono">{asin.slice(0, 10)}</span>
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {group.items.map((item: any) => (
                              <TableRow key={item.id} className={item.isHidden ? "opacity-50 bg-muted/30" : ""}>
                                {manageMode && (
                                  <TableCell>
                                    <div className="flex items-center gap-0.5">
                                      <button
                                        onClick={() => setEditItemDialog({
                                          id: item.id,
                                          subDimension: item.subDimension || "",
                                          standard: item.standard || "",
                                          isCustom: item.isCustom === 1,
                                          hasOverride: item.hasOverride || false,
                                        })}
                                        className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
                                        title="编辑检查项"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        onClick={() => toggleHiddenMut.mutate({ checkItemId: item.id, isHidden: !item.isHidden })}
                                        className={`p-1 hover:bg-muted rounded ${item.isHidden ? "text-amber-600" : "text-muted-foreground hover:text-foreground"}`}
                                        title={item.isHidden ? "取消隐藏" : "隐藏检查项"}
                                      >
                                        {item.isHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                                      </button>
                                      {item.hasOverride && (
                                        <button
                                          onClick={() => resetOverrideMut.mutate({ checkItemId: item.id })}
                                          className="p-1 hover:bg-muted rounded text-blue-600"
                                          title="恢复默认设置"
                                        >
                                          <RotateCcw className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                      {item.isCustom === 1 && (
                                        <button
                                          onClick={() => removeCheckItem.mutate({ itemId: item.id })}
                                          className="p-1 hover:bg-muted rounded text-red-500 hover:text-red-700"
                                          title="删除自定义项"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </TableCell>
                                )}
                                <TableCell className="font-medium text-sm">
                                  <div className="flex items-center gap-1">
                                    {item.subDimension}
                                    {item.isCustom === 1 && <Badge variant="outline" className="text-[10px] px-1 py-0 border-blue-300 text-blue-600">自定义</Badge>}
                                    {item.hasOverride && !item.isHidden && <Badge variant="outline" className="text-[10px] px-1 py-0 border-amber-300 text-amber-600">已修改</Badge>}
                                    {item.isHidden && <Badge variant="outline" className="text-[10px] px-1 py-0 border-gray-400 text-gray-500">已隐藏</Badge>}
                                  </div>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">{item.standard || "—"}</TableCell>
                                {allAsins.map((asin) => {
                                  const key = `${item.id}_${asin}`;
                                  const existing = scoreMap[key];
                                  const editing = editingScore[key];
                                  const score = editing?.score ?? existing?.score ?? 0;
                                 const isLocked = existing?.isLocked === 1;
                                  return (
                                    <TableCell key={asin} className="text-center">
                                      <div className="flex items-center justify-center gap-1">
                                        {/* Score Stars */}
                                        <div className="flex items-center gap-0.5">
                                          {[1, 2, 3, 4, 5].map(s => (
                                            <button
                                              key={s}
                                              disabled={isLocked}
                                              onClick={() => handleScoreChange(item.id, asin, s)}
                                              className={`p-0 ${isLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:scale-110"} transition-transform`}
                                            >
                                              <Star
                                                className={`h-3.5 w-3.5 ${s <= score ? "fill-amber-400 text-amber-400" : "text-gray-300"}`}
                                              />
                                            </button>
                                          ))}
                                        </div>
                                        {/* Score badge */}
                                        {score > 0 && (
                                          <span className={`text-xs px-1 rounded ${getScoreColor(score)}`}>
                                            {score}
                                          </span>
                                        )}
                                        {/* Lock toggle */}
                                        <button
                                          onClick={() => toggleScoreLock(item.id, asin)}
                                          className="p-0.5 hover:bg-muted rounded"
                                          title={isLocked ? "解锁" : "锁定"}
                                        >
                                          {isLocked ? (
                                            <Lock className="h-3 w-3 text-amber-600" />
                                          ) : (
                                            <Unlock className="h-3 w-3 text-gray-400" />
                                          )}
                                        </button>
                                        {/* Save if editing */}
                                        {editing && (
                                          <button
                                            onClick={() => saveScore(item.id, asin)}
                                            className="text-xs text-emerald-600 hover:underline"
                                          >
                                            保存
                                          </button>
                                        )}
                                      </div>
                                      {/* Note */}
                                      {existing?.reason && !editing && (
                                        <p className="text-xs text-muted-foreground mt-1 max-w-[120px] truncate" title={existing.reason || ''}>
                                          {existing.reason}
                                        </p>
                                      )}
                                    </TableCell>
                                  );
                                })}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>

          {/* AI Suggestions */}
          {suggestions && suggestions.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-purple-600" />
                    AI优化建议
                    <Badge variant="secondary" className="text-xs">
                      {suggestions.filter((s: any) => s.isLocked).length}/{suggestions.length} 已锁定
                    </Badge>
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {selectedSuggestions.size > 0 && (
                      <Badge variant="outline" className="text-xs">
                        已选 {selectedSuggestions.size} 项
                      </Badge>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setShowSyncDialog(true)}
                      disabled={syncToPlan.isPending || suggestions.filter((s: any) => s.isLocked).length === 0}>
                      {syncToPlan.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <ArrowRight className="h-3 w-3 mr-1" />}
                      一键同步到运营计划
                    </Button>
                  </div>
                </div>
                {suggestions.filter((s: any) => !s.isLocked).length > 0 && (
                  <p className="text-xs text-amber-600 mt-1">提示：请先锁定需要同步的建议项，仅已锁定的建议可同步到运营计划</p>
                )}
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {suggestions.map((sug: any) => {
                    const isEditing = editingSuggestion[sug.id] !== undefined;
                    const editText = editingSuggestion[sug.id] ?? sug.suggestion;
                    const isSelected = selectedSuggestions.has(sug.id);

                    return (
                      <div key={sug.id} className={`border rounded-lg p-4 transition-colors ${sug.isLocked ? "bg-amber-50/50 border-amber-200" : ""} ${isSelected ? "ring-2 ring-primary/50" : ""}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                setSelectedSuggestions(prev => {
                                  const next = new Set(prev);
                                  if (next.has(sug.id)) next.delete(sug.id); else next.add(sug.id);
                                  return next;
                                });
                              }}
                              className="h-4 w-4 rounded border-gray-300"
                            />
                            <Badge variant="secondary">{sug.categoryName}</Badge>
                            <Badge variant="secondary" className={
                              sug.priority === "high" ? "bg-red-50 text-red-700" :
                              sug.priority === "low" ? "bg-blue-50 text-blue-700" :
                              "bg-yellow-50 text-yellow-700"
                            }>
                              {sug.priority === "high" ? "高优先级" : sug.priority === "low" ? "低优先级" : "中优先级"}
                            </Badge>
                            {sug.isLocked && <Lock className="h-3.5 w-3.5 text-amber-600" />}
                          </div>
                          <div className="flex items-center gap-1">
                            {!isEditing ? (
                              <>
                                <Button size="sm" variant="ghost" onClick={() => setEditingSuggestion(prev => ({ ...prev, [sug.id]: sug.suggestion || "" }))}>
                                  编辑
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => {
                                  updateSuggestion.mutate({
                                    suggestionId: sug.id,
                                    isLocked: !sug.isLocked,
                                  });
                                }}>
                                  {sug.isLocked ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button size="sm" variant="ghost" onClick={() => {
                                  updateSuggestion.mutate({
                                    suggestionId: sug.id,
                                    suggestion: editText,
                                  });
                                  setEditingSuggestion(prev => {
                                    const next = { ...prev };
                                    delete next[sug.id];
                                    return next;
                                  });
                                }}>
                                  保存
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => {
                                  setEditingSuggestion(prev => {
                                    const next = { ...prev };
                                    delete next[sug.id];
                                    return next;
                                  });
                                }}>
                                  取消
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                        {sug.gapAnalysis && (
                          <p className="text-sm text-muted-foreground mb-2 bg-muted/30 rounded p-2">
                            <strong>差距分析：</strong>{sug.gapAnalysis}
                          </p>
                        )}
                        {isEditing ? (
                          <Textarea
                            value={editText}
                            onChange={e => setEditingSuggestion(prev => ({ ...prev, [sug.id]: e.target.value }))}
                            rows={3}
                            className="text-sm"
                          />
                        ) : (
                          <p className="text-sm whitespace-pre-wrap">{sug.suggestion || "—"}</p>
                        )}
                        {sug.expectedEffect && (
                          <p className="text-xs text-emerald-700 mt-2">预期效果：{sug.expectedEffect}</p>
                        )}
                        {sug.linkedPlanActionId && (
                          <div className="mt-2 flex items-center gap-1 text-xs text-blue-600">
                            <CheckCircle className="h-3 w-3" />
                            已同步到运营计划
                          </div>
                        )}
                        {sug.ownScore && Number(sug.ownScore) <= 3 && !sug.linkedPlanActionId && sug.isLocked && (
                          <div className="mt-2 flex items-center gap-1 text-xs text-orange-600">
                            <Star className="h-3 w-3" />
                            低分项·建议同步优化
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ─── Dialogs ─── */}

      {/* Create Comparison Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>新建转化率对比</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>对比名称</Label>
              <Input value={createForm.comparisonName} onChange={e => setCreateForm(f => ({ ...f, comparisonName: e.target.value }))} placeholder="如：Q1主力产品对比" />
            </div>
            <div>
              <Label>己品ASIN *</Label>
              <Input value={createForm.ownAsin} onChange={e => setCreateForm(f => ({ ...f, ownAsin: e.target.value }))} placeholder="输入己品ASIN" className="font-mono" />
            </div>
            <div>
              <Label>竞品ASIN（多个用逗号分隔）*</Label>
              <Textarea value={createForm.competitorAsins} onChange={e => setCreateForm(f => ({ ...f, competitorAsins: e.target.value }))} placeholder="B0XXXXXX1, B0XXXXXX2, B0XXXXXX3" rows={3} className="font-mono" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>取消</Button>
            <Button
              disabled={!createForm.ownAsin || !createForm.competitorAsins || createComparison.isPending}
              onClick={() => createComparison.mutate({
                productProfileId: productId,
                comparisonName: createForm.comparisonName,
                ownAsin: createForm.ownAsin,
                competitorAsins: createForm.competitorAsins.split(',').map((s: string) => s.trim()).filter(Boolean),
              })}
            >
              {createComparison.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              创建并初始化132项检查
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Custom Check Item Dialog */}
      <Dialog open={showAddItem} onOpenChange={setShowAddItem}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>添加自定义检查维度</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>维度序号</Label>
                <Input type="number" min={1} max={99} value={addItemForm.categoryIndex} onChange={e => setAddItemForm(f => ({ ...f, categoryIndex: Number(e.target.value) }))} />
              </div>
              <div>
                <Label>维度名称 *</Label>
                <Input value={addItemForm.categoryName} onChange={e => setAddItemForm(f => ({ ...f, categoryName: e.target.value }))} placeholder="如：社交媒体" />
              </div>
            </div>
            <div>
              <Label>检查项名称 *</Label>
              <Input value={addItemForm.subDimension} onChange={e => setAddItemForm(f => ({ ...f, subDimension: e.target.value }))} placeholder="如：Instagram粉丝数" />
            </div>
            <div>
              <Label>评分标准</Label>
              <Textarea value={addItemForm.standard} onChange={e => setAddItemForm(f => ({ ...f, standard: e.target.value }))} placeholder="描述1-5分的评判标准" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddItem(false)}>取消</Button>
            <Button
              disabled={!addItemForm.categoryName || !addItemForm.subDimension || addCheckItem.isPending}
              onClick={() => addCheckItem.mutate({
                categoryIndex: addItemForm.categoryIndex,
                categoryName: addItemForm.categoryName,
                subDimension: addItemForm.subDimension,
                standard: addItemForm.standard || undefined,
              })}
            >
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sync to Plan Dialog */}
      <Dialog open={showSyncDialog} onOpenChange={setShowSyncDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRight className="h-5 w-5 text-primary" />
              同步优化建议到运营计划
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-3">
              <Label>同步模式</Label>
              <Select value={syncMode} onValueChange={(v: any) => setSyncMode(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="locked_low_score">
                    <div className="flex items-center gap-2">
                      <Filter className="h-3 w-3" />
                      仅同步已锁定的低分项
                    </div>
                  </SelectItem>
                  <SelectItem value="all_locked">
                    <div className="flex items-center gap-2">
                      <Lock className="h-3 w-3" />
                      同步所有已锁定建议
                    </div>
                  </SelectItem>
                  <SelectItem value="selected">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-3 w-3" />
                      仅同步已勾选的建议 ({selectedSuggestions.size} 项)
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {syncMode === "locked_low_score" && (
              <div className="space-y-2">
                <Label>分数阈值（≤该分数视为低分）</Label>
                <div className="flex items-center gap-3">
                  {[1, 2, 3, 4].map(n => (
                    <Button
                      key={n}
                      size="sm"
                      variant={scoreThreshold === n ? "default" : "outline"}
                      onClick={() => setScoreThreshold(n)}
                      className="w-10 h-10"
                    >
                      {n}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  将同步所有已锁定且得分 ≤ {scoreThreshold} 的建议项到运营计划
                </p>
              </div>
            )}

            {/* Preview */}
            <div className="border rounded-lg p-3 bg-muted/30 max-h-48 overflow-y-auto">
              <p className="text-xs font-medium mb-2">预览将同步的建议：</p>
              {(() => {
                if (!suggestions) return <p className="text-xs text-muted-foreground">无可同步的建议</p>;
                let filtered: any[] = [];
                if (syncMode === "locked_low_score") {
                  filtered = suggestions.filter((s: any) => s.isLocked && !s.linkedPlanActionId && s.ownScore && Number(s.ownScore) <= scoreThreshold);
                } else if (syncMode === "all_locked") {
                  filtered = suggestions.filter((s: any) => s.isLocked && !s.linkedPlanActionId);
                } else {
                  filtered = suggestions.filter((s: any) => selectedSuggestions.has(s.id) && !s.linkedPlanActionId);
                }
                if (filtered.length === 0) return <p className="text-xs text-muted-foreground">无符合条件的建议（可能已全部同步）</p>;
                return filtered.map((s: any) => (
                  <div key={s.id} className="flex items-center gap-2 py-1 text-xs">
                    <Badge variant="secondary" className="text-[10px] px-1">{s.categoryName}</Badge>
                    <span className="truncate">{(s.suggestion || "").substring(0, 60)}</span>
                    {s.ownScore && <Badge variant="outline" className="text-[10px] ml-auto">{s.ownScore}分</Badge>}
                  </div>
                ));
              })()}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSyncDialog(false)}>取消</Button>
            <Button
              disabled={syncToPlan.isPending}
              onClick={() => {
                if (!activeCompId) return;
                const ids = syncMode === "selected" ? Array.from(selectedSuggestions) : [];
                syncToPlan.mutate({
                  comparisonId: activeCompId,
                  productProfileId: productId,
                  planId: 0,
                  suggestionIds: ids,
                  mode: syncMode,
                  scoreThreshold,
                });
                setShowSyncDialog(false);
                setSelectedSuggestions(new Set());
              }}
            >
              {syncToPlan.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <ArrowRight className="h-4 w-4 mr-1" />}
              确认同步
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Check Item Dialog */}
      <Dialog open={!!editItemDialog} onOpenChange={(open) => { if (!open) setEditItemDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4" />
              {editItemDialog?.isCustom ? "编辑自定义检查项" : "编辑检查项"}
            </DialogTitle>
          </DialogHeader>
          {editItemDialog && (
            <div className="space-y-4">
              {!editItemDialog.isCustom && (
                <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
                  这是系统默认检查项。修改后仅对您生效，不影响其他用户。您可以随时恢复默认设置。
                </div>
              )}
              <div>
                <Label>检查项名称</Label>
                <Input
                  value={editItemDialog.subDimension}
                  onChange={e => setEditItemDialog(prev => prev ? { ...prev, subDimension: e.target.value } : null)}
                  placeholder="检查项名称"
                />
              </div>
              <div>
                <Label>评分标准</Label>
                <Textarea
                  value={editItemDialog.standard}
                  onChange={e => setEditItemDialog(prev => prev ? { ...prev, standard: e.target.value } : null)}
                  placeholder="描述1-5分的评判标准"
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItemDialog(null)}>取消</Button>
            <Button
              disabled={!editItemDialog?.subDimension || editCheckItemMut.isPending}
              onClick={() => {
                if (!editItemDialog) return;
                editCheckItemMut.mutate({
                  checkItemId: editItemDialog.id,
                  subDimension: editItemDialog.subDimension,
                  standard: editItemDialog.standard || undefined,
                });
              }}
            >
              {editCheckItemMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              保存修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
