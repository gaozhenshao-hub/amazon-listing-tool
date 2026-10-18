// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NativeBlob } from "node:buffer";
import MonthlyFinancialWrite, { MonthlyFinancialWriteController, MonthlyFinancialPersistentPreview, MonthlyFinancialImpactContent, readMonthlyFinancialPending, readBoundedMonthlyOriginal } from "./MonthlyFinancialWrite";
import { parseMonthlyFinancialImport, type MonthlyFinancialImport } from "@shared/monthlyFinancialImport";
import { buildMonthlyFinancialHistoryResult, type MonthlyFinancialBatchRecord } from "@shared/monthlyFinancialRead";
import { buildMonthlyFinancialWriteImpact, buildMonthlyFinancialWriteInspectResult, MONTHLY_FINANCIAL_WRITE_PUBLIC_LIMITS, type MonthlyFinancialWriteInspectInput, type MonthlyFinancialWriteOptionsResult } from "@shared/monthlyFinancialWrite";
import { subscribeMonthlyFinancialChanges } from "./monthlyFinancialWriteEvents";

const controls = vi.hoisted(() => ({
  options: vi.fn(), upload: vi.fn(), inspect: vi.fn(), confirm: vi.fn(), revoke: vi.fn(), recover: vi.fn(), download: vi.fn(), history: vi.fn(),
  auth: { loading: false, error: null as Error | null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } as { id: number; defaultWorkspaceId: number; role: string } | null },
  permissions: { isLoading: false, canRead: vi.fn(), canEdit: vi.fn() },
}));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: {
  monthlyFinancialWrite: { options: { query: controls.options }, upload: { mutate: controls.upload }, inspect: { query: controls.inspect }, confirm: { mutate: controls.confirm }, revoke: { mutate: controls.revoke }, recover: { mutate: controls.recover }, download: { mutate: controls.download } },
  monthlyFinancialRead: { listBatches: { query: controls.history } },
} }) } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => controls.auth }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => controls.permissions }));
const owner = { userId: 7, workspaceId: 11, role: "admin" }, identity = { userId: 7, workspaceId: 11 };
const uuid = "11111111-1111-4111-8111-111111111111";
const available = { status: "available" as const, reasonCode: null };
const unavailable = (reasonCode: string) => ({ status: "unavailable" as const, reasonCode });
const csv = new Uint8Array(new TextEncoder().encode('月份,ASIN,父ASIN,店铺,站点,币种,SKU,品名,业务员,毛利润,销量,销售额,退款量,退货量,广告花费\n2026-09,B000000001,B000000009,合成店,US,USD,SKU-1,<script>原名</script>,原运营人,10,2,100,0,0,-12'));
let parsed: MonthlyFinancialImport;
let currentRecord: MonthlyFinancialBatchRecord;
let currentOptions: MonthlyFinancialWriteOptionsResult;
function record(id = 80, status: MonthlyFinancialBatchRecord["status"] = "previewing"): MonthlyFinancialBatchRecord {
  return { id, workspaceId: 11, userId: 7, fileName: "合成月报.csv", fileHash: parsed.fileHash, status, createdAt: "2026-10-18 10:20:30.000000", confirmedAt: status === "completed" ? "2026-10-18 11:20:30.000000" : null,
    totalRows: parsed.totalRows, skippedRows: parsed.skippedRows, unallocatedRows: parsed.unallocatedRows, months: parsed.months, payload: parsed.rows, fileReferenceKind: "storage", fileUrl: "https://private.invalid/never-expose" };
}
const defaultInput = (batchId = 80): MonthlyFinancialWriteInspectInput => ({ expectedWorkspaceId: 11, batchId, rowOffset: 0, cellOffset: 0, warningOffset: 0, pageSize: 25 });
function inspectResult(input = defaultInput(), source = currentRecord, artifact = true, completed?: MonthlyFinancialBatchRecord[]) {
  return buildMonthlyFinancialWriteInspectResult({ identity, input, record: source,
    artifact: artifact ? { payloadHash: parsed.payloadHash, manifest: parsed.manifest, prepared: { identity, fileName: source.fileName, format: "csv", fileHash: parsed.fileHash, byteSize: csv.length, parserVersion: "monthly-financial-import-v1" } } : null,
    impact: buildMonthlyFinancialWriteImpact({ target: source, completed: completed ?? (source.status === "completed" ? [source] : []), complete: true }),
    capabilities: { confirm: artifact && source.status === "previewing" ? available : unavailable("not_previewing"), revoke: source.status === "deleted" ? unavailable("already_deleted") : available, download: artifact ? available : unavailable("original_manifest_unavailable") } });
}
function receipt(action: "upload" | "confirm" | "revoke", status = "committed") {
  return { identity, operationId: uuid, action, status, batchId: 80, batchStatus: status === "committed" ? { upload: "previewing", confirm: "completed", revoke: "deleted" }[action] : null, batchVersion: status === "committed" ? inspectResult().batchVersion : null, reasonCode: status === "committed" ? null : status === "cancelled" ? "cancelled" : "pending" };
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (value: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function selectFile(name = "合成月报.csv", bytes = csv, size?: number) {
  const file = new File([bytes], name); Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.slice().buffer });
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  fireEvent.change(screen.getByLabelText("持久上传月报原件"), { target: { files: [file] } }); return file;
}
async function check() { fireEvent.click(screen.getByRole("button", { name: "检查月报上传权限" })); await screen.findByText(/持久上传：可用/); }
async function inspectBatch(id = "80") { fireEvent.change(screen.getByLabelText("持久预览批次 ID"), { target: { value: id } }); fireEvent.click(screen.getByRole("button", { name: "读取完整持久预览及替换影响" })); await screen.findByRole("region", { name: "服务端持久月报预览" }); }
async function loaded() { render(<MonthlyFinancialWriteController owner={owner} />); await check(); await inspectBatch(); }
function persistUnknown(action = "upload", overrides: Record<string, unknown> = {}) {
  localStorage.setItem("monthly-financial-write:v1:7:11", JSON.stringify({ version: 1, ...identity, operationId: uuid, action, batchId: action === "upload" ? null : 80, batchVersion: action === "upload" ? null : "a".repeat(64), impactKey: action === "upload" ? null : "b".repeat(64), ...overrides }));
}
beforeAll(async () => { parsed = await parseMonthlyFinancialImport(csv, "合成月报.csv"); });
beforeEach(() => {
  cleanup(); localStorage.clear(); vi.restoreAllMocks();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(uuid);
  controls.auth = { loading: false, error: null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } }; controls.permissions.isLoading = false; controls.permissions.canRead.mockReset().mockReturnValue(true);
  for (const method of [controls.options, controls.upload, controls.inspect, controls.confirm, controls.revoke, controls.recover, controls.download, controls.history]) method.mockReset();
  currentRecord = record(); currentOptions = { identity, limits: MONTHLY_FINANCIAL_WRITE_PUBLIC_LIMITS, capabilities: { upload: available, inspect: available, confirm: available, revoke: available, recover: available, download: available } };
  controls.options.mockImplementation(async () => currentOptions);
  controls.inspect.mockImplementation(async (input: MonthlyFinancialWriteInspectInput) => inspectResult(input));
  controls.upload.mockImplementation(async () => receipt("upload"));
  controls.confirm.mockImplementation(async () => { currentRecord = record(80, "completed"); return receipt("confirm"); });
  controls.revoke.mockImplementation(async () => { currentRecord = record(80, "deleted"); return receipt("revoke"); });
  controls.recover.mockResolvedValue(receipt("upload", "unknown"));
  controls.history.mockImplementation(async input => buildMonthlyFinancialHistoryResult({ identity, input, records: [currentRecord] }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("monthly write authentication and explicit entry", () => {
  it("does not query or upload on mount, separates local selection from persistence", async () => {
    render(<MonthlyFinancialWrite />); selectFile();
    expect(controls.options).not.toHaveBeenCalled(); expect(controls.upload).not.toHaveBeenCalled();
    expect(screen.getByText(/尚未因为选择而上传/)).toBeVisible();
    expect(screen.getByRole("button", { name: "持久上传并生成待确认预览" })).toBeDisabled();
    await check(); expect(controls.options).toHaveBeenCalledWith({ expectedWorkspaceId: 11 }, { signal: expect.any(AbortSignal) });
  });
  it.each(["ops_dashboard", "ops_data_import"])("requires directory %s", directory => {
    controls.permissions.canRead.mockImplementation((_module, menu) => menu !== directory); render(<MonthlyFinancialWrite />);
    expect(screen.getByRole("alert")).toHaveTextContent("缺少月报持久导入读取权限"); expect(controls.options).not.toHaveBeenCalled();
  });
  it.each(["ops_specialist", "viewer", "", "finance"])("hides writes for role %s", role => {
    controls.auth.user!.role = role; render(<MonthlyFinancialWrite />); expect(screen.getByRole("alert")).toHaveTextContent("管理角色");
  });
  it("uses registered read directories and leaves safe recovery visible after write permission revocation", async () => {
    persistUnknown(); controls.permissions.canEdit.mockReturnValue(false); render(<MonthlyFinancialWrite />);
    await screen.findByRole("region", { name: "未知月报操作恢复" });
    expect(controls.permissions.canRead).toHaveBeenCalledWith("ops", "ops_dashboard");
    expect(controls.permissions.canRead).toHaveBeenCalledWith("ops", "ops_data_import");
    expect(controls.permissions.canRead).not.toHaveBeenCalledWith("ops", "ops_monthly_import");
    expect(screen.getByRole("button", { name: "检查原操作结果" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "请求取消并等待确认" })).toBeEnabled();
  });
  it("clears results when auth permission is revoked and aborts a late response", async () => {
    const delayed = deferred<unknown>(); controls.inspect.mockReturnValue(delayed.promise); const view = render(<MonthlyFinancialWrite />); await check();
    fireEvent.change(screen.getByLabelText("持久预览批次 ID"), { target: { value: "80" } }); fireEvent.click(screen.getByRole("button", { name: "读取完整持久预览及替换影响" }));
    const signal = controls.inspect.mock.calls[0][1].signal; controls.permissions.canRead.mockReturnValue(false); view.rerender(<MonthlyFinancialWrite />);
    expect(signal.aborted).toBe(true); await act(async () => delayed.resolve(inspectResult())); expect(screen.queryByLabelText("服务端持久月报预览")).not.toBeInTheDocument();
  });
  it("clears selected file and batch on actor/scope change without leaking pending metadata", async () => {
    const view = render(<MonthlyFinancialWriteController owner={owner} />); await check(); selectFile(); await inspectBatch();
    view.rerender(<MonthlyFinancialWriteController owner={{ ...owner, workspaceId: 12 }} />);
    expect(screen.getByLabelText("持久预览批次 ID")).toHaveValue(""); expect(screen.queryByText(/选择：合成月报/)).not.toBeInTheDocument(); expect(screen.queryByLabelText("服务端持久月报预览")).not.toBeInTheDocument();
  });
  it("default-off does not pretend uploads are ready", async () => {
    currentOptions.capabilities.upload = unavailable("release_disabled"); render(<MonthlyFinancialWriteController owner={owner} />); selectFile(); fireEvent.click(screen.getByRole("button", { name: "检查月报上传权限" }));
    await screen.findByText("持久上传：未开放 / 未接通：release_disabled"); expect(screen.getByRole("button", { name: "持久上传并生成待确认预览" })).toBeDisabled();
  });
  it.each([["bad.xls", 100], ["bad.csv", 0], ["large.xlsx", 5 * 1024 * 1024 + 1]])("rejects invalid file %s %s", async (name, size) => {
    render(<MonthlyFinancialWriteController owner={owner} />); await check(); selectFile(String(name), csv, Number(size));
    expect(screen.getByRole("alert")).toHaveTextContent("不能超过 5 MiB"); expect(screen.getByRole("button", { name: "持久上传并生成待确认预览" })).toBeDisabled(); expect(controls.upload).not.toHaveBeenCalled();
  });
});

describe("persistent import confirmation and complete preview", () => {
  it("persists original bytes once and never auto-confirms; journal contains only metadata", async () => {
    const delayed = deferred<unknown>(); controls.upload.mockReturnValue(delayed.promise); const notice = vi.fn(), unsubscribe = subscribeMonthlyFinancialChanges(notice);
    render(<MonthlyFinancialWriteController owner={owner} />); await check(); selectFile(); fireEvent.click(screen.getByRole("button", { name: "持久上传并生成待确认预览" }));
    await waitFor(() => expect(controls.upload).toHaveBeenCalledTimes(1));
    expect(controls.upload.mock.calls[0][0]).toMatchObject({ expectedWorkspaceId: 11, operationId: uuid, fileName: "合成月报.csv", format: "csv", base64: expect.any(String) });
    const stored = localStorage.getItem("monthly-financial-write:v1:7:11")!;
    expect(stored).not.toContain("合成"); expect(stored).not.toContain("base64"); expect(Object.keys(JSON.parse(stored)).sort()).toEqual(["action", "batchId", "batchVersion", "impactKey", "operationId", "userId", "version", "workspaceId"].sort());
    await act(async () => delayed.resolve(receipt("upload"))); await screen.findByRole("region", { name: "服务端持久月报预览" });
    expect(screen.getByText(/状态：已保存待确认，尚未生效/)).toBeVisible(); expect(controls.confirm).not.toHaveBeenCalled(); expect(readMonthlyFinancialPending(owner)).toBeNull();
    expect(notice).toHaveBeenCalledWith({ ...identity, action: "upload", batchId: 80 }); unsubscribe();
  });
  it("requires full-range checkbox before confirm, binds exact version and impact", async () => {
    await loaded(); const before = inspectResult(); fireEvent.click(screen.getByRole("button", { name: "核对并确认本批次生效" }));
    const dialog = await screen.findByRole("dialog"); expect(dialog).toHaveClass("min-w-0", "grid-cols-1"); expect(dialog).toHaveTextContent("完整导出");
    const button = within(dialog).getByRole("button", { name: "明确确认整范围替换" }); expect(button).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("checkbox")); fireEvent.click(button);
    await waitFor(() => expect(controls.confirm).toHaveBeenCalledTimes(1)); expect(controls.confirm.mock.calls[0][0]).toEqual({ expectedWorkspaceId: 11, operationId: uuid, batchId: 80, expectedBatchVersion: before.batchVersion, expectedImpactKey: before.impact.key, fullScopeAcknowledged: true });
    await screen.findByText(/状态：已确认/); expect(readMonthlyFinancialPending(owner)).toBeNull();
  });
  it("revokes only after whole-batch acknowledgement and preserves original history", async () => {
    currentRecord = record(80, "completed"); await loaded(); fireEvent.click(screen.getByRole("button", { name: "核对并撤销本批次" })); const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("上一有效批次"); expect(controls.revoke).not.toHaveBeenCalled(); fireEvent.click(within(dialog).getByRole("checkbox")); fireEvent.click(within(dialog).getByRole("button", { name: "明确撤销整批" }));
    await screen.findByText(/状态：已撤销，原记录保留/); expect(controls.revoke.mock.calls[0][0].fullScopeAcknowledged).toBe(true);
  });
  it("shows complete raw metadata, source signs and unknowns as text, not executable markup", async () => {
    await loaded(); const preview = screen.getByRole("region", { name: "服务端持久月报预览" });
    expect(preview).toHaveTextContent("<script>原名</script>"); expect(preview.querySelector("script")).toBeNull();
    expect(preview).toHaveTextContent('"value": "-12"'); expect(preview).toHaveTextContent('"advertising": 12');
    expect(preview).toHaveTextContent("原运营人"); expect(preview).toHaveTextContent("未提供（不是 0）");
    expect(preview).not.toHaveTextContent("private.invalid"); expect(screen.getByRole("region", { name: "原件单元格横向表" })).toHaveClass("overflow-auto", "max-w-full");
  });
  it("pages complete original cells with all three offsets and fixed batch version", async () => {
    await loaded(); const before = inspectResult(); fireEvent.click(screen.getByRole("button", { name: "原件单元格下一页" }));
    await waitFor(() => expect(controls.inspect).toHaveBeenCalledTimes(2)); expect(controls.inspect.mock.calls[1][0]).toEqual({ ...defaultInput(), expectedBatchVersion: before.batchVersion, cellOffset: 25 });
    await screen.findByRole("button", { name: "原件单元格上一页" }); fireEvent.click(screen.getByRole("button", { name: "原件单元格上一页" })); await waitFor(() => expect(controls.inspect).toHaveBeenCalledTimes(3)); expect(controls.inspect.mock.calls[2][0].cellOffset).toBe(0);
  });
  it("shows every warning beyond 100 through independent pagination", () => {
    const result = inspectResult(); result.preview!.warnings = Array.from({ length: 25 }, (_, i) => ({ code: `warning-${100 + i}`, message: `提示 ${100 + i}` })); result.preview!.warningPage = { offset: 100, total: 130, limit: 25, nextOffset: 125, hasMore: true }; const onPage = vi.fn();
    render(<MonthlyFinancialPersistentPreview result={result} busy={false} onPage={onPage} />); expect(screen.getByText(/提示 124/)).toBeVisible(); fireEvent.click(screen.getByRole("button", { name: "解析提示下一页" })); expect(onPage).toHaveBeenCalledWith({ rowOffset: 0, cellOffset: 0, warningOffset: 125 });
  });
  it("pages all scopes and keeps full removed-parent evidence", () => {
    const impact = inspectResult().impact; impact.scopes = Array.from({ length: 27 }, (_, i) => ({ ...impact.scopes[0], storeName: `店-${i}`, removedParentAsins: [`旧父-${i}`] })); render(<MonthlyFinancialImpactContent impact={impact} />);
    expect(screen.queryByText(/店-26/)).not.toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "影响范围下一页" })); expect(screen.getByText(/店-26/)).toBeVisible(); expect(screen.getByText("旧父-26")).toBeInTheDocument();
  });
  it("keeps legacy missing original explicitly unavailable while allowing safe revoke", async () => {
    currentRecord = record(80, "completed"); controls.inspect.mockImplementation(async input => inspectResult(input, currentRecord, false)); await loaded();
    expect(screen.getByRole("alert")).toHaveTextContent("原件及完整解析清单未接通"); expect(screen.getByRole("button", { name: "本次授权下载原件" })).toBeDisabled(); expect(screen.getByRole("button", { name: "核对并撤销本批次" })).toBeEnabled(); expect(screen.queryByLabelText("全部原件单元格")).not.toBeInTheDocument();
  });
  it("shows history selection without implicitly reading or modifying a batch", async () => {
    render(<MonthlyFinancialWriteController owner={owner} />); fireEvent.click(screen.getByRole("button", { name: "读取持久上传历史" })); fireEvent.click(await screen.findByRole("button", { name: "选择批次 80" }));
    expect(screen.getByLabelText("持久预览批次 ID")).toHaveValue("80"); expect(controls.inspect).not.toHaveBeenCalled(); expect(controls.confirm).not.toHaveBeenCalled();
  });
});

