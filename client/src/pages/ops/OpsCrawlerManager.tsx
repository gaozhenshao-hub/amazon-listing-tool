import { useMemo, useState } from "react";
import { Activity, BarChart3, Bot, CheckCircle2, Clock, History, Loader2, Package, Pause, Play, RefreshCw, Search, XCircle, Zap } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { AmazonMonitorGovernancePanel } from "./AmazonMonitorGovernancePanel";

type CompetitorMonitorView = {
  id: number;
  competitorAsin: string;
  competitorTitle: string | null;
  marketplace: string | null;
  monitorFrequency: string | null;
  isActive: number;
  lastCheckedAt: Date | string | null;
};

type KeywordMonitorView = {
  id: number;
  keyword: string;
  keywordCn: string | null;
  targetAsin: string | null;
  matchType: string | null;
  isActive: number;
  lastCheckedAt: Date | string | null;
  latestSnapshot?: { organicRank?: number | null; adRank?: number | null } | null;
};

type ProductView = { id: number; title?: string | null; parentAsin?: string | null };
type HistoryRow = {
  id: number;
  snapshotDate: string;
  price?: string | number | null;
  rating?: string | number | null;
  reviewCount?: number | null;
  salesRank?: number | null;
  organicRank?: number | null;
  adRank?: number | null;
  pageNumber?: number | null;
  totalResults?: number | null;
};

function StatMini({ label, value, icon: Icon, tone = "slate" }: { label: string; value: string | number; icon: typeof Activity; tone?: "slate" | "green" | "red" | "blue" }) {
  const tones = { slate: "bg-slate-50 text-slate-700", green: "bg-emerald-50 text-emerald-700", red: "bg-red-50 text-red-700", blue: "bg-blue-50 text-blue-700" };
  return <div className={`rounded-lg p-3 ${tones[tone]}`}><div className="mb-1 flex items-center gap-1.5"><Icon className="h-3.5 w-3.5 opacity-70" /><span className="text-[11px] opacity-75">{label}</span></div><div className="text-lg font-bold">{value}</div></div>;
}

function SchedulerPanel() {
  const status = trpc.crawler.getSchedulerStatus.useQuery(undefined, { refetchInterval: 10000 });
  const runs = trpc.crawler.getMonitorRuns.useQuery({ limit: 50 }, { refetchInterval: 10000 });
  const start = trpc.crawler.startScheduler.useMutation({
    onSuccess: result => { toast.success(`Heartbeat计划已更新：${result.activeCount}/${result.total} 个启用`); void status.refetch(); },
    onError: error => toast.error("启动失败", { description: error.message }),
  });
  const stop = trpc.crawler.stopScheduler.useMutation({
    onSuccess: result => { toast.success(`已暂停 ${result.pausedCount} 个Heartbeat计划`); void status.refetch(); },
    onError: error => toast.error("暂停失败", { description: error.message }),
  });
  if (status.isLoading) return <Skeleton className="h-44" />;
  const runRows = (runs.data || []) as Array<{ status: string; createdAt: Date | string; completedAt?: Date | string | null }>;
  const latestAt = runRows[0]?.completedAt || runRows[0]?.createdAt;
  return (
    <Card className="border-l-4 border-l-orange-500">
      <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><Bot className="h-4 w-4" />Heartbeat监控计划</CardTitle><CardDescription>持久化触发Provider Job，不依赖Web进程驻留。</CardDescription></div><Badge variant={status.data?.running ? "default" : "secondary"}>{status.data?.running ? "运行中" : "已暂停"}</Badge></div></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><StatMini label="最近Run" value={runRows.length} icon={Activity} /><StatMini label="成功" value={runRows.filter(row => row.status === "succeeded").length} icon={CheckCircle2} tone="green" /><StatMini label="失败/部分" value={runRows.filter(row => row.status === "failed" || row.status === "partial").length} icon={XCircle} tone="red" /><StatMini label="启用计划" value={status.data?.activeCount || 0} icon={BarChart3} tone="blue" /></div>
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground"><span className="flex items-center gap-1"><Clock className="h-3 w-3" />上次Run：{latestAt ? new Date(latestAt).toLocaleString() : "从未"}</span><span>下次Heartbeat：{status.data?.nextRunAt ? new Date(status.data.nextRunAt).toLocaleString() : "—"}</span></div>
        <div className="flex flex-wrap gap-2">{status.data?.running ? <Button size="sm" variant="destructive" disabled={stop.isPending} onClick={() => stop.mutate()}>{stop.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Pause className="mr-1 h-3 w-3" />}暂停Heartbeat</Button> : <Button size="sm" disabled={start.isPending} onClick={() => start.mutate({ intervalHours: 24 })}>{start.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}启用每日Heartbeat</Button>}<Button size="sm" variant="outline" onClick={() => { void status.refetch(); void runs.refetch(); }}><RefreshCw className="mr-1 h-3 w-3" />刷新</Button></div>
        <p className="text-xs text-muted-foreground">只有已通过资格验证的Provider能力会创建计划；未验证能力失败关闭，不会回退旧爬虫。</p>
      </CardContent>
    </Card>
  );
}

