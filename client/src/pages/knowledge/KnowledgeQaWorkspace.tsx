import { useEffect, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Bot, Plus, MessageSquare, BookOpen, FileText, Image, Lightbulb, Video, ExternalLink, Search } from "lucide-react";
import { Streamdown } from "streamdown";
import { KnowledgeQaIdentitySchema, KnowledgeQaScopeSchema, KnowledgeQaDeleteInputSchema, KnowledgeQaThreadSchema,
  KnowledgeQaPreviewInputSchema, KnowledgeQaStartInputSchema, KnowledgeQaViewSchema, KnowledgeQaCancelSchema,
  KnowledgeQaPreviewSchema, KnowledgeQaThreadsSchema, KnowledgeQaHistorySchema, knowledgeQaOperation,
  knowledgeQaHash, knowledgeQaCanonical as canonical, type KnowledgeQaIdentity, type KnowledgeQaOperationInput,
  type KnowledgeQaPreviewInput, type KnowledgeQaStartInput, type KnowledgeQaView, type KnowledgeQaAnswer } from "@shared/knowledgeQa";
import { readKnowledgeQaPending, reserveKnowledgeQaPending, releaseKnowledgeQaPending, subscribeKnowledgeQaPending,
  withKnowledgeQaPendingLock, type KnowledgeQaPending } from "./knowledgeQaPending";

type Owner = KnowledgeQaIdentity & { role: string };
type Thread = z.infer<typeof KnowledgeQaThreadSchema>;
type PageInput = { expectedWorkspaceId: number; limit: number; beforeId?: number };
type HistoryInput = PageInput & { threadId: string };
type Query<I> = { query(input: I, options: { signal: AbortSignal }): Promise<unknown> };
type Mutation<I> = { mutate(input: I): Promise<unknown> };
type Rpc = { qaPreview: Query<KnowledgeQaPreviewInput>; qaStart: Mutation<KnowledgeQaStartInput>; qaCheck: Query<KnowledgeQaOperationInput>;
  qaCancel: Mutation<KnowledgeQaOperationInput>; qaThreads: Query<PageInput>; qaHistory: Query<HistoryInput>;
  qaRename: Mutation<{ expectedWorkspaceId: number; threadId: string; title: string; expectedVersion: number }>;
  qaDelete: Mutation<z.infer<typeof KnowledgeQaDeleteInputSchema>>; qaClear: Mutation<{ expectedWorkspaceId: number; confirmAll: true }>;
  qaFeedback: Mutation<KnowledgeQaOperationInput & { itemKey: string; rating: "helpful" | "irrelevant" | "wrong"; comment: string }> };
const typeInfo = {
  product: { icon: Lightbulb, label: "产品创意", path: "/knowledge/products", color: "bg-amber-50 dark:bg-amber-950/30" },
  listing: { icon: FileText, label: "Listing文案", path: "/knowledge/listings", color: "bg-emerald-50 dark:bg-emerald-950/30" },
  image: { icon: Image, label: "图片参考", path: "/knowledge/images", color: "bg-purple-50 dark:bg-purple-950/30" },
  skill: { icon: BookOpen, label: "运营SOP", path: "/knowledge/skills", color: "bg-blue-50 dark:bg-blue-950/30" },
  video: { icon: Video, label: "视频参考", path: "/knowledge/videos", color: "bg-rose-50 dark:bg-rose-950/30" },
};
const prompts = ["帮我找一些充电宝类目的优秀A+图片参考", "有没有高转化率的Listing标题写法案例", "新品上架运营流程SOP有哪些", "竞品分析应该关注哪些维度", "如何优化五点描述提升转化率", "有没有好的品牌故事页面设计案例"];
const labels: Record<KnowledgeQaView["state"], string> = { queued: "后台排队中", running: "正在检索知识库", dispatched: "已派发模型，等待原回执", succeeded: "回答已保存，需人工核对引用",
  failed: "失败，未自动重试", canceled: "原请求已取消", outcome_unknown: "结果未知，只能核对或取消原请求", not_found: "尚未观察到原请求，不代表未执行或未收费" };
const reason = (code: string | null) => !code ? "" : ({ EXECUTION_DISABLED: "新知识问答尚未启用", CONFIGURATION_UNAVAILABLE: "尚无可用的已保存知识助手配置",
  SOURCE_UNAVAILABLE: "知识问答 Skill 的青岛来源审批未就绪", APPROVAL_UNAVAILABLE: "来源、模型或费用审批未就绪", SOURCE_CHANGED: "知识来源或对话已变化，请重新核对",
  SOURCE_LIMIT: "完整来源超出安全预算，没有截取或调用模型" } as Record<string, string>)[code] ?? `当前状态：${code}`;
