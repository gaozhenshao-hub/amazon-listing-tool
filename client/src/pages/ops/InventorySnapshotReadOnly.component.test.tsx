// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InventorySnapshotReadOnly, { InventorySnapshotReadOnlyContent } from "./InventorySnapshotReadOnly";
import { publishInventorySnapshotChange } from "./InventorySnapshotRefresh";
import {
  buildInventorySnapshotReadFailure, buildInventorySnapshotReadResult, InventorySnapshotReadInputSchema,
  mapInventorySources, parseInventorySnapshot, planInventoryScopeAccess,
  type InventorySnapshotReadInput, type InventorySnapshotReadResult, type InventorySources, type InventoryScopeBinding,
} from "@shared/inventorySnapshotRead";

const controls = vi.hoisted(() => ({
  auth: { loading: false, error: null as Error | null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } as { id: number; defaultWorkspaceId: number | null | undefined; role: string } | null },
  permissions: { isLoading: false, canRead: vi.fn() }, query: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => controls.auth }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => controls.permissions }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: { inventorySnapshotRead: { get: { query: controls.query } } } }) } }));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const CAPTURED = Date.UTC(2026, 9, 17, 0, 1, 2), STARTED = CAPTURED - 1000;
const scope = { parentAsin: "P00", storeName: "测试店铺", country: "US", accountId: "account-1" };
function input(overrides: Partial<InventorySnapshotReadInput> = {}) {
  return InventorySnapshotReadInputSchema.parse({ expectedWorkspaceId: 11, search: "", unpaired: false, ageThreshold: 180, groupOffset: 0, groupLimit: 12, agedGroupOffset: 0, agedGroupLimit: 12, ...overrides });
}
/** Real source replay and DTO builders; no mock inventory arithmetic. */
function payload(groupCount = 2, options: { unknown?: boolean; zero?: boolean; label?: string } = {}) {
  const sources: InventorySources = { warehouses: [], warehouse: [], fba: [], commodities: [], aux: [], listings: [], shipping: [], shippingItems: [], details: [] };
  const bindings: InventoryScopeBinding[] = [];
  for (let group = 0; group < groupCount; group++) for (let child = 0; child < (group === 0 ? 2 : 1); child++) {
    const index = sources.fba.length, cid = index + 1, businessScope = { ...scope, parentAsin: `P${String(group).padStart(2, "0")}` };
    const fields = { parentAsin: "parentAsin", storeName: "storeName", country: "country", accountId: "accountId" };
    const listing = { ...businessScope, id: cid, commodityId: cid, asin: `ASIN-${group}-${child}`, sku: `MSKU-${group}-${child}`, commoditySku: `LOCAL-${cid}`, commodityName: options.label ?? `商品 ${group}-${child}`, marketplaceId: "ATVPDKIKX0DER" };
    sources.listings.push(listing); sources.commodities.push({ id: cid, sku: listing.commoditySku, name: listing.commodityName });
    const isZero = options.zero && group === 1;
    sources.fba.push({ ...listing, shareKey: `pool-${cid}`, currency: "CNY", available: isZero ? 0 : 5, reservedTransfer: isZero ? 0 : 1, reservedProcessing: isZero ? 0 : 1, reservedCustomerorders: isZero ? 0 : 1, unfulfillable: isZero ? 0 : 1, research: isZero ? 0 : 1, inTransit: isZero ? 0 : 4, inboundShipped: isZero ? 0 : 3, inboundReceiving: isZero ? 0 : 1, inboundWorking: isZero ? 0 : 100, totalInventory: isZero ? 0 : 14, purchaseCosts: isZero ? 0 : 140, invAge181To270Days: options.unknown && group === 1 ? null : 2, invAge271To365Days: 3, invAge365PlusDays: 1, snapshotDate: "2026-10-10", devList: [{ devName: "来源负责人（不是权限）" }] });
    for (const source of ["fba", "listings"] as const) bindings.push({ ref: { source, index, id: String(cid) }, scope: businessScope, mappingId: `mapping-${source}-${cid}`, kind: "explicit_confirmed_field_mapping", fields });
  }
  return mapInventorySources({ sources, scopeBindings: bindings, startedAt: STARTED, capturedAt: CAPTURED });
}
function result(request = input(), data: unknown = payload(), userId = 7, scoped = false) {
  const scopedRows = scoped && request.exactScope ? planInventoryScopeAccess(parseInventorySnapshot(data), request.exactScope).rowIds : undefined;
  return buildInventorySnapshotReadResult({ identity: { userId, workspaceId: request.expectedWorkspaceId }, input: request, record: { id: 41, workspaceId: request.expectedWorkspaceId, runId: 82, capturedAt: CAPTURED, payload: data }, ...(scoped ? { visibility: "scoped" as const, scopedRows } : {}) });
}
function legacyPayload() {
  const aux = [{ id: "shared-aux", sku: "AUX-SKU", name: "共享纸箱", stock: { quantity: 2, value: 0 }, shared: true, note: "多商品关联，只计一次" }];
  const row = { id: "legacy-1", parentAsin: "LEGACY-P", parentName: "旧版商品", asin: "OLD-ASIN", msku: "OLD-MSKU", localSku: "OLD-LOCAL", commodityId: "old", name: "旧版商品", ownerIds: [777], operator: "旧负责人", unpaired: true, allocation: "旧分配说明", lastShipment: "2025-01-02", plan: 2.123456789, domestic: { quantity: 3, value: 1 }, purchase: { quantity: 2, value: 0 }, shipping: { quantity: 0, value: 0 }, fba: { quantity: 0, value: null }, total: { quantity: 5, value: null }, aux, notes: ["https://example.test/private-not-a-link", "<img src=x onerror=alert(1)>"] };
  return { version: 1, currency: "CNY", startedAt: STARTED, capturedAt: CAPTURED, rows: [row, { ...row, id: "legacy-2", name: "旧版第二行" }], warnings: ["仅历史保存来源"], sourceCounts: { warehouses: 0, warehouse: 0, fba: 0, commodities: 0, aux: 0, listings: 0, shipping: 0, shippingItems: 0, details: 0 } };
}
const readButton = () => screen.getByRole("button", { name: "读取已有库存快照" });
async function readReady() { fireEvent.click(readButton()); await screen.findByText(/上次更新：/); }
function fillScope() {
  for (const [label, value] of [["库存父 ASIN", "P00"], ["库存店铺", scope.storeName], ["库存站点 / 国家代码", "美国"], ["库存来源账号 ID", scope.accountId]]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
beforeEach(() => {
  controls.auth = { loading: false, error: null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } };
  controls.permissions.isLoading = false; controls.permissions.canRead.mockReset().mockReturnValue(true); controls.query.mockReset();
});
afterEach(cleanup);

describe("committed collection refreshes already opened inventory only", () => {
  it("keeps filters and resets both page cursors, clearing the old result before fresh read", async () => {
    controls.query.mockImplementation((request: InventorySnapshotReadInput) => Promise.resolve(result(request, payload(13))));
    render(<InventorySnapshotReadOnly />);
    fireEvent.change(screen.getByLabelText("库存搜索"), { target: { value: "ASIN" } });
    fireEvent.change(screen.getByLabelText("库存超龄口径"), { target: { value: "365" } });
    await readReady(); fireEvent.click(screen.getByRole("button", { name: "库存父组下一页" }));
    await waitFor(() => expect(controls.query.mock.calls.at(-1)?.[0].groupOffset).toBe(12));
    await screen.findByText(/上次更新：/);
    const delayed = deferred<InventorySnapshotReadResult>(); controls.query.mockReturnValueOnce(delayed.promise);
    act(() => publishInventorySnapshotChange({ userId: 7, workspaceId: 11, snapshotId: 42 }));
    expect(screen.queryByText(/上次更新：/)).not.toBeInTheDocument();
    const request = controls.query.mock.calls.at(-1)![0] as InventorySnapshotReadInput;
    expect(request).toEqual(input({ search: "ASIN", ageThreshold: 365 }));
    await act(async () => { delayed.resolve(result(request)); }); await screen.findByText(/上次更新：/);
  });
  it("keeps an opened exact scope and unpaired filter", async () => {
    controls.query.mockImplementation((request: InventorySnapshotReadInput) => Promise.resolve(result(request)));
    render(<InventorySnapshotReadOnly />); fireEvent.click(screen.getByLabelText(/读取工作区可见的全部/)); fillScope();
    fireEvent.click(screen.getByLabelText("仅未配对库存")); await readReady();
    act(() => publishInventorySnapshotChange({ userId: 7, workspaceId: 11, snapshotId: 42 }));
    await waitFor(() => expect(controls.query).toHaveBeenCalledTimes(2));
    expect(controls.query.mock.calls[1][0]).toEqual(input({ unpaired: true, exactScope: scope }));
  });
  it("never opens an unread, changed or explicitly cleared scope on a commit event", async () => {
    controls.query.mockImplementation((request: InventorySnapshotReadInput) => Promise.resolve(result(request)));
    render(<InventorySnapshotReadOnly />); act(() => publishInventorySnapshotChange({ userId: 7, workspaceId: 11, snapshotId: 42 })); expect(controls.query).not.toHaveBeenCalled();
    await readReady(); fireEvent.change(screen.getByLabelText("库存搜索"), { target: { value: "changed" } });
    act(() => publishInventorySnapshotChange({ userId: 7, workspaceId: 11, snapshotId: 42 })); expect(controls.query).toHaveBeenCalledTimes(1);
    await readReady(); fireEvent.click(screen.getByRole("button", { name: "取消并清除库存" }));
    act(() => publishInventorySnapshotChange({ userId: 7, workspaceId: 11, snapshotId: 42 })); expect(controls.query).toHaveBeenCalledTimes(2);
  });
  it("ignores other identities and events after read authority is revoked", async () => {
    controls.query.mockResolvedValue(result()); const view = render(<InventorySnapshotReadOnly />); await readReady();
    act(() => { publishInventorySnapshotChange({ userId: 8, workspaceId: 11, snapshotId: 42 }); publishInventorySnapshotChange({ userId: 7, workspaceId: 12, snapshotId: 42 }); });
    expect(controls.query).toHaveBeenCalledTimes(1); controls.permissions.canRead.mockReturnValue(false); view.rerender(<InventorySnapshotReadOnly />);
    act(() => publishInventorySnapshotChange({ userId: 7, workspaceId: 11, snapshotId: 42 })); expect(controls.query).toHaveBeenCalledTimes(1);
  });
  it("only the optional wrapper adds the controlled collection entry, without automatic queries", () => {
    render(<InventorySnapshotReadOnly withRefresh />);
    expect(screen.getByRole("region", { name: "完整库存显式采集" })).toBeVisible(); expect(controls.query).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "明确开始全来源库存采集" })).toBeDisabled();
  });
});

