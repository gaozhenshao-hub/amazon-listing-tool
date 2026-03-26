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
  Eye, EyeOff, Pencil, RotateCcw, Settings2, Upload, FileSpreadsheet, AlertCircle, Camera, ImageIcon,
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
  const resetAndReinitMut = trpc.productOps.resetAndReinitCheckItems.useMutation({
    onSuccess: (data) => { refetchItems(); refetchScores(); toast.success(`检查项已重置，共${data.count}项`); },
    onError: (err) => toast.error(`重置失败: ${err.message}`),
  });
  const removeCheckItem = trpc.productOps.removeCustomCheckItem.useMutation({
    onSuccess: () => { refetchItems(); toast.success("自定义检查项已删除"); },
  });
  const parseSSCSV = trpc.productOps.parseSellerSpriteCSV.useMutation({
    onSuccess: (data) => {
      setSSImportResult(data as any);
      if (data.success) {
        toast.success(`解析成功：${data.parsedRows}/${data.totalRows}行，类型=${data.fileType}`);
      } else {
        toast.error(`解析失败：${data.errors.join('; ')}`);
      }
    },
    onError: (err) => toast.error(`解析失败: ${err.message}`),
  });
  const applySSData = trpc.productOps.applySellerSpriteData.useMutation({
    onSuccess: (data) => {
      refetchScores();
      setShowSSImport(false);
      setSSImportResult(null);
      toast.success(data.message);
    },
    onError: (err) => toast.error(`导入失败: ${err.message}`),
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
  const analyzeImages = trpc.productOps.analyzeProductImages.useMutation({
    onSuccess: (data) => {
      setImageAnalysisResults(data.results || []);
      if (data.errors?.length) {
        toast.warning(`图片分析完成，${data.analyzedCount}/${data.totalCount}张成功，${data.errors.length}张失败`);
      } else {
        toast.success(`图片AI分析完成，共分析${data.analyzedCount}张图片`);
      }
    },
    onError: (err) => toast.error(`图片分析失败: ${err.message}`),
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
  const [showSSImport, setShowSSImport] = useState(false);
  const [ssImportResult, setSSImportResult] = useState<any>(null);
  const [ssTargetAsin, setSSTargetAsin] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualAsin, setManualAsin] = useState('');
  const [manualForm, setManualForm] = useState({
    title: '', bulletCount: '', imageCount: '', variationCount: '',
    price: '', fulfillment: 'FBA', reviewCount: '', rating: '',
    qaCount: '', videoCount: '',
  });
  const [syncMode, setSyncMode] = useState<"locked_low_score" | "selected" | "all_locked">("locked_low_score");
  const [scoreThreshold, setScoreThreshold] = useState(3);
  const [showImageAnalysis, setShowImageAnalysis] = useState(false);
  const [imageAnalysisResults, setImageAnalysisResults] = useState<any[]>([]);
  const [imageAnalysisAsin, setImageAnalysisAsin] = useState('');

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
        if (s?.score && s.score > 0 && s.source !== 'no_data') {
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
                    setSSTargetAsin(activeComp?.ownAsin || '');
                    setShowSSImport(true);
                    setSSImportResult(null);
                  }}>
                    <Upload className="h-3 w-3 mr-1" />
                    导入卖家精灵数据
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => {
                    setShowManualInput(true);
                  }}>
                    <FileSpreadsheet className="h-3 w-3 mr-1" />
                    手动录入
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => {
                    if (!activeCompId) return;
                    aiScore.mutate({ comparisonId: activeCompId });
                  }} disabled={aiScore.isPending}>
                    {aiScore.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Brain className="h-3 w-3 mr-1" />}
                    AI全量评分
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => {
                    setShowImageAnalysis(true);
                    setImageAnalysisAsin(allAsins[0] || '');
                  }} disabled={analyzeImages.isPending}>
                    {analyzeImages.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Camera className="h-3 w-3 mr-1" />}
                    图片AI分析
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

          {/* Source Statistics */}
          {scores && scores.length > 0 && (() => {
            const ownAsin = activeComp?.ownAsin;
            const ownScores = scores.filter((s: any) => s.asin === ownAsin);
            const programmaticCount = ownScores.filter((s: any) => s.source === 'programmatic').length;
            const aiCount = ownScores.filter((s: any) => s.source === 'ai').length;
            const manualCount = ownScores.filter((s: any) => s.source === 'manual').length;
            const noDataCount = ownScores.filter((s: any) => s.source === 'no_data' || s.score === null).length;
            const totalScored = ownScores.filter((s: any) => s.score && s.score > 0).length;
            if (ownScores.length === 0) return null;
            return (
              <Card>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-6 text-sm">
                    <span className="text-muted-foreground font-medium">己品评分来源统计</span>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                        <span className="text-emerald-700 font-medium">程序化 {programmaticCount}</span>
                        <span className="text-muted-foreground text-xs">({totalScored > 0 ? Math.round(programmaticCount / totalScored * 100) : 0}%)</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                        <span className="text-blue-700 font-medium">AI {aiCount}</span>
                        <span className="text-muted-foreground text-xs">({totalScored > 0 ? Math.round(aiCount / totalScored * 100) : 0}%)</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-500"></span>
                        <span className="text-orange-700 font-medium">手动 {manualCount}</span>
                        <span className="text-muted-foreground text-xs">({totalScored > 0 ? Math.round(manualCount / totalScored * 100) : 0}%)</span>
                      </div>
                      {noDataCount > 0 && (
                        <div className="flex items-center gap-1.5">
                          <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500"></span>
                          <span className="text-red-700 font-medium">无数据 {noDataCount}</span>
                          <span className="text-muted-foreground text-xs">(待手动评分)</span>
                        </div>
                      )}
                    </div>
                    <div className="ml-auto text-xs text-muted-foreground">
                      共 {totalScored} 项已评分 / {ownScores.length} 项总计{noDataCount > 0 ? ` (其中${noDataCount}项无数据)` : ''}
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div className="flex h-2 rounded-full overflow-hidden mt-2 bg-muted">
                    {programmaticCount > 0 && <div className="bg-emerald-500" style={{ width: `${programmaticCount / ownScores.length * 100}%` }}></div>}
                    {aiCount > 0 && <div className="bg-blue-500" style={{ width: `${aiCount / ownScores.length * 100}%` }}></div>}
                    {manualCount > 0 && <div className="bg-orange-500" style={{ width: `${manualCount / ownScores.length * 100}%` }}></div>}
                    {noDataCount > 0 && <div className="bg-red-400" style={{ width: `${noDataCount / ownScores.length * 100}%` }}></div>}
                  </div>
                </CardContent>
              </Card>
            );
          })()}

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
                {manageMode && (
                  <Button size="sm" variant="destructive" onClick={() => {
                    if (confirm("确定要重置所有检查项吗？\n\n这将清空所有系统默认检查项和您的自定义修改，\n然后重新初始化最新的129项检查标准。")) {
                      resetAndReinitMut.mutate();
                    }
                  }} disabled={resetAndReinitMut.isPending}>
                    {resetAndReinitMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RotateCcw className="h-3 w-3 mr-1" />}
                    重置检查项
                  </Button>
                )}
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
                                  const isNoData = existing?.source === 'no_data' || (existing && existing.score === null);
                                  const isLocked = existing?.isLocked === 1;
                                  return (
                                    <TableCell key={asin} className="text-center">
                                      <div className="flex items-center justify-center gap-1">
                                        {/* No Data indicator */}
                                        {isNoData && !editing && score === 0 ? (
                                          <div className="flex items-center gap-1">
                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200 font-medium">
                                              无数据
                                            </span>
                                            <div className="flex items-center gap-0.5">
                                              {[1, 2, 3, 4, 5].map(s => (
                                                <button
                                                  key={s}
                                                  onClick={() => handleScoreChange(item.id, asin, s)}
                                                  className="p-0 cursor-pointer hover:scale-110 transition-transform"
                                                  title="手动评分"
                                                >
                                                  <Star className="h-3 w-3 text-gray-200" />
                                                </button>
                                              ))}
                                            </div>
                                          </div>
                                        ) : (
                                          <>
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
                                        {/* Source badge */}
                                        {existing?.source && score > 0 && (
                                          <span className={`text-[9px] px-1 py-0 rounded-sm font-medium ${
                                            existing.source === 'programmatic' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' :
                                            existing.source === 'manual' ? 'bg-orange-100 text-orange-700 border border-orange-200' :
                                            existing.source === 'no_data' ? 'bg-red-100 text-red-700 border border-red-200' :
                                            'bg-blue-100 text-blue-700 border border-blue-200'
                                          }`} title={{
                                            programmatic: '程序化评分：基于爬虫数据自动计算',
                                            ai: 'AI评分：基于LLM智能分析',
                                            manual: '手动评分：用户手动调整',
                                            no_data: '无数据：爬虫/API未获取到数据',
                                          }[existing.source] || 'AI评分'}>
                                            {{
                                              programmatic: '程序',
                                              ai: 'AI',
                                              manual: '手动',
                                              no_data: '无数据',
                                            }[existing.source] || 'AI'}
                                          </span>
                                        )}
                                          </>
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
                                      {/* Note + raw data hint */}
                                      {existing?.reason && !editing && (
                                        <p className="text-xs text-muted-foreground mt-1 max-w-[140px] truncate" title={existing.reason || ''}>
                                          {existing.reason}
                                        </p>
                                      )}
                                      {/* Show AI original score if user modified */}
                                      {existing?.source === 'manual' && existing?.aiScore && existing.aiScore !== existing.score && (
                                        <p className="text-[10px] text-blue-500 mt-0.5" title={`AI原始评分: ${existing.aiScore}分`}>
                                          AI原始: {existing.aiScore}★
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
      {/* SellerSprite Import Dialog */}
      <Dialog open={showSSImport} onOpenChange={(open) => { if (!open) { setShowSSImport(false); setSSImportResult(null); } }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              导入卖家精灵数据
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
              <p className="font-medium mb-1">支持的数据类型：</p>
              <p>• 产品查询导出（包含标题、价格、评分、变体等）</p>
              <p>• 关键词分析导出（包含搜索量、排名、竞价等）</p>
              <p>• 评论分析导出（包含评论内容、评分等）</p>
              <p className="mt-1 text-blue-600">将卖家精灵导出的CSV文件内容粘贴到下方，或直接拖拽CSV文件到此处。</p>
            </div>
            <div>
              <Label>目标ASIN（可选，留空则导入所有）</Label>
              <Input
                value={ssTargetAsin}
                onChange={(e) => setSSTargetAsin(e.target.value)}
                placeholder="例如 B0F21JYKNT"
                className="mt-1 font-mono"
              />
            </div>
            <div>
              <Label>CSV文件内容</Label>
              <div className="mt-1 relative">
                <Textarea
                  id="ss-csv-input"
                  placeholder="粘贴CSV文件内容…\n\n或拖拽CSV文件到此处"
                  className="min-h-[200px] font-mono text-xs"
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        const textarea = document.getElementById('ss-csv-input') as HTMLTextAreaElement;
                        if (textarea && ev.target?.result) {
                          textarea.value = ev.target.result as string;
                        }
                      };
                      reader.readAsText(file);
                    }
                  }}
                  onDragOver={(e) => e.preventDefault()}
                />
              </div>
            </div>
            <Button
              className="w-full"
              disabled={parseSSCSV.isPending}
              onClick={() => {
                const textarea = document.getElementById('ss-csv-input') as HTMLTextAreaElement;
                const csvText = textarea?.value?.trim();
                if (!csvText || csvText.length < 10) {
                  toast.error('请粘贴CSV文件内容');
                  return;
                }
                parseSSCSV.mutate({
                  csvText,
                  targetAsin: ssTargetAsin || undefined,
                });
              }}
            >
              {parseSSCSV.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
              解析数据
            </Button>

            {/* Parse Result Preview */}
            {ssImportResult && (
              <div className="space-y-3">
                <div className={`p-3 rounded-lg border ${ssImportResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <p className="font-medium text-sm">
                    {ssImportResult.success ? '✅ 解析成功' : '❌ 解析失败'}
                  </p>
                  <p className="text-xs mt-1">
                    文件类型: {ssImportResult.fileType === 'product' ? '产品数据' : ssImportResult.fileType === 'keyword' ? '关键词数据' : ssImportResult.fileType === 'review' ? '评论数据' : '未知'}
                    {' | '}总行数: {ssImportResult.totalRows} | 成功解析: {ssImportResult.parsedRows}
                  </p>
                  {ssImportResult.warnings?.length > 0 && (
                    <div className="mt-2 text-xs text-amber-700">
                      <p className="font-medium">警告:</p>
                      {ssImportResult.warnings.slice(0, 5).map((w: string, i: number) => <p key={i}>{w}</p>)}
                      {ssImportResult.warnings.length > 5 && <p>...及其他{ssImportResult.warnings.length - 5}条</p>}
                    </div>
                  )}
                  {ssImportResult.errors?.length > 0 && (
                    <div className="mt-2 text-xs text-red-700">
                      <p className="font-medium">错误:</p>
                      {ssImportResult.errors.map((e: string, i: number) => <p key={i}>{e}</p>)}
                    </div>
                  )}
                </div>

                {/* Product Data Preview */}
                {ssImportResult.success && ssImportResult.products?.length > 0 && (
                  <div className="border rounded-lg p-3">
                    <p className="font-medium text-sm mb-2">产品数据预览 ({ssImportResult.products.length}条)</p>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">ASIN</TableHead>
                            <TableHead className="text-xs">标题</TableHead>
                            <TableHead className="text-xs">价格</TableHead>
                            <TableHead className="text-xs">评分</TableHead>
                            <TableHead className="text-xs">评论数</TableHead>
                            <TableHead className="text-xs">变体</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ssImportResult.products.slice(0, 10).map((p: any, i: number) => (
                            <TableRow key={i}>
                              <TableCell className="text-xs font-mono">{p.asin}</TableCell>
                              <TableCell className="text-xs max-w-[200px] truncate">{p.title || '-'}</TableCell>
                              <TableCell className="text-xs">{p.price ? `$${p.price}` : '-'}</TableCell>
                              <TableCell className="text-xs">{p.rating || '-'}</TableCell>
                              <TableCell className="text-xs">{p.reviewCount || '-'}</TableCell>
                              <TableCell className="text-xs">{p.variationCount || '-'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {/* Keyword Data Preview */}
                {ssImportResult.success && ssImportResult.keywords?.length > 0 && (
                  <div className="border rounded-lg p-3">
                    <p className="font-medium text-sm mb-2">关键词数据预览 ({ssImportResult.keywords.length}条)</p>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">关键词</TableHead>
                            <TableHead className="text-xs">搜索量</TableHead>
                            <TableHead className="text-xs">自然排名</TableHead>
                            <TableHead className="text-xs">广告竞价</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ssImportResult.keywords.slice(0, 10).map((k: any, i: number) => (
                            <TableRow key={i}>
                              <TableCell className="text-xs">{k.keyword}</TableCell>
                              <TableCell className="text-xs">{k.searchVolume || '-'}</TableCell>
                              <TableCell className="text-xs">{k.organicRank || '-'}</TableCell>
                              <TableCell className="text-xs">{k.ppcBid ? `$${k.ppcBid}` : '-'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {/* Column Mapping */}
                {Object.keys(ssImportResult.columnMapping || {}).length > 0 && (
                  <div className="border rounded-lg p-3">
                    <p className="font-medium text-sm mb-2">列名映射</p>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(ssImportResult.columnMapping).map(([orig, mapped]: [string, any]) => (
                        <Badge key={orig} variant="outline" className="text-xs">
                          {orig} → {mapped}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Apply Button */}
                {ssImportResult.success && activeCompId && (
                  <div className="space-y-2">
                    <div>
                      <Label>应用到哪个ASIN</Label>
                      <Select value={ssTargetAsin} onValueChange={setSSTargetAsin}>
                        <SelectTrigger className="mt-1">
                          <SelectValue placeholder="选择ASIN" />
                        </SelectTrigger>
                        <SelectContent>
                          {allAsins.map((a: string) => (
                            <SelectItem key={a} value={a}>{a}{a === activeComp?.ownAsin ? ' (己品)' : ''}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      className="w-full"
                      disabled={!ssTargetAsin || applySSData.isPending}
                      onClick={() => {
                        if (!activeCompId || !ssTargetAsin) return;
                        const product = ssImportResult.products?.find((p: any) => p.asin === ssTargetAsin.toUpperCase()) || ssImportResult.products?.[0];
                        applySSData.mutate({
                          comparisonId: activeCompId,
                          asin: ssTargetAsin,
                          productData: {
                            title: product?.title,
                            brand: product?.brand,
                            price: product?.price,
                            rating: product?.rating,
                            reviewCount: product?.reviewCount,
                            variationCount: product?.variationCount,
                            fulfillment: product?.fulfillment,
                            imageCount: product?.imageCount,
                            bulletPoints: product?.bulletPoints,
                            description: product?.description,
                          },
                          keywordData: ssImportResult.keywords?.length > 0 ? ssImportResult.keywords : undefined,
                        });
                      }}
                    >
                      {applySSData.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                      应用数据到评分
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Manual Input Dialog */}
      <Dialog open={showManualInput} onOpenChange={setShowManualInput}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              手动录入产品数据
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              <p>手动录入的数据将补充爬虫未获取到的字段，已有真实数据的字段不会被覆盖。</p>
            </div>
            <div>
              <Label>目标ASIN</Label>
              <Select value={manualAsin} onValueChange={setManualAsin}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="选择ASIN" />
                </SelectTrigger>
                <SelectContent>
                  {allAsins.map((a: string) => (
                    <SelectItem key={a} value={a}>{a}{a === activeComp?.ownAsin ? ' (己品)' : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">产品标题</Label>
                <Input
                  value={manualForm.title}
                  onChange={(e) => setManualForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="产品标题…"
                  className="mt-1 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs">价格 ($)</Label>
                <Input
                  value={manualForm.price}
                  onChange={(e) => setManualForm(f => ({ ...f, price: e.target.value }))}
                  placeholder="29.99"
                  className="mt-1 text-xs"
                  type="number"
                  step="0.01"
                />
              </div>
              <div>
                <Label className="text-xs">五点数量</Label>
                <Input
                  value={manualForm.bulletCount}
                  onChange={(e) => setManualForm(f => ({ ...f, bulletCount: e.target.value }))}
                  placeholder="5"
                  className="mt-1 text-xs"
                  type="number"
                />
              </div>
              <div>
                <Label className="text-xs">图片数量</Label>
                <Input
                  value={manualForm.imageCount}
                  onChange={(e) => setManualForm(f => ({ ...f, imageCount: e.target.value }))}
                  placeholder="7"
                  className="mt-1 text-xs"
                  type="number"
                />
              </div>
              <div>
                <Label className="text-xs">变体数量</Label>
                <Input
                  value={manualForm.variationCount}
                  onChange={(e) => setManualForm(f => ({ ...f, variationCount: e.target.value }))}
                  placeholder="3"
                  className="mt-1 text-xs"
                  type="number"
                />
              </div>
              <div>
                <Label className="text-xs">配送方式</Label>
                <Select value={manualForm.fulfillment} onValueChange={(v) => setManualForm(f => ({ ...f, fulfillment: v }))}>
                  <SelectTrigger className="mt-1 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FBA">FBA</SelectItem>
                    <SelectItem value="FBM">FBM</SelectItem>
                    <SelectItem value="AMZ">AMZ自营</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">评论数</Label>
                <Input
                  value={manualForm.reviewCount}
                  onChange={(e) => setManualForm(f => ({ ...f, reviewCount: e.target.value }))}
                  placeholder="150"
                  className="mt-1 text-xs"
                  type="number"
                />
              </div>
              <div>
                <Label className="text-xs">评分</Label>
                <Input
                  value={manualForm.rating}
                  onChange={(e) => setManualForm(f => ({ ...f, rating: e.target.value }))}
                  placeholder="4.5"
                  className="mt-1 text-xs"
                  type="number"
                  step="0.1"
                  min="1"
                  max="5"
                />
              </div>
              <div>
                <Label className="text-xs">Q&A数量</Label>
                <Input
                  value={manualForm.qaCount}
                  onChange={(e) => setManualForm(f => ({ ...f, qaCount: e.target.value }))}
                  placeholder="20"
                  className="mt-1 text-xs"
                  type="number"
                />
              </div>
              <div>
                <Label className="text-xs">视频数量</Label>
                <Input
                  value={manualForm.videoCount}
                  onChange={(e) => setManualForm(f => ({ ...f, videoCount: e.target.value }))}
                  placeholder="2"
                  className="mt-1 text-xs"
                  type="number"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowManualInput(false)}>取消</Button>
            <Button
              disabled={!manualAsin || !activeCompId || applySSData.isPending}
              onClick={() => {
                if (!activeCompId || !manualAsin) return;
                const pd: any = {};
                if (manualForm.title) pd.title = manualForm.title;
                if (manualForm.price) pd.price = parseFloat(manualForm.price);
                if (manualForm.reviewCount) pd.reviewCount = parseInt(manualForm.reviewCount);
                if (manualForm.rating) pd.rating = parseFloat(manualForm.rating);
                if (manualForm.variationCount) pd.variationCount = parseInt(manualForm.variationCount);
                if (manualForm.fulfillment) pd.fulfillment = manualForm.fulfillment;
                if (manualForm.imageCount) pd.imageCount = parseInt(manualForm.imageCount);
                if (manualForm.bulletCount) {
                  pd.bulletPoints = Array.from({ length: parseInt(manualForm.bulletCount) }, (_, i) => `Bullet point ${i + 1}`);
                }
                applySSData.mutate({
                  comparisonId: activeCompId,
                  asin: manualAsin,
                  productData: pd,
                });
                setShowManualInput(false);
              }}
            >
              {applySSData.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              应用数据
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image AI Analysis Dialog */}
      <Dialog open={showImageAnalysis} onOpenChange={(open) => { if (!open) setShowImageAnalysis(false); }}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              图片AI质量分析
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              使用AI视觉能力分析产品图片质量，包括首图白底纯净度、辅图卖点表达、A+内容设计等维度。
              请输入图片URL或从爬取数据中自动获取。
            </p>

            {/* ASIN Selection */}
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Label className="text-xs">选择ASIN</Label>
                <Select value={imageAnalysisAsin} onValueChange={setImageAnalysisAsin}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="选择ASIN" />
                  </SelectTrigger>
                  <SelectContent>
                    {allAsins.map((a: string, i: number) => (
                      <SelectItem key={a} value={a}>{i === 0 ? `己品 ${a}` : `竞品 ${a}`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" onClick={() => {
                if (!activeCompId || !imageAnalysisAsin) return;
                // Use placeholder images for now - in real scenario, these come from crawl data
                const sampleImages = [
                  { url: `https://m.media-amazon.com/images/I/${imageAnalysisAsin}._AC_SL1500_.jpg`, position: 'main' as const, positionIndex: 0 },
                ];
                analyzeImages.mutate({
                  comparisonId: activeCompId,
                  asin: imageAnalysisAsin,
                  imageUrls: sampleImages,
                  maxImages: 10,
                });
              }} disabled={analyzeImages.isPending || !imageAnalysisAsin}>
                {analyzeImages.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Camera className="h-3 w-3 mr-1" />}
                开始分析
              </Button>
            </div>

            {/* Manual Image URL Input */}
            <div>
              <Label className="text-xs">手动输入图片URL（每行一个，格式：类型|序号|URL）</Label>
              <Textarea
                className="text-xs font-mono mt-1"
                rows={4}
                placeholder={`main|0|https://m.media-amazon.com/images/I/xxx._AC_SL1500_.jpg\nsecondary|1|https://m.media-amazon.com/images/I/yyy._AC_SL1500_.jpg\naplus|0|https://m.media-amazon.com/images/I/zzz._AC_SL1500_.jpg`}
                id="imageUrlsInput"
              />
              <Button size="sm" variant="outline" className="mt-2" onClick={() => {
                if (!activeCompId || !imageAnalysisAsin) return;
                const textarea = document.getElementById('imageUrlsInput') as HTMLTextAreaElement;
                const lines = textarea?.value?.split('\n').filter(l => l.trim()) || [];
                const images = lines.map(line => {
                  const parts = line.split('|').map(s => s.trim());
                  return {
                    position: (parts[0] || 'secondary') as 'main' | 'secondary' | 'aplus' | 'brand_story',
                    positionIndex: parseInt(parts[1] || '0'),
                    url: parts[2] || parts[0] || '',
                  };
                }).filter(img => img.url.startsWith('http'));
                if (images.length === 0) { toast.error('请输入有效的图片URL'); return; }
                analyzeImages.mutate({
                  comparisonId: activeCompId,
                  asin: imageAnalysisAsin,
                  imageUrls: images,
                  maxImages: 10,
                });
              }} disabled={analyzeImages.isPending}>
                解析并分析输入的URL
              </Button>
            </div>

            {/* Analysis Results */}
            {imageAnalysisResults.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">分析结果 ({imageAnalysisResults.length}张图片)</h4>
                {imageAnalysisResults.map((result: any, idx: number) => (
                  <Card key={idx} className="border">
                    <CardContent className="p-3">
                      <div className="flex gap-3">
                        {/* Thumbnail */}
                        <div className="w-20 h-20 flex-shrink-0 rounded overflow-hidden bg-muted">
                          <img src={result.imageUrl} alt="" className="w-full h-full object-contain" 
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        </div>
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant={result.imageType === 'main' ? 'default' : 'secondary'} className="text-[10px]">
                              {result.imageType === 'main' ? '首图' : result.imageType === 'secondary' ? `辅图#${result.positionIndex + 1}` : `A+#${result.positionIndex + 1}`}
                            </Badge>
                            <div className="flex items-center gap-0.5">
                              {[1,2,3,4,5].map(s => (
                                <Star key={s} className={`h-3 w-3 ${s <= result.overallScore ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/30'}`} />
                              ))}
                              <span className="text-xs ml-1 font-medium">{result.overallScore}/5</span>
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground mb-2">{result.summary}</p>
                          {/* Dimension Scores */}
                          <div className="grid grid-cols-2 gap-1">
                            {(result.dimensions || []).map((d: any, di: number) => (
                              <div key={di} className="flex items-center gap-1 text-[10px]">
                                <div className={`w-1.5 h-1.5 rounded-full ${d.score >= 4 ? 'bg-green-500' : d.score >= 3 ? 'bg-yellow-500' : 'bg-red-500'}`} />
                                <span className="text-muted-foreground">{d.dimension}:</span>
                                <span className="font-medium">{d.score}/5</span>
                              </div>
                            ))}
                          </div>
                          {/* Strengths & Weaknesses */}
                          {result.strengths?.length > 0 && (
                            <div className="mt-2">
                              <span className="text-[10px] text-green-600 font-medium">优点: </span>
                              <span className="text-[10px] text-muted-foreground">{result.strengths.join(' | ')}</span>
                            </div>
                          )}
                          {result.weaknesses?.length > 0 && (
                            <div>
                              <span className="text-[10px] text-red-600 font-medium">不足: </span>
                              <span className="text-[10px] text-muted-foreground">{result.weaknesses.join(' | ')}</span>
                            </div>
                          )}
                          {result.suggestions?.length > 0 && (
                            <div>
                              <span className="text-[10px] text-blue-600 font-medium">建议: </span>
                              <span className="text-[10px] text-muted-foreground">{result.suggestions.join(' | ')}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {analyzeImages.isPending && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">正在分析图片，每张图片约5-15秒...</span>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
