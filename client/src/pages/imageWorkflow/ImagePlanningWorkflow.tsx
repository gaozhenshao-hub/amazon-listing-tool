import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ImagePlanningPreviewSchema, ImagePlanningJobViewSchema, ImagePlanningHistorySchema, ImagePlanningApplyReceiptSchema,
  ImagePlanningStartInputSchema, ImagePlanningApplyInputSchema, imagePlanningHash, imagePlanningCanonical as canonical,
  type ImagePlanningOperationInput, type ImagePlanningStartInput, type ImagePlanningApplyInput, type ImagePlanningApplyOperationInput,
  type ImagePlanningScope, type ImagePlanningOutline } from "@shared/imagePlanning";
import { readImagePlanningPending, reserveImagePlanningPending, releaseImagePlanningPending, subscribeImagePlanningPending,
  withImagePlanningPendingLock, type ImagePlanningPending } from "./imagePlanningPending";
type Owner = { userId: number; workspaceId: number; role: string };
type Props = { projectId: number; sessionId: number; canEdit?: boolean; draftBusy?: boolean; sourceVersion?: string;
  beforeApply?: () => boolean; onApplyPendingChange?: (pending: boolean) => void; onApplied?: (candidate?: ImagePlanningOutline) => void | Promise<void> };
type Rpc = {
  planningPreview: { query(input: ImagePlanningOperationInput, options: { signal: AbortSignal }): Promise<unknown> };
  planningStart: { mutate(input: ImagePlanningStartInput): Promise<unknown> };
  planningCheck: { query(input: ImagePlanningOperationInput, options: { signal: AbortSignal }): Promise<unknown> };
  planningCancel: { mutate(input: ImagePlanningOperationInput): Promise<unknown> };
  planningHistory: { query(input: ImagePlanningScope, options: { signal: AbortSignal }): Promise<unknown> };
  planningApply: { mutate(input: ImagePlanningApplyInput): Promise<unknown> };
  planningApplyCheck: { query(input: ImagePlanningApplyOperationInput, options: { signal: AbortSignal }): Promise<unknown> };
  planningApplyCancel: { mutate(input: ImagePlanningApplyOperationInput): Promise<unknown> };
};
const labels: Record<string, string> = { queued: "已排队", running: "正在核对执行前置", dispatched: "已派发模型，等待原回执", succeeded: "完整候选已保存，尚未应用或确认",
  failed: "执行失败，未自动重试", canceled: "已取消", outcome_unknown: "结果未知，只能核对或取消原请求", not_found: "暂未观察到原请求，不代表可重新提交" };
const reasons: Record<string, string> = { EXECUTION_DISABLED: "图片策划新执行或后台开关尚未启用", WRITES_DISABLED: "图片策划新写入尚未启用",
  APPROVAL_UNAVAILABLE: "青岛来源、模型或费用审批尚未配置", CONFIGURATION_UNAVAILABLE: "图片策划助手尚无可用已保存配置",
  HUMAN_UPSTREAM_REQUIRED: "请先人工确认上游步骤；已确认的大纲须先按原流程解锁", VERSION_LEDGER_UNAVAILABLE: "当前会话缺少可核验的人工确认版本",
  SOURCE_CHANGED: "项目来源或大纲草稿已变化，请重新读取核对", SOURCE_LIMIT: "完整来源超过安全预算，未截取或调用模型" };
reasons.CURRENT_ASSET_POLICY_CHANGED = "上游图片素材的用途、许可或字节身份已变化，请重新核对素材政策和上游人工确认。";
const textReason = (code: string | null) => code ? reasons[code] ?? `当前不可执行（${code}）` : "";

/** Same-owner auth refresh suspends private content without destroying pending
 * operations. Identity/role/project/session changes mount a clean controller. */
