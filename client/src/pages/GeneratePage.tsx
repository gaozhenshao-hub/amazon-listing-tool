import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import ProjectSelector from "@/components/ProjectSelector";
import { useProject } from "@/contexts/ProjectContext";
import {
  Sparkles,
  Loader2,
  AlertTriangle,
  AlertCircle,
  ArrowRight,
  Tag,
  GitBranch,
  LayoutGrid,
  Search,
  Check,
  Megaphone,
  Target,
  RotateCcw,
  Upload,
  FileText,
  CheckCircle2,
  Plus,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronUp,
  Wand2,
  Download,
  Filter,
  X,
  ArrowUpDown,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";

function CharCountBadge({ count, min, max, label }: { count: number; min: number; max: number; label?: string }) {
  const inRange = count >= min && count <= max;
  const tooShort = count < min;

  return (
    <Badge
      variant={inRange ? "default" : "destructive"}
      className={`text-xs ${inRange ? "bg-green-600" : tooShort ? "bg-amber-500" : "bg-red-500"}`}
    >
      {count} / {min}-{max} {label || "字符"}
      {inRange && " ✓"}
      {tooShort && " ↑偏短"}
      {!inRange && !tooShort && " ↓偏长"}
    </Badge>
  );
}

export default function GeneratePage() {
  const { selectedProjectId } = useProject();
  const [, setLocation] = useLocation();
  const [emphasis, setEmphasis] = useState("");

  // Step-by-step bullet generation state
  const [sellingPointCores, setSellingPointCores] = useState<any[] | null>(null);
  const [overallStrategy, setOverallStrategy] = useState<string>("");
  const [confirmedCores, setConfirmedCores] = useState<boolean[]>([]);
  const [generatedBullets, setGeneratedBullets] = useState<Record<number, any>>({});
  const [confirmedBullets, setConfirmedBullets] = useState<Record<number, boolean>>({});
  const [editingCore, setEditingCore] = useState<number | null>(null);
  const [editingBullet, setEditingBullet] = useState<number | null>(null);
  const [editBulletData, setEditBulletData] = useState<{ subtitle: string; fullText: string }>({ subtitle: "", fullText: "" });
  const [stepBulletPhase, setStepBulletPhase] = useState<"idle" | "cores" | "bullets">("idle");

  // Manual selling point addition state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCoreTheme, setNewCoreTheme] = useState("");
  const [newCoreThemeZh, setNewCoreThemeZh] = useState("");
  const [newCoreDescription, setNewCoreDescription] = useState("");

  // AI assist state for manual selling point
  const [aiAssistMode, setAiAssistMode] = useState(false);
  const [aiKeyword, setAiKeyword] = useState("");
  const [aiResult, setAiResult] = useState<any>(null);
  const [aiResultEditing, setAiResultEditing] = useState(false);

  // Keyword import dialog state
  const [showKeywordImport, setShowKeywordImport] = useState(false);
  const [kwSearchTerm, setKwSearchTerm] = useState("");
  const [kwFilterStrategy, setKwFilterStrategy] = useState<string>("all");
  const [kwFilterPlacement, setKwFilterPlacement] = useState<string>("all");
  const [kwSortOrder, setKwSortOrder] = useState<"none" | "asc" | "desc">("none");
  const [selectedKeywordIds, setSelectedKeywordIds] = useState<Set<number>>(new Set());

  const { data: project } = trpc.project.getById.useQuery(
    { id: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  const { data: analyses } = trpc.analysis.listByProject.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  const { data: fileSummary } = trpc.projectFile.getAnalysisSummary.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  const { data: keywordStats } = trpc.keyword.stats.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  // Keyword list for import dialog (only fetch when dialog is open)
  const { data: allKeywords, isLoading: kwLoading } = trpc.keyword.list.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId && showKeywordImport }
  );

  // Calculate keyword analysis readiness
  const kwReadiness = (() => {
    if (!keywordStats || keywordStats.total === 0) return null;
    const hasSceneTags = (keywordStats.byStatus?.tagged || 0) + (keywordStats.byStatus?.finalized || 0) > 0;
    const hasStrategy = Object.keys(keywordStats.byStrategy || {}).length > 0;
    const hasRoots = Object.keys(keywordStats.byRoot || {}).length > 0;
    const taggedCount = (keywordStats.byStatus?.tagged || 0) + (keywordStats.byStatus?.finalized || 0);
    const steps = [
      { key: "import", label: "关键词导入", done: keywordStats.total > 0, icon: Search, count: keywordStats.total },
      { key: "scene", label: "场景打标", done: hasSceneTags, icon: Tag, count: taggedCount },
      { key: "root", label: "词根分类", done: hasRoots, icon: GitBranch, count: Object.values(keywordStats.byRoot || {}).reduce((a: number, b: number) => a + b, 0) },
      { key: "strategy", label: "策略矩阵", done: hasStrategy, icon: LayoutGrid, count: Object.values(keywordStats.byStrategy || {}).reduce((a: number, b: number) => a + b, 0) },
    ];
    const completedSteps = steps.filter(s => s.done).length;
    return { steps, completedSteps, total: steps.length, allDone: completedSteps === steps.length };
  })();

  // Step-by-step bullet mutations
  const generateCores = trpc.listing.generateSellingPointsCores.useMutation({
    onSuccess: (data) => {
      if (data.sellingPoints) {
        setSellingPointCores(data.sellingPoints);
        setOverallStrategy(data.overallStrategy || "");
        setConfirmedCores(new Array(data.sellingPoints.length).fill(false));
        setGeneratedBullets({});
        setConfirmedBullets({});
        setStepBulletPhase("cores");
        toast.success("卖点核心已生成（7条），请确认或编辑后逐条生成");
      } else {
        toast.error("生成结果格式异常");
      }
    },
    onError: (err) => toast.error("卖点核心生成失败: " + err.message),
  });

  const generateSingleBullet = trpc.listing.generateSingleBullet.useMutation({
    onError: (err) => toast.error("卖点生成失败: " + err.message),
  });

  const handleGenerateCores = () => {
    if (!selectedProjectId) return;
    setStepBulletPhase("idle");
    generateCores.mutate({ projectId: selectedProjectId, emphasis: emphasis.trim() || undefined });
  };

  const handleConfirmCore = (idx: number) => {
    setConfirmedCores(prev => { const next = [...prev]; next[idx] = true; return next; });
    setEditingCore(null);
  };

  const handleEditCore = (idx: number, field: string, value: any) => {
    if (!sellingPointCores) return;
    setSellingPointCores(prev => {
      if (!prev) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const handleEditCoreFabe = (idx: number, fabeField: string, value: string) => {
    if (!sellingPointCores) return;
    setSellingPointCores(prev => {
      if (!prev) return prev;
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        fabeDirection: { ...next[idx].fabeDirection, [fabeField]: value },
      };
      return next;
    });
  };

  // AI expand keyword to FABE mutation
  const expandKeyword = trpc.listing.expandKeywordToFABE.useMutation({
    onSuccess: (data) => {
      setAiResult(data);
      setAiResultEditing(true);
      toast.success("AI已生成FABE卖点框架，请检查并确认");
    },
    onError: (err) => toast.error("AI生成失败: " + err.message),
  });

  const handleAiExpand = () => {
    if (!selectedProjectId || !aiKeyword.trim()) {
      toast.error("请输入关键词或主题");
      return;
    }
    expandKeyword.mutate({ projectId: selectedProjectId, keyword: aiKeyword.trim() });
  };

  const handleConfirmAiResult = () => {
    if (!sellingPointCores || !aiResult) return;
    if (sellingPointCores.length >= 9) {
      toast.error("最多支持9条卖点");
      return;
    }
    const newCore = {
      index: sellingPointCores.length + 1,
      theme: aiResult.theme,
      themeZh: aiResult.themeZh || "",
      description: aiResult.description || "",
      descriptionZh: aiResult.descriptionZh || "",
      fabeDirection: aiResult.fabeDirection || { feature: "", advantage: "", benefit: "", evidence: "" },
      targetKeywords: aiResult.targetKeywords || [],
      addressesGap: aiResult.addressesGap || "",
      isManual: true,
    };
    setSellingPointCores(prev => prev ? [...prev, newCore] : [newCore]);
    setConfirmedCores(prev => [...prev, false]);
    setAiResult(null);
    setAiKeyword("");
    setAiResultEditing(false);
    setShowAddForm(false);
    toast.success("已添加AI生成的卖点，请确认或继续编辑");
  };

  // Add manual selling point core (manual mode)
  const handleAddManualCore = () => {
    if (!sellingPointCores || !newCoreTheme.trim()) {
      toast.error("请填写卖点主题");
      return;
    }
    if (sellingPointCores.length >= 9) {
      toast.error("最多支持9条卖点");
      return;
    }
    const newCore = {
      index: sellingPointCores.length + 1,
      theme: newCoreTheme.trim(),
      themeZh: newCoreThemeZh.trim() || undefined,
      description: newCoreDescription.trim() || "User-defined selling point",
      descriptionZh: "",
      fabeDirection: {
        feature: "",
        advantage: "",
        benefit: "",
        evidence: "",
      },
      targetKeywords: [],
      addressesGap: "",
      isManual: true,
    };
    setSellingPointCores(prev => prev ? [...prev, newCore] : [newCore]);
    setConfirmedCores(prev => [...prev, false]);
    setNewCoreTheme("");
    setNewCoreThemeZh("");
    setNewCoreDescription("");
    setShowAddForm(false);
    setAiAssistMode(false);
    toast.success("已添加自定义卖点，请编辑并确认");
  };

  // Filtered and sorted keyword list for import dialog
  const filteredKeywords = useMemo(() => {
    if (!allKeywords) return [];
    const filtered = allKeywords.filter((kw: any) => {
      if (kw.isNegative === 1) return false;
      if (kwSearchTerm) {
        const search = kwSearchTerm.toLowerCase();
        const matchKeyword = kw.keyword?.toLowerCase().includes(search);
        const matchTranslation = kw.translationCn?.toLowerCase().includes(search);
        if (!matchKeyword && !matchTranslation) return false;
      }
      if (kwFilterStrategy !== "all" && kw.strategyCategory !== kwFilterStrategy) return false;
      if (kwFilterPlacement !== "all" && kw.listingPlacement !== kwFilterPlacement) return false;
      return true;
    });
    if (kwSortOrder === "asc") {
      filtered.sort((a: any, b: any) => (a.monthlySearchVolume ?? 0) - (b.monthlySearchVolume ?? 0));
    } else if (kwSortOrder === "desc") {
      filtered.sort((a: any, b: any) => (b.monthlySearchVolume ?? 0) - (a.monthlySearchVolume ?? 0));
    }
    return filtered;
  }, [allKeywords, kwSearchTerm, kwFilterStrategy, kwFilterPlacement, kwSortOrder]);

  const toggleKeywordSelection = (id: number) => {
    setSelectedKeywordIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    const allIds = filteredKeywords.map((kw: any) => kw.id);
    const allSelected = allIds.every((id: number) => selectedKeywordIds.has(id));
    if (allSelected) {
      setSelectedKeywordIds(prev => {
        const next = new Set(prev);
        allIds.forEach((id: number) => next.delete(id));
        return next;
      });
    } else {
      setSelectedKeywordIds(prev => {
        const next = new Set(prev);
        allIds.forEach((id: number) => next.add(id));
        return next;
      });
    }
  };

  const handleImportSelectedKeywords = () => {
    if (!allKeywords || selectedKeywordIds.size === 0) return;
    const selected = allKeywords.filter((kw: any) => selectedKeywordIds.has(kw.id));
    // Combine selected keywords into a single string for AI input
    const keywordText = selected.map((kw: any) => kw.keyword).join(", ");
    setAiKeyword(keywordText);
    setAiAssistMode(true);
    setShowAddForm(true);
    setShowKeywordImport(false);
    setSelectedKeywordIds(new Set());
    setKwSearchTerm("");
    setKwFilterStrategy("all");
    setKwFilterPlacement("all");
    toast.success(`已导入 ${selected.length} 个关键词，点击"AI生成FABE"开始生成`);
  };

  // Remove manual selling point core
  const handleRemoveCore = (idx: number) => {
    if (!sellingPointCores) return;
    const sp = sellingPointCores[idx];
    if (!sp.isManual) {
      toast.error("只能删除手动添加的卖点");
      return;
    }
    setSellingPointCores(prev => {
      if (!prev) return prev;
      const next = prev.filter((_, i) => i !== idx);
      // Re-index
      return next.map((item, i) => ({ ...item, index: i + 1 }));
    });
    setConfirmedCores(prev => prev.filter((_, i) => i !== idx));
    // Clean up generated bullets
    const newBullets: Record<number, any> = {};
    const newConfirmed: Record<number, boolean> = {};
    Object.entries(generatedBullets).forEach(([key, val]) => {
      const k = Number(key);
      if (k < idx) { newBullets[k] = val; newConfirmed[k] = confirmedBullets[k] || false; }
      else if (k > idx) { newBullets[k - 1] = val; newConfirmed[k - 1] = confirmedBullets[k] || false; }
    });
    setGeneratedBullets(newBullets);
    setConfirmedBullets(newConfirmed);
  };

  const handleGenerateSingleBullet = async (idx: number) => {
    if (!selectedProjectId || !sellingPointCores) return;
    const sp = sellingPointCores[idx];
    // Collect previously confirmed bullets
    const previousBullets = Object.entries(confirmedBullets)
      .filter(([, confirmed]) => confirmed)
      .map(([i]) => generatedBullets[Number(i)])
      .filter(Boolean)
      .map(b => ({ subtitle: b.subtitle || "", fullText: b.fullText || "" }));

    try {
      const result = await generateSingleBullet.mutateAsync({
        projectId: selectedProjectId,
        sellingPoint: sp,
        previousBullets,
        emphasis: emphasis.trim() || undefined,
      });
      setGeneratedBullets(prev => ({ ...prev, [idx]: result }));
      toast.success(`卖点 ${idx + 1} 生成完成`);
    } catch {
      // error handled by onError
    }
  };

  const handleConfirmBullet = (idx: number) => {
    setConfirmedBullets(prev => ({ ...prev, [idx]: true }));
    setEditingBullet(null);
  };

  const handleStartEditBullet = (idx: number) => {
    const bullet = generatedBullets[idx];
    if (!bullet) return;
    setEditBulletData({ subtitle: bullet.subtitle || "", fullText: bullet.fullText || "" });
    setEditingBullet(idx);
  };

  const handleSaveEditBullet = (idx: number) => {
    setGeneratedBullets(prev => ({
      ...prev,
      [idx]: {
        ...prev[idx],
        subtitle: editBulletData.subtitle,
        fullText: editBulletData.fullText,
        actualCharacterCount: (editBulletData.subtitle + " " + editBulletData.fullText).length,
        characterCount: (editBulletData.subtitle + " " + editBulletData.fullText).length,
      },
    }));
    setEditingBullet(null);
    toast.success("卖点内容已更新");
  };

  const handleResetStepBullet = () => {
    setSellingPointCores(null);
    setOverallStrategy("");
    setConfirmedCores([]);
    setGeneratedBullets({});
    setConfirmedBullets({});
    setStepBulletPhase("idle");
    setEditingCore(null);
    setEditingBullet(null);
    setShowAddForm(false);
  };

  // Sync confirmed bullets to listing preview
  const syncBulletsMut = trpc.listing.syncBulletsFromSellingPoints.useMutation({
    onSuccess: (data) => {
      toast.success(`已成功同步 ${data.bulletCount} 条卖点到Listing预览页`);
    },
    onError: (err) => toast.error("同步失败: " + err.message),
  });

  const handleSyncBullets = () => {
    if (!selectedProjectId || !sellingPointCores) return;
    const bullets = Object.entries(confirmedBullets)
      .filter(([, confirmed]) => confirmed)
      .map(([i]) => generatedBullets[Number(i)])
      .filter(Boolean)
      .map(b => ({ subtitle: b.subtitle || "", fullText: b.fullText || "" }));
    if (bullets.length === 0) { toast.error("没有已确认的卖点可同步"); return; }
    syncBulletsMut.mutate({ projectId: selectedProjectId, bullets });
  };

  const allBulletsConfirmed = sellingPointCores
    ? sellingPointCores.every((_, i) => confirmedBullets[i])
    : false;

  const confirmedBulletCount = Object.values(confirmedBullets).filter(Boolean).length;
  const totalCoresCount = sellingPointCores?.length || 0;
  const manualCoresCount = sellingPointCores?.filter(sp => sp.isManual).length || 0;
  const canAddMore = totalCoresCount < 9;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">智能Listing生成</h1>
          <p className="text-muted-foreground mt-1">
            分步卖点精雕：AI生成7条核心卖点方向 → 人工确认/编辑 → 逐条生成完整Bullet Point
          </p>
        </div>
        <ProjectSelector />
      </div>

      {!selectedProjectId ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertTriangle className="h-8 w-8 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">请先在项目管理中创建并选择一个项目</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Character count rules reminder */}
          <Card className="bg-blue-50/50 border-blue-200">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-blue-900">亚马逊Bullet Point规则</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-blue-700">
                    <span>每条Bullet Point：<strong>200-280</strong> 字符（不超过280）</span>
                    <span>卖点数量：AI生成 <strong>7</strong> 条，可手动增加最多 <strong>2</strong> 条（共9条）</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Project Info Summary */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                  <div>
                    <p className="font-medium">{project?.name || "加载中..."}</p>
                    <p className="text-sm text-muted-foreground">
                      {project?.brand ? `${project.brand} · ` : ""}
                      {project?.productName || ""}
                      {analyses && analyses.length > 0 ? ` · ${analyses.length} 个竞品分析` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {analyses && analyses.length > 0 && (
                    <Badge variant="secondary">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      已有竞品数据
                    </Badge>
                  )}
                  {fileSummary && fileSummary.fileCount > 0 && (
                    <Badge variant={fileSummary.hasAllFiles ? "default" : "secondary"}
                      className={fileSummary.hasAllFiles ? "bg-green-600" : ""}>
                      {fileSummary.hasAllFiles ? (
                        <><CheckCircle2 className="h-3 w-3 mr-1" />4/4 分析模块就绪</>
                      ) : (
                        <>{[
                          fileSummary.productAttributes ? 1 : 0,
                          fileSummary.competitorListings ? 1 : 0,
                          fileSummary.cosmoScenes ? 1 : 0,
                          fileSummary.a9Keywords ? 1 : 0,
                        ].reduce((a: number, b: number) => a + b, 0)}/4 分析模块</>
                      )}
                    </Badge>
                  )}
                  {kwReadiness && (
                    <Badge variant={kwReadiness.allDone ? "default" : "secondary"}
                      className={kwReadiness.allDone ? "bg-green-600" : ""}>
                      {kwReadiness.allDone ? (
                        <><CheckCircle2 className="h-3 w-3 mr-1" />关键词分析就绪</>
                      ) : (
                        <>{kwReadiness.completedSteps}/{kwReadiness.total} 关键词步骤</>
                      )}
                    </Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Keyword Readiness Indicator */}
          {kwReadiness && !kwReadiness.allDone && (
            <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-amber-900 dark:text-amber-200 mb-2">
                      关键词AI分析未完成 — 建议先完成分析以获得更优质的Listing
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                      {kwReadiness.steps.map((step) => (
                        <div key={step.key} className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs ${
                          step.done
                            ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                            : "bg-white/60 text-muted-foreground dark:bg-gray-800/40"
                        }`}>
                          {step.done ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                          ) : (
                            <step.icon className="h-3.5 w-3.5 shrink-0" />
                          )}
                          <span className="font-medium">{step.label}</span>
                          {step.done && <span className="ml-auto text-[10px]">({step.count})</span>}
                        </div>
                      ))}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-amber-700 border-amber-300 hover:bg-amber-100"
                      onClick={() => setLocation("/listing/keywords")}
                    >
                      前往关键词管理
                      <ArrowRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Emphasis / Key Selling Points */}
          <Card className="border-amber-200 bg-gradient-to-r from-amber-50/50 to-transparent">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Megaphone className="h-5 w-5 text-amber-600" />
                重点强调（可选）
              </CardTitle>
              <CardDescription>
                指定AI生成时需要优先突出的卖点、场景或差异化优势，留空则由AI自主决策
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder={'例如：突出"无毒安全"和"室内外多场景使用"；强调与竞品相比的独特设计优势；重点体现"送礼场景"...'}
                value={emphasis}
                onChange={(e) => setEmphasis(e.target.value)}
                rows={2}
                className="resize-none"
              />
              {emphasis.trim() && (
                <p className="mt-2 text-xs text-amber-600 flex items-center gap-1">
                  <Check className="h-3 w-3" />
                  已设置重点强调，AI将在生成内容中优先体现这些内容
                </p>
              )}
            </CardContent>
          </Card>

          {/* Step-by-Step Bullet Crafting Section - Main Content */}
          <Card className="border-teal-200 bg-gradient-to-br from-teal-50/50 to-transparent dark:from-teal-950/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5 text-teal-600" />
                分步卖点精雕
              </CardTitle>
              <CardDescription>
                AI生成7条卖点核心方向 → 可手动增加最多2条（共9条） → 人工确认/编辑 → 逐条生成完整Bullet Point → 同步到预览页
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Phase: Generate Cores */}
              {stepBulletPhase === "idle" && (
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={handleGenerateCores}
                  disabled={generateCores.isPending}
                >
                  {generateCores.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />正在分析卖点方向...</>
                  ) : (
                    <><Target className="h-4 w-4 mr-2" />Step 1: 生成7条卖点核心方向</>
                  )}
                </Button>
              )}

              {generateCores.isPending && (
                <div className="mt-2">
                  <Progress value={undefined} className="h-1" />
                  <p className="text-xs text-muted-foreground text-center mt-2">AI正在分析产品数据、竞品信息和关键词策略，规划7条卖点方向...</p>
                </div>
              )}

              {/* Phase: Confirm/Edit Cores */}
              {sellingPointCores && sellingPointCores.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold">
                        卖点核心方向 ({confirmedCores.filter(Boolean).length}/{sellingPointCores.length} 已确认)
                        {manualCoresCount > 0 && (
                          <span className="text-xs text-muted-foreground ml-2">
                            (含 {manualCoresCount} 条手动添加)
                          </span>
                        )}
                      </h3>
                      {overallStrategy && <p className="text-xs text-muted-foreground mt-1">{overallStrategy}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      {canAddMore && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setShowKeywordImport(true);
                              setSelectedKeywordIds(new Set());
                            }}
                          >
                            <Download className="h-3.5 w-3.5 mr-1" />
                            从关键词导入
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setShowAddForm(!showAddForm)}>
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            手动添加 ({totalCoresCount}/9)
                          </Button>
                        </>
                      )}
                      <Button variant="ghost" size="sm" onClick={handleResetStepBullet}>
                        <RotateCcw className="h-3.5 w-3.5 mr-1" />重新生成
                      </Button>
                    </div>
                  </div>

                  {/* Manual Add Form with AI Assist */}
                  {showAddForm && canAddMore && (
                    <div className="rounded-lg border-2 border-dashed border-teal-300 p-4 bg-teal-50/30 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium text-teal-700 flex items-center gap-2">
                          <Plus className="h-4 w-4" />
                          添加自定义卖点 (还可添加 {9 - totalCoresCount} 条)
                        </h4>
                        <div className="flex gap-1 bg-muted rounded-md p-0.5">
                          <button
                            className={`px-3 py-1 text-xs rounded transition-colors ${
                              aiAssistMode
                                ? "bg-background shadow-sm text-teal-700 font-medium"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                            onClick={() => { setAiAssistMode(true); setAiResult(null); }}
                          >
                            <Wand2 className="h-3 w-3 inline mr-1" />AI辅助
                          </button>
                          <button
                            className={`px-3 py-1 text-xs rounded transition-colors ${
                              !aiAssistMode
                                ? "bg-background shadow-sm text-teal-700 font-medium"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                            onClick={() => { setAiAssistMode(false); setAiResult(null); }}
                          >
                            <Pencil className="h-3 w-3 inline mr-1" />手动填写
                          </button>
                        </div>
                      </div>

                      {aiAssistMode ? (
                        <div className="space-y-3">
                          {/* AI Keyword Input */}
                          {!aiResult && (
                            <div className="space-y-2">
                              <Label className="text-xs">输入关键词或卖点主题 <span className="text-red-500">*</span></Label>
                              <p className="text-xs text-muted-foreground">输入一个关键词或简短主题，AI将自动扩展为完整的FABE格式卖点</p>
                              <div className="flex gap-2">
                                <Input
                                  placeholder="例如: waterproof, eco-friendly, easy assembly, 防水设计..."
                                  value={aiKeyword}
                                  onChange={(e) => setAiKeyword(e.target.value)}
                                  className="h-9 text-sm flex-1"
                                  onKeyDown={(e) => { if (e.key === "Enter" && aiKeyword.trim()) handleAiExpand(); }}
                                />
                                <Button
                                  size="sm"
                                  onClick={handleAiExpand}
                                  disabled={!aiKeyword.trim() || expandKeyword.isPending}
                                  className="bg-teal-600 hover:bg-teal-700 h-9"
                                >
                                  {expandKeyword.isPending ? (
                                    <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />AI生成中...</>
                                  ) : (
                                    <><Wand2 className="h-3.5 w-3.5 mr-1" />AI生成FABE</>
                                  )}
                                </Button>
                              </div>
                            </div>
                          )}

                          {/* AI Result Preview & Edit */}
                          {aiResult && (
                            <div className="space-y-3 rounded-lg border border-teal-200 bg-white/80 p-3">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Sparkles className="h-4 w-4 text-teal-600" />
                                  <span className="text-sm font-medium text-teal-700">AI生成结果</span>
                                </div>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs"
                                  onClick={() => { setAiResult(null); }}
                                >
                                  <RotateCcw className="h-3 w-3 mr-1" />重新生成
                                </Button>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <div>
                                  <Label className="text-xs text-muted-foreground">主题 (EN)</Label>
                                  <Input
                                    value={aiResult.theme}
                                    onChange={(e) => setAiResult((prev: any) => ({ ...prev, theme: e.target.value }))}
                                    className="h-8 text-sm font-medium"
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs text-muted-foreground">主题 (CN)</Label>
                                  <Input
                                    value={aiResult.themeZh}
                                    onChange={(e) => setAiResult((prev: any) => ({ ...prev, themeZh: e.target.value }))}
                                    className="h-8 text-sm"
                                  />
                                </div>
                              </div>

                              <div>
                                <Label className="text-xs text-muted-foreground">描述</Label>
                                <Textarea
                                  value={aiResult.description}
                                  onChange={(e) => setAiResult((prev: any) => ({ ...prev, description: e.target.value }))}
                                  rows={2}
                                  className="text-sm resize-none"
                                />
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                {["feature", "advantage", "benefit", "evidence"].map((field) => (
                                  <div key={field}>
                                    <Label className="text-xs text-muted-foreground">
                                      {field === "feature" ? "F - 特征" : field === "advantage" ? "A - 优势" : field === "benefit" ? "B - 利益" : "E - 证据"}
                                    </Label>
                                    <Textarea
                                      value={aiResult.fabeDirection?.[field] || ""}
                                      onChange={(e) => setAiResult((prev: any) => ({
                                        ...prev,
                                        fabeDirection: { ...prev.fabeDirection, [field]: e.target.value }
                                      }))}
                                      rows={2}
                                      className="text-xs resize-none"
                                    />
                                  </div>
                                ))}
                              </div>

                              {aiResult.targetKeywords?.length > 0 && (
                                <div>
                                  <Label className="text-xs text-muted-foreground">目标关键词</Label>
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {aiResult.targetKeywords.map((kw: string, i: number) => (
                                      <Badge key={i} variant="secondary" className="text-xs">{kw}</Badge>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {aiResult.addressesGap && (
                                <div>
                                  <Label className="text-xs text-muted-foreground">解决的竞品缺口</Label>
                                  <p className="text-xs text-muted-foreground mt-0.5">{aiResult.addressesGap}</p>
                                </div>
                              )}

                              <div className="flex gap-2 pt-1">
                                <Button size="sm" onClick={handleConfirmAiResult} className="bg-teal-600 hover:bg-teal-700">
                                  <Check className="h-3.5 w-3.5 mr-1" />确认添加
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => { setAiResult(null); setAiKeyword(""); }}>取消</Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        /* Manual Mode */
                        <div className="space-y-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <Label className="text-xs">卖点主题 (英文) <span className="text-red-500">*</span></Label>
                              <Input
                                placeholder="例如: Eco-Friendly Design"
                                value={newCoreTheme}
                                onChange={(e) => setNewCoreTheme(e.target.value)}
                                className="h-8 text-sm"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">卖点主题 (中文)</Label>
                              <Input
                                placeholder="例如: 环保设计"
                                value={newCoreThemeZh}
                                onChange={(e) => setNewCoreThemeZh(e.target.value)}
                                className="h-8 text-sm"
                              />
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs">描述</Label>
                            <Textarea
                              placeholder="简要描述这条卖点应该传达什么信息..."
                              value={newCoreDescription}
                              onChange={(e) => setNewCoreDescription(e.target.value)}
                              rows={2}
                              className="text-sm resize-none"
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={handleAddManualCore} disabled={!newCoreTheme.trim()}>
                              <Plus className="h-3.5 w-3.5 mr-1" />添加
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>取消</Button>
                          </div>
                        </div>
                      )}

                      {/* Close button when in AI mode without result */}
                      {aiAssistMode && !aiResult && (
                        <div className="flex justify-end">
                          <Button size="sm" variant="ghost" onClick={() => { setShowAddForm(false); setAiAssistMode(false); setAiKeyword(""); }}>取消</Button>
                        </div>
                      )}
                    </div>
                  )}

                  {sellingPointCores.map((sp, idx) => (
                    <div key={idx} className={`rounded-lg border p-4 transition-all ${
                      confirmedCores[idx]
                        ? "border-green-300 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20"
                        : sp.isManual
                        ? "border-teal-300 bg-teal-50/30"
                        : "border-muted"
                    }`}>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={`text-xs ${sp.isManual ? "border-teal-400 text-teal-700" : ""}`}>
                            {idx + 1}
                            {sp.isManual && " (手动)"}
                          </Badge>
                          {editingCore === idx ? (
                            <Input
                              value={sp.theme}
                              onChange={(e) => handleEditCore(idx, "theme", e.target.value)}
                              className="h-7 text-sm font-medium w-48"
                            />
                          ) : (
                            <span className="text-sm font-semibold">{sp.theme}</span>
                          )}
                          {sp.themeZh && <span className="text-xs text-muted-foreground">({sp.themeZh})</span>}
                        </div>
                        <div className="flex items-center gap-1">
                          {!confirmedCores[idx] && (
                            <>
                              {sp.isManual && (
                                <Button variant="ghost" size="sm" className="h-7 px-2 text-red-500 hover:text-red-700" onClick={() => handleRemoveCore(idx)}>
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              )}
                              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setEditingCore(editingCore === idx ? null : idx)}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button variant="default" size="sm" className="h-7 px-3 bg-green-600 hover:bg-green-700" onClick={() => handleConfirmCore(idx)}>
                                <Check className="h-3 w-3 mr-1" />确认
                              </Button>
                            </>
                          )}
                          {confirmedCores[idx] && (
                            <Badge className="bg-green-600 text-white text-[10px]"><CheckCircle2 className="h-3 w-3 mr-1" />已确认</Badge>
                          )}
                        </div>
                      </div>

                      {editingCore === idx ? (
                        <div className="space-y-2 mt-3">
                          <div>
                            <Label className="text-xs">描述</Label>
                            <Textarea
                              value={sp.description}
                              onChange={(e) => handleEditCore(idx, "description", e.target.value)}
                              rows={2}
                              className="text-xs resize-none"
                            />
                          </div>
                          {sp.fabeDirection && (
                            <div className="grid grid-cols-2 gap-2">
                              {["feature", "advantage", "benefit", "evidence"].map((f) => (
                                <div key={f}>
                                  <Label className="text-xs capitalize">{f}</Label>
                                  <Input
                                    value={sp.fabeDirection[f] || ""}
                                    onChange={(e) => handleEditCoreFabe(idx, f, e.target.value)}
                                    className="h-7 text-xs"
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                          {sp.targetKeywords?.length > 0 && (
                            <div>
                              <Label className="text-xs">目标关键词</Label>
                              <Input
                                value={sp.targetKeywords.join(", ")}
                                onChange={(e) => handleEditCore(idx, "targetKeywords", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))}
                                className="h-7 text-xs"
                              />
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <p className="text-xs text-muted-foreground">{sp.description}</p>
                          {sp.descriptionZh && <p className="text-xs text-muted-foreground italic">{sp.descriptionZh}</p>}
                          {sp.fabeDirection && (
                            <div className="grid grid-cols-2 gap-1 mt-2">
                              {Object.entries(sp.fabeDirection).map(([key, val]) => (
                                val ? <div key={key} className="text-[10px] text-muted-foreground"><span className="font-medium uppercase">{key}:</span> {val as string}</div> : null
                              ))}
                            </div>
                          )}
                          {sp.targetKeywords?.length > 0 && (
                            <div className="flex gap-1 flex-wrap mt-1">
                              {sp.targetKeywords.map((kw: string, j: number) => (
                                <Badge key={j} variant="outline" className="text-[10px]">{kw}</Badge>
                              ))}
                            </div>
                          )}
                          {sp.addressesGap && (
                            <p className="text-[10px] text-teal-600 mt-1">针对: {sp.addressesGap}</p>
                          )}
                        </div>
                      )}

                      {/* Single bullet generation for this core */}
                      {confirmedCores[idx] && (
                        <div className="mt-3 pt-3 border-t">
                          {!generatedBullets[idx] ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full"
                              onClick={() => handleGenerateSingleBullet(idx)}
                              disabled={generateSingleBullet.isPending}
                            >
                              {generateSingleBullet.isPending ? (
                                <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />生成中...</>
                              ) : (
                                <><Sparkles className="h-3.5 w-3.5 mr-2" />生成第 {idx + 1} 条 Bullet Point</>
                              )}
                            </Button>
                          ) : (
                            <div className="space-y-2">
                              {editingBullet === idx ? (
                                <div className="p-3 rounded-lg bg-muted/30 border space-y-2">
                                  <div>
                                    <Label className="text-xs">小标题 (Subtitle)</Label>
                                    <Input
                                      value={editBulletData.subtitle}
                                      onChange={(e) => setEditBulletData(prev => ({ ...prev, subtitle: e.target.value }))}
                                      className="h-8 text-sm font-bold"
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs">正文 (Full Text)</Label>
                                    <Textarea
                                      value={editBulletData.fullText}
                                      onChange={(e) => setEditBulletData(prev => ({ ...prev, fullText: e.target.value }))}
                                      rows={3}
                                      className="text-sm resize-none"
                                    />
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <CharCountBadge
                                      count={(editBulletData.subtitle + " " + editBulletData.fullText).length}
                                      min={200}
                                      max={280}
                                    />
                                    <div className="flex gap-2">
                                      <Button size="sm" onClick={() => handleSaveEditBullet(idx)}>
                                        <Check className="h-3.5 w-3.5 mr-1" />保存
                                      </Button>
                                      <Button size="sm" variant="ghost" onClick={() => setEditingBullet(null)}>取消</Button>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="p-3 rounded-lg bg-muted/30 border">
                                  <div className="flex items-start justify-between gap-2">
                                    <p className="text-sm flex-1">
                                      <span className="font-bold">{generatedBullets[idx].subtitle}</span>
                                      {" \u2014 "}
                                      <span className="text-muted-foreground">{generatedBullets[idx].fullText}</span>
                                    </p>
                                    <CharCountBadge
                                      count={(generatedBullets[idx].subtitle + " " + generatedBullets[idx].fullText).length}
                                      min={200}
                                      max={280}
                                    />
                                  </div>
                                  {generatedBullets[idx].fabeBreakdown && (
                                    <div className="grid grid-cols-2 gap-1 mt-2">
                                      {Object.entries(generatedBullets[idx].fabeBreakdown).map(([key, val]) => (
                                        val ? <div key={key} className="text-[10px] text-muted-foreground"><span className="font-medium uppercase">{key}:</span> {val as string}</div> : null
                                      ))}
                                    </div>
                                  )}
                                  {generatedBullets[idx].incorporatedKeywords?.length > 0 && (
                                    <div className="flex gap-1 flex-wrap mt-1.5">
                                      <span className="text-[10px] text-muted-foreground">已埋入:</span>
                                      {generatedBullets[idx].incorporatedKeywords.map((kw: string, j: number) => (
                                        <Badge key={j} variant="outline" className="text-[10px] bg-teal-50">{kw}</Badge>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                              <div className="flex gap-2">
                                {!confirmedBullets[idx] ? (
                                  <>
                                    <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleConfirmBullet(idx)}>
                                      <Check className="h-3.5 w-3.5 mr-1" />确认此条
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => handleStartEditBullet(idx)}>
                                      <Pencil className="h-3.5 w-3.5 mr-1" />编辑
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => handleGenerateSingleBullet(idx)} disabled={generateSingleBullet.isPending}>
                                      <RotateCcw className="h-3.5 w-3.5 mr-1" />重新生成
                                    </Button>
                                  </>
                                ) : (
                                  <Badge className="bg-green-600 text-white"><CheckCircle2 className="h-3 w-3 mr-1" />已确认</Badge>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Summary when all bullets confirmed */}
                  {allBulletsConfirmed && (
                    <div className="p-4 rounded-lg border-2 border-green-300 bg-green-50/50">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                        <span className="text-sm font-semibold text-green-800">全部 {totalCoresCount} 条卖点已确认</span>
                      </div>
                      <p className="text-xs text-green-700 mb-3">所有卖点已精雕完成，点击"同步到预览页"将卖点内容更新到Listing预览页面，然后可在预览页进行编辑和中英文翻译</p>
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={handleSyncBullets} disabled={syncBulletsMut.isPending}>
                          {syncBulletsMut.isPending ? (
                            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />同步中...</>
                          ) : (
                            <><Upload className="h-4 w-4 mr-2" />同步到预览页</>
                          )}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setLocation("/listing/preview")}>
                          <FileText className="h-4 w-4 mr-2" />查看完整预览
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Partial sync option when some bullets are confirmed */}
                  {!allBulletsConfirmed && confirmedBulletCount > 0 && (
                    <div className="p-3 rounded-lg border border-amber-200 bg-amber-50/30">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-amber-700">
                          已确认 {confirmedBulletCount}/{totalCoresCount} 条卖点
                          {confirmedBulletCount >= 5 && "（已达最低5条，可先同步已确认的卖点）"}
                        </p>
                        {confirmedBulletCount >= 5 && (
                          <Button size="sm" variant="outline" className="text-xs" onClick={handleSyncBullets} disabled={syncBulletsMut.isPending}>
                            <Upload className="h-3.5 w-3.5 mr-1" />
                            先同步已确认的 {confirmedBulletCount} 条
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      {/* Keyword Import Dialog */}
      <Dialog open={showKeywordImport} onOpenChange={setShowKeywordImport}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="h-5 w-5 text-teal-600" />
              从关键词管理导入
            </DialogTitle>
            <DialogDescription>
              选择关键词后将自动填入AI辅助生成的输入框，点击“AI生成FABE”即可将关键词扩展为完整卖点
            </DialogDescription>
          </DialogHeader>

          {/* Search & Filters */}
          <div className="space-y-2 px-1">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="搜索关键词或中文翻译..."
                  value={kwSearchTerm}
                  onChange={(e) => setKwSearchTerm(e.target.value)}
                  className="pl-9 h-9 text-sm"
                />
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">策略分类:</Label>
                <select
                  value={kwFilterStrategy}
                  onChange={(e) => setKwFilterStrategy(e.target.value)}
                  className="h-7 text-xs border rounded px-2 bg-background"
                >
                  <option value="all">全部</option>
                  <option value="core_main">核心主词</option>
                  <option value="sub_core">次核心词</option>
                  <option value="precise_longtail">精准长尾词</option>
                  <option value="scene_intent">场景意图词</option>
                  <option value="longtail_main">长尾主词</option>
                  <option value="observe_test">观察测试词</option>
                  <option value="brand_offensive">品牌进攻词</option>
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Listing位置:</Label>
                <select
                  value={kwFilterPlacement}
                  onChange={(e) => setKwFilterPlacement(e.target.value)}
                  className="h-7 text-xs border rounded px-2 bg-background"
                >
                  <option value="all">全部</option>
                  <option value="title_front">标题前段</option>
                  <option value="title_mid">标题中后段</option>
                  <option value="title_end">标题末尾</option>
                  <option value="bullet_first">五点描述首句</option>
                  <option value="bullet_body">五点描述融入</option>
                  <option value="aplus">A+核心文案</option>
                  <option value="search_term">后台Search Term</option>
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">月搜索量:</Label>
                <Button
                  variant={kwSortOrder !== "none" ? "secondary" : "outline"}
                  size="sm"
                  className="h-7 text-xs px-2 gap-1"
                  onClick={() => setKwSortOrder(prev => prev === "none" ? "desc" : prev === "desc" ? "asc" : "none")}
                >
                  <ArrowUpDown className="h-3 w-3" />
                  {kwSortOrder === "desc" ? "降序" : kwSortOrder === "asc" ? "升序" : "排序"}
                </Button>
              </div>
              {(kwSearchTerm || kwFilterStrategy !== "all" || kwFilterPlacement !== "all" || kwSortOrder !== "none") && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={() => { setKwSearchTerm(""); setKwFilterStrategy("all"); setKwFilterPlacement("all"); setKwSortOrder("none"); }}
                >
                  <X className="h-3 w-3 mr-1" />清除筛选
                </Button>
              )}
            </div>
          </div>

          {/* Keyword List */}
          <div className="flex-1 min-h-0">
            {kwLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">加载关键词中...</span>
              </div>
            ) : filteredKeywords.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Search className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">{allKeywords?.length ? "没有符合筛选条件的关键词" : "该项目还没有关键词数据"}</p>
                <p className="text-xs mt-1">{allKeywords?.length ? "请调整筛选条件" : "请先在关键词管理模块中导入关键词"}</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between px-1 py-1.5">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={filteredKeywords.length > 0 && filteredKeywords.every((kw: any) => selectedKeywordIds.has(kw.id))}
                      onCheckedChange={handleSelectAllFiltered}
                    />
                    <span className="text-xs text-muted-foreground">
                      全选 ({filteredKeywords.length} 个关键词)
                    </span>
                  </div>
                  {selectedKeywordIds.size > 0 && (
                    <Badge variant="secondary" className="text-xs">已选 {selectedKeywordIds.size} 个</Badge>
                  )}
                </div>
                <ScrollArea className="h-[320px] border rounded-md">
                  <div className="divide-y">
                    {filteredKeywords.map((kw: any) => (
                      <div
                        key={kw.id}
                        className={`flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer transition-colors ${
                          selectedKeywordIds.has(kw.id) ? "bg-teal-50/50 dark:bg-teal-950/20" : ""
                        }`}
                        onClick={() => toggleKeywordSelection(kw.id)}
                      >
                        <Checkbox
                          checked={selectedKeywordIds.has(kw.id)}
                          onCheckedChange={() => toggleKeywordSelection(kw.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">{kw.keyword}</span>
                            {kw.translationCn && (
                              <span className="text-xs text-muted-foreground truncate">({kw.translationCn})</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            {kw.monthlySearchVolume != null && (
                              <span className="text-xs text-muted-foreground">月搜: {kw.monthlySearchVolume.toLocaleString()}</span>
                            )}
                            {kw.relevance && (
                              <Badge variant="outline" className={`text-[10px] px-1 py-0 ${
                                kw.relevance === "high" ? "border-green-300 text-green-700" :
                                kw.relevance === "medium" ? "border-yellow-300 text-yellow-700" :
                                "border-gray-300 text-gray-500"
                              }`}>
                                {kw.relevance === "high" ? "高相关" : kw.relevance === "medium" ? "中相关" : "低相关"}
                              </Badge>
                            )}
                            {kw.strategyCategory && (
                              <Badge variant="secondary" className="text-[10px] px-1 py-0">
                                {({core_main:"核心主词",sub_core:"次核心",precise_longtail:"精准长尾",scene_intent:"场景意图",longtail_main:"长尾主词",observe_test:"观察测试",brand_offensive:"品牌进攻"} as Record<string,string>)[kw.strategyCategory] || kw.strategyCategory}
                              </Badge>
                            )}
                            {kw.listingPlacement && (
                              <Badge variant="outline" className="text-[10px] px-1 py-0">
                                {({title_front:"标题前段",title_mid:"标题中后",title_end:"标题末尾",bullet_first:"五点首句",bullet_body:"五点融入",aplus:"A+文案",search_term:"Search Term",not_use:"不使用"} as Record<string,string>)[kw.listingPlacement] || kw.listingPlacement}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </>
            )}
          </div>

          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <p className="text-xs text-muted-foreground">
              选中的关键词将合并填入AI辅助生成输入框
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowKeywordImport(false)}>取消</Button>
              <Button
                size="sm"
                onClick={handleImportSelectedKeywords}
                disabled={selectedKeywordIds.size === 0}
                className="bg-teal-600 hover:bg-teal-700"
              >
                <Download className="h-3.5 w-3.5 mr-1" />
                导入已选 ({selectedKeywordIds.size})
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
