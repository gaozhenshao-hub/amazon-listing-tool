import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ListingAuxiliaryPreviewInputSchema, ListingAuxiliaryPreviewResultSchema, ListingAuxiliaryStartInputSchema, ListingAuxiliaryViewSchema, ListingAuxiliaryApplyInputSchema, ListingAuxiliaryApplyReceiptSchema, ListingAuxiliaryHistoryResultSchema,
  listingAuxiliaryCanonical as canonical, listingAuxiliaryHash as hash, listingAuxiliaryDraftHash, listingAuxiliaryTargets,
  type ListingAuxiliaryPreviewInput, type ListingAuxiliaryStartInput, type ListingAuxiliaryOperationInput, type ListingAuxiliaryApplyInput, type ListingAuxiliaryApplyOperationInput,
  type ListingAuxiliaryCandidate, type ListingAuxiliaryHistoryResult, type ListingAuxiliaryOperation } from "@shared/listingAuxiliaryWorkflow";
import { useListingConfiguredGeneration } from "./ListingConfiguredGenerationContext";
import { useListingAuxiliary, type ListingAuxiliaryBridge, type AuxiliaryBinding, type AuxiliaryApplication } from "./ListingAuxiliaryContext";
import { readListingAuxiliaryPending, reserveListingAuxiliaryPending, releaseListingAuxiliaryPending, withListingAuxiliaryPendingLock, subscribeListingAuxiliaryPending, type ListingAuxiliaryPending } from "./listingAuxiliaryPending";
import ListingAuxiliaryCandidateView from "./ListingAuxiliaryCandidateView";