function QueueSummary({ result, label }: { result: { total: number; queuedCount: number; failedCount: number } | undefined; label: string }) {
  if (!result) return null;
  return <div className="mt-4 rounded-lg border bg-muted/30 p-3"><p className="mb-2 text-sm font-medium">{label}排队结果</p><div className="grid grid-cols-3 gap-3 text-center text-xs"><div className="rounded bg-background p-2"><div className="text-lg font-bold">{result.total}</div>总任务</div><div className="rounded bg-background p-2"><div className="text-lg font-bold text-emerald-600">{result.queuedCount}</div>已排队</div><div className="rounded bg-background p-2"><div className="text-lg font-bold text-red-600">{result.failedCount}</div>未排队</div></div></div>;
}

function CompetitorPanel() {
  const query = trpc.operations.getCompetitorMonitors.useQuery();
  const runOne = trpc.crawler.crawlCompetitor.useMutation({ onSuccess: result => result.success ? toast.success("竞品监控Job已排队", { description: "aiJobRunId" in result ? result.aiJobRunId : undefined }) : toast.error("未能排队", { description: result.error }), onError: error => toast.error("排队失败", { description: error.message }) });
  const runAll = trpc.crawler.crawlAllCompetitors.useMutation({ onSuccess: result => toast.success(`已排队 ${result.queuedCount}/${result.total}`), onError: error => toast.error("批量排队失败", { description: error.message }) });
  const [runningId, setRunningId] = useState<number | null>(null);
  const [history, setHistory] = useState<{ id: number; title: string } | null>(null);
  const monitors = ((query.data || []) as CompetitorMonitorView[]).filter(item => item.isActive === 1);
  return (
    <Card>
      <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><Package className="h-4 w-4 text-purple-500" />竞品价格 / BSR监控</CardTitle><CardDescription>只写入Provider明确返回的价格、Buy Box、Offer和BSR字段。</CardDescription></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void query.refetch()}><RefreshCw className="mr-1 h-3 w-3" />刷新</Button><Button size="sm" disabled={runAll.isPending || !monitors.length} onClick={() => runAll.mutate()}><Zap className="mr-1 h-3 w-3" />全部排队（{monitors.length}）</Button></div></div></CardHeader>
      <CardContent>{query.isLoading ? <Skeleton className="h-40" /> : !monitors.length ? <p className="py-10 text-center text-sm text-muted-foreground">暂无启用的竞品监控任务。</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="px-3 py-2">ASIN</th><th className="px-3 py-2">竞品</th><th className="px-3 py-2">站点</th><th className="px-3 py-2">频率</th><th className="px-3 py-2">上次快照</th><th className="px-3 py-2 text-right">操作</th></tr></thead><tbody>{monitors.map(monitor => <tr key={monitor.id} className="border-b"><td className="px-3 py-2 font-mono text-xs">{monitor.competitorAsin}</td><td className="max-w-[220px] truncate px-3 py-2">{monitor.competitorTitle || "—"}</td><td className="px-3 py-2"><Badge variant="outline">{monitor.marketplace || "US"}</Badge></td><td className="px-3 py-2">{monitor.monitorFrequency === "weekly" ? "每周" : monitor.monitorFrequency === "daily" ? "每日" : "手动"}</td><td className="px-3 py-2 text-xs text-muted-foreground">{monitor.lastCheckedAt ? new Date(monitor.lastCheckedAt).toLocaleString() : "从未"}</td><td className="px-3 py-2"><div className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => setHistory({ id: monitor.id, title: monitor.competitorAsin })}><History className="mr-1 h-3 w-3" />历史</Button><Button size="sm" variant="ghost" disabled={runningId === monitor.id} onClick={() => { setRunningId(monitor.id); runOne.mutate({ monitorId: monitor.id }, { onSettled: () => setRunningId(null) }); }}>{runningId === monitor.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}运行</Button></div></td></tr>)}</tbody></table></div>}<QueueSummary result={runAll.data} label="竞品Job" /></CardContent>
      <HistoryDialog open={Boolean(history)} onClose={() => setHistory(null)} kind="competitor" monitorId={history?.id || 0} title={history?.title || ""} />
    </Card>
  );
}

