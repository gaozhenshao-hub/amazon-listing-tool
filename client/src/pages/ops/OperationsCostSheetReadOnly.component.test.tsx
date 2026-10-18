// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildOperationsCostSheetReadResult, type BuildOperationsCostSheetReadInput, type OperationsCostSheetReadResult } from "@shared/operationsCostSheetRead";
import OperationsCostSheetReadOnly, { OperationsCostSheetReadOnlyContent } from "./OperationsCostSheetReadOnly";

const controls = vi.hoisted(() => {
  const query = vi.fn(), options = vi.fn(), save = vi.fn(), recover = vi.fn();
  return {
    auth: { loading: false, error: null as Error | null, user: { id: 7, defaultWorkspaceId: 11 as number | null | undefined, role: "admin" } as { id: number; defaultWorkspaceId: number | null | undefined; role: string } | null },
    permissions: { isLoading: false, canRead: vi.fn() }, query, options, save, recover,
    client: { productCostsReadOnly: { get: { query } }, productCostsWrite: { options: { query: options }, save: { mutate: save }, recover: { mutate: recover } } },
  };
});
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => controls.auth }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => controls.permissions }));
// Deliberately no shared useQuery cache, mutation or model client.
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: controls.client }) } }));

function fixture(): BuildOperationsCostSheetReadInput {
  const input = { key: "item-1", productCost: 0, packagingCost: 4, actualFreight: 3, actualFba: 4,
    weightKg: 1, lengthCm: 20, widthCm: 15, heightCm: 10 };
  const workspaceId = controls.auth.user!.defaultWorkspaceId!;
  const scope = { workspaceId, parentAsin: "B000000001", storeName: "Synthetic Store", country: "US" };
  return {
    identity: { userId: controls.auth.user!.id, workspaceId }, scope, asOfDate: "2026-10-17",
    storage: { status: "saved", record: { id: 1, version: 4, updatedBy: 7, updatedAt: "2026-10-16T10:20:30.000Z",
      payload: { settings: { cnyPerCurrency: 7, freightRate: 20, standardGoodsConfirmed: false }, rows: [input] } } },
    sources: [{ kind: "lingxing", id: 17, importId: 8, date: "2026-10-15", scope,
      sourceKind: "synthetic-report", sourceBatchId: 31, sourceTraceId: "trace-synthetic", sourceSchemaVersion: "v1",
      sku: "item-1", msku: null, asin: "B000000011", name: "完整成本商品", currency: "USD", price: 20,
      actualFbaUnitFee: -5, actualFbaTotalFee: -50, fbaSalesQty: 10, missingColumns: [] }],
  };
}
function result(input = fixture()): OperationsCostSheetReadResult { return buildOperationsCostSheetReadResult(input); }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function enter(store = "Synthetic Store") {
  fireEvent.change(screen.getByLabelText("父 ASIN"), { target: { value: "B000000001" } });
  fireEvent.change(screen.getByLabelText("店铺名称"), { target: { value: store } });
  fireEvent.change(screen.getByLabelText("站点 / 国家代码"), { target: { value: "US" } });
}
function submit() { fireEvent.click(screen.getByRole("button", { name: "读取此范围成本表" })); }
const ready = () => screen.findByRole("region", { name: "已保存完整成本设置" });
beforeEach(() => {
  controls.auth = { loading: false, error: null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } };
  controls.permissions.isLoading = false; controls.permissions.canRead.mockReset().mockReturnValue(true);
  controls.query.mockReset().mockResolvedValue(result());
  controls.options.mockReset(); controls.save.mockReset(); controls.recover.mockReset(); localStorage.clear();
});
afterEach(cleanup);

