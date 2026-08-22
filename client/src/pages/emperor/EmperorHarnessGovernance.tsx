import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Bot, CheckCircle2, GitFork, ShieldCheck, SlidersHorizontal, Wrench } from "lucide-react";
import { toast } from "sonner";

const MODE_LABELS: Record<string, string> = {
  standard: "标准业务", quality_first: "质量优先", batch_background: "批量后台", evaluation: "评测",
};

export default function EmperorHarnessGovernance() {
  const utils = trpc.useUtils();
  const [reviewTitle, setReviewTitle] = useState("");
  const [reviewReason, setReviewReason] = useState("");
  const [reviewResolution, setReviewResolution] = useState("");
  const [reviewType, setReviewType] = useState<"review_required" | "approval_required" | "selection_required">("review_required");
  const [agentRunId, setAgentRunId] = useState("");
  const [branchIds, setBranchIds] = useState("");
  const [mergeNodeId, setMergeNodeId] = useState("");
  const [concurrency, setConcurrency] = useState("2");
  const [parallelApprovalReason, setParallelApprovalReason] = useState("");

  const { data: presets = [] } = trpc.emperor.skills.executionPresets.useQuery();
  const { data: reviews = [] } = trpc.emperor.skills.reviewRequests.useQuery();
  const { data: parallelPlans = [] } = trpc.emperor.skills.parallelPlans.useQuery();
  const { data: tools = [] } = trpc.emperor.tools.list.useQuery();
  const refresh = () => Promise.all([
    utils.emperor.skills.executionPresets.invalidate(), utils.emperor.skills.reviewRequests.invalidate(),
    utils.emperor.skills.parallelPlans.invalidate(), utils.emperor.tools.list.invalidate(),
  ]);
  const seedPresets = trpc.emperor.skills.seedExecutionPresets.useMutation({ onSuccess: () => { toast.success("运行Preset已登记"); void refresh(); }, onError: (e) => toast.error(e.message) });
  const seedTools = trpc.emperor.tools.seedBuiltins.useMutation({ onSuccess: () => { toast.success("受治理Tool已登记"); void refresh(); }, onError: (e) => toast.error(e.message) });
  const createReview = trpc.emperor.skills.createReviewRequest.useMutation({ onSuccess: () => { toast.success("人工审核请求已创建"); setReviewTitle(""); setReviewReason(""); void refresh(); }, onError: (e) => toast.error(e.message) });
  const resolveReview = trpc.emperor.skills.resolveReviewRequest.useMutation({ onSuccess: () => { toast.success("人工决定已写入审核账本"); setReviewResolution(""); void refresh(); }, onError: (e) => toast.error(e.message) });
  const createParallel = trpc.emperor.skills.createParallelPlan.useMutation({ onSuccess: () => { toast.success("受控并行计划已创建，仍需人工批准和合并节点"); setBranchIds(""); void refresh(); }, onError: (e) => toast.error(e.message) });
  const parallelPreview = trpc.emperor.skills.previewParallelPlan.useQuery(
    { agentRunId: agentRunId.trim() || "pending", branchNodeIds: branchIds.split(",").map((value) => value.trim()).filter(Boolean).slice(0, 8) },
    { enabled: false, retry: false },
  );
  const approveParallel = trpc.emperor.skills.approveParallelPlanDraft.useMutation({ onSuccess: () => { toast.success("并行草稿已人工批准；系统仍不会自动调度分支"); setParallelApprovalReason(""); void refresh(); }, onError: (e) => toast.error(e.message) });
  const builtinTools = useMemo(() => tools.filter((tool: any) => tool.source === "builtin"), [tools]);

  return <div className="p-6 max-w-[1500px] mx-auto space-y-6">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <div className="flex items-center gap-2"><ShieldCheck className="h-6 w-6 text-violet-500" /><h1 className="text-2xl font-bold">Harness 治理中心</h1></div>
        <p className="mt-2 text-sm text-muted-foreground">统一管理人工审批协议、运行Preset、受治理业务Tool、反馈归因和受控并行。所有变更默认不影响线上Skill版本。</p>
      </div>
      <Badge variant="outline" className="w-fit border-emerald-300 text-emerald-700">默认安全兼容 · 人工决定</Badge>
    </div>

    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Card><CardHeader className="pb-2"><CardDescription>运行Preset</CardDescription><CardTitle className="text-2xl">{presets.length}</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">标准、质量、批量与评测四种模式</CardContent></Card>
      <Card><CardHeader className="pb-2"><CardDescription>受治理Tool</CardDescription><CardTitle className="text-2xl">{builtinTools.length}</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">统一Schema、权限、限流与审计</CardContent></Card>
      <Card><CardHeader className="pb-2"><CardDescription>待决人审</CardDescription><CardTitle className="text-2xl">{reviews.filter((review: any) => review.status === "open").length}</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">审核、批准与候选选择分型</CardContent></Card>
      <Card><CardHeader className="pb-2"><CardDescription>并行计划</CardDescription><CardTitle className="text-2xl">{parallelPlans.length}</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">默认仅创建证据分支草稿</CardContent></Card>
    </div>

    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" />运行Preset</CardTitle><CardDescription>每种模式同时声明上下文预算、Tool范围、并发上限和人工审批等级。</CardDescription></div><Button size="sm" variant="outline" onClick={() => seedPresets.mutate()} disabled={seedPresets.isPending}>登记系统Preset</Button></div></CardHeader>
        <CardContent className="space-y-3">{presets.map((preset: any) => <div key={preset.presetSlug} className="rounded-lg border p-3"><div className="flex items-center justify-between gap-2"><p className="font-medium">{preset.name}</p><Badge variant="secondary">{MODE_LABELS[preset.mode] || preset.mode}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{preset.description}</p><p className="mt-2 text-xs"><span className="font-medium">模型策略：</span>{preset.config?.modelStrategy || "skill_configured"}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{JSON.stringify(preset.config)}</p></div>)}</CardContent>
      </Card>
      <Card>
        <CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><Wrench className="h-4 w-4" />受治理业务Tool</CardTitle><CardDescription>所有Adapter均经Tool Gateway治理；没有合法连接、范围或审批上下文时会明确拒绝。</CardDescription></div><Button size="sm" variant="outline" onClick={() => seedTools.mutate()} disabled={seedTools.isPending}>登记内置Tool</Button></div></CardHeader>
        <CardContent className="space-y-2">{builtinTools.map((tool: any) => <div key={tool.slug} className="flex items-start justify-between gap-3 rounded-lg border p-3"><div><p className="text-sm font-medium">{tool.name}</p><p className="mt-1 text-xs text-muted-foreground">{tool.description}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{tool.slug}</p></div><Badge variant="outline">{tool.type}</Badge></div>)}<p className="rounded-md bg-amber-50 p-3 text-xs text-amber-800"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />外部数据、领星和导出Adapter仅完成受治理注册；未配置连接时不会发起外部请求。Shell始终拒绝。</p></CardContent>
      </Card>
    </div>

    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />统一人工审批协议</CardTitle><CardDescription>将旧的等待人工确认细分为审核、批准与候选选择，不改变既有状态机的兼容行为。</CardDescription></CardHeader>
        <CardContent className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><div><Label>协议类型</Label><Select value={reviewType} onValueChange={(value: any) => setReviewType(value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="review_required">需要审核</SelectItem><SelectItem value="approval_required">需要批准</SelectItem><SelectItem value="selection_required">需要选择</SelectItem></SelectContent></Select></div><div><Label>请求标题</Label><Input value={reviewTitle} onChange={(e) => setReviewTitle(e.target.value)} placeholder="例如：确认候选Listing版本" /></div></div><div><Label>人工说明</Label><Textarea value={reviewReason} onChange={(e) => setReviewReason(e.target.value)} placeholder="说明要审核的风险、候选和决定标准" /></div><Button disabled={!reviewTitle.trim() || reviewReason.trim().length < 2 || createReview.isPending} onClick={() => createReview.mutate({ title: reviewTitle.trim(), requestedReason: reviewReason.trim(), requestType: reviewType })}>创建人审请求</Button><div className="space-y-2">{reviews.filter((review: any) => !review.candidateSummary?.parallelPlanId).slice(0, 12).map((review: any) => <div key={review.reviewId} className="rounded border p-3 text-xs"><div className="flex justify-between gap-2"><span className="font-medium">{review.title}</span><Badge variant={review.status === "open" ? "secondary" : "outline"}>{review.requestType} · {review.status}</Badge></div><p className="mt-1 text-muted-foreground">{review.requestedReason || "未填写说明"}</p>{review.status === "open" ? <div className="mt-3 space-y-2"><Input value={reviewResolution} onChange={(event) => setReviewResolution(event.target.value)} placeholder="填写审批、拒绝、选择或取消理由（至少2字）" /><div className="flex flex-wrap gap-2"><Button size="sm" disabled={reviewResolution.trim().length < 2 || resolveReview.isPending} onClick={() => resolveReview.mutate({ reviewId: review.reviewId, status: "approved", reason: reviewResolution.trim() })}>批准</Button><Button size="sm" variant="outline" disabled={reviewResolution.trim().length < 2 || resolveReview.isPending} onClick={() => resolveReview.mutate({ reviewId: review.reviewId, status: review.requestType === "selection_required" ? "selected" : "rejected", reason: reviewResolution.trim() })}>{review.requestType === "selection_required" ? "确认选择" : "拒绝"}</Button><Button size="sm" variant="ghost" disabled={reviewResolution.trim().length < 2 || resolveReview.isPending} onClick={() => resolveReview.mutate({ reviewId: review.reviewId, status: "canceled", reason: reviewResolution.trim() })}>取消</Button></div></div> : <p className="mt-2 text-muted-foreground">决定：{review.resolutionReason || "未记录"}</p>}</div>)}</div></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><GitFork className="h-4 w-4" />受控并行子Agent</CardTitle><CardDescription>仅创建独立证据分支草稿。合并、写入和业务发布仍必须由明确合并节点与人工决定完成。</CardDescription></CardHeader>
        <CardContent className="space-y-3"><div><Label>Agent Run ID</Label><Input value={agentRunId} onChange={(e) => setAgentRunId(e.target.value)} placeholder="agent_run_..." /></div><div className="grid gap-3 sm:grid-cols-2"><div><Label>独立分支节点ID（逗号分隔，2–8个）</Label><Input value={branchIds} onChange={(e) => setBranchIds(e.target.value)} placeholder="research_a,research_b" /></div><div><Label>合并节点ID（可选）</Label><Input value={mergeNodeId} onChange={(e) => setMergeNodeId(e.target.value)} placeholder="merge_evidence" /></div></div><div><Label>最大并发（1–4）</Label><Input type="number" min="1" max="4" value={concurrency} onChange={(e) => setConcurrency(e.target.value)} /></div><Button variant="outline" disabled={!agentRunId.trim() || branchIds.split(",").filter(Boolean).length < 2 || parallelPreview.isFetching} onClick={() => void parallelPreview.refetch()}>预览并行资格</Button>{parallelPreview.data ? <div className={`rounded border p-3 text-xs ${parallelPreview.data.eligible ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}><p className="font-medium">{parallelPreview.data.eligible ? "可创建审批草稿" : "不可并行，必须保持串行"}</p>{parallelPreview.data.reasons?.map((reason: any, index: number) => <p key={`${reason.code}-${index}`} className="mt-1 text-muted-foreground">{reason.message}</p>)}<p className="mt-2 text-muted-foreground">仅草稿与人工批准；不会启动分支执行。</p></div> : null}<Button disabled={!parallelPreview.data?.eligible || createParallel.isPending} onClick={() => createParallel.mutate({ agentRunId: agentRunId.trim(), branchNodeIds: branchIds.split(",").map((value) => value.trim()).filter(Boolean), mergeNodeId: mergeNodeId.trim() || null, maxConcurrency: Number(concurrency) || 1 })}>创建并行计划草稿</Button><div className="space-y-2">{parallelPlans.slice(0, 6).map((plan: any) => <div key={plan.parallelPlanId} className="rounded border p-2 text-xs"><div className="flex justify-between gap-2"><span className="font-medium">{plan.agentRunId}</span><Badge variant="outline">{plan.status} · 最大并发 {plan.maxConcurrency}</Badge></div><p className="mt-1 text-muted-foreground">{(plan.branches || []).map((branch: any) => branch.nodeId).join(" · ") || "无分支"}</p>{plan.status === "draft" && plan.policy?.reviewId ? <div className="mt-2 space-y-2"><Input value={parallelApprovalReason} onChange={(event) => setParallelApprovalReason(event.target.value)} placeholder="填写批准理由（至少2字）" /><Button size="sm" disabled={parallelApprovalReason.trim().length < 2 || approveParallel.isPending} onClick={() => approveParallel.mutate({ parallelPlanId: plan.parallelPlanId, reviewId: plan.policy.reviewId, reason: parallelApprovalReason.trim() })}>人工批准草稿（不执行）</Button></div> : null}{plan.status === "approved" ? <p className="mt-2 text-amber-700">已批准，仅保留草稿；尚未、也不会自动调度并行分支。</p> : null}</div>)}</div></CardContent>
      </Card>
    </div>

    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Bot className="h-4 w-4" />人工选择反馈归因</CardTitle><CardDescription>Listing、图片、产品开发等统一Artifact的选择、确认和回退会以非阻断方式写入结构化反馈信号，保留候选版本、理由、业务域和后续结果。该信号仅用于人工审核的金标与评测候选，不会直接训练模型或修改Prompt。</CardDescription></CardHeader></Card>
    <Card><CardHeader><CardTitle>备案恢复后的真实业务验收清单</CardTitle><CardDescription>以下操作必须在青岛独立站登录后由管理员以真实业务数据完成；在此之前，系统仅保持默认兼容和不自动变更。</CardDescription></CardHeader><CardContent className="grid gap-2 text-sm md:grid-cols-2"><p className="rounded border p-3">1. 在真实Agent节点选择质量或评测Preset，核对模型策略、上下文预算和Tool范围。</p><p className="rounded border p-3">2. 触发审核、批准与选择三类请求，写入人工决定后在Run Ledger核对审计事件。</p><p className="rounded border p-3">3. 用真实Artifact选择或回退检查反馈信号，再审核是否纳入金标候选。</p><p className="rounded border p-3">4. 创建独立证据分支计划；仅在合并节点与人工决定后验证结果，不允许业务写入并行化。</p><p className="rounded border p-3 md:col-span-2">5. 对外部Tool逐项配置连接与范围后执行只读验证；未配置时必须显示明确拒绝，不得降级为任意网络或Shell调用。</p></CardContent></Card>
  </div>;
}
