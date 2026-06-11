import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Star, AlertTriangle, Bot, MessageSquare, Check, X, Eye, Edit, Send } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from "recharts";

const STAR_COLORS: Record<number, string> = { 1: "#ef4444", 2: "#f97316", 3: "#eab308", 4: "#3b82f6", 5: "#22c55e" };

export default function ServiceReviews() {
  const [selectedSid, setSelectedSid] = useState<number | undefined>();
  const [starFilter, setStarFilter] = useState<number | undefined>();
  const [page, setPage] = useState(1);
  const [selectedReview, setSelectedReview] = useState<any>(null);
  const [editedReply, setEditedReply] = useState("");
  const [showAnalysisDialog, setShowAnalysisDialog] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);

  const marketplacesQuery = trpc.operations.getMarketplaces.useQuery();
  const reviewsQuery = trpc.afterSales.getReviews.useQuery({ sid: selectedSid, starFilter, page, pageSize: 20 });
  const statsQuery = trpc.afterSales.getReviewStats.useQuery({ sid: selectedSid });
  const analysisMut = trpc.afterSales.aiReviewAnalysis.useMutation();

  const starDistribution = useMemo(() => {
    const stats = statsQuery.data;
    if (!stats?.daily?.length) return [];
    const totals: Record<string, number> = { "1星": 0, "2星": 0, "3星": 0, "4星": 0, "5星": 0 };
    stats.daily.forEach((d: any) => {
      totals["1星"] += d.star_1 || 0;
      totals["2星"] += d.star_2 || 0;
      totals["3星"] += d.star_3 || 0;
      totals["4星"] += d.star_4 || 0;
      totals["5星"] += d.star_5 || 0;
    });
    return Object.entries(totals).map(([name, value], i) => ({ name, value, fill: Object.values(STAR_COLORS)[i] }));
  }, [statsQuery.data]);

  const handleAnalyze = async (review: any) => {
    setSelectedReview(review);
    setShowAnalysisDialog(true);
    setAnalysisResult(null);
    const result = await analysisMut.mutateAsync({
      reviewId: review.review_id,
      starRating: review.star_rating,
      reviewTitle: review.title || "",
      reviewContent: review.content || "",
      asin: review.asin,
    });
    setAnalysisResult(result);
    setEditedReply((result as any)?.suggestedReply || "");
  };

  const reviews = reviewsQuery.data?.list || [];
  const negativeReviews = reviews.filter((r: any) => r.star_rating <= 2);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Review智能管理</h1>
          <p className="text-muted-foreground text-sm mt-1">监控、分析和回复产品Review</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedSid?.toString() || "all"} onValueChange={v => setSelectedSid(v === "all" ? undefined : Number(v))}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="全部店铺" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部店铺</SelectItem>
              {(marketplacesQuery.data || []).flatMap((mp: any) => mp.sids.map((sid: string, i: number) => (
                <SelectItem key={sid} value={sid}>{mp.storeNames?.[i] || `${mp.name}-${sid}`}</SelectItem>
              )))}
            </SelectContent>
          </Select>
          <Select value={starFilter?.toString() || "all"} onValueChange={v => { setStarFilter(v === "all" ? undefined : Number(v)); setPage(1); }}>
            <SelectTrigger className="w-[120px]"><SelectValue placeholder="全部星级" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部星级</SelectItem>
              {[1, 2, 3, 4, 5].map(s => <SelectItem key={s} value={s.toString()}>{s}星</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Star Distribution Chart */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">评分分布（近30天）</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={starDistribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {starDistribution.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Stats Summary */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Review概览</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
              <span className="text-sm">平均评分</span>
              <div className="flex items-center gap-1">
                <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                <span className="font-bold text-lg">{statsQuery.data?.average_rating || "N/A"}</span>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
              <span className="text-sm">总Review数</span>
              <span className="font-bold">{statsQuery.data?.total_reviews || 0}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-red-50 dark:bg-red-950/20">
              <span className="text-sm text-red-600">差评预警（1-2星）</span>
              <Badge variant="destructive">{negativeReviews.length}</Badge>
            </div>
          </CardContent>
        </Card>

        {/* Negative Review Alert Queue */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" /> 差评预警队列
            </CardTitle>
          </CardHeader>
          <CardContent>
            {negativeReviews.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">暂无差评预警</div>
            ) : (
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {negativeReviews.slice(0, 5).map((r: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 p-2 rounded-lg border border-red-200 dark:border-red-900 cursor-pointer hover:bg-red-50 dark:hover:bg-red-950/30" onClick={() => handleAnalyze(r)}>
                    <Badge variant="destructive" className="shrink-0 text-xs">{r.star_rating}★</Badge>
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{r.title || "无标题"}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{r.content?.slice(0, 60)}...</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Review List */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Review列表</CardTitle>
        </CardHeader>
        <CardContent>
          {reviewsQuery.isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <div className="space-y-3">
              {reviews.map((review: any, i: number) => (
                <div key={i} className="flex items-start gap-4 p-4 rounded-lg border hover:bg-muted/30 transition-colors">
                  <div className="shrink-0">
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map(s => (
                        <Star key={s} className={`h-3.5 w-3.5 ${s <= review.star_rating ? 'text-yellow-500 fill-yellow-500' : 'text-gray-300'}`} />
                      ))}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">{review.review_date}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{review.title || "无标题"}</span>
                      {review.is_verified_purchase ? <Badge variant="outline" className="text-[10px]">VP</Badge> : null}
                      {review.has_image ? <Badge variant="secondary" className="text-[10px]">含图</Badge> : null}
                      {review.has_video ? <Badge variant="secondary" className="text-[10px]">含视频</Badge> : null}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{review.content}</p>
                    <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                      <span>ASIN: {review.asin}</span>
                      <span>·</span>
                      <span>{review.reviewer_name}</span>
                    </div>
                  </div>
                  <div className="shrink-0 flex gap-2">
                    {review.star_rating <= 3 && (
                      <Button size="sm" variant="outline" onClick={() => handleAnalyze(review)} disabled={analysisMut.isPending}>
                        <Bot className="h-3.5 w-3.5 mr-1" /> AI分析
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {reviews.length === 0 && <div className="text-center py-8 text-muted-foreground text-sm">暂无Review数据</div>}
            </div>
          )}
          {/* Pagination */}
          {(reviewsQuery.data?.total || 0) > 20 && (
            <div className="flex justify-center gap-2 mt-4">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</Button>
              <span className="text-sm self-center">第{page}页</span>
              <Button size="sm" variant="outline" disabled={reviews.length < 20} onClick={() => setPage(p => p + 1)}>下一页</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Analysis Dialog */}
      <Dialog open={showAnalysisDialog} onOpenChange={setShowAnalysisDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-blue-500" /> AI差评分析与回复
            </DialogTitle>
          </DialogHeader>

          {selectedReview && (
            <div className="space-y-4">
              {/* Original Review */}
              <div className="p-3 rounded-lg bg-muted/30 border">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex">
                    {[1, 2, 3, 4, 5].map(s => (
                      <Star key={s} className={`h-3.5 w-3.5 ${s <= selectedReview.star_rating ? 'text-yellow-500 fill-yellow-500' : 'text-gray-300'}`} />
                    ))}
                  </div>
                  <span className="text-sm font-medium">{selectedReview.title}</span>
                </div>
                <p className="text-sm text-muted-foreground">{selectedReview.content}</p>
              </div>

              {/* Analysis Result */}
              {analysisMut.isPending ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  <span className="text-sm text-muted-foreground">AI正在分析中...</span>
                </div>
              ) : analysisResult ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg border">
                      <div className="text-xs text-muted-foreground mb-1">问题分类</div>
                      <Badge>{analysisResult.problemCategory}</Badge>
                    </div>
                    <div className="p-3 rounded-lg border">
                      <div className="text-xs text-muted-foreground mb-1">严重程度</div>
                      <Badge variant={analysisResult.severity === "high" ? "destructive" : analysisResult.severity === "medium" ? "default" : "secondary"}>
                        {analysisResult.severity === "high" ? "高" : analysisResult.severity === "medium" ? "中" : "低"}
                      </Badge>
                    </div>
                  </div>

                  {/* Key Issues */}
                  <div className="p-3 rounded-lg border">
                    <div className="text-xs text-muted-foreground mb-2">关键问题</div>
                    <div className="flex flex-wrap gap-1.5">
                      {(analysisResult.keyIssues || []).map((issue: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-xs">{issue}</Badge>
                      ))}
                    </div>
                  </div>

                  {/* Internal Action */}
                  <div className="p-3 rounded-lg border bg-blue-50 dark:bg-blue-950/20">
                    <div className="text-xs text-muted-foreground mb-1">内部改进建议</div>
                    <p className="text-sm">{analysisResult.internalAction}</p>
                  </div>

                  {/* Editable Reply Draft */}
                  <div className="p-3 rounded-lg border">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs text-muted-foreground">公开回复草稿（可编辑）</div>
                      {analysisResult.followUpNeeded && <Badge variant="destructive" className="text-[10px]">需跟进</Badge>}
                    </div>
                    <Textarea
                      value={editedReply}
                      onChange={e => setEditedReply(e.target.value)}
                      rows={5}
                      className="text-sm"
                    />
                  </div>
                </div>
              ) : null}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAnalysisDialog(false)}>关闭</Button>
            {analysisResult && (
              <Button onClick={() => { setShowAnalysisDialog(false); }}>
                <Check className="h-4 w-4 mr-1" /> 确认回复
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