const renameReceipt = z.object({ identity: KnowledgeQaIdentitySchema, scope: KnowledgeQaScopeSchema, thread: KnowledgeQaThreadSchema }).strict();
const deleteReceipt = z.object({ identity: KnowledgeQaIdentitySchema, scope: KnowledgeQaDeleteInputSchema, deleted: z.literal(true) }).strict();
const clearReceipt = z.object({ identity: KnowledgeQaIdentitySchema, cleared: z.number().int().nonnegative().max(1000) }).strict();
const feedbackReceipt = z.object({ identity: KnowledgeQaIdentitySchema, scope: KnowledgeQaScopeSchema.extend({ operationId: z.string().uuid() }).strict(), recorded: z.literal(true) }).strict();

/** Same-owner refresh hides private data but preserves an unsent draft. A real
 * actor/workspace/role change gets a new controller, not the previous cache. */
export default function KnowledgeQaWorkspace({ legacyView }: { legacyView?: () => ReactNode }) {
  const auth = useAuth(), permissions = usePermissions(), user = auth.user;
  const valid = user && Number.isSafeInteger(user.id) && user.id > 0 && typeof user.defaultWorkspaceId === "number"
    && Number.isSafeInteger(user.defaultWorkspaceId) && user.defaultWorkspaceId > 0 && typeof user.role === "string" && !!user.role;
  const identity = valid ? JSON.stringify([user.id, user.defaultWorkspaceId, user.role]) : null;
  const boundary = useRef({ identity, epoch: 0 }), shown = useRef<object | null>(null);
  if (boundary.current.identity !== identity) boundary.current = { identity, epoch: boundary.current.epoch + 1 };
  const token = boundary.current, suspended = auth.loading || permissions.isLoading;
  if (!valid || auth.error || !permissions.isLoading && !permissions.canRead("knowledge", "kb_bot")) { shown.current = null; return <p role="alert">知识问答身份或权限不可核验，未显示私有对话。</p>; }
  if (!suspended) shown.current = token;
  if (suspended && shown.current !== token) return <p role="status">正在核对知识问答身份…</p>;
  return <div hidden={suspended}><KnowledgeQaController key={`${identity}:${token.epoch}`} legacyView={legacyView} suspended={suspended}
    owner={{ userId: user!.id, workspaceId: user!.defaultWorkspaceId!, role: user!.role }} canEdit={permissions.canEdit("knowledge", "kb_bot")}
    canDelete={permissions.canDelete("knowledge", "kb_bot")} /></div>;
}

