import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import type { AgentLibraryKey } from "@shared/agentLibraryContracts";
import {
  AssistantConversationCreateThreadInputSchema, AssistantConversationHistoryInputSchema, AssistantConversationOperationInputSchema,
  AssistantConversationSubmitInputSchema, AssistantConversationThreadsInputSchema, type AssistantConversationMode, type AssistantConversationState,
} from "@shared/assistantConversation";
import {
  AssistantConversationOptionsInputSchema, AssistantConversationOptionsResultSchema,
  AssistantConversationThreadResultSchema, AssistantConversationThreadsResultSchema, AssistantConversationHistoryResultSchema,
  AssistantConversationOperationResultSchema, type AssistantConversationOptionsResult, type AssistantConversationPublicThread,
  type AssistantConversationPublicTurn, type AssistantConversationOperationResult,
} from "@shared/assistantConversationRead";
import { trpc } from "@/lib/trpc";
import AssistantConversationPanel, { type ConversationMessageView, type ConversationReadView, type ConversationThreadView } from "./AssistantConversationPanel";
import {
  CONVERSATION_PENDING_EVENT, conversationPendingKey, conversationLocksAvailable, readConversationPending,
  reserveConversationPending, releaseConversationPending, readConversationFiles, disposeConversationFiles,
  type ConversationOwner, type ConversationPending, type ConversationDraftFile,
} from "./AssistantConversationDraft";

type Query<T> = { query: (input: T, options?: { signal?: AbortSignal }) => Promise<unknown> };
type Mutation<T> = { mutate: (input: T) => Promise<unknown> };
export type AssistantConversationClient = {
  options: Query<z.input<typeof AssistantConversationOptionsInputSchema>>;
  threads: Query<z.input<typeof AssistantConversationThreadsInputSchema>>;
  history: Query<z.input<typeof AssistantConversationHistoryInputSchema>>;
  createThread: Mutation<z.input<typeof AssistantConversationCreateThreadInputSchema>>;
  submit: Mutation<z.input<typeof AssistantConversationSubmitInputSchema>>;
  check: Query<z.input<typeof AssistantConversationOperationInputSchema>>;
  cancel: Mutation<z.input<typeof AssistantConversationOperationInputSchema>>;
};
export type AssistantConversationBridgeProps = { agentKey: AgentLibraryKey; scopeKey: string; workspaceId: number; userId: number; role: string; onDirtyChange?: (dirty: boolean) => void };
type Owner = ConversationOwner & { role: string; scopeKey: string };
type History = z.infer<typeof AssistantConversationHistoryResultSchema>;
type Threads = z.infer<typeof AssistantConversationThreadsResultSchema>;
const terminal = (state: AssistantConversationState) => ["succeeded", "failed", "canceled"].includes(state);
const running = (state: AssistantConversationState | "not_found" | null) => state !== null && ["queued", "route_dispatched", "route_ready", "reply_dispatched", "reply_ready"].includes(state);
const reason = (code: string | null) => code === null ? null : ({
  WRITES_DISABLED: "对话执行开关关闭；可查看历史与核对、取消原操作。",
  RUNTIME_UNAVAILABLE: "对话运行时尚未就绪；不会启动模型。",
  CONFIGURATION_UNAVAILABLE: "请先由管理员保存当前助手配置。",
  CONFIGURATION_DISABLED: "当前助手已停用。",
  APPROVAL_REQUIRED: "执行 Skill 还需真实审批；当前不可发送。",
}[code] ?? `当前不可操作：${code}`);
function deniedError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const e = error as { data?: { code?: string }; shape?: { data?: { code?: string } }; message?: string };
  return ["FORBIDDEN", "UNAUTHORIZED"].includes(e.data?.code ?? e.shape?.data?.code ?? "") || /IDENTITY_MISMATCH|SCOPE_MISMATCH|WORKSPACE_CHANGED/u.test(e.message ?? "");
}
function sameOwner(identity: { workspaceId: number; userId: number; agentKey: AgentLibraryKey }, owner: ConversationOwner) {
  if (identity.workspaceId !== owner.workspaceId || identity.userId !== owner.userId || identity.agentKey !== owner.agentKey) throw new Error("IDENTITY_MISMATCH");
}
function checkedHistory(raw: unknown, owner: ConversationOwner, threadId: string, before?: number): History {
  const result = AssistantConversationHistoryResultSchema.parse(raw); sameOwner(result.identity, owner);
  if (result.items.length > 10 || result.thread.threadId !== threadId || result.items.some((row, i) => row.threadId !== threadId || row.sequence === null || row.mode === null || row.message === null || row.configurationRevision === null || row.configurationHash === null
    || row.mode === "work" && row.proposedRules !== null || before !== undefined && row.sequence >= before || i > 0 && row.sequence >= result.items[i - 1].sequence!)) throw new Error("HISTORY_PAGE_INVALID");
  if (new Set(result.items.map(row => row.operationId)).size !== result.items.length || result.nextBeforeSequence !== null && result.nextBeforeSequence !== result.items.at(-1)?.sequence) throw new Error("HISTORY_PAGE_INVALID");
  return result;
}
function projectMessage(row: AssistantConversationPublicTurn): ConversationMessageView {
  return { operationId: row.operationId, sequence: row.sequence!, mode: row.mode!, message: row.message!, reply: row.reply,
    state: row.state, errorCode: row.errorCode, selectedSkillSlug: row.selectedSkillSlug, configurationRevision: row.configurationRevision!, createdAt: row.createdAt, proposedRules: row.proposedRules,
    attachments: row.attachments.map(file => ({ name: file.name, sizeBytes: file.sizeBytes, image: file.kind === "image", coverage: `服务端提取范围：${JSON.stringify(file.coverage)}`, warnings: file.warnings.map(warning => warning.message) })),
  };
}

