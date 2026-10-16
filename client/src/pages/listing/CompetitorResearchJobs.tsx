import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import type { CompetitorResearchJobView } from "@shared/competitorResearchJob";
import { listingOwnerKey, listingRequestOwner } from "./listingResearchSelectionState";

type Analysis = { id: number; asin: string; revision: string; summaryStatus: string };
type Props = { projectId: number; workspaceId: number | null; analyses: Analysis[]; selectedIds: number[]; onCompleted: () => void };
type Owner = { projectId: number; workspaceId: number | null; userId: number };
type Outcome = { analysisId: number; asin: string; revision: string; state: "submitting" | "recorded" | "unconfirmed" | "failed"; message: string };
type Jobs = { status: "loading" | "ready" | "error"; items: CompetitorResearchJobView[]; error: string };
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const activeJob = (job: CompetitorResearchJobView) => job.status === "queued" || job.status === "running";
const resumable = (job: CompetitorResearchJobView) => job.canResume && !job.sourceChanged && ["failed", "canceled"].includes(job.status)
  && ["reserved", "analysis_ready"].includes(job.stage);
const committed = (job: CompetitorResearchJobView) => job.status === "succeeded" && job.stage === "analysis_committed";
const labels: Record<CompetitorResearchJobView["status"], string> = { queued: "排队中", running: "分析中", succeeded: "任务已完成", failed: "任务未完成", canceled: "已取消" };
function ownedJob(value: unknown, owner: Owner): value is CompetitorResearchJobView {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return row.userId === owner.userId && row.workspaceId === owner.workspaceId && row.projectId === owner.projectId
    && typeof row.runId === "string" && row.runId.length > 0 && row.runId.length <= 80 && positiveId(row.analysisId)
    && typeof row.asin === "string" && /^[A-Z0-9]{10}$/.test(row.asin) && hash(row.sourceHash)
    && ["queued", "running", "succeeded", "failed", "canceled"].includes(String(row.status))
    && ["reserved", "model_dispatched", "analysis_ready", "analysis_committed", "model_result_unknown"].includes(String(row.stage))
    && typeof row.progress === "number" && Number.isFinite(row.progress) && row.progress >= 0 && row.progress <= 100
    && typeof row.canResume === "boolean" && typeof row.canCancel === "boolean" && typeof row.sourceChanged === "boolean"
    && typeof row.message === "string" && row.createdAt instanceof Date && Number.isFinite(row.createdAt.getTime());
}
function errorCode(error: unknown) {
  return error && typeof error === "object" && "data" in error && error.data && typeof error.data === "object" && "code" in error.data ? error.data.code : null;
}
const denial = (error: unknown) => ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(String(errorCode(error)));

export function eligibleResearchTargets(analyses: Analysis[]) {
  const counts = new Map<number, number>();
  for (const row of analyses) counts.set(row.id, (counts.get(row.id) || 0) + 1);
  return analyses.filter(row => counts.get(row.id) === 1 && positiveId(row.id) && /^[A-Z0-9]{10}$/.test(row.asin)
    && hash(row.revision) && row.summaryStatus === "draft").map(row => ({ ...row }));
}

/** The displayed task lane is independent of comparison selection/report drafts.
 * Every mutation is explicit; polling only reads existing durable jobs. */
export default function CompetitorResearchJobs(props: Props) {
  const auth = useAuth(), owner = listingRequestOwner(auth.user, props.projectId);
  const identity = owner && owner.workspaceId === props.workspaceId ? listingOwnerKey(owner) : null;
  const boundary = useRef({ identity, epoch: 0 });
  if (boundary.current.identity !== identity) boundary.current = { identity, epoch: boundary.current.epoch + 1 };
  if (!identity || !owner || auth.loading || auth.error) return <p role={auth.loading ? "status" : "alert"}>正在核对研究任务的用户、工作区与项目范围，未启用任务操作。</p>;
  return <OwnedResearchJobs key={identity + ":" + boundary.current.epoch} {...props} userId={owner.userId} />;
}

