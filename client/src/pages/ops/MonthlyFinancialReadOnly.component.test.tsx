// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MonthlyFinancialReadOnly, { MonthlyFinancialBatchContent, MonthlyFinancialHistoryContent, MonthlyFinancialSnapshotContent } from "./MonthlyFinancialReadOnly";
import {
  buildMonthlyFinancialHistoryResult, buildMonthlyFinancialBatchResult, buildMonthlyFinancialSnapshotResult,
  buildMonthlyFinancialHistoryFailure, buildMonthlyFinancialBatchFailure, buildMonthlyFinancialSnapshotFailure,
  findMonthlyFinancialSnapshot,
  type MonthlyFinancialMetrics, type MonthlyFinancialBatchRecord,
  type MonthlyFinancialHistoryInput, type MonthlyFinancialBatchInput, type MonthlyFinancialSnapshotInput,
  type MonthlyFinancialBatchResult, type MonthlyFinancialHistoryResult, type MonthlyFinancialSnapshotResult,
} from "@shared/monthlyFinancialRead";

const controls = vi.hoisted(() => {
  const listBatches = vi.fn(), getBatch = vi.fn(), getEffectiveSnapshot = vi.fn();
  return {
    auth: { loading: false, error: null as Error | null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } as { id: number; defaultWorkspaceId: number | null | undefined; role: string } | null },
    permissions: { isLoading: false, canRead: vi.fn() },
    listBatches, getBatch, getEffectiveSnapshot,
    client: { monthlyFinancialRead: { listBatches: { query: listBatches }, getBatch: { query: getBatch }, getEffectiveSnapshot: { query: getEffectiveSnapshot } } },
  };
});
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => controls.auth }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => controls.permissions }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: controls.client }) } }));

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const allQueries = () => [controls.listBatches, controls.getBatch, controls.getEffectiveSnapshot];
beforeEach(() => {
  controls.auth = { loading: false, error: null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } };
  controls.permissions.isLoading = false; controls.permissions.canRead.mockReset().mockReturnValue(true);
  for (const query of allQueries()) query.mockReset();
});
afterEach(cleanup);

