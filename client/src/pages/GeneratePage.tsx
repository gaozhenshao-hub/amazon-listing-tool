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
  Type,
  List,
  FileText,
  Key,
  Image,
  Zap,
  CheckCircle2,
  AlertCircle,
  Languages,
  ArrowRight,
  Tag,
  GitBranch,
  LayoutGrid,
  Search,
  FlaskConical,
  Check,
  Cpu,
  Heart,
  BarChart3,
  Shuffle,
  Eye,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type GenerationResult = {
  listing?: any;
  titleOptions?: any;
  bulletPointsData?: any;
  descriptionData?: any;
  searchTermsData?: any;
  imageAdviceData?: any;
  chineseTranslation?: {
    titleCn: string;
    bulletPointsCn: any[];
    descriptionCn: string;
    searchTermsCn: string;
  };
};

function CharCountBadge({ count, min, max, label }: { count: number; min: number; max: number; label?: string }) {
  const inRange = count >= min && count <= max;
  const tooShort = count < min;
  const tooLong = count > max;

  return (
    <Badge
      variant={inRange ? "default" : "destructive"}
      className={`text-xs ${inRange ? "bg-green-600" : tooShort ? "bg-amber-500" : "bg-red-500"}`}
    >
      {count} / {min}-{max} {label || "字符"}
      {inRange && " ✓"}
      {tooShort && " ↑偏短"}
      {tooLong && " ↓偏长"}
    </Badge>
  );
}

