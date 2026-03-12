// Router split: keyword CRUD on trpc.keyword, AI procedures on trpc.keywordAi
import { useState, useMemo, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Upload, Plus, Trash2, Filter, Tag, GitBranch, LayoutGrid, Ban,
  Play, Search, Download, RefreshCw, Zap, FileText, ChevronDown,
  ChevronUp, ArrowUpDown, Loader2, X, AlertTriangle, Edit2, CheckCircle2, Copy, BarChart3, Undo2, Star
} from "lucide-react";

// Strategy category labels
const STRATEGY_LABELS: Record<string, { label: string; color: string; desc: string }> = {
  core_main: { label: "核心主词", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200", desc: "高流量+高相关+高竞争" },
  sub_core: { label: "次核心词", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200", desc: "中流量+高相关+中竞争" },
  precise_longtail: { label: "精准长尾词", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200", desc: "低流量+高相关+低竞争" },
  scene_intent: { label: "场景意图词", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200", desc: "场景相关+COSMO匹配" },
  longtail_main: { label: "长尾主词", color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200", desc: "中流量+中相关+低竞争" },
  observe_test: { label: "观察测试词", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200", desc: "高流量+低相关" },
  negative: { label: "否定词", color: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200", desc: "属性不匹配" },
  brand_offensive: { label: "品牌进攻词", color: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200", desc: "竞对品牌词根下的进攻词" },
};

const ROOT_LABELS: Record<string, { label: string; icon: string }> = {
  core: { label: "核心词根", icon: "🎯" },
  function: { label: "功能词根", icon: "⚙️" },
  scene: { label: "场景词根", icon: "🌍" },
  audience: { label: "人群词根", icon: "👥" },
  spec: { label: "规格词根", icon: "📏" },
  painpoint: { label: "痛点词根", icon: "💡" },
  gift_holiday: { label: "节日/礼品词根", icon: "🎁" },
  brand_competitor: { label: "品牌词根", icon: "🏷️" },
};

const PLACEMENT_LABELS: Record<string, string> = {
  title_front: "标题前段",
  title_mid: "标题中后段",
  title_end: "标题末尾",
  bullet_first: "五点首句",
  bullet_body: "五点融入",
  aplus: "A+文案",
  search_term: "后台ST",
  not_use: "不使用",
};

const RELEVANCE_COLORS: Record<string, string> = {
  high: "bg-green-100 text-green-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-orange-100 text-orange-800",
  none: "bg-red-100 text-red-800",
};

const TRAFFIC_COLORS: Record<string, string> = {
  high: "bg-blue-100 text-blue-800",
  medium: "bg-sky-100 text-sky-800",
  low: "bg-gray-100 text-gray-600",
};

export default function KeywordPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("keywords");
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

  // Project list
  const projectsQuery = trpc.project.list.useQuery();
  const projects = projectsQuery.data || [];

  // Auto-select first project
  const projectId = selectedProjectId || projects[0]?.id;

  if (!user) {
    return (
      <div className="container py-8">
        <Card><CardContent className="py-12 text-center text-muted-foreground">请先登录后使用关键词管理功能</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="container py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">关键词管理</h1>
          <p className="text-muted-foreground mt-1">亚马逊关键词整理框架 V2.1 — 词海管理 → AI清洗 → 三维打标 → 策略矩阵 → Listing布局</p>
        </div>
        <Select value={projectId?.toString() || ""} onValueChange={(v) => setSelectedProjectId(Number(v))}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="选择项目" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p: any) => (
              <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!projectId ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">请先选择或创建一个项目</CardContent></Card>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="keywords" className="flex items-center gap-1"><FileText className="h-3.5 w-3.5" />词海管理</TabsTrigger>
            <TabsTrigger value="import" className="flex items-center gap-1"><Upload className="h-3.5 w-3.5" />导入</TabsTrigger>
            <TabsTrigger value="pipeline" className="flex items-center gap-1"><Zap className="h-3.5 w-3.5" />AI分析</TabsTrigger>
            <TabsTrigger value="matrix" className="flex items-center gap-1"><LayoutGrid className="h-3.5 w-3.5" />策略矩阵</TabsTrigger>
            <TabsTrigger value="roots" className="flex items-center gap-1"><GitBranch className="h-3.5 w-3.5" />词根分类</TabsTrigger>
            <TabsTrigger value="negative" className="flex items-center gap-1"><Ban className="h-3.5 w-3.5" />否词库</TabsTrigger>
          </TabsList>

          <TabsContent value="keywords"><KeywordListTab projectId={projectId} /></TabsContent>
          <TabsContent value="import"><ImportTab projectId={projectId} /></TabsContent>
          <TabsContent value="pipeline"><PipelineTab projectId={projectId} /></TabsContent>
          <TabsContent value="matrix"><MatrixTab projectId={projectId} /></TabsContent>
          <TabsContent value="roots"><RootsTab projectId={projectId} /></TabsContent>
          <TabsContent value="negative"><NegativeTab projectId={projectId} /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// ─── Keyword List Tab ──────────────────────────────────────────

function KeywordListTab({ projectId }: { projectId: number }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStrategy, setFilterStrategy] = useState<string>("all");
  const [filterRelevance, setFilterRelevance] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [sortField, setSortField] = useState<string>("keyword");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const keywordsQuery = trpc.keyword.list.useQuery({ projectId });
  const statsQuery = trpc.keyword.stats.useQuery({ projectId });
  const deleteMut = trpc.keyword.delete.useMutation({ onSuccess: () => { keywordsQuery.refetch(); statsQuery.refetch(); toast.success("已删除"); } });
  const bulkDeleteMut = trpc.keyword.bulkDelete.useMutation({ onSuccess: () => { keywordsQuery.refetch(); statsQuery.refetch(); setSelectedIds(new Set()); toast.success("批量删除完成"); } });
  const moveToNegMut = trpc.keyword.moveToNegative.useMutation({ onSuccess: () => { keywordsQuery.refetch(); statsQuery.refetch(); toast.success("已移入否词库"); } });
  const addMut = trpc.keyword.add.useMutation({ onSuccess: () => { keywordsQuery.refetch(); statsQuery.refetch(); toast.success("已添加"); } });
  const updateMut = trpc.keyword.update.useMutation({
    onSuccess: () => { keywordsQuery.refetch(); statsQuery.refetch(); },
    onError: (err: any) => toast.error(err.message),
  });
  const bulkUpdateMut = trpc.keyword.bulkUpdate.useMutation({
    onSuccess: (data: any) => {
      keywordsQuery.refetch(); statsQuery.refetch();
      setSelectedIds(new Set());
      setShowBatchEdit(false);
      toast.success(`已批量更新 ${data.count} 个关键词`);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const [newKw, setNewKw] = useState("");
  const [showBatchEdit, setShowBatchEdit] = useState(false);
  const [batchStrategy, setBatchStrategy] = useState<string>("_none");
  const [batchRelevance, setBatchRelevance] = useState<string>("_none");
  const [batchStatus, setBatchStatus] = useState<string>("_none");
  const [batchPlacement, setBatchPlacement] = useState<string>("_none");
  const [batchRootCategory, setBatchRootCategory] = useState<string>("_none");
  const [batchTrafficLevel, setBatchTrafficLevel] = useState<string>("_none");
  const [batchCompetition, setBatchCompetition] = useState<string>("_none");

  const applyBatchEdit = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) { toast.error("请先选择关键词"); return; }
    const data: any = {};
    if (batchStrategy !== "_none") data.strategyCategory = batchStrategy === "_clear" ? null : batchStrategy;
    if (batchRelevance !== "_none") data.relevance = batchRelevance;
    if (batchStatus !== "_none") data.status = batchStatus;
    if (batchPlacement !== "_none") data.listingPlacement = batchPlacement === "_clear" ? null : batchPlacement;
    if (batchRootCategory !== "_none") data.rootCategory = batchRootCategory === "_clear" ? null : batchRootCategory;
    if (batchTrafficLevel !== "_none") data.trafficLevel = batchTrafficLevel;
    if (batchCompetition !== "_none") data.competition = batchCompetition;
    if (Object.keys(data).length === 0) { toast.error("请至少选择一个要修改的属性"); return; }
    bulkUpdateMut.mutate({ ids, data });
  };

  const resetBatchEdit = () => {
    setBatchStrategy("_none"); setBatchRelevance("_none"); setBatchStatus("_none");
    setBatchPlacement("_none"); setBatchRootCategory("_none");
    setBatchTrafficLevel("_none"); setBatchCompetition("_none");
  };

  const allKeywords = keywordsQuery.data || [];
  const stats = statsQuery.data;

  const filtered = useMemo(() => {
    let result = allKeywords;
    if (searchTerm) result = result.filter((k: any) => k.keyword.toLowerCase().includes(searchTerm.toLowerCase()));
    if (filterStrategy !== "all") result = result.filter((k: any) => k.strategyCategory === filterStrategy);
    if (filterRelevance !== "all") result = result.filter((k: any) => k.relevance === filterRelevance);
    if (filterStatus !== "all") result = result.filter((k: any) => k.status === filterStatus);
    // Sort
    result = [...result].sort((a: any, b: any) => {
      let va = a[sortField] ?? "";
      let vb = b[sortField] ?? "";
      if (typeof va === "number" && typeof vb === "number") return sortDir === "asc" ? va - vb : vb - va;
      return sortDir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
    return result;
  }, [allKeywords, searchTerm, filterStrategy, filterRelevance, filterStatus, sortField, sortDir]);

  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exportCsv = () => {
    const rows = filtered.length > 0 ? filtered : allKeywords;
    if (rows.length === 0) { toast.error("没有可导出的关键词"); return; }
    const headers = ["关键词", "月搜索量", "SPR", "PPC竞价", "相关性", "流量", "竞争", "策略分类", "词根分类", "词根", "Listing位置", "场景标签", "状态", "来源"];
    const csvRows = [headers.join(",")];
    for (const kw of rows) {
      let sceneTags = "";
      try { sceneTags = kw.sceneTags ? JSON.parse(kw.sceneTags).join(";") : ""; } catch {}
      csvRows.push([
        `"${(kw.keyword || "").replace(/"/g, '""')}"`,
        kw.monthlySearchVolume || "",
        kw.spr || "",
        kw.ppcBid || "",
        kw.relevance || "",
        kw.trafficLevel || "",
        kw.competition || "",
        (kw.strategyCategory ? STRATEGY_LABELS[kw.strategyCategory]?.label : "") || kw.strategyCategory || "",
        (kw.rootCategory ? ROOT_LABELS[kw.rootCategory]?.label : "") || kw.rootCategory || "",
        kw.rootWord || "",
        (kw.listingPlacement ? PLACEMENT_LABELS[kw.listingPlacement] : "") || kw.listingPlacement || "",
        `"${sceneTags}"`,
        kw.status || "",
        kw.source || "",
      ].join(","));
    }
    const bom = "\uFEFF";
    const blob = new Blob([bom + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `keywords_${projectId}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`已导出 ${rows.length} 个关键词`);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((k: any) => k.id)));
  };

  return (
    <div className="space-y-4">
      {/* Stats Summary */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card><CardContent className="py-3 text-center"><div className="text-2xl font-bold">{stats.total}</div><div className="text-xs text-muted-foreground">总关键词</div></CardContent></Card>
          <Card><CardContent className="py-3 text-center"><div className="text-2xl font-bold text-green-600">{stats.byStatus?.finalized || 0}</div><div className="text-xs text-muted-foreground">已完成</div></CardContent></Card>
          <Card><CardContent className="py-3 text-center"><div className="text-2xl font-bold text-blue-600">{stats.byStatus?.tagged || 0}</div><div className="text-xs text-muted-foreground">已打标</div></CardContent></Card>
          <Card><CardContent className="py-3 text-center"><div className="text-2xl font-bold text-yellow-600">{stats.byStatus?.raw || 0}</div><div className="text-xs text-muted-foreground">待处理</div></CardContent></Card>
          <Card><CardContent className="py-3 text-center"><div className="text-2xl font-bold text-red-600">{stats.negativeCount}</div><div className="text-xs text-muted-foreground">否定词</div></CardContent></Card>
        </div>
      )}

      {/* Filters & Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="搜索关键词..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterStrategy} onValueChange={setFilterStrategy}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="策略分类" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部策略</SelectItem>
            {Object.entries(STRATEGY_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterRelevance} onValueChange={setFilterRelevance}>
          <SelectTrigger className="w-[120px]"><SelectValue placeholder="相关性" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="high">高相关</SelectItem>
            <SelectItem value="medium">中相关</SelectItem>
            <SelectItem value="low">低相关</SelectItem>
            <SelectItem value="none">无关</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[120px]"><SelectValue placeholder="状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="raw">原始</SelectItem>
            <SelectItem value="cleaned">已清洗</SelectItem>
            <SelectItem value="scored">已评分</SelectItem>
            <SelectItem value="tagged">已打标</SelectItem>
            <SelectItem value="finalized">已完成</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Quick Add */}
      <div className="flex items-center gap-2">
        <Input placeholder="手动添加关键词..." value={newKw} onChange={(e) => setNewKw(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newKw.trim()) { addMut.mutate({ projectId, keyword: newKw.trim() }); setNewKw(""); } }} />
        <Button size="sm" onClick={() => { if (newKw.trim()) { addMut.mutate({ projectId, keyword: newKw.trim() }); setNewKw(""); } }} disabled={!newKw.trim()}><Plus className="h-4 w-4 mr-1" />添加</Button>
        {selectedIds.size > 0 && (
          <>
            <Button size="sm" variant="outline" className="border-blue-500 text-blue-600" onClick={() => { setShowBatchEdit(!showBatchEdit); resetBatchEdit(); }}>
              <Edit2 className="h-4 w-4 mr-1" />批量编辑({selectedIds.size})
            </Button>
            <Button size="sm" variant="destructive" onClick={() => bulkDeleteMut.mutate({ ids: Array.from(selectedIds) })}><Trash2 className="h-4 w-4 mr-1" />删除({selectedIds.size})</Button>
          </>
        )}
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={allKeywords.length === 0}>
          <Download className="h-4 w-4 mr-1" />导出CSV{filtered.length !== allKeywords.length && filtered.length > 0 ? ` (${filtered.length})` : ""}
        </Button>
      </div>

      {/* Batch Edit Toolbar */}
      {showBatchEdit && selectedIds.size > 0 && (
        <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/30">
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Edit2 className="h-4 w-4 text-blue-600" />
                <span className="font-medium text-sm">批量编辑 - 已选择 {selectedIds.size} 个关键词</span>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setShowBatchEdit(false)}><X className="h-4 w-4" /></Button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">策略分类</label>
                <Select value={batchStrategy} onValueChange={setBatchStrategy}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="不修改" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">不修改</SelectItem>
                    <SelectItem value="_clear">清空</SelectItem>
                    {Object.entries(STRATEGY_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">相关性</label>
                <Select value={batchRelevance} onValueChange={setBatchRelevance}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="不修改" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">不修改</SelectItem>
                    <SelectItem value="high">高相关</SelectItem>
                    <SelectItem value="medium">中相关</SelectItem>
                    <SelectItem value="low">低相关</SelectItem>
                    <SelectItem value="none">无关</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">状态</label>
                <Select value={batchStatus} onValueChange={setBatchStatus}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="不修改" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">不修改</SelectItem>
                    <SelectItem value="raw">原始</SelectItem>
                    <SelectItem value="cleaned">已清洗</SelectItem>
                    <SelectItem value="scored">已评分</SelectItem>
                    <SelectItem value="tagged">已打标</SelectItem>
                    <SelectItem value="finalized">已完成</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Listing位置</label>
                <Select value={batchPlacement} onValueChange={setBatchPlacement}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="不修改" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">不修改</SelectItem>
                    <SelectItem value="_clear">清空</SelectItem>
                    {Object.entries(PLACEMENT_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">词根分类</label>
                <Select value={batchRootCategory} onValueChange={setBatchRootCategory}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="不修改" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">不修改</SelectItem>
                    <SelectItem value="_clear">清空</SelectItem>
                    {Object.entries(ROOT_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.icon} {v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">流量等级</label>
                <Select value={batchTrafficLevel} onValueChange={setBatchTrafficLevel}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="不修改" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">不修改</SelectItem>
                    <SelectItem value="high">高</SelectItem>
                    <SelectItem value="medium">中</SelectItem>
                    <SelectItem value="low">低</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">竞争度</label>
                <Select value={batchCompetition} onValueChange={setBatchCompetition}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="不修改" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">不修改</SelectItem>
                    <SelectItem value="high">高</SelectItem>
                    <SelectItem value="medium">中</SelectItem>
                    <SelectItem value="low">低</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <Button size="sm" onClick={applyBatchEdit} disabled={bulkUpdateMut.isPending}>
                {bulkUpdateMut.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />更新中...</> : <><CheckCircle2 className="h-4 w-4 mr-1" />应用修改</>}
              </Button>
              <Button size="sm" variant="ghost" onClick={resetBatchEdit}>重置</Button>
              <span className="text-xs text-muted-foreground">选择“不修改”的属性将保持原值不变</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Keyword Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"><Checkbox checked={selectedIds.size === filtered.length && filtered.length > 0} onCheckedChange={toggleSelectAll} /></TableHead>
                  <TableHead className="cursor-pointer" onClick={() => toggleSort("keyword")}>关键词 <ArrowUpDown className="inline h-3 w-3" /></TableHead>
                  <TableHead>中文翻译</TableHead>
                  <TableHead className="w-10">AC</TableHead>
                  <TableHead className="cursor-pointer" onClick={() => toggleSort("monthlySearchVolume")}>月搜索量 <ArrowUpDown className="inline h-3 w-3" /></TableHead>
                  <TableHead>相关性</TableHead>
                  <TableHead>流量</TableHead>
                  <TableHead>竞争</TableHead>
                  <TableHead>策略分类</TableHead>
                  <TableHead>词根</TableHead>
                  <TableHead>Listing位置</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="w-20">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={13} className="text-center py-8 text-muted-foreground">暂无关键词数据，请先导入CSV/XLSX或手动添加</TableCell></TableRow>
                ) : filtered.slice(0, 200).map((kw: any) => (
                  <TableRow key={kw.id} className={kw.isNegative ? "opacity-50" : ""}>
                    <TableCell><Checkbox checked={selectedIds.has(kw.id)} onCheckedChange={() => toggleSelect(kw.id)} /></TableCell>
                    <TableCell className="font-medium max-w-[200px] truncate">{kw.keyword}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">{kw.translationCn || "-"}</TableCell>
                    <TableCell>{kw.isAcRecommended ? <Star className="h-4 w-4 text-amber-500 fill-amber-500" /> : <span className="text-muted-foreground">-</span>}</TableCell>
                    <TableCell>{kw.monthlySearchVolume?.toLocaleString() || "-"}</TableCell>
                    <TableCell>
                      <Select value={kw.relevance || "none"} onValueChange={(v) => updateMut.mutate({ id: kw.id, relevance: v as any })}>
                        <SelectTrigger className="h-7 w-[68px] text-xs border-transparent hover:border-border px-1.5"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="high"><span className="text-green-700">高</span></SelectItem>
                          <SelectItem value="medium"><span className="text-yellow-700">中</span></SelectItem>
                          <SelectItem value="low"><span className="text-orange-700">低</span></SelectItem>
                          <SelectItem value="none"><span className="text-red-700">无</span></SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select value={kw.trafficLevel || "low"} onValueChange={(v) => updateMut.mutate({ id: kw.id, trafficLevel: v as any })}>
                        <SelectTrigger className="h-7 w-[68px] text-xs border-transparent hover:border-border px-1.5"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="high"><span className="text-blue-700">高</span></SelectItem>
                          <SelectItem value="medium"><span className="text-sky-700">中</span></SelectItem>
                          <SelectItem value="low"><span className="text-gray-600">低</span></SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select value={kw.competition || "low"} onValueChange={(v) => updateMut.mutate({ id: kw.id, competition: v as any })}>
                        <SelectTrigger className="h-7 w-[68px] text-xs border-transparent hover:border-border px-1.5"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="high">高</SelectItem>
                          <SelectItem value="medium">中</SelectItem>
                          <SelectItem value="low">低</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select value={kw.strategyCategory || "_empty"} onValueChange={(v) => updateMut.mutate({ id: kw.id, strategyCategory: v === "_empty" ? null : v as any })}>
                        <SelectTrigger className="h-7 w-[100px] text-xs border-transparent hover:border-border px-1.5"><SelectValue placeholder="-" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_empty">-</SelectItem>
                          {Object.entries(STRATEGY_LABELS).map(([k, v]) => (
                            <SelectItem key={k} value={k}>{v.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select value={kw.rootCategory || "_empty"} onValueChange={(v) => updateMut.mutate({ id: kw.id, rootCategory: v === "_empty" ? null : v as any })}>
                        <SelectTrigger className="h-7 w-[100px] text-xs border-transparent hover:border-border px-1.5"><SelectValue placeholder="-" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_empty">-</SelectItem>
                          {Object.entries(ROOT_LABELS).map(([k, v]) => (
                            <SelectItem key={k} value={k}>{v.icon} {v.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select value={kw.listingPlacement || "_empty"} onValueChange={(v) => updateMut.mutate({ id: kw.id, listingPlacement: v === "_empty" ? null : v as any })}>
                        <SelectTrigger className="h-7 w-[100px] text-xs border-transparent hover:border-border px-1.5"><SelectValue placeholder="-" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_empty">-</SelectItem>
                          {Object.entries(PLACEMENT_LABELS).map(([k, v]) => (
                            <SelectItem key={k} value={k}>{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{kw.status}</Badge></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => moveToNegMut.mutate({ keywordId: kw.id })} title="移入否词库"><Ban className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteMut.mutate({ id: kw.id })} title="删除"><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {filtered.length > 200 && (
            <div className="p-3 text-center text-sm text-muted-foreground border-t">显示前200条，共{filtered.length}条关键词</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Import Tab ────────────────────────────────────────────────

function ImportTab({ projectId }: { projectId: number }) {
  const [csvContent, setCsvContent] = useState("");
  const [isXlsx, setIsXlsx] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [source, setSource] = useState<"csv_import" | "asin_reverse" | "search_suggest">("csv_import");
  const [sourceDetail, setSourceDetail] = useState("");
  const [importResult, setImportResult] = useState<any>(null);
  const utils = trpc.useUtils();

  const importMut = trpc.keyword.importCsv.useMutation({
    onSuccess: (rawData) => {
      const data = rawData as any;
      setImportResult(data);
      const parts = [`新增 ${data.imported} 个关键词`];
      if (data.duplicatesFound > 0) parts.push(`${data.duplicatesFound} 个重复词已合并`);
      if (data.inFileDuplicates > 0) parts.push(`文件内去重 ${data.inFileDuplicates} 个`);
      toast.success(parts.join("，"));
      setCsvContent("");
      setIsXlsx(false);
      setUploadedFileName("");
      setSourceDetail("");
      utils.keyword.list.invalidate();
      utils.keyword.stats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isXlsxFile = file.name.endsWith(".xlsx") || file.name.endsWith(".xls");
    setUploadedFileName(file.name);

    if (isXlsxFile) {
      // Read XLSX as base64
      const reader = new FileReader();
      reader.onload = (ev) => {
        const arrayBuffer = ev.target?.result as ArrayBuffer;
        if (!arrayBuffer) return;
        const bytes = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        setCsvContent(base64);
        setIsXlsx(true);
        toast.success(`已加载XLSX文件: ${file.name}`);
      };
      reader.readAsArrayBuffer(file);
    } else {
      // Read CSV/TXT as text
      const reader = new FileReader();
      reader.onload = (ev) => {
        setCsvContent(ev.target?.result as string || "");
        setIsXlsx(false);
        toast.success(`已加载文件: ${file.name}`);
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Upload className="h-5 w-5" />导入关键词</CardTitle>
          <CardDescription>支持卖家精灵、西柚找词、Helium 10等工具导出的CSV/XLSX文件，自动识别列名映射</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">数据来源</label>
              <Select value={source} onValueChange={(v: any) => setSource(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="csv_import">CSV导入（通用）</SelectItem>
                  <SelectItem value="asin_reverse">ASIN反查</SelectItem>
                  <SelectItem value="search_suggest">搜索建议</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">来源备注（可选）</label>
              <Input placeholder="如: 卖家精灵反查B0XXXXXX" value={sourceDetail} onChange={(e) => setSourceDetail(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">上传文件</label>
            <Input type="file" accept=".csv,.txt,.xlsx,.xls" onChange={handleFileUpload} />
            {uploadedFileName && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="h-4 w-4" />
                <span>{uploadedFileName}</span>
                {isXlsx && <Badge variant="secondary" className="text-xs">XLSX</Badge>}
              </div>
            )}
          </div>

          {!isXlsx && (
            <div className="space-y-2">
              <label className="text-sm font-medium">或直接粘贴CSV内容</label>
              <Textarea placeholder="粘贴CSV内容（含表头行）..." value={csvContent} onChange={(e) => { setCsvContent(e.target.value); setIsXlsx(false); setUploadedFileName(""); }} rows={8} className="font-mono text-xs" />
            </div>
          )}

          <Button onClick={() => { setImportResult(null); importMut.mutate({ projectId, csvContent, source, sourceDetail, isXlsx }); }} disabled={!csvContent.trim() || importMut.isPending}>
            {importMut.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />导入中...</> : <><Upload className="h-4 w-4 mr-2" />开始导入</>}
          </Button>
        </CardContent>
      </Card>

      {/* Import Result with Dedup Summary */}
      {importResult && (
        <Card className="border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/30">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <span className="font-medium">导入完成</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div className="text-center p-2 rounded bg-white dark:bg-gray-900">
                <div className="text-lg font-bold text-blue-600">{importResult.totalParsed || importResult.imported}</div>
                <div className="text-xs text-muted-foreground">解析关键词数</div>
              </div>
              <div className="text-center p-2 rounded bg-white dark:bg-gray-900">
                <div className="text-lg font-bold text-green-600">{importResult.imported}</div>
                <div className="text-xs text-muted-foreground">新增导入</div>
              </div>
              <div className="text-center p-2 rounded bg-white dark:bg-gray-900">
                <div className="text-lg font-bold text-orange-600">{importResult.duplicatesFound || 0}</div>
                <div className="text-xs text-muted-foreground">与库内重复（已合并）</div>
              </div>
              <div className="text-center p-2 rounded bg-white dark:bg-gray-900">
                <div className="text-lg font-bold text-yellow-600">{importResult.inFileDuplicates || 0}</div>
                <div className="text-xs text-muted-foreground">文件内重复（已去重）</div>
              </div>
            </div>
            {(importResult.duplicatesFound > 0 || importResult.inFileDuplicates > 0) && (
              <div className="mt-3 text-xs text-muted-foreground flex items-center gap-1">
                <Copy className="h-3 w-3" />
                重复关键词已自动合并：保留已有数据，补充缺失的搜索量、SPR、竞价等字段
              </div>
            )}
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => setImportResult(null)}>关闭</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>支持的文件格式</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <h4 className="font-medium mb-2">支持的文件类型</h4>
              <div className="mb-3 space-y-1 text-muted-foreground">
                <p><strong>CSV/TXT：</strong>直接解析文本内容，也可粘贴内容导入</p>
                <p><strong>XLSX/XLS：</strong>自动读取第一个工作表，支持Excel格式</p>
              </div>
              <h4 className="font-medium mb-2">自动识别的列名</h4>
              <Table>
                <TableHeader><TableRow><TableHead>字段</TableHead><TableHead>支持的列名</TableHead></TableRow></TableHeader>
                <TableBody>
                  <TableRow><TableCell>关键词</TableCell><TableCell>keyword, 关键词, 搜索词, search term</TableCell></TableRow>
                  <TableRow><TableCell>月搜索量</TableCell><TableCell>search volume, 搜索量, 月搜索量, monthly</TableCell></TableRow>
                  <TableRow><TableCell>SPR</TableCell><TableCell>spr, product rank, 推广难度</TableCell></TableRow>
                  <TableRow><TableCell>PPC竞价</TableCell><TableCell>ppc, bid, 竞价, cpc, 广告费</TableCell></TableRow>
                  <TableRow><TableCell>自然排名</TableCell><TableCell>rank, 排名, 自然排名, organic</TableCell></TableRow>
                  <TableRow><TableCell>相关性</TableCell><TableCell>relevance, 相关, 相关性</TableCell></TableRow>
                </TableBody>
              </Table>
            </div>
            <div>
              <h4 className="font-medium mb-2">自动评估规则</h4>
              <div className="space-y-2 text-muted-foreground">
                <p><strong>流量等级：</strong>月搜索量 ≥10000 → 高 | ≥1000 → 中 | &lt;1000 → 低</p>
                <p><strong>竞争度：</strong>SPR &lt;30 → 低 | &lt;100 → 中 | ≥100 → 高</p>
                <p><strong>相关性：</strong>从文件中"相关性"列自动读取，支持中英文标签</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Pipeline Tab ──────────────────────────────────────────────

function PipelineTab({ projectId }: { projectId: number }) {
  const [pipelineStep, setPipelineStep] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const trafficCompMut = trpc.keywordAi.aiClassifyTrafficCompetition.useMutation({
    onSuccess: (data) => {
      const msg = data.thresholds
        ? `流量/竞争度智能分类完成：${data.classified}个关键词（流量阈值: ≥${data.thresholds.trafficThresholds?.highMin}高/≥${data.thresholds.trafficThresholds?.mediumMin}中，SPR阈值: ≤${data.thresholds.competitionThresholds?.lowMax}低/≤${data.thresholds.competitionThresholds?.mediumMax}中）`
        : `流量/竞争度分类完成：${data.classified}个关键词`;
      toast.success(msg);
      utils.keyword.list.invalidate(); utils.keyword.stats.invalidate(); setPipelineStep(null);
    },
    onError: (err) => { toast.error(err.message); setPipelineStep(null); },
  });
  const filterMut = trpc.keywordAi.aiSemanticFilter.useMutation({
    onSuccess: (data) => { toast.success(`语义过滤完成：保留${data.kept}个，移除${data.removed}个`); utils.keyword.list.invalidate(); utils.keyword.stats.invalidate(); setPipelineStep(null); },
    onError: (err) => { toast.error(err.message); setPipelineStep(null); },
  });
  const tagMut = trpc.keywordAi.aiSceneTag.useMutation({
    onSuccess: (data) => { toast.success(`场景打标完成：${data.tagged}个关键词`); utils.keyword.list.invalidate(); setPipelineStep(null); },
    onError: (err) => { toast.error(err.message); setPipelineStep(null); },
  });
  const classifyMut = trpc.keywordAi.aiRootClassify.useMutation({
    onSuccess: (data) => { toast.success(`词根分类完成：${data.classified}个关键词`); utils.keyword.list.invalidate(); setPipelineStep(null); },
    onError: (err) => { toast.error(err.message); setPipelineStep(null); },
  });
  const matrixMut = trpc.keywordAi.aiStrategyMatrix.useMutation({
    onSuccess: (data) => { toast.success(`策略矩阵完成：${data.categorized}个关键词`); utils.keyword.list.invalidate(); utils.keyword.stats.invalidate(); setPipelineStep(null); },
    onError: (err) => { toast.error(err.message); setPipelineStep(null); },
  });
  const fullPipelineMut = trpc.keywordAi.runFullPipeline.useMutation({
    onSuccess: (data) => {
      toast.success(`全流程完成！流量/竞争度分类${data.trafficCompetition.classified}，过滤保留${data.filter.kept}/移除${data.filter.removed}，场景打标${data.tag.tagged}，词根分类${data.classify.classified}，策略矩阵${data.matrix.categorized}`);
      utils.keyword.list.invalidate(); utils.keyword.stats.invalidate(); setPipelineStep(null);
    },
    onError: (err) => { toast.error(err.message); setPipelineStep(null); },
  });

  const isRunning = trafficCompMut.isPending || filterMut.isPending || tagMut.isPending || classifyMut.isPending || matrixMut.isPending || fullPipelineMut.isPending;

  const steps = [
    { id: "trafficComp", title: "Step 0: 流量/竞争度智能分类", desc: "AI根据整体数据分布自动划分流量等级（月搜索量）和竞争度（SPR）", icon: BarChart3, action: () => { setPipelineStep("trafficComp"); trafficCompMut.mutate({ projectId }); } },
    { id: "filter", title: "Step 1: AI语义过滤", desc: "移除无购买意图、纯泛词、品牌词等无效关键词", icon: Filter, action: () => { setPipelineStep("filter"); filterMut.mutate({ projectId }); } },
    { id: "tag", title: "Step 2: COSMO场景打标", desc: "为每个关键词分配使用场景和购买意图标签", icon: Tag, action: () => { setPipelineStep("tag"); tagMut.mutate({ projectId }); } },
    { id: "classify", title: "Step 3: 词根分类", desc: "将关键词分为7类词根（核心/功能/场景/人群/规格/痛点/节日）", icon: GitBranch, action: () => { setPipelineStep("classify"); classifyMut.mutate({ projectId }); } },
    { id: "matrix", title: "Step 4: 3D策略矩阵", desc: "基于流量×相关性×竞争度三维数据分配策略类别和Listing位置", icon: LayoutGrid, action: () => { setPipelineStep("matrix"); matrixMut.mutate({ projectId }); } },
  ];

  return (
    <div className="space-y-6">
      {/* Full Pipeline */}
      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Zap className="h-5 w-5 text-primary" />一键全流程分析</CardTitle>
          <CardDescription>依次执行：流量/竞争度智能分类 → 语义过滤 → 场景打标 → 词根分类 → 策略矩阵，自动完成所有AI分析步骤</CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="lg" onClick={() => { setPipelineStep("full"); fullPipelineMut.mutate({ projectId }); }} disabled={isRunning}>
            {fullPipelineMut.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />全流程分析中（可能需要数分钟）...</> : <><Play className="h-4 w-4 mr-2" />启动全流程分析</>}
          </Button>
        </CardContent>
      </Card>

      {/* Individual Steps */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {steps.map((step) => (
          <Card key={step.id}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><step.icon className="h-4 w-4" />{step.title}</CardTitle>
              <CardDescription className="text-xs">{step.desc}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button size="sm" variant="outline" onClick={step.action} disabled={isRunning}>
                {pipelineStep === step.id ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />分析中...</> : <><Play className="h-3.5 w-3.5 mr-1" />单独执行</>}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Listing Layout Suggestion */}
      <ListingLayoutCard projectId={projectId} />
    </div>
  );
}

// ─── Listing Layout Suggestion Card ────────────────────────────

function ListingLayoutCard({ projectId }: { projectId: number }) {
  const [layout, setLayout] = useState<any>(null);
  const layoutMut = trpc.keywordAi.aiListingLayout.useMutation({
    onSuccess: (data) => { setLayout(data); toast.success("Listing布局建议已生成"); },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Listing布局建议</CardTitle>
        <CardDescription>基于词根分类和策略矩阵，生成标题公式、五点结构、A+关键词和后台ST建议</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={() => layoutMut.mutate({ projectId })} disabled={layoutMut.isPending}>
          {layoutMut.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />生成中...</> : <><Zap className="h-4 w-4 mr-2" />生成Listing布局建议</>}
        </Button>

        {layout && (
          <div className="space-y-4 mt-4">
            {layout.titleFormula && (
              <div className="space-y-2">
                <h4 className="font-medium">标题公式</h4>
                <div className="bg-muted p-3 rounded-md text-sm">
                  <p className="font-medium">{layout.titleFormula.structure}</p>
                  {layout.titleFormula.example && <p className="mt-2 text-muted-foreground">示例: {layout.titleFormula.example}</p>}
                </div>
              </div>
            )}
            {layout.bulletFormulas && layout.bulletFormulas.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium">五点描述公式</h4>
                {layout.bulletFormulas.map((b: any, i: number) => (
                  <div key={i} className="bg-muted p-3 rounded-md text-sm">
                    <p className="font-medium">Bullet {b.bulletNumber}: {b.structure}</p>
                    {b.example && <p className="mt-1 text-muted-foreground">{b.example}</p>}
                  </div>
                ))}
              </div>
            )}
            {layout.aplusKeywords && layout.aplusKeywords.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium">A+ 场景关键词</h4>
                <div className="flex flex-wrap gap-1.5">{layout.aplusKeywords.map((k: string, i: number) => <Badge key={i} variant="secondary">{k}</Badge>)}</div>
              </div>
            )}
            {layout.searchTermKeywords && layout.searchTermKeywords.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium">后台 Search Term</h4>
                <div className="flex flex-wrap gap-1.5">{layout.searchTermKeywords.map((k: string, i: number) => <Badge key={i} variant="outline">{k}</Badge>)}</div>
              </div>
            )}
            {layout.doNotUse && layout.doNotUse.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium flex items-center gap-1"><AlertTriangle className="h-4 w-4 text-destructive" />绝对不使用</h4>
                <div className="flex flex-wrap gap-1.5">{layout.doNotUse.map((k: string, i: number) => <Badge key={i} variant="destructive">{k}</Badge>)}</div>
              </div>
            )}
            {layout.overallStrategy && (
              <div className="space-y-2">
                <h4 className="font-medium">整体策略总结</h4>
                <p className="text-sm text-muted-foreground">{layout.overallStrategy}</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Matrix Tab ────────────────────────────────────────────────

function MatrixTab({ projectId }: { projectId: number }) {
  const keywordsQuery = trpc.keyword.list.useQuery({ projectId });
  const allKeywords = keywordsQuery.data || [];

  const grouped = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const kw of allKeywords) {
      const cat = (kw as any).strategyCategory || "uncategorized";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(kw);
    }
    return groups;
  }, [allKeywords]);

  const categoryOrder = ["core_main", "sub_core", "precise_longtail", "scene_intent", "longtail_main", "observe_test", "negative", "uncategorized"];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><LayoutGrid className="h-5 w-5" />3D关键词策略矩阵</CardTitle>
          <CardDescription>基于 流量(Traffic) × 相关性(Relevance) × 竞争度(Competition) 三维数据，将关键词分为7个策略类别</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {categoryOrder.filter(c => grouped[c]?.length).map(cat => {
              const info = STRATEGY_LABELS[cat] || { label: "未分类", color: "bg-gray-100 text-gray-600", desc: "" };
              return (
                <Card key={cat} className="overflow-hidden">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between mb-1">
                      <Badge className={info.color}>{info.label}</Badge>
                      <span className="text-lg font-bold">{grouped[cat]?.length || 0}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{info.desc}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Detailed list per category */}
          {categoryOrder.filter(c => grouped[c]?.length).map(cat => {
            const info = STRATEGY_LABELS[cat] || { label: "未分类", color: "bg-gray-100 text-gray-600", desc: "" };
            const kws = grouped[cat] || [];
            return (
              <div key={cat} className="mb-6">
                <h3 className="font-medium mb-2 flex items-center gap-2">
                  <Badge className={info.color}>{info.label}</Badge>
                  <span className="text-sm text-muted-foreground">({kws.length}个关键词)</span>
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {kws.slice(0, 50).map((kw: any) => (
                    <Badge key={kw.id} variant="outline" className="text-xs">
                      {kw.keyword}
                      {kw.monthlySearchVolume ? <span className="ml-1 text-muted-foreground">({kw.monthlySearchVolume.toLocaleString()})</span> : null}
                    </Badge>
                  ))}
                  {kws.length > 50 && <Badge variant="secondary">+{kws.length - 50} more</Badge>}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Roots Tab ─────────────────────────────────────────────────

function RootsTab({ projectId }: { projectId: number }) {
  const keywordsQuery = trpc.keyword.list.useQuery({ projectId });
  const allKeywords = keywordsQuery.data || [];

  const rootGroups = useMemo(() => {
    const groups: Record<string, { rootWord: string; keywords: any[] }[]> = {};
    const rootMap: Record<string, Record<string, any[]>> = {};

    for (const kw of allKeywords) {
      const cat = (kw as any).rootCategory;
      const root = (kw as any).rootWord;
      if (!cat) continue;
      if (!rootMap[cat]) rootMap[cat] = {};
      if (!rootMap[cat][root || "其他"]) rootMap[cat][root || "其他"] = [];
      rootMap[cat][root || "其他"].push(kw);
    }

    for (const [cat, roots] of Object.entries(rootMap)) {
      groups[cat] = Object.entries(roots)
        .map(([rootWord, keywords]) => ({ rootWord, keywords }))
        .sort((a, b) => b.keywords.length - a.keywords.length);
    }
    return groups;
  }, [allKeywords]);

  const rootOrder = ["core", "function", "scene", "audience", "spec", "painpoint", "gift_holiday"];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><GitBranch className="h-5 w-5" />词根分类 & Listing语义地图</CardTitle>
          <CardDescription>将关键词按7类词根分组，展示每个词根下的关键词集合，用于指导Listing内容布局</CardDescription>
        </CardHeader>
        <CardContent>
          {rootOrder.filter(cat => rootGroups[cat]?.length).length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">暂无词根分类数据，请先在"AI分析"中执行词根分类</div>
          ) : (
            <div className="space-y-6">
              {rootOrder.filter(cat => rootGroups[cat]?.length).map(cat => {
                const info = ROOT_LABELS[cat] || { label: cat, icon: "📌" };
                const roots = rootGroups[cat] || [];
                const totalKws = roots.reduce((s, r) => s + r.keywords.length, 0);
                return (
                  <div key={cat}>
                    <h3 className="font-medium mb-3 flex items-center gap-2">
                      <span className="text-lg">{info.icon}</span>
                      <span>{info.label}</span>
                      <Badge variant="secondary">{totalKws}个关键词</Badge>
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {roots.map((root, i) => (
                        <Card key={i} className="overflow-hidden">
                          <CardContent className="p-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-medium text-sm">{root.rootWord}</span>
                              <Badge variant="outline" className="text-xs">{root.keywords.length}</Badge>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {root.keywords.slice(0, 8).map((kw: any) => (
                                <Badge key={kw.id} variant="secondary" className="text-xs">{kw.keyword}</Badge>
                              ))}
                              {root.keywords.length > 8 && <Badge variant="outline" className="text-xs">+{root.keywords.length - 8}</Badge>}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                    <Separator className="mt-4" />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Negative Tab ──────────────────────────────────────────────

function NegativeTab({ projectId }: { projectId: number }) {
  const [newNeg, setNewNeg] = useState("");
  const [newReason, setNewReason] = useState("");
  const [matchType, setMatchType] = useState<"exact" | "phrase" | "broad">("exact");
  const [selectedNegIds, setSelectedNegIds] = useState<Set<number>>(new Set());
  const [reasonFilter, setReasonFilter] = useState<string>("all");
  const [searchNeg, setSearchNeg] = useState("");

  const negQuery = trpc.keyword.negativeList.useQuery({ projectId });
  const addNegMut = trpc.keyword.addNegative.useMutation({
    onSuccess: () => { negQuery.refetch(); setNewNeg(""); setNewReason(""); toast.success("已添加到否词库"); },
  });
  const deleteNegMut = trpc.keyword.deleteNegative.useMutation({
    onSuccess: () => { negQuery.refetch(); toast.success("已删除"); },
  });
  const clearMut = trpc.keyword.clearNegatives.useMutation({
    onSuccess: () => { negQuery.refetch(); toast.success("否词库已清空"); },
  });
  const batchRestoreMut = trpc.keyword.batchRestoreFromNegative.useMutation({
    onSuccess: (data: any) => {
      negQuery.refetch();
      setSelectedNegIds(new Set());
      toast.success(`已移出 ${data.restored} 个关键词并加入分析流程（跳过语义过滤）`);
    },
  });

  const negatives = negQuery.data || [];

  // Extract unique reasons for filter dropdown
  const uniqueReasons = useMemo(() => {
    const reasons = new Set<string>();
    negatives.forEach((neg: any) => {
      if (neg.reasonCn) reasons.add(neg.reasonCn);
      else if (neg.reason) reasons.add(neg.reason);
    });
    return Array.from(reasons).sort();
  }, [negatives]);

  // Filter negatives
  const filteredNeg = useMemo(() => {
    let result = negatives;
    if (reasonFilter !== "all") {
      result = result.filter((neg: any) => (neg.reasonCn || neg.reason) === reasonFilter);
    }
    if (searchNeg) {
      result = result.filter((neg: any) => neg.keyword.toLowerCase().includes(searchNeg.toLowerCase()));
    }
    return result;
  }, [negatives, reasonFilter, searchNeg]);

  const toggleNegSelect = (id: number) => {
    const next = new Set(selectedNegIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedNegIds(next);
  };
  const toggleNegSelectAll = () => {
    if (selectedNegIds.size === filteredNeg.length) setSelectedNegIds(new Set());
    else setSelectedNegIds(new Set(filteredNeg.map((n: any) => n.id)));
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Ban className="h-5 w-5" />否词库管理</CardTitle>
          <CardDescription>管理不应出现在Listing中的关键词。可按否词原因筛选，批量移出否词库后关键词将自动进入分析流程并跳过语义过滤。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add negative keyword */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px] space-y-1">
              <label className="text-xs font-medium">否定关键词</label>
              <Input placeholder="输入否定关键词..." value={newNeg} onChange={(e) => setNewNeg(e.target.value)} />
            </div>
            <div className="w-[140px] space-y-1">
              <label className="text-xs font-medium">匹配类型</label>
              <Select value={matchType} onValueChange={(v: any) => setMatchType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="exact">精确匹配</SelectItem>
                  <SelectItem value="phrase">词组匹配</SelectItem>
                  <SelectItem value="broad">广泛匹配</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px] space-y-1">
              <label className="text-xs font-medium">原因（可选）</label>
              <Input placeholder="为什么是否定词..." value={newReason} onChange={(e) => setNewReason(e.target.value)} />
            </div>
            <Button onClick={() => addNegMut.mutate({ projectId, keyword: newNeg.trim(), matchType, reason: newReason || undefined })} disabled={!newNeg.trim()}>
              <Plus className="h-4 w-4 mr-1" />添加
            </Button>
          </div>

          <Separator />

          {/* Filter and batch actions */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input placeholder="搜索关键词..." value={searchNeg} onChange={(e) => setSearchNeg(e.target.value)} className="w-[200px] h-8" />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={reasonFilter} onValueChange={setReasonFilter}>
                <SelectTrigger className="w-[200px] h-8"><SelectValue placeholder="按否词原因筛选" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部原因</SelectItem>
                  {uniqueReasons.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <span className="text-sm text-muted-foreground">共 {filteredNeg.length} / {negatives.length} 个</span>
            <div className="ml-auto flex items-center gap-2">
              {selectedNegIds.size > 0 && (
                <Button size="sm" variant="outline" onClick={() => batchRestoreMut.mutate({ negativeKeywordIds: Array.from(selectedNegIds), projectId })} disabled={batchRestoreMut.isPending}>
                  {batchRestoreMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Undo2 className="h-3.5 w-3.5 mr-1" />}
                  批量移出否词库 ({selectedNegIds.size})
                </Button>
              )}
              {negatives.length > 0 && (
                <Button size="sm" variant="outline" className="text-destructive" onClick={() => clearMut.mutate({ projectId })}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" />清空否词库
                </Button>
              )}
            </div>
          </div>

          {filteredNeg.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {negatives.length === 0 ? "否词库为空。AI分析过程中会自动添加否定词，您也可以手动添加。" : "当前筛选条件下无否定词"}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"><Checkbox checked={selectedNegIds.size === filteredNeg.length && filteredNeg.length > 0} onCheckedChange={toggleNegSelectAll} /></TableHead>
                  <TableHead>关键词</TableHead>
                  <TableHead>匹配类型</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead>否词原因</TableHead>
                  <TableHead className="w-20">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredNeg.map((neg: any) => (
                  <TableRow key={neg.id}>
                    <TableCell><Checkbox checked={selectedNegIds.has(neg.id)} onCheckedChange={() => toggleNegSelect(neg.id)} /></TableCell>
                    <TableCell className="font-medium">{neg.keyword}</TableCell>
                    <TableCell><Badge variant="outline">{neg.matchType === "exact" ? "精确" : neg.matchType === "phrase" ? "词组" : "广泛"}</Badge></TableCell>
                    <TableCell><Badge variant="secondary" className="text-xs">{neg.source === "manual" ? "手动" : neg.source === "ai_suggest" ? "AI建议" : neg.source === "auto_filter" ? "自动过滤" : "词频分析"}</Badge></TableCell>
                    <TableCell className="text-sm max-w-[250px]">
                      <span className="text-foreground">{neg.reasonCn || "-"}</span>
                      {neg.reason && neg.reasonCn && <span className="text-muted-foreground text-xs ml-1">({neg.reason})</span>}
                      {neg.reason && !neg.reasonCn && <span className="text-muted-foreground">{neg.reason}</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => batchRestoreMut.mutate({ negativeKeywordIds: [neg.id], projectId })} title="移出否词库"><Undo2 className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteNegMut.mutate({ id: neg.id })} title="删除"><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
