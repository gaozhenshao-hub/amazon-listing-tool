import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
  RefreshCw,
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
};

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
    { key: "title", label: "标题", icon: Type, color: "text-blue-600" },
    { key: "bulletPoints", label: "五点描述", icon: List, color: "text-green-600" },
    { key: "description", label: "产品描述", icon: FileText, color: "text-purple-600" },
    { key: "searchTerms", label: "搜索关键词", icon: Key, color: "text-amber-600" },
    { key: "imageAdvice", label: "图片建议", icon: Image, color: "text-pink-600" },
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
                <div className="flex gap-2">
                  {analyses && analyses.length > 0 && (
                    <Badge variant="secondary">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      已有竞品数据
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
                  同时生成标题、五点、描述、关键词和图片建议
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
                            partResults[part.key] || (result && (result as any)[part.key + "Data"]) ? "已生成 · 点击重新生成" : "点击生成"}
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

              {/* Title Preview */}
              {(partResults.title || result?.titleOptions) && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Type className="h-4 w-4 text-blue-600" />
                      标题选项
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {((partResults.title || result?.titleOptions)?.titles || []).map((t: any, i: number) => (
                      <div key={i} className={`p-3 rounded-lg border ${i === 0 ? "border-primary/30 bg-primary/5" : "bg-muted/30"}`}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium flex-1">{t.title}</p>
                          <Badge variant={i === 0 ? "default" : "secondary"} className="shrink-0 text-xs">
                            {t.characterCount || t.title?.length || 0} 字符
                          </Badge>
                        </div>
                        {t.strategy && (
                          <p className="text-xs text-muted-foreground mt-2">{t.strategy}</p>
                        )}
                        {t.coreKeywords && (
                          <div className="flex gap-1.5 mt-2">
                            {t.coreKeywords.map((k: string, j: number) => (
                              <Badge key={j} variant="outline" className="text-xs">{k}</Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Bullet Points Preview */}
              {(partResults.bulletPoints || result?.bulletPointsData) && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <List className="h-4 w-4 text-green-600" />
                      五点描述
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {((partResults.bulletPoints || result?.bulletPointsData)?.bulletPoints || []).map((bp: any, i: number) => (
                      <div key={i} className="p-3 bg-muted/30 rounded-lg border">
                        <p className="text-sm">
                          <span className="font-bold">{bp.subtitle || `卖点 ${i + 1}`}</span>
                          {" — "}
                          <span className="text-muted-foreground">{bp.fullText || bp.sellingPoint || ""}</span>
                        </p>
                        {bp.characterCount && (
                          <Badge variant="outline" className="text-xs mt-2">{bp.characterCount} 字符</Badge>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Search Terms Preview */}
              {(partResults.searchTerms || result?.searchTermsData) && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Key className="h-4 w-4 text-amber-600" />
                      后台搜索词
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="p-3 bg-muted/30 rounded-lg border">
                      <p className="text-sm font-mono break-all">
                        {(partResults.searchTerms || result?.searchTermsData)?.searchTerms || ""}
                      </p>
                      <Badge variant="outline" className="text-xs mt-2">
                        {(partResults.searchTerms || result?.searchTermsData)?.byteCount || 0} bytes
                      </Badge>
                    </div>
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
