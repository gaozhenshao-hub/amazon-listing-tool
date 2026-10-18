import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AcquisitionReviewLocationInputSchema, AcquisitionReviewLocationResultSchema,
  type AcquisitionReviewLocationInput, type AcquisitionReviewLocationResult } from "@shared/acquisitionReviewLocation";
import { AcquisitionReviewReadInputSchema, AcquisitionReviewReadResultSchema, AcquisitionReviewWriteInputSchema,
  AcquisitionReviewWriteResultSchema, AcquisitionReviewImageInputSchema, acquisitionReviewCanonical as canonical, acquisitionReviewRequestHash, acquisitionReviewImageRequestHash,
  type AcquisitionReviewReadInput, type AcquisitionReviewReadResult, type AcquisitionReviewWriteInput,
  type AcquisitionReviewRecoverInput, type AcquisitionReviewPatch, type AcquisitionReviewImageInput, type AcquisitionReviewImageRecoverInput } from "@shared/acquisitionReview";
import AssetReviewGrid, { type AssetDecision } from "./AssetReviewGrid";
import AcquisitionReviewImageForm, { readReviewImageBytes, type ReviewImageSelection } from "./AcquisitionReviewImageForm";
import { readAcquisitionReviewPending, reserveAcquisitionReviewPending, releaseAcquisitionReviewPending, subscribeAcquisitionReviewPending,
  withAcquisitionReviewLock, type AcquisitionReviewPending, type AcquisitionReviewPendingContext } from "./acquisitionReviewPending";

export type AcquisitionReviewOwner = { userId: number; workspaceId: number; role: string };
type Rpc = { review: { query: (input: AcquisitionReviewReadInput, options?: { signal: AbortSignal }) => Promise<unknown> };
  saveReview: { mutate: (input: AcquisitionReviewWriteInput) => Promise<unknown> };
  confirmReview: { mutate: (input: AcquisitionReviewWriteInput) => Promise<unknown> };
  rejectReview: { mutate: (input: AcquisitionReviewWriteInput) => Promise<unknown> };
  recoverReview: { mutate: (input: AcquisitionReviewRecoverInput) => Promise<unknown> };
  recoverReviewImage: { mutate: (input: AcquisitionReviewImageInput) => Promise<unknown> };
  recoverReviewImageOperation: { mutate: (input: AcquisitionReviewImageRecoverInput) => Promise<unknown> } };
type Draft = { title: string; brand: string; category: string; description: string; bullets: string;
  price: string; currency: string; rating: string; reviewCount: string; variants: string; note: string };
const blank: Draft = { title: "", brand: "", category: "", description: "", bullets: "", price: "", currency: "", rating: "", reviewCount: "", variants: "", note: "" };
const fieldLabels: Array<[keyof Draft, string, boolean]> = [["title", "标题", true], ["brand", "品牌", false], ["category", "类目", false],
  ["description", "描述", true], ["bullets", "五点描述（每行一条）", true], ["price", "价格原文", false], ["currency", "价格币种", false],
  ["rating", "页面评分", false], ["reviewCount", "页面评价数量", false], ["variants", "已保存变体 ASIN（每行一条）", true], ["note", "审核备注／拒绝原因", true]];
const reasons: Record<string, string> = { WRITES_DISABLED: "人工审核写入尚未启用；可只读查看和核对原请求。",
  ACQUISITION_REVIEW_WRITES_DISABLED: "人工审核写入尚未启用；可只读查看和核对原请求。",
  JOB_NOT_TERMINAL: "采集仍在后台运行，请完成后重新读取。", REVIEW_NOT_PENDING: "当前没有待确认修订，请先保存新的人工修订。",
  SNAPSHOT_NOT_READY: "原始快照尚不可审核，请重新读取状态。", IMAGE_STORAGE_UNAVAILABLE: "原件安全存储尚未接通，不能上传或恢复图片；已有请求仍可核对／取消。" };
