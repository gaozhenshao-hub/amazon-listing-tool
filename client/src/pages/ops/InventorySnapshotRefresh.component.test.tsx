// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InventorySnapshotRefresh, { InventorySnapshotRefreshController, readInventorySnapshotPending, subscribeInventorySnapshotChanges } from "./InventorySnapshotRefresh";
import type { InventorySnapshotRefreshOptionsResult, InventorySnapshotRefreshResult } from "@shared/inventorySnapshotRefresh";

const controls = vi.hoisted(() => ({
  options: vi.fn(), refresh: vi.fn(), readRun: vi.fn(), recover: vi.fn(),
  auth: { loading: false, error: null as Error | null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } as { id: number; defaultWorkspaceId: number; role: string } | null },
  permissions: { isLoading: false, canRead: vi.fn(), canEdit: vi.fn() },
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => controls.auth }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => controls.permissions }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: { inventorySnapshotRefresh: {
  options: { query: controls.options }, refresh: { mutate: controls.refresh }, readRun: { query: controls.readRun }, recover: { mutate: controls.recover },
} } }) } }));
const owner = { userId: 7, workspaceId: 11, role: "admin" }, identity = { userId: 7, workspaceId: 11 };
const uuid = "11111111-1111-4111-8111-111111111111", differentUuid = "22222222-2222-4222-8222-222222222222";
const key = "inventory-snapshot-refresh:v1:7:11";
const hash = (letter = "a") => letter.repeat(64);
function options(): InventorySnapshotRefreshOptionsResult {
  return { identity, capabilities: { refresh: { status: "available", reasonCode: null } }, snapshot: { status: "ready", id: 41, key: hash(), runSource: "saihu_sync" }, connectionVersion: hash("b"), mappingVersion: hash("c") };
}
function receipt(outcome: InventorySnapshotRefreshResult["outcome"] = "accepted", overrides: Partial<InventorySnapshotRefreshResult> = {}): InventorySnapshotRefreshResult {
  return { identity, operationId: uuid, outcome, jobId: outcome === "unknown" ? null : 91,
    state: outcome === "unknown" ? null : outcome === "accepted" ? "queued" : outcome === "committed" ? "succeeded" : outcome,
    snapshotId: outcome === "committed" ? 42 : null, snapshotKey: outcome === "committed" ? hash("d") : null,
    progress: { source: null, completedSources: outcome === "committed" ? 10 : 0, totalSources: 10 },
    reasonCode: outcome === "accepted" || outcome === "committed" ? null : outcome === "unknown" ? "unresolved" : outcome, ...overrides };
}
function persistPending(jobId: number | null = null, extras: Record<string, unknown> = {}) {
  localStorage.setItem(key, JSON.stringify({ version: 1, ...identity, operationId: uuid, jobId, ...extras }));
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const checkButton = () => screen.getByRole("button", { name: "检查库存采集权限与来源" });
const startButton = () => screen.getByRole("button", { name: "明确开始全来源库存采集" });
async function check() { fireEvent.click(checkButton()); await screen.findByText(/采集能力：/); }
async function start() { await check(); fireEvent.click(startButton()); await screen.findByText(/后台排队中，尚未发布/); }
beforeEach(() => {
  cleanup(); localStorage.clear(); vi.restoreAllMocks();
  const locks = new Map<string, Promise<unknown>>();
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: vi.fn((name: string, options: { signal?: AbortSignal }, callback: () => unknown) => {
    const next = (locks.get(name) ?? Promise.resolve()).then(() => {
      if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError"); return callback();
    }); locks.set(name, next.catch(() => {})); return next;
  }) } });
  controls.auth = { loading: false, error: null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } }; controls.permissions.isLoading = false;
  controls.permissions.canRead.mockReset().mockReturnValue(true); controls.permissions.canEdit.mockReset().mockReturnValue(true);
  for (const method of [controls.options, controls.refresh, controls.readRun, controls.recover]) method.mockReset();
  controls.options.mockResolvedValue(options()); controls.refresh.mockResolvedValue(receipt()); controls.readRun.mockResolvedValue(receipt()); controls.recover.mockResolvedValue(receipt("unknown"));
  vi.spyOn(crypto, "randomUUID").mockReturnValue(uuid);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("inventory collection entry and fresh authority", () => {
  it("does not collect/query on mount, requires explicit authority check and explicit start", async () => {
    render(<InventorySnapshotRefresh />);
    expect(controls.options).not.toHaveBeenCalled(); expect(controls.refresh).not.toHaveBeenCalled(); expect(startButton()).toBeDisabled();
    expect(screen.getByRole("region", { name: "完整库存显式采集" })).toHaveClass("min-w-0", "max-w-full");
    await check(); expect(controls.options).toHaveBeenCalledWith({ expectedWorkspaceId: 11 }, { signal: expect.any(AbortSignal) });
    expect(startButton()).toBeEnabled(); expect(controls.refresh).not.toHaveBeenCalled();
    expect(screen.getByText(/最近已保存快照 #41/)).toBeVisible();
    expect(screen.getByText(/不会改写领星库存规划/)).toHaveTextContent("不等于账号 / 店铺业务授权");
  });
  it.each(["ops_dashboard", "ops_inventory"])("requires read directory %s", directory => {
    controls.permissions.canRead.mockImplementation((_module, menu) => menu !== directory); render(<InventorySnapshotRefresh />);
    expect(screen.getByRole("alert")).toHaveTextContent("缺少库存采集读取权限"); expect(controls.options).not.toHaveBeenCalled(); expect(controls.refresh).not.toHaveBeenCalled();
  });
  it.each(["ops_specialist", "viewer", "finance", ""])("rejects non-manager role %s", role => {
    controls.auth.user!.role = role; render(<InventorySnapshotRefresh />); expect(screen.getByRole("alert")).toHaveTextContent("管理角色");
  });
  it.each([
    ["loading auth", () => { controls.auth.loading = true; }], ["loading permission", () => { controls.permissions.isLoading = true; }],
    ["auth error", () => { controls.auth.error = new Error("private-auth"); }], ["logout", () => { controls.auth.user = null; }],
    ["invalid user", () => { controls.auth.user!.id = 0; }], ["invalid workspace", () => { controls.auth.user!.defaultWorkspaceId = 0; }],
  ] as const)("hides collection for %s", (_label, arrange) => {
    arrange(); render(<InventorySnapshotRefresh />); expect(screen.queryByRole("button")).not.toBeInTheDocument(); expect(controls.options).not.toHaveBeenCalled(); expect(screen.queryByText("private-auth")).not.toBeInTheDocument();
  });
  it.each(["release_disabled", "create_permission_denied", "connection_missing", "mapping_invalid"])("shows unavailable reason %s and does not enable refresh", async reason => {
    const value = options(); value.capabilities.refresh = { status: "unavailable", reasonCode: reason }; controls.options.mockResolvedValue(value);
    render(<InventorySnapshotRefresh />); await check(); expect(screen.getByText(`采集能力：不可用 · ${reason}`)).toBeVisible(); expect(startButton()).toBeDisabled();
  });
  it("distinguishes known absent snapshot from missing table and corrupt snapshot", async () => {
    const value = options(); value.snapshot = { status: "not_found", id: null, key: hash(), runSource: null }; controls.options.mockResolvedValue(value);
    render(<InventorySnapshotRefresh />); await check(); expect(screen.getByText(/尚无已保存快照，不代表零库存/)).toBeVisible(); expect(startButton()).toBeEnabled();
    value.snapshot = { status: "invalid", id: null, key: null, runSource: null }; value.capabilities.refresh = { status: "unavailable", reasonCode: "invalid_snapshot" };
    await check(); expect(screen.getByText(/快照来源缺失或损坏/)).toBeVisible(); expect(startButton()).toBeDisabled();
  });
  it.each(["identity", "capability", "missing_hash", "extra"])("rejects invalid options: %s", async scenario => {
    const value = options() as any;
    if (scenario === "identity") value.identity = { userId: 8, workspaceId: 11 };
    if (scenario === "capability") value.capabilities.refresh.reasonCode = "not_available";
    if (scenario === "missing_hash") value.mappingVersion = null;
    if (scenario === "extra") value.credentials = "secret";
    controls.options.mockResolvedValue(value); render(<InventorySnapshotRefresh />); fireEvent.click(checkButton());
    await screen.findByText(/采集权限或来源检查失败/); expect(startButton()).toBeDisabled(); expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });
});

describe("durable UUID, progress and final acknowledgements", () => {
  it("persists identifiers before one explicit start with all source CAS keys", async () => {
    controls.refresh.mockImplementation(async input => { expect(readInventorySnapshotPending(owner)?.operationId).toBe(input.operationId); return receipt(); });
    render(<InventorySnapshotRefresh />); await check(); fireEvent.click(startButton()); fireEvent.click(startButton());
    await screen.findByText(/后台排队中，尚未发布/);
    expect(controls.refresh).toHaveBeenCalledTimes(1); expect(controls.refresh).toHaveBeenCalledWith({ expectedWorkspaceId: 11, operationId: uuid, expectedSnapshotKey: hash(), expectedConnectionVersion: hash("b"), expectedMappingVersion: hash("c") }, { signal: expect.any(AbortSignal) });
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ version: 1, ...identity, operationId: uuid, jobId: 91 });
    expect(startButton()).toBeDisabled();
  });
  it("polls only the accepted UUID, publishes only committed, and then stops polling", async () => {
    render(<InventorySnapshotRefresh />); await start();
    const notice = vi.fn(), unsub = subscribeInventorySnapshotChanges(notice);
    expect(notice).not.toHaveBeenCalled();
    controls.readRun.mockResolvedValue(receipt("accepted", { state: "running", progress: { source: "fba", completedSources: 2, totalSources: 10 } }));
    vi.useFakeTimers(); // The already scheduled real timer is replaced by an explicit progress response below.
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "读取本次采集进度" })); });
    expect(screen.getByText(/已完成来源：2 \/ 10；当前来源：FBA 库存与库龄/)).toBeVisible();
    controls.readRun.mockResolvedValue(receipt("committed"));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(controls.readRun).toHaveBeenLastCalledWith({ expectedWorkspaceId: 11, operationId: uuid }, { signal: expect.any(AbortSignal) });
    expect(screen.getByText(/新快照 ID：42/)).toBeVisible(); expect(localStorage.getItem(key)).toBeNull();
    expect(notice).toHaveBeenCalledTimes(1); expect(notice).toHaveBeenCalledWith({ ...identity, snapshotId: 42 });
    const calls = controls.readRun.mock.calls.length; await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(controls.readRun).toHaveBeenCalledTimes(calls); expect(startButton()).toBeDisabled(); unsub();
  });
  it("keeps unknown ACK without retry and resumes the original operation after remount", async () => {
    controls.refresh.mockRejectedValue(new Error("private-token")); const view = render(<InventorySnapshotRefresh />); await check(); fireEvent.click(startButton());
    await screen.findByText(/未获得可核验采集回执/); expect(readInventorySnapshotPending(owner)?.operationId).toBe(uuid); expect(screen.queryByText("private-token")).not.toBeInTheDocument();
    view.unmount(); render(<InventorySnapshotRefresh />); await screen.findByRole("region", { name: "库存采集操作恢复" });
    expect(controls.refresh).toHaveBeenCalledTimes(1); expect(controls.recover).not.toHaveBeenCalled();
    controls.recover.mockResolvedValue(receipt("committed")); fireEvent.click(screen.getByRole("button", { name: "检查原采集结果" }));
    await screen.findByText(/新快照 ID：42/); expect(controls.recover).toHaveBeenCalledWith({ expectedWorkspaceId: 11, operationId: uuid, decision: "check" }, { signal: expect.any(AbortSignal) });
    expect(controls.refresh).toHaveBeenCalledTimes(1);
  });
  it("stops automatic polling after an unknown response and never resubmits", async () => {
    render(<InventorySnapshotRefresh />); await start(); controls.readRun.mockResolvedValue(receipt("unknown"));
    vi.useFakeTimers(); await act(async () => { fireEvent.click(screen.getByRole("button", { name: "读取本次采集进度" })); });
    expect(screen.getByText(/采集结果仍未知/)).toBeVisible(); await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(controls.readRun).toHaveBeenCalledTimes(1); expect(controls.refresh).toHaveBeenCalledTimes(1); expect(startButton()).toBeDisabled();
  });
  it("leaves check and acknowledged cancel usable with disabled release and revoked create", async () => {
    persistPending(91); controls.permissions.canEdit.mockReturnValue(false); const value = options(); value.capabilities.refresh = { status: "unavailable", reasonCode: "release_disabled" }; controls.options.mockResolvedValue(value);
    render(<InventorySnapshotRefresh />); await check(); expect(startButton()).toBeDisabled();
    const cancel = screen.getByRole("button", { name: "永久取消原采集操作" }); expect(cancel).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox")); expect(cancel).toBeEnabled();
    controls.recover.mockResolvedValue(receipt("unknown")); fireEvent.click(cancel); await screen.findByText(/采集结果仍未知/); expect(readInventorySnapshotPending(owner)?.operationId).toBe(uuid);
    controls.recover.mockResolvedValue(receipt("cancelled")); fireEvent.click(cancel); await screen.findByText(/服务端已确认永久取消/); expect(localStorage.getItem(key)).toBeNull();
    expect(controls.recover).toHaveBeenLastCalledWith({ expectedWorkspaceId: 11, operationId: uuid, decision: "cancel" }, { signal: expect.any(AbortSignal) }); expect(controls.refresh).not.toHaveBeenCalled();
  });
  it("treats cancel racing a commit as committed rather than claiming cancellation", async () => {
    persistPending(); render(<InventorySnapshotRefresh />); fireEvent.click(screen.getByRole("checkbox")); controls.recover.mockResolvedValue(receipt("committed"));
    fireEvent.click(screen.getByRole("button", { name: "永久取消原采集操作" })); await screen.findByText(/新快照 ID：42/);
    expect(screen.queryByText(/服务端已确认永久取消/)).not.toBeInTheDocument();
  });
  it("failed collection releases only the final operation, keeps old snapshot semantics, does not invalidate", async () => {
    const notice = vi.fn(), unsub = subscribeInventorySnapshotChanges(notice);
    controls.refresh.mockResolvedValue(receipt("failed", { reasonCode: "source_pagination_invalid" })); render(<InventorySnapshotRefresh />); await check(); fireEvent.click(startButton());
    await screen.findByText(/本次采集失败，上一份已保存快照未被替换/); expect(notice).not.toHaveBeenCalled(); expect(localStorage.getItem(key)).toBeNull(); expect(startButton()).toBeDisabled(); unsub();
  });
  it("explains collection deadline without publishing or automatically retrying", async () => {
    controls.refresh.mockResolvedValue(receipt("failed", { reasonCode: "collection_deadline" })); render(<InventorySnapshotRefresh />); await check(); fireEvent.click(startButton());
    await screen.findByText("本次完整采集超过运行时限，未替换原库存；可检查来源规模后重新发起。");
    expect(controls.refresh).toHaveBeenCalledTimes(1); expect(startButton()).toBeDisabled(); expect(localStorage.getItem(key)).toBeNull();
  });
  it("stopping a hung request retains UUID, aborts local waiting, ignores late commit", async () => {
    const delayed = deferred<unknown>(); controls.refresh.mockReturnValue(delayed.promise); render(<InventorySnapshotRefresh />); await check(); fireEvent.click(startButton());
    await screen.findByRole("region", { name: "库存采集操作恢复" }); fireEvent.click(screen.getByRole("button", { name: "停止等待（不取消服务端）" }));
    expect(controls.refresh.mock.calls[0][1].signal.aborted).toBe(true); expect(readInventorySnapshotPending(owner)?.operationId).toBe(uuid);
    await act(async () => { delayed.resolve(receipt("committed")); }); expect(screen.queryByText(/新快照 ID：42/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "检查原采集结果" })).toBeEnabled();
  });
  it.each(["wrong_actor", "wrong_workspace", "wrong_uuid", "wrong_job", "bad_progress", "fake_success", "extra"])("refuses mismatched or malformed receipt %s", async scenario => {
    persistPending(91); const value = receipt("committed") as any;
    if (scenario === "wrong_actor") value.identity = { ...identity, userId: 8 };
    if (scenario === "wrong_workspace") value.identity = { ...identity, workspaceId: 12 };
    if (scenario === "wrong_uuid") value.operationId = differentUuid;
    if (scenario === "wrong_job") value.jobId = 99;
    if (scenario === "bad_progress") value.progress.completedSources = 11;
    if (scenario === "fake_success") value.snapshotKey = null;
    if (scenario === "extra") value.payload = "private-payload";
    controls.recover.mockResolvedValue(value); render(<InventorySnapshotRefresh />); fireEvent.click(screen.getByRole("button", { name: "检查原采集结果" }));
    await screen.findByText(/进度或恢复核对失败/); expect(readInventorySnapshotPending(owner)?.operationId).toBe(uuid); expect(screen.queryByText(/新快照 ID：42/)).not.toBeInTheDocument(); expect(startButton()).toBeDisabled();
  });
});

