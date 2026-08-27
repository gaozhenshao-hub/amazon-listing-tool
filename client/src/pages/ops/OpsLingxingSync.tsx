import { useEffect, useMemo, useState } from "react";
import { Archive, CalendarClock, CalendarRange, DatabaseZap, Eye, FileCheck2, Filter, Loader2, RefreshCw, RotateCcw, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { filterLingxingDraftRows } from "./lingxingSyncViewModel";
import { LingxingDraftStatusFilter } from "./LingxingDraftStatusFilter";
import { getLingxingSyncRule, LINGXING_SYNC_RULES } from "@shared/lingxingSyncRules";

const domains = [
  { value: "product_performance", label: "产品表现", detail: "用于产品总览的ASIN、父ASIN、销量、销售额、订单利润和广告花费预览" },
  { value: "product_performance_daily", label: "ASIN日产品表现（产品总览）", detail: "按子ASIN与报告日读取；完整读取美国站全店范围用于覆盖审计，但仅保留所选时间内有销量、广告或表现数据的商品进入草稿、下载与产品总览" },
  { value: "order_profit", label: "订单利润（产品总览备选）", detail: "产品表现零行时，使用订单利润报表的父ASIN周度销量、销售额、利润和广告花费生成预览" },
  { value: "fba_inventory", label: "FBA库存", detail: "用于子ASIN库存快照；每日17:20全美国店铺读取，校验通过后自动追加库存事实" },
  { value: "ad_campaign", label: "广告活动报表", detail: "仅读取广告活动效果，绝不修改预算、竞价或投放状态" },
  { value: "ad_keyword", label: "广告关键词报表", detail: "每日17:40读取前一天关键词历史事实；校验通过后自动追加，不修改竞价、否词或状态" },
  { value: "listing_master", label: "Listing主数据（只读）", detail: "按店铺分页读取Listing身份与标题字段，仅生成差异审阅草稿，不覆盖人工主数据" },
  { value: "ad_search_term", label: "广告搜索词（只读）", detail: "按广告Profile与报告期读取搜索词事实，过滤聚合行与空身份行，不创建广告操作" },
  { value: "ad_targeting", label: "广告投放目标（只读）", detail: "按广告Profile与报告期读取投放目标事实，过滤空身份行，不修改竞价、预算或状态" },
] as const;

const phase5PreviewDomains = new Set(["listing_master", "ad_search_term", "ad_targeting"]);
const defaultDetailColumns = [
  { key: "asin", label: "ASIN" }, { key: "parentAsin", label: "父ASIN" }, { key: "sku", label: "SKU" },
  { key: "productName", label: "品名" }, { key: "salesQty", label: "销量" }, { key: "fbaAvailable", label: "FBA可售" },
];
const phase5DetailColumns: Record<string, Array<{ key: string; label: string }>> = {
  listing_master: [{ key: "asin", label: "ASIN" }, { key: "parentAsin", label: "父ASIN" }, { key: "sku", label: "SKU" }, { key: "productName", label: "标题" }, { key: "listingStatus", label: "状态" }, { key: "marketplace", label: "站点" }],
  ad_search_term: [{ key: "profileId", label: "Profile" }, { key: "recordId", label: "记录ID" }, { key: "searchTerm", label: "搜索词" }, { key: "sourceTarget", label: "来源投放" }, { key: "campaignId", label: "活动ID" }, { key: "adSpend", label: "花费" }],
  ad_targeting: [{ key: "profileId", label: "Profile" }, { key: "recordId", label: "记录ID" }, { key: "targetingEntity", label: "投放目标" }, { key: "campaignId", label: "活动ID" }, { key: "adGroupId", label: "广告组ID" }, { key: "adSpend", label: "花费" }],
};

type DraftEdit = Record<number, Record<string, unknown>>;

function statusLabel(status: string) {
  const map: Record<string, string> = { draft: "草稿", empty: "该范围无数据", ready_for_review: "待人工确认", confirmed: "已确认，待应用", applied: "已应用", failed: "读取失败", new: "新增", changed: "有更新", unchanged: "无变化", needs_review: "需核对", skipped: "已跳过" };
  return map[status] || status;
}

export default function OpsLingxingSync() {
  const utils = trpc.useUtils();
  const [domain, setDomain] = useState<(typeof domains)[number]["value"]>("product_performance");
  const [storeId, setStoreId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [batchId, setBatchId] = useState<number | null>(null);
  const [edits, setEdits] = useState<DraftEdit>({});
  const [rowStatusFilter, setRowStatusFilter] = useState("all");
  const [historyDomainFilter, setHistoryDomainFilter] = useState("all");
  const [historyStatusFilter, setHistoryStatusFilter] = useState("all");
  const [directoryBootstrapSettled, setDirectoryBootstrapSettled] = useState(false);
  const [reviewQueueBootstrapReady, setReviewQueueBootstrapReady] = useState(false);
  const [scheduleBootstrapReady, setScheduleBootstrapReady] = useState(false);
  const [historyBootstrapReady, setHistoryBootstrapReady] = useState(false);
  const isAdDomain = ["ad_campaign", "ad_keyword", "ad_search_term", "ad_targeting"].includes(domain);
  const storesQuery = trpc.lingxingSync.listStores.useQuery(undefined, { retry: false, staleTime: 5 * 60_000 });
  const adProfilesQuery = trpc.lingxingSync.listAdProfiles.useQuery(undefined, { enabled: isAdDomain, retry: false, staleTime: 5 * 60_000 });
  // 店铺与广告Profile目录会触发官方MCP读取且受QPS=1约束。必须等到目录真实成功或失败后，
  // 再在下一次渲染单独发起纯数据库历史、计划和异常复核查询，避免首屏同批局部429污染其缓存。
  const directoryRequestsFinished = (storesQuery.isSuccess || storesQuery.isError)
    && (!isAdDomain || adProfilesQuery.isSuccess || adProfilesQuery.isError);
  useEffect(() => {
    setDirectoryBootstrapSettled(directoryRequestsFinished);
    if (!directoryRequestsFinished) {
      setReviewQueueBootstrapReady(false);
      setScheduleBootstrapReady(false);
      setHistoryBootstrapReady(false);
    }
  }, [directoryRequestsFinished]);
  // 计划状态来自纯数据库。挂载后的下一事件循环独立发起，既避开首屏与MCP目录的同批请求，
  // 也不因目录暂时超时而隐藏已经启用的自动计划。
  useEffect(() => {
    const timer = window.setTimeout(() => setScheduleBootstrapReady(true), 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (directoryBootstrapSettled) {
      setReviewQueueBootstrapReady(true);
    }
  }, [directoryBootstrapSettled]);
  const historyQuery = trpc.lingxingSync.list.useQuery(
    { limit: 20 },
    { enabled: historyBootstrapReady, retry: false, staleTime: 30_000 },
  );
  const schedulesQuery = trpc.lingxingSync.listSchedules.useQuery(
    undefined,
    { enabled: scheduleBootstrapReady, retry: false, staleTime: 30_000, refetchOnMount: "always" },
  );
  const reviewQueueQuery = trpc.lingxingSync.listBackfillReviewQueue.useQuery(undefined, { enabled: reviewQueueBootstrapReady, retry: false, staleTime: 0, refetchOnMount: "always" });
  const batchQuery = trpc.lingxingSync.get.useQuery({ batchId: batchId || 0 }, { enabled: Boolean(batchId) });
  useEffect(() => {
    if (reviewQueueQuery.isSuccess || reviewQueueQuery.isError) setHistoryBootstrapReady(true);
  }, [reviewQueueQuery.isError, reviewQueueQuery.isSuccess]);

  const previewMutation = trpc.lingxingSync.createPreview.useMutation({
    onSuccess: (result) => {
      setBatchId(result.batchId);
      setEdits({});
      if (result.totalRows === 0) {
        toast.info("该范围没有可同步数据", { description: "已保留空结果审计批次。请更换有数据的店铺、实际业务周期或广告Profile ID后重新读取。" });
      } else {
        toast.success("已生成领星同步预览", { description: `读取 ${result.totalRows} 行；请核对并确认，确认前不会写入业务数据。` });
      }
      void historyQuery.refetch();
    },
    onError: (error) => toast.error("领星读取失败", { description: error.message }),
  });
  const updateMutation = trpc.lingxingSync.updateRows.useMutation();
  const confirmMutation = trpc.lingxingSync.confirm.useMutation({
    onSuccess: () => {
      toast.success("已记录人工确认", { description: "该批次已锁定为待应用状态；当前版本不会自动覆盖任何产品、库存或广告记录。" });
      void batchQuery.refetch();
      void historyQuery.refetch();
    },
    onError: (error) => toast.error("确认失败", { description: error.message }),
  });
  const applyMutation = trpc.lingxingSync.applyConfirmedProductInventory.useMutation({
    onSuccess: (result) => {
      toast.success("已追加至运营数据", { description: `创建新导入批次 #${result.importId}；写入 ${result.importedRows} 行，跳过 ${result.skippedRows} 行。历史上传未被覆盖。` });
      void batchQuery.refetch();
      void historyQuery.refetch();
    },
    onError: (error) => toast.error("应用失败", { description: error.message }),
  });
  const applyAdsMutation = trpc.lingxingSync.applyConfirmedAds.useMutation({
    onSuccess: (result) => {
      toast.success("已追加广告报表数据", { description: `创建广告导入批次 #${result.importId}；写入 ${result.importedRows} 行。系统未修改预算、竞价、投放状态或广告组合。` });
      void batchQuery.refetch();
      void historyQuery.refetch();
    },
    onError: (error) => toast.error("广告报表应用失败", { description: error.message }),
  });
  const scheduleMutation = trpc.lingxingSync.setScheduleEnabled.useMutation({
    onSuccess: (result) => {
      toast.success(result.enabled ? "已更新领星自动计划" : "已暂停领星自动计划", { description: result.autoApply ? "该历史事实将在完整性与异常校验通过后自动追加；异常转入复核队列。" : "计划只生成待审核草稿，不自动写入业务数据。" });
      void schedulesQuery.refetch();
    },
    onError: (error) => toast.error("计划更新失败", { description: error.message }),
  });
  const acknowledgeReviewMutation = trpc.lingxingSync.acknowledgeBackfillReview.useMutation({
    onSuccess: () => {
      toast.success("已记录复核意见", { description: "异常草稿与原始审计证据会保留；该操作不会确认、应用或写入任何业务数据。" });
      void reviewQueueQuery.refetch();
    },
    onError: (error) => toast.error("记录复核意见失败", { description: error.message }),
  });

  const rows = useMemo(() => batchQuery.data?.rows || [], [batchQuery.data?.rows]);
  const visibleRows = useMemo(() => filterLingxingDraftRows(rows, rowStatusFilter), [rows, rowStatusFilter]);
  const chosenDomain = domains.find((item) => item.value === domain)!;
  const selectedRule = getLingxingSyncRule(domain as any);
  const selectedCount = useMemo(() => rows.filter((row: any) => (edits[row.id]?.selected ?? Boolean(row.selected))).length, [edits, rows]);
  const visibleBatches = useMemo(() => (historyQuery.data || []).filter((batch: any) => {
    const domainMatches = historyDomainFilter === "all" || batch.dataDomain === historyDomainFilter;
    const statusMatches = historyStatusFilter === "all" || batch.status === historyStatusFilter;
    return domainMatches && statusMatches;
  }), [historyQuery.data, historyDomainFilter, historyStatusFilter]);
  const activeBatchDomain = batchQuery.data?.batch.dataDomain || domain;
  const activeBatchPreviewOnly = phase5PreviewDomains.has(activeBatchDomain);
  const detailColumns = phase5DetailColumns[activeBatchDomain] || defaultDetailColumns;
  const activeSummary = (batchQuery.data?.batch.summary || {}) as Record<string, unknown>;
  const activeScope = (batchQuery.data?.batch.scope || {}) as Record<string, unknown>;
  const reviewEntries = reviewQueueQuery.data || [];
  const reviewQueueInitializing = !directoryBootstrapSettled || !reviewQueueBootstrapReady || reviewQueueQuery.isPending;
  const activeBatchReviewBlocked = ["product_performance_daily", "fba_inventory", "ad_keyword"].includes(activeBatchDomain) && (
    Boolean(activeSummary.capped)
    || Number(activeSummary.pageTruncations || 0) > 0
    || Boolean(activeSummary.timeoutBeforePreview)
    || Boolean(activeSummary.applyBlocked)
    || (Array.isArray(activeSummary.failedStoreDateWindows) && activeSummary.failedStoreDateWindows.length > 0)
    || (Number(activeSummary.storesExpected || 0) > 0 && Number(activeSummary.storesExpected) !== Number(activeSummary.storesRead || 0))
    || (Number(activeSummary.storeDateWindowsExpected || 0) > 0 && Number(activeSummary.storeDateWindowsExpected) !== Number(activeSummary.storeDateWindowsRead || 0))
  );
  const scheduledDrafts = [
    { dataDomain: "product_performance_daily" as const, title: "每日产品日数据", timing: "每天北京时间 17:00 · 读取前一天", detail: "美国站全店逐日读取；仅在分页完整、身份去重、字段有效且无异常时自动追加日快照", autoApply: true },
    { dataDomain: "fba_inventory" as const, title: "每日FBA库存快照", timing: "每天北京时间 17:20 · 读取当前库存", detail: "美国站店铺错峰读取；仅在全店覆盖、分页完整、身份唯一且指标有效时自动追加库存事实", autoApply: true },
    { dataDomain: "ad_keyword" as const, title: "每日广告关键词历史", timing: "每天北京时间 17:40 · 读取前一天", detail: "美国站广告Profile错峰读取；仅在全Profile覆盖、分页完整、身份唯一且指标有效时自动追加关键词历史事实", autoApply: true },
    { dataDomain: "parent_asin_weekly_rollup" as const, title: "每周父ASIN汇总草稿", timing: "每周一北京时间 17:10 · 汇总上一自然周", detail: "仅汇总已确认日快照，生成父ASIN周度摘要与异常提示，不改写历史周表或人工财务", autoApply: false },
  ];

  const setRow = (id: number, patch: Record<string, unknown>) => setEdits((previous) => ({ ...previous, [id]: { ...previous[id], ...patch } }));
  const field = (row: any, key: string) => String(edits[row.id]?.normalizedData?.[key] ?? row.normalizedData?.[key] ?? "");
  const updateField = (row: any, key: string, nextValue: string) => {
    const current = { ...(row.normalizedData || {}), ...(edits[row.id]?.normalizedData || {}) };
    setRow(row.id, { normalizedData: { ...current, [key]: nextValue } });
  };
  const usAdProfileIds = useMemo(() => (adProfilesQuery.data || [])
    .filter((profile) => ["US", "美国"].includes(String(profile.country || "").toUpperCase()) || /\bUS\b/i.test(String(profile.name || "")))
    .map((profile) => profile.profileId)
    .filter(Boolean)
    .join(","), [adProfilesQuery.data]);
  const selectAdProfile = (nextProfileId: string) => {
    setProfileId(nextProfileId);
    const profile = (adProfilesQuery.data || []).find((item) => item.profileId === nextProfileId);
    if (profile?.sid) setStoreId(profile.sid);
  };
  const runPreview = () => {
    if (!storeId.trim() && !isAdDomain) return toast.error("请选择或填写领星店铺 SID");
    if (isAdDomain && !profileId.trim()) return toast.error("请从官方广告授权店铺中选择 Profile ID");
    if ((domain === "product_performance" || domain === "product_performance_daily" || domain === "order_profit" || isAdDomain) && (!startDate || !endDate)) return toast.error("请选择开始和结束日期");
    previewMutation.mutate({ dataDomain: domain, scope: { storeId: storeId.trim() || "ALL_US_AD_PROFILES", profileId: profileId.trim() || undefined, startDate: startDate || undefined, endDate: endDate || undefined, marketplace: "US" } });
  };
  const saveAndConfirm = async () => {
    if (!batchId || !rows.length) return;
    const patches = rows.map((row: any) => ({ id: row.id, selected: edits[row.id]?.selected ?? Boolean(row.selected), normalizedData: edits[row.id]?.normalizedData || row.normalizedData, rowStatus: edits[row.id]?.rowStatus || row.rowStatus }));
    await updateMutation.mutateAsync({ batchId, rows: patches });
    const selectedRowIds = patches.filter((row) => row.selected).map((row) => row.id);
    confirmMutation.mutate({ batchId, selectedRowIds });
  };
  const applyConfirmed = () => {
    if (!batchId) return;
    if (!window.confirm("确认将已选择的草稿追加到现有运营数据链路吗？这会创建新的领星导入批次；ASIN日产品表现会追加为新日快照，由产品总览优先使用，但不会覆盖历史上传、本地库存或人工货期参数。")) return;
    applyMutation.mutate({ batchId });
  };
  const applyConfirmedAds = () => {
    if (!batchId) return;
    if (!window.confirm("确认将已选择的广告报表草稿追加到广告数据链路吗？此操作只写入历史指标，不会修改广告预算、竞价、投放状态或广告组合。")) return;
    applyAdsMutation.mutate({ batchId });
  };
  const reviewBatch = (entry: any) => {
    setBatchId(entry.batch.id);
    setEdits({});
  };
  const retryReviewDate = (entry: any) => {
    const scope = (entry.batch.scope || {}) as Record<string, unknown>;
    const retryDomain = String(entry.dataDomain || "product_performance_daily") as (typeof domains)[number]["value"];
    const retryLabel = domains.find((item) => item.value === retryDomain)?.label || retryDomain;
    if (!window.confirm(`将重新通过领星官方MCP读取 ${entry.reportDate} 的${retryLabel}数据。旧草稿和审计证据会保留；只有新的读取窗口完整通过校验后，才会进入自动应用或保持异常复核。是否继续？`)) return;
    const retryStoreId = String(scope.storeId || (retryDomain === "ad_keyword" ? "ALL_US_AD_PROFILES" : "ALL_US"));
    const retryProfileId = retryDomain === "ad_keyword" ? String(scope.profileId || "ALL_US_AD_PROFILES") : "";
    setDomain(retryDomain);
    setStoreId(retryStoreId);
    setProfileId(retryProfileId);
    setStartDate(entry.reportDate);
    setEndDate(entry.reportDate);
    previewMutation.mutate({ dataDomain: retryDomain, scope: { storeId: retryStoreId, profileId: retryProfileId || undefined, startDate: entry.reportDate, endDate: entry.reportDate, marketplace: "US" } });
  };
  const acknowledgeReview = (entry: any) => {
    const note = window.prompt(`记录 ${entry.reportDate} 的复核结论（不会确认或写入数据）：`);
    if (!note?.trim()) return;
    acknowledgeReviewMutation.mutate({ batchId: entry.batch.id, note: note.trim() });
  };

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">领星数据同步预览</h1>
        <p className="mt-1 text-muted-foreground">从领星官方 MCP 只读获取运营数据，先预览和人工确认，再进入现有运营数据链路。</p>
      </div>
      <Badge variant="outline" className="w-fit gap-1 border-emerald-300 bg-emerald-50 text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" /> 只读 · QPS=1 · 全程审计</Badge>
    </div>

    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><DatabaseZap className="h-5 w-5 text-primary" />创建同步预览</CardTitle><CardDescription>{chosenDomain.detail}</CardDescription></CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="space-y-2"><Label>数据域</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={domain} onChange={(event) => setDomain(event.target.value as typeof domain)}>{domains.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
        <div className="space-y-2"><Label>领星店铺 SID</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={storeId} onChange={(event) => setStoreId(event.target.value)}><option value="">请选择店铺</option>{["product_performance_daily", "fba_inventory", "listing_master"].includes(domain) && <option value="ALL_US">美国站全部授权店铺（只读预览）</option>}{(storesQuery.data || []).map((store) => <option key={store.sid} value={store.sid}>{store.name} · {store.sid}</option>)}</select><Input value={storeId} onChange={(event) => setStoreId(event.target.value)} placeholder="无店铺列表时可填写 SID" /></div>
        <div className="space-y-2"><Label>广告 Profile ID（广告报表必填）</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={profileId} onChange={(event) => selectAdProfile(event.target.value)} disabled={!isAdDomain || adProfilesQuery.isLoading}><option value="">{isAdDomain ? "请选择官方广告授权店铺" : "广告数据域时选择"}</option>{["ad_keyword", "ad_search_term", "ad_targeting"].includes(domain) && usAdProfileIds ? <option value={domain === "ad_keyword" ? "ALL_US_AD_PROFILES" : usAdProfileIds}>美国站全部广告授权Profile（{usAdProfileIds.split(",").length}家）</option> : null}{(adProfilesQuery.data || []).map((profile) => <option key={profile.profileId} value={profile.profileId}>{profile.name}{profile.country ? ` · ${profile.country}` : ""} · {profile.profileId}</option>)}</select>{isAdDomain && !adProfilesQuery.isLoading && !(adProfilesQuery.data || []).length ? <p className="text-xs text-amber-700">未读取到广告授权Profile；请检查领星广告授权范围。</p> : null}</div>
        <div className="space-y-2"><Label>开始日期</Label><Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div>
        <div className="space-y-2"><Label>结束日期</Label><Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></div>
        <div className="flex items-end"><Button className="w-full" onClick={runPreview} disabled={previewMutation.isPending}>{previewMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}读取并生成预览</Button></div>
      </CardContent>
    </Card>

      <Card className="border-amber-200 bg-amber-50/40"><CardContent className="flex gap-3 pt-6 text-sm text-amber-900"><FileCheck2 className="mt-0.5 h-5 w-5 shrink-0" /><p><b>人工确认与自动应用边界：</b>领星读取先生成独立草稿批次。手动预览仍须由人工逐行确认；已启用的每日产品日数据、FBA库存快照和广告关键词历史计划则会在分页完整、授权范围覆盖、身份去重、字段有效且无异常时自动确认并仅追加对应历史事实。产品总览按父ASIN自然周汇总；库存货期、缓冲、MOQ、成本及广告预算、竞价、否词、状态与结构均不会由自动计划修改。</p></CardContent></Card>
      <Card className="border-emerald-200 bg-emerald-50/40"><CardContent className="flex gap-3 pt-5 text-sm text-emerald-900"><Filter className="mt-0.5 h-5 w-5 shrink-0" /><p><b>统计范围（同步与下载）：</b>系统会完整读取所选店铺和日期窗口，以校验店铺/日期覆盖；但仅将所选时间内有销量、广告或表现数据的商品写入同步草稿、下载结果与产品总览。全零商品保留在受控原始读取审计中，不进入业务日快照。</p></CardContent></Card>

      <Card className="border-amber-300 bg-amber-50/50">
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div><CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="h-5 w-5 text-amber-700" />异常数据复核</CardTitle><CardDescription className="mt-1">按报告日期合并历史异常草稿。可查看截断、超时和失败窗口证据；只能记录复核意见或重新读取完整窗口，不能绕过完整性校验直接写入。</CardDescription></div>
          <Badge variant="outline" className="border-amber-300 bg-background text-amber-800">{reviewQueueInitializing ? "准备复核队列" : `${reviewEntries.length} 个待复核日期`}</Badge>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border border-amber-200 bg-background"><Table><TableHeader><TableRow><TableHead>数据域 / 报告日期</TableHead><TableHead>异常原因</TableHead><TableHead>覆盖 / 截断</TableHead><TableHead>审计批次</TableHead><TableHead className="text-right">人工处理</TableHead></TableRow></TableHeader><TableBody>{reviewEntries.map((entry: any) => {
            const summary = (entry.batch.summary || {}) as Record<string, unknown>;
            const failedWindows = Array.isArray(summary.failedStoreDateWindows) ? summary.failedStoreDateWindows : [];
            const entryDomain = domains.find((item) => item.value === entry.dataDomain);
            return <TableRow key={`${entry.dataDomain || "product_performance_daily"}-${entry.reportDate}`}><TableCell className="font-medium">{entryDomain?.label || entry.dataDomain || "ASIN日产品表现"}<p className="mt-1">{entry.reportDate}</p><p className="mt-1 text-xs text-muted-foreground">已尝试 {entry.attempts} 次</p></TableCell><TableCell><Badge variant="secondary" className="font-normal">{entry.issue.label}</Badge><p className="mt-1 max-w-72 text-xs text-muted-foreground">{entry.issue.detail}</p></TableCell><TableCell className="text-xs text-muted-foreground">范围：{String(summary.storesRead || 0)}/{String(summary.storesExpected || "—")}<br />窗口：{String(summary.storeDateWindowsRead || 0)}/{String(summary.storeDateWindowsExpected || "—")} · 截断 {String(summary.pageTruncations || 0)}{failedWindows.length ? <span className="block text-amber-700">失败窗口 {failedWindows.length}</span> : null}</TableCell><TableCell className="text-xs">#{entry.batch.id}<p className="mt-1 text-muted-foreground">{entry.batch.traceId ? `Trace ${String(entry.batch.traceId).slice(-12)}` : "Trace未记录"}</p></TableCell><TableCell><div className="flex justify-end gap-1.5"><Button variant="outline" size="sm" onClick={() => reviewBatch(entry)}><Eye className="mr-1 h-3.5 w-3.5" />查看</Button><Button variant="outline" size="sm" onClick={() => acknowledgeReview(entry)} disabled={acknowledgeReviewMutation.isPending}><FileCheck2 className="mr-1 h-3.5 w-3.5" />记复核</Button><Button size="sm" onClick={() => retryReviewDate(entry)} disabled={previewMutation.isPending}><RotateCcw className="mr-1 h-3.5 w-3.5" />重新读取</Button></div></TableCell></TableRow>;
          })}{reviewQueueInitializing && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">正在准备店铺目录并读取异常复核队列…</TableCell></TableRow>}{!reviewQueueInitializing && reviewQueueQuery.isError && <TableRow><TableCell colSpan={5} className="py-8 text-center text-destructive">异常复核队列读取失败，请刷新页面后重试；系统未对任何日快照进行写入。</TableCell></TableRow>}{!reviewQueueInitializing && !reviewQueueQuery.isError && !reviewEntries.length && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">当前没有需要人工复核的历史异常日期。</TableCell></TableRow>}</TableBody></Table></div>
          <p className="mt-3 text-xs text-amber-900">“重新读取”仅再次发起领星官方MCP的只读预览；旧批次、原始响应哈希和Trace保持不变。新的草稿仍须通过全店覆盖、无截断、唯一身份、字段有效和异常校验后，才会开放确认入口。</p>
        </CardContent>
      </Card>

      {selectedRule ? <Card className="border-sky-200 bg-sky-50/40"><CardHeader className="pb-2"><CardTitle className="text-base">{selectedRule.label} · 独立联动规则</CardTitle><CardDescription>{selectedRule.grain}；身份键：{selectedRule.identity}</CardDescription></CardHeader><CardContent className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4"><div><p className="text-xs text-muted-foreground">读取字段</p><p className="mt-1">{selectedRule.sourceFields.join("、")}</p></div><div><p className="text-xs text-muted-foreground">写入与下游联动</p><p className="mt-1">{selectedRule.target} → {selectedRule.downstream.join("、")}</p></div><div><p className="text-xs text-muted-foreground">节奏与确认</p><p className="mt-1">{selectedRule.cadence}；{selectedRule.confirmation}</p></div><div><p className="text-xs text-muted-foreground">保护与缺失值</p><p className="mt-1">保护：{selectedRule.protectedFields.join("、")}；{selectedRule.missingValue}</p></div></CardContent></Card> : null}

      <Card className="border-slate-200 bg-slate-50/50"><CardHeader className="pb-2"><CardTitle className="text-base">Phase 5 · 只读预览准备域</CardTitle><CardDescription>Listing、广告搜索词与投放目标已开放独立只读草稿及字段对账，但未开放确认、业务写入或自动计划；避免未验证字段进入现有业务表。</CardDescription></CardHeader><CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{LINGXING_SYNC_RULES.filter((rule) => ["listing_master", "ad_search_term", "ad_targeting", "parent_asin_traffic"].includes(rule.domain)).map((rule) => <div key={rule.domain} className="rounded-md border bg-background p-3 text-sm"><div className="flex items-start justify-between gap-2"><p className="font-medium">{rule.label}</p><Badge variant="outline">只读准备</Badge></div><p className="mt-2 text-xs text-muted-foreground">来源：{rule.source}</p><p className="mt-1 text-xs text-muted-foreground">身份键：{rule.identity}</p><p className="mt-2 text-xs">{rule.confirmation}</p></div>)}</CardContent></Card>

      <Card className="border-violet-200 bg-violet-50/40"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="h-4 w-4" />受治理自动计划</CardTitle><CardDescription>每日产品日表现、FBA库存快照与广告关键词历史事实仅在完整性校验通过后自动追加；每周汇总仅草稿。库存与广告运营配置不会自动写入或修改。</CardDescription></CardHeader><CardContent className="grid gap-3 lg:grid-cols-2">{scheduledDrafts.map((plan) => {
        const schedule = (schedulesQuery.data || []).find((item: any) => item.dataDomain === plan.dataDomain);
        const enabled = Boolean(schedule?.enabled);
        const autoApply = Boolean(schedule?.autoApply ?? plan.autoApply);
        return <div key={plan.dataDomain} className="rounded-lg border bg-background p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{plan.title}</p><p className="mt-1 text-xs text-muted-foreground">{plan.timing}</p></div><Badge variant={enabled ? "default" : "outline"}>{enabled ? "运行中" : "未启用"}</Badge></div><p className="mt-3 text-sm text-muted-foreground">{plan.detail}</p><div className="mt-3 grid gap-1 text-xs text-muted-foreground"><span>写入策略：{autoApply ? "校验通过自动追加历史事实" : "仅生成草稿"}</span><span>最近状态：{schedule?.lastStatus || "尚未运行"}</span><span>最近草稿：{schedule?.lastBatchId ? `#${schedule.lastBatchId}` : "—"}</span>{schedule?.lastError ? <span className="text-amber-700">最近错误：{schedule.lastError}</span> : null}</div><Button className="mt-4 w-full" variant={enabled ? "outline" : "default"} onClick={() => scheduleMutation.mutate({ dataDomain: plan.dataDomain, enabled: !enabled })} disabled={scheduleMutation.isPending}>{scheduleMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{enabled ? "暂停计划" : "启用计划"}</Button></div>;
      })}</CardContent></Card>

    {batchQuery.data && <Card>
      <CardHeader className="flex-row items-start justify-between"><div><CardTitle>同步草稿 #{batchQuery.data.batch.id}</CardTitle><CardDescription>状态：{statusLabel(batchQuery.data.batch.status)} · 已读取 {rows.length} 行 · 已选择 {selectedCount} 行{batchQuery.data.batch.summary?.placeholderRows ? ` · 已过滤占位ASIN ${batchQuery.data.batch.summary.placeholderRows} 行` : ""}{batchQuery.data.batch.summary?.pageTruncations ? ` · 分页上限触发 ${batchQuery.data.batch.summary.pageTruncations} 次` : ""}</CardDescription></div><Button variant="outline" size="sm" onClick={() => void batchQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4" />刷新</Button></CardHeader>
      <CardContent className="space-y-4"><div className="grid gap-3 rounded-lg border bg-muted/20 p-3 text-sm sm:grid-cols-2 xl:grid-cols-4"><div><p className="text-xs text-muted-foreground">读取范围</p><p className="mt-1 font-medium">{String(activeScope.storeId || "未记录")} · {String(activeScope.startDate || "-")} 至 {String(activeScope.endDate || "-")}</p></div><div><p className="text-xs text-muted-foreground">有效草稿 / 已选</p><p className="mt-1 font-medium">{rows.length} / {selectedCount}</p></div><div><p className="text-xs text-muted-foreground">过滤与分页</p><p className="mt-1 font-medium">占位 {String(activeSummary.placeholderRows || 0)} · 聚合/空身份 {String(activeSummary.filteredAggregateOrInvalidRows || 0)} · 截断 {String(activeSummary.pageTruncations || 0)}</p></div><div><p className="text-xs text-muted-foreground">数据影响</p><p className="mt-1 font-medium">{activeBatchPreviewOnly ? "仅字段对账草稿，未开放确认或业务写入" : batchQuery.data.batch.dataDomain === "product_performance_daily" ? "确认后追加日快照并联动产品总览" : "确认后仅追加对应历史事实"}</p></div></div>{activeBatchReviewBlocked ? <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><b>该批次为异常复核草稿，已锁定确认与应用。</b>请查看截断、店铺日期窗口和Trace证据；只能记录复核意见或从上方异常复核列表重新读取完整窗口。</div> : null}{activeBatchPreviewOnly ? <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">此Phase 5批次仅用于人工字段对账。搜索词/投放目标的聚合行、空身份行与`99999999`比率哨兵已被过滤或归一为缺失值；系统不会确认、写入广告事实表、覆盖Listing主数据或修改广告设置。</p> : null}<LingxingDraftStatusFilter value={rowStatusFilter} total={rows.length} onChange={setRowStatusFilter} /><div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>选择</TableHead><TableHead>状态</TableHead><TableHead>差异</TableHead>{detailColumns.map((column) => <TableHead key={column.key}>{column.label}</TableHead>)}</TableRow></TableHeader><TableBody>{visibleRows.map((row: any) => <TableRow key={row.id}><TableCell><input aria-label={`选择草稿行 ${row.id}`} type="checkbox" checked={edits[row.id]?.selected ?? Boolean(row.selected)} onChange={(event) => setRow(row.id, { selected: event.target.checked })} disabled={activeBatchPreviewOnly || activeBatchReviewBlocked} /></TableCell><TableCell><Badge variant={row.rowStatus === "needs_review" ? "secondary" : "outline"}>{statusLabel(edits[row.id]?.rowStatus || row.rowStatus)}</Badge></TableCell><TableCell className="max-w-52 text-xs text-muted-foreground">{row.fieldDiffs?.length ? row.fieldDiffs.map((diff: any) => `${diff.field}: ${diff.before ?? "-"} → ${diff.after ?? "-"}`).join("；") : row.matchInfo?.strategy ? "与现有记录一致" : "新增记录"}{row.validationErrors?.length ? <p className="mt-1 text-amber-700">{row.validationErrors.join("；")}</p> : null}</TableCell>{detailColumns.map((column) => <TableCell key={column.key}><Input className="h-8 min-w-28" value={field(row, column.key)} onChange={(event) => updateField(row, column.key, event.target.value)} disabled={activeBatchPreviewOnly || activeBatchReviewBlocked} /></TableCell>)}</TableRow>)}{!visibleRows.length && <TableRow><TableCell colSpan={3 + detailColumns.length} className="py-8 text-center text-muted-foreground">{rows.length ? "当前筛选条件下没有草稿行。" : "此批次没有可预览的数据行。"}</TableCell></TableRow>}</TableBody></Table></div>{batchQuery.data.batch.summary?.rawResponseExternalized ? <p className="flex items-center gap-1 text-xs text-muted-foreground"><Archive className="h-3.5 w-3.5" />完整领星原始响应已受控归档；当前页面只展示可编辑草稿、差异与审计摘要。</p> : null}<div className="flex flex-wrap justify-end gap-2"><Button onClick={() => void saveAndConfirm()} disabled={activeBatchPreviewOnly || activeBatchReviewBlocked || !rows.length || updateMutation.isPending || confirmMutation.isPending || batchQuery.data.batch.status !== "ready_for_review"}>{(updateMutation.isPending || confirmMutation.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{activeBatchReviewBlocked ? "异常批次不可确认" : activeBatchPreviewOnly ? "仅供字段对账，暂不开放确认" : "确认所选草稿（不写业务表）"}</Button>{["product_performance", "product_performance_daily", "order_profit", "fba_inventory"].includes(batchQuery.data.batch.dataDomain) && <Button variant="secondary" onClick={applyConfirmed} disabled={activeBatchReviewBlocked || applyMutation.isPending || batchQuery.data.batch.status !== "confirmed"}>{applyMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{batchQuery.data.batch.dataDomain === "product_performance_daily" ? "确认后追加日快照并联动产品总览" : "确认后应用至现有运营数据"}</Button>}{["ad_campaign", "ad_keyword"].includes(batchQuery.data.batch.dataDomain) && <Button variant="secondary" onClick={applyConfirmedAds} disabled={applyAdsMutation.isPending || batchQuery.data.batch.status !== "confirmed"}>{applyAdsMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}确认后追加广告报表</Button>}</div></CardContent>
    </Card>}

      <Card><CardHeader><CardTitle>最近同步批次</CardTitle><CardDescription>保留领星读取范围、Tool Run、Artifact与人工确认记录；历史表格导入不受影响。</CardDescription></CardHeader><CardContent className="space-y-3"><div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-2"><Filter className="h-4 w-4 text-muted-foreground" /><select aria-label="按数据域筛选批次" className="h-8 rounded border bg-background px-2 text-sm" value={historyDomainFilter} onChange={(event) => setHistoryDomainFilter(event.target.value)}><option value="all">全部数据域</option>{domains.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><select aria-label="按状态筛选批次" className="h-8 rounded border bg-background px-2 text-sm" value={historyStatusFilter} onChange={(event) => setHistoryStatusFilter(event.target.value)}><option value="all">全部状态</option>{["ready_for_review", "confirmed", "applied", "empty", "failed"].map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select><span className="ml-auto text-xs text-muted-foreground">显示 {visibleBatches.length} / {(historyQuery.data || []).length} 个批次</span></div><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>批次</TableHead><TableHead>数据域</TableHead><TableHead>状态</TableHead><TableHead>读取行数</TableHead><TableHead>范围 / 审计</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{visibleBatches.map((batch: any) => <TableRow key={batch.id}><TableCell>#{batch.id}</TableCell><TableCell>{domains.find((item) => item.value === batch.dataDomain)?.label || batch.dataDomain}</TableCell><TableCell><Badge variant="outline">{statusLabel(batch.status)}</Badge></TableCell><TableCell>{batch.summary?.totalRead ?? "-"}</TableCell><TableCell className="text-xs text-muted-foreground">{batch.scope?.storeId || "-"} · {batch.scope?.startDate || "-"} 至 {batch.scope?.endDate || "-"}{batch.summary?.rawResponseExternalized ? <span className="mt-1 flex items-center gap-1"><Archive className="h-3 w-3" />原始响应已归档</span> : null}</TableCell><TableCell><Button variant="ghost" size="sm" onClick={() => { setBatchId(batch.id); setEdits({}); }}>查看草稿</Button></TableCell></TableRow>)}{!visibleBatches.length && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">当前筛选条件下没有同步批次。</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
  </div>;
}
