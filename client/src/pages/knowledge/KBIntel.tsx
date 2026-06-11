/**
 * KBIntel — 情报推荐中心
 *
 * 功能：情报源管理、推荐列表（按状态筛选）、AI质量评分展示、
 * AI格式化为SOP预览/编辑、采纳入库流程。
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Rss,
  Plus,
  Trash2,
  ExternalLink,
  Star,
  Eye,
  EyeOff,
  CheckCircle,
  XCircle,
  Bookmark,
  Sparkles,
  ArrowRight,
  BarChart3,
  FileText,
  Globe,
  Upload,
  Loader2,
  ChevronDown,
  ChevronUp,
  Edit,
  Clock,
  Play,
  Pause,
  RefreshCw,
  Settings,
  History,
  Zap,
  AlertTriangle,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────
type ItemStatus = "pending" | "recommended" | "adopted" | "ignored" | "expired" | "bookmarked";
type SourceType = "amazon_news" | "wearesellers" | "media" | "custom_url" | "rss";

const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  amazon_news: "亚马逊官方公告",
  wearesellers: "知无不言论坛",
  media: "跨境电商媒体",
  custom_url: "自定义URL",
  rss: "RSS订阅",
};

const STATUS_CONFIG: Record<ItemStatus, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: "待处理", color: "bg-gray-100 text-gray-700", icon: <FileText className="w-3 h-3" /> },
  recommended: { label: "AI推荐", color: "bg-blue-100 text-blue-700", icon: <Sparkles className="w-3 h-3" /> },
  adopted: { label: "已采纳", color: "bg-green-100 text-green-700", icon: <CheckCircle className="w-3 h-3" /> },
  ignored: { label: "已忽略", color: "bg-gray-100 text-gray-500", icon: <EyeOff className="w-3 h-3" /> },
  expired: { label: "已过期", color: "bg-red-100 text-red-600", icon: <XCircle className="w-3 h-3" /> },
  bookmarked: { label: "已收藏", color: "bg-amber-100 text-amber-700", icon: <Bookmark className="w-3 h-3" /> },
};

const KB_TYPE_LABELS: Record<string, string> = {
  sop: "运营SOP库",
  listing: "Listing文案库",
  product: "产品创意库",
  image: "图片知识库",
  video: "视频知识库",
};

// ─── Component ──────────────────────────────────
export default function KBIntel() {

  const [activeTab, setActiveTab] = useState<"items" | "sources" | "stats" | "logs" | "scheduler">("items");
  const [statusFilter, setStatusFilter] = useState<ItemStatus | "all">("recommended");
  const [selectedSourceId, setSelectedSourceId] = useState<number | undefined>();
  const [page, setPage] = useState(1);
  const [dedup, setDedup] = useState(true); // Dedup enabled by default

  // Dialogs
  const [showAddSource, setShowAddSource] = useState(false);
  const [showAddArticle, setShowAddArticle] = useState(false);
  const [showDetail, setShowDetail] = useState<number | null>(null);
  const [showFormatPreview, setShowFormatPreview] = useState<number | null>(null);
  const [showAdoptDialog, setShowAdoptDialog] = useState<number | null>(null);

  // Form states
  const [newSource, setNewSource] = useState({
    name: "", sourceType: "custom_url" as SourceType, url: "", crawlFrequency: "manual" as "daily" | "weekly" | "manual", qualityThreshold: 6,
  });
  const [newArticles, setNewArticles] = useState([{
    title: "", author: "", originalUrl: "", rawContent: "",
  }]);
  const [crawlSourceId, setCrawlSourceId] = useState<number | null>(null);
  const [formatResult, setFormatResult] = useState<Record<string, unknown> | null>(null);
  const [editedContent, setEditedContent] = useState("");
  const [adoptTargetType, setAdoptTargetType] = useState<"sop" | "listing" | "product" | "image" | "video">("sop");

  // ─── Queries ────────────────────────────────
  const sourcesQuery = trpc.kbIntel.listSources.useQuery();
  const itemsQuery = trpc.kbIntel.listItems.useQuery({
    sourceId: selectedSourceId,
    status: statusFilter === "all" ? undefined : statusFilter,
    page,
    pageSize: 20,
    dedup,
  });
  const statsQuery = trpc.kbIntel.getStats.useQuery();
  const detailQuery = trpc.kbIntel.getItemDetail.useQuery(
    { id: showDetail! },
    { enabled: showDetail !== null }
  );

  // ─── Mutations ──────────────────────────────
  const utils = trpc.useUtils();
  const addSourceMut = trpc.kbIntel.addSource.useMutation({
    onSuccess: () => {
      toast.success("情报源已添加");
      utils.kbIntel.listSources.invalidate();
      utils.kbIntel.getStats.invalidate();
      setShowAddSource(false);
      setNewSource({ name: "", sourceType: "custom_url", url: "", crawlFrequency: "manual", qualityThreshold: 6 });
    },
  });
  const deleteSourceMut = trpc.kbIntel.deleteSource.useMutation({
    onSuccess: () => {
      toast.success("情报源已删除");
      utils.kbIntel.listSources.invalidate();
      utils.kbIntel.getStats.invalidate();
    },
  });
  const triggerCrawlMut = trpc.kbIntel.triggerCrawl.useMutation({
    onSuccess: (data) => {
      toast.success(`已提交 ${data.total} 篇文章`, { description: `${data.results.filter(r => r.status === "recommended").length} 篇通过AI质量评估` });
      utils.kbIntel.listItems.invalidate();
      utils.kbIntel.getStats.invalidate();
      utils.kbIntel.listSources.invalidate();
      setShowAddArticle(false);
      setNewArticles([{ title: "", author: "", originalUrl: "", rawContent: "" }]);
    },
  });
  const formatSopMut = trpc.kbIntel.formatAsSop.useMutation({
    onSuccess: (data) => {
      setFormatResult(data);
      setEditedContent(JSON.stringify(data, null, 2));
    },
  });
  const adoptMut = trpc.kbIntel.adoptItem.useMutation({
    onSuccess: (data) => {
      toast.success("已采纳入库", { description: `已录入${KB_TYPE_LABELS[data.targetKbType]}` });
      utils.kbIntel.listItems.invalidate();
      utils.kbIntel.getStats.invalidate();
      setShowAdoptDialog(null);
      setShowFormatPreview(null);
      setFormatResult(null);
    },
  });
  const ignoreMut = trpc.kbIntel.ignoreItem.useMutation({
    onSuccess: () => {
      toast.success("已忽略");
      utils.kbIntel.listItems.invalidate();
    },
  });
  const bookmarkMut = trpc.kbIntel.bookmarkItem.useMutation({
    onSuccess: () => {
      toast.success("已收藏");
      utils.kbIntel.listItems.invalidate();
    },
  });

  // ─── Stats Tab ──────────────────────────────
  const stats = statsQuery.data;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Rss className="w-6 h-6 text-orange-500" />
            情报推荐中心
          </h1>
          <p className="text-muted-foreground mt-1">AI自动采集、评估外部优质内容，经人工确认后录入知识库</p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-muted/50 p-1 rounded-lg w-fit">
        {([
          { key: "items", label: "推荐列表", icon: <FileText className="w-4 h-4" /> },
          { key: "sources", label: "情报源管理", icon: <Globe className="w-4 h-4" /> },
          { key: "logs", label: "采集日志", icon: <History className="w-4 h-4" /> },
          { key: "scheduler", label: "定时任务", icon: <Clock className="w-4 h-4" /> },
          { key: "stats", label: "采集统计", icon: <BarChart3 className="w-4 h-4" /> },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.key ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ════════ Items Tab ════════ */}
      {activeTab === "items" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-1 bg-muted/50 p-0.5 rounded-md">
              {(["all", "recommended", "bookmarked", "pending", "adopted", "ignored"] as const).map(s => (
                <button
                  key={s}
                  onClick={() => { setStatusFilter(s); setPage(1); }}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                    statusFilter === s ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s === "all" ? "全部" : STATUS_CONFIG[s].label}
                </button>
              ))}
            </div>
            {sourcesQuery.data && sourcesQuery.data.length > 0 && (
              <Select
                value={selectedSourceId?.toString() || "all"}
                onValueChange={v => { setSelectedSourceId(v === "all" ? undefined : Number(v)); setPage(1); }}
              >
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="全部来源" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部来源</SelectItem>
                  {sourcesQuery.data.map(s => (
                    <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="ml-auto flex items-center gap-2">
              {/* Dedup toggle */}
              <div className="flex items-center gap-1.5 border rounded-md px-2 py-1.5">
                <span className="text-xs text-muted-foreground">去重显示</span>
                <Switch
                  checked={dedup}
                  onCheckedChange={(v) => { setDedup(v); setPage(1); }}
                  className="scale-75"
                />
                {dedup && (itemsQuery.data?.dedupRemoved ?? 0) > 0 && (
                  <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                    已过滤 {itemsQuery.data?.dedupRemoved} 条重复
                  </Badge>
                )}
              </div>
              <Button size="sm" variant="outline" onClick={() => setShowAddArticle(true)} disabled={!sourcesQuery.data?.length}>
                <Upload className="w-4 h-4 mr-1" /> 手动添加文章
              </Button>
            </div>
          </div>

          {/* Item List */}
          {itemsQuery.isLoading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中...
            </div>
          ) : !itemsQuery.data?.items.length ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Rss className="w-12 h-12 mb-4 opacity-30" />
                <p className="text-lg font-medium">暂无情报条目</p>
                <p className="text-sm mt-1">请先添加情报源，然后手动提交文章进行AI评估</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {itemsQuery.data.items.map(item => (
                <IntelItemCard
                  key={item.id}
                  item={item}
                  onView={() => setShowDetail(item.id)}
                  onFormat={() => { setShowFormatPreview(item.id); formatSopMut.mutate({ itemId: item.id }); }}
                  onAdopt={() => { setShowAdoptDialog(item.id); }}
                  onIgnore={() => ignoreMut.mutate({ id: item.id })}
                  onBookmark={() => bookmarkMut.mutate({ id: item.id })}
                />
              ))}
              {/* Pagination */}
              {itemsQuery.data.total > 20 && (
                <div className="flex items-center justify-center gap-2 pt-4">
                  <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>上一页</Button>
                  <span className="text-sm text-muted-foreground">第 {page} 页 / 共 {Math.ceil(itemsQuery.data.total / 20)} 页</span>
                  <Button size="sm" variant="outline" disabled={page * 20 >= itemsQuery.data.total} onClick={() => setPage(p => p + 1)}>下一页</Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ════════ Sources Tab ════════ */}
      {activeTab === "sources" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-medium text-muted-foreground">已添加 {sourcesQuery.data?.length || 0} 个情报源</h3>
            <Button onClick={() => setShowAddSource(true)}>
              <Plus className="w-4 h-4 mr-1" /> 添加情报源
            </Button>
          </div>

          {/* Preset Sources Quick Add */}
          <PresetSourcesPanel />

          {!sourcesQuery.data?.length ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Globe className="w-12 h-12 mb-4 opacity-30" />
                <p className="text-lg font-medium">暂无情报源</p>
                <p className="text-sm mt-1">添加外部信息源，或使用上方“推荐情报源”一键添加</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sourcesQuery.data.map(source => (
                <Card key={source.id} className={`${source.isActive ? "" : "opacity-60"}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-base">{source.name}</CardTitle>
                        <Badge variant="outline" className="mt-1 text-xs">
                          {SOURCE_TYPE_LABELS[source.sourceType as SourceType]}
                        </Badge>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => { setCrawlSourceId(source.id); setShowAddArticle(true); }}
                        >
                          <Upload className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => { if (confirm("确定删除此情报源？关联的所有条目也将被删除。")) deleteSourceMut.mutate({ id: source.id }); }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-xs text-muted-foreground truncate">{source.url}</p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>已采集: {source.totalCrawled || 0}</span>
                      <span>已采纳: {source.totalAdopted || 0}</span>
                      <span>质量阈值: {source.qualityThreshold}</span>
                    </div>
                    {source.lastCrawledAt && (
                      <p className="text-xs text-muted-foreground">
                        最后采集: {new Date(source.lastCrawledAt).toLocaleString()}
                      </p>
                    )}
                    {/* Auto-collect config inline */}
                    <AutoCollectSourceConfig source={source} />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ════════ Stats Tab ════════ */}
      {activeTab === "stats" && stats && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "情报源", value: stats.totalSources, sub: `${stats.activeSources} 个活跃` },
              { label: "已采集", value: stats.totalCrawled, sub: "累计文章数" },
              { label: "AI推荐", value: stats.totalRecommended, sub: "待审核" },
              { label: "采纳率", value: `${stats.adoptionRate}%`, sub: `${stats.totalAdopted} 篇已入库` },
            ].map((s, i) => (
              <Card key={i}>
                <CardContent className="pt-6">
                  <p className="text-2xl font-bold">{s.value}</p>
                  <p className="text-sm font-medium text-muted-foreground">{s.label}</p>
                  <p className="text-xs text-muted-foreground mt-1">{s.sub}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          {stats.sourceBreakdown.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">各情报源统计</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {stats.sourceBreakdown.map(s => (
                    <div key={s.id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div>
                        <p className="font-medium text-sm">{s.name}</p>
                        <p className="text-xs text-muted-foreground">{SOURCE_TYPE_LABELS[s.sourceType as SourceType]}</p>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span>采集 {s.totalCrawled}</span>
                        <span>采纳 {s.totalAdopted}</span>
                        <Badge variant={s.isActive ? "default" : "secondary"}>
                          {s.isActive ? "活跃" : "停用"}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ════════ Logs Tab ════════ */}
      {activeTab === "logs" && <CollectLogsPanel />}

      {/* ════════ Scheduler Tab ════════ */}
      {activeTab === "scheduler" && <SchedulerPanel />}

      {/* ════════ Add Source Dialog ════════ */}
      <Dialog open={showAddSource} onOpenChange={setShowAddSource}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>添加情报源</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">名称</label>
              <Input placeholder="如：知无不言-精华帖" value={newSource.name} onChange={e => setNewSource(s => ({ ...s, name: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium">类型</label>
              <Select value={newSource.sourceType} onValueChange={v => setNewSource(s => ({ ...s, sourceType: v as SourceType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(SOURCE_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">URL</label>
              <Input placeholder="https://..." value={newSource.url} onChange={e => setNewSource(s => ({ ...s, url: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium">质量阈值（1-10）</label>
              <Input type="number" min={1} max={10} value={newSource.qualityThreshold} onChange={e => setNewSource(s => ({ ...s, qualityThreshold: Number(e.target.value) }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddSource(false)}>取消</Button>
            <Button onClick={() => addSourceMut.mutate(newSource)} disabled={addSourceMut.isPending || !newSource.name || !newSource.url}>
              {addSourceMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════ Add Article Dialog ════════ */}
      <Dialog open={showAddArticle} onOpenChange={v => { setShowAddArticle(v); if (!v) setCrawlSourceId(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader><DialogTitle>手动添加文章</DialogTitle></DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-4 pr-4">
              <div>
                <label className="text-sm font-medium">选择情报源</label>
                <Select
                  value={(crawlSourceId || "").toString()}
                  onValueChange={v => setCrawlSourceId(Number(v))}
                >
                  <SelectTrigger><SelectValue placeholder="选择情报源" /></SelectTrigger>
                  <SelectContent>
                    {sourcesQuery.data?.map(s => (
                      <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {newArticles.map((article, idx) => (
                <Card key={idx} className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">文章 {idx + 1}</span>
                    {newArticles.length > 1 && (
                      <Button size="sm" variant="ghost" onClick={() => setNewArticles(a => a.filter((_, i) => i !== idx))}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                  <Input placeholder="文章标题" value={article.title} onChange={e => {
                    const arr = [...newArticles]; arr[idx] = { ...arr[idx], title: e.target.value }; setNewArticles(arr);
                  }} />
                  <Input placeholder="作者（可选）" value={article.author} onChange={e => {
                    const arr = [...newArticles]; arr[idx] = { ...arr[idx], author: e.target.value }; setNewArticles(arr);
                  }} />
                  <Input placeholder="原文链接 https://..." value={article.originalUrl} onChange={e => {
                    const arr = [...newArticles]; arr[idx] = { ...arr[idx], originalUrl: e.target.value }; setNewArticles(arr);
                  }} />
                  <Textarea placeholder="粘贴文章正文内容..." rows={6} value={article.rawContent} onChange={e => {
                    const arr = [...newArticles]; arr[idx] = { ...arr[idx], rawContent: e.target.value }; setNewArticles(arr);
                  }} />
                </Card>
              ))}
              <Button variant="outline" size="sm" onClick={() => setNewArticles(a => [...a, { title: "", author: "", originalUrl: "", rawContent: "" }])}>
                <Plus className="w-4 h-4 mr-1" /> 再添加一篇
              </Button>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddArticle(false)}>取消</Button>
            <Button
              onClick={() => {
                if (!crawlSourceId) { toast.error("请选择情报源"); return; }
                const valid = newArticles.filter(a => a.title && a.originalUrl && a.rawContent);
                if (!valid.length) { toast.error("请填写完整的文章信息"); return; }
                triggerCrawlMut.mutate({ sourceId: crawlSourceId, articles: valid });
              }}
              disabled={triggerCrawlMut.isPending}
            >
              {triggerCrawlMut.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-1" /> AI评估中...</> : <>提交AI评估</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════ Detail Dialog ════════ */}
      <Dialog open={showDetail !== null} onOpenChange={() => setShowDetail(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh]">
          <DialogHeader><DialogTitle>情报详情</DialogTitle></DialogHeader>
          {detailQuery.isLoading ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : detailQuery.data ? (
            <ScrollArea className="max-h-[70vh]">
              <div className="space-y-4 pr-4">
                <div>
                  <h3 className="font-semibold text-lg">{detailQuery.data.title}</h3>
                  <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                    {detailQuery.data.author && <span>作者: {detailQuery.data.author}</span>}
                    <span>来源: {detailQuery.data.sourceName}</span>
                    <a href={detailQuery.data.originalUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline flex items-center gap-1">
                      原文链接 <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
                {/* Quality Score */}
                {detailQuery.data.aiQualityScore && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">AI质量评估</CardTitle></CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-3 mb-3">
                        <div className="text-3xl font-bold text-orange-500">{parseFloat(detailQuery.data.aiQualityScore).toFixed(1)}</div>
                        <span className="text-sm text-muted-foreground">/ 10 综合评分</span>
                      </div>
                      {detailQuery.data.aiScoreDetails ? (
                        <QualityScoreBar details={detailQuery.data.aiScoreDetails as Record<string, { score: number; reason: string }>} />
                      ) : null}
                    </CardContent>
                  </Card>
                )}
                {/* Summary */}
                {detailQuery.data.aiSummary && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">AI摘要</CardTitle></CardHeader>
                    <CardContent><p className="text-sm">{detailQuery.data.aiSummary}</p></CardContent>
                  </Card>
                )}
                {/* Raw Content */}
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">原文内容</CardTitle></CardHeader>
                  <CardContent>
                    <p className="text-sm whitespace-pre-wrap max-h-60 overflow-y-auto">{detailQuery.data.rawContent}</p>
                  </CardContent>
                </Card>
              </div>
            </ScrollArea>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ════════ Format Preview Dialog ════════ */}
      <Dialog open={showFormatPreview !== null} onOpenChange={() => { setShowFormatPreview(null); setFormatResult(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh]">
          <DialogHeader><DialogTitle>AI格式化为标准SOP</DialogTitle></DialogHeader>
          {formatSopMut.isPending ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-orange-500 mb-4" />
              <p className="text-muted-foreground">AI正在将文章整理为标准SOP格式...</p>
            </div>
          ) : formatResult ? (
            <ScrollArea className="max-h-[65vh]">
              <div className="space-y-4 pr-4">
                <SopPreview data={formatResult} />
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Edit className="w-4 h-4" /> 编辑JSON（可修改后采纳）
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      rows={10}
                      className="font-mono text-xs"
                      value={editedContent}
                      onChange={e => setEditedContent(e.target.value)}
                    />
                  </CardContent>
                </Card>
              </div>
            </ScrollArea>
          ) : formatSopMut.isError ? (
            <div className="text-center py-10 text-destructive">格式化失败，请重试</div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowFormatPreview(null); setFormatResult(null); }}>关闭</Button>
            {formatResult && (
              <Button onClick={() => { setShowAdoptDialog(showFormatPreview); }}>
                <CheckCircle className="w-4 h-4 mr-1" /> 确认采纳入库
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════ Adopt Dialog ════════ */}
      <Dialog open={showAdoptDialog !== null} onOpenChange={() => setShowAdoptDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>确认采纳入库</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">选择目标知识库</label>
              <Select value={adoptTargetType} onValueChange={v => setAdoptTargetType(v as typeof adoptTargetType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(KB_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-sm text-muted-foreground">
              采纳后，文章将以"待审核"状态录入{KB_TYPE_LABELS[adoptTargetType]}，需经审核后才会正式发布。
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdoptDialog(null)}>取消</Button>
            <Button
              onClick={() => {
                if (!showAdoptDialog) return;
                adoptMut.mutate({
                  itemId: showAdoptDialog,
                  targetKbType: adoptTargetType,
                  editedContent: editedContent || undefined,
                });
              }}
              disabled={adoptMut.isPending}
            >
              {adoptMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />}
              确认采纳
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Sub Components ─────────────────────────────

function IntelItemCard({ item, onView, onFormat, onAdopt, onIgnore, onBookmark }: {
  item: Record<string, unknown>;
  onView: () => void;
  onFormat: () => void;
  onAdopt: () => void;
  onIgnore: () => void;
  onBookmark: () => void;
}) {
  const status = item.status as ItemStatus;
  const config = STATUS_CONFIG[status];
  const score = item.aiQualityScore ? parseFloat(item.aiQualityScore as string) : null;
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {/* Score */}
          <div className="flex-shrink-0 w-14 h-14 rounded-lg bg-gradient-to-br from-orange-50 to-amber-50 flex flex-col items-center justify-center border">
            {score !== null ? (
              <>
                <span className={`text-lg font-bold ${score >= 7 ? "text-green-600" : score >= 5 ? "text-amber-600" : "text-red-500"}`}>
                  {score.toFixed(1)}
                </span>
                <span className="text-[10px] text-muted-foreground">评分</span>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">--</span>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge className={`${config.color} text-[10px] px-1.5 py-0 gap-0.5`}>
                {config.icon} {config.label}
              </Badge>
              {item.aiSuggestedType ? (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  建议: {KB_TYPE_LABELS[item.aiSuggestedType as string] || String(item.aiSuggestedType)}
                </Badge>
              ) : null}
              {item.sourceName ? (
                <span className="text-[10px] text-muted-foreground">{String(item.sourceName)}</span>
              ) : null}
            </div>
            <h3 className="font-medium text-sm truncate cursor-pointer hover:text-orange-600" onClick={onView}>
              {String(item.title)}
            </h3>
            {item.aiSummary ? (
              <p className={`text-xs text-muted-foreground mt-1 ${expanded ? "" : "line-clamp-2"}`}>
                {String(item.aiSummary)}
              </p>
            ) : null}
            {item.aiSummary && (item.aiSummary as string).length > 100 ? (
              <button onClick={() => setExpanded(!expanded)} className="text-xs text-blue-500 mt-0.5 flex items-center gap-0.5">
                {expanded ? <><ChevronUp className="w-3 h-3" /> 收起</> : <><ChevronDown className="w-3 h-3" /> 展开</>}
              </button>
            ) : null}
            <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
              {item.author ? <span>{String(item.author)}</span> : null}
              {item.createdAt ? <span>{new Date(item.createdAt as number).toLocaleDateString()}</span> : null}
            </div>
          </div>

          {/* Actions */}
          <div className="flex-shrink-0 flex flex-col gap-1">
            <Button size="sm" variant="ghost" onClick={onView} title="查看详情">
              <Eye className="w-4 h-4" />
            </Button>
            {status !== "adopted" && status !== "ignored" && (
              <>
                <Button size="sm" variant="ghost" onClick={onFormat} title="AI格式化">
                  <Sparkles className="w-4 h-4 text-orange-500" />
                </Button>
                <Button size="sm" variant="ghost" onClick={onAdopt} title="直接采纳">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                </Button>
                <Button size="sm" variant="ghost" onClick={onBookmark} title="收藏">
                  <Bookmark className="w-4 h-4 text-amber-500" />
                </Button>
                <Button size="sm" variant="ghost" onClick={onIgnore} title="忽略">
                  <XCircle className="w-4 h-4 text-gray-400" />
                </Button>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function QualityScoreBar({ details }: { details: Record<string, { score: number; reason: string }> }) {
  const dimensions = [
    { key: "relevance", label: "相关性", weight: "30%" },
    { key: "actionability", label: "实操性", weight: "25%" },
    { key: "timeliness", label: "时效性", weight: "20%" },
    { key: "depth", label: "深度", weight: "15%" },
    { key: "uniqueness", label: "独特性", weight: "10%" },
  ];

  return (
    <div className="space-y-2">
      {dimensions.map(dim => {
        const d = details[dim.key];
        if (!d) return null;
        const pct = (d.score / 10) * 100;
        return (
          <div key={dim.key} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span>{dim.label} <span className="text-muted-foreground">({dim.weight})</span></span>
              <span className="font-medium">{d.score}/10</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${pct >= 70 ? "bg-green-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground">{d.reason}</p>
          </div>
        );
      })}
    </div>
  );
}

function SopPreview({ data }: { data: Record<string, unknown> }) {
  const steps = (data.steps || []) as Array<{ stepNo: number; title: string; description: string; tips: string }>;
  const faq = (data.faq || []) as Array<{ question: string; answer: string }>;
  const metrics = (data.keyMetrics || []) as string[];

  return (
    <Card className="border-orange-200 bg-orange-50/30">
      <CardContent className="p-4 space-y-4">
        <div>
          <h3 className="font-bold text-lg">{String(data.title || "")}</h3>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline">{String(data.level || "")}</Badge>
            <Badge variant="outline">{String(data.businessModule || "")}</Badge>
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">适用场景</p>
          <p className="text-sm">{String(data.applicableScene || "")}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">前置条件</p>
          <p className="text-sm">{String(data.prerequisites || "")}</p>
        </div>
        {steps.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">操作步骤</p>
            <div className="space-y-2">
              {steps.map((step, i) => (
                <div key={i} className="flex gap-3 p-2 bg-background rounded-md">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center text-xs font-bold">
                    {step.stepNo}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{step.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                    {step.tips && <p className="text-xs text-amber-600 mt-0.5">💡 {step.tips}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {metrics.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">关键指标</p>
            <div className="flex flex-wrap gap-1">
              {metrics.map((m, i) => <Badge key={i} variant="secondary" className="text-xs">{m}</Badge>)}
            </div>
          </div>
        )}
        {faq.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">常见问题</p>
            {faq.map((f, i) => (
              <div key={i} className="mb-2">
                <p className="text-sm font-medium">Q: {f.question}</p>
                <p className="text-xs text-muted-foreground">A: {f.answer}</p>
              </div>
            ))}
          </div>
        )}
        {data.referenceSource ? (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              参考来源: {String(data.referenceSource || "")}
              {data.referenceUrl ? (
                <a href={String(data.referenceUrl)} target="_blank" rel="noopener noreferrer" className="text-blue-500 ml-1">
                  [原文链接]
                </a>
              ) : null}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}


// ─── Auto-Collect Source Config (inline in source card) ──
const INTERVAL_LABELS: Record<string, string> = {
  every_6h: "每6小时",
  every_12h: "每12小时",
  daily: "每天",
  weekly: "每周",
  custom: "自定义Cron",
};

function AutoCollectSourceConfig({ source }: { source: Record<string, unknown> }) {
  const utils = trpc.useUtils();
  const updateAutoCollect = trpc.kbIntel.updateAutoCollect.useMutation({
    onSuccess: (data) => {
      toast.success(data.nextAutoCollectAt ? "定时采集已启用" : "定时采集已关闭");
      utils.kbIntel.listSources.invalidate();
      utils.kbIntel.getSchedulerStatus.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const triggerCollect = trpc.kbIntel.triggerAutoCollect.useMutation({
    onSuccess: (data) => {
      toast.success(`采集完成`, {
        description: `发现 ${data.totalFound} 条，新增 ${data.totalNew} 条，推荐 ${data.totalRecommended} 条`,
      });
      utils.kbIntel.listItems.invalidate();
      utils.kbIntel.listSources.invalidate();
      utils.kbIntel.getStats.invalidate();
      utils.kbIntel.getCollectLogs.invalidate();
    },
    onError: (err) => toast.error("采集失败: " + err.message),
  });

  const [showConfig, setShowConfig] = useState(false);
  const [interval, setInterval] = useState<string>((source.autoCollectInterval as string) || "daily");
  const [cron, setCron] = useState<string>((source.autoCollectCron as string) || "");
  const [autoEval, setAutoEval] = useState<boolean>((source.autoEvaluateEnabled as boolean) ?? true);
  const [maxItems, setMaxItems] = useState<number>((source.autoCollectMaxItems as number) || 10);

  const isEnabled = source.autoCollectEnabled as boolean;
  const nextRun = source.nextAutoCollectAt as number | null;
  const lastRun = source.lastAutoCollectAt as number | null;
  const failures = (source.consecutiveFailures as number) || 0;

  return (
    <div className="mt-3 pt-3 border-t space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">定时自动采集</span>
          {failures > 0 && (
            <Badge variant="destructive" className="text-[10px] px-1 py-0">
              <AlertTriangle className="w-2.5 h-2.5 mr-0.5" /> 失败{failures}次
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={isEnabled}
            onCheckedChange={(checked) => {
              updateAutoCollect.mutate({
                sourceId: source.id as number,
                autoCollectEnabled: checked,
                autoCollectInterval: interval as "every_6h" | "every_12h" | "daily" | "weekly" | "custom",
                autoCollectCron: cron || undefined,
                autoEvaluateEnabled: autoEval,
                autoCollectMaxItems: maxItems,
              });
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => setShowConfig(!showConfig)}
          >
            <Settings className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={() => triggerCollect.mutate({ sourceId: source.id as number })}
            disabled={triggerCollect.isPending}
          >
            {triggerCollect.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <><Play className="w-3 h-3 mr-0.5" /> 立即采集</>
            )}
          </Button>
        </div>
      </div>

      {/* Status line */}
      {isEnabled && (
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span>频率: {INTERVAL_LABELS[interval] || interval}</span>
          {lastRun && <span>上次: {new Date(lastRun).toLocaleString()}</span>}
          {nextRun && <span>下次: {new Date(nextRun).toLocaleString()}</span>}
        </div>
      )}

      {/* Config panel */}
      {showConfig && (
        <div className="p-3 bg-muted/30 rounded-lg space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium">采集频率</label>
              <Select value={interval} onValueChange={setInterval}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(INTERVAL_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium">每次最多采集</label>
              <Input
                type="number"
                min={1}
                max={50}
                value={maxItems}
                onChange={e => setMaxItems(Number(e.target.value))}
                className="h-8 text-xs"
              />
            </div>
          </div>
          {interval === "custom" && (
            <div>
              <label className="text-xs font-medium">Cron表达式</label>
              <Input
                placeholder="0 9 * * * (每天9点)"
                value={cron}
                onChange={e => setCron(e.target.value)}
                className="h-8 text-xs font-mono"
              />
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch checked={autoEval} onCheckedChange={setAutoEval} />
              <span className="text-xs">采集后自动AI评估</span>
            </div>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                updateAutoCollect.mutate({
                  sourceId: source.id as number,
                  autoCollectEnabled: isEnabled,
                  autoCollectInterval: interval as "every_6h" | "every_12h" | "daily" | "weekly" | "custom",
                  autoCollectCron: cron || undefined,
                  autoEvaluateEnabled: autoEval,
                  autoCollectMaxItems: maxItems,
                });
                setShowConfig(false);
              }}
              disabled={updateAutoCollect.isPending}
            >
              {updateAutoCollect.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
              保存配置
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Collect Logs Panel ────────────────────────────
function CollectLogsPanel() {
  const [logPage, setLogPage] = useState(1);
  const [sourceFilter, setSourceFilter] = useState<number | undefined>();
  const sourcesQuery = trpc.kbIntel.listSources.useQuery();
  const logsQuery = trpc.kbIntel.getCollectLogs.useQuery({
    sourceId: sourceFilter,
    page: logPage,
    pageSize: 20,
  });

  const STATUS_COLORS: Record<string, string> = {
    running: "bg-blue-100 text-blue-700",
    success: "bg-green-100 text-green-700",
    partial: "bg-amber-100 text-amber-700",
    failed: "bg-red-100 text-red-700",
  };
  const STATUS_LABELS: Record<string, string> = {
    running: "运行中",
    success: "成功",
    partial: "部分成功",
    failed: "失败",
  };
  const TRIGGER_LABELS: Record<string, string> = {
    manual: "手动",
    auto: "定时",
    test: "测试",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <History className="w-5 h-5" /> 采集日志
        </h2>
        <div className="flex items-center gap-2">
          {sourcesQuery.data && sourcesQuery.data.length > 0 && (
            <Select
              value={sourceFilter?.toString() || "all"}
              onValueChange={v => { setSourceFilter(v === "all" ? undefined : Number(v)); setLogPage(1); }}
            >
              <SelectTrigger className="w-48 h-8 text-xs">
                <SelectValue placeholder="全部来源" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部来源</SelectItem>
                {sourcesQuery.data.map(s => (
                  <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" variant="outline" onClick={() => logsQuery.refetch()}>
            <RefreshCw className="w-3.5 h-3.5 mr-1" /> 刷新
          </Button>
        </div>
      </div>

      {logsQuery.isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中...
        </div>
      ) : !logsQuery.data?.logs.length ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <History className="w-12 h-12 mb-4 opacity-30" />
            <p className="text-lg font-medium">暂无采集日志</p>
            <p className="text-sm mt-1">启用定时采集或手动触发采集后，日志将在此显示</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {logsQuery.data.logs.map((log: Record<string, unknown>) => (
            <Card key={log.id as number} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Badge className={`${STATUS_COLORS[log.status as string] || "bg-gray-100"} text-[10px] px-1.5`}>
                      {STATUS_LABELS[log.status as string] || String(log.status)}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] px-1.5">
                      {TRIGGER_LABELS[log.triggerType as string] || String(log.triggerType)}
                    </Badge>
                    <span className="text-sm font-medium">{String(log.sourceName || "未知来源")}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {log.startedAt ? new Date(log.startedAt as number).toLocaleString() : ""}
                  </span>
                </div>
                <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                  <span>发现: <strong className="text-foreground">{String(log.totalFound || 0)}</strong></span>
                  <span>新增: <strong className="text-green-600">{String(log.totalNew || 0)}</strong></span>
                  <span>重复: <strong>{String(log.totalDuplicate || 0)}</strong></span>
                  <span>已评估: <strong className="text-blue-600">{String(log.totalEvaluated || 0)}</strong></span>
                  <span>推荐: <strong className="text-orange-600">{String(log.totalRecommended || 0)}</strong></span>
                  {log.durationMs ? <span>耗时: {((log.durationMs as number) / 1000).toFixed(1)}s</span> : null}
                </div>
                {log.errorMessage ? (
                  <p className="text-xs text-destructive mt-2 bg-destructive/5 p-2 rounded">
                    {String(log.errorMessage)}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}
          {(logsQuery.data.total as number) > 20 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button size="sm" variant="outline" disabled={logPage === 1} onClick={() => setLogPage(p => p - 1)}>上一页</Button>
              <span className="text-sm text-muted-foreground">第 {logPage} 页 / 共 {Math.ceil((logsQuery.data.total as number) / 20)} 页</span>
              <Button size="sm" variant="outline" disabled={logPage * 20 >= (logsQuery.data.total as number)} onClick={() => setLogPage(p => p + 1)}>下一页</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Scheduler Panel ───────────────────────────────
function SchedulerPanel() {
  const schedulerQuery = trpc.kbIntel.getSchedulerStatus.useQuery(undefined, {
    refetchInterval: 30000, // Refresh every 30s
  });
  const utils = trpc.useUtils();
  const updateAutoCollect = trpc.kbIntel.updateAutoCollect.useMutation({
    onSuccess: () => {
      utils.kbIntel.getSchedulerStatus.invalidate();
      utils.kbIntel.listSources.invalidate();
    },
  });

  const data = schedulerQuery.data;

  return (
    <div className="space-y-6">
      {/* Scheduler Status */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-500" /> 调度器状态
            </CardTitle>
            <div className="flex items-center gap-2">
              {data?.isActive ? (
                <Badge className="bg-green-100 text-green-700 text-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1 animate-pulse" /> 运行中
                </Badge>
              ) : (
                <Badge className="bg-gray-100 text-gray-500 text-xs">已停止</Badge>
              )}
              <Button size="sm" variant="outline" onClick={() => schedulerQuery.refetch()}>
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold">{data?.scheduledSources.length || 0}</p>
              <p className="text-xs text-muted-foreground">已调度情报源</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{data?.activeCollections.length || 0}</p>
              <p className="text-xs text-muted-foreground">正在采集</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-amber-600">
                {data?.scheduledSources.filter((s: Record<string, unknown>) => {
                  const next = s.nextRunAt as number | null;
                  return next && next <= Date.now() + 3600000;
                }).length || 0}
              </p>
              <p className="text-xs text-muted-foreground">1小时内待执行</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Scheduled Sources */}
      {data?.scheduledSources && data.scheduledSources.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">定时采集任务列表</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.scheduledSources.map((source: Record<string, unknown>) => {
                const nextRun = source.nextRunAt as number | null;
                const lastRun = source.lastRunAt as number | null;
                const failures = (source.consecutiveFailures as number) || 0;
                const isCollecting = data.activeCollections.includes(source.id as number);

                return (
                  <div key={source.id as number} className="flex items-center justify-between py-3 border-b last:border-0">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${isCollecting ? "bg-blue-500 animate-pulse" : failures > 3 ? "bg-red-500" : "bg-green-500"}`} />
                      <div>
                        <p className="text-sm font-medium">{String(source.name)}</p>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                          <span>{INTERVAL_LABELS[source.interval as string] || String(source.interval)}</span>
                          <span>|</span>
                          <span>最多{String(source.maxItems)}条/次</span>
                          {source.autoEvaluateEnabled ? (
                            <Badge variant="outline" className="text-[10px] px-1 py-0">自动评估</Badge>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right text-xs">
                        {lastRun && (
                          <p className="text-muted-foreground">上次: {new Date(lastRun).toLocaleString()}</p>
                        )}
                        {nextRun && (
                          <p className={nextRun <= Date.now() ? "text-amber-600 font-medium" : "text-muted-foreground"}>
                            下次: {new Date(nextRun).toLocaleString()}
                          </p>
                        )}
                      </div>
                      {failures > 0 && (
                        <Badge variant="destructive" className="text-[10px]">
                          失败{failures}次
                        </Badge>
                      )}
                      {isCollecting && (
                        <Badge className="bg-blue-100 text-blue-700 text-[10px]">
                          <Loader2 className="w-2.5 h-2.5 animate-spin mr-0.5" /> 采集中
                        </Badge>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-destructive"
                        onClick={() => {
                          updateAutoCollect.mutate({
                            sourceId: source.id as number,
                            autoCollectEnabled: false,
                          });
                          toast.info("已停止定时采集");
                        }}
                      >
                        <Pause className="w-3 h-3 mr-0.5" /> 停止
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Clock className="w-12 h-12 mb-4 opacity-30" />
            <p className="text-lg font-medium">暂无定时采集任务</p>
            <p className="text-sm mt-1">在"情报源管理"中为情报源开启定时采集功能</p>
          </CardContent>
        </Card>
      )}

      {/* Tips */}
      <Card className="bg-blue-50/50 border-blue-200">
        <CardContent className="p-4">
          <h3 className="text-sm font-medium flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-blue-500" /> 定时采集说明
          </h3>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>调度器每60秒检查一次是否有需要执行的采集任务</li>
            <li>支持6小时/12小时/每天/每周/自定义Cron五种频率</li>
            <li>采集后可自动进行AI质量评估，达到阈值的自动标记为“推荐”</li>
            <li>连续失败5次的情报源将自动暂停，需手动重新启用</li>
            <li>发现推荐内容时会自动推送通知</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Preset Sources Panel ───────────────────────
function PresetSourcesPanel() {
  const [expanded, setExpanded] = useState(false);
  const presetsQuery = trpc.kbIntel.getPresetSources.useQuery();
  const utils = trpc.useUtils();
  const addPresetMut = trpc.kbIntel.addPresetSource.useMutation({
    onSuccess: (data) => {
      toast.success(`已添加: ${data.name}`);
      utils.kbIntel.getPresetSources.invalidate();
      utils.kbIntel.listSources.invalidate();
      utils.kbIntel.getStats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const addBatchMut = trpc.kbIntel.addPresetSourceBatch.useMutation({
    onSuccess: (data) => {
      const added = data.results.filter(r => r.status === "added").length;
      const exists = data.results.filter(r => r.status === "exists").length;
      toast.success(`批量添加完成`, { description: `${added} 个新增, ${exists} 个已存在` });
      utils.kbIntel.getPresetSources.invalidate();
      utils.kbIntel.listSources.invalidate();
      utils.kbIntel.getStats.invalidate();
    },
  });

  const presets = presetsQuery.data || [];
  const notAdded = presets.filter(p => !p.alreadyAdded);

  const SOURCE_TYPE_ICONS: Record<string, string> = {
    wearesellers: "💬",
    media: "📰",
    amazon_news: "📦",
    rss: "📡",
    custom_url: "🌐",
  };

  return (
    <Card className="border-dashed border-orange-200 bg-orange-50/30">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-orange-500" />
            <span className="text-sm font-medium">推荐情报源</span>
            <Badge variant="outline" className="text-xs">{presets.length} 个源</Badge>
            {notAdded.length > 0 && (
              <Badge className="text-xs bg-orange-100 text-orange-700 hover:bg-orange-200">
                {notAdded.length} 个未添加
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {notAdded.length > 1 && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                disabled={addBatchMut.isPending}
                onClick={() => {
                  const indices = presets
                    .map((p, i) => (!p.alreadyAdded ? i : -1))
                    .filter(i => i >= 0);
                  addBatchMut.mutate({ presetIndices: indices });
                }}
              >
                {addBatchMut.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                一键全部添加
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {expanded && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {presets.map((preset, idx) => (
              <div
                key={idx}
                className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                  preset.alreadyAdded
                    ? "bg-green-50/50 border-green-200 opacity-70"
                    : "bg-white border-gray-200 hover:border-orange-300"
                }`}
              >
                <span className="text-xl mt-0.5">{SOURCE_TYPE_ICONS[preset.sourceType] || "🌐"}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{preset.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{preset.description}</p>
                  <Badge variant="outline" className="text-xs mt-1">{preset.category}</Badge>
                </div>
                <div className="shrink-0">
                  {preset.alreadyAdded ? (
                    <Badge className="bg-green-100 text-green-700 text-xs">
                      <CheckCircle className="w-3 h-3 mr-0.5" /> 已添加
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7"
                      disabled={addPresetMut.isPending}
                      onClick={() => addPresetMut.mutate({ presetIndex: idx })}
                    >
                      {addPresetMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