export default function ImagePlanningWorkflow(props: Props) {
  const auth = useAuth(), permissions = usePermissions(), user = auth.user;
  const valid = user && Number.isSafeInteger(user.id) && user.id > 0 && typeof user.defaultWorkspaceId === "number" && Number.isSafeInteger(user.defaultWorkspaceId) && user.defaultWorkspaceId > 0
    && typeof user.role === "string" && user.role.length > 0 && Number.isSafeInteger(props.projectId) && props.projectId > 0 && Number.isSafeInteger(props.sessionId) && props.sessionId > 0;
  const identity = valid ? JSON.stringify([user.id, user.defaultWorkspaceId, user.role, props.projectId, props.sessionId]) : null;
  const boundary = useRef({ identity, epoch: 0 }), shown = useRef<object | null>(null);
  if (boundary.current.identity !== identity) boundary.current = { identity, epoch: boundary.current.epoch + 1 };
  const token = boundary.current, suspended = auth.loading || permissions.isLoading;
  if (!valid || auth.error || !permissions.isLoading && !permissions.canRead("listing", "listing_image_workflow")) { shown.current = null; return <p role="alert">图片策划身份或权限不可核验，未显示私有执行资料。</p>; }
  if (!suspended) shown.current = token;
  if (suspended && shown.current !== token) return <p role="status">正在核对图片策划身份…</p>;
  return <div hidden={suspended}><ImagePlanningWorkflowController key={`${identity}:${token.epoch}`} {...props} suspended={suspended}
    owner={{ userId: user!.id, workspaceId: user!.defaultWorkspaceId!, role: user!.role }} canEdit={props.canEdit !== false && permissions.canEdit("listing", "listing_image_workflow")} /></div>;
}

