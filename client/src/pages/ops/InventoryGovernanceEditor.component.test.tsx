// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InventoryGovernanceEditor, { InventoryGovernanceEditorController, publishInventoryGovernanceChange, readInventoryGovernancePending, subscribeInventoryGovernanceChanges, type InventoryGovernanceEditorTarget } from "./InventoryGovernanceEditor";
import { InventoryGovernanceReadResultSchema, InventoryGovernanceWriteResultSchema, type InventoryGovernanceCandidate, type InventoryGovernanceRule, type InventoryGovernanceSubject } from "@shared/inventoryGovernanceWrite";
const mocks = vi.hoisted(() => ({ read: vi.fn(), execute: vi.fn(), recover: vi.fn(), auth: { loading: false, error: null as Error | null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } as { id: number; defaultWorkspaceId: number; role: string } | null }, permissions: { isLoading: false, canRead: vi.fn(), canEdit: vi.fn() } }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => mocks.permissions }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: { inventoryGovernanceWrite: { read: { query: mocks.read }, execute: { mutate: mocks.execute }, recover: { mutate: mocks.recover } } } }) } }));
const owner = { userId: 7, workspaceId: 11, role: "admin" }, identity = { userId: 7, workspaceId: 11 }, subject = { kind: "owners" } as const;
const scope = { parentAsin: "P000000001", storeName: "原文精确店铺", country: "美国" }, childScope = { asin: "B000000001", storeName: scope.storeName, country: scope.country };
const lifecycleSubject = { kind: "lifecycle", scope: childScope } as const, hash = "a".repeat(64), uuid = "11111111-1111-4111-8111-111111111111", uuid2 = "22222222-2222-4222-8222-222222222222", key = "inventory-governance-write:v1:7:11", onClose = vi.fn();
const available = { status: "available" as const, reasonCode: null }, unavailable = { status: "unavailable" as const, reasonCode: "not_applicable" }, stamp = "2026-10-18 01:00:00.000001";
function target(part: Partial<InventoryGovernanceEditorTarget> = {}): InventoryGovernanceEditorTarget { return { owner, subject, initialSelection: [scope], ...part }; }
function candidate(index = 1): InventoryGovernanceCandidate { return { scope: { ...scope, parentAsin: `P${String(index).padStart(9, "0")}` }, childAsins: [`B${String(index).padStart(9, "0")}`], productNames: [`原始产品 ${index}`], externalOperators: ["外部姓名仅原文"], sourceKinds: ["daily", "parent_weekly"], sourceCount: 3, latestDate: "2026-10-18" }; }
function rule(index = 1): InventoryGovernanceRule { return { ...candidate(index).scope, id: 30 + index, workspaceId: 11, assigneeUserId: 8, assigneeName: "同名成员", isActive: index === 2 ? 0 : 1, createdByUserId: 7, updatedByUserId: 7, createdAt: stamp, updatedAt: stamp }; }
function result(requestSubject: InventoryGovernanceSubject = subject, sourceCount = 2) {
  const row = { id: 41, workspaceId: 11, userId: 8, ...childScope, parentAsin: scope.parentAsin, status: "discontinued", reason: "three_months_zero", evidenceStartDate: "2026-07-01", evidenceEndDate: "2026-09-30", evidenceDays: 92, evidenceSalesQty: 0, evidenceProfit: "0.00", evidenceMaxInventory: 0, changedBy: null, changedAt: stamp, restoredAt: null, restoreReason: null, createdAt: stamp, updatedAt: stamp };
  return InventoryGovernanceReadResultSchema.parse({ identity, subject: requestSubject, status: "ready", reasonCode: null, snapshotKey: hash, owners: requestSubject.kind === "owners" ? { candidates: Array.from({ length: sourceCount }, (_, index) => candidate(index + 1)), rules: [rule(), rule(2)], members: [{ userId: 8, displayName: "同名成员", role: "ops_specialist" }, { userId: 9, displayName: "同名成员", role: "ops_manager" }] } : null, lifecycle: requestSubject.kind === "lifecycle" ? { row: { ...row, ...requestSubject.scope }, rows: [{ ...row, ...requestSubject.scope }] } : null, capabilities: requestSubject.kind === "owners" ? { assign: available, revoke: available, restore: unavailable } : { assign: unavailable, revoke: unavailable, restore: available } });
}
function receipt(action: "assign" | "revoke" | "restore" = "assign", status: "committed" | "cancelled" | "unknown" = "committed", overrides: Record<string, unknown> = {}) {
  return InventoryGovernanceWriteResultSchema.parse({ identity, subject: action === "restore" ? lifecycleSubject : subject, operationId: uuid, action, status, snapshotKey: status === "committed" ? "b".repeat(64) : null, recordIds: status === "committed" ? [31] : [], counts: status === "committed" ? { created: action === "assign" ? 1 : 0, replaced: 0, reactivated: 0, unchanged: 0, revoked: action === "revoke" ? 1 : 0, restored: action === "restore" ? 1 : 0 } : null, reasonCode: status === "committed" ? null : status, ...overrides });
}
function persist(overrides: Record<string, unknown> = {}) { localStorage.setItem(key, JSON.stringify({ version: 1, ...identity, operationId: uuid, subject, action: "assign", expectedSnapshotKey: hash, targetCount: 1, ...overrides })); }
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise<unknown>(yes => { resolve = yes; }); return { promise, resolve }; }
async function open(value = target()) { const view = render(<InventoryGovernanceEditorController owner={owner} target={value} onClose={onClose} />); await screen.findByText(/读取状态：ready/); return view; }
async function assign() { change("指定当前有效系统负责人", "9"); fireEvent.click(screen.getByRole("button", { name: /确认分配 \/ 替换 \/ 重新启用/ })); await waitFor(() => expect(mocks.execute).toHaveBeenCalled()); }
beforeEach(() => {
  cleanup(); localStorage.clear(); vi.restoreAllMocks(); onClose.mockReset(); mocks.auth = { loading: false, error: null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } }; mocks.permissions.isLoading = false; mocks.permissions.canRead.mockReset().mockReturnValue(true); mocks.permissions.canEdit.mockReset().mockReturnValue(true);
  mocks.read.mockReset().mockImplementation(async input => result(input.subject)); mocks.execute.mockReset().mockImplementation(async input => receipt(input.action)); mocks.recover.mockReset().mockResolvedValue(receipt("assign", "unknown")); vi.spyOn(crypto, "randomUUID").mockReturnValue(uuid);
  const locks = new Map<string, Promise<unknown>>(); Object.defineProperty(navigator, "locks", { configurable: true, value: { request: vi.fn((name: string, options: { signal?: AbortSignal }, callback: () => unknown) => { const next = (locks.get(name) ?? Promise.resolve()).then(() => { if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError"); return callback(); }); locks.set(name, next.catch(() => {})); return next; }) } });
});
afterEach(cleanup);

describe("complete fresh owner and lifecycle editing", () => {
  it("does not read while closed and uses exact workspace subject on explicit opening", async () => {
    const view = render(<InventoryGovernanceEditor target={null} onClose={onClose} />); expect(mocks.read).not.toHaveBeenCalled(); view.rerender(<InventoryGovernanceEditor target={target()} onClose={onClose} />); await screen.findByText(/读取状态：ready/);
    expect(mocks.read).toHaveBeenCalledWith({ expectedWorkspaceId: 11, subject }, { signal: expect.any(AbortSignal) }); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("distinguishes same names by numeric ID and saves exact raw scope with fresh CAS", async () => {
    await open(); expect(screen.getByRole("option", { name: "同名成员 · 用户 #8 · ops_specialist" })).toBeInTheDocument(); expect(screen.getByRole("option", { name: "同名成员 · 用户 #9 · ops_manager" })).toBeInTheDocument(); change("负责人操作说明", "经核对转交同名另一成员"); await assign();
    expect(mocks.execute.mock.calls[0][0]).toEqual({ expectedWorkspaceId: 11, subject, operationId: uuid, expectedSnapshotKey: hash, action: "assign", targets: [scope], assigneeUserId: 9, reason: "经核对转交同名另一成员" }); await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
  it("shows inactive rules and preselects reactivation without writing until explicit confirmation", async () => {
    await open(); expect(screen.getByRole("button", { name: "重新启用规则 #32（先核对负责人）" })).toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "重新启用规则 #32（先核对负责人）" }));
    expect(mocks.execute).not.toHaveBeenCalled(); expect(screen.getByLabelText("指定当前有效系统负责人")).toHaveValue("8"); fireEvent.click(screen.getByRole("button", { name: /确认分配 \/ 替换/ })); await waitFor(() => expect(mocks.execute).toHaveBeenCalled()); expect(mocks.execute.mock.calls[0][0].targets).toEqual([candidate(2).scope]);
  });
  it("requires explicit exact-rule revocation acknowledgement and retains optional reason", async () => {
    mocks.execute.mockResolvedValue(receipt("revoke")); await open(); fireEvent.click(screen.getByRole("button", { name: "选择撤销规则 #31" })); const confirm = screen.getByRole("button", { name: "确认撤销负责人规则" }); expect(confirm).toBeDisabled();
    change("负责人操作说明", "负责人离岗"); fireEvent.click(screen.getByRole("checkbox", { name: "确认撤销上述精确规则" })); fireEvent.click(confirm); await waitFor(() => expect(mocks.execute).toHaveBeenCalled());
    expect(mocks.execute.mock.calls[0][0]).toEqual({ expectedWorkspaceId: 11, subject, operationId: uuid, expectedSnapshotKey: hash, action: "revoke", ruleId: 31, reason: "负责人离岗" });
  });
  it("reads full lifecycle evidence and restores with a validated reason", async () => {
    await open(target({ subject: lifecycleSubject, initialSelection: [] })); expect(screen.getByText(/92 天/)).toBeInTheDocument(); expect(screen.getByText(/销量 0 · 利润 0.00 · 最大库存 0/)).toBeInTheDocument();
    change("恢复在售原因", "Listing 已修复并重新备货"); fireEvent.click(screen.getByRole("button", { name: "确认恢复为在售并保留证据" })); await waitFor(() => expect(mocks.execute).toHaveBeenCalled());
    expect(mocks.execute.mock.calls[0][0]).toEqual({ expectedWorkspaceId: 11, subject: lifecycleSubject, expectedSnapshotKey: hash, operationId: uuid, action: "restore", reason: "Listing 已修复并重新备货" });
  });
  it.each(["", "一", "a".repeat(501)])("refuses invalid restore reason length %s", async reason => {
    await open(target({ subject: lifecycleSubject, initialSelection: [] })); change("恢复在售原因", reason); fireEvent.click(screen.getByRole("button", { name: "确认恢复为在售并保留证据" })); await screen.findByText(/选择或说明不合法/); expect(mocks.execute).not.toHaveBeenCalled(); expect(crypto.randomUUID).not.toHaveBeenCalled();
  });
  it("does not guess a US alias for an exact 美国 source scope", async () => {
    await open(target({ initialSelection: [{ ...scope, country: "US" }] })); expect(screen.getByText(/页面定位范围未全部通过/)).toBeVisible(); expect(screen.getByRole("checkbox", { name: `选择 ${scope.parentAsin} · ${scope.storeName} · 美国` })).not.toBeChecked(); expect(screen.getByRole("button", { name: /确认分配 \/ 替换/ })).toBeDisabled();
  });
  it("retains complete source and rule pagination, including inactive state", async () => {
    const value = result(subject, 27); value.owners!.rules = Array.from({ length: 27 }, (_, index) => rule(index + 1)); mocks.read.mockResolvedValue(value); await open();
    expect(screen.queryByRole("checkbox", { name: /P000000027/ })).not.toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "范围下一页" })); expect(screen.getByRole("checkbox", { name: /P000000027/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "规则下一页" })); expect(screen.getByRole("button", { name: "选择撤销规则 #57" })).toBeInTheDocument(); change("规则状态", "inactive"); expect(screen.getByRole("button", { name: "重新启用规则 #32（先核对负责人）" })).toBeInTheDocument();
  });
  it.each(["原始产品 2", "B000000002", "外部姓名仅原文"])("searches fresh candidate metadata without page hints: %s", async query => {
    await open(); change("搜索当前可信范围", query); expect(screen.getByRole("checkbox", { name: /选择 P000000002/ })).toBeInTheDocument();
    if (query !== "外部姓名仅原文") expect(screen.queryByRole("checkbox", { name: /选择 P000000001/ })).not.toBeInTheDocument();
  });
  it("submits all 500 selected scopes as one request and never truncates the 501st", async () => {
    const value = result(subject, 501); mocks.read.mockResolvedValue(value); mocks.execute.mockImplementation(async input => receipt("assign", "committed", { recordIds: input.targets.map((_: unknown, index: number) => index + 1), counts: { created: 500, replaced: 0, reactivated: 0, unchanged: 0, revoked: 0, restored: 0 } }));
    await open(target({ initialSelection: value.owners!.candidates.slice(0, 500).map(candidate => candidate.scope) })); expect(screen.getByRole("button", { name: "选择全部筛选范围（跨页）" })).toBeDisabled(); await assign(); expect(mocks.execute.mock.calls[0][0].targets).toHaveLength(500);
  });
  it("rejects oversized initial selection instead of silently taking 500", async () => {
    const value = result(subject, 501); mocks.read.mockResolvedValue(value); await open(target({ initialSelection: value.owners!.candidates.map(candidate => candidate.scope) }));
    expect(screen.getByText(/页面定位范围未全部通过/)).toBeInTheDocument(); expect(screen.getByRole("button", { name: /确认分配 \/ 替换 \/ 重新启用 0 个范围/ })).toBeDisabled();
  });
  it("does not manufacture a usable empty list for unavailable projection", async () => {
    mocks.read.mockResolvedValue({ identity, subject, status: "conflict", reasonCode: "alias_collision", snapshotKey: null, owners: null, lifecycle: null, capabilities: { assign: unavailable, revoke: unavailable, restore: unavailable } });
    render(<InventoryGovernanceEditor target={target()} onClose={onClose} />); await screen.findByText(/来源、权限或原记录不可用/); expect(screen.queryByLabelText("指定当前有效系统负责人")).not.toBeInTheDocument();
  });
});

describe("durable UUID, cancellation and retained drafts", () => {
  it("uses the owner Web Lock to reserve only one UUID across two simultaneous editors", async () => {
    const delayed = deferred(); mocks.execute.mockReturnValue(delayed.promise);
    render(<><InventoryGovernanceEditorController owner={owner} target={target()} onClose={onClose} /><InventoryGovernanceEditorController owner={owner} target={target()} onClose={onClose} /></>);
    await waitFor(() => expect(screen.getAllByLabelText("指定当前有效系统负责人")).toHaveLength(2)); const dialogs = screen.getAllByRole("dialog", { hidden: true });
    for (const dialog of dialogs) fireEvent.change(within(dialog).getByLabelText("指定当前有效系统负责人"), { target: { value: "9" } });
    for (const dialog of dialogs) fireEvent.click(within(dialog).getByRole("button", { name: /确认分配 \/ 替换/, hidden: true }));
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1)); expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
    await act(async () => { delayed.resolve(receipt("assign", "unknown")); }); expect(readInventoryGovernancePending(owner)?.operationId).toBe(uuid);
  });
  it("keeps unsent reason and selection after a failed preserve-read, then permits explicit rebase", async () => {
    await open(); change("负责人操作说明", "不得丢弃的原因"); change("指定当前有效系统负责人", "9"); mocks.read.mockRejectedValueOnce(new Error("network failure"));
    fireEvent.click(screen.getByRole("button", { name: "读取当前治理版本用于对照" })); await screen.findByText(/读取失败/); expect(mocks.execute).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "读取当前治理版本用于对照" })); await screen.findByRole("region", { name: "治理当前版本对照" });
    fireEvent.click(screen.getByRole("button", { name: "采用当前治理版本并保留草稿" })); expect(screen.getByLabelText("负责人操作说明")).toHaveValue("不得丢弃的原因"); expect(screen.getByLabelText("指定当前有效系统负责人")).toHaveValue("9");
    expect(screen.getByRole("checkbox", { name: /选择 P000000001/ })).toBeChecked(); expect(screen.getByRole("button", { name: /确认分配 \/ 替换/ })).toBeEnabled();
  });
  it("keeps success counts visible after the parent closes this editor", async () => {
    const view = await open(); await assign(); await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1)); view.rerender(<InventoryGovernanceEditorController owner={owner} target={null} onClose={onClose} />);
    expect(screen.getByRole("status")).toHaveTextContent("新建 1、替换 0（其中重新启用 0）、未变更 0、撤销 0、恢复 0");
  });
  it("persists metadata before write, excluding selected scopes, members and reason body", async () => {
    mocks.execute.mockImplementation(async () => { expect(readInventoryGovernancePending(owner)?.operationId).toBe(uuid); throw new Error("private-provider-error"); }); await open(); change("负责人操作说明", "私有的交接正文"); await assign(); await screen.findByText(/未取得可核验回执/);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ version: 1, ...identity, subject, operationId: uuid, action: "assign", expectedSnapshotKey: hash, targetCount: 1 }); expect(localStorage.getItem(key)).not.toContain("私有的交接正文"); expect(screen.getByLabelText("负责人操作说明")).toHaveValue("私有的交接正文"); expect(screen.queryByText("private-provider-error")).not.toBeInTheDocument();
  });
  it("checks and cancels a restored UUID with release off and edit permission revoked", async () => {
    persist(); mocks.permissions.canEdit.mockReturnValue(false); render(<InventoryGovernanceEditor target={null} onClose={onClose} />); fireEvent.click(screen.getByRole("button", { name: "检查原治理操作" })); await screen.findByText(/结果仍未知/);
    const cancel = screen.getByRole("button", { name: "永久取消原治理操作" }); expect(cancel).toBeDisabled(); fireEvent.click(screen.getByRole("checkbox")); mocks.recover.mockResolvedValue(receipt("assign", "cancelled", { action: null })); fireEvent.click(cancel); await screen.findByText(/服务端已确认永久取消/);
    expect(mocks.recover.mock.calls[1][0]).toEqual({ expectedWorkspaceId: 11, subject, operationId: uuid, decision: "cancel" }); expect(localStorage.getItem(key)).toBeNull(); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("rejects a replacement UUID on cancel before its storage event arrives", () => {
    persist(); render(<InventoryGovernanceEditor target={null} onClose={onClose} />); fireEvent.click(screen.getByRole("checkbox")); persist({ operationId: uuid2 }); fireEvent.click(screen.getByRole("button", { name: "永久取消原治理操作" })); expect(mocks.recover).not.toHaveBeenCalled(); expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
  it("clears cancel acknowledgement on a cross-tab operation change", () => {
    persist(); render(<InventoryGovernanceEditor target={null} onClose={onClose} />); fireEvent.click(screen.getByRole("checkbox")); persist({ operationId: uuid2 }); act(() => window.dispatchEvent(new StorageEvent("storage", { key }))); expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
  it.each(["assign", "restore"] as const)("keeps foreign dirty draft after another editor's committed %s receipt", async action => {
    await open(); change("负责人操作说明", "本窗口尚未提交的交接"); persist({ action, subject: action === "restore" ? lifecycleSubject : subject }); act(() => window.dispatchEvent(new StorageEvent("storage", { key }))); mocks.recover.mockResolvedValue(receipt(action)); fireEvent.click(screen.getByRole("button", { name: "检查原治理操作" })); await screen.findByText(/不是当前草稿的提交/);
    expect(onClose).not.toHaveBeenCalled(); expect(screen.getByLabelText("负责人操作说明")).toHaveValue("本窗口尚未提交的交接"); expect(screen.getByRole("button", { name: /确认分配 \/ 替换/ })).toBeDisabled();
  });
  it("confirms this editor's lost ACK and only then clears its own submitted draft", async () => {
    mocks.execute.mockRejectedValue(new Error("lost ACK")); await open(); await assign(); await screen.findByText(/未取得可核验回执/); mocks.recover.mockResolvedValue(receipt()); fireEvent.click(screen.getByRole("button", { name: "检查原治理操作" })); await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1)); expect(localStorage.getItem(key)).toBeNull();
  });
  it("retains conflict reason and invalidated selection until explicit comparison and rebase", async () => {
    mocks.execute.mockRejectedValue({ data: { code: "CONFLICT" } }); await open(); change("负责人操作说明", "必须保留的分配说明"); await assign(); await screen.findByText(/版本冲突，草稿与原编号保留/);
    fireEvent.click(screen.getByRole("checkbox", { name: /确认永久取消此治理编号/ })); mocks.recover.mockResolvedValue(receipt("assign", "cancelled", { action: null })); fireEvent.click(screen.getByRole("button", { name: "永久取消原治理操作" })); await screen.findByText(/服务端已确认永久取消/);
    const changed = result(); changed.owners!.candidates = [candidate(2)]; changed.snapshotKey = "c".repeat(64); mocks.read.mockResolvedValue(changed); fireEvent.click(screen.getByRole("button", { name: "读取当前治理版本用于对照" })); await screen.findByRole("region", { name: "治理当前版本对照" });
    fireEvent.click(screen.getByRole("button", { name: "采用当前治理版本并保留草稿" })); expect(screen.getByLabelText("负责人操作说明")).toHaveValue("必须保留的分配说明"); expect(screen.getByRole("alert")).toHaveTextContent("原选择未自动删除"); expect(screen.getByRole("button", { name: /确认分配 \/ 替换/ })).toBeDisabled();
  });
  it.each(["identity", "workspace", "subject", "uuid", "action", "count", "malformed"])("keeps original metadata for mismatched receipt %s", async part => {
    persist(); const value = { ...receipt() } as any; if (part === "identity") value.identity = { ...identity, userId: 8 }; if (part === "workspace") value.identity = { ...identity, workspaceId: 12 }; if (part === "subject") value.subject = lifecycleSubject; if (part === "uuid") value.operationId = uuid2;
    if (part === "action") { value.action = "revoke"; value.counts = { created: 0, replaced: 0, reactivated: 0, unchanged: 0, revoked: 1, restored: 0 }; } if (part === "count") { value.recordIds = [31, 32]; value.counts.created = 2; } if (part === "malformed") value.snapshotKey = null;
    mocks.recover.mockResolvedValue(value); render(<InventoryGovernanceEditor target={null} onClose={onClose} />); fireEvent.click(screen.getByRole("button", { name: "检查原治理操作" })); await screen.findByText(/恢复核对失败/); expect(readInventoryGovernancePending(owner)?.operationId).toBe(uuid);
  });
  it("blocks unsafe new saves without Web Locks and retains recovery metadata", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined }); persist(); mocks.recover.mockResolvedValue(receipt("assign", "cancelled", { action: null })); render(<InventoryGovernanceEditor target={null} onClose={onClose} />);
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "永久取消原治理操作" })); await screen.findByText(/本机编号未释放/); expect(localStorage.getItem(key)).not.toBeNull(); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("does not erase malformed persistent metadata", () => {
    persist({ reason: "private" }); render(<InventoryGovernanceEditor target={null} onClose={onClose} />); expect(screen.getByRole("alert")).toHaveTextContent("恢复记录损坏"); expect(localStorage.getItem(key)).toContain("private"); expect(screen.queryByText("private")).not.toBeInTheDocument();
  });
  it("requires confirmation before closing an unsent draft", async () => {
    await open(); change("负责人操作说明", "未提交原因"); fireEvent.click(screen.getByRole("button", { name: "关闭治理编辑" })); expect(onClose).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "继续治理编辑" })); expect(screen.getByLabelText("负责人操作说明")).toHaveValue("未提交原因");
    fireEvent.click(screen.getByRole("button", { name: "关闭治理编辑" })); fireEvent.click(screen.getByRole("button", { name: "确认丢弃治理草稿并关闭" })); expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("fresh identity, directory and shared-workspace isolation", () => {
  it.each(["ops_dashboard", "ops_inventory"])("requires %s read permission", directory => { mocks.permissions.canRead.mockImplementation((_module, current) => current !== directory); render(<InventoryGovernanceEditor target={target()} onClose={onClose} />); expect(mocks.read).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toHaveTextContent("治理读取权限"); });
  it.each(["ops_specialist", "finance", "viewer"])("does not broaden %s to governance manager", role => { mocks.auth.user!.role = role; render(<InventoryGovernanceEditor target={target()} onClose={onClose} />); expect(mocks.read).not.toHaveBeenCalled(); });
  it.each(["actor", "workspace", "role", "permission", "loading"])("aborts read and clears stale data on %s change", async part => {
    const delayed = deferred(); mocks.read.mockReturnValue(delayed.promise); const view = render(<InventoryGovernanceEditor target={target()} onClose={onClose} />); await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    if (part === "actor") mocks.auth.user!.id = 8; if (part === "workspace") mocks.auth.user!.defaultWorkspaceId = 12; if (part === "role") mocks.auth.user!.role = "ops_manager"; if (part === "permission") mocks.permissions.canRead.mockReturnValue(false); if (part === "loading") mocks.permissions.isLoading = true;
    view.rerender(<InventoryGovernanceEditor target={target()} onClose={onClose} />); expect(mocks.read.mock.calls[0][1].signal.aborted).toBe(true); await act(async () => { delayed.resolve(result()); }); expect(screen.queryByLabelText("指定当前有效系统负责人")).not.toBeInTheDocument();
  });
  it("rejects extraneous member email in a response, never rendering it", async () => { const value = result() as any; value.owners.members[0].email = "private@example.test"; mocks.read.mockResolvedValue(value); render(<InventoryGovernanceEditor target={target()} onClose={onClose} />); await screen.findByText(/读取失败/); expect(screen.queryByText("private@example.test")).not.toBeInTheDocument(); });
  it("notifies another actor in the same workspace while keeping the visible draft", async () => {
    await open(); change("负责人操作说明", "保留本窗口草稿"); const notice = { userId: 8, workspaceId: 11, subject, action: "assign" as const, operationId: uuid2 }, listener = vi.fn(), unsubscribe = subscribeInventoryGovernanceChanges(listener);
    act(() => publishInventoryGovernanceChange(notice)); expect(listener).toHaveBeenCalledWith(notice); expect(onClose).not.toHaveBeenCalled(); expect(screen.getByLabelText("负责人操作说明")).toHaveValue("保留本窗口草稿"); expect(screen.getByText(/当前基线需要重新核对/)).toBeInTheDocument(); unsubscribe();
  });
  it("cross-tab notices do not treat another workspace as current authority", async () => {
    await open(); act(() => window.dispatchEvent(new StorageEvent("storage", { key: "inventory-governance-change:v1", newValue: JSON.stringify({ userId: 8, workspaceId: 12, subject, action: "assign", operationId: uuid2 }) }))); expect(screen.queryByText(/当前基线需要重新核对/)).not.toBeInTheDocument();
  });
});
