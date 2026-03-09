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
  ChevronUp, ArrowUpDown, Loader2, X, AlertTriangle
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
};

const ROOT_LABELS: Record<string, { label: string; icon: string }> = {
  core: { label: "核心词根", icon: "🎯" },
  function: { label: "功能词根", icon: "⚙️" },
  scene: { label: "场景词根", icon: "🌍" },
  audience: { label: "人群词根", icon: "👥" },
  spec: { label: "规格词根", icon: "📏" },
  painpoint: { label: "痛点词根", icon: "💡" },
  gift_holiday: { label: "节日/礼品词根", icon: "🎁" },
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

  const [newKw, setNewKw] = useState("");

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
            <Button size="sm" variant="destructive" onClick={() => bulkDeleteMut.mutate({ ids: Array.from(selectedIds) })}><Trash2 className="h-4 w-4 mr-1" />删除({selectedIds.size})</Button>
          </>
        )}
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={allKeywords.length === 0}>
          <Download className="h-4 w-4 mr-1" />导出CSV{filtered.length !== allKeywords.length && filtered.length > 0 ? ` (${filtered.length})` : ""}
        </Button>
      </div>

      {/* Keyword Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"><Checkbox checked={selectedIds.size === filtered.length && filtered.length > 0} onCheckedChange={toggleSelectAll} /></TableHead>
                  <TableHead className="cursor-pointer" onClick={() => toggleSort("keyword")}>关键词 <ArrowUpDown className="inline h-3 w-3" /></TableHead>
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
                  <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">暂无关键词数据，请先导入CSV/XLSX或手动添加</TableCell></TableRow>
                ) : filtered.slice(0, 200).map((kw: any) => (
                  <TableRow key={kw.id} className={kw.isNegative ? "opacity-50" : ""}>
                    <TableCell><Checkbox checked={selectedIds.has(kw.id)} onCheckedChange={() => toggleSelect(kw.id)} /></TableCell>
                    <TableCell className="font-medium max-w-[200px] truncate">{kw.keyword}</TableCell>
                    <TableCell>{kw.monthlySearchVolume?.toLocaleString() || "-"}</TableCell>
                    <TableCell><Badge variant="secondary" className={RELEVANCE_COLORS[kw.relevance] || ""}>{kw.relevance === "high" ? "高" : kw.relevance === "medium" ? "中" : kw.relevance === "low" ? "低" : "无"}</Badge></TableCell>
                    <TableCell><Badge variant="secondary" className={TRAFFIC_COLORS[kw.trafficLevel] || ""}>{kw.trafficLevel === "high" ? "高" : kw.trafficLevel === "medium" ? "中" : "低"}</Badge></TableCell>
                    <TableCell><Badge variant="secondary">{kw.competition === "high" ? "高" : kw.competition === "medium" ? "中" : "低"}</Badge></TableCell>
                    <TableCell>{kw.strategyCategory ? <Badge className={STRATEGY_LABELS[kw.strategyCategory]?.color || ""}>{STRATEGY_LABELS[kw.strategyCategory]?.label || kw.strategyCategory}</Badge> : <span className="text-muted-foreground text-xs">-</span>}</TableCell>
                    <TableCell>{kw.rootCategory ? <span className="text-xs">{ROOT_LABELS[kw.rootCategory]?.icon} {ROOT_LABELS[kw.rootCategory]?.label}</span> : <span className="text-muted-foreground text-xs">-</span>}</TableCell>
                    <TableCell>{kw.listingPlacement ? <Badge variant="outline" className="text-xs">{PLACEMENT_LABELS[kw.listingPlacement] || kw.listingPlacement}</Badge> : <span className="text-muted-foreground text-xs">-</span>}</TableCell>
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
  const utils = trpc.useUtils();

  const importMut = trpc.keyword.importCsv.useMutation({
    onSuccess: (data) => {
      toast.success(`成功导入 ${data.imported} 个关键词`);
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

          <Button onClick={() => importMut.mutate({ projectId, csvContent, source, sourceDetail, isXlsx })} disabled={!csvContent.trim() || importMut.isPending}>
            {importMut.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />导入中...</> : <><Upload className="h-4 w-4 mr-2" />开始导入</>}
          </Button>
        </CardContent>
      </Card>

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

  const filterMut = trpc.keyword.aiSemanticFilter.useMutation({
    onSuccess: (data) => { toast.success(`语义过滤完成：保留${data.kept}个，移除${data.removed}个`); utils.keyword.list.invalidate(); utils.keyword.stats.invalidate(); setPipelineStep(null); },
    onError: (err) => { toast.error(err.message); setPipelineStep(null); },
  });
  const tagMut = trpc.keyword.aiSceneTag.useMutation({
    onSuccess: (data) => { toast.success(`场景打标完成：${data.tagged}个关键词`); utils.keyword.list.invalidate(); setPipelineStep(null); },
    onError: (err) => { toast.error(err.message); setPipelineStep(null); },
  });
  const classifyMut = trpc.keyword.aiRootClassify.useMutation({
    onSuccess: (data) => { toast.success(`词根分类完成：${data.classified}个关键词`); utils.keyword.list.invalidate(); setPipelineStep(null); },
    onError: (err) => { toast.error(err.message); setPipelineStep(null); },
  });
  const matrixMut = trpc.keyword.aiStrategyMatrix.useMutation({
    onSuccess: (data) => { toast.success(`策略矩阵完成：${data.categorized}个关键词`); utils.keyword.list.invalidate(); utils.keyword.stats.invalidate(); setPipelineStep(null); },
    onError: (err) => { toast.error(err.message); setPipelineStep(null); },
  });
  const fullPipelineMut = trpc.keyword.runFullPipeline.useMutation({
    onSuccess: (data) => {
      toast.success(`全流程完成！过滤保留${data.filter.kept}/移除${data.filter.removed}，场景打标${data.tag.tagged}，词根分类${data.classify.classified}，策略矩阵${data.matrix.categorized}`);
      utils.keyword.list.invalidate(); utils.keyword.stats.invalidate(); setPipelineStep(null);
    },
    onError: (err) => { toast.error(err.message); setPipelineStep(null); },
  });

  const isRunning = filterMut.isPending || tagMut.isPending || classifyMut.isPending || matrixMut.isPending || fullPipelineMut.isPending;

  const steps = [
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
          <CardDescription>依次执行：语义过滤 → 场景打标 → 词根分类 → 策略矩阵，自动完成所有AI分析步骤</CardDescription>
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
  const layoutMut = trpc.keyword.aiListingLayout.useMutation({
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

  const negatives = negQuery.data || [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Ban className="h-5 w-5" />否词库管理</CardTitle>
          <CardDescription>管理不应出现在Listing中的关键词，支持精确匹配、词组匹配和广泛匹配三种模式</CardDescription>
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

          {/* Negative keywords list */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">共 {negatives.length} 个否定关键词</span>
            {negatives.length > 0 && (
              <Button size="sm" variant="outline" className="text-destructive" onClick={() => clearMut.mutate({ projectId })}>
                <Trash2 className="h-3.5 w-3.5 mr-1" />清空否词库
              </Button>
            )}
          </div>

          {negatives.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">否词库为空。AI分析过程中会自动添加否定词，您也可以手动添加。</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>关键词</TableHead>
                  <TableHead>匹配类型</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead>原因</TableHead>
                  <TableHead className="w-16">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {negatives.map((neg: any) => (
                  <TableRow key={neg.id}>
                    <TableCell className="font-medium">{neg.keyword}</TableCell>
                    <TableCell><Badge variant="outline">{neg.matchType === "exact" ? "精确" : neg.matchType === "phrase" ? "词组" : "广泛"}</Badge></TableCell>
                    <TableCell><Badge variant="secondary" className="text-xs">{neg.source === "manual" ? "手动" : neg.source === "ai_suggest" ? "AI建议" : neg.source === "auto_filter" ? "自动过滤" : "词频分析"}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{neg.reason || "-"}</TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteNegMut.mutate({ id: neg.id })}><Trash2 className="h-3.5 w-3.5" /></Button>
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
