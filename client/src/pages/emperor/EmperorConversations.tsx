import { useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BookOpenCheck, Bot, FileUp, Loader2, MessageSquarePlus, Play, RotateCcw, Send, ShieldCheck, Sparkles, Workflow } from "lucide-react";
import { toast } from "sonner";

type DraftStep = { title: string; description: string; capabilityType: "skill" | "agent" | "tool"; capabilitySlug: string; riskLevel: "L0" | "L1" | "L2" | "L3"; approvalRequired: boolean };

const statusTone: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700", planning: "bg-blue-50 text-blue-700", awaiting_plan_confirmation: "bg-amber-50 text-amber-700", waiting_human: "bg-orange-50 text-orange-700", running: "bg-violet-50 text-violet-700", completed: "bg-emerald-50 text-emerald-700", failed: "bg-rose-50 text-rose-700",
};

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ""));
    reader.readAsDataURL(file);
  });
}

export default function EmperorConversations() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const conversations = trpc.emperor.conversations.list.useQuery();
  const capabilities = trpc.emperor.conversations.capabilities.useQuery();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [draftSteps, setDraftSteps] = useState<DraftStep[]>([]);
  const [selectedType, setSelectedType] = useState<DraftStep["capabilityType"]>("skill");
  const [selectedSlug, setSelectedSlug] = useState("");
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [knowledgeSource, setKnowledgeSource] = useState<"all" | "emperor_memory" | "amz_ops_skill">("all");
  const [plannerError, setPlannerError] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<{ stepId: string; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const detail = trpc.emperor.conversations.get.useQuery({ conversationId: activeId || "" }, { enabled: Boolean(activeId) });
  const knowledgeCandidates = trpc.emperor.conversations.knowledgeCandidates.useQuery({ query: knowledgeQuery || undefined, sourceKind: knowledgeSource, limit: 8 }, { enabled: Boolean(activeId) });

  const suggestPlan = trpc.emperor.conversations.suggestPlan.useMutation({
    onSuccess: (suggestion) => {
      setPlannerError(null);
      setGoal(suggestion.goal);
      setDraftSteps(suggestion.steps);
      void detail.refetch();
      toast.success(suggestion.steps.length ? "AI已生成可编辑候选计划" : "AI已记录待澄清问题，请补充目标或附件");
    },
    onError: (error) => {
      setDraftSteps([]);
      setPlannerError("模型服务暂时不可用。你的消息、附件和知识引用已保留；未生成、提交或运行任何计划步骤。");
      toast.error(error.message);
    },
  });

  const create = trpc.emperor.conversations.create.useMutation({
    onSuccess: ({ conversationId }) => { setActiveId(conversationId); setTitle(""); void utils.emperor.conversations.list.invalidate(); toast.success("已创建对话任务"); },
    onError: (error) => toast.error(error.message),
  });
  const addMessage = trpc.emperor.conversations.addMessage.useMutation({
    onSuccess: () => { setMessage(""); void detail.refetch(); void utils.emperor.conversations.list.invalidate(); }, onError: (error) => toast.error(error.message),
  });
  const upload = trpc.emperor.conversations.uploadAttachment.useMutation({ onSuccess: () => { void detail.refetch(); toast.success("附件已受控登记"); }, onError: (error) => toast.error(error.message) });
  const addKnowledge = trpc.emperor.conversations.addKnowledgeReference.useMutation({ onSuccess: () => { void detail.refetch(); toast.success("知识摘要已作为受控上下文引用"); }, onError: (error) => toast.error(error.message) });
  const propose = trpc.emperor.conversations.proposePlan.useMutation({ onSuccess: () => { void detail.refetch(); setDraftSteps([]); toast.success("已生成可编辑待确认计划"); }, onError: (error) => toast.error(error.message) });
  const approvePlan = trpc.emperor.conversations.approvePlan.useMutation({ onSuccess: () => { void detail.refetch(); toast.success("计划已批准；高风险步骤仍需单独确认"); }, onError: (error) => toast.error(error.message) });
  const approveStep = trpc.emperor.conversations.approveStep.useMutation({ onSuccess: () => void detail.refetch(), onError: (error) => toast.error(error.message) });
  const runStep = trpc.emperor.conversations.runStep.useMutation({ onSuccess: () => { void detail.refetch(); toast.success("已委派给受治理运行通道"); }, onError: (error) => toast.error(error.message) });
  const recoverStep = trpc.emperor.conversations.recoverStep.useMutation({
    onSuccess: (result) => {
      setRecoveryError(null);
      void detail.refetch();
      toast.success(result.replayed ? "已返回已有恢复结果" : "步骤已恢复至待运行状态；请人工确认后运行");
    },
    onError: (error, variables) => {
      const sourceInvalidated = error.message.includes("上下文来源已失效") || error.message.includes("context_source_invalidated");
      const message = sourceInvalidated
        ? "上下文来源已失效，系统已阻止恢复。请重新生成或重新编译计划，并在核对最新附件/知识摘要后再次人工确认。"
        : error.message;
      setRecoveryError({ stepId: variables.stepId, message });
      toast.error(message);
    },
  });

  const available = useMemo(() => (selectedType === "skill" ? capabilities.data?.skills : selectedType === "agent" ? capabilities.data?.agents : capabilities.data?.tools) || [], [capabilities.data, selectedType]);
  const activePlan = detail.data?.plans?.find((plan: any) => plan.planId === detail.data?.conversation?.activePlanId) || detail.data?.plans?.[0];
  const activeSteps = detail.data?.steps?.filter((step: any) => step.planId === activePlan?.planId) || [];

  async function submitMessage() {
    if (!message.trim()) return;
    const goalText = message.trim();
    if (!activeId) {
      const created = await create.mutateAsync({ title: title.trim() || goalText.slice(0, 40), initialMessage: goalText });
      await suggestPlan.mutateAsync({ conversationId: created.conversationId, goal: goalText });
      setMessage("");
      return;
    }
    await addMessage.mutateAsync({ conversationId: activeId, content: goalText });
    await suggestPlan.mutateAsync({ conversationId: activeId, goal: goalText });
  }
  async function onFile(file?: File) {
    if (!file) return;
    if (!activeId) { toast.error("请先创建或选择一个对话任务"); return; }
    if (file.size > 15 * 1024 * 1024) { toast.error("附件最大为15MB"); return; }
    try { upload.mutate({ conversationId: activeId, fileName: file.name, mimeType: file.type || "application/octet-stream", contentBase64: await fileToBase64(file), contextPolicy: file.type.startsWith("image/") ? "image_vision" : file.type.startsWith("text/") ? "extracted_text" : "summary_only" }); } catch (error) { toast.error(error instanceof Error ? error.message : "附件准备失败"); }
  }
  function addDraftStep() {
    if (!selectedSlug) { toast.error("请选择已登记的Skill、Agent或Tool"); return; }
    const capability = available.find((item: any) => item.slug === selectedSlug);
    if (!capability) { toast.error("该能力已不可用，请重新选择"); return; }
    setDraftSteps((items) => [...items, { title: capability.name || selectedSlug, description: capability.description || "", capabilityType: selectedType, capabilitySlug: selectedSlug, riskLevel: selectedType === "tool" ? "L2" : "L1", approvalRequired: selectedType === "tool" }]);
    setSelectedSlug("");
  }
  function submitPlan() {
    if (!activeId || !goal.trim() || !draftSteps.length) { toast.error("请输入目标并至少添加一个执行步骤"); return; }
    propose.mutate({ conversationId: activeId, goal: goal.trim(), steps: draftSteps });
  }

  return <div className="mx-auto flex h-[calc(100vh-7rem)] max-w-[1680px] gap-4 p-4">
    <Card className="flex w-[260px] shrink-0 flex-col overflow-hidden border-slate-200 shadow-sm">
      <CardHeader className="border-b bg-slate-50/80 p-4"><div className="flex items-center justify-between"><CardTitle className="text-base">任务会话</CardTitle><Button size="icon" variant="outline" onClick={() => setActiveId(null)} aria-label="新建对话"><MessageSquarePlus className="h-4 w-4" /></Button></div></CardHeader>
      <div className="border-b p-3"><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="新对话标题（可选）" /></div>
      <ScrollArea className="flex-1"><div className="space-y-1 p-2">{conversations.data?.map((conversation: any) => <button key={conversation.conversationId} onClick={() => setActiveId(conversation.conversationId)} className={`w-full rounded-lg p-3 text-left transition ${activeId === conversation.conversationId ? "bg-violet-50 ring-1 ring-violet-200" : "hover:bg-slate-50"}`}><p className="truncate text-sm font-medium text-slate-800">{conversation.title}</p><div className="mt-2 flex items-center justify-between"><span className="text-xs text-slate-400">{new Date(conversation.updatedAt).toLocaleDateString()}</span><Badge variant="secondary" className={`border-0 text-[10px] ${statusTone[conversation.status] || ""}`}>{conversation.status}</Badge></div></button>)}{!conversations.data?.length && <p className="p-4 text-center text-sm text-slate-400">创建对话后可在此追踪所有计划与运行。</p>}</div></ScrollArea>
    </Card>

    <Card className="flex min-w-0 flex-1 flex-col overflow-hidden border-slate-200 shadow-sm">
      <CardHeader className="border-b bg-gradient-to-r from-violet-50 to-slate-50 p-4"><div className="flex items-center gap-3"><div className="rounded-xl bg-violet-600 p-2 text-white"><Sparkles className="h-4 w-4" /></div><div><CardTitle className="text-base">皇帝通用任务对话</CardTitle><p className="text-xs text-slate-500">附件仅作为受控上下文引用；每一步均受权限、计划和审计约束。</p></div></div></CardHeader>
      <ScrollArea className="flex-1"><div className="mx-auto max-w-3xl space-y-5 p-5">{!activeId && <div className="rounded-xl border border-dashed border-violet-200 bg-violet-50/40 p-6 text-center"><Bot className="mx-auto mb-3 h-8 w-8 text-violet-500" /><h2 className="font-semibold text-slate-800">从一个目标开始</h2><p className="mt-2 text-sm text-slate-500">描述任务，上传资料，再由你选择可调用的Skill、Agent或MCP工具组成计划。</p></div>}{detail.data?.messages?.map((item: any) => <div key={item.messageId} className={`flex ${item.role === "user" ? "justify-end" : "justify-start"}`}><div className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm ${item.role === "user" ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-700"}`}><p className="whitespace-pre-wrap">{item.content}</p><span className="mt-2 block text-[10px] opacity-60">{new Date(item.createdAt).toLocaleString()}</span></div></div>)}{detail.data?.attachments?.length ? <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="mb-2 text-xs font-semibold text-slate-500">受控上下文附件</p><div className="flex flex-wrap gap-2">{detail.data.attachments.map((attachment: any) => <Badge key={attachment.attachmentId} variant="outline" className="gap-1 py-1"><FileUp className="h-3 w-3" />{attachment.fileName}</Badge>)}</div></div> : null}{activeId ? <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-3"><div className="mb-2 flex items-center gap-2"><BookOpenCheck className="h-4 w-4 text-amber-700" /><p className="text-xs font-semibold text-amber-800">受控知识上下文</p></div><div className="flex gap-2"><Input value={knowledgeQuery} onChange={(event) => setKnowledgeQuery(event.target.value)} placeholder="检索已确认知识" className="h-8 text-xs" /><select value={knowledgeSource} onChange={(event) => setKnowledgeSource(event.target.value as typeof knowledgeSource)} className="h-8 rounded-md border border-amber-200 bg-white px-2 text-xs"><option value="all">全部知识源</option><option value="emperor_memory">皇帝知识</option><option value="amz_ops_skill">AMZ运营技能</option></select></div><div className="mt-2 space-y-1">{knowledgeCandidates.data?.map((item: any) => <div key={`${item.sourceKind}-${item.sourceId}`} className="flex items-center justify-between gap-2 rounded-md bg-white p-2"><div className="min-w-0"><p className="truncate text-xs font-medium text-slate-700">{item.title}</p><p className="text-[10px] text-slate-400">{item.sourceKind === "amz_ops_skill" ? "AMZ运营技能" : "皇帝知识"} · 已审核摘要</p></div><Button size="sm" variant="outline" className="h-7 text-xs" disabled={addKnowledge.isPending} onClick={() => addKnowledge.mutate({ conversationId: activeId, sourceKind: item.sourceKind, sourceId: item.sourceId })}>引用</Button></div>)}</div>{detail.data?.knowledgeRefs?.length ? <div className="mt-2 flex flex-wrap gap-1">{detail.data.knowledgeRefs.map((item: any) => <Badge key={item.referenceId} variant="secondary" className="max-w-full truncate text-[10px]">{item.title}</Badge>)}</div> : <p className="mt-2 text-[10px] text-amber-700">仅可引用当前工作空间中已激活或已审核的知识摘要。</p>}</div> : null}</div></ScrollArea>
      <div className="border-t bg-white p-4"><input ref={fileInputRef} type="file" className="hidden" accept="image/*,.txt,.md,.csv,.json,.pdf,.doc,.docx,.xlsx" onChange={(event) => { void onFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />{plannerError ? <div className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-xs leading-5 text-amber-900">{plannerError}</p><Button size="sm" variant="outline" className="shrink-0 border-amber-300 bg-white text-amber-900" disabled={!activeId || !goal.trim() || suggestPlan.isPending} onClick={() => suggestPlan.mutate({ conversationId: activeId!, goal: goal.trim() })}>重试规划</Button></div> : null}<div className="flex gap-2"><Button variant="outline" size="icon" onClick={() => fileInputRef.current?.click()} disabled={upload.isPending} aria-label="上传文件或图片">{upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}</Button><Textarea value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submitMessage(); }} placeholder="描述目标、补充约束，或粘贴需纳入计划的上下文…" className="min-h-[46px] resize-none" /><Button onClick={() => void submitMessage()} disabled={create.isPending || addMessage.isPending || suggestPlan.isPending || !message.trim()} aria-label="发送并生成候选计划">{create.isPending || addMessage.isPending || suggestPlan.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button></div><p className="mt-2 text-[11px] text-slate-400">发送后由皇帝规划Skill生成可编辑候选计划。任何高风险工具调用会在执行前单独请求确认。</p></div>
    </Card>

      <Card className="flex w-[360px] shrink-0 flex-col overflow-hidden border-slate-200 shadow-sm"><CardHeader className="border-b p-4"><div className="flex items-center gap-2"><Workflow className="h-4 w-4 text-violet-600" /><CardTitle className="text-base">可编辑执行计划</CardTitle></div></CardHeader><ScrollArea className="flex-1"><div className="space-y-4 p-4"><Textarea value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="计划目标：例如，基于附件分析库存风险并形成可确认建议" className="min-h-[82px]" /><Button variant="secondary" className="w-full" onClick={() => activeId && goal.trim() && suggestPlan.mutate({ conversationId: activeId, goal: goal.trim() })} disabled={!activeId || !goal.trim() || suggestPlan.isPending}>{suggestPlan.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}AI生成候选计划</Button><div className="grid grid-cols-2 gap-2"><select value={selectedType} onChange={(event) => { setSelectedType(event.target.value as DraftStep["capabilityType"]); setSelectedSlug(""); }} className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"><option value="skill">Skill</option><option value="agent">Agent</option><option value="tool">Tool / MCP</option></select><select value={selectedSlug} onChange={(event) => setSelectedSlug(event.target.value)} className="h-9 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm"><option value="">选择已登记能力</option>{available.map((item: any) => <option key={item.slug} value={item.slug}>{item.name || item.slug}</option>)}</select></div><Button variant="outline" className="w-full" onClick={addDraftStep}><Workflow className="mr-2 h-4 w-4" />添加计划步骤</Button><div className="space-y-2">{draftSteps.map((step, index) => <div key={`${step.capabilitySlug}-${index}`} className="rounded-lg border border-slate-200 p-3"><div className="flex items-start justify-between gap-2"><div><p className="text-sm font-medium text-slate-800">{index + 1}. {step.title}</p><p className="mt-1 line-clamp-2 text-xs text-slate-500">{step.description || step.capabilitySlug}</p></div><Badge variant="outline">{step.riskLevel}</Badge></div><button onClick={() => setDraftSteps((items) => items.filter((_, itemIndex) => itemIndex !== index))} className="mt-2 text-xs text-rose-600">移除</button></div>)}</div>{activePlan ? <div className="space-y-2 rounded-xl border border-violet-100 bg-violet-50/40 p-3"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-violet-700">当前计划 · {activePlan.status}</span>{activePlan.status === "proposed" && <Button size="sm" onClick={() => approvePlan.mutate({ conversationId: activeId!, planId: activePlan.planId })} disabled={approvePlan.isPending}><ShieldCheck className="mr-1 h-3.5 w-3.5" />批准计划</Button>}</div><p className="text-xs text-slate-600">{activePlan.goal}</p>{activeSteps.map((step: any) => <div key={step.stepId} className="rounded-lg bg-white p-2.5 shadow-sm"><div className="flex items-center justify-between gap-2"><p className="text-xs font-medium">{step.sequence}. {step.title}</p><Badge variant="secondary" className="text-[10px]">{step.status}</Badge></div><p className="mt-1 text-[11px] text-slate-500">{step.capabilityType} · {step.capabilitySlug}</p>{recoveryError?.stepId === step.stepId ? <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] leading-4 text-amber-900">{recoveryError.message}</div> : null}<div className="mt-2 flex gap-2">{step.approvalState === "pending" && <Button size="sm" variant="outline" onClick={() => approveStep.mutate({ conversationId: activeId!, stepId: step.stepId })}>确认步骤</Button>}{step.status === "ready" && <Button size="sm" onClick={() => runStep.mutate({ conversationId: activeId!, stepId: step.stepId })} disabled={runStep.isPending}><Play className="mr-1 h-3 w-3" />运行</Button>}{step.status === "failed" && step.capabilityType === "skill" && (step.riskLevel === "L0" || step.riskLevel === "L1") && <Button size="sm" variant="outline" onClick={() => { setRecoveryError(null); recoverStep.mutate({ conversationId: activeId!, stepId: step.stepId, expectedStateVersion: Number(step.stateVersion || 0) }); }} disabled={recoverStep.isPending}><RotateCcw className="mr-1 h-3 w-3" />恢复至待运行</Button>}{step.skillRunId && <Button size="sm" variant="outline" onClick={() => navigate(`/emperor/trace?runId=${encodeURIComponent(step.skillRunId)}`)}>运行详情</Button>}</div></div>)}</div> : null}</div></ScrollArea><div className="border-t p-4"><Button className="w-full" onClick={submitPlan} disabled={!activeId || !goal.trim() || !draftSteps.length || propose.isPending}>{propose.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}提交可确认计划</Button><button className="mt-3 w-full text-xs text-slate-400 hover:text-slate-600" onClick={() => navigate("/emperor/agents")}>需要复杂DAG？前往 Agent 编排</button></div></Card>
  </div>;
}