describe("explicit, owned cost-sheet read", () => {
  it("adds a separately authorized editor after read and refreshes exact-scope read data after save", async () => {
    const before = result(); let after = before;
    controls.options.mockImplementation(async () => ({ identity: after.identity, scope: after.scope, readResult: after, snapshotKey: "a".repeat(64), capabilities: { save: { status: "available", reasonCode: null } } }));
    controls.query.mockImplementation(async () => after);
    controls.save.mockImplementation(async request => {
      const source = fixture(); if (source.storage.status === "saved") { source.storage.record.payload = request.payload; source.storage.record.version = 5; }
      after = result(source);
      return { identity: after.identity, scope: after.scope, operationId: request.operationId, status: "committed", version: 5, snapshotKey: "a".repeat(64), reasonCode: null };
    });
    render(<OperationsCostSheetReadOnly />); enter(); submit(); await ready();
    expect(controls.options).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "检查成本编辑权限" }));
    fireEvent.click(await screen.findByRole("button", { name: "打开完整成本编辑" }));
    fireEvent.change(screen.getByLabelText("item-1 产品成本（人民币 / 件）"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "保存完整成本" }));
    await waitFor(() => expect(controls.query).toHaveBeenCalledTimes(2));
    expect(controls.query.mock.calls[1][0]).toEqual({ expectedWorkspaceId: 11, parentAsin: "B000000001", storeName: "Synthetic Store", country: "US" });
    await waitFor(() => expect(screen.getByRole("region", { name: "已保存完整成本设置" })).toHaveTextContent("版本 5"));
    expect(screen.getAllByRole("region", { name: "完整成本编辑入口" })).toHaveLength(1);
  });
  it("does not query until explicit submission and sends only the selected scope", async () => {
    const view = render(<OperationsCostSheetReadOnly />);
    expect(controls.query).not.toHaveBeenCalled(); enter(); expect(controls.query).not.toHaveBeenCalled(); submit(); await ready();
    expect(controls.query).toHaveBeenCalledTimes(1);
    expect(controls.query).toHaveBeenCalledWith({ parentAsin: "B000000001", storeName: "Synthetic Store", country: "US", expectedWorkspaceId: 11 }, { signal: expect.any(AbortSignal) });
    expect(controls.permissions.canRead).toHaveBeenCalledWith("ops", "ops_data_import");
    expect(view.container.firstElementChild).toHaveClass("manus-no-record");
    expect(screen.queryByRole("button", { name: /保存|上传|生成|导入确认/ })).not.toBeInTheDocument();
    expect(screen.getByText(/规则基准日期：2026-10-17/)).toBeVisible();
  });
  it("rejects empty input before a data request", () => {
    render(<OperationsCostSheetReadOnly />); submit(); expect(controls.query).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("未发送读取请求");
  });
  it.each([
    ["loading", () => { controls.auth.loading = true; }], ["auth error", () => { controls.auth.error = new Error("secret-auth"); }],
    ["logged out", () => { controls.auth.user = null; }], ["invalid user", () => { controls.auth.user!.id = 0; }],
    ["NULL workspace", () => { controls.auth.user!.defaultWorkspaceId = null; }], ["missing workspace", () => { controls.auth.user!.defaultWorkspaceId = undefined; }],
    ["invalid workspace", () => { controls.auth.user!.defaultWorkspaceId = -1; }], ["missing role", () => { controls.auth.user!.role = ""; }],
    ["permission pending", () => { controls.permissions.isLoading = true; }], ["denied", () => { controls.permissions.canRead.mockReturnValue(false); }],
  ] as const)("does not mount a read form for %s", (_name, arrange) => {
    arrange(); render(<OperationsCostSheetReadOnly />);
    expect(screen.queryByRole("form", { name: "成本表查询范围" })).not.toBeInTheDocument();
    expect(controls.query).not.toHaveBeenCalled(); expect(screen.queryByText("secret-auth")).not.toBeInTheDocument();
  });
  it.each(["user", "workspace", "role", "auth pending", "permission revoked"])("destroys old content on %s without automatic re-read", async field => {
    const view = render(<OperationsCostSheetReadOnly />); enter(); submit(); await ready();
    if (field === "user") controls.auth.user!.id = 8;
    if (field === "workspace") controls.auth.user!.defaultWorkspaceId = 12;
    if (field === "role") controls.auth.user!.role = "ops_specialist";
    if (field === "auth pending") controls.auth.loading = true;
    if (field === "permission revoked") controls.permissions.canRead.mockReturnValue(false);
    view.rerender(<OperationsCostSheetReadOnly />);
    expect(screen.queryByText("完整成本商品")).not.toBeInTheDocument(); expect(screen.queryByText(/版本 4/)).not.toBeInTheDocument();
    expect(controls.query).toHaveBeenCalledTimes(1);
  });
  it.each(["parentAsin", "storeName", "country"])("clears old results as soon as %s is edited, before submit", async field => {
    render(<OperationsCostSheetReadOnly />); enter(); submit(); await ready();
    const labels = { parentAsin: "父 ASIN", storeName: "店铺名称", country: "站点 / 国家代码" };
    fireEvent.change(screen.getByLabelText(labels[field as keyof typeof labels]), { target: { value: "Changed" } });
    expect(screen.queryByRole("region", { name: "已保存完整成本设置" })).not.toBeInTheDocument(); expect(controls.query).toHaveBeenCalledTimes(1);
  });
  it("aborts pending work and ignores old scope responses even if transport ignores abort", async () => {
    const old = deferred<OperationsCostSheetReadResult>(), oldValue = result(); controls.query.mockReturnValueOnce(old.promise);
    const view = render(<OperationsCostSheetReadOnly />); enter(); submit();
    const signal = controls.query.mock.calls[0][1].signal;
    controls.auth.user = { id: 8, defaultWorkspaceId: 12, role: "ops_specialist" };
    view.rerender(<OperationsCostSheetReadOnly />); expect(signal.aborted).toBe(true);
    const next = result(); next.rows[0].name = "当前范围商品"; controls.query.mockResolvedValue(next); enter(); submit(); await ready();
    await act(async () => old.resolve(oldValue));
    expect(screen.getByText("当前范围商品")).toBeVisible(); expect(screen.queryByText("完整成本商品")).not.toBeInTheDocument();
  });
  it("only accepts the last explicit request and clears data on failure without raw messages", async () => {
    const old = deferred<OperationsCostSheetReadResult>(), value = result(); controls.query.mockReturnValueOnce(old.promise);
    render(<OperationsCostSheetReadOnly />); enter(); submit(); const firstSignal = controls.query.mock.calls[0][1].signal;
    submit(); await ready(); expect(firstSignal.aborted).toBe(true);
    await act(async () => old.reject(new Error("secret late failure"))); expect(screen.getByText("完整成本商品")).toBeVisible();
    controls.query.mockRejectedValue(new Error("secret SQL password")); submit();
    expect(screen.queryByRole("region", { name: "已保存完整成本设置" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("读取失败"));
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument(); expect(value.saved?.version).toBe(4);
  });
  it.each(["cancel", "unmount", "input change"])("ignores a late response after %s", async operation => {
    const task = deferred<OperationsCostSheetReadResult>(), value = result(); controls.query.mockReturnValue(task.promise);
    const view = render(<OperationsCostSheetReadOnly />); enter(); submit();
    if (operation === "cancel") fireEvent.click(screen.getByRole("button", { name: "取消读取并清除结果" }));
    if (operation === "unmount") view.unmount();
    if (operation === "input change") fireEvent.change(screen.getByLabelText("店铺名称"), { target: { value: "Other" } });
    expect(controls.query.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => task.resolve(value)); expect(screen.queryByText("完整成本商品")).not.toBeInTheDocument();
  });
  it.each(["user", "workspace", "scope workspace", "parent", "store", "country", "extra", "bad rows"])("rejects malformed or mismatched %s responses", async field => {
    const value = result();
    if (field === "user") value.identity.userId = 99;
    if (field === "workspace") value.identity.workspaceId = 99;
    if (field === "scope workspace") value.scope.workspaceId = 99;
    if (field === "parent") value.scope.parentAsin = "B000000002";
    if (field === "store") value.scope.storeName = "Other";
    if (field === "country") value.scope.country = "CA";
    if (field === "extra") Object.assign(value, { secret: "do-not-render" });
    if (field === "bad rows") Object.assign(value, { rows: null });
    controls.query.mockResolvedValue(value); render(<OperationsCostSheetReadOnly />); enter(); submit();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("返回数据不完整"));
    expect(screen.queryByText("完整成本商品")).not.toBeInTheDocument();
  });
});

