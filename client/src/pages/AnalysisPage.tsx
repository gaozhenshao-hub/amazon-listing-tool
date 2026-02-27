import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
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
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function AnalysisPage() {
  const { selectedProjectId } = useProject();
  const [asin, setAsin] = useState("");
  const [competitorTitle, setCompetitorTitle] = useState("");
  const [competitorBulletPoints, setCompetitorBulletPoints] = useState("");
  const [competitorReviews, setCompetitorReviews] = useState("");
  const [competitorPrice, setCompetitorPrice] = useState("");
  const [competitorRating, setCompetitorRating] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: analyses, isLoading: loadingAnalyses } = trpc.analysis.listByProject.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  const utils = trpc.useUtils();

  const analyzeAsin = trpc.analysis.analyzeAsin.useMutation({
    onSuccess: () => {
      utils.analysis.listByProject.invalidate({ projectId: selectedProjectId! });
      toast.success("竞品分析完成");
      setAsin("");
      setCompetitorTitle("");
      setCompetitorBulletPoints("");
      setCompetitorReviews("");
      setCompetitorPrice("");
      setCompetitorRating("");
    },
    onError: (err) => toast.error("分析失败: " + err.message),
  });

  const deleteAnalysis = trpc.analysis.delete.useMutation({
    onSuccess: () => {
      utils.analysis.listByProject.invalidate({ projectId: selectedProjectId! });
      toast.success("分析记录已删除");
    },
  });

  const handleAnalyze = () => {
    if (!selectedProjectId) {
      toast.error("请先选择一个项目");
      return;
    }
    if (!asin.trim() || asin.trim().length !== 10) {
      toast.error("请输入有效的10位ASIN码");
      return;
    }
    analyzeAsin.mutate({
      projectId: selectedProjectId,
      asin: asin.trim().toUpperCase(),
      competitorTitle: competitorTitle || undefined,
      competitorBulletPoints: competitorBulletPoints || undefined,
      competitorReviews: competitorReviews || undefined,
      competitorPrice: competitorPrice || undefined,
      competitorRating: competitorRating || undefined,
    });
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
            输入竞品ASIN和数据，AI将分析卖点、关键词和用户评论
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
                <CardTitle className="text-base">输入竞品数据</CardTitle>
                <CardDescription>
                  输入竞品ASIN和相关信息进行分析。您可以从亚马逊页面复制标题、五点和评论内容。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>竞品ASIN *</Label>
                  <Input
                    placeholder="例如: B0XXXXXXXXX"
                    value={asin}
                    onChange={(e) => setAsin(e.target.value.toUpperCase())}
                    maxLength={10}
                  />
                  <p className="text-xs text-muted-foreground">10位亚马逊产品标识码</p>
                </div>
                <div className="space-y-2">
                  <Label>竞品标题</Label>
                  <Textarea
                    placeholder="粘贴竞品的产品标题..."
                    rows={3}
                    value={competitorTitle}
                    onChange={(e) => setCompetitorTitle(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>竞品五点描述</Label>
                  <Textarea
                    placeholder="粘贴竞品的五点描述（Bullet Points）..."
                    rows={6}
                    value={competitorBulletPoints}
                    onChange={(e) => setCompetitorBulletPoints(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>价格</Label>
                    <Input
                      placeholder="$29.99"
                      value={competitorPrice}
                      onChange={(e) => setCompetitorPrice(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>评分</Label>
                    <Input
                      placeholder="4.5"
                      value={competitorRating}
                      onChange={(e) => setCompetitorRating(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>客户评论内容</Label>
                  <Textarea
                    placeholder="粘贴客户评论内容，用于痛点/痒点/爽点分析..."
                    rows={8}
                    value={competitorReviews}
                    onChange={(e) => setCompetitorReviews(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    建议粘贴10-20条有代表性的评论，包含好评和差评
                  </p>
                </div>
                <Button
                  className="w-full"
                  onClick={handleAnalyze}
                  disabled={analyzeAsin.isPending}
                >
                  {analyzeAsin.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      AI分析中...
                    </>
                  ) : (
                    <>
                      <Search className="h-4 w-4 mr-2" />
                      开始分析
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Results */}
          <div className="lg:col-span-3 space-y-4">
            <h2 className="text-lg font-semibold">分析结果</h2>
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
                  <p className="text-muted-foreground text-sm">暂无分析结果，请输入竞品数据开始分析</p>
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

                    return (
                      <Card key={analysis.id}>
                        <CardHeader
                          className="cursor-pointer"
                          onClick={() => setExpandedId(isExpanded ? null : analysis.id)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <Badge variant="outline" className="font-mono">
                                {analysis.asin}
                              </Badge>
                              <span className="text-sm text-muted-foreground truncate max-w-xs">
                                {analysis.title || "未提供标题"}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
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
                                          😣 痛点 ({reviewData.painPoints.length})
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
                                          🤔 痒点 ({reviewData.itchPoints.length})
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
                                          😍 爽点 ({reviewData.delightPoints.length})
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
                                  <p className="text-sm text-muted-foreground">未提供评论数据，请在分析时粘贴客户评论</p>
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