export const AUXILIARY_LABELS: Record<ListingAuxiliaryOperation, string> = { keywordFabe: "关键词FABE扩写", optimizeBullet: "单条优化", checkBullet: "卖点自检（含批量）", checkTitle: "标题10项自检", checkDescription: "描述8项自检", checkSearchTerms: "搜索词5项自检", checkQa: "QA8项自检" };
const states: Record<string, string> = { queued: "辅助任务已排队", running: "辅助任务执行中", dispatched: "已派发模型，等待原回执", succeeded: "完整辅助候选已保存，尚未人工应用", failed: "辅助任务失败，未自动重发", canceled: "原辅助请求已取消", outcome_unknown: "结果未知，仅检查或取消原编号", not_found: "尚未观察到原请求，不能换编号重发" };
const reason = (code: string | null) => ({ EXECUTION_DISABLED: "辅助配置化执行尚未启用", WRITES_DISABLED: "新写开关尚未启用", WORKER_DISABLED: "辅助后台尚未启用", CONFIGURATION_UNAVAILABLE: "已保存Listing配置不可用", APPROVAL_UNAVAILABLE: "辅助Skill、模型或费用审批尚未就绪", SOURCE_APPROVAL_UNAVAILABLE: "来源审批尚未就绪", SOURCE_CHANGED: "持久来源已变化，请核对当前来源", DRAFT_CHANGED: "本地稿件已变化，请从原入口重新准备", CORE_REQUIRED: "请先确认本品事实和核心版本" } as Record<string, string>)[code ?? ""] ?? `当前不可用（${code ?? "原因未提供"}）`;
type Owner = { userId: number; workspaceId: number; role: string };
type Rpc = {
  auxiliaryPreview: { query(input: ListingAuxiliaryPreviewInput, options: { signal: AbortSignal }): Promise<unknown> };
  auxiliaryStart: { mutate(input: ListingAuxiliaryStartInput): Promise<unknown> };
  auxiliaryCheck: { query(input: ListingAuxiliaryOperationInput, options: { signal: AbortSignal }): Promise<unknown> };
  auxiliaryCancel: { mutate(input: ListingAuxiliaryOperationInput): Promise<unknown> };
  auxiliaryApply: { mutate(input: ListingAuxiliaryApplyInput): Promise<unknown> };
  auxiliaryApplyCheck: { query(input: ListingAuxiliaryApplyOperationInput, options: { signal: AbortSignal }): Promise<unknown> };
  auxiliaryApplyCancel: { mutate(input: ListingAuxiliaryApplyOperationInput): Promise<unknown> };
  auxiliaryHistory: { query(input: ListingAuxiliaryHistoryResult["scope"], options: { signal: AbortSignal }): Promise<unknown> };
};
export default function ListingAuxiliaryControls({ projectId }: { projectId: number }) {
  const auth = useAuth(), permissions = usePermissions(), bridge = useListingAuxiliary(), main = useListingConfiguredGeneration(), user = auth.user;
  const valid = !!user && Number.isSafeInteger(user.id) && user.id > 0 && typeof user.defaultWorkspaceId === "number" && Number.isSafeInteger(user.defaultWorkspaceId) && user.defaultWorkspaceId > 0 && !!user.role && Number.isSafeInteger(projectId) && projectId > 0;
  const key = valid ? canonical([user.id, user.defaultWorkspaceId, user.role, projectId]) : null, boundary = useRef({ key, epoch: 0 }), shown = useRef<object | null>(null);
  if (key !== boundary.current.key) boundary.current = { key, epoch: boundary.current.epoch + 1 };
  const token = boundary.current, paused = auth.loading || permissions.isLoading;
  if (!bridge) return null;
  if (!valid || auth.error || !permissions.isLoading && !permissions.canRead("listing", "listing_generate")) { shown.current = null; return <p role="alert">辅助执行身份或权限不可核验，已隐藏旧资料；原编号保留。</p>; }
  if (!paused) shown.current = token; if (paused && shown.current !== token) return <p role="status">正在确认辅助执行身份…</p>;
  return <div hidden={paused}><ListingAuxiliaryController key={`${key}:${token.epoch}`} projectId={projectId} owner={{ userId: user.id, workspaceId: user.defaultWorkspaceId!, role: user.role }} bridge={bridge} enabled={!!main?.enabled} suspended={paused} canEdit={permissions.canEdit("listing", "listing_generate")} /></div>;
}
export function ListingAuxiliaryController({ projectId, owner, bridge, enabled, suspended = false, canEdit = false }: { projectId: number; owner: Owner; bridge: ListingAuxiliaryBridge; enabled: boolean; suspended?: boolean; canEdit?: boolean }) {
  const utils = trpc.useUtils(), rpc = utils.client.listing as unknown as Rpc, identity = { userId: owner.userId, workspaceId: owner.workspaceId }, scope = { expectedWorkspaceId: owner.workspaceId, projectId };
  const [context] = useState(() => ({ ...identity, projectId }));
  const [preview, setPreview] = useState<ReturnType<typeof ListingAuxiliaryPreviewResultSchema.parse> | null>(null), [job, setJob] = useState<ReturnType<typeof ListingAuxiliaryViewSchema.parse> | null>(null);
  const [pending, setPending] = useState<ListingAuxiliaryPending | null>(null), [history, setHistory] = useState<ListingAuxiliaryHistoryResult | null>(null), [cursors, setCursors] = useState<Array<number | null>>([null]);
  const [busy, setBusy] = useState(false), [charge, setCharge] = useState(false), [review, setReview] = useState(false), [cancelFor, setCancelFor] = useState<string | null>(null), [notice, setNotice] = useState(""), [denied, setDenied] = useState(false), [storageFailed, setStorageFailed] = useState(false);
  const [applied, setApplied] = useState<{ operationId: string; sourceHash: string; resultHash: string; draftHash: string; application: AuxiliaryApplication; candidate: ListingAuxiliaryCandidate | null; request: ListingAuxiliaryPreviewInput | null } | null>(null);
  const live = useRef(false), paused = useRef(suspended), editable = useRef(canEdit), busyRef = useRef(false), epoch = useRef(0), abort = useRef<AbortController | null>(null), ownStorage = useRef(false), pendingRef = useRef(pending), currentBridge = useRef(bridge);
  const previewBinding = useRef<AuxiliaryBinding | null>(null), runBinding = useRef<{ operationId: string; binding: AuxiliaryBinding } | null>(null), applying = useRef<{ id: string; binding: AuxiliaryBinding | null; candidate: ListingAuxiliaryCandidate; request: ListingAuxiliaryPreviewInput } | null>(null);
  paused.current = suspended; editable.current = canEdit; currentBridge.current = bridge; pendingRef.current = pending;
  const stop = () => { epoch.current++; abort.current?.abort(); busyRef.current = false; setBusy(false); };
  const begin = () => { const ticket = ++epoch.current, controller = new AbortController(); abort.current?.abort(); abort.current = controller; busyRef.current = true; setBusy(true); setNotice("");
    return { controller, current: () => live.current && !paused.current && ticket === epoch.current && !controller.signal.aborted, finish: () => { if (live.current && ticket === epoch.current) { busyRef.current = false; setBusy(false); } } }; };
  const invalid = (): never => { const error = new Error("Auxiliary response binding mismatch"); error.name = "ListingAuxiliaryResponseError"; throw error; };
  const same = (value: { identity: unknown; scope: { expectedWorkspaceId: number; projectId: number } }) => canonical(value.identity) === canonical(identity) && canonical(value.scope.expectedWorkspaceId) === canonical(scope.expectedWorkspaceId) && value.scope.projectId === projectId;
  function fail(error: unknown) { const code = (error as { data?: { code?: string } })?.data?.code;
    if (error instanceof Error && /^LISTING_AUXILIARY_(?:STORAGE_|LOCK_|PENDING_)/u.test(error.message)) { setStorageFailed(true); setNotice("安全存储或跨窗口锁不可用，禁止新提交；未决编号保留。"); }
    else if (["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(code ?? "") || error instanceof Error && ["ZodError", "ListingAuxiliaryResponseError"].includes(error.name)) { setDenied(true); setPreview(null); setJob(null); setHistory(null); setApplied(null); setNotice("辅助响应身份、范围或内容绑定不可核验，已隐藏旧资料；原编号保留。"); }
    else setNotice("辅助回执尚未核验，原编号保留；仅核对或取消，不自动重发模型或应用。原稿不变。");
    setCharge(false); setReview(false);
  }
  const persisted = (record: ListingAuxiliaryPending) => canonical(readListingAuxiliaryPending(context)) === canonical(record);
  const locked = <T,>(signal: AbortSignal, work: () => Promise<T>) => withListingAuxiliaryPendingLock(context, signal, async () => { ownStorage.current = true; try { return await work(); } finally { ownStorage.current = false; } });
  async function release(record: ListingAuxiliaryPending, signal: AbortSignal) { await locked(signal, async () => { if (!persisted(record)) invalid(); releaseListingAuxiliaryPending(context, record.operationId); }); pendingRef.current = readListingAuxiliaryPending(context); setPending(pendingRef.current); }
  useEffect(() => { live.current = true; const sync = () => { if (ownStorage.current) return; try { const next = readListingAuxiliaryPending(context); if (canonical(next) !== canonical(pendingRef.current)) { stop(); setPreview(null); setJob(null); setCharge(false); setReview(false); setCancelFor(null); applying.current = null; runBinding.current = null; } pendingRef.current = next; setPending(next); } catch (error) { fail(error); } };
    sync(); let unsubscribe = () => {}; try { unsubscribe = subscribeListingAuxiliaryPending(context, sync); } catch (error) { fail(error); } return () => { live.current = false; abort.current?.abort(); unsubscribe(); }; }, [context]);
  useEffect(() => { if (suspended) { stop(); setCharge(false); setReview(false); } }, [suspended]);
  const intentKey = canonical(bridge.intent);
  useEffect(() => { stop(); setPreview(null); setCharge(false); previewBinding.current = null; }, [intentKey]);
  function parseJob(raw: unknown, record: ListingAuxiliaryPending) {
    const value = ListingAuxiliaryViewSchema.parse(raw); if (!same(value) || value.scope.operationId !== record.runOperationId) invalid();
    if (value.request) { if (value.request.operationId !== record.runOperationId || value.request.expectedWorkspaceId !== scope.expectedWorkspaceId || value.request.projectId !== projectId || value.request.operation !== record.operation || record.previewHash !== null && hash(value.request) !== record.previewHash || listingAuxiliaryDraftHash(value.request) !== record.draftHash || value.draftHash !== record.draftHash || value.sourceHash !== record.sourceHash) invalid(); }
    else if (!["not_found", "canceled"].includes(value.state)) invalid();
    if ((value.state === "succeeded") !== (value.candidate !== null && value.resultHash !== null)) invalid();
    if (value.candidate) { const expected = value.request && listingAuxiliaryTargets(value.request); if (!expected || hash(value.candidate) !== value.resultHash || value.candidate.sourceHash !== record.sourceHash || value.candidate.draftHash !== record.draftHash || value.candidate.operation !== record.operation || expected.length !== value.candidate.targets.length || value.completedTargets !== expected.length || expected.some((item, i) => item.targetHash !== value.candidate!.targets[i].targetHash)) invalid(); }
    return value;
  }
  async function acceptJob(raw: unknown, record: ListingAuxiliaryPending, signal: AbortSignal) { const value = parseJob(raw, record); if (!persisted(record)) invalid(); setJob(value); setReview(false); if (["failed", "canceled"].includes(value.state)) await release(record, signal); }
  async function readPreview() { if (!enabled || !bridge.intent || busyRef.current || paused.current || pendingRef.current || denied) return; const binding = bridge.capture(); if (!binding) { setNotice("当前原稿或选择已变化，请从原入口重新准备辅助任务。"); return; } const lane = begin(); try {
    const input = ListingAuxiliaryPreviewInputSchema.parse({ ...scope, ...bridge.intent, operationId: crypto.randomUUID() }), value = ListingAuxiliaryPreviewResultSchema.parse(await rpc.auxiliaryPreview.query(input, { signal: lane.controller.signal }));
    if (!lane.current()) return; if (canonical(value.identity) !== canonical(identity) || canonical(value.request) !== canonical(input) || value.draftHash !== listingAuxiliaryDraftHash(input) || binding.draftHash !== value.draftHash || value.available && (!value.runtimeHash || !value.configuration || value.maxCostCents === null || value.reasonCode !== null)) invalid();
    if (value.available && (value.stages.length !== 1 || value.stages[0].operation !== input.operation || value.stages[0].targetCount !== listingAuxiliaryTargets(input).length || value.maxCalls < value.stages[0].targetCount)) invalid();
    previewBinding.current = binding; setPreview(value); setJob(null); setCharge(false);
  } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); } }
  async function start() { const binding = previewBinding.current; if (!enabled || !preview?.available || !preview.runtimeHash || preview.maxCostCents === null || !charge || !editable.current || busyRef.current || paused.current || pendingRef.current || denied || storageFailed) return;
    if (!binding || !bridge.current(binding)) { setCharge(false); setNotice("费用预览后原稿、排序或锁状态发生变化；请从原入口重新准备，尚未收费。"); return; }
    const lane = begin(); try { const input = ListingAuxiliaryStartInputSchema.parse({ ...preview.request, expectedSourceHash: preview.sourceHash, expectedRuntimeHash: preview.runtimeHash, maxCostCents: preview.maxCostCents, chargeConfirmed: true });
      const record: ListingAuxiliaryPending = { version: 1, context, kind: "start", operation: input.operation, operationId: input.operationId, runOperationId: input.operationId, requestHash: hash({ identity, request: input }), previewHash: hash(preview.request), sourceHash: preview.sourceHash, draftHash: preview.draftHash, runtimeHash: preview.runtimeHash, resultHash: null };
      const reserved = await locked(lane.controller.signal, async () => {
        if (!lane.current()) return false;
        if (!editable.current || !currentBridge.current.current(binding)) { setCharge(false); setNotice("等待安全锁期间原稿、选择或锁状态发生变化；未提交、尚未收费，请从原入口重新准备。"); return false; }
        reserveListingAuxiliaryPending(context, record); return true;
      });
      if (!reserved || !lane.current()) return; pendingRef.current = record; setPending(record); setCharge(false); runBinding.current = { operationId: record.operationId, binding };
      if (!editable.current || !currentBridge.current.current(binding)) { setNotice("提交前原稿绑定已失效，尚未发送收费请求；保留原编号，请核对或取消后重新准备。"); return; }
      const raw = await rpc.auxiliaryStart.mutate(input); if (lane.current()) await acceptJob(raw, record, lane.controller.signal);
    } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); }
  }
  async function acceptApply(raw: unknown, record: ListingAuxiliaryPending, signal: AbortSignal) { const value = ListingAuxiliaryApplyReceiptSchema.parse(raw), expected = { ...scope, operationId: record.runOperationId, applyOperationId: record.operationId };
    if (!same(value) || canonical(value.scope) !== canonical(expected) || !persisted(record) || value.status === "committed" && (value.requestHash !== record.requestHash || value.resultHash !== record.resultHash || value.draftHash !== record.draftHash || !value.reportArtifactId || value.reasonCode !== null) || value.status !== "committed" && (value.requestHash !== null || value.resultHash !== null || value.draftHash !== null || value.reportArtifactId !== null || value.candidateIds.length)) invalid();
    if (value.status === "committed" && (record.operation === "optimizeBullet" ? value.candidateIds.length !== 1 : value.candidateIds.length !== 0)) invalid();
    if (value.status === "not_found") { setNotice("未观察到原应用回执，保留原编号；不会重新应用。"); return; }
    await release(record, signal); setPreview(null); setHistory(null);
    if (value.status === "committed") { const own = applying.current, match = own?.id === record.operationId, application = { candidateIds: value.candidateIds, reportArtifactId: value.reportArtifactId };
      const delivered = !!match && currentBridge.current.deliver(own.candidate, own.binding, application);
      setApplied({ operationId: record.runOperationId, sourceHash: record.sourceHash, resultHash: record.resultHash!, draftHash: record.draftHash, application, candidate: match ? own.candidate : null, request: match ? own.request : null });
      setNotice(delivered ? "辅助结果已按原稿绑定载入原编辑器；未确认事实、锁定步骤或调用旧评分保存。" : "辅助应用已确认，但当前稿件、选择或锁状态不再匹配，未覆盖本地稿。结果可完整对照。");
      if (record.operation === "optimizeBullet") void utils.listing.listCandidates.invalidate({ projectId });
    } else setNotice("原辅助应用已取消，原稿保持不变。");
    applying.current = null;
  }
  async function recover(cancel = false) { if (busyRef.current || paused.current || denied) return; const lane = begin(); try { const record = readListingAuxiliaryPending(context); if (!record || canonical(record) !== canonical(pendingRef.current) || cancel && cancelFor !== record.operationId) return;
    if (record.kind === "apply") { const input = { ...scope, operationId: record.runOperationId, applyOperationId: record.operationId }, raw = cancel ? await rpc.auxiliaryApplyCancel.mutate(input) : await rpc.auxiliaryApplyCheck.query(input, { signal: lane.controller.signal }); if (lane.current()) await acceptApply(raw, record, lane.controller.signal); }
    else { const input = { ...scope, operationId: record.operationId }, raw = cancel ? await rpc.auxiliaryCancel.mutate(input) : await rpc.auxiliaryCheck.query(input, { signal: lane.controller.signal }); if (lane.current()) await acceptJob(raw, record, lane.controller.signal); }
  } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); } }
  const recoverRef = useRef(recover); recoverRef.current = recover;
  useEffect(() => { if (!suspended && pending && pending.kind !== "apply" && job && ["queued", "running", "dispatched"].includes(job.state)) { const timer = setTimeout(() => { void recoverRef.current(); }, 2000); return () => clearTimeout(timer); } }, [pending, job, suspended, busy]);
  async function apply() { const record = pendingRef.current; if (!enabled || !record || record.kind === "apply" || !job?.candidate || !job.request || !job.resultHash || !job.sourceHash || !job.draftHash || !job.sourceCurrent || !review || !editable.current || busyRef.current || paused.current || denied || storageFailed) return;
    const lane = begin(); try { const input = ListingAuxiliaryApplyInputSchema.parse({ ...scope, operationId: record.runOperationId, applyOperationId: crypto.randomUUID(), expectedSourceHash: job.sourceHash, expectedResultHash: job.resultHash, expectedDraftHash: job.draftHash, confirmHumanReview: true });
      const next: ListingAuxiliaryPending = { ...record, kind: "apply", operationId: input.applyOperationId, requestHash: hash({ identity, request: input }), runtimeHash: null, resultHash: input.expectedResultHash };
      await locked(lane.controller.signal, async () => { if (!lane.current()) return; if (!persisted(record)) invalid(); reserveListingAuxiliaryPending(context, next, record.operationId); }); if (!lane.current()) return;
      applying.current = { id: next.operationId, candidate: job.candidate, request: job.request, binding: runBinding.current?.operationId === record.runOperationId ? runBinding.current.binding : null }; pendingRef.current = next; setPending(next); setReview(false);
      const raw = await rpc.auxiliaryApply.mutate(input); if (lane.current()) await acceptApply(raw, next, lane.controller.signal);
    } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); }
  }
  async function readHistory(beforeId: number | null = null, next: Array<number | null> = [null]) { if (busyRef.current || paused.current || denied) return; const lane = begin(); setHistory(null); try { const input = { ...scope, beforeId, limit: 20 }, value = ListingAuxiliaryHistoryResultSchema.parse(await rpc.auxiliaryHistory.query(input, { signal: lane.controller.signal })); if (!lane.current()) return;
    if (!same(value) || canonical(value.scope) !== canonical(input) || new Set(value.items.map(item => item.id)).size !== value.items.length || new Set(value.items.map(item => item.operationId)).size !== value.items.length || value.items.some((item, i) => beforeId !== null && item.id >= beforeId || i > 0 && item.id >= value.items[i - 1].id) || value.nextBeforeId !== null && value.nextBeforeId !== value.items.at(-1)?.id) invalid(); setHistory(value); setCursors(next);
  } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); } }
  async function openHistory(row: ListingAuxiliaryHistoryResult["items"][number]) { if (busyRef.current || paused.current || denied || pendingRef.current || storageFailed) return; const lane = begin(); try { const record: ListingAuxiliaryPending = { version: 1, context, kind: "observed", operation: row.operation, operationId: row.operationId, runOperationId: row.operationId, requestHash: null, previewHash: null, sourceHash: row.sourceHash, draftHash: row.draftHash, runtimeHash: null, resultHash: null };
    await locked(lane.controller.signal, async () => { if (lane.current()) reserveListingAuxiliaryPending(context, record); }); if (!lane.current()) return; pendingRef.current = record; setPending(record); runBinding.current = null; setPreview(null);
    const raw = await rpc.auxiliaryCheck.query({ ...scope, operationId: row.operationId }, { signal: lane.controller.signal }); if (lane.current()) await acceptJob(raw, record, lane.controller.signal);
  } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); } }
  async function dismiss() { const record = pendingRef.current; if (!record || record.kind === "apply" || job?.state !== "succeeded" || busyRef.current || paused.current || !window.confirm("结束此辅助候选查看？服务端结果和原稿不删除，可从历史读取。")) return; const lane = begin(); try { await release(record, lane.controller.signal); if (lane.current()) { setJob(null); setPreview(null); } } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); } }
  async function readApplied() { if (!applied || busyRef.current || paused.current || denied) return; const lane = begin(); try { const raw = await rpc.auxiliaryCheck.query({ ...scope, operationId: applied.operationId }, { signal: lane.controller.signal }); if (!lane.current()) return;
    const value = parseJob(raw, { version: 1, context, kind: "observed", operation: ListingAuxiliaryViewSchema.parse(raw).request?.operation ?? invalid(), operationId: applied.operationId, runOperationId: applied.operationId, requestHash: null, previewHash: null, sourceHash: applied.sourceHash, draftHash: applied.draftHash, runtimeHash: null, resultHash: null });
    if (!value.candidate || !value.request || value.resultHash !== applied.resultHash) invalid(); setApplied({ ...applied, candidate: value.candidate, request: value.request });
  } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); } }
  return <section className="min-w-0 max-w-full space-y-3 rounded border p-4" aria-label="Listing辅助配置化执行与恢复"><h3 className="font-semibold">扩写、优化与完整自检</h3>
    <p className="text-sm text-muted-foreground">新配置化方式下，原入口可准备关键词FABE、单条优化、五类自检及全部卖点自检。先核对完整未保存稿、研究范围、Skill和总费用，明确提交；不会自动调用旧收费接口。评分建议不等于事实或正文确认。</p>
    {enabled && <><p>{bridge.intent ? `当前辅助操作：${AUXILIARY_LABELS[bridge.intent.operation]}` : "请从原表单点击扩写、优化或自检；不会立即调用模型。"}</p><Button variant="outline" disabled={!bridge.intent || busy || !!pending || denied || suspended} onClick={() => void readPreview()}>读取辅助来源与费用预览</Button></>}
    {notice && <p role="status">{notice}</p>}
    {preview && <div className="min-w-0 space-y-2 break-words text-sm"><p>配置版本 {preview.configuration?.revision ?? "未就绪"} · {preview.configuration?.hash ?? "未就绪"}</p><p>持久来源 {preview.sourceHash}</p><p>完整本地稿 {preview.draftHash}</p><p>竞品研究：{preview.request.analysisIds.join("、") || "明确不使用竞品"}；研究不作为本品事实。</p>
      <details><summary>核对实际提交稿件与完整上下文</summary><ListingAuxiliaryCandidateView request={preview.request} candidate={{ version: 1, operation: preview.request.operation, sourceHash: preview.sourceHash, draftHash: preview.draftHash, requiresHumanReview: true, targets: listingAuxiliaryTargets(preview.request).map(item => ({ targetIndex: item.targetIndex, targetHash: item.targetHash, result: { 待执行: "尚未调用模型" } })) }} /></details>
      {preview.stages.map(stage => <div key={stage.operation} className="rounded border p-2"><p>{stage.skillSlug} v{stage.skillVersion} · {stage.targetCount}个目标 · {stage.skillHash}</p><p>批准模型：{stage.models.map(model => `${model.slug}（USD ${(model.maxCostCents / 100).toFixed(2)}）`).join(" → ")}；已知结果后的质量修正上限 {stage.maxQualityRepairs}</p></div>)}
      {preview.limitations.map((item, i) => <p key={i}>{item}</p>)}
      {preview.available ? <><p>整批最多 {preview.maxCalls} 次模型调用，授权总预算上限 USD {((preview.maxCostCents ?? 0) / 100).toFixed(2)}；包含批准的有限质量修正／后备，实际费用以供应商账单为准。</p><label><input type="checkbox" checked={charge} disabled={busy || !!pending || !canEdit} onChange={event => setCharge(event.target.checked)} />我确认辅助任务完整稿件、配置及总费用上限</label><Button disabled={!charge || busy || !!pending || !canEdit || storageFailed || suspended || !enabled} onClick={() => void start()}>确认辅助费用并提交</Button></> : <p role="status">{reason(preview.reasonCode)}</p>}
    </div>}
    {pending && <div className="space-y-2 break-words"><p>{AUXILIARY_LABELS[pending.operation]} · {pending.kind === "apply" ? "应用" : "执行"}原编号：{pending.operationId}</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || denied || suspended} onClick={() => void recover()}>检查原辅助请求</Button><label><input type="checkbox" checked={cancelFor === pending.operationId} disabled={busy} onChange={event => setCancelFor(event.target.checked ? pending.operationId : null)} />确认取消此辅助编号</label><Button variant="outline" disabled={busy || denied || suspended || cancelFor !== pending.operationId} onClick={() => void recover(true)}>取消原辅助请求</Button></div></div>}
    {job && <div className="space-y-3"><p>{states[job.state]} · 已完成目标 {job.completedTargets}{job.request ? `/${listingAuxiliaryTargets(job.request).length}` : ""}</p>{job.errorCode && <p>{reason(job.errorCode)}</p>}{job.candidate && job.request && <><ListingAuxiliaryCandidateView candidate={job.candidate} request={job.request} />{!job.sourceCurrent && <p role="alert">持久来源已变化，此历史结果仅供对照，不能应用。</p>}<label><input type="checkbox" checked={review} disabled={busy || !canEdit} onChange={event => setReview(event.target.checked)} />我已人工审阅完整辅助结果，保存应用记录；优化仅进入待审核账本，评分不修改正文。</label><div className="flex flex-wrap gap-2"><Button disabled={!enabled || !review || !job.sourceCurrent || busy || !canEdit || suspended || denied || storageFailed || !pending || pending.kind === "apply"} onClick={() => void apply()}>人工应用辅助结果</Button><Button variant="outline" disabled={busy || !pending || pending.kind === "apply"} onClick={() => void dismiss()}>结束辅助候选查看</Button></div></>}</div>}
    {applied && <div className="space-y-2"><p>已确认的辅助应用报告仅供完整对照；来源可能变化，不会重新回填本地稿。修改后需从原入口重新准备。</p>{applied.candidate && applied.request ? <ListingAuxiliaryCandidateView candidate={applied.candidate} request={applied.request} /> : <Button variant="outline" disabled={busy || denied || suspended} onClick={() => void readApplied()}>读取已应用辅助结果（不重生成）</Button>}</div>}
    <details><summary>本人辅助任务完整分页历史</summary><Button variant="outline" disabled={busy || denied || suspended} onClick={() => void readHistory()}>读取辅助历史</Button>{history && <div className="max-h-80 space-y-2 overflow-auto">{!history.items.length && <p>当前页无辅助任务。</p>}{history.items.map(row => <div key={row.id} className="break-words rounded border p-2"><p>{AUXILIARY_LABELS[row.operation]} · {states[row.state]} · {row.createdAt}</p><p>{row.operationId}</p><Button variant="outline" disabled={busy || !!pending || denied || suspended || storageFailed} onClick={() => void openHistory(row)}>读取此原辅助任务</Button></div>)}<Button variant="outline" disabled={busy || cursors.length < 2} onClick={() => { const previous = cursors.slice(0, -1); void readHistory(previous.at(-1)!, previous); }}>辅助历史上一页</Button><Button variant="outline" disabled={busy || history.nextBeforeId === null} onClick={() => void readHistory(history.nextBeforeId, [...cursors, history.nextBeforeId])}>辅助历史下一页</Button></div>}</details>
  </section>;
}