const reason = (code: string | null) => code ? reasons[code] ?? `此操作暂不可用（${code}）` : "";
const text = (value: unknown) => typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
function draftFrom(view: AcquisitionReviewReadResult): Draft {
  const value = view.effectiveDraft, price = value.price && typeof value.price === "object" ? value.price as Record<string, unknown> : {};
  return { title: text(value.title), brand: text(value.brand), category: text(value.category), description: text(value.description),
    bullets: Array.isArray(value.bulletPoints) ? value.bulletPoints.map(text).join("\n") : "", price: text(price.value), currency: text(price.currency),
    rating: text(value.rating), reviewCount: text(value.reviewCount), variants: Array.isArray(value.variantAsins) ? value.variantAsins.map(text).join("\n") : "", note: view.revision?.note ?? "" };
}
function makePatch(draft: Draft, initial: Draft): AcquisitionReviewPatch {
  const patch: AcquisitionReviewPatch = {};
  for (const key of ["title", "brand", "category", "description", "rating"] as const) if (draft[key] !== initial[key]) patch[key] = draft[key].trim() || null;
  if (draft.bullets !== initial.bullets) patch.bulletPoints = draft.bullets.split("\n").map(value => value.trim()).filter(Boolean);
  if (draft.variants !== initial.variants) patch.variantAsins = draft.variants.split("\n").map(value => value.trim()).filter(Boolean);
  if (draft.price !== initial.price || draft.currency !== initial.currency) patch.price = !draft.price.trim() && !draft.currency.trim() ? null : { value: draft.price.trim(), currency: draft.currency.trim() };
  if (draft.reviewCount !== initial.reviewCount) {
    if (draft.reviewCount.trim() && !/^\d+$/u.test(draft.reviewCount.trim())) throw new Error("页面评价数量须为非负整数或留空，不自动补零。");
    patch.reviewCount = draft.reviewCount.trim() ? Number(draft.reviewCount.trim()) : null;
  }
  return patch;
}
export default function AcquisitionReviewPage({ snapshotId: suppliedSnapshotId, projectId: suppliedProjectId }: { snapshotId?: number; projectId?: number | null } = {}) {
  const params = useParams<{ snapshotId?: string; jobId?: string }>(), auth = useAuth();
  const snapshotId = suppliedSnapshotId ?? Number(params.snapshotId), rawProject = new URLSearchParams(window.location.search).get("projectId");
  const projectId = suppliedProjectId !== undefined ? suppliedProjectId : rawProject === null ? null : Number(rawProject);
  const resolveLocation = suppliedSnapshotId === undefined;
  const target = params.jobId !== undefined ? { jobId: Number(params.jobId) } : { snapshotId };
  const user = auth.user, workspaceId = user?.defaultWorkspaceId;
  const valid = !!user && Number.isSafeInteger(user.id) && user.id > 0 && typeof user.role === "string" && user.role.trim().length > 0
    && Number.isSafeInteger(workspaceId) && Number(workspaceId) > 0
    && (resolveLocation ? AcquisitionReviewLocationInputSchema.safeParse({ ...target, expectedWorkspaceId: workspaceId }).success
      : AcquisitionReviewReadInputSchema.safeParse({ snapshotId, expectedProjectId: projectId, expectedWorkspaceId: workspaceId }).success);
  const identity = valid ? canonical([user!.id, workspaceId, user!.role, resolveLocation ? target : { snapshotId, projectId }]) : null;
  const boundary = useRef({ identity, epoch: 0 }), shown = useRef<object | null>(null);
  if (boundary.current.identity !== identity) boundary.current = { identity, epoch: boundary.current.epoch + 1 };
  const token = boundary.current;
  if (!valid || auth.error) { shown.current = null; return <p role="alert">当前身份或采集范围不可核验，未显示审核资料。</p>; }
  if (!auth.loading) shown.current = token;
  if (auth.loading && shown.current !== token) return <p role="status">正在核对审核身份…</p>;
  const owner = { userId: user!.id, workspaceId: Number(workspaceId), role: user!.role };
  return <div hidden={auth.loading}>{resolveLocation
    ? <AcquisitionReviewLocationController key={`${identity}:${token.epoch}`} owner={owner} input={{ ...target, expectedWorkspaceId: owner.workspaceId }} suspended={auth.loading} />
    : <AcquisitionReviewController key={`${identity}:${token.epoch}`} owner={owner} snapshotId={snapshotId} projectId={projectId} suspended={auth.loading} />}</div>;
}

