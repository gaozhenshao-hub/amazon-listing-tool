import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { VideoWorkflowOptionsResultSchema, VideoWorkflowStartInputSchema, VideoWorkflowViewSchema, VideoWorkflowApplyInputSchema, VideoWorkflowApplyReceiptSchema, VideoWorkflowHistoryResultSchema,
  videoWorkflowCanonical as canonical, videoWorkflowHash, type VideoWorkflowScope, type VideoWorkflowOperation, type VideoWorkflowOptionsInput, type VideoWorkflowOperationInput,
  type VideoWorkflowStartInput, type VideoWorkflowApplyInput, type VideoWorkflowApplyOperationInput } from "@shared/videoWorkflow";
import { readVideoWorkflowPending, reserveVideoWorkflowPending, releaseVideoWorkflowPending, withVideoWorkflowPendingLock, subscribeVideoWorkflowPending, type VideoWorkflowPending } from "./videoWorkflowPending";
type Props = { projectId: number; videoScriptId: number; operation: VideoWorkflowOperation; competitorScriptId?: number | null; onApplied?: () => void | Promise<void>; suspended?: boolean };
type Owner = { userId: number; workspaceId: number; role: string };
type Rpc = {
  workflowOptions: { query(input: VideoWorkflowOptionsInput, options: { signal: AbortSignal }): Promise<unknown> };
  workflowStart: { mutate(input: VideoWorkflowStartInput): Promise<unknown> };
  workflowCheck: { query(input: VideoWorkflowOperationInput, options: { signal: AbortSignal }): Promise<unknown> };
  workflowCancel: { mutate(input: VideoWorkflowOperationInput): Promise<unknown> };
  workflowApply: { mutate(input: VideoWorkflowApplyInput): Promise<unknown> };
  workflowApplyCheck: { query(input: VideoWorkflowApplyOperationInput, options: { signal: AbortSignal }): Promise<unknown> };
  workflowApplyCancel: { mutate(input: VideoWorkflowApplyOperationInput): Promise<unknown> };
  workflowHistory: { query(input: VideoWorkflowScope, options: { signal: AbortSignal }): Promise<unknown> };
};
export const VIDEO_OPERATION_LABELS: Record<VideoWorkflowOperation, string> = { competitor_analysis: "竞品脚本分析", competitor_summary: "多竞品汇总", product_info: "产品信息提取", sections: "段落规划", subtopics: "子主题展开", shots: "镜头明细", edit_scripts: "剪辑脚本" };
const states: Record<string, string> = { queued: "已排队", running: "正在核对执行前置", dispatched: "已派发模型，等待原回执", succeeded: "完整候选已保存，尚未应用", failed: "执行失败，未自动重试", canceled: "原请求已取消", outcome_unknown: "结果未知，只能核对或取消原请求", not_found: "暂未观察到原请求，不能另开编号重发" };
const reasons: Record<string, string> = { EXECUTION_DISABLED: "视频新执行或后台开关尚未启用", WRITES_DISABLED: "视频新写入尚未启用", APPROVAL_UNAVAILABLE: "青岛 Skill、模型和费用审批尚未配置", SOURCE_APPROVAL_UNAVAILABLE: "青岛来源审批尚未配置", CONFIGURATION_UNAVAILABLE: "视频助手尚无可用已保存配置", SOURCE_CHANGED: "原项目或阶段内容已变化，不能应用旧候选", SOURCE_LIMIT: "完整来源超过安全预算，未截取或调用模型", UPSTREAM_NOT_CONFIRMED: "请先按原流程确认上游阶段" };
const reasonText = (code: string | null) => code ? reasons[code] ?? `当前不可用（${code}）` : "";
export default function VideoWorkflowControls(props: Props) {
  const auth = useAuth(), permissions = usePermissions(), user = auth.user;
  const valid = !!user && Number.isSafeInteger(user.id) && user.id > 0 && typeof user.defaultWorkspaceId === "number" && Number.isSafeInteger(user.defaultWorkspaceId) && user.defaultWorkspaceId > 0 && typeof user.role === "string" && !!user.role
    && Number.isSafeInteger(props.projectId) && props.projectId > 0 && Number.isSafeInteger(props.videoScriptId) && props.videoScriptId > 0;
  const key = valid ? canonical([user.id, user.defaultWorkspaceId, user.role, props.projectId, props.videoScriptId, props.operation, props.competitorScriptId ?? null]) : null;
  const boundary = useRef({ key, epoch: 0 }), shown = useRef<object | null>(null); if (boundary.current.key !== key) boundary.current = { key, epoch: boundary.current.epoch + 1 };
  const token = boundary.current, suspended = auth.loading || permissions.isLoading || !!props.suspended;
  if (!valid || auth.error || !permissions.isLoading && !permissions.canRead("listing", "listing_projects")) { shown.current = null; return <p role="alert">视频执行身份或权限不可核验，未显示私有内容。</p>; }
  if (!suspended) shown.current = token; if (suspended && shown.current !== token) return <p role="status">正在核对视频执行身份…</p>;
  return <div hidden={suspended}><VideoWorkflowControlsController key={`${key}:${token.epoch}`} {...props} suspended={suspended} owner={{ userId: user.id, workspaceId: user.defaultWorkspaceId!, role: user.role }} canEdit={permissions.canEdit("listing", "listing_projects")} /></div>;
}
export function VideoWorkflowControlsController({ owner, projectId, videoScriptId, operation, competitorScriptId = null, onApplied, suspended = false, canEdit = false }: Props & { owner: Owner; canEdit?: boolean }) {
  const utils = trpc.useUtils(), rpc = utils.client.videoScript as unknown as Rpc, identity = { userId: owner.userId, workspaceId: owner.workspaceId }, scope = { expectedWorkspaceId: owner.workspaceId, projectId, videoScriptId };
  const [context] = useState(() => ({ ...identity, projectId, videoScriptId }));
  const [preview, setPreview] = useState<ReturnType<typeof VideoWorkflowOptionsResultSchema.parse> | null>(null), [job, setJob] = useState<ReturnType<typeof VideoWorkflowViewSchema.parse> | null>(null);
  const [history, setHistory] = useState<ReturnType<typeof VideoWorkflowHistoryResultSchema.parse> | null>(null);
  const [pending, setPending] = useState<VideoWorkflowPending | null>(null), [busy, setBusy] = useState(false), [charge, setCharge] = useState(false), [review, setReview] = useState(false), [replace, setReplace] = useState(false);
  const [notice, setNotice] = useState(""), [denied, setDenied] = useState(false), [storageFailed, setStorageFailed] = useState(false), [cancelFor, setCancelFor] = useState<string | null>(null);
  const live = useRef(false), paused = useRef(suspended), ownStorage = useRef(false), epoch = useRef(0), abort = useRef<AbortController | null>(null), busyRef = useRef(false), pendingRef = useRef(pending), callback = useRef(onApplied), editable = useRef(canEdit);
  paused.current = suspended; pendingRef.current = pending; callback.current = onApplied; editable.current = canEdit;
  const stop = () => { epoch.current++; abort.current?.abort(); busyRef.current = false; setBusy(false); };
  const begin = () => { const ticket = ++epoch.current, controller = new AbortController(); abort.current?.abort(); abort.current = controller; busyRef.current = true; setBusy(true); setNotice("");
    return { controller, current: () => live.current && !paused.current && ticket === epoch.current && !controller.signal.aborted, finish: () => { if (live.current && ticket === epoch.current) { busyRef.current = false; setBusy(false); } } }; };
  const same = (value: { identity: unknown; scope: VideoWorkflowScope }) => canonical(value.identity) === canonical(identity) && canonical(value.scope.expectedWorkspaceId) === canonical(scope.expectedWorkspaceId) && value.scope.projectId === projectId && value.scope.videoScriptId === videoScriptId;
  const invalid = (): never => { const error = new Error("Response scope mismatch"); error.name = "VideoResponseError"; throw error; };
  function fail(error: unknown) { const code = (error as { data?: { code?: string } })?.data?.code;
    if (error instanceof Error && /^VIDEO_(?:STORAGE_|LOCK_|PENDING_)/u.test(error.message)) { setStorageFailed(true); setNotice("安全恢复存储或跨窗口锁不可用，已禁止新提交；未决编号保留。"); }
    else if (["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(code ?? "") || error instanceof Error && ["ZodError", "VideoResponseError"].includes(error.name)) { setDenied(true); setPreview(null); setJob(null); setHistory(null); setNotice("当前范围或权限无法核验，已隐藏旧资料；原请求编号保留。"); }
    else setNotice("回执尚未核验，原编号保留。仅检查或取消，不自动重发模型或应用。"); setCharge(false); setReview(false); setReplace(false);
  }
  const persisted = (value: VideoWorkflowPending) => canonical(readVideoWorkflowPending(context)) === canonical(value);
  async function locked<T>(signal: AbortSignal, work: () => Promise<T>) { return withVideoWorkflowPendingLock(context, signal, async () => { ownStorage.current = true; try { return await work(); } finally { ownStorage.current = false; } }); }
  async function release(record: VideoWorkflowPending, signal: AbortSignal) { await locked(signal, async () => { if (!persisted(record)) invalid(); releaseVideoWorkflowPending(context, record.operationId); }); pendingRef.current = readVideoWorkflowPending(context); setPending(pendingRef.current); }
  useEffect(() => { live.current = true; const sync = () => { if (ownStorage.current) return; try { const next = readVideoWorkflowPending(context); if (canonical(next) !== canonical(pendingRef.current)) { stop(); setPreview(null); setJob(null); setCharge(false); setReview(false); setCancelFor(null); } pendingRef.current = next; setPending(next); } catch (error) { fail(error); } };
    sync(); let unsubscribe = () => {}; try { unsubscribe = subscribeVideoWorkflowPending(context, sync); } catch (error) { fail(error); }
    return () => { live.current = false; abort.current?.abort(); unsubscribe(); }; }, [context]);
  useEffect(() => { if (suspended) { stop(); setCharge(false); setReview(false); setReplace(false); } }, [suspended]);
  function parseJob(raw: unknown, record: VideoWorkflowPending) { const value = VideoWorkflowViewSchema.parse(raw); if (!same(value) || value.scope.operationId !== record.runOperationId
    || !["not_found", "canceled"].includes(value.state) && (value.operation !== record.operation || value.sourceHash !== record.sourceHash)
    || value.candidate !== null && videoWorkflowHash(value.candidate) !== value.resultHash) invalid(); return value; }
  async function acceptJob(value: ReturnType<typeof parseJob>, record: VideoWorkflowPending, signal: AbortSignal) { if (!persisted(record)) invalid(); setJob(value); setReview(false); setReplace(false); if (["failed", "canceled"].includes(value.state)) await release(record, signal); }
  async function readPreview() { if (busyRef.current || paused.current || pendingRef.current || denied) return; const lane = begin(); try {
    const input = { ...scope, operationId: crypto.randomUUID(), operation, competitorScriptId }, value = VideoWorkflowOptionsResultSchema.parse(await rpc.workflowOptions.query(input, { signal: lane.controller.signal }));
    if (!lane.current()) return; if (canonical(value.identity) !== canonical(identity) || canonical(value.request) !== canonical(input) || value.available && (!value.sourceHash || !value.runtimeHash || !value.configuration || value.maxCostCents === null || value.reasonCode !== null)) invalid(); setPreview(value); setJob(null); setCharge(false);
  } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); } }
  async function readHistory() { if (busyRef.current || paused.current || denied) return; const lane = begin(); setHistory(null); try {
    const value = VideoWorkflowHistoryResultSchema.parse(await rpc.workflowHistory.query(scope, { signal: lane.controller.signal })); if (!lane.current()) return;
    if (!same(value) || canonical(value.scope) !== canonical(scope) || new Set(value.operations.map(row => row.operationId)).size !== value.operations.length
      || value.operations.some(row => (row.operation === "competitor_analysis") !== (row.competitorScriptId !== null))) invalid(); setHistory(value);
  } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); } }
  async function openHistory(row: NonNullable<typeof history>["operations"][number]) { if (busyRef.current || paused.current || denied || pendingRef.current || storageFailed) return; const lane = begin(); try {
    const record: VideoWorkflowPending = { version: 1, context, kind: "observed", operation: row.operation, competitorScriptId: row.competitorScriptId, operationId: row.operationId, runOperationId: row.operationId,
      requestHash: null, sourceHash: row.sourceHash, runtimeHash: null, resultHash: null };
    await locked(lane.controller.signal, async () => { if (lane.current()) reserveVideoWorkflowPending(context, record); }); if (!lane.current()) return; pendingRef.current = record; setPending(record); setPreview(null);
    const raw = await rpc.workflowCheck.query({ ...scope, operationId: row.operationId }, { signal: lane.controller.signal }); if (lane.current()) await acceptJob(parseJob(raw, record), record, lane.controller.signal);
  } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); } }
  async function start() { if (!preview?.available || !preview.sourceHash || !preview.runtimeHash || preview.maxCostCents === null || !charge || !editable.current || busyRef.current || paused.current || pendingRef.current || denied || storageFailed) return;
    const lane = begin(); try { const input = VideoWorkflowStartInputSchema.parse({ ...preview.request, expectedSourceHash: preview.sourceHash, expectedRuntimeHash: preview.runtimeHash, maxCostCents: preview.maxCostCents, chargeConfirmed: true });
      const record: VideoWorkflowPending = { version: 1, context, kind: "start", operation, competitorScriptId, operationId: input.operationId, runOperationId: input.operationId, requestHash: videoWorkflowHash({ identity, request: input }), sourceHash: input.expectedSourceHash, runtimeHash: input.expectedRuntimeHash, resultHash: null };
      await locked(lane.controller.signal, async () => { if (lane.current()) reserveVideoWorkflowPending(context, record); }); if (!lane.current()) return; pendingRef.current = record; setPending(record); setCharge(false);
      const raw = await rpc.workflowStart.mutate(input); if (lane.current()) await acceptJob(parseJob(raw, record), record, lane.controller.signal);
    } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); }
  }
  async function acceptApply(raw: unknown, record: VideoWorkflowPending, signal: AbortSignal) { const value = VideoWorkflowApplyReceiptSchema.parse(raw), expected = { ...scope, operationId: record.operationId, runOperationId: record.runOperationId };
    if (!same(value) || canonical(value.scope) !== canonical(expected) || !persisted(record) || value.status === "committed" && (value.requestHash !== record.requestHash || value.resultHash !== record.resultHash || !value.afterHash || value.version === null || value.reasonCode !== null)
      || value.status !== "committed" && (value.requestHash !== null || value.resultHash !== null || value.afterHash !== null || value.version !== null)) invalid();
    if (value.status === "not_found") { setNotice("尚未观察到原应用请求，编号仍保留；不要换编号重写。"); return; }
    await release(record, signal); setJob(null); setPreview(null); setHistory(null); if (value.status === "committed") { await Promise.all([utils.videoScript.getById.invalidate({ id: videoScriptId }), callback.current?.()]); setNotice("候选已应用到原阶段草稿，没有自动人工确认。请继续原编辑与阶段确认流程。"); } else setNotice("原应用已取消，未自动更改旧阶段内容。");
  }
  async function recover(cancel = false) { if (busyRef.current || paused.current || denied) return; const lane = begin(); try { const record = readVideoWorkflowPending(context); if (!record || canonical(record) !== canonical(pendingRef.current) || cancel && cancelFor !== record.operationId) return;
    const input = { ...scope, operationId: record.operationId };
    if (record.kind === "apply") { const scope = { ...input, runOperationId: record.runOperationId }, raw = cancel ? await rpc.workflowApplyCancel.mutate(scope) : await rpc.workflowApplyCheck.query(scope, { signal: lane.controller.signal }); if (lane.current()) await acceptApply(raw, record, lane.controller.signal); }
    else { const raw = cancel ? await rpc.workflowCancel.mutate(input) : await rpc.workflowCheck.query(input, { signal: lane.controller.signal }); if (lane.current()) await acceptJob(parseJob(raw, record), record, lane.controller.signal); }
  } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); } }
  const recoverRef = useRef(recover); recoverRef.current = recover;
  useEffect(() => { if (!suspended && pending && pending.kind !== "apply" && job && ["queued", "running", "dispatched"].includes(job.state)) { const timer = setTimeout(() => { void recoverRef.current(); }, 2000); return () => clearTimeout(timer); } }, [pending, job, suspended, busy]);
  const targetMatches = pending?.operation === operation && pending?.competitorScriptId === competitorScriptId;
  async function apply() { const record = pendingRef.current; if (!record || record.kind === "apply" || !targetMatches || !job?.candidate || !job.resultHash || !job.sourceHash || !job.sourceCurrent || !review || !editable.current || busyRef.current || paused.current || denied || storageFailed) return;
    const lane = begin(); try { const input = VideoWorkflowApplyInputSchema.parse({ ...scope, operationId: crypto.randomUUID(), runOperationId: record.runOperationId, expectedSourceHash: job.sourceHash, expectedResultHash: job.resultHash, replaceConfirmed: replace, confirmHumanReview: true });
      const next: VideoWorkflowPending = { version: 1, context, kind: "apply", operation, competitorScriptId, operationId: input.operationId, runOperationId: input.runOperationId, requestHash: videoWorkflowHash({ identity, request: input }), sourceHash: input.expectedSourceHash, runtimeHash: null, resultHash: input.expectedResultHash };
      await locked(lane.controller.signal, async () => { if (!lane.current()) return; if (!persisted(record)) invalid(); reserveVideoWorkflowPending(context, next, record.operationId); }); if (!lane.current()) return;
      pendingRef.current = next; setPending(next); setReview(false); setReplace(false); const raw = await rpc.workflowApply.mutate(input); if (lane.current()) await acceptApply(raw, next, lane.controller.signal);
    } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); }
  }
  async function dismissCandidate() { const record = pendingRef.current; if (busyRef.current || paused.current || !record || record.kind === "apply" || job?.state !== "succeeded" || job.scope.operationId !== record.operationId || !window.confirm("结束本地候选查看？不会删除服务端候选或更改旧阶段；可从新协议历史重新读取原候选。")) return;
    const lane = begin(); try { await release(record, lane.controller.signal); if (lane.current()) { setJob(null); setPreview(null); } } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); } }
  return <section className="min-w-0 max-w-full space-y-3 rounded-md border p-3" aria-label={`按已保存配置执行${VIDEO_OPERATION_LABELS[operation]}`}>
    <h4 className="font-medium">{VIDEO_OPERATION_LABELS[operation]} · 已保存视频配置</h4>
    <p className="text-sm text-muted-foreground">青岛受审 Skill，处理文字及结构化引用，不下载/识别视频像素。先预览并确认费用，成功只保存候选；人工应用后仍按原流程编辑和确认。旧任务保留原协议，不叠加新配置。</p>
    <Button variant="outline" disabled={busy || !!pending || denied || suspended} onClick={() => void readPreview()}>读取来源与费用预览</Button>
    {notice && <p role="status">{notice}</p>}
    {preview && <div className="space-y-2 break-words"><p>配置版本 {preview.configuration?.revision ?? "未就绪"} · 来源 {preview.sourceHash ?? "未就绪"}</p><p>配置哈希 {preview.configuration?.hash ?? "未就绪"} · 执行绑定 {preview.runtimeHash ?? "未就绪"}</p>
      {preview.available ? <><p>本次最多 1 次模型调用，授权预算上限 USD {((preview.maxCostCents ?? 0) / 100).toFixed(2)}；实际费用以供应商账单为准。</p><label className="flex items-center gap-2"><input type="checkbox" checked={charge} disabled={busy || !!pending || !canEdit} onChange={event => setCharge(event.target.checked)} />我确认来源、配置和上述费用上限</label><Button disabled={!charge || busy || !!pending || !canEdit || storageFailed || suspended} onClick={() => void start()}>提交后台生成</Button></> : <p role="status">{reasonText(preview.reasonCode)}</p>}
    </div>}
    {pending && <div className="space-y-2 break-words"><p>原请求：{pending.operationId} · {VIDEO_OPERATION_LABELS[pending.operation]} · {pending.kind === "apply" ? "人工应用" : "后台生成"}</p>
      {!targetMatches && <p>本脚本另一个阶段／竞品还有待核对请求。这里只核对或取消；请回到对应阶段应用其候选。</p>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || denied || suspended} onClick={() => void recover()}>检查原请求</Button>
        <label className="flex items-center gap-2"><input type="checkbox" checked={cancelFor === pending.operationId} disabled={busy} onChange={event => setCancelFor(event.target.checked ? pending.operationId : null)} />确认取消这个原编号</label>
        <Button variant="outline" disabled={busy || denied || suspended || cancelFor !== pending.operationId} onClick={() => void recover(true)}>取消原请求</Button></div></div>}
    {job && <div className="space-y-2"><p role="status">{states[job.state]} {reasonText(job.errorCode)}</p>{job.candidate && <><details><summary>查看完整候选（未自动应用）</summary><pre className="max-h-96 max-w-full overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">{JSON.stringify(job.candidate, null, 2)}</pre></details>
      {!job.sourceCurrent && <p role="alert">当前来源已变化，旧候选不可直接应用；旧稿未被覆盖。</p>}
      <label className="flex items-center gap-2"><input type="checkbox" checked={review} disabled={!canEdit || busy || !targetMatches} onChange={event => setReview(event.target.checked)} />我已完整核对候选，应用到当前阶段草稿</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={replace} disabled={!canEdit || busy || !targetMatches} onChange={event => setReplace(event.target.checked)} />如阶段已有内容，明确允许替换并使下游失效</label>
      <div className="flex flex-wrap gap-2"><Button disabled={!review || !targetMatches || !job.sourceCurrent || !canEdit || busy || suspended || denied || storageFailed || !pending || pending.kind === "apply"} onClick={() => void apply()}>人工应用候选</Button><Button variant="outline" disabled={busy || suspended || !pending || pending.kind === "apply"} onClick={() => void dismissCandidate()}>结束候选查看</Button></div>
    </>}</div>}
    <details><summary>本脚本新协议任务与候选历史</summary><Button variant="outline" disabled={busy || suspended || denied} onClick={() => void readHistory()}>读取本人任务历史</Button>
      {history && <div className="max-h-80 space-y-2 overflow-auto">{!history.complete && <p role="status">仅显示最近 50 条，非完整历史；更早记录未在此列表提供，已有本地未决编号仍可恢复。</p>}{history.operations.length === 0 && <p>本次读取未发现本人任务。</p>}
        {history.operations.map(row => <div key={row.operationId} className="break-words rounded border p-2 text-sm"><p>{VIDEO_OPERATION_LABELS[row.operation]}{row.competitorScriptId ? ` · 竞品 #${row.competitorScriptId}` : ""} · {states[row.state]}</p><p>{row.createdAt} · {row.operationId}</p><Button variant="outline" disabled={busy || suspended || denied || !!pending || storageFailed} onClick={() => void openHistory(row)}>读取此原任务</Button></div>)}</div>}
    </details>
  </section>;
}
