import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CompetitorDeepAdoptionInputSchema, CompetitorDeepAdoptionRefSchema, CompetitorDeepAdoptionResultSchema,
  competitorDeepAdoptionHash as hash } from "@shared/competitorDeepAdoption";
import { listingOwnerKey, listingRequestOwner, type ListingRequestOwner } from "./listingResearchSelectionState";
import { parseCompetitorDeepResultView, type CompetitorDeepResultView } from "./competitorDeepResultView";
import CompetitorDeepResultPanel from "./CompetitorDeepResultPanel";
import { readDeepAdoptionPending, reserveDeepAdoptionPending, releaseDeepAdoptionPending, subscribeDeepAdoptionPending,
  withDeepAdoptionLock, type CompetitorDeepAdoptionPending, type CompetitorDeepAdoptionContext } from "./competitorDeepAdoptionPending";

const optionsSchema = z.object({ candidate: z.unknown(), capability: z.object({ available: z.boolean(), reasonCode: z.string().nullable() }).strict(),
  currentAdoptionValid: z.boolean(), activeAdoption: CompetitorDeepAdoptionRefSchema.nullable(),
  currentSummary: z.string().refine(value => new TextEncoder().encode(value).byteLength <= 65_535).nullable() }).strict();
type Options = Omit<z.infer<typeof optionsSchema>, "candidate"> & { candidate: CompetitorDeepResultView };
export type CompetitorDeepAdoptionEditorProps = { projectId: number; analysisId: number; asin: string; revision: string;
  suspended?: boolean; onAdopted?: () => void | Promise<void>; onDirtyChange?: (dirty: boolean) => void };
const reasons: Record<string, string> = { WRITES_DISABLED: "人工采纳写入尚未启用。", ADOPTION_WRITES_DISABLED: "人工采纳写入尚未启用。",
  SOURCE_CHANGED: "候选来源已变化，请重新核对当前资料。", RECORD_CONFIRMED: "当前记录已确认，请核对现有正式版本。",
  NOT_AVAILABLE: "当前没有可核验的研究候选。" };
const idOf = (value: CompetitorDeepAdoptionPending | null) => value?.operation.operationId ?? null;

export default function CompetitorDeepAdoptionEditor(props: CompetitorDeepAdoptionEditorProps) {
  const auth = useAuth(), owner = listingRequestOwner(auth.user, props.projectId);
  const valid = Number.isSafeInteger(props.analysisId) && props.analysisId > 0 && /^[A-Z0-9]{10}$/u.test(props.asin) && /^[a-f0-9]{64}$/u.test(props.revision);
  const identity = owner && valid ? JSON.stringify([listingOwnerKey(owner), props.analysisId, props.asin]) : null;
  const boundary = useRef({ identity, epoch: 0 }), shown = useRef<object | null>(null);
  if (boundary.current.identity !== identity) boundary.current = { identity, epoch: boundary.current.epoch + 1 };
  const token = boundary.current, suspended = auth.loading || !!props.suspended;
  if (!owner || !identity || auth.error) { shown.current = null; return <p role="alert">身份或竞品范围无法核验，未显示人工采纳资料。</p>; }
  if (!suspended) shown.current = token;
  if (suspended && shown.current !== token) return <p role="status">正在核对人工采纳身份…</p>;
  return <div hidden={suspended}><CompetitorDeepAdoptionController key={`${identity}:${token.epoch}`} {...props} owner={owner} suspended={suspended} /></div>;
}