const identity = { userId: 7, workspaceId: 11 };
const businessScope = { yearMonth: "2026-09", storeName: "样本店铺", country: "US", parentAsin: "PARENT-A" };
const metrics: MonthlyFinancialMetrics = {
  financialProfit: -7, salesQty: 2, salesAmount: 100, otherIncome: 0, discount: null,
  purchaseCost: 10, freight: 4, fbaFee: 8, commission: 15, advertising: 20, promotion: 3,
  storage: 1, otherFees: 2, refundAmount: 0, refundQty: 0, returnQty: 1, ld: 0, coupon: 1, vine: null,
};
function row(index = 0, overrides: Record<string, unknown> = {}) {
  return { ...metrics, yearMonth: "2026-09", parentAsin: "PARENT-A", asin: `CHILD-${index}`, sku: `SKU-${index}`,
    title: `原始品名-${index}`, storeName: "样本店铺", site: "US", operator: null,
    raw: { currency: "USD", "1:广告费/费用": -20, original: `<script>private-${index}</script>` }, ...overrides };
}
function record(id = 80, rows = [row()], overrides: Partial<MonthlyFinancialBatchRecord> = {}): MonthlyFinancialBatchRecord {
  return { id, workspaceId: 11, userId: 7, fileName: `样本批次-${id}.csv`, fileHash: "a".repeat(64), status: "completed",
    createdAt: "2026-10-16 09:10:11.123000", confirmedAt: "2026-10-16 09:11:12.345000",
    payload: rows, totalRows: rows.length, skippedRows: 0, unallocatedRows: rows.filter(item => !item.parentAsin).length,
    months: [...new Set(rows.map(item => item.yearMonth))], fileUrl: "saihu-sync-run:99", ...overrides };
}
const historyInput: MonthlyFinancialHistoryInput = { expectedWorkspaceId: 11, cursor: null, limit: 20 };
const batchInput: MonthlyFinancialBatchInput = { expectedWorkspaceId: 11, batchId: 80, rowOffset: 0, pageSize: 20 };
const snapshotInput: MonthlyFinancialSnapshotInput = { ...businessScope, expectedWorkspaceId: 11, rowOffset: 0, pageSize: 20 };
const historyResult = (input = historyInput, records = [record()]) => buildMonthlyFinancialHistoryResult({ identity, input, records });
const batchResult = (input = batchInput, source = record(), visibility: "full" | "scoped" = "full") => buildMonthlyFinancialBatchResult({ identity, input, record: source, metadataVisibility: visibility });
const snapshotResult = (input = snapshotInput, records = [record()], visibility: "full" | "scoped" = "full") => buildMonthlyFinancialSnapshotResult({ identity, input, selection: findMonthlyFinancialSnapshot(records, input, true), metadataVisibility: visibility });
function fillScope(prefix: "明细" | "快照", parent = "PARENT-A") {
  for (const [label, value] of [["月份（YYYY-MM）", "2026-09"], ["店铺", "样本店铺"], ["站点 / 国家代码", "US"]]) fireEvent.change(screen.getByLabelText(`${prefix}${label}`), { target: { value } });
  fireEvent.change(screen.getByLabelText(new RegExp(`^${prefix}父 ASIN`)), { target: { value: parent } });
}
function requestBatch(id = "80") {
  fireEvent.change(screen.getByLabelText("明细批次 ID"), { target: { value: id } });
  fireEvent.click(screen.getByRole("button", { name: "读取所选批次明细" }));
}
function requestSnapshot(parent = "PARENT-A") { fillScope("快照", parent); fireEvent.click(screen.getByRole("button", { name: "读取有效快照" })); }
async function expectBatchVisible() { await screen.findByText("原始品名-0"); }

describe("monthly financial read ownership gates", () => {
  it("starts without private data queries, writes, uploads, or model actions", () => {
    const view = render(<MonthlyFinancialReadOnly />);
    for (const query of allQueries()) expect(query).not.toHaveBeenCalled();
    expect(view.container.firstElementChild).toHaveClass("manus-no-record");
    expect(screen.queryByRole("button", { name: /上传|保存|撤销|生成|导入确认/ })).not.toBeInTheDocument();
    expect(controls.permissions.canRead).toHaveBeenCalledWith("ops", "ops_data_import");
  });
  it.each([
    ["auth pending", () => { controls.auth.loading = true; }],
    ["auth error", () => { controls.auth.error = new Error("private-auth-message"); }],
    ["logout", () => { controls.auth.user = null; }],
    ["invalid user", () => { controls.auth.user!.id = 0; }],
    ["NULL workspace", () => { controls.auth.user!.defaultWorkspaceId = null; }],
    ["missing workspace", () => { controls.auth.user!.defaultWorkspaceId = undefined; }],
    ["bad workspace", () => { controls.auth.user!.defaultWorkspaceId = -1; }],
    ["empty role", () => { controls.auth.user!.role = ""; }],
    ["permission pending", () => { controls.permissions.isLoading = true; }],
    ["permission denied", () => { controls.permissions.canRead.mockReturnValue(false); }],
  ] as const)("does not mount owned readers for %s", (_name, arrange) => {
    arrange(); render(<MonthlyFinancialReadOnly />);
    expect(screen.queryByRole("button", { name: "读取批次历史" })).not.toBeInTheDocument();
    for (const query of allQueries()) expect(query).not.toHaveBeenCalled();
    expect(screen.queryByText("private-auth-message")).not.toBeInTheDocument();
  });
});