/** Injection is for synthetic browser/tests; production uses the exact tRPC client. */
export function AssistantConversationController({ owner, api, onDirtyChange }: { owner: Owner; api: AssistantConversationClient; onDirtyChange?: (dirty: boolean) => void }) {
  return <OwnedConversation key={JSON.stringify([owner.userId, owner.workspaceId, owner.agentKey, owner.role, owner.scopeKey])} owner={owner} api={api} onDirtyChange={onDirtyChange} />;
}
function OwnedConversation({ owner, api, onDirtyChange }: { owner: Owner; api: AssistantConversationClient; onDirtyChange?: (dirty: boolean) => void }) {
  const [options, setOptions] = useState<ConversationReadView<AssistantConversationOptionsResult>>({ status: "loading" });
  const [threads, setThreads] = useState<ConversationReadView<Threads>>({ status: "loading" });
  const [history, setHistory] = useState<ConversationReadView<History> | null>(null);
  const [thread, setThread] = useState<AssistantConversationPublicThread | null>(null);
  const [mode, setMode] = useState<AssistantConversationMode>("work"), [skillSlug, setSkillSlug] = useState("");
  const [message, setMessage] = useState(""), [title, setTitle] = useState("");
  const [files, setFiles] = useState<ConversationDraftFile[]>([]), [readingFiles, setReadingFiles] = useState(false);
  const [pending, setPending] = useState<ConversationPending | null>(null), [pendingState, setPendingState] = useState<AssistantConversationState | "not_found" | null>(null);
  const [cancelFor, setCancelFor] = useState<string | null>(null), [storageError, setStorageError] = useState(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [denied, setDenied] = useState(false);
  const [runtimeEnabled, setRuntimeEnabled] = useState(false), [createUnknown, setCreateUnknown] = useState<{ threadId: string; title: string } | null>(null);
  const life = useRef({ active: false, denied: false, epoch: 0, controllers: new Set<AbortController>() });
  const lane = useRef({ busy: false, id: 0 });
  const ownStorage = useRef(false), previousPending = useRef<string | null | undefined>(undefined);
  const filesRef = useRef(files), dirtyRevision = useRef(0), submitted = useRef<{ operationId: string; revision: number; threadId: string } | null>(null);
  const selectedId = useRef<string | null>(null), historyTicket = useRef(0), optionsTicket = useRef(0), threadsTicket = useRef(0), fileBusy = useRef(false);
  filesRef.current = files;
  const scope = { expectedWorkspaceId: owner.workspaceId, agentKey: owner.agentKey };
  const dirty = !!message || files.length > 0 || !!title || !!createUnknown;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const callbacks = useRef({ reload: () => {}, check: () => {}, sync: () => {} });
  const storageKey = conversationPendingKey(owner);
  function readLane() {
    const controller = new AbortController(), epoch = life.current.epoch; life.current.controllers.add(controller);
    return { signal: controller.signal, current: () => life.current.active && !life.current.denied && !controller.signal.aborted && epoch === life.current.epoch,
      close: () => life.current.controllers.delete(controller) };
  }
  function clearFiles() { disposeConversationFiles(filesRef.current); filesRef.current = []; setFiles([]); }
  function quarantine(error: unknown) {
    if (!deniedError(error)) return false;
    life.current.denied = true; life.current.epoch++; for (const controller of life.current.controllers) controller.abort();
    lane.current.busy = false; lane.current.id++; setBusy(false); setDenied(true); setOptions({ status: "error", message: "当前私有读取权限已变化" });
    setThreads({ status: "error", message: "当前私有读取权限已变化" }); setHistory(null); setThread(null); selectedId.current = null; setMessage(""); setTitle(""); clearFiles(); setPending(null); setCreateUnknown(null); setCancelFor(null); submitted.current = null;
    return true;
  }
  async function loadOptions() {
    if (!life.current.active || life.current.denied) return;
    const request = readLane(), ticket = ++optionsTicket.current; setOptions({ status: "loading" });
    try {
      const result = AssistantConversationOptionsResultSchema.parse(await api.options.query(scope, { signal: request.signal }));
      if (!request.current() || ticket !== optionsTicket.current) return; sameOwner(result.identity, owner);
      if (new Set(result.skills.map(skill => skill.slug)).size !== result.skills.length) throw new Error("OPTIONS_INVALID");
      setOptions({ status: "ready", value: result }); setRuntimeEnabled(result.runtimeEnabled);
    } catch (error) { if (request.current() && ticket === optionsTicket.current && !quarantine(error)) { setOptions({ status: "error", message: "对话能力读取失败，请显式刷新" }); setRuntimeEnabled(false); } }
    finally { request.close(); }
  }
  async function loadThreads(beforeId?: number) {
    if (!life.current.active || life.current.denied) return;
    const prior = threads.status === "ready" ? threads.value : null;
    if (beforeId !== undefined && prior?.nextBeforeId !== beforeId) return;
    const request = readLane(), ticket = ++threadsTicket.current; if (beforeId === undefined) setThreads({ status: "loading" });
    try {
      const result = AssistantConversationThreadsResultSchema.parse(await api.threads.query({ ...scope, ...(beforeId === undefined ? {} : { beforeId }), limit: 20 }, { signal: request.signal }));
      if (!request.current() || ticket !== threadsTicket.current) return; sameOwner(result.identity, owner);
      const old = beforeId === undefined ? [] : prior!.items;
      if (result.items.length > 20 || new Set([...old, ...result.items].map(row => row.threadId)).size !== old.length + result.items.length || result.nextBeforeId !== null && (!result.items.length || beforeId !== undefined && result.nextBeforeId >= beforeId)) throw new Error("THREAD_PAGE_INVALID");
      setThreads({ status: "ready", value: { ...result, items: [...old, ...result.items] } });
    } catch (error) { if (request.current() && ticket === threadsTicket.current && !quarantine(error)) setThreads({ status: "error", message: "会话列表读取失败或分页内容不一致，请刷新" }); }
    finally { request.close(); }
  }
  async function loadHistory(threadId: string, before?: number) {
    if (!life.current.active || life.current.denied) return;
    const prior = history?.status === "ready" ? history.value : null;
    if (before !== undefined && (prior?.thread.threadId !== threadId || prior.nextBeforeSequence !== before)) return;
    const request = readLane(), ticket = ++historyTicket.current; if (before === undefined) setHistory({ status: "loading" });
    try {
      const result = checkedHistory(await api.history.query({ ...scope, threadId, ...(before === undefined ? {} : { beforeSequence: before }), limit: 10 }, { signal: request.signal }), owner, threadId, before);
      if (!request.current() || ticket !== historyTicket.current || selectedId.current !== threadId) return;
      const old = before === undefined ? [] : prior!.items;
      if (before !== undefined && (result.thread.version !== prior!.thread.version || result.thread.activeOperationId !== prior!.thread.activeOperationId)) throw new Error("HISTORY_VERSION_CHANGED");
      if (new Set([...old, ...result.items].map(row => row.operationId)).size !== old.length + result.items.length) throw new Error("HISTORY_PAGE_INVALID");
      setHistory({ status: "ready", value: { ...result, items: [...old, ...result.items] } }); setThread(result.thread); setRuntimeEnabled(result.runtimeEnabled);
    } catch (error) { if (request.current() && ticket === historyTicket.current && selectedId.current === threadId && !quarantine(error)) { setHistory({ status: "error", message: "消息读取失败、版本变化或分页内容不一致；请刷新重新读取，未拼接旧页" }); setThread(null); } }
    finally { request.close(); }
  }
  function selectThread(threadId: string) {
    if (!threadId || threadId === selectedId.current || lane.current.busy || fileBusy.current || life.current.denied) return;
    if (dirtyRef.current && !window.confirm("切换会话将丢弃未发送草稿和附件，是否继续？")) return;
    historyTicket.current++; selectedId.current = threadId; submitted.current = null; dirtyRevision.current++; setMessage(""); setTitle(""); clearFiles(); setCreateUnknown(null);
    setThread(threads.status === "ready" ? threads.value.items.find(item => item.threadId === threadId) ?? null : null); void loadHistory(threadId);
  }
  function beginAction() {
    if (lane.current.busy || !life.current.active || life.current.denied) return null;
    lane.current.busy = true; const id = ++lane.current.id, request = readLane(); setBusy(true); setNotice("");
    return { ...request, current: () => request.current() && id === lane.current.id, done: () => { request.close(); if (id === lane.current.id && life.current.active) { lane.current.busy = false; setBusy(false); } } };
  }
  function syncPending() {
    if (life.current.denied) return;
    try {
      const value = readConversationPending(owner), next = value?.operationId ?? null;
      if (previousPending.current !== undefined && previousPending.current !== next) {
        setCancelFor(null); setPendingState(null);
        if (!ownStorage.current) { lane.current.id++; lane.current.busy = false; setBusy(false); setNotice("另一窗口的原操作已变化，已保留当前草稿；请核对新的 UUID。"); }
      }
      previousPending.current = next; setPending(value); setStorageError(false);
    } catch { lane.current.id++; lane.current.busy = false; setBusy(false); setPending(null); setStorageError(true); setCancelFor(null); }
  }
  async function acceptOperation(raw: unknown, operation: ConversationPending, request: { signal: AbortSignal; current: () => boolean }) {
    const result: AssistantConversationOperationResult = AssistantConversationOperationResultSchema.parse(raw); sameOwner(result.identity, owner);
    if (result.thread.threadId !== operation.threadId || result.operation && (result.operation.operationId !== operation.operationId || result.operation.threadId !== operation.threadId)
      || (result.operation === null) !== (result.reasonCode === "OPERATION_UNKNOWN")) throw new Error("SCOPE_MISMATCH");
    if (!request.current()) return;
    if (readConversationPending(owner)?.operationId !== operation.operationId) { syncPending(); throw new Error("RECOVERY_OPERATION_CHANGED"); }
    setRuntimeEnabled(result.runtimeEnabled); setPendingState(result.operation?.state ?? "not_found");
    if (!result.operation) { setNotice("原 UUID 尚未查到；保留恢复记录，不自动创建新 UUID。可继续核对或永久取消。"); return; }
    const own = submitted.current;
    if (own?.operationId === operation.operationId && own.threadId === selectedId.current && own.revision === dirtyRevision.current && result.operation.state !== "canceled") {
      setMessage(""); clearFiles(); dirtyRevision.current++; submitted.current = null;
    }
    if (terminal(result.operation.state)) {
      ownStorage.current = true;
      try { await releaseConversationPending(owner, operation.operationId, request.signal); } finally { ownStorage.current = false; }
      if (!request.current()) return;
      setNotice(result.operation.state === "succeeded" ? "对话已完成；业务数据及长期规则没有自动修改。" : result.operation.state === "canceled" ? "服务端已确认取消原 UUID，保留未发送草稿。" : "原对话已确认失败；未自动重发，可检查原因后决定下一步。");
    } else if (result.operation.state === "unknown") setNotice("原模型请求结果未知；不会再次调用。请检查记录或取消原 UUID。");
    else setNotice(result.runtimeEnabled ? "原对话已持久保存，正在核对阶段状态。" : "原操作已保存，但执行开关关闭；不能据此判断工作进程正在运行。");
    if (selectedId.current === operation.threadId) void loadHistory(operation.threadId);
    void loadThreads();
  }
  async function recover(cancel = false) {
    if (!pending || storageError) return;
    let operation: ConversationPending | null;
    try { operation = readConversationPending(owner); } catch { syncPending(); return; }
    if (!operation || operation.operationId !== pending.operationId || cancel && cancelFor !== operation.operationId) { syncPending(); setCancelFor(null); return; }
    const request = beginAction(); if (!request) return;
    try {
      const input = AssistantConversationOperationInputSchema.parse({ ...scope, threadId: operation.threadId, operationId: operation.operationId });
      const raw = cancel ? await api.cancel.mutate(input) : await api.check.query(input, { signal: request.signal });
      if (request.current()) await acceptOperation(raw, operation, request);
    } catch (error) { if (request.current() && !quarantine(error)) { setPendingState(null); setCancelFor(null); setNotice("核对或取消未获得可验证回执；原 UUID 仍保留，不能重复发送。"); } }
    finally { request.done(); }
  }
  async function send() {
    if (fileBusy.current || !thread || thread.activeOperationId || options.status !== "ready" || !options.value.configuration || !options.value.capabilities.submit.available || !options.value.runtimeEnabled || !runtimeEnabled || storageError || createUnknown || !conversationLocksAvailable()) return;
    if (skillSlug && !options.value.skills.some(skill => skill.slug === skillSlug)) { setNotice("所选 Skill 已不在当前启用范围，请明确重新选择；草稿保留。"); return; }
    if (filesRef.current.length && !options.value.capabilities.upload.available) { setNotice("当前附件提交能力不可用，已保留草稿；没有生成新操作 UUID。"); return; }
    if (filesRef.current.some(file => file.previewUrl !== null) && options.value.configuration.vision !== true) { setNotice("当前模型视觉能力未确认，图片和消息草稿保留；没有生成新操作 UUID。"); return; }
    const request = beginAction(); if (!request) return;
    try {
      const configuration = options.value.configuration;
      const input = AssistantConversationSubmitInputSchema.parse({ ...scope, threadId: thread.threadId, operationId: crypto.randomUUID(), expectedThreadVersion: thread.version,
        expectedConfiguration: { revision: configuration.revision, hash: configuration.hash }, mode, selection: skillSlug ? { kind: "explicit", skillSlug } : { kind: "automatic" }, message, files: filesRef.current.map(({ name, base64 }) => ({ name, base64 })) });
      const operation: ConversationPending = { version: 1, userId: owner.userId, workspaceId: owner.workspaceId, agentKey: owner.agentKey, threadId: input.threadId, operationId: input.operationId, expectedThreadVersion: input.expectedThreadVersion, configurationRevision: configuration.revision };
      ownStorage.current = true;
      try { await reserveConversationPending(owner, operation, request.signal); } finally { ownStorage.current = false; }
      if (!request.current()) return;
      submitted.current = { operationId: operation.operationId, revision: dirtyRevision.current, threadId: input.threadId };
      const raw = await api.submit.mutate(input); if (request.current()) await acceptOperation(raw, operation, request);
    } catch (error) { if (request.current() && !quarantine(error)) { syncPending(); setPendingState(null); setNotice("未获得可验证的提交回执；草稿保留。如已生成原 UUID，只能核对或取消，不能换 UUID 重发。若还未提交，请检查消息与本机恢复记录。"); } }
    finally { request.done(); }
  }
  async function recoverHistoryMessage(operationId: string) {
    if (history?.status !== "ready" || storageError || fileBusy.current) return;
    const row = history.value.items.find(item => item.operationId === operationId);
    if (!row || row.configurationRevision === null || terminal(row.state)) return;
    const request = beginAction(); if (!request) return;
    try {
      const existing = readConversationPending(owner);
      if (existing && existing.operationId !== operationId) throw new Error("PENDING_OPERATION_EXISTS");
      if (!existing) {
        ownStorage.current = true;
        try { await reserveConversationPending(owner, { version: 1, userId: owner.userId, workspaceId: owner.workspaceId, agentKey: owner.agentKey, threadId: row.threadId, operationId, expectedThreadVersion: null, configurationRevision: row.configurationRevision }, request.signal); }
        finally { ownStorage.current = false; }
      }
      if (!request.current()) return;
      syncPending(); setPendingState(row.state); setCancelFor(null); setNotice("已选择服务器保存的原 UUID；可核对或取消，不会重新发送原消息。当前草稿仍保留。");
    } catch { if (request.current()) { syncPending(); setNotice("不能替换其他窗口尚未核对的原 UUID；请先处理现有恢复记录。"); } }
    finally { request.done(); }
  }
  async function createThread(retry = false) {
    if (pending || storageError || fileBusy.current || options.status !== "ready" || !options.value.capabilities.create.available || createUnknown && !retry) return;
    if (!retry && (message || files.length) && !window.confirm("创建新会话将丢弃当前未发送消息和附件，是否继续？")) return;
    const request = beginAction(); if (!request) return;
    try {
      const input = AssistantConversationCreateThreadInputSchema.parse({ ...scope, threadId: createUnknown?.threadId ?? crypto.randomUUID(), title: createUnknown?.title ?? title });
      setCreateUnknown({ threadId: input.threadId, title: input.title });
      const result = AssistantConversationThreadResultSchema.parse(await api.createThread.mutate(input));
      if (!request.current()) return; sameOwner(result.identity, owner);
      if (result.thread.threadId !== input.threadId || result.thread.title !== input.title) throw new Error("SCOPE_MISMATCH");
      setCreateUnknown(null); setTitle(""); setMessage(""); clearFiles(); dirtyRevision.current++; submitted.current = null;
      selectedId.current = result.thread.threadId; setThread(result.thread); void loadHistory(result.thread.threadId); void loadThreads(); setNotice("私有会话已创建；没有启动模型。");
    } catch (error) { if (request.current() && !quarantine(error)) setNotice("新会话创建结果尚未确认；保留同一会话 UUID，可显式核对或同 UUID 重试，不会调用模型。"); }
    finally { request.done(); }
  }
  async function checkCreatedThread() {
    if (!createUnknown) return;
    const request = beginAction(); if (!request) return;
    try {
      const result = checkedHistory(await api.history.query({ ...scope, threadId: createUnknown.threadId, limit: 10 }, { signal: request.signal }), owner, createUnknown.threadId);
      if (!request.current()) return;
      if (result.thread.title !== createUnknown.title) throw new Error("SCOPE_MISMATCH");
      selectedId.current = result.thread.threadId; setThread(result.thread); setHistory({ status: "ready", value: result }); setCreateUnknown(null); setTitle(""); setMessage(""); clearFiles(); dirtyRevision.current++; void loadThreads(); setNotice("已核对到原私有会话，没有重新创建或调用模型。");
    } catch (error) { if (request.current() && !quarantine(error)) setNotice("尚未核实新会话；可继续核对或显式使用同一会话 UUID 重试。不会自动新建其他会话。"); }
    finally { request.done(); }
  }
  async function pickFiles(incoming: File[]) {
    if (!incoming.length || fileBusy.current || lane.current.busy || pending || life.current.denied) return;
    const request = readLane(), revision = dirtyRevision.current; fileBusy.current = true; setReadingFiles(true);
    try {
      const next = await readConversationFiles(incoming, filesRef.current.length, request.signal);
      if (!request.current() || revision !== dirtyRevision.current) { disposeConversationFiles(next); return; }
      filesRef.current = [...filesRef.current, ...next]; setFiles(filesRef.current); dirtyRevision.current++;
    } catch (error) { if (request.current()) setNotice(error instanceof Error ? error.message : "附件读取失败，原草稿保留"); }
    finally { request.close(); if (request.current()) { fileBusy.current = false; setReadingFiles(false); } }
  }
  callbacks.current = { reload: () => { if (life.current.denied) return; void loadOptions(); void loadThreads(); if (selectedId.current) void loadHistory(selectedId.current); }, check: () => { void recover(); }, sync: syncPending };
  useEffect(() => {
    const current = life.current; current.active = true;
    const storage = (event: StorageEvent) => { if (event.key === null || event.key === storageKey) callbacks.current.sync(); };
    const ownEvent = (event: Event) => { if ((event as CustomEvent).detail === storageKey) callbacks.current.sync(); };
    callbacks.current.sync(); window.addEventListener("storage", storage); window.addEventListener(CONVERSATION_PENDING_EVENT, ownEvent);
    callbacks.current.reload();
    return () => { current.active = false; current.epoch++; for (const controller of current.controllers) controller.abort(); current.controllers.clear(); disposeConversationFiles(filesRef.current); window.removeEventListener("storage", storage); window.removeEventListener(CONVERSATION_PENDING_EVENT, ownEvent); };
    // Fixed owner is keyed by Controller. Never reuse a private cache across scopes.
  }, [api, storageKey]);
  useEffect(() => { onDirtyChange?.(dirty); return () => { onDirtyChange?.(false); }; }, [dirty, onDirtyChange]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard);
  }, []);
  useEffect(() => {
    if (!pending || !running(pendingState) || busy || !runtimeEnabled || denied) return;
    const timer = window.setTimeout(() => callbacks.current.check(), 3000); return () => window.clearTimeout(timer);
  }, [pending, pendingState, busy, runtimeEnabled, denied]);
  const optionView = options.status !== "ready" ? options : { status: "ready" as const, value: {
    title: options.value.configuration?.name ?? "对话与调教", model: options.value.configuration?.modelName ?? options.value.configuration?.modelSlug ?? null,
    configurationRevision: options.value.configuration?.revision ?? null,
    createAvailable: options.value.capabilities.create.available && !createUnknown,
    submitAvailable: options.value.capabilities.submit.available && runtimeEnabled && !createUnknown && (!skillSlug || options.value.skills.some(skill => skill.slug === skillSlug)) && (!files.some(file => file.previewUrl !== null) || options.value.configuration?.vision === true),
    cancelAvailable: options.value.capabilities.cancel.available,
    uploadAvailable: options.value.capabilities.upload.available,
    reason: reason(options.value.capabilities.submit.reasonCode) ?? (!options.value.runtimeEnabled ? "对话运行时开关未开启，不能认为工作进程正在运行。" : files.some(file => file.previewUrl !== null) && options.value.configuration?.vision !== true ? "当前模型视觉能力未确认，图片和消息草稿保留；请移除图片或更换已批准的视觉模型。" : null), skills: options.value.skills,
  } };
  const threadItems: ConversationReadView<ConversationThreadView[]> = threads.status !== "ready" ? threads : { status: "ready", value: thread && !threads.value.items.some(item => item.threadId === thread.threadId) ? [thread, ...threads.value.items] : threads.value.items };
  return <>
    {createUnknown && !denied && <aside className="min-w-0 space-y-2 rounded-lg border border-amber-500/30 p-3 text-sm text-amber-200" aria-label="新会话创建核对"><p className="break-all">新会话 UUID：{createUnknown.threadId}。此处仅创建私有会话，不调用模型。</p><button type="button" className="mr-3 rounded border p-2" disabled={busy} onClick={() => void checkCreatedThread()}>核对新会话</button><button type="button" className="rounded border p-2" disabled={busy || options.status !== "ready" || !options.value.capabilities.create.available} onClick={() => void createThread(true)}>同 UUID 重试创建会话</button></aside>}
    <AssistantConversationPanel options={optionView} threads={threadItems} nextThreadPage={threads.status === "ready" && threads.value.nextBeforeId !== null}
      selectedThread={thread} history={history?.status === "ready" ? { status: "ready", value: [...history.value.items].reverse().map(projectMessage) } : history}
      nextHistoryPage={history?.status === "ready" && history.value.nextBeforeSequence !== null} mode={mode} skillSlug={skillSlug} message={message} title={title}
      files={files} readingFiles={readingFiles} busy={busy} draftLocked={!!createUnknown} pending={pending} pendingState={pendingState} cancelAcknowledged={!!pending && cancelFor === pending.operationId}
      storageError={storageError} locksAvailable={conversationLocksAvailable()} notice={notice} denied={denied}
      onReload={() => callbacks.current.reload()} onSelectThread={selectThread} onLoadThreads={() => { if (threads.status === "ready" && threads.value.nextBeforeId !== null) void loadThreads(threads.value.nextBeforeId); }}
      onLoadHistory={() => { if (history?.status === "ready" && history.value.nextBeforeSequence !== null) void loadHistory(history.value.thread.threadId, history.value.nextBeforeSequence); }}
      onCreateThread={() => void createThread()} onTitle={value => { setTitle(value); dirtyRevision.current++; }} onMode={value => { setMode(value); dirtyRevision.current++; }} onSkill={value => { setSkillSlug(value); dirtyRevision.current++; }} onMessage={value => { setMessage(value); dirtyRevision.current++; }}
      onFiles={incoming => void pickFiles(incoming)} onRemoveFile={id => { const removed = filesRef.current.find(file => file.id === id); if (removed) disposeConversationFiles([removed]); filesRef.current = filesRef.current.filter(file => file.id !== id); setFiles(filesRef.current); dirtyRevision.current++; }}
      onSend={() => void send()} onCheck={() => void recover()} onCancel={() => void recover(true)} onCancelAcknowledged={value => setCancelFor(value ? pending?.operationId ?? null : null)} onRecoverMessage={id => void recoverHistoryMessage(id)} />
  </>;
}
export default function AssistantConversationBridge(props: AssistantConversationBridgeProps) {
  const client = trpc.useUtils().client;
  const api = useMemo(() => client.emperor.assistantConversations, [client]);
  const { onDirtyChange, ...owner } = props;
  return <AssistantConversationController owner={owner} api={api} onDirtyChange={onDirtyChange} />;
}
