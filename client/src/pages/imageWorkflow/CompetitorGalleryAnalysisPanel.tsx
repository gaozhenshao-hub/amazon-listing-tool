import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, Check, Crown, EyeOff, ImageIcon, Layers3, Loader2, Plus, RefreshCw, Save, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type FactDraft = {
  imagePurpose: string;
  sellingPointsText: string;
  expressionMethod: string;
  copyStrategy: string;
  strengthsText: string;
  risksText: string;
};

const DEFAULT_ANALYSIS_ROLES = new Set(["main", "secondary", "aplus"]);

export function defaultGalleryAnalysisAssetIds(assets: Array<{ id: number; role: string }>) {
  return assets.filter((asset) => DEFAULT_ANALYSIS_ROLES.has(asset.role)).map((asset) => asset.id);
}

export function stableAssetIds(value: unknown) {
  return Array.from(new Set(Array.isArray(value) ? value.map(Number).filter((id) => Number.isInteger(id) && id > 0) : [])).sort((left, right) => left - right);
}

export function sameAssetIds(left: number[], right: number[]) {
  const normalizedLeft = stableAssetIds(left);
  const normalizedRight = stableAssetIds(right);
  return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((id, index) => id === normalizedRight[index]);
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function listText(value: unknown) {
  return Array.isArray(value) ? value.map(String).join("\n") : "";
}

function roleLabel(role: string) {
  if (role === "primary") return "主要竞争对手";
  if (role === "supplemental") return "补充样本";
  return "对标竞品";
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    ready: "待分析", analyzing: "分析中", review_required: "待审核", confirmed: "已确认", draft: "草稿",
  };
  return labels[status] || status;
}