describe("explicit keyset history and complete source presentation", () => {
  it("reads history only on action, retains every status and does not auto-read a selection", async () => {
    controls.listBatches.mockResolvedValue(historyResult(historyInput, [record(83, [row()], { status: "previewing", confirmedAt: null }), record(82), record(81, [row()], { status: "deleted" })]));
    render(<MonthlyFinancialReadOnly />);
    fireEvent.click(screen.getByRole("button", { name: "读取批次历史" }));
    await screen.findByRole("button", { name: "选择批次 83" });
    expect(controls.listBatches).toHaveBeenCalledWith(historyInput, { signal: expect.any(AbortSignal) });
    expect(screen.getAllByText(/待确认/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/已撤销/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "选择批次 82" }));
    expect(screen.getByLabelText("明细批次 ID")).toHaveValue("82");
    expect(controls.getBatch).not.toHaveBeenCalled();
    expect(controls.getEffectiveSnapshot).not.toHaveBeenCalled();
  });
  it("uses backend keyset cursors beyond a first page, and re-reads previous pages", async () => {
    controls.listBatches.mockImplementation((input: MonthlyFinancialHistoryInput) => Promise.resolve(historyResult(input,
      input.cursor === null ? Array.from({ length: 21 }, (_, index) => record(150 - index)) : [record(130), record(129)])));
    render(<MonthlyFinancialReadOnly />); fireEvent.click(screen.getByRole("button", { name: "读取批次历史" }));
    await screen.findByRole("button", { name: "选择批次 131" });
    expect(screen.queryByRole("button", { name: "选择批次 130" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一页批次" }));
    await screen.findByRole("button", { name: "选择批次 129" });
    expect(controls.listBatches.mock.calls[1][0]).toEqual({ ...historyInput, cursor: 131 });
    expect(screen.getByRole("button", { name: "下一页批次" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "上一页批次" }));
    await screen.findByRole("button", { name: "选择批次 150" });
    expect(controls.listBatches.mock.calls[2][0]).toEqual(historyInput);
  });
  it("renders every metric, full raw text and expense/ratio components without executable links or HTML", async () => {
    controls.getBatch.mockResolvedValue(batchResult()); const view = render(<MonthlyFinancialReadOnly />); requestBatch(); await expectBatchVisible();
    const table = screen.getByRole("region", { name: "月报完整行横向表" });
    expect(table).toHaveClass("overflow-x-auto"); expect(table).toHaveAttribute("tabindex", "0");
    const cells = within(table).getAllByRole("row")[1].querySelectorAll(":scope > td");
    expect(cells).toHaveLength(22);
    expect(Array.from(cells).slice(2, 21).map(cell => cell.textContent)).toEqual(Object.values(metrics).map(value => value === null ? "未知 / 未提供" : String(value)));
    expect(within(table).getByText(/private-0/)).toHaveTextContent("<script>private-0</script>");
    expect(view.container.querySelector("script")).toBeNull(); expect(view.container.querySelector("a")).toBeNull();
    expect(screen.getByText(/来源运行 ID：99/)).toBeInTheDocument();
    expect(screen.getByText(/mapped_json_bytes/)).toBeInTheDocument();
    expect(screen.getByText(/2026-10-16 09:10:11.123000/)).toBeInTheDocument();
    expect(within(table).getByRole("region", { name: "月报比例和分母", hidden: true })).toHaveTextContent("退款率");
    expect(within(table).getByRole("region", { name: "月报比例和分母", hidden: true })).toHaveTextContent("退货率");
    expect(within(table).getByText(/平均费用：保留加权分子/)).toBeInTheDocument();
    expect(within(table).getByText(/自然销售额/)).toBeInTheDocument();
    expect(within(table).getAllByText(/取值依据：/).length).toBeGreaterThanOrEqual(21);
    expect(controls.getBatch.mock.calls[0][0]).toEqual(batchInput);
  });
  it("does not infer USD from US, and retains zero/negative separately from missing amounts", async () => {
    controls.getBatch.mockResolvedValue(batchResult(batchInput, record(80, [row(0, { raw: { original: "no explicit currency" } })])));
    render(<MonthlyFinancialReadOnly />); requestBatch(); await expectBatchVisible();
    const table = screen.getByRole("region", { name: "月报完整行横向表" });
    expect(table).toHaveTextContent("币种：未知 / 未提供"); expect(table).not.toHaveTextContent("币种：USD");
    const cells = within(table).getAllByRole("row")[1].querySelectorAll(":scope > td");
    expect(cells[2]).toHaveTextContent("-7"); expect(cells[5]).toHaveTextContent("0"); expect(cells[6]).toHaveTextContent("未知 / 未提供");
  });
  it("reads all original row pages without dropping an item and keeps all aggregates independently pageable", async () => {
    const source = record(80, Array.from({ length: 21 }, (_, index) => row(index)));
    controls.getBatch.mockImplementation((input: MonthlyFinancialBatchInput) => Promise.resolve(batchResult(input, source)));
    render(<MonthlyFinancialReadOnly />); requestBatch(); await expectBatchVisible();
    expect(screen.getByText("原始品名-19")).toBeInTheDocument(); expect(screen.queryByText("原始品名-20")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "月报完整行横向表" }).querySelectorAll(":scope > table > tbody > tr")).toHaveLength(20);
    fireEvent.click(screen.getByRole("button", { name: "下一页原始行" }));
    await screen.findByText("原始品名-20"); expect(screen.queryByText("原始品名-0")).not.toBeInTheDocument();
    expect(controls.getBatch.mock.calls[1][0]).toEqual({ ...batchInput, rowOffset: 20 });
    expect(screen.getByRole("button", { name: "下一页原始行" })).toBeDisabled();
    const groups = screen.getByRole("region", { name: "月报父子与未分配完整汇总" });
    expect(groups).toHaveTextContent("共 22 组");
    fireEvent.click(within(groups).getByRole("button", { name: "下一页汇总" }));
    expect(groups).toHaveTextContent("第 2 / 3 页");
    fireEvent.click(within(groups).getByRole("button", { name: "下一页汇总" }));
    expect(groups).toHaveTextContent("CHILD-20");
    fireEvent.click(screen.getByRole("button", { name: "上一页原始行" })); await expectBatchVisible();
    expect(controls.getBatch.mock.calls[2][0].rowOffset).toBe(0);
  });
  it("keeps reported parent, child-derived parent, unallocated and cross-store groups distinct", () => {
    const source = record(80, [row(), row(1, { asin: "", sku: "parent", salesAmount: 1000 }), row(2, { parentAsin: "", asin: "", sku: "unallocated" }), row(3, { storeName: "另一店铺" })]);
    render(<MonthlyFinancialBatchContent result={batchResult(batchInput, source)} />);
    const groups = screen.getByRole("region", { name: "月报父子与未分配完整汇总" });
    expect(groups).toHaveTextContent("原报表父体单行（不能与子体派生合计相加）");
    expect(groups).toHaveTextContent("子体原始行派生汇总"); expect(groups).toHaveTextContent("未分配或歧义行独立汇总");
    expect(groups).toHaveTextContent("另一店铺"); expect(groups).toHaveTextContent("80:2");
  });
});

