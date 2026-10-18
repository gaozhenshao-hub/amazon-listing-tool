import { useEffect, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MonthlyFinancialHistoryContent } from "./MonthlyFinancialReadOnly";
import { MonthlyFinancialHistoryResultSchema, type MonthlyFinancialHistoryResult } from "@shared/monthlyFinancialRead";
import {
  MonthlyFinancialWriteOptionsResultSchema, MonthlyFinancialWriteInspectInputSchema, MonthlyFinancialWriteInspectResultSchema,
  MonthlyFinancialWriteUploadInputSchema, MonthlyFinancialWriteConfirmInputSchema, MonthlyFinancialWriteResultSchema, MonthlyFinancialWriteDownloadResultSchema,
  type MonthlyFinancialWriteOptionsResult, type MonthlyFinancialWriteInspectResult, type MonthlyFinancialWriteInspectInput,
  type MonthlyFinancialWriteImpact,
} from "@shared/monthlyFinancialWrite";
import { monthlyFinancialImportBytesHash } from "@shared/monthlyFinancialImport";
import { publishMonthlyFinancialChange } from "./monthlyFinancialWriteEvents";

export type MonthlyFinancialWriteOwner = { userId: number; workspaceId: number; role: string };
const FILE_LIMIT = 5 * 1024 * 1024;
const PAGE_SIZE = 25;
const buttonClass = "min-h-10 rounded border px-3 py-2 text-sm disabled:opacity-50";
const cellClass = "border-b p-3 align-top whitespace-pre-wrap break-words";
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const boardSyncDisabledError = z.object({
  message: z.literal("OPERATIONS_BOARD_SYNC_DISABLED_FOR_INITIALIZED_SCOPE"),
  data: z.object({ code: z.literal("PRECONDITION_FAILED") }),
});
const PendingSchema = z.object({
  version: z.literal(1), userId: z.number().int().positive(), workspaceId: z.number().int().positive(),
  operationId: z.string().uuid(), action: z.enum(["upload", "confirm", "revoke"]),
  batchId: z.number().int().positive().nullable(), batchVersion: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  impactKey: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
}).strict().refine(value => value.action === "upload" ? value.batchId === null && value.batchVersion === null && value.impactKey === null : value.batchId !== null && value.batchVersion !== null && value.impactKey !== null);
type Pending = z.infer<typeof PendingSchema>;
const pendingListeners = new Set<() => void>();
const pendingKey = (owner: MonthlyFinancialWriteOwner) => `monthly-financial-write:v1:${owner.userId}:${owner.workspaceId}`;
/** Browser persistence contains recovery metadata only, never file names,
 * report rows, base64, object references, signed URLs or private source text. */
export function readMonthlyFinancialPending(owner: MonthlyFinancialWriteOwner): Pending | null {
  const raw = localStorage.getItem(pendingKey(owner));
  if (raw === null) return null;
  if (raw.length > 4096) throw new Error("RECOVERY_METADATA_INVALID");
  const value = PendingSchema.parse(JSON.parse(raw));
  if (value.userId !== owner.userId || value.workspaceId !== owner.workspaceId) throw new Error("RECOVERY_IDENTITY_INVALID");
  return value;
}
function persistPending(owner: MonthlyFinancialWriteOwner, pending: Pending) {
  if (readMonthlyFinancialPending(owner)) throw new Error("AN_OPERATION_IS_PENDING");
  localStorage.setItem(pendingKey(owner), JSON.stringify(PendingSchema.parse(pending)));
  if (readMonthlyFinancialPending(owner)?.operationId !== pending.operationId) throw new Error("RECOVERY_STORAGE_FAILED");
  pendingListeners.forEach(listener => listener());
}
function releasePending(owner: MonthlyFinancialWriteOwner, operationId: string) {
  if (readMonthlyFinancialPending(owner)?.operationId === operationId) localStorage.removeItem(pendingKey(owner));
  pendingListeners.forEach(listener => listener());
}
function Shell({ children }: { children: ReactNode }) {
  return <section aria-label="月报持久上传与确认" className="manus-no-record min-w-0 max-w-full space-y-4 rounded-xl border bg-card p-4 md:p-5">
    <header className="space-y-2"><h2 className="text-lg font-semibold">月报持久上传、完整预览与确认</h2>
      <p className="text-sm text-muted-foreground">本地文件预览不等于已上传。这里明确上传原件，服务端重新解析并生成待确认批次；只有明确确认后才参与有效月报。不会调用模型、启动同步或写入日报 / 周报。</p>
      <p className="text-xs text-muted-foreground">确认按完整月份 / 精确店铺 / 站点整范围替换，不按父 ASIN 拼接旧数据。来源完整不等于整月业务覆盖完整，必须核对完整导出范围。未知结果不自动重新提交。</p>
    </header>{children}
  </section>;
}
function Pager({ label, offset, total, limit = PAGE_SIZE, disabled, onPage }: { label: string; offset: number; total: number; limit?: number; disabled: boolean; onPage: (offset: number) => void }) {
  return <nav aria-label={`${label}分页`} className="flex flex-wrap items-center gap-3 text-sm"><span>{total ? `${offset + 1}–${Math.min(offset + limit, total)} / ${total}` : "0 / 0"}，所有记录均可逐页查看</span>
    <button className={buttonClass} type="button" disabled={disabled || offset === 0} onClick={() => onPage(Math.max(0, offset - limit))}>{label}上一页</button>
    <button className={buttonClass} type="button" disabled={disabled || offset + limit >= total} onClick={() => onPage(offset + limit)}>{label}下一页</button>
  </nav>;
}
function json(value: unknown) { return <pre className="max-w-full whitespace-pre-wrap break-all text-xs">{JSON.stringify(value, null, 2)}</pre>; }
function encodedBytes(bytes: Uint8Array) {
  let result = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) result += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(result);
}
/** A dishonest/missing Content-Length must not cause an unbounded blob read. */
export async function readBoundedMonthlyOriginal(response: Response, expectedBytes: number, signal: AbortSignal, current: () => boolean): Promise<Blob> {
  if (!response.ok || !response.body || expectedBytes <= 0 || expectedBytes > FILE_LIMIT || Number(response.headers.get("content-length") ?? 0) > FILE_LIMIT) { await response.body?.cancel(); throw new Error("ORIGINAL_RESPONSE_INVALID"); }
  const reader = response.body.getReader(), bytes = new Uint8Array(expectedBytes);
  let length = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal.aborted || !current()) throw new Error("CANCELLED");
      const value = await reader.read();
      if (signal.aborted || !current()) throw new Error("CANCELLED");
      if (value.done) break;
      if (length + value.value.byteLength > expectedBytes) throw new Error("ORIGINAL_TOO_LARGE");
      bytes.set(value.value, length); length += value.value.byteLength;
    }
    if (length !== expectedBytes) throw new Error("ORIGINAL_SIZE_MISMATCH");
    return new Blob([bytes], { type: "application/octet-stream" });
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}