export function CompetitorGalleryAnalysisPanel({ projectId, canEdit }: { projectId: number; canEdit: boolean }) {
  const utils = trpc.useUtils();
  const subjectsQuery = trpc.imageWorkflow.listCompetitorGallerySubjects.useQuery(
    { projectId },
    { refetchInterval: 4_000 },
  );
  const snapshotQuery = trpc.imageWorkflow.listCompetitorSnapshotOptions.useQuery();
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(null);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState("");
  const [asinInput, setAsinInput] = useState("");
  const [factDrafts, setFactDrafts] = useState<Record<number, FactDraft>>({});
  const [overallConclusion, setOverallConclusion] = useState("");
  const [narrativeStrategy, setNarrativeStrategy] = useState("");
  const [selectedAssetIds, setSelectedAssetIds] = useState<number[]>([]);

  const subjects = useMemo(() => subjectsQuery.data || [], [subjectsQuery.data]);
  useEffect(() => {
    if (!selectedSubjectId && subjects[0]?.id) setSelectedSubjectId(subjects[0].id);
  }, [selectedSubjectId, subjects]);
  const selected = useMemo(() => subjects.find((subject: any) => subject.id === selectedSubjectId) || null, [subjects, selectedSubjectId]);
  const selectionSourceKey = useMemo(() => {
    if (!selected) return "";
    const source = selected.selection || selected.analysisScope;
    const selectedIds = source?.selectedAssetIds || defaultGalleryAnalysisAssetIds(selected.assets || []);
    return `${selected.id}:${source?.id || source?.selectionVersionId || "default"}:${stableAssetIds(selectedIds).join(",")}`;
  }, [selected]);

  useEffect(() => {
    if (!selected) {
      setSelectedAssetIds([]);
      return;
    }
    const source = selected.selection || selected.analysisScope;
    setSelectedAssetIds(stableAssetIds(source?.selectedAssetIds || defaultGalleryAnalysisAssetIds(selected.assets || [])));
  }, [selectionSourceKey, selected]);

  useEffect(() => {
    if (!selected) return;
    const drafts: Record<number, FactDraft> = {};
    for (const asset of selected.assets || []) {
      const fact = objectValue(asset.fact?.userEdit || asset.fact?.aiFacts);
      drafts[asset.id] = {
        imagePurpose: String(fact.imagePurpose || ""),
        sellingPointsText: listText(fact.sellingPoints),
        expressionMethod: String(fact.expressionMethod || ""),
        copyStrategy: String(fact.copyStrategy || ""),
        strengthsText: listText(fact.strengths),
        risksText: listText(fact.risks),
      };
    }
    setFactDrafts(drafts);
    const analysis = objectValue(selected.analysis?.userEdit || selected.analysis?.analysis);
    setOverallConclusion(String(analysis.overallConclusion || ""));
    setNarrativeStrategy(String(analysis.narrativeStrategy || ""));
  }, [selected]);

  const latestJobQuery = trpc.imageWorkflow.latestCompetitorGalleryJob.useQuery(
    { projectId, subjectId: selectedSubjectId || 0 },
    { enabled: Boolean(selectedSubjectId), refetchInterval: 3_000 },
  );
  const createAcquisitionJob = trpc.acquisition.createJob.useMutation();
  const addSubject = trpc.imageWorkflow.addCompetitorResearchSubject.useMutation();
  const setPrimary = trpc.imageWorkflow.setPrimaryCompetitorSubject.useMutation();
  const archiveSubject = trpc.imageWorkflow.archiveCompetitorResearchSubject.useMutation();
  const startAnalysis = trpc.imageWorkflow.startCompetitorGalleryAnalysis.useMutation();
  const saveFact = trpc.imageWorkflow.saveCompetitorImageFact.useMutation();
  const saveAnalysis = trpc.imageWorkflow.saveCompetitorGalleryAnalysis.useMutation();
  const confirmAnalysis = trpc.imageWorkflow.confirmCompetitorGalleryAnalysis.useMutation();
  const saveScope = trpc.imageWorkflow.saveCompetitorGallerySelection.useMutation();
  const confirmScope = trpc.imageWorkflow.confirmCompetitorGallerySelection.useMutation();

  const refresh = async () => {
    await Promise.all([
      utils.imageWorkflow.listCompetitorGallerySubjects.invalidate({ projectId }),
      utils.imageWorkflow.listCompetitorSnapshotOptions.invalidate(),
    ]);
  };

  const handleCreateAcquisition = async () => {
    const asin = asinInput.trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) return toast.error("请输入10位美国站ASIN");
    try {
      const result = await createAcquisitionJob.mutateAsync({
        consumerType: "image_workflow",
        consumerRef: `project:${projectId}:competitor-gallery`,
        marketplace: "US",
        asin,
        capabilities: ["catalog_basic", "image_gallery", "aplus", "brand_story"],
        cachePolicy: "prefer_cache",
        maxChargeUsd: 0.1,
      });
      setAsinInput("");
      toast.success(result.cacheHitSnapshotId ? "已复用确认快照并直接录入本项目竞品图库" : `采集任务 #${result.jobId} 已创建；主图、副图、A+与品牌故事安全保存后将直接录入，缺失图片会明确提示`);
      await refresh();
    } catch (error: any) {
      toast.error(error.message || "采集任务创建失败");
    }
  };

  const handleAddSubject = async () => {
    const snapshotId = Number(selectedSnapshotId);
    if (!snapshotId) return toast.error("请选择已确认的采集快照");
    try {
      const result = await addSubject.mutateAsync({
        projectId,
        confirmedSnapshotId: snapshotId,
        role: subjects.some((subject: any) => subject.role === "primary") ? "benchmark" : "primary",
      });
      setSelectedSnapshotId("");
      setSelectedSubjectId(result.id);
      await refresh();
      toast.success("竞品整套图库已关联");
    } catch (error: any) {
      toast.error(error.message || "关联失败");
    }
  };

  const selection = selected?.selection || null;
  const scopeDirty = Boolean(selected) && (!selection || !sameAssetIds(selectedAssetIds, selection.selectedAssetIds || []));
  const scopeReadyForAnalysis = Boolean(selection?.status === "confirmed" && !scopeDirty);
  const selectedAssetIdSet = useMemo(() => new Set(selectedAssetIds), [selectedAssetIds]);
  const scopeRoleCounts = useMemo(() => {
    const counts: Record<string, number> = { main: 0, secondary: 0, aplus: 0, brand_story: 0 };
    for (const asset of selected?.assets || []) if (selectedAssetIdSet.has(asset.id) && asset.role in counts) counts[asset.role] += 1;
    return counts;
  }, [selected?.assets, selectedAssetIdSet]);

  const toggleAsset = (assetId: number, checked: boolean) => {
    setSelectedAssetIds((previous) => stableAssetIds(checked ? [...previous, assetId] : previous.filter((id) => id !== assetId)));
  };

  const selectByRoles = (roles: string[]) => {
    if (!selected) return;
    setSelectedAssetIds(stableAssetIds(selected.assets.filter((asset: any) => roles.includes(asset.role)).map((asset: any) => asset.id)));
  };

  const saveCurrentScope = async () => {
    if (!selected) throw new Error("请先选择竞品图库");
    if (!selectedAssetIds.length) throw new Error("请至少选择一张图片进入分析范围");
    const result = await saveScope.mutateAsync({
      projectId,
      subjectId: selected.id,
      selectedAssetIds,
      filters: { includedRoles: Object.entries(scopeRoleCounts).filter(([, count]) => count > 0).map(([role]) => role as "main" | "secondary" | "aplus" | "brand_story") },
    });
    await refresh();
    return result;
  };

  const handleSaveScope = async () => {
    try {
      const result = await saveCurrentScope();
      toast.success(result.status === "confirmed" ? "当前分析范围已确认" : "分析范围草稿已保存；确认后才会进入AI分析");
    } catch (error: any) { toast.error(error.message || "保存分析范围失败"); }
  };

  const handleConfirmScope = async () => {
    try {
      const result = !scopeDirty && selection ? selection : await saveCurrentScope();
      if (result.status !== "confirmed") {
        await confirmScope.mutateAsync({ projectId, subjectId: selected.id, selectionVersionId: result.id });
      }
      await refresh();
      toast.success("分析范围已确认：范围外图片仍安全保留，但不会传入AI或下游表达分析");
    } catch (error: any) { toast.error(error.message || "确认分析范围失败"); }
  };

  const handleAnalyze = async () => {
    if (!selected) return;
    if (!scopeReadyForAnalysis || !selection) return toast.error("请先保存并确认当前图片分析范围");
    try {
      await startAnalysis.mutateAsync({ projectId, subjectId: selected.id, selectionVersionId: selection.id });
      await latestJobQuery.refetch();
      toast.success("竞品全图分析已进入后台任务");
    } catch (error: any) {
      toast.error(error.message || "分析任务创建失败");
    }
  };

  const updateFactDraft = (assetId: number, patch: Partial<FactDraft>) => {
    setFactDrafts((previous) => ({ ...previous, [assetId]: { ...(previous[assetId] || {} as FactDraft), ...patch } }));
  };

  const handleSaveFact = async (asset: any) => {
    if (!asset.fact) return;
    const original = objectValue(asset.fact.userEdit || asset.fact.aiFacts);
    const draft = factDrafts[asset.id];
    try {
      await saveFact.mutateAsync({
        projectId,
        subjectId: selected.id,
        factId: asset.fact.id,
        fact: {
          ...original,
          imagePurpose: draft.imagePurpose,
          sellingPoints: draft.sellingPointsText.split("\n").map((item) => item.trim()).filter(Boolean),
          expressionMethod: draft.expressionMethod,
          copyStrategy: draft.copyStrategy,
          strengths: draft.strengthsText.split("\n").map((item) => item.trim()).filter(Boolean),
          risks: draft.risksText.split("\n").map((item) => item.trim()).filter(Boolean),
        } as any,
      });
      await refresh();
      toast.success("逐图事实已保存");
    } catch (error: any) { toast.error(error.message || "保存失败"); }
  };

  const currentAnalysis = selected ? objectValue(selected.analysis?.userEdit || selected.analysis?.analysis) : {};
  const handleSaveAnalysis = async () => {
    if (!selected?.analysis) return;
    try {
      await saveAnalysis.mutateAsync({
        projectId,
        subjectId: selected.id,
        analysisId: selected.analysis.id,
        analysis: {
          ...currentAnalysis,
          overallConclusion,
          narrativeStrategy,
        } as any,
      });
      await refresh();
      toast.success("整套分析已保存");
    } catch (error: any) { toast.error(error.message || "保存失败"); }
  };

  const handleConfirm = async () => {
    if (!selected?.analysis) return;
    try {
      await handleSaveAnalysis();
      await confirmAnalysis.mutateAsync({ projectId, subjectId: selected.id, analysisId: selected.analysis.id });
      await refresh();
      toast.success("竞品整套图库分析已确认");
    } catch (error: any) { toast.error(error.message || "确认失败"); }
  };

  const job = latestJobQuery.data;
  const jobActive = job?.status === "queued" || job?.status === "running";

  return (
    <div className="space-y-4">
      <Card className="border-amber-200/70 bg-gradient-to-br from-amber-50/80 via-background to-background">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><ImageIcon className="h-4 w-4 text-amber-700" />受控采集与竞品研究对象</CardTitle>
          <CardDescription>输入ASIN后先进入统一采集任务；主图、副图、A+和品牌故事安全保存后会直接录入本项目。每次AI分析前均由人工选择范围，未选择的图片不会进入模型或下游表达分析。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
            <Input value={asinInput} onChange={(event) => setAsinInput(event.target.value.toUpperCase())} placeholder="输入美国站竞品ASIN" disabled={!canEdit} />
            <Button variant="outline" onClick={handleCreateAcquisition} disabled={!canEdit || createAcquisitionJob.isPending}>
              {createAcquisitionJob.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}创建采集任务
            </Button>
            <Button variant="ghost" asChild><Link href="/knowledge/acquisition">打开采集任务中心</Link></Button>
          </div>
          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <Select value={selectedSnapshotId} onValueChange={setSelectedSnapshotId} disabled={!canEdit}>
              <SelectTrigger><SelectValue placeholder="选择已直接录入的竞品Snapshot" /></SelectTrigger>
              <SelectContent>
                {(snapshotQuery.data || []).map((snapshot: any) => (
                  <SelectItem key={snapshot.id} value={String(snapshot.id)}>{snapshot.asin} · {snapshot.title || "未命名商品"} · {snapshot.assetCount}张图</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleAddSubject} disabled={!canEdit || !selectedSnapshotId || addSubject.isPending}>关联到本项目</Button>
          </div>
        </CardContent>
      </Card>

      {subjects.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed p-12 text-center text-muted-foreground">
          <ImageIcon className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="font-medium">暂无已直接录入的竞品图库</p>
          <p className="mt-1 text-sm">创建采集任务后，安全保存的图片会自动录入本项目；缺失图片会保留为可追踪缺口。</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="space-y-2">
            {subjects.map((subject: any) => (
              <button key={subject.id} type="button" onClick={() => setSelectedSubjectId(subject.id)} className={`w-full rounded-xl border p-3 text-left transition ${selectedSubjectId === subject.id ? "border-amber-500 bg-amber-50 shadow-sm" : "bg-card hover:border-amber-300"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><p className="truncate text-sm font-semibold">{subject.displayName || subject.asin}</p><p className="text-xs text-muted-foreground">{subject.asin}</p></div>
                  {subject.role === "primary" && <Crown className="h-4 w-4 shrink-0 text-amber-600" />}
                </div>
                <div className="mt-2 flex flex-wrap gap-1"><Badge variant="outline">{roleLabel(subject.role)}</Badge><Badge variant="secondary">{statusLabel(subject.status)}</Badge><Badge variant="outline">{subject.assets.length}张</Badge></div>
              </button>
            ))}
          </div>

          {selected && (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><CardTitle className="text-lg">{selected.displayName || selected.asin}</CardTitle><CardDescription>{selected.asin} · {roleLabel(selected.role)} · {selected.assets.length}张已确认图片</CardDescription></div>
                    <div className="flex flex-wrap gap-2">
                      {selected.role !== "primary" && <Button size="sm" variant="outline" disabled={!canEdit} onClick={async () => { await setPrimary.mutateAsync({ projectId, subjectId: selected.id }); await refresh(); }}><Crown className="mr-1 h-4 w-4" />设为主要竞品</Button>}
                      <Button size="sm" onClick={handleAnalyze} disabled={!canEdit || !scopeReadyForAnalysis || jobActive || startAnalysis.isPending}>{jobActive ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}{selected.analysis ? "重新分析已选图片" : "分析已选图片"}</Button>
                      <Button size="icon" variant="ghost" disabled={!canEdit} onClick={async () => { await archiveSubject.mutateAsync({ projectId, subjectId: selected.id }); setSelectedSubjectId(null); await refresh(); }}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                  {job && <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs"><RefreshCw className={`h-3.5 w-3.5 ${jobActive ? "animate-spin" : ""}`} />后台任务：{statusLabel(job.status)} · {job.progress || 0}%</div>}
                </CardHeader>
              </Card>

              <Card className="border-sky-200 bg-sky-50/40">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base"><Layers3 className="h-4 w-4 text-sky-700" />本次图片分析范围</CardTitle>
                      <CardDescription>默认纳入主图/副图和A+，默认排除品牌故事。图片始终保留在竞品图库；未纳入图片不会发送给AI、不会成为表达方式候选，也不会被判断为“缺失”。</CardDescription>
                    </div>
                    <Badge variant={scopeReadyForAnalysis ? "default" : "secondary"}>{scopeReadyForAnalysis ? `已确认范围 v${selection?.version || ""}` : selection?.status === "draft" ? "范围草稿未确认" : "请选择并确认范围"}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => selectByRoles(["main", "secondary", "aplus"])} disabled={!canEdit}>仅主图/副图/A+</Button>
                    <Button size="sm" variant="outline" onClick={() => selectByRoles(["main", "secondary", "aplus", "brand_story"])} disabled={!canEdit}>全选已保存图片</Button>
                    <Button size="sm" variant="ghost" onClick={() => selectByRoles([])} disabled={!canEdit}>清空选择</Button>
                  </div>
                  <div className="grid gap-2 rounded-lg border bg-background p-3 text-sm md:grid-cols-4">
                    <div><span className="text-muted-foreground">已选范围</span><p className="font-semibold">{selectedAssetIds.length} / {selected.assets.length} 张</p></div>
                    <div><span className="text-muted-foreground">主图/副图</span><p className="font-semibold">{scopeRoleCounts.main + scopeRoleCounts.secondary} 张</p></div>
                    <div><span className="text-muted-foreground">A+内容</span><p className="font-semibold">{scopeRoleCounts.aplus} 张</p></div>
                    <div><span className="text-muted-foreground">品牌故事</span><p className="font-semibold">{scopeRoleCounts.brand_story} 张{scopeRoleCounts.brand_story === 0 ? "（默认排除）" : ""}</p></div>
                  </div>
                  {selected.analysisScope?.legacy && <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="h-4 w-4 shrink-0" />历史整套分析没有范围版本记录；请保存并确认一次新的范围，后续分析、表达方式和综合结论将仅使用该范围。</div>}
                  {!selectedAssetIds.length && <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><AlertTriangle className="h-4 w-4 shrink-0" />至少选择一张安全保存的图片后才能保存或确认分析范围。</div>}
                  <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={handleSaveScope} disabled={!canEdit || !selectedAssetIds.length || saveScope.isPending}><Save className="mr-1 h-4 w-4" />保存范围草稿</Button><Button onClick={handleConfirmScope} disabled={!canEdit || !selectedAssetIds.length || confirmScope.isPending}>{confirmScope.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}确认分析范围</Button></div>
                </CardContent>
              </Card>

              <div className="grid gap-4 xl:grid-cols-2">
                {selected.assets.map((asset: any) => {
                  const draft = factDrafts[asset.id];
                  return (
                    <Card key={asset.id} className={`overflow-hidden ${selectedAssetIdSet.has(asset.id) ? "border-sky-300" : "border-dashed opacity-80"}`}>
                      <div className="aspect-[4/3] bg-muted"><img src={asset.imageUrl || ""} alt="竞品确认图片" className="h-full w-full object-contain" /></div>
                      <CardContent className="space-y-3 p-4">
                        <div className="flex items-center justify-between gap-2"><div className="flex gap-2"><Badge variant="outline">{asset.role}</Badge><Badge variant="secondary">图位 {asset.positionIndex + 1}</Badge></div><label className="flex cursor-pointer items-center gap-2 text-xs font-medium"><Checkbox checked={selectedAssetIdSet.has(asset.id)} onCheckedChange={(checked) => toggleAsset(asset.id, checked === true)} disabled={!canEdit} aria-label={`将图位 ${asset.positionIndex + 1} 加入分析范围`} />纳入分析</label></div>
                        {!selectedAssetIdSet.has(asset.id) && <div className="flex gap-2 rounded-md bg-muted p-2 text-xs text-muted-foreground"><EyeOff className="h-3.5 w-3.5 shrink-0" />此图仅安全保留，不会进入本次AI、表达方式候选或综合结论。</div>}
                        {!asset.fact || !draft ? <p className="text-sm text-muted-foreground">运行“分析整套图片”后生成可编辑逐图事实。</p> : (
                          <>
                            <div className="grid gap-2 sm:grid-cols-2"><Input value={draft.imagePurpose} onChange={(e) => updateFactDraft(asset.id, { imagePurpose: e.target.value })} placeholder="图片目的" disabled={!canEdit} /><Input value={draft.sellingPointsText} onChange={(e) => updateFactDraft(asset.id, { sellingPointsText: e.target.value })} placeholder="核心卖点（多项用换行）" disabled={!canEdit} /></div>
                            <div className="grid gap-2 sm:grid-cols-2"><Input value={draft.expressionMethod} onChange={(e) => updateFactDraft(asset.id, { expressionMethod: e.target.value })} placeholder="表达方式" disabled={!canEdit} /><Input value={draft.copyStrategy} onChange={(e) => updateFactDraft(asset.id, { copyStrategy: e.target.value })} placeholder="文案策略" disabled={!canEdit} /></div>
                            <div className="grid gap-2 sm:grid-cols-2"><Textarea value={draft.strengthsText} onChange={(e) => updateFactDraft(asset.id, { strengthsText: e.target.value })} placeholder="优势（每行一项）" disabled={!canEdit} /><Textarea value={draft.risksText} onChange={(e) => updateFactDraft(asset.id, { risksText: e.target.value })} placeholder="风险（每行一项）" disabled={!canEdit} /></div>
                            <Button size="sm" variant="outline" onClick={() => handleSaveFact(asset)} disabled={!canEdit || saveFact.isPending}>保存逐图事实</Button>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {selected.analysis && (
                <Card className="border-amber-200">
                  <CardHeader><CardTitle className="text-base">竞争对手所有图片主要分析</CardTitle><CardDescription>结论必须引用已确认图片证据；编辑后确认才进入Step 0 Artifact。</CardDescription></CardHeader>
                  <CardContent className="space-y-3">
                    <Textarea value={overallConclusion} onChange={(e) => setOverallConclusion(e.target.value)} className="min-h-24" placeholder="整套图片综合结论" disabled={!canEdit || selected.analysis.status === "confirmed"} />
                    <Textarea value={narrativeStrategy} onChange={(e) => setNarrativeStrategy(e.target.value)} placeholder="整套叙事策略" disabled={!canEdit || selected.analysis.status === "confirmed"} />
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-lg border p-3"><p className="mb-2 text-xs font-semibold text-muted-foreground">证据化优势</p>{(currentAnalysis.strengths || []).map((item: any, index: number) => <p key={index} className="mb-1 text-sm">{item.title}：{item.description}</p>)}</div>
                      <div className="rounded-lg border p-3"><p className="mb-2 text-xs font-semibold text-muted-foreground">风险与限制</p>{(currentAnalysis.risks || []).map((item: any, index: number) => <p key={index} className="mb-1 text-sm">{item.title}：{item.description}</p>)}</div>
                    </div>
                    {selected.analysis.status !== "confirmed" ? <div className="flex justify-end gap-2"><Button variant="outline" onClick={handleSaveAnalysis} disabled={!canEdit || saveAnalysis.isPending}>保存编辑</Button><Button onClick={handleConfirm} disabled={!canEdit || confirmAnalysis.isPending}><Check className="mr-2 h-4 w-4" />确认整套分析</Button></div> : <div className="flex items-center gap-2 text-sm text-green-700"><Check className="h-4 w-4" />该版本已确认，可供后续综合结论引用</div>}
                  </CardContent>
                </Card>
              )}
              {selected.role === "primary" && selected.status !== "confirmed" && <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="h-4 w-4 shrink-0" />主要竞争对手的整套分析确认前，Step 0不能完成最终确认。</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
