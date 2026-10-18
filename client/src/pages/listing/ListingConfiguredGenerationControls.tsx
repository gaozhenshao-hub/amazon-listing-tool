import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ListingConfiguredPreviewInputSchema, ListingConfiguredPreviewResultSchema, ListingConfiguredStartInputSchema, ListingConfiguredViewSchema, ListingConfiguredApplyInputSchema, ListingConfiguredApplyReceiptSchema, ListingConfiguredHistoryResultSchema,
  listingConfiguredCanonical as canonical, listingConfiguredHash as hash, type ListingConfiguredOperation, type ListingConfiguredScope, type ListingConfiguredPreviewInput, type ListingConfiguredStartInput,
  type ListingConfiguredOperationInput, type ListingConfiguredApplyInput, type ListingConfiguredApplyOperationInput, type ListingConfiguredHistoryInputSchema } from "@shared/listingConfiguredWorkflow";
import type { z } from "zod";
import { readListingConfiguredPending, reserveListingConfiguredPending, releaseListingConfiguredPending, withListingConfiguredPendingLock, subscribeListingConfiguredPending, type ListingConfiguredPending } from "./listingConfiguredPending";
import { useListingConfiguredGeneration } from "./ListingConfiguredGenerationContext";
import ListingConfiguredCandidateView from "./ListingConfiguredCandidateView";

