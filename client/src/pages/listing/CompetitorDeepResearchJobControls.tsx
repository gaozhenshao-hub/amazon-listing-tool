import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { CompetitorDeepOptionsResultSchema, CompetitorDeepJobViewSchema,
  type CompetitorDeepOptionsResult, type CompetitorDeepJobView } from "@shared/competitorDeepExecutionJob";
import { listingRequestOwner, listingOwnerKey, type ListingRequestOwner } from "./listingResearchSelectionState";
import { readCompetitorDeepPending, reserveCompetitorDeepPending, releaseCompetitorDeepPending,
  subscribeCompetitorDeepPending, withCompetitorDeepPendingLock, type CompetitorDeepPending, type CompetitorDeepPendingContext } from "./competitorDeepPending";

export type CompetitorDeepResearchJobControlsProps = {
  projectId: number; analysisId: number; asin: string; revision: string;
  onCompleted?: (committedRevision: string) => void;
};
const terminal = (value: CompetitorDeepJobView) => ["succeeded", "failed", "canceled"].includes(value.status);
const active = (value: CompetitorDeepJobView | null) => value?.status === "queued" || value?.status === "running";
const statuses: Record<string, string> = { queued: "后台排队中", running: "后台研究中", succeeded: "四栏候选已保存，等待人工审阅", failed: "本次研究已停止", canceled: "原请求已取消", unknown: "执行结果尚未确认", not_found: "尚未查到原请求，不能视为提交失败" };
const reasons: Record<string, string> = {
  WRITES_DISABLED: "四栏研究写入开关尚未启用", WORKER_DISABLED: "四栏后台执行器尚未启用",
  WORKSPACE_REQUIRED: "请先选择明确的工作区，再核对四栏研究条件",
  RECORD_CONFIRMED: "此竞品摘要已经确认；需要先人工解锁，再核对是否重新研究",
  RUN_NOT_AUTHORIZED: "当前身份没有此研究任务的访问权限，请核对账号和项目范围",
  SOURCE_CHANGED: "竞品原资料已变化，请刷新已保存研究后重新核对",
  EVIDENCE_CHANGED: "本次研究依据已变化，请重新核对当前资料，不能沿用旧依据提交",
  DEEP_WRITES_DISABLED: "四栏研究写入开关尚未启用", DEEP_WORKER_DISABLED: "四栏后台执行器尚未启用",
  SOURCE_UNAVAILABLE: "研究 Skill 来源尚未配置", CONFIGURATION_UNAVAILABLE: "模型或 Skill 配置尚未就绪",
  DEEP_RUNTIME_UNAVAILABLE: "四栏模型执行配置尚未就绪", DEEP_SOURCE_CHANGED: "竞品原资料已变化，请重新核对",
};
const reason = (code: string | null) => code ? reasons[code] ?? "当前条件未满足（" + code + "）" : "";
const codeOf = (error: unknown) => (error as { data?: { code?: string } } | null)?.data?.code;
const denied = (error: unknown) => ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(codeOf(error) ?? "");

export default function CompetitorDeepResearchJobControls(props: CompetitorDeepResearchJobControlsProps) {
  const auth = useAuth(), permissions = usePermissions();
  const owner = listingRequestOwner(auth.user, props.projectId, auth.loading || !!auth.error || permissions.isLoading);
  const valid = Number.isSafeInteger(props.analysisId) && props.analysisId > 0 && /^[A-Z0-9]{10}$/u.test(props.asin) && /^[a-f0-9]{64}$/u.test(props.revision);
  const identity = owner && valid && permissions.canRead("listing", "listing_analysis") ? JSON.stringify([listingOwnerKey(owner), props.analysisId, props.asin, props.revision]) : null;
  const boundary = useRef({ identity, epoch: 0 });
  if (boundary.current.identity !== identity) boundary.current = { identity, epoch: boundary.current.epoch + 1 };
  if (!identity || !owner) return <p role={auth.loading || permissions.isLoading ? "status" : "alert"} className="text-sm">正在核对四栏任务身份与权限，未读取或启动研究。</p>;
  return <CompetitorDeepResearchJobController key={identity + ":" + boundary.current.epoch} {...props} owner={owner} />;
}