export function ImagePlanningWorkflowController({ owner, projectId, sessionId, canEdit = false, draftBusy = false, sourceVersion = "", suspended = false, beforeApply, onApplied, onApplyPendingChange }: Props & { owner: Owner; suspended?: boolean }) {
  const rpc = trpc.useUtils().client.imageWorkflow as unknown as Rpc;
  const [context] = useState(() => ({ userId: owner.userId, workspaceId: owner.workspaceId, projectId, sessionId }));
  const identity = { userId: owner.userId, workspaceId: owner.workspaceId }, scope = { expectedWorkspaceId: owner.workspaceId, projectId, sessionId };
  const [preview, setPreview] = useState<ReturnType<typeof ImagePlanningPreviewSchema.parse> | null>(null);
  const [job, setJob] = useState<ReturnType<typeof ImagePlanningJobViewSchema.parse> | null>(null);
  const [history, setHistory] = useState<ReturnType<typeof ImagePlanningHistorySchema.parse> | null>(null);
  const [pending, setPending] = useState<ImagePlanningPending | null>(null), [busy, setBusy] = useState(false), [charge, setCharge] = useState(false), [replace, setReplace] = useState(false);
  const [notice, setNotice] = useState(""), [denied, setDenied] = useState(false), [storageFailed, setStorageFailed] = useState(false), [cancelFor, setCancelFor] = useState<string | null>(null);
  const live = useRef(false), paused = useRef(suspended), ownStorage = useRef(false), epoch = useRef(0), abort = useRef<AbortController | null>(null), busyRef = useRef(false);
  const pendingRef = useRef(pending), callback = useRef(onApplied), guard = useRef(beforeApply), canWrite = useRef(canEdit && !draftBusy);
  const applyPendingCallback = useRef(onApplyPendingChange); applyPendingCallback.current = onApplyPendingChange;
  paused.current = suspended; pendingRef.current = pending; callback.current = onApplied; guard.current = beforeApply; canWrite.current = canEdit && !draftBusy;
  const stop = () => { epoch.current++; abort.current?.abort(); busyRef.current = false; setBusy(false); };
  const begin = () => {
    const ticket = ++epoch.current, controller = new AbortController(); abort.current?.abort(); abort.current = controller; busyRef.current = true; setBusy(true); setNotice("");
    return { controller, current: () => live.current && !paused.current && ticket === epoch.current && !controller.signal.aborted,
      finish: () => { if (live.current && ticket === epoch.current) { busyRef.current = false; setBusy(false); } } };
  };
  const same = (value: { identity: unknown; scope: ImagePlanningScope }) => canonical(value.identity) === canonical(identity)
    && value.scope.expectedWorkspaceId === scope.expectedWorkspaceId && value.scope.projectId === projectId && value.scope.sessionId === sessionId;
  function fail(error: unknown) {
    const code = (error as { data?: { code?: string } })?.data?.code;
    if (error instanceof Error && /^PLANNING_(?:STORAGE_|LOCK_|PENDING_)/u.test(error.message)) { setStorageFailed(true); setNotice("安全恢复存储或跨窗口锁不可用，已停止新提交；未决编号不会被删除。"); }
    else if (["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(code ?? "") || error instanceof Error && ["ZodError", "PlanningResponseError"].includes(error.name)) {
      setDenied(true); setPreview(null); setJob(null); setHistory(null); setNotice("范围或权限无法核验，已隐藏旧资料；原请求编号保留。");
    } else setNotice("回执尚未核验。原请求编号已保留，只能检查或取消，不会自动重发模型或应用。");
    setCharge(false); setReplace(false);
  }
  const invalid = (): never => { const error = new Error("Response scope mismatch"); error.name = "PlanningResponseError"; throw error; };
  function parseJob(value: unknown, id: string, expected?: ImagePlanningPending | null) {
    const result = ImagePlanningJobViewSchema.parse(value);
    if (!same(result) || result.scope.operationId !== id || result.candidate && imagePlanningHash(result.candidate) !== result.resultHash
      || expected && !["not_found", "canceled"].includes(result.state) && (expected.sourceHash && expected.sourceHash !== result.sourceHash || expected.runtimeHash && expected.runtimeHash !== result.runtimeHash)) invalid();
    return result;
  }
  async function locked<T>(signal: AbortSignal, work: () => Promise<T>) { ownStorage.current = true; try { return await withImagePlanningPendingLock(context, signal, work); } finally { ownStorage.current = false; } }
  async function release(value: ImagePlanningPending, signal: AbortSignal) { await locked(signal, async () => { releaseImagePlanningPending(context, value.operationId); }); setPending(readImagePlanningPending(context)); pendingRef.current = readImagePlanningPending(context); }
  const persisted = (value: ImagePlanningPending) => canonical(readImagePlanningPending(context)) === canonical(value);
  useEffect(() => {
    live.current = true;
    const sync = () => { if (ownStorage.current) return; try { const next = readImagePlanningPending(context); if (canonical(next) !== canonical(pendingRef.current)) { stop(); setPreview(null); setJob(null); setCharge(false); setReplace(false); setCancelFor(null); } pendingRef.current = next; setPending(next); } catch (error) { fail(error); } };
    sync(); let unsubscribe = () => {}; try { unsubscribe = subscribeImagePlanningPending(context, sync); } catch (error) { fail(error); }
    // This is a request-generation counter, not a DOM ref captured by cleanup.
    return () => { live.current = false; abort.current?.abort(); unsubscribe(); };
  }, [context]);
  useEffect(() => { if (suspended) { stop(); setCharge(false); setReplace(false); } }, [suspended]);
  useEffect(() => { applyPendingCallback.current?.(pending?.kind === "apply"); }, [pending]);
  useEffect(() => () => { applyPendingCallback.current?.(false); }, []);
  useEffect(() => { stop(); setPreview(null); setJob(null); setCharge(false); setReplace(false); }, [sourceVersion]);
  async function readPreview() {
    if (busyRef.current || paused.current || pendingRef.current) return; const lane = begin();
    try { const input = { ...scope, operationId: crypto.randomUUID() }, value = ImagePlanningPreviewSchema.parse(await rpc.planningPreview.query(input, { signal: lane.controller.signal }));
      if (!lane.current()) return; if (!same(value) || value.scope.operationId !== input.operationId) invalid(); setPreview(value); setCharge(false); setJob(null);
    } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); }
  }
  async function readHistory() { if (busyRef.current || paused.current) return; const lane = begin(); try {
    const value = ImagePlanningHistorySchema.parse(await rpc.planningHistory.query(scope, { signal: lane.controller.signal })); if (!lane.current()) return; if (!same(value)) invalid(); setHistory(value);
  } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); } }
  async function acceptJob(value: ReturnType<typeof parseJob>, record: ImagePlanningPending, signal: AbortSignal) {
    if (!persisted(record)) invalid(); setJob(value); setReplace(false);
    if (["succeeded", "failed", "canceled"].includes(value.state)) await release(record, signal);
  }
  async function start() {
    if (!preview?.capability.available || !preview.runtimeHash || preview.maxCostCents === null || !charge || !canWrite.current || busyRef.current || pendingRef.current || storageFailed) return;
    const lane = begin(); try {
      const input = ImagePlanningStartInputSchema.parse({ ...preview.scope, expectedSourceHash: preview.sourceHash, expectedRuntimeHash: preview.runtimeHash, maxCostCents: preview.maxCostCents, chargeConfirmed: true });
      const record: ImagePlanningPending = { version: 1, context, kind: "start", operationId: input.operationId, runOperationId: input.operationId,
        requestHash: imagePlanningHash({ identity, request: input }), sourceHash: input.expectedSourceHash, runtimeHash: input.expectedRuntimeHash, resultHash: null };
      await locked(lane.controller.signal, async () => { if (!lane.current()) return; reserveImagePlanningPending(context, record); });
      if (!lane.current()) return; pendingRef.current = record; setPending(record); setCharge(false);
      const value = parseJob(await rpc.planningStart.mutate(input), input.operationId, record); if (lane.current()) await acceptJob(value, record, lane.controller.signal);
    } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); }
  }
  async function recover(cancel = false) {
    if (busyRef.current || paused.current || denied) return; const lane = begin(); try {
      const record = readImagePlanningPending(context); if (!record || record.operationId !== pendingRef.current?.operationId || cancel && cancelFor !== record.operationId) return;
      const operation = { ...scope, operationId: record.operationId };
      if (record.kind === "apply") {
        const input = { ...operation, runOperationId: record.runOperationId }, value = ImagePlanningApplyReceiptSchema.parse(cancel ? await rpc.planningApplyCancel.mutate(input) : await rpc.planningApplyCheck.query(input, { signal: lane.controller.signal }));
        if (!lane.current()) return; if (!same(value) || canonical(value.scope) !== canonical(input) || !persisted(record)) invalid();
        if (value.status === "committed" && (value.requestHash !== record.requestHash || value.resultHash !== record.resultHash)) invalid();
        if (value.status !== "not_found") { await release(record, lane.controller.signal); setJob(null); setPreview(null); if (value.status === "committed") { await callback.current?.(); setNotice("原人工应用已确认。大纲仍为草稿，请按原流程人工确认。"); } }
        else setNotice("尚未观察到原应用请求，编号仍保留。不要另开编号重写。");
      } else {
        const value = parseJob(cancel ? await rpc.planningCancel.mutate(operation) : await rpc.planningCheck.query(operation, { signal: lane.controller.signal }), record.operationId, record);
        if (lane.current()) await acceptJob(value, record, lane.controller.signal);
      }
    } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); }
  }
  async function inspect(operationId: string) {
    if (busyRef.current || pendingRef.current || paused.current) return; const lane = begin(); try {
      const record: ImagePlanningPending = { version: 1, context, kind: "observed", operationId, runOperationId: operationId, requestHash: null, sourceHash: null, runtimeHash: null, resultHash: null };
      await locked(lane.controller.signal, async () => { if (lane.current()) reserveImagePlanningPending(context, record); }); if (!lane.current()) return;
      pendingRef.current = record; setPending(record); const value = parseJob(await rpc.planningCheck.query({ ...scope, operationId }, { signal: lane.controller.signal }), operationId);
      if (lane.current()) await acceptJob(value, record, lane.controller.signal);
    } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); }
  }
  const recoverRef = useRef(recover); recoverRef.current = recover;
  useEffect(() => {
    if (!suspended && pending && pending.kind !== "apply" && job && ["queued", "running", "dispatched"].includes(job.state)) {
      const timer = setTimeout(() => { void recoverRef.current(); }, 2000); return () => clearTimeout(timer);
    }
  }, [pending, job, suspended, busy]);
  async function apply() {
    if (!job?.candidate || !job.resultHash || !job.currentSourceHash || job.sourceChanged || !replace || !canWrite.current || pendingRef.current || busyRef.current || storageFailed) return;
    if (guard.current && !guard.current()) return;
    applyPendingCallback.current?.(true);
    const lane = begin(); try {
      const input = ImagePlanningApplyInputSchema.parse({ ...scope, operationId: crypto.randomUUID(), runOperationId: job.scope.operationId,
        expectedSourceHash: job.currentSourceHash, expectedResultHash: job.resultHash, replaceDraftConfirmed: true });
      const record: ImagePlanningPending = { version: 1, context, kind: "apply", operationId: input.operationId, runOperationId: input.runOperationId,
        requestHash: imagePlanningHash({ identity, request: input }), sourceHash: input.expectedSourceHash, runtimeHash: null, resultHash: input.expectedResultHash };
      await locked(lane.controller.signal, async () => { if (lane.current()) reserveImagePlanningPending(context, record); }); if (!lane.current()) return;
      pendingRef.current = record; setPending(record); setReplace(false);
      const value = ImagePlanningApplyReceiptSchema.parse(await rpc.planningApply.mutate(input)); if (!lane.current()) return;
      const expected = { ...scope, operationId: input.operationId, runOperationId: input.runOperationId };
      if (!same(value) || canonical(value.scope) !== canonical(expected) || !persisted(record) || value.status === "committed" && (value.requestHash !== record.requestHash || value.resultHash !== record.resultHash)) invalid();
      if (value.status !== "not_found") await release(record, lane.controller.signal);
      if (value.status === "committed") { const candidate = job.candidate; setJob(null); setPreview(null); await callback.current?.(candidate); setNotice("候选已应用到原大纲草稿，没有自动确认；请继续编辑并人工确认。"); }
    } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); applyPendingCallback.current?.(pendingRef.current?.kind === "apply"); }
  }
  return <section className="min-w-0 space-y-3 rounded-lg border p-3" aria-label="已保存配置图片大纲执行">
    <h3 className="font-medium">按已保存图片策划配置生成（第 2 步）</h3>
    <p className="text-sm text-muted-foreground">完整主图、6 张副图、7 个 A+ 模块及品牌故事。青岛受审 Skill；仅生成文字候选，不生成图片，不自动确认。其他步骤仍沿原流程。</p>
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !!pending || denied || suspended} onClick={() => void readPreview()}>读取完整来源与费用预览</Button><Button variant="outline" disabled={busy || denied || suspended} onClick={() => void readHistory()}>读取本会话历史</Button></div>
    {notice && <p role="status">{notice}</p>}
    {preview && <div className="space-y-2 break-words"><p>{preview.title} · 已保存来源 {preview.counts.files} 份文件、{preview.counts.competitors} 个竞品、{preview.counts.keywordAnalyses} 条关键词。不是全市场穷尽证明。</p>
      <p>配置版本 {preview.configuration?.revision ?? "未就绪"} · 模型 {preview.modelSlug ?? "未就绪"} · 最多 1 次调用 · 费用授权上限 USD {preview.maxCostCents === null ? "未知" : (preview.maxCostCents / 100).toFixed(2)}（实际费用以供应商账单为准）</p>
      <details><summary>来源和配置指纹</summary><p className="break-all">来源 {preview.sourceHash}<br />配置 {preview.configuration?.hash ?? "未就绪"}<br />执行 {preview.runtimeHash ?? "未就绪"}</p></details>
      {!preview.capability.available && <p>{textReason(preview.capability.reasonCode)}</p>}
      <label className="flex items-start gap-2"><input type="checkbox" checked={charge} onChange={event => setCharge(event.target.checked)} disabled={busy || !!pending || !canEdit || !preview.capability.available} />我确认本次完整来源、已保存配置与上述费用上限</label>
      <Button disabled={busy || !!pending || !charge || !canEdit || draftBusy || !preview.capability.available || storageFailed} onClick={() => void start()}>明确开始一次大纲生成</Button></div>}
    {pending && <div className="space-y-2 break-all"><p>未决原请求：{pending.operationId}（{pending.kind === "apply" ? "人工应用" : "生成"}）</p>
      <Button variant="outline" disabled={busy || denied || suspended} onClick={() => void recover()}>核对原请求</Button>
      <label className="flex gap-2"><input type="checkbox" checked={cancelFor === pending.operationId} onChange={event => setCancelFor(event.target.checked ? pending.operationId : null)} />确认永久取消此原编号；已发生的模型费用不会撤销</label>
      <Button variant="outline" disabled={busy || denied || cancelFor !== pending.operationId || suspended} onClick={() => void recover(true)}>取消原请求</Button></div>}
    {job && <div className="space-y-2"><p>{labels[job.state]} {textReason(job.reasonCode)}</p>{job.sourceChanged && <p role="alert">来源或会话草稿已变化，此候选不能直接应用。请保留原稿，重新核对来源。</p>}
      {job.candidate && <><details><summary>查看完整候选（所有字段，不截断）</summary><pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded border p-2 text-xs">{JSON.stringify(job.candidate, null, 2)}</pre></details>
        <label className="flex items-start gap-2"><input type="checkbox" checked={replace} disabled={!!pending || busy || !canEdit || job.sourceChanged} onChange={event => setReplace(event.target.checked)} />已审阅完整候选，明确替换当前未确认大纲草稿；不会代替原人工确认</label>
        <Button disabled={!replace || busy || !!pending || !canEdit || draftBusy || job.sourceChanged || storageFailed} onClick={() => void apply()}>人工应用到原大纲编辑器</Button></>}
    </div>}
    {history && <div><p>本会话私有历史{history.complete ? "" : "（最近 50 条，更早记录未在此页展示）"}</p><ul>{history.operations.map(item => <li key={item.operationId} className="flex flex-wrap gap-2"><span>{item.createdAt} · {labels[item.state]}</span><Button size="sm" variant="outline" disabled={busy || !!pending || denied} onClick={() => void inspect(item.operationId)}>核对该次候选</Button></li>)}</ul></div>}
  </section>;
}