function ScrollTable({ label, children }: { label: string; children: ReactNode }) {
  return <div role="region" aria-label={label} tabIndex={0} className="min-w-0 max-w-full max-h-[32rem] overflow-auto rounded border">{children}</div>;
}
const shown = (value: unknown) => value === null || value === undefined || value === "" ? "未提供（不是 0）" : String(value);
/** This is the complete server replacement plan, not a plan inferred from the
 * currently displayed source page. Every scope/removed parent remains reachable. */
export function MonthlyFinancialImpactContent({ impact }: { impact: MonthlyFinancialWriteImpact }) {
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [impact.key]);
  return <section aria-label="全部范围替换影响" className="min-w-0 space-y-3">
    <h3 className="font-semibold">完整月份 / 店铺 / 站点替换影响</h3>
    <p className="text-sm">每个范围采用最大已确认批次 ID；不会把本批缺少的父体从旧批补回。撤销后使用该范围剩余最大已确认批次；没有则不再有有效月报。未分配费用保留，不伪分配给产品。</p>
    <p>影响来源：{impact.complete ? "完整" : "不完整，禁止确认 / 撤销"} · 共 {impact.scopes.length} 个精确范围</p>
    {impact.blockingReasons.length > 0 && <p role="alert" className="break-all text-amber-700">阻断原因：{impact.blockingReasons.join("、")}</p>}
    <ScrollTable label="替换影响横向表"><table className="w-full min-w-[1000px] text-left text-xs"><thead className="sticky top-0 bg-background"><tr>{["月份 / 店铺 / 站点", "当前有效批次 / 原行", "确认后批次 / 本批行", "撤销后批次 / 原行", "本批未分配行", "确认后不再保留的旧父体"].map(text => <th className={cellClass} key={text}>{text}</th>)}</tr></thead><tbody>
      {impact.scopes.slice(offset, offset + PAGE_SIZE).map(scope => <tr key={JSON.stringify([scope.yearMonth, scope.storeName, scope.country])}><td className={cellClass}>{scope.yearMonth}<br />{scope.storeName}<br />{scope.country}</td><td className={cellClass}>{scope.currentWinnerId === null ? "无有效批次" : `#${scope.currentWinnerId}`} / {scope.currentRows} 行</td><td className={cellClass}>{scope.confirmWinnerId === null ? "无有效批次" : `#${scope.confirmWinnerId}`} / 本批 {scope.incomingRows} 行</td><td className={cellClass}>{scope.revokeWinnerId === null ? "无剩余有效批次" : `#${scope.revokeWinnerId}`} / {scope.revokeRows} 行</td><td className={cellClass}>{scope.incomingUnallocatedRows}</td><td className={cellClass}>{scope.removedParentAsins.length ? <details><summary>{scope.removedParentAsins.length} 个父体（展开全部）</summary>{scope.removedParentAsins.map(parent => <p key={parent}>{parent}</p>)}</details> : "没有"}</td></tr>)}
    </tbody></table></ScrollTable>
    <Pager label="影响范围" offset={offset} total={impact.scopes.length} disabled={false} onPage={setOffset} />
  </section>;
}