describe("authorized batch scope and latest effective selection", () => {
  it("allows a nonmanager known batch only with exact scope and redacts other uploader metadata", async () => {
    controls.auth.user!.role = "user";
    const source = record(80, [row(), row(1, { parentAsin: "OTHER", title: "outside-private-row" })], { userId: 99, fileName: "other-uploader-secret.csv" });
    controls.getBatch.mockImplementation((input: MonthlyFinancialBatchInput) => Promise.resolve(batchResult(input, source, "scoped")));
    render(<MonthlyFinancialReadOnly />); requestBatch();
    expect(controls.getBatch).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("范围不完整");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fillScope("明细"); fireEvent.click(screen.getByRole("button", { name: "读取所选批次明细" })); await expectBatchVisible();
    expect(controls.getBatch.mock.calls[0][0]).toEqual({ ...batchInput, scope: businessScope });
    expect(screen.queryByText("other-uploader-secret.csv")).not.toBeInTheDocument(); expect(screen.queryByText("outside-private-row")).not.toBeInTheDocument();
    expect(screen.queryByText("a".repeat(64))).not.toBeInTheDocument();
    expect(screen.getByText(/整批总数未授权或未知/)).toBeInTheDocument();
  });
  it("requires a real parent for nonmanager effective reads; manager omission is all including unallocated", async () => {
    controls.auth.user!.role = "user";
    const view = render(<MonthlyFinancialReadOnly />); requestSnapshot(""); expect(controls.getEffectiveSnapshot).not.toHaveBeenCalled();
    controls.auth.user!.role = "ops_manager"; view.rerender(<MonthlyFinancialReadOnly />);
    controls.getEffectiveSnapshot.mockImplementation((input: MonthlyFinancialSnapshotInput) => Promise.resolve(snapshotResult(input, [record(80, [row(0, { parentAsin: "", asin: "", title: "未分配原记录" })])])));
    requestSnapshot(""); await screen.findByText("未分配原记录");
    expect(controls.getEffectiveSnapshot.mock.calls[0][0]).not.toHaveProperty("parentAsin");
    expect(screen.getByText(/尚未核验店铺\/月度完整覆盖/)).toBeInTheDocument();
  });
  it("does not fill a missing parent from an older completed batch after whole-scope replacement", async () => {
    controls.getEffectiveSnapshot.mockImplementation((input: MonthlyFinancialSnapshotInput) => Promise.resolve(snapshotResult(input, [record(90, [row(0, { parentAsin: "OTHER", title: "new other parent" })]), record(80)])));
    render(<MonthlyFinancialReadOnly />); requestSnapshot();
    await screen.findByText(/有效批次 90/);
    expect(screen.getByText(/当前筛选 0 行/)).toBeInTheDocument();
    expect(screen.queryByText("原始品名-0")).not.toBeInTheDocument(); expect(screen.queryByText("new other parent")).not.toBeInTheDocument();
    expect(screen.getByText(/新版缺少的行不会从旧版补回/)).toBeInTheDocument();
  });
  it("keeps snapshot and batch action results independent and clears a changed scope immediately", async () => {
    controls.getBatch.mockResolvedValue(batchResult()); controls.getEffectiveSnapshot.mockImplementation((input: MonthlyFinancialSnapshotInput) => Promise.resolve(snapshotResult(input, [record(90, [row(0, { title: "有效快照专属行" })])])));
    render(<MonthlyFinancialReadOnly />); requestBatch(); await expectBatchVisible(); requestSnapshot(); await screen.findByText("有效快照专属行");
    fireEvent.change(screen.getByLabelText("快照店铺"), { target: { value: "新店铺" } });
    expect(screen.queryByText("有效快照专属行")).not.toBeInTheDocument(); expect(screen.getByText("原始品名-0")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("明细批次 ID"), { target: { value: "99" } });
    expect(screen.queryByText("原始品名-0")).not.toBeInTheDocument(); expect(controls.getBatch).toHaveBeenCalledTimes(1);
  });
  it("exports presentations for synthetic browser use without RPC", () => {
    render(<><MonthlyFinancialHistoryContent result={historyResult()} /><MonthlyFinancialBatchContent result={batchResult()} /><MonthlyFinancialSnapshotContent result={snapshotResult()} /></>);
    for (const query of allQueries()) expect(query).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "已选月报批次明细" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "当前有效月报快照" })).toBeInTheDocument();
  });
});