function KeywordPanel() {
  const productsQuery = trpc.productOps.listProducts.useQuery();
  const products = (productsQuery.data || []) as ProductView[];
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const productId = selectedProductId ?? products[0]?.id ?? null;
  const query = trpc.productOps.getKeywordMonitors.useQuery({ productId: productId || 0 }, { enabled: Boolean(productId) });
  const runOne = trpc.crawler.crawlKeyword.useMutation({ onSuccess: result => result.success ? toast.success("关键词排名Job已排队", { description: "aiJobRunId" in result ? result.aiJobRunId : undefined }) : toast.error("未能排队", { description: result.error }), onError: error => toast.error("排队失败", { description: error.message }) });
  const runAll = trpc.crawler.crawlAllKeywords.useMutation({ onSuccess: result => toast.success(`已排队 ${result.queuedCount}/${result.total}`), onError: error => toast.error("批量排队失败", { description: error.message }) });
  const [runningId, setRunningId] = useState<number | null>(null);
  const [history, setHistory] = useState<{ id: number; title: string } | null>(null);
  const monitors = ((query.data || []) as KeywordMonitorView[]).filter(item => item.isActive === 1);
  return (
    <Card>
      <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><Search className="h-4 w-4 text-blue-500" />关键词排名监控</CardTitle><CardDescription>追踪自然与广告位置；未找到只记录“未进入扫描范围”，不伪造排名。</CardDescription></div><div className="flex flex-wrap gap-2">{!!products.length && <Select value={productId?.toString()} onValueChange={value => setSelectedProductId(Number(value))}><SelectTrigger className="w-[220px]"><SelectValue placeholder="选择产品" /></SelectTrigger><SelectContent>{products.map(product => <SelectItem key={product.id} value={String(product.id)}>{product.title?.slice(0, 28) || product.parentAsin || `产品#${product.id}`}</SelectItem>)}</SelectContent></Select>}<Button size="sm" disabled={runAll.isPending || !monitors.length || !productId} onClick={() => productId && runAll.mutate({ productId })}><Zap className="mr-1 h-3 w-3" />全部排队（{monitors.length}）</Button></div></div></CardHeader>
      <CardContent>{query.isLoading ? <Skeleton className="h-40" /> : !productId ? <p className="py-10 text-center text-sm text-muted-foreground">请先选择产品。</p> : !monitors.length ? <p className="py-10 text-center text-sm text-muted-foreground">该产品暂无启用的关键词监控。</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="px-3 py-2">关键词</th><th className="px-3 py-2">目标ASIN</th><th className="px-3 py-2">匹配类型</th><th className="px-3 py-2">最新排名</th><th className="px-3 py-2">上次快照</th><th className="px-3 py-2 text-right">操作</th></tr></thead><tbody>{monitors.map(monitor => <tr key={monitor.id} className="border-b"><td className="px-3 py-2 font-medium">{monitor.keyword}{monitor.keywordCn ? <span className="ml-1 text-xs text-muted-foreground">({monitor.keywordCn})</span> : null}</td><td className="px-3 py-2 font-mono text-xs">{monitor.targetAsin || "—"}</td><td className="px-3 py-2">{monitor.matchType || "—"}</td><td className="px-3 py-2">{monitor.latestSnapshot?.organicRank ? `#${monitor.latestSnapshot.organicRank}` : "—"}{monitor.latestSnapshot?.adRank ? <Badge variant="secondary" className="ml-2">广告#{monitor.latestSnapshot.adRank}</Badge> : null}</td><td className="px-3 py-2 text-xs text-muted-foreground">{monitor.lastCheckedAt ? new Date(monitor.lastCheckedAt).toLocaleString() : "从未"}</td><td className="px-3 py-2"><div className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => setHistory({ id: monitor.id, title: monitor.keyword })}><History className="mr-1 h-3 w-3" />历史</Button><Button size="sm" variant="ghost" disabled={runningId === monitor.id} onClick={() => { setRunningId(monitor.id); runOne.mutate({ keywordMonitorId: monitor.id }, { onSettled: () => setRunningId(null) }); }}>{runningId === monitor.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}运行</Button></div></td></tr>)}</tbody></table></div>}<QueueSummary result={runAll.data} label="关键词Job" /></CardContent>
      <HistoryDialog open={Boolean(history)} onClose={() => setHistory(null)} kind="keyword" monitorId={history?.id || 0} title={history?.title || ""} />
    </Card>
  );
}

function HistoryDialog({ open, onClose, kind, monitorId, title }: { open: boolean; onClose: () => void; kind: "competitor" | "keyword"; monitorId: number; title: string }) {
  const query = trpc.crawler.getCrawlHistory.useQuery({ monitorId, type: kind, limit: 30 }, { enabled: open && monitorId > 0 });
  const rows = useMemo(() => (query.data || []) as HistoryRow[], [query.data]);
  const chartData = useMemo(() => [...rows].reverse().map(row => ({ ...row, priceValue: row.price === null || row.price === undefined ? null : Number(row.price) })), [rows]);
  return <Dialog open={open} onOpenChange={onClose}><DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Provider快照历史 — {title}</DialogTitle><DialogDescription>{kind === "competitor" ? "价格与BSR变化；空值表示Provider未返回。" : "自然与广告排名变化；排名数值越低越靠前。"}</DialogDescription></DialogHeader>{query.isLoading ? <Skeleton className="h-64" /> : !rows.length ? <p className="py-12 text-center text-sm text-muted-foreground">暂无确认快照；请先运行受控Provider Job或等待Heartbeat。</p> : <div className="space-y-5"><ResponsiveContainer width="100%" height={240}><LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="snapshotDate" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} reversed={kind === "keyword"} /><RechartsTooltip /><Legend />{kind === "competitor" ? <><Line type="monotone" dataKey="priceValue" stroke="#7c3aed" name="价格" connectNulls={false} /><Line type="monotone" dataKey="salesRank" stroke="#ea580c" name="BSR" connectNulls={false} /></> : <><Line type="monotone" dataKey="organicRank" stroke="#2563eb" name="自然排名" connectNulls={false} /><Line type="monotone" dataKey="adRank" stroke="#d97706" name="广告排名" connectNulls={false} /></>}</LineChart></ResponsiveContainer><div className="max-h-64 overflow-auto rounded-lg border"><table className="w-full text-xs"><thead><tr className="border-b bg-muted/50 text-left"><th className="px-3 py-2">日期</th>{kind === "competitor" ? <><th className="px-3 py-2">价格</th><th className="px-3 py-2">评分</th><th className="px-3 py-2">评论</th><th className="px-3 py-2">BSR</th></> : <><th className="px-3 py-2">自然</th><th className="px-3 py-2">广告</th><th className="px-3 py-2">页码</th></>}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-b"><td className="px-3 py-2">{row.snapshotDate}</td>{kind === "competitor" ? <><td className="px-3 py-2">{row.price ?? "—"}</td><td className="px-3 py-2">{row.rating ?? "—"}</td><td className="px-3 py-2">{row.reviewCount ?? "—"}</td><td className="px-3 py-2">{row.salesRank ?? "—"}</td></> : <><td className="px-3 py-2">{row.organicRank ?? "—"}</td><td className="px-3 py-2">{row.adRank ?? "—"}</td><td className="px-3 py-2">{row.pageNumber ?? "—"}</td></>}</tr>)}</tbody></table></div></div>}</DialogContent></Dialog>;
}

export default function OpsCrawlerManager() {
  return (
    <div className="space-y-6 p-1">
      <div><h1 className="flex items-center gap-2 text-xl font-bold"><Bot className="h-5 w-5 text-orange-500" />Amazon监控中心</h1><p className="mt-1 text-sm text-muted-foreground">受控Provider、持久化Job/Run与Heartbeat驱动的竞品价格/BSR和关键词排名追踪。</p></div>
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList><TabsTrigger value="overview"><Activity className="mr-1 h-3.5 w-3.5" />总览</TabsTrigger><TabsTrigger value="competitor"><Package className="mr-1 h-3.5 w-3.5" />竞品监控</TabsTrigger><TabsTrigger value="keyword"><Search className="mr-1 h-3.5 w-3.5" />关键词监控</TabsTrigger></TabsList>
        <TabsContent value="overview" className="space-y-4"><AmazonMonitorGovernancePanel /><SchedulerPanel /><div className="grid gap-4 xl:grid-cols-2"><CompetitorPanel /><KeywordPanel /></div></TabsContent>
        <TabsContent value="competitor"><CompetitorPanel /></TabsContent>
        <TabsContent value="keyword"><KeywordPanel /></TabsContent>
      </Tabs>
    </div>
  );
}