describe("inventory snapshot read ownership gates", () => {
  it("requires an explicit read and has no sync, upload or write action", () => {
    const view = render(<InventorySnapshotReadOnly />);
    expect(controls.query).not.toHaveBeenCalled();
    expect(view.container.firstElementChild).toHaveClass("manus-no-record");
    expect(screen.queryByRole("button", { name: /同步|上传|保存|采集|生成/ })).not.toBeInTheDocument();
    expect(controls.permissions.canRead).toHaveBeenCalledWith("ops", "ops_data_import");
  });
  it.each([
    ["auth pending", () => { controls.auth.loading = true; }], ["auth error", () => { controls.auth.error = new Error("private-auth"); }],
    ["logout", () => { controls.auth.user = null; }], ["invalid user", () => { controls.auth.user!.id = 0; }],
    ["NULL workspace", () => { controls.auth.user!.defaultWorkspaceId = null; }], ["missing workspace", () => { controls.auth.user!.defaultWorkspaceId = undefined; }],
    ["invalid workspace", () => { controls.auth.user!.defaultWorkspaceId = -1; }], ["missing role", () => { controls.auth.user!.role = ""; }],
    ["permission pending", () => { controls.permissions.isLoading = true; }], ["permission denied", () => { controls.permissions.canRead.mockReturnValue(false); }],
  ] as const)("does not mount a reader for %s", (_name, arrange) => {
    arrange(); render(<InventorySnapshotReadOnly />); expect(controls.query).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "读取已有库存快照" })).not.toBeInTheDocument();
    expect(screen.queryByText("private-auth")).not.toBeInTheDocument();
  });
});

