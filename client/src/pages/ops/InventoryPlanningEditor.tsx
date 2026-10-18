import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  InventoryPlanningReadInputSchema, InventoryPlanningReadResultSchema, InventoryPlanningExecuteInputSchema, InventoryPlanningRecoverInputSchema,
  InventoryPlanningWriteResultSchema, InventoryPlanningValuesSchema, InventoryPlanningPatchSchema, InventoryPlanningScopeSchema,
  canonicalInventoryPlanningScope, inventoryPlanningScopeKey, validateInventoryPlanningWriteAgainstReadResult,
  type InventoryPlanningReadInput, type InventoryPlanningReadResult, type InventoryPlanningScope, type InventoryPlanningValues,
  type InventoryPlanningPatch, type InventoryPlanningExecuteInput,
} from "@shared/inventoryPlanningWrite";

export type InventoryPlanningEditorOwner = { userId: number; workspaceId: number; role: string };
export type InventoryPlanningEditorTarget = { owner: InventoryPlanningEditorOwner; scope: InventoryPlanningScope; asOfDate: string; marketplace: string; mode: "local" | "planning" | "cost" };
type Notice = { userId: number; workspaceId: number; scope: InventoryPlanningScope; asOfDate: string; marketplace: string; action: "confirmLocal" | "saveParameters" };
const listeners = new Set<(notice: Notice) => void>();
export function subscribeInventoryPlanningChanges(listener: (notice: Notice) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function publishInventoryPlanningChange(notice: Notice) { listeners.forEach(listener => listener(notice)); }
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const manager = (role: string) => ["admin", "super_admin", "ops_manager"].includes(role);
const ownerKey = (owner: InventoryPlanningEditorOwner) => JSON.stringify([owner.userId, owner.workspaceId, owner.role]);
const buttonClass = "min-h-10 rounded border px-3 py-2 text-sm disabled:opacity-50";
const inputClass = "mt-1 block w-full min-w-0 max-w-full rounded border bg-background p-2 text-sm";
const parameterLabels = {
  productionDays: "生产天数", shippingDays: "物流天数", bufferDays: "缓冲天数", targetCoverDays: "目标覆盖配置天数（非派生缺口）", moq: "最低起订量 MOQ", packSize: "包装倍数",
  productCost: "产品成本", estimatedFirstLegCost: "预估头程", actualFirstLegCost: "实际头程", estimatedFbaFee: "预估 FBA", actualFbaFee: "实际 FBA", sellingPrice: "售价",
  estimatedDimensions: "预估尺寸", actualDimensions: "实际尺寸", estimatedWeight: "预估重量", actualWeight: "实际重量", dimensionUnit: "尺寸单位", weightUnit: "重量单位", currency: "币种",
} as const;
type Field = keyof InventoryPlanningValues;
const planningFields: Field[] = ["productionDays", "shippingDays", "bufferDays", "targetCoverDays", "moq", "packSize"];
const costFields: Field[] = ["productCost", "estimatedFirstLegCost", "actualFirstLegCost", "estimatedFbaFee", "actualFbaFee", "sellingPrice", "estimatedDimensions", "actualDimensions", "estimatedWeight", "actualWeight", "dimensionUnit", "weightUnit", "currency"];
const nullableFields = new Set<Field>(["productCost", "estimatedFirstLegCost", "actualFirstLegCost", "estimatedFbaFee", "actualFbaFee", "sellingPrice", "estimatedDimensions", "actualDimensions", "estimatedWeight", "actualWeight"]);
type Draft = Record<Field, string>;
const shown = (value: unknown) => value === null || value === undefined ? "未知 / 未填写" : String(value);
function scopeText(scope: InventoryPlanningScope) { try { return inventoryPlanningScopeKey(scope); } catch { return "范围不合法，请重新选择"; } }
export function initializeInventoryPlanningDraft(values: InventoryPlanningValues): Draft {
  return Object.fromEntries(Object.entries(InventoryPlanningValuesSchema.parse(values)).map(([key, value]) => [key, value === null ? "" : String(value)])) as Draft;
}
function exactDraftNumber(raw: string, field: Field) {
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/iu.exec(raw.trim());
  if (!match) throw new Error("INVALID_NUMBER_TEXT");
  const fraction = match[3] ?? match[4] ?? "", exponent = Number(match[5] ?? 0);
  if (!Number.isSafeInteger(exponent)) throw new Error("INVALID_NUMBER_EXPONENT");
  const digits = `${match[2] ?? "0"}${fraction}`.replace(/^0+/u, "");
  if (digits.length === 0) return 0;
  const coefficient = digits.replace(/0+$/u, ""), scale = fraction.length - exponent - (digits.length - coefficient.length);
  const precision = field === "estimatedWeight" || field === "actualWeight" ? 3 : nullableFields.has(field) ? 2 : 0;
  // Validate the original decimal before Number can round an over-precise value
  // or underflow a tiny non-zero input to zero. Trailing zeros are insignificant.
  if (scale > precision || coefficient.length - scale > 10) throw new Error("NUMBER_PRECISION_OR_RANGE");
  const value = Number(raw);
  if (!Number.isFinite(value) || value === 0) throw new Error("NUMBER_CONVERSION_LOST");
  return value;
}
/** Only edited fields become a patch. Blank nullable fields are explicit null,
 * while omitted groups and original target-cover configuration remain intact. */
export function buildInventoryPlanningDraftPatch(base: InventoryPlanningValues, draft: Draft, changed: ReadonlySet<Field>): InventoryPlanningPatch {
  const patch: Record<string, unknown> = {};
  for (const field of changed) {
    const raw = draft[field]; let value: unknown;
    if (raw === "" && nullableFields.has(field)) value = null;
    else if (["estimatedDimensions", "actualDimensions", "dimensionUnit", "weightUnit", "currency"].includes(field)) value = raw;
    else value = exactDraftNumber(raw, field);
    if (value !== base[field]) patch[field] = value;
  }
  return InventoryPlanningPatchSchema.parse(patch);
}
const PendingSchema = z.object({ version: z.literal(1), userId: z.number().int().positive().max(2147483647), workspaceId: z.number().int().positive().max(2147483647),
  operationId: z.string().uuid(), action: z.enum(["confirmLocal", "saveParameters"]), scope: InventoryPlanningScopeSchema,
  asOfDate: InventoryPlanningReadInputSchema.shape.asOfDate, marketplace: z.string(), expectedSnapshotKey: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
type Pending = z.infer<typeof PendingSchema>;
const pendingListeners = new Set<() => void>();
const pendingKey = (owner: InventoryPlanningEditorOwner) => `inventory-planning-write:v1:${owner.userId}:${owner.workspaceId}`;
const locksAvailable = () => typeof navigator !== "undefined" && typeof navigator.locks?.request === "function";
export function readInventoryPlanningPending(owner: InventoryPlanningEditorOwner): Pending | null {
  const raw = localStorage.getItem(pendingKey(owner)); if (raw === null) return null;
  if (raw.length > 4096) throw new Error("INVALID_RECOVERY_METADATA");
  const value = PendingSchema.parse(JSON.parse(raw));
  if (value.userId !== owner.userId || value.workspaceId !== owner.workspaceId) throw new Error("RECOVERY_IDENTITY_CHANGED");
  InventoryPlanningReadInputSchema.parse({ expectedWorkspaceId: value.workspaceId, scope: value.scope, asOfDate: value.asOfDate, marketplace: value.marketplace });
  return value;
}
async function locked<T>(owner: InventoryPlanningEditorOwner, signal: AbortSignal, work: () => T): Promise<T> {
  if (!locksAvailable()) throw new Error("BROWSER_LOCK_REQUIRED");
  return navigator.locks.request(pendingKey(owner), { mode: "exclusive", signal }, work);
}
function sameIdentity(identity: { userId: number; workspaceId: number }, owner: InventoryPlanningEditorOwner) { return identity.userId === owner.userId && identity.workspaceId === owner.workspaceId; }
function contextKey(input: InventoryPlanningReadInput) { return JSON.stringify([input.expectedWorkspaceId, inventoryPlanningScopeKey(input.scope), input.asOfDate, input.marketplace]); }
function inputFor(target: InventoryPlanningEditorTarget): InventoryPlanningReadInput {
  return InventoryPlanningReadInputSchema.parse({ expectedWorkspaceId: target.owner.workspaceId, scope: canonicalInventoryPlanningScope(target.scope), asOfDate: target.asOfDate, marketplace: target.marketplace });
}
function errorCode(error: unknown): string | null { if (error && typeof error === "object" && "data" in error) { const data = error.data; if (data && typeof data === "object" && "code" in data && typeof data.code === "string") return data.code; } return null; }
function ParameterFields({ draft, mode, disabled, onChange }: { draft: Draft; mode: "planning" | "cost"; disabled: boolean; onChange: (field: Field, value: string) => void }) {
  return <fieldset disabled={disabled} className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{(mode === "planning" ? planningFields : costFields).map(field => <label className="min-w-0 text-sm" key={field}>{parameterLabels[field]}
    {field === "currency" ? <p className="mt-1 p-2">USD（保持原币种，不换算）</p> : field === "dimensionUnit" || field === "weightUnit" ? <select aria-label={parameterLabels[field]} className={inputClass} value={draft[field]} onChange={event => onChange(field, event.currentTarget.value)}>{(field === "dimensionUnit" ? ["in", "cm"] : ["lb", "kg"]).map(value => <option key={value} value={value}>{value}</option>)}</select>
      : <input aria-label={parameterLabels[field]} type="text" inputMode={field.endsWith("Dimensions") ? "text" : "decimal"} className={inputClass} value={draft[field]} placeholder={nullableFields.has(field) ? "未知（留空不等于 0）" : "必须填写整数"} onChange={event => onChange(field, event.currentTarget.value)} />}
  </label>)}</fieldset>;
}
function LocalHistory({ result }: { result: InventoryPlanningReadResult }) {
  const [page, setPage] = useState(0), history = result.local?.history ?? [];
  useEffect(() => setPage(0), [result.snapshotKey]);
  return <details className="min-w-0"><summary>全部本地库存确认历史（{history.length} 条）</summary><div role="region" aria-label="本地库存历史横向表" tabIndex={0} className="max-h-72 min-w-0 overflow-auto"><table className="min-w-[850px] text-left text-xs"><thead className="sticky top-0 bg-background"><tr>{["ID / 生效日期", "绝对数量 / 状态", "确认人 / 确认时间", "被替代为", "原因 / 完整原值"].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{history.slice(page * 25, page * 25 + 25).map(row => <tr key={row.id}><td className="p-2">#{row.id} · {row.effectiveDate}</td><td className="p-2">{row.localQty} · {row.status}</td><td className="p-2">{shown(row.confirmedBy)} · {shown(row.confirmedAt)}</td><td className="p-2">{shown(row.supersededById)}</td><td className="max-w-80 whitespace-pre-wrap break-words p-2">{shown(row.reason)}<details><summary>完整记录</summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify(row, null, 2)}</pre></details></td></tr>)}</tbody></table></div><div className="flex flex-wrap items-center gap-2"><button className={buttonClass} disabled={page === 0} onClick={() => setPage(value => value - 1)}>历史上一页</button><span>第 {page + 1} 页 / {Math.max(1, Math.ceil(history.length / 25))} 页，全部 {history.length} 条</span><button className={buttonClass} disabled={(page + 1) * 25 >= history.length} onClick={() => setPage(value => value + 1)}>历史下一页</button></div></details>;
}
function OwnedInventoryPlanningEditor({ owner, target, onClose }: { owner: InventoryPlanningEditorOwner; target: InventoryPlanningEditorTarget | null; onClose: () => void }) {
  const client = trpc.useUtils().client;
  const [base, setBase] = useState<InventoryPlanningReadResult | null>(null), [comparison, setComparison] = useState<InventoryPlanningReadResult | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null), [changed, setChanged] = useState<Set<Field>>(new Set());
  const [localQty, setLocalQty] = useState(""), [effectiveDate, setEffectiveDate] = useState(""), [reason, setReason] = useState("");
  const [localDirty, setLocalDirty] = useState(false), [discardPrompt, setDiscardPrompt] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null), [storageError, setStorageError] = useState(false), [cancelAcknowledged, setCancelAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [loadedKey, setLoadedKey] = useState("");
  const [needsReview, setNeedsReview] = useState(false);
  const lane = useRef({ sequence: 0, controller: null as AbortController | null, busy: false }), ownChange = useRef(false), notified = useRef(new Set<string>());
  const submittedHere = useRef<{ operationId: string; targetKey: string } | null>(null);
  const targetKey = target ? JSON.stringify([ownerKey(target.owner), target.scope, target.asOfDate, target.marketplace, target.mode]) : "";
  const readRef = useRef<(preserve: boolean) => void>(() => {});
  const validTarget = target && ownerKey(target.owner) === ownerKey(owner);
  const visibleBase = loadedKey === targetKey ? base : null, visibleDraft = loadedKey === targetKey ? draft : null;
  function stop() { lane.current.sequence++; lane.current.controller?.abort(); lane.current.controller = null; lane.current.busy = false; setBusy(false); }
  function begin() { stop(); const controller = new AbortController(), sequence = lane.current.sequence; lane.current.controller = controller; lane.current.busy = true; setBusy(true); return { signal: controller.signal, current: () => sequence === lane.current.sequence && !controller.signal.aborted }; }
  function clearDraft() { setBase(null); setComparison(null); setDraft(null); setChanged(new Set()); setLocalDirty(false); setLoadedKey(""); setDiscardPrompt(false); setNeedsReview(false); }
  useEffect(() => {
    const currentLane = lane.current; let previous: string | null | undefined;
    const sync = () => {
      try { const value = readInventoryPlanningPending(owner); if (previous !== undefined && previous !== (value?.operationId ?? null) && !ownChange.current) { currentLane.sequence++; currentLane.controller?.abort(); currentLane.busy = false; setBusy(false); setCancelAcknowledged(false); setComparison(null); } previous = value?.operationId ?? null; setPending(value); setStorageError(false); }
      catch { currentLane.sequence++; currentLane.controller?.abort(); currentLane.busy = false; setBusy(false); setPending(null); setStorageError(true); setCancelAcknowledged(false); }
    };
    const storage = (event: StorageEvent) => { if (event.key === pendingKey(owner) || event.key === null) sync(); };
    sync(); pendingListeners.add(sync); window.addEventListener("storage", storage);
    return () => { pendingListeners.delete(sync); window.removeEventListener("storage", storage); currentLane.sequence++; currentLane.controller?.abort(); };
  }, [owner]);
  async function read(preserve: boolean) {
    if (!target || !validTarget || lane.current.busy) return;
    let input: InventoryPlanningReadInput;
    try { input = inputFor(target); } catch { setMessage("编辑范围、站点筛选或截至日不合法，未发送请求。"); return; }
    const request = begin(); setMessage(""); if (!preserve) clearDraft();
    try {
      const raw = await client.inventoryPlanningWrite.read.query(input, { signal: request.signal }); if (!request.current()) return;
      const value = InventoryPlanningReadResultSchema.parse(raw);
      if (!sameIdentity(value.identity, owner) || contextKey({ expectedWorkspaceId: value.identity.workspaceId, scope: value.scope, asOfDate: value.asOfDate, marketplace: value.marketplace }) !== contextKey(input)) throw new Error("READ_CONTEXT_CHANGED");
      if (preserve) { setComparison(value); setMessage("已读取当前版本用于对照；尚未覆盖草稿。原未知操作必须先核对或取消。"); }
      else { setBase(value); setLoadedKey(targetKey); setDraft(value.parameters ? initializeInventoryPlanningDraft(value.parameters.effective) : null); setChanged(new Set()); setLocalQty(value.local?.current ? String(value.local.current.localQty) : ""); setEffectiveDate(input.asOfDate); setReason(""); setLocalDirty(false); }
    } catch { if (request.current()) { setBase(null); setComparison(null); setMessage("读取失败或身份、权限、来源上下文及回包完整性已变化；不使用旧行、零值或默认值冒充可保存状态。草稿未发送，请显式重新读取。"); } }
    finally { if (request.current()) { lane.current.busy = false; setBusy(false); } }
  }
  readRef.current = preserve => { void read(preserve); };
  useEffect(() => { const currentLane = lane.current; currentLane.sequence++; currentLane.controller?.abort(); currentLane.busy = false; submittedHere.current = null; setBusy(false); clearDraft(); setMessage(""); if (targetKey) readRef.current(false); return () => { currentLane.sequence++; currentLane.controller?.abort(); }; }, [targetKey]);
  async function finish(raw: unknown, operation: Pending, request: { signal: AbortSignal; current: () => boolean }) {
    const value = InventoryPlanningWriteResultSchema.parse(raw);
    const original = InventoryPlanningReadInputSchema.parse({ expectedWorkspaceId: operation.workspaceId, scope: operation.scope, asOfDate: operation.asOfDate, marketplace: operation.marketplace });
    if (!sameIdentity(value.identity, owner) || value.operationId !== operation.operationId || value.action !== null && value.action !== operation.action || contextKey({ expectedWorkspaceId: value.identity.workspaceId, scope: value.scope, asOfDate: value.asOfDate, marketplace: value.marketplace }) !== contextKey(original)) throw new Error("RECEIPT_CHANGED");
    if (readInventoryPlanningPending(owner)?.operationId !== operation.operationId) throw new Error("PENDING_CHANGED");
    if (value.status === "unknown") { setNeedsReview(true); setMessage("保存结果未知，原编号与草稿均保留。只检查或永久取消原操作，不生成新编号重发。"); return; }
    if (locksAvailable()) await locked(owner, request.signal, () => {
      if (!request.current() || readInventoryPlanningPending(owner)?.operationId !== operation.operationId) throw new Error("PENDING_CHANGED");
      ownChange.current = true; try { localStorage.removeItem(pendingKey(owner)); if (readInventoryPlanningPending(owner)) throw new Error("STORAGE_FAILED"); pendingListeners.forEach(listener => listener()); } finally { ownChange.current = false; }
    });
    if (!request.current()) return;
    setCancelAcknowledged(false);
    if (value.status === "committed") {
      const isOwnSubmission = submittedHere.current?.operationId === operation.operationId && submittedHere.current.targetKey === targetKey;
      const preserveUnsubmittedDraft = !isOwnSubmission && !!target && loadedKey === targetKey && (changed.size > 0 || localDirty);
      if (preserveUnsubmittedDraft) {
        setNeedsReview(true); setComparison(null);
        setMessage(`原操作已确认保存记录 #${value.recordId}；它不是当前草稿的提交，当前未提交草稿保留。请读取当前版本对照并明确采用基线后再保存。${locksAvailable() ? "" : "浏览器不支持安全锁，本机编号仍保留。"}`);
      } else { clearDraft(); setMessage(`已确认保存记录 #${value.recordId}，两个入口将重新读取。${locksAvailable() ? "" : "浏览器不支持安全锁，本机编号仍保留，禁止新保存。"}`); }
      submittedHere.current = null;
      if (!notified.current.has(operation.operationId)) { notified.current.add(operation.operationId); publishInventoryPlanningChange({ ...value.identity, scope: value.scope, asOfDate: value.asOfDate, marketplace: value.marketplace, action: operation.action }); }
      if (!preserveUnsubmittedDraft) onClose();
    } else { setNeedsReview(true); setMessage(`服务端已确认永久取消，原草稿保留。请读取当前版本对照后再明确保存。${locksAvailable() ? "" : "本机编号尚未释放。"}`); setComparison(null); }
  }
  async function save() {
    if (!target || !visibleBase || visibleBase.status !== "ready" || !visibleBase.parameters || !visibleDraft || !locksAvailable() || pending || storageError || needsReview || lane.current.busy) return;
    const action = target.mode === "local" ? "confirmLocal" : "saveParameters";
    if (visibleBase.capabilities[action].status !== "available") return;
    let body: Omit<InventoryPlanningExecuteInput, "operationId">;
    try {
      const context = inputFor(target);
      if (action === "confirmLocal") {
        if (!/^\d+$/u.test(localQty)) throw new Error("LOCAL_QUANTITY_REQUIRED");
        body = { ...context, action, expectedSnapshotKey: visibleBase.snapshotKey!, localQty: Number(localQty), effectiveDate, reason: reason === "" ? null : reason } as Omit<InventoryPlanningExecuteInput, "operationId">;
      } else body = { ...context, action, expectedSnapshotKey: visibleBase.snapshotKey!, patch: buildInventoryPlanningDraftPatch(visibleBase.parameters.effective, visibleDraft, changed) } as Omit<InventoryPlanningExecuteInput, "operationId">;
      validateInventoryPlanningWriteAgainstReadResult({ ...body, operationId: "00000000-0000-4000-8000-000000000000" } as InventoryPlanningExecuteInput, visibleBase);
    } catch { setMessage("输入不合法或没有实际修改：数量与天数必须在允许整数范围，费用最多 2 位、重量最多 3 位小数；未知项请明确留空，不会四舍五入、截断或补 0。"); return; }
    const request = begin(); setMessage(""); let reserved = false;
    try {
      const operation = await locked(owner, request.signal, () => {
        if (!request.current() || readInventoryPlanningPending(owner)) throw new Error("OPERATION_PENDING");
        const value = PendingSchema.parse({ version: 1, userId: owner.userId, workspaceId: owner.workspaceId, operationId: crypto.randomUUID(), action, scope: body.scope, asOfDate: body.asOfDate, marketplace: body.marketplace, expectedSnapshotKey: body.expectedSnapshotKey });
        ownChange.current = true; try { localStorage.setItem(pendingKey(owner), JSON.stringify(value)); if (readInventoryPlanningPending(owner)?.operationId !== value.operationId) throw new Error("STORAGE_FAILED"); reserved = true; pendingListeners.forEach(listener => listener()); } finally { ownChange.current = false; }
        return value;
      });
      if (!request.current()) return;
      submittedHere.current = { operationId: operation.operationId, targetKey };
      const input = InventoryPlanningExecuteInputSchema.parse({ ...body, operationId: operation.operationId });
      const raw = await client.inventoryPlanningWrite.execute.mutate(input, { signal: request.signal }); if (request.current()) await finish(raw, operation, request);
    } catch (error) { if (request.current()) { setComparison(null); if (reserved) setNeedsReview(true); setMessage(reserved ? errorCode(error) === "CONFLICT" ? "版本冲突，草稿保留且未自动覆盖。请读取当前版本对照，并检查 / 取消原编号；不自动重发。" : "未取得可核验保存回执，结果未知。草稿和原编号保留，请检查或永久取消原操作；不会重复提交。" : "无法安全预留恢复编号，未发起保存。请检查已有操作和浏览器存储，不删除旧记录。"); if (!reserved) setStorageError(true); } }
    finally { if (request.current()) { lane.current.busy = false; setBusy(false); } }
  }
  async function recover(decision: "check" | "cancel") {
    if (lane.current.busy || storageError || !pending || decision === "cancel" && !cancelAcknowledged) return;
    let operation: Pending | null;
    try { operation = readInventoryPlanningPending(owner); } catch { setStorageError(true); setCancelAcknowledged(false); return; }
    if (!operation || operation.operationId !== pending.operationId) { stop(); setPending(operation); setCancelAcknowledged(false); setMessage("其他窗口已变更恢复编号，未发送操作。请重新核对并确认。"); return; }
    const request = begin(); setMessage("");
    try {
      const input = InventoryPlanningRecoverInputSchema.parse({ expectedWorkspaceId: owner.workspaceId, operationId: operation.operationId, scope: operation.scope, asOfDate: operation.asOfDate, marketplace: operation.marketplace, decision });
      const raw = await client.inventoryPlanningWrite.recover.mutate(input, { signal: request.signal }); if (request.current()) await finish(raw, operation, request);
    } catch { if (request.current()) { setComparison(null); setMessage("恢复核对失败或身份、权限、范围与回执不一致。原编号保留，未自动重发或删除。"); } }
    finally { if (request.current()) { lane.current.busy = false; setBusy(false); } }
  }
  function adopt(keepEdits: boolean) {
    if (!comparison?.parameters || comparison.status !== "ready" || pending || busy) return;
    const next = initializeInventoryPlanningDraft(comparison.parameters.effective);
    if (keepEdits && visibleDraft) for (const field of changed) next[field] = visibleDraft[field];
    if (!keepEdits) { setChanged(new Set()); setLocalQty(comparison.local?.current ? String(comparison.local.current.localQty) : ""); setEffectiveDate(comparison.asOfDate); setReason(""); setLocalDirty(false); }
    setBase(comparison); setDraft(next); setLoadedKey(targetKey); setComparison(null); setNeedsReview(false); setMessage("已明确采用当前版本作为保存基线；尚未保存。");
  }
  function requestClose() { if (changed.size || localDirty) setDiscardPrompt(true); else { stop(); clearDraft(); onClose(); } }
  const action = target?.mode === "local" ? "confirmLocal" : "saveParameters";
  const unavailable = visibleBase?.capabilities[action].status !== "available";
  const recoveryControls = pending ? <section aria-label="人工库存与参数操作恢复" className="min-w-0 space-y-2 rounded border p-3 text-sm"><h3 className="font-medium">待核对的人工规划操作</h3><p className="break-all">{pending.operationId} · {pending.action} · {inventoryPlanningScopeKey(pending.scope)} · 截至 {pending.asOfDate} · 来源筛选 {pending.marketplace}</p><p>只保存身份、范围、版本和编号，不保存草稿正文。关闭发布开关后仍可按当前授权核对 / 取消。</p><button className={buttonClass} disabled={busy || storageError} onClick={() => void recover("check")}>检查原人工规划操作</button><label className="flex items-start gap-2"><input type="checkbox" checked={cancelAcknowledged} onChange={event => setCancelAcknowledged(event.currentTarget.checked)} />确认永久取消此编号；服务端确认前不释放</label><button className={buttonClass} disabled={busy || storageError || !cancelAcknowledged} onClick={() => void recover("cancel")}>永久取消原人工规划操作</button></section> : null;
  return <div className="manus-no-record min-w-0 max-w-full">
    {storageError && <p role="alert" className="rounded border p-3">人工规划恢复记录损坏、身份不匹配或存储不可用，禁止新保存；未删除原记录。</p>}
    {!locksAvailable() && <p role="alert" className="rounded border p-3">浏览器不支持安全跨窗口锁，禁止新保存；原编号仍可检查或取消，不降级为旧写接口。</p>}
    {!target && recoveryControls}
    {message && !target && <p role="status" className="break-words p-2 text-sm">{message}</p>}
    <Dialog open={target !== null} onOpenChange={open => { if (!open) requestClose(); }}><DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] min-w-0 max-w-5xl grid-cols-[minmax(0,1fr)] overflow-y-auto">
      <DialogHeader className="min-w-0"><DialogTitle>{target?.mode === "local" ? "确认本地绝对库存" : target?.mode === "planning" ? "完整货期与数量参数" : "完整产品成本、尺寸与重量"}</DialogTitle><DialogDescription>先读取当前用户在精确范围的原记录；不改领星来源事实或赛狐库存快照。省略字段不修改，空值不冒充 0。</DialogDescription></DialogHeader>
      {recoveryControls}
      {!validTarget ? <p role="alert">编辑身份或工作区已变化，旧选择与草稿不可继续使用。请关闭后重新选择。</p> : <div className="min-w-0 space-y-4">
        <p className="break-all text-sm">{scopeText(target.scope)} · 来源筛选 {target.marketplace} · 截至 {target.asOfDate}</p>
        <div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={busy} onClick={() => void read(!!visibleDraft)}>读取当前版本{visibleDraft ? "用于对照" : "并编辑"}</button><button className={buttonClass} onClick={requestClose}>关闭编辑</button></div>
        {message && <p role="status" className="break-words text-sm">{message}</p>}
        {visibleBase && <section className="min-w-0 space-y-2 text-sm"><p>来源状态：{visibleBase.status} · {visibleBase.source.recordCount} 条已验证来源 · 写入能力：{unavailable ? visibleBase.capabilities[action].reasonCode : "可用"}</p>
          {visibleBase.status !== "ready" && <p role="alert">原人工记录或来源不可读 / 有冲突：{visibleBase.reasonCode}。不补零、猜记录或自动修复。</p>}
          {visibleBase.parameters && <><p>参数生效来源：{visibleBase.parameters.resolvedFrom} · 当前精确范围记录：{visibleBase.parameters.current ? `#${visibleBase.parameters.current.id}` : "已核实没有记录，使用明确继承 / 系统默认"}</p><details><summary>完整原参数与版本</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify({ snapshotKey: visibleBase.snapshotKey, parameters: visibleBase.parameters }, null, 2)}</pre></details></>}
        </section>}
        {visibleBase?.status === "ready" && visibleDraft && <>
          {target.mode === "local" ? <fieldset disabled={busy || unavailable || !!pending} className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2"><label className="min-w-0 text-sm">确认后的本地绝对数量<input aria-label="确认后的本地绝对数量" className={inputClass} inputMode="numeric" value={localQty} onChange={event => { setLocalQty(event.currentTarget.value); setLocalDirty(true); }} /></label><label className="min-w-0 text-sm">生效日期<input aria-label="本地库存生效日期" className={inputClass} type="date" value={effectiveDate} onChange={event => { setEffectiveDate(event.currentTarget.value); setLocalDirty(true); }} /></label><label className="min-w-0 text-sm sm:col-span-2">确认原因（可选，最多 500 字）<textarea aria-label="本地库存确认原因" className={inputClass} value={reason} onChange={event => { setReason(event.currentTarget.value); setLocalDirty(true); }} /></label><p className="text-xs sm:col-span-2">数量是该日期的绝对库存，不是增量。同日旧确认将保留为被替代历史；其他日期不删除。当前确认：{visibleBase.local?.current ? `${visibleBase.local.current.localQty} 件（${visibleBase.local.current.effectiveDate}）` : "尚未确认，不代表实际库存为 0"}。</p></fieldset>
            : <><ParameterFields draft={visibleDraft} mode={target.mode} disabled={busy || unavailable || !!pending} onChange={(field, value) => { setDraft(old => old ? { ...old, [field]: value } : old); setChanged(old => new Set([...old, field])); }} /><p className="text-xs">目标覆盖天数只编辑原配置，不从派生覆盖缺口反写。成本为空表示未知；更改单位不会自动换算对应尺寸 / 重量，请一并核对。费用最多 2 位、重量最多 3 位小数。</p></>}
          <LocalHistory result={visibleBase} />
          {target.mode === "local" && effectiveDate > target.asOfDate && <p role="status" className="text-amber-700">生效日期晚于当前截至日；确认后保留为未来记录，不计入当前截至日的本地库存。</p>}
          {needsReview && <p role="status">原操作结束后仍需读取当前版本并明确采用保存基线，不使用旧快照直接重试。</p>}
          <button className={buttonClass} disabled={busy || unavailable || !!pending || storageError || needsReview || !locksAvailable()} onClick={() => void save()}>{target.mode === "local" ? "确认保存本地绝对库存" : "保存已编辑字段"}</button>
        </>}
        {comparison && <section aria-label="人工规划当前版本对照" className="min-w-0 space-y-3 rounded border p-3"><h3 className="font-medium">当前版本对照（原草稿保留）</h3><p>当前来源：{comparison.status} · {comparison.reasonCode ?? comparison.snapshotKey}</p>{comparison.parameters && <div role="region" aria-label="完整参数版本对照表" tabIndex={0} className="max-h-80 min-w-0 overflow-auto"><table className="min-w-[650px] text-left text-xs"><thead className="sticky top-0 bg-background"><tr><th>字段</th><th>原读取值</th><th>当前版本</th><th>草稿</th></tr></thead><tbody>{(Object.keys(parameterLabels) as Field[]).map(field => <tr key={field}><td className="p-2">{parameterLabels[field]}</td><td className="p-2">{shown(base?.parameters?.effective[field])}</td><td className="p-2">{shown(comparison.parameters!.effective[field])}</td><td className="p-2">{visibleDraft?.[field] === "" ? "未知 / 清空" : visibleDraft?.[field]}</td></tr>)}</tbody></table></div>}{comparison.local && <LocalHistory result={comparison} />}<div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={busy || !!pending || comparison.status !== "ready"} onClick={() => adopt(true)}>采用当前版本并保留已编辑字段</button><button className={buttonClass} disabled={busy || !!pending || comparison.status !== "ready"} onClick={() => adopt(false)}>放弃草稿并采用当前版本</button></div></section>}
        {busy && <div><p role="status">正在读取或核对人工规划操作…</p><button className={buttonClass} onClick={() => { stop(); setMessage("已停止等待，不等于服务端已取消。若有原编号，请检查或永久取消，不能直接重发。"); }}>停止等待（不取消服务端）</button></div>}
        {discardPrompt && <div role="alert" className="space-y-2 rounded border p-3"><p>存在未保存草稿。关闭将丢弃本地草稿；未知操作编号仍保留用于恢复，不代表撤销已提交请求。</p><button className={buttonClass} onClick={() => { stop(); clearDraft(); onClose(); }}>确认丢弃草稿并关闭</button><button className={buttonClass} onClick={() => setDiscardPrompt(false)}>继续编辑</button></div>}
      </div>}
    </DialogContent></Dialog>
  </div>;
}
export function InventoryPlanningEditorController({ owner, target, onClose }: { owner: InventoryPlanningEditorOwner; target: InventoryPlanningEditorTarget | null; onClose: () => void }) {
  const stableOwner = useMemo(() => ({ userId: owner.userId, workspaceId: owner.workspaceId, role: owner.role }), [owner.userId, owner.workspaceId, owner.role]);
  if (!positiveId(owner.userId) || !positiveId(owner.workspaceId) || !manager(owner.role)) return <p role="alert">人工规划编辑需要有效用户、工作区和管理角色。</p>;
  return <OwnedInventoryPlanningEditor key={ownerKey(owner)} owner={stableOwner} target={target} onClose={onClose} />;
}
export default function InventoryPlanningEditor({ target, onClose }: { target: InventoryPlanningEditorTarget | null; onClose: () => void }) {
  const auth = useAuth(), permissions = usePermissions();
  if (auth.loading || permissions.isLoading) return target ? <p role="status">正在确认人工规划编辑身份与权限…</p> : null;
  const user = auth.user;
  if (auth.error || !user || !positiveId(user.id) || !positiveId(user.defaultWorkspaceId) || !manager(user.role) || !permissions.canRead("ops", "ops_dashboard") || !permissions.canRead("ops", "ops_inventory")) return target ? <p role="alert">缺少人工规划读取权限或有效管理身份，旧内容已隐藏。</p> : null;
  return <InventoryPlanningEditorController owner={{ userId: user.id, workspaceId: user.defaultWorkspaceId, role: user.role }} target={target} onClose={onClose} />;
}
