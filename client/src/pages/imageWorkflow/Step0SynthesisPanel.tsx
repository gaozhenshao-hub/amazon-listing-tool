import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, ArrowLeft, Check, Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type Track = "gallery" | "expression" | "synthesis";
type Props = { projectId: number; canEdit: boolean; onNavigate: (track: Track) => void };

export function Step0SynthesisPanel({ projectId, canEdit, onNavigate }: Props) {
  const utils = trpc.useUtils();
  const stateQuery = trpc.imageWorkflow.getStep0SynthesisState.useQuery({ projectId });
  const jobQuery = trpc.imageWorkflow.latestStep0SynthesisJob.useQuery({ projectId }, { refetchInterval: 2500 });
  const startMutation = trpc.imageWorkflow.startStep0Synthesis.useMutation();
  const saveMutation = trpc.imageWorkflow.saveStep0Synthesis.useMutation();
  const confirmMutation = trpc.imageWorkflow.confirmStep0Synthesis.useMutation();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [positioningSummary, setPositioningSummary] = useState("");
  const [overallConclusion, setOverallConclusion] = useState("");
  const hydratedId = useRef<number | null>(null);
  const state = stateQuery.data;
  const synthesis = state?.synthesis;
  const analysis = (synthesis?.userEdit || synthesis?.analysis || null) as any;
  const job = jobQuery.data;
  const isRunning = job?.status === "queued" || job?.status === "running";

  const sections = useMemo(() => analysis ? [
    ["主要竞品启示", analysis.primaryCompetitorTakeaways || []],
    ["表达策略优先级", analysis.expressionStrategyPriorities || []],
    ["差异化机会", analysis.differentiationOpportunities || []],
    ["冲突与取舍", analysis.conflicts || []],
    ["下游建议", analysis.downstreamRecommendations || []],
  ] as Array<[string, any[]]> : [], [analysis]);

  useEffect(() => {
    if (synthesis?.id && hydratedId.current !== synthesis.id) {
      setSelectedIds(Array.isArray(synthesis.selectedDecisionIds) ? synthesis.selectedDecisionIds.map(String) : []);
      setPositioningSummary(String(analysis?.positioningSummary || ""));
      setOverallConclusion(String(analysis?.overallConclusion || ""));
      hydratedId.current = synthesis.id;
    }
  }, [synthesis?.id, synthesis?.selectedDecisionIds, analysis?.positioningSummary, analysis?.overallConclusion]);

  useEffect(() => {
    if (job?.status === "succeeded" || job?.status === "failed") void utils.imageWorkflow.getStep0SynthesisState.invalidate({ projectId });
  }, [job?.status, job?.runId, projectId, utils]);

  const refresh = async () => {
    await Promise.all([
      utils.imageWorkflow.getStep0SynthesisState.invalidate({ projectId }),
      utils.imageWorkflow.getSession.invalidate({ projectId }),
    ]);
  };

  const start = async () => {
    try {
      await startMutation.mutateAsync({ projectId });
      await jobQuery.refetch();
      toast.success("综合结论已进入后台任务");
    } catch (error: any) { toast.error(error.message || "启动综合分析失败"); }
  };

  const toggle = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const save = async () => {
    if (!synthesis?.id || !analysis) return;
    try {
      await saveMutation.mutateAsync({
        projectId,
        synthesisId: synthesis.id,
        selectedDecisionIds: selectedIds,
        analysis: { ...analysis, positioningSummary, overallConclusion },
      });
      await refresh();
      toast.success("综合结论和人工选择已保存");
    } catch (error: any) { toast.error(error.message || "保存失败"); }
  };

  const confirm = async () => {
    if (!synthesis?.id) return;
    if (!selectedIds.length) return toast.error("请至少选择一项策略进入后续步骤");
    try {
      await saveMutation.mutateAsync({
        projectId,
        synthesisId: synthesis.id,
        selectedDecisionIds: selectedIds,
        analysis: { ...analysis, positioningSummary, overallConclusion },
      });
      await confirmMutation.mutateAsync({ projectId, synthesisId: synthesis.id });
      await refresh();
      toast.success("综合结论已确认，只有勾选项会进入后续步骤");
    } catch (error: any) { toast.error(error.message || "确认失败"); }
  };

  if (stateQuery.isLoading) return <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载综合结论...</div>;

  if (!state?.galleryArtifact || !state?.expressionArtifact) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Step 0 综合结论</CardTitle></CardHeader>
        <CardContent>
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>需要两个已确认上游Artifact</AlertTitle>
            <AlertDescription className="mt-2">先确认主要竞品整套图库分析，再确认至少一个图库联动表达方式分析。旧手工表达方式路径仍可独立使用。</AlertDescription>
          </Alert>
          <div className="mt-4 flex gap-2"><Button variant="outline" onClick={() => onNavigate("gallery")}><ArrowLeft className="mr-1 h-4 w-4" />去竞品全图</Button><Button variant="outline" onClick={() => onNavigate("expression")}>去卖点表达</Button></div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><CardTitle className="text-base">全图策略 × 卖点表达综合结论</CardTitle><p className="mt-1 text-xs text-muted-foreground">AI先提供结构化候选，您必须逐项勾选；仅已确认且被勾选的决策进入Step 1/2。</p></div>
            <div className="flex items-center gap-2"><Badge variant="outline">{synthesis?.status === "confirmed" ? "已确认" : synthesis ? "待审核" : "未生成"}</Badge>{canEdit && <Button onClick={start} disabled={isRunning || startMutation.isPending}>{isRunning ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}{synthesis ? "重新生成" : "生成综合结论"}</Button>}</div>
          </div>
        </CardHeader>
      </Card>
      {job?.status === "failed" && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>综合分析失败</AlertTitle><AlertDescription>{job.error || "可重新发起任务"}</AlertDescription></Alert>}
      {analysis && <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="grid gap-3 md:grid-cols-2">
            <div><label className="mb-1 block text-xs font-semibold">定位摘要</label><Textarea value={positioningSummary} onChange={(event) => setPositioningSummary(event.target.value)} disabled={!canEdit || synthesis.status === "confirmed"} className="min-h-24" /></div>
            <div><label className="mb-1 block text-xs font-semibold">综合结论</label><Textarea value={overallConclusion} onChange={(event) => setOverallConclusion(event.target.value)} disabled={!canEdit || synthesis.status === "confirmed"} className="min-h-24" /></div>
          </div>
          {sections.map(([title, items]) => <div key={title}>
            <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">{title}</h3><span className="text-xs text-muted-foreground">已选 {items.filter((item) => selectedIds.includes(item.id)).length}/{items.length}</span></div>
            <div className="grid gap-2 md:grid-cols-2">{items.map((item) => {
              const text = item.takeaway || item.strategy || item.opportunity || item.conflict || item.recommendation;
              return <label key={item.id} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${selectedIds.includes(item.id) ? "border-primary bg-primary/5" : "bg-background"}`}>
                <Checkbox checked={selectedIds.includes(item.id)} onCheckedChange={() => canEdit && synthesis.status !== "confirmed" && toggle(item.id)} />
                <div className="min-w-0"><p className="text-sm font-medium">{text}</p>{item.rationale && <p className="mt-1 text-xs text-muted-foreground">{item.rationale}</p>}<p className="mt-1 text-[11px] text-muted-foreground">证据 Asset：{item.evidenceAssetIds.join(", ")}</p></div>
              </label>;
            })}</div>
          </div>)}
          {canEdit && synthesis.status !== "confirmed" && <div className="flex justify-end gap-2 border-t pt-4"><Button variant="outline" onClick={save} disabled={!selectedIds.length || saveMutation.isPending}>保存人工选择</Button><Button onClick={confirm} disabled={!selectedIds.length || confirmMutation.isPending}><Check className="mr-1 h-4 w-4" />确认并进入后续</Button></div>}
        </CardContent>
      </Card>}
    </div>
  );
}