describe("unknown receipts, version fencing and read isolation", () => {
  it.each(["confirm", "revoke"] as const)("explains disabled archive synchronization for %s without releasing the original UUID or retrying", async action => {
    if (action === "revoke") currentRecord = record(80, "completed");
    controls[action].mockRejectedValue(Object.assign(new Error("OPERATIONS_BOARD_SYNC_DISABLED_FOR_INITIALIZED_SCOPE"), { data: { code: "PRECONDITION_FAILED" } }));
    const notice = vi.fn(), unsubscribe = subscribeMonthlyFinancialChanges(notice);
    await loaded(); selectFile();
    fireEvent.click(screen.getByRole("button", { name: action === "confirm" ? "核对并确认本批次生效" : "核对并撤销本批次" }));
    const dialog = await screen.findByRole("dialog"); fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: action === "confirm" ? "明确确认整范围替换" : "明确撤销整批" }));
    await screen.findByText(/归档同步已停用，但受影响范围已有归档/);
    expect(readMonthlyFinancialPending(owner)).toMatchObject({ action, operationId: uuid, batchId: 80 });
    expect(controls[action]).toHaveBeenCalledTimes(1); expect(controls.recover).not.toHaveBeenCalled(); expect(notice).not.toHaveBeenCalled();
    expect(screen.getByText(/选择：合成月报/)).toBeVisible(); expect(screen.queryByLabelText("服务端持久月报预览")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); unsubscribe();
  });
  it("does not interpret a matching message with another RPC code as a verified archive rejection", async () => {
    controls.confirm.mockRejectedValue(Object.assign(new Error("OPERATIONS_BOARD_SYNC_DISABLED_FOR_INITIALIZED_SCOPE"), { data: { code: "INTERNAL_SERVER_ERROR" } }));
    await loaded(); fireEvent.click(screen.getByRole("button", { name: "核对并确认本批次生效" }));
    const dialog = await screen.findByRole("dialog"); fireEvent.click(within(dialog).getByRole("checkbox")); fireEvent.click(within(dialog).getByRole("button", { name: "明确确认整范围替换" }));
    await screen.findByText(/提交结果未知或发生版本冲突/);
    expect(screen.queryByText(/归档同步已停用，但受影响范围已有归档/)).not.toBeInTheDocument();
    expect(readMonthlyFinancialPending(owner)?.operationId).toBe(uuid); expect(controls.confirm).toHaveBeenCalledTimes(1);
  });
  it("keeps UUID after network loss and does not retry on reload", async () => {
    controls.upload.mockRejectedValue(new Error("network-lost")); const view = render(<MonthlyFinancialWriteController owner={owner} />); await check(); selectFile(); fireEvent.click(screen.getByRole("button", { name: "持久上传并生成待确认预览" }));
    await screen.findByText(/提交结果未知或发生版本冲突/); expect(readMonthlyFinancialPending(owner)?.operationId).toBe(uuid); expect(screen.getByText(/选择：合成月报/)).toBeVisible();
    view.unmount(); render(<MonthlyFinancialWriteController owner={owner} />); await screen.findByRole("region", { name: "未知月报操作恢复" }); expect(controls.upload).toHaveBeenCalledTimes(1); expect(controls.recover).not.toHaveBeenCalled();
  });
  it("check/cancel remain available while release is disabled; only cancelled ack releases UUID", async () => {
    persistUnknown(); currentOptions.capabilities.upload = unavailable("release_disabled"); controls.recover.mockResolvedValueOnce(receipt("upload", "unknown")).mockResolvedValueOnce({ ...receipt("upload", "cancelled"), action: null, batchId: null });
    render(<MonthlyFinancialWriteController owner={owner} />); await screen.findByRole("region", { name: "未知月报操作恢复" }); fireEvent.click(screen.getByRole("button", { name: "检查原操作结果" }));
    await screen.findByText(/提交结果尚未确认/); expect(readMonthlyFinancialPending(owner)).not.toBeNull(); expect(screen.getByRole("button", { name: "完成已持久上传" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "请求取消并等待确认" })); await screen.findByText(/永久取消屏障/); expect(readMonthlyFinancialPending(owner)).toBeNull(); expect(controls.recover.mock.calls.map(call => call[0].decision)).toEqual(["check", "cancel"]);
  });
  it("complete_upload sends recovery metadata only, never file bytes or another PUT", async () => {
    persistUnknown(); controls.recover.mockResolvedValue(receipt("upload")); render(<MonthlyFinancialWriteController owner={owner} />); await check(); fireEvent.click(screen.getByRole("button", { name: "完成已持久上传" }));
    await screen.findByRole("region", { name: "服务端持久月报预览" }); expect(controls.recover.mock.calls[0][0]).toEqual({ expectedWorkspaceId: 11, operationId: uuid, decision: "complete_upload" }); expect(controls.upload).not.toHaveBeenCalled(); expect(readMonthlyFinancialPending(owner)).toBeNull();
  });
  it("unconfirmed cancellation never frees the original UUID", async () => {
    persistUnknown(); controls.recover.mockRejectedValue(new Error("lost")); render(<MonthlyFinancialWriteController owner={owner} />); await screen.findByRole("region", { name: "未知月报操作恢复" }); fireEvent.click(screen.getByRole("button", { name: "请求取消并等待确认" }));
    await screen.findByText(/恢复请求未获有效确认/); expect(readMonthlyFinancialPending(owner)?.operationId).toBe(uuid);
  });
  it.each(["identity", "operation", "action", "batch"])("rejects mismatched %s recovery receipt", async mismatch => {
    persistUnknown("confirm"); currentRecord = record(80, "completed"); const value = receipt("confirm"); if (mismatch === "identity") value.identity = { userId: 8, workspaceId: 11 }; if (mismatch === "operation") value.operationId = "22222222-2222-4222-8222-222222222222"; if (mismatch === "action") { value.action = "upload"; value.batchStatus = "previewing"; } if (mismatch === "batch") value.batchId = 81;
    controls.recover.mockResolvedValue(value); render(<MonthlyFinancialWriteController owner={owner} />); await screen.findByRole("region", { name: "未知月报操作恢复" }); fireEvent.click(screen.getByRole("button", { name: "检查原操作结果" }));
    await screen.findByText(/恢复请求未获有效确认/); expect(readMonthlyFinancialPending(owner)).not.toBeNull(); expect(controls.inspect).not.toHaveBeenCalled();
  });
  it("blocks new writes when recovery metadata is corrupt rather than clearing it", async () => {
    localStorage.setItem("monthly-financial-write:v1:7:11", "bad"); render(<MonthlyFinancialWriteController owner={owner} />); await check(); selectFile();
    expect(screen.getByRole("alert")).toHaveTextContent("恢复记录无法读取"); expect(screen.getByRole("button", { name: "持久上传并生成待确认预览" })).toBeDisabled(); expect(localStorage.getItem("monthly-financial-write:v1:7:11")).toBe("bad");
  });
  it("conflict preserves original UUID and selected local file; no automatic new operation", async () => {
    controls.confirm.mockRejectedValue(new Error("CONFLICT")); await loaded(); selectFile(); fireEvent.click(screen.getByRole("button", { name: "核对并确认本批次生效" })); const dialog = await screen.findByRole("dialog"); fireEvent.click(within(dialog).getByRole("checkbox")); fireEvent.click(within(dialog).getByRole("button", { name: "明确确认整范围替换" }));
    await screen.findByText(/提交结果未知或发生版本冲突/); expect(readMonthlyFinancialPending(owner)?.action).toBe("confirm"); expect(screen.getByText(/选择：合成月报/)).toBeVisible(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(controls.confirm).toHaveBeenCalledTimes(1);
  });
  it.each(["version", "impact", "page", "identity"])("rejects mixed %s on subsequent original page", async mismatch => {
    await loaded(); const other = inspectResult({ ...defaultInput(), cellOffset: 25 });
    if (mismatch === "version") other.batchVersion = "a".repeat(64); if (mismatch === "impact") other.impact.key = "b".repeat(64); if (mismatch === "page") other.preview!.cellPage.offset = 0; if (mismatch === "identity") other.identity.userId = 8;
    controls.inspect.mockResolvedValue(other); fireEvent.click(screen.getByRole("button", { name: "原件单元格下一页" })); await screen.findByText(/读取失败或权限/);
    expect(screen.queryByRole("region", { name: "服务端持久月报预览" })).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "读取完整持久预览及替换影响" })).toBeDisabled();
  });
  it("ignores a late batch response after selection changes", async () => {
    const delayed = deferred<unknown>(); controls.inspect.mockReturnValue(delayed.promise); render(<MonthlyFinancialWriteController owner={owner} />); await check();
    fireEvent.change(screen.getByLabelText("持久预览批次 ID"), { target: { value: "80" } }); fireEvent.click(screen.getByRole("button", { name: "读取完整持久预览及替换影响" })); const signal = controls.inspect.mock.calls[0][1].signal;
    fireEvent.change(screen.getByLabelText("持久预览批次 ID"), { target: { value: "81" } }); await act(async () => delayed.resolve(inspectResult())); expect(signal.aborted).toBe(true); expect(screen.queryByLabelText("服务端持久月报预览")).not.toBeInTheDocument();
  });
});

