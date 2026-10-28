import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import {
  InventorySnapshotRefreshOptionsResultSchema, InventorySnapshotRefreshResultSchema, InventorySnapshotRefreshStartInputSchema,
  type InventorySnapshotRefreshOptionsResult, type InventorySnapshotRefreshResult,
} from "@shared/inventorySnapshotRefresh";

export type InventorySnapshotRefreshOwner = { userId: number; workspaceId: number; role: string };
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const isManager = (role: string) => ["admin", "super_admin", "ops_manager"].includes(role);
const buttonClass = "min-h-10 rounded border px-3 py-2 text-sm disabled:opacity-50";
const PendingSchema = z.object({
  version: z.literal(1), userId: z.number().int().positive().max(2147483647), workspaceId: z.number().int().positive().max(2147483647),
  operationId: z.string().uuid().refine(value => value === value.toLowerCase()), jobId: z.number().int().positive().max(2147483647).nullable(),
}).strict();
type Pending = z.infer<typeof PendingSchema>;
const pendingListeners = new Set<() => void>();
const pendingKey = (owner: InventorySnapshotRefreshOwner) => `inventory-snapshot-refresh:v1:${owner.userId}:${owner.workspaceId}`;
function hasPendingLocks() { return typeof navigator !== "undefined" && typeof navigator.locks?.request === "function"; }
async function withPendingLock<T>(owner: InventorySnapshotRefreshOwner, work: () => T, signal?: AbortSignal): Promise<T> {
  if (!hasPendingLocks()) throw new Error("EXCLUSIVE_BROWSER_LOCK_UNAVAILABLE");
  return navigator.locks.request(pendingKey(owner), { mode: "exclusive", ...(signal ? { signal } : {}) }, work);
}
/** Persist recovery identifiers only, not inventory, source credentials or scope mappings. */
export function readInventorySnapshotPending(owner: InventorySnapshotRefreshOwner): Pending | null {
  const raw = localStorage.getItem(pendingKey(owner));
  if (raw === null) return null;
  if (raw.length > 1024) throw new Error("INVALID_RECOVERY_METADATA");
  const value = PendingSchema.parse(JSON.parse(raw));
  if (value.userId !== owner.userId || value.workspaceId !== owner.workspaceId) throw new Error("RECOVERY_IDENTITY_CHANGED");
  return value;
}
function persist(owner: InventorySnapshotRefreshOwner, value: Pending, existing = false) {
  const previous = readInventorySnapshotPending(owner);
  if (existing ? previous?.operationId !== value.operationId : previous !== null) throw new Error("PENDING_OPERATION_CHANGED");
  localStorage.setItem(pendingKey(owner), JSON.stringify(PendingSchema.parse(value)));
  const verified = readInventorySnapshotPending(owner);
  if (verified?.operationId !== value.operationId || verified.jobId !== value.jobId) throw new Error("RECOVERY_STORAGE_FAILED");
  pendingListeners.forEach(listener => listener());
}
function release(owner: InventorySnapshotRefreshOwner, operationId: string) {
  if (readInventorySnapshotPending(owner)?.operationId !== operationId) throw new Error("PENDING_OPERATION_CHANGED");
  localStorage.removeItem(pendingKey(owner));
  if (readInventorySnapshotPending(owner)) throw new Error("RECOVERY_STORAGE_FAILED");
  pendingListeners.forEach(listener => listener());
}
type SnapshotChange = { userId: number; workspaceId: number; snapshotId: number };
const snapshotListeners = new Set<(notice: SnapshotChange) => void>();
export function subscribeInventorySnapshotChanges(listener: (notice: SnapshotChange) => void) {
  snapshotListeners.add(listener); return () => { snapshotListeners.delete(listener); };
}
/** A local invalidation signal, never permission or a substitute for fresh reading. */
export function publishInventorySnapshotChange(notice: SnapshotChange) {
  if (!positiveId(notice.userId) || !positiveId(notice.workspaceId) || !positiveId(notice.snapshotId)) return;
  snapshotListeners.forEach(listener => listener(notice));
}
function Shell({ children }: { children: ReactNode }) {
  return <section aria-label="完整库存显式采集" className="manus-no-record min-w-0 max-w-full space-y-4 overflow-hidden rounded-xl border bg-card p-4 md:p-5">
    <header className="space-y-1"><h2 className="text-lg font-semibold">更新库存</h2>
      <p className="text-sm text-muted-foreground">从赛狐获取最新库存，更新成功后自动刷新下方列表。</p>
    </header>{children}
  </section>;
}
const sourceLabels = { warehouses: "仓库目录", warehouse: "国内仓库存", fba: "FBA 库存与库龄", commodities: "商品", aux: "辅料", auxParents: "辅料关联", listings: "Listing 来源", shipping: "发货单", shippingItems: "发货明细", details: "商品详情" };
const reasonLabels: Record<string, string> = {
  collection_deadline: "本次完整采集超过运行时限，未替换原库存；可检查来源规模后重新发起。",
  worker_stopped: "采集执行进程已停止，未发布不完整快照。", collection_disabled: "采集发布开关已关闭。",
  lease_or_authority_lost: "执行租约或当前授权已变化，未继续发布。", vendor_rate_limited: "来源限流，请核对来源限制后再明确发起。",
  vendor_authorization_failed: "来源授权失败，需要检查当前连接授权。", vendor_response_invalid: "来源响应不完整或格式不合法。",
  vendor_http_failed: "来源服务请求失败。", vendor_connection_failed: "无法连接来源服务。",
  response_budget: "来源响应超过安全读取预算，未截断发布。", request_budget: "来源请求数超过安全预算，未截断发布。",
};
function identityMatches(identity: { userId: number; workspaceId: number }, owner: InventorySnapshotRefreshOwner) {
  if (identity.userId !== owner.userId || identity.workspaceId !== owner.workspaceId) throw new Error("IDENTITY_CHANGED");
}
function OwnedInventorySnapshotRefresh({ owner }: { owner: InventorySnapshotRefreshOwner }) {
  const client = trpc.useUtils().client;
  const [options, setOptions] = useState<InventorySnapshotRefreshOptionsResult | null>(null);
  const [pending, setPending] = useState<Pending | null>(null), [storageError, setStorageError] = useState(false);
  const [result, setResult] = useState<InventorySnapshotRefreshResult | null>(null), [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false), [cancelAcknowledged, setCancelAcknowledged] = useState(false);
  const lane = useRef({ sequence: 0, controller: null as AbortController | null, busy: false });
  const ownPendingChange = useRef(false), notified = useRef(new Set<string>());
  const poll = useRef<() => void>(() => {});
  function stop() { lane.current.sequence++; lane.current.controller?.abort(); lane.current.controller = null; lane.current.busy = false; setBusy(false); }
  function begin() {
    stop(); const controller = new AbortController(), sequence = lane.current.sequence;
    lane.current.controller = controller; lane.current.busy = true; setBusy(true);
    return { signal: controller.signal, current: () => sequence === lane.current.sequence && !controller.signal.aborted };
  }
  useEffect(() => {
    const currentLane = lane.current;
    let previousOperation: string | null | undefined;
    function stopStaleView() {
      currentLane.sequence++; currentLane.controller?.abort(); currentLane.controller = null; currentLane.busy = false;
      setBusy(false); setOptions(null); setResult(null); setCancelAcknowledged(false);
    }
    function sync() {
      try {
        const next = readInventorySnapshotPending(owner), operation = next?.operationId ?? null;
        if (previousOperation !== undefined && previousOperation !== operation && !ownPendingChange.current) stopStaleView();
        previousOperation = operation; setPending(next); setStorageError(false);
      } catch { stopStaleView(); setPending(null); setStorageError(true); }
    }
    const onStorage = (event: StorageEvent) => { if (event.key === pendingKey(owner) || event.key === null) sync(); };
    sync(); pendingListeners.add(sync); window.addEventListener("storage", onStorage);
    return () => { pendingListeners.delete(sync); window.removeEventListener("storage", onStorage); currentLane.sequence++; currentLane.controller?.abort(); };
  }, [owner]);
  useEffect(() => {
    if (!pending || result?.outcome !== "accepted" || result.operationId !== pending.operationId || busy || storageError) return;
    const timer = setTimeout(() => poll.current(), 5000);
    return () => clearTimeout(timer);
  }, [pending, result, busy, storageError]);
  async function checkOptions() {
    if (lane.current.busy) return;
    const request = begin(); setOptions(null); setMessage("");
    try {
      const raw = await client.inventorySnapshotRefresh.options.query({ expectedWorkspaceId: owner.workspaceId }, { signal: request.signal });
      if (!request.current()) return;
      const value = InventorySnapshotRefreshOptionsResultSchema.parse(raw); identityMatches(value.identity, owner);
      setOptions(value);
    } catch { if (request.current()) { setOptions(null); setResult(null); setMessage("采集权限或来源检查失败，未发起采集。请重新检查；已有未知操作只核对或取消。"); } }
    finally { if (request.current()) { lane.current.busy = false; setBusy(false); } }
  }
  async function accept(raw: unknown, operation: Pending, request: { current: () => boolean; signal: AbortSignal }) {
    const value = InventorySnapshotRefreshResultSchema.parse(raw); identityMatches(value.identity, owner);
    function verifiedPending() {
      const saved = readInventorySnapshotPending(owner);
      if (!request.current() || value.operationId !== operation.operationId || saved?.operationId !== operation.operationId || saved.jobId !== null && value.jobId !== null && value.jobId !== saved.jobId) throw new Error("OPERATION_CHANGED");
      return saved;
    }
    verifiedPending();
    if (value.outcome !== "unknown" && hasPendingLocks()) {
      await withPendingLock(owner, () => {
        const saved = verifiedPending(); ownPendingChange.current = true;
        try { if (value.outcome === "accepted") persist(owner, { ...saved, jobId: value.jobId }, true); else release(owner, operation.operationId); }
        finally { ownPendingChange.current = false; }
      }, request.signal);
    }
    if (!request.current()) return;
    if (value.outcome === "accepted") {
      setMessage("服务端已受理，尚未发布新快照。每 5 秒只查询本次操作进度。");
    } else if (value.outcome === "unknown") {
      setOptions(null); setMessage("采集结果仍未知。保留原操作编号，不自动重新提交；请检查原操作或明确永久取消。");
    } else {
      setOptions(null); setCancelAcknowledged(false);
      const confirmed = value.outcome === "committed" ? "已确认保存新快照；已打开的库存视图将按原筛选重新读取。" : value.outcome === "cancelled" ? "服务端已确认永久取消；迟到的原操作不能继续发布。再次采集前请重新检查权限和来源。" : "本次采集失败，上一份已保存快照未被替换。再次采集前请重新检查权限和来源。";
      setMessage(confirmed + (hasPendingLocks() ? "" : " 当前浏览器不支持安全锁，本机恢复记录未释放；请在支持安全锁的浏览器环境核对后释放，不重复启动。"));
      if (value.outcome === "committed" && value.snapshotId !== null && !notified.current.has(operation.operationId)) {
        notified.current.add(operation.operationId); publishInventorySnapshotChange({ userId: owner.userId, workspaceId: owner.workspaceId, snapshotId: value.snapshotId });
      }
    }
    setResult(value);
  }
  async function refresh() {
    if (lane.current.busy || storageError || pending || !hasPendingLocks() || !options || options.capabilities.refresh.status !== "available") return;
    let reserved = false;
    const request = begin(); setMessage(""); setResult(null);
    try {
      const operation = await withPendingLock(owner, () => {
        if (!request.current() || readInventorySnapshotPending(owner)) throw new Error("AN_OPERATION_IS_PENDING");
        const value = PendingSchema.parse({ version: 1, userId: owner.userId, workspaceId: owner.workspaceId, operationId: crypto.randomUUID(), jobId: null });
        ownPendingChange.current = true;
        try { persist(owner, value); reserved = true; }
        finally { ownPendingChange.current = false; }
        return value;
      }, request.signal);
      if (!request.current()) return;
      const input = InventorySnapshotRefreshStartInputSchema.parse({ expectedWorkspaceId: owner.workspaceId, operationId: operation.operationId, expectedSnapshotKey: options.snapshot.key, expectedConnectionVersion: options.connectionVersion, expectedMappingVersion: options.mappingVersion });
      const raw = await client.inventorySnapshotRefresh.refresh.mutate(input, { signal: request.signal });
      if (request.current()) await accept(raw, operation, request);
    } catch { if (request.current()) {
      setOptions(null); setResult(null);
      if (reserved) setMessage("未获得可核验采集回执，结果未知。原编号已保留；不自动重发，只能查询或永久取消。");
      else { setStorageError(true); setMessage("无法安全保存恢复编号，未发起新采集。请保留现有恢复记录并排查浏览器存储。"); }
    } }
    finally { if (request.current()) { lane.current.busy = false; setBusy(false); } }
  }
  async function recover(decision: "read" | "check" | "cancel") {
    if (lane.current.busy || storageError || decision === "cancel" && !cancelAcknowledged) return;
    let operation: Pending | null;
    try { operation = readInventorySnapshotPending(owner); if (!operation) return; }
    catch { setStorageError(true); return; }
    if (pending?.operationId !== operation.operationId) {
      stop(); setPending(operation); setOptions(null); setResult(null); setCancelAcknowledged(false);
      setMessage("恢复编号已在其他窗口变化，未发送操作。请重新核对当前编号并确认。"); return;
    }
    const request = begin(); setMessage("");
    try {
      const input = { expectedWorkspaceId: owner.workspaceId, operationId: operation.operationId };
      const raw = decision === "read" ? await client.inventorySnapshotRefresh.readRun.query(input, { signal: request.signal })
        : await client.inventorySnapshotRefresh.recover.mutate({ ...input, decision }, { signal: request.signal });
      if (request.current()) await accept(raw, operation, request);
    } catch { if (request.current()) { setOptions(null); setResult(null); setMessage("进度或恢复核对失败，身份、权限或回执可能变化。原编号仍保留，请显式重新核对；不会自动重新采集。"); } }
    finally { if (request.current()) { lane.current.busy = false; setBusy(false); } }
  }
  poll.current = () => { void recover("read"); };
  return <Shell>
    <div className="flex flex-wrap gap-2"><button type="button" aria-label="检查库存采集权限与来源" className={buttonClass} disabled={busy} onClick={() => void checkOptions()}>检查连接</button>
      <button type="button" aria-label="明确开始全来源库存采集" className={`${buttonClass} bg-primary text-primary-foreground`} disabled={busy || storageError || !!pending || !hasPendingLocks() || options?.capabilities.refresh.status !== "available"} onClick={() => void refresh()}>刷新赛狐库存</button>
    </div>
    {!options && <p className="text-xs text-muted-foreground">先检查连接，再刷新库存。</p>}
    {!hasPendingLocks() && <p role="alert">当前浏览器不支持安全跨窗口锁，禁止新采集；不会降级为无锁提交。已有编号仍可向服务端核对或取消，本机记录保留。</p>}
    {options && <div className="space-y-2 text-sm"><p>{options.capabilities.refresh.status === "available" ? "连接正常，可以更新库存。" : "暂时无法更新，请检查赛狐配置或联系管理员。"}</p>
      {options.snapshot.status !== "ready" && <p>{options.snapshot.status === "not_found" ? "还没有库存数据，请先刷新。" : "现有库存数据需要核对，请联系管理员。"}</p>}
    </div>}
    {storageError && <p role="alert">本机恢复记录损坏、身份不一致或存储不可用，已禁止新采集。未删除或覆盖原记录；需要排查后重新打开。</p>}
    {pending && <section aria-label="库存采集操作恢复" className="min-w-0 space-y-3 rounded border p-3 text-sm">
      <p>有一次库存更新尚未完成，请先查看进度或核对结果。</p>
      <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={busy || storageError} onClick={() => void recover("read")}>读取本次采集进度</button>
        <button type="button" className={buttonClass} disabled={busy || storageError} onClick={() => void recover("check")}>检查原采集结果</button>
      </div>
      <label className="flex items-start gap-2"><input type="checkbox" checked={cancelAcknowledged} onChange={event => setCancelAcknowledged(event.currentTarget.checked)} />确认永久取消此操作，只有服务端确认取消后才能释放原编号</label>
      <button type="button" className={buttonClass} disabled={busy || storageError || !cancelAcknowledged} onClick={() => void recover("cancel")}>永久取消原采集操作</button>
    </section>}
    {busy && <div className="space-y-2"><p role="status">正在核对采集状态…</p><button type="button" className={buttonClass} onClick={() => { stop(); setOptions(null); setResult(null); setMessage("已停止本次等待，不等于服务端已取消。若存在原操作编号，请显式核对结果。"); }}>停止等待（不取消服务端）</button></div>}
    {message && <p role="status" className="break-words text-sm">{message}</p>}
    {result && <section aria-label="本次库存采集状态" className="space-y-2 text-sm">
      <p>状态：{({ accepted: result.state === "queued" ? "后台排队中，尚未发布" : "采集中，尚未发布", committed: "已保存新快照", failed: "采集失败，旧快照保留", cancelled: "已永久取消", unknown: "结果未知，需核对" })[result.outcome]}</p>
      {result.outcome !== "unknown" && <><p>已完成来源：{result.progress.completedSources} / {result.progress.totalSources}；{result.progress.source ? `当前来源：${sourceLabels[result.progress.source]}` : "当前未指定来源"}</p><progress aria-label="库存来源采集进度" max={10} value={result.progress.completedSources} className="w-full max-w-md" /></>}
      {result.outcome === "committed" && <p>库存已更新，下方列表将显示最新数据。</p>}
      {result.reasonCode && <p>{reasonLabels[result.reasonCode] || "本次更新需要进一步核对，请联系管理员。"}</p>}
    </section>}
  </Shell>;
}
/** Authless controller for explicit embedding and synthetic UI acceptance. */
export function InventorySnapshotRefreshController({ owner }: { owner: InventorySnapshotRefreshOwner }) {
  const stableOwner = useMemo(() => ({ userId: owner.userId, workspaceId: owner.workspaceId, role: owner.role }), [owner.userId, owner.workspaceId, owner.role]);
  if (!positiveId(owner.userId) || !positiveId(owner.workspaceId) || !isManager(owner.role)) return <Shell><p role="alert">库存采集需要有效工作区和管理角色。</p></Shell>;
  return <OwnedInventorySnapshotRefresh key={JSON.stringify([owner.userId, owner.workspaceId, owner.role])} owner={stableOwner} />;
}
export default function InventorySnapshotRefresh() {
  const auth = useAuth(), permissions = usePermissions();
  if (auth.loading || permissions.isLoading) return <Shell><p role="status">正在确认库存采集身份与权限…</p></Shell>;
  const user = auth.user;
  if (auth.error || !user || !positiveId(user.id) || !positiveId(user.defaultWorkspaceId) || !isManager(user.role)) return <Shell><p role="alert">库存采集需要有效用户、工作区及管理角色，旧采集信息已隐藏。</p></Shell>;
  if (!permissions.canRead("ops", "ops_dashboard") || !permissions.canRead("ops", "ops_inventory")) return <Shell><p role="alert">缺少库存采集读取权限，旧采集信息已隐藏。</p></Shell>;
  return <InventorySnapshotRefreshController owner={{ userId: user.id, workspaceId: user.defaultWorkspaceId, role: user.role }} />;
}
