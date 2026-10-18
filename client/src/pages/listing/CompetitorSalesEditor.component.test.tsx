// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompetitorSalesEditor, CompetitorSalesSummary, type CompetitorSalesRecord } from "./CompetitorSalesEditor";
import AnalysisPage from "../AnalysisPage";

const state = vi.hoisted(() => {
  const save = vi.fn(), read = vi.fn(), invalidate = vi.fn();
  return { save, read, invalidate, saved: vi.fn(), options: [] as { retry?: boolean }[], queryCalls: vi.fn(), merged: false,
    listQuery: { data: [] as unknown[], isSuccess: false, isFetchedAfterMount: false, isFetching: false, isError: false, isLoading: false, refetch: vi.fn() },
    importQuery: { data: [] as unknown[], isLoading: false, error: null, refetch: vi.fn() },
    utils: { client: { analysis: { listByProject: { query: read } } }, analysis: { listByProject: { invalidate } } },
    auth: { user: { id: 7, defaultWorkspaceId: 11, role: "admin" } as { id: number; defaultWorkspaceId: number | null | undefined; role: string } | null, loading: false, error: null as Error | null } };
});
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => state.auth }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => state.utils, analysis: {
  calibrateSales: { useMutation: (options: { retry?: boolean }) => { state.options.push(options); return { mutateAsync: state.save }; } },
  listByProject: { useQuery: (input: unknown, options: unknown) => { state.queryCalls(input, options); return state.listQuery; } },
  listImportJobs: { useQuery: () => state.importQuery },
  analyzeAsin: { useMutation: () => ({ mutateAsync: vi.fn() }) }, analyzeManual: { useMutation: () => ({ mutateAsync: vi.fn() }) },
  startImportJob: { useMutation: () => ({ mutateAsync: vi.fn() }) }, previewReviewFile: { useMutation: () => ({ mutateAsync: vi.fn() }) },
  previewSellerSpriteFile: { useMutation: () => ({ mutateAsync: vi.fn() }) }, delete: { useMutation: () => ({ mutate: vi.fn() }) },
} } }));
vi.mock("@/contexts/ProjectContext", () => ({ useProject: () => ({ selectedProjectId: 5 }) }));
vi.mock("@/components/ProjectSelector", () => ({ default: () => null }));
vi.mock("@/pages/listing/CompetitorAnalysisSummaryEditor", () => ({ CompetitorAnalysisSummaryEditor: () => null }));
vi.mock("@/lib/mergedListingWorkflow", () => ({ get MERGED_LISTING_WORKFLOW_ENABLED() { return state.merged; } }));
const revision = "a".repeat(64), nextRevision = "b".repeat(64);
const row: CompetitorSalesRecord = { id: 3, projectId: 5, asin: "B000000003", revision, rawData: JSON.stringify({ research: { boughtPastMonth: "100+" } }), salesCalibrationWritable: true };
const manual = { version: 1, value: 200, sourceNote: "人工核对来源", updatedBy: 7, updatedAt: "2026-10-19T01:02:03.000Z" };
const editor = (analysis = row, projectId = 5) => <CompetitorSalesEditor projectId={projectId} analysis={analysis} onSaved={state.saved} />;
function start(value = "200", note = "人工核对来源") {
  fireEvent.click(screen.getByRole("button", { name: "校准月销量" }));
  fireEvent.change(screen.getByRole("textbox", { name: "人工月销量" }), { target: { value } });
  fireEvent.change(screen.getByRole("textbox", { name: "销量来源说明" }), { target: { value: note } });
}
const save = () => fireEvent.click(screen.getByRole("button", { name: "保存销量校准" }));
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  vi.clearAllMocks(); state.options.length = 0;
  state.auth = { user: { id: 7, defaultWorkspaceId: 11, role: "admin" }, loading: false, error: null };
  state.merged = false;
  Object.assign(state.listQuery, { data: [], isSuccess: false, isFetchedAfterMount: false, isFetching: false, isError: false, isLoading: false });
  state.invalidate.mockResolvedValue(undefined); state.saved.mockResolvedValue(undefined); state.read.mockResolvedValue([row]);
  state.save.mockImplementation(input => Promise.resolve({ ...row, revision: nextRevision, identity: { userId: 7, workspaceId: state.auth.user?.defaultWorkspaceId },
    rawData: JSON.stringify(input.value === null ? { research: { boughtPastMonth: "100+" } } : { manualSales: { ...manual, value: input.value, sourceNote: input.sourceNote } }) }));
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("owned manual sales editor", () => {
  it("submits actual zero and source with exact scope/revision, validates persisted metadata and refreshes both owners", async () => {
    render(editor()); start("0", "  实际核对  "); save(); await screen.findByText(/销量已校准；/);
    expect(state.save).toHaveBeenCalledOnce(); expect(state.save).toHaveBeenCalledWith({ projectId: 5, analysisId: 3, expectedWorkspaceId: 11, expectedRevision: revision, value: 0, sourceNote: "实际核对" });
    expect(state.options.every(option => option.retry === false)).toBe(true);
    expect(state.invalidate).toHaveBeenCalledWith({ projectId: 5 }); expect(state.saved).toHaveBeenCalledOnce();
    expect(screen.getByText(/来源：实际核对/)).toBeInTheDocument();
  });
  it("explicit restore removes the manual override, not the original collected source", async () => {
    render(editor({ ...row, rawData: JSON.stringify({ manualSales: manual, research: { boughtPastMonth: "100+" } }) }));
    fireEvent.click(screen.getByRole("button", { name: "校准月销量" })); fireEvent.click(screen.getByRole("button", { name: "恢复采集值" }));
    await screen.findByText(/已恢复采集值/); expect(state.save.mock.calls[0][0]).toMatchObject({ value: null, sourceNote: null, expectedRevision: revision });
    expect(screen.getByText(/100\+（下限）/)).toBeInTheDocument();
  });
  it("requires explicit confirmation before restoring collected values", () => {
    vi.mocked(window.confirm).mockReturnValue(false); render(editor({ ...row, rawData: JSON.stringify({ manualSales: manual }) }));
    fireEvent.click(screen.getByRole("button", { name: "校准月销量" })); fireEvent.click(screen.getByRole("button", { name: "恢复采集值" })); expect(state.save).not.toHaveBeenCalled();
  });
  it.each([false, undefined])("missing/disabled write capability %s never enables save", capability => {
    render(editor({ ...row, salesCalibrationWritable: capability })); start(); expect(screen.getByRole("button", { name: "保存销量校准" })).toBeDisabled(); save(); expect(state.save).not.toHaveBeenCalled();
  });
  it.each(["", "-1", "1.5", "1e3", "1000000001", "NaN", " 0 "])("rejects invalid numeric input %s without normalizing to zero", value => {
    render(editor()); start(value); save(); expect(state.save).not.toHaveBeenCalled();
  });
  it("requires a nonblank source note", () => { render(editor()); start("0", "   "); save(); expect(state.save).not.toHaveBeenCalled(); });
  it("legacy calibration remains unverified and can be explicitly recalibrated", async () => {
    render(editor({ ...row, rawData: JSON.stringify({ manualSales: { value: 300, updatedAt: manual.updatedAt, updatedBy: 7 } }) }));
    expect(screen.getByRole("alert")).toHaveTextContent("旧校准"); start("300", "重新核对的来源"); save(); await screen.findByText(/销量已校准；/);
  });
  it("explicit null workspace is not replaced by a default", async () => {
    state.auth.user!.defaultWorkspaceId = null; render(editor()); start(); save(); await screen.findByText(/销量已校准；/); expect(state.save.mock.calls[0][0].expectedWorkspaceId).toBeNull();
  });
  it.each(["loading", "error", "anonymous", "workspace", "role", "project"])("denies incomplete %s without a read or write", kind => {
    if (kind === "loading") state.auth.loading = true;
    if (kind === "error") state.auth.error = new Error("private");
    if (kind === "anonymous") state.auth.user = null;
    if (kind === "workspace") state.auth.user!.defaultWorkspaceId = undefined;
    if (kind === "role") state.auth.user!.role = "";
    render(editor(row, kind === "project" ? 6 : 5)); expect(screen.queryByRole("button")).not.toBeInTheDocument(); expect(state.read).not.toHaveBeenCalled(); expect(state.save).not.toHaveBeenCalled();
  });
  it.each(["user", "workspace", "role", "project"])("drops private draft and ignores late response on %s change", async kind => {
    const pending = deferred<unknown>(); state.save.mockReturnValue(pending.promise); const view = render(editor()); start("123", "旧身份私有输入"); save();
    if (kind === "user") state.auth.user!.id = 8;
    if (kind === "workspace") state.auth.user!.defaultWorkspaceId = 12;
    if (kind === "role") state.auth.user!.role = "member";
    view.rerender(editor(kind === "project" ? { ...row, projectId: 6 } : row, kind === "project" ? 6 : 5));
    await act(async () => pending.resolve({ ...row, revision: nextRevision, identity: { userId: 7, workspaceId: 11 }, rawData: JSON.stringify({ manualSales: { ...manual, value: 123, sourceNote: "旧身份私有输入" } }) }));
    expect(screen.queryByDisplayValue("旧身份私有输入")).not.toBeInTheDocument(); expect(state.saved).not.toHaveBeenCalled(); expect(state.invalidate).not.toHaveBeenCalled();
  });
  it("keeps dirty input on changed source and requires explicit fresh read/adoption before using new revision", async () => {
    const view = render(editor()); start("321", "仍未保存的来源"); view.rerender(editor({ ...row, revision: nextRevision }));
    expect(screen.getByRole("textbox", { name: "销量来源说明" })).toHaveValue("仍未保存的来源"); expect(screen.getByRole("button", { name: "保存销量校准" })).toBeDisabled();
    state.read.mockResolvedValue([{ ...row, revision: nextRevision }]); fireEvent.click(screen.getByRole("button", { name: "重新读取并核对" }));
    fireEvent.click(await screen.findByRole("button", { name: "采用已读取版本，保留输入" })); save(); await screen.findByText(/销量已校准；/);
    expect(state.save.mock.calls[0][0]).toMatchObject({ expectedRevision: nextRevision, value: 321, sourceNote: "仍未保存的来源" });
  });
  it.each(["CONFLICT", "INTERNAL_SERVER_ERROR"])("%s retains draft, blocks blind resubmit and never auto retries", async code => {
    state.save.mockRejectedValue({ data: { code }, message: "private failure" }); render(editor()); start(); save();
    await screen.findByText(/当前需要重新读取/); save(); expect(state.save).toHaveBeenCalledOnce(); expect(state.read).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "人工月销量" })).toHaveValue("200"); expect(screen.queryByText("private failure")).not.toBeInTheDocument();
  });
  it("only explicit reread after lost ACK can release the local write quarantine", async () => {
    state.save.mockRejectedValueOnce(new Error("lost ACK")); render(editor()); start(); save(); await screen.findByText(/当前需要重新读取/);
    state.read.mockResolvedValue([{ ...row, revision: nextRevision, rawData: JSON.stringify({ manualSales: manual }) }]);
    fireEvent.click(screen.getByRole("button", { name: "重新读取并核对" })); await screen.findByRole("button", { name: "采用已读取版本，保留输入" });
    expect(state.save).toHaveBeenCalledOnce(); expect(screen.getByRole("button", { name: "保存销量校准" })).toBeDisabled();
  });
  it.each(["missing", "duplicate", "other-duplicate", "mixed-project", "wrong-asin", "bad-revision", "bad-raw", "null-row", "non-array"])("successful reread with %s fails closed and hides previous private data", async kind => {
    const privateRow = { ...row, rawData: JSON.stringify({ manualSales: { ...manual, sourceNote: "原已保存私有说明" } }) };
    let rows: unknown = [privateRow];
    if (kind === "missing") rows = [];
    if (kind === "duplicate") rows = [privateRow, privateRow];
    if (kind === "other-duplicate") rows = [privateRow, { ...row, id: 4 }, { ...row, id: 4 }];
    if (kind === "mixed-project") rows = [privateRow, { ...row, id: 4, projectId: 99 }];
    if (kind === "wrong-asin") rows = [{ ...privateRow, asin: "B000000004" }];
    if (kind === "bad-revision") rows = [{ ...privateRow, revision: "invalid" }];
    if (kind === "bad-raw") rows = [{ ...privateRow, rawData: "invalid-json" }];
    if (kind === "null-row") rows = [null];
    if (kind === "non-array") rows = {};
    state.read.mockResolvedValue(rows); render(editor(privateRow)); start("200", "未提交的私有说明");
    fireEvent.click(screen.getByRole("button", { name: "重新读取并核对" })); await screen.findByText(/已隐藏旧资料和草稿/);
    expect(screen.queryByDisplayValue("未提交的私有说明")).not.toBeInTheDocument(); expect(screen.queryByText(/原已保存私有说明/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument(); expect(state.save).not.toHaveBeenCalled();
    expect(state.read).toHaveBeenCalledWith({ projectId: 5, expectedUserId: 7, expectedWorkspaceId: 11 });
  });
  it("network-unknown reread preserves a dirty input but blocks another write", async () => {
    state.read.mockRejectedValue(new Error("network unavailable")); render(editor()); start("999", "网络失败保留草稿");
    fireEvent.click(screen.getByRole("button", { name: "重新读取并核对" })); await screen.findByText(/当前需要重新读取/);
    expect(screen.getByRole("textbox", { name: "销量来源说明" })).toHaveValue("网络失败保留草稿"); expect(screen.getByRole("button", { name: "保存销量校准" })).toBeDisabled();
  });
  it.each(["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"])("%s hides old private input", async code => {
    state.save.mockRejectedValue({ data: { code } }); render(editor()); start("123", "不能泄露的说明"); save(); await screen.findByText(/已隐藏销量草稿/);
    expect(screen.queryByDisplayValue("不能泄露的说明")).not.toBeInTheDocument(); expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it.each(["actor", "workspace", "project", "asin", "revision", "value", "note", "legacy", "flag"])("rejects forged/mismatched %s in a save receipt", async field => {
    const receipt = { ...row, revision: nextRevision, identity: { userId: 7, workspaceId: 11 }, rawData: JSON.stringify({ manualSales: manual }) };
    if (field === "actor") receipt.identity.userId = 8;
    if (field === "workspace") receipt.identity.workspaceId = 12;
    if (field === "project") receipt.projectId = 6;
    if (field === "asin") receipt.asin = "B000000004";
    if (field === "revision") receipt.revision = "bad";
    if (field === "value") receipt.rawData = JSON.stringify({ manualSales: { ...manual, value: 201 } });
    if (field === "note") receipt.rawData = JSON.stringify({ manualSales: { ...manual, sourceNote: "other" } });
    if (field === "legacy") receipt.rawData = JSON.stringify({ manualSales: { value: 200 } });
    if (field === "flag") delete receipt.salesCalibrationWritable;
    state.save.mockResolvedValue(receipt); render(editor()); start(); save(); await screen.findByRole("alert");
    expect(state.saved).not.toHaveBeenCalled(); expect(state.invalidate).not.toHaveBeenCalled();
  });
  it("single in-flight guard prevents repeated local clicks", async () => {
    const pending = deferred<unknown>(); state.save.mockReturnValue(pending.promise); render(editor()); start(); save(); save(); expect(state.save).toHaveBeenCalledOnce();
    await act(async () => pending.reject(new Error("lost")));
  });
  it("capability revocation preserves draft but disables writes immediately", () => {
    const view = render(editor()); start(); view.rerender(editor({ ...row, salesCalibrationWritable: false }));
    expect(screen.getByRole("textbox", { name: "人工月销量" })).toHaveValue("200"); expect(screen.getByRole("button", { name: "保存销量校准" })).toBeDisabled();
  });
  it("an untouched open form follows a fresh source revision instead of sending stale input against a new revision", () => {
    const view = render(editor()); fireEvent.click(screen.getByRole("button", { name: "校准月销量" }));
    expect(screen.getByRole("textbox", { name: "人工月销量" })).toHaveValue("100");
    view.rerender(editor({ ...row, revision: nextRevision, rawData: JSON.stringify({ manualSales: manual }) }));
    expect(screen.getByRole("textbox", { name: "人工月销量" })).toHaveValue("200"); expect(screen.getByRole("textbox", { name: "销量来源说明" })).toHaveValue(manual.sourceNote);
  });
  it("a single saved ASIN badge never claims all variants were collected", () => {
    render(<CompetitorSalesSummary analysis={row} />); expect(screen.getByText(/单 ASIN 购买提示/)).toBeInTheDocument();
    expect(screen.getByText(/不证明其他子体已采集/)).toBeInTheDocument(); expect(screen.getByText(/已保存观测覆盖 1\/1/)).toBeInTheDocument();
  });
  it("asks before discarding a dirty draft and escapes the source note", () => {
    vi.mocked(window.confirm).mockReturnValue(false); render(editor()); start("200", "<script>不执行</script>"); fireEvent.click(screen.getByRole("button", { name: /^关闭$/ }));
    expect(within(screen.getByRole("dialog")).getByRole("textbox", { name: "销量来源说明" })).toHaveValue("<script>不执行</script>"); expect(document.querySelector("script")).toBeNull();
  });
  it("does not claim refresh succeeded when parent-owned refresh fails", async () => {
    state.saved.mockRejectedValue(new Error("refresh failed")); render(editor()); start(); save(); await screen.findByText(/销量已保存，页面刷新未完成/); expect(state.save).toHaveBeenCalledOnce();
  });
});
describe("sales source display", () => {
  it("shows partial coverage and independent estimates without summing them", () => {
    render(<CompetitorSalesSummary analysis={{ ...row, rawData: JSON.stringify({ sellerSpriteData: { monthlySales: 900 }, research: { variants: [{ asin: row.asin, status: "collected", boughtPastMonth: "100+" }, { asin: "B000000004", status: "failed" }] } }) }} />);
    expect(screen.getByText(/100\+（下限）/)).toBeInTheDocument(); expect(screen.getByText(/覆盖 1\/2/)).toBeInTheDocument(); expect(screen.getByText(/独立估算：900/)).toBeInTheDocument();
  });
});

describe("real AnalysisPage fresh owned sales boundary", () => {
  const privateRow = () => ({ ...row, title: "旧账号私有商品标题", keywords: null, reviewAnalysis: null, bulletPoints: null, summary: null, aiSummary: null,
    summaryStatus: "draft", summaryVersion: 1, summaryConfirmedAt: null, rawData: JSON.stringify({ manualSales: { ...manual, sourceNote: "旧账号私有销量来源" } }) });
  it.each([false, true])("flag %s requires fresh success for this mount before displaying the real editor", merged => {
    state.merged = merged; state.listQuery.data = [privateRow()]; state.listQuery.isSuccess = true;
    const view = render(<AnalysisPage />);
    expect(screen.queryByText("旧账号私有商品标题")).not.toBeInTheDocument(); expect(screen.queryByText(/旧账号私有销量来源/)).not.toBeInTheDocument();
    expect(state.queryCalls).toHaveBeenCalledWith({ projectId: 5, expectedUserId: 7, expectedWorkspaceId: 11 }, expect.objectContaining({ refetchOnMount: "always", retry: false, enabled: true }));
    state.listQuery.isFetchedAfterMount = true; view.rerender(<AnalysisPage />); fireEvent.click(screen.getByText("旧账号私有商品标题"));
    expect(screen.getByText(/旧账号私有销量来源/)).toBeInTheDocument(); expect(screen.getByRole("button", { name: "校准月销量" })).toBeInTheDocument();
  });
  it.each(["user", "workspace", "role"])("a %s change cannot show cached rows before fresh authorization", kind => {
    Object.assign(state.listQuery, { data: [privateRow()], isSuccess: true, isFetchedAfterMount: true });
    const view = render(<AnalysisPage />); fireEvent.click(screen.getByText("旧账号私有商品标题")); expect(screen.getByText(/旧账号私有销量来源/)).toBeInTheDocument();
    if (kind === "user") state.auth.user!.id = 8;
    if (kind === "workspace") state.auth.user!.defaultWorkspaceId = 12;
    if (kind === "role") state.auth.user!.role = "readonly";
    Object.assign(state.listQuery, { isFetchedAfterMount: false, isFetching: true }); view.rerender(<AnalysisPage />);
    expect(screen.queryByText("旧账号私有商品标题")).not.toBeInTheDocument(); expect(screen.queryByText(/旧账号私有销量来源/)).not.toBeInTheDocument();
    Object.assign(state.listQuery, { isFetchedAfterMount: true, isFetching: false, isError: true, isSuccess: false }); view.rerender(<AnalysisPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("已隐藏旧结果"); expect(screen.queryByText("暂无分析结果")).not.toBeInTheDocument();
    expect(screen.queryByText(/旧账号私有销量来源/)).not.toBeInTheDocument(); expect(state.save).not.toHaveBeenCalled();
  });
  it.each(["fetching", "error", "mixed", "duplicate", "null-row"])("%s never passes old or wrong-scope rows to a sales editor", kind => {
    Object.assign(state.listQuery, { data: [privateRow()], isSuccess: true, isFetchedAfterMount: true });
    const view = render(<AnalysisPage />); fireEvent.click(screen.getByText("旧账号私有商品标题"));
    if (kind === "fetching") state.listQuery.isFetching = true;
    if (kind === "error") { state.listQuery.isError = true; state.listQuery.isSuccess = false; }
    if (kind === "mixed") state.listQuery.data = [privateRow(), { ...privateRow(), projectId: 99, id: 4 }];
    if (kind === "duplicate") state.listQuery.data = [privateRow(), privateRow()];
    if (kind === "null-row") state.listQuery.data = [null];
    view.rerender(<AnalysisPage />);
    if (kind === "fetching") expect(screen.getByText(/旧账号私有销量来源/)).not.toBeVisible();
    else expect(screen.queryByText(/旧账号私有销量来源/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "校准月销量" })).not.toBeInTheDocument();
  });
  it.each([[false, "list"], [true, "list"], [false, "auth"], [true, "auth"]] as const)("flag %s same-owner %s refresh suspends without losing a dirty sales draft", (merged, kind) => {
    state.merged = merged; Object.assign(state.listQuery, { data: [privateRow()], isSuccess: true, isFetchedAfterMount: true });
    const view = render(<AnalysisPage />); fireEvent.click(screen.getByText("旧账号私有商品标题")); start("321", "同身份保留草稿");
    if (kind === "list") state.listQuery.isFetching = true; else state.auth.loading = true;
    view.rerender(<AnalysisPage />);
    expect(screen.getByText("旧账号私有商品标题")).not.toBeVisible(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存销量校准" })).not.toBeInTheDocument();
    state.listQuery.isFetching = false; state.auth.loading = false; view.rerender(<AnalysisPage />);
    expect(screen.getByRole("textbox", { name: "人工月销量" })).toHaveValue("321");
    expect(screen.getByRole("textbox", { name: "销量来源说明" })).toHaveValue("同身份保留草稿"); expect(state.save).not.toHaveBeenCalled();
  });
  it.each(["list", "auth"])("same-owner %s refresh keeps a pending request and does not permit a second send", async kind => {
    Object.assign(state.listQuery, { data: [privateRow()], isSuccess: true, isFetchedAfterMount: true });
    const pending = deferred<unknown>(); state.save.mockReturnValue(pending.promise);
    const view = render(<AnalysisPage />); fireEvent.click(screen.getByText("旧账号私有商品标题")); start("321", "等待原回执"); save();
    if (kind === "list") state.listQuery.isFetching = true; else state.auth.loading = true;
    view.rerender(<AnalysisPage />); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    state.listQuery.isFetching = false; state.auth.loading = false; view.rerender(<AnalysisPage />);
    expect(screen.getByRole("textbox", { name: "销量来源说明" })).toHaveValue("等待原回执"); expect(screen.getByRole("button", { name: "保存销量校准" })).toBeDisabled();
    save(); expect(state.save).toHaveBeenCalledOnce(); await act(async () => pending.reject(new Error("lost ACK")));
    expect(screen.getByRole("textbox", { name: "销量来源说明" })).toHaveValue("等待原回执"); expect(screen.getByRole("button", { name: "保存销量校准" })).toBeDisabled();
  });
  it("a fresh changed revision after suspension retains dirty input and requires explicit adoption", () => {
    Object.assign(state.listQuery, { data: [privateRow()], isSuccess: true, isFetchedAfterMount: true });
    const view = render(<AnalysisPage />); fireEvent.click(screen.getByText("旧账号私有商品标题")); start("321", "不自动采用新版本");
    state.listQuery.isFetching = true; view.rerender(<AnalysisPage />);
    state.listQuery.isFetching = false; state.listQuery.data = [{ ...privateRow(), revision: nextRevision }]; view.rerender(<AnalysisPage />);
    expect(screen.getByRole("textbox", { name: "销量来源说明" })).toHaveValue("不自动采用新版本"); expect(screen.getByRole("button", { name: "保存销量校准" })).toBeDisabled();
    expect(screen.getByText(/当前需要重新读取并显式核对版本/)).toBeInTheDocument(); expect(state.save).not.toHaveBeenCalled();
  });
  it.each(["missing", "list-error", "auth-error", "new-user-loading"])("%s after same-owner suspension clears the previous private draft", kind => {
    Object.assign(state.listQuery, { data: [privateRow()], isSuccess: true, isFetchedAfterMount: true });
    const view = render(<AnalysisPage />); fireEvent.click(screen.getByText("旧账号私有商品标题")); start("321", "必须隐藏的私有草稿");
    state.listQuery.isFetching = true; view.rerender(<AnalysisPage />); state.listQuery.isFetching = false;
    if (kind === "missing") state.listQuery.data = [];
    if (kind === "list-error") state.listQuery.isError = true;
    if (kind === "auth-error") state.auth.error = new Error("denied");
    if (kind === "new-user-loading") { state.auth.user!.id = 8; state.auth.loading = true; }
    view.rerender(<AnalysisPage />);
    expect(screen.queryByText(/旧账号私有销量来源/)).not.toBeInTheDocument(); expect(screen.queryByDisplayValue("必须隐藏的私有草稿")).not.toBeInTheDocument();
    expect(state.save).not.toHaveBeenCalled();
  });
});
