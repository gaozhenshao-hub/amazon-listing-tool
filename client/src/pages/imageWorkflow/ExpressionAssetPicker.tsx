import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, ArrowRight, Check, Filter, Loader2, ShieldCheck, Sparkles, Wand2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type Props = { projectId: number; groupId: number; canEdit: boolean };

function statusLabel(status?: string) {
  if (status === "confirmed") return "已确认";
  if (status === "review_required") return "待审核";
  if (status === "draft") return "草稿";
  if (status === "failed") return "失败";
  return "未创建";
}

export function ExpressionAssetPicker({ projectId, groupId, canEdit }: Props) {
  const utils = trpc.useUtils();
  const [sellingPoint, setSellingPoint] = useState("");
  const [expressionMethod, setExpressionMethod] = useState("");
  const [asinSearch, setAsinSearch] = useState("");
  const [subjectRole, setSubjectRole] = useState<"all" | "primary" | "benchmark" | "supplemental">("all");
  const [assetRole, setAssetRole] = useState("all");
  const [proofType, setProofType] = useState("all");
  const [minConfidence, setMinConfidence] = useState(0);
  const filters = useMemo(() => ({
    sellingPoint,
    expressionMethod,
    subjectIds: [],
    subjectRoles: subjectRole === "all" ? [] : [subjectRole],
    assetRoles: assetRole === "all" ? [] : [assetRole],
    proofTypes: proofType === "all" ? [] : [proofType],
    minConfidence,
  }), [sellingPoint, expressionMethod, subjectRole, assetRole, proofType, minConfidence]);
  const stateQuery = trpc.imageWorkflow.listExpressionAssetCandidates.useQuery({ projectId, groupId, filters });
  const jobQuery = trpc.imageWorkflow.latestExpressionAssetAnalysisJob.useQuery(
    { projectId, groupId },
    { refetchInterval: 2500 },
  );
  const saveMutation = trpc.imageWorkflow.saveExpressionSelection.useMutation();
  const confirmSelectionMutation = trpc.imageWorkflow.confirmExpressionSelection.useMutation();
  const startAnalysisMutation = trpc.imageWorkflow.startExpressionAssetAnalysis.useMutation();
  const saveAnalysisMutation = trpc.imageWorkflow.saveExpressionAssetAnalysis.useMutation();
  const confirmAnalysisMutation = trpc.imageWorkflow.confirmExpressionAssetAnalysis.useMutation();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [recommendedIds, setRecommendedIds] = useState<number[]>([]);
  const [analysisSummary, setAnalysisSummary] = useState("");
  const hydratedSelectionId = useRef<number | null>(null);
  const hydratedAnalysisId = useRef<number | null>(null);

  const data = stateQuery.data;
  const candidates = useMemo(() => data?.candidates || [], [data?.candidates]);
  const visibleCandidates = useMemo(() => {
    const keyword = asinSearch.trim().toLowerCase();
    if (!keyword) return candidates;
    return candidates.filter((candidate: any) => String(candidate.asin || "").toLowerCase().includes(keyword) || String(candidate.subjectName || "").toLowerCase().includes(keyword));
  }, [asinSearch, candidates]);
  const selection = data?.selection;
  const analysis = data?.analysis;
  const analysisData = (analysis?.userEdit || analysis?.analysis || null) as any;
  const job = jobQuery.data;
  const isAnalyzing = job?.status === "queued" || job?.status === "running";

  useEffect(() => {
    if (selection?.id && hydratedSelectionId.current !== selection.id) {
      const ids = Array.isArray(selection.selectedAssetIds) ? selection.selectedAssetIds.map(Number) : [];
      const aiIds = (data?.links || []).filter((link: any) => link.source === "ai_recommended").map((link: any) => link.acquisitionAssetId);
      setSelectedIds(ids);
      setRecommendedIds(aiIds);
      hydratedSelectionId.current = selection.id;
    }
  }, [selection?.id, selection?.selectedAssetIds, data?.links]);

  useEffect(() => {
    if (analysis?.id && hydratedAnalysisId.current !== analysis.id) {
      setAnalysisSummary(String(analysisData?.summary || ""));
      hydratedAnalysisId.current = analysis.id;
    }
  }, [analysis?.id, analysisData?.summary]);

  useEffect(() => {
    if (job?.status === "succeeded" || job?.status === "failed") {
      void utils.imageWorkflow.listExpressionAssetCandidates.invalidate({ projectId, groupId });
    }
  }, [job?.status, job?.runId, groupId, projectId, utils]);

  const toggleAsset = (assetId: number) => {
    setSelectedIds((current) => current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId]);
  };

  const moveAsset = (assetId: number, direction: -1 | 1) => {
    setSelectedIds((current) => {
      const index = current.indexOf(assetId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const selectRecommended = () => {
    const ids = visibleCandidates.filter((candidate: any) => candidate.recommended).map((candidate: any) => candidate.assetId);
    if (!ids.length) return toast.info("当前筛选条件下没有AI推荐候选，请人工选择或调整筛选");
    setSelectedIds(ids);
    setRecommendedIds(ids);
  };

  const refresh = async () => {
    await Promise.all([
      utils.imageWorkflow.listExpressionAssetCandidates.invalidate({ projectId, groupId }),
      utils.imageWorkflow.getSession.invalidate({ projectId }),
    ]);
  };

  const saveSelection = async () => {
    try {
      await saveMutation.mutateAsync({ projectId, groupId, filters, selectedAssetIds: selectedIds, aiRecommendedAssetIds: recommendedIds });
      await refresh();
      toast.success("已保存新的图片选择版本；旧表达分析与综合结论已失效");
    } catch (error: any) { toast.error(error.message || "保存选择失败"); }
  };

  const confirmSelection = async () => {
    if (!selection?.id) return toast.error("请先保存图片选择版本");
    try {
      await confirmSelectionMutation.mutateAsync({ projectId, groupId, selectionVersionId: selection.id });
      await refresh();
      toast.success("图片选择版本已确认");
    } catch (error: any) { toast.error(error.message || "确认失败"); }
  };

  const startAnalysis = async () => {
    if (!selection?.id || selection.status !== "confirmed") return toast.error("请先保存并确认图片选择版本");
    try {
      await startAnalysisMutation.mutateAsync({ projectId, groupId, selectionVersionId: selection.id });
      await jobQuery.refetch();
      toast.success("同表达竞品图片分析已进入后台任务");
    } catch (error: any) { toast.error(error.message || "启动分析失败"); }
  };

  const saveAnalysis = async () => {
    if (!analysis?.id || !analysisData) return;
    try {
      await saveAnalysisMutation.mutateAsync({ projectId, groupId, analysisId: analysis.id, analysis: { ...analysisData, summary: analysisSummary } });
      await refresh();
      toast.success("表达分析编辑已保存");
    } catch (error: any) { toast.error(error.message || "保存分析失败"); }
  };

  const confirmAnalysis = async () => {
    if (!analysis?.id) return;
    try {
      if (analysisSummary !== analysisData?.summary) {
        await saveAnalysisMutation.mutateAsync({ projectId, groupId, analysisId: analysis.id, analysis: { ...analysisData, summary: analysisSummary } });
      }
      await confirmAnalysisMutation.mutateAsync({ projectId, groupId, analysisId: analysis.id });
      await refresh();
      toast.success("表达分析已确认，可进入综合结论");
    } catch (error: any) { toast.error(error.message || "确认分析失败"); }
  };

  return (
    <div className="border-b bg-slate-50/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <p className="text-sm font-semibold">受控竞品图库联动</p>
            <Badge variant="outline">选择 {statusLabel(selection?.status)}</Badge>
            <Badge variant="outline">分析 {statusLabel(analysis?.status)}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">只可选择已确认Snapshot且逐图事实已确认的竞品图片；不受手工上传5张上限约束。竞品图仅用于研究，不进入我方生成素材库。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setSelectedIds(visibleCandidates.map((item: any) => item.assetId))} disabled={!canEdit || !visibleCandidates.length}>全选筛选结果</Button>
          <Button size="sm" variant="outline" onClick={selectRecommended} disabled={!canEdit || !visibleCandidates.length}><Wand2 className="mr-1 h-3.5 w-3.5" />AI推荐</Button>
          <Button size="sm" variant="ghost" onClick={() => { setSelectedIds([]); setRecommendedIds([]); }} disabled={!canEdit}>清空</Button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
        <Input value={sellingPoint} onChange={(event) => setSellingPoint(event.target.value)} placeholder="筛选卖点" className="h-8 text-xs" />
        <Input value={expressionMethod} onChange={(event) => setExpressionMethod(event.target.value)} placeholder="筛选表达方式" className="h-8 text-xs" />
        <Input value={asinSearch} onChange={(event) => setAsinSearch(event.target.value)} placeholder="筛选ASIN/竞品" className="h-8 text-xs" />
        <select value={subjectRole} onChange={(event) => setSubjectRole(event.target.value as "all" | "primary" | "benchmark" | "supplemental")} className="h-8 rounded-md border bg-background px-2 text-xs">
          <option value="all">全部竞品角色</option><option value="primary">主要竞品</option><option value="benchmark">对标样本</option><option value="supplemental">补充样本</option>
        </select>
        <select value={assetRole} onChange={(event) => setAssetRole(event.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs">
          <option value="all">全部图位</option><option value="main">主图</option><option value="aplus">A+</option><option value="brand_story">品牌故事</option><option value="other">其他</option>
        </select>
        <select value={proofType} onChange={(event) => setProofType(event.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs">
          <option value="all">全部证明方式</option><option value="data">数据</option><option value="comparison">对比</option><option value="testimonial">口碑</option><option value="certification">认证</option><option value="scene">场景</option><option value="none">未标注</option>
        </select>
        <label className="flex h-8 items-center gap-2 rounded-md border bg-background px-2 text-xs text-muted-foreground">
          <Filter className="h-3.5 w-3.5" />置信度≥{minConfidence.toFixed(1)}
          <input type="range" min="0" max="1" step="0.1" value={minConfidence} onChange={(event) => setMinConfidence(Number(event.target.value))} className="min-w-0 flex-1" />
        </label>
      </div>

      {stateQuery.isLoading ? (
        <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载已确认竞品图库...</div>
      ) : visibleCandidates.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed bg-background p-4 text-center text-xs text-muted-foreground">没有符合条件的已确认资产。请先在“竞品全图分析”确认逐图事实和整套分析。</div>
      ) : (
        <div className="mt-3 grid max-h-[430px] grid-cols-2 gap-2 overflow-y-auto pr-1 md:grid-cols-3 xl:grid-cols-5">
          {visibleCandidates.map((candidate: any) => {
            const checked = selectedIds.includes(candidate.assetId);
            return (
              <button key={candidate.assetId} type="button" onClick={() => canEdit && toggleAsset(candidate.assetId)} className={`overflow-hidden rounded-lg border bg-background text-left transition ${checked ? "border-primary ring-2 ring-primary/20" : "hover:border-primary/40"}`}>
                <div className="relative aspect-square bg-muted">
                  <img src={candidate.imageUrl} alt={`${candidate.asin} ${candidate.positionIndex}`} className="h-full w-full object-contain" />
                  <div className="absolute left-2 top-2"><Checkbox checked={checked} /></div>
                  {candidate.recommended && <Badge className="absolute right-2 top-2 bg-violet-600 text-white">AI推荐</Badge>}
                </div>
                <div className="space-y-1 p-2">
                  <p className="truncate text-xs font-medium">{candidate.subjectName || candidate.asin}</p>
                  <div className="flex flex-wrap gap-1"><Badge variant="secondary" className="text-[10px]">{candidate.assetRole}</Badge><Badge variant="outline" className="text-[10px]">{candidate.proofType}</Badge></div>
                  <p className="line-clamp-2 text-[10px] text-muted-foreground">{candidate.sellingPoints.join(" · ") || "未提取卖点"}</p>
                  <p className="line-clamp-1 text-[10px] text-muted-foreground">表达：{candidate.expressionMethod || "未标注"}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-3 rounded-lg border bg-background p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium">已选托盘：{selectedIds.length} 张</p>
          {canEdit && <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={saveSelection} disabled={saveMutation.isPending || !selectedIds.length}>{saveMutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}保存新版本</Button>
            <Button size="sm" variant="outline" onClick={confirmSelection} disabled={confirmSelectionMutation.isPending || selection?.status !== "draft"}><Check className="mr-1 h-3.5 w-3.5" />确认选择</Button>
            <Button size="sm" onClick={startAnalysis} disabled={startAnalysisMutation.isPending || isAnalyzing || selection?.status !== "confirmed"}>{isAnalyzing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}分析所选图库</Button>
          </div>}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selectedIds.slice(0, 30).map((assetId, index) => <Badge key={assetId} variant="secondary" className="gap-1">
            <span>{index + 1}. Asset #{assetId}</span>
            {canEdit && <>
              <ArrowLeft className={`h-3 w-3 cursor-pointer ${index === 0 ? "opacity-30" : ""}`} onClick={() => moveAsset(assetId, -1)} />
              <ArrowRight className={`h-3 w-3 cursor-pointer ${index === selectedIds.length - 1 ? "opacity-30" : ""}`} onClick={() => moveAsset(assetId, 1)} />
              <X className="h-3 w-3 cursor-pointer" onClick={() => toggleAsset(assetId)} />
            </>}
          </Badge>)}
          {selectedIds.length > 30 && <Badge variant="outline">另有 {selectedIds.length - 30} 张，后台将按30张分批覆盖</Badge>}
        </div>
        {job?.status === "failed" && <p className="mt-2 text-xs text-destructive">{job.error || "后台分析失败，可重试"}</p>}
      </div>

      {analysisData && (
        <Card className="mt-3 border-violet-200 bg-violet-50/40">
          <CardHeader className="pb-2"><CardTitle className="text-sm">同表达资产分析 v{analysis.version}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Textarea value={analysisSummary} onChange={(event) => setAnalysisSummary(event.target.value)} disabled={!canEdit || analysis.status === "confirmed"} className="min-h-20 bg-background text-xs" />
            <div className="grid gap-3 md:grid-cols-3">
              <div><p className="text-xs font-semibold">共性模式</p>{(analysisData.commonPatterns || []).map((item: any) => <p key={item.id} className="mt-1 text-xs text-muted-foreground">{item.pattern} · 证据 {item.evidenceAssetIds.join(", ")}</p>)}</div>
              <div><p className="text-xs font-semibold">差异与风险</p>{[...(analysisData.meaningfulDifferences || []), ...(analysisData.risks || [])].map((item: any) => <p key={item.id} className="mt-1 text-xs text-muted-foreground">{item.pattern || item.risk} · 证据 {item.evidenceAssetIds.join(", ")}</p>)}</div>
              <div><p className="text-xs font-semibold">策略建议</p>{(analysisData.strategyRecommendations || []).map((item: any) => <p key={item.id} className="mt-1 text-xs text-muted-foreground">{item.recommendation} · 证据 {item.evidenceAssetIds.join(", ")}</p>)}</div>
            </div>
            {canEdit && analysis.status !== "confirmed" && <div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={saveAnalysis}>保存编辑</Button><Button size="sm" onClick={confirmAnalysis}><Check className="mr-1 h-3.5 w-3.5" />确认表达分析</Button></div>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
