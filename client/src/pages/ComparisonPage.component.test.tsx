// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ComparisonPage from "./ComparisonPage";

const state = vi.hoisted(() => {
  const list = vi.fn(), report = vi.fn(), generate = vi.fn(), save = vi.fn(), confirm = vi.fn(), unlock = vi.fn(), confirmSummary = vi.fn(), unlockSummary = vi.fn();
  return {
    flag: true, projectId: 1 as number | null,
    auth: { loading: false, error: null as Error | null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } as { id: number; defaultWorkspaceId: number | null; role: string } | null },
    list, report, generate, save, confirm, unlock, confirmSummary, unlockSummary,
    researchProps: [] as Array<{ projectId: number; workspaceId: number | null; analyses: Array<{ id: number; revision: string }>; selectedIds: number[]; onCompleted: () => void }>,
    client: { analysis: { listByProject: { query: list }, getComparisonReport: { query: report }, comparisonSummary: { mutate: generate }, updateComparisonReport: { mutate: save }, confirmComparisonReport: { mutate: confirm }, unlockComparisonReport: { mutate: unlock }, confirmSummary: { mutate: confirmSummary }, unlockSummary: { mutate: unlockSummary } } },
  };
});
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => state.auth }));
vi.mock("@/contexts/ProjectContext", () => ({ useProject: () => ({ selectedProjectId: state.projectId }) }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: state.client }) } }));
vi.mock("@/lib/mergedListingWorkflow", () => ({ get MERGED_LISTING_WORKFLOW_ENABLED() { return state.flag; } }));
vi.mock("@/lib/mergedReadOnlyFeatures", () => ({ MERGED_READONLY_FEATURES_ENABLED: false }));
vi.mock("./listing/ListingStages", () => ({ default: () => <nav aria-label="Listing 阶段">流程阶段</nav> }));
vi.mock("./listing/CompetitorResearchJobs", () => ({ default: (props: (typeof state.researchProps)[number]) => {
  state.researchProps.push(props);
  return <section aria-label="已保存竞品资料分析任务"><button onClick={props.onCompleted}>模拟资料分析保存完成</button></section>;
} }));
vi.mock("@/components/ProjectSelector", () => ({ default: () => <span>项目选择器</span> }));
vi.mock("streamdown", () => ({ Streamdown: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
// Keep all report panes inspectable; these tests target ownership, not Radix tab navigation.
vi.mock("@/components/ui/tabs", () => ({ Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, TabsTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/ui/scroll-area", () => ({ ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, ScrollBar: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function analysis(id: number, extra = {}) {
  return { id, revision: String(id).repeat(64).slice(0, 64), asin: `B${String(id).padStart(9, "0")}`, title: `竞品 ${id}`, price: "12.50", rating: "4", reviewCount: 0, bulletPoints: '["<script>原文不是HTML</script>"]', keywords: null, reviewAnalysis: null, rawData: null, summary: `已保存摘要 ${id}`, aiSummary: "AI候选", summaryStatus: "draft", summaryVersion: 1, ...extra };
}
function report(summary = "服务器报告", ids = [1, 2], projectId = 1) {
  return { id: 90, projectId, analysisIds: ids, selectionKey: [...ids].sort((a, b) => a - b).join("-"), analyzedAsins: ids.map(id => analysis(id).asin), aiSummary: summary, summary, sellingPointRows: [], status: "draft", version: 1, confirmedAt: null };
}
async function choose(id: number) { await waitFor(() => expect(screen.getByRole("checkbox", { name: `选择 ${analysis(id).asin}` })).toBeEnabled()); fireEvent.click(screen.getByRole("checkbox", { name: `选择 ${analysis(id).asin}` })); }
async function chooseResearch(id: number) { await waitFor(() => expect(screen.getByRole("checkbox", { name: `研究选择 ${analysis(id).asin}` })).toBeEnabled()); fireEvent.click(screen.getByRole("checkbox", { name: `研究选择 ${analysis(id).asin}` })); }
async function selectTwo() { await choose(1); await choose(2); }
const refresh = () => fireEvent.click(screen.getByRole("button", { name: "刷新已保存研究" }));
beforeEach(() => {
  vi.clearAllMocks(); state.researchProps.length = 0; state.flag = true; state.projectId = 1;
  state.auth = { loading: false, error: null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } };
  state.list.mockReset().mockResolvedValue([analysis(1), analysis(2), analysis(3)]);
  state.report.mockReset().mockResolvedValue(null);
  state.generate.mockReset().mockResolvedValue({ report: report("新生成报告") });
  state.save.mockReset().mockResolvedValue(report("已保存新报告"));
  state.confirm.mockReset().mockResolvedValue({ ...report(), status: "confirmed" });
  state.unlock.mockReset().mockResolvedValue(report());
  state.confirmSummary.mockReset().mockResolvedValue({}); state.unlockSummary.mockReset().mockResolvedValue({});
});
afterEach(cleanup);

describe("comparison owned scope", () => {
  it.each([false, true])("allows the supported explicit null workspace with feature flag=%s", async flag => {
    state.flag = flag; state.auth.user!.defaultWorkspaceId = null;
    render(<ComparisonPage />); await choose(1);
    expect(state.list).toHaveBeenCalledWith({ projectId: 1, expectedWorkspaceId: null }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByText("已选 1/3")).toBeInTheDocument();
  });
  it.each([undefined, 0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, "11"])("rejects a missing or invalid workspace %s", value => {
    Object.assign(state.auth.user!, { defaultWorkspaceId: value });
    render(<ComparisonPage />); expect(state.list).not.toHaveBeenCalled(); expect(state.report).not.toHaveBeenCalled();
  });
  it.each([[null, 11], [11, null]] as const)("isolates selection and late reads on workspace %s → %s", async (previous, next) => {
    state.auth.user!.defaultWorkspaceId = previous;
    const old = deferred<ReturnType<typeof report> | null>(); state.report.mockReturnValueOnce(old.promise);
    const view = render(<ComparisonPage />); await selectTwo();
    state.auth.user!.defaultWorkspaceId = next;
    const nextRead = deferred<ReturnType<typeof analysis>[]>(); state.list.mockReturnValueOnce(nextRead.promise);
    view.rerender(<ComparisonPage />);
    expect(screen.queryByText("已选 2/3")).not.toBeInTheDocument();
    await act(async () => { old.resolve(report("旧 nullable 作用域报告")); nextRead.resolve([analysis(1), analysis(2)]); });
    expect(screen.queryByText("旧 nullable 作用域报告")).not.toBeInTheDocument();
    expect(screen.getByText("已选 0/2")).toBeInTheDocument();
  });
  it.each(["loading", "error", "user", "workspace", "project"])("does not read data with missing %s admission", field => {
    if (field === "loading") state.auth.loading = true;
    if (field === "error") state.auth.error = new Error("private");
    if (field === "user") state.auth.user = null;
    if (field === "workspace") state.auth.user!.defaultWorkspaceId = 0;
    if (field === "project") state.projectId = null;
    render(<ComparisonPage />); expect(state.list).not.toHaveBeenCalled(); expect(state.report).not.toHaveBeenCalled();
  });
  it.each(["project", "user", "workspace", "role"])("destroys selection/draft on %s change and ignores old reads", async field => {
    const old = deferred<ReturnType<typeof report> | null>(); state.report.mockReturnValueOnce(old.promise);
    const view = render(<ComparisonPage />); await selectTwo();
    expect(screen.getByText("已选 2/3")).toBeInTheDocument();
    if (field === "project") state.projectId = 2;
    if (field === "user") state.auth.user!.id = 8;
    if (field === "workspace") state.auth.user!.defaultWorkspaceId = 12;
    if (field === "role") state.auth.user!.role = "readonly";
    const next = deferred<ReturnType<typeof analysis>[]>(); state.list.mockReturnValueOnce(next.promise);
    view.rerender(<ComparisonPage />);
    expect(screen.queryByText("已选 2/3")).not.toBeInTheDocument();
    await act(async () => { old.resolve(report("旧作用域报告")); next.resolve([analysis(1), analysis(2)]); });
    expect(screen.queryByText("旧作用域报告")).not.toBeInTheDocument(); expect(screen.getByText("已选 0/2")).toBeInTheDocument();
  });
  it("reports read errors rather than claiming zero records", async () => {
    state.list.mockRejectedValueOnce(new Error("denied")); render(<ComparisonPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("竞品读取失败"); expect(screen.queryByText("暂无竞品分析数据")).not.toBeInTheDocument();
  });
});

describe("existing structured report preservation", () => {
  it("ignores a late old-selection response", async () => {
    const old = deferred<ReturnType<typeof report> | null>(); state.report.mockReturnValueOnce(old.promise);
    render(<ComparisonPage />); await selectTwo(); await choose(2); await choose(3);
    await act(async () => old.resolve(report("旧选择报告")));
    expect(screen.queryByText("旧选择报告")).not.toBeInTheDocument();
  });
  it("rejects report payloads from a different project", async () => {
    state.report.mockResolvedValue(report("错误报告", [1, 2], 2)); render(<ComparisonPage />); await selectTwo();
    expect(await screen.findByRole("alert")).toHaveTextContent("范围不匹配"); expect(screen.queryByText("错误报告")).not.toBeInTheDocument();
  });
  it("does not overwrite an edited draft when refreshed data arrives", async () => {
    state.report.mockResolvedValueOnce(report()); render(<ComparisonPage />); await selectTwo();
    await screen.findByText("服务器报告"); fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByPlaceholderText(/编辑市场概览/), { target: { value: "未保存的人工草稿" } });
    state.report.mockResolvedValue(report("远端刷新")); refresh();
    await waitFor(() => expect(state.report).toHaveBeenCalledTimes(2));
    expect(await screen.findByDisplayValue("未保存的人工草稿")).toBeInTheDocument(); expect(screen.queryByText("远端刷新")).not.toBeInTheDocument();
  });
  it("keeps edits made while a save was pending", async () => {
    state.report.mockResolvedValue(report()); const save = deferred<ReturnType<typeof report>>(); state.save.mockReturnValueOnce(save.promise);
    render(<ComparisonPage />); await selectTwo(); await screen.findByText("服务器报告"); fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByPlaceholderText(/编辑市场概览/), { target: { value: "提交草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    fireEvent.change(screen.getByPlaceholderText(/编辑市场概览/), { target: { value: "提交后的继续编辑" } });
    await act(async () => save.resolve(report("提交草稿")));
    expect(screen.getByDisplayValue("提交后的继续编辑")).toBeInTheDocument();
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ projectId: 1, reportId: 90, summary: "提交草稿" }));
  });
  it("does not let a read started before a save replace the acknowledged report", async () => {
    state.report.mockResolvedValueOnce(report()); render(<ComparisonPage />); await selectTwo(); await screen.findByText("服务器报告");
    const stale = deferred<ReturnType<typeof report>>(); state.report.mockReturnValueOnce(stale.promise); refresh();
    await waitFor(() => expect(state.report).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByPlaceholderText(/编辑市场概览/), { target: { value: "已保存新报告" } });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await screen.findByText("已保存新报告"); await act(async () => stale.resolve(report("读取的旧版本")));
    expect(screen.getByText("已保存新报告")).toBeInTheDocument(); expect(screen.queryByText("读取的旧版本")).not.toBeInTheDocument();
  });
  it("preserves actual report confirm and unlock endpoints", async () => {
    state.report.mockResolvedValue(report()); render(<ComparisonPage />); await selectTwo(); await screen.findByText("服务器报告");
    fireEvent.click(screen.getByRole("button", { name: "确认结果" }));
    fireEvent.click(await screen.findByRole("button", { name: "解锁编辑" }));
    await screen.findByDisplayValue("服务器报告");
    expect(state.confirm).toHaveBeenCalledWith({ projectId: 1, reportId: 90, summary: "服务器报告", sellingPointRows: [] });
    expect(state.unlock).toHaveBeenCalledWith({ projectId: 1, reportId: 90 });
  });
  it("cannot apply a pending save to a new owner or refresh that owner's reads", async () => {
    state.report.mockResolvedValue(report()); const old = deferred<ReturnType<typeof report>>(); state.save.mockReturnValueOnce(old.promise);
    const view = render(<ComparisonPage />); await selectTwo(); await screen.findByText("服务器报告"); fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    state.auth.user!.defaultWorkspaceId = 12; view.rerender(<ComparisonPage />);
    await waitFor(() => expect(screen.getByText("已选 0/3")).toBeInTheDocument()); const calls = state.list.mock.calls.length;
    await act(async () => old.resolve(report("旧工作区保存完成")));
    expect(screen.queryByText("旧工作区保存完成")).not.toBeInTheDocument(); expect(state.list).toHaveBeenCalledTimes(calls);
  });
  it("discards a generated result after selection changes", async () => {
    const generated = deferred<{ report: ReturnType<typeof report> }>(); state.generate.mockReturnValueOnce(generated.promise);
    render(<ComparisonPage />); await selectTwo(); fireEvent.click(screen.getByRole("button", { name: "生成结构化对比" }));
    expect(state.generate).toHaveBeenCalledWith({ projectId: 1, analysisIds: [1, 2] });
    await choose(2); await choose(3); await act(async () => generated.resolve({ report: report("旧生成结果") }));
    expect(screen.queryByText("旧生成结果")).not.toBeInTheDocument();
  });
  it("keeps old report workflows available with the new flag off", async () => {
    state.flag = false; state.report.mockResolvedValue(report()); render(<ComparisonPage />); await selectTwo();
    await screen.findByText("服务器报告"); expect(screen.getByRole("button", { name: "确认结果" })).toBeEnabled();
    expect(screen.queryByRole("region", { name: "选中竞品并排研究" })).not.toBeInTheDocument(); expect(screen.queryByRole("navigation", { name: "Listing 阶段" })).not.toBeInTheDocument();
  });
});

describe("selected saved studies", () => {
  it("passes the exact owned all-record list and independent selected ids into the enabled research lane", async () => {
    render(<ComparisonPage />); await choose(2);
    expect(state.researchProps.at(-1)!.selectedIds).toEqual([]);
    await chooseResearch(2);
    const props = state.researchProps.at(-1)!;
    expect(props.projectId).toBe(1); expect(props.workspaceId).toBe(11); expect(props.selectedIds).toEqual([2]);
    expect(props.analyses.map(row => row.id)).toEqual([1, 2, 3]); expect(props.analyses[0].revision).toBe(analysis(1).revision);
  });
  it("research completion refreshes source records without remounting the lane or discarding a dirty report", async () => {
    state.report.mockResolvedValue(report()); render(<ComparisonPage />); await selectTwo(); await screen.findByText("服务器报告");
    await chooseResearch(1); await chooseResearch(2);
    fireEvent.click(screen.getByRole("button", { name: "编辑" })); fireEvent.change(screen.getByPlaceholderText(/编辑市场概览/), { target: { value: "研究刷新期间保留的草稿" } });
    const next = deferred<ReturnType<typeof analysis>[]>(); state.list.mockReturnValueOnce(next.promise);
    fireEvent.click(screen.getByRole("button", { name: "模拟资料分析保存完成" }));
    await waitFor(() => expect(state.list).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("region", { name: "已保存竞品资料分析任务" })).toBeInTheDocument();
    expect(state.researchProps.at(-1)!.analyses).toEqual([]);
    await act(async () => next.resolve([analysis(1), analysis(2), analysis(3)]));
    expect(await screen.findByDisplayValue("研究刷新期间保留的草稿")).toBeInTheDocument(); expect(state.researchProps.at(-1)!.selectedIds).toEqual([1, 2]);
    expect(state.confirmSummary).not.toHaveBeenCalled(); expect(state.generate).not.toHaveBeenCalled();
  });
  it("never mounts the new job lane when the workflow flag is off", async () => {
    state.flag = false; render(<ComparisonPage />); await choose(1);
    expect(screen.queryByRole("region", { name: "已保存竞品资料分析任务" })).not.toBeInTheDocument(); expect(state.researchProps).toHaveLength(0);
  });
  it("shows one selected study, literal source text, and no fabricated task state", async () => {
    state.list.mockResolvedValue([analysis(1)]); render(<ComparisonPage />); await chooseResearch(1);
    const card = screen.getByRole("article", { name: `${analysis(1).asin} 研究` });
    expect(within(card).getByText("已保存摘要 1")).toBeInTheDocument(); expect(within(card).getByText("<script>原文不是HTML</script>")).toBeInTheDocument();
    expect(card.querySelector("script")).toBeNull(); expect(screen.getByText(/不代表四项深度分析已完成/)).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: `查看 ${analysis(1).asin} 原评论` })).toHaveAttribute("href", "/listing/competitors/1/reviews?projectId=1");
    expect(screen.getByRole("link", { name: "前往竞品采集、分析与后台任务" })).toHaveAttribute("href", "/listing/analysis");
  });
  it("confirms only the exact saved summary and suppresses double dispatch", async () => {
    const done = deferred<object>(); state.confirmSummary.mockReturnValueOnce(done.promise);
    render(<ComparisonPage />); await chooseResearch(1);
    const button = screen.getByRole("button", { name: "确认此摘要" }); fireEvent.click(button); fireEvent.click(button);
    expect(state.confirmSummary).toHaveBeenCalledTimes(1); expect(state.confirmSummary).toHaveBeenCalledWith({ projectId: 1, analysisId: 1, summary: "已保存摘要 1", expectedWorkspaceId: 11, expectedRevision: analysis(1).revision });
    await act(async () => done.resolve({}));
  });
  it("unlocks a saved confirmed summary without invoking analysis", async () => {
    state.list.mockResolvedValue([analysis(1, { summaryStatus: "confirmed" })]); render(<ComparisonPage />); await chooseResearch(1);
    expect(screen.getByRole("button", { name: "确认此摘要" })).toBeDisabled(); fireEvent.click(screen.getByRole("button", { name: "解锁此摘要" }));
    expect(state.unlockSummary).toHaveBeenCalledWith({ projectId: 1, analysisId: 1, expectedWorkspaceId: 11, expectedRevision: analysis(1).revision });
  });
  it("does not write when the server row lacks a complete revision", async () => {
    state.list.mockResolvedValue([analysis(1, { revision: undefined })]); render(<ComparisonPage />); await chooseResearch(1);
    fireEvent.click(screen.getByRole("button", { name: "确认此摘要" }));
    expect(state.confirmSummary).not.toHaveBeenCalled();
  });
  it("carries explicit NULL into review requests rather than inferring a different workspace", async () => {
    state.auth.user!.defaultWorkspaceId = null; render(<ComparisonPage />); await chooseResearch(1);
    fireEvent.click(screen.getByRole("button", { name: "确认此摘要" }));
    expect(state.confirmSummary).toHaveBeenCalledWith(expect.objectContaining({ expectedWorkspaceId: null, expectedRevision: analysis(1).revision }));
  });
  it("refreshes the saved confirmed state and does not infer a task result", async () => {
    render(<ComparisonPage />); await chooseResearch(1);
    state.list.mockResolvedValueOnce([analysis(1, { summaryStatus: "confirmed", summaryVersion: 2 }), analysis(2)]);
    fireEvent.click(screen.getByRole("button", { name: "确认此摘要" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "解锁此摘要" })).toBeEnabled());
    expect(screen.getByText("v2")).toBeInTheDocument(); expect(screen.getByRole("button", { name: "确认此摘要" })).toBeDisabled();
  });
  it("caps selection at eight and a checkbox click toggles only once", async () => {
    state.list.mockResolvedValue(Array.from({ length: 9 }, (_, index) => analysis(index + 1))); render(<ComparisonPage />);
    for (let id = 1; id <= 9; id++) await choose(id);
    expect(screen.getByText("已选 8/8")).toBeInTheDocument(); expect(screen.getByRole("checkbox", { name: `选择 ${analysis(9).asin}` })).not.toBeChecked();
  });
  it("research can select and review more than eight without selecting a legacy report or reading one", async () => {
    state.list.mockResolvedValue(Array.from({ length: 10 }, (_, index) => analysis(index + 1))); render(<ComparisonPage />);
    await screen.findByRole("button", { name: "选择全部研究竞品" }); fireEvent.click(screen.getByRole("button", { name: "选择全部研究竞品" }));
    expect(screen.getByText("研究已选 10/10")).toBeInTheDocument(); expect(screen.getByText("已选 0/8")).toBeInTheDocument();
    expect(screen.getAllByRole("article", { name: /研究$/ })).toHaveLength(10);
    expect(state.researchProps.at(-1)!.selectedIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); expect(state.report).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "清空研究选择" })); expect(screen.queryAllByRole("article", { name: /研究$/ })).toHaveLength(0);
  });
  it("research checkbox changes preserve the exact legacy report selection and dirty draft", async () => {
    state.report.mockResolvedValue(report()); render(<ComparisonPage />); await selectTwo(); await screen.findByText("服务器报告");
    fireEvent.click(screen.getByRole("button", { name: "编辑" })); fireEvent.change(screen.getByPlaceholderText(/编辑市场概览/), { target: { value: "报告草稿独立于研究" } });
    await chooseResearch(3); expect(screen.getByDisplayValue("报告草稿独立于研究")).toBeInTheDocument();
    expect(screen.getByText("已选 2/3")).toBeInTheDocument(); expect(state.report).toHaveBeenCalledTimes(1);
    expect(state.researchProps.at(-1)!.selectedIds).toEqual([3]); await choose(3);
    expect(screen.getByText("研究已选 1/3")).toBeInTheDocument(); expect(screen.getByRole("article", { name: `${analysis(3).asin} 研究` })).toBeInTheDocument();
  });
  it.each(["user", "workspace", "role", "project"])("clears both research and report selection on %s change", async field => {
    const view = render(<ComparisonPage />); await chooseResearch(1); await choose(2);
    if (field === "user") state.auth.user!.id = 8;
    if (field === "workspace") state.auth.user!.defaultWorkspaceId = null;
    if (field === "role") state.auth.user!.role = "reader";
    if (field === "project") state.projectId = 2;
    view.rerender(<ComparisonPage />); await screen.findByText("研究已选 0/3");
    expect(screen.getByText("已选 0/3")).toBeInTheDocument(); expect(screen.queryByRole("article", { name: `${analysis(1).asin} 研究` })).not.toBeInTheDocument();
    expect(state.researchProps.at(-1)!.selectedIds).toEqual([]);
  });
});