export function KnowledgeQaController({ owner, canEdit, canDelete, suspended = false, legacyView }: { owner: Owner; canEdit: boolean; canDelete: boolean; suspended?: boolean; legacyView?: () => ReactNode }) {
  const rpc = trpc.useUtils().client.kbBot as unknown as Rpc;
  const [identity] = useState<KnowledgeQaIdentity>(() => ({ userId: owner.userId, workspaceId: owner.workspaceId }));
  const [threadId, setThreadId] = useState<string>(() => crypto.randomUUID()), [question, setQuestion] = useState("");
  const [threads, setThreads] = useState<Thread[]>([]), [threadsRead, setThreadsRead] = useState(false), [nextThread, setNextThread] = useState<number | null>(null);
  const [history, setHistory] = useState<KnowledgeQaView[]>([]), [historyThread, setHistoryThread] = useState<Thread | null>(null), [nextHistory, setNextHistory] = useState<number | null>(null);
  const [preview, setPreview] = useState<z.infer<typeof KnowledgeQaPreviewSchema> | null>(null), [job, setJob] = useState<KnowledgeQaView | null>(null);
  const [pending, setPending] = useState<KnowledgeQaPending | null>(null), [busy, setBusy] = useState(false), [charge, setCharge] = useState(false), [cancelFor, setCancelFor] = useState<string | null>(null);
  const [notice, setNotice] = useState(""), [denied, setDenied] = useState(false), [storageFailed, setStorageFailed] = useState(false), [managementUnknown, setManagementUnknown] = useState(false);
  const [legacy, setLegacy] = useState(false), [collapsed, setCollapsed] = useState(false), [titleDraft, setTitleDraft] = useState<string | null>(null);
  const live = useRef(false), pause = useRef(suspended), epoch = useRef(0), abort = useRef<AbortController | null>(null), busyRef = useRef(false), ownStorage = useRef(false);
  const pendingRef = useRef(pending); pendingRef.current = pending; pause.current = suspended;
  const editable = useRef(canEdit); editable.current = canEdit;
  const stop = () => { epoch.current++; abort.current?.abort(); busyRef.current = false; setBusy(false); };
  const begin = () => { const ticket = ++epoch.current, controller = new AbortController(); abort.current?.abort(); abort.current = controller; busyRef.current = true; setBusy(true); setNotice("");
    return { signal: controller.signal, current: () => live.current && !pause.current && ticket === epoch.current && !controller.signal.aborted,
      finish: () => { if (live.current && ticket === epoch.current) { busyRef.current = false; setBusy(false); } } }; };
  const invalid = (): never => { const error = new Error("QA response binding mismatch"); error.name = "QaResponseError"; throw error; };
  const sameIdentity = (value: { identity: KnowledgeQaIdentity }) => canonical(value.identity) === canonical(identity);
  const sameOperation = (value: { identity: KnowledgeQaIdentity; scope: KnowledgeQaOperationInput }, input: KnowledgeQaOperationInput) => sameIdentity(value) && canonical(value.scope) === canonical(input);
  function fail(error: unknown) {
    const code = (error as { data?: { code?: string } })?.data?.code;
    if (error instanceof Error && /^QA_(?:STORAGE|LOCK|PENDING)/u.test(error.message)) { setStorageFailed(true); setNotice("安全恢复存储或跨窗口锁不可用，已停止新提交；未决编号不会被删除。"); }
    else if (["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(code ?? "") || error instanceof Error && ["ZodError", "QaResponseError"].includes(error.name)) {
      setDenied(true); setPreview(null); setJob(null); setHistory([]); setHistoryThread(null); setThreads([]); setNotice("范围或权限无法核验，已隐藏旧资料；原请求编号保留。");
    } else setNotice("回执尚未核验。未决编号已保留，不会自动重发；请核对原请求或重新读取记录。");
    setCharge(false);
  }
  async function locked<T>(signal: AbortSignal, body: () => Promise<T>) { ownStorage.current = true; try { return await withKnowledgeQaPendingLock(identity, signal, body); } finally { ownStorage.current = false; } }
  const persisted = (value: KnowledgeQaPending) => canonical(readKnowledgeQaPending(identity)) === canonical(value);
  async function release(value: KnowledgeQaPending, signal: AbortSignal) { await locked(signal, async () => { if (!persisted(value)) invalid(); releaseKnowledgeQaPending(identity, value.operationId); }); const next = readKnowledgeQaPending(identity); pendingRef.current = next; setPending(next); setCancelFor(null); }
  useEffect(() => {
    live.current = true;
    const sync = () => { if (ownStorage.current) return; try { const next = readKnowledgeQaPending(identity); if (canonical(next) !== canonical(pendingRef.current)) { stop(); setPreview(null); setJob(null); setCharge(false); setCancelFor(null); } pendingRef.current = next; setPending(next); } catch (error) { fail(error); } };
    sync(); let unsubscribe = () => {}; try { unsubscribe = subscribeKnowledgeQaPending(identity, sync); } catch (error) { fail(error); }
    return () => { live.current = false; abort.current?.abort(); unsubscribe(); };
  }, [identity]);
  useEffect(() => { if (suspended) { stop(); setCharge(false); setCancelFor(null); } }, [suspended]);
  function parseView(raw: unknown, input: KnowledgeQaOperationInput, expected?: KnowledgeQaPending | null) {
    const value = KnowledgeQaViewSchema.parse(raw);
    if (!sameOperation(value, input) || value.answer && knowledgeQaHash(value.answer) !== value.resultHash
      || expected && !["not_found", "canceled"].includes(value.state) && (expected.sourceHash && expected.sourceHash !== value.sourceHash || expected.runtimeHash && expected.runtimeHash !== value.runtimeHash)) invalid();
    return value;
  }
  async function accept(value: KnowledgeQaView, record: KnowledgeQaPending, signal: AbortSignal) {
    if (!persisted(record)) invalid(); setJob(value); if (["succeeded", "failed", "canceled"].includes(value.state)) await release(record, signal);
  }
  function resetThread(id: string) {
    if (question.trim() && !window.confirm("切换对话将丢弃尚未发送的问题，是否继续？")) return;
    stop(); setThreadId(id); setQuestion(""); setHistory([]); setHistoryThread(null); setNextHistory(null); setPreview(null); setJob(null); setCharge(false); setTitleDraft(null); setLegacy(false);
  }
  async function readThreads(beforeId?: number) {
    if (busyRef.current || pause.current) return; const lane = begin(), input: PageInput = { expectedWorkspaceId: owner.workspaceId, limit: 20, ...(beforeId ? { beforeId } : {}) };
    try { const value = KnowledgeQaThreadsSchema.parse(await rpc.qaThreads.query(input, { signal: lane.signal })); if (!lane.current()) return;
      if (!sameIdentity(value) || canonical(value.request) !== canonical(input)) invalid();
      setThreads(previous => beforeId ? [...new Map([...previous, ...value.items].map(item => [item.threadId, item])).values()] : value.items); setThreadsRead(true); setNextThread(value.nextBeforeId); setManagementUnknown(false);
    } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); }
  }
  async function readHistory(beforeId?: number) {
    if (busyRef.current || pause.current) return; const lane = begin(), input: HistoryInput = { expectedWorkspaceId: owner.workspaceId, threadId, limit: 20, ...(beforeId ? { beforeId } : {}) };
    try { const value = KnowledgeQaHistorySchema.parse(await rpc.qaHistory.query(input, { signal: lane.signal })); if (!lane.current()) return;
      if (!sameIdentity(value) || canonical(value.request) !== canonical(input) || value.thread.threadId !== threadId || value.items.some(item => !sameIdentity(item) || item.scope.threadId !== threadId || item.scope.expectedWorkspaceId !== owner.workspaceId || item.answer && knowledgeQaHash(item.answer) !== item.resultHash)) invalid();
      setHistory(previous => beforeId ? [...new Map([...previous, ...value.items].map(item => [item.scope.operationId, item])).values()] : value.items); setHistoryThread(value.thread); setNextHistory(value.nextBeforeId); setManagementUnknown(false);
    } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); }
  }
  async function readPreview() {
    if (!question.trim() || busyRef.current || pause.current || pendingRef.current || denied) return; const lane = begin();
    try { const input = KnowledgeQaPreviewInputSchema.parse({ expectedWorkspaceId: owner.workspaceId, threadId, operationId: crypto.randomUUID(), question });
      const value = KnowledgeQaPreviewSchema.parse(await rpc.qaPreview.query(input, { signal: lane.signal })); if (!lane.current()) return;
      if (!sameIdentity(value) || canonical(value.scope) !== canonical(input)) invalid(); setPreview(value); setCharge(false); setJob(null);
    } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); }
  }
  async function start() {
    if (!preview?.capability.available || !preview.runtimeHash || !preview.budget || !charge || busyRef.current || pause.current || pendingRef.current || storageFailed || denied || !editable.current
      || preview.scope.threadId !== threadId || preview.scope.question !== question.trim()) return; const lane = begin();
    try { const input = KnowledgeQaStartInputSchema.parse({ ...preview.scope, expectedSourceHash: preview.sourceHash, expectedRuntimeHash: preview.runtimeHash, maxCostCents: preview.budget.maxCostCentsTotal, chargeConfirmed: true });
      const record: KnowledgeQaPending = { version: 1, identity, threadId, operationId: input.operationId, kind: "start", sourceHash: input.expectedSourceHash, runtimeHash: input.expectedRuntimeHash, requestHash: knowledgeQaHash({ identity, request: input }) };
      await locked(lane.signal, async () => { if (lane.current()) reserveKnowledgeQaPending(identity, record); }); if (!lane.current()) return;
      pendingRef.current = record; setPending(record); setCharge(false); setPreview(null);
      const value = parseView(await rpc.qaStart.mutate(input), knowledgeQaOperation(input), record); if (!lane.current()) return;
      setQuestion(""); await accept(value, record, lane.signal);
    } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); }
  }
  async function recover(cancel = false) {
    if (busyRef.current || pause.current || !pendingRef.current) return; const record = pendingRef.current, lane = begin();
    try { if (!persisted(record)) { setCancelFor(null); const next = readKnowledgeQaPending(identity); pendingRef.current = next; setPending(next); return; }
      const input = { expectedWorkspaceId: owner.workspaceId, threadId: record.threadId, operationId: record.operationId };
      if (cancel) { if (cancelFor !== record.operationId) return; const value = KnowledgeQaCancelSchema.parse(await rpc.qaCancel.mutate(input)); if (!lane.current()) return;
        if (!sameOperation(value, input) || !persisted(record)) invalid();
        if (value.state === "canceled") { await release(record, lane.signal); setJob(previous => previous?.scope.operationId === input.operationId ? null : previous); setNotice("原请求已取消；已产生的模型费用不会撤销。"); }
        else setNotice(`${labels[value.state]}；取消回包不含答案，请继续核对原请求。`);
      } else { const value = parseView(await rpc.qaCheck.query(input, { signal: lane.signal }), input, record); if (lane.current()) await accept(value, record, lane.signal); }
    } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); }
  }
  async function inspect(value: KnowledgeQaView) {
    if (busyRef.current || pause.current || pendingRef.current) return; const lane = begin();
    try { const input = knowledgeQaOperation(value.scope), record: KnowledgeQaPending = { version: 1, identity, threadId: input.threadId, operationId: input.operationId, kind: "observed", sourceHash: null, runtimeHash: null, requestHash: null };
      await locked(lane.signal, async () => { if (lane.current()) reserveKnowledgeQaPending(identity, record); }); if (!lane.current()) return;
      pendingRef.current = record; setPending(record); const result = parseView(await rpc.qaCheck.query(input, { signal: lane.signal }), input); if (lane.current()) await accept(result, record, lane.signal);
    } catch (error) { if (lane.current()) fail(error); } finally { lane.finish(); }
  }
  const recoverRef = useRef(recover); recoverRef.current = recover;
  useEffect(() => { if (!suspended && pending && job?.scope.operationId === pending.operationId && ["queued", "running", "dispatched"].includes(job.state) && !busy) {
    const timer = setTimeout(() => { void recoverRef.current(); }, 2500); return () => clearTimeout(timer);
  } }, [pending, job, busy, suspended]);
  async function manage(action: "rename" | "delete" | "clear") {
    if (busyRef.current || pause.current || pendingRef.current || managementUnknown || denied) return;
    const current = historyThread?.threadId === threadId ? historyThread : threads.find(item => item.threadId === threadId);
    if (action === "rename" ? !canEdit || !current || !titleDraft?.trim() : !canDelete || action === "delete" && !current) return;
    if (action !== "rename" && !window.confirm(action === "clear" ? "隐藏当前工作区自己的全部新版对话（不仅是本页）；服务端保留原件，不影响旧版记录。确认继续？" : "隐藏此新版对话；服务端保留原件。确认继续？")) return;
    const lane = begin(); setManagementUnknown(true);
    try {
      if (action === "rename") { const input = { expectedWorkspaceId: owner.workspaceId, threadId, title: titleDraft!.trim(), expectedVersion: current!.version };
        const value = renameReceipt.parse(await rpc.qaRename.mutate(input)); if (!lane.current()) return;
        if (!sameIdentity(value) || value.scope.threadId !== threadId || value.scope.expectedWorkspaceId !== owner.workspaceId || value.thread.threadId !== threadId || value.thread.title !== input.title || value.thread.version !== input.expectedVersion + 1) invalid();
        setHistoryThread(value.thread); setThreads(previous => previous.map(item => item.threadId === threadId ? value.thread : item)); setTitleDraft(null);
      } else if (action === "delete") { const input = { expectedWorkspaceId: owner.workspaceId, threadId, expectedVersion: current!.version }, value = deleteReceipt.parse(await rpc.qaDelete.mutate(input)); if (!lane.current()) return;
        if (!sameIdentity(value) || canonical(value.scope) !== canonical(input)) invalid(); setThreads(previous => previous.filter(item => item.threadId !== threadId)); setThreadId(crypto.randomUUID()); setHistory([]); setHistoryThread(null); setJob(null); setPreview(null); setQuestion("");
      } else { const value = clearReceipt.parse(await rpc.qaClear.mutate({ expectedWorkspaceId: owner.workspaceId, confirmAll: true })); if (!lane.current()) return; if (!sameIdentity(value)) invalid();
        setThreads([]); setThreadsRead(false); setNextThread(null); setThreadId(crypto.randomUUID()); setHistory([]); setHistoryThread(null); setJob(null); setPreview(null); setQuestion(""); setNotice(`已隐藏 ${value.cleared} 个新版对话；未永久删除原件。`);
      }
      setManagementUnknown(false);
    } catch (error) { if (lane.current()) { fail(error); setNotice("对话管理回执未知，未自动重试。请先重新读取对话列表／本对话，核对实际版本。"); } } finally { lane.finish(); }
  }
  // A restored UUID can belong to a different thread than the fresh blank
  // composer. Show its checked result explicitly, never silently lose it or
  // insert it into the selected thread's server-side conversation context.
  const shown = [...new Map([...history, ...(job ? [job] : [])].map(item => [item.scope.operationId, item])).values()].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  const currentThread = historyThread?.threadId === threadId ? historyThread : threads.find(item => item.threadId === threadId);
  if (legacy) return <section><div className="flex items-center gap-3 border-b p-3"><Button variant="outline" onClick={() => setLegacy(false)}>返回新版知识问答</Button><p>旧版只读记录：未绑定当前工作区，不作为新版问答来源。</p></div>{legacyView?.()}</section>;
  return <div className="flex h-[calc(100vh-4rem)] min-h-[36rem] overflow-hidden" aria-label="知识库三层检索问答">
    <aside className={`${collapsed ? "hidden" : "w-64 shrink-0"} flex flex-col border-r bg-muted/30`}>
      <div className="flex items-center justify-between border-b p-3"><h3 className="flex gap-2 text-sm font-semibold"><Bot className="h-4 w-4" />对话记录</h3><Button aria-label="新建知识对话" size="icon" variant="ghost" onClick={() => resetThread(crypto.randomUUID())}><Plus className="h-4 w-4" /></Button></div>
      <div className="space-y-2 overflow-auto p-2"><Button variant="outline" size="sm" disabled={busy || suspended} onClick={() => void readThreads()}>读取对话列表</Button>
        {threadsRead && !threads.length && <p className="text-xs">本次成功读取未返回新版对话。</p>}
        {threads.map(item => <button key={item.threadId} className={`flex w-full items-center gap-2 rounded-md p-2 text-left text-xs ${item.threadId === threadId ? "bg-primary/10 text-primary" : "hover:bg-muted"}`} onClick={() => resetThread(item.threadId)}><MessageSquare className="h-4 w-4 shrink-0" /><span className="truncate">{item.title}</span></button>)}
        {nextThread && <Button size="sm" variant="outline" disabled={busy} onClick={() => void readThreads(nextThread)}>更早的对话</Button>}
        {legacyView && <Button variant="ghost" size="sm" disabled={busy || !!pending} onClick={() => setLegacy(true)}>查看旧版只读记录</Button>}
      </div>
    </aside>
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b p-3"><Button aria-label="展开或收起知识对话列表" variant="ghost" size="icon" onClick={() => setCollapsed(!collapsed)}><MessageSquare className="h-4 w-4" /></Button>
        <div><h2 className="text-sm font-semibold">AI知识助手</h2><p className="text-[10px] text-muted-foreground">L1索引 → L2摘要 → L3详情 · 同工作区已确认共享知识 · 青岛受审Skill</p></div>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void readHistory()}>读取本对话</Button>
        <Button size="sm" variant="outline" onClick={() => resetThread(crypto.randomUUID())}>新对话</Button>
      </header>
      <div className="flex-1 space-y-4 overflow-auto p-4">
        <p className="text-xs text-muted-foreground">保留原五类来源、引用跳转与逐来源反馈；不上传或联网，不读取图片像素，不自动写入知识库。完整业务验收尚待人工完成。</p>
        {notice && <p role="status" className="rounded border p-2 text-sm">{notice}</p>}
        {managementUnknown && <p role="alert">对话管理结果需重读核对，暂不接受再次修改。</p>}
        {!denied && currentThread && <div className="flex flex-wrap items-center gap-2 text-xs"><span>{currentThread.title} · 版本 {currentThread.version}</span>
          {titleDraft === null ? <Button size="sm" variant="ghost" disabled={!canEdit || busy || !!pending || managementUnknown} onClick={() => setTitleDraft(currentThread.title)}>重命名</Button>
            : <><Input aria-label="知识对话新标题" className="w-56" maxLength={255} value={titleDraft} onChange={event => setTitleDraft(event.target.value)} /><Button size="sm" disabled={busy || managementUnknown} onClick={() => void manage("rename")}>保存对话标题</Button><Button size="sm" variant="ghost" onClick={() => setTitleDraft(null)}>取消改名</Button></>}
          <Button size="sm" variant="ghost" disabled={!canDelete || busy || !!pending || managementUnknown} onClick={() => void manage("delete")}>隐藏本对话</Button>
          <Button size="sm" variant="ghost" disabled={!canDelete || busy || !!pending || managementUnknown} onClick={() => void manage("clear")}>清空全部新版对话</Button></div>}
        {pending && <div className="space-y-2 rounded border p-3 text-xs"><p className="break-all">未决原请求：{pending.operationId} · 对话 {pending.threadId}</p>
          <Button size="sm" variant="outline" disabled={busy || suspended} onClick={() => void recover()}>核对原请求</Button>
          <label className="flex gap-2"><input type="checkbox" checked={cancelFor === pending.operationId} onChange={event => setCancelFor(event.target.checked ? pending.operationId : null)} />确认永久取消此原编号；已发生费用不会撤销</label>
          <Button size="sm" variant="outline" disabled={busy || suspended || cancelFor !== pending.operationId} onClick={() => void recover(true)}>取消原请求</Button></div>}
        {!shown.length && !denied && <div className="mx-auto max-w-lg space-y-4 py-10 text-center"><Bot className="mx-auto h-12 w-12 text-primary/60" /><h3 className="font-semibold">AI知识库助手</h3><p className="text-sm text-muted-foreground">检索优秀案例、运营SOP和文案。先预览来源与费用，再明确启动一次问答。</p><div className="grid grid-cols-2 gap-2">{prompts.map(prompt => <button key={prompt} disabled={busy || !!pending} className="rounded-lg border p-3 text-left text-xs hover:bg-accent" onClick={() => { setQuestion(prompt); setPreview(null); setCharge(false); }}>{prompt}</button>)}</div></div>}
        {!denied && shown.map(value => <article key={value.scope.operationId} aria-label="知识问答记录" className="mx-auto max-w-4xl space-y-3">
          {value.scope.threadId !== threadId && <p className="break-all rounded border p-2 text-xs">已核对的原请求属于另一对话 {value.scope.threadId}；未并入当前对话上下文。可在左侧重新读取对话列表后打开原对话。</p>}
          {value.question && <div className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary p-3 text-sm text-primary-foreground">{value.question}</div>}
          <div className="rounded-lg bg-muted p-4"><p className="mb-2 text-xs text-muted-foreground">{labels[value.state]} · {value.stage ?? "尚无模型阶段"} · {reason(value.reasonCode)}</p>
            {value.answer && <KnowledgeQaAnswerView key={`${value.scope.operationId}:${value.resultHash}`} value={value.answer} scope={value.scope} identity={identity} rpc={rpc} canEdit={canEdit} suspended={suspended} onInvalid={fail} />}
            {value.sourceChanged && <p role="alert">来源已变化，此回答仅作历史记录，请重新核对来源。</p>}
            <Button size="sm" variant="ghost" disabled={busy || !!pending} onClick={() => void inspect(value)}>重新核对该次回答</Button>
          </div></article>)}
        {nextHistory && <Button variant="outline" disabled={busy} onClick={() => void readHistory(nextHistory)}>更早的问答记录</Button>}
      </div>
      <footer className="space-y-3 border-t p-4">
        {preview && !denied && <div className="mx-auto max-w-4xl space-y-2 rounded border p-3 text-xs"><p>匹配索引 {preview.matchedCount} 条 · {preview.types.map(type => typeInfo[type].label).join("、") || "无来源"} · 对话上下文 {preview.historyIncluded}/{preview.historyAvailable} 条（最多最近6条）</p>
          <p>已保存配置版本 {preview.configuration?.revision ?? "未就绪"} · 最多 {preview.budget?.maxCalls ?? "未知"} 次模型调用 · 总费用授权上限 USD {preview.budget ? (preview.budget.maxCostCentsTotal / 100).toFixed(2) : "未知"}（非实际账单）</p>
          <details><summary>来源和执行指纹</summary><p className="break-all">来源 {preview.sourceHash}<br />配置 {preview.configuration?.hash ?? "未就绪"}<br />执行 {preview.runtimeHash ?? "未就绪"}</p></details>
          {!preview.capability.available && <p>{reason(preview.capability.reasonCode)}</p>}
          <label className="flex items-start gap-2"><input type="checkbox" checked={charge} disabled={busy || !!pending || !canEdit || !preview.capability.available} onChange={event => setCharge(event.target.checked)} />确认本次问题、完整来源、已保存配置与总费用上限</label>
          <Button disabled={busy || !!pending || !charge || !canEdit || !preview.capability.available || storageFailed} onClick={() => void start()}>确认费用并启动一次问答</Button></div>}
        <div className="mx-auto flex max-w-4xl items-end gap-2"><Textarea aria-label="知识问答问题" maxLength={5000} rows={2} value={question} disabled={busy || !!pending || denied} placeholder="输入问题，先预览本次知识来源与费用…" className="max-h-32 resize-none"
          onChange={event => { setQuestion(event.target.value); setPreview(null); setCharge(false); }} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void readPreview(); } }} />
          <Button variant="outline" disabled={!question.trim() || busy || !!pending || denied || suspended} onClick={() => void readPreview()}>预览来源与费用</Button></div>
      </footer>
    </main>
  </div>;
}

