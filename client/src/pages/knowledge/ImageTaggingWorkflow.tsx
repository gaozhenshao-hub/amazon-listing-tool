import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { IMAGE_TAGGING_OPTIONS, IMAGE_TAGGING_TAG_FIELDS, ImageTaggingPreviewSchema, ImageTaggingSubmitInputSchema,
  ImageTaggingJobViewSchema, ImageTaggingApplyInputSchema, ImageTaggingApplyReceiptSchema, ImageTaggingHistorySchema,
  imageTaggingHash, imageTaggingCanonical as canonical, type ImageTaggingTags, type ImageTaggingPreview,
  type ImageTaggingPreviewInput, type ImageTaggingSubmitInput, type ImageTaggingOperationInput, type ImageTaggingJobView,
  type ImageTaggingApplyInput, type ImageTaggingApplyOperationInput, type ImageTaggingApplyReceipt,
} from "@shared/imageTagging";
import { readImageTaggingPending, reserveImageTaggingPending, releaseImageTaggingPending, subscribeImageTaggingPending,
  withImageTaggingPendingLock, type ImageTaggingPending, type ImageTaggingPendingContext } from "./imageTaggingPending";

export type ImageTaggingOwner = { userId: number; workspaceId: number; role: string };
export type ImageTaggingWorkflowProps = { setId: number; onApplied?: () => void | Promise<void>; onDirtyChange?: (dirty: boolean) => void };
type Scope = { expectedWorkspaceId: number; imageSetId: number };
type Rpc = {
  taggingPreview: { query: (input: ImageTaggingPreviewInput, options: { signal: AbortSignal }) => Promise<unknown> };
  taggingStart: { mutate: (input: ImageTaggingSubmitInput) => Promise<unknown> };
  taggingCheck: { query: (input: ImageTaggingOperationInput, options: { signal: AbortSignal }) => Promise<unknown> };
  taggingCancel: { mutate: (input: ImageTaggingOperationInput) => Promise<unknown> };
  taggingHistory: { query: (input: Scope, options: { signal: AbortSignal }) => Promise<unknown> };
  taggingApply: { mutate: (input: ImageTaggingApplyInput) => Promise<unknown> };
  taggingApplyCheck: { query: (input: ImageTaggingApplyOperationInput, options: { signal: AbortSignal }) => Promise<unknown> };
  taggingApplyCancel: { mutate: (input: ImageTaggingApplyOperationInput) => Promise<unknown> };
};
type History = ReturnType<typeof ImageTaggingHistorySchema.parse>;
type Decision = { candidateHash: string; decision: "pending" | "accept" | "exclude"; tags: ImageTaggingTags };
const changedEvent = "image-tagging-source-changed-v1";
const idOf = (value: ImageTaggingPending | null) => value?.operationId ?? null;
const ongoing = (state: string) => ["queued", "running"].includes(state);
const unresolved = (state: string) => ["queued", "running", "outcome_unknown", "not_found"].includes(state);
const fieldLabels: Record<keyof ImageTaggingTags, string> = { tagCategory: "产品类目", tagImageTypeMain: "图片大类", tagImageTypeSub: "图片子类",
  tagSellingPointCategory: "卖点大类", tagSellingPointDetail: "卖点子类", tagComposition: "构图", tagColorSchemeV2: "主色方案", tagDesignStyleV2: "设计风格" };
const stateLabels: Record<string, string> = { pending: "等待识别", dispatched: "已派发，等待回执", succeeded: "候选已保存，未应用", failed: "失败，未重试",
  skipped_confirmed: "保留已人工确认标签", skipped_complete: "已识别（含明确未知），本模式跳过", canceled: "已取消", outcome_unknown: "结果未知，不会自动重试",
  applied: "人工应用已确认", excluded: "人工排除此候选", queued: "已排队", running: "逐图识别中", partial: "部分完成，请核对缺口", not_found: "尚未观察到原请求，不能判定失败" };
const reasons: Record<string, string> = { WRITES_DISABLED: "新标签任务写入尚未启用", WORKER_DISABLED: "标签后台执行尚未启用", IMAGE_TAGGING_WRITES_DISABLED: "新标签任务写入尚未启用",
  IMAGE_TAGGING_WORKER_DISABLED: "标签后台执行尚未启用", CONFIGURATION_UNAVAILABLE: "Tagger 专属配置不可用", APPROVAL_UNAVAILABLE: "受审来源或费用审批尚未就绪",
  EXECUTION_DISABLED: "新标签写入或后台执行尚未启用", ACCESS_DENIED: "当前没有此操作的授权", UNAVAILABLE: "当前来源或执行前置尚不可核验",
  SOURCE_CHANGED: "图片或标签来源已变化，请重新核对", NO_ELIGIBLE_IMAGES: "此模式没有需要识别的图片", MODEL_UNAVAILABLE: "专属视觉模型不可用" };