export function MonthlyFinancialPersistentPreview({ result, busy, onPage }: { result: MonthlyFinancialWriteInspectResult; busy: boolean; onPage: (offsets: Pick<MonthlyFinancialWriteInspectInput, "rowOffset" | "cellOffset" | "warningOffset">) => void }) {
  const preview = result.preview;
  const offsets = preview ? { rowOffset: preview.rowPage.offset, cellOffset: preview.cellPage.offset, warningOffset: preview.warningPage.offset } : { rowOffset: 0, cellOffset: 0, warningOffset: 0 };
  return <section aria-label="服务端持久月报预览" className="min-w-0 space-y-4">
    <h3 className="break-all font-semibold">批次 #{result.batch.id} · {result.batch.fileName}</h3>
    <p>状态：{({ previewing: "已保存待确认，尚未生效", completed: "已确认（有效范围以当前最大 ID 为准）", deleted: "已撤销，原记录保留" })[result.batch.status]}</p>
    <p>整批标准化行 {result.batch.totalRows} · 汇总行 {result.batch.skippedRows} · 未分配行 {result.batch.unallocatedRows}</p>
    <p>月份：{result.batch.months.join("、") || "未识别"} · 上传者 ID：{result.batch.userId} · 创建时间（数据库原时区）：{result.batch.createdAt}</p>
    <details><summary>批次与原件完整元数据</summary>{json({ batch: result.batch, batchVersion: result.batchVersion, artifact: result.artifact })}</details>
    {!preview ? <p role="alert">原件及完整解析清单未接通：{result.artifact.reasonCode}。不把历史标准化记录冒充原文件预览，不能下载未验证原件。</p> : <>
      <p>已持久保存原件：{preview.byteLength} 字节 · {preview.format} · {preview.parserVersion}。原费用符号与标准化值分开保留，仅服务端标准化一次。</p>
      <p className="text-sm">运营人字段是原文，不代表已完成数字用户授权映射。缺失字段、未知币种和歧义行保留未知，不自动补 0。以下分页覆盖完整原件，不是抽样预览。</p>
      <details><summary>全部工作表、表头与完整性证据</summary>{json({ fileHash: preview.fileHash, payloadHash: preview.payloadHash, manifestHash: preview.manifestHash, counts: preview.counts, sheets: preview.sheets })}</details>
      {preview.blockingReasons.length > 0 && <p role="alert" className="break-all text-amber-700">解析阻断：{preview.blockingReasons.join("、")}</p>}
      <section aria-label="全部原预览行" className="min-w-0 space-y-3"><h4 className="font-medium">完整原预览行（含汇总行）</h4>
        <ScrollTable label="原预览行横向表"><table className="w-full min-w-[1300px] text-left text-xs"><thead className="sticky top-0 bg-background"><tr>{["工作表 / 原行 / 类型", "月份 / 店铺 / 站点", "父 ASIN / ASIN / SKU / 标题", "原运营人 / 币种 / 分配", "原符号、全部 19 指标与来源"].map(text => <th className={cellClass} key={text}>{text}</th>)}</tr></thead><tbody>{preview.rows.map(row => <tr key={`${row.sheet}:${row.rowNumber}`}><td className={cellClass}>{row.sheet} · {row.rowNumber} · {row.kind}<br />标准化索引：{shown(row.normalizedRowIndex)}</td><td className={cellClass}>{shown(row.yearMonth)}<br />{shown(row.storeName)}<br />{shown(row.site)}</td><td className={cellClass}>{shown(row.parentAsin)}<br />{shown(row.asin)}<br />{shown(row.sku)}<br />{shown(row.title)}</td><td className={cellClass}>{shown(row.operator)}<br />{shown(row.currency)} · {row.currencySource}<br />{row.allocation}</td><td className={cellClass}><details><summary>展开本行所有原值 / 标准化值 / 来源证据</summary>{json({ sourceMetrics: row.sourceMetrics, normalizedMetrics: row.normalizedMetrics, parentCandidates: row.parentCandidates, blockingReasons: row.blockingReasons })}</details></td></tr>)}</tbody></table></ScrollTable>
        <Pager label="预览原行" {...preview.rowPage} disabled={busy} onPage={rowOffset => onPage({ ...offsets, rowOffset })} />
      </section>
      <section aria-label="全部原件单元格" className="min-w-0 space-y-3"><h4 className="font-medium">完整原件单元格（所有表头及正文）</h4>
        <ScrollTable label="原件单元格横向表"><table className="w-full min-w-[900px] text-left text-xs"><thead className="sticky top-0 bg-background"><tr>{["表 / 坐标", "原值", "公式（只显示不执行）", "格式 / 错误"].map(text => <th key={text} className={cellClass}>{text}</th>)}</tr></thead><tbody>{preview.cells.map(cell => <tr key={`${cell.sheet}:${cell.address}`}><td className={cellClass}>{cell.sheet}!{cell.address}</td><td className={cellClass}>{shown(cell.value)}</td><td className={cellClass}>{shown(cell.formula)}</td><td className={cellClass}>{shown(cell.format)} / {cell.error ? "错误单元格" : "无错误标记"}</td></tr>)}</tbody></table></ScrollTable>
        <Pager label="原件单元格" {...preview.cellPage} disabled={busy} onPage={cellOffset => onPage({ ...offsets, cellOffset })} />
      </section>
      <section aria-label="所有解析提示" className="min-w-0 space-y-3"><h4 className="font-medium">全部解析提示</h4>{preview.warnings.length ? <ul className="space-y-2">{preview.warnings.map((warning, index) => <li className="break-all rounded border p-2 text-sm" key={preview.warningPage.offset + index}>{warning.code} · {warning.message}<br />{warning.sheet ?? "全文件"} · 原行 {shown(warning.row)} · {warning.columns?.join("、") ?? "未指定列"}</li>)}</ul> : <p>本页没有解析提示。</p>}
        <Pager label="解析提示" {...preview.warningPage} disabled={busy} onPage={warningOffset => onPage({ ...offsets, warningOffset })} />
      </section>
    </>}
    <MonthlyFinancialImpactContent impact={result.impact} />
  </section>;
}

