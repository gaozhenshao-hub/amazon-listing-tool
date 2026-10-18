// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MONTHLY_FINANCIAL_METRICS, parseMonthlyFinancialBatch } from "@shared/monthlyFinancialRead";
import { OperationsBoardEditionReadResultSchema, OperationsBoardEditionStateResultSchema, OperationsBoardEditionPreviewResultSchema,
  buildOperationsBoardEditionCapture, operationsBoardEditionPreviewKey, operationsBoardEditionRequestHash, operationsBoardEditionCanonical,
  type OperationsBoardEditionReadInput, type OperationsBoardEditionReadResult, type OperationsBoardEditionSaveNoteInput, type OperationsBoardEditionExecuteInput } from "@shared/operationsBoardEdition";
import { operationsBoardPartnersRequestHash } from "@shared/operationsBoardPartners";
import { OperationsBoardEditionWorkspace } from "./OperationsBoardEditionWorkspace";
import { boardOperationContext, boardPendingKey, readBoardPending, reserveBoardPending, publishBoardEditionChange } from "./operationsBoardEditionClientState";
import { publishMonthlyFinancialChange } from "./monthlyFinancialWriteEvents";

const mocks = vi.hoisted(() => ({
  state: vi.fn(), read: vi.fn(), history: vi.fn(), preview: vi.fn(), execute: vi.fn(), saveNote: vi.fn(), recover: vi.fn(), partnerOptions: vi.fn(), setPartner: vi.fn(), recoverPartner: vi.fn(),
  auth: { loading: false, error: null as Error | null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } as { id: number; defaultWorkspaceId: number; role: string } | null },
  permissions: { isLoading: false, canRead: vi.fn() },
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => mocks.permissions }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: { operationsBoard: {
  state: { query: mocks.state }, read: { query: mocks.read }, history: { query: mocks.history }, preview: { query: mocks.preview }, execute: { mutate: mocks.execute }, saveNote: { mutate: mocks.saveNote }, recover: { mutate: mocks.recover },
  partnerOptions: { query: mocks.partnerOptions }, setPartner: { mutate: mocks.setPartner }, recoverPartner: { mutate: mocks.recoverPartner },
} } }) } }));
const owner = { userId: 7, workspaceId: 11, role: "admin" }, identity = { userId: 7, workspaceId: 11 }, scope = { storeName: "SYNTHETIC Store", country: "US" };
const scopeFull = { ...scope, workspaceId: 11 }, base = { expectedWorkspaceId: 11, scope }, context = boardOperationContext(owner, scope);
const uuid = "11111111-1111-4111-8111-111111111111", secondUuid = "22222222-2222-4222-8222-222222222222", time = "2026-10-18 01:02:03.123000", parent = "SYNTHETIC-PARENT";
const cap = (available: boolean, reasonCode = "writes_not_enabled") => ({ available, reasonCode: available ? null : reasonCode });
let initialized = true, writes = true, noteValue = "原备注\nSYNTHETIC", noteVersion = 1, editionVersion = 4;
function state() { return initialized ? { scope: scopeFull, version: 2, currentMonth: "2026-09", currentEditionId: 9, status: "current" } : { scope: scopeFull, version: 0, currentMonth: null, currentEditionId: null, status: "uninitialized" }; }
function capture(month = "2026-09") {
  const rows = parseMonthlyFinancialBatch({ id: 41, workspaceId: 11, userId: 7, fileName: "SYNTHETIC.csv", fileHash: "a".repeat(64), status: "completed",
    totalRows: 1, skippedRows: 0, unallocatedRows: 0, months: [month], createdAt: time, confirmedAt: time,
    payload: [{ yearMonth: month, parentAsin: parent, asin: "SYNTHETIC-CHILD", sku: "SYNTHETIC", title: "SYNTHETIC 完整榜单产品", storeName: scope.storeName, site: "美国站", operator: "SYNTHETIC来源原文", raw: { currency: "USD" },
      ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => [key, key === "salesQty" ? 12 : key === "financialProfit" ? 7 : null])) }],
  }).rows;
  return buildOperationsBoardEditionCapture({ scope: scopeFull, month, rows, scannedBatches: [{ id: 41, recordHash: "b".repeat(64) }], sources: [{ month, batchId: 41, recordHash: "b".repeat(64), rowCount: 1, origin: { kind: "unknown", hashBasis: "unknown", sourceRunId: null } }] });
}
function edition(id = 9) {
  return { id, scope: scopeFull, month: id === 9 ? "2026-09" : "2026-08", revision: 1, version: editionVersion, kind: "original", status: id === 9 ? "current" : "archived", originalEditionId: null,
    sourceHash: capture(id === 9 ? "2026-09" : "2026-08").sourceHash, createdAt: time, updatedAt: time, archivedAt: id === 9 ? null : time };
}
function readResult(input: OperationsBoardEditionReadInput = { ...base, editionId: null }): OperationsBoardEditionReadResult {
  const selected = input.editionId ?? 9, snapshot = capture(selected === 9 ? "2026-09" : "2026-08");
  const common = { identity, scope: scopeFull, request: input, state: state(), visibility: "full", authorizationHash: "c".repeat(64), viewKey: "d".repeat(64), reasonCode: null };
  return OperationsBoardEditionReadResultSchema.parse(!initialized ? { ...common, status: "uninitialized", reasonCode: "not_initialized", edition: null, rows: [], sources: [], notes: [], ownership: null, coverage: { complete: true, meaning: "all_currently_authorized_edition_rows", rowCount: 0 } } : {
    ...common, status: "ready", edition: edition(selected), rows: snapshot.rows, sources: snapshot.sources,
    coverage: { complete: true, meaning: input.operatorId ? "all_currently_authorized_edition_rows_matching_operator" : "all_currently_authorized_edition_rows", rowCount: 1 },
    notes: [{ editionId: selected, parentAsin: parent, note: noteValue, version: noteVersion, updatedBy: 7, updatedAt: time, canEdit: selected === 9 && writes, editBasis: selected === 9 && writes ? "admin" : "readonly" }],
    ownership: { version: 1, meaning: "current_authorization_not_historical_membership", visibility: "full", selectedOperatorId: input.operatorId ?? null,
      operators: [{ userId: 7, displayName: "SYNTHETIC同名", relation: "self" }, { userId: 8, displayName: "SYNTHETIC同名", relation: "workspace_owner" }],
      parents: [{ parentAsin: parent, operatorIds: [7, 8], status: "resolved", basis: "manual", sourceMonth: null }] },
  });
}
function final(operationId: string, status: "unknown" | "cancelled" = "unknown") {
  return { identity, scope: scopeFull, operationId, status, action: null, requestHash: null, stateVersion: null, editionId: null, editionVersion: null, sourceHash: null, parentAsin: null, noteVersion: null, reasonCode: status === "unknown" ? "outcome_unknown_check_same_operation" : "operation_cancelled" };
}
function committed(input: OperationsBoardEditionSaveNoteInput | OperationsBoardEditionExecuteInput) {
  return { identity, scope: scopeFull, operationId: input.operationId, status: "committed", action: "action" in input ? input.action : "saveNote", requestHash: operationsBoardEditionRequestHash(identity, input),
    stateVersion: 2, editionId: "editionId" in input ? input.editionId : 9, editionVersion: 5, sourceHash: capture().sourceHash, parentAsin: "parentAsin" in input ? input.parentAsin : null, noteVersion: "note" in input ? noteVersion + 1 : null, reasonCode: null };
}
const content = vi.fn((value: OperationsBoardEditionReadResult, note: (parent: string) => React.ReactNode) => <div data-testid="complete-board">完整榜单版本 {value.edition?.id}{note(parent)}</div>);
const mount = () => render(<OperationsBoardEditionWorkspace owner={owner} scope={scope} renderContent={content} />);
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
async function read() { click("读取当前看板版本"); await screen.findByTestId("complete-board"); }
async function edit() { await read(); click("填写 / 编辑 · " + parent); await screen.findByRole("dialog"); }
const change = (text: string) => fireEvent.change(screen.getByLabelText("版本利润变化原因"), { target: { value: text } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => {
  vi.restoreAllMocks(); localStorage.clear(); initialized = true; writes = true; noteValue = "原备注\nSYNTHETIC"; noteVersion = 1; editionVersion = 4; content.mockClear();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(uuid);
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: vi.fn(async (_name: string, options: LockOptions, run: () => Promise<unknown>) => { if (options.signal?.aborted) throw new Error("aborted"); return run(); }) } });
  mocks.auth = { loading: false, error: null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } }; mocks.permissions.isLoading = false; mocks.permissions.canRead.mockReset().mockReturnValue(true);
  mocks.state.mockReset().mockImplementation(async request => OperationsBoardEditionStateResultSchema.parse({ identity, scope: scopeFull, request, state: state(), capabilities: { initialize: cap(!initialized && writes, initialized ? "already_initialized" : "writes_not_enabled"), publishRevision: cap(initialized && writes) } }));
  mocks.read.mockReset().mockImplementation(async input => readResult(input));
  mocks.history.mockReset().mockImplementation(async request => ({ identity, scope: scopeFull, request, state: state(), historyVersion: "e".repeat(64), items: [edition(8)], page: { nextCursor: null, hasMore: false } }));
  mocks.preview.mockReset().mockImplementation(async request => {
    const value = { identity, scope: scopeFull, request, state: state(), original: request.originalEditionId ? edition(request.originalEditionId) : null, targetMonth: request.originalEditionId ? "2026-08" : "2026-09", sourceHash: capture().sourceHash, sourceRowCount: 1, capability: cap(writes), effects: { movesCurrent: request.action === "initialize", preservesOriginal: true, copiesNotes: false, createsPastEditions: false } };
    return OperationsBoardEditionPreviewResultSchema.parse({ ...value, previewKey: operationsBoardEditionPreviewKey(value as Parameters<typeof operationsBoardEditionPreviewKey>[0]) });
  });
  mocks.execute.mockReset().mockImplementation(async input => committed(input));
  mocks.saveNote.mockReset().mockImplementation(async input => committed(input));
  mocks.recover.mockReset().mockImplementation(async input => final(input.operationId, input.decision === "cancel" ? "cancelled" : "unknown"));
  mocks.partnerOptions.mockReset().mockImplementation(async request => ({ identity, request, capability: cap(writes), members: [{ userId: 7, displayName: "SYNTHETIC同名" }, { userId: 8, displayName: "SYNTHETIC同名" }],
    pairs: [{ id: 50, workspaceId: 11, firstUserId: 7, secondUserId: 8, isActive: false, version: 3, updatedBy: 7, updatedAt: time }] }));
  mocks.setPartner.mockReset().mockImplementation(async input => ({ identity, operationId: input.operationId, status: "committed", requestHash: operationsBoardPartnersRequestHash(input), reasonCode: null,
    pair: { id: 50, workspaceId: 11, firstUserId: input.firstUserId, secondUserId: input.secondUserId, isActive: input.isActive, version: input.expectedVersion + 1, updatedBy: 7, updatedAt: time } }));
  mocks.recoverPartner.mockReset().mockImplementation(async input => ({ identity, operationId: input.operationId, status: input.decision === "cancel" ? "cancelled" : "unknown", requestHash: null, pair: null, reasonCode: "pending" }));
});
afterEach(cleanup);

