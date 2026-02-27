import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import ProjectSelector from "@/components/ProjectSelector";
import { useProject } from "@/contexts/ProjectContext";
import {
  AlertTriangle,
  BarChart3,
  Key,
  MessageSquare,
  Star,
  DollarSign,
  TrendingUp,
  ArrowUpDown,
  CheckCircle2,
  XCircle,
  Minus,
  Package,
  Sparkles,
  Loader2,
  Copy,
  Check,
} from "lucide-react";
import { Streamdown } from "streamdown";
import { useState, useMemo } from "react";

// Type for parsed analysis data
interface ParsedAnalysis {
  id: number;
  asin: string;
  title: string;
  brand: string;
  price: string;
  rating: string;
  reviewCount: string;
  bulletPoints: string[];
  keywords: {
    core: Array<{ keyword: string } | string>;
    longTail: Array<{ keyword: string } | string>;
    traffic: Array<{ keyword: string } | string>;
  } | null;
  reviewAnalysis: {
    painPoints: Array<{ issue: string; frequency?: string; severity?: string }>;
    itchPoints: Array<{ desire: string; importance?: string }>;
    delightPoints: Array<{ feature: string; impact?: string }>;
  } | null;
  rawData: any;
  isManual: boolean;
}

function parseJson(str: string | null): any {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

function getKeywordText(k: any): string {
  return typeof k === "string" ? k : k?.keyword || k?.term || String(k);
}

function parseAnalysis(analysis: any): ParsedAnalysis {
  const keywords = parseJson(analysis.keywords);
  const reviewAnalysis = parseJson(analysis.reviewAnalysis);
  const rawData = parseJson(analysis.rawData);
  const bulletPoints = parseJson(analysis.bulletPoints) || [];

  return {
    id: analysis.id,
    asin: analysis.asin,
    title: analysis.title || "未知标题",
    brand: rawData?.scrapedData?.brand || rawData?.brand || "-",
    price: analysis.price || "-",
    rating: analysis.rating || "-",
    reviewCount: analysis.reviewCount || rawData?.scrapedData?.reviewCount?.toString() || "-",
    bulletPoints,
    keywords,
    reviewAnalysis,
    rawData,
    isManual: rawData?.manualInput === true,
  };
}

// Color palette for ASIN badges
const ASIN_COLORS = [
  "bg-blue-100 text-blue-800 border-blue-200",
  "bg-emerald-100 text-emerald-800 border-emerald-200",
  "bg-purple-100 text-purple-800 border-purple-200",
  "bg-amber-100 text-amber-800 border-amber-200",
  "bg-rose-100 text-rose-800 border-rose-200",
  "bg-cyan-100 text-cyan-800 border-cyan-200",
  "bg-indigo-100 text-indigo-800 border-indigo-200",
  "bg-orange-100 text-orange-800 border-orange-200",
];

// AI Summary Section Component
function AISummarySection({
  projectId,
  selectedIds,
  selectedAnalyses,
  aiSummary,
  setAiSummary,
}: {
  projectId: number;
  selectedIds: Set<number>;
  selectedAnalyses: ParsedAnalysis[];
  aiSummary: string | null;
  setAiSummary: (s: string | null) => void;
}) {
  const [isCopied, setIsCopied] = useState(false);
  const summaryMutation = trpc.analysis.comparisonSummary.useMutation({
    onSuccess: (data) => {
      setAiSummary(data.summary);
    },
  });

  const handleGenerate = () => {
    setAiSummary(null);
    summaryMutation.mutate({
      projectId,
      analysisIds: Array.from(selectedIds),
    });
  };

  const handleCopy = async () => {
    if (!aiSummary) return;
    try {
      await navigator.clipboard.writeText(aiSummary);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  return (
    <div className="space-y-4">
      {/* Generate Button Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                AI 竞品对比总结
              </CardTitle>
              <CardDescription className="mt-1">
                基于已选的 {selectedAnalyses.length} 个竞品分析数据，AI将自动提炼关键差异、发现市场机会并生成优化建议
              </CardDescription>
            </div>
            <Button
              onClick={handleGenerate}
              disabled={summaryMutation.isPending || selectedAnalyses.length < 2}
              className="shrink-0"
            >
              {summaryMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  AI 分析中...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  {aiSummary ? "重新生成" : "生成AI总结"}
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        {summaryMutation.isPending && (
          <CardContent className="pt-0">
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span>正在分析 {selectedAnalyses.length} 个竞品数据，提炼关键差异和优化建议...</span>
              </div>
              <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                <div className="bg-primary h-full rounded-full animate-pulse" style={{ width: "60%" }} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                {["分析价格与评分差异", "对比关键词覆盖", "提炼用户痛点机会"].map((step, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                    {step}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Error Display */}
      {summaryMutation.isError && (
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-sm text-red-700">
              <XCircle className="h-4 w-4 shrink-0" />
              <span>生成失败：{summaryMutation.error?.message || "未知错误，请重试"}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Result */}
      {aiSummary && (
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                分析报告
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  已分析 {selectedAnalyses.map(a => a.asin).join(", ")}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  className="h-7 text-xs"
                >
                  {isCopied ? (
                    <><Check className="h-3 w-3 mr-1" />已复制</>
                  ) : (
                    <><Copy className="h-3 w-3 mr-1" />复制报告</>
                  )}
                </Button>
              </div>
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4">
            <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-foreground/90 prose-strong:text-foreground prose-li:text-foreground/90 prose-table:text-sm">
              <Streamdown>{aiSummary}</Streamdown>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!aiSummary && !summaryMutation.isPending && !summaryMutation.isError && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Sparkles className="h-8 w-8 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-sm">点击上方「生成AI总结」按钮，获取竞品差异分析报告</p>
            <p className="text-muted-foreground text-xs mt-1">报告将包含市场概览、关键差异、关键词机会、痛点分析和优化建议</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function ComparisonPage() {
  const { selectedProjectId } = useProject();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [aiSummary, setAiSummary] = useState<string | null>(null);

  const { data: analyses, isLoading } = trpc.analysis.listByProject.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  // Parse selected analyses
  const selectedAnalyses = useMemo(() => {
    if (!analyses) return [];
    return analyses
      .filter(a => selectedIds.has(a.id))
      .map(parseAnalysis);
  }, [analyses, selectedIds]);

  // Toggle selection
  const toggleSelection = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= 8) return prev; // Max 8 items
        next.add(id);
      }
      return next;
    });
  };

  // Select all / deselect all
  const toggleAll = () => {
    if (!analyses) return;
    if (selectedIds.size === analyses.length || selectedIds.size >= 8) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(analyses.slice(0, 8).map(a => a.id)));
    }
  };

  // Compute shared and unique keywords
  const keywordComparison = useMemo(() => {
    if (selectedAnalyses.length < 2) return null;

    const allKeywordSets = selectedAnalyses.map(a => {
      const kws = new Set<string>();
      if (a.keywords) {
        (a.keywords.core || []).forEach((k: any) => kws.add(getKeywordText(k).toLowerCase()));
        (a.keywords.longTail || []).forEach((k: any) => kws.add(getKeywordText(k).toLowerCase()));
        (a.keywords.traffic || []).forEach((k: any) => kws.add(getKeywordText(k).toLowerCase()));
      }
      return kws;
    });

    // Shared: in ALL selected
    const shared = new Set<string>();
    if (allKeywordSets.length > 0) {
      Array.from(allKeywordSets[0]).forEach(kw => {
        if (allKeywordSets.every(set => set.has(kw))) {
          shared.add(kw);
        }
      });
    }

    // Unique per ASIN
    const uniquePerAsin = selectedAnalyses.map((a, idx) => {
      const unique = new Set<string>();
      Array.from(allKeywordSets[idx]).forEach(kw => {
        const inOthers = allKeywordSets.some((set, j) => j !== idx && set.has(kw));
        if (!inOthers) unique.add(kw);
      });
      return { asin: a.asin, keywords: unique };
    });

    return { shared, uniquePerAsin };
  }, [selectedAnalyses]);

  // Compute pain points comparison
  const painPointComparison = useMemo(() => {
    if (selectedAnalyses.length < 2) return null;

    const allPainPoints = new Map<string, Set<string>>();
    selectedAnalyses.forEach(a => {
      if (a.reviewAnalysis?.painPoints) {
        a.reviewAnalysis.painPoints.forEach(p => {
          const key = p.issue.toLowerCase().trim();
          if (!allPainPoints.has(key)) allPainPoints.set(key, new Set());
          allPainPoints.get(key)!.add(a.asin);
        });
      }
    });

    // Sort by frequency (how many ASINs share the pain point)
    const sorted = Array.from(allPainPoints.entries())
      .sort((a, b) => b[1].size - a[1].size);

    return sorted;
  }, [selectedAnalyses]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">竞品对比</h1>
          <p className="text-muted-foreground mt-1">
            选择多个已分析的ASIN进行并排比较，发现竞品差异和机会
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
      ) : isLoading ? (
        <div className="space-y-4">
          {[1, 2].map(i => (
            <Card key={i}><CardContent className="p-6"><div className="h-20 bg-muted animate-pulse rounded" /></CardContent></Card>
          ))}
        </div>
      ) : !analyses || analyses.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <BarChart3 className="h-8 w-8 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">暂无竞品分析数据</p>
            <p className="text-muted-foreground text-xs mt-1">请先在竞品分析页面分析至少2个ASIN</p>
          </CardContent>
        </Card>
      ) : analyses.length < 2 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <BarChart3 className="h-8 w-8 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">至少需要2个竞品分析结果才能进行对比</p>
            <p className="text-muted-foreground text-xs mt-1">当前有 {analyses.length} 个分析结果，请再分析更多ASIN</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* ASIN Selector */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ArrowUpDown className="h-4 w-4" />
                    选择对比ASIN
                  </CardTitle>
                  <CardDescription className="mt-1">
                    选择2-8个已分析的ASIN进行并排对比
                  </CardDescription>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">
                    已选 {selectedIds.size}/{Math.min(analyses.length, 8)}
                  </Badge>
                  <Button variant="outline" size="sm" onClick={toggleAll}>
                    {selectedIds.size > 0 ? "取消全选" : "全选"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {analyses.map((analysis, idx) => {
                  const isSelected = selectedIds.has(analysis.id);
                  const colorClass = ASIN_COLORS[idx % ASIN_COLORS.length];
                  const rawData = parseJson(analysis.rawData);
                  const isManual = rawData?.manualInput === true;

                  return (
                    <div
                      key={analysis.id}
                      className={`flex items-start gap-3 p-3 rounded-lg border-2 transition-all cursor-pointer hover:shadow-sm ${
                        isSelected
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-transparent bg-muted/30 hover:bg-muted/50"
                      }`}
                      onClick={() => toggleSelection(analysis.id)}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelection(analysis.id)}
                        className="mt-0.5 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className={`font-mono text-xs border ${colorClass}`}>
                            {analysis.asin}
                          </Badge>
                          {isManual && (
                            <Badge variant="secondary" className="text-[10px] h-4 px-1">手动</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {analysis.title || "未知标题"}
                        </p>
                        <div className="flex items-center gap-3 mt-1.5">
                          {analysis.price && (
                            <span className="text-xs font-medium">{analysis.price}</span>
                          )}
                          {analysis.rating && (
                            <span className="text-xs flex items-center gap-0.5">
                              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                              {analysis.rating}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Comparison Results */}
          {selectedAnalyses.length >= 2 && (
            <Tabs defaultValue="overview" className="space-y-4">
              <TabsList>
                <TabsTrigger value="overview">
                  <Package className="h-3.5 w-3.5 mr-1.5" />
                  基本信息
                </TabsTrigger>
                <TabsTrigger value="keywords">
                  <Key className="h-3.5 w-3.5 mr-1.5" />
                  关键词对比
                </TabsTrigger>
                <TabsTrigger value="reviews">
                  <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                  评论分析对比
                </TabsTrigger>
                <TabsTrigger value="bullets">
                  <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
                  五点描述对比
                </TabsTrigger>
                <TabsTrigger value="ai-summary">
                  <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                  AI智能总结
                </TabsTrigger>
              </TabsList>

              {/* Overview Tab */}
              <TabsContent value="overview">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">基本信息对比</CardTitle>
                    <CardDescription>
                      价格、评分、品牌、标题长度等基本指标的并排比较
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="w-full">
                      <div className="min-w-[600px]">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-3 px-4 font-medium text-muted-foreground w-[140px] sticky left-0 bg-card z-10">
                                指标
                              </th>
                              {selectedAnalyses.map((a, idx) => (
                                <th key={a.id} className="text-left py-3 px-4 font-medium min-w-[180px]">
                                  <Badge className={`font-mono text-xs border ${ASIN_COLORS[analyses?.findIndex(x => x.id === a.id) ?? idx % ASIN_COLORS.length]}`}>
                                    {a.asin}
                                  </Badge>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {/* Title */}
                            <tr className="border-b hover:bg-muted/30">
                              <td className="py-3 px-4 font-medium text-muted-foreground sticky left-0 bg-card z-10">标题</td>
                              {selectedAnalyses.map(a => (
                                <td key={a.id} className="py-3 px-4">
                                  <p className="text-xs leading-relaxed line-clamp-3">{a.title}</p>
                                  <span className={`text-[10px] mt-1 inline-block ${
                                    a.title.length >= 180 && a.title.length <= 200 ? "text-green-600" :
                                    a.title.length > 200 ? "text-red-600" : "text-amber-600"
                                  }`}>
                                    {a.title.length} 字符
                                  </span>
                                </td>
                              ))}
                            </tr>
                            {/* Brand */}
                            <tr className="border-b hover:bg-muted/30">
                              <td className="py-3 px-4 font-medium text-muted-foreground sticky left-0 bg-card z-10">品牌</td>
                              {selectedAnalyses.map(a => (
                                <td key={a.id} className="py-3 px-4 font-medium">{a.brand}</td>
                              ))}
                            </tr>
                            {/* Price */}
                            <tr className="border-b hover:bg-muted/30">
                              <td className="py-3 px-4 font-medium text-muted-foreground sticky left-0 bg-card z-10">
                                <div className="flex items-center gap-1.5">
                                  <DollarSign className="h-3.5 w-3.5" />
                                  价格
                                </div>
                              </td>
                              {selectedAnalyses.map(a => {
                                const prices = selectedAnalyses
                                  .map(x => parseFloat(x.price.replace(/[^0-9.]/g, "")))
                                  .filter(p => !isNaN(p));
                                const currentPrice = parseFloat(a.price.replace(/[^0-9.]/g, ""));
                                const minPrice = Math.min(...prices);
                                const maxPrice = Math.max(...prices);
                                const isLowest = !isNaN(currentPrice) && currentPrice === minPrice && prices.length > 1;
                                const isHighest = !isNaN(currentPrice) && currentPrice === maxPrice && prices.length > 1;

                                return (
                                  <td key={a.id} className="py-3 px-4">
                                    <span className={`font-semibold text-base ${
                                      isLowest ? "text-green-600" : isHighest ? "text-red-600" : ""
                                    }`}>
                                      {a.price}
                                    </span>
                                    {isLowest && <Badge variant="secondary" className="ml-2 text-[10px] h-4 px-1 bg-green-100 text-green-700">最低</Badge>}
                                    {isHighest && <Badge variant="secondary" className="ml-2 text-[10px] h-4 px-1 bg-red-100 text-red-700">最高</Badge>}
                                  </td>
                                );
                              })}
                            </tr>
                            {/* Rating */}
                            <tr className="border-b hover:bg-muted/30">
                              <td className="py-3 px-4 font-medium text-muted-foreground sticky left-0 bg-card z-10">
                                <div className="flex items-center gap-1.5">
                                  <Star className="h-3.5 w-3.5" />
                                  评分
                                </div>
                              </td>
                              {selectedAnalyses.map(a => {
                                const ratings = selectedAnalyses
                                  .map(x => parseFloat(x.rating))
                                  .filter(r => !isNaN(r));
                                const currentRating = parseFloat(a.rating);
                                const maxRating = Math.max(...ratings);
                                const isBest = !isNaN(currentRating) && currentRating === maxRating && ratings.length > 1;

                                return (
                                  <td key={a.id} className="py-3 px-4">
                                    <div className="flex items-center gap-2">
                                      <div className="flex items-center gap-1">
                                        {[1, 2, 3, 4, 5].map(star => {
                                          const val = parseFloat(a.rating);
                                          return (
                                            <Star
                                              key={star}
                                              className={`h-3.5 w-3.5 ${
                                                !isNaN(val) && star <= Math.round(val)
                                                  ? "fill-amber-400 text-amber-400"
                                                  : "text-muted-foreground/30"
                                              }`}
                                            />
                                          );
                                        })}
                                      </div>
                                      <span className="font-semibold">{a.rating}</span>
                                      {isBest && <Badge variant="secondary" className="text-[10px] h-4 px-1 bg-amber-100 text-amber-700">最高</Badge>}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                            {/* Review Count */}
                            <tr className="border-b hover:bg-muted/30">
                              <td className="py-3 px-4 font-medium text-muted-foreground sticky left-0 bg-card z-10">评论数</td>
                              {selectedAnalyses.map(a => (
                                <td key={a.id} className="py-3 px-4">{a.reviewCount}</td>
                              ))}
                            </tr>
                            {/* Bullet Points Count */}
                            <tr className="border-b hover:bg-muted/30">
                              <td className="py-3 px-4 font-medium text-muted-foreground sticky left-0 bg-card z-10">五点数量</td>
                              {selectedAnalyses.map(a => (
                                <td key={a.id} className="py-3 px-4">{a.bulletPoints.length} 条</td>
                              ))}
                            </tr>
                            {/* Data Source */}
                            <tr className="hover:bg-muted/30">
                              <td className="py-3 px-4 font-medium text-muted-foreground sticky left-0 bg-card z-10">数据来源</td>
                              {selectedAnalyses.map(a => (
                                <td key={a.id} className="py-3 px-4">
                                  <Badge variant={a.isManual ? "outline" : "secondary"} className="text-xs">
                                    {a.isManual ? "手动输入" : "自动爬取"}
                                  </Badge>
                                </td>
                              ))}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Keywords Tab */}
              <TabsContent value="keywords">
                <div className="space-y-4">
                  {/* Shared Keywords */}
                  {keywordComparison && (
                    <>
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                            共同关键词
                            <Badge variant="secondary" className="ml-1">{keywordComparison.shared.size}</Badge>
                          </CardTitle>
                          <CardDescription>
                            所有选中竞品都包含的关键词，代表品类核心词
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          {keywordComparison.shared.size > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {Array.from(keywordComparison.shared).map(kw => (
                                <Badge key={kw} variant="default" className="text-xs">
                                  {kw}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">未发现完全共同的关键词</p>
                          )}
                        </CardContent>
                      </Card>

                      {/* Unique Keywords per ASIN */}
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base flex items-center gap-2">
                            <XCircle className="h-4 w-4 text-blue-500" />
                            独有关键词
                          </CardTitle>
                          <CardDescription>
                            每个竞品独有的关键词，代表差异化卖点
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-4">
                            {keywordComparison.uniquePerAsin.map((item, idx) => (
                              <div key={item.asin}>
                                <div className="flex items-center gap-2 mb-2">
                                  <Badge className={`font-mono text-xs border ${ASIN_COLORS[analyses?.findIndex(a => a.asin === item.asin) ?? idx % ASIN_COLORS.length]}`}>
                                    {item.asin}
                                  </Badge>
                                  <Badge variant="secondary" className="text-xs">{item.keywords.size} 个独有</Badge>
                                </div>
                                {item.keywords.size > 0 ? (
                                  <div className="flex flex-wrap gap-1.5 ml-2">
                                    {Array.from(item.keywords).map(kw => (
                                      <Badge key={kw} variant="outline" className="text-xs">
                                        {kw}
                                      </Badge>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-muted-foreground ml-2">无独有关键词</p>
                                )}
                                {idx < keywordComparison.uniquePerAsin.length - 1 && (
                                  <Separator className="mt-3" />
                                )}
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    </>
                  )}

                  {/* Per-ASIN Keyword Breakdown */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">各竞品关键词详情</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="w-full">
                        <div className="min-w-[600px]">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b">
                                <th className="text-left py-3 px-4 font-medium text-muted-foreground w-[120px] sticky left-0 bg-card z-10">
                                  类型
                                </th>
                                {selectedAnalyses.map((a, idx) => (
                                  <th key={a.id} className="text-left py-3 px-4 font-medium min-w-[200px]">
                                    <Badge className={`font-mono text-xs border ${ASIN_COLORS[analyses?.findIndex(x => x.id === a.id) ?? idx % ASIN_COLORS.length]}`}>
                                      {a.asin}
                                    </Badge>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {/* Core Keywords */}
                              <tr className="border-b hover:bg-muted/30">
                                <td className="py-3 px-4 font-medium text-muted-foreground sticky left-0 bg-card z-10">核心词</td>
                                {selectedAnalyses.map(a => (
                                  <td key={a.id} className="py-3 px-4">
                                    <div className="flex flex-wrap gap-1">
                                      {a.keywords?.core?.map((k: any, i: number) => (
                                        <Badge key={i} variant="default" className="text-[10px]">
                                          {getKeywordText(k)}
                                        </Badge>
                                      )) || <span className="text-xs text-muted-foreground">-</span>}
                                    </div>
                                  </td>
                                ))}
                              </tr>
                              {/* Long-tail Keywords */}
                              <tr className="border-b hover:bg-muted/30">
                                <td className="py-3 px-4 font-medium text-muted-foreground sticky left-0 bg-card z-10">长尾词</td>
                                {selectedAnalyses.map(a => (
                                  <td key={a.id} className="py-3 px-4">
                                    <div className="flex flex-wrap gap-1">
                                      {a.keywords?.longTail?.map((k: any, i: number) => (
                                        <Badge key={i} variant="secondary" className="text-[10px]">
                                          {getKeywordText(k)}
                                        </Badge>
                                      )) || <span className="text-xs text-muted-foreground">-</span>}
                                    </div>
                                  </td>
                                ))}
                              </tr>
                              {/* Traffic Keywords */}
                              <tr className="hover:bg-muted/30">
                                <td className="py-3 px-4 font-medium text-muted-foreground sticky left-0 bg-card z-10">流量词</td>
                                {selectedAnalyses.map(a => (
                                  <td key={a.id} className="py-3 px-4">
                                    <div className="flex flex-wrap gap-1">
                                      {a.keywords?.traffic?.map((k: any, i: number) => (
                                        <Badge key={i} variant="outline" className="text-[10px]">
                                          {getKeywordText(k)}
                                        </Badge>
                                      )) || <span className="text-xs text-muted-foreground">-</span>}
                                    </div>
                                  </td>
                                ))}
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        <ScrollBar orientation="horizontal" />
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* Reviews Tab */}
              <TabsContent value="reviews">
                <div className="space-y-4">
                  {/* Common Pain Points Matrix */}
                  {painPointComparison && painPointComparison.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-red-500" />
                          痛点交叉分析
                        </CardTitle>
                        <CardDescription>
                          显示各竞品共有的用户痛点，帮助发现品类通病和差异化机会
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ScrollArea className="w-full">
                          <div className="min-w-[500px]">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b">
                                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">痛点</th>
                                  {selectedAnalyses.map((a, idx) => (
                                    <th key={a.id} className="text-center py-2 px-3 font-medium min-w-[80px]">
                                      <Badge className={`font-mono text-[10px] border ${ASIN_COLORS[analyses?.findIndex(x => x.id === a.id) ?? idx % ASIN_COLORS.length]}`}>
                                        {a.asin.slice(-4)}
                                      </Badge>
                                    </th>
                                  ))}
                                  <th className="text-center py-2 px-3 font-medium text-muted-foreground min-w-[60px]">频率</th>
                                </tr>
                              </thead>
                              <tbody>
                                {painPointComparison.slice(0, 15).map(([issue, asins]) => (
                                  <tr key={issue} className="border-b hover:bg-muted/30">
                                    <td className="py-2 px-3 text-xs max-w-[250px]">{issue}</td>
                                    {selectedAnalyses.map(a => (
                                      <td key={a.id} className="text-center py-2 px-3">
                                        {asins.has(a.asin) ? (
                                          <CheckCircle2 className="h-4 w-4 text-red-500 mx-auto" />
                                        ) : (
                                          <Minus className="h-4 w-4 text-muted-foreground/30 mx-auto" />
                                        )}
                                      </td>
                                    ))}
                                    <td className="text-center py-2 px-3">
                                      <Badge variant={asins.size === selectedAnalyses.length ? "destructive" : "secondary"} className="text-[10px]">
                                        {asins.size}/{selectedAnalyses.length}
                                      </Badge>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <ScrollBar orientation="horizontal" />
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  )}

                  {/* Per-ASIN Review Analysis */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">各竞品评论分析详情</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="w-full">
                        <div className="min-w-[600px]">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b">
                                <th className="text-left py-3 px-4 font-medium text-muted-foreground w-[100px] sticky left-0 bg-card z-10">
                                  类型
                                </th>
                                {selectedAnalyses.map((a, idx) => (
                                  <th key={a.id} className="text-left py-3 px-4 font-medium min-w-[220px]">
                                    <Badge className={`font-mono text-xs border ${ASIN_COLORS[analyses?.findIndex(x => x.id === a.id) ?? idx % ASIN_COLORS.length]}`}>
                                      {a.asin}
                                    </Badge>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {/* Pain Points */}
                              <tr className="border-b hover:bg-muted/30 align-top">
                                <td className="py-3 px-4 font-medium text-red-600 sticky left-0 bg-card z-10">
                                  <div className="flex items-center gap-1">
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                    痛点
                                  </div>
                                </td>
                                {selectedAnalyses.map(a => (
                                  <td key={a.id} className="py-3 px-4">
                                    {a.reviewAnalysis?.painPoints?.length ? (
                                      <div className="space-y-1.5">
                                        {a.reviewAnalysis.painPoints.map((p, i) => (
                                          <div key={i} className="p-2 bg-red-50 rounded text-xs border border-red-100">
                                            <p className="font-medium text-red-800">{p.issue}</p>
                                            {p.severity && (
                                              <span className="text-[10px] text-red-600">严重度: {p.severity}</span>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">无数据</span>
                                    )}
                                  </td>
                                ))}
                              </tr>
                              {/* Itch Points */}
                              <tr className="border-b hover:bg-muted/30 align-top">
                                <td className="py-3 px-4 font-medium text-amber-600 sticky left-0 bg-card z-10">
                                  <div className="flex items-center gap-1">
                                    <TrendingUp className="h-3.5 w-3.5" />
                                    痒点
                                  </div>
                                </td>
                                {selectedAnalyses.map(a => (
                                  <td key={a.id} className="py-3 px-4">
                                    {a.reviewAnalysis?.itchPoints?.length ? (
                                      <div className="space-y-1.5">
                                        {a.reviewAnalysis.itchPoints.map((p, i) => (
                                          <div key={i} className="p-2 bg-amber-50 rounded text-xs border border-amber-100">
                                            <p className="font-medium text-amber-800">{p.desire}</p>
                                            {p.importance && (
                                              <span className="text-[10px] text-amber-600">重要性: {p.importance}</span>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">无数据</span>
                                    )}
                                  </td>
                                ))}
                              </tr>
                              {/* Delight Points */}
                              <tr className="hover:bg-muted/30 align-top">
                                <td className="py-3 px-4 font-medium text-green-600 sticky left-0 bg-card z-10">
                                  <div className="flex items-center gap-1">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    爽点
                                  </div>
                                </td>
                                {selectedAnalyses.map(a => (
                                  <td key={a.id} className="py-3 px-4">
                                    {a.reviewAnalysis?.delightPoints?.length ? (
                                      <div className="space-y-1.5">
                                        {a.reviewAnalysis.delightPoints.map((p, i) => (
                                          <div key={i} className="p-2 bg-green-50 rounded text-xs border border-green-100">
                                            <p className="font-medium text-green-800">{p.feature}</p>
                                            {p.impact && (
                                              <span className="text-[10px] text-green-600">影响: {p.impact}</span>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">无数据</span>
                                    )}
                                  </td>
                                ))}
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        <ScrollBar orientation="horizontal" />
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* Bullet Points Tab */}
              <TabsContent value="bullets">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">五点描述对比</CardTitle>
                    <CardDescription>
                      并排展示各竞品的五点描述，分析卖点差异和表达方式
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="w-full">
                      <div className="min-w-[600px]">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-3 px-4 font-medium text-muted-foreground w-[60px] sticky left-0 bg-card z-10">
                                #
                              </th>
                              {selectedAnalyses.map((a, idx) => (
                                <th key={a.id} className="text-left py-3 px-4 font-medium min-w-[250px]">
                                  <Badge className={`font-mono text-xs border ${ASIN_COLORS[analyses?.findIndex(x => x.id === a.id) ?? idx % ASIN_COLORS.length]}`}>
                                    {a.asin}
                                  </Badge>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {[0, 1, 2, 3, 4].map(bulletIdx => (
                              <tr key={bulletIdx} className="border-b hover:bg-muted/30 align-top">
                                <td className="py-3 px-4 font-bold text-muted-foreground sticky left-0 bg-card z-10">
                                  {bulletIdx + 1}
                                </td>
                                {selectedAnalyses.map(a => (
                                  <td key={a.id} className="py-3 px-4">
                                    {a.bulletPoints[bulletIdx] ? (
                                      <div>
                                        <p className="text-xs leading-relaxed">{a.bulletPoints[bulletIdx]}</p>
                                        <span className={`text-[10px] mt-1 inline-block ${
                                          a.bulletPoints[bulletIdx].length >= 250 && a.bulletPoints[bulletIdx].length <= 300
                                            ? "text-green-600"
                                            : a.bulletPoints[bulletIdx].length > 300
                                              ? "text-red-600"
                                              : "text-amber-600"
                                        }`}>
                                          {a.bulletPoints[bulletIdx].length} 字符
                                        </span>
                                      </div>
                                    ) : (
                                      <span className="text-xs text-muted-foreground italic">无</span>
                                    )}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* AI Summary Tab */}
              <TabsContent value="ai-summary">
                <AISummarySection
                  projectId={selectedProjectId!}
                  selectedIds={selectedIds}
                  selectedAnalyses={selectedAnalyses}
                  aiSummary={aiSummary}
                  setAiSummary={setAiSummary}
                />
              </TabsContent>
            </Tabs>
          )}

          {/* Prompt to select more */}
          {selectedIds.size > 0 && selectedIds.size < 2 && (
            <Card className="border-dashed border-amber-200 bg-amber-50/50">
              <CardContent className="flex items-center justify-center py-8">
                <p className="text-sm text-amber-700">
                  请再选择至少 <span className="font-bold">1</span> 个ASIN以开始对比分析
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