export function CompetitorDeepResearchJobController({ owner, onCompleted, ...props }: CompetitorDeepResearchJobControlsProps & { owner: ListingRequestOwner }) {
  const client = trpc.useUtils().client.analysis;
  const context: CompetitorDeepPendingContext = { userId: owner.userId, workspaceId: owner.workspaceId, projectId: props.projectId, analysisId: props.analysisId, asin: props.asin };
  const scope = { expectedWorkspaceId: owner.workspaceId, projectId: props.projectId, analysisId: props.analysisId };
  const [options, setOptions] = useState<CompetitorDeepOptionsResult | null>(null), [job, setJob] = useState<CompetitorDeepJobView | null>(null);
  const [pending, setPending] = useState<CompetitorDeepPending | null>(null), [storageError, setStorageError] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""), [startConfirmed, setStartConfirmed] = useState(false), [cancelConfirmed, setCancelConfirmed] = useState<string | null>(null);
  const lane = useRef({ sequence: 0, controller: null as AbortController | null, mounted: false }), ownStorage = useRef(false), observed = useRef<string | null>(null);
  const callback = useRef(onCompleted); callback.current = onCompleted;
  const completed = useRef(new Set<string>()), latest = useRef({ context, sync: () => {} });
  function stop() { lane.current.sequence++; lane.current.controller?.abort(); lane.current.controller = null; setBusy(false); }
  function clearPrivate() { setOptions(null); setJob(null); setStartConfirmed(false); }
  function sync() {
    try {
      const value = readCompetitorDeepPending(context), next = value?.operationId ?? null;
      if (observed.current !== next && !ownStorage.current) { stop(); clearPrivate(); setMessage(""); setCancelConfirmed(null); }
      observed.current = next; setPending(value); setStorageError(false);
    } catch { stop(); clearPrivate(); setPending(null); setStorageError(true); setCancelConfirmed(null); }
  }
  latest.current = { context, sync };
  useEffect(() => {
    const current = lane.current; current.mounted = true; sync();
    let unsubscribe: (() => void) | undefined;
    try { unsubscribe = subscribeCompetitorDeepPending(context, () => latest.current.sync()); } catch { setStorageError(true); }
    return () => { current.mounted = false; current.sequence++; current.controller?.abort(); unsubscribe?.(); };
    // The owner/project/row/revision wrapper remounts this controller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function begin() { stop(); const controller = new AbortController(), sequence = lane.current.sequence; lane.current.controller = controller; setBusy(true); setMessage(""); return { controller, current: () => lane.current.mounted && sequence === lane.current.sequence && !controller.signal.aborted }; }
  function owned(value: { identity: { userId: number; workspaceId: number | null }; projectId: number; analysisId: number }) {
    if (value.identity.userId !== owner.userId || value.identity.workspaceId !== owner.workspaceId || value.projectId !== props.projectId || value.analysisId !== props.analysisId) throw new Error("DEEP_SCOPE_CHANGED");
  }
  function failure(error: unknown, work: ReturnType<typeof begin>) {
    if (!work.current()) return;
    clearPrivate(); setStartConfirmed(false);
    setMessage(denied(error) ? "当前研究访问权限不可用，旧私有进度已隐藏；原请求编号仍保留，不会重新提交。" : "未取得可核验结果。若已有请求，仅核对／取消原编号；不会自动重发或再次调用模型。");
    sync();
  }
  async function readOptions() {
    if (busy || pending || storageError) return;
    const work = begin(); setOptions(null); setStartConfirmed(false);
    try {
      const value = CompetitorDeepOptionsResultSchema.parse(await client.competitorDeepOptions.query({ ...scope, expectedRevision: props.revision }, { signal: work.controller.signal }));
      if (!work.current()) return; owned(value);
      if (value.revision !== props.revision) throw new Error("DEEP_SOURCE_CHANGED");
      setOptions(value);
    } catch (error) { failure(error, work); } finally { if (work.current()) setBusy(false); }
  }
  async function accept(raw: unknown, operation: CompetitorDeepPending, work: ReturnType<typeof begin>) {
    if (!work.current()) return;
    const value = CompetitorDeepJobViewSchema.parse(raw); owned(value);
    if (value.operationId !== operation.operationId) throw new Error("DEEP_OPERATION_CHANGED");
    if (value.sourceRevision !== null && value.sourceRevision !== operation.expectedRevision
      || value.evidenceHash !== null && value.evidenceHash !== operation.expectedEvidenceHash) throw new Error("DEEP_SOURCE_CHANGED");
    if (readCompetitorDeepPending(context)?.operationId !== operation.operationId) { sync(); return; }
    setJob(value);
    if (!terminal(value)) { if (!active(value)) setMessage("原请求结果尚未确认，只能继续核对或永久取消；不能另起一次研究。"); return; }
    const released = await withCompetitorDeepPendingLock(context, work.controller.signal, async () => {
      if (!work.current() || readCompetitorDeepPending(context)?.operationId !== operation.operationId) return false;
      ownStorage.current = true;
      try { return releaseCompetitorDeepPending(context, operation.operationId); } finally { ownStorage.current = false; }
    });
    if (!work.current() || !released) { sync(); return; }
    setOptions(null); setStartConfirmed(false); setCancelConfirmed(null);
    if (value.status === "succeeded" && value.committedRevision && !completed.current.has(operation.operationId)) {
      completed.current.add(operation.operationId);
      setMessage("四栏候选已保存。请查看完整结果并人工确认摘要；不会自动确认或修改 Listing。");
      try { callback.current?.(value.committedRevision); } catch { setMessage("四栏候选已保存，但目录刷新未完成。请手动刷新竞品目录后查看、确认。"); }
    }
  }
  async function start() {
    if (busy || pending || storageError || !options?.capability.available || !options.workerEnabled || !startConfirmed || !options.evidenceHash) return;
    const operation: CompetitorDeepPending = { version: 1, context, operationId: crypto.randomUUID(), expectedRevision: props.revision, expectedEvidenceHash: options.evidenceHash };
    const work = begin(); setJob(null);
    try {
      await withCompetitorDeepPendingLock(context, work.controller.signal, async () => {
        if (!work.current()) throw new Error("ABORTED"); ownStorage.current = true;
        try { reserveCompetitorDeepPending(context, operation); observed.current = operation.operationId; setPending(operation); } finally { ownStorage.current = false; }
      });
      if (!work.current()) return;
      await accept(await client.startCompetitorDeepResearch.mutate({ ...scope, operationId: operation.operationId, expectedRevision: operation.expectedRevision, expectedEvidenceHash: operation.expectedEvidenceHash }, { signal: work.controller.signal }), operation, work);
    } catch (error) { failure(error, work); } finally { if (work.current()) setBusy(false); }
  }
  async function check(cancel = false) {
    if (busy || storageError || !pending || cancel && cancelConfirmed !== pending.operationId) return;
    const displayedId = pending.operationId, work = begin();
    try {
      const operation = await withCompetitorDeepPendingLock(context, work.controller.signal, async () => {
        const value = readCompetitorDeepPending(context);
        if (!value || value.operationId !== displayedId || cancel && cancelConfirmed !== value.operationId) throw new Error("DEEP_PENDING_CHANGED"); return value;
      });
      if (!work.current()) return;
      const request = { ...scope, operationId: operation.operationId };
      const raw = cancel ? await client.cancelCompetitorDeepResearch.mutate(request, { signal: work.controller.signal }) : await client.checkCompetitorDeepResearch.query(request, { signal: work.controller.signal });
      await accept(raw, operation, work);
    } catch (error) { failure(error, work); } finally { if (work.current()) setBusy(false); }
  }
  const poll = useRef(check); poll.current = check;
  useEffect(() => {
    if (!pending || !active(job) || busy || storageError) return;
    const timeout = window.setTimeout(() => { void poll.current(false); }, 2_000);
    return () => window.clearTimeout(timeout);
  }, [pending, job, busy, storageError]);
  return <section aria-label={props.asin + " 四栏研究任务"} className="min-w-0 max-w-full space-y-2 rounded border p-3">
    <h4 className="text-sm font-medium">生成四栏研究候选</h4>
    <p className="text-xs text-muted-foreground">标题、卖点、买家反馈与总结按已保存资料生成；评论仅代表可核验原文件样本，不代表市场全部评论。图片 / OCR、问答暂未纳入，不宣称完整全量研究。无需重新上传已有资料。</p>
    {storageError && <p role="alert" className="text-sm">原请求安全存储不可读或已损坏，未删除元数据；请保留本机记录核对，暂不能启动新研究。</p>}
    {message && <p role="alert" className="text-sm">{message}</p>}
    {busy && <p role="status" className="text-sm">正在核对请求与后台状态…</p>}
    {job && <div className="space-y-1 text-sm"><p role="status">{statuses[job.status]}</p>{job.stage && <p>当前阶段：{job.stage}</p>}{job.progress !== null && <p>已完成阶段进度：{job.progress}%</p>}{job.sourceChanged && <p role="alert">原资料已变化，本任务不得冒充当前资料结果；请先核对原请求。</p>}{job.reasonCode && <p>{reason(job.reasonCode)}</p>}</div>}
    {pending ? <div className="space-y-2 text-sm"><p className="break-all">原请求 UUID：{pending.operationId}</p>{pending.expectedRevision !== props.revision && <p>当前资料版本已变化；下面仍核对旧请求，不会用新版本重发。</p>}<div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={busy || storageError} onClick={() => void check()}>核对原四栏请求</Button><label className="flex items-center gap-2"><input type="checkbox" checked={cancelConfirmed === pending.operationId} onChange={event => setCancelConfirmed(event.currentTarget.checked ? pending.operationId : null)} />确认永久取消此原请求</label><Button type="button" size="sm" variant="outline" disabled={busy || storageError || cancelConfirmed !== pending.operationId} onClick={() => void check(true)}>取消原四栏请求</Button></div><p className="text-xs text-muted-foreground">开关关闭后仍可核对／取消原编号。后台进度轮询只读取状态，不重新分析；取消不会撤销已保存成功的结果。</p></div>
      : <div className="space-y-2"><Button type="button" size="sm" variant="outline" disabled={busy || storageError} onClick={() => void readOptions()}>核对四栏研究条件</Button>{options && <><p className="text-sm">{options.capability.available && options.workerEnabled ? "当前资料和后台条件允许提交研究" : reason(options.capability.reasonCode) || "后台执行器尚未启用"}</p><label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={!options.capability.available || !options.workerEnabled} checked={startConfirmed} onChange={event => setStartConfirmed(event.currentTarget.checked)} />我确认分析此版本已保存资料，并知晓可能产生模型调用费用；仅生成待人工审核候选。</label><Button type="button" size="sm" disabled={busy || storageError || !options.capability.available || !options.workerEnabled || !startConfirmed} onClick={() => void start()}>提交四栏后台研究</Button></>}</div>}
  </section>;
}