describe("fail-closed response identity, page continuity and errors", () => {
  it.each([
    ["identity user", (value: MonthlyFinancialBatchResult) => { value.identity.userId++; }],
    ["identity workspace", (value: MonthlyFinancialBatchResult) => { value.identity.workspaceId++; }],
    ["batch ID", (value: MonthlyFinancialBatchResult) => { value.batch!.id++; }],
    ["request offset", (value: MonthlyFinancialBatchResult) => { value.page.rowOffset = 20; }],
    ["page size", (value: MonthlyFinancialBatchResult) => { value.page.pageSize = 10; }],
    ["missing row", (value: MonthlyFinancialBatchResult) => { value.rows = []; }],
    ["duplicate row", (value: MonthlyFinancialBatchResult) => { value.rows.push(value.rows[0]); }],
    ["invalid next", (value: MonthlyFinancialBatchResult) => { value.page.nextOffset = 20; }],
    ["truncated claims", (value: MonthlyFinancialBatchResult) => { value.page.matchedRows = 2; }],
    ["scope in full request", (value: MonthlyFinancialBatchResult) => { value.scope = businessScope; }],
    ["foreign row batch", (value: MonthlyFinancialBatchResult) => { value.rows[0].batchId++; }],
    ["foreign aggregate", (value: MonthlyFinancialBatchResult) => { value.aggregates[0].sourceRows[0].batchId++; }],
    ["missing groups source", (value: MonthlyFinancialBatchResult) => { value.aggregates[0].sourceRows = []; }],
    ["schema extra", (value: MonthlyFinancialBatchResult) => { Object.assign(value, { serverSecret: "raw-secret" }); }],
  ] as const)("rejects %s rather than displaying unvalidated rows", async (_name, mutate) => {
    const value = batchResult(); mutate(value); controls.getBatch.mockResolvedValue(value);
    render(<MonthlyFinancialReadOnly />); requestBatch(); await screen.findByRole("alert");
    expect(screen.queryByText("原始品名-0")).not.toBeInTheDocument(); expect(screen.queryByText("raw-secret")).not.toBeInTheDocument();
  });
  it("rejects full metadata of another uploader for a nonmanager even with scoped rows", async () => {
    controls.auth.user!.role = "user";
    controls.getBatch.mockImplementation((input: MonthlyFinancialBatchInput) => Promise.resolve(batchResult(input, record(80, [row()], { userId: 99 }))));
    render(<MonthlyFinancialReadOnly />); fillScope("明细"); requestBatch(); await screen.findByRole("alert"); expect(screen.queryByText("原始品名-0")).not.toBeInTheDocument();
  });
  it.each([
    ["wrong user", (value: MonthlyFinancialHistoryResult) => { value.identity.userId++; }],
    ["wrong cursor", (value: MonthlyFinancialHistoryResult) => { value.page.cursor = 81; }],
    ["duplicate ID", (value: MonthlyFinancialHistoryResult) => { value.batches.push(value.batches[0]); }],
    ["fake hasMore", (value: MonthlyFinancialHistoryResult) => { value.page.hasMore = true; value.page.nextCursor = 80; }],
  ] as const)("rejects history %s", async (_name, mutate) => {
    const value = historyResult(); mutate(value); controls.listBatches.mockResolvedValue(value); render(<MonthlyFinancialReadOnly />);
    fireEvent.click(screen.getByRole("button", { name: "读取批次历史" })); await screen.findByRole("alert"); expect(screen.queryByRole("button", { name: "选择批次 80" })).not.toBeInTheDocument();
  });
  it.each([
    ["wrong owner", (value: MonthlyFinancialSnapshotResult) => { value.identity.userId++; }],
    ["wrong scope", (value: MonthlyFinancialSnapshotResult) => { value.scope.storeName = "other"; }],
    ["incomplete scan", (value: MonthlyFinancialSnapshotResult) => { value.selection.complete = false; }],
    ["wrong winner", (value: MonthlyFinancialSnapshotResult) => { value.selectedBatchId = 79; }],
    ["duplicate winner", (value: MonthlyFinancialSnapshotResult) => { value.winningScopes.push(value.winningScopes[0]); }],
  ] as const)("rejects effective snapshot %s", async (_name, mutate) => {
    const value = snapshotResult(); mutate(value); controls.getEffectiveSnapshot.mockResolvedValue(value);
    render(<MonthlyFinancialReadOnly />); requestSnapshot(); await screen.findByRole("alert"); expect(screen.queryByText("原始品名-0")).not.toBeInTheDocument();
  });
  it.each(["missing", "not_found", "invalid"] as const)("distinguishes %s from a successful zero-valued result", async status => {
    const failure = { identity, status, reasonCode: `safe_${status}`, missingReason: `安全说明-${status}` };
    controls.listBatches.mockResolvedValue(buildMonthlyFinancialHistoryFailure({ ...failure, input: historyInput }));
    controls.getBatch.mockResolvedValue(buildMonthlyFinancialBatchFailure({ ...failure, input: batchInput }));
    controls.getEffectiveSnapshot.mockResolvedValue(buildMonthlyFinancialSnapshotFailure({ ...failure, input: snapshotInput }));
    render(<MonthlyFinancialReadOnly />); fireEvent.click(screen.getByRole("button", { name: "读取批次历史" }));
    await screen.findByText(`安全说明-${status}`); requestBatch(); requestSnapshot();
    await waitFor(() => expect(screen.getAllByText(`安全说明-${status}`)).toHaveLength(3));
    expect(screen.queryByText(/当前筛选 0 行/)).not.toBeInTheDocument();
  });
  it("clears previous data on errors and never displays raw error text or reuses cached results", async () => {
    controls.getBatch.mockResolvedValueOnce(batchResult()).mockRejectedValueOnce(new Error("private-sql-credential"));
    render(<MonthlyFinancialReadOnly />); requestBatch(); await expectBatchVisible();
    fireEvent.click(screen.getByRole("button", { name: "读取所选批次明细" })); await screen.findByRole("alert");
    expect(screen.queryByText("原始品名-0")).not.toBeInTheDocument(); expect(screen.queryByText("private-sql-credential")).not.toBeInTheDocument();
  });
});