/** Resolve exact job/snapshot metadata before opening any editable source. Never
 * infer a snapshot or project from an ASIN, cache badge, or route query string. */
export function AcquisitionReviewLocationController({ owner, input, suspended = false }: {
  owner: AcquisitionReviewOwner; input: AcquisitionReviewLocationInput; suspended?: boolean;
}) {
  const rpc = trpc.useUtils().client.acquisition as unknown as { reviewJob: { query: (input: AcquisitionReviewLocationInput, options: { signal: AbortSignal }) => Promise<unknown> } };
  const [location, setLocation] = useState<AcquisitionReviewLocationResult | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const active = useRef(false), paused = useRef(suspended), epoch = useRef(0), abort = useRef<AbortController | null>(null);
  paused.current = suspended;
  useEffect(() => { active.current = true; return () => { active.current = false; abort.current?.abort(); }; }, []);
  useEffect(() => { if (suspended) { epoch.current++; abort.current?.abort(); setBusy(false); } }, [suspended]);
  async function locate() {
    if (!active.current || paused.current || busy) return;
    const ticket = ++epoch.current, controller = new AbortController(); abort.current?.abort(); abort.current = controller;
    setBusy(true); setError(""); setLocation(null);
    const current = () => active.current && !paused.current && !controller.signal.aborted && ticket === epoch.current;
    try {
      const parsed = AcquisitionReviewLocationResultSchema.safeParse(await rpc.reviewJob.query(input, { signal: controller.signal }));
      if (!current()) return;
      if (!parsed.success || canonical(parsed.data.identity) !== canonical({ userId: owner.userId, workspaceId: owner.workspaceId })
        || ("jobId" in input ? parsed.data.jobId !== input.jobId : parsed.data.snapshotId !== input.snapshotId && !["queued", "running"].includes(parsed.data.status))) {
        setError("任务范围或身份不可核验，未显示任何快照。"); return;
      }
      setLocation(parsed.data);
    } catch { if (current()) setError("任务状态读取失败，不能据此判定采集结束；请显式重新读取。未创建或重试采集任务。"); }
    finally { if (current()) setBusy(false); }
  }
  if (location?.snapshotId !== null && location?.snapshotId !== undefined && !["queued", "running"].includes(location.status)) {
    return <AcquisitionReviewController key={`${location.snapshotId}:${location.projectId}`} owner={owner} snapshotId={location.snapshotId} projectId={location.projectId} suspended={suspended} />;
  }
  return <section className="space-y-3 p-4"><h1 className="text-2xl font-semibold">打开精确采集快照</h1>
    <p>按任务／快照编号核验当前授权与项目范围，不按 ASIN 猜测。人工审核可选，原直接入库流程不变。</p>
    {error && <p role="alert">{error}</p>}
    {location && <p role="status">{["queued", "running"].includes(location.status) ? "采集仍在排队／运行，请等待后重新读取；不会自动重新采集。" : "该任务暂未返回可审核快照；不代表原数据不存在，不能确认或拒绝。"}</p>}
    <Button disabled={busy || suspended} onClick={() => void locate()}>{busy ? "正在核验任务范围…" : "读取任务对应的快照"}</Button>
    <a className="block underline" href="/knowledge/acquisition">返回采集任务</a>
  </section>;
}

