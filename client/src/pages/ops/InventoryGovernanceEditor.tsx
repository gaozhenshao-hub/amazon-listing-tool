import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InventoryGovernanceReadInputSchema, InventoryGovernanceReadResultSchema, InventoryGovernanceExecuteInputSchema, InventoryGovernanceRecoverInputSchema, InventoryGovernanceWriteResultSchema, InventoryGovernanceSubjectSchema, type InventoryGovernanceReadResult, type InventoryGovernanceExecuteInput, type InventoryGovernanceCandidate } from "@shared/inventoryGovernanceWrite";

export type InventoryGovernanceEditorOwner = { userId: number; workspaceId: number; role: string };
type OwnerScope = { parentAsin: string; storeName: string; country: string };
type Subject = { kind: "owners" } | { kind: "lifecycle"; scope: { asin: string; storeName: string; country: string } };
type SourceHint = { scope: OwnerScope; childAsins: string[]; productNames: string[]; externalOperators: string[] };
export type InventoryGovernanceEditorTarget = { owner: InventoryGovernanceEditorOwner; subject: Subject; initialSelection?: OwnerScope[]; sourceHints?: SourceHint[] };
const buttonClass = "min-h-10 rounded border px-3 py-2 text-sm disabled:opacity-50";
const inputClass = "mt-1 block w-full min-w-0 max-w-full rounded border bg-background p-2 text-sm";
const manager = (role: string) => ["admin", "super_admin", "ops_manager"].includes(role);
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const ownerKey = (owner: InventoryGovernanceEditorOwner) => JSON.stringify([owner.userId, owner.workspaceId, owner.role]);
const scopeKey = (scope: OwnerScope) => JSON.stringify([scope.parentAsin, scope.storeName, scope.country]);
const scopeLabel = (scope: OwnerScope) => `${scope.parentAsin} · ${scope.storeName} · ${scope.country}`;
const subjectKey = (subject: Subject) => subject.kind === "owners" ? "owners" : JSON.stringify(["lifecycle", subject.scope.asin, subject.scope.storeName, subject.scope.country]);
type OwnerData = { scopes: OwnerScope[]; candidates: InventoryGovernanceCandidate[]; members: { id: number; name: string; role: string }[]; rules: (OwnerScope & { id: number; assigneeUserId: number; assigneeName: string; isActive: number })[] };
type OwnerDraft = { selected: OwnerScope[]; assignee: string; reason: string; revokeId: number | null; revokeAcknowledged: boolean };
const emptyDraft = (): OwnerDraft => ({ selected: [], assignee: "", reason: "", revokeId: null, revokeAcknowledged: false });
function Pager({ page, total, label, onChange }: { page: number; total: number; label: string; onChange: (page: number) => void }) {
  return <div className="flex flex-wrap items-center gap-2 text-xs"><button className={buttonClass} disabled={page === 0} onClick={() => onChange(page - 1)}>{label}上一页</button><span>第 {page + 1} / {Math.max(1, Math.ceil(total / 25))} 页，全部 {total} 条</span><button className={buttonClass} disabled={(page + 1) * 25 >= total} onClick={() => onChange(page + 1)}>{label}下一页</button></div>;
}
function OwnerFields({ data, draft, hints, disabled, onChange, onAssign, onRevoke, canAssign, canRevoke }: { data: OwnerData; draft: OwnerDraft; hints: SourceHint[]; disabled: boolean; onChange: (draft: OwnerDraft) => void; onAssign: () => void; onRevoke: () => void; canAssign: boolean; canRevoke: boolean }) {
  const [search, setSearch] = useState(""), [onlyHints, setOnlyHints] = useState(hints.length > 0), [sourcePage, setSourcePage] = useState(0), [rulePage, setRulePage] = useState(0), [ruleStatus, setRuleStatus] = useState("all");
  const hintMap = new Map(hints.map(hint => [scopeKey(hint.scope), hint])), scopeMap = new Map(data.scopes.map(scope => [scopeKey(scope), scope])), candidates = new Map(data.candidates.map(candidate => [scopeKey(candidate.scope), candidate]));
  const selected = new Set(draft.selected.map(scopeKey));
  const sources = data.scopes.filter(scope => {
    const candidate = candidates.get(scopeKey(scope));
    const text = [scopeLabel(scope), ...(candidate?.productNames ?? []), ...(candidate?.childAsins ?? []), ...(candidate?.externalOperators ?? []), ...(hintMap.get(scopeKey(scope))?.productNames ?? [])].join(" ").toLocaleLowerCase();
    return (!onlyHints || hintMap.has(scopeKey(scope))) && (!search || text.includes(search.toLocaleLowerCase()));
  });
  const rules = data.rules.filter(rule => ruleStatus === "all" || (ruleStatus === "active" ? rule.isActive === 1 : rule.isActive !== 1));
  const missing = draft.selected.filter(scope => !scopeMap.has(scopeKey(scope))), selectedRule = data.rules.find(rule => rule.id === draft.revokeId);
  const unavailableMember = draft.assignee && !data.members.some(member => String(member.id) === draft.assignee);
  useEffect(() => { setSourcePage(0); }, [search, onlyHints, data]);
  useEffect(() => { setRulePage(0); }, [ruleStatus, data]);
  return <div className="min-w-0 space-y-4">
    <p className="rounded border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">人工库存规则 → 设置页已确认的领星名称映射 → 产品主档 → 历史周报 → 未映射。撤销仅停用规则，保留原记录；重新启用复用原 ID。产品主档负责人仍由原入口独立管理。</p>
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-sm">搜索当前可信范围<input aria-label="搜索当前可信范围" className={inputClass} value={search} onChange={event => setSearch(event.currentTarget.value)} /></label>{hints.length > 0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyHints} onChange={event => setOnlyHints(event.currentTarget.checked)} />只看原页面待分配提示</label>}</div>
      {hints.length > 0 && <p className="text-xs text-muted-foreground">页面提示含 {hints.length} 个分组，仅用于定位、品名和子体说明；可选范围与人员均以本次服务端读取为准，不凭外部姓名授权。</p>}
      <div className="flex flex-wrap items-center gap-2 text-sm"><span>当前可信范围 {sources.length} / {data.scopes.length}，已选择 {draft.selected.length}，单批最多 500 个</span><button className={buttonClass} disabled={sources.length === 0 || new Set([...selected, ...sources.map(scopeKey)]).size > 500} onClick={() => onChange({ ...draft, selected: [...new Map([...draft.selected, ...sources].map(scope => [scopeKey(scope), scope])).values()] })}>选择全部筛选范围（跨页）</button><button className={buttonClass} onClick={() => onChange({ ...draft, selected: [] })}>清空范围选择</button></div>
      {sources.length > 500 && <p className="text-amber-700 text-xs">筛选结果超过 500 个，请缩小范围或逐项选择；不会静默只提交前 500 个。</p>}
      {missing.length > 0 && <p role="alert">草稿中 {missing.length} 个范围已不在当前可信来源中，原选择未自动删除，必须明确清空 / 重新选择后才能提交。</p>}
      <div role="region" aria-label="可信负责人范围列表" tabIndex={0} className="max-h-80 min-w-0 overflow-auto rounded border"><div className="min-w-[520px] divide-y">{sources.slice(sourcePage * 25, sourcePage * 25 + 25).map(scope => {
        const key = scopeKey(scope), hint = hintMap.get(key), current = data.rules.find(rule => scopeKey(rule) === key), candidate = candidates.get(key)!;
        return <label key={key} className="flex items-start gap-3 p-3 text-xs"><input aria-label={`选择 ${scopeLabel(scope)}`} type="checkbox" checked={selected.has(key)} disabled={!selected.has(key) && selected.size >= 500} onChange={event => onChange({ ...draft, selected: event.currentTarget.checked ? [...draft.selected, scope] : draft.selected.filter(value => scopeKey(value) !== key) })} /><span className="min-w-0 break-words"><b>{scopeLabel(scope)}</b><span className="block">{current ? `规则 #${current.id} · ${current.isActive === 1 ? "生效" : "已停用，可重新启用"} · ${current.assigneeName}（用户 #${current.assigneeUserId}）` : "未建立人工规则"}</span><span className="block">本次来源：{candidate.sourceKinds.join(" / ")} · {candidate.sourceCount} 行 · 最新 {candidate.latestDate} · {candidate.childAsins.length} 子体 · {candidate.productNames.join(" / ")} · {candidate.childAsins.join(" / ")}{candidate.externalOperators.length ? ` · 外部原文姓名（非授权）${candidate.externalOperators.join(" / ")}` : ""}</span>{hint && <span className="block text-muted-foreground">页面待分配提示：{hint.childAsins.length} 子体 · {hint.productNames.join(" / ")}</span>}</span></label>;
      })}{sources.length === 0 && <p className="p-4 text-sm">此筛选下没有当前可信范围。</p>}</div></div><Pager page={sourcePage} total={sources.length} label="范围" onChange={setSourcePage} />
      <details><summary className="text-sm">完整已选范围（{draft.selected.length}）</summary><ul className="max-h-48 overflow-auto text-xs">{draft.selected.map(scope => <li key={scopeKey(scope)} className="break-words">{scopeLabel(scope)}</li>)}</ul></details>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2"><label className="min-w-0 text-sm">指定当前有效系统负责人<select aria-label="指定当前有效系统负责人" className={inputClass} value={draft.assignee} onChange={event => onChange({ ...draft, assignee: event.currentTarget.value })}><option value="">请选择数字身份</option>{unavailableMember && <option value={draft.assignee}>原用户 #{draft.assignee} 已不在当前有效候选中</option>}{data.members.map(member => <option key={member.id} value={String(member.id)}>{member.name} · 用户 #{member.id} · {member.role}</option>)}</select></label><label className="min-w-0 text-sm">操作说明（可选，最多 500 字）<textarea aria-label="负责人操作说明" className={inputClass} value={draft.reason} onChange={event => onChange({ ...draft, reason: event.currentTarget.value })} /></label></div>
      <button className={buttonClass} disabled={!canAssign || draft.selected.length === 0 || draft.selected.length > 500 || missing.length > 0 || !draft.assignee || !!unavailableMember} onClick={onAssign}>确认分配 / 替换 / 重新启用 {draft.selected.length} 个范围</button>
      <section className="min-w-0 space-y-2 border-t pt-3"><h3 className="font-medium">全部人工规则（含已停用历史）</h3><label className="text-sm">规则状态<select aria-label="规则状态" className={inputClass} value={ruleStatus} onChange={event => setRuleStatus(event.currentTarget.value)}><option value="all">全部状态</option><option value="active">生效</option><option value="inactive">已停用</option></select></label><div role="region" aria-label="负责人规则列表" tabIndex={0} className="max-h-72 min-w-0 overflow-auto rounded border"><div className="min-w-[520px] divide-y">{rules.slice(rulePage * 25, rulePage * 25 + 25).map(rule => <div key={rule.id} className="space-y-2 p-3 text-xs"><p>规则 #{rule.id} · {scopeLabel(rule)} · {rule.assigneeName}（用户 #{rule.assigneeUserId}） · {rule.isActive === 1 ? "生效" : "已停用"}</p><details><summary>完整规则原值</summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify(rule, null, 2)}</pre></details>{rule.isActive === 1 ? <button className={buttonClass} disabled={!canRevoke} onClick={() => onChange({ ...draft, revokeId: rule.id, revokeAcknowledged: false })}>选择撤销规则 #{rule.id}</button> : <button className={buttonClass} disabled={!canAssign || !scopeMap.has(scopeKey(rule))} onClick={() => onChange({ ...draft, selected: [scopeMap.get(scopeKey(rule))!], assignee: data.members.some(member => member.id === rule.assigneeUserId) ? String(rule.assigneeUserId) : "", revokeId: null, revokeAcknowledged: false })}>重新启用规则 #{rule.id}（先核对负责人）</button>}</div>)}{rules.length === 0 && <p className="p-4 text-sm">此筛选下没有人工规则，不代表其他状态不存在。</p>}</div></div><Pager page={rulePage} total={rules.length} label="规则" onChange={setRulePage} /></section>
      {draft.revokeId !== null && <section className="space-y-2 rounded border border-amber-300 p-3 text-sm"><p>待撤销规则 #{draft.revokeId}：{selectedRule ? scopeLabel(selectedRule) : "已不在当前规则中，无法撤销"}</p><p>撤销后将回退到可验证的领星映射、产品主档、周报或未映射；不是删除历史。</p><label className="flex items-center gap-2"><input type="checkbox" checked={draft.revokeAcknowledged} onChange={event => onChange({ ...draft, revokeAcknowledged: event.currentTarget.checked })} />确认撤销上述精确规则</label><button className={buttonClass} disabled={!canRevoke || !draft.revokeAcknowledged || selectedRule?.isActive !== 1} onClick={onRevoke}>确认撤销负责人规则</button></section>}
    </fieldset>
  </div>;
}
const PendingSchema = z.object({ version: z.literal(1), userId: z.number().int().positive().max(2147483647), workspaceId: z.number().int().positive().max(2147483647), operationId: z.string().uuid(), subject: InventoryGovernanceSubjectSchema, action: z.enum(["assign", "revoke", "restore"]), expectedSnapshotKey: z.string().regex(/^[a-f0-9]{64}$/u), targetCount: z.number().int().min(1).max(500) }).strict().refine(value => (value.action === "restore") === (value.subject.kind === "lifecycle") && (value.action === "assign" || value.targetCount === 1));
type Pending = z.infer<typeof PendingSchema>;
const pendingKey = (owner: InventoryGovernanceEditorOwner) => `inventory-governance-write:v1:${owner.userId}:${owner.workspaceId}`;
const pendingListeners = new Set<() => void>();
const locksAvailable = () => typeof navigator !== "undefined" && typeof navigator.locks?.request === "function";
export function readInventoryGovernancePending(owner: InventoryGovernanceEditorOwner): Pending | null {
  const raw = localStorage.getItem(pendingKey(owner)); if (raw === null) return null;
  if (raw.length > 4096) throw new Error("RECOVERY_METADATA_INVALID");
  const result = PendingSchema.parse(JSON.parse(raw)); if (result.userId !== owner.userId || result.workspaceId !== owner.workspaceId) throw new Error("RECOVERY_IDENTITY_MISMATCH"); return result;
}
async function locked<T>(owner: InventoryGovernanceEditorOwner, signal: AbortSignal, work: () => T): Promise<T> {
  if (!locksAvailable()) throw new Error("SAFE_BROWSER_LOCK_REQUIRED");
  return navigator.locks.request(pendingKey(owner), { mode: "exclusive", signal }, work);
}
const NoticeSchema = z.object({ userId: z.number().int().positive(), workspaceId: z.number().int().positive(), operationId: z.string().uuid(), subject: InventoryGovernanceSubjectSchema, action: z.enum(["assign", "revoke", "restore"]) }).strict();
type Notice = z.infer<typeof NoticeSchema>;
const noticeKey = "inventory-governance-change:v1", noticeListeners = new Set<(notice: Notice) => void>();
export function subscribeInventoryGovernanceChanges(listener: (notice: Notice) => void) {
  noticeListeners.add(listener);
  const storage = (event: StorageEvent) => { if (event.key !== noticeKey || !event.newValue || event.newValue.length > 4096) return; try { listener(NoticeSchema.parse(JSON.parse(event.newValue))); } catch { /* A notification is not authority. */ } };
  window.addEventListener("storage", storage);
  return () => { noticeListeners.delete(listener); window.removeEventListener("storage", storage); };
}
export function publishInventoryGovernanceChange(raw: Notice) {
  const notice = NoticeSchema.parse(raw); noticeListeners.forEach(listener => listener(notice));
  try { localStorage.setItem(noticeKey, JSON.stringify(notice)); } catch { /* Committed receipt remains true; current-page listeners already ran. */ }
}
function errorCode(error: unknown) { return error && typeof error === "object" && "data" in error && error.data && typeof error.data === "object" && "code" in error.data ? error.data.code : null; }
function OwnedGovernanceEditor({ owner, target, onClose }: { owner: InventoryGovernanceEditorOwner; target: InventoryGovernanceEditorTarget | null; onClose: () => void }) {
  const client = trpc.useUtils().client;
  const [base, setBase] = useState<InventoryGovernanceReadResult | null>(null), [comparison, setComparison] = useState<InventoryGovernanceReadResult | null>(null), [loadedKey, setLoadedKey] = useState("");
  const [draft, setDraft] = useState<OwnerDraft>(emptyDraft), [restoreReason, setRestoreReason] = useState(""), [dirty, setDirty] = useState(false), [needsReview, setNeedsReview] = useState(false), [discardPrompt, setDiscardPrompt] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null), [storageError, setStorageError] = useState(false), [cancelAcknowledged, setCancelAcknowledged] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const lane = useRef({ sequence: 0, controller: null as AbortController | null, busy: false }), ownChange = useRef(false), ownSubmission = useRef<{ operationId: string; targetKey: string } | null>(null), notified = useRef(new Set<string>()), readRef = useRef<(preserve: boolean) => void>(() => {});
  const targetKey = target ? JSON.stringify([ownerKey(target.owner), target.subject, target.initialSelection ?? [], target.sourceHints ?? []]) : "", validTarget = target && ownerKey(target.owner) === ownerKey(owner), visible = loadedKey === targetKey ? base : null;
  const ownerData = useMemo<OwnerData | null>(() => visible?.owners ? { scopes: visible.owners.candidates.map(candidate => candidate.scope), candidates: visible.owners.candidates, members: visible.owners.members.map(member => ({ id: member.userId, name: member.displayName, role: member.role })), rules: visible.owners.rules } : null, [visible]);
  function stop() { lane.current.sequence++; lane.current.controller?.abort(); lane.current.controller = null; lane.current.busy = false; setBusy(false); }
  function begin() { stop(); const controller = new AbortController(), sequence = lane.current.sequence; lane.current.controller = controller; lane.current.busy = true; setBusy(true); return { signal: controller.signal, current: () => lane.current.sequence === sequence && !controller.signal.aborted }; }
  function clearDraft() { setBase(null); setComparison(null); setLoadedKey(""); setDraft(emptyDraft()); setRestoreReason(""); setDirty(false); setNeedsReview(false); setDiscardPrompt(false); }
  useEffect(() => {
    const currentLane = lane.current; let previous: string | null | undefined;
    const sync = () => { try { const value = readInventoryGovernancePending(owner); if (previous !== undefined && previous !== (value?.operationId ?? null) && !ownChange.current) { currentLane.sequence++; currentLane.controller?.abort(); currentLane.busy = false; setBusy(false); setCancelAcknowledged(false); setComparison(null); setNeedsReview(true); } previous = value?.operationId ?? null; setPending(value); setStorageError(false); } catch { currentLane.sequence++; currentLane.controller?.abort(); currentLane.busy = false; setBusy(false); setPending(null); setStorageError(true); setCancelAcknowledged(false); } };
    const storage = (event: StorageEvent) => { if (event.key === null || event.key === pendingKey(owner)) sync(); };
    sync(); pendingListeners.add(sync); window.addEventListener("storage", storage);
    return () => { pendingListeners.delete(sync); window.removeEventListener("storage", storage); currentLane.sequence++; currentLane.controller?.abort(); };
  }, [owner]);
  useEffect(() => subscribeInventoryGovernanceChanges(notice => { if (notice.workspaceId === owner.workspaceId && target && notice.operationId !== ownSubmission.current?.operationId) { setNeedsReview(true); setComparison(null); } }), [owner.workspaceId, target]);
  async function read(preserve: boolean) {
    if (!target || !validTarget || lane.current.busy) return;
    let input: z.infer<typeof InventoryGovernanceReadInputSchema>;
    try { input = InventoryGovernanceReadInputSchema.parse({ expectedWorkspaceId: owner.workspaceId, subject: target.subject }); } catch { setMessage("目标范围无效，未发送读取或保存请求。"); return; }
    const request = begin(); setMessage(""); if (!preserve) clearDraft();
    try {
      const raw = await client.inventoryGovernanceWrite.read.query(input, { signal: request.signal }); if (!request.current()) return;
      const result = InventoryGovernanceReadResultSchema.parse(raw);
      if (result.identity.userId !== owner.userId || result.identity.workspaceId !== owner.workspaceId || subjectKey(result.subject) !== subjectKey(input.subject)) throw new Error("READ_CONTEXT_CHANGED");
      if (preserve) { setComparison(result); setMessage("当前版本已读取用于对照，草稿没有被覆盖。未知操作必须先检查或永久取消。"); }
      else {
        const available = new Map((result.owners?.candidates ?? []).map(candidate => [scopeKey(candidate.scope), candidate.scope]));
        const initial = target.initialSelection ?? [], selected = initial.length <= 500 ? initial.filter(scope => available.has(scopeKey(scope))) : [];
        setBase(result); setLoadedKey(targetKey); setDraft({ ...emptyDraft(), selected }); setDirty(false); setNeedsReview(false);
        if (selected.length !== initial.length) setMessage("页面定位范围未全部通过本次精确来源校验，未猜测别名或截断后提交；请在可信范围中重新选择。");
      }
    } catch { if (request.current()) { setBase(null); setComparison(null); setMessage("读取失败，或身份、权限、精确范围与完整回包已变化。没有把失败伪装成零候选 / 空历史；请显式重新读取。"); } }
    finally { if (request.current()) { lane.current.busy = false; setBusy(false); } }
  }
  readRef.current = preserve => { void read(preserve); };
  useEffect(() => { const currentLane = lane.current; currentLane.sequence++; currentLane.controller?.abort(); currentLane.busy = false; ownSubmission.current = null; setBusy(false); clearDraft(); if (targetKey) { setMessage(""); readRef.current(false); } return () => { currentLane.sequence++; currentLane.controller?.abort(); }; }, [targetKey]);
  async function finish(raw: unknown, operation: Pending, request: { signal: AbortSignal; current: () => boolean }) {
    const result = InventoryGovernanceWriteResultSchema.parse(raw);
    if (result.identity.userId !== owner.userId || result.identity.workspaceId !== owner.workspaceId || subjectKey(result.subject) !== subjectKey(operation.subject) || result.operationId !== operation.operationId || result.action !== null && result.action !== operation.action || result.status === "committed" && result.recordIds.length !== operation.targetCount) throw new Error("RECEIPT_MISMATCH");
    if (readInventoryGovernancePending(owner)?.operationId !== operation.operationId) throw new Error("PENDING_CHANGED");
    if (result.status === "unknown") { setNeedsReview(true); setMessage("结果仍未知，原操作编号与草稿保留；只检查或永久取消，不生成新编号重发。"); return; }
    if (locksAvailable()) await locked(owner, request.signal, () => {
      if (!request.current() || readInventoryGovernancePending(owner)?.operationId !== operation.operationId) throw new Error("PENDING_CHANGED");
      ownChange.current = true; try { localStorage.removeItem(pendingKey(owner)); if (readInventoryGovernancePending(owner)) throw new Error("STORAGE_NOT_RELEASED"); pendingListeners.forEach(listener => listener()); } finally { ownChange.current = false; }
    });
    if (!request.current()) return; setCancelAcknowledged(false);
    if (result.status === "cancelled") { setNeedsReview(true); setComparison(null); setMessage(`服务端已确认永久取消原编号，草稿仍保留。请读取当前版本并明确采用后再保存。${locksAvailable() ? "" : "本机编号未释放，禁止新保存。"}`); return; }
    const isOwn = ownSubmission.current?.operationId === operation.operationId && ownSubmission.current.targetKey === targetKey, keepDirty = !isOwn && !!target && loadedKey === targetKey && dirty;
    const counts = result.counts!, summary = `新建 ${counts.created}、替换 ${counts.replaced}（其中重新启用 ${counts.reactivated}）、未变更 ${counts.unchanged}、撤销 ${counts.revoked}、恢复 ${counts.restored}`;
    if (keepDirty) { setNeedsReview(true); setComparison(null); setMessage(`原操作已确认：${summary}。不是当前草稿的提交，未提交草稿保留；请读取对照并明确采用新基线。`); }
    else { clearDraft(); setMessage(`保存已确认：${summary}。当前视图将重新读取，不把回执当成新的来源事实。${locksAvailable() ? "" : "本机编号未释放，禁止新保存。"}`); }
    if (!notified.current.has(operation.operationId)) { notified.current.add(operation.operationId); publishInventoryGovernanceChange({ ...result.identity, subject: result.subject, operationId: result.operationId, action: operation.action }); }
    ownSubmission.current = null; if (!keepDirty) onClose();
  }
  async function execute(action: "assign" | "revoke" | "restore") {
    if (!target || !visible || visible.status !== "ready" || !visible.snapshotKey || pending || storageError || needsReview || lane.current.busy || !locksAvailable() || visible.capabilities[action].status !== "available") return;
    let input: InventoryGovernanceExecuteInput;
    try {
      const common = { expectedWorkspaceId: owner.workspaceId, subject: target.subject, expectedSnapshotKey: visible.snapshotKey, operationId: "00000000-0000-4000-8000-000000000000" };
      input = InventoryGovernanceExecuteInputSchema.parse(action === "assign" ? { ...common, action, targets: draft.selected, assigneeUserId: Number(draft.assignee), reason: draft.reason.trim() || null } : action === "revoke" ? { ...common, action, ruleId: draft.revokeId, reason: draft.reason.trim() || null } : { ...common, action, reason: restoreReason.trim() });
      if (input.action === "assign") {
        const command = input;
        if (!visible.owners?.members.some(member => member.userId === command.assigneeUserId) || command.targets.some(scope => !visible.owners?.candidates.some(candidate => scopeKey(candidate.scope) === scopeKey(scope)))) throw new Error("CANDIDATES_CHANGED");
      }
      if (input.action === "revoke") {
        const command = input;
        if (!draft.revokeAcknowledged || !visible.owners?.rules.some(rule => rule.id === command.ruleId && rule.isActive === 1)) throw new Error("RULE_CHANGED");
      }
    } catch { setMessage("选择或说明不合法：分配必须使用当前数字成员与 1–500 个精确范围；恢复原因必须 2–500 字；不截断、猜别名或自动删除失效选择。"); return; }
    const request = begin(); setMessage(""); let reserved = false;
    try {
      const operation = await locked(owner, request.signal, () => {
        if (!request.current() || readInventoryGovernancePending(owner)) throw new Error("OPERATION_PENDING");
        const value = PendingSchema.parse({ version: 1, userId: owner.userId, workspaceId: owner.workspaceId, operationId: crypto.randomUUID(), subject: input.subject, action, expectedSnapshotKey: input.expectedSnapshotKey, targetCount: input.action === "assign" ? input.targets.length : 1 });
        ownChange.current = true; try { localStorage.setItem(pendingKey(owner), JSON.stringify(value)); if (readInventoryGovernancePending(owner)?.operationId !== value.operationId) throw new Error("RESERVATION_FAILED"); reserved = true; pendingListeners.forEach(listener => listener()); } finally { ownChange.current = false; }
        return value;
      });
      if (!request.current()) return; ownSubmission.current = { operationId: operation.operationId, targetKey };
      const raw = await client.inventoryGovernanceWrite.execute.mutate(InventoryGovernanceExecuteInputSchema.parse({ ...input, operationId: operation.operationId }), { signal: request.signal }); if (request.current()) await finish(raw, operation, request);
    } catch (error) { if (request.current()) { setComparison(null); if (reserved) setNeedsReview(true); setMessage(reserved ? errorCode(error) === "CONFLICT" ? "版本冲突，草稿与原编号保留。读取当前版本对照，并检查 / 取消原操作；不会覆盖或自动重发。" : "未取得可核验回执，结果未知。草稿和原编号保留，请检查或永久取消，不能重复提交。" : "无法安全预留恢复编号，未发送保存；请核对已有操作和浏览器存储，不删除原记录。"); if (!reserved) setStorageError(true); } }
    finally { if (request.current()) { lane.current.busy = false; setBusy(false); } }
  }
  async function recover(decision: "check" | "cancel") {
    if (!pending || storageError || lane.current.busy || decision === "cancel" && !cancelAcknowledged) return;
    let operation: Pending | null; try { operation = readInventoryGovernancePending(owner); } catch { setStorageError(true); setCancelAcknowledged(false); return; }
    if (!operation || operation.operationId !== pending.operationId) { stop(); setPending(operation); setCancelAcknowledged(false); setMessage("其他窗口已变更编号，未发送操作；请重新核对。"); return; }
    const request = begin(); setMessage("");
    try { const input = InventoryGovernanceRecoverInputSchema.parse({ expectedWorkspaceId: owner.workspaceId, subject: operation.subject, operationId: operation.operationId, decision }); const raw = await client.inventoryGovernanceWrite.recover.mutate(input, { signal: request.signal }); if (request.current()) await finish(raw, operation, request); }
    catch { if (request.current()) setMessage("恢复核对失败或身份、范围、权限及回执不一致，原编号未删除，没有自动重发。"); }
    finally { if (request.current()) { lane.current.busy = false; setBusy(false); } }
  }
  function adopt(keep: boolean) {
    if (!comparison || comparison.status !== "ready" || pending || busy) return;
    setBase(comparison); setComparison(null); setLoadedKey(targetKey); setNeedsReview(false);
    if (!keep) { setDraft(emptyDraft()); setRestoreReason(""); setDirty(false); } else setDraft(current => ({ ...current, revokeAcknowledged: false }));
    setMessage("已明确采用当前版本作为基线，尚未保存。原说明与选择仅在选择保留时继续存在，请核对候选变化。");
  }
  function requestClose() { if (dirty) setDiscardPrompt(true); else { stop(); clearDraft(); onClose(); } }
  const recovery = pending ? <section aria-label="负责人及生命周期操作恢复" className="min-w-0 space-y-2 rounded border p-3 text-sm"><h3 className="font-medium">待核对的负责人 / 生命周期操作</h3><p className="break-all">{pending.operationId} · {pending.action} · {subjectKey(pending.subject)} · 目标 {pending.targetCount} 个</p><p>仅保存身份、范围和操作编号等恢复元数据，不保存负责人选择或原因正文。发布关闭后仍可按当前读取授权检查 / 取消。</p><button className={buttonClass} disabled={busy || storageError} onClick={() => void recover("check")}>检查原治理操作</button><label className="flex items-start gap-2"><input type="checkbox" checked={cancelAcknowledged} onChange={event => setCancelAcknowledged(event.currentTarget.checked)} />确认永久取消此治理编号；服务端确认前不释放</label><button className={buttonClass} disabled={busy || storageError || !cancelAcknowledged} onClick={() => void recover("cancel")}>永久取消原治理操作</button></section> : null;
  return <div className="manus-no-record min-w-0 max-w-full">
    {storageError && <p role="alert">治理恢复记录损坏、身份不符或存储不可用；禁止新保存，未删除原记录。</p>}
    {!locksAvailable() && <p role="alert">浏览器不支持安全跨窗口锁，禁止新保存；原编号仍可核对，不降级为旧接口。</p>}
    {!target && <>{recovery}{message && <p role="status" className="break-words text-sm">{message}</p>}</>}
    <Dialog open={target !== null} onOpenChange={open => { if (!open) requestClose(); }}><DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] min-w-0 max-w-5xl grid-cols-[minmax(0,1fr)] overflow-y-auto">
      <DialogHeader className="min-w-0"><DialogTitle>{target?.subject.kind === "lifecycle" ? "恢复在售与完整生命周期证据" : "库存来源负责人规则管理"}</DialogTitle><DialogDescription>先读取当前工作区完整授权候选与原记录。规则共享于工作区；不改领星原始事实，不代替产品主档负责人管理。</DialogDescription></DialogHeader>
      {recovery}
      {!validTarget ? <p role="alert">身份或工作区已变化，旧范围及草稿不可继续使用；请重新选择。</p> : <div className="min-w-0 space-y-4">
        <p className="break-all text-sm">精确范围：{subjectKey(target.subject)}</p>
        <div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={busy} onClick={() => void read(!!visible || dirty)}>读取当前治理版本{visible || dirty ? "用于对照" : "并编辑"}</button><button className={buttonClass} onClick={requestClose}>关闭治理编辑</button></div>
        {message && <p role="status" className="break-words text-sm">{message}</p>}
        {visible && <section className="space-y-2 text-sm"><p>读取状态：{visible.status} · {visible.reasonCode ?? "完整当前版本"}</p>{Object.entries(visible.capabilities).map(([action, cap]) => <p key={action}>{action}：{cap.status === "available" ? "可用" : `未启用 / 不可操作（${cap.reasonCode}）`}</p>)}{visible.status !== "ready" && <p role="alert">来源、权限或原记录不可用 / 存在冲突，不能按空规则继续写入。</p>}</section>}
        {visible?.status === "ready" && ownerData && <OwnerFields data={ownerData} draft={draft} hints={target.sourceHints ?? []} disabled={busy || !!pending} canAssign={!needsReview && !storageError && locksAvailable() && visible.capabilities.assign.status === "available"} canRevoke={!needsReview && !storageError && locksAvailable() && visible.capabilities.revoke.status === "available"} onChange={next => { setDraft(next); setDirty(true); }} onAssign={() => void execute("assign")} onRevoke={() => void execute("revoke")} />}
        {visible?.status === "ready" && visible.lifecycle && <section className="min-w-0 space-y-3"><h3 className="font-medium">当前生命周期及完整证据</h3>{visible.lifecycle.row ? <><p className="text-sm">记录 #{visible.lifecycle.row.id} · {visible.lifecycle.row.status} · 证据期 {visible.lifecycle.row.evidenceStartDate ?? "未提供"} 至 {visible.lifecycle.row.evidenceEndDate ?? "未提供"} · {visible.lifecycle.row.evidenceDays} 天</p><p className="text-sm">销量 {visible.lifecycle.row.evidenceSalesQty} · 利润 {visible.lifecycle.row.evidenceProfit} · 最大库存 {visible.lifecycle.row.evidenceMaxInventory}</p><p className="text-sm">人工恢复时间：{visible.lifecycle.row.restoredAt ?? "无"} · 原恢复原因：{visible.lifecycle.row.restoreReason ?? "无"}</p><p className="text-xs">已有人工恢复保护保留，不会因后续自动证据变化清空恢复时间或说明。</p><details><summary>完整生命周期原记录</summary><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(visible.lifecycle.rows, null, 2)}</pre></details></> : <p>已核实该精确范围没有生命周期记录，不能据此新建或冒充停售。</p>}<label className="block min-w-0 text-sm">恢复在售原因（2–500 字）<textarea aria-label="恢复在售原因" disabled={busy || !!pending || visible.capabilities.restore.status !== "available"} className={inputClass} value={restoreReason} onChange={event => { setRestoreReason(event.currentTarget.value); setDirty(true); }} /></label><button className={buttonClass} disabled={busy || !!pending || needsReview || storageError || !locksAvailable() || visible.capabilities.restore.status !== "available"} onClick={() => void execute("restore")}>确认恢复为在售并保留证据</button></section>}
        {needsReview && <p role="status" className="text-amber-700">当前基线需要重新核对。先处理原编号，再读取当前版本并明确采用，不直接沿用旧快照提交。</p>}
        {comparison && <section aria-label="治理当前版本对照" className="min-w-0 space-y-3 rounded border p-3"><h3 className="font-medium">当前版本对照，原草稿保留</h3><p>当前状态：{comparison.status} · {comparison.reasonCode ?? comparison.snapshotKey}</p>{comparison.owners && <p>当前可信范围 {comparison.owners.candidates.length}、成员 {comparison.owners.members.length}、全部规则 {comparison.owners.rules.length}（已停用 {comparison.owners.rules.filter(rule => rule.isActive === 0).length}）。原选择 {draft.selected.length}、原成员 #{draft.assignee || "未选择"}；说明不会被自动替换。</p>}<details><summary>完整当前版本与旧版本原值对照</summary><div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2"><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(base, null, 2)}</pre><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(comparison, null, 2)}</pre></div></details><div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={busy || !!pending || comparison.status !== "ready"} onClick={() => adopt(true)}>采用当前治理版本并保留草稿</button><button className={buttonClass} disabled={busy || !!pending || comparison.status !== "ready"} onClick={() => adopt(false)}>放弃草稿并采用当前治理版本</button></div></section>}
        {discardPrompt && <section role="alert" className="space-y-2 rounded border p-3"><p>有未提交的选择或原因。关闭会丢弃本地草稿；未知操作编号仍保留，关闭不代表服务端撤销。</p><button className={buttonClass} onClick={() => { stop(); clearDraft(); onClose(); }}>确认丢弃治理草稿并关闭</button><button className={buttonClass} onClick={() => setDiscardPrompt(false)}>继续治理编辑</button></section>}
      </div>}
      {busy && <div><p role="status">正在读取 / 核对治理操作…</p><button className={buttonClass} onClick={() => { stop(); setMessage("停止等待不等于服务端取消；如有原编号，只能检查或永久取消。"); }}>停止等待治理操作</button></div>}
    </DialogContent></Dialog>
  </div>;
}
export function InventoryGovernanceEditorController({ owner, target, onClose }: { owner: InventoryGovernanceEditorOwner; target: InventoryGovernanceEditorTarget | null; onClose: () => void }) {
  const stable = useMemo(() => ({ userId: owner.userId, workspaceId: owner.workspaceId, role: owner.role }), [owner.userId, owner.workspaceId, owner.role]);
  if (!positiveId(owner.userId) || !positiveId(owner.workspaceId) || !manager(owner.role)) return <p role="alert">治理编辑需要有效工作区、数字身份及管理角色。</p>;
  return <OwnedGovernanceEditor key={ownerKey(owner)} owner={stable} target={target} onClose={onClose} />;
}
export default function InventoryGovernanceEditor({ target, onClose }: { target: InventoryGovernanceEditorTarget | null; onClose: () => void }) {
  const auth = useAuth(), permissions = usePermissions(), user = auth.user;
  if (auth.loading || permissions.isLoading) return target ? <p role="status">正在确认治理权限…</p> : null;
  if (auth.error || !user || !positiveId(user.id) || !positiveId(user.defaultWorkspaceId) || !manager(user.role) || !permissions.canRead("ops", "ops_dashboard") || !permissions.canRead("ops", "ops_inventory")) return target ? <p role="alert">治理读取权限或管理身份不可用，旧内容已隐藏。</p> : null;
  return <InventoryGovernanceEditorController owner={{ userId: user.id, workspaceId: user.defaultWorkspaceId, role: user.role }} target={target} onClose={onClose} />;
}
