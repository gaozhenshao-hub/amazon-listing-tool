import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  OperationsCostSheetPayloadSchema, OperationsCostSheetScopeSchema,
  calculateOperationsCostSheetProfit, calculateOperationsCostSheetFreight, estimateOperationsCostSheetFba,
  type OperationsCostSheetPayload, type OperationsCostSheetRowInput, type OperationsCostSheetScope,
} from "@shared/operationsCostSheetRead";
import {
  OperationsCostSheetWriteOptionsInputSchema, OperationsCostSheetWriteOptionsResultSchema, OperationsCostSheetWriteResultSchema,
  initializeOperationsCostSheetDraft, createOperationsCostSheetDraftRow, validateOperationsCostSheetWriteAgainstReadResult,
  type OperationsCostSheetWriteOptionsResult,
} from "@shared/operationsCostSheetWrite";

export type OperationsCostSheetActionOwner = { userId: number; workspaceId: number; role: string };
type Notice = { userId: number; scope: OperationsCostSheetScope };
const changes = new Set<(notice: Notice) => void>();
const pendingChanges = new Set<() => void>();
export function subscribeOperationsCostSheetChanges(listener: (notice: Notice) => void) {
  changes.add(listener); return () => { changes.delete(listener); };
}
const sameScope = (a: OperationsCostSheetScope, b: OperationsCostSheetScope) => a.workspaceId === b.workspaceId && a.storeName === b.storeName && a.country === b.country && a.parentAsin === b.parentAsin;
const PendingSchema = z.object({ version: z.literal(1), userId: z.number().int().positive(), scope: OperationsCostSheetScopeSchema, operationId: z.string().uuid() }).strict();
type Pending = z.infer<typeof PendingSchema>;
const pendingKey = (owner: OperationsCostSheetActionOwner, scope: OperationsCostSheetScope) => `operations-cost-write:v1:${JSON.stringify([owner.userId, scope.workspaceId, scope.storeName, scope.country, scope.parentAsin])}`;
/** Recovery metadata only: no row values, drafts, source observations or URLs. */
export function readOperationsCostSheetPending(owner: OperationsCostSheetActionOwner, scope: OperationsCostSheetScope): Pending | null {
  const raw = localStorage.getItem(pendingKey(owner, scope));
  if (raw === null) return null;
  if (raw.length > 4096) throw new Error("Invalid recovery metadata");
  const parsed = PendingSchema.parse(JSON.parse(raw));
  if (parsed.userId !== owner.userId || !sameScope(parsed.scope, scope)) throw new Error("Recovery scope mismatch");
  return parsed;
}
function claimPending(owner: OperationsCostSheetActionOwner, scope: OperationsCostSheetScope, operationId: string) {
  if (readOperationsCostSheetPending(owner, scope)) throw new Error("An operation is already pending");
  localStorage.setItem(pendingKey(owner, scope), JSON.stringify({ version: 1, userId: owner.userId, scope, operationId }));
  if (readOperationsCostSheetPending(owner, scope)?.operationId !== operationId) throw new Error("Recovery storage failed");
  pendingChanges.forEach(listener => listener());
}
function releasePending(owner: OperationsCostSheetActionOwner, scope: OperationsCostSheetScope, operationId: string) {
  if (readOperationsCostSheetPending(owner, scope)?.operationId === operationId) localStorage.removeItem(pendingKey(owner, scope));
  pendingChanges.forEach(listener => listener());
}
const FIELDS = [
  ["productCost", "产品成本（人民币 / 件）"], ["packagingCost", "包装成本（人民币 / 件）"],
  ["weightKg", "重量（kg）"], ["lengthCm", "长（cm）"], ["widthCm", "宽（cm）"], ["heightCm", "高（cm）"],
  ["actualFreight", "实际运费（人民币 / 件）"], ["actualFba", "实际 FBA（结算币种 / 件）"],
] as const;
type RowField = typeof FIELDS[number][0];
type RawRow = { key: string } & Record<RowField, string>;
type Draft = { settings: { cnyPerCurrency: string; freightRate: string; standardGoodsConfirmed: boolean }; rows: RawRow[] };
const text = (value: number | null | undefined) => value == null ? "" : String(value);
const shown = (value: number | string | null | undefined) => value == null ? "未提供" : String(value);
const rowDraft = (row: OperationsCostSheetRowInput): RawRow => ({ key: row.key, productCost: text(row.productCost), packagingCost: text(row.packagingCost), weightKg: text(row.weightKg), lengthCm: text(row.lengthCm), widthCm: text(row.widthCm), heightCm: text(row.heightCm), actualFreight: text(row.actualFreight), actualFba: text(row.actualFba) });
function draftFromPayload(payload: OperationsCostSheetPayload): Draft {
  return { settings: { cnyPerCurrency: text(payload.settings.cnyPerCurrency), freightRate: String(payload.settings.freightRate), standardGoodsConfirmed: payload.settings.standardGoodsConfirmed }, rows: payload.rows.map(rowDraft) };
}
const numeric = (value: string, nullable = true) => value.trim() === "" ? nullable ? null : NaN : /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) ? Number(value) : NaN;
function parseDraft(draft: Draft) {
  return OperationsCostSheetPayloadSchema.safeParse({
    settings: { cnyPerCurrency: numeric(draft.settings.cnyPerCurrency), freightRate: numeric(draft.settings.freightRate, false), standardGoodsConfirmed: draft.settings.standardGoodsConfirmed },
    rows: draft.rows.map(row => ({ key: row.key, ...Object.fromEntries(FIELDS.map(([key]) => [key, numeric(row[key])])) })),
  });
}
function draftDifferences(base: Draft, next: Draft) {
  const differences: { row: string | null; field: string; before: string | boolean; after: string | boolean }[] = [];
  for (const field of ["cnyPerCurrency", "freightRate", "standardGoodsConfirmed"] as const) if (base.settings[field] !== next.settings[field]) differences.push({ row: null, field, before: base.settings[field], after: next.settings[field] });
  for (const row of next.rows) {
    const previous = base.rows.find(item => item.key === row.key) ?? rowDraft(createOperationsCostSheetDraftRow(row.key));
    for (const [field] of FIELDS) if (previous[field] !== row[field]) differences.push({ row: row.key, field, before: previous[field], after: row[field] });
    // An explicitly edited empty row is preserved too, even when all values are null.
    if (!base.rows.some(item => item.key === row.key) && FIELDS.every(([field]) => previous[field] === row[field])) differences.push({ row: row.key, field: "row", before: "未保存行", after: "明确空行" });
  }
  return differences;
}
const countryCurrency: Record<string, string> = { US: "USD", CA: "CAD", MX: "MXN", UK: "GBP", DE: "EUR", FR: "EUR", IT: "EUR", ES: "EUR", JP: "JPY", AU: "AUD" };
const buttonClass = "min-h-10 rounded border px-3 py-2 text-sm disabled:opacity-50";
const cellClass = "border-b p-2 align-top whitespace-pre-wrap break-words";
const negative = (value: number | null | undefined) => value != null && value < 0 ? "font-semibold text-red-700" : "";

