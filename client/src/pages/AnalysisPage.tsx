import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import ProjectSelector from "@/components/ProjectSelector";
import { useProject } from "@/contexts/ProjectContext";
import {
  Search,
  Loader2,
  AlertTriangle,
  TrendingUp,
  MessageSquare,
  Key,
  Trash2,
  ChevronDown,
  ChevronUp,
  Globe,
  DollarSign,
  Star,
  Zap,
  Package,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  List,
} from "lucide-react";
import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";

type BatchItemStatus = "pending" | "scraping" | "analyzing" | "done" | "failed";

interface BatchItem {
  asin: string;
  status: BatchItemStatus;
  title?: string;
  error?: string;
}

export default function AnalysisPage() {
  const { selectedProjectId } = useProject();
  const [asinInput, setAsinInput] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentBatchIndex, setCurrentBatchIndex] = useState(-1);
  const abortRef = useRef(false);

  const { data: analyses, isLoading: loadingAnalyses } = trpc.analysis.listByProject.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  const utils = trpc.useUtils();

  const analyzeAsin = trpc.analysis.analyzeAsin.useMutation();

  const deleteAnalysis = trpc.analysis.delete.useMutation({
    onSuccess: () => {
      utils.analysis.listByProject.invalidate({ projectId: selectedProjectId! });
      toast.success("分析记录已删除");
    },
  });

  // Parse ASINs from input
  const parseAsins = useCallback((input: string): string[] => {
    return input
      .toUpperCase()
      .split(/[\s,;\n]+/)
      .map(s => s.trim())
      .filter(s => s.length === 10 && /^[A-Z0-9]{10}$/.test(s));
  }, []);

  // Count parsed ASINs for display
  const parsedAsins = parseAsins(asinInput);
  const uniqueAsins = Array.from(new Set(parsedAsins));

  // Process batch sequentially on the frontend
  const handleBatchAnalyze = useCallback(async () => {
    if (!selectedProjectId) {
      toast.error("请先选择一个项目");
      return;
    }

    if (uniqueAsins.length === 0) {
      toast.error("请输入有效的10位ASIN码");
      return;
    }

    if (uniqueAsins.length > 20) {
      toast.error("单次最多支持20个ASIN");
      return;
    }

    // Initialize batch items
    const items: BatchItem[] = uniqueAsins.map(asin => ({
      asin,
      status: "pending" as BatchItemStatus,
    }));
    setBatchItems(items);
    setIsProcessing(true);
    abortRef.current = false;

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < items.length; i++) {
      if (abortRef.current) break;

      setCurrentBatchIndex(i);

      // Update status to scraping
      setBatchItems(prev => prev.map((item, idx) =>
        idx === i ? { ...item, status: "scraping" } : item
      ));

      // Wait a moment then update to analyzing
      setTimeout(() => {
        setBatchItems(prev => prev.map((item, idx) =>
          idx === i && item.status === "scraping" ? { ...item, status: "analyzing" } : item
        ));
      }, 3000);

      try {
        const result = await analyzeAsin.mutateAsync({
          projectId: selectedProjectId,
          asin: items[i].asin,
        });

        setBatchItems(prev => prev.map((item, idx) =>
          idx === i ? {
            ...item,
            status: "done",
            title: result.title || "分析完成",
          } : item
        ));
        successCount++;
      } catch (error: any) {
        setBatchItems(prev => prev.map((item, idx) =>
          idx === i ? {
            ...item,
            status: "failed",
            error: error.message || "分析失败",
          } : item
        ));
        failCount++;
      }

      // Small delay between ASINs
      if (i < items.length - 1 && !abortRef.current) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    setIsProcessing(false);
    setCurrentBatchIndex(-1);
    utils.analysis.listByProject.invalidate({ projectId: selectedProjectId! });

    if (abortRef.current) {
      toast.info("批量分析已取消");
    } else {
      toast.success(`批量分析完成`, {
        description: `成功 ${successCount} 个，失败 ${failCount} 个，共 ${items.length} 个ASIN`,
      });
    }

    setAsinInput("");
  }, [selectedProjectId, uniqueAsins, analyzeAsin, utils]);

  // Single ASIN analysis
  const handleSingleAnalyze = useCallback(async () => {
    if (!selectedProjectId) {
      toast.error("请先选择一个项目");
      return;
    }

    if (uniqueAsins.length === 0) {
      toast.error("请输入有效的10位ASIN码");
      return;
    }

    // If multiple ASINs detected, switch to batch mode
    if (uniqueAsins.length > 1) {
      handleBatchAnalyze();
      return;
    }

    const asin = uniqueAsins[0];
    setBatchItems([{ asin, status: "scraping" }]);
    setIsProcessing(true);

    setTimeout(() => {
      setBatchItems(prev => prev.map(item =>
        item.status === "scraping" ? { ...item, status: "analyzing" } : item
      ));
    }, 3000);

    try {
      const result = await analyzeAsin.mutateAsync({
        projectId: selectedProjectId,
        asin,
      });

      setBatchItems([{ asin, status: "done", title: result.title || "分析完成" }]);
      utils.analysis.listByProject.invalidate({ projectId: selectedProjectId! });
      toast.success("竞品分析完成", {
        description: `已成功爬取并分析 ${asin} 的产品数据`,
      });
      setAsinInput("");
    } catch (error: any) {
      setBatchItems([{ asin, status: "failed", error: error.message }]);
      toast.error("分析失败: " + error.message);
    } finally {
      setIsProcessing(false);
    }
  }, [selectedProjectId, uniqueAsins, analyzeAsin, utils, handleBatchAnalyze]);

  const handleCancel = () => {
    abortRef.current = true;
  };

  const parseJson = (str: string | null) => {
    if (!str) return null;
    try { return JSON.parse(str); } catch { return null; }
  };

  const getStatusIcon = (status: BatchItemStatus) => {
    switch (status) {
      case "pending": return <Clock className="h-4 w-4 text-muted-foreground" />;
      case "scraping": return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      case "analyzing": return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      case "done": return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "failed": return <XCircle className="h-4 w-4 text-red-500" />;
    }
  };

  const getStatusText = (status: BatchItemStatus) => {
    switch (status) {
      case "pending": return "等待中";
      case "scraping": return "爬取数据中...";
      case "analyzing": return "AI分析中...";
      case "done": return "完成";
      case "failed": return "失败";
    }
  };

  const batchProgress = batchItems.length > 0
    ? Math.round((batchItems.filter(i => i.status === "done" || i.status === "failed").length / batchItems.length) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">竞品分析</h1>
          <p className="text-muted-foreground mt-1">
            输入竞品ASIN，自动爬取产品数据并进行AI深度分析
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
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Input Form */}
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    输入竞品ASIN
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => setIsBatchMode(!isBatchMode)}
                    disabled={isProcessing}
                  >
                    <List className="h-3.5 w-3.5 mr-1" />
                    {isBatchMode ? "单个模式" : "批量模式"}
                  </Button>
                </div>
                <CardDescription>
                  {isBatchMode
                    ? "输入多个ASIN码（每行一个，或用逗号/空格分隔），最多20个，工具将依次自动爬取分析。"
                    : "输入ASIN码，工具将自动从亚马逊爬取产品数据并进行AI深度分析。"
                  }
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>竞品ASIN *</Label>
                    {uniqueAsins.length > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {uniqueAsins.length} 个ASIN
                      </Badge>
                    )}
                  </div>
                  {isBatchMode ? (
                    <Textarea
                      placeholder={"每行一个ASIN，或用逗号/空格分隔\n例如:\nB0XXXXXXXXX\nB0YYYYYYYYY\nB0ZZZZZZZZZ"}
                      value={asinInput}
                      onChange={(e) => setAsinInput(e.target.value.toUpperCase())}
                      disabled={isProcessing}
                      className="font-mono text-sm tracking-wider min-h-[120px]"
                      rows={6}
                    />
                  ) : (
                    <Input
                      placeholder="例如: B0XXXXXXXXX"
                      value={asinInput}
                      onChange={(e) => setAsinInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !isProcessing) handleSingleAnalyze();
                      }}
                      disabled={isProcessing}
                      className="font-mono text-base tracking-wider"
                    />
                  )}
                  <p className="text-xs text-muted-foreground">
                    {isBatchMode
                      ? `已识别 ${uniqueAsins.length} 个有效ASIN（最多20个）`
                      : "输入10位亚马逊产品标识码，支持输入多个自动切换批量模式"
                    }
                  </p>
                </div>

                {/* Batch Progress */}
                {isProcessing && batchItems.length > 0 && (
                  <div className="space-y-3 p-4 bg-muted/30 rounded-lg border">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        <span className="text-sm font-medium">
                          {batchItems.length === 1
                            ? getStatusText(batchItems[0].status)
                            : `批量分析中 (${batchItems.filter(i => i.status === "done" || i.status === "failed").length}/${batchItems.length})`
                          }
                        </span>
                      </div>
                      {batchItems.length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-destructive"
                          onClick={handleCancel}
                        >
                          取消
                        </Button>
                      )}
                    </div>
                    <Progress value={batchProgress} className="h-2" />

                    {/* Per-ASIN status list */}
                    {batchItems.length > 1 && (
                      <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                        {batchItems.map((item, idx) => (
                          <div
                            key={item.asin}
                            className={`flex items-center justify-between text-xs p-2 rounded ${
                              item.status === "done" ? "bg-green-50 border border-green-100" :
                              item.status === "failed" ? "bg-red-50 border border-red-100" :
                              item.status === "scraping" || item.status === "analyzing" ? "bg-blue-50 border border-blue-100" :
                              "bg-muted/20 border border-transparent"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              {getStatusIcon(item.status)}
                              <span className="font-mono">{item.asin}</span>
                            </div>
                            <span className={`text-xs ${
                              item.status === "done" ? "text-green-600" :
                              item.status === "failed" ? "text-red-600" :
                              "text-muted-foreground"
                            }`}>
                              {item.status === "done" && item.title
                                ? item.title.substring(0, 30) + (item.title.length > 30 ? "..." : "")
                                : item.status === "failed" && item.error
                                  ? item.error.substring(0, 30)
                                  : getStatusText(item.status)
                              }
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Single ASIN progress steps */}
                    {batchItems.length === 1 && (
                      <div className="grid grid-cols-3 gap-1 text-xs text-muted-foreground">
                        <span className={batchItems[0].status !== "pending" ? "text-primary font-medium" : ""}>
                          爬取数据
                        </span>
                        <span className={batchItems[0].status === "analyzing" || batchItems[0].status === "done" ? "text-primary font-medium" : ""}>
                          AI分析
                        </span>
                        <span className={batchItems[0].status === "done" ? "text-primary font-medium" : ""}>
                          保存结果
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <Button
                  className="w-full"
                  size="lg"
                  onClick={uniqueAsins.length > 1 ? handleBatchAnalyze : handleSingleAnalyze}
                  disabled={isProcessing || uniqueAsins.length === 0}
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {batchItems.length > 1 ? "批量分析中..." : "自动爬取分析中..."}
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4 mr-2" />
                      {uniqueAsins.length > 1
                        ? `批量爬取 & 分析 (${uniqueAsins.length}个)`
                        : "一键爬取 & 分析"
                      }
                    </>
                  )}
                </Button>

                {/* Auto-scrape feature highlights */}
                <div className="pt-2 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">自动爬取内容：</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { icon: Package, label: "产品标题" },
                      { icon: TrendingUp, label: "五点描述" },
                      { icon: DollarSign, label: "价格信息" },
                      { icon: Star, label: "评分评论" },
                      { icon: Key, label: "关键词提取" },
                      { icon: MessageSquare, label: "痛点分析" },
                    ].map(({ icon: Icon, label }) => (
                      <div key={label} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Icon className="h-3 w-3 text-primary/60" />
                        <span>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Results */}
          <div className="lg:col-span-3 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">分析结果</h2>
              {analyses && analyses.length > 0 && (
                <Badge variant="secondary">{analyses.length} 条分析</Badge>
              )}
            </div>

            {loadingAnalyses ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <Card key={i}><CardContent className="p-6"><div className="h-24 bg-muted animate-pulse rounded" /></CardContent></Card>
                ))}
              </div>
            ) : !analyses || analyses.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Search className="h-8 w-8 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground text-sm">暂无分析结果</p>
                  <p className="text-muted-foreground text-xs mt-1">输入竞品ASIN开始自动爬取分析</p>
                </CardContent>
              </Card>
            ) : (
              <ScrollArea className="h-[calc(100vh-220px)]">
                <div className="space-y-4 pr-4">
                  {analyses.map((analysis) => {
                    const isExpanded = expandedId === analysis.id;
                    const keywords = parseJson(analysis.keywords);
                    const reviewData = parseJson(analysis.reviewAnalysis);
                    const rawData = parseJson(analysis.rawData);
                    const bulletPoints = parseJson(analysis.bulletPoints);
                    const scrapedInfo = rawData?.scrapedData;

                    return (
                      <Card key={analysis.id} className="overflow-hidden">
                        <CardHeader
                          className="cursor-pointer hover:bg-muted/30 transition-colors"
                          onClick={() => setExpandedId(isExpanded ? null : analysis.id)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-3 mb-1">
                                <Badge variant="outline" className="font-mono shrink-0">
                                  {analysis.asin}
                                </Badge>
                                {analysis.price && (
                                  <Badge variant="secondary" className="text-xs shrink-0">
                                    {analysis.price}
                                  </Badge>
                                )}
                                {analysis.rating && (
                                  <Badge variant="secondary" className="text-xs shrink-0">
                                    <Star className="h-3 w-3 mr-0.5 fill-amber-400 text-amber-400" />
                                    {analysis.rating}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground truncate">
                                {analysis.title || "标题爬取中..."}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-3">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteAnalysis.mutate({ id: analysis.id });
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </div>
                          </div>
                        </CardHeader>

                        {isExpanded && (
                          <CardContent className="pt-0">
                            {/* Scraped Data Summary */}
                            {(analysis.title || scrapedInfo) && (
                              <div className="mb-4 p-3 bg-muted/30 rounded-lg border">
                                <h4 className="text-xs font-medium text-muted-foreground mb-2">爬取数据摘要</h4>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                                  {scrapedInfo?.brand && (
                                    <div>
                                      <span className="text-xs text-muted-foreground">品牌</span>
                                      <p className="font-medium truncate">{scrapedInfo.brand}</p>
                                    </div>
                                  )}
                                  {analysis.price && (
                                    <div>
                                      <span className="text-xs text-muted-foreground">价格</span>
                                      <p className="font-medium">{analysis.price}</p>
                                    </div>
                                  )}
                                  {analysis.rating && (
                                    <div>
                                      <span className="text-xs text-muted-foreground">评分</span>
                                      <p className="font-medium">{analysis.rating}/5</p>
                                    </div>
                                  )}
                                  {scrapedInfo?.reviewsCount != null && (
                                    <div>
                                      <span className="text-xs text-muted-foreground">评论数</span>
                                      <p className="font-medium">{scrapedInfo.reviewsCount} 条已分析</p>
                                    </div>
                                  )}
                                </div>
                                {bulletPoints && bulletPoints.length > 0 && (
                                  <div className="mt-3">
                                    <span className="text-xs text-muted-foreground">五点描述</span>
                                    <ul className="mt-1 space-y-1">
                                      {bulletPoints.slice(0, 5).map((bp: string, i: number) => (
                                        <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                                          <span className="text-primary mt-0.5 shrink-0">•</span>
                                          <span className="line-clamp-2">{bp}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            )}

                            <Tabs defaultValue="keywords">
                              <TabsList className="w-full justify-start">
                                <TabsTrigger value="keywords">
                                  <Key className="h-3.5 w-3.5 mr-1.5" />
                                  关键词
                                </TabsTrigger>
                                <TabsTrigger value="reviews">
                                  <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                                  评论分析
                                </TabsTrigger>
                                <TabsTrigger value="insights">
                                  <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
                                  竞品洞察
                                </TabsTrigger>
                              </TabsList>

                              <TabsContent value="keywords" className="mt-4 space-y-4">
                                {keywords ? (
                                  <>
                                    {keywords.core && (
                                      <div>
                                        <h4 className="text-sm font-medium mb-2">核心关键词</h4>
                                        <div className="flex flex-wrap gap-2">
                                          {keywords.core.map((k: any, i: number) => (
                                            <Badge key={i} variant="default" className="text-xs">
                                              {k.keyword || k}
                                            </Badge>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {keywords.longTail && (
                                      <div>
                                        <h4 className="text-sm font-medium mb-2">长尾关键词</h4>
                                        <div className="flex flex-wrap gap-2">
                                          {keywords.longTail.map((k: any, i: number) => (
                                            <Badge key={i} variant="secondary" className="text-xs">
                                              {k.keyword || k}
                                            </Badge>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {keywords.traffic && (
                                      <div>
                                        <h4 className="text-sm font-medium mb-2">流量关键词</h4>
                                        <div className="flex flex-wrap gap-2">
                                          {keywords.traffic.map((k: any, i: number) => (
                                            <Badge key={i} variant="outline" className="text-xs">
                                              {k.keyword || k}
                                            </Badge>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <p className="text-sm text-muted-foreground">暂无关键词数据</p>
                                )}
                              </TabsContent>

                              <TabsContent value="reviews" className="mt-4 space-y-4">
                                {reviewData ? (
                                  <>
                                    {reviewData.painPoints && reviewData.painPoints.length > 0 && (
                                      <div>
                                        <h4 className="text-sm font-medium mb-2 text-red-600">
                                          痛点 ({reviewData.painPoints.length})
                                        </h4>
                                        <div className="space-y-2">
                                          {reviewData.painPoints.map((p: any, i: number) => (
                                            <div key={i} className="p-3 bg-red-50 rounded-lg border border-red-100">
                                              <p className="text-sm font-medium text-red-800">{p.issue}</p>
                                              <div className="flex gap-2 mt-1">
                                                <Badge variant="outline" className="text-xs">频率: {p.frequency}</Badge>
                                                <Badge variant="outline" className="text-xs">严重度: {p.severity}</Badge>
                                              </div>
                                              {p.quotes && p.quotes.length > 0 && (
                                                <p className="text-xs text-red-600 mt-2 italic">"{p.quotes[0]}"</p>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {reviewData.itchPoints && reviewData.itchPoints.length > 0 && (
                                      <div>
                                        <h4 className="text-sm font-medium mb-2 text-amber-600">
                                          痒点 ({reviewData.itchPoints.length})
                                        </h4>
                                        <div className="space-y-2">
                                          {reviewData.itchPoints.map((p: any, i: number) => (
                                            <div key={i} className="p-3 bg-amber-50 rounded-lg border border-amber-100">
                                              <p className="text-sm font-medium text-amber-800">{p.desire}</p>
                                              <Badge variant="outline" className="text-xs mt-1">重要性: {p.importance}</Badge>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {reviewData.delightPoints && reviewData.delightPoints.length > 0 && (
                                      <div>
                                        <h4 className="text-sm font-medium mb-2 text-green-600">
                                          爽点 ({reviewData.delightPoints.length})
                                        </h4>
                                        <div className="space-y-2">
                                          {reviewData.delightPoints.map((p: any, i: number) => (
                                            <div key={i} className="p-3 bg-green-50 rounded-lg border border-green-100">
                                              <p className="text-sm font-medium text-green-800">{p.feature}</p>
                                              <Badge variant="outline" className="text-xs mt-1">影响: {p.impact}</Badge>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <div className="text-center py-6">
                                    <MessageSquare className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                                    <p className="text-sm text-muted-foreground">未爬取到客户评论数据</p>
                                    <p className="text-xs text-muted-foreground mt-1">亚马逊可能限制了评论页面的访问</p>
                                  </div>
                                )}
                              </TabsContent>

                              <TabsContent value="insights" className="mt-4 space-y-4">
                                {rawData ? (
                                  <>
                                    {rawData.titleAnalysis && (
                                      <div>
                                        <h4 className="text-sm font-medium mb-2">标题分析</h4>
                                        <div className="p-3 bg-muted/50 rounded-lg text-sm space-y-1">
                                          {rawData.titleAnalysis.brand && (
                                            <p><span className="font-medium">品牌:</span> {rawData.titleAnalysis.brand}</p>
                                          )}
                                          {rawData.titleAnalysis.mainKeywords && (
                                            <p><span className="font-medium">主要关键词:</span> {rawData.titleAnalysis.mainKeywords.join(", ")}</p>
                                          )}
                                          {rawData.titleAnalysis.features && (
                                            <p><span className="font-medium">特征:</span> {rawData.titleAnalysis.features.join(", ")}</p>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                    {rawData.advantages && rawData.advantages.length > 0 && (
                                      <div>
                                        <h4 className="text-sm font-medium mb-2">竞品优势</h4>
                                        <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
                                          {rawData.advantages.map((a: string, i: number) => (
                                            <li key={i}>{a}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    {rawData.weaknesses && rawData.weaknesses.length > 0 && (
                                      <div>
                                        <h4 className="text-sm font-medium mb-2">竞品弱点</h4>
                                        <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
                                          {rawData.weaknesses.map((w: string, i: number) => (
                                            <li key={i}>{w}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <p className="text-sm text-muted-foreground">暂无竞品洞察数据</p>
                                )}
                              </TabsContent>
                            </Tabs>
                          </CardContent>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
