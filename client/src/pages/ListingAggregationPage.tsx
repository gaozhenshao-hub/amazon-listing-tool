import GenerationOptionsDialog from "./listing/GenerationOptionsDialog";
import { ManualText, manuallyEdited, manualTextClass } from "./listing/ManualText";
import { recordManualResearch } from "@shared/researchEditing";
import QuestionOrigins from "./listing/QuestionOrigins";
import TaskFeedbackDialog from "./listing/TaskFeedbackDialog";
import ResearchFindings from "./listing/ResearchFindings";
import ProductPhotoPanel from "./listing/ProductPhotoPanel";
import { useResearchLock,ResearchLockButton } from "./listing/ResearchLock";
import { researchCategory,researchCategories } from "@shared/researchCategories";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { MessageSquare, Undo2, Redo2, Send } from "lucide-react";
import ProjectSelector from "@/components/ProjectSelector";
import { useProject } from "@/contexts/ProjectContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { emptyListingAggregation,
  aggregationConceptKey, sellingGroupLabels,
  featureGroupLabels,
  type ListingAggregation,
} from "@shared/listingAggregation";
import type { GraphNode } from "@shared/featureBenefitEditing";
import ListingStages from "./listing/ListingStages";
import FeatureBenefitBoard from "./listing/FeatureBenefitBoard";
import AggregationSourceEvidence from "./listing/AggregationSourceEvidence";
import { AggregationReviewEvidenceDialog } from "./listing/ReviewEvidenceDialog";