export default function GeneratePage() {
  const { selectedProjectId } = useProject();
  const [, setLocation] = useLocation();
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [generatingPart, setGeneratingPart] = useState<string | null>(null);
  const [partResults, setPartResults] = useState<Record<string, any>>({});
  const [abVariants, setAbVariants] = useState<any[] | null>(null);
  const [abDialogOpen, setAbDialogOpen] = useState(false);
  const [applyingVariant, setApplyingVariant] = useState<string | null>(null);
  // Mixed selection state: pick title from one variant, each bullet from any variant
  const [selectedTitleVariant, setSelectedTitleVariant] = useState<string | null>(null);
  const [selectedTitleIdx, setSelectedTitleIdx] = useState<number>(0);
  const [selectedBullets, setSelectedBullets] = useState<Array<{ variantId: string; bulletIdx: number }>>([]);
  const [mixedMode, setMixedMode] = useState<"browse" | "mix">("browse");

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

  // Calculate keyword analysis readiness
  const kwReadiness = (() => {
    if (!keywordStats || keywordStats.total === 0) return null;
    const hasSceneTags = (keywordStats.byStatus?.tagged || 0) + (keywordStats.byStatus?.finalized || 0) > 0;
    const hasStrategy = Object.keys(keywordStats.byStrategy || {}).length > 0;
    const hasRoots = Object.keys(keywordStats.byRoot || {}).length > 0;
    const taggedCount = (keywordStats.byStatus?.tagged || 0) + (keywordStats.byStatus?.finalized || 0);
    const taggedPercent = Math.round((taggedCount / keywordStats.total) * 100);
    const steps = [
      { key: "import", label: "关键词导入", done: keywordStats.total > 0, icon: Search, count: keywordStats.total },
      { key: "scene", label: "场景打标", done: hasSceneTags, icon: Tag, count: taggedCount },
      { key: "root", label: "词根分类", done: hasRoots, icon: GitBranch, count: Object.values(keywordStats.byRoot || {}).reduce((a: number, b: number) => a + b, 0) },
      { key: "strategy", label: "策略矩阵", done: hasStrategy, icon: LayoutGrid, count: Object.values(keywordStats.byStrategy || {}).reduce((a: number, b: number) => a + b, 0) },
    ];
    const completedSteps = steps.filter(s => s.done).length;
    return { steps, completedSteps, total: steps.length, taggedPercent, allDone: completedSteps === steps.length };
  })();

  const generateFull = trpc.listing.generateFull.useMutation({
    onSuccess: (data) => {
      setResult(data);
      toast.success("Listing生成完成！");
    },
    onError: (err) => toast.error("生成失败: " + err.message),
  });

  const generateTitle = trpc.listing.generateTitle.useMutation({
    onSuccess: (data) => {
      setPartResults((prev) => ({ ...prev, title: data }));
      setGeneratingPart(null);
      toast.success("标题生成完成");
    },
    onError: (err) => { setGeneratingPart(null); toast.error("生成失败: " + err.message); },
  });

  const generateBulletPoints = trpc.listing.generateBulletPoints.useMutation({
    onSuccess: (data) => {
      setPartResults((prev) => ({ ...prev, bulletPoints: data }));
      setGeneratingPart(null);
      toast.success("五点描述生成完成");
    },
    onError: (err) => { setGeneratingPart(null); toast.error("生成失败: " + err.message); },
  });

  const generateDescription = trpc.listing.generateDescription.useMutation({
    onSuccess: (data) => {
      setPartResults((prev) => ({ ...prev, description: data }));
      setGeneratingPart(null);
      toast.success("产品描述生成完成");
    },
    onError: (err) => { setGeneratingPart(null); toast.error("生成失败: " + err.message); },
  });

  const generateSearchTerms = trpc.listing.generateSearchTerms.useMutation({
    onSuccess: (data) => {
      setPartResults((prev) => ({ ...prev, searchTerms: data }));
      setGeneratingPart(null);
      toast.success("搜索词生成完成");
    },
    onError: (err) => { setGeneratingPart(null); toast.error("生成失败: " + err.message); },
  });

  const generateImageAdvice = trpc.listing.generateImageAdvice.useMutation({
    onSuccess: (data) => {
      setPartResults((prev) => ({ ...prev, imageAdvice: data }));
      setGeneratingPart(null);
      toast.success("图片建议生成完成");
    },
    onError: (err) => { setGeneratingPart(null); toast.error("生成失败: " + err.message); },
  });

  const generateABTest = trpc.listing.generateABTest.useMutation({
    onSuccess: (data) => {
      setAbVariants(data.variants);
      setAbDialogOpen(true);
      setMixedMode("browse");
      toast.success("A/B测试版本生成完成！");
    },
    onError: (err) => toast.error("A/B生成失败: " + err.message),
  });

  const applyABVariant = trpc.listing.applyABVariant.useMutation({
    onSuccess: (data) => {
      setApplyingVariant(null);
      setAbDialogOpen(false);
      setAbVariants(null);
      toast.success(`已应用所选版本，更新了: ${data.applied.join(", ")}`);
    },
    onError: (err) => { setApplyingVariant(null); toast.error("应用失败: " + err.message); },
  });

  const handleGenerateABTest = () => {
    if (!selectedProjectId) return;
    generateABTest.mutate({ projectId: selectedProjectId, components: ["title", "bulletPoints"] });
  };

  const handleApplyVariant = (variant: any) => {
    if (!selectedProjectId) return;
    setApplyingVariant(variant.id);
    const applyData: any = { projectId: selectedProjectId };
    if (variant.titleData?.recommendedTitle) {
      applyData.title = variant.titleData.recommendedTitle;
    } else if (variant.titleData?.titles?.[0]?.title) {
      applyData.title = variant.titleData.titles[0].title;
    }
    if (variant.bulletData?.bulletPoints) {
      applyData.bulletPoints = JSON.stringify(variant.bulletData.bulletPoints);
    }
    applyABVariant.mutate(applyData);
  };

  // Initialize mixed selection when entering mix mode
  const initMixedSelection = () => {
    if (!abVariants || abVariants.length === 0) return;
    setSelectedTitleVariant(abVariants[0].id);
    setSelectedTitleIdx(0);
    // Default: all 5 bullets from first variant
    const firstVariant = abVariants[0];
    const bulletCount = firstVariant.bulletData?.bulletPoints?.length || 5;
    setSelectedBullets(
      Array.from({ length: bulletCount }, (_, i) => ({ variantId: firstVariant.id, bulletIdx: i }))
    );
    setMixedMode("mix");
  };

  // Get selected title text
  const getSelectedTitle = () => {
    if (!abVariants || !selectedTitleVariant) return "";
    const v = abVariants.find((v: any) => v.id === selectedTitleVariant);
    if (!v) return "";
    const titles = v.titleData?.titles || [];
    if (titles[selectedTitleIdx]?.title) return titles[selectedTitleIdx].title;
    if (v.titleData?.recommendedTitle) return v.titleData.recommendedTitle;
    return titles[0]?.title || "";
  };

  // Get selected bullet points as array
  const getSelectedBulletPoints = () => {
    if (!abVariants || selectedBullets.length === 0) return [];
    return selectedBullets.map((sel) => {
      const v = abVariants.find((v: any) => v.id === sel.variantId);
      if (!v) return null;
      return v.bulletData?.bulletPoints?.[sel.bulletIdx] || null;
    }).filter(Boolean);
  };

  // Apply mixed selection
  const handleApplyMixed = () => {
    if (!selectedProjectId) return;
    setApplyingVariant("mixed");
    const applyData: any = { projectId: selectedProjectId };
    const title = getSelectedTitle();
    if (title) applyData.title = title;
    const bullets = getSelectedBulletPoints();
    if (bullets.length > 0) applyData.bulletPoints = JSON.stringify(bullets);
    applyABVariant.mutate(applyData);
  };

  const styleIcons: Record<string, any> = {
    professional: Cpu,
    emotional: Heart,
    datadriven: BarChart3,
  };

  const styleColors: Record<string, string> = {
    professional: "text-blue-600 bg-blue-50 border-blue-200",
    emotional: "text-rose-600 bg-rose-50 border-rose-200",
    datadriven: "text-emerald-600 bg-emerald-50 border-emerald-200",
  };

  const styleBadgeColors: Record<string, string> = {
    professional: "bg-blue-100 text-blue-700 border-blue-300",
    emotional: "bg-rose-100 text-rose-700 border-rose-300",
    datadriven: "bg-emerald-100 text-emerald-700 border-emerald-300",
  };

  const handleGenerateFull = () => {
    if (!selectedProjectId) return;
    setResult(null);
    setPartResults({});
    generateFull.mutate({ projectId: selectedProjectId });
  };

  const handleGeneratePart = (part: string) => {
    if (!selectedProjectId) return;
    setGeneratingPart(part);
    switch (part) {
      case "title":
        generateTitle.mutate({ projectId: selectedProjectId });
        break;
      case "bulletPoints":
        generateBulletPoints.mutate({ projectId: selectedProjectId });
        break;
      case "description":
        generateDescription.mutate({ projectId: selectedProjectId });
        break;
      case "searchTerms":
        generateSearchTerms.mutate({ projectId: selectedProjectId });
        break;
      case "imageAdvice":
        generateImageAdvice.mutate({ projectId: selectedProjectId });
        break;
    }
  };

  const isGenerating = generateFull.isPending;
  const hasResult = result || Object.keys(partResults).length > 0;

  const generationParts = [
    { key: "title", label: "标题", desc: "180-200字符", icon: Type, color: "text-blue-600" },
    { key: "bulletPoints", label: "五点描述", desc: "每条200-280字符", icon: List, color: "text-green-600" },
    { key: "description", label: "产品描述", desc: "2000字符内", icon: FileText, color: "text-purple-600" },
    { key: "searchTerms", label: "搜索关键词", desc: "250字节内", icon: Key, color: "text-amber-600" },
    { key: "imageAdvice", label: "图片建议", desc: "首图+辅图+A+", icon: Image, color: "text-pink-600" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Listing 生成</h1>
          <p className="text-muted-foreground mt-1">
            基于产品信息和竞品分析，AI自动生成优化的Amazon Listing
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
                  <p className="text-sm font-medium text-blue-900">亚马逊字符数规则</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-blue-700">
                    <span>标题：<strong>180-200</strong> 字符（充分利用空间）</span>
                    <span>五点描述：每条 <strong>200-280</strong> 字符（不超过280）</span>
                    <span>搜索词：<strong>250</strong> 字节内</span>
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
                      onClick={() => setLocation("/keywords")}
                    >
                      前往关键词管理
                      <ArrowRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Generation Options */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* One-click full generation */}
            <Card className="lg:col-span-1 border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-primary" />
                  一键生成
                </CardTitle>
                <CardDescription>
                  同时生成标题、五点、描述、关键词、图片建议及中文翻译
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleGenerateFull}
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      AI生成中...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      一键生成全部
                    </>
                  )}
                </Button>
                {isGenerating && (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs text-muted-foreground text-center">
                      正在并行生成所有内容，请稍候...
                    </p>
                    <Progress value={undefined} className="h-1" />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Individual generation */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>分步生成</CardTitle>
                <CardDescription>
                  逐项生成Listing内容，可以单独重新生成不满意的部分
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {generationParts.map((part) => (
                    <Button
                      key={part.key}
                      variant="outline"
                      className="justify-start h-auto py-3 px-4"
                      onClick={() => handleGeneratePart(part.key)}
                      disabled={generatingPart === part.key || isGenerating}
                    >
                      {generatingPart === part.key ? (
                        <Loader2 className="h-4 w-4 mr-3 animate-spin shrink-0" />
                      ) : partResults[part.key] || (result && (result as any)[part.key + "Data"]) ? (
                        <CheckCircle2 className="h-4 w-4 mr-3 text-green-500 shrink-0" />
                      ) : (
                        <part.icon className={`h-4 w-4 mr-3 shrink-0 ${part.color}`} />
                      )}
                      <div className="text-left">
                        <p className="text-sm font-medium">{part.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {generatingPart === part.key ? "生成中..." :
                            partResults[part.key] || (result && (result as any)[part.key + "Data"])
                              ? `已生成 · 点击重新生成`
                              : part.desc}
                        </p>
                      </div>
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* A/B Test Section */}
          <Card className="border-purple-200 bg-gradient-to-br from-purple-50/50 to-transparent dark:from-purple-950/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FlaskConical className="h-5 w-5 text-purple-600" />
                A/B 测试版本
              </CardTitle>
              <CardDescription>
                同时生成3种不同风格的标题和五点描述，对比选择最佳版本应用到当前Listing
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                {[
                  { id: "professional", name: "专业技术型", icon: Cpu, color: "text-blue-600", desc: "规格参数、技术优势、认证标准" },
                  { id: "emotional", name: "情感场景型", icon: Heart, color: "text-rose-600", desc: "使用场景、情感共鸣、生活方式" },
                  { id: "datadriven", name: "数据驱动型", icon: BarChart3, color: "text-emerald-600", desc: "数据对比、量化优势、竞品差异" },
                ].map((s) => (
                  <div key={s.id} className="flex items-start gap-3 p-3 rounded-lg border bg-background/50">
                    <s.icon className={`h-5 w-5 ${s.color} shrink-0 mt-0.5`} />
                    <div>
                      <p className="text-sm font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <Button
                className="w-full"
                variant="outline"
                onClick={handleGenerateABTest}
                disabled={generateABTest.isPending || isGenerating}
              >
                {generateABTest.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    正在生成3种风格变体...
                  </>
                ) : (
                  <>
                    <FlaskConical className="h-4 w-4 mr-2" />
                    生成 A/B 测试版本
                  </>
                )}
              </Button>
              {generateABTest.isPending && (
                <div className="mt-3">
                  <Progress value={undefined} className="h-1" />
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    正在并行生成3种风格的标题和五点描述，预计需要30-60秒...
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Results Preview */}
          {hasResult && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">生成结果预览</h2>
                <Button variant="outline" onClick={() => setLocation("/preview")}>
                  <FileText className="h-4 w-4 mr-2" />
                  查看完整预览
                </Button>
              </div>

              {/* Title Preview - Bilingual */}
              {(partResults.title || result?.titleOptions) && (
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Type className="h-4 w-4 text-blue-600" />
                        标题选项
                      </CardTitle>
                      <span className="text-xs text-muted-foreground">目标: 180-200 字符</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {((partResults.title || result?.titleOptions)?.titles || []).map((t: any, i: number) => {
                      const actualCount = t.title ? t.title.length : 0;
                      return (
                        <div key={i} className={`p-3 rounded-lg border ${
                          i === 0 ? "border-primary/30 bg-primary/5" : "bg-muted/30"
                        }`}>
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium flex-1">{t.title}</p>
                            <CharCountBadge count={actualCount} min={180} max={200} />
                          </div>
                          {t.strategy && (
                            <p className="text-xs text-muted-foreground mt-2">{t.strategy}</p>
                          )}
                          {t.coreKeywords && (
                            <div className="flex gap-1.5 mt-2 flex-wrap">
                              {t.coreKeywords.map((k: string, j: number) => (
                                <Badge key={j} variant="outline" className="text-xs">{k}</Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {/* Chinese title translation */}
                    {result?.chineseTranslation?.titleCn && (
                      <div className="mt-3 p-3 rounded-lg border border-orange-200 bg-orange-50/50">
                        <div className="flex items-center gap-2 mb-2">
                          <Languages className="h-3.5 w-3.5 text-orange-600" />
                          <span className="text-xs font-medium text-orange-700">中文翻译</span>
                        </div>
                        <p className="text-sm text-orange-900">{result.chineseTranslation.titleCn}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Bullet Points Preview - Bilingual */}
              {(partResults.bulletPoints || result?.bulletPointsData) && (
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <List className="h-4 w-4 text-green-600" />
                        五点描述
                        {(result?.chineseTranslation?.bulletPointsCn?.length ?? 0) > 0 && (
                          <Badge variant="outline" className="text-xs ml-2 border-orange-300 text-orange-600">
                            <Languages className="h-3 w-3 mr-1" />
                            中英对照
                          </Badge>
                        )}
                      </CardTitle>
                      <span className="text-xs text-muted-foreground">目标: 每条 200-280 字符</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {((partResults.bulletPoints || result?.bulletPointsData)?.bulletPoints || []).map((bp: any, i: number) => {
                      const fullBullet = bp.subtitle && bp.fullText
                        ? `${bp.subtitle} ${bp.fullText}`
                        : bp.fullText || bp.subtitle || "";
                      const actualCount = fullBullet.length;
                      const cnBp = result?.chineseTranslation?.bulletPointsCn?.[i];
                      return (
                        <div key={i} className="rounded-lg border overflow-hidden">
                          {/* English */}
                          <div className="p-3 bg-muted/30">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm flex-1">
                                <span className="font-bold">{bp.subtitle || `卖点 ${i + 1}`}</span>
                                {" — "}
                                <span className="text-muted-foreground">{bp.fullText || bp.sellingPoint || ""}</span>
                              </p>
                              <CharCountBadge count={actualCount} min={200} max={280} />
                            </div>
                          </div>
                          {/* Chinese */}
                          {cnBp && (
                            <div className="p-3 bg-orange-50/50 border-t border-orange-200">
                              <div className="flex items-start gap-2">
                                <Languages className="h-3.5 w-3.5 text-orange-500 mt-0.5 shrink-0" />
                                <p className="text-sm text-orange-900">
                                  <span className="font-bold">{cnBp.subtitle || ""}</span>
                                  {cnBp.subtitle && cnBp.fullText && " — "}
                                  <span className="text-orange-700">{cnBp.fullText || ""}</span>
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {((partResults.bulletPoints || result?.bulletPointsData)?.totalCharacterCount) && (
                      <div className="text-xs text-muted-foreground text-right">
                        五点总字符数: {(partResults.bulletPoints || result?.bulletPointsData).totalCharacterCount}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Search Terms Preview - Bilingual */}
              {(partResults.searchTerms || result?.searchTermsData) && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Key className="h-4 w-4 text-amber-600" />
                      后台搜索词
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="p-3 bg-muted/30 rounded-lg border">
                      <p className="text-xs font-medium text-muted-foreground mb-1">English</p>
                      <p className="text-sm font-mono break-all">
                        {(partResults.searchTerms || result?.searchTermsData)?.searchTerms || ""}
                      </p>
                      <Badge variant="outline" className="text-xs mt-2">
                        {(partResults.searchTerms || result?.searchTermsData)?.byteCount || 0} / 250 bytes
                      </Badge>
                    </div>
                    {result?.chineseTranslation?.searchTermsCn && (
                      <div className="p-3 bg-orange-50/50 rounded-lg border border-orange-200">
                        <div className="flex items-center gap-2 mb-1">
                          <Languages className="h-3.5 w-3.5 text-orange-600" />
                          <span className="text-xs font-medium text-orange-700">中文搜索词</span>
                        </div>
                        <p className="text-sm font-mono break-all text-orange-900">
                          {result.chineseTranslation.searchTermsCn}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
      {/* A/B Test Comparison Dialog */}
      <Dialog open={abDialogOpen} onOpenChange={(open) => { setAbDialogOpen(open); if (!open) setMixedMode("browse"); }}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-purple-600" />
              A/B 测试版本对比
            </DialogTitle>
            <DialogDescription>
              {mixedMode === "browse" ? "浏览3种风格，整体应用或切换到混合模式自由组合" : "从不同风格中自由挑选标题和五点描述，组合成最佳版本"}
            </DialogDescription>
          </DialogHeader>

          {/* Mode toggle */}
          {abVariants && (
            <div className="flex gap-2 mt-2">
              <Button
                variant={mixedMode === "browse" ? "default" : "outline"}
                size="sm"
                onClick={() => setMixedMode("browse")}
                className="text-xs"
              >
                <Eye className="h-3.5 w-3.5 mr-1.5" />
                浏览模式
              </Button>
              <Button
                variant={mixedMode === "mix" ? "default" : "outline"}
                size="sm"
                onClick={initMixedSelection}
                className="text-xs"
              >
                <Shuffle className="h-3.5 w-3.5 mr-1.5" />
                自由组合模式
              </Button>
            </div>
          )}

          {/* Browse Mode - original tab-based view */}
          {abVariants && mixedMode === "browse" && (
            <Tabs defaultValue={abVariants[0]?.id} className="mt-4">
              <TabsList className="grid grid-cols-3 w-full">
                {abVariants.map((v: any) => {
                  const Icon = styleIcons[v.id] || Cpu;
                  return (
                    <TabsTrigger key={v.id} value={v.id} className="flex items-center gap-1.5 text-xs">
                      <Icon className="h-3.5 w-3.5" />
                      {v.name}
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              {abVariants.map((variant: any) => {
                const Icon = styleIcons[variant.id] || Cpu;
                const colorClass = styleColors[variant.id] || "";
                const badgeColor = styleBadgeColors[variant.id] || "";
                return (
                  <TabsContent key={variant.id} value={variant.id} className="space-y-4 mt-4">
                    <div className={`flex items-center gap-3 p-3 rounded-lg border ${colorClass}`}>
                      <Icon className="h-5 w-5 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold">{variant.name} ({variant.nameEn})</p>
                        <p className="text-xs opacity-80">{variant.description}</p>
                      </div>
                    </div>

                    {variant.titleData?.titles && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold flex items-center gap-2">
                          <Type className="h-4 w-4 text-blue-600" /> 标题选项
                        </h4>
                        {variant.titleData.titles.map((t: any, i: number) => (
                          <div key={i} className={`p-3 rounded-lg border ${i === 0 ? "border-primary/30 bg-primary/5" : "bg-muted/30"}`}>
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm flex-1">{t.title}</p>
                              <CharCountBadge count={t.title?.length || 0} min={180} max={200} />
                            </div>
                            {t.strategy && <p className="text-xs text-muted-foreground mt-1.5">{t.strategy}</p>}
                            {t.coreKeywords && (
                              <div className="flex gap-1 mt-1.5 flex-wrap">
                                {t.coreKeywords.map((k: string, j: number) => (
                                  <Badge key={j} variant="outline" className={`text-[10px] ${badgeColor}`}>{k}</Badge>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {variant.bulletData?.bulletPoints && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold flex items-center gap-2">
                          <List className="h-4 w-4 text-green-600" /> 五点描述
                        </h4>
                        {variant.bulletData.bulletPoints.map((bp: any, i: number) => {
                          const fullBullet = bp.subtitle && bp.fullText ? `${bp.subtitle} ${bp.fullText}` : bp.fullText || bp.subtitle || "";
                          return (
                            <div key={i} className="p-3 rounded-lg border bg-muted/30">
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-sm flex-1">
                                  <span className="font-bold">{bp.subtitle || `卖点 ${i + 1}`}</span>
                                  {" \u2014 "}
                                  <span className="text-muted-foreground">{bp.fullText || bp.sellingPoint || ""}</span>
                                </p>
                                <CharCountBadge count={fullBullet.length} min={200} max={280} />
                              </div>
                              {bp.fabeBreakdown && (
                                <div className="grid grid-cols-2 gap-1.5 mt-2">
                                  {Object.entries(bp.fabeBreakdown).map(([key, val]) => (
                                    val ? <div key={key} className="text-[10px] text-muted-foreground"><span className="font-medium uppercase">{key}:</span> {val as string}</div> : null
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="flex justify-between pt-2 border-t">
                      <Button variant="outline" size="sm" onClick={initMixedSelection}>
                        <Shuffle className="h-4 w-4 mr-2" /> 自由组合
                      </Button>
                      <Button onClick={() => handleApplyVariant(variant)} disabled={applyingVariant !== null} className="min-w-[160px]">
                        {applyingVariant === variant.id ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />应用中...</>) : (<><Check className="h-4 w-4 mr-2" />应用此版本</>)}
                      </Button>
                    </div>
                  </TabsContent>
                );
              })}
            </Tabs>
          )}

          {/* Mixed Selection Mode */}
          {abVariants && mixedMode === "mix" && (
            <div className="mt-4 space-y-6">
              {/* Title Selection */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <Type className="h-4 w-4 text-blue-600" />
                  选择标题
                  <span className="text-xs text-muted-foreground font-normal">（从任意风格中选择一个标题）</span>
                </h4>
                <div className="space-y-2">
                  {abVariants.map((variant: any) => {
                    const Icon = styleIcons[variant.id] || Cpu;
                    const colorClass = styleColors[variant.id] || "";
                    const titles = variant.titleData?.titles || [];
                    const recTitle = variant.titleData?.recommendedTitle;
                    // Use recommended title or first title
                    const displayTitle = recTitle || titles[0]?.title || "";
                    const displayIdx = recTitle ? -1 : 0;
                    const isSelected = selectedTitleVariant === variant.id;
                    return (
                      <div
                        key={variant.id}
                        className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                          isSelected
                            ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                            : "border-muted hover:border-muted-foreground/30"
                        }`}
                        onClick={() => {
                          setSelectedTitleVariant(variant.id);
                          setSelectedTitleIdx(displayIdx === -1 ? 0 : displayIdx);
                        }}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
                            <Icon className="h-3 w-3" />
                            {variant.name}
                          </div>
                          {isSelected && <Badge className="text-[10px] bg-primary text-primary-foreground">已选</Badge>}
                          <CharCountBadge count={displayTitle.length} min={180} max={200} />
                        </div>
                        <p className="text-sm">{displayTitle}</p>
                        {titles.length > 1 && (
                          <div className="mt-2 space-y-1">
                            {titles.map((t: any, ti: number) => {
                              if (recTitle && ti === 0 && t.title === recTitle) return null;
                              const isTitleSelected = isSelected && selectedTitleIdx === ti;
                              return (
                                <div
                                  key={ti}
                                  className={`p-2 rounded text-xs border cursor-pointer transition-all ${
                                    isTitleSelected ? "border-primary/50 bg-primary/10" : "border-transparent hover:bg-muted/50"
                                  }`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedTitleVariant(variant.id);
                                    setSelectedTitleIdx(ti);
                                  }}
                                >
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-muted-foreground">备选 {ti + 1}:</span>
                                    {isTitleSelected && <Badge className="text-[9px] bg-primary text-primary-foreground">已选</Badge>}
                                  </div>
                                  <p className="mt-0.5">{t.title}</p>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Bullet Points Selection */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <List className="h-4 w-4 text-green-600" />
                  选择五点描述
                  <span className="text-xs text-muted-foreground font-normal">（每条可从不同风格中选择）</span>
                </h4>
                {(() => {
                  const maxBullets = Math.max(...abVariants.map((v: any) => v.bulletData?.bulletPoints?.length || 0));
                  return Array.from({ length: maxBullets }, (_, bulletIdx) => (
                    <div key={bulletIdx} className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">卖点 {bulletIdx + 1}</p>
                      <div className="grid gap-2">
                        {abVariants.map((variant: any) => {
                          const bp = variant.bulletData?.bulletPoints?.[bulletIdx];
                          if (!bp) return null;
                          const Icon = styleIcons[variant.id] || Cpu;
                          const colorClass = styleColors[variant.id] || "";
                          const isSelected = selectedBullets[bulletIdx]?.variantId === variant.id && selectedBullets[bulletIdx]?.bulletIdx === bulletIdx;
                          const fullBullet = bp.subtitle && bp.fullText ? `${bp.subtitle} ${bp.fullText}` : bp.fullText || bp.subtitle || "";
                          return (
                            <div
                              key={variant.id}
                              className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                                isSelected
                                  ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                                  : "border-muted hover:border-muted-foreground/30"
                              }`}
                              onClick={() => {
                                setSelectedBullets((prev) => {
                                  const next = [...prev];
                                  // Ensure array is long enough
                                  while (next.length <= bulletIdx) {
                                    next.push({ variantId: abVariants[0].id, bulletIdx: next.length });
                                  }
                                  next[bulletIdx] = { variantId: variant.id, bulletIdx };
                                  return next;
                                });
                              }}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${colorClass}`}>
                                  <Icon className="h-2.5 w-2.5" />
                                  {variant.name}
                                </div>
                                {isSelected && <Badge className="text-[9px] bg-primary text-primary-foreground">已选</Badge>}
                                <CharCountBadge count={fullBullet.length} min={200} max={280} />
                              </div>
                              <p className="text-sm">
                                <span className="font-bold">{bp.subtitle || `卖点 ${bulletIdx + 1}`}</span>
                                {" \u2014 "}
                                <span className="text-muted-foreground">{bp.fullText || bp.sellingPoint || ""}</span>
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ));
                })()}
              </div>

              {/* Combined Preview */}
              <div className="space-y-3 p-4 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <Eye className="h-4 w-4 text-primary" />
                  组合预览
                </h4>
                <div className="space-y-2">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">标题</p>
                    <p className="text-sm font-medium">{getSelectedTitle() || "未选择标题"}</p>
                    {selectedTitleVariant && (
                      <Badge variant="outline" className={`text-[9px] mt-1 ${styleBadgeColors[selectedTitleVariant] || ""}`}>
                        来自: {abVariants.find((v: any) => v.id === selectedTitleVariant)?.name}
                      </Badge>
                    )}
                  </div>
                  <div className="border-t pt-2">
                    <p className="text-xs text-muted-foreground mb-1.5">五点描述</p>
                    {getSelectedBulletPoints().map((bp: any, i: number) => {
                      const fromVariant = selectedBullets[i]?.variantId;
                      return (
                        <div key={i} className="flex items-start gap-2 mb-1.5">
                          <span className="text-xs text-muted-foreground mt-0.5 shrink-0">{i + 1}.</span>
                          <div className="flex-1">
                            <p className="text-sm">
                              <span className="font-bold">{bp.subtitle}</span>
                              {" \u2014 "}
                              <span className="text-muted-foreground">{bp.fullText || bp.sellingPoint || ""}</span>
                            </p>
                            {fromVariant && (
                              <Badge variant="outline" className={`text-[9px] mt-0.5 ${styleBadgeColors[fromVariant] || ""}`}>
                                {abVariants.find((v: any) => v.id === fromVariant)?.name}
                              </Badge>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Apply mixed button */}
              <div className="flex justify-between pt-2 border-t">
                <Button variant="outline" size="sm" onClick={() => setMixedMode("browse")}>
                  <Eye className="h-4 w-4 mr-2" /> 返回浏览
                </Button>
                <Button onClick={handleApplyMixed} disabled={applyingVariant !== null} className="min-w-[180px]">
                  {applyingVariant === "mixed" ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />应用中...</>
                  ) : (
                    <><Shuffle className="h-4 w-4 mr-2" />应用组合版本</>
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
