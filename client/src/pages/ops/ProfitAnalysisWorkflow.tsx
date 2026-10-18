import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProfitAnalysisPreviewInputSchema, type ProfitAnalysisPreviewInput, type ProfitAnalysisScope } from "@shared/profitAnalysis";
import { ProfitAnalysisStartInputSchema, ProfitAnalysisSaveInputSchema } from "@shared/profitAnalysisWorkflow";
import { ProfitAnalysisWorkflowViewResultSchema, ProfitAnalysisWorkflowHistoryResultSchema, ProfitAnalysisWorkflowSaveResultSchema,
  ProfitAnalysisWorkflowCancelResultSchema, type ProfitAnalysisWorkflowViewResult, type ProfitAnalysisWorkflowHistoryResult,
  type ProfitAnalysisPublicRun } from "@shared/profitAnalysisWorkflowRead";
import { pendingOperationId, readProfitAnalysisPending, reserveProfitAnalysisPending, releaseProfitAnalysisPending,
  withProfitAnalysisPendingLock, subscribeProfitAnalysisPending, type ProfitAnalysisPending, type ProfitAnalysisPendingOwner } from "./profitAnalysisPending";
import { subscribeMonthlyFinancialChanges } from "./monthlyFinancialWriteEvents";
import ProfitAnalysisReportView from "./ProfitAnalysisReportView";
import ProfitAnalysisPreview from "./ProfitAnalysisPreview";

export type ProfitAnalysisWorkflowProps = { identity: ProfitAnalysisPendingOwner; scope: ProfitAnalysisScope; months: string[]; initialMonth?: string };
const button = "rounded border px-3 py-2 text-sm disabled:opacity-50";
const terminal = (run: ProfitAnalysisPublicRun | null) => run !== null && ["succeeded", "failed", "canceled"].includes(run.state);
const active = (run: ProfitAnalysisPublicRun | null) => run !== null && ["queued", "dispatched", "result_ready"].includes(run.state);
const states: Record<ProfitAnalysisPublicRun["state"], string> = { queued: "后台排队中", dispatched: "已发出模型请求", result_ready: "结果已持久保存，等待本地完成", succeeded: "生成完成", failed: "生成前失败", canceled: "已取消", unknown: "执行结果未知，禁止自动重试" };
const reasons: Record<string, string> = {
  EXECUTION_DISABLED: "利润生成开关或专属 worker 尚未启用", WRITES_DISABLED: "写入开关当前关闭", PERMISSION_DENIED: "当前没有生成或取消权限",
  SOURCE_BLOCKED: "两个月来源或币种尚不完整，不能生成", SOURCE_UNAVAILABLE: "青岛利润 Skill 的受审来源尚未接通", CONFIGURATION_UNAVAILABLE: "尚未配置可用的财务 Agent",
  RUN_ACTIVE: "已有后台生成任务，请先检查原任务", UNKNOWN_REQUIRES_CANCEL: "原任务结果未知，必须明确取消后才能重新生成", NOT_CHECKED: "请重新读取当前状态，核对生成资格",
  APPROVED_SKILL_CHANGED: "利润 Skill 已变化，需要重新核对受审来源", APPROVED_MODEL_CHANGED: "受审财务模型已变化", SOURCE_CHANGED: "月报来源已变化，请重新读取",
  REPORT_CONFLICT: "报告版本已变化，请重新读取后比较", MODEL_RESULT_UNKNOWN: "模型返回结果未知，不会自动再次调用", CONFIGURATION_NOT_EXECUTABLE: "财务配置当前不可执行",
};
const explain = (code: string | null) => code === null ? "" : reasons[code] ?? `当前条件未满足（${code}），请核对配置、来源和权限`;
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
async function saveRequestHash(pending: Extract<ProfitAnalysisPending, { kind: "save" }>) {
  const { request, identity } = pending, { scope, month, saveOperationId } = request;
  const bytes = new TextEncoder().encode(canonical({ identity, target: { scope, month }, saveOperationId, request }));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
}

