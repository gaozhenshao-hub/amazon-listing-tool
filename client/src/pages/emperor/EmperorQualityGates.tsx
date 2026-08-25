import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, ClipboardCheck, FilePlus2, Gauge, History, PauseCircle, Play, Rocket, RotateCcw, ShieldAlert, Sparkles } from "lucide-react";
import { toast } from "sonner";

const DEFAULT_RUBRIC = {
  version: "human_quality.v1",
  dimensions: [
    { key: "structure", label: "结构合规", weight: 25 },
    { key: "business_accuracy", label: "业务准确", weight: 25 },
    { key: "editability", label: "可编辑性", weight: 20 },
    { key: "compliance", label: "平台与品牌合规", weight: 20 },
    { key: "actionability", label: "可执行性", weight: 10 },
  ],
};

function safeJson(value: string, fieldName: string) {
  try { return JSON.parse(value); } catch { throw new Error(`${fieldName}必须是有效JSON`); }
}

export default function EmperorQualityGates() {
  const utils = trpc.useUtils();
  const [skillSlug, setSkillSlug] = useState("");
  const [caseDialogOpen, setCaseDialogOpen] = useState(false);
  const [resultCase, setResultCase] = useState<any | null>(null);
  const [caseName, setCaseName] = useState("");
  const [caseContext, setCaseContext] = useState("{\n  \n}");
  const [caseConstraints, setCaseConstraints] = useState("{\n  \n}");
  const [caseRubric, setCaseRubric] = useState(JSON.stringify(DEFAULT_RUBRIC, null, 2));
  const [score, setScore] = useState("80");
  const [feedback, setFeedback] = useState("");
  const [humanApproved, setHumanApproved] = useState(true);
  const [passed, setPassed] = useState(true);
  const [gateMode, setGateMode] = useState<"advisory" | "enforced">("advisory");
  const [minCases, setMinCases] = useState("3");
  const [minScore, setMinScore] = useState("80");
  const [minPassRate, setMinPassRate] = useState("80");
  const [requireHuman, setRequireHuman] = useState(true);
  const [snapshotId, setSnapshotId] = useState("");
  const [replayToReview, setReplayToReview] = useState<any | null>(null);
  const [rolloutNote, setRolloutNote] = useState("");
  const [rolloutPercent, setRolloutPercent] = useState("5");

  const { data: skillsData } = trpc.emperor.skills.list.useQuery({ page: 1, pageSize: 200 });
  const { data: cases = [], isLoading: casesLoading } = trpc.emperor.skills.evalCases.useQuery({ skillSlug: skillSlug || undefined });
  const { data: gate, refetch: refetchGate } = trpc.emperor.skills.releaseGate.useQuery(
    { skillSlug }, { enabled: Boolean(skillSlug) },
  );
  const { data: snapshots = [] } = trpc.emperor.skills.versionSnapshots.useQuery({ skillSlug: skillSlug || undefined });
  const { data: replayResults = [] } = trpc.emperor.skills.replayResults.useQuery({ skillSlug: skillSlug || undefined });
  const { data: rolloutPlans = [] } = trpc.emperor.skills.rolloutPlans.useQuery({ skillSlug: skillSlug || undefined });
  const selectedSkill = useMemo(() => (skillsData?.skills || []).find((item: any) => item.slug === skillSlug), [skillsData, skillSlug]);

  const refresh = async () => {
    await Promise.all([
      utils.emperor.skills.evalCases.invalidate(),
      utils.emperor.skills.qualityOverview.invalidate(),
      utils.emperor.skills.releaseGate.invalidate(),
      utils.emperor.skills.replayResults.invalidate(),
      utils.emperor.skills.rolloutPlans.invalidate(),
    ]);
    await refetchGate();
  };

  const createCase = trpc.emperor.skills.createEvalCase.useMutation({
    onSuccess: async () => { toast.success("金标用例已保存"); setCaseDialogOpen(false); setCaseName(""); await refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const recordResult = trpc.emperor.skills.recordEvalResult.useMutation({
    onSuccess: async () => { toast.success("人工评测已记录"); setResultCase(null); setFeedback(""); await refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const saveGate = trpc.emperor.skills.updateReleaseGate.useMutation({
    onSuccess: async () => { toast.success("发布门禁策略已保存"); await refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const replayCase = trpc.emperor.skills.replayEvalCase.useMutation({
    onSuccess: async (result) => { toast.success("候选版本回放完成，请进行人工判断"); setReplayToReview(result); await refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const createRolloutPlan = trpc.emperor.skills.createRolloutPlan.useMutation({ onSuccess: async () => { toast.success("灰度草稿已创建，仍需人工批准"); await refresh(); }, onError: (error) => toast.error(error.message) });
  const approveRolloutPlan = trpc.emperor.skills.approveRolloutPlan.useMutation({ onSuccess: async () => { toast.success("灰度计划已人工批准"); await refresh(); }, onError: (error) => toast.error(error.message) });
  const activateRolloutPlan = trpc.emperor.skills.activateRolloutPlan.useMutation({ onSuccess: async () => { toast.success("有限灰度已启动"); await refresh(); }, onError: (error) => toast.error(error.message) });
  const stopRolloutPlan = trpc.emperor.skills.stopRolloutPlan.useMutation({ onSuccess: async () => { toast.success("灰度计划已停止，运行将回到默认版本"); await refresh(); }, onError: (error) => toast.error(error.message) });

  const currentMetrics = gate?.metrics;
  const gateReasons = gate?.reasons || [];

  return (
    <div className="p-6 space-y-6 max-w-[1500px] mx-auto">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-primary" /><h1 className="text-xl font-semibold">质量评测与发布门禁</h1></div>
          <p className="text-sm text-muted-foreground mt-1">用真实业务上下文建立金标用例，以人工评分驱动候选Skill的版本比较；默认仅提示，不会自动替换已发布版本。</p>
        </div>
        <Button onClick={() => { if (!skillSlug) { toast.error("请先选择Skill"); return; } setCaseDialogOpen(true); }}><FilePlus2 className="h-4 w-4 mr-2" />新建金标用例</Button>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-col md:flex-row gap-4 md:items-center">
          <div className="min-w-56"><Label>选择Skill</Label><select value={skillSlug} onChange={(event) => setSkillSlug(event.target.value)} className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="">请选择需要治理的Skill</option>{(skillsData?.skills || []).map((item: any) => <option key={item.slug} value={item.slug}>{item.name} · {item.slug}</option>)}</select></div>
          {selectedSkill ? <div className="grid grid-cols-2 md:grid-cols-5 gap-4 flex-1 text-sm"><div><p className="text-xs text-muted-foreground">当前版本</p><p className="font-medium">v{selectedSkill.version}</p></div><div><p className="text-xs text-muted-foreground">发布状态</p><Badge variant="secondary">{selectedSkill.status}</Badge></div><div><p className="text-xs text-muted-foreground">金标用例</p><p className="font-medium">{cases.length} 个</p></div><div><p className="text-xs text-muted-foreground">门禁模式</p><Badge variant={gate?.mode === "enforced" ? "destructive" : "outline"}>{gate?.mode === "enforced" ? "强制" : "建议"}</Badge></div><div><Label className="text-xs text-muted-foreground">候选快照</Label><select value={snapshotId} onChange={(event) => setSnapshotId(event.target.value)} className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-xs"><option value="">选择候选版本</option>{snapshots.map((snapshot: any) => <option key={snapshot.snapshotId} value={snapshot.snapshotId}>v{snapshot.skillVersion} · {snapshot.source} · {String(snapshot.snapshotHash).slice(0, 8)}</option>)}</select></div></div> : <p className="text-sm text-muted-foreground">选择Skill后可配置金标、人工评分和发布质量门槛。</p>}
        </CardContent>
      </Card>

      {skillSlug ? <div className="grid xl:grid-cols-[1.55fr_1fr] gap-6">
        <Card className="min-h-[500px]"><CardHeader><CardTitle className="text-base">金标用例与候选回放</CardTitle><CardDescription>仅在已批准真实用例上回放候选快照；回放只生成评测证据，不发布或替换Skill。</CardDescription></CardHeader><CardContent><ScrollArea className="h-[390px] pr-3">{casesLoading ? <p className="text-sm text-muted-foreground">正在加载用例…</p> : cases.length === 0 ? <div className="py-20 text-center text-muted-foreground"><Sparkles className="h-8 w-8 mx-auto opacity-30 mb-3" /><p className="text-sm">尚无金标用例</p><p className="text-xs mt-1">从已确认的业务产物中创建一个可重复的评测上下文。</p></div> : <div className="space-y-3">{cases.map((item: any) => <div key={item.caseId} className="rounded-lg border p-4"><div className="flex justify-between gap-4"><div><div className="flex items-center gap-2"><p className="font-medium text-sm">{item.name}</p><Badge variant={item.status === "approved" ? "default" : "secondary"}>{item.status}</Badge></div><p className="text-xs text-muted-foreground font-mono mt-1">{item.caseId}</p></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setResultCase(item)}>人工评分</Button><Button size="sm" disabled={item.status !== "approved" || !snapshotId || replayCase.isPending} onClick={() => replayCase.mutate({ caseId: item.caseId, snapshotId })}><Play className="h-3.5 w-3.5 mr-1" />回放候选</Button></div></div><div className="flex flex-wrap gap-1 mt-3">{(item.tags || []).map((tag: string) => <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>)}</div>{item.status !== "approved" ? <p className="text-xs text-amber-700 mt-3">草稿用例不能触发模型回放；请先在真实业务审核后批准。</p> : null}</div>)}</div>}</ScrollArea></CardContent></Card>

        <div className="space-y-6"><Card><CardHeader><CardTitle className="text-base flex gap-2 items-center"><Gauge className="h-4 w-4" />候选版本质量</CardTitle><CardDescription>当前版本的人工评测汇总</CardDescription></CardHeader><CardContent className="space-y-4">{currentMetrics ? <><div className="grid grid-cols-3 gap-3 text-center"><div><p className="text-xl font-semibold">{currentMetrics.approvedCases}</p><p className="text-xs text-muted-foreground">评分样本</p></div><div><p className="text-xl font-semibold">{currentMetrics.averageScore.toFixed(1)}</p><p className="text-xs text-muted-foreground">平均分</p></div><div><p className="text-xl font-semibold">{currentMetrics.passRate.toFixed(0)}%</p><p className="text-xs text-muted-foreground">通过率</p></div></div><Progress value={Math.min(Math.max(currentMetrics.averageScore, 0), 100)} />{gateReasons.length ? <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800"><ShieldAlert className="inline h-3.5 w-3.5 mr-1" />{gateReasons.join("；")}</div> : <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800"><CheckCircle2 className="inline h-3.5 w-3.5 mr-1" />当前候选满足已配置的门槛。</div>}</> : <p className="text-sm text-muted-foreground">尚未配置门禁策略。</p>}</CardContent></Card>

          <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4" />候选回放报告</CardTitle><CardDescription>自动检查只验证明确约束；是否计入门禁仍由人工评分决定。</CardDescription></CardHeader><CardContent><ScrollArea className="h-44 pr-2">{replayResults.length ? <div className="space-y-2">{replayResults.map((result: any) => <button key={result.resultId} className="w-full rounded-md border p-3 text-left hover:bg-muted/50" onClick={() => setReplayToReview(result)}><div className="flex justify-between gap-2"><span className="text-xs font-medium">v{result.skillVersion} · {result.snapshotId?.slice(-8)}</span><Badge variant={result.passed ? "default" : "destructive"}>{result.passed ? "约束通过" : "存在约束问题"}</Badge></div><p className="mt-1 text-xs text-muted-foreground line-clamp-2">{result.outputSummary?.output || "无输出摘要"}</p></button>)}</div> : <p className="py-10 text-center text-xs text-muted-foreground">尚无回放报告。选择候选快照后，从approved金标用例发起回放。</p>}</ScrollArea></CardContent></Card><Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><Rocket className="h-4 w-4" />有限灰度计划</CardTitle><CardDescription>仅人工批准的候选可按稳定分桶在1%–50%范围试运行；暂停或回退立即恢复默认版本。</CardDescription></CardHeader><CardContent className="space-y-3"><div className="grid grid-cols-[1fr_88px] gap-2"><Input value={rolloutNote} onChange={(event) => setRolloutNote(event.target.value)} placeholder="人工决策说明（至少5字）" /><Input type="number" min="1" max="50" value={rolloutPercent} onChange={(event) => setRolloutPercent(event.target.value)} /></div><Button size="sm" className="w-full" variant="outline" disabled={!snapshotId || rolloutNote.trim().length < 5 || createRolloutPlan.isPending} onClick={() => createRolloutPlan.mutate({ skillSlug, snapshotId, rolloutPercent: Number(rolloutPercent), decisionNote: rolloutNote })}>从候选快照创建灰度草稿</Button><ScrollArea className="h-48 pr-2">{rolloutPlans.length ? <div className="space-y-2">{rolloutPlans.map((plan: any) => <div key={plan.planId} className="rounded-md border p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">v{plan.skillVersion} · {plan.snapshotId?.slice(-8)}</span><Badge variant={plan.status === "active" ? "default" : plan.status === "rolled_back" ? "destructive" : "secondary"}>{plan.status}</Badge></div><p className="mt-1 text-xs text-muted-foreground line-clamp-2">{plan.decisionNote || "无人工说明"}</p><div className="mt-2 flex flex-wrap gap-2"><Badge variant="outline" className="text-xs">{plan.rolloutPercent}%</Badge>{plan.status === "draft" || plan.status === "paused" ? <Button size="sm" variant="outline" disabled={rolloutNote.trim().length < 5 || approveRolloutPlan.isPending} onClick={() => approveRolloutPlan.mutate({ planId: plan.planId, decisionNote: rolloutNote })}>人工批准</Button> : null}{plan.status === "approved" || plan.status === "paused" ? <Button size="sm" disabled={rolloutNote.trim().length < 5 || activateRolloutPlan.isPending} onClick={() => activateRolloutPlan.mutate({ planId: plan.planId, rolloutPercent: Number(rolloutPercent), decisionNote: rolloutNote })}><Rocket className="h-3.5 w-3.5 mr-1" />启动</Button> : null}{plan.status === "active" ? <><Button size="sm" variant="outline" disabled={rolloutNote.trim().length < 5 || stopRolloutPlan.isPending} onClick={() => stopRolloutPlan.mutate({ planId: plan.planId, status: "paused", decisionNote: rolloutNote })}><PauseCircle className="h-3.5 w-3.5 mr-1" />暂停</Button><Button size="sm" variant="destructive" disabled={rolloutNote.trim().length < 5 || stopRolloutPlan.isPending} onClick={() => stopRolloutPlan.mutate({ planId: plan.planId, status: "rolled_back", decisionNote: rolloutNote })}><RotateCcw className="h-3.5 w-3.5 mr-1" />回退</Button></> : null}</div></div>)}</div> : <p className="py-6 text-center text-xs text-muted-foreground">尚无灰度计划。先完成真实回放与人工评分，再创建候选灰度草稿。</p>}</ScrollArea></CardContent></Card><Card><CardHeader><CardTitle className="text-base">发布门禁策略</CardTitle><CardDescription>建议模式只提示风险；强制模式才会阻止不达标候选发布。</CardDescription></CardHeader><CardContent className="space-y-3"><div className="grid grid-cols-2 gap-3"><div><Label>模式</Label><select value={gateMode} onChange={(event) => setGateMode(event.target.value as "advisory" | "enforced")} className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"><option value="advisory">建议（默认）</option><option value="enforced">强制</option></select></div><div><Label>最低样本</Label><Input className="mt-1" type="number" min="0" value={minCases} onChange={(event) => setMinCases(event.target.value)} /></div><div><Label>最低平均分</Label><Input className="mt-1" type="number" min="0" max="100" value={minScore} onChange={(event) => setMinScore(event.target.value)} /></div><div><Label>最低通过率%</Label><Input className="mt-1" type="number" min="0" max="100" value={minPassRate} onChange={(event) => setMinPassRate(event.target.value)} /></div></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={requireHuman} onChange={(event) => setRequireHuman(event.target.checked)} />需要至少一条人工批准的结果</label><Button className="w-full" variant="outline" disabled={saveGate.isPending} onClick={() => saveGate.mutate({ skillSlug, mode: gateMode, minApprovedCases: Number(minCases), minAverageScore: Number(minScore), minPassRate: Number(minPassRate), requireHumanApproval: requireHuman })}>保存门禁策略</Button></CardContent></Card></div>
      </div> : null}

      <Dialog open={caseDialogOpen} onOpenChange={setCaseDialogOpen}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>新建金标用例</DialogTitle><DialogDescription>请粘贴已脱敏的真实上下文；此操作不会调用模型或修改Skill。</DialogDescription></DialogHeader><div className="space-y-3 max-h-[65vh] overflow-y-auto"><div><Label>用例名称</Label><Input value={caseName} onChange={(event) => setCaseName(event.target.value)} /></div><div><Label>输入上下文（JSON）</Label><textarea value={caseContext} onChange={(event) => setCaseContext(event.target.value)} className="mt-1 min-h-28 w-full rounded-md border bg-background p-3 font-mono text-xs" /></div><div><Label>期望约束（JSON）</Label><textarea value={caseConstraints} onChange={(event) => setCaseConstraints(event.target.value)} className="mt-1 min-h-24 w-full rounded-md border bg-background p-3 font-mono text-xs" /></div><div><Label>评分量表（JSON）</Label><textarea value={caseRubric} onChange={(event) => setCaseRubric(event.target.value)} className="mt-1 min-h-32 w-full rounded-md border bg-background p-3 font-mono text-xs" /></div></div><DialogFooter><Button variant="outline" onClick={() => setCaseDialogOpen(false)}>取消</Button><Button disabled={createCase.isPending} onClick={() => { try { createCase.mutate({ skillSlug, name: caseName, status: "draft", inputContext: safeJson(caseContext, "输入上下文"), expectedConstraints: safeJson(caseConstraints, "期望约束"), rubric: safeJson(caseRubric, "评分量表") }); } catch (error: any) { toast.error(error.message); } }}>保存草稿</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(resultCase)} onOpenChange={(open) => !open && setResultCase(null)}><DialogContent><DialogHeader><DialogTitle>录入人工评测</DialogTitle><DialogDescription>{resultCase?.name} · 仅记录人工判断，不触发模型生成。</DialogDescription></DialogHeader><div className="space-y-3"><div><Label>总分（0–100）</Label><Input type="number" min="0" max="100" value={score} onChange={(event) => setScore(event.target.value)} /></div><div><Label>评测反馈</Label><textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} className="mt-1 min-h-24 w-full rounded-md border bg-background p-3 text-sm" placeholder="说明该候选版本为何通过或需要改进" /></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={passed} onChange={(event) => setPassed(event.target.checked)} />本用例通过</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={humanApproved} onChange={(event) => setHumanApproved(event.target.checked)} />人工批准计入发布门禁</label></div><DialogFooter><Button variant="outline" onClick={() => setResultCase(null)}>取消</Button><Button disabled={recordResult.isPending} onClick={() => recordResult.mutate({ caseId: resultCase.caseId, skillSlug, snapshotId: replayToReview?.snapshotId || null, skillVersion: replayToReview?.skillVersion || String(selectedSkill?.version ?? "1"), score: Number(score), passed, humanApproved, feedback, outputSummary: replayToReview?.outputSummary || undefined })}>保存人工评分</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={Boolean(replayToReview) && !resultCase} onOpenChange={(open) => !open && setReplayToReview(null)}><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>候选版本回放报告</DialogTitle><DialogDescription>仅供人工决策；回放不会发布、替换或回滚Skill。</DialogDescription></DialogHeader><ScrollArea className="max-h-[55vh] pr-3"><div className="space-y-3 text-sm"><div className="flex gap-2"><Badge>v{replayToReview?.skillVersion}</Badge><Badge variant={replayToReview?.constraintEvaluation?.passed || replayToReview?.outputSummary?.constraintEvaluation?.passed ? "default" : "destructive"}>{replayToReview?.constraintEvaluation?.passed || replayToReview?.outputSummary?.constraintEvaluation?.passed ? "约束通过" : "存在约束问题"}</Badge></div><pre className="rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-words">{replayToReview?.output || replayToReview?.outputSummary?.output || "无输出"}</pre></div></ScrollArea><DialogFooter><Button variant="outline" onClick={() => setReplayToReview(null)}>关闭</Button><Button onClick={() => setResultCase(cases.find((item: any) => item.caseId === replayToReview?.caseId) || null)}>基于此回放录入人工评分</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}