describe("full cost presentation without fabricated values", () => {
  it("shows settings, version, units, server percentage and separate actual vs predicted costs", () => {
    render(<OperationsCostSheetReadOnlyContent result={result()} />);
    expect(screen.getByText(/版本 4 · 更新人 7/)).toBeVisible(); expect(screen.getByText("未确认")).toBeVisible();
    expect(screen.getByText(/60%/)).toBeVisible(); expect(screen.queryByText(/6000%/)).not.toBeInTheDocument();
    expect(screen.getByText(/历史版本不可用/)).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "保存实际 FBA（结算币种 / 件）" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "报表实际 FBA（结算币种 / 件）" })).toBeVisible();
    const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    expect(cells[3]).toHaveTextContent(/^0$/); expect(cells[9]).toHaveTextContent(/^4$/); expect(cells[10]).toHaveTextContent(/^5$/);
  });
  it("preserves all observation sources and literal escaped text", () => {
    const input = fixture(); input.sources![0].name = "<img src=x onerror=alert(1)>";
    input.sources!.push({ ...input.sources![0], kind: "saihu", id: 18, importId: 9, date: "2026-10-16" });
    const value = result(input), row = value.rows[0];
    const view = render(<OperationsCostSheetReadOnlyContent result={value} />);
    fireEvent.click(screen.getByText("查看全部 2 条来源观测"));
    expect(screen.getByText(/赛狐 · 2026-10-16 · ID 18 · 导入 9/)).toBeVisible();
    expect(screen.getAllByText(/来源类型：synthetic-report · 批次：31 · 追踪：trace-synthetic · 来源版本：v1/)).toHaveLength(2);
    expect(screen.getAllByText(/原单件 FBA：-5 · 原 FBA 总费：-50 · 原 FBA 销量：10/)).toHaveLength(2);
    expect(view.container.querySelector("img,script")).toBeNull(); expect(screen.getByText(row.name)).toBeVisible();
  });
  it("keeps orphan rows and missing inputs distinct from a real zero", () => {
    const input = fixture(); if (input.storage.status !== "saved") throw new Error("fixture requires saved");
    const payload = result().saved!.payload; payload.rows[0].key = "saved-orphan"; input.storage.record.payload = payload;
    render(<OperationsCostSheetReadOnlyContent result={result(input)} />);
    expect(screen.getByText(/保存孤立行（未匹配报表）/)).toBeVisible(); expect(screen.getByText(/没有该 SKU 的完整保存成本输入/)).toBeVisible();
    expect(within(screen.getAllByRole("row")[1]).getAllByRole("cell")[3]).toHaveTextContent(/^未提供$/);
    expect(within(screen.getAllByRole("row")[2]).getAllByRole("cell")[3]).toHaveTextContent(/^0$/);
  });
  it.each(["not_saved", "not_connected", "corrupt"] as const)("shows %s as a distinct non-zero, non-saved state", status => {
    const input = fixture(); input.storage = { status }; input.sources = [];
    render(<OperationsCostSheetReadOnlyContent result={result(input)} />);
    const text = { not_saved: "此范围尚未保存完整成本表", not_connected: "完整成本表尚未连接（缺表）", corrupt: "已保存成本内容损坏或不兼容" };
    expect(screen.getByText(new RegExp(text[status].replace(/[（）]/g, "\\$&")))).toBeVisible();
    expect(screen.queryByRole("region", { name: "已保存完整成本设置" })).not.toBeInTheDocument(); expect(screen.getByText(/这不代表零成本或零利润/)).toBeVisible();
  });
  it("distinguishes unavailable source count from an available empty report", () => {
    const input = fixture(); input.sources = null;
    const view = render(<OperationsCostSheetReadOnlyContent result={result(input)} />);
    expect(screen.getByText("报表来源不可用，记录数量未知（不是零条）")).toBeVisible();
    expect(screen.queryByText("本次报表来源记录：0 条")).not.toBeInTheDocument();
    input.sources = []; view.rerender(<OperationsCostSheetReadOnlyContent result={result(input)} />);
    expect(screen.getByText("本次报表来源记录：0 条")).toBeVisible();
  });
  it("shows same-day source conflicts and does not turn missing profit into zero", () => {
    const input = fixture(); input.sources!.push({ ...input.sources![0], kind: "saihu", id: 18, price: 25 });
    render(<OperationsCostSheetReadOnlyContent result={result(input)} />);
    expect(screen.getByText(/同日来源冲突，不能据此计算利润/)).toBeVisible();
    expect(screen.getByText(/同日跨来源事实冲突，不能认定最新事实/)).toBeVisible();
    expect(screen.queryByText(/60%/)).not.toBeInTheDocument();
  });
  it("paginates all rows including the last orphan using focusable native controls and local overflow", () => {
    const input = fixture(); if (input.storage.status !== "saved") throw new Error("fixture requires saved");
    const payload = result().saved!.payload, original = payload.rows[0], source = input.sources![0];
    payload.rows = Array.from({ length: 21 }, (_, index) => ({ ...original, key: `item-${index}` })); input.storage.record.payload = payload;
    input.sources = Array.from({ length: 20 }, (_, index) => ({ ...source, id: index + 1, sku: `item-${index}`, name: `分页商品${index}` }));
    render(<OperationsCostSheetReadOnlyContent result={result(input)} />);
    const viewport = screen.getByRole("region", { name: "成本明细横向滚动表" }); expect(viewport).toHaveAttribute("tabindex", "0"); expect(viewport).toHaveClass("overflow-x-auto", "max-w-full");
    expect(screen.getAllByRole("row")).toHaveLength(21); expect(screen.queryByText("item-20")).not.toBeInTheDocument();
    const next = screen.getByRole("button", { name: "下一页成本行" }); next.focus(); expect(next).toHaveFocus(); fireEvent.click(next);
    expect(screen.getAllByText("item-20")[0]).toBeVisible(); expect(screen.getByText(/保存孤立行（未匹配报表）/)).toBeVisible();
    expect(next).toBeDisabled(); fireEvent.click(screen.getByRole("button", { name: "上一页成本行" })); expect(screen.getByText("分页商品0")).toBeVisible();
  });
});
