import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Check, CheckCircle2, FilePenLine, Loader2, LockKeyhole, RotateCcw, Save, Sparkles, UnlockKeyhole, X } from "lucide-react";
import { Streamdown } from "streamdown";
import { competitorStudy } from "./competitorStudyModel";
import { listingOwnerKey, listingRequestOwner } from "./listingResearchSelectionState";

type Analysis = {
  id: number; projectId: number; asin: string; revision: string;
  rawData: string | null; aiSummary: string | null; summary: string | null;
  summaryStatus: "draft" | "confirmed"; summaryVersion: number; summaryConfirmedAt: Date | string | null;
  activeResearch?: unknown;
};
type Props = { projectId: number; analysis: Analysis };
const isRevision = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const summaryText = (analysis: Analysis) => analysis.summary?.trim() ? analysis.summary : analysis.aiSummary?.trim() ? analysis.aiSummary : "";
function errorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("data" in error) || !error.data || typeof error.data !== "object") return null;
  return "code" in error.data ? error.data.code : null;
}
function persistedRow(value: unknown, projectId: number, original: Analysis): value is Analysis {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return row.id === original.id && row.projectId === projectId && row.asin === original.asin && isRevision(row.revision)
    && (row.summary === null || typeof row.summary === "string") && (row.aiSummary === null || typeof row.aiSummary === "string")
    && (row.rawData === null || typeof row.rawData === "string") && ["draft", "confirmed"].includes(String(row.summaryStatus))
    && Number.isSafeInteger(row.summaryVersion) && Number(row.summaryVersion) > 0;
}

/** The parent owns source reads. This boundary isolates editor drafts/callbacks;
 * it does not turn the legacy page's project-only cache into an authorization proof. */
export function CompetitorAnalysisSummaryEditor({ projectId, analysis }: Props) {
  const auth = useAuth(), owner = listingRequestOwner(auth.user, projectId);
  const identity = owner ? JSON.stringify([listingOwnerKey(owner), analysis.id]) : null;
  const boundary = useRef({ identity, epoch: 0 }), shown = useRef<object | null>(null);
  if (boundary.current.identity !== identity) boundary.current = { identity, epoch: boundary.current.epoch + 1 };
  const token = boundary.current, suspended = auth.loading || !!auth.error;
  if (!owner || !Number.isSafeInteger(analysis.id) || analysis.id <= 0 || analysis.projectId !== projectId)
    return <p role={auth.loading ? "status" : "alert"}>用户、工作区或摘要身份不完整，未启用摘要编辑。</p>;
  if (!suspended) shown.current = token;
  if (suspended && shown.current !== token) return <p role="status">正在确认摘要编辑身份…</p>;
  return <>{suspended && <p role="status">正在确认摘要编辑身份，当前草稿暂时保留…</p>}
    <div hidden={suspended}><OwnedSummaryEditor key={identity + ":" + token.epoch} projectId={projectId}
      analysis={analysis} workspaceId={owner.workspaceId} suspended={suspended} /></div></>;
}

