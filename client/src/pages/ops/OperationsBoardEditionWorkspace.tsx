import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  OperationsBoardEditionStateInputSchema, OperationsBoardEditionStateResultSchema, OperationsBoardEditionReadInputSchema, OperationsBoardEditionReadResultSchema,
  OperationsBoardEditionHistoryInputSchema, OperationsBoardEditionHistoryResultSchema, OperationsBoardEditionPreviewInputSchema, OperationsBoardEditionPreviewResultSchema,
  OperationsBoardEditionExecuteInputSchema, OperationsBoardEditionSaveNoteInputSchema, OperationsBoardEditionWriteResultSchema,
  operationsBoardEditionCanonical, operationsBoardEditionRequestHash,
  type OperationsBoardEditionReadResult, type OperationsBoardEditionStateResult, type OperationsBoardEditionHistoryResult,
  type OperationsBoardEditionHistoryInput, type OperationsBoardEditionPreviewResult, type OperationsBoardEditionNote,
} from "@shared/operationsBoardEdition";
import { boardOperationContext, publishBoardEditionChange, subscribeBoardEditionChanges, type BoardOwner, type BoardScope } from "./operationsBoardEditionClientState";
import { useOperationsBoardOperation, boardErrorCode } from "./useOperationsBoardOperation";
import { BoardOperationRecovery } from "./OperationsBoardOperationRecovery";
import { OperationsBoardPartnerEditor } from "./OperationsBoardPartnerEditor";
import { subscribeMonthlyFinancialChanges } from "./monthlyFinancialWriteEvents";

export type OperationsBoardEditionWorkspaceProps = {
  owner: BoardOwner; scope: BoardScope;
  renderContent: (result: OperationsBoardEditionReadResult, renderNote: (parentAsin: string) => ReactNode) => ReactNode;
};
type NoteDraft = { editionId: number; parentAsin: string; text: string; original: string; editionVersion: number; sourceHash: string; noteVersion: number; canEdit: boolean };
const same = (left: unknown, right: unknown) => operationsBoardEditionCanonical(left) === operationsBoardEditionCanonical(right);
const buttonClass = "rounded border px-3 py-2 text-sm disabled:opacity-50";
const admin = (role: string) => role === "admin" || role === "super_admin";
const reasons: Record<string, string> = { writes_not_enabled: "功能写入开关尚未启用", admin_required: "此操作仅管理员可执行", access_denied: "当前权限不允许此操作", already_initialized: "已建立当前版本", not_initialized: "尚未初始化归档版本" };
const reasonText = (reason: string | null) => reasons[reason ?? ""] ?? reason ?? "未提供原因";
function useReadLane() {
  const lane = useRef({ sequence: 0, controller: null as AbortController | null });
  useEffect(() => () => { lane.current.sequence++; lane.current.controller?.abort(); }, []);
  const stop = () => { lane.current.sequence++; lane.current.controller?.abort(); lane.current.controller = null; };
  const start = () => { stop(); const controller = new AbortController(), sequence = lane.current.sequence; lane.current.controller = controller; return { controller, current: () => sequence === lane.current.sequence && !controller.signal.aborted }; };
  return { start, stop };
}

