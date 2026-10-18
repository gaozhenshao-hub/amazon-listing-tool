// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildOperationsCostSheetReadResult, type BuildOperationsCostSheetReadInput } from "@shared/operationsCostSheetRead";
import { type OperationsCostSheetWriteOptionsResult, type OperationsCostSheetWriteSaveInput } from "@shared/operationsCostSheetWrite";
import { OperationsCostSheetActions, OperationsCostSheetEmbeddedActions, readOperationsCostSheetPending, subscribeOperationsCostSheetChanges } from "./OperationsCostSheetActions";

const controls = vi.hoisted(() => ({
  options: vi.fn(), save: vi.fn(), recover: vi.fn(),
  auth: { loading: false, error: null as Error | null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } as { id: number; defaultWorkspaceId: number; role: string } | null },
  permissions: { isLoading: false, canRead: vi.fn() },
}));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: { productCostsWrite: { options: { query: controls.options }, save: { mutate: controls.save }, recover: { mutate: controls.recover } } } }) } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => controls.auth }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => controls.permissions }));
const owner = { userId: 7, workspaceId: 11, role: "admin" };
const scope = { workspaceId: 11, parentAsin: "B000000001", storeName: "Synthetic Store", country: "US" };
const input = { expectedWorkspaceId: 11, parentAsin: scope.parentAsin, storeName: scope.storeName, country: "US" };
const uuid = "11111111-1111-4111-8111-111111111111";
const row = { key: "item-1", productCost: 0, packagingCost: 4, actualFreight: 3, actualFba: 4, weightKg: 1, lengthCm: 20, widthCm: 15, heightCm: 10 };
function fixture(): BuildOperationsCostSheetReadInput {
  return { identity: { userId: 7, workspaceId: 11 }, scope, asOfDate: "2026-10-17",
    storage: { status: "saved", record: { id: 1, version: 4, updatedBy: 7, updatedAt: "2026-10-16T10:20:30.000Z", payload: { settings: { cnyPerCurrency: 7, freightRate: 20, standardGoodsConfirmed: false }, rows: [row] } } },
    sources: [{ kind: "lingxing", id: 17, importId: 8, date: "2026-10-15", scope, sourceKind: "synthetic-report", sourceBatchId: 31, sourceTraceId: "trace-synthetic", sourceSchemaVersion: "v1", sku: "item-1", msku: null, asin: "B000000011", name: "完整成本商品", currency: "USD", price: 20, actualFbaUnitFee: -5, actualFbaTotalFee: -50, fbaSalesQty: 10, missingColumns: [] }],
  };
}
function options(source = fixture(), reasonCode: string | null = null): OperationsCostSheetWriteOptionsResult {
  const readResult = buildOperationsCostSheetReadResult(source);
  return { identity: readResult.identity, scope, readResult, snapshotKey: (readResult.status === "saved" || readResult.status === "not_saved") && readResult.sourceStatus === "available" ? "a".repeat(64) : null, capabilities: { save: reasonCode ? { status: "unavailable", reasonCode } : { status: "available", reasonCode: null } } };
}
let currentOptions: OperationsCostSheetWriteOptionsResult;
function receipt(status = "committed", operationId = uuid) { return { identity: { userId: 7, workspaceId: 11 }, scope, operationId, status, version: status === "committed" ? 5 : null, snapshotKey: status === "committed" ? "b".repeat(64) : null, reasonCode: status === "committed" ? null : status === "cancelled" ? "CANCELLED" : "PENDING" }; }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (value: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function check() { fireEvent.click(screen.getByRole("button", { name: "检查成本编辑权限" })); await screen.findByRole("region", { name: "产品成本摘要" }); }
async function edit() { await check(); fireEvent.click(screen.getByRole("button", { name: "打开完整成本编辑" })); await screen.findByRole("dialog"); }
const field = (name = "产品成本（人民币 / 件）") => screen.getByLabelText(`item-1 ${name}`);
const change = (value: string, name?: string) => fireEvent.change(field(name), { target: { value } });
const save = () => fireEvent.click(screen.getByRole("button", { name: "保存完整成本" }));
const mount = () => render(<OperationsCostSheetActions owner={owner} scope={scope} />);
beforeEach(() => {
  localStorage.clear(); vi.restoreAllMocks();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(uuid);
  controls.auth = { loading: false, error: null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } };
  controls.permissions.isLoading = false; controls.permissions.canRead.mockReset().mockReturnValue(true);
  currentOptions = options();
  controls.options.mockReset().mockImplementation(async () => currentOptions);
  controls.save.mockReset().mockImplementation(async (value: OperationsCostSheetWriteSaveInput) => {
    const source = fixture(); source.storage = { status: "saved", record: { id: 1, version: 5, updatedBy: 7, updatedAt: "2026-10-18T10:20:30.000Z", payload: value.payload } };
    currentOptions = options(source); currentOptions.snapshotKey = "b".repeat(64);
    return receipt("committed", value.operationId);
  });
  controls.recover.mockReset().mockResolvedValue(receipt("unknown"));
});
afterEach(cleanup);