describe("identity isolation and safe recovery storage", () => {
  it.each(["actor", "workspace", "role", "read_permission", "permission_loading"])("clears prior result, aborts and ignores late responses on %s change", async scenario => {
    persistPending(91); const delayed = deferred<unknown>(); controls.recover.mockReturnValue(delayed.promise); const view = render(<InventorySnapshotRefresh />);
    fireEvent.click(screen.getByRole("button", { name: "检查原采集结果" }));
    if (scenario === "actor") controls.auth.user!.id = 8;
    if (scenario === "workspace") controls.auth.user!.defaultWorkspaceId = 12;
    if (scenario === "role") controls.auth.user!.role = "ops_manager";
    if (scenario === "read_permission") controls.permissions.canRead.mockReturnValue(false);
    if (scenario === "permission_loading") controls.permissions.isLoading = true;
    view.rerender(<InventorySnapshotRefresh />); expect(controls.recover.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { delayed.resolve(receipt("committed")); }); expect(screen.queryByText(/新快照 ID：42/)).not.toBeInTheDocument(); expect(readInventorySnapshotPending(owner)?.operationId).toBe(uuid);
    expect(controls.refresh).not.toHaveBeenCalled();
  });
  it.each(["invalid_json", "extra_payload", "wrong_identity", "oversize"])("does not silently remove corrupted metadata %s", async scenario => {
    if (scenario === "invalid_json") localStorage.setItem(key, "{");
    if (scenario === "extra_payload") persistPending(null, { base64: "private-file" });
    if (scenario === "wrong_identity") persistPending(null, { userId: 8 });
    if (scenario === "oversize") localStorage.setItem(key, "x".repeat(1025));
    const old = localStorage.getItem(key); render(<InventorySnapshotRefresh />); await check();
    expect(screen.getByRole("alert")).toHaveTextContent("恢复记录损坏"); expect(startButton()).toBeDisabled(); expect(localStorage.getItem(key)).toBe(old); expect(screen.queryByText("private-file")).not.toBeInTheDocument();
  });
  it("does not send when durable storage cannot be written", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); }); render(<InventorySnapshotRefresh />); await check(); fireEvent.click(startButton());
    await screen.findByText(/无法安全保存恢复编号/); expect(controls.refresh).not.toHaveBeenCalled();
  });
  it("honors another tab's pending UUID and will not replace it", async () => {
    render(<InventorySnapshotRefreshController owner={owner} />); await check(); persistPending(null, { operationId: differentUuid });
    act(() => window.dispatchEvent(new StorageEvent("storage", { key })));
    expect(startButton()).toBeDisabled(); expect(screen.getByText(new RegExp(differentUuid))).toBeVisible(); expect(controls.refresh).not.toHaveBeenCalled();
  });
  it("binds cancellation acknowledgement to one UUID and clears old options when another tab switches it", async () => {
    persistPending(91); render(<InventorySnapshotRefresh />); await check(); fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "永久取消原采集操作" })).toBeEnabled();
    persistPending(99, { operationId: differentUuid }); act(() => window.dispatchEvent(new StorageEvent("storage", { key })));
    expect(screen.getByRole("button", { name: "永久取消原采集操作" })).toBeDisabled(); expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.queryByText(/采集能力：可用/)).not.toBeInTheDocument(); expect(screen.getByText(new RegExp(differentUuid))).toBeVisible();
    localStorage.removeItem(key); act(() => window.dispatchEvent(new StorageEvent("storage", { key })));
    expect(startButton()).toBeDisabled(); expect(screen.queryByRole("region", { name: "库存采集操作恢复" })).not.toBeInTheDocument();
  });
  it("checks the currently persisted UUID before cancelling even if the storage event has not arrived", async () => {
    persistPending(91); render(<InventorySnapshotRefresh />); fireEvent.click(screen.getByRole("checkbox"));
    persistPending(99, { operationId: differentUuid }); fireEvent.click(screen.getByRole("button", { name: "永久取消原采集操作" }));
    expect(controls.recover).not.toHaveBeenCalled(); expect(screen.getByText(/恢复编号已在其他窗口变化/)).toBeVisible();
    expect(screen.getByRole("checkbox")).not.toBeChecked(); expect(screen.getByRole("button", { name: "永久取消原采集操作" })).toBeDisabled();
  });
  it("serializes simultaneous owner reservations so only one UUID can reach the server", async () => {
    render(<><InventorySnapshotRefreshController owner={owner} /><InventorySnapshotRefreshController owner={owner} /></>);
    const regions = screen.getAllByRole("region", { name: "完整库存显式采集" });
    await act(async () => { for (const region of regions) fireEvent.click(within(region).getByRole("button", { name: "检查库存采集权限与来源" })); });
    await act(async () => { for (const region of regions) fireEvent.click(within(region).getByRole("button", { name: "明确开始全来源库存采集" })); });
    expect(controls.refresh).toHaveBeenCalledTimes(1); expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
    expect(navigator.locks.request).toHaveBeenCalledWith(key, expect.objectContaining({ mode: "exclusive" }), expect.any(Function));
    expect(readInventorySnapshotPending(owner)?.operationId).toBe(uuid);
  });
  it("does not downgrade unsupported lock environments, while allowing safe recovery without deleting metadata", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined }); persistPending(91);
    render(<InventorySnapshotRefresh />); await check(); expect(startButton()).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("禁止新采集；不会降级为无锁提交");
    controls.recover.mockResolvedValue(receipt("cancelled")); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "永久取消原采集操作" }));
    await screen.findByText(/本机恢复记录未释放/); expect(readInventorySnapshotPending(owner)?.operationId).toBe(uuid); expect(controls.refresh).not.toHaveBeenCalled();
  });
  it("does not abort a pending safe check for unrelated same-identity rerenders or revoked create", async () => {
    persistPending(91); const delayed = deferred<unknown>(); controls.recover.mockReturnValue(delayed.promise); const view = render(<InventorySnapshotRefresh />);
    fireEvent.click(screen.getByRole("button", { name: "检查原采集结果" })); controls.permissions.canEdit.mockReturnValue(false); view.rerender(<InventorySnapshotRefresh />);
    expect(controls.recover.mock.calls[0][1].signal.aborted).toBe(false);
    await act(async () => { delayed.resolve(receipt("committed")); }); await screen.findByText(/新快照 ID：42/);
  });
  it("never clears another operation when an old response arrives", async () => {
    persistPending(91); const delayed = deferred<unknown>(); controls.recover.mockReturnValue(delayed.promise); render(<InventorySnapshotRefresh />);
    fireEvent.click(screen.getByRole("button", { name: "检查原采集结果" })); persistPending(99, { operationId: differentUuid });
    await act(async () => { delayed.resolve(receipt("committed")); }); await screen.findByText(/进度或恢复核对失败/);
    expect(readInventorySnapshotPending(owner)?.operationId).toBe(differentUuid); expect(screen.queryByText(/新快照 ID：42/)).not.toBeInTheDocument();
  });
});
