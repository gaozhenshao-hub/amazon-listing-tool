import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, BarChart, Bar, Legend,
} from "recharts";
import {
  Bot, Play, Square, RefreshCw, Loader2, Clock, CheckCircle2,
  XCircle, TrendingUp, TrendingDown, Eye, Activity, Zap, Timer,
  BarChart3, ArrowUpRight, ArrowDownRight, Minus, History, Settings2,
  Search, Package, DollarSign, Star, AlertTriangle,
} from "lucide-react";

// ─── Scheduler Control Panel ───────────────────────────────────
function SchedulerPanel() {
  const { data: status, isLoading, refetch } = trpc.crawler.getSchedulerStatus.useQuery(
    undefined, { refetchInterval: 10000 }
  );
  const startScheduler = trpc.crawler.startScheduler.useMutation({
    onSuccess: () => { toast.success("定时调度器已启动"); refetch(); },
    onError: (e) => toast.error("启动失败", { description: e.message }),
  });
  const stopScheduler = trpc.crawler.stopScheduler.useMutation({
    onSuccess: () => { toast.success("定时调度器已停止"); refetch(); },
    onError: (e) => toast.error("停止失败", { description: e.message }),
  });

  if (isLoading) return <Skeleton className="h-40" />;

  const isRunning = status?.isRunning ?? false;
  const lastRun = status?.lastRunAt ? new Date(status.lastRunAt).toLocaleString() : "从未运行";
  const nextRun = status?.nextRunAt ? new Date(status.nextRunAt).toLocaleString() : "—";

  return (
    <Card className="border-l-4 border-l-orange-500">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isRunning ? "bg-green-100" : "bg-gray-100"}`}>
              <Bot className={`w-4 h-4 ${isRunning ? "text-green-600" : "text-gray-400"}`} />
            </div>
            <div>
              <CardTitle className="text-base">爬虫调度器</CardTitle>
              <CardDescription className="text-xs">自动定时抓取竞品和关键词数据</CardDescription>
            </div>
          </div>
          <Badge variant={isRunning ? "default" : "secondary"} className={isRunning ? "bg-green-500" : ""}>
            {isRunning ? "运行中" : "已停止"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <StatMini label="累计执行" value={status?.totalRuns ?? 0} icon={Activity} />
          <StatMini label="成功任务" value={status?.totalSuccess ?? 0} icon={CheckCircle2} color="green" />
          <StatMini label="失败任务" value={status?.totalFailed ?? 0} icon={XCircle} color="red" />
          <StatMini label="上次结果" value={status?.lastResultCount ?? 0} icon={BarChart3} />
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500 mb-4">
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> 上次运行: {lastRun}</span>
          {isRunning && <span className="flex items-center gap-1"><Timer className="w-3 h-3" /> 下次运行: {nextRun}</span>}
        </div>
        <div className="flex gap-2">
          {!isRunning ? (
            <Button
              size="sm"
              onClick={() => startScheduler.mutate({ intervalHours: 24 })}
              disabled={startScheduler.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              {startScheduler.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Play className="w-3 h-3 mr-1" />}
              启动调度器 (每24小时)
            </Button>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => stopScheduler.mutate()}
              disabled={stopScheduler.isPending}
            >
              {stopScheduler.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Square className="w-3 h-3 mr-1" />}
              停止调度器
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            <RefreshCw className="w-3 h-3 mr-1" /> 刷新状态
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StatMini({ label, value, icon: Icon, color = "gray" }: {
  label: string; value: number | string; icon: any; color?: string;
}) {
  const colorMap: Record<string, string> = {
    gray: "text-gray-600 bg-gray-50",
    green: "text-green-600 bg-green-50",
    red: "text-red-600 bg-red-50",
    blue: "text-blue-600 bg-blue-50",
    orange: "text-orange-600 bg-orange-50",
  };
  return (
    <div className={`rounded-lg p-3 ${colorMap[color] || colorMap.gray}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3.5 h-3.5 opacity-60" />
        <span className="text-[11px] opacity-70">{label}</span>
      </div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}