describe("bounded original download", () => {
  it("streams exactly the verified byte length even without Content-Length", async () => {
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3])); controller.close(); } }));
    const blob = await readBoundedMonthlyOriginal(response, 3, new AbortController().signal, () => true); expect(blob.size).toBe(3);
  });
  it("cancels dishonest streams before allocating beyond the allowed size", async () => {
    const cancel = vi.fn(); const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3, 4])); }, cancel }));
    await expect(readBoundedMonthlyOriginal(response, 3, new AbortController().signal, () => true)).rejects.toThrow("ORIGINAL_TOO_LARGE"); expect(cancel).toHaveBeenCalled();
  });
  it("rejects truncated and scope-invalidated downloads", async () => {
    await expect(readBoundedMonthlyOriginal(new Response(new Uint8Array([1])), 3, new AbortController().signal, () => true)).rejects.toThrow("ORIGINAL_SIZE_MISMATCH");
    await expect(readBoundedMonthlyOriginal(new Response(new Uint8Array([1])), 1, new AbortController().signal, () => false)).rejects.toThrow("CANCELLED");
  });
  it("authorizes each download and rejects mismatched file metadata before fetch", async () => {
    await loaded(); const fetchSpy = vi.fn(); vi.stubGlobal("fetch", fetchSpy); controls.download.mockResolvedValue({ identity, batchId: 81, batchVersion: inspectResult().batchVersion, fileName: "合成月报.csv", fileHash: parsed.fileHash, byteSize: csv.length, url: "https://private.invalid/signed", expiresSeconds: 60 });
    fireEvent.click(screen.getByRole("button", { name: "本次授权下载原件" })); await screen.findByText(/原件下载失败或权限/); expect(controls.download).toHaveBeenCalledWith({ expectedWorkspaceId: 11, batchId: 80, expectedBatchVersion: inspectResult().batchVersion }, { signal: expect.any(AbortSignal) }); expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("per-click authorizes, bounds and hashes the private original then immediately releases object URLs", async () => {
    await loaded(); vi.stubGlobal("Blob", NativeBlob); const create = vi.fn().mockReturnValue("blob:synthetic-only"), revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const fetchSpy = vi.fn().mockImplementation(async () => new Response(csv)); vi.stubGlobal("fetch", fetchSpy);
    controls.download.mockResolvedValue({ identity, batchId: 80, batchVersion: inspectResult().batchVersion, fileName: "合成月报.csv", fileHash: parsed.fileHash, byteSize: csv.length, url: "https://private.invalid/signed", expiresSeconds: 60 });
    for (let i = 0; i < 2; i++) { fireEvent.click(screen.getByRole("button", { name: "本次授权下载原件" })); await waitFor(() => expect(click).toHaveBeenCalledTimes(i + 1)); }
    expect(controls.download).toHaveBeenCalledTimes(2); expect(revoke).toHaveBeenCalledTimes(2); expect(create).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", cache: "no-store" });
    expect(document.querySelector("a[download]")).toBeNull(); expect(localStorage.length).toBe(0); expect(document.body).not.toHaveTextContent("private.invalid");
  });
  it("does not fetch or reveal a late signed URL after batch change", async () => {
    await loaded(); const delayed = deferred<unknown>(); controls.download.mockReturnValue(delayed.promise); const fetchSpy = vi.fn(); vi.stubGlobal("fetch", fetchSpy);
    fireEvent.click(screen.getByRole("button", { name: "本次授权下载原件" })); const signal = controls.download.mock.calls[0][1].signal;
    fireEvent.change(screen.getByLabelText("持久预览批次 ID"), { target: { value: "81" } });
    await act(async () => delayed.resolve({ identity, batchId: 80, batchVersion: inspectResult().batchVersion, fileName: "合成月报.csv", fileHash: parsed.fileHash, byteSize: csv.length, url: "https://private.invalid/signed", expiresSeconds: 60 }));
    expect(signal.aborted).toBe(true); expect(fetchSpy).not.toHaveBeenCalled(); expect(screen.queryByLabelText("服务端持久月报预览")).not.toBeInTheDocument();
  });
  it("rejects oversized Content-Length before reading any stream", async () => {
    const cancel = vi.fn(); const response = new Response(new ReadableStream({ cancel }), { headers: { "Content-Length": String(5 * 1024 * 1024 + 1) } });
    await expect(readBoundedMonthlyOriginal(response, 1, new AbortController().signal, () => true)).rejects.toThrow("ORIGINAL_RESPONSE_INVALID"); expect(cancel).toHaveBeenCalled();
  });
});