describe("explicit complete cost editing", () => {
  it("does not query on mount, binds exact scope, and keeps full row inputs and original sources", async () => {
    mount(); expect(controls.options).not.toHaveBeenCalled(); await edit();
    expect(controls.options).toHaveBeenCalledWith(input, { signal: expect.any(AbortSignal) });
    expect(field()).toHaveValue("0"); expect(field("实际 FBA（结算币种 / 件）")).toHaveValue("4");
    expect(screen.getByLabelText("确认普通非服装、非危险品（用于 FBA 预测）")).not.toBeChecked();
    expect(screen.getByRole("dialog")).toHaveTextContent("非会计利润");
    expect(screen.getByRole("dialog")).toHaveTextContent("trace-synthetic");
    expect(screen.getByRole("button", { name: "保存完整成本" })).toBeDisabled(); expect(controls.save).not.toHaveBeenCalled();
  });
  it("opens from the product summary and retains scoped dialog layout", async () => {
    mount(); await check(); fireEvent.click(screen.getByRole("button", { name: "完整成本商品" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveClass("min-w-0", "grid-cols-1");
    expect(screen.getByRole("region", { name: "完整成本编辑横向表" })).toHaveClass("max-w-full", "overflow-auto");
    expect(screen.getByRole("region", { name: "完整成本编辑横向表" }).querySelector("table")).toHaveClass("min-w-[2200px]");
  });
  it("formats summary to two decimal places without altering saved precision", async () => {
    const source = fixture(); if (source.storage.status === "saved") (source.storage.record.payload as { rows: typeof row[] }).rows[0] = { ...row, productCost: 1 };
    currentOptions = options(source); mount(); await check();
    const summary = screen.getByRole("region", { name: "产品成本摘要" });
    expect(summary).toHaveTextContent("11.86 USD"); expect(summary).toHaveTextContent("59.29%");
    expect(currentOptions.readResult.rows[0].profit!.profit).toBeCloseTo(11.857142857142858, 12);
  });
  it("uses explicit standard-goods confirmation for live predictions and does not save until clicked", async () => {
    mount(); await edit();
    expect(screen.getByRole("dialog")).toHaveTextContent("未确认普通非服装");
    fireEvent.click(screen.getByLabelText("确认普通非服装、非危险品（用于 FBA 预测）"));
    expect(screen.getByRole("dialog")).not.toHaveTextContent("未确认普通非服装");
    change("140"); expect(screen.getByRole("dialog")).toHaveTextContent("-8.00 USD");
    expect(within(screen.getByRole("dialog")).getByRole("cell", { name: /-8\.00 USD/ })).toHaveClass("text-red-700");
    expect(controls.save).not.toHaveBeenCalled(); save();
    await waitFor(() => expect(controls.save).toHaveBeenCalledTimes(1));
    expect(controls.save.mock.calls[0][0]).toMatchObject({ ...input, operationId: uuid, expectedVersion: 4, expectedSnapshotKey: "a".repeat(64), payload: { settings: { standardGoodsConfirmed: true }, rows: [{ ...row, productCost: 140 }] } });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText(/当前保存版本 5/)).toBeVisible(); expect(readOperationsCostSheetPending(owner, scope)).toBeNull();
  });
  it("preserves nullable blanks and real zero without substituting report FBA", async () => {
    mount(); await edit(); change(""); change("0", "实际运费（人民币 / 件）"); save();
    await waitFor(() => expect(controls.save).toHaveBeenCalled());
    expect(controls.save.mock.calls[0][0].payload.rows[0]).toMatchObject({ productCost: null, actualFreight: 0, actualFba: 4 });
  });
  it.each(["-1", "NaN", "Infinity", "abc", "1e100", "10000001"])("rejects illegal amount %s without coercion", async value => {
    mount(); await edit(); change(value);
    expect(screen.getByRole("alert")).toHaveTextContent("输入不合法");
    expect(screen.getByRole("button", { name: "保存完整成本" })).toBeDisabled(); expect(controls.save).not.toHaveBeenCalled();
  });
  it("rejects blank freight rate and zero dimensions while allowing nullable dimensions", async () => {
    mount(); await edit(); fireEvent.change(screen.getByLabelText("编辑预测运费单价"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "保存完整成本" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("编辑预测运费单价"), { target: { value: "0" } }); change("0", "重量（kg）");
    expect(screen.getByRole("button", { name: "保存完整成本" })).toBeDisabled();
    change("", "重量（kg）"); expect(screen.getByRole("button", { name: "保存完整成本" })).toBeEnabled();
  });
  it("starts not_saved with explicit draft freight 9, no fabricated saved rows or zeros", async () => {
    const source = fixture(); source.storage = { status: "not_saved" }; currentOptions = options(source);
    mount(); await edit(); expect(field()).toHaveValue(""); expect(screen.getByLabelText("编辑结算币种兑人民币汇率")).toHaveValue("");
    expect(screen.getByLabelText("编辑预测运费单价")).toHaveValue("9");
    expect(screen.getByRole("dialog")).toHaveTextContent("仅为本次未保存草稿默认值");
    change("2"); save(); await waitFor(() => expect(controls.save).toHaveBeenCalled());
    expect(controls.save.mock.calls[0][0]).toMatchObject({ expectedVersion: 0, payload: { settings: { cnyPerCurrency: null, freightRate: 9, standardGoodsConfirmed: false }, rows: [{ key: "item-1", productCost: 2, packagingCost: null, actualFreight: null, actualFba: null, weightKg: null, lengthCm: null, widthCm: null, heightCm: null }] } });
  });
  it("preserves saved orphan rows unchanged and read-only while editing current rows", async () => {
    const source = fixture(); const orphan = { ...row, key: "orphan", productCost: 42 };
    if (source.storage.status === "saved") (source.storage.record.payload as { rows: typeof row[] }).rows.push(orphan);
    currentOptions = options(source); mount(); await edit();
    expect(screen.getByRole("dialog")).toHaveTextContent("保存孤立行 · 只读完整保留");
    expect(screen.queryByLabelText("orphan 产品成本（人民币 / 件）")).not.toBeInTheDocument();
    change("10"); save(); await waitFor(() => expect(controls.save).toHaveBeenCalled());
    expect(controls.save.mock.calls[0][0].payload.rows).toEqual([{ ...row, productCost: 10 }, orphan]);
  });
  it("preserves valid scientific-notation amounts in historical rows without numeric coercion loss", async () => {
    const source = fixture(), orphan = { ...row, key: "small-orphan", productCost: 1e-7, weightKg: 1e-8 };
    if (source.storage.status === "saved") (source.storage.record.payload as { rows: typeof row[] }).rows.push(orphan);
    currentOptions = options(source); mount(); await edit(); change(".5"); save();
    await waitFor(() => expect(controls.save).toHaveBeenCalled());
    expect(controls.save.mock.calls[0][0].payload.rows).toEqual([{ ...row, productCost: 0.5 }, orphan]);
  });
  it.each(["not_connected", "corrupt"] as const)("does not edit or repair %s", async status => {
    const source = fixture(); source.storage = { status }; currentOptions = options(source, status);
    mount(); await check(); expect(screen.queryByRole("button", { name: "打开完整成本编辑" })).not.toBeInTheDocument();
    expect(controls.save).not.toHaveBeenCalled();
  });
  it("does not edit when zero current facts or source unavailable", async () => {
    const source = fixture(); source.sources = []; currentOptions = options(source, "no_current_facts");
    mount(); await check(); expect(screen.getByText(/当前保存能力不可用/)).toHaveTextContent("no_current_facts");
    expect(screen.queryByRole("button", { name: "打开完整成本编辑" })).not.toBeInTheDocument();
  });
  it("rejects a 501st row without dropping saved rows or silently truncating", async () => {
    const source = fixture(); if (source.storage.status === "saved") (source.storage.record.payload as { rows: typeof row[] }).rows = Array.from({ length: 500 }, (_, i) => ({ ...row, key: `orphan-${i}` }));
    currentOptions = options(source); mount(); await edit();
    // The current fact sorts before historical orphan rows in the complete display.
    change("1"); expect(screen.getByRole("alert")).toHaveTextContent("最多 500 行");
    expect(screen.getByRole("button", { name: "保存完整成本" })).toBeDisabled(); expect(controls.save).not.toHaveBeenCalled();
  });
  it("keeps currency-conflict rows editable but never fabricates a profit", async () => {
    const source = fixture(); source.sources![0].currency = "EUR"; currentOptions = options(source);
    mount(); await edit(); change("1"); expect(screen.getByRole("dialog")).toHaveTextContent("币种冲突");
    expect(within(screen.getByRole("region", { name: "完整成本编辑横向表" })).getByRole("cell", { name: /未计算/ })).toBeVisible();
  });
  it("pages all rows and carries offscreen edits into the complete payload", async () => {
    const source = fixture(); source.sources = Array.from({ length: 21 }, (_, i) => ({ ...source.sources![0], id: i + 1, sku: `item-${i + 1}`, name: `成本商品${i + 1}` }));
    currentOptions = options(source); mount(); await edit(); change("8");
    fireEvent.click(screen.getByRole("button", { name: "下一页编辑行" }));
    fireEvent.change(screen.getByLabelText("item-21 包装成本（人民币 / 件）"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "上一页编辑行" })); expect(field()).toHaveValue("8");
    save(); await waitFor(() => expect(controls.save).toHaveBeenCalled());
    expect(controls.save.mock.calls[0][0].payload.rows).toHaveLength(2);
    expect(controls.save.mock.calls[0][0].payload.rows[1]).toMatchObject({ key: "item-21", packagingCost: 3, productCost: null });
  });
  it("asks before discarding a dirty draft and never saves on close", async () => {
    mount(); await edit(); change("2"); fireEvent.click(screen.getByRole("button", { name: "关闭成本编辑" }));
    expect(screen.getByRole("alert")).toHaveTextContent("有未保存修改");
    fireEvent.click(screen.getByRole("button", { name: "继续编辑草稿" })); expect(field()).toHaveValue("2");
    fireEvent.click(screen.getByRole("button", { name: "关闭成本编辑" })); fireEvent.click(screen.getByRole("button", { name: "放弃草稿并关闭" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(controls.save).not.toHaveBeenCalled();
  });
  it("escapes product and source text instead of executing HTML", async () => {
    const source = fixture(); source.sources![0].name = "<img src=x onerror=alert(1)>"; currentOptions = options(source);
    mount(); await edit(); expect(screen.getByRole("dialog")).toHaveTextContent("<img src=x onerror=alert(1)>");
    expect(screen.getByRole("dialog").querySelector("img")).toBeNull();
  });
});

describe("UUID recovery, scope and concurrent-version safety", () => {
  it("persists only recovery metadata before a mutation; unknown blocks duplicate saves", async () => {
    controls.save.mockImplementation(async () => { expect(readOperationsCostSheetPending(owner, scope)?.operationId).toBe(uuid); throw new Error("secret SQL"); });
    mount(); await edit(); change("12.34"); save();
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("保存结果未确认"));
    expect(screen.getByRole("button", { name: "保存完整成本" })).toBeDisabled();
    expect(controls.save).toHaveBeenCalledTimes(1);
    const serialized = localStorage.getItem(localStorage.key(0)!)!;
    expect(JSON.parse(serialized)).toEqual({ version: 1, userId: 7, scope, operationId: uuid });
    expect(serialized).not.toMatch(/12\.34|productCost|secret|payload/);
  });
  it("recovers an unknown save after remount and release-gate rollback, releasing only final cancel ACK", async () => {
    controls.save.mockRejectedValue(new Error("timeout")); const view = mount(); await edit(); change("2"); save();
    await waitFor(() => expect(controls.save).toHaveBeenCalled()); view.unmount();
    currentOptions.capabilities.save = { status: "unavailable", reasonCode: "release_disabled" }; mount();
    expect(controls.options).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByRole("button", { name: "检查成本保存结果" }));
    await waitFor(() => expect(controls.recover).toHaveBeenCalledWith({ ...input, operationId: uuid, decision: "check" }, { signal: expect.any(AbortSignal) }));
    expect(readOperationsCostSheetPending(owner, scope)).not.toBeNull();
    controls.recover.mockResolvedValue(receipt("cancelled"));
    fireEvent.click(screen.getByRole("button", { name: "请求取消未确认保存" }));
    await waitFor(() => expect(readOperationsCostSheetPending(owner, scope)).toBeNull());
    expect(controls.save).toHaveBeenCalledTimes(1);
  });
  it("does not release UUID for malformed, foreign-scope or mismatched receipt", async () => {
    controls.save.mockResolvedValue({ ...receipt(), scope: { ...scope, storeName: "Other" } });
    mount(); await edit(); change("2"); save(); await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("保存结果未确认"));
    controls.recover.mockResolvedValue({ ...receipt("cancelled"), operationId: "22222222-2222-4222-8222-222222222222" });
    fireEvent.click(screen.getByRole("button", { name: "检查本次保存结果" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("未获可信确认")); expect(readOperationsCostSheetPending(owner, scope)).not.toBeNull();
  });
  it("preserves a conflicted draft, compares latest full version, and merges only touched fields", async () => {
    controls.save.mockRejectedValueOnce(new Error("CONFLICT")); mount(); await edit(); change("12"); save();
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("保存结果未确认"));
    const source = fixture(); if (source.storage.status === "saved") { source.storage.record.version = 5; (source.storage.record.payload as { rows: typeof row[] }).rows = [{ ...row, packagingCost: 99 }]; }
    currentOptions = options(source); currentOptions.snapshotKey = "c".repeat(64);
    fireEvent.click(screen.getByRole("button", { name: "刷新最新版本对比（保留草稿）" }));
    await screen.findByRole("region", { name: "成本版本冲突对比" }); expect(field()).toHaveValue("12");
    expect(screen.getByRole("button", { name: "采用最新版本并合并本地改动" })).toBeDisabled();
    controls.recover.mockResolvedValue(receipt("cancelled")); fireEvent.click(screen.getByRole("button", { name: "确认请求取消本次保存" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "采用最新版本并合并本地改动" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "采用最新版本并合并本地改动" }));
    expect(field()).toHaveValue("12"); expect(field("包装成本（人民币 / 件）")).toHaveValue("99");
    save(); await waitFor(() => expect(controls.save).toHaveBeenCalledTimes(2));
    expect(controls.save.mock.calls[1][0]).toMatchObject({ expectedVersion: 5, expectedSnapshotKey: "c".repeat(64), payload: { rows: [{ ...row, productCost: 12, packagingCost: 99 }] } });
  });
  it("refuses a merge that would alter a newly orphaned row", async () => {
    mount(); await edit(); change("12");
    const source = fixture(); source.sources = [{ ...source.sources![0], sku: "replacement" }]; currentOptions = options(source);
    fireEvent.click(screen.getByRole("button", { name: "刷新最新版本对比（保留草稿）" })); await screen.findByRole("region", { name: "成本版本冲突对比" });
    fireEvent.click(screen.getByRole("button", { name: "采用最新版本并合并本地改动" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("无法安全合并"); expect(field()).toHaveValue("12"); expect(controls.save).not.toHaveBeenCalled();
  });
  it("does not accept a post-commit stale options version as current saved data", async () => {
    controls.save.mockResolvedValue(receipt()); mount(); await edit(); change("12"); save();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "产品成本摘要" })).not.toBeInTheDocument();
    expect(readOperationsCostSheetPending(owner, scope)).toBeNull();
  });
  it("clears old data for malformed or cross-scope options and does not display raw errors", async () => {
    controls.options.mockResolvedValue({ ...currentOptions, identity: { userId: 8, workspaceId: 11 } });
    mount(); fireEvent.click(screen.getByRole("button", { name: "检查成本编辑权限" }));
    await screen.findByText(/成本权限、范围或完整来源核验失败/);
    expect(screen.queryByRole("region", { name: "产品成本摘要" })).not.toBeInTheDocument();
  });
  it("aborts and ignores options after actor/scope switch", async () => {
    const old = deferred<OperationsCostSheetWriteOptionsResult>(); controls.options.mockReturnValueOnce(old.promise);
    const view = mount(); fireEvent.click(screen.getByRole("button", { name: "检查成本编辑权限" }));
    const signal = controls.options.mock.calls[0][1].signal;
    view.rerender(<OperationsCostSheetActions owner={{ ...owner, userId: 8 }} scope={{ ...scope, storeName: "Other" }} />);
    expect(signal.aborted).toBe(true); await act(async () => old.resolve(currentOptions));
    expect(screen.queryByText("完整成本商品")).not.toBeInTheDocument(); expect(controls.options).toHaveBeenCalledTimes(1);
  });
  it("keeps old pending metadata after an actor change but hides late mutation results", async () => {
    const old = deferred<unknown>(); controls.save.mockReturnValue(old.promise); const view = mount(); await edit(); change("4"); save();
    const signal = controls.save.mock.calls[0][1].signal;
    view.rerender(<OperationsCostSheetActions owner={{ ...owner, userId: 8 }} scope={scope} />);
    expect(signal.aborted).toBe(true); await act(async () => old.resolve(receipt()));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(screen.queryByText(/未确认的成本操作/)).not.toBeInTheDocument();
    expect(readOperationsCostSheetPending(owner, scope)).not.toBeNull();
  });
  it("blocks writes if local recovery storage cannot be safely persisted", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
    mount(); await edit(); change("5"); save(); expect(controls.save).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("恢复记录无法安全保存");
  });
  it("publishes committed changes to only the exact actor and four-part product scope", async () => {
    const listener = vi.fn(), unsubscribe = subscribeOperationsCostSheetChanges(listener);
    mount(); await edit(); change("2"); save(); await waitFor(() => expect(listener).toHaveBeenCalledWith({ userId: 7, scope })); unsubscribe();
  });
  it("refreshes another already-loaded same-scope entry after a committed save", async () => {
    render(<><OperationsCostSheetActions owner={owner} scope={scope} /><OperationsCostSheetActions owner={owner} scope={scope} /></>);
    const entries = screen.getAllByRole("region", { name: "完整成本编辑入口" });
    for (const entry of entries) {
      fireEvent.click(within(entry).getByRole("button", { name: "检查成本编辑权限" }));
      await within(entry).findByRole("region", { name: "产品成本摘要" });
    }
    fireEvent.click(within(entries[0]).getByRole("button", { name: "打开完整成本编辑" })); change("3"); save();
    await waitFor(() => expect(screen.getAllByText(/当前保存版本 5/)).toHaveLength(2));
    expect(controls.options).toHaveBeenCalledTimes(4); expect(controls.save).toHaveBeenCalledTimes(1);
  });
  it.each(["permission", "workspace", "auth", "pending"])("does not mount an embedded querying entry when %s invalid", kind => {
    if (kind === "permission") controls.permissions.canRead.mockReturnValue(false);
    if (kind === "workspace") controls.auth.user!.defaultWorkspaceId = 12;
    if (kind === "auth") controls.auth.user = null;
    if (kind === "pending") controls.permissions.isLoading = true;
    render(<OperationsCostSheetEmbeddedActions scope={scope} />);
    expect(screen.queryByRole("button", { name: "检查成本编辑权限" })).not.toBeInTheDocument(); expect(controls.options).not.toHaveBeenCalled();
  });
  it("unmounts an embedded dirty draft on permission revocation", async () => {
    const view = render(<OperationsCostSheetEmbeddedActions scope={scope} />); await edit(); change("44");
    controls.permissions.canRead.mockReturnValue(false); view.rerender(<OperationsCostSheetEmbeddedActions scope={scope} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(controls.save).not.toHaveBeenCalled();
  });
});