/** Default export additionally checks live identity and both directories. */
export function OperationsBoardEditionWorkspaceController({ owner, scope, renderContent }: OperationsBoardEditionWorkspaceProps) {
  const client = trpc.useUtils().client.operationsBoard, context = boardOperationContext(owner, scope);
  const input = { expectedWorkspaceId: owner.workspaceId, scope }, identity = context.identity;
  const [result, setResult] = useState<OperationsBoardEditionReadResult | null>(null), [state, setState] = useState<OperationsBoardEditionStateResult | null>(null);
  const [editionId, setEditionId] = useState<number | null>(null), [operatorId, setOperatorId] = useState<number | undefined>();
  const [directory, setDirectory] = useState<OperationsBoardEditionReadResult["ownership"]>(null);
  const [history, setHistory] = useState<OperationsBoardEditionHistoryResult | null>(null), [historyIndex, setHistoryIndex] = useState(0), [historyCursors, setHistoryCursors] = useState<OperationsBoardEditionHistoryInput["cursor"][]>([null]);
  const [preview, setPreview] = useState<OperationsBoardEditionPreviewResult | null>(null), [effectsConfirmed, setEffectsConfirmed] = useState(false);
  const [note, setNote] = useState<NoteDraft | null>(null), [needsReview, setNeedsReview] = useState(false), [clearConfirmed, setClearConfirmed] = useState(false);
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [partnersOpen, setPartnersOpen] = useState(false), [partnerDirty, setPartnerDirty] = useState(false), [partnerKey, setPartnerKey] = useState(0);
  const [navigation, setNavigation] = useState<{ run: () => void } | null>(null);
  const readLane = useReadLane(), ownNotice = useRef(false), dirty = !!note && note.text !== note.original || partnerDirty;
  function clearView() { readLane.stop(); setBusy(false); setResult(null); setState(null); setDirectory(null); setHistory(null); setHistoryIndex(0); setHistoryCursors([null]); setPreview(null); setEffectsConfirmed(false); setNeedsReview(true); }
  function denied() { clearView(); setNote(null); setPartnersOpen(false); setPartnerKey(value => value + 1); setPartnerDirty(false); }
  const operation = useOperationsBoardOperation({ context,
    accept(raw, pending) {
      const value = OperationsBoardEditionWriteResultSchema.parse(raw);
      if (!same(value.identity, identity) || !same(value.scope, { ...scope, workspaceId: owner.workspaceId }) || value.operationId !== pending.operationId
        || value.status === "committed" && (value.requestHash !== pending.requestHash || value.action !== pending.action
          || pending.action === "saveNote" && (value.editionId !== pending.editionId || value.parentAsin !== pending.parentAsin))) throw new Error("RECEIPT_CHANGED");
      return value;
    },
    recover: (pending, decision, signal) => client.recover.mutate({ ...input, operationId: pending.operationId, decision }, { signal }),
    onInvalidate: clearView, onDenied: denied,
    onCommitted: (pending, own) => {
      clearView(); if (own && pending.action === "saveNote" && note?.editionId === pending.editionId && note.parentAsin === pending.parentAsin) setNote(null);
      ownNotice.current = true;
      try { publishBoardEditionChange({ workspaceId: owner.workspaceId, scope, action: pending.action === "saveNote" ? "note" : "edition" }); } finally { ownNotice.current = false; }
    },
  });
  const latest = useRef({ clearView, operation }); latest.current = { clearView, operation };
  useEffect(() => {
    const changed = () => { latest.current.clearView(); latest.current.operation.invalidate(); setMessage("来源、版本、备注或搭档权限已变化，旧展示已清除。请重新读取；未提交草稿和原操作编号仍保留。"); };
    const stop = subscribeBoardEditionChanges(notice => { if (!ownNotice.current && notice.workspaceId === owner.workspaceId && (notice.scope === null || notice.scope.storeName === scope.storeName && notice.scope.country === scope.country)) changed(); });
    const stopFinancial = subscribeMonthlyFinancialChanges(notice => { if (notice.workspaceId === owner.workspaceId && notice.action !== "upload") changed(); });
    return () => { stop(); stopFinancial(); };
  }, [owner.workspaceId, scope.storeName, scope.country]);
  useEffect(() => {
    if (!dirty) return;
    const leaving = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", leaving); return () => window.removeEventListener("beforeunload", leaving);
  }, [dirty]);
  function navigate(run: () => void) { if (dirty) setNavigation({ run }); else run(); }
  function accept<T extends { identity: { userId: number; workspaceId: number }; request: unknown }>(value: T, request: unknown) { if (!same(value.identity, identity) || !same(value.request, request)) throw new Error("RESPONSE_CHANGED"); return value; }
  function readFailure(error: unknown) {
    clearView(); if (["FORBIDDEN", "UNAUTHORIZED"].includes(boardErrorCode(error))) denied();
    setMessage("读取失败或身份、范围、版本已变化，旧数据显示已清除；没有回退其他版本或补零。请显式重新读取。");
  }
  async function readSelected(selected = editionId, selectedOperator = operatorId) {
    clearView(); const work = readLane.start(); setBusy(true); setMessage("");
    try {
      const stateInput = OperationsBoardEditionStateInputSchema.parse(input), readInput = OperationsBoardEditionReadInputSchema.parse({ ...input, editionId: selected, ...(selectedOperator === undefined ? {} : { operatorId: selectedOperator }) });
      const [rawState, rawRead] = await Promise.all([client.state.query(stateInput, { signal: work.controller.signal }), client.read.query(readInput, { signal: work.controller.signal })]);
      if (!work.current()) return;
      const currentState = accept(OperationsBoardEditionStateResultSchema.parse(rawState), stateInput), value = accept(OperationsBoardEditionReadResultSchema.parse(rawRead), readInput);
      if (!same(value.state, currentState.state) || value.ownership && value.ownership.selectedOperatorId !== (selectedOperator ?? null)) throw new Error("VERSION_CHANGED");
      setState(currentState); setResult(value); setDirectory(value.ownership); setEditionId(selected); setOperatorId(selectedOperator);
      setNote(current => {
        if (!current) return null;
        const readable = value.edition?.id === current.editionId ? value.notes.find(item => item.parentAsin === current.parentAsin) : undefined;
        // A successful read can narrow row-level access without throwing FORBIDDEN.
        // Keep an unsent draft only while this exact edition/parent is still readable.
        return readable ? { ...current, canEdit: readable.canEdit } : null;
      });
      setNeedsReview(true); setClearConfirmed(false);
    } catch (error) { if (work.current()) readFailure(error); } finally { if (work.current()) setBusy(false); }
  }
  async function readHistory(cursor: OperationsBoardEditionHistoryInput["cursor"] = null, index = 0) {
    const previous = history, work = readLane.start(); setBusy(true); setHistory(null); setMessage("");
    try {
      const request = OperationsBoardEditionHistoryInputSchema.parse({ ...input, cursor, limit: 20 }), value = accept(OperationsBoardEditionHistoryResultSchema.parse(await client.history.query(request, { signal: work.controller.signal })), request);
      if (!work.current()) return;
      if (cursor && previous && value.historyVersion !== previous.historyVersion || result && !same(value.state, result.state)) throw new Error("HISTORY_CHANGED");
      setHistory(value); setHistoryIndex(index); if (cursor === null) setHistoryCursors([null]); else setHistoryCursors(old => [...old.slice(0, index), cursor]);
    } catch (error) { if (work.current()) readFailure(error); } finally { if (work.current()) setBusy(false); }
  }
  async function readPreview(action: "initialize" | "publishRevision", originalEditionId: number | null) {
    setPreview(null); setEffectsConfirmed(false); const work = readLane.start(); setBusy(true); setMessage("");
    try {
      const request = OperationsBoardEditionPreviewInputSchema.parse({ ...input, action, originalEditionId }), value = accept(OperationsBoardEditionPreviewResultSchema.parse(await client.preview.query(request, { signal: work.controller.signal })), request);
      if (work.current()) setPreview(value);
    } catch (error) { if (work.current()) readFailure(error); } finally { if (work.current()) setBusy(false); }
  }
  async function executePreview() {
    if (!preview?.capability.available || !effectsConfirmed || operation.pending || operation.busy || operation.storageError || busy) return;
    const request = OperationsBoardEditionExecuteInputSchema.parse({ ...preview.request, operationId: crypto.randomUUID(), expectedStateVersion: preview.state.version, expectedSourceHash: preview.sourceHash, expectedPreviewKey: preview.previewKey });
    await operation.submit({ version: 1, context, operationId: request.operationId, requestHash: operationsBoardEditionRequestHash(identity, request), action: request.action, editionId: request.originalEditionId, parentAsin: null }, signal => client.execute.mutate(request, { signal }));
  }
  function openNote(value: OperationsBoardEditionNote) {
    if (!result?.edition) return;
    const edition = result.edition;
    navigate(() => { setNote({ editionId: edition.id, parentAsin: value.parentAsin, text: value.note, original: value.note, editionVersion: edition.version, sourceHash: edition.sourceHash, noteVersion: value.version, canEdit: value.canEdit }); setNeedsReview(false); setClearConfirmed(false); });
  }
  const currentNote = note && result?.edition?.id === note.editionId ? result.notes.find(value => value.parentAsin === note.parentAsin) : undefined;
  function adoptNoteVersion() {
    if (!note || !currentNote || !result?.edition || !currentNote.canEdit || operation.pending) return;
    setNote({ ...note, original: currentNote.note, editionVersion: result.edition.version, sourceHash: result.edition.sourceHash, noteVersion: currentNote.version, canEdit: currentNote.canEdit }); setNeedsReview(false); setClearConfirmed(false);
  }
  async function saveNote() {
    if (!note || !result?.edition || !currentNote?.canEdit || needsReview || operation.pending || operation.busy || operation.storageError || busy || note.text === note.original || note.text === "" && !clearConfirmed) return;
    const checked = OperationsBoardEditionSaveNoteInputSchema.safeParse({ ...input, operationId: crypto.randomUUID(), editionId: note.editionId, parentAsin: note.parentAsin, note: note.text, expectedEditionVersion: note.editionVersion, expectedSourceHash: note.sourceHash, expectedNoteVersion: note.noteVersion });
    if (!checked.success) { setMessage("备注不能超过 3000 字，且必须绑定完整版本；没有截断或提交。"); return; }
    const request = checked.data;
    await operation.submit({ version: 1, context, operationId: request.operationId, requestHash: operationsBoardEditionRequestHash(identity, request), action: "saveNote", editionId: note.editionId, parentAsin: note.parentAsin }, signal => client.saveNote.mutate(request, { signal }));
  }
  function renderNote(parentAsin: string) {
    const found = result?.notes.find(value => value.parentAsin === parentAsin);
    return found ? <section aria-label={parentAsin + " 版本备注"} className="min-w-0 space-y-1"><p className="whitespace-pre-wrap break-words text-sm">{found.note || "尚未填写备注"}</p><button type="button" className={buttonClass} onClick={() => openNote(found)}>{found.canEdit ? "填写 / 编辑" : "查看备注"} · {parentAsin}</button></section> : <span className="text-sm">当前版本未返回此父体的授权备注，不补造空备注。</span>;
  }
  return <section aria-label="看板版本与协作工作区" className="manus-no-record min-w-0 max-w-full space-y-4 rounded border p-3">
    <header><h3 className="font-semibold">看板版本、备注与数字搭档</h3><p className="break-words text-sm">{scope.storeName} / {scope.country} · 工作区 {owner.workspaceId}。读取不会初始化归档、同步或调用模型。</p><p className="text-xs">财务按保存版本展示，负责人和搭档始终按当前授权核验；不是历史成员授权快照。</p></header>
    <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={busy || operation.busy} onClick={() => { navigate(() => { setNote(null); setEditionId(null); void readSelected(null); }); }}>读取当前看板版本</button><button type="button" className={buttonClass} disabled={busy || operation.busy} onClick={() => { void readHistory(); }}>读取归档历史</button>{editionId !== null && <button type="button" className={buttonClass} disabled={busy || operation.busy} onClick={() => navigate(() => { setNote(null); setEditionId(null); void readSelected(null); })}>返回当前看板</button>}
      {admin(owner.role) && <button type="button" className={buttonClass} onClick={() => navigate(() => { setPartnersOpen(value => !value); setPartnerDirty(false); setPartnerKey(value => value + 1); })}>{partnersOpen ? "收起" : "打开"}数字搭档管理</button>}
    </div>
    {busy && <p role="status">正在核验版本及当前授权…</p>}{message && <p role="alert">{message}</p>}
    <BoardOperationRecovery operation={operation} label="看板" />
    <label className="block min-w-0 text-sm">当前授权运营<select aria-label="版本看板运营" className="mt-1 w-full min-w-0 max-w-md rounded border bg-background p-2" value={operatorId ?? "all"} disabled={!directory || busy || operation.busy} onChange={event => { const selected = event.currentTarget.value === "all" ? undefined : Number(event.currentTarget.value); navigate(() => { clearView(); setNote(null); setOperatorId(selected); }); }}><option value="all">{!directory ? "授权目录待核验" : directory.visibility === "full" ? "全部授权运营" : directory.operators.some(item => item.relation === "direct_partner") ? "自己与已授权直接搭档" : "本人已授权范围"}</option>{operatorId !== undefined && !directory?.operators.some(item => item.userId === operatorId) && <option value={operatorId}>待重新核验 · ID {operatorId}</option>}{directory?.operators.map(item => <option key={item.userId} value={item.userId}>{item.displayName} · ID {item.userId} · {item.relation === "self" ? "本人" : item.relation === "direct_partner" ? "直接搭档（只读）" : "工作区负责人"}</option>)}</select></label>
    <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={busy || operation.busy} onClick={() => { void readSelected(); }}>读取所选版本与运营</button>{operatorId !== undefined && <button type="button" className={buttonClass} onClick={() => navigate(() => { clearView(); setNote(null); setOperatorId(undefined); })}>清除版本运营筛选</button>}</div>
    {result?.edition && <p className="rounded bg-muted p-3 text-sm">{result.edition.status === "archived" ? "历史归档（数据及备注只读）" : "当前看板"} · {result.edition.month} · {result.edition.kind === "original" ? "原版" : "修订版 " + result.edition.revision} · 版本 ID {result.edition.id} / v{result.edition.version} · {result.edition.archivedAt ? "归档 " + result.edition.archivedAt : "更新 " + result.edition.updatedAt}（原文时间，时区未声明）</p>}
    {result && !result.edition && <p role="status">{result.status === "uninitialized" ? "此店铺／站点尚未初始化版本；不会自动创建或伪造历史。" : "当前版本不可显示：" + reasonText(result.reasonCode)} 空状态不是零销量或利润。</p>}
    {result?.status === "current_empty" && <p role="alert">当前期有效来源已撤销／缺失。保留当前空状态，不自动退回上一期归档；已有历史仍可单独查看。</p>}
    {result?.edition && renderContent(result, renderNote)}
    {history && <section aria-label="月度归档版本" className="space-y-3"><h4 className="font-semibold">月度快照与修订（全部可分页）</h4><p className="text-xs">选择精确版本 ID；修订不覆盖原版、不复制旧备注，不补造启用前的过去版本。</p><div className="flex flex-wrap gap-2">{history.items.map(item => <button type="button" key={item.id} aria-pressed={editionId === item.id} className={buttonClass + " text-left"} disabled={busy || operation.busy} onClick={() => navigate(() => { setNote(null); setEditionId(item.id); void readSelected(item.id); })}>{item.month} · {item.kind === "original" ? "原版" : "修订 " + item.revision} · #{item.id}<span className="block text-xs">已归档 · {item.archivedAt}</span></button>)}</div>{!history.items.length && <p>此页没有当前授权的归档版本。</p>}<nav aria-label="归档版本分页" className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={busy || historyIndex === 0} onClick={() => { void readHistory(historyCursors[historyIndex - 1], historyIndex - 1); }}>归档上一页</button><span>第 {historyIndex + 1} 页</span><button type="button" className={buttonClass} disabled={busy || !history.page.hasMore} onClick={() => { void readHistory(history.page.nextCursor, historyIndex + 1); }}>归档下一页</button></nav></section>}
    {state && admin(owner.role) && <section aria-label="归档版本明确操作" className="space-y-2 rounded border p-3"><p className="text-sm">首次初始化：{state.capabilities.initialize.available ? "可先预览" : reasonText(state.capabilities.initialize.reasonCode)}。历史修订：{state.capabilities.publishRevision.available ? "可先预览" : reasonText(state.capabilities.publishRevision.reasonCode)}。</p><button type="button" className={buttonClass} disabled={!state.capabilities.initialize.available || busy || operation.busy || !!operation.pending} onClick={() => navigate(() => { void readPreview("initialize", null); })}>预览首次初始化</button>{result?.edition?.status === "archived" && result.edition.kind === "original" && <button type="button" className={buttonClass} disabled={!state.capabilities.publishRevision.available || busy || operation.busy || !!operation.pending} onClick={() => navigate(() => { void readPreview("publishRevision", result.edition!.id); })}>预览发布所选原版的修订</button>}</section>}
    {preview && <section aria-label="归档操作影响预览" className="space-y-2 rounded border border-amber-400 p-3"><h4 className="font-semibold">{preview.request.action === "initialize" ? "首次初始化" : "发布修订"} · {preview.targetMonth ?? "无可用月份"}</h4><p>本次来源 {preview.sourceRowCount ?? "未知"} 行；{preview.effects.movesCurrent ? "将建立当前版本指针" : "不移动当前版本指针"}；保留原版，不复制备注，不创建过去缺失版本。</p><p className="break-all text-xs">来源哈希：{preview.sourceHash ?? "不可用"} · 预览编号：{preview.previewKey ?? "不可用"}</p>{!preview.capability.available && <p role="alert">不可执行：{reasonText(preview.capability.reasonCode)}</p>}<label className="flex items-start gap-2"><input type="checkbox" checked={effectsConfirmed} onChange={event => setEffectsConfirmed(event.currentTarget.checked)} />我已核对范围、月份与全部影响，明确确认本次操作</label><button type="button" className={buttonClass} disabled={!preview.capability.available || !effectsConfirmed || busy || operation.busy || !!operation.pending || operation.storageError} onClick={() => { void executePreview(); }}>确认执行版本操作</button></section>}
    {partnersOpen && admin(owner.role) && <OperationsBoardPartnerEditor key={partnerKey} owner={owner} onDirtyChange={setPartnerDirty} />}
    <Dialog open={note !== null} onOpenChange={open => { if (!open) navigate(() => setNote(null)); }}><DialogContent className="manus-no-record grid min-w-0 max-w-[calc(100vw-2rem)] grid-cols-1 max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{note?.canEdit ? "填写利润变化原因" : "查看利润变化原因"}</DialogTitle><DialogDescription>{note?.parentAsin} · 版本 #{note?.editionId} · 备注 v{note?.noteVersion}。归档和仅搭档读取均不能编辑。</DialogDescription></DialogHeader>{note && <div className="min-w-0 space-y-3"><textarea aria-label="版本利润变化原因" className="w-full min-w-0 max-w-full rounded border bg-background p-2" value={note.text} maxLength={3000} rows={7} readOnly={!note.canEdit || !!operation.pending || operation.busy} onChange={event => { setNote({ ...note, text: event.currentTarget.value }); setClearConfirmed(false); }} /><p className="text-xs">{note.text.length} / 3000 字；原文展示，不执行链接或 HTML。</p>
      {needsReview && <section className="space-y-2 rounded border p-2"><p role="alert">当前来源／版本需重新核验，草稿未丢弃，不能直接保存。</p><button type="button" className={buttonClass} disabled={busy} onClick={() => { void readSelected(note.editionId); }}>读取当前版本对照（保留草稿）</button>{currentNote && <><p className="whitespace-pre-wrap break-words">服务器当前备注：{currentNote.note || "空备注"}</p><button type="button" className={buttonClass} disabled={!currentNote.canEdit || !!operation.pending || busy} onClick={adoptNoteVersion}>采用最新版本继续编辑（保留草稿正文）</button></>}</section>}
      {note.canEdit && note.text === "" && note.original !== "" && <label className="flex gap-2"><input type="checkbox" checked={clearConfirmed} onChange={event => setClearConfirmed(event.currentTarget.checked)} />确认明确清空此版本备注</label>}
      <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} onClick={() => navigate(() => setNote(null))}>关闭备注</button>{note.canEdit && <button type="button" className={buttonClass} disabled={!currentNote?.canEdit || needsReview || busy || operation.busy || !!operation.pending || operation.storageError || note.text === note.original || note.text === "" && !clearConfirmed} onClick={() => { void saveNote(); }}>保存版本备注</button>}</div><BoardOperationRecovery operation={operation} label="备注" /></div>}</DialogContent></Dialog>
    <Dialog open={navigation !== null} onOpenChange={open => { if (!open) setNavigation(null); }}><DialogContent className="min-w-0 max-w-[calc(100vw-2rem)] grid-cols-1 sm:max-w-lg"><DialogHeader><DialogTitle>保留未提交草稿？</DialogTitle><DialogDescription>切换或关闭将丢弃本页未提交备注／配对选择。已提交但未确认的操作编号不会删除。</DialogDescription></DialogHeader><div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} onClick={() => setNavigation(null)}>继续编辑，不切换</button><button type="button" className={buttonClass} onClick={() => { const run = navigation?.run; setNavigation(null); setNote(null); setPartnerKey(value => value + 1); setPartnerDirty(false); run?.(); }}>放弃未提交草稿并继续</button></div></DialogContent></Dialog>
  </section>;
}

export function OperationsBoardEditionWorkspace(props: OperationsBoardEditionWorkspaceProps) {
  const auth = useAuth(), permissions = usePermissions(), user = auth.user;
  const valid = OperationsBoardEditionStateInputSchema.safeParse({ expectedWorkspaceId: props.owner.workspaceId, scope: props.scope }).success;
  if (auth.loading || permissions.isLoading) return <p role="status">正在核验版本工作区身份与权限…</p>;
  if (auth.error || !user || !valid || user.id !== props.owner.userId || user.defaultWorkspaceId !== props.owner.workspaceId || user.role !== props.owner.role || !Number.isSafeInteger(user.id) || user.id <= 0 || user.id > 2_147_483_647 || !user.role?.trim()
    || !permissions.canRead("ops", "ops_dashboard") || !permissions.canRead("ops", "ops_data_import")) return <p role="alert">版本工作区身份或权限不可用，私有内容已隐藏；未决操作元数据仍按原身份保留。</p>;
  return <OperationsBoardEditionWorkspaceController key={JSON.stringify([props.owner, props.scope])} {...props} />;
}
export default OperationsBoardEditionWorkspace;