type Lane = { sequence: number; controller: AbortController | null };
function useRequestLane() {
  const ref = useRef<Lane>({ sequence: 0, controller: null });
  const cancel = () => { ref.current.sequence++; ref.current.controller?.abort(); ref.current.controller = null; };
  useEffect(() => cancel, []);
  return { cancel, begin() { cancel(); const controller = new AbortController(), sequence = ref.current.sequence; ref.current.controller = controller; return { signal: controller.signal, current: () => sequence === ref.current.sequence && !controller.signal.aborted }; } };
}
function assertIdentity(identity: { userId: number; workspaceId: number }, owner: MonthlyFinancialWriteOwner) {
  if (identity.userId !== owner.userId || identity.workspaceId !== owner.workspaceId) throw new Error("IDENTITY_MISMATCH");
}
const capabilityLabels = { upload: "持久上传", inspect: "检查原件预览", confirm: "确认生效", revoke: "撤销批次", recover: "恢复核对", download: "原件下载" } as const;

function OwnedMonthlyFinancialWrite({ owner }: { owner: MonthlyFinancialWriteOwner }) {
  const client = trpc.useUtils().client;
  const [options, setOptions] = useState<MonthlyFinancialWriteOptionsResult | null>(null);
  const [file, setFile] = useState<File | null>(null), [batchId, setBatchId] = useState("");
  const [result, setResult] = useState<MonthlyFinancialWriteInspectResult | null>(null);
  const [history, setHistory] = useState<MonthlyFinancialHistoryResult | null>(null), [trail, setTrail] = useState<Array<number | null>>([null]);
  const historyOpened = useRef(false);
  const [pending, setPending] = useState<Pending | null>(null), [storageError, setStorageError] = useState(false);
  const [busy, setBusy] = useState(false), [reading, setReading] = useState(false), [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState(""), [dialog, setDialog] = useState<"confirm" | "revoke" | null>(null), [acknowledged, setAcknowledged] = useState(false);
  const optionsLane = useRequestLane(), inspectLane = useRequestLane(), historyLane = useRequestLane(), writeLane = useRequestLane(), downloadLane = useRequestLane();
  const writeLock = useRef(false), fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const update = () => { try { setPending(readMonthlyFinancialPending(owner)); setStorageError(false); } catch { setStorageError(true); } };
    update(); pendingListeners.add(update); window.addEventListener("storage", update);
    return () => { pendingListeners.delete(update); window.removeEventListener("storage", update); };
  }, [owner]);
  function clearInspect() { inspectLane.cancel(); downloadLane.cancel(); setResult(null); setReading(false); setDownloading(false); setDialog(null); setAcknowledged(false); }
  function failRead() { clearInspect(); historyLane.cancel(); setHistory(null); optionsLane.cancel(); setOptions(null); setMessage("读取失败或权限 / 数据版本已变化，旧内容已清除。请显式重新检查；未知提交记录保留，不自动重试。"); }
  async function checkOptions() {
    const request = optionsLane.begin(); clearInspect(); historyLane.cancel(); setHistory(null); setOptions(null); setMessage("");
    try { const value = MonthlyFinancialWriteOptionsResultSchema.parse(await client.monthlyFinancialWrite.options.query({ expectedWorkspaceId: owner.workspaceId }, { signal: request.signal })); assertIdentity(value.identity, owner); if (request.current()) setOptions(value); }
    catch { if (request.current()) failRead(); }
  }
  async function readHistory(cursor: number | null = null, nextTrail: Array<number | null> = [null]) {
    const request = historyLane.begin(); historyOpened.current = true; setHistory(null); setTrail(nextTrail);
    try {
      const value = MonthlyFinancialHistoryResultSchema.parse(await client.monthlyFinancialRead.listBatches.query({ expectedWorkspaceId: owner.workspaceId, cursor, limit: 20 }, { signal: request.signal })); assertIdentity(value.identity, owner);
      if (value.page.cursor !== cursor || value.page.limit !== 20 || value.batches.some(batch => batch.visibility !== "full")) throw new Error("HISTORY_SCOPE_MISMATCH");
      if (request.current()) setHistory(value);
    } catch { if (request.current()) failRead(); }
  }
  async function inspect(id: number, offsets = { rowOffset: 0, cellOffset: 0, warningOffset: 0 }, previous: MonthlyFinancialWriteInspectResult | null = null, receiptVersion?: string) {
    const request = inspectLane.begin(); downloadLane.cancel(); setDownloading(false); setReading(true); setResult(null); setAcknowledged(false); setDialog(null);
    try {
      const input = MonthlyFinancialWriteInspectInputSchema.parse({ expectedWorkspaceId: owner.workspaceId, batchId: id, ...offsets, pageSize: PAGE_SIZE, ...(previous || receiptVersion ? { expectedBatchVersion: previous?.batchVersion ?? receiptVersion } : {}) });
      const value = MonthlyFinancialWriteInspectResultSchema.parse(await client.monthlyFinancialWrite.inspect.query(input, { signal: request.signal })); assertIdentity(value.identity, owner);
      if (value.batch.id !== id || value.batch.visibility !== "full" || input.expectedBatchVersion && value.batchVersion !== input.expectedBatchVersion) throw new Error("BATCH_MISMATCH");
      if (value.preview && (value.preview.rowPage.offset !== offsets.rowOffset || value.preview.cellPage.offset !== offsets.cellOffset || value.preview.warningPage.offset !== offsets.warningOffset || [value.preview.rowPage, value.preview.cellPage, value.preview.warningPage].some(page => page.limit !== PAGE_SIZE))) throw new Error("PAGE_MISMATCH");
      if (previous && (value.impact.key !== previous.impact.key || value.preview?.manifestHash !== previous.preview?.manifestHash || value.preview?.payloadHash !== previous.preview?.payloadHash || value.preview?.fileHash !== previous.preview?.fileHash)) throw new Error("SOURCE_CHANGED");
      if (request.current()) { setResult(value); setBatchId(String(id)); }
    } catch { if (request.current()) { failRead(); if (receiptVersion) setMessage("提交已经确认，但当前批次 / 权限 / 来源已变化或读取失败；请重新检查权限并显式读取当前批次。不要重复提交。"); } }
    finally { if (request.current()) setReading(false); }
  }
  async function acceptReceipt(raw: unknown, operation: Pending, current: () => boolean) {
    const value = MonthlyFinancialWriteResultSchema.parse(raw); assertIdentity(value.identity, owner);
    if (value.operationId !== operation.operationId || value.action !== null && value.action !== operation.action || operation.batchId !== null && value.batchId !== null && value.batchId !== operation.batchId || value.status === "committed" && (value.action !== operation.action || operation.batchId !== null && value.batchId !== operation.batchId)) throw new Error("RECEIPT_MISMATCH");
    if (!current()) return;
    if (value.status === "unknown") { clearInspect(); setMessage(`提交结果尚未确认（${value.reasonCode}）。保留原 UUID；只能检查、完成已持久上传或请求取消，不能换 UUID 重复提交。`); return; }
    releasePending(owner, operation.operationId);
    if (value.status === "cancelled") { setMessage("服务端已确认永久取消屏障，原 UUID 已释放。原文件选择保留；需要时可明确发起新上传。"); return; }
    setDialog(null); setAcknowledged(false); setBatchId(String(value.batchId));
    setMessage(value.action === "upload" ? "原件与待确认批次已持久保存，尚未生效。请核对完整预览及全部替换范围后明确确认。" : value.action === "confirm" ? "确认已提交，已通知当前打开的月报、利润和产品视图清除旧页并重新读取。" : "撤销已确认，原记录保留；已通知当前打开的相关视图重新读取有效范围。");
    publishMonthlyFinancialChange({ userId: owner.userId, workspaceId: owner.workspaceId, action: value.action!, batchId: value.batchId! });
    if (historyOpened.current) void readHistory();
    await inspect(value.batchId!, undefined, null, value.batchVersion!);
  }
  async function write(action: Pending["action"]) {
    if (writeLock.current || pending || storageError) return;
    writeLock.current = true; setBusy(true); setMessage("");
    const request = writeLane.begin(); let operation: Pending | null = null;
    try {
      let upload: ReturnType<typeof MonthlyFinancialWriteUploadInputSchema.parse> | null = null;
      const operationId = crypto.randomUUID();
      if (action === "upload") {
        if (options?.capabilities.upload.status !== "available" || !file || file.size <= 0 || file.size > FILE_LIMIT || !/\.(xlsx|csv)$/iu.test(file.name)) throw new Error("FILE_INVALID");
        const bytes = new Uint8Array(await file.arrayBuffer()); if (!request.current()) return;
        if (bytes.length !== file.size) throw new Error("FILE_CHANGED");
        upload = MonthlyFinancialWriteUploadInputSchema.parse({ expectedWorkspaceId: owner.workspaceId, operationId, fileName: file.name, format: file.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv", base64: encodedBytes(bytes) });
      } else if (!result || !acknowledged || result.capabilities[action].status !== "available" || options?.capabilities[action].status !== "available" || !result.impact.complete) throw new Error("CONFIRMATION_REQUIRED");
      operation = { version: 1, userId: owner.userId, workspaceId: owner.workspaceId, operationId, action, batchId: action === "upload" ? null : result!.batch.id, batchVersion: action === "upload" ? null : result!.batchVersion, impactKey: action === "upload" ? null : result!.impact.key };
      persistPending(owner, operation);
      // Earlier reads must not repopulate a pre-commit snapshot while a write is
      // in flight. The exact reviewed version/impact are retained in metadata.
      clearInspect(); historyLane.cancel(); setHistory(null); optionsLane.cancel();
      const input = action === "upload" ? null : MonthlyFinancialWriteConfirmInputSchema.parse({ expectedWorkspaceId: owner.workspaceId, operationId, batchId: operation.batchId, expectedBatchVersion: operation.batchVersion, expectedImpactKey: operation.impactKey, fullScopeAcknowledged: true });
      const raw = action === "upload" ? await client.monthlyFinancialWrite.upload.mutate(upload!, { signal: request.signal }) : action === "confirm" ? await client.monthlyFinancialWrite.confirm.mutate(input!, { signal: request.signal }) : await client.monthlyFinancialWrite.revoke.mutate(input!, { signal: request.signal });
      await acceptReceipt(raw, operation, request.current);
    } catch (error) { if (request.current()) { setDialog(null); setAcknowledged(false); if (operation) {
      failRead();
      setMessage(boardSyncDisabledError.safeParse(error).success
        ? "归档同步已停用，但受影响范围已有归档，服务端已拒绝本次月报变更。原 UUID 已保留，请先检查原结果或获得取消确认，再由维护者核对月报与归档启停配置及历史差异；不要自动重发或仅重开开关冒充追平。"
        : "提交结果未知或发生版本冲突。原 UUID 已保留，原文件不清除；请检查结果或获得取消确认后再重新检查当前预览，不能自动重发。");
    } else setMessage("文件 / 授权 / 确认范围不合法，或恢复记录无法安全保存；没有发送新请求。请检查文件和权限。"); } }
    finally { writeLock.current = false; if (request.current()) setBusy(false); }
  }
  async function recover(decision: "check" | "complete_upload" | "cancel") {
    if (writeLock.current || storageError || !pending || decision === "complete_upload" && (pending.action !== "upload" || options?.capabilities.upload.status !== "available")) return;
    writeLock.current = true; setBusy(true); const request = writeLane.begin(), operation = pending;
    try { await acceptReceipt(await client.monthlyFinancialWrite.recover.mutate({ expectedWorkspaceId: owner.workspaceId, operationId: operation.operationId, decision }, { signal: request.signal }), operation, request.current); }
    catch { if (request.current()) { failRead(); setMessage("恢复请求未获有效确认，原 UUID 继续保留。请稍后明确检查；取消只有服务端确认后才会释放。权限撤销时不能继续读取内容。"); } }
    finally { writeLock.current = false; if (request.current()) setBusy(false); }
  }
  async function download() {
    if (!result?.preview || result.capabilities.download.status !== "available" || downloading) return;
    const selected = result, request = downloadLane.begin(); setDownloading(true); setMessage(""); let objectUrl: string | null = null;
    try {
      const value = MonthlyFinancialWriteDownloadResultSchema.parse(await client.monthlyFinancialWrite.download.mutate({ expectedWorkspaceId: owner.workspaceId, batchId: selected.batch.id, expectedBatchVersion: selected.batchVersion }, { signal: request.signal })); assertIdentity(value.identity, owner);
      if (value.batchId !== selected.batch.id || value.batchVersion !== selected.batchVersion || value.fileHash !== selected.preview!.fileHash || value.byteSize !== selected.preview!.byteLength || value.fileName !== selected.batch.fileName) throw new Error("ORIGINAL_MISMATCH");
      if (!request.current()) return;
      const response = await fetch(value.url, { signal: request.signal, credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", cache: "no-store" });
      const blob = await readBoundedMonthlyOriginal(response, value.byteSize, request.signal, request.current);
      if (monthlyFinancialImportBytesHash(new Uint8Array(await blob.arrayBuffer())) !== value.fileHash) throw new Error("ORIGINAL_HASH_MISMATCH");
      if (!request.current()) return;
      objectUrl = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = objectUrl; anchor.download = value.fileName; anchor.className = "manus-no-record"; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setMessage("原件已完成本次授权校验和完整性验证，临时链接已释放。");
    } catch { if (request.current()) { failRead(); setMessage("原件下载失败或权限 / 版本 / 文件完整性变化。旧预览已清除，请显式重新检查，不复用下载链接。"); } }
    finally { if (objectUrl) URL.revokeObjectURL(objectUrl); if (request.current()) setDownloading(false); }
  }
  const fileValid = !!file && file.size > 0 && file.size <= FILE_LIMIT && /\.(xlsx|csv)$/iu.test(file.name);
  const locked = busy || pending !== null || storageError;
  return <Shell>
    <div className="flex flex-wrap gap-3"><button type="button" className={buttonClass} disabled={busy} onClick={() => void checkOptions()}>检查月报上传权限</button><button type="button" className={buttonClass} disabled={busy} onClick={() => void readHistory()}>读取持久上传历史</button></div>
    {options ? <div className="space-y-1 text-sm">{Object.entries(options.capabilities).map(([key, capability]) => <p key={key}>{capabilityLabels[key as keyof typeof capabilityLabels]}：{capability.status === "available" ? "可用（执行时仍由服务端重新鉴权）" : `未开放 / 未接通：${capability.reasonCode}`}</p>)}</div> : <p>尚未检查上传权限；未启用时仅显示能力状态，不自发写入。</p>}
    {message && <p role="status" className="break-all rounded border p-3 text-sm">{message}</p>}
    {storageError && <p role="alert">恢复记录无法读取或不合法，已阻止新提交；不能擅自删除未知操作记录。</p>}
    {pending && <section aria-label="未知月报操作恢复" className="space-y-3 rounded border border-amber-500 p-3"><h3 className="font-medium">有待核对操作，禁止重复提交</h3><p className="break-all text-xs">{pending.action} · UUID {pending.operationId} · 批次 {pending.batchId ?? "尚未确认"}</p><p className="text-sm">检查 / 取消在发布开关关闭时仍可使用；取消须收到服务端永久屏障确认。完成上传只读取已持久保存的原件，不重新发送文件；原件未保存则需先取消。</p><div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={busy} onClick={() => void recover("check")}>检查原操作结果</button>{pending.action === "upload" && <button className={buttonClass} disabled={busy || options?.capabilities.upload.status !== "available"} onClick={() => void recover("complete_upload")}>完成已持久上传</button>}<button className={buttonClass} disabled={busy} onClick={() => void recover("cancel")}>请求取消并等待确认</button></div></section>}
    <section aria-label="明确上传月报原件" className="min-w-0 space-y-3 rounded border p-3"><h3 className="font-medium">一、选择原件并明确持久上传</h3><label className="block min-w-0 text-sm">月报原件（.xlsx / .csv，最多 5 MiB）<input ref={fileInput} aria-label="持久上传月报原件" type="file" accept=".xlsx,.csv" disabled={busy} className="mt-2 block w-full min-w-0 max-w-full text-xs" onChange={event => { setFile(event.currentTarget.files?.[0] ?? null); setMessage(""); }} /></label>{file && <p className="break-all text-sm">选择：{file.name} · {file.size} 字节 · 尚未因为选择而上传</p>}{file && !fileValid && <p role="alert">仅接受非空 .xlsx / .csv，文件不能超过 5 MiB；不截断或偷偷转换。</p>}<div className="flex flex-wrap gap-3"><button className={buttonClass} disabled={locked || !fileValid || options?.capabilities.upload.status !== "available"} onClick={() => void write("upload")}>持久上传并生成待确认预览</button><button className={buttonClass} disabled={busy} onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = ""; }}>清除本地文件选择</button></div></section>
    {history && <section aria-label="持久上传批次历史" className="min-w-0 space-y-3"><MonthlyFinancialHistoryContent result={history} onSelect={id => { if (!busy) { clearInspect(); setBatchId(String(id)); } }} />{history.status === "ready" && <nav className="flex flex-wrap gap-3" aria-label="持久历史分页"><button className={buttonClass} disabled={busy || trail.length < 2} onClick={() => { const next = trail.slice(0, -1); void readHistory(next.at(-1) ?? null, next); }}>持久历史上一页</button><button className={buttonClass} disabled={busy || !history.page.hasMore} onClick={() => void readHistory(history.page.nextCursor, [...trail, history.page.nextCursor])}>持久历史下一页</button></nav>}</section>}
    <section className="min-w-0 space-y-3"><h3 className="font-medium">二、检查已持久保存的批次 / 恢复待确认批次</h3><label className="block text-sm">持久预览批次 ID<input aria-label="持久预览批次 ID" value={batchId} inputMode="numeric" disabled={busy} className="mt-1 block w-full min-w-0 max-w-sm rounded border bg-background p-2" onChange={event => { clearInspect(); setBatchId(event.currentTarget.value); }} /></label><button className={buttonClass} disabled={busy || reading || !/^[1-9]\d*$/u.test(batchId) || !positiveId(Number(batchId)) || options?.capabilities.inspect.status !== "available"} onClick={() => void inspect(Number(batchId))}>读取完整持久预览及替换影响</button>{reading && <p role="status">正在读取完整原件证据和替换范围…</p>}</section>
    {result && <><MonthlyFinancialPersistentPreview result={result} busy={busy || reading} onPage={offsets => void inspect(result.batch.id, offsets, result)} /><div className="flex flex-wrap gap-3"><button className={buttonClass} disabled={locked || options?.capabilities.confirm.status !== "available" || result.capabilities.confirm.status !== "available"} onClick={() => { setAcknowledged(false); setDialog("confirm"); }}>核对并确认本批次生效</button><button className={buttonClass} disabled={locked || options?.capabilities.revoke.status !== "available" || result.capabilities.revoke.status !== "available"} onClick={() => { setAcknowledged(false); setDialog("revoke"); }}>核对并撤销本批次</button><button className={buttonClass} disabled={busy || downloading || options?.capabilities.download.status !== "available" || result.capabilities.download.status !== "available"} onClick={() => void download()}>本次授权下载原件</button></div>{Object.entries(result.capabilities).filter(([, cap]) => cap.status !== "available").map(([key, cap]) => <p className="break-all text-sm" key={key}>{capabilityLabels[key as "confirm" | "revoke" | "download"]}不可用：{cap.reasonCode}</p>)}</>}
    <Dialog open={dialog !== null} onOpenChange={open => { if (!open && !busy) { setDialog(null); setAcknowledged(false); } }}><DialogContent className="manus-no-record min-w-0 grid-cols-1 w-[calc(100vw-2rem)] max-w-5xl max-h-[90dvh] overflow-y-auto"><DialogHeader className="min-w-0"><DialogTitle>{dialog === "revoke" ? "确认撤销整批月报" : "确认整范围替换月报"}</DialogTitle><DialogDescription>这是持久写入。请核对每个完整月份、精确店铺、站点与原运营人，不能仅根据当前预览页判断整批完整。</DialogDescription></DialogHeader><div className="min-w-0 max-w-full space-y-4">{result && <MonthlyFinancialImpactContent impact={result.impact} />}<label className="flex min-w-0 items-start gap-2 text-sm"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.currentTarget.checked)} /><span>{dialog === "revoke" ? "我已核对所有范围，理解撤销整批会回退到各范围的上一有效批次，或使该范围不再有有效月报；原记录保留。" : "我已核对月份 / 店铺 / 站点及原运营人，确认原件是这些范围所需的完整导出；理解整范围替换会移除本批未包含的旧父体，未分配费用保留。"}</span></label><div className="flex flex-wrap gap-3"><button className={buttonClass} disabled={!acknowledged || locked} onClick={() => { if (dialog) void write(dialog); }}>{dialog === "revoke" ? "明确撤销整批" : "明确确认整范围替换"}</button><button className={buttonClass} disabled={busy} onClick={() => { setDialog(null); setAcknowledged(false); }}>返回继续核对</button></div></div></DialogContent></Dialog>
  </Shell>;
}