function KnowledgeQaAnswerView({ value, scope, identity, rpc, canEdit, suspended, onInvalid }: { value: KnowledgeQaAnswer; scope: KnowledgeQaOperationInput;
  identity: KnowledgeQaIdentity; rpc: Rpc; canEdit: boolean; suspended: boolean; onInvalid: (error: unknown) => void }) {
  const [feedback, setFeedback] = useState<Record<string, string>>({}), [commentFor, setCommentFor] = useState<string | null>(null), [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""); const live = useRef(false), paused = useRef(suspended); paused.current = suspended;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  async function send(itemKey: string, rating: "helpful" | "irrelevant" | "wrong") {
    if (busy || !canEdit || paused.current || feedback[itemKey]) return;
    if (rating === "wrong" && commentFor !== itemKey) { setCommentFor(itemKey); setComment(""); return; }
    setBusy(true); setNotice("");
    try { const response = feedbackReceipt.parse(await rpc.qaFeedback.mutate({ ...scope, itemKey, rating, comment: rating === "wrong" ? comment : "" })); if (!live.current || paused.current) return;
      if (canonical(response.identity) !== canonical(identity) || canonical(response.scope) !== canonical(scope)) { const error = new Error("Feedback scope mismatch"); error.name = "QaResponseError"; throw error; }
      setFeedback(previous => ({ ...previous, [itemKey]: rating })); setCommentFor(null); setComment("");
    } catch (error) { if (live.current && !paused.current) { setNotice("反馈回执未核验，未自动重发；重新读取记录后核对。"); if (error instanceof Error && ["ZodError", "QaResponseError"].includes(error.name)) onInvalid(error); } }
    finally { if (live.current) setBusy(false); }
  }
  return <div className="space-y-3"><div className="prose prose-sm max-w-none dark:prose-invert"><Streamdown>{value.content}</Streamdown></div>
    <div className="space-y-2">{value.references.map((reference, index) => { const info = typeInfo[reference.type], Icon = info.icon; return <details key={reference.key} className={`rounded-lg border p-3 ${info.color}`}>
      <summary className="cursor-pointer text-sm"><Icon className="mr-2 inline h-4 w-4" />[引用{index + 1}] {reference.title} <Badge variant="outline" className="text-[10px]">{info.label}</Badge></summary>
      <p className="mt-2 whitespace-pre-wrap text-xs">{reference.excerpt}</p><p className="mt-1 text-xs">{reference.asin} {reference.category} {reference.score !== null ? `评分 ${reference.score}/10` : ""}</p>
      <a href={`${info.path}?highlight=${reference.id}`} className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"><ExternalLink className="h-3 w-3" />查看详情</a>
      <div className="mt-2 flex flex-wrap gap-2 text-xs"><span>这个来源有帮助吗？</span>{feedback[reference.key] ? <span>已提交反馈</span> : <>{(["helpful", "irrelevant", "wrong"] as const).map(rating => <Button key={rating} variant="ghost" size="sm" disabled={busy || !canEdit || suspended} onClick={() => void send(reference.key, rating)}>{rating === "helpful" ? "有用" : rating === "irrelevant" ? "不相关" : "内容错误"}</Button>)}</>}</div>
      {commentFor === reference.key && <div className="flex items-center gap-2"><Input aria-label={`引用${index + 1}错误原因`} maxLength={500} value={comment} onChange={event => setComment(event.target.value)} /><Button size="sm" disabled={busy || !canEdit || suspended} onClick={() => void send(reference.key, "wrong")}>提交错误说明</Button><Button variant="ghost" size="sm" onClick={() => setCommentFor(null)}>取消反馈</Button></div>}
    </details>; })}</div>
    <details className="text-xs text-muted-foreground"><summary className="cursor-pointer"><Search className="mr-1 inline h-3 w-3" />检索路径 · {value.tokensUsed === null ? "供应商未报告用量" : `${value.tokensUsed} tokens`}</summary>
      {value.searchPath.map(step => <p key={step.level}>{step.level} · 扫描 {step.scannedCount} / 匹配 {step.matchedCount} · {step.modelCalled ? "已调用模型" : "未调用模型"} · {step.tokensUsed === null ? "用量未知" : `${step.tokensUsed} tokens`}</p>)}</details>
    {notice && <p role="status">{notice}</p>}
  </div>;
}