export function AcquisitionReviewController({ owner, snapshotId, projectId, suspended = false }: {
  owner: AcquisitionReviewOwner; snapshotId: number; projectId: number | null; suspended?: boolean;
}) {
  const client = trpc.useUtils().client.acquisition as unknown as Rpc;
  const [context] = useState<AcquisitionReviewPendingContext>(() => ({ userId: owner.userId, workspaceId: owner.workspaceId, projectId, snapshotId }));
  const input: AcquisitionReviewReadInput = { expectedWorkspaceId: owner.workspaceId, expectedProjectId: projectId, snapshotId };
  const [view, setView] = useState<AcquisitionReviewReadResult | null>(null), [comparison, setComparison] = useState<AcquisitionReviewReadResult | null>(null);
  const [draft, setDraft] = useState<Draft>(blank), [initial, setInitial] = useState<Draft>(blank), [decisions, setDecisions] = useState<Record<number, AssetDecision>>({});
  const [dirty, setDirty] = useState(false), [needsReview, setNeedsReview] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [imageDirty, setImageDirty] = useState(false), [imageEpoch, setImageEpoch] = useState(0);
  const [pending, setPending] = useState<AcquisitionReviewPending | null>(null), [cancelFor, setCancelFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [storageError, setStorageError] = useState(false), [denied, setDenied] = useState(false), [notice, setNotice] = useState("");
  const live = useRef(false), paused = useRef(suspended), dirtyRef = useRef(dirty), busyRef = useRef(false), ownStorage = useRef(false);
  const lane = useRef(0), abort = useRef<AbortController | null>(null), observed = useRef<string | null>(null), ownSubmission = useRef<string | null>(null);
  const anyDirty = useRef(false); anyDirty.current = dirty || imageDirty;
  paused.current = suspended; dirtyRef.current = dirty;
  useEffect(() => {
    live.current = true;
    const sync = () => {
      if (ownStorage.current) return;
      try {
        const next = readAcquisitionReviewPending(context);
        if (observed.current !== (next?.operationId ?? null)) { lane.current++; abort.current?.abort(); setView(null); setComparison(null); setNeedsReview(true); setConfirmed(false); setCancelFor(null); busyRef.current = false; setBusy(false); }
        observed.current = next?.operationId ?? null; setPending(next); setStorageError(false);
      } catch { lane.current++; abort.current?.abort(); setView(null); setComparison(null); setNeedsReview(true); setStorageError(true); busyRef.current = false; setBusy(false); }
    };
    sync(); let stop: () => void = () => undefined;
    try { stop = subscribeAcquisitionReviewPending(context, sync); } catch { setStorageError(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { live.current = false; lane.current++; abort.current?.abort(); stop(); };
  }, [context]);
  useEffect(() => { if (suspended) { lane.current++; abort.current?.abort(); busyRef.current = false; setBusy(false); setNeedsReview(true); setConfirmed(false); } }, [suspended]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (anyDirty.current) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, []);
  const usable = () => live.current && !paused.current && !denied;
  function begin() {
    const ticket = ++lane.current; abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    busyRef.current = true; setBusy(true); setNotice("");
    return { controller, current: () => usable() && ticket === lane.current && !controller.signal.aborted,
      finish: () => { if (live.current && ticket === lane.current) { busyRef.current = false; setBusy(false); } } };
  }
  function deny() { setDenied(true); setView(null); setComparison(null); setDraft(blank); setInitial(blank); setDecisions({}); setDirty(false); setImageDirty(false); setImageEpoch(value => value + 1); setConfirmed(false); setNotice("权限或返回范围不可核验，旧资料已隐藏；原请求编号仍保留，不会重发。"); }
  function fail(error: unknown) {
    const code = error && typeof error === "object" && "data" in error && error.data && typeof error.data === "object" && "code" in error.data ? String(error.data.code) : null;
    if (["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(code ?? "")) return deny();
    const message = error instanceof Error ? error.message : "";
    if (/ACQUISITION_IMAGE_ORIGINAL_(?:REQUIRES_SUPPLEMENT|ARTIFACT_UNVERIFIED)/u.test(message)) {
      setNeedsReview(true); setConfirmed(false); setNotice("原始证据无法安全恢复，请上传／粘贴原图。先核对或取消原请求并重新读取；不会回爬页面或调用模型。"); return;
    }
    setNeedsReview(true); setConfirmed(false); setNotice("本次结果尚未核验。草稿保留；原请求只能核对或取消，不会自动重发。读取失败不代表任务结束。");
  }
  function adopt(next: AcquisitionReviewReadResult, preserve: boolean) {
    const base = draftFrom(next); setView(next); setComparison(null); setInitial(base); setNeedsReview(false); setConfirmed(false);
    if (!preserve) { setDraft(base); setDirty(false); setDecisions(Object.fromEntries(next.assets.map(asset => [asset.id, asset.decision]))); }
    else setDecisions(previous => Object.fromEntries(next.assets.map(asset => [asset.id, previous[asset.id] ?? asset.decision])));
  }
  async function read() {
    if (!usable() || busyRef.current) return; const work = begin();
    try {
      const raw = await client.review.query(input, { signal: work.controller.signal }); if (!work.current()) return;
      const parsed = AcquisitionReviewReadResultSchema.safeParse(raw);
      if (!parsed.success || parsed.data.identity.userId !== owner.userId || canonical(parsed.data.scope) !== canonical(input)) return deny();
      if (dirtyRef.current) { setComparison(parsed.data); setNeedsReview(true); setConfirmed(false); }
      else adopt(parsed.data, false);
    } catch (error) { if (work.current()) fail(error); } finally { work.finish(); }
  }
  async function accept(raw: unknown, operation: AcquisitionReviewPending, work: ReturnType<typeof begin>) {
    if (!work.current()) return; const parsed = AcquisitionReviewWriteResultSchema.safeParse(raw);
    if (!parsed.success || parsed.data.identity.userId !== owner.userId || canonical(parsed.data.scope) !== canonical(input)
      || parsed.data.operationId !== operation.operationId) return deny();
    const result = parsed.data;
    if (readAcquisitionReviewPending(context)?.operationId !== operation.operationId) throw new Error("REVIEW_PENDING_CHANGED");
    if (result.status === "unknown") { setNotice("原请求结果未知，继续保留同一编号；仅可核对或取消，不会重新提交。"); return; }
    if (result.status === "committed" && (result.requestHash !== operation.requestHash || result.action !== operation.action)) return deny();
    await withAcquisitionReviewLock(context, work.controller.signal, async () => {
      if (!work.current() || readAcquisitionReviewPending(context)?.operationId !== operation.operationId) throw new Error("REVIEW_PENDING_CHANGED");
      ownStorage.current = true;
      try { if (!releaseAcquisitionReviewPending(context, operation.operationId)) throw new Error("REVIEW_PENDING_CHANGED"); observed.current = null; setPending(null); }
      finally { ownStorage.current = false; }
    });
    if (!work.current()) return;
    setView(null); setComparison(null); setCancelFor(null); setNeedsReview(true); setConfirmed(false);
    if (result.status === "committed") {
      if (ownSubmission.current === operation.operationId) { if (operation.action === "image") { setImageDirty(false); setImageEpoch(value => value + 1); } else setDirty(false); }
      setNotice(`原${operation.action === "save" ? "保存" : operation.action === "confirm" ? "确认" : operation.action === "image" ? "补图" : "拒绝"}请求已核验，修订 v${result.revisionVersion}。请重新读取当前版本；未调用模型，也未删除已直接入库图片。`);
    } else setNotice("已核验取消原请求。草稿保留；重新读取并核对后才能发起新的操作。");
  }
  const waiting = !!view && ["queued", "running"].includes(view.snapshot.jobStatus);
  const safeDecisions = !!view && view.assets.every(asset => decisions[asset.id] === "delete" || decisions[asset.id] === "keep" && asset.storageAvailable && asset.contentHash !== null);
  const gallery = !!view?.assets.some(asset => ["main", "secondary"].includes(asset.role) && decisions[asset.id] === "keep" && asset.storageAvailable && asset.contentHash !== null);
  const editable = !!view && !busy && !pending && !storageError && !needsReview && !waiting && !suspended && !denied;
  async function submit(action: "save" | "confirm" | "reject") {
    if (!usable() || busyRef.current || !editable || imageDirty || !view?.capabilities[action].available) return;
    if (action === "confirm" && (dirty || !confirmed || !safeDecisions || !gallery)) return;
    if (action === "reject" && !draft.note.trim()) { setNotice("拒绝修订必须填写原因。"); return; }
    const work = begin();
    try {
      const base = { ...input, operationId: crypto.randomUUID(), expectedRevisionHash: view.revisionHash };
      const raw = action === "save" ? { ...base, action, patch: makePatch(draft, initial), assetDecisions: view.assets.map(asset => ({ assetId: asset.id, decision: decisions[asset.id] ?? "pending" })), note: draft.note.trim() || null }
        : { ...base, action, note: action === "reject" ? draft.note.trim() : draft.note.trim() || null };
      const parsed = AcquisitionReviewWriteInputSchema.safeParse(raw);
      if (!parsed.success) { setNotice("输入不符合审核限制，请核对文本长度、整数、币种和 ASIN；没有提交，也没有截断或补零。"); return; }
      const request = parsed.data, operation: AcquisitionReviewPending = { version: 1, context, operationId: request.operationId, action,
        expectedRevisionHash: request.expectedRevisionHash, requestHash: acquisitionReviewRequestHash({ userId: owner.userId, workspaceId: owner.workspaceId }, request) };
      await withAcquisitionReviewLock(context, work.controller.signal, async () => {
        if (!work.current()) throw new Error("REVIEW_ABORTED"); ownStorage.current = true;
        try { reserveAcquisitionReviewPending(context, operation); observed.current = operation.operationId; setPending(operation); ownSubmission.current = operation.operationId; }
        finally { ownStorage.current = false; }
      });
      if (!work.current() || readAcquisitionReviewPending(context)?.operationId !== operation.operationId) return;
      // Direct client calls deliberately bypass global React Query mutation retries.
      const result = action === "save" ? await client.saveReview.mutate(request) : action === "confirm" ? await client.confirmReview.mutate(request) : await client.rejectReview.mutate(request);
      await accept(result, operation, work);
    } catch (error) { if (work.current()) fail(error); } finally { work.finish(); }
  }
  async function submitImage(selection: ReviewImageSelection | number) {
    if (!usable() || busyRef.current || !editable || dirty || !view?.capabilities.image.available) return;
    if (typeof selection === "number" && imageDirty) return;
    const work = begin();
    try {
      const base = { ...input, operationId: crypto.randomUUID(), expectedRevisionHash: view.revisionHash };
      let bytes: Awaited<ReturnType<typeof readReviewImageBytes>> | undefined;
      if (typeof selection !== "number") bytes = await readReviewImageBytes(selection.file, work.controller.signal);
      if (!work.current()) return;
      if (typeof selection === "number" ? !view.assets.some(asset => asset.id === selection && asset.origin === "original" && (!asset.storageAvailable || asset.contentHash === null))
        : selection.sourceAssetId !== null && !view.assets.some(asset => asset.id === selection.sourceAssetId && asset.role === selection.role)) throw new Error("IMAGE_SOURCE_CHANGED");
      const request = AcquisitionReviewImageInputSchema.parse(typeof selection === "number" ? { ...base, mode: "retry_original", sourceAssetId: selection }
        : { ...base, mode: "supplement", sourceAssetId: selection.sourceAssetId, role: selection.role, fileName: selection.file.name, base64: bytes!.base64 });
      const operation: AcquisitionReviewPending = { version: 1, context, operationId: request.operationId, action: "image", expectedRevisionHash: request.expectedRevisionHash,
        requestHash: acquisitionReviewImageRequestHash({ userId: owner.userId, workspaceId: owner.workspaceId }, request, bytes && { contentHash: bytes.contentHash, byteSize: bytes.byteSize }) };
      await withAcquisitionReviewLock(context, work.controller.signal, async () => {
        if (!work.current()) throw new Error("REVIEW_ABORTED"); ownStorage.current = true;
        try { reserveAcquisitionReviewPending(context, operation); observed.current = operation.operationId; setPending(operation); ownSubmission.current = operation.operationId; }
        finally { ownStorage.current = false; }
      });
      if (!work.current() || readAcquisitionReviewPending(context)?.operationId !== operation.operationId) return;
      await accept(await client.recoverReviewImage.mutate(request), operation, work);
    } catch (error) { if (work.current()) fail(error); } finally { work.finish(); }
  }
  async function recover(decision: "check" | "cancel" | "complete_image") {
    if (!usable() || busyRef.current || storageError) return; const work = begin();
    try {
      if (decision === "complete_image" && (!view || needsReview || waiting)) throw new Error("IMAGE_RECOVERY_REQUIRES_FRESH_READ");
      const operation = readAcquisitionReviewPending(context);
      if (!operation || operation.operationId !== pending?.operationId || decision === "cancel" && cancelFor !== operation.operationId) throw new Error("REVIEW_PENDING_CHANGED");
      if (decision === "complete_image" && operation.action !== "image") throw new Error("REVIEW_PENDING_CHANGED");
      const result = operation.action === "image" ? await client.recoverReviewImageOperation.mutate({ ...input, operationId: operation.operationId, decision })
        : await client.recoverReview.mutate({ ...input, operationId: operation.operationId, decision: decision as "check" | "cancel" });
      await accept(result, operation, work);
    } catch (error) { if (work.current()) fail(error); } finally { work.finish(); }
  }
  function leave(event: React.MouseEvent<HTMLAnchorElement>) { if (anyDirty.current && !window.confirm("离开会丢弃尚未提交的审核草稿／已选文件；未决请求编号仍可恢复。是否离开？")) event.preventDefault(); }
  return <section className="mx-auto min-w-0 max-w-7xl space-y-4 p-4" aria-label="可选人工采集审核">
    <header className="space-y-2"><h1 className="text-2xl font-semibold">采集人工审核与修订</h1><p className="text-sm">可选流程：默认安全直接／部分入库保持不变。本页保存独立修订，排除或拒绝不删除原文件，也不删除此前已直接入库图片；确认不调用模型。</p>
      <a className="text-sm underline" href="/knowledge/acquisition" onClick={leave}>返回采集任务</a></header>
    {notice && <p role="status" className="break-words rounded border p-3">{notice}</p>}
    {storageError && <p role="alert">恢复存储或浏览器锁不可用，已禁止新写入；未清除已有记录。</p>}
    {pending && <aside className="space-y-2 rounded border p-3"><p className="break-all">未决审核操作：{pending.action} · {pending.operationId}</p>
      <p>只核对或永久取消这个请求，不重新发送草稿或图片。关闭新写入后仍可恢复。</p>
      <Button disabled={busy || storageError || suspended || denied} onClick={() => void recover("check")}>核对原审核请求</Button>
      {pending.action === "image" && <><p>补图结果未知时，核对不会重传文件。先重新读取当前权限，再明确完成已准备的原件。关闭新写入后仍可恢复这个旧编号；只验证已保存原件，不新建上传。</p><Button disabled={busy || storageError || suspended || denied || needsReview || waiting || !view} onClick={() => void recover("complete_image")}>明确验证原件并完成原补图请求</Button></>}
      <label className="flex items-start gap-2"><input type="checkbox" checked={cancelFor === pending.operationId} disabled={busy || suspended || denied} onChange={event => setCancelFor(event.target.checked ? pending.operationId : null)} />确认只取消上述未决请求，不撤销已经提交的修订</label>
      <Button variant="outline" disabled={busy || storageError || suspended || denied || cancelFor !== pending.operationId} onClick={() => void recover("cancel")}>取消原审核请求</Button>
    </aside>}
    <Button disabled={busy || suspended || denied} onClick={() => void read()}>{busy ? "正在核对…" : "读取原始采集与当前修订"}</Button>
    {comparison && <aside className="space-y-2 rounded border p-3"><p>已读取新版本，未覆盖本地草稿。请比较后显式采用；采用版本不等于提交。</p>
      <details><summary>当前服务器有效草稿（完整）</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(comparison.effectiveDraft, null, 2)}</pre></details>
      <Button disabled={busy || !!pending} onClick={() => adopt(comparison, true)}>采用此版本，保留本地草稿</Button>
      <Button variant="outline" disabled={busy || !!pending} onClick={() => { if (window.confirm("确定放弃本地未提交修改，采用当前服务器草稿？")) adopt(comparison, false); }}>放弃本地修改并采用</Button>
    </aside>}
    {view && <>
      <div className="flex flex-wrap gap-3 text-sm"><span>{view.snapshot.asin} · {view.snapshot.marketplace}</span><span>Snapshot #{snapshotId} · Job #{view.snapshot.jobId}</span><span>{view.revision ? `人工修订 v${view.revision.version} · ${view.revision.status}` : "尚无人工修订"}</span></div>
      {waiting && <p role="status">采集仍在排队／运行。请等待后重新读取；当前不能保存或确认，不会自动重新采集。</p>}
      {needsReview && <p role="alert">来源或授权需要重新核对；草稿与原请求编号保留，暂不可提交。</p>}
      {dirty && <p>有未保存修改。确认只使用已保存修订，请先保存并重新读取。</p>}
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <article className="min-w-0 space-y-3 rounded border p-3"><h2 className="font-semibold">原始采集（只读、不覆盖）</h2><p className="break-all text-xs">来源 SHA：{view.snapshot.sourceHash}</p>
          <pre aria-label="原始采集完整内容" className="max-h-[36rem] overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(view.original, null, 2)}</pre></article>
        <article className="min-w-0 space-y-3 rounded border p-3"><h2 className="font-semibold">独立人工修订</h2>
          <details><summary>服务器有效草稿（完整）</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(view.effectiveDraft, null, 2)}</pre></details>
          <fieldset className="min-w-0 space-y-3" disabled={!editable}>
            {fieldLabels.map(([key, label, multiline]) => <label key={key} className="block min-w-0 space-y-1 text-sm"><span>{label}</span>{multiline
              ? <Textarea value={draft[key]} aria-label={label} rows={key === "description" ? 5 : 3} onChange={event => { setDraft(previous => ({ ...previous, [key]: event.target.value })); setDirty(true); setConfirmed(false); }} />
              : <Input value={draft[key]} aria-label={label} onChange={event => { setDraft(previous => ({ ...previous, [key]: event.target.value })); setDirty(true); setConfirmed(false); }} />}</label>)}
          </fieldset><p className="text-xs text-muted-foreground">留空为未知／明确清除，不自动补零；未修改字段不反写。评价数量不等于已取得评论正文数。</p>
        </article>
      </div>
      <h2 className="font-semibold">逐图修订选择</h2>
      <AssetReviewGrid assets={view.assets} decisions={decisions} disabled={!editable} onChange={(id, value) => { setDecisions(previous => ({ ...previous, [id]: value })); setDirty(true); setConfirmed(false); }}
        onRetryOriginal={id => void submitImage(id)} retryDisabled={!editable || dirty || imageDirty || !view.capabilities.image.available} />
      <div className="space-y-3 rounded border p-3"><p>粘贴评论预览保存及长期独立原件保存尚未接通；这里不会声称已有完整图片、OCR 或问答证据。</p>
        <p className="text-xs">{reason(view.capabilities.save.reasonCode)} {reason(view.capabilities.confirm.reasonCode)} {reason(view.capabilities.reject.reasonCode)}</p>
        <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={!editable || dirty || !safeDecisions || !gallery} onChange={event => setConfirmed(event.target.checked)} />我已核对已保存的全部图片决定及来源限制；至少一张安全主／副图，确认本修订不删除旧入库图片</label>
        <div className="flex flex-wrap gap-2"><Button disabled={!editable || imageDirty || !view.capabilities.save.available} onClick={() => void submit("save")}>{view.revision?.status === "pending_review" ? "保存审核草稿" : "保存为新的人工修订"}</Button>
          <Button variant="destructive" disabled={!editable || imageDirty || !view.capabilities.reject.available || !draft.note.trim()} onClick={() => void submit("reject")}>拒绝当前修订</Button>
          <Button disabled={!editable || imageDirty || !view.capabilities.confirm.available || dirty || !confirmed || !safeDecisions || !gallery} onClick={() => void submit("confirm")}>确认已保存修订（不调用模型）</Button></div>
      </div>
    </>}
    {!denied && <AcquisitionReviewImageForm key={imageEpoch} assets={view?.assets ?? []} disabled={!editable || dirty || !view?.capabilities.image.available}
      reason={dirty ? "请先保存或明确放弃当前审核草稿，再补图。" : view ? reason(view.capabilities.image.reasonCode) : "先读取已授权的当前修订，才能选择和补充图片。"}
      onDraftChange={setImageDirty} onSubmit={selection => void submitImage(selection)} />}
  </section>;
}