type Tab = "selling" | "reviews" | "questions";
type Chat = Array<{ role: "user" | "assistant"; text: string }>;
const labels = { manual: "手动添加", uploaded: "上传的问题", review: "评论", listing: "Listing", inferred: "AI 推测",
} as const;
function Overview({ data, section }: { data: ListingAggregation;section?:Tab }) {
  return (
    <div className="space-y-4 text-sm">
      {(!section || section==="selling") && <div className="grid gap-4 md:grid-cols-2">
        <section>
          <h3 className="mb-2 font-semibold">功能</h3>
          {(data.features || []).map(n => (
            <p key={n.id} className="mb-2 rounded border p-2">
              <small className="text-muted-foreground">
                {researchCategories[researchCategory(n)].name}
              </small>{" "}
              · <ManualText text={n.text} manual={manuallyEdited(n,"text")} />
              {n.note && (
                <span className="mt-1 block text-xs text-muted-foreground">
                  <ManualText text={n.note} manual={manuallyEdited(n,"note")} />
                </span>
              )}
            </p>
          ))}
        </section>
        <section>
          <h3 className="mb-2 font-semibold">用户获益</h3>
          {data.selling.map(n => (
            <p key={n.id} className="mb-2 rounded border p-2">
              <small className="text-muted-foreground">
                {researchCategories[researchCategory(n)].name}
              </small>{" "}
              · <ManualText text={n.text} manual={manuallyEdited(n,"text")} />
              {n.note && (
                <span className="mt-1 block text-xs text-muted-foreground">
                  <ManualText text={n.note} manual={manuallyEdited(n,"note")} />
                </span>
              )}
            </p>
          ))}
        </section>
      </div>}
      {(!section || section==="selling") && <p className="text-muted-foreground">
        {data.links?.length || 0} 条功能与卖点关联
      </p>}
      {(!section || section==="reviews") && <section>
        <h3 className="mb-2 font-semibold">评论归并</h3>
        {data.reviews.map(n => (
          <p key={n.id} className="mb-2 rounded border p-2">
            {n.sentiment === "positive" ? "好评" : "差评"} · <ManualText text={n.text} manual={manuallyEdited(n,"text")} />
            {n.count !== undefined && " · " + n.count + " 条"}
            {n.percentage !== null && " · " + n.percentage + "%"}
            <small className="mt-1 block text-muted-foreground"><ManualText text={n.note} manual={manuallyEdited(n,"note")} /></small>
          </p>
        ))}
      </section>}
      {(!section || section==="questions") && <section><h3 className="mb-2 font-semibold">买家问题与回答</h3>{data.questions.map(q=><article key={q.id} className="mb-2 rounded border p-2"><small className={"mb-1 block text-xs "+researchCategories[researchCategory(q)].className}>{researchCategories[researchCategory(q)].name}</small><strong>{q.text}</strong>{q.manual && <small className="ml-2 rounded bg-amber-100 px-1 text-amber-900">人工已修改</small>}<p className="mt-1 text-xs">{q.answer || "待整理回答"}</p><QuestionOrigins question={q}/></article>)}</section>}
    </div>
  );
}
export default function ListingAggregationPage() {
  const { selectedProjectId } = useProject(),
    utils = trpc.useUtils();
  const latestProject=useRef(selectedProjectId);latestProject.current=selectedProjectId;
  const [tab, setTab] = useState<Tab>("selling"),
    [draft, setDraft] = useState<ListingAggregation>(emptyListingAggregation),
    [revision, setRevision] = useState(0),
    [loadedProject, setLoadedProject] = useState<number | null>(null),
    [dirty, setDirty] = useState(false);
  const lock=useResearchLock(selectedProjectId,tab);
  const [past, setPast] = useState<ListingAggregation[]>([]),
    [future, setFuture] = useState<ListingAggregation[]>([]);
  const [sourceNode, setSourceNode] = useState<GraphNode | null>(null),
    [evidence,setEvidence]=useState<{id:string;name:string } | null>(
      null
    );
  const [generation, setGeneration] = useState<{
    data: ListingAggregation;
    revision: number;
    section?: Tab;
    runId:string;
    previewRevision:number;
    history?:Chat;
  }|null>(null);
  const [rerunOpen,setRerunOpen]=useState(false),[refineOpen,setRefineOpen]=useState(false),[refineMessage,setRefineMessage]=useState("");
  const [adjustOpen,setAdjustOpen]=useState(false),[message,setMessage]=useState(""),
    [chat,setChat]=useState<Chat>([]),
    [preview,setPreview]=useState<ListingAggregation|null>(null);
  const [baseline, setBaseline] = useState<
    { revision: number; sourceHash: string } | undefined
  >();
  const operationId = useRef(crypto.randomUUID());
  const query = trpc.analysis.getAggregation.useQuery({ projectId: selectedProjectId! }, { enabled: !!selectedProjectId, refetchOnWindowFocus: false });
  const save = trpc.analysis.saveAggregation.useMutation(),
    generate = trpc.analysis.organizeResearch.useMutation(),
    adjust = trpc.analysis.adjustAggregation.useMutation(),
    confirm = trpc.analysis.confirmAggregationAdjustment.useMutation();
  const confirmProposal=trpc.analysis.confirmResearchPreview.useMutation(),dismissProposal=trpc.analysis.dismissResearchPreview.useMutation(),refineProposal=trpc.analysis.refineResearchPreview.useMutation();
  const proposalJob=trpc.analysis.researchOrganizationStatus.useQuery({projectId:selectedProjectId!,section:tab},{enabled:!!selectedProjectId,refetchInterval:q=>["queued","running"].includes(q.state.data?.status || "")?2500:false});
  const organizing=["queued","running"].includes(proposalJob.data?.status || "");
  const hasResult=!!draft.organized?.[tab] || (tab==="selling"?!!(draft.features?.length || draft.selling.length):!!draft[tab].length);
  const resultName=tab==="selling"?"卖点梳理":tab==="reviews"?"评论分析":"问题整理";
  const candidateReady=proposalJob.data?.status==="succeeded" && !!proposalJob.data.proposal;
  const taskLabel=candidateReady?resultName+"结果预览":organizing||generate.isPending?"正在整理…":tab==="selling"?"一键卖点梳理":tab==="reviews"?(hasResult?"一键重新评论分析":"一键评论分析"):(hasResult?"一键重新整理问题":"一键整理问题");
  async function openProposal(){const result=await proposalJob.refetch();const job=result.data;if(job?.proposal)setGeneration({...job.proposal,runId:job.runId});}
  function taskClick(){if(candidateReady){void openProposal();return;}if(tab==="selling" || hasResult)setRerunOpen(true);else void generateDraft();}
  useEffect(() => {
    if (selectedProjectId !== loadedProject && query.data) {
      setDraft(query.data.data); setRevision(query.data.revision); setLoadedProject(selectedProjectId); setDirty(false);
      setPast([]);setRerunOpen(false);setRefineOpen(false);
      setFuture([]);setGeneration(null);setAdjustOpen(false);setPreview(null);setChat([]);setSourceNode(null);setEvidence(null);
    }
  }, [query.data, selectedProjectId, loadedProject]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  const change = (value: ListingAggregation) => {
    if(lock.locked)return;
    setPast(p => [...p.slice(-49), draft]);
    setFuture([]);
    setDraft(tab === "selling" ? recordManualResearch(draft, value) : value); setDirty(true); };
  const undo = () => {
    if (lock.locked || !past.length) return;
    setFuture([draft, ...future]);
    setDraft(past[past.length - 1]);
    setPast(past.slice(0, -1));
    setDirty(true); };
  const redo = () => {
    if (lock.locked || !future.length) return;
    setPast([...past, draft]);
    setDraft(future[0]);
    setFuture(future.slice(1));
    setDirty(true);
  };
  function accept(result: { data: ListingAggregation; revision: number }) {
    if(latestProject.current!==selectedProjectId)return;
    utils.analysis.getAggregation.setData(
      { projectId: selectedProjectId! },
      result
    );
    setDraft(result.data);
    setRevision(result.revision);
    setDirty(false);
  }
  async function saveDraft(value = draft, expected = revision, generationSection?:Tab) {
    if (!selectedProjectId || loadedProject !== selectedProjectId) return false;
    try {
      const result=await save.mutateAsync({projectId:selectedProjectId,revision:expected,data:value,generationSection});
      if(latestProject.current!==selectedProjectId)return false;
      accept(result);
      void utils.analysis.researchOrganizationStatus?.invalidate({projectId:selectedProjectId,section:generationSection || tab});
      toast.success("聚合分析已保存");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
      return false;
    }
  }
  async function generateDraft(feedback="", preserveManual=true) {
    if (!selectedProjectId || (tab !== "selling" && lock.locked)) return;
    if(dirty && !(await saveDraft()))return;
    try {
      const result=await generate.mutateAsync({projectId:selectedProjectId,section:tab,feedback,preserveManual});
      if(latestProject.current!==selectedProjectId)return;
      setRevision(result.revision);
      setRerunOpen(false);
      await proposalJob.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "汇总未完成");
    }
  }
  const editText = (text: string) => window.prompt("编辑内容", text)?.trim();
  const editNote = (note: string) => window.prompt("编辑详细标注", note);
  async function send() {
    if (!selectedProjectId || !message.trim()) return;
    const text = message.trim();
    try {
      const result = await adjust.mutateAsync({
        projectId: selectedProjectId,
        data: preview || draft, section:tab,
        message: text,
        history: chat,
        baseline,
      });
      if(latestProject.current!==selectedProjectId)return;
      setChat([
        ...chat,
        { role: "user", text },
        { role: "assistant", text: result.reply },
      ]);
      setPreview(result.data);
      setBaseline(result.baseline);
      setMessage("");
      operationId.current = crypto.randomUUID();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "调整暂未完成");
    }
  }
  async function confirmAdjustment(improve: boolean) {
    if (!selectedProjectId || !preview || !baseline || message.trim()) return;
    try {
      const result = await confirm.mutateAsync({
        projectId: selectedProjectId,
        data: preview, section:tab,
        baseline,
        history: chat,
        operationId: operationId.current,
        improve,
      });
      if(latestProject.current!==selectedProjectId)return;
      setPast([...past.slice(-49), draft]);
      setFuture([]);
      accept(result);
      setAdjustOpen(false);
      setPreview(null);
      toast.success(
        improve ? "调整已保存，并建立独立改进草稿" : "本次调整已保存"
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "确认未完成");
    }
  }
  const busy = save.isPending || confirm.isPending || generate.isPending || lock.pending || confirmProposal.isPending || dismissProposal.isPending || refineProposal.isPending;
  async function candidateAction(action:"confirm"|"cancel"){
    if(!selectedProjectId||!generation||!generation.section)return;
    const input={projectId:selectedProjectId,section:generation.section,runId:generation.runId,previewRevision:generation.previewRevision};
    try{if(action==="confirm"){const result=await confirmProposal.mutateAsync(input);if(latestProject.current!==selectedProjectId)return;setPast(p=>[...p.slice(-49),draft]);setFuture([]);accept(result);toast.success("已确认本次结果");}else{const result=await dismissProposal.mutateAsync(input);if(latestProject.current!==selectedProjectId)return;setRevision(result.revision);toast.success("已取消本次任务，原内容保留");}setGeneration(null);await proposalJob.refetch();}catch(e){toast.error(e instanceof Error?e.message:"操作未完成");}
  }
  async function refineCandidate(){if(!selectedProjectId||!generation?.section||!refineMessage.trim())return;try{await refineProposal.mutateAsync({projectId:selectedProjectId,section:generation.section,runId:generation.runId,previewRevision:generation.previewRevision,message:refineMessage.trim()});if(latestProject.current!==selectedProjectId)return;setRefineMessage("");await openProposal();}catch(e){toast.error(e instanceof Error?e.message:"改进未完成");}}
  return (
    <div className="min-w-0 space-y-5">
      <ListingStages />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">聚合分析</h1>
          <p className="text-sm text-muted-foreground">
            把功能、用户获益和来源关联起来，归并已有评论结论。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ProjectSelector
            beforeChange={() =>
              !dirty ||
              window.confirm("当前修改尚未保存，切换项目会丢失修改。是否继续？")
            }
          />
          <Button
            onClick={() => void saveDraft()}
            disabled={lock.locked || !dirty || busy || loadedProject !== selectedProjectId}
          >
            {save.isPending ? "保存中…" : dirty ? "保存修改" : "已保存"}
          </Button>
        </div>
      </header>
      {!selectedProjectId ? (
        <p>请先选择项目。</p>
      ) : query.error ? (
        <p role="alert">{query.error.message}</p>
      ) : loadedProject !== selectedProjectId ? (
        <p>正在读取聚合分析…</p>
      ) : (
        <>
          <div className="flex flex-wrap justify-between gap-3">
            <nav className="flex gap-2" aria-label="聚合分析分类">
              {(
                [
                  ["selling", "卖点梳理"],
                  ["reviews", "评论分析"],
                  ["questions", "买家问题库"],
                ] as const
              ).map(([key, label]) => (
                <Button
                  key={key}
                  variant={tab === key ? "default" : "outline"}
                  onClick={() => setTab(key)}
                >
                  {label}
                </Button>
              ))}
            </nav>
            <div className="flex flex-wrap gap-2">
              <ResearchLockButton state={lock} beforeLock={async()=>!dirty || await saveDraft()} onRevision={r=>{if(latestProject.current===selectedProjectId)setRevision(r);}}/>
              <Button
                variant="outline"
                size="icon"
                aria-label="撤销"
                onClick={undo}
                disabled={lock.locked || !past.length || busy}
              >
                <Undo2 className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="重做"
                onClick={redo}
                disabled={lock.locked || !future.length || busy}
              >
                <Redo2 className="h-4 w-4" />
              </Button>
              <Button
                className={tab==="selling"?"hidden":""}
                variant="outline"
                disabled={(!candidateReady && lock.locked) || organizing || busy}
                onClick={taskClick}
              >
                {taskLabel}
              </Button>
            </div>
          </div>
          {organizing && <p role="status" className="rounded border bg-muted/20 p-3 text-sm">小L正在整理当前板块。结果会保存为预览，不会自动覆盖人工修改。</p>}
          {proposalJob.data?.error && <p role="alert" className="text-sm text-destructive">{proposalJob.data.error}</p>}
          <fieldset
            disabled={busy}
            className={
              busy ? "pointer-events-none space-y-5 opacity-70" : "space-y-5"
            }
          >
            {tab === "selling" && (
              <>
                <details className="rounded-xl border p-4">
                  <summary className="cursor-pointer text-sm font-medium">
                    本品补充信息
                  </summary>
                  <p className="my-2 text-xs text-muted-foreground">
                    填写本品优化、改进及与竞品的差异。下方保存后的卖点梳理就是本品资料；补充后点击按钮再汇总。
                  </p>
                  <textarea
                    disabled={lock.locked || organizing || candidateReady}
                    aria-label="本品补充信息"
                    className={"min-h-28 w-full rounded border p-3 text-sm " + manualTextClass(!!draft.productNotes)}
                    maxLength={20000}
                    value={draft.productNotes || ""}
                    onChange={e =>
                      change({ ...draft, productNotes: e.target.value })
                    }
                  />
                  <ProductPhotoPanel projectId={selectedProjectId} readOnly={lock.locked || busy || organizing || candidateReady} beforeWrite={async()=>!dirty || await saveDraft()} onRevision={r=>{if(latestProject.current===selectedProjectId)setRevision(r);}}/>
                </details>
                <Button disabled={organizing || busy || loadedProject !== selectedProjectId} onClick={taskClick}>{taskLabel}</Button>
                <FeatureBenefitBoard
                  data={draft}
                  readOnly={lock.locked || busy || organizing || candidateReady}
                  onChange={change}
                  onEvidence={(_side, node) => setSourceNode(node)}
                />
              </>
            )}
            {(tab === "reviews" || tab === "questions") && <ResearchFindings data={draft} kind={tab} readOnly={lock.locked || busy} onChange={change} onEvidence={(id,name)=>setEvidence({id,name})} onQuestionEvidence={node=>setSourceNode({...node,group:"information"} as GraphNode)}/>}
          </fieldset>
          {tab !== "selling" && (draft.selling.length>0 ||
            draft.features?.length ||draft.reviews.length>0||draft.questions.length>0)&& (
            <Button
              variant="outline"
              disabled={lock.locked || busy}
              onClick={()=>{setChat([]);setPreview(null);
                setBaseline(undefined);
                setMessage("");
                operationId.current = crypto.randomUUID();
                setAdjustOpen(true);}}
            >
              <MessageSquare className="h-4 w-4" />
              调整结果（AI）
            </Button>
          )}
          {sourceNode && (
            <AggregationSourceEvidence
              key={sourceNode.id}
              projectId={selectedProjectId}
              node={sourceNode}
              onClose={()=> setSourceNode(null)}/>
          )}
      {evidence&& (
            <AggregationReviewEvidenceDialog key={evidence.id} projectId={selectedProjectId} itemId={evidence.id} name={evidence.name} onClose={()=>setEvidence(null)}/>
          )}
          <Dialog
            open={!!generation}
            onOpenChange={open => {
              if (!open) setGeneration(null);
            }}
          >
            <DialogContent
              className="max-h-[90vh] max-w-5xl overflow-y-auto"
              aria-describedby={undefined}
            >
              <DialogTitle>{generation?.section==="reviews"?"评论分析预览":generation?.section==="questions"?"买家问题整理预览":"卖点梳理预览"}</DialogTitle>
              <p className="text-sm text-muted-foreground">
                {generation?.section === "selling" ? "确认后，本次预览将替换当前卖点梳理。" : "复用已有竞品分析，保留现有人工整理。确认后保存到当前项目。"}
              </p>
              {generation && <Overview data={generation.data} section={generation.section} />}
              {dirty && generation?.section !== "selling" && <p className="text-sm text-amber-800">请先返回保存当前人工修改，再打开最新整理预览确认。</p>}
              <div className="flex justify-end gap-2">
                <Button
                  disabled={busy || (generation?.section !== "selling" && (lock.locked || dirty))}
                  onClick={()=>void candidateAction("confirm")}
                >
                  {generation?.section === "selling" ? "确认本次结果" : "确认"}
                </Button>
                <Button variant="outline" disabled={busy || (generation?.section !== "selling" && lock.locked)} onClick={()=>void candidateAction("cancel")}>{generation?.section === "selling" ? "放弃本次结果" : "取消"}</Button>
                {generation?.section !== "selling" && <Button variant="outline" disabled={lock.locked || dirty || busy} onClick={()=>{setRefineMessage("");setRefineOpen(true);}}>改进</Button>}
              </div>
            </DialogContent>
          </Dialog>
          {rerunOpen && (tab === "selling" ? <GenerationOptionsDialog title="一键卖点梳理" busy={busy} onClose={()=>setRerunOpen(false)} onSubmit={generateDraft}/> : <TaskFeedbackDialog title={"重新"+resultName} busy={busy} onClose={()=>setRerunOpen(false)} onSubmit={generateDraft}/>)}
          <Dialog open={refineOpen} onOpenChange={open=>{if(!refineProposal.isPending)setRefineOpen(open);}}><DialogContent className="flex max-h-[85vh] max-w-2xl flex-col" aria-describedby={undefined}><DialogTitle>和小L改进本次候选结果</DialogTitle><div className="min-h-32 space-y-3 overflow-y-auto">{!generation?.history?.length && <p className="text-sm text-muted-foreground">说说哪里需要改进。交流和修改会保存在本次预览中，确认后才替换当前内容。</p>}{generation?.history?.map((m,i)=><p key={i} className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm"><strong>{m.role==="user"?"你":"小L"}：</strong>{m.text}</p>)}</div><textarea aria-label="候选结果改进意见" maxLength={4000} className="min-h-28 rounded-lg border p-3 text-sm" value={refineMessage} onChange={e=>setRefineMessage(e.target.value)} disabled={refineProposal.isPending}/><div className="flex justify-end gap-2"><Button variant="outline" disabled={refineProposal.isPending} onClick={()=>setRefineOpen(false)}>返回结果预览</Button><Button disabled={busy||!refineMessage.trim()} onClick={()=>void refineCandidate()}>{refineProposal.isPending?"小L正在改进…":"发送"}</Button></div></DialogContent></Dialog>
          <Dialog open={adjustOpen} onOpenChange={open=>{if(!open&&preview&&!window.confirm("本次调整尚未确认，确定退出吗？"))return;setAdjustOpen(open);}}>
            <DialogContent className="flex h-[90vh] max-w-6xl flex-col"
              aria-describedby={undefined}
            >
              <DialogTitle>调整结果（AI） · 聚合分析</DialogTitle>
              <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
                <div className="flex min-h-0 flex-col rounded-xl border">
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                    {!chat.length && (
                      <p className="text-sm text-muted-foreground">
                        告诉小L需要调整的分类、表述或关联。确认之前，原结果会保留。
                      </p>
                    )}
                    {chat.map((m,i)=> (
                      <p key={i} className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm"
                      >
                        <strong>{m.role=== "user" ? "你" : "小L"}：</strong>
                        {m.text}
                      </p>))}
                  </div>
                  <div className="space-y-2 border-t p-3">
                    <textarea aria-label="告诉小L调整要求"
                      className="min-h-24 w-full rounded border p-2 text-sm"
                      value={message} onChange={e=>setMessage(e.target.value)} placeholder="例如：把选码准确归到必要卖点，并补充详细说明"
                    />
                    <Button disabled={!message.trim()||adjust.isPending || busy} onClick={()=> void send()}>
                      <Send className="h-4 w-4" />
                      {adjust.isPending? "正在核对…" : "发送"}
                    </Button>
                  </div>
                </div>
                <div className="min-h-0 overflow-y-auto rounded-xl border p-4">
                  <h3 className="mb-3 font-semibold">当前调整预览</h3>
                  <Overview data={preview || draft} section={tab} />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  用于改进会建立独立草稿，保留输入、修改结果、意见和来源。
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" disabled={!preview ||
                      !baseline ||
                      !!message.trim() ||
                      adjust.isPending ||
                      busy
                    } onClick={()=> void confirmAdjustment(false)}>
                    确认本次调整
                  </Button>
                  <Button
                    disabled={
                      !preview ||
                      !baseline ||
                      !!message.trim() ||
                      adjust.isPending ||
                      busy
                    }
                    onClick={() => void confirmAdjustment(true)}
                  >
                    确认并用于改进
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
    </>
      )}
  </div>
  );
}