function reason(code: string | null) { return code ? reasons[code] ?? `当前不可操作（${code}）` : ""; }
function tagsOnly(value: ImageTaggingTags): ImageTaggingTags { return Object.fromEntries(IMAGE_TAGGING_TAG_FIELDS.map(field => [field, value[field]])) as ImageTaggingTags; }
function safePreview(url: string | null) { if (!url) return undefined; try { const parsed = new URL(url); return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password ? url : undefined; } catch { return undefined; } }
function choices(field: keyof ImageTaggingTags, tags: ImageTaggingTags): readonly string[] {
  switch (field) {
    case "tagCategory": return IMAGE_TAGGING_OPTIONS.categories;
    case "tagImageTypeMain": return Object.keys(IMAGE_TAGGING_OPTIONS.imageTypes);
    case "tagImageTypeSub": return (IMAGE_TAGGING_OPTIONS.imageTypes as Record<string, readonly string[]>)[tags.tagImageTypeMain] ?? [];
    case "tagSellingPointCategory": return Object.keys(IMAGE_TAGGING_OPTIONS.sellingPoints);
    case "tagSellingPointDetail": return IMAGE_TAGGING_OPTIONS.sellingPoints[tags.tagSellingPointCategory] ?? [];
    case "tagComposition": return IMAGE_TAGGING_OPTIONS.compositions;
    case "tagColorSchemeV2": return IMAGE_TAGGING_OPTIONS.colors;
    case "tagDesignStyleV2": return IMAGE_TAGGING_OPTIONS.styles;
  }
}

/** Fresh private boundary; same-owner authentication refresh pauses rather than
 * destroying a human draft. No query or paid action happens on mount. */
export default function ImageTaggingWorkflow(props: ImageTaggingWorkflowProps) {
  const auth = useAuth(), permissions = usePermissions(), user = auth.user;
  const valid = user && Number.isSafeInteger(user.id) && user.id > 0 && user.id <= 2_147_483_647 && typeof user.defaultWorkspaceId === "number"
    && Number.isSafeInteger(user.defaultWorkspaceId) && user.defaultWorkspaceId > 0 && user.defaultWorkspaceId <= 2_147_483_647
    && typeof user.role === "string" && user.role.trim().length > 0 && Number.isSafeInteger(props.setId) && props.setId > 0 && props.setId <= 2_147_483_647;
  const identity = valid ? JSON.stringify([user.id, user.defaultWorkspaceId, user.role, props.setId]) : null;
  const boundary = useRef({ identity, epoch: 0 }), shown = useRef<object | null>(null);
  if (boundary.current.identity !== identity) boundary.current = { identity, epoch: boundary.current.epoch + 1 };
  const token = boundary.current, suspended = auth.loading || permissions.isLoading;
  if (!valid || auth.error || !permissions.isLoading && !permissions.canRead("knowledge", "kb_images")) { shown.current = null; return <p role="alert">当前身份或图片知识库权限不可核验，未显示标签任务资料。</p>; }
  if (!suspended) shown.current = token;
  if (suspended && shown.current !== token) return <p role="status">正在核对标签任务身份与权限…</p>;
  return <div hidden={suspended}><ImageTaggingWorkflowController key={`${identity}:${token.epoch}`} {...props}
    owner={{ userId: user!.id, workspaceId: user!.defaultWorkspaceId!, role: user!.role }} suspended={suspended}
    canEdit={permissions.canEdit("knowledge", "kb_images")} /></div>;
}

