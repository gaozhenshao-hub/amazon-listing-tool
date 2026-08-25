import { useMemo, useState } from "react";
import { DatabaseZap, Eye, FileCheck2, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
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

const domains = [
  { value: "product_performance", label: "产品表现", detail: "用于产品总览的ASIN、父ASIN、销量、销售额、订单利润和广告花费预览" },
  { value: "product_performance_daily", label: "ASIN日产品表现（产品总览）", detail: "按子ASIN与报告日读取；支持美国站全店预览、占位ASIN过滤、人工确认后追加日快照，并由产品总览自动按父ASIN自然周汇总" },
  { value: "order_profit", label: "订单利润（产品总览备选）", detail: "产品表现零行时，使用订单利润报表的父ASIN周度销量、销售额、利润和广告花费生成预览" },
  { value: "fba_inventory", label: "FBA库存", detail: "用于子ASIN库存快照的可售、预留和在途库存预览" },
  { value: "ad_campaign", label: "广告活动报表", detail: "仅读取广告活动效果，绝不修改预算、竞价或投放状态" },
  { value: "ad_keyword", label: "广告关键词报表", detail: "仅读取关键词效果，供广告看板与后续人工分析使用" },
] as const;

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
  const storesQuery = trpc.lingxingSync.listStores.useQuery(undefined, { retry: false, staleTime: 5 * 60_000 });
  const adProfilesQuery = trpc.lingxingSync.listAdProfiles.useQuery(undefined, { retry: false, staleTime: 5 * 60_000 });
  const historyQuery = trpc.lingxingSync.list.useQuery({ limit: 20 });
  const batchQuery = trpc.lingxingSync.get.useQuery({ batchId: batchId || 0 }, { enabled: Boolean(batchId) });

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

  const rows = useMemo(() => batchQuery.data?.rows || [], [batchQuery.data?.rows]);
  const visibleRows = useMemo(() => filterLingxingDraftRows(rows, rowStatusFilter), [rows, rowStatusFilter]);
  const chosenDomain = domains.find((item) => item.value === domain)!;
  const selectedCount = useMemo(() => rows.filter((row: any) => (edits[row.id]?.selected ?? Boolean(row.selected))).length, [edits, rows]);

  const setRow = (id: number, patch: Record<string, unknown>) => setEdits((previous) => ({ ...previous, [id]: { ...previous[id], ...patch } }));
  const field = (row: any, key: string) => String(edits[row.id]?.normalizedData?.[key] ?? row.normalizedData?.[key] ?? "");
  const updateField = (row: any, key: string, nextValue: string) => {
    const current = { ...(row.normalizedData || {}), ...(edits[row.id]?.normalizedData || {}) };
    setRow(row.id, { normalizedData: { ...current, [key]: nextValue } });
  };
  const isAdDomain = domain === "ad_campaign" || domain === "ad_keyword";
  const selectAdProfile = (nextProfileId: string) => {
    setProfileId(nextProfileId);
    const profile = (adProfilesQuery.data || []).find((item) => item.profileId === nextProfileId);
    if (profile?.sid) setStoreId(profile.sid);
  };
  const runPreview = () => {
    if (!storeId.trim()) return toast.error("请选择或填写领星店铺 SID");
    if (isAdDomain && !profileId.trim()) return toast.error("请从官方广告授权店铺中选择 Profile ID");
    if ((domain === "product_performance" || domain === "product_performance_daily" || domain === "order_profit" || isAdDomain) && (!startDate || !endDate)) return toast.error("请选择开始和结束日期");
    previewMutation.mutate({ dataDomain: domain, scope: { storeId: storeId.trim(), profileId: profileId.trim() || undefined, startDate: startDate || undefined, endDate: endDate || undefined } });
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
        <div className="space-y-2"><Label>领星店铺 SID</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={storeId} onChange={(event) => setStoreId(event.target.value)}><option value="">请选择店铺</option>{domain === "product_performance_daily" && <option value="ALL_US">美国站全部授权店铺（逐店逐日预览）</option>}{(storesQuery.data || []).map((store) => <option key={store.sid} value={store.sid}>{store.name} · {store.sid}</option>)}</select><Input value={storeId} onChange={(event) => setStoreId(event.target.value)} placeholder="无店铺列表时可填写 SID" /></div>
        <div className="space-y-2"><Label>广告 Profile ID（广告报表必填）</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={profileId} onChange={(event) => selectAdProfile(event.target.value)} disabled={!isAdDomain || adProfilesQuery.isLoading}><option value="">{isAdDomain ? "请选择官方广告授权店铺" : "广告数据域时选择"}</option>{(adProfilesQuery.data || []).map((profile) => <option key={profile.profileId} value={profile.profileId}>{profile.name}{profile.country ? ` · ${profile.country}` : ""} · {profile.profileId}</option>)}</select>{isAdDomain && !adProfilesQuery.isLoading && !(adProfilesQuery.data || []).length ? <p className="text-xs text-amber-700">未读取到广告授权Profile；请检查领星广告授权范围。</p> : null}</div>
        <div className="space-y-2"><Label>开始日期</Label><Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div>
        <div className="space-y-2"><Label>结束日期</Label><Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></div>
        <div className="flex items-end"><Button className="w-full" onClick={runPreview} disabled={previewMutation.isPending}>{previewMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}读取并生成预览</Button></div>
      </CardContent>
    </Card>

      <Card className="border-amber-200 bg-amber-50/40"><CardContent className="flex gap-3 pt-6 text-sm text-amber-900"><FileCheck2 className="mt-0.5 h-5 w-5 shrink-0" /><p><b>人工确认边界：</b>领星读取只生成独立草稿批次。ASIN日产品表现会过滤`asin="-"`占位行，并显示销售、Session、广告、自然订单和库存字段；只有人工逐行确认后才会追加日快照，由产品总览按父ASIN自然周汇总。确认前不会写入产品总览、库存规划、月度采购或广告业务表，更不会修改广告投放设置。</p></CardContent></Card>

    {batchQuery.data && <Card>
      <CardHeader className="flex-row items-start justify-between"><div><CardTitle>同步草稿 #{batchQuery.data.batch.id}</CardTitle><CardDescription>状态：{statusLabel(batchQuery.data.batch.status)} · 已读取 {rows.length} 行 · 已选择 {selectedCount} 行{batchQuery.data.batch.summary?.placeholderRows ? ` · 已过滤占位ASIN ${batchQuery.data.batch.summary.placeholderRows} 行` : ""}{batchQuery.data.batch.summary?.pageTruncations ? ` · 分页上限触发 ${batchQuery.data.batch.summary.pageTruncations} 次` : ""}</CardDescription></div><Button variant="outline" size="sm" onClick={() => void batchQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4" />刷新</Button></CardHeader>
      <CardContent className="space-y-4"><LingxingDraftStatusFilter value={rowStatusFilter} total={rows.length} onChange={setRowStatusFilter} /><div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>选择</TableHead><TableHead>状态</TableHead><TableHead>差异</TableHead><TableHead>ASIN</TableHead><TableHead>父ASIN</TableHead><TableHead>SKU</TableHead><TableHead>品名</TableHead><TableHead>销量</TableHead><TableHead>FBA可售</TableHead></TableRow></TableHeader><TableBody>{visibleRows.map((row: any) => <TableRow key={row.id}><TableCell><input aria-label={`选择草稿行 ${row.id}`} type="checkbox" checked={edits[row.id]?.selected ?? Boolean(row.selected)} onChange={(event) => setRow(row.id, { selected: event.target.checked })} /></TableCell><TableCell><Badge variant={row.rowStatus === "needs_review" ? "secondary" : "outline"}>{statusLabel(edits[row.id]?.rowStatus || row.rowStatus)}</Badge></TableCell><TableCell className="max-w-52 text-xs text-muted-foreground">{row.fieldDiffs?.length ? row.fieldDiffs.map((diff: any) => `${diff.field}: ${diff.before ?? "-"} → ${diff.after ?? "-"}`).join("；") : row.matchInfo?.strategy ? "与现有记录一致" : "新增记录"}{row.validationErrors?.length ? <p className="mt-1 text-amber-700">{row.validationErrors.join("；")}</p> : null}</TableCell>{["asin", "parentAsin", "sku", "productName", "salesQty", "fbaAvailable"].map((key) => <TableCell key={key}><Input className="h-8 min-w-28" value={field(row, key)} onChange={(event) => updateField(row, key, event.target.value)} /></TableCell>)}</TableRow>)}{!visibleRows.length && <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">{rows.length ? "当前筛选条件下没有草稿行。" : "此批次没有可预览的数据行。"}</TableCell></TableRow>}</TableBody></Table></div>{batchQuery.data.batch.summary?.rawResponseExternalized ? <p className="text-xs text-muted-foreground">完整领星原始响应已受控归档；当前页面只展示可编辑草稿、差异与审计摘要。</p> : null}<div className="flex flex-wrap justify-end gap-2"><Button onClick={() => void saveAndConfirm()} disabled={!rows.length || updateMutation.isPending || confirmMutation.isPending || batchQuery.data.batch.status !== "ready_for_review"}>{(updateMutation.isPending || confirmMutation.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}确认所选草稿（不写业务表）</Button>{["product_performance", "product_performance_daily", "order_profit", "fba_inventory"].includes(batchQuery.data.batch.dataDomain) && <Button variant="secondary" onClick={applyConfirmed} disabled={applyMutation.isPending || batchQuery.data.batch.status !== "confirmed"}>{applyMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{batchQuery.data.batch.dataDomain === "product_performance_daily" ? "确认后追加日快照并联动产品总览" : "确认后应用至现有运营数据"}</Button>}{["ad_campaign", "ad_keyword"].includes(batchQuery.data.batch.dataDomain) && <Button variant="secondary" onClick={applyConfirmedAds} disabled={applyAdsMutation.isPending || batchQuery.data.batch.status !== "confirmed"}>{applyAdsMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}确认后追加广告报表</Button>}</div></CardContent>
    </Card>}

      <Card><CardHeader><CardTitle>最近同步批次</CardTitle><CardDescription>保留领星读取范围、Tool Run与人工确认记录；历史表格导入不受影响。</CardDescription></CardHeader><CardContent><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>批次</TableHead><TableHead>数据域</TableHead><TableHead>状态</TableHead><TableHead>读取行数</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{(historyQuery.data || []).map((batch: any) => <TableRow key={batch.id}><TableCell>#{batch.id}</TableCell><TableCell>{domains.find((item) => item.value === batch.dataDomain)?.label || batch.dataDomain}</TableCell><TableCell><Badge variant="outline">{statusLabel(batch.status)}</Badge></TableCell><TableCell>{batch.summary?.totalRead ?? "-"}</TableCell><TableCell><Button variant="ghost" size="sm" onClick={() => { setBatchId(batch.id); setEdits({}); }}>查看草稿</Button></TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>
  </div>;
}