describe("complete saved inventory presentation", () => {
  it.each([
    { quantity: 0, value: 0, expected: "单价 ¥0" },
    { quantity: 0, value: null, expected: "单价 ¥0" },
    { quantity: 3, value: 0, expected: "单价 待核对" },
    { quantity: 3, value: null, expected: "单价 待核对" },
    { quantity: 3, value: 30, expected: "单价 ¥10" },
  ])("uses the agreed unit-price display for quantity $quantity and value $value", ({ quantity, value, expected }) => {
    const saved = legacyPayload();
    const data = { ...saved, rows: saved.rows.map((row, index) => index === 0 ? {
      ...row, domestic: { quantity, value }, total: { quantity: quantity + row.purchase.quantity, value: null },
    } : row) };
    render(<InventorySnapshotReadOnlyContent result={result(input(), data)} />);
    const table = screen.getByRole("region", { name: "库存明细横向表" });
    const row = table.querySelector("tbody tr")!;
    const domestic = row.querySelectorAll("td")[5];
    expect(within(domestic).getByText(expected)).toBeVisible();
    expect(domestic).toHaveTextContent(value === null ? "货值 待核对" : `货值 ¥${value.toFixed(2)}`);
    if (quantity === 0) expect(within(domestic).getByText("单价 ¥0")).toBeVisible();
  });
  it("renders both full grouped tables, all stock components and capture timezone without RPC", () => {
    render(<InventorySnapshotReadOnlyContent result={result()} />);
    expect(controls.query).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "库存明细横向表" })).toHaveClass("overflow-x-auto");
    expect(screen.getByRole("region", { name: "库存明细横向表" })).toHaveAttribute("tabindex", "0");
    const table = within(screen.getByRole("region", { name: "库存明细横向表" }));
    for (const label of ["计划数量", "国内仓", "采购在途", "FBA 在途", "FBA 仓", "商品总库存", "辅料"]) expect(table.getByRole("columnheader", { name: label })).toBeInTheDocument();
    expect(screen.getByText(/2026\/10\/17 08:01:02/)).toHaveTextContent("北京时间");
    expect(screen.queryByText(/采集完成原值/)).not.toBeInTheDocument();
    expect(document.querySelector("pre")).toBeNull();
    expect(screen.getByText("赛狐库存 · 人民币")).toBeInTheDocument();
    expect(table.queryByRole("columnheader", { name: "来源、分项和分配证据" })).not.toBeInTheDocument();
    for (const disclosure of screen.getByRole("region", { name: "库存明细横向表" }).querySelectorAll("details")) {
      expect(disclosure.closest("td")).toBe(disclosure.closest("tr")!.lastElementChild);
      expect(disclosure.querySelector("summary")).toHaveTextContent("辅料明细");
    }
    expect(within(screen.getByRole("region", { name: "全筛选库存与货值合计" })).getByText("FBA 待发货计划：300", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "已知超龄库存横向表" })).toBeInTheDocument();
  });
  it("keeps complete parent groups together and shows whole-filter totals, not current page", () => {
    const data = result(input({ groupLimit: 1, agedGroupLimit: 1 }));
    const onPage = vi.fn(); render(<InventorySnapshotReadOnlyContent result={data} onPage={onPage} />);
    const region = screen.getByRole("region", { name: "库存明细横向表" });
    expect(region.querySelectorAll("tbody")).toHaveLength(1); expect(region.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(region.querySelector("td[rowspan]" )).toHaveAttribute("rowspan", "2");
    expect(within(screen.getByRole("region", { name: "全筛选库存与货值合计" })).getByText((_, element) => element?.tagName === "P" && element.textContent === "数量 42")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "库存父组下一页" })); expect(onPage).toHaveBeenLastCalledWith(1, 0);
    fireEvent.click(screen.getByRole("button", { name: "库龄父组下一页" })); expect(onPage).toHaveBeenLastCalledWith(0, 1);
  });
  it("preserves legacy unknowns, zero values, original decimal precision and deduplicated accessories", () => {
    const saved = legacyPayload();
    saved.rows[0].aux[0].name = "<img src=x onerror=alert(1)>";
    const data = result(input(), saved);
    const { container } = render(<InventorySnapshotReadOnlyContent result={data} />);
    expect(data.groups.every(group => group.scopeStatus === "unknown")).toBe(true);
    expect(data.groups.flatMap(group => group.rows).every(row => row.fbaComponents.length === 0)).toBe(true);
    expect(screen.getAllByText("2.1235").length).toBeGreaterThan(0);
    expect(screen.getAllByText("单价 ¥0.3333").length).toBeGreaterThan(0);
    expect(screen.getAllByText("单价 ¥0").length).toBeGreaterThan(0);
    expect(screen.getAllByText("单价 待核对").length).toBeGreaterThan(0);
    expect(data.groups[0].rows[0].plan).toBe(2.123456789);
    const totals = within(screen.getByRole("region", { name: "全筛选库存与货值合计" }));
    expect(totals.getByText((_, element) => element?.tagName === "P" && element.textContent === "数量 2")).toBeInTheDocument();
    expect(totals.getAllByText(/货值 待核对/).length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: "全部库龄未知父组的完整库存独立合计", hidden: true })).toHaveTextContent("数量 10");
    expect(screen.getByText(/库龄未知父组 2 个/)).toBeInTheDocument();
    expect(container.querySelector("a,img,script")).toBeNull();
    expect(screen.getAllByText("<img src=x onerror=alert(1)>").length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("范围核验：unknown");
  });
  it("retains zero realtime stock with nonzero historic age and the separate age dates", () => {
    render(<InventorySnapshotReadOnlyContent result={result(input(), payload(2, { zero: true }))} />);
    const table = screen.getByRole("region", { name: "已知超龄库存横向表" });
    const child = within(table).getByText("ASIN-1-0").closest("tr")!;
    expect(child).toHaveTextContent("数量 0"); expect(child).toHaveTextContent("181 天及以上：6"); expect(child).toHaveTextContent("2026-10-10");
    expect(child).toHaveTextContent("库龄快照数量超过实时仓内数量");
  });
  it("shows non-FBA age as not applicable rather than a measured zero in a mixed parent group", () => {
    const data = payload(), sources = structuredClone(data.mapping.sources), bindings = structuredClone(data.mapping.scopeBindings);
    sources.warehouses.push({ id: "warehouse-1", type: 1 });
    sources.warehouse.push({ ...scope, id: "balance-1", warehouseId: "warehouse-1", commodityId: 1, commoditySku: "LOCAL-1", stockAllNum: 3, stockAvailable: 3, stockOccupy: 0, stockDefective: 0, stockWait: 2, stockPlan: 4, totalPurchase: 6, onWayPurchase: 4 });
    bindings.push({ ref: { source: "warehouse", index: 0, id: "balance-1" }, scope, mappingId: "domestic-binding", kind: "explicit_confirmed_field_mapping", fields: { parentAsin: "parentAsin", storeName: "storeName", country: "country", accountId: "accountId" } });
    const mixed = mapInventorySources({ sources, scopeBindings: bindings, startedAt: STARTED, capturedAt: CAPTURED });
    render(<InventorySnapshotReadOnlyContent result={result(input(), mixed)} />);
    expect(within(screen.getByRole("region", { name: "已知超龄库存横向表" })).getByText("不适用（非 FBA），不是已测库龄为零")).toBeInTheDocument();
    expect(screen.getByText(/库龄未知父组 0 个/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "全筛选库存与货值合计" })).toHaveTextContent("货值 ¥6.00");
  });
  it("retains zero realtime FBA with missing age as unknown, not an empty snapshot", () => {
    render(<InventorySnapshotReadOnlyContent result={result(input(), payload(2, { zero: true, unknown: true }))} />);
    const unknown = screen.getByRole("region", { name: "库龄未知库存横向表" });
    expect(unknown).toHaveTextContent("ASIN-1-0"); expect(unknown).toHaveTextContent("181 天及以上：未知"); expect(unknown).toHaveTextContent("数量 0");
  });
  it("unknown-age totals include all unknown groups even while that category is off-page", () => {
    const data = payload(2, { unknown: true });
    const view = render(<InventorySnapshotReadOnlyContent result={result(input({ agedGroupLimit: 1 }), data)} />);
    expect(screen.queryByRole("region", { name: "库龄未知组" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "全部库龄未知父组的完整库存独立合计", hidden: true })).toHaveTextContent("数量 14");
    view.rerender(<InventorySnapshotReadOnlyContent result={result(input({ agedGroupLimit: 1, agedGroupOffset: 1 }), data)} />);
    expect(screen.getByRole("region", { name: "库龄未知组" })).toHaveTextContent("ASIN-1-0");
    expect(screen.getByRole("region", { name: "全部库龄未知父组的完整库存独立合计", hidden: true })).toHaveTextContent("数量 14");
  });
  it.each(["missing", "not_found", "invalid", "scope_unverifiable"] as const)("keeps %s distinct from zero inventory", status => {
    const data = buildInventorySnapshotReadFailure({ input: input(), identity: { userId: 7, workspaceId: 11 }, status, reasonCode: status, missingReason: "明确无结果，不补零" });
    render(<InventorySnapshotReadOnlyContent result={data} />);
    expect(screen.queryByText("明确无结果，不补零")).not.toBeInTheDocument();
    expect(screen.queryByText(`状态依据：${status}`)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "全筛选库存与货值合计" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("explicit scope, pagination and stale-response isolation", () => {
  it("requires ordinary users' exact scope and accepts a canonical scoped reply without global source counts", async () => {
    controls.auth.user!.role = "member"; controls.query.mockImplementation((request: InventorySnapshotReadInput) => Promise.resolve(result(request, payload(), 7, true)));
    render(<InventorySnapshotReadOnly />); fireEvent.click(readButton()); expect(controls.query).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("范围");
    fillScope(); expect(controls.query).not.toHaveBeenCalled(); await readReady();
    expect(controls.query.mock.calls[0][0]).toEqual(input({ exactScope: scope }));
    expect(screen.getByText("赛狐库存 · 人民币")).toBeInTheDocument();
    expect(screen.queryByText("ASIN-1-0")).not.toBeInTheDocument();
    expect(screen.queryByText("原始来源记录数（缺失为未知）")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/读取工作区可见的全部/)).not.toBeInTheDocument();
  });
  it("rejects a full metadata response for an ordinary reader even if its requested row scope matches", async () => {
    controls.auth.user!.role = "member"; controls.query.mockImplementation((request: InventorySnapshotReadInput) => Promise.resolve(result(request)));
    render(<InventorySnapshotReadOnly />); fillScope(); fireEvent.click(readButton()); await screen.findByRole("alert");
    expect(screen.queryByText(/上次更新：/)).not.toBeInTheDocument();
  });
  it.each(["super_admin", "admin", "ops_manager"])("only the exact manager role %s has the optional all-scope control", role => {
    controls.auth.user!.role = role; render(<InventorySnapshotReadOnly />);
    expect(screen.getByLabelText(/读取工作区可见的全部/)).toBeChecked();
  });
  it("paginates each table independently and starts explicit refresh at zero", async () => {
    const data = payload(13); controls.query.mockImplementation((request: InventorySnapshotReadInput) => Promise.resolve(result(request, data)));
    render(<InventorySnapshotReadOnly />); await readReady();
    fireEvent.click(screen.getByRole("button", { name: "库存父组下一页" }));
    await waitFor(() => expect(controls.query).toHaveBeenCalledTimes(2)); await screen.findByText(/上次更新：/);
    expect(controls.query.mock.calls[1][0]).toEqual(input({ groupOffset: 12 }));
    fireEvent.click(screen.getByRole("button", { name: "库龄父组下一页" }));
    await waitFor(() => expect(controls.query).toHaveBeenCalledTimes(3)); await screen.findByText(/上次更新：/);
    expect(controls.query.mock.calls[2][0]).toEqual(input({ groupOffset: 12, agedGroupOffset: 12 }));
    await readReady(); expect(controls.query.mock.calls[3][0]).toEqual(input());
  });
  it.each(["id", "runId", "runSource", "capturedAt", "version"] as const)("rejects paging across a changed snapshot %s", async field => {
    const data = payload(13); controls.query.mockImplementation((request: InventorySnapshotReadInput) => {
      const next = result(request, data);
      if (request.groupOffset) { if (field === "version") next.snapshot!.version = 1; else if (field === "runSource") next.snapshot!.runSource = "manual_collection"; else next.snapshot![field] += 1; }
      return Promise.resolve(next);
    });
    render(<InventorySnapshotReadOnly />); await readReady(); fireEvent.click(screen.getByRole("button", { name: "库存父组下一页" }));
    await screen.findByRole("alert"); expect(screen.queryByText(/上次更新：/)).not.toBeInTheDocument(); expect(controls.query).toHaveBeenCalledTimes(2);
    await readReady(); expect(controls.query.mock.calls[2][0].groupOffset).toBe(0);
  });
  it.each([
    ["search", () => fireEvent.change(screen.getByLabelText("库存搜索"), { target: { value: "ASIN-1" } }), { search: "ASIN-1" }],
    ["unpaired", () => fireEvent.click(screen.getByLabelText("仅未配对库存")), { unpaired: true }],
    ["age365", () => fireEvent.change(screen.getByLabelText("库存超龄口径"), { target: { value: "365" } }), { ageThreshold: 365 }],
  ] as const)("clears saved results on %s change and makes no automatic query", async (_name, change, patch) => {
    controls.query.mockImplementation((request: InventorySnapshotReadInput) => Promise.resolve(result(request)));
    render(<InventorySnapshotReadOnly />); await readReady(); change();
    expect(screen.queryByText(/上次更新：/)).not.toBeInTheDocument(); expect(controls.query).toHaveBeenCalledTimes(1);
    await readReady(); expect(controls.query.mock.calls[1][0]).toMatchObject(patch);
  });
  it("clears results when the manager switches to exact scope or edits any scope field", async () => {
    controls.query.mockImplementation((request: InventorySnapshotReadInput) => Promise.resolve(result(request)));
    render(<InventorySnapshotReadOnly />); await readReady(); fireEvent.click(screen.getByLabelText(/读取工作区可见的全部/));
    expect(screen.queryByText(/上次更新：/)).not.toBeInTheDocument(); fillScope(); await readReady();
    fireEvent.change(screen.getByLabelText("库存店铺"), { target: { value: "other" } });
    expect(screen.queryByText(/上次更新：/)).not.toBeInTheDocument(); expect(controls.query).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["user", (value: InventorySnapshotReadResult) => { value.identity.userId++; }],
    ["workspace", (value: InventorySnapshotReadResult) => { value.identity.workspaceId++; }],
    ["search", (value: InventorySnapshotReadResult) => { value.request.search = "other"; }],
    ["scope", (value: InventorySnapshotReadResult) => { value.request.exactScope = scope; }],
    ["age", (value: InventorySnapshotReadResult) => { value.request.ageThreshold = 365; }],
    ["pagination", (value: InventorySnapshotReadResult) => { value.page.nextOffset = 77; }],
    ["quantity", (value: InventorySnapshotReadResult) => { value.totals!.total.quantity = NaN; }],
  ] as const)("rejects malformed or mismatched %s replies without showing source data", async (_name, mutate) => {
    const data = result(); mutate(data); controls.query.mockResolvedValue(data);
    render(<InventorySnapshotReadOnly />); fireEvent.click(readButton()); await screen.findByRole("alert");
    expect(screen.queryByText(/上次更新：/)).not.toBeInTheDocument(); expect(screen.queryByText("ASIN-0-0")).not.toBeInTheDocument();
  });
  it("clears prior data and hides raw server errors after an explicit refresh fails", async () => {
    controls.query.mockResolvedValueOnce(result()).mockRejectedValueOnce(new Error("secret SQL account token"));
    render(<InventorySnapshotReadOnly />); await readReady(); fireEvent.click(readButton()); await screen.findByRole("alert");
    expect(screen.queryByText(/上次更新：/)).not.toBeInTheDocument(); expect(screen.queryByText(/secret SQL/)).not.toBeInTheDocument();
  });
  it("aborts and ignores an old request after cancellation", async () => {
    const old = deferred<InventorySnapshotReadResult>(); controls.query.mockReturnValue(old.promise); render(<InventorySnapshotReadOnly />);
    fireEvent.click(readButton()); const signal = controls.query.mock.calls[0][1].signal as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: "取消并清除库存" })); expect(signal.aborted).toBe(true);
    await act(async () => old.resolve(result())); expect(screen.queryByText(/上次更新：/)).not.toBeInTheDocument();
  });
  it("accepts only the newest refresh even when the old transport ignores abort", async () => {
    const old = deferred<InventorySnapshotReadResult>(); controls.query.mockReturnValueOnce(old.promise).mockResolvedValueOnce(result(input(), payload(2, { label: "NEWEST" })));
    render(<InventorySnapshotReadOnly />); fireEvent.click(readButton());
    await readReady();
    await act(async () => old.resolve(result(input(), payload(2, { label: "STALE" }))));
    expect(screen.getAllByText("NEWEST").length).toBeGreaterThan(0); expect(screen.queryByText("STALE")).not.toBeInTheDocument();
  });
  it.each([
    ["actor", () => { controls.auth.user!.id = 8; }], ["workspace", () => { controls.auth.user!.defaultWorkspaceId = 12; }],
    ["role", () => { controls.auth.user!.role = "ops_manager"; }], ["auth pending", () => { controls.auth.loading = true; }],
    ["auth error", () => { controls.auth.error = new Error("raw-auth-secret"); }], ["logout", () => { controls.auth.user = null; }],
    ["permission pending", () => { controls.permissions.isLoading = true; }], ["permission lost", () => { controls.permissions.canRead.mockReturnValue(false); }],
  ] as const)("destroys saved and pending data on %s change", async (_name, change) => {
    const old = deferred<InventorySnapshotReadResult>(); controls.query.mockResolvedValueOnce(result()).mockReturnValueOnce(old.promise);
    const view = render(<InventorySnapshotReadOnly />); await readReady(); fireEvent.click(readButton());
    const signal = controls.query.mock.calls[1][1].signal as AbortSignal; change(); view.rerender(<InventorySnapshotReadOnly />);
    expect(signal.aborted).toBe(true); expect(screen.queryByText(/上次更新：/)).not.toBeInTheDocument();
    await act(async () => old.resolve(result())); expect(screen.queryByText(/上次更新：/)).not.toBeInTheDocument();
    expect(controls.query).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["actor", () => { controls.auth.user!.id = 8; }], ["workspace", () => { controls.auth.user!.defaultWorkspaceId = 12; }],
    ["role", () => { controls.auth.user!.role = "ops_manager"; }], ["auth pending", () => { controls.auth.loading = true; }],
    ["auth error", () => { controls.auth.error = new Error("secret-auth"); }], ["logout", () => { controls.auth.user = null; }],
    ["permission pending", () => { controls.permissions.isLoading = true; }], ["permission lost", () => { controls.permissions.canRead.mockReturnValue(false); }],
  ] as const)("synchronously removes a visible saved result when %s changes", async (_name, change) => {
    controls.query.mockResolvedValue(result()); const view = render(<InventorySnapshotReadOnly />); await readReady();
    expect(screen.getAllByText("ASIN-0-0").length).toBeGreaterThan(0);
    change(); view.rerender(<InventorySnapshotReadOnly />);
    expect(screen.queryByText(/上次更新：/)).not.toBeInTheDocument(); expect(screen.queryByText("ASIN-0-0")).not.toBeInTheDocument();
    expect(controls.query).toHaveBeenCalledTimes(1);
  });
  it("unmount aborts pending work and does not schedule a retry", async () => {
    const pending = deferred<InventorySnapshotReadResult>(); controls.query.mockReturnValue(pending.promise);
    const view = render(<InventorySnapshotReadOnly />); fireEvent.click(readButton()); const signal = controls.query.mock.calls[0][1].signal as AbortSignal;
    view.unmount(); expect(signal.aborted).toBe(true); await act(async () => pending.resolve(result())); expect(controls.query).toHaveBeenCalledTimes(1);
  });
});