export function ImageTaggingWorkflowController({ owner, setId, suspended = false, canEdit = false, onApplied, onDirtyChange }: ImageTaggingWorkflowProps & {
  owner: ImageTaggingOwner; suspended?: boolean; canEdit?: boolean;
}) {
  const rpc = trpc.useUtils().client.kbImages as unknown as Rpc;
  const [context] = useState<ImageTaggingPendingContext>(() => ({ userId: owner.userId, workspaceId: owner.workspaceId, imageSetId: setId }));
  const scope: Scope = { expectedWorkspaceId: owner.workspaceId, imageSetId: setId }, identity = { userId: owner.userId, workspaceId: owner.workspaceId };
  const [mode, setMode] = useState<"missing" | "all_unconfirmed">("missing"), [preview, setPreview] = useState<ImageTaggingPreview | null>(null);
  const [job, setJob] = useState<ImageTaggingJobView | null>(null), [comparison, setComparison] = useState<ImageTaggingJobView | null>(null), [history, setHistory] = useState<History | null>(null);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({}), [dirty, setDirty] = useState(false), [needsReview, setNeedsReview] = useState(false);
  const [pending, setPending] = useState<ImageTaggingPending | null>(null), [cancelFor, setCancelFor] = useState<string | null>(null);
  const [charge, setCharge] = useState(false), [humanConfirmed, setHumanConfirmed] = useState(false), [page, setPage] = useState(0), [candidatePage, setCandidatePage] = useState(0);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [storageError, setStorageError] = useState(false), [denied, setDenied] = useState(false);
  const live = useRef(false), paused = useRef(suspended), editable = useRef(canEdit), busyRef = useRef(false), dirtyRef = useRef(false), ownStorage = useRef(false), ownEvent = useRef(false);
  const epoch = useRef(0), abort = useRef<AbortController | null>(null), observed = useRef<string | null>(null), ownSubmission = useRef<string | null>(null);
  const previewOperation = useRef<string | null>(null), callback = useRef(onApplied), dirtyCallback = useRef(onDirtyChange);
  paused.current = suspended; editable.current = canEdit; dirtyRef.current = dirty; callback.current = onApplied; dirtyCallback.current = onDirtyChange;
  const usable = () => live.current && !paused.current && !denied;
  function stopLane() { epoch.current++; abort.current?.abort(); busyRef.current = false; setBusy(false); }
  function begin() {
    const ticket = ++epoch.current, controller = new AbortController(); abort.current?.abort(); abort.current = controller; busyRef.current = true; setBusy(true); setNotice("");
    return { controller, current: () => usable() && ticket === epoch.current && !controller.signal.aborted,
      finish: () => { if (live.current && ticket === epoch.current) { busyRef.current = false; setBusy(false); } } };
  }
  function deny() { setDenied(true); setPreview(null); setJob(null); setComparison(null); setHistory(null); setDecisions({}); setDirty(false); setCharge(false); setHumanConfirmed(false); setNotice("身份、权限或回包范围无法核验，已隐藏旧资料；原请求编号仍保留。"); }
  function fail(error: unknown) {
    const code = (error as { data?: { code?: string } } | null)?.data?.code;
    if (error instanceof Error && /^TAGGING_(?:LOCK_UNAVAILABLE|STORAGE_|PENDING_INVALID)/u.test(error.message)) { setStorageError(true); setNeedsReview(true); setCharge(false); setHumanConfirmed(false); setNotice("浏览器安全锁或恢复存储不可用，已停止提交；不会降级重发，也不会删除未决记录。"); }
    else if (["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(code ?? "") || error instanceof Error && (error.name === "ZodError" || ["TAGGING_RESPONSE_INVALID", "TAGGING_APPLY_RESPONSE_INVALID"].includes(error.message))) deny();
    else { setNeedsReview(true); setCharge(false); setHumanConfirmed(false); setNotice("结果尚未核验，草稿与原请求已保留。只能核对或取消未决原编号，不会自动再次调用模型或写标签。"); }
  }
  function sameScope(value: { identity: unknown; scope: Scope }) { return canonical(value.identity) === canonical(identity) && value.scope.expectedWorkspaceId === scope.expectedWorkspaceId && value.scope.imageSetId === setId; }
  function parseJob(raw: unknown, operationId: string, expected?: ImageTaggingPending | null) {
    const value = ImageTaggingJobViewSchema.parse(raw);
    if (!sameScope(value) || value.scope.operationId !== operationId || value.images.some(image => image.candidate && imageTaggingHash(image.candidate) !== image.candidateHash)
      || expected && (expected.sourceHash && value.sourceHash !== expected.sourceHash && !(value.sourceHash === null && ["not_found", "canceled"].includes(value.state))
        || expected.runtimeHash && value.runtimeHash !== expected.runtimeHash && !(value.runtimeHash === null && ["not_found", "canceled"].includes(value.state)))
      || preview?.scope.operationId === operationId && value.state !== "not_found" && value.state !== "canceled"
        && canonical(value.images.map(image => image.imageId).sort((a, b) => a - b)) !== canonical(preview.images.map(image => image.imageId).sort((a, b) => a - b))) throw new Error("TAGGING_RESPONSE_INVALID");
    return value;
  }
  function acceptJob(value: ImageTaggingJobView, preserve = false) {
    if (dirtyRef.current && !preserve && (job?.scope.operationId !== value.scope.operationId || job.resultHash !== value.resultHash)) { setComparison(value); setNeedsReview(true); return; }
    setJob(value); setComparison(null); setNeedsReview(value.sourceChanged); setHumanConfirmed(false);
    if (!dirtyRef.current || preserve) {
      const next: Record<number, Decision> = {};
      for (const image of value.images) if (image.candidate && image.candidateHash && image.state === "succeeded") next[image.imageId] = { candidateHash: image.candidateHash, decision: "pending", tags: tagsOnly(image.candidate) };
      setDecisions(next); setDirty(false); setCandidatePage(0);
    }
  }
  useEffect(() => { dirtyCallback.current?.(dirty); }, [dirty]);
  useEffect(() => {
    live.current = true;
    const sync = () => {
      if (ownStorage.current) return;
      try { const value = readImageTaggingPending(context); if (observed.current !== idOf(value)) { stopLane(); setCancelFor(null); setPreview(null); setJob(null); setComparison(null); setNeedsReview(true); setCharge(false); setHumanConfirmed(false); }
        observed.current = idOf(value); setPending(value); setStorageError(false);
      } catch { stopLane(); setStorageError(true); setPreview(null); setJob(null); setComparison(null); setNeedsReview(true); }
    };
    sync(); let unsubscribe = () => undefined as void;
    try { unsubscribe = subscribeImageTaggingPending(context, sync); } catch { setStorageError(true); }
    const sourceChanged = (event: Event) => {
      const value = (event as CustomEvent).detail;
      if (ownEvent.current || !value || value.workspaceId !== context.workspaceId || value.imageSetId !== context.imageSetId) return;
      stopLane(); setPreview(null); setJob(null); setComparison(null); setHistory(null); setNeedsReview(true); setCharge(false); setHumanConfirmed(false);
      setNotice("此图片集在另一视图已更新；未提交草稿保留，请显式重读核对后再应用。");
    };
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener(changedEvent, sourceChanged); window.addEventListener("beforeunload", warn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { live.current = false; epoch.current++; abort.current?.abort(); unsubscribe(); window.removeEventListener(changedEvent, sourceChanged); window.removeEventListener("beforeunload", warn); dirtyCallback.current?.(false); };
  }, [context]);
  useEffect(() => { if (suspended) { stopLane(); setCharge(false); setHumanConfirmed(false); setNeedsReview(true); } }, [suspended]);
  async function reserve(value: ImageTaggingPending, signal: AbortSignal, current: () => boolean) {
    await withImageTaggingPendingLock(context, signal, async () => { if (!current()) return; ownStorage.current = true;
      try { reserveImageTaggingPending(context, value); observed.current = value.operationId; setPending(value); }
      finally { ownStorage.current = false; } });
    if (!current() || idOf(readImageTaggingPending(context)) !== value.operationId) throw new Error("TAGGING_PENDING_CHANGED");
  }
  async function release(value: ImageTaggingPending, signal: AbortSignal, current: () => boolean) {
    return withImageTaggingPendingLock(context, signal, async () => { if (!current()) return false; ownStorage.current = true;
      try { const removed = releaseImageTaggingPending(context, value.operationId); if (removed) { observed.current = null; setPending(null); setCancelFor(null); } return removed; }
      finally { ownStorage.current = false; } });
  }
  async function readPreview() {
    if (!usable() || busyRef.current || pending || storageError) return;
    const work = begin(), operationId = previewOperation.current ?? crypto.randomUUID(); previewOperation.current = operationId;
    try {
      const input = { ...scope, operationId, mode }, value = ImageTaggingPreviewSchema.parse(await rpc.taggingPreview.query(input, { signal: work.controller.signal }));
      if (!work.current()) return;
      if (!sameScope(value) || canonical(value.scope) !== canonical(input) || value.budget && (value.budget.maxCalls !== value.images.filter(image => image.eligibility === "pending").length
        || value.budget.maxCostCentsTotal !== value.budget.maxCalls * value.budget.maxCostCentsPerImage)) { deny(); return; }
      setPreview(value); setPage(0); setCharge(false); if (!dirtyRef.current) setNeedsReview(false);
    } catch (error) { if (work.current()) fail(error); } finally { work.finish(); }
  }
  async function start() {
    if (!usable() || busyRef.current || pending || storageError || !canEdit || !preview?.capability.available || !preview.runtimeHash || !preview.budget || !charge || dirty || needsReview || preview.scope.operationId === job?.scope.operationId) return;
    const work = begin();
    try {
      const input = ImageTaggingSubmitInputSchema.parse({ ...preview.scope, expectedSourceHash: preview.sourceHash, expectedRuntimeHash: preview.runtimeHash, maxCostCents: preview.budget.maxCostCentsTotal, chargeConfirmed: true });
      const value: ImageTaggingPending = { version: 1, context, kind: "start", operationId: input.operationId, runOperationId: input.operationId,
        requestHash: imageTaggingHash({ identity, request: input }), sourceHash: input.expectedSourceHash, runtimeHash: input.expectedRuntimeHash, resultHash: null };
      await reserve(value, work.controller.signal, () => work.current() && editable.current); if (!work.current() || !editable.current) return;
      ownSubmission.current = value.operationId; setCharge(false);
      previewOperation.current = null;
      const result = parseJob(await rpc.taggingStart.mutate(input), value.operationId, value); if (!work.current()) return;
      if (idOf(readImageTaggingPending(context)) !== value.operationId) { setNeedsReview(true); return; }
      acceptJob(result); if (!unresolved(result.state)) await release(value, work.controller.signal, work.current);
    } catch (error) { if (work.current()) fail(error); } finally { work.finish(); }
  }
  async function readJob(operationId: string, cancellation = false) {
    if (!usable() || busyRef.current || storageError) return;
    const work = begin();
    try {
      const existing = readImageTaggingPending(context);
      if (existing && (existing.operationId !== operationId || existing.kind === "apply") || cancellation && cancelFor !== operationId) { setCancelFor(null); setNeedsReview(true); return; }
      const input = { ...scope, operationId }, raw = cancellation ? await rpc.taggingCancel.mutate(input) : await rpc.taggingCheck.query(input, { signal: work.controller.signal });
      if (!work.current()) return;
      const result = parseJob(raw, operationId, existing);
      if (existing && idOf(readImageTaggingPending(context)) !== existing.operationId) { setNeedsReview(true); return; }
      if (!existing && unresolved(result.state)) await reserve({ version: 1, context, kind: "observed", operationId, runOperationId: operationId,
        requestHash: null, sourceHash: result.sourceHash, runtimeHash: result.runtimeHash, resultHash: null }, work.controller.signal, work.current);
      if (!work.current()) return; acceptJob(result);
      if (existing && !unresolved(result.state)) await release(existing, work.controller.signal, work.current);
      if (result.state === "not_found") setNotice("尚未观察到原请求，不代表未收费或失败；保留原编号，只能继续核对或显式取消。");
    } catch (error) { if (work.current()) fail(error); } finally { work.finish(); }
  }
  useEffect(() => {
    if (suspended || denied || busy || !pending || pending.kind === "apply" || !job || !ongoing(job.state) || job.scope.operationId !== pending.operationId) return;
    const timer = window.setTimeout(() => { void readJob(pending.operationId); }, 5000); return () => window.clearTimeout(timer);
    // Polling only queries the original UUID; never invokes start/retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suspended, denied, busy, pending, job]);
  async function readHistory() {
    if (!usable() || busyRef.current) return; const work = begin(); setHistory(null);
    try { const value = ImageTaggingHistorySchema.parse(await rpc.taggingHistory.query(scope, { signal: work.controller.signal }));
      if (!work.current()) return; if (!sameScope(value) || new Set(value.operations.map(item => item.operationId)).size !== value.operations.length) { deny(); return; } setHistory(value);
    } catch (error) { if (work.current()) fail(error); } finally { work.finish(); }
  }
  function parseApply(raw: unknown, value: ImageTaggingPending): ImageTaggingApplyReceipt {
    const receipt = ImageTaggingApplyReceiptSchema.parse(raw);
    if (!sameScope(receipt) || receipt.scope.operationId !== value.operationId || receipt.scope.runOperationId !== value.runOperationId
      || receipt.status === "committed" && receipt.requestHash !== value.requestHash) throw new Error("TAGGING_APPLY_RESPONSE_INVALID");
    return receipt;
  }
  async function finishApply(receipt: ImageTaggingApplyReceipt, value: ImageTaggingPending, work: ReturnType<typeof begin>) {
    if (!work.current() || idOf(readImageTaggingPending(context)) !== value.operationId) return;
    if (!["committed", "cancelled"].includes(receipt.status)) { setNotice("应用结果未知，保留原应用编号；不会重新写入或调用模型。"); return; }
    if (!await release(value, work.controller.signal, work.current) || !work.current()) return;
    setPreview(null); previewOperation.current = null; setJob(null); setComparison(null); setHumanConfirmed(false); setNeedsReview(true);
    if (receipt.status === "committed") {
      if (ownSubmission.current === value.operationId) { setDirty(false); setDecisions({}); }
      setNotice(`人工应用已确认：${receipt.appliedCount} 张应用、${receipt.excludedCount} 张排除。旧确认标签未被覆盖；请重新读取当前图片集。`);
      ownEvent.current = true; try { window.dispatchEvent(new CustomEvent(changedEvent, { detail: { workspaceId: context.workspaceId, imageSetId: setId } })); } finally { ownEvent.current = false; }
      try { await callback.current?.(); } catch { setNotice("应用已确认，但外部图片列表刷新失败；请手动刷新。不会再次写入。"); }
    } else setNotice("原应用请求已取消；未提交的人工草稿保留。取消不会撤销此前已经确认的标签。");
  }
  async function apply() {
    if (!usable() || busyRef.current || pending || storageError || !canEdit || needsReview || !humanConfirmed || !job?.resultHash || !job.currentSourceHash || job.sourceChanged || !["succeeded", "partial"].includes(job.state) || !imagesVerified) return;
    const work = begin();
    try {
      const input = ImageTaggingApplyInputSchema.parse({ ...scope, operationId: crypto.randomUUID(), runOperationId: job.scope.operationId,
        expectedSourceHash: job.currentSourceHash, expectedResultHash: job.resultHash, decisions: Object.entries(decisions).filter(([, item]) => item.decision !== "pending").map(([imageId, item]) => ({ imageId: Number(imageId), candidateHash: item.candidateHash, decision: item.decision, tags: item.decision === "accept" ? item.tags : null })) });
      const value: ImageTaggingPending = { version: 1, context, kind: "apply", operationId: input.operationId, runOperationId: input.runOperationId,
        requestHash: imageTaggingHash({ identity, request: input }), sourceHash: input.expectedSourceHash, runtimeHash: null, resultHash: input.expectedResultHash };
      await reserve(value, work.controller.signal, () => work.current() && editable.current); if (!work.current() || !editable.current) return; ownSubmission.current = value.operationId;
      const raw = await rpc.taggingApply.mutate(input); if (!work.current()) return; await finishApply(parseApply(raw, value), value, work);
    } catch (error) { if (work.current()) fail(error); } finally { work.finish(); }
  }
  async function recoverApply(cancel: boolean) {
    if (!usable() || busyRef.current || !pending || pending.kind !== "apply" || storageError || cancel && cancelFor !== pending.operationId) return;
    const work = begin();
    try {
      const value = readImageTaggingPending(context); if (!value || value.kind !== "apply" || value.operationId !== pending.operationId) { setCancelFor(null); setNeedsReview(true); return; }
      const input = { ...scope, operationId: value.operationId, runOperationId: value.runOperationId };
      const raw = cancel ? await rpc.taggingApplyCancel.mutate(input) : await rpc.taggingApplyCheck.query(input, { signal: work.controller.signal });
      if (!work.current()) return; await finishApply(parseApply(raw, value), value, work);
    } catch (error) { if (work.current()) fail(error); } finally { work.finish(); }
  }
  function updateDecision(imageId: number, patch: Partial<Decision>) { if (!usable() || busyRef.current || pending || !canEdit) return; setDecisions(previous => ({ ...previous, [imageId]: { ...previous[imageId], ...patch } })); setDirty(true); setHumanConfirmed(false); }
  const canKeepDraft = comparison !== null && Object.entries(decisions).every(([id, item]) => comparison.images.some(image => image.imageId === Number(id) && image.state === "succeeded" && image.candidateHash === item.candidateHash));
  function keepDraftAgainstComparison() {
    if (!usable() || busyRef.current || pending || !comparison || !canKeepDraft) return;
    const next: Record<number, Decision> = {};
    for (const image of comparison.images) if (image.candidate && image.candidateHash && image.state === "succeeded") next[image.imageId] = decisions[image.imageId] ?? { candidateHash: image.candidateHash, decision: "pending", tags: tagsOnly(image.candidate) };
    setJob(comparison); setComparison(null); setNeedsReview(comparison.sourceChanged); setDecisions(next); setHumanConfirmed(false); setCandidatePage(0);
  }
  const blocked = busy || suspended || denied, candidateImages = job?.images.filter(image => image.candidate) ?? [];
  const imagesVerified = !!job && !!preview && preview.sourceHash === job.currentSourceHash
    && canonical(preview.images.map(image => image.imageId).sort((a, b) => a - b)) === canonical(job.images.map(image => image.imageId).sort((a, b) => a - b));
  const selected = Object.values(decisions).filter(value => value.decision !== "pending").length;
  return <section aria-label="AI 标签候选与人工应用" className="min-w-0 max-w-full space-y-4 rounded-lg border p-3 text-sm [overflow-wrap:anywhere]">
    <h3 className="font-semibold">AI 标签候选 · 人工应用</h3>
    <p>仅处理此已授权图片集，不修改原图像素。预览、历史和核对不调用模型；识别成功只生成候选，现有人工确认标签与分析保持不变。</p>
    {notice && <p role="status" className="rounded bg-muted p-2">{notice}</p>}
    {storageError && <p role="alert">本机恢复记录无法安全读取或锁定，已禁止新提交；不会删除记录或降级为无锁写入。</p>}
    {pending && <div className="space-y-2 rounded border border-amber-300 p-3"><p>未决{pending.kind === "apply" ? "人工应用" : "识别"}请求：<span className="break-all">{pending.operationId}</span></p>
      <Button size="sm" variant="outline" disabled={blocked || storageError} onClick={() => void (pending.kind === "apply" ? recoverApply(false) : readJob(pending.operationId))}>核对原请求</Button>
      <label className="flex items-start gap-2"><input type="checkbox" checked={cancelFor === pending.operationId} disabled={blocked} onChange={event => setCancelFor(event.target.checked ? pending.operationId : null)} />确认取消此原请求；已发生费用或已提交标签不会撤销</label>
      <Button size="sm" variant="outline" disabled={blocked || storageError || cancelFor !== pending.operationId} onClick={() => void (pending.kind === "apply" ? recoverApply(true) : readJob(pending.operationId, true))}>取消原请求</Button>
    </div>}
    <div className="flex flex-wrap items-center gap-2"><label>识别范围 <select aria-label="识别范围" value={mode} disabled={blocked || !!pending} className="max-w-full rounded border bg-background p-2" onChange={event => {
      if (dirtyRef.current && !window.confirm("切换模式将丢弃未提交的候选编辑，原未决请求仍保留。是否继续？")) return;
      stopLane(); setMode(event.target.value as typeof mode); previewOperation.current = null; setPreview(null); setJob(null); setComparison(null); setDirty(false); setDecisions({}); setCharge(false); setHumanConfirmed(false); setNeedsReview(false);
    }}><option value="missing">仅补从未识别的缺失标签</option><option value="all_unconfirmed">重新识别全部未人工确认图片</option></select></label>
      <Button variant="outline" disabled={blocked || !!pending || storageError} onClick={() => void readPreview()}>预览整套图片与费用</Button>
      <Button variant="outline" disabled={blocked} onClick={() => void readHistory()}>读取标签任务历史</Button></div>
    <p className="text-xs text-muted-foreground">空字符串表示已识别但不确定，不等于从未识别；已人工确认的标签／分析始终跳过。新写与后台执行默认关闭，具体以当前服务端能力为准。</p>
    {preview && <div className="space-y-3"><h4 className="font-medium">完整图片集预览：{preview.images.length} 张 · {preview.title ?? "名称未提供"}</h4>
      <p className="text-xs break-all">来源哈希：{preview.sourceHash} · 配置版本：{preview.configuration?.revision ?? "未就绪"} · 配置哈希：{preview.configuration?.hash ?? "未就绪"}</p>
      <p>Skill：{preview.skillSlug ?? "不可用"} · 专属模型：{preview.modelSlug ?? "不可用"}</p>
      {preview.budget ? <p>本批最多 {preview.budget.maxCalls} 次模型调用；授权费用上限 USD {(preview.budget.maxCostCentsTotal / 100).toFixed(2)}。单图最多 8 MiB，实际费用以供应商账单为准，未知回执不会自动重试。</p> : <p>费用上限尚未核验，不能启动。</p>}
      {!preview.capability.available && <p role="status">{reason(preview.capability.reasonCode)}</p>}
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">{preview.images.slice(page * 12, (page + 1) * 12).map(image => <article key={image.imageId} className="min-w-0 rounded border p-2">
        {safePreview(image.previewUrl) ? <img src={safePreview(image.previewUrl)} alt={`图片 ${image.imageId} 原图预览`} className="h-40 w-full object-contain" loading="lazy" /> : <p>此图预览地址不可用，不能据此推断原图已丢失。</p>}
        <p>图片 #{image.imageId} · {image.imagePosition} · {stateLabels[image.eligibility]}</p>
        <dl className="mt-2 text-xs">{IMAGE_TAGGING_TAG_FIELDS.map(field => <div key={field}><dt className="inline">{fieldLabels[field]}：</dt><dd className="inline">{image.tags[field] === null ? "从未识别" : image.tags[field] || "已识别但未知"}</dd></div>)}</dl>
      </article>)}</div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(value => value - 1)}>上一页图片</Button><span>第 {page + 1} / {Math.ceil(preview.images.length / 12)} 页</span><Button variant="outline" size="sm" disabled={(page + 1) * 12 >= preview.images.length} onClick={() => setPage(value => value + 1)}>下一页图片</Button></div>
      <label className="flex items-start gap-2"><input type="checkbox" checked={charge} disabled={blocked || !!pending || !preview.capability.available || !canEdit || needsReview || dirty} onChange={event => setCharge(event.target.checked)} />我已核对整套范围、配置版本与费用上限，同意本次可能产生模型费用</label>
      <Button disabled={blocked || !!pending || storageError || !preview.capability.available || !canEdit || !charge || needsReview || dirty || preview.scope.operationId === job?.scope.operationId} onClick={() => void start()}>确认费用并启动一次识别</Button>
    </div>}
    {history && <div className="space-y-2"><h4 className="font-medium">当前授权图片集的任务历史</h4>{!history.complete && <p role="alert">此为有界历史结果，不是完整历史；未显示的记录不能视为不存在。</p>}
      {!history.operations.length && <p>本次成功读取未返回历史任务。</p>}<ul className="space-y-2">{history.operations.map(item => <li key={item.operationId} className="rounded border p-2"><p>{item.createdAt} · {stateLabels[item.state] ?? item.state}</p><p className="text-xs break-all">原请求 {item.operationId}</p>
        <Button size="sm" variant="outline" disabled={blocked || !!pending && pending.runOperationId !== item.operationId} onClick={() => void readJob(item.operationId)}>查看此任务与候选</Button></li>)}</ul></div>}
    {comparison && <div className="space-y-2 rounded border border-amber-300 p-2"><p>新读回的候选版本与草稿不同。旧草稿保留，但不得按旧版本应用。</p>
      {canKeepDraft && <Button variant="outline" disabled={blocked || !!pending} onClick={keepDraftAgainstComparison}>核对新版本并保留匹配的人工草稿</Button>}
      <Button variant="outline" disabled={blocked || !!pending} onClick={() => { if (window.confirm("明确丢弃本地候选编辑，采用本次读回版本？")) acceptJob(comparison, true); }}>丢弃草稿，采用当前候选</Button></div>}
    {job && <div className="space-y-3"><h4 className="font-medium">识别任务：{stateLabels[job.state]}</h4><p className="text-xs break-all">原请求：{job.scope.operationId} · 配置版本 {job.configuration?.revision ?? "未返回"}</p>
      {job.reasonCode && <p>{reason(job.reasonCode)}</p>}
      <p>已终结 {job.images.filter(image => !["pending", "dispatched"].includes(image.state)).length} / {job.images.length} 张；候选 {candidateImages.length} 张。这里只统计本次服务端返回的完整任务清单。</p>
      <ul className="max-h-48 overflow-auto rounded border p-2 text-xs" aria-label="逐图真实进度">{job.images.map(image => <li key={image.imageId}>图片 #{image.imageId}：{stateLabels[image.state]}{image.reasonCode ? ` · ${reason(image.reasonCode)}` : ""}</li>)}</ul>
      {job.sourceChanged && <p role="alert">图片／标签来源已变化，旧候选不能直接应用；原结果保留，须重新核对当前来源。</p>}
      {!imagesVerified && candidateImages.length > 0 && <p role="status">请先显式预览整套图片并核对当前来源，再逐图确认候选；读取预览不会调用模型。</p>}
      {needsReview && <p role="status">当前资格需重新核对；未提交编辑不会因刷新自动覆盖。</p>}
      <Button variant="outline" disabled={blocked || !!pending && pending.kind === "apply"} onClick={() => void readJob(job.scope.operationId)}>重新读取此任务（不调用模型）</Button>
      <div className="space-y-3">{candidateImages.slice(candidatePage * 12, (candidatePage + 1) * 12).map(image => {
        const draft = decisions[image.imageId], original = imagesVerified ? preview?.images.find(item => item.imageId === image.imageId) : null;
        return <article key={image.imageId} className="min-w-0 rounded border p-3" aria-label={`图片 ${image.imageId} 标签候选`}>
          <h5 className="font-medium">图片 #{image.imageId} · {stateLabels[image.state]}</h5><p className="my-2">可见证据与不确定性：{image.candidate!.evidence}</p><p>辅助色：{image.candidate!.accentColor || "未知"}（仅候选证据，不写入单图标签字段）</p>
          {original && safePreview(original.previewUrl) && <img src={safePreview(original.previewUrl)} alt={`图片 ${image.imageId} 人工核对原图`} className="my-2 h-56 w-full object-contain" loading="lazy" />}
          {original && !safePreview(original.previewUrl) && <p>原图预览暂不可用，请先在原图片集中核对；模型候选不替代人工证据。</p>}
          {draft ? <><label>人工决定 <select aria-label={`图片 ${image.imageId} 人工决定`} value={draft.decision} disabled={blocked || !!pending || !canEdit || needsReview || job.sourceChanged} className="rounded border bg-background p-2" onChange={event => updateDecision(image.imageId, { decision: event.target.value as Decision["decision"] })}><option value="pending">待人工决定</option><option value="accept">应用下列标签</option><option value="exclude">排除此候选（不删原图／旧标签）</option></select></label>
            <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2">{IMAGE_TAGGING_TAG_FIELDS.map(field => <label key={field} className="min-w-0">{fieldLabels[field]}<select aria-label={`图片 ${image.imageId} ${fieldLabels[field]}`} value={draft.tags[field]} disabled={blocked || !!pending || !canEdit || needsReview || job.sourceChanged || draft.decision === "exclude"} className="mt-1 w-full min-w-0 max-w-full rounded border bg-background p-2" onChange={event => {
              const next = { ...draft.tags, [field]: event.target.value }; if (field === "tagImageTypeMain") next.tagImageTypeSub = ""; if (field === "tagSellingPointCategory") next.tagSellingPointDetail = ""; updateDecision(image.imageId, { tags: next });
            }}><option value="">未知／留空</option>{choices(field, draft.tags).map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}</div></>
            : <dl>{IMAGE_TAGGING_TAG_FIELDS.map(field => <div key={field}><dt className="inline">{fieldLabels[field]}：</dt><dd className="inline">{image.candidate![field] || "未知"}</dd></div>)}</dl>}
        </article>;
      })}</div>
      {candidateImages.length > 0 && <><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={candidatePage === 0} onClick={() => setCandidatePage(value => value - 1)}>上一页候选</Button><span>第 {candidatePage + 1} / {Math.ceil(candidateImages.length / 12)} 页</span><Button size="sm" variant="outline" disabled={(candidatePage + 1) * 12 >= candidateImages.length} onClick={() => setCandidatePage(value => value + 1)}>下一页候选</Button></div>
        <label className="flex items-start gap-2"><input type="checkbox" checked={humanConfirmed} disabled={blocked || !!pending || !canEdit || needsReview || job.sourceChanged || !selected || !imagesVerified} onChange={event => setHumanConfirmed(event.target.checked)} />我已逐图核对本次选中的 {selected} 项，图片宣传不等于真实产品事实；确认应用不会调用模型</label>
        <Button disabled={blocked || !!pending || storageError || !canEdit || needsReview || job.sourceChanged || !humanConfirmed || !selected || !["succeeded", "partial"].includes(job.state) || !imagesVerified} onClick={() => void apply()}>人工确认并应用所选候选</Button></>}
    </div>}
  </section>;
}