describe("owned reads and late response destruction", () => {
  it.each([
    ["user", () => { controls.auth.user!.id++; }], ["workspace", () => { controls.auth.user!.defaultWorkspaceId = 12; }],
    ["role", () => { controls.auth.user!.role = "ops_manager"; }], ["auth pending", () => { controls.auth.loading = true; }],
    ["permissions pending", () => { controls.permissions.isLoading = true; }], ["permission revoked", () => { controls.permissions.canRead.mockReturnValue(false); }],
  ] as const)("destroys old data and pending results on %s change", async (_name, change) => {
    const pending = deferred<MonthlyFinancialBatchResult>(); controls.getBatch.mockResolvedValueOnce(batchResult()).mockReturnValueOnce(pending.promise);
    const view = render(<MonthlyFinancialReadOnly />); requestBatch(); await expectBatchVisible();
    fireEvent.click(screen.getByRole("button", { name: "读取所选批次明细" }));
    const signal = controls.getBatch.mock.calls[1][1].signal as AbortSignal;
    change(); view.rerender(<MonthlyFinancialReadOnly />); expect(signal.aborted).toBe(true);
    await act(async () => { pending.resolve(batchResult()); });
    expect(screen.queryByText("原始品名-0")).not.toBeInTheDocument();
    expect(controls.getBatch).toHaveBeenCalledTimes(2);
  });
  it("only renders the newest response in one lane even if transport ignores abort", async () => {
    const old = deferred<MonthlyFinancialBatchResult>(); controls.getBatch.mockReturnValueOnce(old.promise).mockResolvedValueOnce(batchResult(batchInput, record(80, [row(0, { title: "最新回包行" })])));
    render(<MonthlyFinancialReadOnly />); requestBatch(); fireEvent.click(screen.getByRole("button", { name: "读取所选批次明细" })); await screen.findByText("最新回包行");
    expect(controls.getBatch.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { old.resolve(batchResult()); }); expect(screen.queryByText("原始品名-0")).not.toBeInTheDocument(); expect(screen.getByText("最新回包行")).toBeInTheDocument();
  });
  it("invalidates a late batch request on selection change and a late snapshot on input edit", async () => {
    const oldBatch = deferred<MonthlyFinancialBatchResult>(), oldSnapshot = deferred<MonthlyFinancialSnapshotResult>();
    controls.getBatch.mockReturnValue(oldBatch.promise); controls.getEffectiveSnapshot.mockReturnValue(oldSnapshot.promise);
    render(<MonthlyFinancialReadOnly />); requestBatch(); requestSnapshot();
    fireEvent.change(screen.getByLabelText("明细批次 ID"), { target: { value: "81" } });
    fireEvent.change(screen.getByLabelText("快照月份（YYYY-MM）"), { target: { value: "2026-10" } });
    await act(async () => { oldBatch.resolve(batchResult()); oldSnapshot.resolve(snapshotResult()); });
    expect(screen.queryByText("原始品名-0")).not.toBeInTheDocument();
    expect(controls.getBatch.mock.calls[0][1].signal.aborted).toBe(true); expect(controls.getEffectiveSnapshot.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it("aborts all three physical requests on unmount and ignores all three late successes", async () => {
    const a = deferred<MonthlyFinancialHistoryResult>(), b = deferred<MonthlyFinancialBatchResult>(), c = deferred<MonthlyFinancialSnapshotResult>();
    controls.listBatches.mockReturnValue(a.promise); controls.getBatch.mockReturnValue(b.promise); controls.getEffectiveSnapshot.mockReturnValue(c.promise);
    const view = render(<MonthlyFinancialReadOnly />); fireEvent.click(screen.getByRole("button", { name: "读取批次历史" })); requestBatch(); requestSnapshot();
    const signals = allQueries().map(query => query.mock.calls[0][1].signal as AbortSignal);
    view.unmount(); expect(signals.every(signal => signal.aborted)).toBe(true);
    await act(async () => { a.resolve(historyResult()); b.resolve(batchResult()); c.resolve(snapshotResult()); });
    expect(screen.queryByText("原始品名-0")).not.toBeInTheDocument();
  });
  it("a different history selection destroys already displayed details without another query", async () => {
    controls.listBatches.mockResolvedValue(historyResult(historyInput, [record(81), record(80)])); controls.getBatch.mockResolvedValue(batchResult());
    render(<MonthlyFinancialReadOnly />); fireEvent.click(screen.getByRole("button", { name: "读取批次历史" })); await screen.findByRole("button", { name: "选择批次 80" });
    requestBatch(); await expectBatchVisible(); fireEvent.click(screen.getByRole("button", { name: "选择批次 81" }));
    expect(screen.queryByText("原始品名-0")).not.toBeInTheDocument(); expect(screen.getByLabelText("明细批次 ID")).toHaveValue("81");
    expect(controls.getBatch).toHaveBeenCalledTimes(1);
  });
  it("clear buttons abort only their owned lanes and do not fetch or mutate", async () => {
    const pending = deferred<MonthlyFinancialBatchResult>(); controls.getBatch.mockReturnValue(pending.promise);
    render(<MonthlyFinancialReadOnly />); requestBatch(); fireEvent.click(screen.getByRole("button", { name: "取消并清除明细" }));
    expect(controls.getBatch.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { pending.resolve(batchResult()); }); expect(screen.queryByText("原始品名-0")).not.toBeInTheDocument();
    expect(controls.getBatch).toHaveBeenCalledTimes(1); expect(controls.listBatches).not.toHaveBeenCalled(); expect(controls.getEffectiveSnapshot).not.toHaveBeenCalled();
  });
});