function OwnedResearchJobs({ projectId, workspaceId, userId, analyses, selectedIds, onCompleted }: Props & { userId: number }) {
  const client = trpc.useUtils().client;
  const start = trpc.analysis.startResearchJob.useMutation({ retry: false });
  const resume = trpc.analysis.resumeResearchJob.useMutation({ retry: false });
  const cancel = trpc.analysis.cancelResearchJob.useMutation({ retry: false });
  const [jobs, setJobs] = useState<Jobs>({ status: "loading", items: [], error: "" });
  const [outcomes, setOutcomes] = useState<Outcome[]>([]), [pending, setPending] = useState(false), [notice, setNotice] = useState("");
  const mounted = useRef(false), denied = useRef(false), mutationLock = useRef(false), readTicket = useRef(0);
  const controller = useRef<AbortController | null>(null), completed = useRef(new Set<string>()), callback = useRef(onCompleted);
  callback.current = onCompleted;
  const usable = useCallback(() => mounted.current && !denied.current, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const clearPrivate = useCallback(() => {
    denied.current = true; controller.current?.abort(); readTicket.current++;
    setJobs({ status: "error", items: [], error: "任务访问条件已变化，旧任务已隐藏；请重新读取核对。" }); setOutcomes([]); setNotice("");
  }, []);
  const readJobs = useCallback(async () => {
    if (!mounted.current) return;
    controller.current?.abort(); const abort = new AbortController(), ticket = ++readTicket.current; controller.current = abort;
    setJobs(previous => ({ ...previous, status: "loading", error: "" }));
    try {
      const rows = await client.analysis.listResearchJobs.query({ projectId, expectedWorkspaceId: workspaceId }, { signal: abort.signal });
      if (!mounted.current || abort.signal.aborted || ticket !== readTicket.current) return;
      const owner = { projectId, workspaceId, userId };
      if (!Array.isArray(rows) || rows.some(row => !ownedJob(row, owner)) || new Set(rows.map(row => row.runId)).size !== rows.length) { clearPrivate(); return; }
      denied.current = false; setJobs({ status: "ready", items: rows, error: "" });
    } catch (error) {
      if (!mounted.current || abort.signal.aborted || ticket !== readTicket.current) return;
      if (denial(error) || errorCode(error) === "PRECONDITION_FAILED") clearPrivate();
      else setJobs(previous => ({ ...previous, status: "error", error: "任务读取失败，尚不能确认最新进度；请重新读取，不要盲目重复提交。" }));
    }
  }, [clearPrivate, client, projectId, userId, workspaceId]);
  useEffect(() => { void readJobs(); return () => controller.current?.abort(); }, [readJobs]);
  useEffect(() => {
    if (denied.current || jobs.status === "loading" || (!jobs.items.some(activeJob) && !outcomes.some(row => row.state === "unconfirmed"))) return;
    const timer = setTimeout(() => { void readJobs(); }, jobs.status === "error" ? 5_000 : 2_000);
    return () => clearTimeout(timer);
  }, [jobs, outcomes, readJobs]);
  useEffect(() => {
    if (!usable()) return;
    const successful = jobs.items.filter(job => committed(job) && !completed.current.has(job.runId));
    if (!successful.length) return;
    for (const job of successful) completed.current.add(job.runId);
    try { callback.current(); } catch { setNotice("分析结果已保存，但页面刷新未完成；请手动刷新已保存研究。"); }
  }, [jobs.items, usable]);

  function accept(job: CompetitorResearchJobView) {
    readTicket.current++; controller.current?.abort();
    setJobs(previous => ({ status: "ready", items: [job, ...previous.items.filter(row => row.runId !== job.runId)], error: "" }));
  }
  const eligible = eligibleResearchTargets(analyses).filter(row => !jobs.items.some(job => job.analysisId === row.id
    && (activeJob(job) || (!job.sourceChanged && (committed(job) || resumable(job) || job.stage === "model_result_unknown")))));
  const selected = eligible.filter(row => selectedIds.includes(row.id));
  const canSubmit = !pending && jobs.status === "ready" && !denied.current;
  async function submit(targets: Analysis[]) {
    if (!usable() || mutationLock.current || jobs.status !== "ready" || !targets.length) return;
    // Freeze every explicit id/revision before the first request. Selection/refetch
    // during this batch must not silently switch remaining inputs to newer rows.
    const frozen = targets.map(row => ({ ...row }));
    mutationLock.current = true; setPending(true); setNotice("");
    setOutcomes(frozen.map(row => ({ analysisId: row.id, asin: row.asin, revision: row.revision, state: "submitting", message: "等待提交" })));
    try {
      for (const row of frozen) {
        if (!usable()) break;
        try {
          const job = await start.mutateAsync({ projectId, expectedWorkspaceId: workspaceId, analysisId: row.id, expectedRevision: row.revision });
          if (!usable()) break;
          if (!ownedJob(job, { projectId, workspaceId, userId }) || job.analysisId !== row.id || job.asin !== row.asin) { clearPrivate(); break; }
          accept(job);
          setOutcomes(previous => previous.map(item => item.analysisId === row.id ? { ...item, state: "recorded", message: "任务已记录，以下方任务状态为准" } : item));
        } catch (error) {
          if (!usable()) break;
          if (denial(error)) { clearPrivate(); break; }
          const known = ["CONFLICT", "BAD_REQUEST", "PRECONDITION_FAILED"].includes(String(errorCode(error)));
          setOutcomes(previous => previous.map(item => item.analysisId === row.id ? { ...item, state: known ? "failed" : "unconfirmed",
            message: known ? "此次提交未完成，资料或操作条件已变化；请刷新核对后再操作" : "提交回执未确认。请核对下方已有任务；系统不会自动重发，手动再提交由服务器核对原任务" } : item));
          // sourceHash is not the whole-row expectedRevision. Never guess a lost
          // ACK by picking the latest job with the same analysisId from this list.
          void readJobs();
        }
      }
    } finally { mutationLock.current = false; if (mounted.current) setPending(false); }
  }
  async function taskAction(job: CompetitorResearchJobView, kind: "resume" | "cancel") {
    if (!usable() || mutationLock.current || jobs.status !== "ready" || (kind === "resume" ? !resumable(job) : !job.canCancel || !activeJob(job))) return;
    mutationLock.current = true; setPending(true); setNotice("");
    try {
      const input = { projectId, expectedWorkspaceId: workspaceId, runId: job.runId };
      const result = kind === "resume" ? await resume.mutateAsync(input) : await cancel.mutateAsync(input);
      if (!usable()) return;
      if (!ownedJob(result, { projectId, workspaceId, userId }) || result.runId !== job.runId || result.analysisId !== job.analysisId
        || result.asin !== job.asin || result.sourceHash !== job.sourceHash) { clearPrivate(); return; }
      accept(result); setNotice(kind === "resume" ? "原任务恢复请求已记录，请以下方状态为准。" : "已读取取消处理结果，请以下方状态为准。");
    } catch (error) {
      if (!usable()) return;
      if (denial(error)) clearPrivate();
      else { setNotice("操作结果未确认，请重新读取原任务；系统不会自动重试。"); void readJobs(); }
    } finally { mutationLock.current = false; if (mounted.current) setPending(false); }
  }

  return <section aria-label="已保存竞品资料分析任务" className="space-y-3 rounded-lg border bg-card p-4">
    <div><h2 className="font-semibold">已保存资料分析（现有 Listing Skill）</h2>
      <p className="text-sm text-muted-foreground">仅分析当前项目已保存的竞品资料，不自动采集。确认会创建后台任务并可能产生模型费用；已确认的摘要请先解锁。</p>
      <p className="text-xs text-muted-foreground">分析范围为已保存的文字资料和二级评论分析；未读取的评论原文、图片内容不作为已验证证据。竞品研究不代替本品事实审核。</p></div>
    <div className="flex flex-wrap gap-2"><Button disabled={!canSubmit || !selected.length} onClick={() => void submit(selected)}>分析选中竞品（{selected.length}）</Button>
      <Button variant="outline" disabled={!canSubmit || !eligible.length} onClick={() => void submit(eligible)}>分析全部可分析竞品（{eligible.length}）</Button>
      <Button variant="ghost" disabled={pending || jobs.status === "loading"} onClick={() => void readJobs()}>重新读取分析任务</Button></div>
    <p className="text-xs text-muted-foreground">“全部”指当前项目的可分析记录，不等于页面勾选；进行中或当前来源已有结果、需恢复、结果未知的任务不重复创建。旧摘要仍保留在下方研究卡中。</p>
    <p className="text-xs text-muted-foreground">任务列表显示当前范围最近100条任务，不代表完整历史。</p>
    {!!outcomes.length && <ul aria-label="本次逐项提交结果" className="space-y-1 text-sm">{outcomes.map(row => <li key={row.analysisId}>{row.asin} · {row.message}</li>)}</ul>}
    {jobs.status === "loading" && <p role="status">正在读取已记录的竞品分析任务…</p>}
    {jobs.status === "error" && <p role="alert">{jobs.error}</p>}
    {jobs.status === "ready" && !jobs.items.length && <p className="text-sm text-muted-foreground">当前范围尚无已记录的分析任务。</p>}
    {jobs.items.map(job => <article key={job.runId} aria-label={job.asin + " 分析任务 " + job.runId} className="space-y-2 rounded border p-3 text-sm">
      <p className="font-medium">{job.asin} · {labels[job.status]}{activeJob(job) ? " · " + Math.round(job.progress) + "%" : ""}</p>
      <p>{job.stage === "model_result_unknown" ? "模型结果未可靠保存，不能恢复或盲目再次调用；请核对已有研究结果或联系管理员。"
        : committed(job) ? "已保存资料分析结果，仍须人工审核摘要。" : job.message.slice(0, 400)}</p>
      {job.sourceChanged && <p role="alert" className="text-amber-700">当前资料已变化，此任务绑定旧来源；旧结果仅作历史参考。</p>}
      {job.status === "succeeded" && !committed(job) && <p role="alert">尚无完整的分析保存凭据，请重新读取核对。</p>}
      {(resumable(job) || job.canCancel) && <div className="flex gap-2">
        {resumable(job) && <Button size="sm" variant="outline" disabled={pending || jobs.status !== "ready"} onClick={() => void taskAction(job, "resume")}>恢复原分析任务</Button>}
        {job.canCancel && activeJob(job) && <Button size="sm" variant="outline" disabled={pending || jobs.status !== "ready"} onClick={() => void taskAction(job, "cancel")}>取消此分析任务</Button>}
      </div>}
      {job.canCancel && activeJob(job) && <p className="text-xs text-muted-foreground">取消只阻止后续结果覆盖；模型已经发出时，不能保证停止服务商计费。</p>}
    </article>)}
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </section>;
}