// ─── Competitor Crawl Tasks ────────────────────────────────────
function CompetitorCrawlPanel() {
  const { data: monitors, isLoading, refetch } = trpc.operations.getCompetitorMonitors.useQuery();
  const crawlOne = trpc.crawler.crawlCompetitor.useMutation({
    onSuccess: (res) => {
      if (res.success) {
        toast.success("竞品数据抓取成功", { description: `耗时 ${res.duration}ms` });
      } else {
        toast.error("抓取失败", { description: res.error });
      }
      refetch();
    },
    onError: (e) => toast.error("抓取出错", { description: e.message }),
  });
  const crawlAll = trpc.crawler.crawlAllCompetitors.useMutation({
    onSuccess: (res) => {
      toast.success(`批量抓取完成: ${res.successCount}/${res.total} 成功`, {
        description: (res.failedCount ?? 0) > 0 ? `${res.failedCount} 个失败` : undefined,
      });
      refetch();
    },
    onError: (e) => toast.error("批量抓取出错", { description: e.message }),
  });

  const [selectedMonitorId, setSelectedMonitorId] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [crawlingId, setCrawlingId] = useState<number | null>(null);

  const activeMonitors = (monitors || []).filter((m: any) => m.isActive === 1);

  if (isLoading) return <Skeleton className="h-60" />;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="w-4 h-4 text-purple-500" />
              竞品价格/排名监控
            </CardTitle>
            <CardDescription className="text-xs">
              追踪竞品ASIN的价格、BSR排名、评论数等变化
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => refetch()}
            >
              <RefreshCw className="w-3 h-3 mr-1" /> 刷新
            </Button>
            <Button
              size="sm"
              className="bg-purple-600 hover:bg-purple-700"
              onClick={() => crawlAll.mutate()}
              disabled={crawlAll.isPending || activeMonitors.length === 0}
            >
              {crawlAll.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
              ) : (
                <Zap className="w-3 h-3 mr-1" />
              )}
              全部抓取 ({activeMonitors.length})
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {activeMonitors.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">暂无竞品监控任务</p>
            <p className="text-xs mt-1">请先在「竞品监控」页面添加竞品ASIN</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 px-3 font-medium">ASIN</th>
                  <th className="py-2 px-3 font-medium">竞品名称</th>
                  <th className="py-2 px-3 font-medium">站点</th>
                  <th className="py-2 px-3 font-medium">频率</th>
                  <th className="py-2 px-3 font-medium">上次抓取</th>
                  <th className="py-2 px-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {activeMonitors.map((m: any) => (
                  <tr key={m.id} className="border-b hover:bg-gray-50 transition-colors">
                    <td className="py-2.5 px-3">
                      <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono">{m.competitorAsin}</code>
                    </td>
                    <td className="py-2.5 px-3 max-w-[200px] truncate text-gray-700">
                      {m.competitorTitle || "—"}
                    </td>
                    <td className="py-2.5 px-3">
                      <Badge variant="outline" className="text-[10px]">{m.marketplace || "US"}</Badge>
                    </td>
                    <td className="py-2.5 px-3">
                      <Badge variant="secondary" className="text-[10px]">
                        {m.monitorFrequency === "daily" ? "每日" : m.monitorFrequency === "weekly" ? "每周" : "手动"}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 text-xs text-gray-500">
                      {m.lastCheckedAt ? new Date(m.lastCheckedAt).toLocaleString() : "从未"}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex gap-1 justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            setSelectedMonitorId(m.id);
                            setShowHistory(true);
                          }}
                        >
                          <History className="w-3 h-3 mr-1" /> 历史
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-purple-600 hover:text-purple-700"
                          onClick={() => {
                            setCrawlingId(m.id);
                            crawlOne.mutate({ monitorId: m.id }, {
                              onSettled: () => setCrawlingId(null),
                            });
                          }}
                          disabled={crawlingId === m.id}
                        >
                          {crawlingId === m.id ? (
                            <Loader2 className="w-3 h-3 animate-spin mr-1" />
                          ) : (
                            <Play className="w-3 h-3 mr-1" />
                          )}
                          抓取
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Batch crawl results summary */}
        {crawlAll.data && (
          <div className="mt-4 p-3 rounded-lg bg-gray-50 border">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span className="text-sm font-medium">批量抓取结果</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center text-xs">
              <div className="bg-white rounded p-2">
                <div className="text-lg font-bold">{crawlAll.data.total}</div>
                <div className="text-gray-500">总任务</div>
              </div>
              <div className="bg-white rounded p-2">
                <div className="text-lg font-bold text-green-600">{crawlAll.data.successCount}</div>
                <div className="text-gray-500">成功</div>
              </div>
              <div className="bg-white rounded p-2">
                <div className="text-lg font-bold text-red-600">{crawlAll.data.failedCount}</div>
                <div className="text-gray-500">失败</div>
              </div>
            </div>
            {crawlAll.data.results && crawlAll.data.results.length > 0 && (
              <div className="mt-2 space-y-1">
                {crawlAll.data.results.map((r: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs py-1">
                    {r.success ? (
                      <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
                    ) : (
                      <XCircle className="w-3 h-3 text-red-500 shrink-0" />
                    )}
                    <code className="font-mono text-[11px]">{r.asin}</code>
                    {r.duration && <span className="text-gray-400">{r.duration}ms</span>}
                    {r.error && <span className="text-red-500 truncate max-w-[200px]">{r.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* History Dialog */}
      {showHistory && selectedMonitorId && (
        <CompetitorHistoryDialog
          monitorId={selectedMonitorId}
          monitor={activeMonitors.find((m: any) => m.id === selectedMonitorId)}
          open={showHistory}
          onClose={() => setShowHistory(false)}
        />
      )}
    </Card>
  );
}

// ─── Competitor History Dialog ─────────────────────────────────
function CompetitorHistoryDialog({ monitorId, monitor, open, onClose }: {
  monitorId: number; monitor: any; open: boolean; onClose: () => void;
}) {
  const { data: history, isLoading } = trpc.crawler.getCrawlHistory.useQuery(
    { monitorId, type: "competitor", limit: 30 },
    { enabled: open }
  );

  const chartData = useMemo(() => {
    if (!history || history.length === 0) return [];
    return [...history].reverse().map((s: any) => ({
      date: s.snapshotDate,
      price: s.price ? parseFloat(s.price) : null,
      bsrRank: s.bsrRank,
      reviewCount: s.reviewCount,
      rating: s.rating ? parseFloat(s.rating) : null,
    }));
  }, [history]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-4 h-4" />
            抓取历史 — {monitor?.competitorAsin}
          </DialogTitle>
          <DialogDescription>
            {monitor?.competitorTitle || "竞品"} 的历史数据趋势
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-48" />
            <Skeleton className="h-32" />
          </div>
        ) : !history || history.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <History className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">暂无抓取记录</p>
            <p className="text-xs mt-1">请先手动触发抓取或等待调度器运行</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Price Trend */}
            {chartData.some(d => d.price !== null) && (
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5 text-green-500" /> 价格趋势
                </h4>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
                    <RechartsTooltip contentStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="price" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} name="价格($)" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* BSR Rank Trend */}
            {chartData.some(d => d.bsrRank !== null) && (
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-blue-500" /> BSR排名趋势
                </h4>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} reversed domain={["auto", "auto"]} />
                    <RechartsTooltip contentStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="bsrRank" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="BSR排名" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Review Count Trend */}
            {chartData.some(d => d.reviewCount !== null) && (
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5 text-yellow-500" /> 评论数趋势
                </h4>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <RechartsTooltip contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="reviewCount" fill="#f59e0b" name="评论数" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Data Table */}
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5 text-gray-500" /> 详细数据
              </h4>
              <div className="overflow-x-auto max-h-[300px] overflow-y-auto border rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="py-2 px-3 text-left font-medium">日期</th>
                      <th className="py-2 px-3 text-right font-medium">价格</th>
                      <th className="py-2 px-3 text-right font-medium">BSR排名</th>
                      <th className="py-2 px-3 text-right font-medium">评论数</th>
                      <th className="py-2 px-3 text-right font-medium">评分</th>
                      <th className="py-2 px-3 text-center font-medium">库存</th>
                      <th className="py-2 px-3 text-left font-medium">优惠</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(history as any[]).map((s: any, i: number) => {
                      const prev = (history as any[])[i + 1]; // history is desc order
                      return (
                        <tr key={s.id} className="border-t hover:bg-gray-50">
                          <td className="py-1.5 px-3 font-mono">{s.snapshotDate}</td>
                          <td className="py-1.5 px-3 text-right">
                            {s.price ? `$${parseFloat(s.price).toFixed(2)}` : "—"}
                            {prev?.price && s.price && (
                              <PriceChange current={parseFloat(s.price)} previous={parseFloat(prev.price)} />
                            )}
                          </td>
                          <td className="py-1.5 px-3 text-right">
                            {s.bsrRank ? `#${s.bsrRank.toLocaleString()}` : "—"}
                            {prev?.bsrRank && s.bsrRank && (
                              <RankChange current={s.bsrRank} previous={prev.bsrRank} />
                            )}
                          </td>
                          <td className="py-1.5 px-3 text-right">{s.reviewCount?.toLocaleString() ?? "—"}</td>
                          <td className="py-1.5 px-3 text-right">{s.rating ? parseFloat(s.rating).toFixed(1) : "—"}</td>
                          <td className="py-1.5 px-3 text-center">
                            {s.isInStock ? (
                              <Badge variant="outline" className="text-[9px] text-green-600 border-green-200">有货</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[9px] text-red-600 border-red-200">缺货</Badge>
                            )}
                          </td>
                          <td className="py-1.5 px-3 text-xs text-gray-500 max-w-[120px] truncate">
                            {s.couponInfo || s.dealInfo || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Keyword Crawl Tasks ───────────────────────────────────────
function KeywordCrawlPanel() {
  const { data: products } = trpc.productOps.listProducts.useQuery();
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);

  // Auto-select first product
  const productId = selectedProductId ?? (products && products.length > 0 ? products[0].id : null);

  const { data: monitors, isLoading, refetch } = trpc.productOps.getKeywordMonitors.useQuery(
    { productId: productId! },
    { enabled: !!productId }
  );

  const crawlOne = trpc.crawler.crawlKeyword.useMutation({
    onSuccess: (res) => {
      if (res.success) {
        toast.success("关键词排名抓取成功", { description: `耗时 ${res.duration}ms` });
      } else {
        toast.error("抓取失败", { description: res.error });
      }
      refetch();
    },
    onError: (e) => toast.error("抓取出错", { description: e.message }),
  });

  const crawlAll = trpc.crawler.crawlAllKeywords.useMutation({
    onSuccess: (res) => {
      toast.success(`批量抓取完成: ${res.successCount}/${res.total} 成功`, {
        description: (res.failedCount ?? 0) > 0 ? `${res.failedCount} 个失败` : undefined,
      });
      refetch();
    },
    onError: (e) => toast.error("批量抓取出错", { description: e.message }),
  });

  const [showHistory, setShowHistory] = useState(false);
  const [selectedKwMonitorId, setSelectedKwMonitorId] = useState<number | null>(null);
  const [crawlingId, setCrawlingId] = useState<number | null>(null);

  const activeMonitors = (monitors || []).filter((m: any) => m.isActive === 1);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="w-4 h-4 text-blue-500" />
              关键词排名监控
            </CardTitle>
            <CardDescription className="text-xs">
              追踪关键词在亚马逊搜索结果中的自然排名和广告排名
            </CardDescription>
          </div>
          <div className="flex gap-2 items-center">
            {products && products.length > 0 && (
              <Select
                value={productId?.toString() || ""}
                onValueChange={(v) => setSelectedProductId(parseInt(v))}
              >
                <SelectTrigger className="w-[200px] h-8 text-xs">
                  <SelectValue placeholder="选择产品" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p: any) => (
                    <SelectItem key={p.id} value={p.id.toString()}>
                      {p.title?.slice(0, 30) || p.parentAsin}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700"
              onClick={() => productId && crawlAll.mutate({ productId })}
              disabled={crawlAll.isPending || activeMonitors.length === 0 || !productId}
            >
              {crawlAll.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
              ) : (
                <Zap className="w-3 h-3 mr-1" />
              )}
              全部抓取 ({activeMonitors.length})
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : !productId ? (
          <div className="text-center py-8 text-gray-400">
            <Search className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">请先选择一个产品</p>
          </div>
        ) : activeMonitors.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <Search className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">该产品暂无关键词监控任务</p>
            <p className="text-xs mt-1">请在产品详情页的「关键词监控」Tab中添加关键词</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 px-3 font-medium">关键词</th>
                  <th className="py-2 px-3 font-medium">目标ASIN</th>
                  <th className="py-2 px-3 font-medium">匹配类型</th>
                  <th className="py-2 px-3 font-medium">最新排名</th>
                  <th className="py-2 px-3 font-medium">上次抓取</th>
                  <th className="py-2 px-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {activeMonitors.map((m: any) => (
                  <tr key={m.id} className="border-b hover:bg-gray-50 transition-colors">
                    <td className="py-2.5 px-3">
                      <span className="font-medium text-gray-800">{m.keyword}</span>
                      {m.keywordCn && (
                        <span className="text-xs text-gray-400 ml-1">({m.keywordCn})</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono">
                        {m.targetAsin || "—"}
                      </code>
                    </td>
                    <td className="py-2.5 px-3">
                      <Badge variant="outline" className="text-[10px]">
                        {m.matchType === "exact" ? "精准" : m.matchType === "phrase" ? "词组" : "广泛"}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3">
                      {m.latestSnapshot ? (
                        <div className="flex items-center gap-1">
                          <span className="font-medium">
                            {m.latestSnapshot.organicRank ? `#${m.latestSnapshot.organicRank}` : "—"}
                          </span>
                          {m.latestSnapshot.adRank && (
                            <Badge variant="secondary" className="text-[9px]">
                              广告#{m.latestSnapshot.adRank}
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-xs text-gray-500">
                      {m.lastCheckedAt ? new Date(m.lastCheckedAt).toLocaleString() : "从未"}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex gap-1 justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            setSelectedKwMonitorId(m.id);
                            setShowHistory(true);
                          }}
                        >
                          <History className="w-3 h-3 mr-1" /> 历史
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-blue-600 hover:text-blue-700"
                          onClick={() => {
                            setCrawlingId(m.id);
                            crawlOne.mutate({ keywordMonitorId: m.id }, {
                              onSettled: () => setCrawlingId(null),
                            });
                          }}
                          disabled={crawlingId === m.id}
                        >
                          {crawlingId === m.id ? (
                            <Loader2 className="w-3 h-3 animate-spin mr-1" />
                          ) : (
                            <Play className="w-3 h-3 mr-1" />
                          )}
                          抓取
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Batch crawl results summary */}
        {crawlAll.data && (
          <div className="mt-4 p-3 rounded-lg bg-gray-50 border">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span className="text-sm font-medium">批量抓取结果</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center text-xs">
              <div className="bg-white rounded p-2">
                <div className="text-lg font-bold">{crawlAll.data.total}</div>
                <div className="text-gray-500">总任务</div>
              </div>
              <div className="bg-white rounded p-2">
                <div className="text-lg font-bold text-green-600">{crawlAll.data.successCount}</div>
                <div className="text-gray-500">成功</div>
              </div>
              <div className="bg-white rounded p-2">
                <div className="text-lg font-bold text-red-600">{crawlAll.data.failedCount}</div>
                <div className="text-gray-500">失败</div>
              </div>
            </div>
            {crawlAll.data.results && crawlAll.data.results.length > 0 && (
              <div className="mt-2 space-y-1">
                {crawlAll.data.results.map((r: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs py-1">
                    {r.success ? (
                      <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
                    ) : (
                      <XCircle className="w-3 h-3 text-red-500 shrink-0" />
                    )}
                    <span className="font-medium">{r.keyword}</span>
                    {r.duration && <span className="text-gray-400">{r.duration}ms</span>}
                    {r.error && <span className="text-red-500 truncate max-w-[200px]">{r.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* Keyword History Dialog */}
      {showHistory && selectedKwMonitorId && (
        <KeywordHistoryDialog
          monitorId={selectedKwMonitorId}
          monitor={activeMonitors.find((m: any) => m.id === selectedKwMonitorId)}
          open={showHistory}
          onClose={() => setShowHistory(false)}
        />
      )}
    </Card>
  );
}

// ─── Keyword History Dialog ────────────────────────────────────
function KeywordHistoryDialog({ monitorId, monitor, open, onClose }: {
  monitorId: number; monitor: any; open: boolean; onClose: () => void;
}) {
  const { data: history, isLoading } = trpc.crawler.getCrawlHistory.useQuery(
    { monitorId, type: "keyword", limit: 30 },
    { enabled: open }
  );

  const chartData = useMemo(() => {
    if (!history || history.length === 0) return [];
    return [...history].reverse().map((s: any) => ({
      date: s.snapshotDate,
      organicRank: s.organicRank,
      adRank: s.adRank,
      pageNumber: s.pageNumber,
    }));
  }, [history]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-4 h-4" />
            排名历史 — "{monitor?.keyword}"
          </DialogTitle>
          <DialogDescription>
            关键词排名变化趋势（排名越低越好）
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-48" />
            <Skeleton className="h-32" />
          </div>
        ) : !history || history.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <History className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">暂无排名记录</p>
            <p className="text-xs mt-1">请先手动触发抓取或等待调度器运行</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Rank Trend Chart */}
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-blue-500" /> 排名趋势
              </h4>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} reversed domain={["auto", "auto"]} />
                  <RechartsTooltip contentStyle={{ fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="organicRank" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="自然排名" />
                  <Line type="monotone" dataKey="adRank" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} name="广告排名" strokeDasharray="5 5" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Data Table */}
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5 text-gray-500" /> 详细数据
              </h4>
              <div className="overflow-x-auto max-h-[300px] overflow-y-auto border rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="py-2 px-3 text-left font-medium">日期</th>
                      <th className="py-2 px-3 text-right font-medium">自然排名</th>
                      <th className="py-2 px-3 text-right font-medium">广告排名</th>
                      <th className="py-2 px-3 text-right font-medium">页码</th>
                      <th className="py-2 px-3 text-right font-medium">总结果数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(history as any[]).map((s: any, i: number) => {
                      const prev = (history as any[])[i + 1];
                      return (
                        <tr key={s.id} className="border-t hover:bg-gray-50">
                          <td className="py-1.5 px-3 font-mono">{s.snapshotDate}</td>
                          <td className="py-1.5 px-3 text-right">
                            {s.organicRank ? (
                              <span className="flex items-center gap-1 justify-end">
                                #{s.organicRank}
                                {prev?.organicRank && (
                                  <RankChange current={s.organicRank} previous={prev.organicRank} />
                                )}
                              </span>
                            ) : "—"}
                          </td>
                          <td className="py-1.5 px-3 text-right">
                            {s.adRank ? `#${s.adRank}` : "—"}
                          </td>
                          <td className="py-1.5 px-3 text-right">{s.pageNumber ?? "—"}</td>
                          <td className="py-1.5 px-3 text-right">{s.totalResults?.toLocaleString() ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Helper Components ─────────────────────────────────────────
function PriceChange({ current, previous }: { current: number; previous: number }) {
  const diff = current - previous;
  if (Math.abs(diff) < 0.01) return null;
  return (
    <span className={`inline-flex items-center ml-1 text-[10px] ${diff > 0 ? "text-red-500" : "text-green-500"}`}>
      {diff > 0 ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
      ${Math.abs(diff).toFixed(2)}
    </span>
  );
}

function RankChange({ current, previous }: { current: number; previous: number }) {
  const diff = previous - current; // positive = improved (rank decreased)
  if (diff === 0) return null;
  return (
    <span className={`inline-flex items-center ml-1 text-[10px] ${diff > 0 ? "text-green-500" : "text-red-500"}`}>
      {diff > 0 ? (
        <><ArrowUpRight className="w-2.5 h-2.5" />{diff}</>
      ) : (
        <><ArrowDownRight className="w-2.5 h-2.5" />{Math.abs(diff)}</>
      )}
    </span>
  );
}

// ─── Main Page ─────────────────────────────────────────────────
export default function OpsCrawlerManager() {
  return (
    <div className="space-y-6 p-1">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Bot className="w-5 h-5 text-orange-500" />
          爬虫引擎管理
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          管理亚马逊数据爬虫任务，包括竞品价格/排名监控和关键词自然排名追踪
        </p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview" className="text-xs">
            <Activity className="w-3.5 h-3.5 mr-1" /> 总览
          </TabsTrigger>
          <TabsTrigger value="competitor" className="text-xs">
            <Package className="w-3.5 h-3.5 mr-1" /> 竞品爬虫
          </TabsTrigger>
          <TabsTrigger value="keyword" className="text-xs">
            <Search className="w-3.5 h-3.5 mr-1" /> 关键词爬虫
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <SchedulerPanel />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CompetitorCrawlPanel />
            <KeywordCrawlPanel />
          </div>
        </TabsContent>

        <TabsContent value="competitor">
          <CompetitorCrawlPanel />
        </TabsContent>

        <TabsContent value="keyword">
          <KeywordCrawlPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