function MonthWorkflow({ identity, input }: { identity: ProfitAnalysisPendingOwner; input: ProfitAnalysisPreviewInput }) {
  const api = trpc.useUtils().client.profitAnalysis;
  const [view, setView] = useState<ProfitAnalysisWorkflowViewResult | null>(null), [history, setHistory] = useState<ProfitAnalysisWorkflowHistoryResult[]>([]), [page, setPage] = useState(0);
  const [pending, setPending] = useState<ProfitAnalysisPending | null>(null), [storageError, setStorageError] = useState(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("请显式读取本月状态；页面不会自动生成或付费。"), [pollId, setPollId] = useState<string | null>(null);
  const [observedRunId, setObservedRunId] = useState<string | null>(null);
  const [regenerate, setRegenerate] = useState(false), [saveConfirmed, setSaveConfirmed] = useState(false), [cancelConfirmed, setCancelConfirmed] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ run: ProfitAnalysisPublicRun; label: string } | null>(null);
  const lane = useRef<{ id: number; controller: AbortController } | null>(null), sequence = useRef(0), alive = useRef(true), busyRef = useRef(false), ownStorage = useRef(false), pendingRef = useRef<ProfitAnalysisPending | null>(null);
  function abort() { sequence.current++; lane.current?.controller.abort(); lane.current = null; busyRef.current = false; setBusy(false); setPollId(null); }
  function clear(message: string) { abort(); setView(null); setHistory([]); setPage(0); setDetail(null); setRegenerate(false); setSaveConfirmed(false); setCancelConfirmed(null); setNotice(message); }
  function updatePending(value: ProfitAnalysisPending | null) { pendingRef.current = value; setPending(value); }
  function sync() {
    if (ownStorage.current || !alive.current) return;
    try {
      const value = readProfitAnalysisPending(identity, input), previous = pendingRef.current;
      if (!same(value, previous)) { clear("另一窗口的原操作记录已变化，旧展示已清除；请核对原 UUID 后继续。"); setObservedRunId(null); }
      updatePending(value); setStorageError(false);
    } catch { clear("本机恢复记录无法安全读取。未删除或覆盖记录；请先恢复存储访问。"); setStorageError(true); }
  }
  const mountedContext = useRef({ identity, input }), syncRef = useRef(sync), clearRef = useRef(clear);
  syncRef.current = sync; clearRef.current = clear;
  useEffect(() => {
    const { identity: owner, input: context } = mountedContext.current;
    alive.current = true; syncRef.current(); const unsubscribe = subscribeProfitAnalysisPending(owner, context, () => syncRef.current());
    return () => { alive.current = false; lane.current?.controller.abort(); unsubscribe(); };
  }, []);
  useEffect(() => subscribeMonthlyFinancialChanges(event => {
    if (event.workspaceId === identity.workspaceId && event.action !== "upload") clearRef.current("月报来源已变化，旧依据和保存资格已清除；原 UUID 保留，请显式重新读取或核对。");
  }), [identity.workspaceId]);
  function begin() {
    if (busyRef.current) return null;
    lane.current?.controller.abort(); const request = { id: ++sequence.current, controller: new AbortController() };
    lane.current = request; busyRef.current = true; setBusy(true); setPollId(null);
    return { ...request, current: () => alive.current && sequence.current === request.id && !request.controller.signal.aborted };
  }
  type Lane = NonNullable<ReturnType<typeof begin>>;
  function end(request: Lane) { if (request.current()) { lane.current = null; busyRef.current = false; setBusy(false); } }
  function failure(request: Lane) { if (request.current()) { setView(null); setHistory([]); setDetail(null); setSaveConfirmed(false); setRegenerate(false); setPollId(null); setNotice("操作返回未能安全核验，或权限、来源已变化。原 UUID 保留；请检查或明确取消，不能自动重新提交。"); } }
  function bind(result: { identity: ProfitAnalysisPendingOwner; request: ProfitAnalysisPreviewInput }) {
    if (!same(result.identity, identity) || !same({ expectedWorkspaceId: result.request.expectedWorkspaceId, scope: result.request.scope, month: result.request.month }, input)) throw new Error("PRIVATE_CONTEXT_CHANGED");
  }
  function persistedMatches(value: ProfitAnalysisPending | null) { return same(readProfitAnalysisPending(identity, input), value); }
  async function release(value: ProfitAnalysisPending, request: Lane) {
    await withProfitAnalysisPendingLock(identity, input, request.controller.signal, async () => {
      if (!request.current() || !persistedMatches(value)) throw new Error("PENDING_CHANGED");
      ownStorage.current = true;
      try { if (!releaseProfitAnalysisPending(identity, input, pendingOperationId(value))) throw new Error("PENDING_CHANGED"); updatePending(null); }
      finally { ownStorage.current = false; }
    });
  }
  async function reserve(value: ProfitAnalysisPending, request: Lane) {
    await withProfitAnalysisPendingLock(identity, input, request.controller.signal, async () => {
      if (!request.current() || readProfitAnalysisPending(identity, input) !== null) throw new Error("PENDING_EXISTS");
      ownStorage.current = true;
      try { reserveProfitAnalysisPending(identity, input, value); updatePending(value); }
      finally { ownStorage.current = false; }
    });
  }
  async function acceptView(raw: unknown, request: Lane, operation?: { id: string; pending: ProfitAnalysisPending | null }) {
    if (!request.current()) return;
    const result = ProfitAnalysisWorkflowViewResultSchema.parse(raw); bind(result);
    if (operation) {
      if (!persistedMatches(operation.pending)) throw new Error("PENDING_CHANGED");
      if (result.run && result.run.operationId !== operation.id) throw new Error("OPERATION_CHANGED");
      if (operation.pending?.kind === "generate" && result.run?.sourceHash !== null && result.run?.sourceHash !== undefined && result.run.sourceHash !== operation.pending.request.expectedSourceHash) throw new Error("SOURCE_BINDING_CHANGED");
      if (terminal(result.run) && operation.pending) await release(operation.pending, request);
    }
    if (!request.current()) return;
    setView(result); setSaveConfirmed(false); setRegenerate(false);
    if (result.run && !terminal(result.run)) setObservedRunId(previous => previous ?? result.run!.operationId);
    else if (result.run && terminal(result.run)) setObservedRunId(previous => previous === result.run!.operationId ? null : previous);
    if (active(result.run)) { if (!pendingRef.current || pendingRef.current.kind === "generate" && pendingRef.current.request.operationId === result.run!.operationId) setPollId(result.run!.operationId); setNotice("后台任务已确认；只轮询原 UUID，不重复发起生成。"); }
    else if (operation && !result.run) setNotice("服务器尚未找到原操作，不代表提交失败。UUID 已保留，请继续检查或明确取消。");
    else if (result.run?.state === "unknown") setNotice("原执行结果未知，可能已产生费用；请明确取消原任务后，再决定是否重新生成。");
    else setNotice("已读取当前状态。生成草稿与已保存结果分别保留；保存必须人工确认。");
  }
  async function read() {
    const request = begin(); if (!request) return;
    setView(null); setHistory([]); setPage(0); setDetail(null); setSaveConfirmed(false); setRegenerate(false);
    try { await acceptView(await api.options.query(input, { signal: request.controller.signal }), request); }
    catch { failure(request); } finally { end(request); }
  }
  async function start() {
    if (!view?.generation.available || !view.currentSourceHash || view.sourceStatus !== "ready" || pending || observedRunId || storageError || view.report?.activeOperationId || view.run?.state === "unknown" || view.report?.latestOperationId && !regenerate) return;
    const request = begin(); if (!request) return;
    try {
      const value: ProfitAnalysisPending = { version: 1, identity, kind: "generate", request: ProfitAnalysisStartInputSchema.parse({ ...input, operationId: crypto.randomUUID(), expectedReportVersion: view.report?.version ?? 0, expectedSourceHash: view.currentSourceHash, regenerateConfirmed: regenerate }) };
      await reserve(value, request); if (!request.current()) return;
      await acceptView(await api.start.mutate(value.request, { signal: request.controller.signal }), request, { id: pendingOperationId(value), pending: value });
    } catch { failure(request); sync(); } finally { end(request); }
  }
  async function acceptSave(raw: unknown, value: Extract<ProfitAnalysisPending, { kind: "save" }>, request: Lane) {
    if (!request.current()) return;
    const result = ProfitAnalysisWorkflowSaveResultSchema.parse(raw); bind(result);
    if (!persistedMatches(value) || result.request.saveOperationId !== value.request.saveOperationId) throw new Error("SAVE_CHANGED");
    if (result.receipt && (result.receipt.operationId !== value.request.runOperationId || result.receipt.sourceHash !== value.request.expectedSourceHash || result.receipt.resultHash !== value.request.expectedResultHash
      || result.receipt.reportVersion !== value.request.expectedReportVersion + 1 || result.receipt.requestHash !== await saveRequestHash(value))) throw new Error("SAVE_RECEIPT_CHANGED");
    if (!request.current()) return;
    if (result.status === "absent") { setNotice("尚未找到原保存回执，不代表未保存。请检查或取消原保存 UUID，不能再次提交。"); return; }
    await release(value, request); if (!request.current()) return;
    setView(null); setHistory([]); setDetail(null); setSaveConfirmed(false);
    setNotice(result.status === "committed" ? "人工保存已确认。请重新读取当前状态查看已保存结果；没有修改财务原始数据。" : "原保存操作已明确取消；原已保存结果不受影响，请重新读取。");
  }
  const draft = view?.draft ?? null;
  const canSave = Boolean(draft?.state === "succeeded" && draft.stale === false && draft.resultHash && draft.sourceHash && view?.currentSourceHash === draft.sourceHash && view.sourceStatus === "ready"
    && view.report && !view.report.activeOperationId && view.report.savedOperationId !== draft.operationId && !pending && !observedRunId && !storageError);
  async function save() {
    if (!canSave || !saveConfirmed || !draft || !view?.report) return;
    const request = begin(); if (!request) return;
    try {
      const value: Extract<ProfitAnalysisPending, { kind: "save" }> = { version: 1, identity, kind: "save", request: ProfitAnalysisSaveInputSchema.parse({ ...input, saveOperationId: crypto.randomUUID(), runOperationId: draft.operationId,
        expectedReportVersion: view.report.version, expectedResultHash: draft.resultHash, expectedSourceHash: draft.sourceHash }) };
      await saveRequestHash(value); if (!request.current()) return; // No send if exact receipt hashing is unavailable.
      await reserve(value, request); if (!request.current()) return;
      await acceptSave(await api.save.mutate(value.request, { signal: request.controller.signal }), value, request);
    } catch { failure(request); sync(); } finally { end(request); }
  }
  const recoverId = pending ? pendingOperationId(pending) : observedRunId;
  async function recover(cancel = false, explicitId?: string) {
    const value = pendingRef.current, id = explicitId ?? (value ? pendingOperationId(value) : recoverId);
    if (!id || cancel && cancelConfirmed !== id) return;
    const request = begin(); if (!request) return;
    try {
      if (!persistedMatches(value) || value && pendingOperationId(value) !== id) throw new Error("PENDING_CHANGED");
      if (value?.kind === "save") {
        const payload = { ...input, saveOperationId: id };
        await acceptSave(cancel ? await api.cancelSave.mutate(payload, { signal: request.controller.signal }) : await api.checkSave.query(payload, { signal: request.controller.signal }), value, request);
      } else {
        const payload = { ...input, operationId: id };
        if (!cancel) await acceptView(await api.check.query(payload, { signal: request.controller.signal }), request, { id, pending: value });
        else {
          const result = ProfitAnalysisWorkflowCancelResultSchema.parse(await api.cancel.mutate(payload, { signal: request.controller.signal }));
          if (!request.current()) return; bind(result);
          if (!persistedMatches(value) || result.operationId !== id || result.request.operationId !== id) throw new Error("OPERATION_CHANGED");
          if (["canceled", "succeeded", "failed"].includes(result.state)) {
            if (value) await release(value, request); if (!request.current()) return;
            setObservedRunId(null);
            setView(null); setHistory([]); setDetail(null); setSaveConfirmed(false); setRegenerate(false);
            setNotice(result.state === "canceled" ? "原生成任务已明确取消。历史已保存报告不受影响；请重新读取后决定是否生成。" : "原任务已经终结，取消未改变其结果。请重新读取核对。");
          } else setNotice("取消尚未取得可核验终态，原 UUID 仍保留；请继续检查，不要重复生成。");
        }
      }
    } catch { failure(request); sync(); } finally { if (request.current()) setCancelConfirmed(null); end(request); }
  }
  const recoverRef = useRef(recover); recoverRef.current = recover;
  useEffect(() => { if (!pollId || busy) return; const timer = setTimeout(() => { void recoverRef.current(false, pollId); }, 3000); return () => clearTimeout(timer); }, [pollId, busy]);
  async function loadHistory(next = false) {
    const previous = next ? history.at(-1) : undefined, beforeId = previous?.nextBeforeId ?? undefined;
    if (next && !beforeId) return;
    const request = begin(); if (!request) return;
    try {
      const result = ProfitAnalysisWorkflowHistoryResultSchema.parse(await api.history.query({ ...input, limit: 10, ...(beforeId === undefined ? {} : { beforeId }) }, { signal: request.controller.signal }));
      if (!request.current()) return; bind(result);
      if (result.items.length > 10 || beforeId !== undefined && result.nextBeforeId !== null && result.nextBeforeId >= beforeId
        || next && result.items.some(item => history.some(page => page.items.some(old => old.operationId === item.operationId)))) throw new Error("HISTORY_PAGE_CHANGED");
      const pages = next ? [...history, result] : [result]; setHistory(pages); setPage(pages.length - 1); setNotice("历史按所选月份逐页读取；未截断旧记录，月报变化后请重新读取。");
      if (active(view?.run ?? null)) setPollId(view!.run!.operationId);
    } catch { failure(request); } finally { end(request); }
  }
  function card(run: ProfitAnalysisPublicRun | null, label: string) {
    return <section className="min-w-0 rounded border p-3" aria-label={label}><h5 className="font-medium">{label}</h5>{!run ? <p>当前没有{label}；不代表利润为零。</p> : <>
      <p>{states[run.state]} · {run.updatedAt}</p>{run.stale !== false && <p role="status">来源已变化或暂无法核验；此结果不能作为当前草稿保存。</p>}
      <p>严重程度：{run.result?.severity ?? "无模型评级"}；{run.result?.modelCalled ? "模型选择证据" : "未调用模型的确定性结果"}</p>
      <button type="button" className={button} onClick={() => setDetail({ run, label })}>查看{label}完整结果</button>
    </>}</section>;
  }
  return <section aria-label="利润分析生成与人工保存" className="manus-no-record min-w-0 max-w-full space-y-3 rounded border p-3">
    <h4 className="font-semibold">{input.month} 利润分析</h4>
    <p className="break-words text-sm">{input.scope.storeName} / {input.scope.country} / {input.scope.parentAsin} / {input.scope.currency ?? "币种未知"} / {input.scope.basis === "child_rows" ? "子体原行汇总" : "原报表父体合计"}</p>
    <p className="text-xs">结果仅属于当前账号与工作区。分析读取完整授权双月来源，不使用图表或分页行拼接；生成不等于人工保存，也不改财务原表。读取结果为当时快照。</p>
    <details className="min-w-0"><summary className="cursor-pointer">查看双月分析依据</summary><ProfitAnalysisPreview key={input.month} identity={identity} scope={input.scope} months={[input.month]} /></details>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={() => { void read(); }}>读取本月分析状态</button><button type="button" className={button} onClick={() => clear("私有展示已清除；未取消后台操作，原 UUID 恢复记录保留。")}>清除分析展示</button><button type="button" className={button} disabled={busy} onClick={() => { void loadHistory(); }}>读取本月全部历史</button></div>
    <p role="status" className="break-words text-sm">{busy ? "正在核验当前范围与原操作…" : notice}</p>
    {storageError && <p role="alert">恢复存储不可用；无法安全发起新操作。未删除原记录。</p>}
    {recoverId && <section className="min-w-0 space-y-2 rounded border border-amber-500 p-3" aria-label="原操作恢复">
      <p className="break-all">原{pending?.kind === "save" ? "保存" : "生成"}操作 UUID：{recoverId}</p><p>未知、查无记录和超时均不代表未执行。只检查或取消这个 UUID，不自动重新提交。</p>
      {!pending && <p className="text-xs">此 UUID 来自已核验的服务器任务；重新打开页面时请读取本月状态找回，不伪造本机提交记录。</p>}
      <button type="button" className={button} disabled={busy} onClick={() => { void recover(); }}>检查原操作</button>
      <label className="flex items-start gap-2"><input type="checkbox" checked={cancelConfirmed === recoverId} onChange={event => setCancelConfirmed(event.currentTarget.checked ? recoverId : null)} />我确认取消此原操作；已发生的模型费用无法撤回，已保存报告不被删除</label>
      <button type="button" className={button} disabled={busy || cancelConfirmed !== recoverId} onClick={() => { void recover(true); }}>明确取消原操作</button>
    </section>}
    {view && <>
      <p>来源：{view.sourceStatus === "ready" ? "双月来源已核验" : view.sourceStatus === "blocked" ? "来源不完整或币种未核验" : "来源当前不可读取"}；报告版本 {view.report?.version ?? 0}。</p>
      {!view.generation.available && <p role="status">暂不可生成：{explain(view.generation.reasonCode)}</p>}
      {view.run && <p>当前生成任务：{states[view.run.state]}{view.run.errorCode ? `；${explain(view.run.errorCode)}` : ""}</p>}
      {view.report?.latestOperationId && <label className="flex items-start gap-2"><input type="checkbox" checked={regenerate} onChange={event => setRegenerate(event.currentTarget.checked)} />我确认重新生成，可能新增一次模型费用；旧已保存结果继续保留</label>}
      <button type="button" className={button} disabled={busy || !!pending || !!observedRunId || storageError || !view.generation.available || !!view.report?.latestOperationId && !regenerate} onClick={() => { void start(); }}>{view.report?.latestOperationId ? "确认重新生成本月草稿" : "生成本月分析草稿"}</button>
      <p className="text-xs">{view.generation.modelRequired === false ? "当前无需模型：没有可比较变化时，仅生成明确的确定性结果，不表示业务正常。" : "仅点击生成才提交专属后台任务；实际模型、青岛利润 Skill 和权限仍由服务器核验。"}</p>
      <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">{card(view.draft, "生成草稿")}{card(view.saved, "已保存报告")}</div>
      <label className="flex items-start gap-2"><input type="checkbox" checked={saveConfirmed} disabled={!canSave || busy} onChange={event => setSaveConfirmed(event.currentTarget.checked)} />我已阅读完整草稿，确认人工保存为本月报告</label>
      <button type="button" className={button} disabled={busy || !canSave || !saveConfirmed} onClick={() => { void save(); }}>人工保存本月报告</button>
      <p className="text-xs">生成资格不代表保存权限；保存还需服务器当前权限与来源 / 结果 / 报告版本核验。来源过期的草稿不可保存。</p>
    </>}
    {history[page] && <section aria-label="本月生成历史" className="min-w-0 space-y-2"><h5>本月生成历史 · 第 {page + 1} 页</h5>
      {!history[page].items.length && <p>当前页没有历史记录；不会把缺失当作已生成。</p>}
      <ul className="space-y-2">{history[page].items.map(run => <li key={run.operationId} className="min-w-0 rounded border p-2"><p className="break-all">{run.createdAt} · {states[run.state]} · {run.operationId}</p>{run.state === "succeeded" && <button type="button" className={button} onClick={() => setDetail({ run, label: "历史报告" })}>查看历史完整结果</button>}{run.errorCode && <p>{explain(run.errorCode)}</p>}</li>)}</ul>
      <nav aria-label="利润报告历史分页" className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || page === 0} onClick={() => setPage(page - 1)}>历史上一页</button><button type="button" className={button} disabled={busy || page === history.length - 1 && history[page].nextBeforeId === null} onClick={() => { if (page < history.length - 1) setPage(page + 1); else void loadHistory(true); }}>历史下一页</button></nav>
    </section>}
    <Dialog open={detail !== null} onOpenChange={open => { if (!open) setDetail(null); }}><DialogContent className="min-w-0 w-[calc(100%-2rem)] max-w-6xl max-h-[85dvh] overflow-y-auto [grid-template-columns:minmax(0,1fr)]"><DialogHeader className="min-w-0"><DialogTitle>{input.month} · {detail?.label ?? "完整报告"}</DialogTitle><DialogDescription>完整证据、来源与覆盖情况；模型解释不表示已证明因果。</DialogDescription></DialogHeader>{detail && <ProfitAnalysisReportView run={detail.run} label={detail.label} />}</DialogContent></Dialog>
  </section>;
}
function WorkflowScope({ identity, scope, months, initialMonth }: ProfitAnalysisWorkflowProps) {
  const [month, setMonth] = useState(initialMonth ?? months.at(-1) ?? "");
  const parsed = ProfitAnalysisPreviewInputSchema.safeParse({ expectedWorkspaceId: identity.workspaceId, scope, month });
  return <div className="min-w-0 max-w-full space-y-3"><nav aria-label="利润分析月份快捷选择" className="flex flex-wrap gap-2">{[...new Set(months)].map(value => <button type="button" key={value} aria-pressed={month === value} className={button} onClick={() => setMonth(value)}>{value}</button>)}</nav>
    <label className="flex min-w-0 flex-wrap items-center gap-2">分析月份（可选择更早月份）<input aria-label="利润报告月份" type="month" className="min-w-0 max-w-full rounded border p-2" value={month} onChange={event => setMonth(event.currentTarget.value)} /></label>
    {parsed.success ? <MonthWorkflow key={canonical(parsed.data)} identity={identity} input={parsed.data} /> : <p role="alert">请选择有效月份及产品范围；尚未发起请求。</p>}
  </div>;
}
/** Real controller for isolated synthetic browser acceptance; no query on mount. */
export function ProfitAnalysisWorkflowController(props: ProfitAnalysisWorkflowProps) { return <WorkflowScope key={canonical(props)} {...props} />; }
export default function ProfitAnalysisWorkflow(props: ProfitAnalysisWorkflowProps) {
  const auth = useAuth(), permissions = usePermissions(), user = auth.user;
  if (auth.loading || permissions.isLoading) return <p role="status">正在核验利润报告读取权限…</p>;
  if (auth.error || !user || user.id !== props.identity.userId || user.defaultWorkspaceId !== props.identity.workspaceId || !permissions.canRead("ops", "ops_dashboard") || !permissions.canRead("ops", "ops_profit")) return <p role="alert">当前没有此私有利润报告的读取权限；旧展示已清除。</p>;
  return <ProfitAnalysisWorkflowController key={canonical([props, user.role])} {...props} />;
}
