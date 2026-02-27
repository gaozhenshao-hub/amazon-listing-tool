import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
  ShoppingCart,
  Plus,
  Zap,
  Package,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function AnalysisPage() {
  const { selectedProjectId } = useProject();
  const [asinInput, setAsinInput] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [scrapeProgress, setScrapeProgress] = useState(0);
  const [scrapeStatus, setScrapeStatus] = useState("");

  const { data: analyses, isLoading: loadingAnalyses } = trpc.analysis.listByProject.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  const utils = trpc.useUtils();

  const analyzeAsin = trpc.analysis.analyzeAsin.useMutation({
    onMutate: () => {
      setScrapeProgress(10);
      setScrapeStatus("正在连接亚马逊...");
    },
    onSuccess: (data) => {
      setScrapeProgress(100);
      setScrapeStatus("分析完成！");
      utils.analysis.listByProject.invalidate({ projectId: selectedProjectId! });

      const scrapedInfo = data.scrapedData;
      if (scrapedInfo?.title) {
        toast.success("竞品分析完成", {
          description: `已成功爬取并分析 ${data.asin} 的产品数据`,
        });
      } else {
        toast.success("竞品分析完成", {
          description: "已基于ASIN完成AI分析（部分数据可能未爬取到）",
        });
      }
      setAsinInput("");
      setTimeout(() => {
        setScrapeProgress(0);
        setScrapeStatus("");
      }, 2000);
    },
    onError: (err) => {
      setScrapeProgress(0);
      setScrapeStatus("");
      toast.error("分析失败: " + err.message);
    },
  });

  const deleteAnalysis = trpc.analysis.delete.useMutation({
    onSuccess: () => {
      utils.analysis.listByProject.invalidate({ projectId: selectedProjectId! });
      toast.success("分析记录已删除");
    },
  });

  // Simulate progress updates during analysis
  const handleAnalyze = () => {
    if (!selectedProjectId) {
      toast.error("请先选择一个项目");
      return;
    }

    // Parse multiple ASINs (comma, space, or newline separated)
    const asins = asinInput
      .toUpperCase()
      .split(/[\s,;\n]+/)
      .map(s => s.trim())
      .filter(s => s.length === 10 && /^[A-Z0-9]{10}$/.test(s));

    if (asins.length === 0) {
      toast.error("请输入有效的10位ASIN码");
      return;
    }

    // Analyze the first ASIN (batch support can be added later)
    const asin = asins[0];

    // Start progress simulation
    let progress = 10;
    const progressInterval = setInterval(() => {
      progress += Math.random() * 15;
      if (progress > 90) progress = 90;
      setScrapeProgress(Math.round(progress));

      if (progress < 30) setScrapeStatus("正在爬取产品页面...");
      else if (progress < 50) setScrapeStatus("正在提取产品信息...");
      else if (progress < 70) setScrapeStatus("正在爬取客户评论...");
      else setScrapeStatus("AI正在分析竞品数据...");
    }, 1500);

    analyzeAsin.mutate(
      { projectId: selectedProjectId, asin },
      {
        onSettled: () => clearInterval(progressInterval),
      }
    );
  };

  const parseJson = (str: string | null) => {
    if (!str) return null;
    try { return JSON.parse(str); } catch { return null; }
  };

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
          {/* Input Form - Simplified to ASIN only */}
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Globe className="h-4 w-4" />
                  输入竞品ASIN
                </CardTitle>
                <CardDescription>
                  只需输入ASIN码，工具将自动从亚马逊爬取产品标题、五点描述、价格、评分和客户评论，然后进行AI深度分析。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>竞品ASIN *</Label>
                  <Input
                    placeholder="例如: B0XXXXXXXXX"
                    value={asinInput}
                    onChange={(e) => setAsinInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !analyzeAsin.isPending) handleAnalyze();
                    }}
                    disabled={analyzeAsin.isPending}
                    className="font-mono text-base tracking-wider"
                  />
                  <p className="text-xs text-muted-foreground">
                    输入10位亚马逊产品标识码，按回车或点击按钮开始分析
                  </p>
                </div>

                {/* Progress indicator */}
                {analyzeAsin.isPending && (
                  <div className="space-y-3 p-4 bg-muted/30 rounded-lg border">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span className="text-sm font-medium">{scrapeStatus}</span>
                    </div>
                    <Progress value={scrapeProgress} className="h-2" />
                    <div className="grid grid-cols-4 gap-1 text-xs text-muted-foreground">
                      <span className={scrapeProgress >= 10 ? "text-primary font-medium" : ""}>爬取页面</span>
                      <span className={scrapeProgress >= 30 ? "text-primary font-medium" : ""}>提取数据</span>
                      <span className={scrapeProgress >= 50 ? "text-primary font-medium" : ""}>爬取评论</span>
                      <span className={scrapeProgress >= 70 ? "text-primary font-medium" : ""}>AI分析</span>
                    </div>
                  </div>
                )}

                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleAnalyze}
                  disabled={analyzeAsin.isPending || !asinInput.trim()}
                >
                  {analyzeAsin.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      自动爬取分析中...
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4 mr-2" />
                      一键爬取 & 分析
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
