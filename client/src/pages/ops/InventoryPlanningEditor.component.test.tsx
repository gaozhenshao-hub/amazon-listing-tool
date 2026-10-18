// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InventoryPlanningEditor, { InventoryPlanningEditorController, buildInventoryPlanningDraftPatch, initializeInventoryPlanningDraft, readInventoryPlanningPending, subscribeInventoryPlanningChanges, type InventoryPlanningEditorTarget } from "./InventoryPlanningEditor";
import { INVENTORY_PLANNING_DEFAULTS, InventoryPlanningReadResultSchema, resolveInventoryPlanningState, type InventoryPlanningReadInput, type InventoryPlanningReadResult, type InventoryPlanningParameterRow, type InventoryPlanningLocalRow } from "@shared/inventoryPlanningWrite";

const controls = vi.hoisted(() => ({ read: vi.fn(), execute: vi.fn(), recover: vi.fn(),
  auth: { loading: false, error: null as Error | null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } as { id: number; defaultWorkspaceId: number; role: string } | null },
  permissions: { isLoading: false, canRead: vi.fn(), canEdit: vi.fn() },
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => controls.auth }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => controls.permissions }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: { inventoryPlanningWrite: { read: { query: controls.read }, execute: { mutate: controls.execute }, recover: { mutate: controls.recover } } } }) } }));
const owner = { userId: 7, workspaceId: 11, role: "admin" }, identity = { userId: 7, workspaceId: 11 };
const scope = { scopeType: "asin" as const, asin: "B000000001", storeName: "合成精确店铺", country: "美国" };
const asOfDate = "2026-10-18", marketplace = "ALL", hash = "a".repeat(64), uuid = "11111111-1111-4111-8111-111111111111", uuid2 = "22222222-2222-4222-8222-222222222222";
const key = "inventory-planning-write:v1:7:11", onClose = vi.fn();
const available = { status: "available" as const, reasonCode: null };
function target(mode: InventoryPlanningEditorTarget["mode"] = "cost"): InventoryPlanningEditorTarget { return { owner, scope, asOfDate, marketplace, mode }; }
const input = (): InventoryPlanningReadInput => ({ expectedWorkspaceId: 11, scope, asOfDate, marketplace });
function parameter(overrides: Partial<InventoryPlanningParameterRow> = {}): InventoryPlanningParameterRow {
  return { ...INVENTORY_PLANNING_DEFAULTS, ...identity, id: 21, scopeType: "asin", asin: scope.asin, storeName: scope.storeName, country: scope.country, parentAsin: null, isActive: 1, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-17T00:00:00.000Z", productionDays: 32, shippingDays: 28, bufferDays: 12, targetCoverDays: 47, moq: 18, packSize: 6,
    productCost: 12.34, estimatedFirstLegCost: null, actualFirstLegCost: 0, estimatedFbaFee: 3.5, actualFbaFee: 4.55, sellingPrice: 39.99, estimatedDimensions: "10 × 20 × 30", actualDimensions: null, estimatedWeight: 1.234, actualWeight: null, dimensionUnit: "cm", weightUnit: "kg", ...overrides };
}
function local(id = 1): InventoryPlanningLocalRow {
  return { ...identity, id, asin: scope.asin, storeName: scope.storeName, country: scope.country, effectiveDate: `2026-10-${String(id).padStart(2, "0")}`, localQty: id * 10, reason: `第 ${id} 条原确认原因 <script>仅原文</script>`, status: "confirmed", confirmedBy: 7, confirmedAt: "2026-10-17T00:00:00.000Z", supersededById: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-17T00:00:00.000Z" };
}
function readResult(request = input(), params: InventoryPlanningParameterRow[] = [parameter()], locals: InventoryPlanningLocalRow[] = [local()]): InventoryPlanningReadResult {
  const resolved = resolveInventoryPlanningState({ identity, scope: request.scope, asOfDate: request.asOfDate, parameters: params, locals });
  return InventoryPlanningReadResultSchema.parse({ identity, scope: request.scope, asOfDate: request.asOfDate, marketplace: request.marketplace, status: "ready", reasonCode: null, snapshotKey: hash,
    source: { status: "available", recordCount: 1, asOfDate: request.asOfDate }, ...resolved, capabilities: { confirmLocal: available, saveParameters: available } });
}
function receipt(action: "confirmLocal" | "saveParameters" = "saveParameters", status = "committed", overrides: Record<string, unknown> = {}) {
  return { identity, scope, asOfDate, marketplace, operationId: uuid, action, status, recordId: status === "committed" ? 22 : null, snapshotKey: status === "committed" ? "b".repeat(64) : null, reasonCode: status === "committed" ? null : status, ...overrides };
}
function persist(action = "saveParameters", overrides: Record<string, unknown> = {}) { localStorage.setItem(key, JSON.stringify({ version: 1, ...identity, operationId: uuid, action, scope, asOfDate, marketplace, expectedSnapshotKey: hash, ...overrides })); }
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function opened(mode: InventoryPlanningEditorTarget["mode"] = "cost") {
  const view = render(<InventoryPlanningEditorController owner={owner} target={target(mode)} onClose={onClose} />);
  await screen.findByText(/参数生效来源：asin/); return view;
}
async function save(mode: "local" | "planning" | "cost" = "cost") { fireEvent.click(screen.getByRole("button", { name: mode === "local" ? "确认保存本地绝对库存" : "保存已编辑字段" })); await waitFor(() => expect(controls.execute).toHaveBeenCalled()); }
beforeEach(() => {
  cleanup(); localStorage.clear(); vi.restoreAllMocks(); onClose.mockReset();
  controls.auth = { loading: false, error: null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } }; controls.permissions.isLoading = false; controls.permissions.canRead.mockReset().mockReturnValue(true); controls.permissions.canEdit.mockReset().mockReturnValue(true);
  controls.read.mockReset().mockImplementation(async request => readResult(request)); controls.execute.mockReset().mockImplementation(async request => receipt(request.action)); controls.recover.mockReset().mockResolvedValue(receipt("saveParameters", "unknown"));
  vi.spyOn(crypto, "randomUUID").mockReturnValue(uuid);
  const locks = new Map<string, Promise<unknown>>(); Object.defineProperty(navigator, "locks", { configurable: true, value: { request: vi.fn((name: string, options: { signal?: AbortSignal }, callback: () => unknown) => {
    const next = (locks.get(name) ?? Promise.resolve()).then(() => { if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError"); return callback(); }); locks.set(name, next.catch(() => {})); return next;
  }) } });
});
afterEach(cleanup);

describe("parameter patch preserves unknowns and independent groups", () => {
  it("initializes every one of the 19 fields without changing units, zeros, nulls or target configuration", () => {
    const values = readResult().parameters!.effective, draft = initializeInventoryPlanningDraft(values);
    expect(Object.keys(draft)).toHaveLength(19); expect(draft.dimensionUnit).toBe("cm"); expect(draft.weightUnit).toBe("kg"); expect(draft.targetCoverDays).toBe("47"); expect(draft.actualFirstLegCost).toBe("0"); expect(draft.estimatedFirstLegCost).toBe("");
  });
  it("changes only touched values and keeps all costs/units outside a planning edit", () => {
    const values = readResult().parameters!.effective, draft = initializeInventoryPlanningDraft(values); draft.productionDays = "40"; draft.moq = "0";
    expect(buildInventoryPlanningDraftPatch(values, draft, new Set(["productionDays", "moq"]))).toEqual({ productionDays: 40, moq: 0 });
  });
  it("distinguishes explicit zero, clear-null and an omitted field", () => {
    const values = readResult().parameters!.effective, draft = initializeInventoryPlanningDraft(values); draft.productCost = "0"; draft.estimatedWeight = "";
    expect(buildInventoryPlanningDraftPatch(values, draft, new Set(["productCost", "estimatedWeight"]))).toEqual({ productCost: 0, estimatedWeight: null });
  });
  it.each(["", "NaN", "Infinity", "-1", "1.234", "100000000", "3junk", "1e-400", "1.00000000000000001"])("rejects bad or overprecision cost %s without rounding", raw => {
    const values = readResult().parameters!.effective, draft = initializeInventoryPlanningDraft(values); draft.productCost = raw;
    if (raw === "") expect(buildInventoryPlanningDraftPatch(values, draft, new Set(["productCost"]))).toEqual({ productCost: null });
    else expect(() => buildInventoryPlanningDraftPatch(values, draft, new Set(["productCost"]))).toThrow();
  });
  it("accepts finite scientific decimal input and skips an unchanged numeric equivalent", () => {
    const values = readResult().parameters!.effective, draft = initializeInventoryPlanningDraft(values); draft.productCost = "2e1"; draft.actualFirstLegCost = "0.00";
    expect(buildInventoryPlanningDraftPatch(values, draft, new Set(["productCost", "actualFirstLegCost"]))).toEqual({ productCost: 20 });
  });
  it("allows insignificant trailing zero precision without treating the original number as over-precise", () => {
    const values = readResult().parameters!.effective, draft = initializeInventoryPlanningDraft(values); draft.productCost = "1.2300"; draft.estimatedWeight = "0.0010";
    expect(buildInventoryPlanningDraftPatch(values, draft, new Set(["productCost", "estimatedWeight"]))).toEqual({ productCost: 1.23, estimatedWeight: 0.001 });
  });
  it.each(["", "1.5", "-1", "366"])("rejects bad nonnullable lead time %s", raw => {
    const values = readResult().parameters!.effective, draft = initializeInventoryPlanningDraft(values); draft.productionDays = raw; expect(() => buildInventoryPlanningDraftPatch(values, draft, new Set(["productionDays"]))).toThrow();
  });
});

describe("editor reads current server state and all complete fields", () => {
  it("does not read or write while closed, then reads exact source context on explicit opening", async () => {
    const view = render(<InventoryPlanningEditor target={null} onClose={onClose} />); expect(controls.read).not.toHaveBeenCalled(); expect(controls.execute).not.toHaveBeenCalled();
    view.rerender(<InventoryPlanningEditor target={target()} onClose={onClose} />); await screen.findByText(/参数生效来源：asin/);
    expect(controls.read).toHaveBeenCalledWith(input(), { signal: expect.any(AbortSignal) }); expect(controls.execute).not.toHaveBeenCalled();
    expect(screen.getByLabelText("预估头程")).toHaveValue(""); expect(screen.getByLabelText("实际头程")).toHaveValue("0");
    expect(screen.getByLabelText("尺寸单位")).toHaveValue("cm"); expect(screen.getByLabelText("重量单位")).toHaveValue("kg");
  });
  it("saves a cost-only patch with fresh CAS and no forged parent, lead, MOQ or unit defaults", async () => {
    await opened(); change("产品成本", "22.5"); await save();
    expect(controls.execute.mock.calls[0][0]).toEqual({ ...input(), action: "saveParameters", operationId: uuid, expectedSnapshotKey: hash, patch: { productCost: 22.5 } });
    await waitFor(() => expect(localStorage.getItem(key)).toBeNull()); expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("edits complete six planning parameters without reverse-writing derived targetCover or costs", async () => {
    await opened("planning"); expect(screen.getByLabelText("目标覆盖配置天数（非派生缺口）")).toHaveValue("47");
    for (const label of ["生产天数", "物流天数", "缓冲天数", "目标覆盖配置天数（非派生缺口）", "最低起订量 MOQ", "包装倍数"]) expect(screen.getByLabelText(label)).toBeVisible();
    change("包装倍数", "12"); change("最低起订量 MOQ", "0"); await save("planning"); expect(controls.execute.mock.calls[0][0].patch).toEqual({ moq: 0, packSize: 12 });
  });
  it("permits all six costs, both dimensions/weights and both units, preserving explicit clear", async () => {
    await opened(); change("预估头程", "0"); change("预估尺寸", ""); change("实际尺寸", "4 × 5 × 6"); change("预估重量", ""); change("实际重量", "1.001"); change("尺寸单位", "in"); change("重量单位", "lb");
    await save(); expect(controls.execute.mock.calls[0][0].patch).toEqual({ estimatedFirstLegCost: 0, estimatedDimensions: null, actualDimensions: "4 × 5 × 6", estimatedWeight: null, actualWeight: 1.001, dimensionUnit: "in", weightUnit: "lb" });
  });
  it("confirms absolute zero with historical/future date and reason, rather than a delta", async () => {
    await opened("local"); change("确认后的本地绝对数量", "0"); change("本地库存生效日期", "2026-11-01"); change("本地库存确认原因", "未来入库盘点确认");
    expect(screen.getByText(/不计入当前截至日的本地库存/)).toBeVisible(); await save("local");
    expect(controls.execute.mock.calls[0][0]).toEqual({ ...input(), operationId: uuid, expectedSnapshotKey: hash, action: "confirmLocal", localQty: 0, effectiveDate: "2026-11-01", reason: "未来入库盘点确认" });
  });
  it.each(["", "-1", "1.5", "2147483648"])("does not submit invalid absolute quantity %s", async value => {
    await opened("local"); change("确认后的本地绝对数量", value); fireEvent.click(screen.getByRole("button", { name: "确认保存本地绝对库存" })); await screen.findByText(/输入不合法或没有实际修改/);
    expect(controls.execute).not.toHaveBeenCalled(); expect(crypto.randomUUID).not.toHaveBeenCalled();
  });
  it("does not invent existing local inventory when no record exists", async () => {
    controls.read.mockResolvedValue(readResult(input(), [], [])); render(<InventoryPlanningEditorController owner={owner} target={target("local")} onClose={onClose} />);
    await screen.findByText(/参数生效来源：system_defaults/); expect(screen.getByLabelText("确认后的本地绝对数量")).toHaveValue(""); expect(screen.getByText(/尚未确认，不代表实际库存为 0/)).toBeVisible();
  });
  it("renders all local history pages and escaped original reasons", async () => {
    controls.read.mockResolvedValue(readResult(input(), [parameter()], Array.from({ length: 27 }, (_, index) => local(index + 1)))); await opened("local");
    fireEvent.click(screen.getByText("全部本地库存确认历史（27 条）")); expect(screen.getByText(/第 27 条原确认原因/, { selector: "td" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "历史下一页" })); expect(screen.getByText(/第 1 条原确认原因/, { selector: "td" })).toBeVisible(); expect(screen.getByText(/第 2 页 \/ 2 页/)).toBeVisible();
    expect(document.querySelector("script[src=x]")).toBeNull();
  });
  it("disabled release remains readable but cannot save", async () => {
    const value = readResult(); value.capabilities.saveParameters = { status: "unavailable", reasonCode: "release_disabled" }; controls.read.mockResolvedValue(value);
    await opened(); expect(screen.getByRole("button", { name: "保存已编辑字段" })).toBeDisabled(); expect(screen.getByLabelText("产品成本")).toBeDisabled();
  });
  it.each(["unavailable", "conflict"] as const)("does not manufacture fields for %s source", async status => {
    const value = { ...readResult(), status, reasonCode: "legacy_parameter_conflict", snapshotKey: null, parameters: null, local: null, capabilities: { confirmLocal: { status: "unavailable", reasonCode: "legacy_parameter_conflict" }, saveParameters: { status: "unavailable", reasonCode: "legacy_parameter_conflict" } } };
    controls.read.mockResolvedValue(value); render(<InventoryPlanningEditorController owner={owner} target={target()} onClose={onClose} />);
    await screen.findByText(/原人工记录或来源不可读 \/ 有冲突/); expect(screen.queryByLabelText("产品成本")).not.toBeInTheDocument(); expect(controls.execute).not.toHaveBeenCalled();
  });
  it("asks before discarding a dirty draft", async () => {
    await opened(); change("产品成本", "50"); fireEvent.click(screen.getByRole("button", { name: "关闭编辑" }));
    expect(screen.getByRole("alert")).toHaveTextContent("存在未保存草稿"); expect(onClose).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "继续编辑" })); expect(screen.getByLabelText("产品成本")).toHaveValue("50");
    fireEvent.click(screen.getByRole("button", { name: "关闭编辑" })); fireEvent.click(screen.getByRole("button", { name: "确认丢弃草稿并关闭" })); expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("fixed operation recovery and explicit conflict comparison", () => {
  it.each(["same", "different"])("preserves an unsubmitted dirty draft when recovering another editor's committed %s scope", async relation => {
    await opened(); change("产品成本", "64.25");
    const operationScope = relation === "same" ? scope : { ...scope, asin: "B000000002", storeName: "另一窗口店铺" };
    persist("saveParameters", { scope: operationScope }); act(() => window.dispatchEvent(new StorageEvent("storage", { key })));
    controls.recover.mockResolvedValue(receipt("saveParameters", "committed", { scope: operationScope }));
    fireEvent.click(screen.getByRole("button", { name: "检查原人工规划操作" })); await screen.findByText(/它不是当前草稿的提交/);
    expect(onClose).not.toHaveBeenCalled(); expect(screen.getByLabelText("产品成本")).toHaveValue("64.25"); expect(localStorage.getItem(key)).toBeNull();
    expect(screen.getByRole("button", { name: "保存已编辑字段" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "读取当前版本用于对照" })); await screen.findByRole("region", { name: "人工规划当前版本对照" });
    expect(controls.read.mock.calls.at(-1)![0]).toEqual(input()); fireEvent.click(screen.getByRole("button", { name: "采用当前版本并保留已编辑字段" }));
    expect(screen.getByLabelText("产品成本")).toHaveValue("64.25"); expect(screen.getByRole("button", { name: "保存已编辑字段" })).toBeEnabled();
  });
  it("clears a submitted draft only when recovery confirms this editor's own UUID and target", async () => {
    controls.execute.mockRejectedValue(new Error("lost ACK")); await opened(); change("产品成本", "64.25"); await save(); await screen.findByText(/未取得可核验保存回执/);
    controls.recover.mockResolvedValue(receipt()); fireEvent.click(screen.getByRole("button", { name: "检查原人工规划操作" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1)); expect(localStorage.getItem(key)).toBeNull();
  });
  it("serializes two editors under one owner lock and never overwrites the first unresolved UUID", async () => {
    const delayed = deferred<unknown>(); controls.execute.mockReturnValue(delayed.promise);
    render(<><InventoryPlanningEditorController owner={owner} target={target()} onClose={onClose} /><InventoryPlanningEditorController owner={owner} target={target()} onClose={onClose} /></>);
    await waitFor(() => expect(screen.getAllByLabelText("产品成本")).toHaveLength(2));
    const dialogs = screen.getAllByRole("dialog", { hidden: true });
    for (const dialog of dialogs) fireEvent.change(within(dialog).getByLabelText("产品成本"), { target: { value: "23" } });
    for (const dialog of dialogs) fireEvent.click(within(dialog).getByRole("button", { name: "保存已编辑字段", hidden: true }));
    await waitFor(() => expect(controls.execute).toHaveBeenCalledTimes(1));
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1); expect(readInventoryPlanningPending(owner)?.operationId).toBe(uuid);
    await act(async () => { delayed.resolve(receipt("saveParameters", "unknown")); });
    expect(readInventoryPlanningPending(owner)?.operationId).toBe(uuid); expect(controls.execute).toHaveBeenCalledTimes(1);
  });
  it("leaves original recovery metadata after the editor target changes during a save", async () => {
    const delayed = deferred<unknown>(); controls.execute.mockReturnValue(delayed.promise); const view = await opened();
    change("产品成本", "23"); await save(); const savingSignal = controls.execute.mock.calls[0][1].signal;
    view.rerender(<InventoryPlanningEditorController owner={owner} target={target("planning")} onClose={onClose} />);
    await screen.findByLabelText("生产天数"); expect(savingSignal.aborted).toBe(true);
    await act(async () => { delayed.resolve(receipt()); });
    expect(readInventoryPlanningPending(owner)?.operationId).toBe(uuid); expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "保存已编辑字段" })).toBeDisabled();
  });
  it("persists only metadata before sending and retains the original UUID on lost ACK", async () => {
    controls.execute.mockImplementation(async () => { const record = readInventoryPlanningPending(owner); expect(record?.operationId).toBe(uuid); throw new Error("secret connection text"); });
    await opened(); change("产品成本", "66.66"); await save(); await screen.findByText(/未取得可核验保存回执/);
    expect(screen.getByLabelText("产品成本")).toHaveValue("66.66"); expect(screen.getByRole("button", { name: "保存已编辑字段" })).toBeDisabled();
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ version: 1, ...identity, operationId: uuid, action: "saveParameters", scope, asOfDate, marketplace, expectedSnapshotKey: hash });
    expect(localStorage.getItem(key)).not.toContain("66.66"); expect(screen.queryByText("secret connection text")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "检查原人工规划操作" })).toBeVisible();
  });
  it("restores an unknown operation while closed, with release off and create/edit revoked", async () => {
    persist(); controls.permissions.canEdit.mockReturnValue(false); controls.recover.mockResolvedValue(receipt()); const notice = vi.fn(), unsubscribe = subscribeInventoryPlanningChanges(notice);
    render(<InventoryPlanningEditor target={null} onClose={onClose} />); expect(controls.read).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "检查原人工规划操作" }));
    await screen.findByText(/已确认保存记录 #22/); expect(controls.recover).toHaveBeenCalledWith({ ...input(), operationId: uuid, decision: "check" }, { signal: expect.any(AbortSignal) });
    expect(notice).toHaveBeenCalledWith({ ...identity, scope, asOfDate, marketplace, action: "saveParameters" }); expect(controls.execute).not.toHaveBeenCalled(); unsubscribe();
  });
  it("preserves conflicting draft, requires cancellation and deliberate rebase before another UUID", async () => {
    controls.execute.mockRejectedValue({ data: { code: "CONFLICT" } }); await opened(); change("产品成本", "77"); await save(); await screen.findByText(/版本冲突，草稿保留/);
    controls.read.mockResolvedValue({ ...readResult(input(), [parameter({ productCost: 15, dimensionUnit: "in" })]), snapshotKey: "c".repeat(64) });
    fireEvent.click(screen.getByRole("button", { name: "读取当前版本用于对照" })); await screen.findByRole("region", { name: "人工规划当前版本对照" });
    expect(screen.getByLabelText("产品成本")).toHaveValue("77"); expect(screen.getByRole("button", { name: "采用当前版本并保留已编辑字段" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /确认永久取消此编号/ })); controls.recover.mockResolvedValue(receipt("saveParameters", "cancelled", { action: null })); fireEvent.click(screen.getByRole("button", { name: "永久取消原人工规划操作" }));
    await screen.findByText(/服务端已确认永久取消，原草稿保留/); expect(screen.getByRole("button", { name: "保存已编辑字段" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "读取当前版本用于对照" })); await screen.findByRole("region", { name: "人工规划当前版本对照" });
    fireEvent.click(screen.getByRole("button", { name: "采用当前版本并保留已编辑字段" })); expect(screen.getByLabelText("产品成本")).toHaveValue("77"); expect(screen.getByLabelText("尺寸单位")).toHaveValue("in");
    vi.mocked(crypto.randomUUID).mockReturnValue(uuid2); controls.execute.mockImplementation(async request => receipt(request.action, "committed", { operationId: request.operationId })); await save();
    await waitFor(() => expect(controls.execute).toHaveBeenCalledTimes(2)); expect(controls.execute.mock.calls[1][0]).toEqual({ ...input(), operationId: uuid2, action: "saveParameters", expectedSnapshotKey: "c".repeat(64), patch: { productCost: 77 } });
  });
  it("requires permanent cancellation acknowledgement, and unknown cancel does not release", async () => {
    persist(); render(<InventoryPlanningEditor target={null} onClose={onClose} />); const button = screen.getByRole("button", { name: "永久取消原人工规划操作" }); expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(button); await screen.findByText(/保存结果未知/); expect(localStorage.getItem(key)).not.toBeNull();
    controls.recover.mockResolvedValue(receipt("saveParameters", "cancelled", { action: null })); fireEvent.click(button); await screen.findByText(/服务端已确认永久取消/); expect(localStorage.getItem(key)).toBeNull();
  });
  it("does not cancel a replacement UUID before its storage event arrives", () => {
    persist(); render(<InventoryPlanningEditor target={null} onClose={onClose} />); fireEvent.click(screen.getByRole("checkbox")); persist("saveParameters", { operationId: uuid2 });
    fireEvent.click(screen.getByRole("button", { name: "永久取消原人工规划操作" })); expect(controls.recover).not.toHaveBeenCalled(); expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
  it("resets cancellation acknowledgement for a cross-tab UUID change", () => {
    persist(); render(<InventoryPlanningEditor target={null} onClose={onClose} />); fireEvent.click(screen.getByRole("checkbox")); persist("saveParameters", { operationId: uuid2 }); act(() => window.dispatchEvent(new StorageEvent("storage", { key })));
    expect(screen.getByRole("checkbox")).not.toBeChecked(); expect(screen.getByRole("button", { name: "永久取消原人工规划操作" })).toBeDisabled();
  });
  it.each(["identity", "workspace", "scope", "date", "marketplace", "uuid", "action", "incomplete"])("rejects a mismatched final receipt %s and retains UUID", async part => {
    persist(); const value = receipt() as any;
    if (part === "identity") value.identity = { ...identity, userId: 8 }; if (part === "workspace") value.identity = { ...identity, workspaceId: 12 };
    if (part === "scope") value.scope = { ...scope, storeName: "Other" }; if (part === "date") value.asOfDate = "2026-10-17"; if (part === "marketplace") value.marketplace = "US";
    if (part === "uuid") value.operationId = uuid2; if (part === "action") value.action = "confirmLocal"; if (part === "incomplete") value.snapshotKey = null;
    controls.recover.mockResolvedValue(value); render(<InventoryPlanningEditor target={null} onClose={onClose} />); fireEvent.click(screen.getByRole("button", { name: "检查原人工规划操作" }));
    await screen.findByText(/恢复核对失败/); expect(readInventoryPlanningPending(owner)?.operationId).toBe(uuid); expect(onClose).not.toHaveBeenCalled();
  });
  it("disables new saves without navigator locks but permits safe final-result recovery", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined }); persist(); controls.recover.mockResolvedValue(receipt("saveParameters", "cancelled", { action: null }));
    render(<InventoryPlanningEditor target={null} onClose={onClose} />); expect(screen.getByRole("alert")).toHaveTextContent("禁止新保存"); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "永久取消原人工规划操作" }));
    await screen.findByText(/本机编号尚未释放/); expect(localStorage.getItem(key)).not.toBeNull(); expect(controls.execute).not.toHaveBeenCalled();
  });
  it("refuses malformed storage without deleting private recovery data", async () => {
    persist("saveParameters", { draft: "private-costs" }); render(<InventoryPlanningEditor target={null} onClose={onClose} />);
    expect(screen.getByRole("alert")).toHaveTextContent("恢复记录损坏"); expect(localStorage.getItem(key)).toContain("private-costs"); expect(screen.queryByText("private-costs")).not.toBeInTheDocument();
  });
});