/** Scope-keyed controller. Reads require an explicit click. Props are not
 * authority: options/save/recover each re-authorize on the server. */
export function OperationsCostSheetActions(props: { owner: OperationsCostSheetActionOwner; scope: OperationsCostSheetScope }) {
  const parsed = OperationsCostSheetScopeSchema.safeParse(props.scope);
  if (!parsed.success || parsed.data.workspaceId !== props.owner.workspaceId || !Number.isSafeInteger(props.owner.userId) || props.owner.userId <= 0 || props.owner.userId > 2147483647 || !props.owner.role) return <p role="alert">成本编辑范围不合法，未发起请求。</p>;
  return <OwnedActions key={JSON.stringify([props.owner.userId, props.owner.workspaceId, props.owner.role, parsed.data])} owner={props.owner} scope={parsed.data} />;
}
function OwnedActions({ owner, scope }: { owner: OperationsCostSheetActionOwner; scope: OperationsCostSheetScope }) {
  const client = trpc.useUtils().client;
  const input = OperationsCostSheetWriteOptionsInputSchema.parse({ expectedWorkspaceId: scope.workspaceId, storeName: scope.storeName, country: scope.country, parentAsin: scope.parentAsin });
  const [base, setBase] = useState<OperationsCostSheetWriteOptionsResult | null>(null), [latest, setLatest] = useState<OperationsCostSheetWriteOptionsResult | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null), [open, setOpen] = useState(false), [closePrompt, setClosePrompt] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [pending, setPending] = useState<Pending | null>(null), [storageError, setStorageError] = useState(false), [page, setPage] = useState(0);
  const alive = useRef(true), sequence = useRef(0), controller = useRef<AbortController | null>(null);
  const baseRef = useRef(base), draftRef = useRef(draft), ownChange = useRef(false);
  const callbacks = useRef({ loadOptions }); callbacks.current = { loadOptions };
  baseRef.current = base; draftRef.current = draft;
  const baseDraft = base?.snapshotKey ? draftFromPayload(initializeOperationsCostSheetDraft(base.readResult)) : null;
  const dirty = !!(draft && baseDraft && JSON.stringify(draft) !== JSON.stringify(baseDraft));
  const parsed = draft ? parseDraft(draft) : null;
  const canSave = base?.capabilities.save.status === "available" && !!base.snapshotKey;
  const pendingId = pending?.operationId;

  useEffect(() => {
    const load = () => { try { setPending(readOperationsCostSheetPending(owner, scope)); setStorageError(false); } catch { setStorageError(true); } };
    load(); pendingChanges.add(load);
    const storage = (event: StorageEvent) => { if (event.key === null || event.key === pendingKey(owner, scope)) load(); };
    window.addEventListener("storage", storage);
    return () => { pendingChanges.delete(load); window.removeEventListener("storage", storage); };
  }, [owner, scope]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; controller.current?.abort(); };
  }, []);
  useEffect(() => subscribeOperationsCostSheetChanges(notice => {
    if (notice.userId !== owner.userId || !sameScope(notice.scope, scope) || ownChange.current || !baseRef.current) return;
    const original = baseRef.current.snapshotKey ? draftFromPayload(initializeOperationsCostSheetDraft(baseRef.current.readResult)) : null;
    if (draftRef.current && original && JSON.stringify(draftRef.current) !== JSON.stringify(original)) {
      setMessage("同范围成本已在另一入口更新。当前草稿保留，请刷新最新版本对比后处理冲突。");
    } else { void callbacks.current.loadOptions(false); }
  }), [owner.userId, scope]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  function start() { sequence.current++; controller.current?.abort(); const signal = new AbortController(); controller.current = signal; setBusy(true); const ticket = sequence.current; return { signal: signal.signal, current: () => alive.current && ticket === sequence.current && !signal.signal.aborted }; }
  function validOwner(value: { identity: { userId: number; workspaceId: number }; scope: OperationsCostSheetScope }) { return value.identity.userId === owner.userId && value.identity.workspaceId === owner.workspaceId && sameScope(value.scope, scope); }
  function install(value: OperationsCostSheetWriteOptionsResult) {
    setBase(value); setLatest(null); setPage(0);
    setDraft(value.snapshotKey ? draftFromPayload(initializeOperationsCostSheetDraft(value.readResult)) : null);
  }
  async function loadOptions(compare: boolean, minimumVersion = 0, committedSnapshot: string | null = null) {
    const request = start();
    try {
      const value = OperationsCostSheetWriteOptionsResultSchema.parse(await client.productCostsWrite.options.query(input, { signal: request.signal }));
      if (!request.current()) return;
      if (!validOwner(value)) throw new Error("Scope changed");
      if ((value.readResult.saved?.version ?? 0) < minimumVersion) throw new Error("Stale saved version");
      if (compare && baseRef.current && draftRef.current) { setLatest(value); setMessage("最新版本已读取；原草稿未覆盖。请对比后显式合并本地改动，或放弃草稿。"); }
      else {
        install(value);
        const refreshed = minimumVersion > 0 ? value.readResult.saved?.version === minimumVersion && committedSnapshot && committedSnapshot !== value.snapshotKey
          ? "提交已确认；保存后的来源又发生变化，现已重读最新来源，请重新核对测算。" : `提交已确认，已刷新当前版本 ${value.readResult.saved?.version}。` : "";
        setMessage(`${refreshed}${value.capabilities.save.status === "available" ? "当前范围已核验，可以打开完整成本编辑。" : `当前暂不可保存：${value.capabilities.save.reasonCode}。未自动写入或替换缺失数据。`}`);
      }
    } catch {
      if (request.current()) { setBase(null); setLatest(null); setDraft(null); setOpen(false); setMessage(minimumVersion > 0 ? "保存提交已确认，但刷新权限、范围或最新完整版本失败；未展示旧版本。请显式检查成本编辑权限重读，不要重复提交。" : "成本权限、范围或完整来源核验失败；旧数据和草稿已隐藏。如有待处理操作，其编号仍保留，需显式核验恢复。"); }
    } finally { if (request.current()) setBusy(false); }
  }
  function publish() {
    ownChange.current = true;
    try { changes.forEach(listener => listener({ userId: owner.userId, scope })); } finally { ownChange.current = false; }
  }
  async function applyReceipt(raw: unknown, operationId: string) {
    const receipt = OperationsCostSheetWriteResultSchema.parse(raw);
    if (!validOwner(receipt) || receipt.operationId !== operationId) throw new Error("Receipt mismatch");
    if (receipt.status === "unknown") { setMessage(`保存结果尚未确认（${receipt.reasonCode}）。禁止重新生成操作编号提交；请检查结果或确认取消。`); return; }
    releasePending(owner, scope, operationId);
    if (receipt.status === "committed") {
      setDraft(null); setBase(null); setLatest(null); setOpen(false); setClosePrompt(false);
      setMessage(`成本保存已确认，版本 ${receipt.version}；正在刷新本范围。`); publish(); await loadOptions(false, receipt.version!, receipt.snapshotKey);
    } else setMessage("服务端已确认取消并封锁迟到的原操作。草稿仍保留，可核验版本后重新保存。");
  }
  async function save() {
    if (busy || pending || storageError || !canSave || !base || !draft || !parsed?.success || !dirty) return;
    let operationId: string;
    try {
      operationId = crypto.randomUUID();
      const saveInput = validateOperationsCostSheetWriteAgainstReadResult({ ...input, operationId, expectedVersion: base.readResult.saved?.version ?? 0, expectedSnapshotKey: base.snapshotKey!, payload: parsed.data }, base.readResult, base.snapshotKey!);
      claimPending(owner, scope, operationId);
      const request = start();
      try {
        const receipt = await client.productCostsWrite.save.mutate(saveInput, { signal: request.signal });
        if (!request.current()) return;
        await applyReceipt(receipt, operationId);
      } catch {
        if (request.current()) setMessage("保存结果未确认，可能是版本冲突、权限变化或网络中断。草稿和原操作编号已保留，不自动重试。先检查结果；冲突时可刷新最新版本对比，取消须取得服务端确认。");
      } finally { if (request.current()) setBusy(false); }
    } catch { setMessage("草稿不符合完整成本契约，或恢复记录无法安全保存。未发送保存请求；请检查数值、行数、孤立行及本机存储。"); }
  }
  async function recover(decision: "check" | "cancel") {
    if (busy || !pendingId) return;
    const request = start();
    try {
      const receipt = await client.productCostsWrite.recover.mutate({ ...input, operationId: pendingId, decision }, { signal: request.signal });
      if (request.current()) await applyReceipt(receipt, pendingId);
    } catch { if (request.current()) setMessage("恢复请求未获可信确认，原操作编号仍锁定。未重新提交或释放取消锁；请核对身份后再次检查。"); }
    finally { if (request.current()) setBusy(false); }
  }
  function changeRow(key: string, field: RowField, value: string) {
    setDraft(previous => {
      if (!previous) return previous;
      const row = previous.rows.find(item => item.key === key) ?? rowDraft(createOperationsCostSheetDraftRow(key));
      return { ...previous, rows: previous.rows.some(item => item.key === key) ? previous.rows.map(item => item.key === key ? { ...row, [field]: value } : item) : [...previous.rows, { ...row, [field]: value }] };
    });
  }
  function close() { if (dirty) { setClosePrompt(true); return; } setOpen(false); }
  function discard() { if (base) install(latest ?? base); setClosePrompt(false); setOpen(false); }
  function mergeLatest() {
    if (!latest?.snapshotKey || !baseDraft || !draft || pending || busy) return;
    const merged = draftFromPayload(initializeOperationsCostSheetDraft(latest.readResult));
    for (const diff of draftDifferences(baseDraft, draft)) {
      if (diff.row === null) Object.assign(merged.settings, { [diff.field]: diff.after });
      else {
        let row = merged.rows.find(item => item.key === diff.row);
        if (!row) { row = rowDraft(createOperationsCostSheetDraftRow(diff.row)); merged.rows.push(row); }
        if (diff.field !== "row") Object.assign(row, { [diff.field]: diff.after });
      }
    }
    const payload = parseDraft(merged);
    try {
      if (!payload.success) throw new Error("Invalid merged draft");
      validateOperationsCostSheetWriteAgainstReadResult({ ...input, operationId: crypto.randomUUID(), expectedVersion: latest.readResult.saved?.version ?? 0, expectedSnapshotKey: latest.snapshotKey, payload: payload.data }, latest.readResult, latest.snapshotKey);
      setBase(latest); setLatest(null); setDraft(merged); setMessage("已采用最新完整版本并只合并本地改动，尚未保存；请复核后明确保存。");
    } catch { setMessage("无法安全合并：来源行可能已失效、变为孤立行或超过限制。原草稿保留，请对比后手动处理，不会覆盖最新成本。"); }
  }
  const rows = base?.readResult.rows ?? [], pages = Math.max(1, Math.ceil(rows.length / 20)), currentPage = Math.min(page, pages - 1);
  const differences = baseDraft && draft ? draftDifferences(baseDraft, draft) : [];
  return <section aria-label="完整成本编辑入口" className="manus-no-record my-3 min-w-0 max-w-full space-y-3 rounded border p-3">
    <h4 className="font-medium">产品完整成本 · {scope.parentAsin}</h4>
    <p className="break-words text-xs">{scope.storeName} / {scope.country} · 工作区 {scope.workspaceId}。读取摘要与编辑前逐次核验权限；不自动保存。</p>
    <button type="button" className={buttonClass} disabled={busy} onClick={() => void loadOptions(dirty || !!pending)}>检查成本编辑权限</button>
    {message && <p role="status" className="break-words text-sm">{message}</p>}
    {storageError && <p role="alert">恢复记录无法读取，已阻止新保存。请先恢复本机存储，不会静默清除未知操作。</p>}
    {pending && <div role="status" className="space-y-2 rounded border border-amber-600 p-3 text-sm"><p className="break-all">存在未确认的成本操作：{pending.operationId}。即使发布开关关闭，也可检查结果或请求取消；未收到最终确认前不能再次保存。</p>
      <button type="button" disabled={busy} className={buttonClass} onClick={() => void recover("check")}>检查成本保存结果</button>{" "}
      <button type="button" disabled={busy} className={buttonClass} onClick={() => void recover("cancel")}>请求取消未确认保存</button>
    </div>}
    {base && <>
      <p className="text-xs">{base.readResult.status === "saved" ? `当前保存版本 ${base.readResult.saved!.version}` : base.readResult.status === "not_saved" ? "尚未保存；运费单价 9 仅为未保存草稿默认值，不是来源事实。" : `不可编辑来源：${base.readResult.status}`} · {base.readResult.rows.length} 行（包含保存孤立行）</p>
      <div role="region" aria-label="产品成本摘要" tabIndex={0} className="max-h-64 min-w-0 max-w-full overflow-auto rounded border"><table className="w-full min-w-[440px] text-sm"><thead className="sticky top-0 bg-muted"><tr><th className="p-2 text-left">商品 / SKU</th><th>单件测算毛利</th><th>测算毛利率</th></tr></thead><tbody>{rows.map(row => <tr key={row.key}><td className="p-2"><button type="button" disabled={!canSave || busy} className="text-left underline decoration-dotted" onClick={() => setOpen(true)}>{row.name || row.sku || row.key}</button>{row.orphaned && " · 保存孤立行"}</td><td className={negative(row.profit?.profit)}>{row.profit ? `${row.profit.profit.toFixed(2)} ${row.currency}` : "未计算"}</td><td className={negative(row.profit?.margin)}>{row.profit?.margin == null ? "未提供" : `${row.profit.margin.toFixed(2)}%`}</td></tr>)}</tbody></table></div>
      {canSave ? <button type="button" className={buttonClass} disabled={busy} onClick={() => setOpen(true)}>打开完整成本编辑</button> : <p className="text-sm">当前保存能力不可用：{base.capabilities.save.reasonCode}。未连接、损坏或不完整来源不会被默认成本修复。</p>}
    </>}
    <Dialog open={open} onOpenChange={value => { if (value) setOpen(true); else close(); }}>
      <DialogContent className="grid w-[calc(100vw-2rem)] max-w-[96vw] min-w-0 grid-cols-1 gap-3 max-h-[90vh] overflow-y-auto [&>*]:min-w-0 [&>*]:max-w-full" onInteractOutside={event => { if (dirty || busy) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>完整成本编辑</DialogTitle><DialogDescription className="break-words">{scope.parentAsin} · {scope.storeName} · {scope.country}。固定15%佣金假设下的单件测算，非会计利润。预测运费和预测 FBA 不参与实际利润；空值不是零。</DialogDescription></DialogHeader>
        {base && draft && <>
          <p className="text-xs">基准版本 {base.readResult.saved?.version ?? "尚未保存"} · 规则日期 {base.readResult.asOfDate} · 完整输入 {draft.rows.length} / 500 行，上限 1 MiB。孤立行完整保留且只读。</p>
          {base.readResult.status === "not_saved" && <p className="text-sm">运费单价 9 仅为本次未保存草稿默认值；汇率及成本均未提供，不自动回填报表费用。</p>}
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="min-w-0 text-sm">结算币种兑人民币汇率<input aria-label="编辑结算币种兑人民币汇率" inputMode="decimal" className="block w-full min-w-0 rounded border p-2" value={draft.settings.cnyPerCurrency} disabled={busy || !!pending} onChange={event => setDraft({ ...draft, settings: { ...draft.settings, cnyPerCurrency: event.target.value } })} /></label>
            <label className="min-w-0 text-sm">预测运费单价（人民币 / kg）<input aria-label="编辑预测运费单价" inputMode="decimal" className="block w-full min-w-0 rounded border p-2" value={draft.settings.freightRate} disabled={busy || !!pending} onChange={event => setDraft({ ...draft, settings: { ...draft.settings, freightRate: event.target.value } })} /></label>
            <label className="flex min-w-0 items-center gap-2 text-sm"><input type="checkbox" checked={draft.settings.standardGoodsConfirmed} disabled={busy || !!pending} onChange={event => setDraft({ ...draft, settings: { ...draft.settings, standardGoodsConfirmed: event.target.checked } })} />确认普通非服装、非危险品（用于 FBA 预测）</label>
          </div>
          {parsed && !parsed.success && <p role="alert">输入不合法：金额必须为非负数，尺寸重量和汇率必须大于零；运费单价不能为空。最多 500 行、1 MiB，不截断或把非法值补零。当前暂不测算或保存。</p>}
          <p className="text-xs">全部来源、成本和尺寸逐页完整保留。实际 FBA 为明确保存输入；旁列报表 FBA 仅供核对，不能自动代填。固定朋友版 FBA 规则并非最新官方认证。</p>
          <div role="region" aria-label="完整成本编辑横向表" tabIndex={0} className="max-h-[50vh] min-w-0 max-w-full overflow-auto rounded border">
            <table className="w-full min-w-[2200px] text-left text-xs"><thead className="sticky top-0 z-10 bg-muted"><tr>{["商品 / SKU / 来源", "售价 / 币种", ...FIELDS.map(([, label]) => label), "预测运费", "预测 FBA", "报表实际 FBA", "草稿测算毛利 / 率"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
              <tbody>{rows.slice(currentPage * 20, (currentPage + 1) * 20).map(row => {
                const raw = draft.rows.find(value => value.key === row.key) ?? rowDraft(createOperationsCostSheetDraftRow(row.key));
                const values = parsed?.success ? parsed.data.rows.find(value => value.key === row.key) : null;
                const settings = parsed?.success ? parsed.data.settings : null;
                const eligible = !!row.fact && !row.orphaned && !row.ambiguous && !row.currencyMismatch && !row.sourceConflict && row.currency !== null && countryCurrency[scope.country] === row.currency;
                const profit = values && settings && eligible ? calculateOperationsCostSheetProfit(row.fact!.price, values.actualFba, values, settings) : null;
                const freight = values && settings ? calculateOperationsCostSheetFreight(values, settings.freightRate) : null;
                const fba = settings ? estimateOperationsCostSheetFba(values ?? null, row.fact?.price ?? null, scope.country, settings.standardGoodsConfirmed, base.readResult.asOfDate) : null;
                return <tr key={row.key}><td className={`${cellClass} max-w-80`}><strong>{row.name || "名称未提供"}</strong><br />SKU：{shown(row.sku)}<br />键：{row.key}<br />{row.orphaned ? "保存孤立行 · 只读完整保留" : "当前来源行"}<br />{row.ambiguous && "匹配歧义；"}{row.currencyMismatch && "币种冲突；"}{row.sourceConflict && "同日来源冲突；"}
                  <details><summary>全部 {row.observations.length} 条来源观测</summary><pre className="max-w-72 whitespace-pre-wrap break-all">{JSON.stringify(row.observations, null, 2)}</pre></details></td>
                  <td className={cellClass}>{shown(row.fact?.price)} {shown(row.currency)}</td>
                  {FIELDS.map(([field, label]) => <td key={field} className={cellClass}>{row.orphaned ? shown(row.input?.[field]) : <input aria-label={`${row.key} ${label}`} inputMode="decimal" className="w-28 min-w-0 max-w-full rounded border bg-background p-2" value={raw[field]} disabled={busy || !!pending} onChange={event => changeRow(row.key, field, event.target.value)} />}</td>)}
                  <td className={cellClass}>{freight ? <>{freight.cost.toFixed(2)} CNY<br />计费重 {freight.billableKg.toFixed(4)} kg</> : "缺少有效设置 / 尺寸重量"}</td>
                  <td className={`${cellClass} max-w-64`}>{shown(fba?.fee)} USD<br />{fba?.reason ?? "输入不合法，暂不预测"}</td>
                  <td className={cellClass}>{shown(row.fact?.actualFba)} {shown(row.currency)}</td>
                  <td className={`${cellClass} ${negative(profit?.profit)}`}>{profit ? <>{profit.profit.toFixed(2)} {row.currency}<br />{profit.margin == null ? "未提供" : `${profit.margin.toFixed(2)}%`}</> : <>未计算<br />{eligible ? "缺必要成本 / 汇率 / 售价" : row.profitUnavailableReason || "来源、币种不完整或存在冲突"}</>}</td>
                </tr>;
              })}</tbody></table>
          </div>
          <nav aria-label="成本编辑行分页" className="flex flex-wrap items-center gap-3"><span>完整 {rows.length} 行 · 第 {currentPage + 1} / {pages} 页</span><button type="button" className={buttonClass} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页编辑行</button><button type="button" className={buttonClass} disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>下一页编辑行</button></nav>
          {message && <p role="status" className="break-words text-sm">{message}</p>}
          {pending && <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={busy} onClick={() => void recover("check")}>检查本次保存结果</button><button type="button" className={buttonClass} disabled={busy} onClick={() => void recover("cancel")}>确认请求取消本次保存</button></div>}
          <button type="button" className={buttonClass} disabled={busy} onClick={() => void loadOptions(true)}>刷新最新版本对比（保留草稿）</button>
          {latest && <section aria-label="成本版本冲突对比" className="min-w-0 space-y-2 rounded border p-3 text-sm"><p>草稿基准 {base.readResult.saved?.version ?? 0} → 最新 {latest.readResult.saved?.version ?? 0}。只合并明确修改的字段，未改字段采用最新版本；不会静默覆盖他人更改。</p><p>最新保存能力：{latest.capabilities.save.status} {latest.capabilities.save.reasonCode}</p>
            <div className="max-h-64 overflow-auto"><table className="min-w-[500px] text-left text-xs"><thead><tr><th>行 / 字段</th><th>原值</th><th>最新保存值</th><th>本地草稿</th></tr></thead><tbody>{differences.map((diff, index) => {
              const current = latest.snapshotKey ? draftFromPayload(initializeOperationsCostSheetDraft(latest.readResult)) : null;
              const value = diff.row === null ? current?.settings[diff.field as keyof Draft["settings"]] : current?.rows.find(row => row.key === diff.row)?.[diff.field as RowField];
              return <tr key={index}><td className="p-2 break-all">{diff.row ?? "设置"} / {diff.field}</td><td>{String(diff.before) || "未提供"}</td><td>{value === undefined || value === "" ? "未提供" : String(value)}</td><td>{String(diff.after) || "未提供"}</td></tr>;
            })}</tbody></table></div><button type="button" className={buttonClass} disabled={!!pending || busy || latest.capabilities.save.status !== "available"} onClick={mergeLatest}>采用最新版本并合并本地改动</button>{pending && <p>须先取得原操作的最终提交 / 取消确认，才能合并并再次保存。</p>}</section>}
          {closePrompt && <div role="alert" className="space-y-2 rounded border border-amber-600 p-3"><p>有未保存修改，是否放弃草稿并关闭？未知保存操作不会因此取消，恢复编号仍保留。</p><button type="button" className={buttonClass} onClick={() => setClosePrompt(false)}>继续编辑草稿</button>{" "}<button type="button" className={buttonClass} onClick={discard}>放弃草稿并关闭</button></div>}
          <div className="flex flex-wrap justify-end gap-2"><button type="button" className={buttonClass} disabled={busy} onClick={close}>关闭成本编辑</button><button type="button" className={buttonClass} disabled={busy || !!pending || storageError || !canSave || !dirty || !parsed?.success || !!latest} onClick={() => void save()}>保存完整成本</button></div>
        </>}
      </DialogContent>
    </Dialog>
  </section>;
}

/** Lazy product-card entry: mounting never fetches financial or cost data. */
export function OperationsCostSheetEmbeddedActions({ scope }: { scope: OperationsCostSheetScope }) {
  const auth = useAuth(), permissions = usePermissions();
  const user = auth.user;
  if (auth.loading || permissions.isLoading) return <p role="status">正在核验成本入口权限…</p>;
  if (auth.error || !user || !Number.isSafeInteger(user.id) || user.id <= 0 || !Number.isSafeInteger(user.defaultWorkspaceId) || user.defaultWorkspaceId! <= 0 || !user.role || !permissions.canRead("ops", "ops_data_import") || user.defaultWorkspaceId !== scope.workspaceId) return <p role="status">当前身份没有此范围成本入口权限，未查询成本数据。</p>;
  return <OperationsCostSheetActions owner={{ userId: user.id, workspaceId: user.defaultWorkspaceId!, role: user.role }} scope={scope} />;
}