/** Authless controller entry for a validated owner / local synthetic harness.
 * Production uses the authenticated default wrapper below. */
export function MonthlyFinancialWriteController({ owner }: { owner: MonthlyFinancialWriteOwner }) {
  return <OwnedMonthlyFinancialWrite key={JSON.stringify([owner.userId, owner.workspaceId, owner.role])} owner={owner} />;
}
export default function MonthlyFinancialWrite() {
  const auth = useAuth(), permissions = usePermissions();
  if (auth.loading || permissions.isLoading) return <Shell><p role="status">正在确认月报上传身份与目录权限…</p></Shell>;
  const user = auth.user;
  if (auth.error || !user || !positiveId(user.id) || !positiveId(user.defaultWorkspaceId) || !["admin", "super_admin", "ops_manager"].includes(user.role)) return <Shell><p role="alert">月报持久上传仅开放给有效工作区的管理角色，旧内容已隐藏。</p></Shell>;
  if (!permissions.canRead("ops", "ops_dashboard") || !permissions.canRead("ops", "ops_data_import")) return <Shell><p role="alert">缺少月报持久导入读取权限，旧内容已隐藏，不发起请求。</p></Shell>;
  return <MonthlyFinancialWriteController owner={{ userId: user.id, workspaceId: user.defaultWorkspaceId, role: user.role }} />;
}