describe("complete version workspace explicit reading", () => {
  it("does not read, write or initialize on mount; current is exactly editionId null", async () => {
    mount(); expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.partnerOptions).not.toHaveBeenCalled(); await read();
    expect(mocks.read).toHaveBeenCalledWith({ ...base, editionId: null }, { signal: expect.any(AbortSignal) }); expect(mocks.execute).not.toHaveBeenCalled();
    expect(content).toHaveBeenCalled(); expect(screen.getByTestId("complete-board")).toHaveTextContent("完整榜单版本 9");
  });
  it("selects numeric IDs (not same-name text), clears old content immediately and can clear a rejected filter", async () => {
    mount(); await read(); fireEvent.change(screen.getByLabelText("版本看板运营"), { target: { value: "8" } });
    expect(screen.queryByTestId("complete-board")).not.toBeInTheDocument(); expect(mocks.read).toHaveBeenCalledTimes(1);
    mocks.read.mockRejectedValueOnce(new Error("denied")); click("读取所选版本与运营"); await screen.findByText(/读取失败或身份/);
    expect(mocks.read.mock.calls.at(-1)![0].operatorId).toBe(8); click("清除版本运营筛选"); click("读取所选版本与运营"); await screen.findByTestId("complete-board");
    expect(mocks.read.mock.calls.at(-1)![0]).not.toHaveProperty("operatorId");
  });
  it("reads exact historical edition ID and returns to null without confusing a month with an edition", async () => {
    mount(); await read(); click("读取归档历史"); await screen.findByRole("region", { name: "月度归档版本" });
    fireEvent.click(screen.getByRole("button", { name: /2026-08 · 原版 · #8/ })); await waitFor(() => expect(screen.getByTestId("complete-board")).toHaveTextContent("版本 8"));
    expect(mocks.read.mock.calls.at(-1)![0].editionId).toBe(8); expect(screen.getByText(/历史归档（数据及备注只读）/)).toBeVisible();
    click("返回当前看板"); await waitFor(() => expect(screen.getByTestId("complete-board")).toHaveTextContent("版本 9")); expect(mocks.read.mock.calls.at(-1)![0].editionId).toBeNull();
  });
  it("follows every history cursor and rejects changed history versions", async () => {
    mocks.history.mockImplementation(async request => ({ identity, scope: scopeFull, request, state: state(), historyVersion: request.cursor ? "f".repeat(64) : "e".repeat(64),
      items: request.cursor ? [edition(1)] : Array.from({ length: 20 }, (_, index) => edition(40 - index)),
      page: request.cursor ? { nextCursor: null, hasMore: false } : { nextCursor: { beforeId: 21, historyVersion: "e".repeat(64) }, hasMore: true } }));
    mount(); await read(); click("读取归档历史"); await screen.findByRole("button", { name: "归档下一页" }); click("归档下一页");
    await screen.findByText(/读取失败或身份/); expect(mocks.history.mock.calls.at(-1)![0].cursor).toEqual({ beforeId: 21, historyVersion: "e".repeat(64) });
    expect(screen.queryByTestId("complete-board")).not.toBeInTheDocument();
  });
  it.each(["identity", "scope", "request", "ownership"])("rejects changed %s response without fallback", async field => {
    mocks.read.mockImplementation(async input => {
      const value = readResult(input);
      if (field === "identity") value.identity.userId = 8;
      if (field === "scope") value.scope.storeName = "OTHER";
      if (field === "request") value.request.editionId = 8;
      if (field === "ownership") value.ownership!.selectedOperatorId = 8;
      return value;
    });
    mount(); click("读取当前看板版本"); await screen.findByText(/读取失败或身份/); expect(screen.queryByTestId("complete-board")).not.toBeInTheDocument();
  });
  it("does not show current_empty as zero or fall back to a past edition", async () => {
    mocks.state.mockImplementation(async request => ({ identity, scope: scopeFull, request, state: { ...state(), status: "current_empty" }, capabilities: { initialize: cap(false), publishRevision: cap(false) } }));
    mocks.read.mockImplementation(async input => { const value = readResult(input); value.status = "current_empty"; value.state.status = "current_empty"; value.rows = []; value.sources = []; value.notes = []; value.coverage.rowCount = 0; value.ownership!.parents = []; value.ownership!.operators = []; return value; });
    mount(); await read(); expect(screen.getByText(/当前期有效来源已撤销/)).toBeVisible(); expect(mocks.read).toHaveBeenCalledTimes(1);
  });
});

describe("notes preserve draft, exact CAS and unknown IDs", () => {
  it("saves full original text with all three versions and closes only its own submitted draft", async () => {
    mount(); await edit(); change("<script>不是代码</script>\n完整原因"); click("保存版本备注");
    await waitFor(() => expect(mocks.saveNote).toHaveBeenCalledTimes(1));
    expect(mocks.saveNote.mock.calls[0][0]).toMatchObject({ ...base, operationId: uuid, editionId: 9, parentAsin: parent, note: "<script>不是代码</script>\n完整原因", expectedEditionVersion: 4, expectedSourceHash: capture().sourceHash, expectedNoteVersion: 1 });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); expect(readBoardPending(context)).toBeNull();
  });
  it("requires a separate explicit empty-note confirmation", async () => {
    mount(); await edit(); change(""); expect(screen.getByRole("button", { name: "保存版本备注" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("确认明确清空此版本备注")); click("保存版本备注"); await waitFor(() => expect(mocks.saveNote).toHaveBeenCalled());
    expect(mocks.saveNote.mock.calls[0][0].note).toBe("");
  });
  it("does not allow editing archived notes and preserves full text viewing", async () => {
    mount(); await read(); click("读取归档历史"); fireEvent.click(await screen.findByRole("button", { name: /2026-08 · 原版 · #8/ }));
    await screen.findByRole("button", { name: "查看备注 · " + parent }); click("查看备注 · " + parent);
    expect(screen.getByLabelText("版本利润变化原因")).toHaveAttribute("readonly"); expect(screen.queryByRole("button", { name: "保存版本备注" })).not.toBeInTheDocument();
  });
  it("guards dirty close and preserves draft when the user stays", async () => {
    mount(); await edit(); change("未保存草稿"); click("关闭备注"); await screen.findByText("保留未提交草稿？"); click("继续编辑，不切换");
    expect(screen.getByLabelText("版本利润变化原因")).toHaveValue("未保存草稿"); click("关闭备注"); click("放弃未提交草稿并继续"); await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("keeps an unknown UUID and no note body in storage, then recovers despite writes being off", async () => {
    let sent!: OperationsBoardEditionSaveNoteInput; mocks.saveNote.mockImplementation(async input => { sent = input; throw new Error("lost ACK"); });
    mount(); await edit(); change("仅内存私密备注"); click("保存版本备注"); await waitFor(() => expect(readBoardPending(context)?.operationId).toBe(uuid));
    expect(localStorage.getItem(boardPendingKey(context))).not.toContain("仅内存私密备注"); expect(screen.getByRole("button", { name: "保存版本备注" })).toBeDisabled();
    writes = false; mocks.recover.mockImplementation(async () => committed(sent)); click("核对原备注操作");
    await waitFor(() => expect(readBoardPending(context)).toBeNull()); expect(mocks.saveNote).toHaveBeenCalledTimes(1); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("retains pending on unknown or mismatched committed receipt", async () => {
    mocks.saveNote.mockImplementation(async input => ({ ...committed(input), requestHash: "f".repeat(64) }));
    mount(); await edit(); change("保留草稿"); click("保存版本备注"); await waitFor(() => expect(readBoardPending(context)).not.toBeNull());
    click("核对原备注操作"); await waitFor(() => expect(mocks.recover).toHaveBeenCalled()); expect(readBoardPending(context)).not.toBeNull(); expect(screen.getByLabelText("版本利润变化原因")).toHaveValue("保留草稿");
  });
  it("cancel acknowledgement is UUID bound and cancel only releases after final acknowledgement", async () => {
    mocks.saveNote.mockImplementation(async input => final(input.operationId)); mount(); await edit(); change("保留草稿"); click("保存版本备注");
    await screen.findByRole("button", { name: "永久取消原备注操作" }); expect(screen.getByRole("button", { name: "永久取消原备注操作" })).toBeDisabled();
    fireEvent.click(within(screen.getByRole("region", { name: "备注未决操作恢复" })).getByRole("checkbox")); click("永久取消原备注操作");
    await waitFor(() => expect(readBoardPending(context)).toBeNull()); expect(screen.getByLabelText("版本利润变化原因")).toHaveValue("保留草稿");
  });
  it("conflict leaves draft, requires terminal cancellation then explicit fresh comparison", async () => {
    mocks.saveNote.mockRejectedValue({ data: { code: "CONFLICT" } }); mount(); await edit(); change("我的草稿"); click("保存版本备注"); await within(screen.getByRole("dialog")).findByText(/版本发生冲突/);
    fireEvent.click(within(screen.getByRole("region", { name: "备注未决操作恢复" })).getByRole("checkbox")); click("永久取消原备注操作"); await waitFor(() => expect(readBoardPending(context)).toBeNull());
    noteValue = "另一人的已保存备注"; noteVersion = 2; editionVersion = 5; click("读取当前版本对照（保留草稿）"); await screen.findByText("服务器当前备注：另一人的已保存备注");
    expect(screen.getByLabelText("版本利润变化原因")).toHaveValue("我的草稿"); expect(screen.getByRole("button", { name: "保存版本备注" })).toBeDisabled();
    click("采用最新版本继续编辑（保留草稿正文）"); expect(screen.getByRole("button", { name: "保存版本备注" })).toBeEnabled();
  });
  it("foreign same-target committed recovery must not clear this component's unsent draft", async () => {
    mount(); await edit(); change("B窗口未发送草稿");
    const sent = { ...base, operationId: secondUuid, editionId: 9, parentAsin: parent, note: "A窗口已保存", expectedEditionVersion: 4, expectedSourceHash: capture().sourceHash, expectedNoteVersion: 1 };
    await act(async () => { reserveBoardPending(context, { version: 1, context, operationId: secondUuid, requestHash: operationsBoardEditionRequestHash(identity, sent), action: "saveNote", editionId: 9, parentAsin: parent }); });
    mocks.recover.mockResolvedValue(committed(sent)); click("核对原备注操作"); await waitFor(() => expect(readBoardPending(context)).toBeNull());
    expect(screen.getByLabelText("版本利润变化原因")).toHaveValue("B窗口未发送草稿"); expect(screen.getByRole("button", { name: "保存版本备注" })).toBeDisabled();
  });
});

describe("permissions, invalidation and late responses", () => {
  it.each(["loading", "error", "missing", "workspace", "role", "permissionLoading", "dashboard", "financial"])("does not mount private controller for %s", async kind => {
    if (kind === "loading") mocks.auth.loading = true;
    if (kind === "error") mocks.auth.error = new Error("failed");
    if (kind === "missing") mocks.auth.user = null;
    if (kind === "workspace") mocks.auth.user!.defaultWorkspaceId = 12;
    if (kind === "role") mocks.auth.user!.role = "ops_specialist";
    if (kind === "permissionLoading") mocks.permissions.isLoading = true;
    if (kind === "dashboard" || kind === "financial") mocks.permissions.canRead.mockImplementation((_module, directory) => directory !== (kind === "dashboard" ? "ops_dashboard" : "ops_data_import"));
    mount(); expect(screen.queryByRole("button", { name: "读取当前看板版本" })).not.toBeInTheDocument(); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("permission revocation unmounts private drafts but retains pending metadata", async () => {
    mocks.saveNote.mockImplementation(async input => final(input.operationId)); const view = mount(); await edit(); change("私密草稿"); click("保存版本备注"); await waitFor(() => expect(readBoardPending(context)).not.toBeNull());
    mocks.permissions.canRead.mockReturnValue(false); view.rerender(<OperationsBoardEditionWorkspace owner={owner} scope={scope} renderContent={content} />);
    expect(screen.queryByLabelText("版本利润变化原因")).not.toBeInTheDocument(); expect(readBoardPending(context)).not.toBeNull();
  });
  it("ignores late old-scope reply and never renders it in another scope", async () => {
    const deferredRead = deferred<OperationsBoardEditionReadResult>(); mocks.read.mockReturnValue(deferredRead.promise); const view = mount(); click("读取当前看板版本");
    view.rerender(<OperationsBoardEditionWorkspace owner={owner} scope={{ ...scope, storeName: "OTHER" }} renderContent={content} />);
    await act(async () => deferredRead.resolve(readResult())); expect(screen.queryByTestId("complete-board")).not.toBeInTheDocument();
  });
  it("same-workspace cross-actor events invalidate without losing note draft, other workspace is ignored", async () => {
    mount(); await edit(); change("草稿仍在");
    act(() => publishMonthlyFinancialChange({ userId: 999, workspaceId: 12, action: "confirm", batchId: 1 })); expect(screen.getByRole("button", { name: "保存版本备注" })).toBeEnabled();
    act(() => publishMonthlyFinancialChange({ userId: 999, workspaceId: 11, action: "confirm", batchId: 1 }));
    expect(screen.getByLabelText("版本利润变化原因")).toHaveValue("草稿仍在"); expect(screen.getByRole("button", { name: "保存版本备注" })).toBeDisabled();
  });
  it.each(["not_found", "missing_parent"])("hides the old private note after a fresh authorized read returns %s", async outcome => {
    mount(); await edit(); change("不可继续泄露的私有草稿");
    mocks.read.mockImplementation(async input => {
      const value = readResult(input); value.notes = [];
      if (outcome === "not_found") {
        value.status = "not_found"; value.reasonCode = "not_found"; value.edition = null; value.rows = []; value.sources = []; value.ownership = null; value.coverage.rowCount = 0;
      }
      return OperationsBoardEditionReadResultSchema.parse(value);
    });
    act(() => publishBoardEditionChange({ workspaceId: 11, scope: null, action: "partners" }));
    click("读取当前版本对照（保留草稿）");
    await waitFor(() => expect(screen.queryByLabelText("版本利润变化原因")).not.toBeInTheDocument());
    expect(screen.queryByText("不可继续泄露的私有草稿")).not.toBeInTheDocument(); expect(mocks.saveNote).not.toHaveBeenCalled();
  });
  it("preserves a still-readable unsent note as readonly after edit permission is revoked", async () => {
    mount(); await edit(); change("仍可读取的未发送草稿"); writes = false;
    act(() => publishBoardEditionChange({ workspaceId: 11, scope: null, action: "partners" }));
    click("读取当前版本对照（保留草稿）");
    await waitFor(() => expect(screen.queryByRole("button", { name: "保存版本备注" })).not.toBeInTheDocument());
    expect(screen.getByLabelText("版本利润变化原因")).toHaveValue("仍可读取的未发送草稿");
    expect(screen.getByLabelText("版本利润变化原因")).toHaveAttribute("readonly"); expect(mocks.saveNote).not.toHaveBeenCalled();
  });
  it("cross-tab source changes invalidate displayed content", async () => {
    mount(); await read();
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "ops-board-changed:v1", newValue: JSON.stringify({ workspaceId: 11, scope, action: "note", nonce: secondUuid }) })));
    expect(screen.queryByTestId("complete-board")).not.toBeInTheDocument();
  });
  it("cannot submit when locks are unavailable", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined }); mount(); await edit(); change("不发送"); click("保存版本备注");
    await within(screen.getByRole("dialog")).findByText(/未取得可核验回执/); expect(mocks.saveNote).not.toHaveBeenCalled();
  });
  it("a persisted UUID changed without a storage event cannot receive the old checkbox's cancel", async () => {
    mocks.saveNote.mockImplementation(async input => final(input.operationId)); mount(); await edit(); change("草稿"); click("保存版本备注"); await waitFor(() => expect(readBoardPending(context)).not.toBeNull());
    fireEvent.click(within(screen.getByRole("region", { name: "备注未决操作恢复" })).getByRole("checkbox"));
    localStorage.setItem(boardPendingKey(context), operationsBoardEditionCanonical({ ...readBoardPending(context)!, operationId: secondUuid }));
    click("永久取消原备注操作"); await waitFor(() => expect(screen.getByRole("region", { name: "备注未决操作恢复" })).toHaveTextContent(secondUuid));
    expect(mocks.recover).not.toHaveBeenCalled(); expect(screen.getByRole("button", { name: "永久取消原备注操作" })).toBeDisabled();
  });
});

describe("explicit initialize/revision and direct numeric pairs", () => {
  it("initialization requires preview and all-effects acknowledgement before one execute", async () => {
    initialized = false; mount(); click("读取当前看板版本"); await screen.findByText(/此店铺／站点尚未初始化/); click("预览首次初始化");
    await screen.findByRole("region", { name: "归档操作影响预览" }); expect(screen.getByRole("button", { name: "确认执行版本操作" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("我已核对范围、月份与全部影响，明确确认本次操作")); click("确认执行版本操作"); await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));
    expect(mocks.execute.mock.calls[0][0]).toMatchObject({ ...base, action: "initialize", originalEditionId: null, expectedStateVersion: 0, operationId: uuid });
  });
  it("default-off initialization is visibly unavailable without silently writing", async () => {
    initialized = false; writes = false; mount(); click("读取当前看板版本"); await screen.findByText(/此店铺／站点尚未初始化/);
    expect(screen.getByRole("button", { name: "预览首次初始化" })).toBeDisabled(); expect(screen.getByText(/功能写入开关尚未启用/)).toBeVisible(); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("revision binds the archived original and describes no movement or copying", async () => {
    mount(); await read(); click("读取归档历史"); fireEvent.click(await screen.findByRole("button", { name: /2026-08 · 原版 · #8/ }));
    await screen.findByRole("button", { name: "预览发布所选原版的修订" }); click("预览发布所选原版的修订");
    const preview = await screen.findByRole("region", { name: "归档操作影响预览" }); expect(preview).toHaveTextContent("不移动当前版本指针"); expect(preview).toHaveTextContent("不复制备注");
    expect(mocks.preview.mock.calls[0][0]).toEqual({ ...base, action: "publishRevision", originalEditionId: 8 });
  });
  it("pairs use numeric IDs, require acknowledgement and retain inactive record versions", async () => {
    mount(); click("打开数字搭档管理"); expect(mocks.partnerOptions).not.toHaveBeenCalled(); click("读取搭档配置与权限"); await screen.findByRole("button", { name: "重新启用配对 #50" });
    fireEvent.change(screen.getByLabelText("第一位数字成员"), { target: { value: "8" } }); fireEvent.change(screen.getByLabelText("第二位数字成员"), { target: { value: "7" } });
    expect(screen.getByRole("button", { name: "保存数字配对" })).toBeDisabled(); fireEvent.click(screen.getByLabelText("我确认此次配对／停用会改变双方当前可读范围，不会赋予写权限")); click("保存数字配对");
    await waitFor(() => expect(mocks.setPartner).toHaveBeenCalledTimes(1)); expect(mocks.setPartner.mock.calls[0][0]).toEqual({ expectedWorkspaceId: 11, operationId: uuid, firstUserId: 7, secondUserId: 8, isActive: true, expectedVersion: 3 });
  });
  it("existing departed-member pairs can be disabled but not re-enabled from a fabricated directory", async () => {
    mocks.partnerOptions.mockImplementation(async request => ({ identity, request, capability: cap(true), members: [{ userId: 7, displayName: "SYNTHETIC" }], pairs: [{ id: 50, workspaceId: 11, firstUserId: 7, secondUserId: 8, isActive: true, version: 3, updatedBy: 7, updatedAt: time }] }));
    mount(); click("打开数字搭档管理"); click("读取搭档配置与权限"); await screen.findByText(/当前非有效成员 · ID 8/); fireEvent.click(screen.getByLabelText("我确认此次配对／停用会改变双方当前可读范围，不会赋予写权限")); click("停用配对 #50");
    await waitFor(() => expect(mocks.setPartner).toHaveBeenCalled()); expect(mocks.setPartner.mock.calls[0][0].isActive).toBe(false);
  });
  it("lost partner acknowledgement is recoverable with write flag off and does not auto-resubmit", async () => {
    mocks.setPartner.mockRejectedValue(new Error("lost")); mount(); click("打开数字搭档管理"); click("读取搭档配置与权限"); await screen.findByRole("button", { name: "重新启用配对 #50" });
    fireEvent.click(screen.getByLabelText("我确认此次配对／停用会改变双方当前可读范围，不会赋予写权限")); click("重新启用配对 #50");
    await screen.findByRole("region", { name: "搭档未决操作恢复" }); writes = false; click("核对原搭档操作"); await waitFor(() => expect(mocks.recoverPartner).toHaveBeenCalled());
    expect(mocks.setPartner).toHaveBeenCalledTimes(1); expect(readBoardPending(boardOperationContext(owner, null))?.operationId).toBe(uuid);
  });
});
