import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ProjectSelector from "@/components/ProjectSelector";
import { useProject } from "@/contexts/ProjectContext";
import {
  Upload,
  FileText,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  BarChart3,
  Search,
  Target,
  Layers,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";

type FileType = "product_attributes" | "competitor_listings" | "search_term_report" | "aba_keywords";

const FILE_TYPE_CONFIG: Record<FileType, {
  label: string;
  description: string;
  accept: string;
  icon: typeof FileText;
  color: string;
  bgColor: string;
  borderColor: string;
  module: string;
  expectedFile: string;
}> = {
  product_attributes: {
    label: "本品属性表",
    description: "Rufus 属性提取 — 深度读取产品属性参数，提取核心规格、材质、性能等",
    accept: ".txt,.csv",
    icon: Target,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
    module: "Module 1: Rufus",
    expectedFile: "本品属性表.txt",
  },
  competitor_listings: {
    label: "竞品Listing文本",
    description: "多竞品格局分析 — 找共性(Parity)和找缺口(Gap)，发现差异化机会",
    accept: ".txt",
    icon: Layers,
    color: "text-green-600",
    bgColor: "bg-green-50",
    borderColor: "border-green-200",
    module: "Module 2: Multi-Competitor",
    expectedFile: "竞品Listing文本.txt",
  },
  search_term_report: {
    label: "竞品出单词报告",
    description: "COSMO 场景映射 — 锁定用户最关心的真实使用场景和搜索意图",
    accept: ".csv",
    icon: Search,
    color: "text-purple-600",
    bgColor: "bg-purple-50",
    borderColor: "border-purple-200",
    module: "Module 3: COSMO",
    expectedFile: "竞品出单词报告.csv",
  },
  aba_keywords: {
    label: "ABA关键词数据",
    description: "A9 关键词分级 — 基于ABA数据锁定高权重核心词，分级放置",
    accept: ".csv",
    icon: BarChart3,
    color: "text-amber-600",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-200",
    module: "Module 4: A9",
    expectedFile: "ABA关键词数据.csv",
  },
};

const FILE_TYPES: FileType[] = ["product_attributes", "competitor_listings", "search_term_report", "aba_keywords"];

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className: string }> = {
    uploaded: { label: "已上传", variant: "secondary", className: "" },
    parsing: { label: "解析中", variant: "secondary", className: "animate-pulse" },
    parsed: { label: "已解析", variant: "outline", className: "border-blue-300 text-blue-600" },
    analyzing: { label: "AI分析中", variant: "secondary", className: "animate-pulse bg-purple-100 text-purple-700" },
    completed: { label: "分析完成", variant: "default", className: "bg-green-600" },
    failed: { label: "失败", variant: "destructive", className: "" },
  };
  const c = config[status] || config.uploaded;
  return <Badge variant={c.variant} className={c.className}>{c.label}</Badge>;
}

