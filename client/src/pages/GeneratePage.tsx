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
} from "lucide-react";
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
                </div>
              </div>
            </CardContent>
          </Card>

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
    </div>
  );
}