describe("fresh actor, directory and source binding", () => {
  it.each(["ops_dashboard", "ops_inventory"])("requires read directory %s", menu => {
    controls.permissions.canRead.mockImplementation((_module, directory) => directory !== menu); render(<InventoryPlanningEditor target={target()} onClose={onClose} />);
    expect(screen.getByRole("alert")).toHaveTextContent("缺少人工规划读取权限"); expect(controls.read).not.toHaveBeenCalled();
  });
  it.each(["ops_specialist", "finance", "viewer", ""])("does not grant role %s a writable editor", role => {
    controls.auth.user!.role = role; render(<InventoryPlanningEditor target={target()} onClose={onClose} />); expect(controls.read).not.toHaveBeenCalled(); expect(screen.queryByLabelText("产品成本")).not.toBeInTheDocument();
  });
  it.each(["actor", "workspace", "role", "permission", "loading"])("clears stale editor and ignores late response when %s changes", async scenario => {
    const delayed = deferred<unknown>(); controls.read.mockReturnValue(delayed.promise); const view = render(<InventoryPlanningEditor target={target()} onClose={onClose} />);
    await waitFor(() => expect(controls.read).toHaveBeenCalledTimes(1));
    if (scenario === "actor") controls.auth.user!.id = 8; if (scenario === "workspace") controls.auth.user!.defaultWorkspaceId = 12; if (scenario === "role") controls.auth.user!.role = "ops_manager";
    if (scenario === "permission") controls.permissions.canRead.mockReturnValue(false); if (scenario === "loading") controls.permissions.isLoading = true;
    view.rerender(<InventoryPlanningEditor target={target()} onClose={onClose} />); expect(controls.read.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { delayed.resolve(readResult()); }); expect(screen.queryByLabelText("产品成本")).not.toBeInTheDocument(); expect(controls.read).toHaveBeenCalledTimes(1);
  });
  it.each(["identity", "scope", "date", "marketplace"])("rejects a read result from another %s", async part => {
    const value = readResult() as any;
    if (part === "identity") value.identity = { ...identity, userId: 8 }; if (part === "scope") value.scope = { ...scope, asin: "B000000002" }; if (part === "date") value.asOfDate = "2026-10-17"; if (part === "marketplace") value.marketplace = "US";
    controls.read.mockResolvedValue(value); render(<InventoryPlanningEditorController owner={owner} target={target()} onClose={onClose} />); await screen.findByText(/读取失败或身份/); expect(screen.queryByLabelText("产品成本")).not.toBeInTheDocument();
  });
  it("discards a prior response on target store/date/marketplace change and loads only the new scope", async () => {
    const delayed = deferred<unknown>(); controls.read.mockReturnValueOnce(delayed.promise); const view = render(<InventoryPlanningEditorController owner={owner} target={target()} onClose={onClose} />);
    const next = { ...target(), scope: { ...scope, storeName: "另一店铺" }, asOfDate: "2026-10-19", marketplace: "US" };
    controls.read.mockImplementation(async request => readResult(request, [parameter({ storeName: "另一店铺" })], [])); view.rerender(<InventoryPlanningEditorController owner={owner} target={next} onClose={onClose} />);
    await screen.findByText(/参数生效来源：asin/); expect(controls.read.mock.calls[0][1].signal.aborted).toBe(true); await act(async () => { delayed.resolve(readResult()); });
    expect(controls.read.mock.calls[1][0]).toEqual({ expectedWorkspaceId: 11, scope: next.scope, asOfDate: next.asOfDate, marketplace: "US" }); expect(screen.getByText(/另一店铺/, { selector: "p" })).toBeVisible();
  });
});