function AnalysisResultCard({ fileType, result }: { fileType: FileType; result: any }) {
  const [expanded, setExpanded] = useState(false);

  if (!result) return null;

  const renderContent = () => {
    switch (fileType) {
      case "product_attributes":
        return (
          <div className="space-y-3">
            {result.uniqueSellingPoints?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-blue-700 mb-1">独特卖点 (USP)</p>
                <div className="flex flex-wrap gap-1.5">
                  {result.uniqueSellingPoints.map((usp: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-xs border-blue-300 text-blue-700">{usp}</Badge>
                  ))}
                </div>
              </div>
            )}
            {result.coreSpecs?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-blue-700 mb-1">核心规格</p>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  {result.coreSpecs.slice(0, 8).map((s: any, i: number) => (
                    <span key={i} className="text-muted-foreground">
                      <strong>{s.attribute}:</strong> {s.value}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {result.rufusFriendlyAttributes?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-blue-700 mb-1">Rufus友好属性</p>
                <div className="flex flex-wrap gap-1">
                  {result.rufusFriendlyAttributes.slice(0, 6).map((a: string, i: number) => (
                    <Badge key={i} variant="secondary" className="text-xs">{a}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        );

      case "competitor_listings":
        return (
          <div className="space-y-3">
            {result.parityPoints?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-green-700 mb-1">共性卖点 (Parity) — 必须包含</p>
                <div className="space-y-1">
                  {result.parityPoints.slice(0, 6).map((p: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <Badge variant="outline" className="text-xs shrink-0 border-green-300">{p.frequency}</Badge>
                      <span>{p.sellingPoint}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {result.gapOpportunities?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-green-700 mb-1">缺口机会 (Gap) — 差异化</p>
                <div className="space-y-1">
                  {result.gapOpportunities.slice(0, 5).map((g: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <Badge variant="outline" className={`text-xs shrink-0 ${
                        g.opportunityLevel === "high" ? "border-red-300 text-red-600" :
                        g.opportunityLevel === "medium" ? "border-amber-300 text-amber-600" :
                        "border-gray-300"
                      }`}>{g.opportunityLevel}</Badge>
                      <span>{g.gap}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );

      case "search_term_report":
        return (
          <div className="space-y-3">
            {result.scenesClusters?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-purple-700 mb-1">使用场景聚类</p>
                <div className="space-y-1.5">
                  {result.scenesClusters.slice(0, 6).map((sc: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <Badge variant="outline" className={`text-xs shrink-0 ${
                        sc.priority === "high" ? "border-purple-400 text-purple-700" :
                        "border-purple-200 text-purple-500"
                      }`}>{sc.priority}</Badge>
                      <div>
                        <span className="font-medium">{sc.sceneName}</span>
                        {sc.sceneNameCn && <span className="text-muted-foreground ml-1">({sc.sceneNameCn})</span>}
                        {sc.buyerIntent && <p className="text-muted-foreground mt-0.5">{sc.buyerIntent}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {result.topScenesByVolume?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-purple-700 mb-1">搜索量TOP场景</p>
                <div className="flex flex-wrap gap-1">
                  {result.topScenesByVolume.slice(0, 6).map((s: string, i: number) => (
                    <Badge key={i} variant="secondary" className="text-xs">{s}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        );

      case "aba_keywords":
        return (
          <div className="space-y-3">
            {result.titleMustHaveKeywords?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-amber-700 mb-1">标题必含关键词 (Tier 1)</p>
                <div className="flex flex-wrap gap-1">
                  {result.titleMustHaveKeywords.map((k: string, i: number) => (
                    <Badge key={i} className="text-xs bg-amber-600">{k}</Badge>
                  ))}
                </div>
              </div>
            )}
            {result.bulletPriorityKeywords?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-amber-700 mb-1">五点优先关键词 (Tier 2)</p>
                <div className="flex flex-wrap gap-1">
                  {result.bulletPriorityKeywords.slice(0, 8).map((k: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-xs border-amber-300 text-amber-700">{k}</Badge>
                  ))}
                </div>
              </div>
            )}
            {result.goldenKeywords?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-amber-700 mb-1">黄金关键词 (高搜索+低竞争)</p>
                <div className="flex flex-wrap gap-1">
                  {result.goldenKeywords.slice(0, 6).map((k: string, i: number) => (
                    <Badge key={i} variant="secondary" className="text-xs bg-yellow-100 text-yellow-800">{k}</Badge>
                  ))}
                </div>
              </div>
            )}
            {result.keywordStrategy && (
              <div>
                <p className="text-xs font-semibold text-amber-700 mb-1">关键词策略</p>
                <p className="text-xs text-muted-foreground">{result.keywordStrategy}</p>
              </div>
            )}
          </div>
        );

      default:
        return <pre className="text-xs overflow-auto max-h-40">{JSON.stringify(result, null, 2)}</pre>;
    }
  };

  return (
    <div className="mt-3 space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        {expanded ? "收起分析结果" : "展开分析结果"}
      </button>
      {expanded && (
        <div className="p-3 rounded-lg border bg-muted/20">
          {renderContent()}
        </div>
      )}
    </div>
  );
}

function FileUploadCard({ fileType, projectId }: { fileType: FileType; projectId: number }) {
  const config = FILE_TYPE_CONFIG[fileType];
  const Icon = config.icon;
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const utils = trpc.useUtils();

  const { data: files, isLoading } = trpc.projectFile.listByType.useQuery(
    { projectId, fileType },
    { enabled: !!projectId }
  );

  const uploadAndAnalyze = trpc.projectFile.uploadAndAnalyze.useMutation({
    onSuccess: () => {
      utils.projectFile.listByType.invalidate({ projectId, fileType });
      utils.projectFile.listByProject.invalidate({ projectId });
      utils.projectFile.getAnalysisSummary.invalidate({ projectId });
      toast.success(`${config.label} 上传并分析完成`);
      setUploading(false);
    },
    onError: (err) => {
      toast.error(`分析失败: ${err.message}`);
      setUploading(false);
    },
  });

  const reAnalyze = trpc.projectFile.analyze.useMutation({
    onSuccess: () => {
      utils.projectFile.listByType.invalidate({ projectId, fileType });
      utils.projectFile.listByProject.invalidate({ projectId });
      utils.projectFile.getAnalysisSummary.invalidate({ projectId });
      toast.success("重新分析完成");
    },
    onError: (err) => toast.error(`分析失败: ${err.message}`),
  });

  const deleteFile = trpc.projectFile.delete.useMutation({
    onSuccess: () => {
      utils.projectFile.listByType.invalidate({ projectId, fileType });
      utils.projectFile.listByProject.invalidate({ projectId });
      utils.projectFile.getAnalysisSummary.invalidate({ projectId });
      toast.success("文件已删除");
    },
    onError: (err) => toast.error(`删除失败: ${err.message}`),
  });

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error("文件大小不能超过5MB");
      return;
    }

    setUploading(true);

    try {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        uploadAndAnalyze.mutate({
          projectId,
          fileType,
          filename: file.name,
          content: base64,
        });
      };
      reader.readAsDataURL(file);
    } catch {
      toast.error("文件读取失败");
      setUploading(false);
    }

    // Reset input
    if (inputRef.current) inputRef.current.value = "";
  }, [projectId, fileType, uploadAndAnalyze]);

  const latestFile = files?.[0];
  const hasCompletedFile = latestFile?.status === "completed";
  const isAnalyzing = uploading || uploadAndAnalyze.isPending || reAnalyze.isPending;

  let analysisResult: any = null;
  if (latestFile?.analysisResult) {
    try {
      analysisResult = JSON.parse(latestFile.analysisResult);
    } catch {}
  }

  return (
    <Card className={`${hasCompletedFile ? config.borderColor : ""} transition-all`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-lg ${config.bgColor}`}>
              <Icon className={`h-5 w-5 ${config.color}`} />
            </div>
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                {config.label}
                <Badge variant="outline" className="text-[10px] font-normal">{config.module}</Badge>
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">{config.description}</CardDescription>
            </div>
          </div>
          {hasCompletedFile && (
            <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Upload button */}
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={config.accept}
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={isAnalyzing}
            className="flex-1"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                {uploading ? "上传中..." : "AI分析中..."}
              </>
            ) : (
              <>
                <Upload className="h-3.5 w-3.5 mr-2" />
                {latestFile ? "重新上传" : `上传 ${config.expectedFile}`}
              </>
            )}
          </Button>
        </div>

        {/* File info */}
        {latestFile && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground truncate max-w-[200px]">{latestFile.filename}</span>
                <span className="text-muted-foreground">
                  {latestFile.fileSize ? `${(latestFile.fileSize / 1024).toFixed(1)}KB` : ""}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <StatusBadge status={latestFile.status} />
                {latestFile.status === "parsed" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => reAnalyze.mutate({ fileId: latestFile.id })}
                    disabled={reAnalyze.isPending}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    分析
                  </Button>
                )}
                {latestFile.status === "failed" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-red-600"
                    onClick={() => reAnalyze.mutate({ fileId: latestFile.id })}
                    disabled={reAnalyze.isPending}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    重试
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-red-600"
                  onClick={() => {
                    if (confirm("确定删除此文件？")) {
                      deleteFile.mutate({ fileId: latestFile.id });
                    }
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>

            {latestFile.errorMessage && (
              <p className="text-xs text-red-500">{latestFile.errorMessage}</p>
            )}

            {/* Analysis result preview */}
            {analysisResult && (
              <AnalysisResultCard fileType={fileType} result={analysisResult} />
            )}
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            加载中...
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DataFilesPage() {
  const { selectedProjectId } = useProject();

  const { data: project } = trpc.project.getById.useQuery(
    { id: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  const { data: summary } = trpc.projectFile.getAnalysisSummary.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  const completedModules = [
    summary?.productAttributes ? 1 : 0,
    summary?.competitorListings ? 1 : 0,
    summary?.cosmoScenes ? 1 : 0,
    summary?.a9Keywords ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">数据文件管理</h1>
          <p className="text-muted-foreground mt-1">
            上传产品属性表、竞品Listing、出单词报告和ABA关键词数据，AI自动分析并整合到Listing生成
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
          {/* Progress summary */}
          <Card className="bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    {FILE_TYPES.map((ft) => {
                      const done = ft === "product_attributes" ? !!summary?.productAttributes :
                                   ft === "competitor_listings" ? !!summary?.competitorListings :
                                   ft === "search_term_report" ? !!summary?.cosmoScenes :
                                   !!summary?.a9Keywords;
                      return (
                        <div
                          key={ft}
                          className={`h-2.5 w-8 rounded-full transition-colors ${
                            done ? "bg-green-500" : "bg-gray-200"
                          }`}
                        />
                      );
                    })}
                  </div>
                  <span className="text-sm font-medium text-indigo-900">
                    {completedModules}/4 模块已完成
                  </span>
                </div>
                {summary?.hasAllFiles && (
                  <Badge className="bg-green-600">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    全部就绪
                  </Badge>
                )}
              </div>
              <p className="text-xs text-indigo-700 mt-2">
                {summary?.hasAllFiles
                  ? "所有四大分析模块数据已就绪，生成Listing时将自动整合这些分析结果。"
                  : "上传并分析文件后，生成Listing时将自动整合已完成的分析模块数据。未上传的模块不影响基本生成。"}
              </p>
            </CardContent>
          </Card>

          {/* File upload cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {FILE_TYPES.map((ft) => (
              <FileUploadCard key={ft} fileType={ft} projectId={selectedProjectId} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