export function CompetitorDeepAdoptionController({ owner, suspended = false, onAdopted, onDirtyChange, ...props }: CompetitorDeepAdoptionEditorProps & { owner: ListingRequestOwner }) {
  const client = trpc.useUtils().client.analysis;
  const [context] = useState<CompetitorDeepAdoptionContext>(() => ({ userId: owner.userId, workspaceId: owner.workspaceId,
    projectId: props.projectId, analysisId: props.analysisId, asin: props.asin }));
  const [options, setOptions] = useState<Options | null>(null), [comparison, setComparison] = useState<Options | null>(null);
  const [draft, setDraft] = useState(""), [dirty, setDirty] = useState(false), [open, setOpen] = useState(false);
  const [needsReview, setNeedsReview] = useState(false), [limitations, setLimitations] = useState(false);
  const [pending, setPending] = useState<CompetitorDeepAdoptionPending | null>(null), [cancelFor, setCancelFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [storageError, setStorageError] = useState(false), [denied, setDenied] = useState(false), [notice, setNotice] = useState("");
  const live = useRef(false), paused = useRef(suspended), busyRef = useRef(false), dirtyRef = useRef(dirty), ownStorage = useRef(false);
  const lane = useRef(0), abort = useRef<AbortController | null>(null), observed = useRef<string | null>(null), ownSubmission = useRef<string | null>(null);
  const latestRevision = useRef(props.revision), callback = useRef(onAdopted), draftCallback = useRef(onDirtyChange);
  paused.current = suspended; dirtyRef.current = dirty; callback.current = onAdopted; draftCallback.current = onDirtyChange;
  useEffect(() => { draftCallback.current?.(dirty); }, [dirty]);
  useEffect(() => {
    live.current = true;
    const sync = () => {
      if (ownStorage.current) return;
      try {
        const value = readDeepAdoptionPending(context), changed = observed.current !== idOf(value);
        if (changed) { lane.current++; abort.current?.abort(); busyRef.current = false; setBusy(false); setCancelFor(null); setOptions(null); setComparison(null); setNeedsReview(true); }
        observed.current = idOf(value); setPending(value); setStorageError(false);
      } catch { lane.current++; abort.current?.abort(); setStorageError(true); setOptions(null); setComparison(null); setNeedsReview(true); setBusy(false); busyRef.current = false; }
    };
    sync(); let stop: () => void = () => undefined;
    try { stop = subscribeDeepAdoptionPending(context, sync); } catch { setStorageError(true); }
    // Invalidate the latest request epoch, not the epoch captured on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { live.current = false; lane.current++; abort.current?.abort(); stop(); draftCallback.current?.(false); };
  }, [context]);
  useEffect(() => {
    if (latestRevision.current === props.revision) return;
    latestRevision.current = props.revision; lane.current++; abort.current?.abort(); busyRef.current = false; setBusy(false);
    setNeedsReview(true); setComparison(null); setLimitations(false); setNotice("当前记录版本已变化，草稿与原请求编号已保留；请重新读取并显式核对。");
  }, [props.revision]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const usable = () => live.current && !paused.current && !denied;
  function begin() {
    const ticket = ++lane.current; abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    busyRef.current = true; setBusy(true); setNotice("");
    return { controller, current: () => usable() && ticket === lane.current && !controller.signal.aborted, finish: () => { if (live.current && ticket === lane.current) { busyRef.current = false; setBusy(false); } } };
  }
  function fail(error: unknown) {
    const code = error && typeof error === "object" && "data" in error && error.data && typeof error.data === "object" && "code" in error.data ? error.data.code : null;
    if (["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(String(code))) {
      setDenied(true); setOpen(false); setDraft(""); setDirty(false); setOptions(null); setComparison(null); setNotice("权限或记录范围已变化，已隐藏旧资料；原请求恢复信息仍保留。");
    } else { setNeedsReview(true); setComparison(null); setNotice("结果尚未核验，草稿已保留；未决请求只能核对或取消原编号，不会自动重新提交。"); }
  }
  function denyResponse() {
    setDenied(true); setOpen(false); setDraft(""); setDirty(false); setOptions(null); setComparison(null);
    setNotice("返回的身份、候选或回执无法核验，已隐藏旧资料；原请求恢复信息仍保留。");
  }
  function adoptOptions(value: Options, preserveDraft: boolean) {
    setOptions(value); setComparison(null); setNeedsReview(false); setLimitations(false);
    if (!preserveDraft) { setDraft(value.currentSummary ?? (value.candidate.status === "available" ? value.candidate.result.summaryText : "")); setDirty(false); }
  }
  async function read() {
    if (!usable() || busyRef.current) return; const work = begin();
    try {
      const raw = await client.deepAdoptionOptions.query({ projectId: props.projectId, analysisId: props.analysisId,
        expectedWorkspaceId: owner.workspaceId, expectedRevision: props.revision }, { signal: work.controller.signal });
      if (!work.current()) return;
      let parsed: z.infer<typeof optionsSchema>, candidate: CompetitorDeepResultView;
      try {
        parsed = optionsSchema.parse(raw); candidate = parseCompetitorDeepResultView(parsed.candidate, { ...context, revision: props.revision });
        if (parsed.capability.available && (parsed.capability.reasonCode !== null || candidate.status !== "available")
          || parsed.currentAdoptionValid !== !!parsed.activeAdoption || parsed.activeAdoption && (candidate.status !== "available"
          || parsed.activeAdoption.jobRunId !== candidate.result.source.jobRunId || parsed.activeAdoption.resultHash !== candidate.result.resultHash
          || parsed.activeAdoption.evidenceHash !== candidate.result.source.evidenceHash)) throw new Error("ADOPTION_OPTIONS_INVALID");
      } catch { denyResponse(); return; }
      const next = { ...parsed, candidate };
      if (candidate.status === "not_available") { setOptions(next); setComparison(null); setDraft(""); setDirty(false); setNeedsReview(true); }
      else if (dirtyRef.current) { setComparison(next); setNeedsReview(true); }
      else adoptOptions(next, false);
      setOpen(true);
    } catch (error) { if (work.current()) fail(error); } finally { work.finish(); }
  }
  async function accept(raw: unknown, operation: CompetitorDeepAdoptionPending, work: ReturnType<typeof begin>) {
    if (!work.current()) return;
    const parsed = CompetitorDeepAdoptionResultSchema.safeParse(raw), scope = operation.operation;
    if (!parsed.success) { denyResponse(); return; }
    const result = parsed.data;
    if (result.identity.userId !== owner.userId || result.identity.workspaceId !== owner.workspaceId || result.projectId !== props.projectId
      || result.analysisId !== props.analysisId || result.jobRunId !== scope.jobRunId || result.operationId !== scope.operationId) { denyResponse(); return; }
    if (idOf(readDeepAdoptionPending(context)) !== scope.operationId) throw new Error("ADOPTION_PENDING_CHANGED");
    if (result.status === "unknown") { setNotice("原采纳请求结果未知，继续保留编号；仅可核对或取消该请求，不会重发。"); return; }
    if (result.requestHash !== null && result.requestHash !== operation.requestHash) { denyResponse(); return; }
    if (result.status === "committed" && (!result.ref || result.ref.resultHash !== operation.expectedResultHash || result.ref.evidenceHash !== operation.expectedEvidenceHash
      || result.ref.summaryHash !== operation.summaryHash)) { denyResponse(); return; }
    await withDeepAdoptionLock(context, work.controller.signal, async () => {
      if (!work.current() || idOf(readDeepAdoptionPending(context)) !== scope.operationId) throw new Error("ADOPTION_PENDING_CHANGED");
      ownStorage.current = true; try { if (!releaseDeepAdoptionPending(context, scope.operationId)) throw new Error("ADOPTION_PENDING_CHANGED"); observed.current = null; setPending(null); } finally { ownStorage.current = false; }
    });
    if (!work.current()) return;
    setOptions(null); setComparison(null); setCancelFor(null); setLimitations(false); setNeedsReview(true);
    if (result.status === "committed") {
      if (ownSubmission.current === scope.operationId && latestRevision.current === operation.expectedRevision && hash(draft.trim()) === operation.summaryHash) { setDirty(false); setOpen(false); }
      setNotice(result.currentActive ? "人工采纳已核验保存；正在重新读取正式研究资料。不会补齐图片、OCR 或问答证据。" : "原采纳操作已保存，但当前资料已变化或不再生效；请重新读取，不能当作当前正式研究。");
      await callback.current?.();
    } else setNotice("原采纳请求已确认取消。草稿保留；需要重新读取后才能新建采纳请求。");
  }
  async function submit() {
    if (!usable() || busyRef.current || pending || storageError || needsReview || !limitations || !options?.capability.available || options.candidate.status !== "available") return;
    const candidate = options.candidate, parsed = CompetitorDeepAdoptionInputSchema.safeParse({ projectId: props.projectId, analysisId: props.analysisId,
      expectedWorkspaceId: owner.workspaceId, jobRunId: candidate.result.source.jobRunId, operationId: crypto.randomUUID(), expectedRevision: candidate.currentRevision,
      expectedResultHash: candidate.result.resultHash, expectedEvidenceHash: candidate.result.source.evidenceHash, summary: draft, confirmLimitations: true });
    if (!parsed.success) return;
    const input = parsed.data, operation: CompetitorDeepAdoptionPending = { version: 1, context,
      operation: { projectId: input.projectId, analysisId: input.analysisId, expectedWorkspaceId: input.expectedWorkspaceId, jobRunId: input.jobRunId, operationId: input.operationId },
      expectedRevision: input.expectedRevision, expectedResultHash: input.expectedResultHash, expectedEvidenceHash: input.expectedEvidenceHash,
      summaryHash: hash(input.summary), requestHash: hash({ identity: { userId: owner.userId, workspaceId: owner.workspaceId }, request: input }) };
    const work = begin();
    try {
      await withDeepAdoptionLock(context, work.controller.signal, async () => {
        if (!work.current()) throw new Error("ADOPTION_ABORTED"); ownStorage.current = true;
        try { reserveDeepAdoptionPending(context, operation); observed.current = input.operationId; setPending(operation); ownSubmission.current = input.operationId; } finally { ownStorage.current = false; }
      });
      if (!work.current()) return;
      await accept(await client.adoptDeepResult.mutate(input, { signal: work.controller.signal }), operation, work);
    } catch (error) { if (work.current()) fail(error); } finally { work.finish(); }
  }
  async function recover(cancel: boolean) {
    if (!usable() || busyRef.current || !pending || storageError || cancel && cancelFor !== idOf(pending)) return;
    const displayed = idOf(pending), work = begin();
    try {
      const operation = await withDeepAdoptionLock(context, work.controller.signal, async () => {
        const value = readDeepAdoptionPending(context); if (!value || idOf(value) !== displayed || cancel && cancelFor !== idOf(value)) throw new Error("ADOPTION_PENDING_CHANGED"); return value;
      });
      if (!work.current()) return;
      const raw = cancel ? await client.cancelDeepAdoption.mutate(operation.operation, { signal: work.controller.signal })
        : await client.checkDeepAdoption.query(operation.operation, { signal: work.controller.signal });
      await accept(raw, operation, work);
    } catch (error) { if (work.current()) fail(error); } finally { work.finish(); }
  }
  function close() { if (busyRef.current || dirtyRef.current && !window.confirm("关闭会丢弃未提交的人工摘要；未决请求编号仍会保留。是否继续？")) return; setOpen(false); setDirty(false); setDraft(""); setOptions(null); setComparison(null); }
  const recoveryControls = pending && <div className="space-y-2 rounded border p-2 text-xs"><p className="break-all">待核对的人工采纳请求：{pending.operation.operationId}</p>
    <Button size="sm" variant="outline" disabled={busy || suspended} onClick={() => void recover(false)}>核对原采纳请求</Button>
    <label className="flex gap-2"><input type="checkbox" checked={cancelFor === idOf(pending)} disabled={busy || suspended} onChange={event => setCancelFor(event.target.checked ? idOf(pending) : null)} />确认取消此原请求；若已保存，不撤销正式研究</label>
    <Button size="sm" variant="outline" disabled={busy || suspended || cancelFor !== idOf(pending)} onClick={() => void recover(true)}>取消原采纳请求</Button></div>;
  if (denied) return <p role="alert">{notice}</p>;
  const blocked = busy || suspended || !!pending || storageError || needsReview || !options?.capability.available || !limitations || !draft.trim() || draft.trim().length > 20_000;
  return <section className="min-w-0 space-y-2" aria-label={`${props.asin} 四栏人工采纳`}>
    <Button variant="outline" size="sm" disabled={busy || suspended} onClick={() => void read()}>审阅并采纳四栏候选</Button>
    <p className="text-xs text-muted-foreground">人工审阅与保存不调用模型；采纳不代表补齐图片、OCR、问答或长期独立原件证据。</p>
    {notice && !open && <p role="status" className="text-sm">{notice}</p>}
    {storageError && <p role="alert">原请求存储无法核验，未清除未知编号；已停止新提交。请恢复此浏览器存储后重新进入。</p>}
    {!open && recoveryControls}
    <Dialog open={open && !suspended} onOpenChange={value => { if (!value) close(); }}><DialogContent className="max-h-[90vh] min-w-0 max-w-[min(64rem,calc(100vw-2rem))] overflow-y-auto">
      <DialogHeader><DialogTitle>人工审阅并采纳 · {props.asin}</DialogTitle><DialogDescription>核对完整候选及来源限制后，保存人工编辑的正式研究摘要。此动作不启动模型，不更改旧分析的历史状态。</DialogDescription></DialogHeader>
      {notice && <p role="status" className="text-sm">{notice}</p>}{recoveryControls}
      {options?.candidate.status === "available" && <CompetitorDeepResultPanel view={options.candidate} />}
      {options?.candidate.status === "not_available" && <p role="alert">没有可核验候选，未启用采纳。</p>}
      {options && !options.capability.available && <p role="alert">{reasons[options.capability.reasonCode ?? ""] ?? "当前不允许人工采纳，请核对权限、来源及服务开关。"} {options.capability.reasonCode}</p>}
      {options?.currentAdoptionValid && <p>该候选已有经服务端核验的正式采纳记录；重新保存仍需逐次人工确认。</p>}
      {needsReview && <p role="alert">版本或请求结果需重新核对。草稿未自动覆盖，当前不能保存。</p>}
      {comparison && <div className="space-y-2 rounded border p-2"><details><summary>查看新读取的完整候选</summary>{comparison.candidate.status === "available" && <CompetitorDeepResultPanel view={comparison.candidate} />}</details>
        <Button variant="outline" disabled={busy || suspended || !!pending} onClick={() => { if (usable()) adoptOptions(comparison, true); }}>采用此读取版本，保留人工摘要</Button></div>}
      <label className="block min-w-0 space-y-2 text-sm">人工正式摘要<Textarea aria-label="人工正式摘要" value={draft} rows={12} maxLength={20_000} disabled={busy || suspended || !!pending}
        onChange={event => { if (!busyRef.current && !pending && usable()) { setDraft(event.target.value); setDirty(true); } }} /></label>
      {draft.trim().length > 20_000 && <p role="alert">当前摘要已完整保留，但超过 20,000 字提交上限；请自行缩短后确认，不会自动截断或改填 AI 候选。</p>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={limitations} disabled={busy || suspended || !!pending} onChange={event => setLimitations(event.target.checked)} />我已核对标题、五点与导入评论样本；理解图片、OCR、真实问答和长期独立原件未纳入，不将竞品推断作为本品已确认事实。</label>
      <div className="flex flex-wrap gap-2"><Button disabled={blocked} onClick={() => void submit()}>确认并保存正式研究</Button>
        <Button variant="outline" disabled={busy || suspended} onClick={() => void read()}>重新读取采纳依据</Button><Button variant="ghost" disabled={busy} onClick={close}>关闭</Button></div>
    </DialogContent></Dialog>
  </section>;
}