export const LISTING_CONFIGURED_LABELS: Record<ListingConfiguredOperation, string> = { sellingPoints: "七条卖点方向", singleBullet: "单条五点描述", bullets: "全部五点描述", title: "标题", description: "产品描述", searchTerms: "后台搜索词", qa: "QA问答", batch: "完整批量生成" };
type Owner = { userId: number; workspaceId: number; role: string };
type Rpc = {
  configuredPreview: { query(input: ListingConfiguredPreviewInput, options: { signal: AbortSignal }): Promise<unknown> };
  configuredStart: { mutate(input: ListingConfiguredStartInput): Promise<unknown> };
  configuredCheck: { query(input: ListingConfiguredOperationInput, options: { signal: AbortSignal }): Promise<unknown> };
  configuredCancel: { mutate(input: ListingConfiguredOperationInput): Promise<unknown> };
  configuredApply: { mutate(input: ListingConfiguredApplyInput): Promise<unknown> };
  configuredApplyCheck: { query(input: ListingConfiguredApplyOperationInput, options: { signal: AbortSignal }): Promise<unknown> };
  configuredApplyCancel: { mutate(input: ListingConfiguredApplyOperationInput): Promise<unknown> };
  configuredHistory: { query(input: z.infer<typeof ListingConfiguredHistoryInputSchema>, options: { signal: AbortSignal }): Promise<unknown> };
};
const stateLabels: Record<string, string> = { queued: "已排队", running: "正在执行已冻结阶段", dispatched: "模型已派发，等待原回执", succeeded: "完整候选已保存，未代替人工审核", failed: "执行失败，未自动重试", canceled: "原请求已取消", outcome_unknown: "模型结果未知，只能核对或取消原编号", not_found: "暂未观察到原请求，不能换编号重发" };
const reasons: Record<string, string> = { EXECUTION_DISABLED: "Listing配置化执行或后台开关尚未启用", WRITES_DISABLED: "新写入开关尚未启用", WORKER_DISABLED: "配置化后台执行尚未启用", CONFIGURATION_UNAVAILABLE: "尚无可用的已保存Listing配置", APPROVAL_UNAVAILABLE: "用户Listing Skill、模型和费用审批尚未配置", SOURCE_APPROVAL_UNAVAILABLE: "受审来源审批尚未配置", SOURCE_CHANGED: "来源已变化，请保留旧稿并重新核对", DRAFT_CHANGED: "原草稿已变化，不能用旧版本覆盖", SOURCE_LIMIT: "完整来源超过预算，未截断或调用模型", CORE_REQUIRED: "请先按原流程审核本品事实与卖点核心" };
const reasonText = (code: string | null) => code ? reasons[code] ?? `当前不可用（${code}）` : "";
type Bridge = NonNullable<ReturnType<typeof useListingConfiguredGeneration>>;
export default function ListingConfiguredGenerationControls({ projectId, suspended = false }: { projectId: number; suspended?: boolean }) {
  const auth = useAuth(), permissions = usePermissions(), bridge = useListingConfiguredGeneration(), user = auth.user;
  const valid = !!user && Number.isSafeInteger(user.id) && user.id > 0 && typeof user.defaultWorkspaceId === "number" && user.defaultWorkspaceId > 0 && Number.isSafeInteger(user.defaultWorkspaceId) && !!user.role && Number.isSafeInteger(projectId) && projectId > 0;
  const key = valid ? canonical([user.id, user.defaultWorkspaceId, user.role, projectId]) : null;
  const boundary = useRef({ key, epoch: 0 }), shown = useRef<object | null>(null); if (key !== boundary.current.key) boundary.current = { key, epoch: boundary.current.epoch + 1 };
  const token = boundary.current, paused = suspended || auth.loading || permissions.isLoading;
  if (!bridge) return null;
  if (!valid || auth.error || !permissions.isLoading && !permissions.canRead("listing", "listing_generate")) { shown.current = null; return <p role="alert">当前配置化生成身份或权限不可核验；未显示私有执行资料。</p>; }
  if (!paused) shown.current = token; if (paused && shown.current !== token) return <p role="status">正在核对配置化生成身份…</p>;
  return <div hidden={paused}><ListingConfiguredGenerationController key={`${key}:${token.epoch}`} projectId={projectId} owner={{ userId: user.id, workspaceId: user.defaultWorkspaceId!, role: user.role }} bridge={bridge} suspended={paused} canEdit={permissions.canEdit("listing", "listing_generate")} /></div>;
}
export function ListingConfiguredGenerationController({ projectId, owner, bridge, suspended = false, canEdit = false }: { projectId: number; owner: Owner; bridge: Bridge; suspended?: boolean; canEdit?: boolean }) {
  const utils = trpc.useUtils(), rpc = utils.client.listing as unknown as Rpc, identity = { userId: owner.userId, workspaceId: owner.workspaceId }, scope = { expectedWorkspaceId: owner.workspaceId, projectId };
  const [context] = useState(() => ({ ...identity, projectId }));
  const [preview, setPreview] = useState<ReturnType<typeof ListingConfiguredPreviewResultSchema.parse> | null>(null), [job, setJob] = useState<ReturnType<typeof ListingConfiguredViewSchema.parse> | null>(null);
  const [history, setHistory] = useState<ReturnType<typeof ListingConfiguredHistoryResultSchema.parse> | null>(null), [cursors, setCursors] = useState<Array<number | null>>([null]);
  const [pending, setPending] = useState<ListingConfiguredPending | null>(null), [busy, setBusy] = useState(false), [charge, setCharge] = useState(false), [review, setReview] = useState(false), [titleIndex, setTitleIndex] = useState<number | null>(null);
  const [notice, setNotice] = useState(""), [denied, setDenied] = useState(false), [storageFailed, setStorageFailed] = useState(false), [cancelFor, setCancelFor] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ operationId: string; sourceHash: string; resultHash: string; outputs: Record<string, unknown> | null } | null>(null);
  const live = useRef(false), paused = useRef(suspended), ownStorage = useRef(false), epoch = useRef(0), abort = useRef<AbortController | null>(null), busyRef = useRef(false), pendingRef = useRef(pending), editable = useRef(canEdit), currentBridge = useRef(bridge);
  const application = useRef<{ id: string; receivers: ReturnType<Bridge["capture"]>; outputs: Record<string, unknown> } | null>(null);
  paused.current = suspended; pendingRef.current = pending; editable.current = canEdit; currentBridge.current = bridge;
  const stop = () => { epoch.current++; abort.current?.abort(); busyRef.current = false; setBusy(false); };
  const begin = () => { const ticket = ++epoch.current, controller = new AbortController(); abort.current?.abort(); abort.current = controller; busyRef.current = true; setBusy(true); setNotice("");
    return { controller, current: () => live.current && !paused.current && ticket === epoch.current && !controller.signal.aborted, finish: () => { if (live.current && ticket === epoch.current) { busyRef.current = false; setBusy(false); } } }; };
  const same = (value: { identity: unknown; scope: ListingConfiguredScope }) => canonical(value.identity) === canonical(identity) && value.scope.expectedWorkspaceId === scope.expectedWorkspaceId && value.scope.projectId === projectId;
  const invalid = (): never => { const error = new Error("Response scope mismatch"); error.name = "ListingConfiguredResponseError"; throw error; };
  function fail(error: unknown) { const code = (error as { data?: { code?: string } })?.data?.code;
    if (error instanceof Error && /^LISTING_CONFIGURED_(?:STORAGE_|LOCK_|PENDING_)/u.test(error.message)) { setStorageFailed(true); setNotice("安全存储或跨窗口锁不可用，禁止新提交；未决编号保留。"); }
    else if (["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(code ?? "") || error instanceof Error && ["ZodError", "ListingConfiguredResponseError"].includes(error.name)) { setDenied(true); setPreview(null); setJob(null); setHistory(null); setApplied(null); setNotice("响应身份、范围或权限无法核验，已隐藏旧资料；原请求编号保留。"); }
    else setNotice("回执尚未核验，原编号保留。只检查或取消，不自动重发模型或应用；原编辑稿不受影响。");
    setCharge(false); setReview(false); setTitleIndex(null);
  }
  const persisted = (value: ListingConfiguredPending) => canonical(readListingConfiguredPending(context)) === canonical(value);
  async function locked<T>(signal: AbortSignal, work: () => Promise<T>) { return withListingConfiguredPendingLock(context, signal, async () => { ownStorage.current = true; try { return await work(); } finally { ownStorage.current = false; } }); }
  async function release(record: ListingConfiguredPending, signal: AbortSignal) { await locked(signal, async () => { if (!persisted(record)) invalid(); releaseListingConfiguredPending(context, record.operationId); }); pendingRef.current = readListingConfiguredPending(context); setPending(pendingRef.current); }
  useEffect(() => { live.current = true; const sync = () => { if (ownStorage.current) return; try { const next = readListingConfiguredPending(context); if (canonical(next) !== canonical(pendingRef.current)) { stop(); setPreview(null); setJob(null); setCharge(false); setReview(false); setCancelFor(null); application.current = null; } pendingRef.current = next; setPending(next); } catch (error) { fail(error); } };
    sync(); let unsubscribe = () => {}; try { unsubscribe = subscribeListingConfiguredPending(context, sync); } catch (error) { fail(error); } return () => { live.current = false; abort.current?.abort(); unsubscribe(); }; }, [context]);
  useEffect(() => { if (suspended) { stop(); setCharge(false); setReview(false); } }, [suspended]);
  const intentKey = canonical(bridge.intent);
  useEffect(() => { stop(); setPreview(null); setCharge(false); }, [intentKey]);
  function parseJob(raw: unknown, record: ListingConfiguredPending) { const value = ListingConfiguredViewSchema.parse(raw);
    if (!same(value) || value.scope.operationId !== record.runOperationId || !["not_found", "canceled"].includes(value.state) && (value.operation !== record.operation || value.sourceHash !== record.sourceHash)
      || (value.state === "succeeded") !== (value.candidate !== null && value.resultHash !== null) || value.candidate && (hash(value.candidate) !== value.resultHash || value.candidate.sourceHash !== record.sourceHash || value.candidate.operation !== record.operation)) invalid(); return value;
  }
  async function acceptJob(value: ReturnType<typeof parseJob>, record: ListingConfiguredPending, signal: AbortSignal) { if (!persisted(record)) invalid(); setJob(value); setReview(false); setTitleIndex(null); if (["failed", "canceled"].includes(value.state)) await release(record, signal); }
  async function readPreview() { if (!bridge.intent || busyRef.current || paused.current || pendingRef.current || denied) return; const lane = begin(); try {
    const input = ListingConfiguredPreviewInputSchema.parse({ ...scope, ...bridge.intent, operationId: crypto.randomUUID() }), value = ListingConfiguredPreviewResultSchema.parse(await rpc.configuredPreview.query(input, { signal: lane.controller.signal }));
    if (!lane.current()) return; if (canonical(value.identity) !== canonical(identity) || canonical(value.request) !== canonical(input) || value.available && (!value.runtimeHash || !value.configuration || value.maxCostCents === null || value.reasonCode !== null)) invalid(); setPreview(value); setJob(null); setCharge(false);
  } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); } }
  async function start() { if (!preview?.available || !preview.runtimeHash || preview.maxCostCents === null || !charge || !editable.current || busyRef.current || paused.current || pendingRef.current || denied || storageFailed) return; const lane = begin(); try {
    const input = ListingConfiguredStartInputSchema.parse({ ...preview.request, expectedSourceHash: preview.sourceHash, expectedRuntimeHash: preview.runtimeHash, maxCostCents: preview.maxCostCents, chargeConfirmed: true });
    const record: ListingConfiguredPending = { version: 1, context, kind: "start", operation: input.operation, operationId: input.operationId, runOperationId: input.operationId, requestHash: hash({ identity, request: input }), sourceHash: input.expectedSourceHash, runtimeHash: input.expectedRuntimeHash, resultHash: null };
    await locked(lane.controller.signal, async () => { if (lane.current()) reserveListingConfiguredPending(context, record); }); if (!lane.current()) return; pendingRef.current = record; setPending(record); setCharge(false);
    const raw = await rpc.configuredStart.mutate(input); if (lane.current()) await acceptJob(parseJob(raw, record), record, lane.controller.signal);
  } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); } }
  async function acceptApply(raw: unknown, record: ListingConfiguredPending, signal: AbortSignal) {
    const value = ListingConfiguredApplyReceiptSchema.parse(raw), expected = { ...scope, operationId: record.runOperationId, applyOperationId: record.operationId };
    if (!same(value) || canonical(value.scope) !== canonical(expected) || !persisted(record) || value.status === "committed" && (value.requestHash !== record.requestHash || value.resultHash !== record.resultHash || !value.afterHash || value.reasonCode !== null)
      || value.status !== "committed" && (value.requestHash !== null || value.resultHash !== null || value.afterHash !== null || value.listingId !== null || value.candidateIds.length)) invalid();
    if (value.status === "not_found") { setNotice("尚未观察到原应用请求，编号保留；不要另开编号重写。"); return; }
    await release(record, signal); setPreview(null); setHistory(null);
    if (value.status === "committed") {
      const own = application.current, delivered = own?.id === record.operationId && currentBridge.current.deliver(own.outputs, own.receivers);
      setApplied({ operationId: record.runOperationId, sourceHash: record.sourceHash, resultHash: record.resultHash!, outputs: own?.id === record.operationId ? own.outputs : null });
      application.current = null; setNotice(delivered ? "已应用到原草稿／待审核候选，未自动确认或追加模型自检。请继续原编辑和人工审核。" : "原应用已确认；此窗口未提交的编辑稿没有被覆盖。请在原步骤显式读取已应用内容或从历史核对。");
      void utils.listing.getActive.invalidate({ projectId }); void utils.listing.listCandidates.invalidate({ projectId });
    } else { application.current = null; setNotice("原应用已取消，未自动更改原草稿。"); }
  }
  async function recover(cancel = false) { if (busyRef.current || paused.current || denied) return; const lane = begin(); try {
    const record = readListingConfiguredPending(context); if (!record || canonical(record) !== canonical(pendingRef.current) || cancel && cancelFor !== record.operationId) return;
    if (record.kind === "apply") { const input = { ...scope, operationId: record.runOperationId, applyOperationId: record.operationId }, raw = cancel ? await rpc.configuredApplyCancel.mutate(input) : await rpc.configuredApplyCheck.query(input, { signal: lane.controller.signal }); if (lane.current()) await acceptApply(raw, record, lane.controller.signal); }
    else { const input = { ...scope, operationId: record.operationId }, raw = cancel ? await rpc.configuredCancel.mutate(input) : await rpc.configuredCheck.query(input, { signal: lane.controller.signal }); if (lane.current()) await acceptJob(parseJob(raw, record), record, lane.controller.signal); }
  } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); } }
  const recoverRef = useRef(recover); recoverRef.current = recover;
  useEffect(() => { if (!suspended && pending && pending.kind !== "apply" && job && ["queued", "running", "dispatched"].includes(job.state)) { const timer = setTimeout(() => { void recoverRef.current(); }, 2000); return () => clearTimeout(timer); } }, [pending, job, suspended, busy]);
  async function apply() { const record = pendingRef.current; if (!record || record.kind === "apply" || !job?.candidate || !job.resultHash || !job.sourceHash || !job.currentDraftHash || !job.sourceCurrent || !review || !editable.current || busyRef.current || paused.current || denied || storageFailed) return;
    const lane = begin(); try {
      const input = ListingConfiguredApplyInputSchema.parse({ ...scope, operationId: record.runOperationId, applyOperationId: crypto.randomUUID(), expectedSourceHash: job.sourceHash, expectedResultHash: job.resultHash, expectedDraftHash: job.currentDraftHash, titleIndex, confirmHumanReview: true });
      const next: ListingConfiguredPending = { version: 1, context, kind: "apply", operation: record.operation, operationId: input.applyOperationId, runOperationId: input.operationId, requestHash: hash({ identity, request: input }), sourceHash: input.expectedSourceHash, runtimeHash: null, resultHash: input.expectedResultHash };
      await locked(lane.controller.signal, async () => { if (!lane.current()) return; if (!persisted(record)) invalid(); reserveListingConfiguredPending(context, next, record.operationId); }); if (!lane.current()) return;
      application.current = { id: next.operationId, receivers: currentBridge.current.capture(), outputs: job.candidate.outputs }; pendingRef.current = next; setPending(next); setReview(false);
      const raw = await rpc.configuredApply.mutate(input); if (lane.current()) await acceptApply(raw, next, lane.controller.signal);
    } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); }
  }
  async function readHistory(beforeId: number | null = null, nextCursors: Array<number | null> = [null]) { if (busyRef.current || paused.current || denied) return; const lane = begin(); setHistory(null); try {
    const input = { ...scope, beforeId, limit: 20 }, value = ListingConfiguredHistoryResultSchema.parse(await rpc.configuredHistory.query(input, { signal: lane.controller.signal })); if (!lane.current()) return;
    if (!same(value) || canonical(value.scope) !== canonical(input) || new Set(value.items.map(row => row.id)).size !== value.items.length || new Set(value.items.map(row => row.operationId)).size !== value.items.length || value.items.some((row, index) => beforeId !== null && row.id >= beforeId || index > 0 && row.id >= value.items[index - 1].id) || value.nextBeforeId !== null && value.nextBeforeId !== value.items.at(-1)?.id) invalid(); setHistory(value); setCursors(nextCursors);
  } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); } }
  async function openHistory(row: NonNullable<typeof history>["items"][number]) { if (busyRef.current || paused.current || denied || pendingRef.current || storageFailed) return; const lane = begin(); try {
    const record: ListingConfiguredPending = { version: 1, context, kind: "observed", operation: row.operation, operationId: row.operationId, runOperationId: row.operationId, requestHash: null, sourceHash: row.sourceHash, runtimeHash: null, resultHash: null };
    await locked(lane.controller.signal, async () => { if (lane.current()) reserveListingConfiguredPending(context, record); }); if (!lane.current()) return; pendingRef.current = record; setPending(record); setPreview(null);
    const raw = await rpc.configuredCheck.query({ ...scope, operationId: row.operationId }, { signal: lane.controller.signal }); if (lane.current()) await acceptJob(parseJob(raw, record), record, lane.controller.signal);
  } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); } }
  async function dismiss() { const record = pendingRef.current; if (!record || record.kind === "apply" || job?.state !== "succeeded" || busyRef.current || paused.current || !window.confirm("结束本地候选查看？服务端候选和原草稿不会删除，可从历史重新读取。")) return; const lane = begin(); try { await release(record, lane.controller.signal); if (lane.current()) { setJob(null); setPreview(null); } } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); } }
  async function readApplied() { if (!applied || busyRef.current || paused.current || denied) return; const lane = begin(); try {
    const value = ListingConfiguredViewSchema.parse(await rpc.configuredCheck.query({ ...scope, operationId: applied.operationId }, { signal: lane.controller.signal })); if (!lane.current()) return;
    if (!value.candidate) return invalid();
    if (!same(value) || value.scope.operationId !== applied.operationId || value.state !== "succeeded" || value.sourceHash !== applied.sourceHash || value.resultHash !== applied.resultHash || hash(value.candidate) !== applied.resultHash) invalid();
    setApplied({ ...applied, outputs: value.candidate.outputs });
  } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); } }
  function loadApplied(operation: string) { if (!bridge.enabled || !applied?.outputs || busyRef.current || paused.current || denied || !window.confirm("明确将已核验的已应用候选载入这个原步骤？将替换该步骤当前本地草稿，不会再次调用模型、写入或代替人工确认。")) return;
    const delivered = currentBridge.current.deliver({ [operation]: applied.outputs[operation] }, currentBridge.current.capture());
    setNotice(delivered ? "已按明确选择载入原编辑步骤，请继续人工核对；没有新模型调用或服务端写入。" : "请先切换到对应原步骤；当前未覆盖任何本地草稿。五点候选请使用原候选审核账本。");
  }
  const titleOutput = job?.candidate?.outputs.title, titles = titleOutput && (Array.isArray(titleOutput.titles) ? titleOutput.titles : Array.isArray(titleOutput.candidates) ? titleOutput.candidates : [titleOutput]);
  return <section className="min-w-0 max-w-full space-y-3 rounded border p-4" aria-label="Listing已保存配置生成与恢复">
    <h3 className="font-semibold">按已保存 Listing 配置生成</h3><label className="flex items-center gap-2"><input type="checkbox" checked={bridge.enabled} disabled={busy || !!pending} onChange={event => bridge.setEnabled(event.target.checked)} />使用新配置化执行方式</label>
    <p className="text-sm text-muted-foreground">覆盖8种主要生成操作，保留用户 Listing Skill、七方向与原编辑／审核流程。新方式先读来源和总费用，再明确提交；不会失败后转用旧收费接口。旧任务恢复仍保留。关键词扩写、独立优化与完整自检由下方独立辅助面板核对稿件、费用及原请求恢复。</p>
    {bridge.enabled && <><p>{bridge.intent ? `当前准备：${LISTING_CONFIGURED_LABELS[bridge.intent.operation]}` : "请在原步骤点击生成，准备对应来源；此动作不会调用模型。"}</p><Button variant="outline" disabled={!bridge.intent || busy || !!pending || denied || suspended} onClick={() => void readPreview()}>读取完整来源与费用预览</Button></>}
    {notice && <p role="status">{notice}</p>}
    {applied && <div className="space-y-2 rounded border p-3 text-sm"><p>已核验的人工应用结果保留在本窗口；切换步骤不会自动覆盖该步骤脏稿。载入原编辑器需保持新配置化方式，避免触发旧协议自动自检。</p>{!applied.outputs ? <Button variant="outline" disabled={busy || denied || suspended} onClick={() => void readApplied()}>读取已应用的原候选（不重生成）</Button> : <div className="flex flex-wrap gap-2">{Object.keys(applied.outputs).map(operation => <Button key={operation} variant="outline" disabled={!bridge.enabled || busy || denied || suspended} onClick={() => loadApplied(operation)}>载入{LISTING_CONFIGURED_LABELS[operation as ListingConfiguredOperation] || operation}到原步骤</Button>)}</div>}</div>}
    {preview && <div className="min-w-0 space-y-2 break-words text-sm"><p>当前项目 #{projectId} · 工作区 #{owner.workspaceId} · {LISTING_CONFIGURED_LABELS[preview.request.operation]}</p><p>竞品研究编号：{preview.request.analysisIds.join("、") || "明确不使用竞品"}（研究不是本品事实）</p><p>本次已审核心：{preview.request.coreRevisionIds.join("、") || "无"} · 当前可用核心：{preview.existingConfirmedCoreIds.join("、") || "无"}</p><p>来源哈希 {preview.sourceHash}</p><p>草稿版本 {preview.draftHash}</p><p>已保存配置版本 {preview.configuration?.revision ?? "未就绪"} · {preview.configuration?.hash ?? "未就绪"}</p><p>执行绑定 {preview.runtimeHash ?? "未就绪"}</p>
      {preview.stages.map(stage => <div key={stage.operation} className="rounded border p-2"><p>{LISTING_CONFIGURED_LABELS[stage.operation]} · {stage.skillSlug} v{stage.skillVersion} · {stage.skillHash}</p><p>已批准模型顺序：{stage.models.map(model => `${model.slug}（单次上限 USD ${(model.maxCostCents / 100).toFixed(2)}，配置 ${model.configurationHash}）`).join(" → ")}</p><p>已知响应后的质量修正上限 {stage.maxQualityRepairs} 次；结果未知不重发。</p></div>)}
      {preview.available ? <><p>本次最多 {preview.maxCalls} 次模型调用，授权总预算上限 USD {((preview.maxCostCents ?? 0) / 100).toFixed(2)}。含已批准的有限质量修正／后备；实际费用以供应商账单为准。未知回执绝不重发。</p><label className="flex items-center gap-2"><input type="checkbox" checked={charge} disabled={busy || !!pending || !canEdit} onChange={event => setCharge(event.target.checked)} />我确认上述完整范围、已保存配置及总费用上限</label><Button disabled={!charge || busy || !!pending || !canEdit || storageFailed || suspended || !bridge.enabled} onClick={() => void start()}>确认费用并提交后台生成</Button></> : <p role="status">{reasonText(preview.reasonCode)}</p>}</div>}
    {pending && <div className="space-y-2 break-words"><p>{LISTING_CONFIGURED_LABELS[pending.operation]} · {pending.kind === "apply" ? "人工应用" : "生成"}原编号：{pending.operationId}</p><div className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={busy || denied || suspended} onClick={() => void recover()}>检查原请求</Button><label><input type="checkbox" checked={cancelFor === pending.operationId} disabled={busy} onChange={event => setCancelFor(event.target.checked ? pending.operationId : null)} />确认取消此原编号</label><Button variant="outline" disabled={busy || denied || suspended || cancelFor !== pending.operationId} onClick={() => void recover(true)}>取消原请求</Button></div></div>}
    {job && <div className="space-y-3"><p role="status">{stateLabels[job.state]} · 已完成 {job.completedStages} 个阶段 {reasonText(job.errorCode)}</p>{job.candidate && <><details><summary>查看完整候选和每条依据</summary><div className="max-h-[36rem] overflow-auto"><ListingConfiguredCandidateView outputs={job.candidate.outputs} /></div></details>
      {!job.sourceCurrent && <p role="alert">原来源已变化，不能应用这个候选；现有草稿保留。</p>}
      {titles && <label className="block">明确选择要应用的标题<select className="block max-w-full rounded border p-2" aria-label="要应用的标题" value={titleIndex ?? ""} disabled={busy || !canEdit} onChange={event => setTitleIndex(event.target.value === "" ? null : Number(event.target.value))}><option value="">请人工选择，不自动采用第一条</option>{titles.map((item, index) => <option key={index} value={index}>{index + 1}. {typeof item === "object" && item ? String((item as Record<string, unknown>).title ?? (item as Record<string, unknown>).layer1 ?? "标题候选") : "标题候选"}</option>)}</select></label>}
      <label className="flex items-start gap-2"><input type="checkbox" checked={review} disabled={busy || !canEdit} onChange={event => setReview(event.target.checked)} />我已核对完整候选，明确应用到原草稿／待审核账本；不会确认产品事实或锁定Listing。当前步骤本地内容将仅在应用期间未改动时载入。</label>
      <div className="flex flex-wrap gap-2"><Button disabled={!review || !!titles && titleIndex === null || !job.sourceCurrent || !job.currentDraftHash || busy || !canEdit || suspended || denied || storageFailed || !pending || pending.kind === "apply"} onClick={() => void apply()}>人工应用候选到原流程</Button><Button variant="outline" disabled={busy || !pending || pending.kind === "apply"} onClick={() => void dismiss()}>结束候选查看</Button></div>
    </>}</div>}
    <details><summary>本人配置化任务与候选历史</summary><Button variant="outline" disabled={busy || denied || suspended} onClick={() => void readHistory()}>读取本人完整分页历史</Button>{history && <div className="max-h-80 space-y-2 overflow-auto">{history.items.length === 0 && <p>当前页无任务。</p>}{history.items.map(row => <div key={row.id} className="break-words rounded border p-2 text-sm"><p>{LISTING_CONFIGURED_LABELS[row.operation]} · {stateLabels[row.state]} · {row.createdAt}</p><p>{row.operationId}</p><Button variant="outline" disabled={busy || !!pending || denied || suspended || storageFailed} onClick={() => void openHistory(row)}>读取此原任务</Button></div>)}<Button variant="outline" disabled={busy || cursors.length < 2} onClick={() => { const prior = cursors.slice(0, -1); void readHistory(prior.at(-1)!, prior); }}>历史上一页</Button><Button variant="outline" disabled={busy || history.nextBeforeId === null} onClick={() => void readHistory(history.nextBeforeId, [...cursors, history.nextBeforeId])}>历史下一页</Button></div>}</details>
  </section>;
}
