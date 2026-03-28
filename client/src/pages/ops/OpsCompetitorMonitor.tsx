import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Eye, TrendingUp, TrendingDown, DollarSign, Star, BarChart3,
  Search, Loader2, Sparkles, AlertTriangle, ArrowUpRight, ArrowDownRight,
  Minus, RefreshCw, Users
} from "lucide-react";
import { toast } from "sonner";

function PriceChangeIcon({ change }: { change: number }) {
  if (change > 0) return <ArrowUpRight className="h-4 w-4 text-red-500" />;
  if (change < 0) return <ArrowDownRight className="h-4 w-4 text-green-500" />;
  return <Minus className="h-4 w-4 text-muted-foreground" />;
}

export default function OpsCompetitorMonitor() {
  const [searchAsin, setSearchAsin] = useState('');
  const [compareAsins, setCompareAsins] = useState('');

  const listQuery = trpc.competitorMonitor.getCompetitorList.useQuery({ offset: 0, length: 50 });
  const priceChangesQuery = trpc.competitorMonitor.getCompetitorPriceChanges.useQuery({ days: 30 });
  const reviewChangesQuery = trpc.competitorMonitor.getCompetitorReviewChanges.useQuery({ days: 7 });
  const aiInsightMutation = trpc.competitorMonitor.aiCompetitorInsight.useMutation();

  const handleAiAnalysis = (focusArea: 'pricing' | 'reviews' | 'bsr' | 'overall') => {
    const competitorData = {
      competitors: listQuery.data?.list?.slice(0, 10) || [],
      priceChanges: priceChangesQuery.data?.changes?.slice(0, 10) || [],
      reviewChanges: reviewChangesQuery.data?.changes?.slice(0, 10) || [],
    };
    aiInsightMutation.mutate({ competitorData, focusArea });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Eye className="h-6 w-6 text-primary" />
            竞品监控中心
          </h2>
          <p className="text-muted-foreground mt-1">价格追踪 · BSR排名 · Review变动 · AI竞品解读</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => handleAiAnalysis('overall')} disabled={aiInsightMutation.isPending}>
            {aiInsightMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            AI竞品分析
          </Button>
        </div>
      </div>

      {/* AI Insight Card */}
      {aiInsightMutation.data && (
        <Card className="border-primary/30 bg-gradient-to-r from-primary/5 to-transparent">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              AI竞品洞察
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm font-medium">{aiInsightMutation.data.summary}</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Key Findings */}
              <div>
                <h4 className="text-sm font-medium mb-2">关键发现</h4>
                <div className="space-y-1">
                  {aiInsightMutation.data.keyFindings?.map((f: string, i: number) => (
                    <div key={i} className="text-sm flex items-start gap-2 p-2 rounded bg-muted/50">
                      <span className="text-primary font-medium">{i + 1}.</span>
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Threats */}
              <div>
                <h4 className="text-sm font-medium text-red-600 mb-2 flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4" />竞争威胁
                </h4>
                <div className="space-y-1">
                  {aiInsightMutation.data.threats?.map((t: any, i: number) => (
                    <div key={i} className="text-sm p-2 rounded bg-red-50 dark:bg-red-900/10">
                      <div className="flex items-center gap-2">
                        <Badge variant={t.severity === 'high' ? 'destructive' : t.severity === 'medium' ? 'default' : 'secondary'} className="text-xs">
                          {t.severity === 'high' ? '高' : t.severity === 'medium' ? '中' : '低'}
                        </Badge>
                        <span className="font-medium">{t.competitor}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{t.threat}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Action Plan */}
            {aiInsightMutation.data.actionPlan?.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">行动计划</h4>
                <div className="space-y-1">
                  {aiInsightMutation.data.actionPlan.map((a: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-sm p-2 rounded bg-muted/50">
                      <Badge variant={a.priority === 'P0' ? 'destructive' : a.priority === 'P1' ? 'default' : 'secondary'} className="text-xs">{a.priority}</Badge>
                      <span className="flex-1">{a.action}</span>
                      <span className="text-xs text-muted-foreground">{a.timeline}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {aiInsightMutation.data.pricingInsight && (
              <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/10 text-sm">
                <span className="font-medium text-blue-600">💰 价格策略建议：</span>
                <span>{aiInsightMutation.data.pricingInsight}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list"><Users className="h-4 w-4 mr-1" />竞品列表</TabsTrigger>
          <TabsTrigger value="price"><DollarSign className="h-4 w-4 mr-1" />价格变动</TabsTrigger>
          <TabsTrigger value="reviews"><Star className="h-4 w-4 mr-1" />Review变动</TabsTrigger>
          <TabsTrigger value="compare"><BarChart3 className="h-4 w-4 mr-1" />属性对比</TabsTrigger>
        </TabsList>

        {/* Competitor List */}
        <TabsContent value="list">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  竞品监控列表
                  {listQuery.data && <Badge variant="outline">{listQuery.data.total}个竞品</Badge>}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Input placeholder="搜索ASIN..." value={searchAsin} onChange={e => setSearchAsin(e.target.value)} className="w-48" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {listQuery.isLoading ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-3 font-medium">ASIN</th>
                        <th className="text-left py-2 px-3 font-medium">标题</th>
                        <th className="text-left py-2 px-3 font-medium">品牌</th>
                        <th className="text-right py-2 px-3 font-medium">价格</th>
                        <th className="text-right py-2 px-3 font-medium">评分</th>
                        <th className="text-right py-2 px-3 font-medium">Review数</th>
                        <th className="text-right py-2 px-3 font-medium">BSR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listQuery.data?.list
                        ?.filter((c: any) => !searchAsin || c.asin.includes(searchAsin.toUpperCase()))
                        .map((c: any, i: number) => (
                        <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="py-2 px-3 font-mono text-xs">{c.asin}</td>
                          <td className="py-2 px-3 max-w-[200px] truncate">{c.title}</td>
                          <td className="py-2 px-3">{c.brand}</td>
                          <td className="py-2 px-3 text-right font-medium">${c.price.toFixed(2)}</td>
                          <td className="py-2 px-3 text-right">
                            <span className="flex items-center justify-end gap-1">
                              <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                              {c.rating.toFixed(1)}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right">{c.reviewCount.toLocaleString()}</td>
                          <td className="py-2 px-3 text-right">#{c.bsr.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Price Changes */}
        <TabsContent value="price">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                近30天价格变动
                {priceChangesQuery.data && <Badge variant="outline">{priceChangesQuery.data.total}个变动</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {priceChangesQuery.isLoading ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
              ) : priceChangesQuery.data?.changes.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">近30天无价格变动</p>
              ) : (
                <div className="space-y-3">
                  {priceChangesQuery.data?.changes.map((c: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex items-center gap-3">
                        <PriceChangeIcon change={c.change} />
                        <div>
                          <div className="font-medium text-sm">{c.asin}</div>
                          <div className="text-xs text-muted-foreground">{c.brand} · {c.title?.slice(0, 40)}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground line-through">${c.oldPrice.toFixed(2)}</span>
                          <span className="text-sm font-bold">${c.newPrice.toFixed(2)}</span>
                        </div>
                        <div className={`text-xs font-medium ${c.change > 0 ? 'text-red-500' : 'text-green-500'}`}>
                          {c.change > 0 ? '+' : ''}{c.changePercent.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Review Changes */}
        <TabsContent value="reviews">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Star className="h-5 w-5" />
                Review变动监控
                {reviewChangesQuery.data && <Badge variant="outline">{reviewChangesQuery.data.total}个变动</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {reviewChangesQuery.isLoading ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
              ) : reviewChangesQuery.data?.changes.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">近7天无Review变动</p>
              ) : (
                <div className="space-y-3">
                  {reviewChangesQuery.data?.changes.map((c: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          c.ratingChange > 0 ? 'bg-green-100 text-green-600 dark:bg-green-900/30' :
                          c.ratingChange < 0 ? 'bg-red-100 text-red-600 dark:bg-red-900/30' :
                          'bg-muted text-muted-foreground'
                        }`}>
                          <Star className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="font-medium text-sm">{c.asin}</div>
                          <div className="text-xs text-muted-foreground">{c.brand}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-center">
                          <div className="text-xs text-muted-foreground">评分</div>
                          <div className="flex items-center gap-1">
                            <span className="font-medium">{c.currentRating.toFixed(1)}</span>
                            {c.ratingChange !== 0 && (
                              <span className={`text-xs ${c.ratingChange > 0 ? 'text-green-500' : 'text-red-500'}`}>
                                ({c.ratingChange > 0 ? '+' : ''}{c.ratingChange.toFixed(1)})
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-muted-foreground">新增Review</div>
                          <div className={`font-medium ${c.newReviews > 0 ? 'text-blue-500' : ''}`}>
                            {c.newReviews > 0 ? '+' : ''}{c.newReviews}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-muted-foreground">总Review</div>
                          <div className="font-medium">{c.currentCount.toLocaleString()}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Product Comparison */}
        <TabsContent value="compare">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                产品属性对比
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="输入ASIN，逗号分隔（2-5个）"
                  value={compareAsins}
                  onChange={e => setCompareAsins(e.target.value)}
                  className="flex-1"
                />
                <Button
                  onClick={() => {
                    const asins = compareAsins.split(',').map(a => a.trim()).filter(Boolean);
                    if (asins.length < 2) { toast.error('请输入至少2个ASIN'); return; }
                    toast.info('功能开发中，请使用竞品列表查看详情');
                  }}
                >
                  <Search className="h-4 w-4 mr-2" />对比
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                输入2-5个ASIN进行多维度对比分析（价格、评分、Review数、BSR排名、功能特点等）
              </p>

              {/* Quick comparison from list */}
              {listQuery.data?.list && listQuery.data.list.length >= 2 && (
                <div>
                  <h4 className="text-sm font-medium mb-3">快速对比（前5个竞品）</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 px-3 font-medium">维度</th>
                          {listQuery.data.list.slice(0, 5).map((c: any, i: number) => (
                            <th key={i} className="text-center py-2 px-3 font-medium">{c.asin?.slice(-4)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { label: '价格', key: 'price', format: (v: number) => `$${v.toFixed(2)}` },
                          { label: '评分', key: 'rating', format: (v: number) => `⭐${v.toFixed(1)}` },
                          { label: 'Review数', key: 'reviewCount', format: (v: number) => v.toLocaleString() },
                          { label: 'BSR', key: 'bsr', format: (v: number) => `#${v.toLocaleString()}` },
                        ].map(row => (
                          <tr key={row.key} className="border-b border-border/50">
                            <td className="py-2 px-3 font-medium">{row.label}</td>
                            {listQuery.data!.list.slice(0, 5).map((c: any, i: number) => {
                              const val = c[row.key];
                              const allVals = listQuery.data!.list.slice(0, 5).map((x: any) => x[row.key]);
                              const isMax = row.key === 'bsr' ? val === Math.min(...allVals) : val === Math.max(...allVals);
                              return (
                                <td key={i} className={`py-2 px-3 text-center ${isMax ? 'font-bold text-primary' : ''}`}>
                                  {row.format(val)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