describe("current product inventory screen", () => {
  it("loads without account fields, groups by current parent and filters by numeric operator", async () => {
    controls.auth.user!.role = "ops_specialist";
    controls.query.mockImplementation(async (request: InventorySnapshotReadInput) => {
      const data = legacyPayload();
      return buildInventorySnapshotReadResult({ identity: { userId: 7, workspaceId: 11 }, input: request,
        record: { id: 41, workspaceId: 11, runId: 82, capturedAt: CAPTURED, payload: data }, visibility: "scoped",
        currentProducts: { rowIds: data.rows.map(row => row.id), operators: [{ id: 7, name: "本人" }, { id: 8, name: "搭档" }],
          projections: data.rows.map(row => ({ rowId: row.id, product: { parentAsin: "CURRENT-P", storeName: "US Store", title: "当前父体", ownerIds: [7, 8], operator: "本人 / 搭档", sourceRowId: 12 } })) } });
    });
    render(<InventorySnapshotReadOnly currentProducts />);
    await screen.findByText(/上次更新：/);
    expect(controls.query.mock.calls[0][0]).toMatchObject({ ownershipMode: "current_us" });
    expect(controls.query.mock.calls[0][0]).not.toHaveProperty("exactScope");
    expect(screen.queryByLabelText("库存来源账号 ID")).not.toBeInTheDocument();
    const table = screen.getByRole("region", { name: "库存明细横向表" });
    expect(within(table).getByText("当前父体").closest("td")).toHaveAttribute("rowspan", "2");
    fireEvent.change(screen.getByLabelText("库存运营负责人"), { target: { value: "8" } });
    expect(screen.queryByText(/上次更新：/)).not.toBeInTheDocument();
    fireEvent.click(readButton());
    await screen.findByText(/上次更新：/);
    expect(controls.query.mock.calls[1][0]).toMatchObject({ operatorId: 8, ownershipMode: "current_us" });
  });
});