function OwnedSummaryEditor({ projectId, analysis, workspaceId, suspended }: Props & { workspaceId: number | null; suspended: boolean }) {
  const utils = trpc.useUtils();
  const updateMutation = trpc.analysis.updateSummary.useMutation({ retry: false });
  const confirmMutation = trpc.analysis.confirmSummary.useMutation({ retry: false });
  const unlockMutation = trpc.analysis.unlockSummary.useMutation({ retry: false });
  const [base, setBase] = useState(analysis), [draft, setDraft] = useState(summaryText(analysis));
  const [isEditing, setIsEditing] = useState(false), [pending, setPending] = useState<"save" | "confirm" | "unlock" | null>(null);
  const [notice, setNotice] = useState(""), [denied, setDenied] = useState(false);
  const active = useRef(false), paused = useRef(suspended), pendingRef = useRef(false), dirty = useRef(false);
  const latest = useRef(analysis), incomingRevision = useRef(analysis.revision), incomingEpoch = useRef(0);
  paused.current = suspended;
  if (incomingRevision.current !== analysis.revision) {
    incomingRevision.current = analysis.revision; latest.current = analysis; incomingEpoch.current++;
  }
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (dirty.current || pendingRef.current) {
      if (analysis.revision !== base.revision) setNotice("资料版本已变化，本地草稿和起始版本已保留；请重新读取并核对后再操作。");
      return;
    }
    setBase(analysis); setDraft(summaryText(analysis)); setIsEditing(false); setNotice("");
    // A background row change must not silently rebase an edited draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis.revision]);
  const usable = () => active.current && !paused.current && !denied;
  const confirmed = base.summaryStatus === "confirmed", source = competitorStudy(latest.current);
  const validDraft = !!draft.trim() && draft.trim().length <= 20_000;
  const writable = !suspended && !denied && !pending && isRevision(base.revision);
  const canConfirm = writable && !confirmed && validDraft && !source.historical && !source.sourceUnknown
    && latest.current.summaryStatus !== "confirmed";

  function adopt(row: Analysis, editing = false) {
    latest.current = row; setBase(row); setDraft(summaryText(row)); dirty.current = false; setIsEditing(editing);
  }
  function changeDraft(text: string) {
    if (!usable() || pendingRef.current) return;
    dirty.current = true; setDraft(text);
  }
  async function write(kind: "save" | "confirm" | "unlock") {
    if (!usable() || pendingRef.current || !isRevision(base.revision)) return;
    if (kind === "confirm" ? !canConfirm : kind === "save" ? confirmed || !validDraft : !confirmed) return;
    pendingRef.current = true; setPending(kind); setNotice("");
    const epoch = incomingEpoch.current;
    const scope = { projectId, analysisId: base.id, expectedWorkspaceId: workspaceId, expectedRevision: base.revision };
    try {
      const row = kind === "save" ? await updateMutation.mutateAsync({ ...scope, summary: draft })
        : kind === "confirm" ? await confirmMutation.mutateAsync({ ...scope, summary: draft }) : await unlockMutation.mutateAsync(scope);
      if (!active.current) return;
      if (paused.current) { dirty.current = true; setNotice("请求结果需要重新读取核对，当前草稿已保留；系统不会自动重试。"); return; }
      if (!persistedRow(row, projectId, base) || row.summaryStatus !== (kind === "confirm" ? "confirmed" : "draft")
        || (kind !== "unlock" && row.summary !== draft.trim())) {
        setDenied(true); setNotice("返回的摘要范围、结果或版本无法核验，已停止编辑；请重新读取核对。"); return;
      }
      if (epoch === incomingEpoch.current) adopt(row, kind === "unlock");
      else { dirty.current = true; setNotice("请求已完成，但读取版本期间发生变化；本地草稿和起始版本已保留，请重新读取核对。"); }
      const results = await Promise.allSettled([utils.analysis.listByProject.invalidate({ projectId })]);
      if (!usable() || epoch !== incomingEpoch.current) return;
      setNotice(results.some(result => result.status === "rejected") ? "请求已完成，但页面刷新失败；请重新读取核对，不要重复提交。"
        : kind === "save" ? "竞品分析总结已保存" : kind === "confirm" ? "竞品分析已确认并锁定" : "已解锁，可以继续编辑");
    } catch (error) {
      if (!active.current) return;
      dirty.current = true;
      const code = errorCode(error);
      if (code === "FORBIDDEN" || code === "UNAUTHORIZED" || code === "NOT_FOUND") {
        setDenied(true); setNotice("访问权限已变化，已停止摘要编辑；请重新读取核对。");
      } else setNotice(code === "CONFLICT" ? "摘要或来源版本冲突，本地草稿和起始版本已保留；请重新读取核对后再保存。"
        : "请求未确认完成，当前草稿已保留；请重新读取核对，系统不会自动重试。");
    } finally { pendingRef.current = false; if (active.current) setPending(null); }
  }
  if (denied) return <p role="alert">{notice}</p>;
  return <section className="mb-4 border bg-muted/20" aria-label="竞品分析总结编辑器">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
      <div className="flex min-w-0 items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><div>
        <h4 className="text-sm font-semibold">竞品分析总结</h4><p className="text-xs text-muted-foreground">确认后的版本将作为 Listing 下游正式输入</p>
      </div></div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={confirmed && !source.historical && !source.sourceUnknown ? "default" : "secondary"} className="gap-1">
          {confirmed ? <LockKeyhole className="h-3 w-3" /> : <FilePenLine className="h-3 w-3" />}
          {source.historical ? confirmed ? "历史摘要曾确认" : "历史摘要" : source.sourceUnknown ? "来源状态未核验" : confirmed ? "已确认" : "待确认"} · v{base.summaryVersion}
        </Badge>
        {confirmed ? <Button size="sm" variant="outline" disabled={!writable} onClick={() => void write("unlock")}>
          {pending === "unlock" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UnlockKeyhole className="h-4 w-4" />}解锁编辑</Button>
          : isEditing ? <>
            <Button size="sm" variant="ghost" disabled={!!pending} onClick={() => { if (!pendingRef.current) { adopt(latest.current); setNotice(""); } }}><X className="h-4 w-4" />取消</Button>
            <Button size="sm" variant="outline" disabled={!writable || !validDraft} onClick={() => void write("save")}>
              {pending === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}保存草稿</Button>
            <Button size="sm" disabled={!canConfirm} onClick={() => void write("confirm")}>
              {pending === "confirm" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}确认并锁定</Button>
          </> : <>
            <Button size="sm" variant="outline" disabled={!!pending} onClick={() => { if (usable() && !pendingRef.current) { dirty.current = true; setIsEditing(true); } }}><FilePenLine className="h-4 w-4" />编辑</Button>
            <Button size="sm" disabled={!canConfirm} onClick={() => void write("confirm")}>
              {pending === "confirm" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}确认结果</Button>
          </>}
      </div>
    </div>
    <div className="space-y-3 p-4">
      {source.historical && <p role="alert" className="text-sm text-amber-700">{source.analysisStale ? "资料已变化，旧摘要仅作历史参考；需要重新分析当前资料后再确认。" : "当前仅保存采集资料，旧摘要不代表当前资料分析；需要重新分析后再确认。"}可保留人工编辑草稿。</p>}
      {source.adoptedDeep && <p className="text-sm">当前正式摘要来自已核验的四栏人工采纳；不表示图片、OCR、真实问答或完整全量研究已完成，旧分析历史状态仍保留。</p>}
      {source.adoptionNeedsReview && <p role="alert" className="text-sm">四栏正式研究当前需重新核验。若已解锁或编辑摘要，请到竞品并排研究使用“审阅并采纳四栏候选”重新人工确认；普通摘要确认不能替代采纳，同源重采纳不调用模型。</p>}
      {source.sourceUnknown && <p role="alert" className="text-sm text-amber-700">来源状态无法核验，不能确认摘要；可保留人工草稿，请到分析页核对。</p>}
      {!isRevision(base.revision) && <p role="alert">摘要版本无法核验，未启用保存或确认；请重新读取。</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {isEditing ? <div className="space-y-2">
        <Textarea aria-label="竞品摘要草稿" value={draft} onChange={event => changeDraft(event.target.value)} rows={14}
          className="min-h-[280px] resize-y bg-background font-mono text-sm leading-6" placeholder="编辑真实竞品分析摘要" disabled={!!pending} />
        <div className="flex items-center justify-between text-xs text-muted-foreground"><span>支持 Markdown 结构，保存草稿不会锁定。</span>
          <Button variant="ghost" size="sm" className="h-7" disabled={!!pending || !latest.current.aiSummary?.trim()}
            onClick={() => changeDraft(latest.current.aiSummary || "")}><RotateCcw className="h-3.5 w-3.5" />恢复 AI 原稿</Button>
        </div>
      </div> : draft ? <div className="prose prose-sm max-w-none dark:prose-invert"><Streamdown>{draft}</Streamdown></div>
        : <p className="text-sm text-muted-foreground">尚无已保存或 AI 候选摘要，请补充真实分析内容；不会以占位文字代替分析结果。</p>}
    </div>
  </section>;
}
